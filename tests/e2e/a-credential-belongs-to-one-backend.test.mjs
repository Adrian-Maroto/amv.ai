/* THE SHORT-LIVED TOKEN WAS BOUND TO ITS ORIGIN. THE LONG-LIVED ONE WAS NOT.
   (AMV-AUD-008)

   `_fetch` has refused to attach the bearer token to an origin it was not
   issued for since AMV-013. `_doRefresh` had no such check: it posted
   `{refreshToken}` to `this.base + '/auth/refresh'` whatever `this.base` had
   become.

   So pointing AMV at a different backend withheld the credential that expires
   in minutes and then offered the one that is valid for weeks to the new
   destination on the very next 401. That is the wrong way round. A copy of a
   refresh token is a copy of the account.

   THE FIX IS NOT A SECOND GUARD, IT IS INVALIDATION. Guarding `_doRefresh`
   alone would leave a bundle in memory belonging to nobody: an access token
   for one origin, a refresh token that may not be used, and a cookie-auth flag
   set by a server nobody is talking to any more. Changing the backend drops
   all of it and moves the authentication generation, which is what makes a
   refresh already in flight land as stale instead of writing a token back for
   the origin that was just left.

   The guard inside `_doRefresh` stays as well, and is asserted separately: the
   setter is one way the base changes, a stored value edited elsewhere is
   another, and this is the expensive credential.

   WHAT MUST NOT HAPPEN: re-saving the SAME url must not sign anybody out.
   Settings writes the base on every test-connection press. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const A = 'https://one.workers.dev';
const B = 'https://two.workers.dev';

/* A signed-in bundle issued by backend A, set the way a real login sets it. */
const armed = () => page.evaluate((a) => {
  AMV_API.base = a;
  AMV_API._setTokens({ token: 'ACCESS-A', refreshToken: 'REFRESH-A' });
  return { token: AMV_API.token, refresh: AMV_API.refreshTok,
           bound: loadStr('amv_api_token_origin'), gen: AMV_API._authGen || 0 };
}, A);

section('A login binds the bundle to the backend that issued it');
{
  const r = await armed();
  ok(r.token === 'ACCESS-A', 'the access token is held', r.token);
  ok(r.refresh === 'REFRESH-A', 'and the refresh token', r.refresh);
  ok(/one\.workers\.dev/.test(r.bound), 'bound to the origin that issued them', r.bound);
}

section('Changing the backend drops the whole bundle');
{
  const before = await armed();
  const r = await page.evaluate((b) => {
    AMV_API.base = b;
    return { token: AMV_API.token, refresh: AMV_API.refreshTok, cookie: AMV_API.cookieAuth,
             bound: loadStr('amv_api_token_origin'), gen: AMV_API._authGen || 0,
             base: AMV_API.base };
  }, B);
  ok(/two\.workers\.dev/.test(r.base), 'the backend really did change', r.base);
  ok(r.token === '', 'the access token is gone', JSON.stringify(r.token));
  ok(r.refresh === '',
     'AND SO IS THE REFRESH TOKEN - the one worth weeks, which is the finding', JSON.stringify(r.refresh));
  ok(r.cookie === false, 'the cookie-auth flag is cleared, because it belonged to the old server', String(r.cookie));
  ok(!r.bound, 'nothing is left bound', JSON.stringify(r.bound));
  ok(r.gen > before.gen,
     'and the authentication generation moved, so work in flight lands as stale', before.gen + ' -> ' + r.gen);
}

section('Re-saving the same backend does not sign anybody out');
{
  /* Settings writes the base on every test-connection press. A guard that
     fires on a write rather than on a CHANGE would log people out for pressing
     a button that succeeded. */
  const before = await armed();
  const r = await page.evaluate((a) => {
    AMV_API.base = a;
    AMV_API.base = a + '/';        // the same origin, written differently
    return { token: AMV_API.token, refresh: AMV_API.refreshTok, gen: AMV_API._authGen || 0 };
  }, A);
  ok(r.token === 'ACCESS-A' && r.refresh === 'REFRESH-A',
     'the bundle survives', JSON.stringify(r));
  ok(r.gen === before.gen, 'and nothing was invalidated', before.gen + ' vs ' + r.gen);
}

section('A refresh is refused when the bundle is not for this backend');
{
  /* The defence in depth, reached directly: the binding is left pointing at A
     while the base says B, which is the state the setter now prevents but a
     stored value edited elsewhere could still produce. */
  const r = await page.evaluate(async (bases) => {
    const sent = [];
    AMV_API.base = bases.a;
    AMV_API._setTokens({ token: 'ACCESS-A', refreshToken: 'REFRESH-A' });
    /* Move the base WITHOUT going through the setter, so the bundle survives
       and only the mismatch remains. */
    saveStr('amv_api_base', bases.b);
    window.fetch = async (url, init) => {
      sent.push({ url: String(url), body: String((init && init.body) || '') });
      return { ok: true, status: 200, json: async () => ({ token: 'ACCESS-B' }) };
    };
    const okd = await AMV_API._doRefresh();
    return { okd, sent, token: AMV_API.token };
  }, { a: A, b: B });
  ok(r.okd === false, 'the refresh refuses', String(r.okd));
  ok(r.sent.length === 0,
     'and the refresh token is never put on the wire to the new backend', JSON.stringify(r.sent));
  ok(r.token === 'ACCESS-A',
     'no token from the other backend is adopted', r.token);
}

section('A refresh to the backend that issued the bundle still works');
{
  /* The other side. A guard that refuses every refresh is not a guard, it is
     sign-in-every-few-minutes. */
  const r = await page.evaluate(async (a) => {
    const sent = [];
    AMV_API.base = a;
    AMV_API._setTokens({ token: 'ACCESS-A', refreshToken: 'REFRESH-A' });
    window.fetch = async (url, init) => {
      sent.push(String(url));
      return { ok: true, status: 200, json: async () => ({ token: 'ACCESS-A2', refreshToken: 'REFRESH-A2' }) };
    };
    const okd = await AMV_API._doRefresh();
    return { okd, sent, token: AMV_API.token };
  }, A);
  ok(r.okd === true, 'the refresh goes through', String(r.okd));
  ok(r.sent.length === 1 && /one\.workers\.dev/.test(r.sent[0]), 'to the right backend', JSON.stringify(r.sent));
  ok(r.token === 'ACCESS-A2', 'and the new token is adopted', r.token);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
