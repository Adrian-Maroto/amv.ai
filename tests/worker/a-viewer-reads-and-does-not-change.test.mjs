/* A VIEWER READS THE TEAM'S WORK AND CHANGES NONE OF IT.

   Oct 26 audit: role-based access. Teams had owner, admin and member; the
   role every company asks for next is the one that can see and not touch -
   a client, an auditor, a manager who reads. Run against the Worker:
   - an owner can invite a viewer and turn a member into one and back;
   - a viewer reads what is shared, the shared projects and their files;
   - a viewer cannot share, create or save a shared project, or create or
     update a task - each refused by the server, saying why;
   - work cannot be assigned to a viewer, who could never mark it done;
   - nobody but the owner sets roles, and nobody can be made owner. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'viewer.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, _withTeam, _withFam, FAMILY_MAX_CHILDREN, TEAM_SEATS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv(readDelayMs = 12) {
  const m = new Map(); const n = new Map();
  const env0 = {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    _map: m,
    AMV_KV: {
      _map: m,
      /* Answered with what was held when the read arrived. Sleeping first and
         reading the map afterwards makes a slow reader see the other writer's
         result, so nothing ever disagrees and no lock can be missed. */
      async get(k) {
        const asServed = m.has(k) ? m.get(k) : null;
        /* One read, once, made much slower than the rest. Firing two writers
           together expresses simultaneity, not sequence, and the sequence that
           does the damage - one reads, the other completes in full, the first
           writes - comes up too rarely to catch. Holding a single read open
           states it instead. The delay is one-shot so the writer that has to
           get in behind it is not slowed down as well. */
        const slow = env0._slowOnce;
        if (slow && slow.key === k) { env0._slowOnce = null; await new Promise(r => setTimeout(r, slow.ms)); return asServed; }
        if (readDelayMs) await new Promise(r => setTimeout(r, readDelayMs));
        return asServed;
      },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: withAuthOps({
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = n.get(x) || 0;
        if (b.op === 'claim') { if (n.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); n.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { n.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { n.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: n.get(x) })); }
        if (b.op === 'rateCheck') { n.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    }),
  };
  return env0;
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok, method) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '66.66.66.66',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: (method === 'GET') ? undefined : JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const together = async (...ps) => (await Promise.allSettled(ps))
  .filter(r => r.status === 'rejected')
  .map(r => String((r.reason && r.reason.message) || r.reason));

const PW = 'A-real-Passw0rd!';
const signup = async (env, email, name) =>
  (await (await call(env, '/auth/signup', { email, name, password: PW })).json()).token;

async function anOwnerWithATeam(env, plan = 'ultra') {
  const tok = await signup(env, 'owner@example.com', 'Olive');
  await W.setEntitlement(env, 'owner@example.com', plan, { source: 'stripe' });
  const t = await post(env, '/team/create', { name: 'The Team' }, tok);
  const team = t.body.team || t.body;
  ok(!!(team && team.id), 'the team was created on the ' + plan + ' plan', t.body.error || (team && team.id));
  return { tok, team };
}
async function anInviteFor(env, ownerTok, email, role) {
  const r = await post(env, '/team/invite', { email, role: role || 'member' }, ownerTok);
  return r.body.inviteToken;
}



const env = mkEnv(0);
const { tok, team } = await anOwnerWithATeam(env);
const memTok = await signup(env, 'mia@example.com', 'Mia');
const viewTok = await signup(env, 'vic@example.com', 'Vic');
{
  const inv = await anInviteFor(env, tok, 'mia@example.com', 'member');
  await post(env, '/team/join', { token: inv }, memTok);
}
const shared = await post(env, '/team/project/create', { name: 'Board pack', instructions: 'Keep it short.', files: [{ id: 'f1', name: 'q3.txt', text: 'Revenue up 14 percent' }] }, memTok);
const pid = shared.body.project.id;

