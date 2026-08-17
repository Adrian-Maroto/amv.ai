/* THE SIGN-IN SCREEN ANSWERED A QUESTION NOBODY SHOULD BE ABLE TO ASK.

   "no such account" with a 404, or "wrong password" with a 401. Two answers,
   and the difference between them is the entire thing an attacker came for.
   Point a list of a million addresses at the endpoint and it sorts them into
   customers and strangers for free, with no password guessed - which for
   anybody whose membership here is private is a breach on its own, and for
   everybody else is the shortlist that makes credential stuffing worth doing.

   The reset screen was careful about this and then gave it away one field
   along. It always answered `ok:true` and never said whether the account
   existed, and it reported `sent`, which was true only when the address was
   registered. With email configured, `sent:false` meant "no account here".

   Underneath both, the clock says it too. A missing account returned in a
   millisecond because nothing was hashed; a real one took as long as six
   hundred thousand rounds of PBKDF2 take. A status code that no longer answers
   the question is not much use if a stopwatch still does.

   And the same function that makes the timing expensive makes it a weapon.
   PBKDF2 costs per byte as well as per round, and login bounded the length of
   what it hashed at nothing at all - so one request carrying a ten megabyte
   "password" bought seconds of the operator's CPU for the price of sending it.

   AND THE OTHER DOOR (AMV-027). Google sign-in refused a token that said
   `email_verified: false` and accepted one that did not mention the claim.
   That claim is the only thing between "Google says this person owns this
   address" and "somebody typed this address into a Google account" - and an
   address that already exists here as a password account is signed straight
   into, with no password. It is also an open endpoint that makes AMV call
   Google once per request, from AMV's own address, with nothing bounding it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'enumeration.harness.mjs');
writeFileSync(harness, src +
  '\nexport { authLogin, authSignup, authGoogle, authResetCode, _passwordTooLong,' +
  ' _passwordLengthProblem, PASSWORD_MAX, PASSWORD_MIN, DB };\n');
const W = await import(harness + '?t=' + Date.now());

const AUD = 'amv-client-id.apps.googleusercontent.com';
const PW = 'A-real-Passw0rd!';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => [b64({ alg: 'RS256' }), b64(Object.assign({
  aud: AUD, iss: 'accounts.google.com', name: 'G User',
  exp: Math.floor(Date.now() / 1000) + 3600,
}, claims)), 'sig'].join('.');

const realFetch = globalThis.fetch;
let googleCalls = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  const m = /tokeninfo\?id_token=([^&]+)/.exec(u);
  if (m) {
    googleCalls++;
    const parts = decodeURIComponent(m[1]).split('.');
    let payload = {};
    try { payload = JSON.parse(Buffer.from(parts[1] || '', 'base64url').toString()); } catch (e) {}
    return { ok: true, status: 200, json: async () => payload };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test', GOOGLE_CLIENT_ID: AUD,
    _vals: vals,
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, String(v)); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'rateCheck') { const nx = cur + 1; vals.set(n, nx); return new Response(JSON.stringify({ allowed: nx <= (b.limit || 9999), count: nx })); }
        if (b.op === 'reserve') { const nx = cur + (b.amount || 0); if (nx > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur })); vals.set(n, nx); return new Response(JSON.stringify({ allowed: true, value: nx })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const post = (path, body, ip = '1.2.3.4') => new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
  body: JSON.stringify(body),
});
const read = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

section('A real customer still signs in, which everything below is in service of');
{
  const env = mkEnv();
  await read(await W.authSignup(post('/auth/signup', { email: 'real@example.com', name: 'R', password: PW }), env));
  const good = await read(await W.authLogin(post('/auth/login', { email: 'real@example.com', password: PW }), env));
  ok(good.status === 200 && !!good.body.token, 'the right password issues a token', good.status);
}

section('THE FINDING: a stranger and a wrong password get the same answer');
{
  const env = mkEnv();
  await read(await W.authSignup(post('/auth/signup', { email: 'known@example.com', name: 'K', password: PW }), env));

  const wrong = await read(await W.authLogin(post('/auth/login', { email: 'known@example.com', password: 'Not-the-Passw0rd!' }), env));
  const absent = await read(await W.authLogin(post('/auth/login', { email: 'nobody@example.com', password: 'Not-the-Passw0rd!' }), env));

  ok(wrong.status === absent.status, 'the same status', { wrong: wrong.status, absent: absent.status });
  ok(wrong.status === 401, 'and it is an unauthorised, not a not-found', wrong.status);
  ok(wrong.body.error === absent.body.error, 'the same sentence', { wrong: wrong.body.error, absent: absent.body.error });
  ok(wrong.body.code === absent.body.code, 'and the same code', { wrong: wrong.body.code, absent: absent.body.code });
  ok(!/no such account|not found|no account/i.test(JSON.stringify(absent.body)),
     'nothing in it says the account is missing', absent.body);
  ok(!wrong.body.token && !absent.body.token, 'and neither hands out a token', { w: !!wrong.body.token, a: !!absent.body.token });
}

section('A federated account is not identifiable by its refusal either');
{
  /* Somebody who signed up with Google has no password to check. Answering
     that differently tells an attacker to stop guessing and go phish a Google
     account instead, which is a favour nobody should be doing them. */
  const env = mkEnv();
  await W.DB.put(env, 'acct', 'goog@example.com', { email: 'goog@example.com', name: 'G', provider: 'google', createdAt: Date.now() });
  await read(await W.authSignup(post('/auth/signup', { email: 'pw@example.com', name: 'P', password: PW }), env));

  const federated = await read(await W.authLogin(post('/auth/login', { email: 'goog@example.com', password: 'Not-the-Passw0rd!' }), env));
  const password = await read(await W.authLogin(post('/auth/login', { email: 'pw@example.com', password: 'Not-the-Passw0rd!' }), env));
  const stranger = await read(await W.authLogin(post('/auth/login', { email: 'who@example.com', password: 'Not-the-Passw0rd!' }), env));

  const shape = (x) => x.status + '|' + x.body.error + '|' + x.body.code;
  ok(shape(federated) === shape(password), 'a Google account answers like a password account', { federated: shape(federated), password: shape(password) });
  ok(shape(federated) === shape(stranger), 'and like an address nobody has ever used', { federated: shape(federated), stranger: shape(stranger) });
  ok(!/google|provider|federat/i.test(JSON.stringify(federated.body)), 'and never names the provider', federated.body);
}

