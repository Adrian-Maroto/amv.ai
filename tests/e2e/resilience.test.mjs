/* RESILIENCE — two failure modes that erode trust quietly:
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

  // expired -> must renew rather than force a reconnect
  saveStr('amv_gtoken', 'OLD'); saveStr('amv_gtoken_exp', String(Date.now() - 1000));
  out.expired = await ensureGToken();

  // about to expire -> renew early so a long job never dies mid-run
  saveStr('amv_gtoken', 'OLD2'); saveStr('amv_gtoken_exp', String(Date.now() + 60000));
  out.nearExpiry = await ensureGToken();

  // healthy -> no needless network call
  const before = calls;
  saveStr('amv_gtoken', 'GOOD'); saveStr('amv_gtoken_exp', String(Date.now() + 3600000));
  out.healthy = await ensureGToken();
  out.noExtraCall = (calls === before);

  // no backend -> degrade honestly, never hand back a dead token
  saveStr('amv_api_base', ''); saveStr('amv_api_token', '');
  saveStr('amv_gtoken', 'DEAD'); saveStr('amv_gtoken_exp', String(Date.now() - 1000));
  out.noBackend = await ensureGToken();

  window.fetch = origFetch;
  return out;
});
ok(tok.expired === 'NEW_TOKEN', 'an expired token is renewed automatically', tok.expired);
ok(tok.nearExpiry === 'NEW_TOKEN', 'a nearly-expired token is renewed early (jobs never expire mid-run)', tok.nearExpiry);
ok(tok.healthy === 'GOOD' && tok.noExtraCall, 'a healthy token is reused with no extra network call');
ok(!tok.noBackend, 'with no backend it returns nothing rather than a dead token', tok.noBackend);

section('Google actions await a live token, not a stale one');
const actionsSrc = await page.evaluate(() => {
  try { return Object.keys(INTEGRATION_ACTIONS).map(k => String(INTEGRATION_ACTIONS[k].run)).join('\n'); }
  catch (e) { return ''; }
});
ok(/ensureGToken/.test(actionsSrc), 'the Google actions refresh before calling out', 'ensureGToken');

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
