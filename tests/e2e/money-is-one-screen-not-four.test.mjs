/* MONEY: SPENDING IS THE MONEY AMV MAY SPEND; UPGRADE IS THE PLANS.

   The owner, most recently: "Remove this from upgrade plan" - Upgrade opened
   the Spending page with the plans at the bottom, two screens in one. So the
   plans are Upgrade's own screen, the plan's figures are on Plan & billing,
   and Spending keeps the money AMV may spend for you. What this suite held
   before still holds where it applies: the editors are the real ones, a redraw
   stays on the tab, the figures follow the plan, the old address resolves, and
   every screen quotes a plan in the same unit.

   Originally - MONEY WAS IN FOUR PLACES AND NONE OF THEM WAS THE OBVIOUS ONE.

   What a plan costs was on Pricing. What the plan buys you was on Plan &
   usage. What AMV may spend on your behalf was a Settings pane three levels
   down. Whether an account was connected at all was a different Settings pane
   beside it. Money is the thing people most want one answer about, and AMV
   made them assemble it from four screens that did not reference each other.

   Prices moved with it rather than staying behind. A plan's price and a
   plan's limits are the same decision, and splitting them is exactly what let
   a Pricing page drift from the thing enforcing it.

   WHAT THIS HOLDS, AND WHY EACH ONE IS HERE RATHER THAN OBVIOUS:

   THE PANES ARE COMPOSED, NOT COPIED. The limits editor and the account card
   are the same functions Settings renders. If somebody later re-types either
   one to "make the tab self-contained", there are two copies of the most
   consequential controls in the product and they drift. So this asserts the
   real editor is present - by its controls, which only the real one has.

   AND EACH ONE CAN REDRAW ITSELF HERE. The spending pane called renderSetPane
   after the server's real limits come back. On this tab that would throw
   somebody into Settings, or redraw a pane that is not on screen and silently
   drop the server's numbers. It takes a redraw from its caller now, and the
   check is that a redraw leaves the tab intact rather than navigating away.

   THE NUMBERS ARE THE ONES FOR THE PLAN SOMEBODY IS ON, not for the plan the
   page would like to sell them. Changing plan has to change them.

   THE OLD ADDRESS STILL RESOLVES. #/plans was a real URL people may have
   bookmarked; it lands on Spending rather than on a 404.

   BROKEN FOUR WAYS. Re-typing the limits editor as prose fails the
   controls line. Freezing the four figures on one plan fails three lines at
   once. Dropping the #/plans case fails the address line. And putting the
   Settings-only redraw back fails the redraw line - though only after that
   line was rewritten: the first version asked whether we were still on the
   tab, which a redraw that does nothing at all passes, because doing nothing
   navigates nowhere. It asks whether the pane MOVED now. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(300);

const open = async (plan) => page.evaluate(async (p) => {
  if (p) saveStr('amv_plan', p);
  setTab('spend');
  await new Promise(r => setTimeout(r, 700));
  const t = (id) => { const e = document.getElementById(id); return (e && e.innerText) || ''; };
  return {
    tab: S.tab,
    heading: (document.querySelector('.spv-t') || {}).innerText || '',
    /* Scoped to the PLAN panel. There is a second row of facts now - balance,
       ceiling, spent - and an unscoped count silently doubled, which would have
       read as the plan figures having changed. */
    facts: [...document.querySelectorAll('.spv-now .spv-f')].map(e => e.innerText.replace(/\n/g, ' ')),
    limitsText: t('spv-limits').slice(0, 200),
    bankText: t('spv-bank').slice(0, 200),
    /* Controls only the real editor has. Prose could be re-typed; a wired
       input with this id is the pane itself. */
    hasLimitInputs: ['mf-auto', 'mf-per', 'mf-cap'].filter(i => !!document.getElementById(i)).length,
    hasGate: !!document.getElementById('mf-accept-terms'),
    planCards: document.querySelectorAll('.spv-plans .plnc').length,
    hasBand: !!document.querySelector('.ushape'),
    hasCompare: !!document.getElementById('spv-compare'),
  };
}, plan);

section('Spending is the money; the plans are on Upgrade');
{
  const s = await open('free');
  ok(s.tab === 'spend', 'the Spending tab opens', s.tab);
  ok(/Spending/.test(s.heading), 'and says what it is', s.heading);
  ok(s.planCards === 0 && !s.hasBand && !s.hasCompare, 'with no plans, no limit band and no comparison on it', s);
  const u = await page.evaluate(async () => {
    setTab('plans'); await new Promise(r => setTimeout(r, 600));
    return { cards: document.querySelectorAll('.pln-v .plnc').length, compare: !!document.getElementById('pln-compare') };
  });
  ok(u.cards === 4 && u.compare, 'while Upgrade has the four plans and the full comparison', u);
}

section('The editors are the real ones, not a second copy');
{
  const s = await open(null);
  /* An account with no accepted terms meets the gate instead of the inputs -
     which is the pane working, so either shape counts as the real pane. */
  ok(s.hasLimitInputs === 3 || s.hasGate,
     'the spending editor is the pane Settings renders, controls and all',
     { inputs: s.hasLimitInputs, gate: s.hasGate });
  ok(/spend/i.test(s.limitsText), 'and it is about spending', s.limitsText.slice(0, 60));
  ok(s.bankText.length > 40, 'the connected-account card is on it too', s.bankText.slice(0, 60));
}