section('And the clock does not answer it either');
{
  /* The same disclosure with a stopwatch instead of a status code. The absent
     branch used to skip the hashing entirely, so it returned in about a
     millisecond while a real account took as long as PBKDF2 does.

     Asserted as a RATIO against the real path rather than as an absolute time,
     because the absolute number is whatever this machine happens to be, and a
     threshold in milliseconds is a test that goes red on a busy afternoon. */
  const env = mkEnv();
  await read(await W.authSignup(post('/auth/signup', { email: 'timed@example.com', name: 'T', password: PW }), env));

  const time = async (email) => {
    const t = Date.now();
    await W.authLogin(post('/auth/login', { email, password: 'Not-the-Passw0rd!' }, '9.9.9.' + Math.floor(Math.random() * 200)), env);
    return Date.now() - t;
  };
  const real = Math.min(await time('timed@example.com'), await time('timed@example.com'));
  const absent = Math.min(await time('ghost@example.com'), await time('ghost@example.com'));

  ok(real > 5, 'a real account really does spend time hashing', real);
  ok(absent > real * 0.4,
     'and a missing one spends comparable time, so the wait does not sort them',
     { real, absent, ratio: +(absent / real).toFixed(2) });
}

section('A password is a secret, not a workload');
{
  /* PBKDF2 costs per byte as well as per round, on an endpoint that has to be
     open to the world. Login bounded this at nothing. */
  const env = mkEnv();
  await read(await W.authSignup(post('/auth/signup', { email: 'victim@example.com', name: 'V', password: PW }), env));

  const huge = 'x'.repeat(5 * 1024 * 1024);
  const t = Date.now();
  const r = await read(await W.authLogin(post('/auth/login', { email: 'victim@example.com', password: huge }), env));
  const took = Date.now() - t;
  ok(r.status === 400, 'an enormous password is refused', r.status);
  ok(r.body.code === 'password_too_long', 'for being enormous', r.body.code);
  ok(took < 300, 'without hashing it first', took);

  ok(W._passwordTooLong('y'.repeat(W.PASSWORD_MAX)) === null,
     'exactly at the ceiling is still a password', W.PASSWORD_MAX);
  ok(W._passwordTooLong('y'.repeat(W.PASSWORD_MAX + 1)) !== null, 'one past it is not');

  /* The MINIMUM must not apply here. An account whose password predates the
     rule would otherwise be locked out by a rule change - the people least able
     to work out why. */
  ok(W._passwordTooLong('abc') === null, 'a short password is not refused for being short at sign-in');
  ok(W._passwordLengthProblem('abc') !== null, 'while setting one that short still is');
  ok(W._passwordLengthProblem('y'.repeat(W.PASSWORD_MAX + 1)) !== null, 'and so is setting one too long');
}

