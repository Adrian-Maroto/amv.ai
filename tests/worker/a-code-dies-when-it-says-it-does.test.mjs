/* A CODE DIES WHEN IT SAYS IT DOES, AND IS TRIED AND USED ONLY AS OFTEN AS IT
   SAYS (Build 16 audit SEC-01, SEC-02, Nov 20).

   Sign-in and password-reset codes lived as long as their KV record - and a
   wrong guess rewrote that record without an expiry, so it never expired.
   Their tries and their one use were counted in the same record, read from a
   store that can answer with an older copy. Run against the real Worker and
   the real counter object, with KV that drops expiry exactly as Cloudflare's
   does and can be made to answer stale:
   - after a wrong guess the record keeps its deadline, and past it the right
     code is refused;
   - a record from before deadlines were written is judged by its age;
   - stale reads do not buy more than five tries, or a second use. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'codedies.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { authLoginVerify, authResetVerify, DB, _codeHash };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('AUDIT')) quiet(...a); };
globalThis.fetch = async () => new Response('{}', { status: 200 });

let now = Date.now(); const realNow = Date.now; Date.now = () => now;
const live = new Map(), ttl = new Map(), objects = new Map(), queues = new Map();
let override = null;
const env = { JWT_SECRET: 'x'.repeat(48), APP_URL: 'https://amv.test',
  AMV_KV: {
    async get(k) { if (override) { const v = override(k); if (v !== undefined) return v; } if (ttl.has(k) && ttl.get(k) <= now) { live.delete(k); ttl.delete(k); } return live.has(k) ? live.get(k) : null; },
    /* Like Cloudflare's: a write replaces the expiry - none given, none kept. */
    async put(k, v, o) { live.set(k, String(v)); if (o && o.expirationTtl) ttl.set(k, now + o.expirationTtl * 1000); else if (o && o.expiration) ttl.set(k, o.expiration * 1000); else ttl.delete(k); },
    async delete(k) { live.delete(k); ttl.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...live.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: { idFromName: n => n, get: n => ({ fetch: async (u, init) => {
    const run = async () => {
      if (!objects.has(n)) { const st = new Map(); objects.set(n, new W.AMVCounter({ storage: { async get(k) { return structuredClone(st.get(k)); }, async put(k, v) { st.set(k, structuredClone(v)); },
        async delete(k) { st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {})); }
      return objects.get(n).fetch(new Request('https://counter.invalid', init));
    };
    const prev = queues.get(n) || Promise.resolve(); const p = prev.then(run, run); queues.set(n, p.catch(() => {})); return p;
  } }) } };
const EM = 'kim@example.com';
await W.DB.put(env, 'acct', EM, { email: EM, name: 'Kim', createdAt: now - 86400000 });
const login = (challenge, code) => W.authLoginVerify(new Request('https://x/auth/login/verify', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.' + Math.floor(Math.random() * 250) }, body: JSON.stringify({ challenge, code }) }), env)
  .then(async r => ({ status: r.status, d: await r.json() }));
const reset = (code) => W.authResetVerify(new Request('https://x/auth/reset/verify', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.1.' + Math.floor(Math.random() * 250) }, body: JSON.stringify({ email: EM, code }) }), env)
  .then(async r => ({ status: r.status, d: await r.json() }));
const issue = async (extra = {}) => {
  const id = createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 48);
  const rec = Object.assign({ email: EM, name: 'Kim', why: 'signin', hash: await W._codeHash(id, '123456'), attempts: 0, resends: 0, at: now, exp: now + 600000 }, extra);
  await env.AMV_KV.put('signincode:' + id, JSON.stringify(rec), { expirationTtl: 600 });
  return id;
};

section('A wrong guess does not make a code live for ever');
{
  const id = await issue();
  const w = await login(id, '000000');
  ok(w.d.code === 'code_wrong', 'a wrong code is wrong', w.d);
  ok(ttl.has('signincode:' + id) && ttl.get('signincode:' + id) <= now + 600000 + 1000, 'and the record it rewrote still expires by its deadline', ttl.get('signincode:' + id) - now);
  now += 11 * 60000;
  ttl.delete('signincode:' + id);        // even if the store kept it
  const r = await login(id, '123456');
  ok(r.d.code === 'code_expired', 'past the deadline the right code is refused', r.d);
}

section('A record from before deadlines were written is judged by its age');
{
  const id = await issue({ exp: undefined, at: now - 11 * 60000 });
  ttl.delete('signincode:' + id);
  const r = await login(id, '123456');
  ok(r.d.code === 'code_expired', 'older than a code lives: refused', r.d);
}

section('Stale reads buy no extra tries and no second use');
{
  const id = await issue();
  const fresh = live.get('signincode:' + id);
  override = (k) => k === 'signincode:' + id ? fresh : undefined;       // every read answers the first copy
  const tries = [];
  for (let i = 0; i < 8; i++) tries.push(await login(id, '00000' + i));
  const wrong = tries.filter(t => t.d.code === 'code_wrong').length;
  ok(wrong <= 5 && tries.slice(5).every(t => t.d.code === 'code_exhausted'), 'five tries, then none - whatever the copy says', tries.map(t => t.d.code));
  const right = await login(id, '123456');
  ok(right.status !== 200, 'and the right code after that is refused too', right.d);

  const id2 = await issue();
  const fresh2 = live.get('signincode:' + id2);
  override = (k) => k === 'signincode:' + id2 ? fresh2 : undefined;
  const a = await login(id2, '123456');
  const b = await login(id2, '123456');
  ok(a.status === 200 && b.status !== 200, 'the right code is used once, even when the copy still says unused', [a.status, b.status, b.d.code]);
  override = null;
}

section('The same for a password reset code');
{
  await env.AMV_KV.put('resetcode:' + EM, JSON.stringify({ code: '654321', attempts: 0, at: now, exp: now + 900000, n: 'n1' }), { expirationTtl: 900 });
  const w = await reset('111111');
  ok(w.status === 400 && ttl.has('resetcode:' + EM), 'a wrong guess keeps the deadline', w.d);
  now += 16 * 60000; ttl.delete('resetcode:' + EM);
  ok((await reset('654321')).status === 400, 'past it, the right code is refused', true);

  await env.AMV_KV.put('resetcode:' + EM, JSON.stringify({ code: '654321', attempts: 0, at: now, exp: now + 900000, n: 'n2' }), { expirationTtl: 900 });
  const fresh = live.get('resetcode:' + EM);
  override = (k) => k === 'resetcode:' + EM ? fresh : undefined;
  const tries = [];
  for (let i = 0; i < 7; i++) tries.push(await reset('11111' + i));
  ok(tries.slice(5).every(t => t.status === 429), 'five tries per code, whatever the copy says', tries.map(t => t.status));
  await env.AMV_KV.put('resetcode:' + EM, JSON.stringify({ code: '654321', attempts: 0, at: now, exp: now + 900000, n: 'n3' }), { expirationTtl: 900 });
  const fresh3 = live.get('resetcode:' + EM);
  override = (k) => k === 'resetcode:' + EM ? fresh3 : undefined;
  const a = await reset('654321'), b = await reset('654321');
  ok(a.status === 200 && a.d.token && b.status !== 200, 'a fresh code works, once', [a.status, b.status]);
  override = null;
}

Date.now = realNow; console.log = quiet;
if (report('a-code-dies-when-it-says-it-does') > 0) process.exitCode = 1;
done();