section('A redraw stays on this screen instead of jumping to Settings');
{
  /* The defect the redraw argument exists for: the pane redrawing itself must
     not navigate. Driven through the pane's own path rather than by calling
     the renderer again, so it is the wiring under test. */
  const after = await page.evaluate(async () => {
    const before = (document.getElementById('spv-limits') || {}).innerText || '';
    const b = document.getElementById('mf-accept-terms');
    if (b) b.click();
    await new Promise(r => setTimeout(r, 600));
    const now = (document.getElementById('spv-limits') || {}).innerText || '';
    return { tab: S.tab, stillSpend: !!document.querySelector('.spv-t'),
             limits: !!document.getElementById('spv-limits'),
             clicked: !!b, changed: now !== before,
             gateStill: !!document.getElementById('mf-accept-terms') };
  });
  ok(after.clicked, 'the terms gate was there to accept', after);
  ok(after.tab === 'spend' && after.stillSpend && after.limits,
     'accepting it leaves you on Spending', after);
  /* AND IT ACTUALLY REDREW. Navigating away is the loud failure; the quiet one
     is that nothing happens at all - renderSetPane finds no Settings pane on
     screen, returns, and the person is left looking at the gate they just
     cleared. Putting the old call back passed a check that only asked whether
     we were still here, so the check asks whether the pane MOVED: the terms
     button is gone and the pane is showing something else.

     Deliberately not "the three limit fields are now present" - the next
     thing a fresh account meets is the age gate, so asserting the editor
     would be asserting a step that legitimately comes later. */
  ok(after.changed && !after.gateStill,
     'and the pane redrew past it, which is what the redraw was for', after);
}

section('The numbers are for the plan you are on');
{
  /* On Plan & billing now, where a plan's figures belong. */
  const bill = async (p) => page.evaluate(async (plan) => {
    saveStr('amv_plan', plan); setTab('billing'); await new Promise(r => setTimeout(r, 650));
    /* The figures block on a paid plan; on Free the plan's own list ("What
       your plan does") is where the figure is. */
    const el = document.querySelector('.bill-facts') || document.getElementById('vc');
    return ((el || {}).innerText || '').replace(/\s+/g, ' ').split(/UPGRADE YOUR PLAN/i)[0];
  }, p);
  const free = await bill('free'), ultra = await bill('ultra');
  ok(free && ultra && free !== ultra, 'they change with the plan rather than being decoration', { free: free.slice(0, 80), ultra: ultra.slice(0, 80) });
  ok(/1,000,000/.test(ultra), 'Ultra shows its real monthly figure', ultra.slice(0, 120));
  ok(/3,000/.test(free), 'and Free shows its own', free.slice(0, 120));
  await page.evaluate(() => saveStr('amv_plan', 'free'));
}

section('The address Pricing used to have still goes somewhere');
{
  const r = await page.evaluate(async () => {
    setTab('chat');
    await new Promise(res => setTimeout(res, 200));
    setTab('plans');
    await new Promise(res => setTimeout(res, 700));
    return { tab: S.tab, onPlans: !!document.querySelector('.pln-v'),
             cards: document.querySelectorAll('.pln-v .plnc').length };
  });
  ok(r.onPlans && r.cards === 4,
     'an older link to the plans lands on the plans', r);
}

section('Billing quotes the same plan in the same unit');
{
  /* THE ONE THAT WAS LEFT BEHIND. Spending was rebuilt to sell messages and
     Billing went on saying "2.3M tokens a month" - on the screen somebody
     opens when they are actually paying. Two screens disagreeing about what a
     plan gives you is the whole defect this work removed from Pricing, and it
     survived one page over.

     Compared rather than asserted against a literal: a number typed into this
     file is a fourth place for the figure to live. */
  const pair = await page.evaluate(async () => {
    const out = {};
    for (const plan of ['pro', 'elite']) {
      saveStr('amv_plan', plan);
      setTab('plans'); await new Promise(r => setTimeout(r, 650));
      /* The card for this plan on Upgrade, line by line. */
      /* In ladder order - free, pro, elite, ultra - which is how planCards draws them. */
      const card = [...document.querySelectorAll('.pln-v .plnc')][['free', 'pro', 'elite', 'ultra'].indexOf(plan)];
      const spend = card ? card.innerText.split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
      setTab('billing'); await new Promise(r => setTimeout(r, 650));
      const bill = (document.querySelector('.bill-facts') || {}).innerText || '';
      out[plan] = { spend, bill: bill.replace(/\s+/g, ' ') };
    }
    saveStr('amv_plan', 'free');
    return out;
  });

  for (const plan of ['pro', 'elite']) {
    const line = pair[plan].spend.find(f => /messages a month/i.test(f)) || '';
    const monthly = ((line.match(/([\d,]+)\s+messages a month/i) || [])[1] || '').replace(/,$/, '');
    ok(monthly.length > 0, `[${plan}] Upgrade states a monthly message figure`, pair[plan].spend);
    ok(pair[plan].bill.indexOf(monthly) >= 0,
       `[${plan}] and Billing quotes that same figure, not a different unit`,
       { monthly, billing: pair[plan].bill.slice(0, 160) });
    ok(/messages a month/i.test(pair[plan].bill),
       `[${plan}] in messages, which is what the server counts`,
       pair[plan].bill.slice(0, 160));
  }
  /* The token cap is still real and still printed - it is the secondary guard,
     so removing it would be its own kind of dishonesty. It is just no longer
     the headline. */
  ok(/token allowance/i.test(pair.pro.bill),
     'with the token cap kept beside it as the secondary guard',
     pair.pro.bill.slice(0, 200));
}

ok(errors.length === 0, 'and nothing on the screen raised an error', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
