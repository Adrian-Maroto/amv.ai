/* AUTH HARDENING — attack the token system the way an attacker would.
   Before real users depend on it, prove: a forged token is rejected, the
   'alg:none' trick fails, a token signed with the wrong secret fails, an expired
   token fails, a refresh token can't be used as an access token, tampering with
   the payload fails, and "sign out everywhere" (epoch bump) genuinely kills
   existing tokens. Every test here is an attempted break-in. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'auth.harness.mjs');
writeFileSync(harness, src +
  '\nexport { signToken, verifyToken, issueTokens, authRefresh, authLogout, requireUser, revokeUserTokens, _tokenEpoch, b64urlEncode, TOKEN_VER };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'a-long-random-secret-at-least-32-chars-long',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
  }
};

const SECRET = env.JWT_SECRET;
const decode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ── A legitimately-issued token works ───────────────────────────────────── */
section('A real token verifies');

const pair = await W.issueTokens(env, 'alice@test.com', 'Alice');
ok(!!pair.token && !!pair.refreshToken, 'issuing produces an access + refresh token');
const good = await W.verifyToken(pair.token, SECRET, env, 'access');
ok(good && good.email === 'alice@test.com', 'a valid access token verifies to the right user', good && good.email);

/* ── ATTACK: alg:none ────────────────────────────────────────────────────── */
section('ATTACK: the alg:none trick is rejected');

const noneHeader = b64url({ alg: 'none', typ: 'JWT' });
const nonePayload = b64url({ email: 'attacker@evil.com', typ: 'access', ver: W.TOKEN_VER, exp: 9999999999 });
const noneToken = `${noneHeader}.${nonePayload}.`;
const noneResult = await W.verifyToken(noneToken, SECRET, env, 'access');
ok(noneResult === null, 'a token with alg:none and no signature is REJECTED', noneResult);

/* ── ATTACK: wrong signing secret ────────────────────────────────────────── */
section('ATTACK: a token signed with the wrong secret is rejected');

const forged = await W.signToken({ email: 'attacker@evil.com' }, 'the-wrong-secret', { typ: 'access' });
const forgedResult = await W.verifyToken(forged, SECRET, env, 'access');
ok(forgedResult === null, 'a token signed with a different secret does NOT verify', forgedResult);

/* ── ATTACK: tamper with the payload, keep the old signature ─────────────── */
section('ATTACK: editing the payload breaks the signature');

const [h, p, s] = pair.token.split('.');
const tampered = JSON.parse(decode(p));
tampered.email = 'attacker@evil.com';        // try to become someone else
const tamperedToken = `${h}.${b64url(tampered)}.${s}`;
const tamperedResult = await W.verifyToken(tamperedToken, SECRET, env, 'access');
ok(tamperedResult === null, 'a payload edited to impersonate another user is rejected', tamperedResult);

/* ── ATTACK: use a refresh token where an access token is required ────────── */
section('ATTACK: a refresh token cannot act as an access token');

const asAccess = await W.verifyToken(pair.refreshToken, SECRET, env, 'access');
ok(asAccess === null, 'a refresh token is NOT accepted as an access token', asAccess);
const asRefresh = await W.verifyToken(pair.refreshToken, SECRET, env, 'refresh');
ok(asRefresh && asRefresh.email === 'alice@test.com', 'but it IS valid as a refresh token', asRefresh && asRefresh.email);

/* ── ATTACK: an expired token ────────────────────────────────────────────── */
section('ATTACK: an expired token is rejected');

// hand-craft a properly-signed token that is already expired
const expiredToken = await W.signToken({ email: 'alice@test.com' }, SECRET, { typ: 'access' });
// forge expiry into the past by re-signing: easiest is to verify a token whose exp we control
// Build one directly with the real signer, then fast-forward "now" isn't possible, so
// instead craft-sign a payload with a past exp using the module's own signToken is not exposed
// for exp override — so we assert via a manually built + correctly-signed token:
const pastPayload = { email: 'alice@test.com', typ: 'access', ver: W.TOKEN_VER, epoch: 0,
  iat: 1000, nbf: 1000, exp: 2000, jti: 'x' };  // exp long in the past
