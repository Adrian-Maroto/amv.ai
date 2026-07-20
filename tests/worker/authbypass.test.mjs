/* AUTH BYPASS REGRESSIONS — locks the three Critical authentication holes shut.

   Security audit 2026-07-19 reproduced three release-blocking bypasses:
     AMV-001  POST /auth/login with provider:"google" + a victim email issued
              real tokens for that email with NO credential check.
     AMV-002  A federated (non-email) account could log in through the password
              endpoint with ANY password, because the password check was skipped
              for non-email providers and control fell through to issueTokens.
     AMV-003  A deployment missing JWT_SECRET silently signed/verified tokens with
              the public constant "dev-insecure-secret", so anyone could forge
              tokens for any account.

   These tests fail loudly if any of those ever regress. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'authbypass.harness.mjs');
writeFileSync(harness, src +
  '\nexport { authSignup, authLogin, authGoogle, issueTokens, signToken, verifyToken };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const mkEnv = (extra = {}) => ({
  JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
    }
  },
  ...extra
});
const post = (path, body) => new Request('https://api.amv.dev' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const body = async (r) => { try { return await r.json(); } catch { return {}; } };

let env = mkEnv();

/* ── Positive control: a real email account still works ─────────────────── */
section('Baseline: real email+password login still works');
let r = await W.authSignup(post('/auth/signup', { name: 'Alice', email: 'alice@x.com', password: 'correct-horse-battery' }), env);
let d = await body(r);
ok(r.status < 400 && !d.error, 'email account created');
r = await W.authLogin(post('/auth/login', { email: 'alice@x.com', password: 'correct-horse-battery', provider: 'email' }), env);
d = await body(r);
ok(r.status === 200 && !!d.token, 'correct password issues a token');
r = await W.authLogin(post('/auth/login', { email: 'alice@x.com', password: 'WRONG', provider: 'email' }), env);
d = await body(r);
ok(r.status === 401 && !d.token, 'wrong password is rejected with no token');

/* ── AMV-001: provider:"google" must NOT be proof of identity ───────────── */
section('AMV-001: provider="google" cannot mint tokens without verification');
r = await W.authLogin(post('/auth/login', { provider: 'google', email: 'victim-new@x.com' }), env);
d = await body(r);
ok(!d.token, 'provider=google for an unknown email issues NO token');
ok(r.status >= 400, 'provider=google login is rejected (>=400)');
// even if the victim account is pre-created, the google branch must not grant a token
store.set('acct:victim2@x.com', JSON.stringify({ email: 'victim2@x.com', name: 'Victim', provider: 'email', pwHash: 'x', salt: 's', pwIter: 100000, createdAt: Date.now() }));
r = await W.authLogin(post('/auth/login', { provider: 'google', email: 'victim2@x.com' }), env);
d = await body(r);
ok(!d.token, 'provider=google against an existing account still issues NO token');

/* ── AMV-002: a federated account cannot be logged into with any password ─ */
section('AMV-002: federated (non-email) accounts reject the password endpoint');
store.set('acct:bob@x.com', JSON.stringify({ email: 'bob@x.com', name: 'Bob', provider: 'google', createdAt: Date.now() }));
r = await W.authLogin(post('/auth/login', { email: 'bob@x.com', password: 'anything-at-all', provider: 'email' }), env);
d = await body(r);
ok(r.status === 401 && !d.token, 'google account + arbitrary password → 401, no token');
r = await W.authLogin(post('/auth/login', { email: 'bob@x.com', password: '', provider: 'google' }), env);
d = await body(r);
ok(!d.token, 'google account via provider=google branch also issues no token');
// and the generic error must not leak that the account is federated
ok(!/google|federat|provider/i.test(String(d.error || '')), 'error message does not reveal the provider');

/* ── AMV-003: missing JWT_SECRET must fail closed, not use a public key ──── */
section('AMV-003: no signing/verification with a public fallback key');
// a token forged with the OLD public constant must not verify when no secret is set
const forged = await W.signToken({ email: 'attacker@x.com' }, 'dev-insecure-secret', { typ: 'access' });
const envNoSecret = mkEnv({ JWT_SECRET: undefined });
const verified = await W.verifyToken(forged, envNoSecret.JWT_SECRET, envNoSecret, 'access');
ok(verified === null, 'token forged with the old default key does NOT verify without a secret');
// signing with no secret must throw rather than silently succeed
let threw = false;
try { await W.issueTokens(envNoSecret, 'anyone@x.com', 'Anyone'); } catch { threw = true; }
ok(threw, 'issueTokens refuses to sign when JWT_SECRET is absent');
// a real secret still verifies its own tokens (no collateral damage)
const good = await W.issueTokens(env, 'alice@x.com', 'Alice');
const goodClaims = await W.verifyToken(good.token, env.JWT_SECRET, env, 'access');
ok(goodClaims && goodClaims.email === 'alice@x.com', 'a properly-signed token still verifies');

/* ── AMV-052: Google OIDC validation fails closed and pins the audience ─── */
section('AMV-052: Google sign-in validates audience/issuer, fails closed');
{
  const realFetch = globalThis.fetch;
  const gReq = (credential) => new Request('https://api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
  // tokeninfo stub: returns claims for whatever token
  const stub = (claims) => { globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => claims }); };

  // no GOOGLE_CLIENT_ID configured -> fail closed (503), never accept a token
  stub({ aud: 'someapp', iss: 'accounts.google.com', email: 'v@x.com', email_verified: true });
  let r = await W.authGoogle(gReq('tok'), env);
  ok(r.status === 503, 'Google login is refused when GOOGLE_CLIENT_ID is unset (fail closed)', r.status);

  const genv = { ...env, GOOGLE_CLIENT_ID: 'my-real-client-id' };
  // audience minted for a DIFFERENT app -> rejected
  stub({ aud: 'attacker-app', iss: 'accounts.google.com', email: 'v@x.com', email_verified: true });
  r = await W.authGoogle(gReq('tok'), genv);
  ok(r.status === 401, 'a token minted for another app (aud mismatch) is rejected', r.status);
  // unverified email -> rejected
  stub({ aud: 'my-real-client-id', iss: 'accounts.google.com', email: 'v@x.com', email_verified: false });
  r = await W.authGoogle(gReq('tok'), genv);
  ok(r.status === 401, 'an unverified Google email is rejected', r.status);
  // valid token -> accepted
  stub({ aud: 'my-real-client-id', iss: 'accounts.google.com', email: 'v@x.com', email_verified: true, name: 'V' });
  r = await W.authGoogle(gReq('tok'), genv);
  const gd = await body(r);
  ok(r.status === 200 && !!gd.token, 'a valid, audience-matched Google token is accepted', r.status);
  globalThis.fetch = realFetch;
}

if (report() > 0) process.exitCode = 1;
done();
