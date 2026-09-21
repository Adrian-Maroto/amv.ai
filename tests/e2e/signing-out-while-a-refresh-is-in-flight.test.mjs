/* SIGN OUT MEANT SIGN OUT UNLESS SOMETHING WAS ALREADY IN THE AIR.

   Found by the gate, not by reading: `the-session-survives-a-reload-without-a-
   token-on-disk` failed three assertions under parallel load and passed alone,
   which is the shape of a race and the shape of a suite people learn to
   re-run. It reproduced in two full gate runs, so it was neither.

   Instrumenting the failing section said exactly what happened:

     before    token "restored.a", a refresh already in flight
     justAfter token "", memory "", storage ""      <- signOut DID clear it
     setTokens "restored.a"  <- _doRefresh <- _fetch
     300ms on  token "restored.a"                   <- and it came back

   A request had met a 401, `_fetch` had started a refresh, and the person
   pressed Sign out while it was running. signOut cleared everything it could
   see; the refresh landed afterwards and wrote a fresh access token into
   memory. Nothing reached disk, so nothing survived a reload - but
   `hasSession` reads memory, so the app went on believing somebody was signed
   in, and the next request would have carried a working bearer token for the
   account that had just asked to leave.

   On a slow connection this is not an edge case. It is what pressing Sign out
   looks like when the network is bad, which is exactly when somebody is most
   likely to press it twice and walk away.

   WHY THIS FILE DRIVES IT THROUGH `_fetch`. The first attempt to reproduce it
   called `_doRefresh()` directly with `_fetch` stubbed, and it did NOT
   reproduce - `_doRefresh` is entered FROM INSIDE `_fetch`'s 401 path and does
   not go back out through it, so the stub never saw the refresh. A test that
   reaches the code by a route the product never takes is a test that can pass
   while the product is broken, and this one nearly was. It stubs the network
   underneath instead, and lets the app find its own way to the refresh. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

/* One 401 on an ordinary call, then a refresh that takes its time. The page's
   own fetch is replaced, so `_fetch` behaves exactly as it does in
   production - including deciding on its own to refresh. */
const arm = () => page.evaluate(() => {
  AMV_API.base = 'https://amv-stub.workers.dev';
  AMV_API.token = 'old-token';
  AMV_API.refreshTok = 'old-refresh';
  window.__refreshStarted = false;
  window.__realFetch = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u);
    if (url.indexOf('/auth/refresh') >= 0) {
      window.__refreshStarted = true;
      await new Promise(s => setTimeout(s, 450));
      return new Response(JSON.stringify({ ok: true, token: 'RESURRECTED', refreshToken: 'rt2', exp: Date.now() + 3e6 }),
                          { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.indexOf('/auth/logout') >= 0) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    /* The call that provokes the refresh. */
    return new Response(JSON.stringify({ error: 'expired' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  };
});

section('The setup really does put a refresh in flight');
{
  await arm();
  const r = await page.evaluate(async () => {
    const call = AMV_API._fetch('/v1/usage').catch(() => null);
    await new Promise(s => setTimeout(s, 150));
    const mid = { started: !!window.__refreshStarted, inFlight: !!AMV_API._refreshInFlight };
    await call;
    return mid;
  });
  /* Without this the assertions below would pass on a page where nothing was
     ever refreshing - green for the wrong reason, which is the failure this
     whole file is about. */
  ok(r.started, 'a 401 on an ordinary call sends the app to refresh', r);
  ok(r.inFlight, 'and the refresh is still running when we look', r);
}

section('Signing out mid-refresh leaves nothing behind');
{
  await arm();
  const r = await page.evaluate(async () => {
    const call = AMV_API._fetch('/v1/usage').catch(() => null);
    await new Promise(s => setTimeout(s, 150));         // the refresh is in flight
    signOut();
    const justAfter = { token: String(AMV_API.token || ''), mem: String(AMV_API._atMem || '') };
    await call;
    await new Promise(s => setTimeout(s, 250));          // well past the refresh landing
    const settled = {
      token: String(AMV_API.token || ''),
      mem: String(AMV_API._atMem || ''),
      rt: String(AMV_API._rtMem || ''),
      hasSession: !!AMV_API.hasSession,
      restoring: !!AMV_API._restoring,
    };
    window.fetch = window.__realFetch;
    return { justAfter, settled };
  });
  ok(r.justAfter.token === '', 'sign-out clears it immediately', JSON.stringify(r.justAfter));
  /* The one that was failing. The token the refresh minted is real and it is
     for a session that no longer exists, so it must not be written. */
  ok(r.settled.token === '', 'and it is still clear once the refresh lands', JSON.stringify(r.settled));
  ok(r.settled.token !== 'RESURRECTED', 'the token the refresh minted is not adopted', r.settled.token);
  ok(r.settled.mem === '', 'nothing is left in memory', r.settled.mem);
  ok(!r.settled.hasSession, 'and the session reads as over', r.settled);
}

section('A refresh that finishes with nobody signing out still works');
{
  /* The guard must not break the ordinary case: this is the same path with no
     sign-out in it, and the refreshed token has to be adopted. A fix that
     dropped every refresh would pass every assertion above and sign people
     out at random. */
  await arm();
  const r = await page.evaluate(async () => {
    const call = AMV_API._fetch('/v1/usage').catch(() => null);
    await call;
    await new Promise(s => setTimeout(s, 150));
    const out = { token: String(AMV_API.token || ''), hasSession: !!AMV_API.hasSession };
    window.fetch = window.__realFetch;
    return out;
  });
  ok(r.token === 'RESURRECTED', 'the refreshed token is adopted when nobody signed out', r.token);
  ok(r.hasSession, 'and the session carries on', r);
}

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await app.close();
report();
done();
