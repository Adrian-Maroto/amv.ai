/* THE LEDGER ON THIS DEVICE SAID "PAID" ABOUT THINGS NOBODY HAD PAID FOR.
   (AMV-AUD-011, AMV-AUD-012)

   Billing has two lists. The authoritative one is the processor's - invoices
   read from the server. The other is "Payments recorded on this device", kept
   in this browser, and the page is careful to call it secondary. Two paths
   wrote things into that secondary list that were not true.

   A PLAN CHANGE WAS WRITTEN DOWN AS A PAYMENT (012). `_setPlan` appended a
   `paid` subscription at the plan's list price whenever the plan went up - and
   the plan goes up for reasons that are not payments: a server entitlement
   sync, an admin grant, a trial, a preview. It was titled "monthly" even for a
   yearly plan. A plan is access; a payment is money; the list conflated them.

   A RETURN URL WAS TAKEN AS A RECEIPT (011). Checkout comes back to
   `?bought=<listing id>`. The app marked "a pending marketplace record" paid -
   whichever pending one it found first, not the one for that listing - and
   announced "Purchase complete", on nothing but a query string anybody can
   type. The server keeps the real record at `/v1/market/purchases`, written
   when the processor's webhook lands.

   So the return is a REQUEST TO CHECK. The server is asked; only an order it
   lists is settled, and only the one for that listing. Until then the screen
   says it is confirming, and if it never confirms, it says that too.

   WHY THIS IS NOT A BILLING CHANGE. Nothing here charges, refunds, grants,
   prices or talks to a processor. It stops a display from asserting a payment
   it has no evidence of. With no backend nothing is ever charged, so the
   removed entries described no real money; with one, real charges come from
   the processor's own list, which is untouched. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await app.connect();

const ledger = () => page.evaluate(() => (typeof _loadTxns === 'function' ? _loadTxns() : []));
const wipe = () => page.evaluate(() => { try { store('amv_txns', {}); } catch (e) {} });

section('A plan change is not a payment');
{
  await wipe();
  await page.evaluate(() => { saveStr('amv_plan', 'free'); _setPlan('pro'); });
  const t = await ledger();
  ok(t.length === 0,
     'going from free to a paid plan writes NO transaction - access is not money', JSON.stringify(t));
  const plan = await page.evaluate(() => loadStr('amv_plan'));
  ok(plan === 'pro', 'while the plan itself really did change', plan);
}

/* ORDER MATTERS HERE, AND ON PURPOSE. The confirm loop keeps asking the
   server for several seconds in the background, so a poller left over from a
   section that expects NOTHING to settle is still running when the next one
   starts. Run after it, the positive case below could be settled by that
   leftover rather than by its own return - passing for the wrong reason. So
   the case that SHOULD settle goes first, where nothing is left running. */
section('A purchase the server lists is settled - that one, and only that one');
{
  await wipe();
  await page.evaluate(() => {
    /* L-OTHER is recorded LAST so it sits FIRST: `_recordTxn` prepends. The
       old settle took "the first pending marketplace record", and with these
       the other way round that happened to be the right one - so the mutation
       restoring it passed. Recorded in this order, "first pending" is the
       WRONG order, which is the case the fix exists for. */
    _recordTxn({ type: 'marketplace', listingId: 'L-REAL', title: 'Real thing', amount: 9, status: 'pending' });
    _recordTxn({ type: 'marketplace', listingId: 'L-OTHER', title: 'Something else', amount: 4, status: 'pending' });
    AMV_API._fetch = async (p) => (/\/v1\/market\/purchases/.test(p)
      ? { ok: true, items: [{ id: 'L-REAL', title: 'Real thing', _purchasedAt: Date.now() }] } : { ok: true });
    window.__toasts = [];
    window.toast = (m) => window.__toasts.push(String(m));
    history.replaceState(null, '', location.pathname + '?bought=L-REAL');
    _checkPayReturn();
  });
  await page.waitForTimeout(900);
  const t = await ledger();
  const real = t.find(x => x.listingId === 'L-REAL');
  const other = t.find(x => x.listingId === 'L-OTHER');
  ok(real && real.status === 'paid', 'the order the server confirmed is marked paid', JSON.stringify(real));
  ok(other && other.status === 'pending',
     'and a DIFFERENT pending order is left alone - the old code settled whichever it found first',
     JSON.stringify(other));
  const toasts = await page.evaluate(() => window.__toasts);
  ok(toasts.some(m => /purchase complete/i.test(m)), 'and now it is announced as complete', JSON.stringify(toasts));
}

section('A return URL on its own settles nothing');
{
  await wipe();
  await page.evaluate(() => {
    _recordTxn({ type: 'marketplace', listingId: 'L-REAL', title: 'Real thing', amount: 9, status: 'pending' });
    /* The server has NOT recorded this purchase. */
    AMV_API._fetch = async (p) => (/\/v1\/market\/purchases/.test(p) ? { ok: true, items: [] } : { ok: true });
    window.__toasts = [];
    window.toast = (m) => window.__toasts.push(String(m));
    history.replaceState(null, '', location.pathname + '?bought=L-REAL');
    _checkPayReturn();
  });
  await page.waitForTimeout(600);
  const t = await ledger();
  const toasts = await page.evaluate(() => window.__toasts);
  ok(t[0] && t[0].status === 'pending',
     'the order stays pending while the server has no record of it', JSON.stringify(t[0]));
  ok(!toasts.some(m => /purchase complete/i.test(m)),
     'and nothing announces the purchase as complete', JSON.stringify(toasts));
  ok(toasts.some(m => /confirm/i.test(m)), 'it says it is confirming instead', JSON.stringify(toasts));
}

section('A made-up listing id in the URL settles nothing');
{
  await wipe();
  await page.evaluate(() => {
    _recordTxn({ type: 'marketplace', listingId: 'L-REAL', title: 'Real thing', amount: 9, status: 'pending' });
    AMV_API._fetch = async (p) => (/\/v1\/market\/purchases/.test(p)
      ? { ok: true, items: [{ id: 'L-SOMETHING-ELSE' }] } : { ok: true });
    window.__toasts = [];
    window.toast = (m) => window.__toasts.push(String(m));
    history.replaceState(null, '', location.pathname + '?bought=L-FAKE');
    _checkPayReturn();
  });
  await page.waitForTimeout(600);
  const t = await ledger();
  ok(t[0] && t[0].status === 'pending', 'a return for an order that does not exist changes nothing', JSON.stringify(t[0]));
  /* THE ANNOUNCEMENT IS THE HARM, not only the ledger. A confirm that accepted
     ANY purchase in the list settled nothing here - no order matched - and so
     passed the line above, while still telling the person "Purchase complete"
     about a listing they never bought. */
  const toasts = await page.evaluate(() => window.__toasts);
  ok(!toasts.some(m => /purchase complete/i.test(m)),
     'and nobody is told a purchase completed that the server does not list', JSON.stringify(toasts));
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
