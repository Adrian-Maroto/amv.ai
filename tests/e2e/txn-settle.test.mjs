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

section('A completed purchase stops saying Pending');
{
  const r = await page.evaluate(() => {
    const key = ((S.user && S.user.email) || 'you@amv.local').toLowerCase();
    store('amv_txns', { [key]: [
      { id: 'tx1', type: 'marketplace', title: 'A thing', amount: 19, status: 'pending', ts: Date.now() },
    ] });
    const settled = _settleMarketTxn('paid');
    const t = (load('amv_txns') || {})[key][0];
    return { settled, status: t.status, hasWhen: !!t.settledAt };
  });
  ok(r.settled === true, 'the waiting purchase is found', r.settled);
  ok(r.status === 'paid', 'and recorded as paid once it really completed', r.status);
  ok(r.hasWhen, 'with when it settled', r.hasWhen);
}

section('Coming back from checkout is what settles it');
{
  /* The point of the fix is the wiring, not the helper - the helper existing
     and never being called is the bug this replaces. */
  const r = await page.evaluate(() => {
    const key = ((S.user && S.user.email) || 'you@amv.local').toLowerCase();
    store('amv_txns', { [key]: [
      { id: 'tx1', type: 'marketplace', title: 'A thing', amount: 19, status: 'pending', ts: Date.now() },
    ] });
    history.replaceState({}, '', location.pathname + '?bought=1');
    _checkPayReturn();
    return { status: (load('amv_txns') || {})[key][0].status };
  });
  ok(r.status === 'paid', 'returning from a completed checkout settles the record', r.status);
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