section('The reset screen no longer says it in the other field');
{
  const env = { ...mkEnv(), EMAIL_API_KEY: 'configured' };
  await read(await W.authSignup(post('/auth/signup', { email: 'member@example.com', name: 'M', password: PW }), env));

  const known = await read(await W.authResetCode(post('/auth/reset/code', { email: 'member@example.com' }), env));
  const unknown = await read(await W.authResetCode(post('/auth/reset/code', { email: 'stranger@example.com' }), env));

  ok(JSON.stringify(known.body) === JSON.stringify(unknown.body),
     'the whole answer is identical for a member and a stranger',
     { known: known.body, unknown: unknown.body });
  ok(known.status === unknown.status && known.status === 200, 'including the status', known.status);
  ok(known.body.sent === true, 'and it says a code is on its way, which is what the screen needs', known.body);

  /* The code is still only really written for an account that exists - the
     uniform answer is about what is SAID, not about doing the work anyway. */
  ok(!!env.AMV_KV._map.get('resetcode:member@example.com'), 'a real address gets a real code', true);
  ok(!env.AMV_KV._map.get('resetcode:stranger@example.com'), 'and a stranger gets nothing stored', true);
}

section('With no email configured it says so, because that is about the server');
{
  const env = mkEnv();
  await read(await W.authSignup(post('/auth/signup', { email: 'member@example.com', name: 'M', password: PW }), env));
  const known = await read(await W.authResetCode(post('/auth/reset/code', { email: 'member@example.com' }), env));
  const unknown = await read(await W.authResetCode(post('/auth/reset/code', { email: 'stranger@example.com' }), env));

  ok(known.body.emailConfigured === false, 'the app is told email is not set up', known.body);
  ok(known.body.sent === false, 'so nothing claims to have been sent', known.body);
  ok(JSON.stringify(known.body) === JSON.stringify(unknown.body),
     'and it is still the same answer for both', { known: known.body, unknown: unknown.body });
}

section('Google has to have CONFIRMED the address, not merely not denied it');
{
  const env = mkEnv();
  const g = (claims) => W.authGoogle(post('/auth/google', { credential: idToken(claims) }), env);

  const yes = await read(await g({ email: 'verified@example.com', email_verified: true }));
  ok(yes.status === 200 && !!yes.body.token, 'a confirmed address signs in', yes.status);

  const no = await read(await g({ email: 'liar@example.com', email_verified: false }));
  ok(no.status === 401, 'an explicitly unconfirmed one does not', no.status);

  /* THE FINDING. A token that does not mention the claim at all used to be
     read as confirmed. */
  const silent = await read(await g({ email: 'silent@example.com' }));
  ok(silent.status === 401, 'and neither does one that never says', silent.status);
  ok(silent.body.code === 'google_unverified', 'named as what it is', silent.body.code);
  ok(!silent.body.token, 'with no token', silent.body.token);
  ok(!env.AMV_KV._map.get('acct:silent@example.com'), 'and no account created for it', true);

  /* The takeover this actually buys: the address already belongs to somebody
     here, with a password. */
  await read(await W.authSignup(post('/auth/signup', { email: 'target@example.com', name: 'T', password: PW }), env));
  const steal = await read(await g({ email: 'target@example.com' }));
  ok(steal.status === 401, 'an unconfirmed claim on somebody else’s address is refused', steal.status);
  ok(!steal.body.token, 'so it cannot sign in as them', steal.body.token);

  const stringy = await read(await g({ email: 'stringy@example.com', email_verified: 'true' }));
  ok(stringy.status === 200, 'while the string "true" Google really sends is still accepted', stringy.status);
}

