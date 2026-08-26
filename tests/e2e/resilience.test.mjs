/* RESILIENCE - two failure modes that erode trust quietly:
   1. a Google token that silently expires overnight, killing every standing
      job at the one-hour mark with no error anyone sees;
   2. a failed fetch that leaves a panel blank, which reads as "empty" rather
      than "this did not load".
   Both must fail loudly and recover on their own where possible. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

section('Google access renews itself instead of disconnecting the user');
const tok = await page.evaluate(async () => {
  const out = {};
  const origFetch = window.fetch; let calls = 0;
  window.fetch = async (u, o) => {
    if (String(u).includes('/v1/oauth/google/refresh')) {
      calls++;
      return { ok: true, json: async () => ({ ok: true, access_token: 'NEW_TOKEN', expires_in: 3600 }) };
    }
    return origFetch(u, o);
  };
  saveStr('amv_api_base', 'https://api.test'); saveStr('amv_api_token', 't');

  /* SEEDED THROUGH _gSet, NOT localStorage.

     This used to write amv_gtoken and amv_gtoken_exp straight into storage,
     which was the right door while the access token lived there. It does not
     any more: a live Google bearer token in localStorage is readable by any
     script that reaches the page and outlives the tab, so it is held in memory
     and re-minted from the server's refresh token on demand.

     Every assertion below is unchanged in strength. Only the way the state is
     set up moved, because seeding a store the code no longer reads tests
     nothing - it would have reported whatever the previous step left behind. */

  // expired -> must renew rather than force a reconnect
  _gSet('OLD', Date.now() - 1000);
  out.expired = await ensureGToken();

  // about to expire -> renew early so a long job never dies mid-run
  _gSet('OLD2', Date.now() + 60000);
  out.nearExpiry = await ensureGToken();

  // healthy -> no needless network call
  const before = calls;
  _gSet('GOOD', Date.now() + 3600000);
  out.healthy = await ensureGToken();
  out.noExtraCall = (calls === before);

  // no backend -> degrade honestly, never hand back a dead token
  saveStr('amv_api_base', ''); saveStr('amv_api_token', '');
  _gSet('DEAD', Date.now() - 1000);
  out.noBackend = await ensureGToken();

  window.fetch = origFetch;
  return out;
});
ok(tok.expired === 'NEW_TOKEN', 'an expired token is renewed automatically', tok.expired);
ok(tok.nearExpiry === 'NEW_TOKEN', 'a nearly-expired token is renewed early (jobs never expire mid-run)', tok.nearExpiry);
ok(tok.healthy === 'GOOD' && tok.noExtraCall, 'a healthy token is reused with no extra network call');
ok(!tok.noBackend, 'with no backend it returns nothing rather than a dead token', tok.noBackend);

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
