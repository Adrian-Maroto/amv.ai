/* THE SCREEN THAT ASKS FOR THE MONEY SHOWED ONE PLAN.

   It opened straight into a single plan's detail, which is right for somebody
   who has already decided and wrong for everybody else: "is the one above this
   worth it" had no answer anywhere on the page, and the only way to compare
   was to leave and come back - from the screen immediately before a payment.

   Every plan is on it now, the one somebody is already on marked, the one
   being considered selected, and pressing another redraws the detail in place
   rather than navigating. Then the detail, then one centred call to action.

   WHAT THIS HOLDS BEYOND THE LAYOUT:

   THE LADDER AND THE DETAIL AGREE. Both render from PLANS and _planPitch, so a
   plan cannot say $75 in the chooser and something else in the body. Checked
   by switching and reading both, because two numbers written side by side in
   one template prove only that they were typed together.

   THE CURRENT PLAN IS MARKED. It is the thing every other price on that row is
   being compared against, and a chooser that does not say which one you are on
   is asking somebody to remember.

   AND IT QUOTES MESSAGES. This was the last screen still describing a plan in
   tokens - the one read immediately before paying, while Spending and Billing
   had both moved. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(300);

const open = (plan, pick) => page.evaluate(async (o) => {
  saveStr('amv_plan', o.plan);
  openUpgrade(o.pick, 'spend');
  await new Promise(r => setTimeout(r, 700));
  return {
    ladder: [...document.querySelectorAll('.upg-pick')].map(b => ({
      key: b.dataset.upgPick,
      name: (b.querySelector('.upg-pick-n') || {}).textContent || '',
      price: (b.querySelector('.upg-pick-p') || {}).textContent || '',
      on: b.classList.contains('on'), now: b.classList.contains('now') })),
    title: (document.querySelector('.upg-t') || {}).textContent || '',
    bodyPrice: (document.querySelector('.upg-price') || {}).textContent || '',
    cta: (document.getElementById('upg-pay') || {}).textContent || '',
    figs: [...document.querySelectorAll('.upg-fig')].map(e => e.innerText.replace(/\n/g, ' ')),
  };
}, { plan, pick });

section('Every plan is on the screen where one is chosen');
{
  const r = await open('pro', 'elite');
  ok(r.ladder.length === 4, 'all four plans are in the chooser', r.ladder.map(x => x.key));
  ok(r.ladder.filter(x => x.on).length === 1, 'exactly one is selected',
     r.ladder.filter(x => x.on).map(x => x.key));
  ok((r.ladder.find(x => x.on) || {}).key === 'elite',
     'and it is the one that was opened', r.ladder.find(x => x.on));
  ok((r.ladder.find(x => x.now) || {}).key === 'pro',
     'the plan already held is marked as such', r.ladder.find(x => x.now));
  ok(!/Free\s*Free/i.test(r.ladder.map(x => x.name + ' ' + x.price).join(' ')),
     'and no row says its own name twice', r.ladder[0]);
}

section('The chooser and the detail cannot disagree');
{
  for (const k of ['pro', 'elite', 'ultra']) {
    const r = await open('free', k);
    const row = r.ladder.find(x => x.key === k);
    ok(r.title === row.name, `[${k}] the detail is the plan the chooser has selected`,
       { detail: r.title, chooser: row.name });
    const n = (row.price.match(/\d+/) || [])[0];
    ok(n && r.bodyPrice.indexOf(n) >= 0,
       `[${k}] and the price below is the price above`, { row: row.price, body: r.bodyPrice });
  }
}

section('Switching redraws in place rather than leaving');
{
  await open('pro', 'elite');
  const r = await page.evaluate(async () => {
    document.querySelector('[data-upg-pick="ultra"]').click();
    await new Promise(res => setTimeout(res, 600));
    return { tab: S.tab, title: (document.querySelector('.upg-t') || {}).textContent || '',
             on: [...document.querySelectorAll('.upg-pick.on')].map(b => b.dataset.upgPick),
             stillLadder: document.querySelectorAll('.upg-pick').length };
  });
  ok(r.tab === 'upgrade', 'still on the upgrade screen', r.tab);
  ok(r.title === 'Ultra' && r.on.join() === 'ultra', 'showing the plan just pressed', r);
  ok(r.stillLadder === 4, 'with the chooser still there', r.stillLadder);
}

section('One centred thing to do, in the words it was asked for');
{
  const r = await open('free', 'pro');
  ok(/proceed to checkout/i.test(r.cta), 'the call to action is Proceed to checkout', r.cta);
  const centred = await page.evaluate(() => {
    const b = document.getElementById('upg-pay');
    const wrap = b.closest('.upg-go');
    const br = b.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    /* Measured, not asserted from the stylesheet: a rule that says centre and
       a button that is not are two different claims. */
    return Math.abs((br.left - wr.left) - (wr.right - br.right));
  });
  ok(centred < 2, 'and it really is centred in its row', centred);
}

section('And the plan is quoted in messages, on the screen before the payment');
{
  const r = await open('free', 'elite');
  ok(r.figs.some(f => /messages a month/i.test(f)),
     'the headline figure is messages', r.figs);
  ok(!r.figs.some(f => /tokens/i.test(f)),
     'not tokens, which every other money screen has stopped saying', r.figs);
}

ok(errors.length === 0, 'and none of it raised an error', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