section('An owner invites a viewer');
{
  const inv = await anInviteFor(env, tok, 'vic@example.com', 'viewer');
  const j = await post(env, '/team/join', { token: inv }, viewTok);
  ok(!j.body.error, 'the viewer joined', j.body.error || 'ok');
  const t = JSON.parse(env.AMV_KV._map.get('team:' + team.id));
  ok(t.members.find(m => m.email === 'vic@example.com').role === 'viewer', 'as a viewer', t.members.map(m => m.role));
}

section('A viewer reads the shared work');
{
  const list = await post(env, '/team/project/list', {}, viewTok);
  ok(list.body.projects && list.body.projects.length === 1, 'sees the shared projects', list.body);
  const got = await post(env, '/team/project/get', { id: pid }, viewTok);
  ok(got.body.project && got.body.project.files[0].text === 'Revenue up 14 percent', 'and reads their files', got.body.error);
  const lib = await post(env, '/team/shared', {}, viewTok);
  ok(lib.body.ok, 'and the shared library', lib.body);
}

section('A viewer changes none of it, and is told why');
{
  const tries = [
    ['/team/share', { kind: 'prompt', item: { title: 'Mine', text: 'x' } }],
    ['/team/project/create', { name: 'Viewer project' }],
    ['/team/project/save', { id: pid, baseRev: 1, instructions: 'Changed by a viewer' }],
    ['/team/task/create', { title: 'A task from a viewer' }],
  ];
  for (const [p, b] of tries) {
    const r = await post(env, p, b, viewTok);
    ok(r.status === 403 && r.body.code === 'viewer', p + ' is refused for a viewer', r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  }
  const got = await post(env, '/team/project/get', { id: pid }, memTok);
  ok(got.body.project.instructions === 'Keep it short.' && got.body.project.rev === 1, 'the project is exactly as it was', got.body.project.rev);
  const task = await post(env, '/team/task/create', { title: 'Draft the summary' }, memTok);
  ok(task.body.ok !== false && !task.body.error, 'a member still creates tasks', task.body.error);
  const tid = (task.body.task || {}).id || ((task.body.tasks || [])[0] || {}).id;
  const up = await post(env, '/team/task/update', { id: tid, status: 'done' }, viewTok);
  ok(up.status === 403 && up.body.code === 'viewer', 'and a viewer cannot update one', up.status + ' ' + JSON.stringify(up.body).slice(0, 120));
  const asg = await post(env, '/team/task/create', { title: 'For Vic', assignee: 'vic@example.com' }, memTok);
  ok(asg.status === 400 && asg.body.code === 'assignee_viewer', 'nor be given one', asg.status + ' ' + JSON.stringify(asg.body).slice(0, 120));
}

section('Only the owner sets roles, and owner is never one to give');
{
  const byMember = await post(env, '/team/role', { email: 'vic@example.com', role: 'member' }, memTok);
  ok(byMember.status === 403, 'a member cannot change a role', byMember.status);
  const up = await post(env, '/team/role', { email: 'vic@example.com', role: 'member' }, tok);
  ok(!up.body.error, 'the owner makes the viewer a member', up.body.error);
  const now = await post(env, '/team/project/save', { id: pid, baseRev: 1, instructions: 'Keep it short. Lead with revenue.' }, viewTok);
  ok(now.body.ok && now.body.project.rev === 2, 'who can then edit', now.body.error);
  const down = await post(env, '/team/role', { email: 'mia@example.com', role: 'viewer' }, tok);
  ok(!down.body.error, 'and makes a member a viewer', down.body.error);
  const after = await post(env, '/team/project/save', { id: pid, baseRev: 2, instructions: 'x' }, memTok);
  ok(after.status === 403 && after.body.code === 'viewer', 'who from then on cannot', after.status);
  const own = await post(env, '/team/role', { email: 'vic@example.com', role: 'owner' }, tok);
  const t = JSON.parse(env.AMV_KV._map.get('team:' + team.id));
  ok(t.members.filter(m => m.role === 'owner').length === 1 && t.members.find(m => m.email === 'vic@example.com').role !== 'owner', 'asking for owner never makes a second one', own.body);
}

globalThis.fetch = realFetch;
if (report('a-viewer-reads-and-does-not-change') > 0) process.exitCode = 1;
done();
