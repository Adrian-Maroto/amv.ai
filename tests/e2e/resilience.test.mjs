/* RESILIENCE - two failure modes that erode trust quietly:
   1. a provider grant that silently expires overnight, killing every standing
      job at the one-hour mark with no error anyone sees;
   2. a failed fetch that leaves a panel blank, which reads as "empty" rather
      than "this did not load".
   Both must fail loudly and recover on their own where possible.

   (1) IS NO LONGER A BROWSER PROBLEM, AND THAT IS THE POINT.

   It used to be one. The page held a Google access token, and this suite
   asserted that ensureGToken renewed it a couple of minutes early so a long job
   never expired mid-run. That was correct, and it only ever protected a job
   while a tab was open.

   The token moved to the server. The page asks it to ACT rather than asking for
   a key to act with, so there is nothing here left to expire - and the renewal
   that keeps the overnight promise is asserted where it now lives, against
   connUse, in tests/worker/the-grant-renews-itself-overnight.

   What is asserted HERE is the browser half of the same guarantee, and it is a
   property rather than an absence: every action on a server-held grant reaches
   the server, none of them carries a credential, and no machinery for holding
   or renewing one is left behind to be reached by accident. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

section('Nothing in this browser holds or renews a provider token');
{
  const gone = await page.evaluate(() => ({
    symbols: ['getGToken', 'ensureGToken', 'refreshGToken', '_gSet', '_gClear', '_gHasGrant', 'connectGoogle']
      .filter(n => typeof window[n] !== 'undefined'),
    marker: (() => { try { return localStorage.getItem('amv_google_connected'); } catch (e) { return null; } })(),
    stored: (() => {
      try { return Object.keys(localStorage).filter(k => /gtoken/i.test(k)); } catch (e) { return []; }
    })(),
  }));
  ok(gone.symbols.length === 0,
     'not one piece of the old token machinery is reachable on the page', gone.symbols);
  ok(!gone.marker,
     'and no "Google is connected" marker is left in storage to be believed', gone.marker);
  ok(gone.stored.length === 0, 'and nothing token-shaped is on disk', gone.stored);

  /* AND NOTHING ASKS FOR ONE EITHER. The routes that used to mint a token for
     this page are gone from the Worker, so a client that still called them
     would get a 404 and show somebody a failure instead of a mailbox - the kind
     of break that only appears once it is deployed. */
  const asks = await page.evaluate(() => {
    const src = [String(window.checkOAuthCallback || ''),
                 String(window._connActRun || ''),
                 String(window.connectIntegration || '')].join('\n');
    return {
      read: src.length > 200,
      exchange: /oauth\/google\/exchange/.test(src),
      refresh: /oauth\/google\/refresh/.test(src),
      direct: /oauth2\.googleapis\.com/.test(src),
    };
  });
  ok(asks.read, 'the handlers were read, not three empty strings', asks.read);
  ok(!asks.exchange, 'nothing calls the retired exchange route', asks.exchange);
  ok(!asks.refresh, 'nothing calls the retired refresh route', asks.refresh);
  ok(!asks.direct, 'and the browser never calls a provider token endpoint itself', asks.direct);

  /* AND THE RETURN HANDLER KEEPS NOTHING EITHER. What comes back from a
     provider is a single-use code in the address bar; this handler's whole job
     is to get it to the server and get it out of the URL. */
  const cb = await page.evaluate(() => String(window.checkOAuthCallback || ''));
  ok(cb.length > 100, 'the return handler was read, not an empty string', cb.length);
  ok(/_connectFinish/.test(cb), 'the code goes to the connected-accounts finish, which asks the server');
  ok(!/verifier/.test(cb), 'and it carries no PKCE verifier, because it never had one');
  ok(/history\.replaceState/.test(cb), 'the code is stripped from the address bar after handling');
}

section('The account actions never hold a provider token at all');
{
  /* This used to assert that they call ensureGToken before reaching out - the
     right property while the page held a Google token and a stale one would
     make a job fail mid-run.

     They do not hold one now. The server does, and the page asks it to act, so
     the assertion changed from "refresh the token first" to something
     stronger: there is no token here to be stale. A token that never arrives
     cannot expire, cannot be read by anything that gets a foothold on this
     page, and does not vanish when the tab closes. */
  /* Only the ones on a SERVER-HELD grant. GitHub and Slack in the same table
     use a token the person pasted themselves, which is a different arrangement
     and not what changed - asserting over the whole table would fail on those
     and say nothing about this. */
  const acts = await page.evaluate(() => {
    try {
      return Object.keys(INTEGRATION_ACTIONS)
        .filter(k => INTEGRATION_ACTIONS[k].needs === 'connect')
        .map(k => ({ k, src: String(INTEGRATION_ACTIONS[k].run) }));
    } catch (e) { return []; }
  });
  ok(acts.length >= 6, 'the server-held actions were found, not an empty list', acts.map(a => a.k));
  const direct = acts.filter(a => /Bearer|googleapis\.com/.test(a.src)).map(a => a.k);
  ok(direct.length === 0,
     'not one of them carries a token or calls a provider from the browser', direct);
  const asks = acts.filter(a => /_connActRun/.test(a.src)).map(a => a.k);
  ok(asks.length === acts.length, 'every one asks the server to act', { asks: asks.length, of: acts.length });
}

section('A failed load says so instead of looking empty');
// Assert on the handlers themselves: every network/IO promise must have a
// rejection path that tells the user something, not just resolve-or-nothing.
const handlers = await page.evaluate(() => ({
  sheet: String(window.handleSheetFile || ''),
  hasMarketRecovery: typeof window.renderMarketView === 'function'
}));
ok(/\.catch\(/.test(handlers.sheet), 'the file upload handles a read failure');
ok(/Could not read that file/.test(handlers.sheet), 'and tells the user, rather than silently doing nothing');
ok(/no readable rows/.test(handlers.sheet), 'an empty or non-CSV file is reported too');
ok(handlers.hasMarketRecovery, 'the marketplace view is present to render its own failure state');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
