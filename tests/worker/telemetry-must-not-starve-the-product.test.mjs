/* TWO PUBLIC ENDPOINTS COULD SPEND THE WHOLE ACCOUNT'S DAY OF STORAGE.

   Cloudflare's free KV tier allows 1000 writes a DAY for the entire account.
   /errors and /waitlist are unauthenticated, write once per request, and were
   rate-limited per IP and nothing else: 500 a day and 50 a day. Two IPs at the
   telemetry allowance is 1000 writes - the whole budget, spent on error
   reports, by anyone who felt like it.

   When it is gone every write fails: sign-up, session, save, the KV bookkeeping
   behind a payment. For everybody, until the quota rolls over, and nothing in
   the product would know that was the reason.

   Neither per-IP limit is wrong on its own. What was missing is that no
   allowance may be larger than a fraction of what the account HAS. Telemetry
   and a waitlist are the least important writes AMV makes, so they share a
   small daily ceiling and are refused FIRST - which is the order a product
   should shed load in.

   What this checks is the property, not the number: that the two of them
   together cannot write more than the ceiling however many IPs they come from,
   that they say so honestly rather than pretending, and that an ordinary
   account action still works once they have been cut off - which is the whole
   point of cutting them off. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'noness.harness.mjs');
writeFileSync(harness, src + '\nexport { errorsReport, waitlistAdd, authSignup, _nonEssentialWrite, NONESSENTIAL_DAILY_WRITES };\n');
const W = await import(harness + '?t=' + Date.now());

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const CAP = 12;   // small, so the test is fast and the property is the same

function makeEnv() {
  const kv = new Map();
  let writes = 0;
  return {
    _kv: kv, get _writes() { return writes; },
    JWT_SECRET: 'test-secret-abcdefghijklmnopqrstuv',
    NONESSENTIAL_WRITE_CAP: String(CAP),
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { writes++; kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()]
        .filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }),
    },
  };
}
const post = (path, body, ip) => new Request('https://w' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '1.1.1.1' },
  body: JSON.stringify(body || {}),
});
const report1 = (env, ip, n) => W.errorsReport(
  post('/errors', { events: [{ kind: 'error', msg: 'boom ' + n, where: 'x' }] }, ip), env, { waitUntil() {} });
const waitlist = (env, ip, n) => W.waitlistAdd(
  post('/waitlist', { email: 'p' + n + '@x.com', product: 'general' }, ip), env);

section('The ceiling holds however many addresses it is spread across');
{
  const env = makeEnv();
  let accepted = 0, refused = 0;
  /* Forty requests from forty different IPs, so every per-IP limit is untouched
     and only the shared ceiling can stop it. */
  for (let i = 0; i < 40; i++) {
    const d = await (await report1(env, '10.0.0.' + i, i)).json();
    if (d.reason === 'storage_budget') refused++; else accepted++;
  }
  ok(refused > 0, 'a fresh IP does not buy another allowance', refused);
  ok(accepted <= CAP, 'and the total accepted never passes the ceiling',
     accepted + ' accepted, cap ' + CAP);
}

section('The two of them share it, rather than having one each');
{
  const env = makeEnv();
  for (let i = 0; i < CAP; i++) await report1(env, '10.1.0.' + i, i);
  const w = await (await waitlist(env, '10.2.0.1', 1)).json();
  ok(w.code === 'needs_service',
     'telemetry using up the budget stops the waitlist too', JSON.stringify(w).slice(0, 90));
  ok(/could not add you/i.test(String(w.error || '')),
     'and it says so instead of pretending it was recorded', String(w.error || '').slice(0, 70));
}

section('And the writes that matter still work once those are cut off');
{
  /* The entire reason for refusing them. If sign-up broke too, the ceiling
     would be pointless. */
  const env = makeEnv();
  for (let i = 0; i < CAP + 5; i++) await report1(env, '10.3.0.' + i, i);
  const r = await W.authSignup(post('/auth/signup',
    { email: 'real@x.com', name: 'T', password: 'correct-horse-9' }), env);
  const d = await r.json();
  ok(!!d.token, 'somebody can still create an account', d.error || 'signed up');
  ok(!!env._kv.get('acct:real@x.com') || [...env._kv.keys()].some(k => k.includes('real@x.com')),
     'and the record really was written', true);
}

section('Refusing telemetry is quiet; refusing a person is not');
{
  const env = makeEnv();
  for (let i = 0; i < CAP; i++) await report1(env, '10.4.0.' + i, i);
  const e = await (await report1(env, '10.4.9.9', 99)).json();
  ok(e.ok === true && e.accepted === 0,
     'a dropped error report is not an error the browser has to handle',
     JSON.stringify(e));
  ok(e.throttled === true, 'but it is honest that nothing was stored', e.throttled);
}

section('The ceiling is a fraction of what the account has, not most of it');
{
  /* The number itself. Free-tier KV is 1000 writes a day; a default anywhere
     near that would be the bug this file exists for, wearing a constant. */
  const m = /const NONESSENTIAL_DAILY_WRITES = (\d+)/.exec(src);
  ok(!!m, 'the default is a named constant', m && m[1]);
  const n = m ? +m[1] : 0;
  ok(n > 0 && n <= 300,
     'and it is a small share of a 1000-write day, not most of it', n);
  ok(/NONESSENTIAL_WRITE_CAP/.test(src),
     'with an env override, so a paid plan can raise it without a deploy', true);
}

if (report('telemetry-must-not-starve-the-product') > 0) process.exitCode = 1;
done();
