/* A CARD IN A ROW OF FOUR IS NOT ENOUGH TO DECIDE $75 A MONTH ON.

   Billing's rows already opened the plan's own page. The pricing cards did not:
   "Go Elite - $75/mo" went straight to the card form, and the only thing the
   person had read by then was a one-line anchor and seven clipped bullets - the
   first of which, on Elite and Ultra, is not a feature at all but a pointer:
   "Everything in Pro, plus:". So the most important part of what they would be
   buying was a reference to a card they had just scrolled past.

   Three routes to money existed and they disagreed: Billing went to the plan
   page, the cards went to checkout, and pro/elite with a direct payment link
   configured went somewhere else again. Now there is ONE: every button naming a
   paid plan opens that plan's page, and that page has the single control that
   starts a payment - including the direct-link case, decided at the moment it
   is needed rather than in two places that have to agree.

   And the pointer is kept. Every lower paid rung is expanded underneath from
   the same `_planPitch` the cards render from, so somebody on Free reading the
   Elite page is told what Pro gives them instead of being sent to find out. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'plans' });
const { page, errors } = app;

section('Every paid card offers the plan, not the card form');
{
  const btns = await page.evaluate(async () => {
    _setPlan('free'); setTab('plans');
    await new Promise(r => setTimeout(r, 400));
    return [...document.querySelectorAll('#vc .plnbtn')]
      .filter(b => b.dataset.darg)
      .map(b => ({ txt: b.textContent.trim(), dact: b.dataset.dact, plan: b.dataset.darg }));
  });
  const paid = btns.filter(b => ['pro', 'elite', 'ultra'].indexOf(b.plan) >= 0);
  ok(paid.length === 3, 'all three paid tiers have a button', btns);
  ok(paid.every(b => b.dact === 'openUpgrade'),
     'and every one of them opens that plan’s page', paid);
  ok(!paid.some(b => b.dact === 'openCheckout'),
     'none of them still goes straight to payment', paid);
  /* The direct-payment-link branch used to fire here and skip the argument
     entirely. It is not a special case on this screen any more. */
  const direct = await page.evaluate(async () => {
    S.sp = 'https://pay.example/pro'; S.se = 'https://pay.example/elite';
    setTab('plans'); await new Promise(r => setTimeout(r, 400));
    return [...document.querySelectorAll('#vc .plnbtn')]
      .filter(b => b.dataset.darg).map(b => b.dataset.dact);
  });
  ok(direct.every(d => d === 'openUpgrade'),
     'even when a plan has its own payment link configured', direct);
  await page.evaluate(() => { S.sp = ''; S.se = ''; });
}

section('The page it opens argues the whole case');
{
  const r = await page.evaluate(async () => {
    _setPlan('free'); setTab('plans');
    await new Promise(r => setTimeout(r, 300));
    (document.querySelector('#vc .plnbtn[data-darg="elite"]') || { click(){} }).click();
    await new Promise(r => setTimeout(r, 400));
    const vc = document.getElementById('vc');
    return {
      tab: S.tab,
      name: (vc.querySelector('.upg-t') || {}).textContent,
      onNow: (vc.querySelector('.upg-eyebrow') || {}).textContent,
      own: [...vc.querySelectorAll('.upg-feats .plnfl li')].map(e => e.textContent.trim()),
      groups: [...vc.querySelectorAll('.upg-inh-h')].map(e => e.textContent.trim()),
      inherited: [...vc.querySelectorAll('.upg-inh .plnfl li')].map(e => e.textContent.trim()),
      crosses: vc.querySelectorAll('.upg-inh .fxx').length,
      cta: (vc.querySelector('#upg-pay') || {}).textContent,
    };
  });
  ok(r.tab === 'upgrade', 'it lands on the plan’s own screen', r.tab);
  ok(/Elite/.test(r.name || ''), 'for the plan that was pressed', r.name);
  ok(/Free/.test(r.onNow || ''), 'and says what they are on now', r.onNow);
  ok(r.own.length >= 6, 'the plan’s own list is there', r.own.length);

  ok(r.groups.join(',') === 'Everything in Pro',
     'with the tier below it expanded, not just referred to', r.groups);
  ok(r.inherited.length >= 6,
     'and that expansion is the real list, not a heading over nothing', r.inherited.length);
  ok(/Mission Control/.test(r.inherited.join(' ')),
     'carrying what Pro actually gives you', r.inherited.slice(0, 3));
  /* A `[0, ...]` row is something a tier does NOT include. Printing one under a
     heading saying what comes included with Elite would be nonsense: Elite has
     agents, and the row saying Free does not is about Free. */
  ok(r.crosses === 0, 'and nothing in it is a feature the plan lacks', r.crosses);
  ok(/payment/i.test(r.cta || ''), 'one control goes on to pay', r.cta);
}

