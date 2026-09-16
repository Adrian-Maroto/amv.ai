/* BILLING, IN THE ORDER SOMEBODY DECIDES IN.

   Asked for by name, three times, and the last time with a reference screen:
   what I am on, what I have been charged, what I could move to, how I pay.
   What was there put the record of somebody's money below the door marked
   Cancel, and never said what the plan they were paying for actually does.

   The two capability columns are the part that sells: a price with no
   capabilities beside it asks somebody to go and look up what they are buying.
   Both halves come out of `_planPitch`, the same source the pricing cards and
   the upgrade page render from - a hand-written list here would be a second
   description of the product and the two would drift the first time a plan
   changed.

   AND NOTHING IS INVENTED. This page once generated one row per month between
   the start date and today, each stamped Paid, with no invoice number and no
   amount from a processor - a-billing-screen-that-invented-its-own-invoices is
   that fault written down. Renaming the section to "Recent transactions" must
   not bring it back, so this asserts the empty state is still an honest
   sentence rather than a table. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({});
const { page, errors } = app;

const show = (plan) => page.evaluate(async (plan) => {
  _setPlan(plan);
  setTab('billing');
  await new Promise(r => setTimeout(r, 420));
  const vc = document.getElementById('vc');
  return {
    headings: [...vc.querySelectorAll('h2,h3')].map(e => e.textContent.trim()),
    text: (vc.innerText || ''),
    cols: [...vc.querySelectorAll('.bill-cc-h')].map(e => e.textContent.trim()),
    upgrades: [...vc.querySelectorAll('[data-pay]')].map(b => b.dataset.pay),
    lead: (vc.querySelector('.bill-plan-row.lead') || {}).dataset,
    hash: location.hash,
  };
}, plan);

section('The four sections, in the order they were asked for');
{
  const r = await show('pro');
  const want = ['Recent transactions', 'Upgrade your plan', 'Payment method'];
  const idx = want.map(h => r.headings.indexOf(h));
  ok(idx.every(i => i >= 0), 'all three sections are on the page', r.headings);
  ok(idx[0] < idx[1] && idx[1] < idx[2],
     'transactions, then upgrade, then payment method', r.headings);
  ok(r.headings[0] === 'Billing', 'under one heading', r.headings[0]);
}

section('What your plan does, and what it does not');
{
  const pro = await show('pro');
  ok(pro.cols.length === 2, 'two columns on a paid plan', pro.cols);
  ok(/What your plan does/i.test(pro.cols[0]), 'the first is what you have', pro.cols);
  ok(/What Elite adds/i.test(pro.cols[1]),
     'and the second is the next step up, named - not a blank "you cannot"', pro.cols);

  const free = await show('free');
  ok(/Not on this plan/i.test(free.cols[1] || ''),
     'Free declares its own gaps, which it already knows', free.cols);
  ok(/Autonomous agents/i.test(free.text),
     'and they are the real ones, from the same list the pricing page sells from',
     free.cols);

  /* The top of the ladder has nothing above it, and inventing a column would
     be writing copy in a renderer. */
  const ultra = await show('ultra');
  ok(ultra.cols.length === 1, 'the top plan shows only what it does', ultra.cols);
}

section('The upgrade is one recommendation, not three shouts');
{
  const r = await show('free');
  ok(r.upgrades.length >= 2, 'the ladder is offered', r.upgrades);
  ok(r.lead && r.lead.pay === 'pro',
     'and the one that leads is the NEXT step up, not the dearest', r.lead);
  ok(!/Most popular/i.test(r.text),
     'with no invented social proof', r.text.slice(0, 200));
}

section('Nothing on it is invented');
{
  const r = await show('pro');
  ok(!/\$15\.00\s*·\s*Paid/i.test(r.text), 'no fabricated paid row', r.text.slice(0, 200));
  ok(/payment processor/i.test(r.text),
     'the empty state says where invoices come from instead', r.text.slice(0, 400));
}

section('Billing has an address of its own');
{
  const r = await show('pro');
  ok(r.hash === '#/billing', 'the address bar says where you are', r.hash);
  const back = await page.evaluate(async () => {
    setTab('chat');
    await new Promise(r => setTimeout(r, 200));
    const cleared = location.hash;
    history.replaceState(null, '', location.pathname + '#/billing');
    return { cleared, readsBack: _tabFromURL() };
  });
  ok(back.cleared === '', 'and stops saying it when you leave', back);
  ok(back.readsBack === 'billing', 'a link to it resolves back to billing', back);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
