/* OAUTH HARDENING - the implicit flow returns the access token in the URL
   fragment, where it lands in browser history, referrers, and anything that can
   read the address bar, and it cannot issue a refresh token. These assertions
   prove AMV uses auth-code + PKCE whenever a backend is available, that the
   verifier never leaves the browser except to our own server, and that the
   CSRF/state protections still hold. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
   redefinable), so the authorisation URL is asserted from the code that builds
   it rather than by following it.

   THIS USED TO READ connectGoogle, AND connectGoogle HAD NO CALLERS.

   It was the old client-side Google connection, superseded by Connected
   accounts and reachable from nothing - so these assertions were green about a
   function nobody could run, while the handshake a person actually takes was
   somewhere else entirely. A test that guards dead code is worse than no test,
   because it reads as coverage. There are two live paths and both are asked. */

section('The provider AMV holds a key for: the handshake starts on the SERVER');
{
  /* Connected accounts is the flow behind Google, and its whole point is that
     the browser is not trusted with any of it: the server picks the verifier,
     keeps it sealed, builds the URL, and does the exchange with the client
     secret. So the assertions are about the Worker, not the page. */
  const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  const fn = worker.slice(worker.indexOf('async function connStart'),
                          worker.indexOf('async function connFinish'));
  ok(fn.length > 500, 'the handshake start was found', fn.length);
  ok(/response_type: 'code'/.test(fn), 'the auth-code flow is built - never response_type=token', true);
  ok(/code_challenge_method: 'S256'/.test(fn), 'with an S256 PKCE challenge', true);
  ok(/const verifier = _connRandom\(48\)/.test(fn),
     'and the verifier is minted HERE, so the browser never holds one', true);
  ok(/sealed: await connSeal\(env, \{ verifier/.test(fn),
     'stored sealed rather than in the clear, because a verifier readable in KV is a verifier available to anything that can read KV', true);
  ok(/access_type/.test(worker.slice(worker.indexOf('const CONN_PROVIDERS'), worker.indexOf('const CONN_PROVIDERS') + 2000)),
     'and offline access is asked for, or the tab-closed promise cannot be kept', true);
  ok(!/response_type=token/.test(fn), 'the implicit flow appears nowhere in it', true);
}

section('And the providers the client still starts itself use PKCE too');
{
  /* The catalogue providers - Outlook, Slack, GitHub and the rest - are not in
     the connected-accounts framework yet, so the page builds their URL. They
     get the same treatment: a challenge and a provider-bound state, every one.

     Read from app.js rather than from the live function: the shipped page is
     minified, so a local name is gone and quote style is the minifier's to
     choose. The BEHAVIOUR assertions above and below run against the real
     page. */
  const bundleSrc = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = bundleSrc.indexOf('async function _oauthUrl');
  ok(at > 0, 'the client-side URL builder was found', at);
  const fn = bundleSrc.slice(at, bundleSrc.indexOf('\nfunction ', at + 10));
  ok(/_pkceChallenge\(id\)/.test(fn), 'a challenge is minted per provider, by id', true);
  ok(/code_challenge_method=S256/.test(fn), 'S256, not plain', true);
  ok(!/response_type=token/.test(fn), 'and no provider is handed the implicit flow', true);
  /* Every URL it can return carries the state. A provider added to that map
     without one is a callback nobody can bind to a request. */
  const urls = fn.split('\n').filter(l => /https?:\/\//.test(l) && /client_id=/.test(l));
  ok(urls.length >= 5, 'the provider map was read, not an empty slice', urls.length);
  /* `+pkce` is the shared suffix and it ENDS in &state=, so a line that appends
     it carries state without the word appearing on that line. Checked for
     either, because the first version of this reported Outlook - which does
     carry it - as missing, and a check that cries wolf gets edited rather than
     believed. */
  const stateless = urls.filter(l => !/state=/.test(l) && !/\+\s*pkce\b/.test(l))
                        .map(l => l.trim().split(':')[0]);
  ok(stateless.length === 0, 'and every one carries CSRF state', stateless);
}

section('The implicit flow is the fallback, never the first choice');
{
  /* THE ONE PLACE IN THE CLIENT THAT CAN STILL ASK FOR A TOKEN IN THE URL.

     connectGoogle starts the older Google grant - the one the mailbox, the
     calendar and the school reader still run on. It tries auth-code + PKCE
     first and falls back to the implicit flow only when there is no backend to
     do the exchange, which is the deployment where the alternative is the
     feature not existing.

     That ordering IS the guarantee. The implicit flow returns the access token
     in the URL fragment, where it lands in history, in referrers, and in
     anything that can read the address bar, and it cannot issue a refresh
     token. So: it must come second, and it must be reachable only when the
     first branch cannot run.

     This suite once asserted all of this and nothing else, against a function
     with no callers - see GOOGLE-PATHS.md. The two sections above are the paths
     a person actually takes today; this one is the path that is still wired
     underneath them. */
  const bundleSrc = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = bundleSrc.indexOf('function connectGoogle');
  ok(at > 0, 'the older Google grant is still in the bundle', at);
  const fn = bundleSrc.slice(at, bundleSrc.indexOf('\nfunction ', at + 10));
  const codeIdx = fn.indexOf('response_type=code');
  const tokenIdx = fn.indexOf('response_type=token');
  ok(codeIdx > 0, 'the auth-code flow is built', codeIdx);
  ok(/code_challenge_method=S256/.test(fn), 'with an S256 PKCE challenge', true);
  ok(/access_type=offline/.test(fn), 'and offline access, so a refresh token can be issued', true);
  ok(/AMV_API && AMV_API\.live && AMV_API\.token/.test(fn),
     'chosen whenever a backend is available to do the exchange', true);
  ok(tokenIdx > codeIdx,
     'and the implicit flow appears only AFTER it, as the no-backend fallback', { codeIdx, tokenIdx });
  ok(/state=/.test(fn), 'CSRF state is present in both paths', true);

  /* And nowhere else. One fallback in one function is a stated tradeoff; a
     second copy somewhere else is how a tradeoff becomes the default. */
  const all = (bundleSrc.match(/response_type=token/g) || []).length;
  ok(all === 1, 'and it is the only place in the whole client that asks for one', all);
}

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
