/* A TEAM EDITS ONE PROJECT TOGETHER.

   Shared projects, at the server that holds them: one record per project,
   edited by every member, read by every member's chats.

   - any member can share a project, and every member can read and edit it;
   - somebody outside the team, or who has left it, can do neither;
   - a save names the revision it was made from, and one made from an older
     revision is REFUSED with what is there now - never merged over it, never
     silently lost - including when two people press Save at the same moment;
   - each save keeps the instructions it replaced, with who and when;
   - only whoever shared it, or an owner or admin, can stop sharing it;
   - the files are bounded, and the team's audit log records each change. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'tproj.harness.mjs');
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
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = n.get(x) || 0;
        if (b.op === 'claim') { if (n.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); n.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { n.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { n.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: n.get(x) })); }
        if (b.op === 'rateCheck') { n.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
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


async function aTeamOfThree(env) {
  const { tok, team } = await anOwnerWithATeam(env);
  const annTok = await signup(env, 'ann@example.com', 'Ann');
  const benTok = await signup(env, 'ben@example.com', 'Ben');
  for (const [e, t] of [['ann@example.com', annTok], ['ben@example.com', benTok]]) {
    const inv = await anInviteFor(env, tok, e);
    const j = await post(env, '/team/join', { token: inv }, t);
    ok(j.body.ok !== false && !j.body.error, e + ' joined', j.body.error || 'ok');
  }
  return { tok, team, annTok, benTok };
}

section('Any member shares a project; every member reads and edits it');
let shared;
{
  const env = mkEnv(0);
  const { tok, team, annTok, benTok } = await aTeamOfThree(env);
  const c = await post(env, '/team/project/create', { name: 'Clinic FAQ', icon: '\u{1F9B7}', instructions: 'Answer in French.',
    files: [{ id: 'pf1', name: 'prices.txt', text: 'Cleaning 60 EUR' }] }, annTok);
  ok(c.body.ok && c.body.project.rev === 1 && c.body.project.createdBy === 'ann@example.com', 'a member shared it, at version 1', c.body.error || c.body.project.rev);
  shared = { env, team, tok, annTok, benTok, id: c.body.project.id };
  const list = await post(env, '/team/project/list', {}, benTok);
  ok(list.body.projects.length === 1 && list.body.projects[0].name === 'Clinic FAQ', 'a colleague sees it listed', list.body.projects);
  const got = await post(env, '/team/project/get', { id: shared.id }, benTok);
  ok(got.body.project.files[0].text === 'Cleaning 60 EUR', 'and can read its files', got.body.project.files);
  const ed = await post(env, '/team/project/save', { id: shared.id, baseRev: 1, instructions: 'Answer in French. Quote prices in euros.' }, benTok);
  ok(ed.body.ok && ed.body.project.rev === 2 && ed.body.project.updatedBy === 'ben@example.com', 'and edit it, as version 2', ed.body.error || ed.body.project.rev);
  ok(ed.body.project.history[0].instructions === 'Answer in French.' && ed.body.project.history[0].by === 'ann@example.com',
     'the instructions it replaced are kept, with who wrote them', ed.body.project.history[0]);
  const log = JSON.parse(env.AMV_KV._map.get('teamlog:' + team.id) || '[]').map(e => e.action);
  ok(log.includes('project_shared') && log.includes('project_edited'), 'and the team’s log records both', log);
}

section('A save made from an older version is refused with what is there now');
{
  const { env, annTok, id } = shared;
  const stale = await post(env, '/team/project/save', { id, baseRev: 1, instructions: 'Answer in English.' }, annTok);
  ok(stale.status === 409 && stale.body.code === 'conflict', 'refused as a conflict', stale.body);
  ok(stale.body.project && stale.body.project.rev === 2 && /euros/.test(stale.body.project.instructions), 'carrying the newer version to show', stale.body.project && stale.body.project.rev);
  const now = await post(env, '/team/project/get', { id }, annTok);
  ok(/euros/.test(now.body.project.instructions), 'and the colleague’s work is untouched', now.body.project.instructions);
  const knowingly = await post(env, '/team/project/save', { id, baseRev: 2, instructions: 'Answer in English.' }, annTok);
  ok(knowingly.body.ok && knowingly.body.project.rev === 3, 'saving over it after seeing it is allowed, as a new version', knowingly.body.error || knowingly.body.project.rev);
}

section('Two people pressing Save at the same moment: one wins, the other is told');
{
  const env = mkEnv();
  const { annTok, benTok } = await aTeamOfThree(env);
  const c = await post(env, '/team/project/create', { name: 'Race', instructions: 'v1' }, annTok);
  const id = c.body.project.id;
  const [a, b] = await Promise.all([
    post(env, '/team/project/save', { id, baseRev: 1, instructions: 'from Ann' }, annTok),
    post(env, '/team/project/save', { id, baseRev: 1, instructions: 'from Ben' }, benTok),
  ]);
  const wins = [a, b].filter(r => r.body.ok), told = [a, b].filter(r => r.status === 409);
  ok(wins.length === 1 && told.length === 1, 'exactly one save lands and the other is refused', { a: a.status, b: b.status });
  const now = await post(env, '/team/project/get', { id }, annTok);
  ok(now.body.project.rev === 2 && now.body.project.instructions === wins[0].body.project.instructions, 'the stored project is the one that landed', now.body.project);
}

section('Nobody outside the team reaches it');
{
  const { env, id, team } = shared;
  const outTok = await signup(env, 'mallory@example.com', 'Mallory');
  const g = await post(env, '/team/project/get', { id }, outTok);
  const s = await post(env, '/team/project/save', { id, baseRev: 3, instructions: 'pwned' }, outTok);
  const l = await post(env, '/team/project/list', {}, outTok);
  ok(g.status === 404 && s.status === 404 && (l.body.projects || []).length === 0, 'a stranger can neither read, edit nor list it', { g: g.status, s: s.status, l: l.body.projects });
  const noTok = await post(env, '/team/project/get', { id });
  ok(noTok.status === 401, 'and nobody signed out can', noTok.status);
  const rec = await W.DB.get(env, 'tproj', team.id + ':' + id);
  ok(rec.instructions === 'Answer in English.', 'the project is as its team left it', rec.instructions);
}

section('Only whoever shared it, or an admin, can stop sharing it');
{
  const { env, id, tok, benTok } = shared;
  const ben = await post(env, '/team/project/delete', { id }, benTok);
  ok(ben.status === 403, 'a member who did not share it cannot', ben.status);
  const owner = await post(env, '/team/project/delete', { id }, tok);
  ok(owner.body.ok, 'the team owner can', owner.body.error || 'ok');
  const after = await post(env, '/team/project/get', { id }, benTok);
  const list = await post(env, '/team/project/list', {}, benTok);
  ok(after.status === 404 && after.body.code === 'gone' && list.body.projects.length === 0, 'and it is gone for everyone, from the list too', { s: after.status, l: list.body.projects });
}

section('The files are bounded');
{
  const { env, annTok } = shared;
  const big = await post(env, '/team/project/create', { name: 'Huge', files: [{ name: 'a.txt', text: 'x'.repeat(600 * 1024 + 1) }] }, annTok);
  ok(big.status === 413, 'more than 600k characters of files is refused', big.status);
  const many = await post(env, '/team/project/create', { name: 'Many', files: Array.from({ length: 21 }, (_, i) => ({ name: i + '.txt', text: 'x' })) }, annTok);
  ok(many.status === 400, 'and so are more than twenty files', many.status);
}

report('a-team-edits-one-project-together');
done();
