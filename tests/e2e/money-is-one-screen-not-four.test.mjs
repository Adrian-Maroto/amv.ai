/* MONEY WAS IN FOUR PLACES AND NONE OF THEM WAS THE OBVIOUS ONE.

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
    facts: [...document.querySelectorAll('.spv-facts .spv-f')].map(e => e.innerText.replace(/\n/g, ' ')),
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

section('One screen carries all of it');
{
  const s = await open('free');
  ok(s.tab === 'spend', 'the Spending tab opens', s.tab);
  ok(/money/i.test(s.heading), 'and says what it is about', s.heading);
  ok(s.planCards === 4, 'the plans and their prices are on it', s.planCards);
  ok(s.hasBand, 'so is how the limit behaves, before somebody meets it');
  ok(s.hasCompare, 'and the full comparison is one press away');
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
  const free = await open('free');
  const ultra = await open('ultra');
  ok(free.facts.length === 4 && ultra.facts.length === 4,
     'four figures either way', { free: free.facts.length, ultra: ultra.facts.length });
  ok(JSON.stringify(free.facts) !== JSON.stringify(ultra.facts),
     'and they change with the plan rather than being decoration',
     { free: free.facts, ultra: ultra.facts });
  ok(/1,000,000/.test(ultra.facts.join(' ')),
     'Ultra shows its real monthly figure', ultra.facts);
  ok(/3,000/.test(free.facts.join(' ')),
     'and Free shows its own', free.facts);
  await page.evaluate(() => saveStr('amv_plan', 'free'));
}

section('The address Pricing used to have still goes somewhere');
{
  const r = await page.evaluate(async () => {
    setTab('chat');
    await new Promise(res => setTimeout(res, 200));
    setTab('plans');
    await new Promise(res => setTimeout(res, 700));
    return { tab: S.tab, onSpend: !!document.querySelector('.spv-t'),
             cards: document.querySelectorAll('.spv-plans .plnc').length };
  });
  ok(r.onSpend && r.cards === 4,
     'an older link to the plans lands on Spending, with the plans on it', r);
}

ok(errors.length === 0, 'and nothing on the screen raised an error', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
