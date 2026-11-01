/* A TEAM CAN TAKE ITS WHOLE HISTORY AWAY (Oct 31 audit, item 107: an audit
   export a security team loads into its own system).

   Driven through the Worker's own routes:
     - every team action lands in the record for its day as well as in the
       recent-activity record, and that day record expires on its own;
     - an owner downloads a period as NDJSON, oldest first, one event per
       line, each with its time, team, actor, action and detail;
     - the same export answers the owner's API key, so a tool can pull it;
     - a member is refused; a range that is malformed, backwards or longer
       than 92 days is refused and says so;
     - a day past its cap says how many entries are missing instead of
       pretending the day was complete;
     - the export is itself in the log. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'team-audit-export.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _teamLogDayAppend };\n');
const W = await import(harness + '?t=' + Date.now());
globalThis.fetch = async () => new Response('{}', { status: 200 });

const m = new Map(), ttl = new Map(), vals = new Map();
const env = {
  JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v, o) { m.set(k, v); if (o && o.expirationTtl) ttl.set(k, o.expirationTtl); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'incr' || b.op === 'reserve') { vals.set(n, cur + Number(b.amount || 0)); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur, count: 1 });
  } }) }),
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const call = (path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.1.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}) }), env, ctx);
async function account(email, plan) {
  const tok = (await (await call('/auth/signup', { email, name: 'T', password: 'A-real-Passw0rd!' })).json()).token;
  if (plan !== 'free') await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const lines = (t) => t.split('\n').filter(Boolean).map(l => JSON.parse(l));

const owner = await account('owner-ax@example.com', 'elite');
const member = await account('member-ax@example.com', 'free');
const made = await (await call('/team/create', { name: 'Acme' }, owner)).json();
ok(made.ok, 'the owner creates a team', made);
const inv = await (await call('/team/invite', { email: 'member-ax@example.com', role: 'member' }, owner)).json();
ok((await (await call('/team/join', { token: inv.inviteToken }, member)).json()).ok, 'the member joins it');
const teamId = made.team && made.team.id || [...m.keys()].find(k => /^teamlog:[^:]+$/.test(k)).split(':')[1];
const today = new Date().toISOString().slice(0, 10);

section('Every action lands in the record for its day, which expires on its own');
{
  const key = 'teamlog:' + teamId + ':' + today;
  const rec = JSON.parse(m.get(key) || 'null');
  ok(rec && rec.e.map(e => e.action).join(',') === 'team_created,member_invited,member_joined', 'the day holds all three actions in order', rec && rec.e.map(e => e.action));
  ok(ttl.get(key) === 400 * 86400, 'and is kept 400 days, then expired by the store', ttl.get(key));
  ok(JSON.parse(m.get('teamlog:' + teamId)).length === 3, 'the recent-activity record still has them too');
}

section('An owner downloads the period as NDJSON, oldest first');
{
  const r = await call('/team/audit/export', { from: today, to: today }, owner);
  ok(r.status === 200 && /application\/x-ndjson/.test(r.headers.get('Content-Type') || ''), 'NDJSON', r.status);
  ok(/attachment; filename="amv-team-activity-/.test(r.headers.get('Content-Disposition') || ''), 'as a file');
  const ev = lines(await r.text());
  ok(ev.length === 3 && ev.every(e => e.type === 'team_action' && e.team === teamId && e.actor && e.action && !isNaN(Date.parse(e.time))), 'three events, each with time, team, actor and action', ev);
  ok(ev[1].action === 'member_invited' && ev[1].detail.invitee === 'member-ax@example.com', 'with what the action was about', ev[1]);
  ok(r.headers.get('X-AMV-Events') === '3', 'and the count in a header');
  const log = JSON.parse(m.get('teamlog:' + teamId));
  ok(log[log.length - 1].action === 'audit_exported' && log[log.length - 1].from === today, 'the export is itself in the log');
}

section('An API key pulls the same file, so a security tool can fetch it on a schedule');
{
  const key = (await (await call('/v1/keys/create', { name: 'siem' }, owner)).json()).key;
  ok(/^amv_sk_/.test(key || ''), 'the owner makes a key', key);
  const r = await call('/team/audit/export', { from: today, to: today }, key);
  ok(r.status === 200 && lines(await r.text()).some(e => e.action === 'audit_exported'), 'and the key downloads the log', r.status);
}

section('A member is refused; a bad range is refused and says why');
{
  const r = await call('/team/audit/export', { from: today, to: today }, member);
  ok(r.status === 403 && /owner or admin/.test((await r.json()).error), 'a member cannot export it');
  ok((await call('/team/audit/export', { from: today, to: today })).status === 401, 'nobody signed in cannot either');
  const bad = async (b) => { const x = await call('/team/audit/export', b, owner); const t = await x.text(); let d = {}; try { d = JSON.parse(t); } catch (e) {} return { s: x.status, d }; };
  let x = await bad({ from: '2026-02-30', to: today });
  ok(x.s === 400 && x.d.code === 'bad_range', 'a date that does not exist', x);
  x = await bad({ from: '2026-10-02', to: '2026-10-01' });
  ok(x.s === 400 && x.d.code === 'bad_range', 'a range that runs backwards', x);
  x = await bad({ from: '2026-01-01', to: '2026-12-31' });
  ok(x.s === 400 && x.d.code === 'range_too_long' && /92/.test(x.d.error), 'and more than 92 days', x);
  x = await call('/team/audit/export', { from: '2026-08-01', to: '2026-10-31' }, owner);
  ok(x.status === 200, 'exactly 92 days is allowed', x.status);
}

section('A day past its cap says how many entries are missing');
{
  const day = '2026-09-15';
  const t = Date.parse(day + 'T12:00:00Z');
  m.set('teamlog:' + teamId + ':' + day, JSON.stringify({ e: Array.from({ length: 5000 }, (_, i) => ({ t: t + i, actor: 'bot@example.com', action: 'task_created' })), over: 0 }));
  await W._teamLogDayAppend(env, teamId, { t: t + 9999, actor: 'bot@example.com', action: 'task_created' });
  await W._teamLogDayAppend(env, teamId, { t: t + 9999, actor: 'bot@example.com', action: 'task_created' });
  const rec = JSON.parse(m.get('teamlog:' + teamId + ':' + day));
  ok(rec.e.length === 5000 && rec.over === 2, 'the record stops growing and counts what it did not keep', { n: rec.e.length, over: rec.over });
  const ev = lines(await (await call('/team/audit/export', { from: day, to: day }, owner)).text());
  const gap = ev[ev.length - 1];
  ok(ev.length === 5001 && gap.type === 'gap' && gap.missing === 2 && gap.day === day, 'and the export ends that day with a gap line saying 2 are missing', gap);
}

report();
done();
