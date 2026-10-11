/* THE UPGRADE WINDOW IS THE PLANS, NOT A DIFFERENT SHAPE OF THEM.

   Picking an engine your plan does not include opened a stack of four rows
   under an emoji padlock - a shape used nowhere else a plan is sold, and the
   owner's word for it was "looks bad". It is the same cards as the plans page
   now, showing only the plans that include the engine, the cheapest of them
   leading. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const open = (mk) => page.evaluate(async (m) => {
  saveStr('amv_plan', 'free'); S.plan = 'free';
  openUpgradeModal(m);
  await new Promise(r => setTimeout(r, 200));
  const w = document.querySelector('#ovr .upg2');
  return w ? {
    title: (w.querySelector('h2') || {}).textContent || '',
    plans: [...w.querySelectorAll('[data-upg]')].map(b => b.dataset.upg),
    lead: [...w.querySelectorAll('.upg2-card.lead [data-upg]')].map(b => b.dataset.upg),
    primary: [...w.querySelectorAll('.btn.bp[data-upg]')].map(b => b.dataset.upg),
    emoji: /\p{Extended_Pictographic}/u.test(w.textContent),
    labelled: w.getAttribute('role') === 'dialog' && !!w.getAttribute('aria-labelledby'),
  } : null;
}, mk);

section('Only the plans that include the engine, the cheapest leading');
{
  const forge = await open('coding');
  ok(forge && /AMV Forge/.test(forge.title), 'it names the engine that was picked', forge && forge.title);
  ok(forge.plans.join() === 'pro,elite,ultra,custom', 'Pro, Elite and Ultra, and a custom plan', forge.plans);
  ok(forge.lead.join() === 'pro' && forge.primary.join() === 'pro', 'Pro leads, and is the only filled button', forge);
  ok(!forge.emoji, 'no emoji padlock - the icon is drawn like every other icon', forge.emoji);
  ok(forge.labelled, 'and it is announced as a dialog with its title', forge.labelled);
  await page.click('#upg-x');
  const apex = await open('smart');
  const need = await page.evaluate(() => _minPlanForModel('smart'));
  const below = await page.evaluate((a) => a.plans.filter(k => k !== 'custom' && PLAN_RANK[k] < PLAN_RANK[_minPlanForModel('smart')]), apex);
  ok(apex.lead.join() === need && below.length === 0,
     'for the top engine, nothing below the plan that includes it is offered', { apex, need });
}

section('It closes, and every button goes where it says');
{
  await page.click('#upg-x');
  const gone = await page.evaluate(() => !document.querySelector('#ovr .upg2'));
  ok(gone, 'the X closes it');
  await open('coding');
  await page.click('#ovr [data-upg="elite"]');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ tab: S.tab, open: !!document.querySelector('#ovr .upg2') }));
  ok(r.tab === 'upgrade' && !r.open, 'Get Elite opens Elite’s own page', r);
}

section('It fits a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await open('coding');
  const r = await page.evaluate(() => {
    const w = document.querySelector('#ovr .upg2').getBoundingClientRect();
    return { left: w.left, right: w.right, vw: innerWidth };
  });
  ok(r.left >= 0 && r.right <= r.vw, 'the window stays inside the screen', r);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('the-upgrade-window-is-the-plans') > 0) process.exitCode = 1;
done();
