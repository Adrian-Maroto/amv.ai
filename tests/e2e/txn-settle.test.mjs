/* A CHECKOUT THAT NEVER CAME BACK.

   Buying something in the marketplace records a "pending" transaction and hands
   the browser to the processor's own checkout page. Nothing ever settled it.

   So the transaction list - the screen somebody opens to find out what they
   have been charged - was wrong in both directions at once. A purchase that
   COMPLETED sat at "Pending" for ever, because the return path never touched
   the record. And a checkout somebody closed without paying sat at "Pending"
   for ever too, looking like a charge still in flight for something they never
   bought.

   Neither can be fixed by guessing. The completed case is knowable - the return
   says so - and is settled. The abandoned case is not, so after a few hours it
   stops claiming to be pending and says what is actually true: AMV cannot tell
   from here, and the Purchases list is the record of what you own. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'B', email: 'b@x.com', ini: 'B' } });
const { page, errors } = app;

const seed = (rows) => page.evaluate((r) => {
  const key = ((S.user && S.user.email) || 'you@amv.local').toLowerCase();
  store('amv_txns', { [key]: r });
}, rows);

/* ═════════════════════════════════════════════════════════════════════════
   WHAT SETTLES A PURCHASE CHANGED, DELIBERATELY.  (AMV-AUD-011)

   These two sections used to hold that "the completed case is knowable - the
   return says so". It is not. `?bought=` is a query string anybody can type,
   it arrives before the processor's webhook has necessarily landed, and the
   helper settled "the first pending marketplace record" rather than the one
   for that listing. An external audit showed a return URL alone marking an
   unpaid purchase paid.

   The requirement this file was written for still stands: a purchase that
   REALLY completed must stop saying Pending. What changed is the evidence.
   The server's `/v1/market/purchases` is the record, so the return asks it,
   and only an order it lists is settled - that one, by listing id.
   ═════════════════════════════════════════════════════════════════════════ */
section('Settling needs to know which order, and settles only that one');
{
  const r = await page.evaluate(() => {
    const key = ((S.user && S.user.email) || 'you@amv.local').toLowerCase();
    store('amv_txns', { [key]: [
      { id: 'tx2', type: 'marketplace', listingId: 'L-2', title: 'Other', amount: 5, status: 'pending', ts: Date.now() },
      { id: 'tx1', type: 'marketplace', listingId: 'L-1', title: 'A thing', amount: 19, status: 'pending', ts: Date.now() },
    ] });
    const blind = _settleMarketTxn('paid');                // no listing named
    const named = _settleMarketTxn('paid', 'L-1');
    const rows = (load('amv_txns') || {})[key];
    const one = rows.find(x => x.listingId === 'L-1');
    const two = rows.find(x => x.listingId === 'L-2');
    return { blind, named, one: one.status, two: two.status, hasWhen: !!one.settledAt };
  });
  ok(r.blind === false, 'asked to settle without saying which, it settles nothing', r.blind);
  ok(r.named === true && r.one === 'paid', 'the named order is recorded as paid', JSON.stringify(r));
  ok(r.hasWhen, 'with when it settled', r.hasWhen);
  ok(r.two === 'pending',
     'and the other order - which sat FIRST in the list - is untouched', r.two);
}

section('Coming back from checkout settles it once the server has it');
{
  /* Still the wiring, as before - a helper nothing calls is the bug this file
     was first written for. Now the wiring runs through the server. */
  const r = await page.evaluate(async () => {
    const key = ((S.user && S.user.email) || 'you@amv.local').toLowerCase();
    store('amv_txns', { [key]: [
      { id: 'tx1', type: 'marketplace', listingId: 'L-1', title: 'A thing', amount: 19, status: 'pending', ts: Date.now() },
    ] });
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
    AMV_API._fetch = async (p) => (/\/v1\/market\/purchases/.test(p) ? { ok: true, items: [{ id: 'L-1' }] } : { ok: true });
    history.replaceState({}, '', location.pathname + '?bought=L-1');
    _checkPayReturn();
    await new Promise(res => setTimeout(res, 600));
    return { status: (load('amv_txns') || {})[key][0].status };
  });
  ok(r.status === 'paid', 'a completed checkout the server lists stops saying Pending', r.status);
}

section('A return the server has not confirmed does not settle anything');
{
  const r = await page.evaluate(async () => {
    const key = ((S.user && S.user.email) || 'you@amv.local').toLowerCase();
    store('amv_txns', { [key]: [
      { id: 'tx1', type: 'marketplace', listingId: 'L-1', title: 'A thing', amount: 19, status: 'pending', ts: Date.now() },
    ] });
    AMV_API._fetch = async (p) => (/\/v1\/market\/purchases/.test(p) ? { ok: true, items: [] } : { ok: true });
    history.replaceState({}, '', location.pathname + '?bought=L-1');
    _checkPayReturn();
    await new Promise(res => setTimeout(res, 600));
    return { status: (load('amv_txns') || {})[key][0].status };
  });
  ok(r.status === 'pending', 'a return URL on its own is not a receipt', r.status);
}

section('One that never came back is not left claiming to be in flight');
{
  const r = await page.evaluate(() => {
    const key = ((S.user && S.user.email) || 'you@amv.local').toLowerCase();
    const SEVEN_HOURS = 7 * 3600000;
    store('amv_txns', { [key]: [
      { id: 'old', type: 'marketplace', title: 'Abandoned', amount: 9, status: 'pending', ts: Date.now() - SEVEN_HOURS },
      { id: 'new', type: 'marketplace', title: 'Just now', amount: 9, status: 'pending', ts: Date.now() },
    ] });
    const html = _billingTxnsHTML();
    const box = document.createElement('div'); box.innerHTML = html;
    const rows = [...box.querySelectorAll('.bill-txn-row')];
    const find = (title) => rows.find(x => (x.textContent || '').includes(title));
    return {
      oldText: (find('Abandoned') || {}).textContent || '',
      newText: (find('Just now') || {}).textContent || '',
    };
  });
  ok(/Not confirmed/i.test(r.oldText),
     'a checkout from hours ago is reported as unconfirmed, not pending', r.oldText.slice(0, 90));
  ok(/never confirmed here/i.test(r.oldText),
     'saying AMV cannot tell from here', r.oldText.slice(0, 160));
  ok(/Purchases/.test(r.oldText),
     'and pointing at the list that does know', r.oldText.slice(0, 200));
  ok(/nothing is charged twice/i.test(r.oldText),
     'while making clear it is not a second charge', r.oldText.slice(0, 220));
  ok(/Pending/i.test(r.newText) && !/Not confirmed/i.test(r.newText),
     'one that genuinely just started still says Pending', r.newText.slice(0, 90));
}

section('Settled and refunded rows are untouched');
{
  await seed([
    { id: 'p', type: 'subscription', title: 'Pro', amount: 15, status: 'paid', ts: Date.now() },
    { id: 'r', type: 'marketplace', title: 'Returned', amount: 5, status: 'refunded', ts: Date.now() - 9 * 3600000 },
  ]);
  const r = await page.evaluate(() => {
    const box = document.createElement('div'); box.innerHTML = _billingTxnsHTML();
    return box.textContent || '';
  });
  ok(/Paid/.test(r), 'a paid row still reads paid', true);
  ok(/Refunded/.test(r) && !/Not confirmed/.test(r),
     'and an old refunded one is not swept up by the age rule', r.slice(0, 200));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('txn-settle') > 0) process.exitCode = 1;
done();
