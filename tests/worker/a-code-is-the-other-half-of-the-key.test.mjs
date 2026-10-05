/* A CODE IS THE OTHER HALF OF THE KEY.

   Asked for: "make sure no one can log into anyone else's account even though
   they have a verification code... make it like ChatGPT and Claude... make
   sure they can't auto sign in because I didn't put the code but it still
   signed me in".

   AMV signed anybody in on email and password alone, and never checked that
   whoever signed up owned the address. Now, wherever email can reach people:
   sign-up ends in a code sent to the address, and sign-in on a device that has
   not proved itself needs the password AND a code. Every case here tries to
   get a session WITHOUT the right code, and must fail. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'signincode.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const PW = 'A-real-Passw0rd!';
const mail = [];
const realFetch = globalThis.fetch;
/* What the email provider does: 'ok', 'refuse' (the real answer for a domain
   nobody verified), or 'down' (the network). */
let provider = 'ok';
globalThis.fetch = async (url, opts) => {
  const u = String(url && url.url ? url.url : url);
  if (/api\.resend\.com/.test(u)) {
    if (provider === 'refuse') return new Response('{"message":"The amv.homes domain is not verified. Please, add and verify your domain on https://resend.com/domains","name":"validation_error","statusCode":403}', { status: 403 });
    if (provider === 'down') throw new TypeError('fetch failed');
    mail.push(JSON.parse(String(opts.body || '{}'))); return new Response('{"id":"x"}', { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
const codeFor = (to) => { const m = [...mail].reverse().find(x => (x.to || [])[0] === to); return m ? (/\b(\d{6})\b/.exec(m.subject) || [])[1] : ''; };

function mkEnv(extra) {
  const m = new Map(); const vals = new Map();
  return Object.assign({
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'reserve') {
        if (b.cap != null && cur + Number(b.amount) > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
        vals.set(n, cur + Number(b.amount)); return new Response(JSON.stringify({ allowed: true, value: cur + Number(b.amount) }));
      }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }) },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    EMAIL_API_KEY: 'k', RESET_EMAIL_FROM: 'AMV <hello@amv.test>',
  }, extra || {});
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 10;
const call = async (env, path, body, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '55.55.' + (ip % 250) + '.' + (ip++ % 250) };
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST', headers, body: JSON.stringify(body || {}) }), env, ctx);
  let d = {}; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d, cookies: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
};
const cookieFrom = (res, name) => { const c = res.cookies.find(x => x.startsWith(name + '=')); return c ? c.split(';')[0] : ''; };

section('Sign-up proves the address before there is any session');
{
  const env = mkEnv();
  mail.length = 0;
  const s = await call(env, '/auth/signup', { email: 'new@example.com', name: 'New', password: PW });
  ok(s.d.needsCode === true && !s.d.token && !s.d.refreshToken, 'signing up returns a code step, not a session', s.d);
  ok(s.d.to && !s.d.to.includes('new@') && /@example\.com$/.test(s.d.to), 'and names the address masked', s.d.to);
  const code = codeFor('new@example.com');
  ok(/^\d{6}$/.test(code), 'a six-digit code went to that address', code);
  const login = await call(env, '/auth/login', { email: 'new@example.com', password: PW });
  ok(!login.d.token && login.d.needsCode, 'and signing in instead, without the code, gets no session either', login.d);
  const v = await call(env, '/auth/login/verify', { challenge: s.d.challenge, code });
  ok(!!v.d.token, 'the right code finishes it', v.status);
  const acct = await W.DB.get(env, 'acct', 'new@example.com');
  ok(acct && acct.emailVerifiedAt > 0, 'and the address is recorded as verified', acct && acct.emailVerifiedAt);
}

section('The right password is not enough on a new device');
{
  const env = mkEnv();
  const s = await call(env, '/auth/signup', { email: 'own@example.com', name: 'Own', password: PW });
  await call(env, '/auth/login/verify', { challenge: s.d.challenge, code: codeFor('own@example.com') });
  mail.length = 0;
  const l = await call(env, '/auth/login', { email: 'own@example.com', password: PW });
  ok(l.status === 200 && l.d.needsCode && !l.d.token && !l.d.refreshToken, 'correct password, unknown device: a code step and nothing else', l.d);
  ok(!l.cookies.some(c => /^amv_rt|refresh/i.test(c) && !/Max-Age=0/.test(c)), 'and no sign-in cookie set', l.cookies);
  const bad = await call(env, '/auth/login', { email: 'own@example.com', password: 'Wrong-Passw0rd!1' });
  ok(bad.status === 401 && !bad.d.needsCode, 'a wrong password sends no code at all', bad.d);
  ok(mail.length === 1, 'exactly one email: the one the correct password earned', mail.length);
}

section('A code only works for the sign-in it was sent for');
{
  const env = mkEnv();
  for (const who of ['alice@example.com', 'mallory@example.com']) {
    const s = await call(env, '/auth/signup', { email: who, name: who, password: PW });
    await call(env, '/auth/login/verify', { challenge: s.d.challenge, code: codeFor(who) });
  }
  const a = await call(env, '/auth/login', { email: 'alice@example.com', password: PW });
  const m = await call(env, '/auth/login', { email: 'mallory@example.com', password: PW });
  const malloryCode = codeFor('mallory@example.com');
  const swap = await call(env, '/auth/login/verify', { challenge: a.d.challenge, code: malloryCode });
  ok(!swap.d.token, 'Mallory’s own valid code does not open Alice’s sign-in', swap.d);
  const own = await call(env, '/auth/login/verify', { challenge: m.d.challenge, code: malloryCode });
  ok(own.d.token && JSON.parse(Buffer.from(own.d.token.split('.')[1], 'base64url')).email === 'mallory@example.com', 'it only ever opens Mallory’s own', own.status);
  const forged = await call(env, '/auth/login/verify', { challenge: 'f'.repeat(48), code: '123456' });
  ok(!forged.d.token && forged.status === 400, 'a made-up challenge is simply expired', forged.d);
}

section('Guessing is capped, in parallel too, and a code works once');
{
  const env = mkEnv();
  const s = await call(env, '/auth/signup', { email: 'guess@example.com', name: 'G', password: PW });
  const real = codeFor('guess@example.com');
  const wrong = real === '000000' ? '111111' : '000000';
  const burst = await Promise.all(Array.from({ length: 12 }, () => call(env, '/auth/login/verify', { challenge: s.d.challenge, code: wrong })));
  ok(burst.every(x => !x.d.token), 'twelve wrong guesses at once: no session', burst.map(x => x.status));
  const after = await call(env, '/auth/login/verify', { challenge: s.d.challenge, code: real });
  ok(!after.d.token, 'and after them even the real code is refused - the attempts ran out', after.d);

  const s2 = await call(env, '/auth/signup', { email: 'once@example.com', name: 'O', password: PW });
  const c2 = codeFor('once@example.com');
  const first = await call(env, '/auth/login/verify', { challenge: s2.d.challenge, code: c2 });
  const again = await call(env, '/auth/login/verify', { challenge: s2.d.challenge, code: c2 });
  ok(first.d.token && !again.d.token, 'the right code works once, and never twice', { first: !!first.d.token, again: again.d });
}

section('A device that entered a code is trusted - and only for that account');
{
  const env = mkEnv({ ALLOWED_ORIGIN: 'https://amv.test' });   // cookie mode
  const s = await call(env, '/auth/signup', { email: 'dev@example.com', name: 'D', password: PW });
  const v = await call(env, '/auth/login/verify', { challenge: s.d.challenge, code: codeFor('dev@example.com') });
  const dev = cookieFrom(v, 'amv_dev');
  ok(/^amv_dev=/.test(dev) && v.cookies.some(c => c.startsWith('amv_dev=') && /HttpOnly/.test(c) && /Secure/.test(c)), 'it gets an HttpOnly, Secure device cookie', v.cookies);
  const back = await call(env, '/auth/login', { email: 'dev@example.com', password: PW }, { cookie: dev });
  ok(!!back.d.token && !back.d.needsCode, 'so next time the password is enough on this device', back.d.needsCode);
  const wrongPw = await call(env, '/auth/login', { email: 'dev@example.com', password: 'Wrong-Passw0rd!1' }, { cookie: dev });
  ok(!wrongPw.d.token, 'but never without the password', wrongPw.status);
  const s2 = await call(env, '/auth/signup', { email: 'other@example.com', name: 'X', password: PW });
  await call(env, '/auth/login/verify', { challenge: s2.d.challenge, code: codeFor('other@example.com') });
  const other = await call(env, '/auth/login', { email: 'other@example.com', password: PW }, { cookie: dev });
  ok(!other.d.token && other.d.needsCode, 'and the device cookie for one account does not skip the code for another', other.d);
  const forged = await call(env, '/auth/login', { email: 'dev@example.com', password: PW }, { cookie: 'amv_dev=not.a.token' });
  ok(!forged.d.token && forged.d.needsCode, 'a forged device cookie counts for nothing', forged.d);
}

section('Signing out everywhere un-trusts every device');
{
  const env = mkEnv();   // body mode: the device token travels in the body
  const s = await call(env, '/auth/signup', { email: 'out@example.com', name: 'O', password: PW });
  const v = await call(env, '/auth/login/verify', { challenge: s.d.challenge, code: codeFor('out@example.com') });
  ok(!!v.d.deviceToken, 'without cookies, the device token comes back for the page to keep', !!v.d.deviceToken);
  const trusted = await call(env, '/auth/login', { email: 'out@example.com', password: PW, deviceToken: v.d.deviceToken });
  ok(!!trusted.d.token, 'and is honoured', trusted.status);
  await new Promise(r => setTimeout(r, 1100));
  await call(env, '/auth/logout', { everywhere: true }, { token: trusted.d.token });
  const after = await call(env, '/auth/login', { email: 'out@example.com', password: PW, deviceToken: v.d.deviceToken });
  ok(!after.d.token && after.d.needsCode, 'after "sign out everywhere" the same device needs a code again', after.d);
}

section('Signing out ends the session even with no access token');
{
  const env = mkEnv();
  const s = await call(env, '/auth/signup', { email: 'rt@example.com', name: 'R', password: PW });
  const v = await call(env, '/auth/login/verify', { challenge: s.d.challenge, code: codeFor('rt@example.com') });
  const out = await call(env, '/auth/logout', { refreshToken: v.d.refreshToken });
  ok(out.d.ok && out.d.scope === 'device', 'the refresh token alone is enough to sign out', out.d);
  const reuse = await call(env, '/auth/refresh', { refreshToken: v.d.refreshToken });
  ok(!reuse.d.token, 'and that sign-in cannot be renewed afterwards', reuse.d);
}

section('A code sent before the account was deleted signs nobody in');
{
  /* A challenge is keyed by its id, so erasure cannot find it. The code in the
     inbox must not mint a session for an account that is gone - or for the
     next person to register the address. */
  const env = mkEnv();
  const s = await call(env, '/auth/signup', { email: 'gone@example.com', name: 'G', password: PW });
  const code = codeFor('gone@example.com');
  const { keys } = await env.AMV_KV.list({});
  for (const k of keys) if (/^acct:.*gone@example\.com/.test(k.name)) await env.AMV_KV.delete(k.name);
  const v = await call(env, '/auth/login/verify', { challenge: s.d.challenge, code });
  ok(!v.d.token && v.d.code === 'code_expired', 'the account is gone, so the code is refused', v.d);
}

section('A sender the provider refuses outright locks nobody out - and says so');
{
  /* The owner's deployment: RESET_EMAIL_FROM set, the domain never verified
     with the provider. Every code was refused, so every sign-up and every new
     device failed - the owner included, the moment their session ended. */
  const env = mkEnv();
  provider = 'refuse';
  const s = await call(env, '/auth/signup', { email: 'refused@example.com', name: 'R', password: PW });
  ok(!!s.d.token && !s.d.needsCode, 'sign-up finishes without a code that cannot be sent', s.d);
  const l = await call(env, '/auth/login', { email: 'refused@example.com', password: PW });
  ok(!!l.d.token, 'and so does signing in on a new device', l.d);
  const bad = await call(env, '/auth/login', { email: 'refused@example.com', password: 'Wrong-Passw0rd!' });
  ok(!bad.d.token && bad.status >= 400, 'the password is still checked', bad.status);
  const rd = await W.default.fetch(new Request('https://api.amv.test/admin/readiness', { headers: { Authorization: 'Bearer a', 'CF-Connecting-IP': '7.7.7.7' } }), env, ctx);
  const row = ((await rd.json()).items || []).find(i => i.id === 'emailSender') || {};
  ok(row.on === false && /not verified/.test(row.problem || ''), 'the readiness screen says email is refused, in the provider\u2019s words', row);

  /* The moment the domain is verified, the next send goes through and codes
     are required again - nobody has to remember to switch them back on. */
  provider = 'ok';
  await call(env, '/auth/reset', { email: 'refused@example.com' });
  const back = await call(env, '/auth/login', { email: 'refused@example.com', password: PW });
  ok(back.d.needsCode && !back.d.token, 'once mail goes through again, a new device needs the code again', back.d);
}

section('A send that merely failed is "try again", never "come in"');
{
  /* Passing through on ANY failure would hand a code-free sign-in to whoever
     can make one send fail. Only the provider's refusal of the sender counts. */
  const env = mkEnv();
  const s = await call(env, '/auth/signup', { email: 'flaky@example.com', name: 'F', password: PW });
  await call(env, '/auth/login/verify', { challenge: s.d.challenge, code: codeFor('flaky@example.com') });
  provider = 'down';
  const l = await call(env, '/auth/login', { email: 'flaky@example.com', password: PW });
  ok(l.status === 503 && !l.d.token && l.d.code === 'code_not_sent', 'the network failing refuses, and signs nobody in', { status: l.status, d: l.d });
  provider = 'ok';
}

section('Where email cannot reach people, nothing is locked out');
{
  const env = mkEnv({ RESET_EMAIL_FROM: '' });
  const s = await call(env, '/auth/signup', { email: 'plain@example.com', name: 'P', password: PW });
  ok(!!s.d.token && !s.d.needsCode, 'no verified sender: sign-up works without a code that could never arrive', s.d.needsCode);
}

globalThis.fetch = realFetch;
report();
done();