section('Ultra expands both rungs beneath it');
{
  const g = await page.evaluate(async () => {
    openUpgrade('ultra');
    await new Promise(r => setTimeout(r, 400));
    return {
      groups: [...document.querySelectorAll('.upg-inh-h')].map(e => e.textContent.trim()),
      /* The pointer row stays at the top of the plan's OWN list - it is what
         the expansion below is keeping. */
      firstOwn: (document.querySelector('.upg-feats .plnfl li') || {}).textContent,
    };
  });
  ok(g.groups.join(' | ') === 'Everything in Pro | Everything in Elite',
     'in ladder order, so the reader builds up rather than jumps', g.groups);
  ok(/Everything in Elite/.test(g.firstOwn || ''),
     'and the pointer it keeps is still the first thing said', g.firstOwn);
}

section('Pro has nothing beneath it, and does not pretend otherwise');
{
  const r = await page.evaluate(async () => {
    openUpgrade('pro');
    await new Promise(r => setTimeout(r, 400));
    return { groups: document.querySelectorAll('.upg-inh-h').length,
             block: document.querySelectorAll('.upg-inh').length };
  });
  ok(r.groups === 0 && r.block === 0,
     'no empty "everything in" section on the first paid rung', r);
}

section('Back goes back to where they actually came from');
{
  /* It always returned to Billing, which was right while Billing was the only
     door. Sending somebody who pressed Go Elite on the Plans screen to Billing
     is the same small insult as dropping them at the top of a page they were
     halfway down. */
  const fromPlans = await page.evaluate(async () => {
    setTab('plans'); await new Promise(r => setTimeout(r, 300));
    (document.querySelector('#vc .plnbtn[data-darg="pro"]') || { click(){} }).click();
    await new Promise(r => setTimeout(r, 400));
    /* Null-safe on purpose. When this breaks, it breaks by never opening the
       upgrade page at all - and a suite that throws TypeError there aborts the
       run and reports nothing about WHICH claim failed. A missing control is a
       result, so it is recorded as one. */
    const b = document.querySelector('.upg-back');
    const label = b ? b.textContent.trim() : '(no back control - upgrade page never opened)';
    if (b) b.click();
    await new Promise(r => setTimeout(r, 400));
    return { label, tab: S.tab };
  });
  ok(fromPlans.label === 'Plans', 'the control says where it goes', fromPlans.label);
  ok(fromPlans.tab === 'plans', 'and goes there', fromPlans.tab);

  const fromBilling = await page.evaluate(async () => {
    setTab('billing'); await new Promise(r => setTimeout(r, 400));
    const row = document.querySelector('#vc [data-pay]');
    if (row) row.click();
    await new Promise(r => setTimeout(r, 400));
    /* Null-safe on purpose. When this breaks, it breaks by never opening the
       upgrade page at all - and a suite that throws TypeError there aborts the
       run and reports nothing about WHICH claim failed. A missing control is a
       result, so it is recorded as one. */
    const b = document.querySelector('.upg-back');
    const label = b ? b.textContent.trim() : '(no back control - upgrade page never opened)';
    if (b) b.click();
    await new Promise(r => setTimeout(r, 400));
    return { label, tab: S.tab };
  });
  ok(fromBilling.label === 'Billing', 'and Billing still says Billing', fromBilling.label);
  ok(fromBilling.tab === 'billing', 'and still returns there', fromBilling.tab);

  /* Opening a plan from a plan page must not make Back a loop with no exit. */
  const chained = await page.evaluate(async () => {
    setTab('plans'); await new Promise(r => setTimeout(r, 300));
    openUpgrade('pro'); await new Promise(r => setTimeout(r, 300));
    openUpgrade('elite'); await new Promise(r => setTimeout(r, 300));
    const b = document.querySelector('.upg-back');
    if (b) b.click();
    await new Promise(r => setTimeout(r, 400));
    return S.tab;
  });
  ok(chained !== 'upgrade', 'a second plan opened from the first still has a way out', chained);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
