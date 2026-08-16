/* ACCOUNT ACTIVITY - the account's own security record.

   Two things are being fixed here. The Security screen showed a hardcoded
   "This browser - Active now" row wired to nothing, so a compromised account
   looked exactly like a healthy one. And "Sign out of this device" revoked
   every token on the account, so signing out of a laptop silently ended a
   session on a phone.

   The log is shown back to the user, which makes what it does NOT contain as
   important as what it does: no IP addresses, no full user-agent strings, no
   unbounded growth. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'activity.harness.mjs');
writeFileSync(harness, src + `
export { authSignup, authLogin, authLogout, authRefresh, authDeleteAccount, accountActivity,
         setEntitlement, requireUser, _userEvent, _deviceLabel, DB,
         ACTIVITY_MAX_EVENTS, issueTokens };
`);
const W = await import(harness + '?t=' + Date.now());

function makeEnv() {
  const kv = new Map();
  return {
    _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnopqrstuv',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }),
    },
  };
}
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function post(path, body, { ip, ua, country } = {}) {
  const r = new Request('https://w' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...(ua ? { 'User-Agent': ua } : {}) },
    body: JSON.stringify(body || {}),
  });
  if (country) Object.defineProperty(r, 'cf', { value: { country }, configurable: true });
  return r;
}
const authed = (path, token, method, body) => new Request('https://w' + path, {
  method: method || 'GET',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const PW = 'correct-horse-9';
async function signup(env, email, opts) {
  const d = await (await W.authSignup(post('/auth/signup', { email, name: 'T', password: PW }, opts || {}), env)).json();
  if (!d.token) throw new Error('signup failed: ' + JSON.stringify(d));
  return d;
}
const login = (env, email, password, opts) =>
  W.authLogin(post('/auth/login', { email, password, provider: 'email' }, opts || {}), env);
const activity = async (env, token) => (await (await W.accountActivity(authed('/v1/activity', token), env)).json());

section('The log records the events that matter, in order');
{
  const env = makeEnv();
  const a = await signup(env, 'u@x.com', { ua: CHROME_MAC, country: 'GB' });
  await login(env, 'u@x.com', PW, { ua: CHROME_MAC, country: 'GB' });
  await login(env, 'u@x.com', 'wrong-password', { ua: CHROME_MAC, country: 'DE' });
  await W.setEntitlement(env, 'u@x.com', 'pro');

  const d = await activity(env, a.token);
  const kinds = d.events.map(e => e.kind);
  ok(kinds.includes('account_created'), 'account creation is recorded', kinds);
  ok(kinds.includes('signed_in'), 'so is a successful sign-in');
  ok(kinds.includes('sign_in_failed'), 'and a FAILED one - the entry that reveals a password being guessed');
  ok(kinds.includes('plan_changed'), 'and a plan change, which is how a compromised account shows itself');
  ok(d.events[0].at >= d.events[d.events.length - 1].at, 'newest first, which is the order it will be read in');
}

section('What is recorded is coarse ON PURPOSE');
{
  const env = makeEnv();
  const a = await signup(env, 'p@x.com', { ua: CHROME_MAC, ip: '203.0.113.9', country: 'FR' });
  const d = await activity(env, a.token);
  const ev = d.events[0];
  const raw = JSON.stringify(d);

  ok(ev.dev === 'Chrome on Mac', 'the browser family is shown, which is what a person recognises', ev.dev);
  ok(!raw.includes('AppleWebKit') && !raw.includes('537.36'),
     'the full user-agent is NOT stored - that is a fingerprint, not a security signal');
  ok(!raw.includes('203.0.113.9'), 'the IP address appears nowhere');
  ok(!/\d+\.\d+\.\d+\.\d+/.test(raw), 'nor any address in any other form', raw.slice(0, 80));
  ok(ev.country === 'FR', 'the country is kept, because "signed in from another country" is the whole point', ev.country);
}

section('An event with no device says so instead of inventing one');
{
  const env = makeEnv();
  const a = await signup(env, 'w@x.com', { ua: CHROME_MAC });
  await W.setEntitlement(env, 'w@x.com', 'pro');   // from a payment webhook: no browser, no country
  const d = await activity(env, a.token);
  const plan = d.events.find(e => e.kind === 'plan_changed');
  ok(!!plan, 'the webhook event is still recorded');
  ok(plan.dev === undefined && plan.country === undefined,
     'with no device or country, because there genuinely was not one');
}

section('A guessing run cannot flood the log');
{
  const env = makeEnv();
  const a = await signup(env, 'guess@x.com', { ua: CHROME_MAC });
  // Each attempt from a different address, which is exactly how the per-IP
  // throttle is defeated - so the log needs its own bound.
  for (let i = 0; i < 12; i++) await login(env, 'guess@x.com', 'nope-' + i, { ua: CHROME_MAC, ip: '10.0.0.' + i });
  const d = await activity(env, a.token);
  const fails = d.events.filter(e => e.kind === 'sign_in_failed').length;
  ok(fails === 1, 'twelve guesses become one entry, not twelve writes', fails);
  ok(fails > 0, 'but the attack is still visible, which is the point of the entry');
}

section('The log cannot grow without limit');
{
  const env = makeEnv();
  const a = await signup(env, 'many@x.com', { ua: CHROME_MAC });
  for (let i = 0; i < W.ACTIVITY_MAX_EVENTS + 25; i++) {
    await W._userEvent(env, post('/x', {}, { ua: CHROME_MAC }), 'many@x.com', 'signed_in');
  }
  const d = await activity(env, a.token);
  ok(d.events.length === W.ACTIVITY_MAX_EVENTS, 'it is capped at the stated maximum', d.events.length);
  ok(d.kept === W.ACTIVITY_MAX_EVENTS, 'and the cap is told to the user rather than being a silent truncation');
}

section('One account cannot read the history of another');
{
  const env = makeEnv();
  await signup(env, 'victim@x.com', { ua: CHROME_MAC });
  const b = await signup(env, 'nosey@x.com', { ua: CHROME_MAC });
  const d = await activity(env, b.token);
  ok(!JSON.stringify(d).includes('victim@x.com'), 'the other account appears nowhere');
  const anon = await W.accountActivity(new Request('https://w/v1/activity'), env);
  ok(anon.status === 401, 'and an unauthenticated caller gets nothing', anon.status);
}

section('Signing out of THIS device leaves the others signed in');
{
  const env = makeEnv();
  const laptop = await signup(env, 'two@x.com', { ua: CHROME_MAC });
  const phone = await (await login(env, 'two@x.com', PW, { ua: CHROME_MAC })).json();

  const r = await (await W.authLogout(authed('/auth/logout', laptop.token, 'POST',
    { refreshToken: laptop.refreshToken }), env)).json();
  ok(r.scope === 'device', 'the sign-out is scoped to the device', r.scope);

  const stillIn = await W.requireUser(authed('/v1/x', phone.token), env);
  ok(!!stillIn, 'the phone is STILL signed in - this is the bug that used to end that session too');

  // The laptop's refresh token is spent, so it can never be exchanged again.
  const again = await W.authRefresh(post('/auth/refresh', { refreshToken: laptop.refreshToken }), env);
  ok(again.status === 401, 'while the laptop cannot refresh its way back in', again.status);
}

section('Signing out EVERYWHERE really means everywhere');
{
  const env = makeEnv();
  const laptop = await signup(env, 'all@x.com', { ua: CHROME_MAC });
  const phone = await (await login(env, 'all@x.com', PW, { ua: CHROME_MAC })).json();

  const r = await (await W.authLogout(authed('/auth/logout', laptop.token, 'POST', { everywhere: true }), env)).json();
  ok(r.scope === 'all', 'the scope is reported back');
  ok(!(await W.requireUser(authed('/v1/x', phone.token), env)), 'the phone is signed out');
  ok(!(await W.requireUser(authed('/v1/x', laptop.token), env)), 'and so is the device that asked');

  const fresh = await (await login(env, 'all@x.com', PW, { ua: CHROME_MAC })).json();
  const d = await activity(env, fresh.token);
  ok(d.events.some(e => e.kind === 'signed_out_everywhere'),
     'and the account can see that it happened, which matters if it was not them');
}

section('Deleting the account deletes the record of it too');
{
  const env = makeEnv();
  const a = await signup(env, 'gone@x.com', { ua: CHROME_MAC });
  ok(!!(await env.AMV_KV.get('alog:gone@x.com')), 'the log exists while the account does');
  /* AMV-015: erasure asks for the password, so a leaked session cannot do it. */
  await W.authDeleteAccount(new Request('https://x/auth/delete', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + a.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PW }),
  }), env);
  ok(!(await env.AMV_KV.get('alog:gone@x.com')), 'and is gone with it - erasure means the activity log too');
  ok(!(await env.AMV_KV.get('refmine:gone@x.com')), 'along with the referral code claim');
  /* `tokepoch` is deliberately kept: it is a bare integer with no personal data
     in the value, and dropping it would resurrect any token still in circulation
     that was issued before the deletion. Everything else must be gone. */
  const leftovers = [...env._kv.keys()].filter(k => k.includes('gone@x.com') && !k.startsWith('tokepoch:'));
  ok(leftovers.length === 0, 'no key holding data about the deleted account survives', leftovers);
}

