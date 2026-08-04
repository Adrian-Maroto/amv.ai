/* FAILED PAYMENT NOTICE - a declined renewal is the one billing problem only
   the user can fix, and they were never told about it. The server now reports
   it; these assertions cover the app actually surfacing it, sending them
   somewhere a card can be changed, and correcting the plan down when the
   grace period is over. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const BROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

const sync = (plan, billing, sold) => page.evaluate(async ([p, b, s]) => {
  AMV_API.base = 'https://api.test'; AMV_API.token = 'tok';
  window.fetch = async () => ({ ok: true, status: 200, headers: new Headers(),
    json: async () => ({ ok: true, entitlement: { plan: p, sold: s || p }, billing: b }) });
  await syncEntitlement();
  const bar = document.getElementById('bill-notice');
  return { shown: !!bar, text: bar ? bar.textContent : '', lapsed: bar ? bar.classList.contains('lapsed') : false,
           plan: loadStr('amv_plan') };
}, [plan, billing, sold]);

section('A healthy account is not nagged');
const clean = await sync('pro', null);
ok(clean.shown === false, 'no notice when nothing is wrong');
ok(clean.plan === 'pro', 'and the plan syncs as usual', clean.plan);

section('Past due: the plan still works, and they are told to fix the card');
const due = await sync('ultra', {
  state: 'past_due', since: Date.now(), graceEndsAt: Date.now() + 3 * 86400000,
  message: 'Your last payment did not go through. Update your card to keep your plan - it stays active until Fri, 01 Aug 2026 00:00:00 UTC.'
});
ok(due.shown === true, 'the notice appears');
ok(/did not go through/.test(due.text), 'it says what happened', due.text.slice(0, 90));
ok(/card/i.test(due.text), 'and what to do about it');
ok(due.plan === 'ultra', 'the plan they paid for still works during the grace period', due.plan);
ok(due.lapsed === false, 'it does not read as final while there is still time');

section('It points at the only place a card can actually be changed');
/* The success branch ends in a real navigation to the processor's page, which
   cannot be exercised in-page without destroying the context, so it is checked
   by reading the wiring. The branch that CAN go wrong - no portal configured -
   is exercised for real. */
/* From app.js rather than the live function: the shipped page is minified, so
   whitespace and quote style there belong to the minifier. The behavioural
   assertions below still drive the real page. */
const billSrc = (() => {
  const src = readFileSync(join(BROOT, 'app.js'), 'utf8');
  const at = src.indexOf('function _showBillingNotice');
  return at < 0 ? '' : src.slice(at, src.indexOf('\nfunction ', at + 10));
})();
const portalWiring = {
  asksPortal: /AMV_API\.portal\(/.test(billSrc),
  navigates: /location\.href\s*=\s*url/.test(billSrc),
  fallsBack: /setTab\((['"])billing\1\)/.test(billSrc),
};
ok(portalWiring.asksPortal, 'the button asks the server for a billing portal session');
ok(portalWiring.navigates, 'and sends the user to the processor’s own page, where the card lives');
ok(portalWiring.fallsBack, 'with a fallback if no portal is configured');

const noPortal = await page.evaluate(async () => {
  const asked = [];
  window.fetch = async (u) => {
    asked.push(String(u));
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };   // no url
  };
  const before = S.tab;
  document.getElementById('bill-fix').click();
  await new Promise(r => setTimeout(r, 250));
  return { asked, before, after: S.tab };
});
ok(noPortal.asked.some(u => /stripe\/portal/.test(u)), 'it really calls the portal endpoint', noPortal.asked);
ok(noPortal.after === 'billing', 'and with no portal available it opens Billing instead of doing nothing', noPortal.after);

section('Lapsed: the plan is corrected down and the notice changes tone');
const lapsed = await sync('free', {
  state: 'lapsed', since: Date.now() - 5 * 86400000,
  message: 'Your last payment did not go through, so your plan has dropped to Free. Update your card to restore it.'
}, 'ultra');
ok(lapsed.plan === 'free', 'the client follows the server down to free - it does not keep the sold plan', lapsed.plan);
ok(lapsed.lapsed === true, 'and the notice is styled as the harder state');
ok(/dropped to Free/.test(lapsed.text), 'saying plainly what has happened', lapsed.text.slice(0, 90));

section('Dismissing it sticks for that situation, but not for the next one');
const dismiss = await page.evaluate(async () => {
  document.getElementById('bill-x').click();
  const gone = !document.getElementById('bill-notice');
  // same situation again: stays dismissed
  await syncEntitlement();
  const stillGone = !document.getElementById('bill-notice');
  return { gone, stillGone };
});
ok(dismiss.gone === true, 'the notice can be dismissed');
ok(dismiss.stillGone === true, 'and does not come straight back for the same problem');

const escalate = await sync('free', {
  state: 'lapsed', since: Date.now() - 40 * 86400000,   // a NEW failure, later date
  message: 'Your last payment did not go through, so your plan has dropped to Free. Update your card to restore it.'
});
ok(escalate.shown === true, 'but a new payment failure is surfaced again rather than staying silenced');

section('It is announced, reachable and readable on a phone');
const a11y = await page.evaluate(() => {
  const bar = document.getElementById('bill-notice');
  const fix = document.getElementById('bill-fix'), x = document.getElementById('bill-x');
  return { role: bar.getAttribute('role'), fixName: fix.textContent.trim(),
           xName: x.getAttribute('aria-label') || '', focusable: fix.tabIndex >= 0 && x.tabIndex >= 0 };
});
ok(a11y.role === 'status', 'a screen reader is told about it', a11y.role);
ok(a11y.fixName.length > 0, 'the action button has a real name', a11y.fixName);
ok(a11y.xName.length > 0, 'and the close control is labelled, not a bare glyph', a11y.xName);
ok(a11y.focusable === true, 'both are keyboard reachable');

const mobile = await page.evaluate(async () => {
  const bar = document.getElementById('bill-notice');
  const r = bar.getBoundingClientRect();
  return { fits: r.right <= window.innerWidth + 1 && r.left >= -1, bodyOverflow: document.body.scrollWidth - window.innerWidth };
});
await page.setViewportSize({ width: 390, height: 844 });
const mobile2 = await page.evaluate(async () => {
  await new Promise(r => setTimeout(r, 80));
  const bar = document.getElementById('bill-notice');
  const r = bar.getBoundingClientRect();
  return { fits: r.right <= window.innerWidth + 1 && r.left >= -1, bodyOverflow: document.body.scrollWidth - window.innerWidth };
});
ok(mobile.fits && mobile.bodyOverflow <= 1, 'it fits on desktop', mobile);
ok(mobile2.fits && mobile2.bodyOverflow <= 1, 'and on a 390px phone, without pushing the page sideways', mobile2);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
