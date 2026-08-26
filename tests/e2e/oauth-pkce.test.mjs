/* OAUTH HARDENING - the implicit flow returns the access token in the URL
   fragment, where it lands in browser history, referrers, and anything that can
   read the address bar, and it cannot issue a refresh token.

   These assertions prove AMV uses auth-code + PKCE everywhere, and that the
   CSRF/state protections hold. What they no longer say is that the verifier
   "never leaves the browser except to our own server": for the provider AMV
   holds a key for, the verifier is minted and sealed on the SERVER and the
   browser never has one to protect. The catalogue providers the page still
   starts itself do mint one here, and those are asserted separately below. */
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

section('The implicit flow is not the fallback, because it is not anywhere');
{
  /* THIS SECTION USED TO ASSERT AN ORDERING, AND NOW ASSERTS AN ABSENCE, WHICH
     IS THE STRONGER OF THE TWO.

     connectGoogle started the older Google grant. It tried auth-code + PKCE
     first and fell back to `response_type=token` - the implicit flow - only
     when there was no backend to do the exchange. The ordering WAS the
     guarantee, and this suite asserted it: second, and reachable only when the
     first branch cannot run.

     That was an honest trade while the alternative was the feature not
     existing. Connected accounts needs a backend by construction, so the trade
     is no longer on the table and neither is the flow. The implicit flow returns
     the access token in the URL fragment, where it lands in history, in
     referrers and in anything that can read the address bar, and it cannot issue
     a refresh token. It is gone from the client entirely.

     READ FROM THE SHIPPED BLOCK, NOT FROM app.js. The readable bundle carries
     the comments explaining what was removed, and those comments name the flow
     - so a correct removal reads as a leak if you grep the copy with the prose
     in it. index.html's generated block is what a visitor downloads: minified,
     comments stripped. */
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf('<!-- BUILD:JS:START -->');
  const b = html.indexOf('<!-- BUILD:JS:END -->');
  ok(a > 0 && b > a, 'the generated block markers were found', { a, b });
  const shipped = html.slice(a, b);
  /* A NEGATIVE CONTROL. If the markers move, the slice above becomes a few
     characters and every absence below passes for the wrong reason. */
  ok(shipped.length > 100000, 'and it really is the bundle, not an empty slice', shipped.length);

  ok(!/response_type=token/.test(shipped),
     'nothing in the shipped page asks a provider for a token in the URL', true);
  ok(!/connectGoogle/.test(shipped), 'and the function that used to is gone with it', true);
  ok(!/oauth\/google\/(exchange|refresh)/.test(shipped),
     'along with the routes it exchanged and refreshed through', true);

  /* AND THE SERVER SIDE OF THE SAME STATEMENT. A client that cannot ask is only
     half of it - a route that would still answer is one somebody finds a use
     for. */
  const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  ok(!/case '\/v1\/oauth\/google\/(exchange|refresh)'/.test(worker),
     'the Worker no longer routes either of them', true);
  ok(!/function googleOAuth(Exchange|Refresh)/.test(worker),
     'and the handlers are deleted, not merely unrouted', true);
}

section('The verifier is never in this browser, so it cannot leave it');
{
  /* The original property was "the verifier is only ever sent to our own
     server", which was the right one while the browser minted it. The server
     mints and seals it now, so the browser has nothing to send - a stronger
     statement, and asserted as one rather than as the old one reworded. */
  const src = await page.evaluate(() => String(window.checkOAuthCallback || ''));
  ok(src.length > 100, 'the return handler was read, not an empty string', src.length);
  ok(!/verifier/.test(src), 'the return handler holds no PKCE verifier');
  ok(!/oauth2\.googleapis\.com/.test(src), 'and never calls a provider token endpoint directly');
  ok(/_connectFinish/.test(src), 'it hands the code to the server instead');
  ok(/history\.replaceState/.test(src), 'and the code is stripped from the address bar after handling');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
