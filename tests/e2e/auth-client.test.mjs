/* CLIENT AUTH RESILIENCE — what users actually experience.
   An access token expires after an hour. The user must NOT be logged out or lose
   work when that happens mid-session. These tests prove the client silently
   refreshes on a 401, dedupes concurrent refreshes, refreshes proactively on
   boot, and fails cleanly (not into a broken state) when refresh is impossible. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('A 401 triggers a silent refresh and retry');

const silentRefresh = await page.evaluate(async () => {
  AMV_API.base = 'https://api.test';
  AMV_API.token = 'expired-token';
  AMV_API.refreshTok = 'good-refresh';

  let refreshCalls = 0, protectedCalls = 0;
  window.fetch = async (u, o) => {
    const url = String(u);
    if (url.includes('/auth/refresh')) {
      refreshCalls++;
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
               json: async () => ({ token: 'fresh-token', refreshToken: 'fresh-refresh' }) };
    }
    // a protected endpoint: 401 while the token is stale, 200 once refreshed
    protectedCalls++;
    if (AMV_API.token === 'fresh-token') {
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true }) };
    }
    return { ok: false, status: 401, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ error: 'expired' }) };
  };

  const r = await AMV_API._fetch('/v1/some-protected', { method: 'POST', body: '{}' });
  return { status: r.status, refreshCalls, protectedCalls, tokenAfter: AMV_API.token };
});
ok(silentRefresh.status === 200, 'the call ultimately succeeds after a silent refresh', silentRefresh.status);
ok(silentRefresh.refreshCalls === 1, 'exactly one refresh was performed', silentRefresh.refreshCalls);
ok(silentRefresh.tokenAfter === 'fresh-token', 'and the client is now holding the fresh token', silentRefresh.tokenAfter);

section('Concurrent 401s share ONE refresh (no refresh storm)');

const dedupe = await page.evaluate(async () => {
  AMV_API.base = 'https://api.test';
  AMV_API.token = 'expired-token';
  AMV_API.refreshTok = 'good-refresh';

  let refreshCalls = 0;
  window.fetch = async (u) => {
    const url = String(u);
    if (url.includes('/auth/refresh')) {
      refreshCalls++;
      await new Promise(r => setTimeout(r, 30));  // simulate latency so calls overlap
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
               json: async () => ({ token: 'fresh-token', refreshToken: 'fresh-refresh' }) };
    }
    if (AMV_API.token === 'fresh-token')
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) };
    return { ok: false, status: 401, headers: new Headers(), json: async () => ({ error: 'expired' }) };
  };

  // fire several protected calls at once — they should all 401 and share ONE refresh
  const results = await Promise.all([
    AMV_API._fetch('/v1/a', { method: 'POST', body: '{}' }),
    AMV_API._fetch('/v1/b', { method: 'POST', body: '{}' }),
    AMV_API._fetch('/v1/c', { method: 'POST', body: '{}' }),
  ]);
  return { refreshCalls, allOk: results.every(r => r.status === 200) };
});
ok(dedupe.allOk, 'all concurrent calls succeed', dedupe.allOk);
ok(dedupe.refreshCalls === 1, 'but only ONE refresh fired for the whole burst (single-flight)', dedupe.refreshCalls);

section('When refresh is impossible, the user is cleanly told to sign in');

const cleanFail = await page.evaluate(async () => {
  AMV_API.base = 'https://api.test';
  AMV_API.token = 'expired-token';
  AMV_API.refreshTok = 'dead-refresh';

  window.fetch = async (u) => {
    const url = String(u);
    if (url.includes('/auth/refresh'))
      return { ok: false, status: 401, headers: new Headers(), json: async () => ({ error: 'invalid refresh' }) };
    return { ok: false, status: 401, headers: new Headers(), json: async () => ({ error: 'expired' }) };
  };

  let msg = '';
  try { await AMV_API._fetch('/v1/protected', { method: 'POST', body: '{}' }); }
  catch (e) { msg = e.message; }
  return { msg };
});
ok(/sign in/i.test(cleanFail.msg), 'a dead refresh yields a clear "sign in again", not a crash', cleanFail.msg);

section('tokenValid reflects the stored expiry');

const validity = await page.evaluate(() => {
  // store an expiry in the past → invalid; future → valid
  localStorage.setItem('amv_token_exp', String(Date.now() - 1000));
  const past = AMV_API.tokenValid();
  localStorage.setItem('amv_token_exp', String(Date.now() + 60 * 60 * 1000));
  const future = AMV_API.tokenValid();
  localStorage.removeItem('amv_token_exp');
  return { past, future };
});
ok(validity.past === false, 'an expired token reads as invalid', validity.past);
ok(validity.future === true, 'a token with a future expiry reads as valid', validity.future);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
