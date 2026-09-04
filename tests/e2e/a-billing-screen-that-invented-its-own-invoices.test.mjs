/* THE INVOICE TABLE WAS A LOOP OVER A PRICE.

   The comment above it said "the subscription's real billing history". It was
   one row per month between the plan's start date and today, each for the
   plan's LIST PRICE, each stamped Paid, each with a View button. No invoice
   number, no amount from a processor, no check that any payment happened.

   A proration, a coupon, a refund, a failed charge, a plan change or a
   cancel-and-resubscribe all rendered as an unbroken run of full-price months
   marked Paid - on the screen somebody opens to work out what they have
   actually been billed, and the one they read before disputing a charge.

   The other half of the same screen went the other way. `amv_txns` lives in
   localStorage and is in neither sync list, so it never leaves the browser
   that made the purchase - under a heading reading "Every payment you've made
   on AMV". On a second device that heading sat above none of them, and since
   the function returned '' when the list was empty, the section did not appear
   at all: no transactions, no explanation, nothing. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { bootApp } from '../lib/harness.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@x.com', ini: 'A' } });
try {
  section('With no processor connected, no invoice history is invented');
  {
    const r = await app.page.evaluate(() => {
      const P = { name: 'Pro', price: 15 };
      const since = new Date(Date.now() - 400 * 86400000);   // over a year ago
      return _invoiceTableHTML('pro', P, since);
    });
    ok(!/\$15\.00/.test(r), 'no amount is conjured from the list price', r.slice(0, 200));
    ok(!/>Paid</.test(r), 'nothing is marked Paid', r.slice(0, 200));
    ok(!/inv-row|inv-table/.test(r), 'and there is no table of months at all', r.slice(0, 160));
    ok(/not connected|payment processor/i.test(r), 'it says why there is nothing', r.slice(0, 220));
    ok(/nothing has been charged/i.test(r), 'and that nothing was charged, which is the reassuring half', r.slice(0, 220));
  }

  section('A free plan still gets the ordinary empty state');
  {
    const r = await app.page.evaluate(() => _invoiceTableHTML('free', { name: 'Free', price: 0 }, new Date()));
    ok(/No invoices yet/i.test(r), 'because there is genuinely nothing to bill', r.slice(0, 160));
  }

  section('A year on a plan produces no rows, however long it has been');
  /* The old loop was bounded at 36 - it would happily print three years of
     invented invoices for an account that had never paid anything. */
  {
    const n = await app.page.evaluate(() => {
      const since = new Date(Date.now() - 1000 * 86400000);
      const html = _invoiceTableHTML('ultra', { name: 'Ultra', price: 200 }, since);
      const d = document.createElement('div'); d.innerHTML = html;
      return d.querySelectorAll('.inv-row, .bill-inv-row').length;
    });
    ok(n === 0, 'zero rows', n);
  }

  section('The transaction list says where it comes from');
  {
    const r = await app.page.evaluate(() => {
      /* Through the app's own storage helper, not localStorage directly -
         keys are scoped per account, so writing the raw key stores something
         the reader never looks at and the assertion would fail for a reason
         that has nothing to do with the code under test. */
      const m = {}; m['ada@x.com'] = [{ id: 't1', ts: Date.now(), type: 'marketplace',
                                        title: 'A prompt pack', amount: 9, status: 'paid' }];
      store('amv_txns', m);
      return _billingTxnsHTML();
    });
    ok(/A prompt pack/.test(r), 'the payment it does know about is listed', r.slice(0, 200));
    ok(!/Every payment you/.test(r), 'it no longer claims to be every payment', r.slice(0, 300));
    ok(/this device|this browser/i.test(r), 'it says the record is local', r.slice(0, 300));
    ok(/another device/i.test(r), 'and that another device will not be in it', r.slice(0, 300));
  }

  section('An empty list on a connected account explains itself');
  /* This is what a person sees on their phone after paying on a laptop. It
     used to be nothing at all - the section simply was not on the page. */
  {
    const r = await app.page.evaluate(async () => {
      store('amv_txns', {});
      AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 'test-token';
      return _billingTxnsHTML();
    });
    ok(r.length > 0, 'the section appears', r.length);
    ok(/another device/i.test(r), 'saying a purchase made elsewhere will not be here', r.slice(0, 300));
    ok(/Invoices/.test(r), 'and pointing at the list that is authoritative', r.slice(0, 300));
    ok(/Purchases/.test(r), 'and at where a bought item actually lives', r.slice(0, 300));
  }

  section('With no backend, an empty list stays out of the way');
  /* Nothing has been bought and there is no processor, so a paragraph
     explaining the absence of records would be noise. */
  {
    const r = await app.page.evaluate(() => {
      store('amv_txns', {});
      AMV_API.base = ''; AMV_API.token = '';
      return _billingTxnsHTML();
    });
    ok(r === '', 'nothing is rendered', JSON.stringify(r).slice(0, 80));
  }

  ok(app.errors.length === 0, 'and no page error was thrown throughout', app.errors);
} finally {
  await app.close();
}

report();
done();
