/* A SIGN-IN THAT CANNOT BE CHECKED GRANTS NOTHING, AND AN ENDING IS SAID ONLY
   WHEN IT HOLDS (Build 16 audit SEC-04, SEC-05, SEC-06, Nov 20).

   Against the real Worker and the real counter object, which can be made to
   stop answering:
   - with the revocation object down, renewing a session and the operator's
     user list refuse as a short wait - never a fresh pair, never the list;
   - signed out everywhere between the check and the issue, a renewal is not
     promoted to the new generation;
   - ending a sign-in from the device list says "done" only once it is;
   - five hundred and one endings do not bring the first one back. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'surecheck.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { authRefresh, adminUsers, sessionsEnd, issueTokens, verifyToken, DB, counter, _authName, revokeUserTokens };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('AUDIT')) quiet(...a); };
globalThis.fetch = async () => new Response('{}', { status: 200 });

const live = new Map(), objects = new Map(), queues = new Map();
let down = null;
const env = { JWT_SECRET: 'x'.repeat(48), APP_URL: 'https://amv.test', OWNER_EMAIL: 'owner@example.com',
  AMV_KV: { async get(k) { return live.has(k) ? live.get(k) : null; }, async put(k, v) { live.set(k, String(v)); }, async delete(k) { live.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...live.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: { idFromName: n => n, get: n => ({ fetch: async (u, init) => {
    const p = JSON.parse(init.body);
    const run = async () => {
      if (down && down(n, p)) throw new Error('object down');
      if (!objects.has(n)) { const st = new Map(); objects.set(n, new W.AMVCounter({ storage: { async get(k) { return structuredClone(st.get(k)); }, async put(k, v) { st.set(k, structuredClone(v)); },
        async delete(k) { st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {})); }
      return objects.get(n).fetch(new Request('https://counter.invalid', init));
    };
    const prev = queues.get(n) || Promise.resolve(); const q = prev.then(run, run); queues.set(n, q.catch(() => {})); return q;
  } }) } };
const authDown = (n, p) => /^auth/.test(p.op);
const answer = async (fn, req) => { try { const r = await fn(req, env); return { status: r.status, d: await r.json() }; } catch (e) { return e && e.amvRefusal ? { status: e.amvRefusal.status, d: e.amvRefusal.body } : { status: 500, d: { error: String(e) } }; } };
const post = (path, body, token) => new Request('https://x' + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.2.0.' + Math.floor(Math.random() * 250) }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body || {}) });

const EM = 'kim@example.com', OWN = 'owner@example.com';
await W.DB.put(env, 'acct', EM, { email: EM, name: 'Kim', createdAt: Date.now() - 1e6 });
await W.DB.put(env, 'acct', OWN, { email: OWN, name: 'Owner', createdAt: Date.now() - 1e6 });

section('The revocation object down: nothing is granted');
{
  const t = await W.issueTokens(env, EM, 'Kim', '');
  down = authDown;
  const r = await answer(W.authRefresh, post('/auth/refresh', { refreshToken: t.refreshToken }));
  ok(r.status === 503 && !r.d.token, 'a renewal is a short wait, not a fresh pair', r);
  const o = await W.issueTokens(env, OWN, 'Owner', '').catch(() => null);
  down = null;
  const own = await W.issueTokens(env, OWN, 'Owner', '');
  down = authDown;
  const a = await answer(W.adminUsers, new Request('https://x/admin/users', { headers: { Authorization: 'Bearer ' + own.token } }));
  ok(a.status === 503 && !a.d.users, 'the operator’s user list is refused too', { status: a.status, keys: Object.keys(a.d || {}) });
  down = null;
  const fine = await answer(W.authRefresh, post('/auth/refresh', { refreshToken: t.refreshToken }));
  ok(fine.status === 200 && !!fine.d.token, 'and once it answers, the same renewal works', fine.status);
}

section('Signed out everywhere between the check and the issue');
{
  const t = await W.issueTokens(env, EM, 'Kim', '');
  /* The revocation lands right after the renewal's check read the epoch. */
  let armed = true;
  const realGet = env.AMV_COUNTER.get;
  env.AMV_COUNTER.get = (n) => { const stub = realGet(n); return { fetch: async (u, init) => {
    const r = await stub.fetch(u, init); const p = JSON.parse(init.body);
    if (armed && n === W._authName(EM) && p.op === 'authGet') { armed = false; env.AMV_COUNTER.get = realGet; await W.revokeUserTokens(env, EM); }
    return r; } }; };
  const r = await answer(W.authRefresh, post('/auth/refresh', { refreshToken: t.refreshToken }));
  env.AMV_COUNTER.get = realGet;
  ok(r.status === 401 && !r.d.token, 'the old token is not traded for a pair of the new generation', r);
}

section('Ending a sign-in is said only when it holds');
{
  const me = await W.issueTokens(env, EM, 'Kim', 'aaaaaaaa-0000-4000-8000-000000000001');
  const other = 'bbbbbbbb-0000-4000-8000-000000000002';
  live.set('sess:' + EM + ':' + other, JSON.stringify({ id: other, dev: 'Phone' }));
  down = (n, p) => p.op === 'authEndSession';
  const r = await answer(W.sessionsEnd, post('/v1/sessions/end', { id: other }, me.token));
  ok(r.status === 503 && r.d.code === 'end_pending', 'the object could not record it: not "done"', r);
  down = null;
  const r2 = await answer(W.sessionsEnd, post('/v1/sessions/end', { id: other }, me.token));
  ok(r2.status === 200 && r2.d.ok, 'once it can, it is done', r2);
}

section('Five hundred and one endings do not bring the first one back');
{
  const name = W._authName('many@example.com');
  await W.counter(env, name, { op: 'authSeed', floor: 0, strict: true });
  const first = await W.counter(env, name, { op: 'authGet', sid: 's0', strict: true });
  for (let i = 0; i < 501; i++) await W.counter(env, name, { op: 'authEndSession', sid: 's' + i, ttlMs: 86400000, floor: 0, strict: true });
  const after = await W.counter(env, name, { op: 'authGet', sid: 's0', strict: true });
  ok(after.ended || after.epoch > first.epoch, 'the first ended sign-in is still refused - ended, or its generation is over', { first, after });
}

console.log = quiet;
if (report('a-sign-in-that-cannot-be-checked-grants-nothing') > 0) process.exitCode = 1;
done();
