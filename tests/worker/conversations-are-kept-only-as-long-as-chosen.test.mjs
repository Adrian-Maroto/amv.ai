/* CONVERSATIONS ARE KEPT ONLY AS LONG AS CHOSEN (Oct 31 audit, item 108;
   src/worker/34a-retention.js).

   Through the Worker's own routes:
     - a person chooses 30 days: a push keeps what is recent, drops what is
       older by its last change, and keeps what has no date;
     - a device still holding an old conversation cannot put it back;
     - a pull never hands out anything older, even before the stored copy is
       trimmed, and says the period so the app trims its own copy;
     - a team's period applies to every member, the shorter of the two wins,
       and only an owner or admin can set it;
     - a bad period is refused;
     - the nightly sweep trims people who never come back, team members
       included, and leaves no address behind for an erased account. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'retention.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, runRetentionSweep };\n');
const W = await import(harness + '?t=' + Date.now());
globalThis.fetch = async () => new Response('{}', { status: 200 });

const m = new Map(), vals = new Map();
const env = {
  JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test',
  AMV_KV: { async get(k){ return m.has(k) ? m.get(k) : null; }, async put(k, v){ m.set(k, v); }, async delete(k){ m.delete(k); },
    async list({ prefix, cursor, limit } = {}){ const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).sort(); const start = cursor ? +cursor : 0; const n = limit || 1000;
      const page = all.slice(start, start + n); const end = start + n >= all.length; return { keys: page.map(name => ({ name })), list_complete: end, cursor: end ? undefined : String(start + n) }; } },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init){
    const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'clear') return r({ ok: true });
    if (b.op === 'claim'){ if (vals.get('c:' + n)) return r({ claimed: false }); vals.set('c:' + n, 1); return r({ claimed: true, owner: n }); }
    if (b.op === 'release'){ vals.delete('c:' + n); return r({ ok: true }); }
    if (b.op === 'incr'){ vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur, count: 1 });
  } }) }),
};
const ctx = { waitUntil(){}, passThroughOnException(){} };
let ip = 1;
const call = async (path, body, tok) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.3.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: JSON.stringify(body || {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
async function account(email, plan) {
  const tok = (await call('/auth/signup', { email, name: 'T', password: 'A-real-Passw0rd! long' })).d.token;
  if (plan) await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const DAY = 86400000, now = Date.now();
const conv = (id, ageDays, extra) => ({ id, title: id, msgs: [{ role: 'user', content: 'hi' }], created: now - 400 * DAY, ...(ageDays == null ? {} : { updated: now - ageDays * DAY }), ...(extra || {}) });
const ids = (list) => (list || []).map(x => x.id).sort().join(',');
const stored = (email) => JSON.parse(m.get('data:' + email) || '{}');

const ana = await account('ana@example.com');

section('With no period chosen, nothing is removed');
{
  const p = await call('/sync/push', { data: { convs: [conv('old', 400), conv('new', 1)] }, baseRev: 0 }, ana);
  ok(p.status === 200 && p.d.retention === null, 'the push says there is no period', p.d);
  ok(ids(stored('ana@example.com').convs) === 'new,old', 'both conversations are kept');
}

section('A person chooses 30 days: old goes, recent and undated stay');
{
  const bad = await call('/account/retention', { days: 45 }, ana);
  ok(bad.status === 400 && bad.d.code === 'bad_request', 'a period that is not offered is refused', bad.d);
  const set = await call('/account/retention', { days: 30 }, ana);
  ok(set.status === 200 && set.d.days === 30 && set.d.by === 'you', 'the choice is saved and answered', set.d);
  const rev = stored('ana@example.com')._rev;
  const undated = { id: 'undated', title: 'x', msgs: [] };
  const p = await call('/sync/push', { data: { convs: [conv('old', 400), conv('new', 1), conv('edge', 29), undated], sessions: [conv('s-old', 60), conv('s-new', 2)] }, baseRev: rev }, ana);
  const s = stored('ana@example.com');
  ok(ids(s.convs) === 'edge,new,undated', 'the stored record keeps the recent and the undated, and drops the old', ids(s.convs));
  ok(ids(s.sessions) === 's-new', 'Dev and Lab sessions follow the same rule', ids(s.sessions));
  ok(p.d.retention && p.d.retention.days === 30 && p.d.merged === true, 'the push says the period and tells the app to pull', p.d);
}

section('A device still holding an old conversation cannot put it back');
{
  const p = await call('/sync/push', { data: { convs: [conv('old', 400), conv('older', 90)] }, baseRev: 0 }, ana);
  ok(p.status === 200 && !stored('ana@example.com').convs.some(c => c.id === 'old' || c.id === 'older'), 'a stale device’s old conversations are dropped again');
}

section('A pull never hands out anything older, even before the stored copy is trimmed');
{
  const s = stored('ana@example.com'); s.convs.push(conv('planted', 200)); m.set('data:ana@example.com', JSON.stringify(s));
  const p = await call('/sync/pull', {}, ana);
  ok(p.status === 200 && !p.d.data.convs.some(c => c.id === 'planted'), 'the old one is not in the answer');
  ok(p.d.retention && p.d.retention.days === 30 && p.d.retention.by === 'you', 'and the answer carries the period for the app');
}

section('A team’s period applies to every member, and the shorter one wins');
{
  const owner = await account('owner-r@example.com', 'elite');
  const bo = await account('bo@example.com');
  const made = (await call('/team/create', { name: 'Acme' }, owner)).d;
  const inv = (await call('/team/invite', { email: 'bo@example.com', role: 'member' }, owner)).d;
  ok((await call('/team/join', { token: inv.inviteToken }, bo)).d.ok, 'a member joins');
  const no = await call('/team/policy', { retentionDays: 90 }, bo);
  ok(no.status === 403, 'a member cannot set the team’s period', no.status);
  ok((await call('/team/policy', { retentionDays: 45 }, owner)).status === 400, 'a period that is not offered is refused');
  const set = await call('/team/policy', { retentionDays: 90 }, owner);
  ok(set.status === 200 && set.d.retentionDays === 90, 'the owner sets 90 days', set.d);
  ok(m.has('retainteam:' + made.team.id), 'and the nightly sweep can find the team');
  let r = (await call('/account/retention', {}, bo)).d;
  ok(r.days === 90 && r.by === 'team', 'a member with no choice of their own gets the team’s', r);
  await call('/account/retention', { days: 30 }, bo);
  r = (await call('/account/retention', {}, bo)).d;
  ok(r.days === 30 && r.by === 'you', 'a member can go shorter', r);
  await call('/account/retention', { days: 365 }, bo);
  r = (await call('/account/retention', {}, bo)).d;
  ok(r.days === 90 && r.by === 'team', 'but never longer than the team', r);
  const p = await call('/sync/push', { data: { convs: [conv('b-old', 120), conv('b-new', 5)] }, baseRev: 0 }, bo);
  ok(ids(stored('bo@example.com').convs) === 'b-new', 'the member’s push is trimmed to the team’s period', ids(stored('bo@example.com').convs));
  const log = JSON.parse(m.get('teamlog:' + made.team.id));
  ok(log.some(e => e.action === 'retention_changed' && e.days === 90), 'and the change is in the team’s activity');
}

section('The nightly sweep trims people who never come back');
{
  m.set('data:ana@example.com', JSON.stringify({ _rev: 50, convs: [conv('a-gone', 100), conv('a-stays', 3)] }));
  m.set('data:bo@example.com', JSON.stringify({ _rev: 50, convs: [conv('b-gone', 100), conv('b-stays', 3)] }));
  m.set('retainidx:ghost@example.com', '1');
  const r = await W.runRetentionSweep(env, now);
  ok(r.done && r.trimmed === 2, 'one conversation each, for the person and for the team member', r);
  ok(ids(stored('ana@example.com').convs) === 'a-stays' && ids(stored('bo@example.com').convs) === 'b-stays', 'what is recent stays');
  ok(!m.has('retainidx:ghost@example.com'), 'an erased account leaves no address behind in the index');
  const again = await W.runRetentionSweep(env, now);
  ok(again.ran === false, 'and the night’s run is not repeated');
}

section('Choosing to keep everything again takes the person out of the sweep');
{
  const r = await call('/account/retention', { days: null }, ana);
  ok(r.d.days === null && !m.has('retainidx:ana@example.com'), 'no period, and no index entry', r.d);
}

report();
done();