const encHeader = W.b64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
const encPayload = W.b64urlEncode(new TextEncoder().encode(JSON.stringify(pastPayload)));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${encHeader}.${encPayload}`));
const encSig = W.b64urlEncode(new Uint8Array(mac));
const realButExpired = `${encHeader}.${encPayload}.${encSig}`;
const expiredResult = await W.verifyToken(realButExpired, SECRET, env, 'access');
ok(expiredResult === null, 'a correctly-signed but EXPIRED token is rejected', expiredResult);

/* ── ATTACK: garbage / malformed tokens don't crash or pass ──────────────── */
section('ATTACK: malformed tokens fail closed');

for (const bad of ['', 'not.a.token', 'a.b', 'a.b.c.d', null, undefined, 'Bearer xyz', '...']) {
  const r = await W.verifyToken(bad, SECRET, env, 'access');
  ok(r === null, `malformed token (${JSON.stringify(bad)}) is rejected`, r);
}

/* ── "Sign out everywhere" genuinely revokes existing tokens ─────────────── */
section('Revocation: signing out everywhere kills existing tokens');

const before = await W.verifyToken(pair.token, SECRET, env, 'access');
ok(before && before.email === 'alice@test.com', 'the token works before logout');

await W.revokeUserTokens(env, 'alice@test.com');   // bump the epoch

const after = await W.verifyToken(pair.token, SECRET, env, 'access');
ok(after === null, 'after "sign out everywhere", the OLD token no longer works', after);

// a freshly-issued token (post-revocation) works again
const fresh = await W.issueTokens(env, 'alice@test.com', 'Alice');
const freshOk = await W.verifyToken(fresh.token, SECRET, env, 'access');
ok(freshOk && freshOk.email === 'alice@test.com', 'a new token issued after logout works', freshOk && freshOk.email);
ok(await W.verifyToken(pair.token, SECRET, env, 'access') === null,
   'and the revoked token STAYS dead', 'still null');

/* ── The refresh endpoint enforces token type + validity ─────────────────── */
section('The refresh endpoint rejects bad input');

const req = (body, hdrs = {}) => new Request('https://api.amv.dev/auth/refresh', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...hdrs }, body: JSON.stringify(body || {})
});

let r = await W.authRefresh(req({}), env);
ok(r.status === 400, 'refresh with no token is a 400', r.status);

r = await W.authRefresh(req({ refreshToken: fresh.token }), env);   // an ACCESS token, not refresh
ok(r.status === 401, 'trying to refresh with an ACCESS token is rejected', r.status);

r = await W.authRefresh(req({ refreshToken: 'garbage.token.here' }), env);
ok(r.status === 401, 'refresh with a garbage token is rejected', r.status);

r = await W.authRefresh(req({ refreshToken: fresh.refreshToken }), env);
ok(r.status === 200, 'refresh with a valid refresh token succeeds', r.status);
const refreshed = await r.json();
ok(!!refreshed.token && !!refreshed.refreshToken, 'and returns a fresh access + refresh pair');

/* ── requireUser: the gate every protected endpoint relies on ────────────── */
section('requireUser is the real gate');

const authed = await W.requireUser(new Request('https://x', { headers: { Authorization: 'Bearer ' + fresh.token } }), env);
ok(authed && authed.email === 'alice@test.com', 'a valid Bearer token authenticates', authed && authed.email);

const noAuth = await W.requireUser(new Request('https://x'), env);
ok(noAuth === null, 'no Authorization header = not authenticated', noAuth);

const badAuth = await W.requireUser(new Request('https://x', { headers: { Authorization: 'Bearer ' + noneToken } }), env);
ok(badAuth === null, 'a forged token does not authenticate', badAuth);

report();
done();
