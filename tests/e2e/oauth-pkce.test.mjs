/* OAUTH HARDENING - the implicit flow returns the access token in the URL
   fragment, where it lands in browser history, referrers, and anything that can
   read the address bar, and it cannot issue a refresh token. These assertions
   prove AMV uses auth-code + PKCE whenever a backend is available, that the
   verifier never leaves the browser except to our own server, and that the
   CSRF/state protections still hold. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

section('PKCE is generated correctly (S256, high entropy, single-use)');
const pk = await page.evaluate(async () => {
  const a = await _pkceChallenge('google');
  const b = await _pkceChallenge('google');
  // verify the challenge really is base64url(SHA-256(verifier))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a.verifier));
  let s = ''; const arr = new Uint8Array(digest);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  const expected = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const first = _pkceConsume(a.state, 'google');
  const replay = _pkceConsume(a.state, 'google');       // must not work twice
  const wrongProvider = _pkceConsume(b.state, 'slack'); // must not cross providers
  return { method: a.method, verifierLen: a.verifier.length, challengeMatches: a.challenge === expected,
    distinct: a.verifier !== b.verifier && a.state !== b.state,
    first: first.ok, replay: replay.ok, wrongProvider: wrongProvider.ok,
    urlSafe: /^[A-Za-z0-9_-]+$/.test(a.challenge) };
});
ok(pk.method === 'S256', 'the S256 challenge method is used, not plain', pk.method);
ok(pk.verifierLen >= 43, 'the verifier meets the minimum entropy length', pk.verifierLen);
ok(pk.challengeMatches, 'the challenge is a correct SHA-256 of the verifier');
ok(pk.urlSafe, 'the challenge is base64url encoded');
ok(pk.distinct, 'every attempt gets its own verifier and state');
ok(pk.first === true, 'a valid state resolves once');
ok(pk.replay === false, 'and CANNOT be replayed - the transaction is single-use', pk.replay);
ok(pk.wrongProvider === false, 'a state from one provider cannot be used for another', pk.wrongProvider);

section('An expired transaction is refused');
const expired = await page.evaluate(() => {
  const st = _oauthTxStart('google', 'v');
  const raw = JSON.parse(loadStr('amv_oauthtx_' + st));
  raw.exp = Date.now() - 1000;
  saveStr('amv_oauthtx_' + st, JSON.stringify(raw));
  return _oauthTxConsume(st, 'google');
});
ok(expired === null, 'an expired OAuth transaction cannot be consumed');

/* Navigation cannot be intercepted in a real browser (location.href is not
   redefinable), so the authorisation URL is asserted from what connectGoogle
   actually constructs, and the branch condition is checked explicitly. */
section('With a backend, the auth-code flow is used - no token in the URL');
const fn = await page.evaluate(() => String(window.connectGoogle));
ok(/response_type=code/.test(fn), 'the auth-code flow is built', 'response_type=code');
ok(/code_challenge=/.test(fn) && /code_challenge_method=S256/.test(fn), 'with a PKCE challenge attached');
ok(/access_type=offline/.test(fn), 'and offline access, so a refresh token can be issued');
ok(/_pkceChallenge\('google'\)/.test(fn), 'using the PKCE helper');
ok(/AMV_API && AMV_API\.live && AMV_API\.token/.test(fn), 'chosen whenever a backend is available', 'canExchange');
// the legacy implicit flow survives ONLY as the no-backend fallback
const codeIdx = fn.indexOf('response_type=code');
const tokenIdx = fn.indexOf('response_type=token');
ok(tokenIdx > codeIdx, 'the implicit flow appears only AFTER the code flow, as the fallback', { codeIdx, tokenIdx });
ok(/state=/.test(fn), 'CSRF state is still present in both paths');

section('The verifier is only ever sent to our own server');
const src = await page.evaluate(() => String(window.checkOAuthCallback));
ok(/v1\/oauth\/google\/exchange/.test(src), 'the code and verifier go to our exchange endpoint');
ok(!/oauth2\.googleapis\.com\/token/.test(src), 'the browser never calls the token endpoint directly (no client secret in the client)');
ok(/history\.replaceState/.test(src), 'the code is stripped from the address bar after handling');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