section('And the sign-in endpoint is not a free way to make AMV call Google');
{
  const env = mkEnv();
  googleCalls = 0;
  const flood = [];
  for (let i = 0; i < 40; i++) flood.push(W.authGoogle(post('/auth/google', { credential: idToken({ email: 'x' + i + '@example.com', email_verified: true }) }, '7.7.7.7'), env));
  const rs = await Promise.all(flood.map(async (p) => read(await p)));

  const refused = rs.filter(r => r.status === 429).length;
  ok(refused > 0, 'a burst from one source is cut off', refused);
  ok(googleCalls <= 25, 'so Google is called a bounded number of times, not forty', googleCalls);
  ok(rs.some(r => r.status === 200), 'while the first ones through still work', rs.filter(r => r.status === 200).length);

  /* A credential nobody could have minted is refused before it is put on a URL
     and sent anywhere. */
  googleCalls = 0;
  const oversize = await read(await W.authGoogle(post('/auth/google', { credential: 'a'.repeat(200000) }, '8.8.8.8'), env));
  ok(oversize.status === 401, 'an absurd credential is refused', oversize.status);
  ok(googleCalls === 0, 'without asking Google about it', googleCalls);
}

section('A counter outage does not become a sign-in outage');
{
  /* The ceiling above is about amplification, and nothing irreversible happens
     on the other side of it - unlike the money ceilings, where refusing is the
     right way to be wrong. Turning one storage blip into "nobody can sign in
     with Google" would be a worse failure than the one being prevented. */
  const env = mkEnv();
  const broken = Object.assign({}, env, {
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { throw new Error('counter down'); } }) },
  });
  const r = await read(await W.authGoogle(post('/auth/google', { credential: idToken({ email: 'blip@example.com', email_verified: true }) }, '6.6.6.6'), broken));
  ok(r.status === 200, 'somebody still gets in', r.status);
  ok(!!r.body.token, 'with a real token', !!r.body.token);
}

section('And the cost of that equal treatment is bounded');
{
  /* The trade this fix makes, closed rather than left. Answering a missing
     account with the same work as a real one is what stops the clock leaking
     which is which - and it means any string somebody sends now buys a PBKDF2
     at six hundred thousand iterations. The only throttle here counted
     FAILURES per email+ip, so rotating the address walked past it.

     The ceiling is on attempts from one SOURCE. A person signing in is nowhere
     near it; an amplifier runs into it immediately. */
  const env = mkEnv();
  await read(await W.authSignup(post('/auth/signup', { email: 'real@example.com', name: 'R', password: PW }), env));

  const burst = [];
  for (let i = 0; i < 45; i++) {
    burst.push(await read(await W.authLogin(
      post('/auth/login', { email: 'ghost' + i + '@example.com', password: 'Not-the-Passw0rd!' }, '4.4.4.4'), env)));
  }
  const stopped = burst.filter(r => r.status === 429).length;
  ok(stopped > 0, 'a burst of sign-in attempts from one source is cut off', stopped);
  ok(burst.filter(r => r.status === 401).length <= 30,
     'so the number of password hashes one source can buy is bounded',
     burst.filter(r => r.status === 401).length);
  ok(/Too many sign-in attempts/.test(burst[burst.length - 1].body.error || ''),
     'and it says so rather than looking like a wrong password',
     burst[burst.length - 1].body.error);

  /* And a different source is unaffected, because a shared address must not
     lock out everybody behind it for one attacker. */
  const other = await read(await W.authLogin(post('/auth/login', { email: 'real@example.com', password: PW }, '5.5.5.5'), env));
  ok(other.status === 200, 'while somebody else signs in normally', other.status);
}

section('And a counter outage does not become a sign-in outage here either');
{
  const env = mkEnv();
  await read(await W.authSignup(post('/auth/signup', { email: 'blip@example.com', name: 'B', password: PW }), env));
  const broken = Object.assign({}, env, {
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { throw new Error('counter down'); } }) },
  });
  const r = await read(await W.authLogin(post('/auth/login', { email: 'blip@example.com', password: PW }, '6.1.1.1'), broken));
  ok(r.status === 200, 'somebody still gets in', r.status);
  ok(!!r.body.token, 'with a real token', !!r.body.token);
}

section('The shape, so none of it comes back quietly');
{
  const login = codeOnly(functionBody(src, 'authLogin') || '');
  ok(login.length > 800, 'the handler was read', login.length);
  ok(!/no such account/.test(login), 'no branch names a missing account', true);
  ok((login.match(/SAME_ANSWER/g) || []).length >= 4,
     'every failure returns the one answer', (login.match(/SAME_ANSWER/g) || []).length);
  ok(!/\}, 404\)/.test(login), 'and nothing here is a 404', true);

  const hash = codeOnly(functionBody(src, '_hashPassword') || '');
  ok(/PASSWORD_MAX/.test(hash),
     'the length bound is at the one place every password route funnels through', true);
}

globalThis.fetch = realFetch;
if (report('the-door-does-not-say-who-lives-here') > 0) process.exitCode = 1;
done();