section('Logging can never break the thing it is logging');
{
  const env = makeEnv();
  env.AMV_KV.put = async () => { throw new Error('KV is down'); };
  let threw = false;
  try { await W._userEvent(env, post('/x', {}, { ua: CHROME_MAC }), 'x@x.com', 'signed_in'); }
  catch (e) { threw = true; }
  ok(!threw, 'a failing store does not throw, so a sign-in still succeeds');
}

section('A sign-out it cannot scope revokes everything, not nothing');
{
  /* A cached older build posts to /auth/logout with no body at all. Given
     nothing that says WHICH session, the only reading of "sign me out" that can
     actually be honoured is all of them - the alternative is a request that
     promised to end a session and ended none. */
  const env = makeEnv();
  const laptop = await signup(env, 'old@x.com', { ua: CHROME_MAC });
  const phone = await (await login(env, 'old@x.com', PW, { ua: CHROME_MAC })).json();

  const r = await (await W.authLogout(authed('/auth/logout', laptop.token, 'POST'), env)).json();
  ok(r.scope === 'all', 'an unscoped sign-out is reported as everywhere', r.scope);
  ok(!(await W.requireUser(authed('/v1/x', phone.token), env)), 'and every token really is dead');

  // A refresh token belonging to somebody else is not a scope either.
  const env2 = makeEnv();
  const me = await signup(env2, 'me@x.com', { ua: CHROME_MAC });
  const them = await signup(env2, 'them@x.com', { ua: CHROME_MAC });
  const r2 = await (await W.authLogout(authed('/auth/logout', me.token, 'POST',
    { refreshToken: them.refreshToken }), env2)).json();
  ok(r2.scope === 'all', 'someone else\u2019s token cannot be used to make a sign-out a no-op', r2.scope);
  ok(!!(await W.requireUser(authed('/v1/x', them.token), env2)),
     'and it does not sign THEM out either - only the caller loses their sessions');
}

report('account-activity');
done();
