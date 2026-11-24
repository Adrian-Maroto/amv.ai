/* THE FREE PLAN SAYS SO, AND LEADS TO PLANS (owner, Nov 24: "top left ... in
   the same box as the main chat ... you're on the free plan, upgrade").
   Held: signed in on Free, the chat screen says "Free plan · Upgrade" in its
   top left and Upgrade opens the plans screen; on a paid plan, or signed out,
   it says nothing; and a plan change redraws it without a reload. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: null, viewport: { width: 1280, height: 900 } });
const { page, errors } = app;
await page.waitForTimeout(500);

const state = () => page.evaluate(() => { const e = document.getElementById('cv-plan');
  if(!e) return { exists: false };
  const r = e.getBoundingClientRect(), vc = document.getElementById('vc').getBoundingClientRect();
  return { exists: true, shown: !e.hidden && r.width > 0, text: e.textContent.replace(/\s+/g, ' ').trim(), dx: r.left - vc.left, dy: r.top - vc.top }; });

section('Signed out: nothing');
await page.evaluate(() => { setTab('chat'); });
ok(!(await state()).shown, 'no plan line before anybody signs in');

section('Signed in on Free: top left of the chat, and Upgrade opens the plans');
await page.evaluate(() => { saveStr('amv_plan', 'free'); S.user = { name: 'A', email: 'a@x.com', ini: 'A' }; updateSbUser(); setTab('chat'); });
const s1 = await state();
ok(s1.shown && /Free plan/.test(s1.text) && /Upgrade/.test(s1.text), 'it says "Free plan · Upgrade"', s1);
ok(s1.dx >= 0 && s1.dx < 40 && s1.dy >= 0 && s1.dy < 40, 'in the top left of the chat area', s1);
await page.click('#cv-plan .cv-plan-up');
await page.waitForTimeout(300);
ok(await page.evaluate(() => S.tab === 'plans'), 'Upgrade opened the plans screen', await page.evaluate(() => S.tab));

section('A paid plan: nothing to say, and it follows the change at once');
await page.evaluate(() => { setTab('chat'); _setPlan('pro'); });
ok(!(await state()).shown, 'on Pro the line is gone without a reload');
await page.evaluate(() => { _setPlan('free'); });
ok((await state()).shown, 'and back on Free it returns');

section('On a phone it does not cover the greeting');
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => { setTab('chat'); });
await page.waitForTimeout(200);
const ov = await page.evaluate(() => { const a = document.getElementById('cv-plan').getBoundingClientRect();
  const h = document.querySelector('#cm h1, #cm h2, .ch-greet'); if(!h) return { none: true };
  const b = h.getBoundingClientRect(); return { overlap: !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right), a: a.bottom, b: b.top }; });
ok(ov.none || !ov.overlap, 'the plan line and the greeting do not overlap', ov);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

report();
await app.close();
done();
