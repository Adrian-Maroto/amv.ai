/* CHOOSING A PLAN IS CENTRED ON THE SCREEN (Nov 27, the owner: "the billing
   page is centred, but when you click on Pro, Ultra etc. it is not").

   It was centred - in the space beside the side menu. Billing opens in the
   Settings panel, centred on the window; Plans and Upgrade sat 125px right
   of the screen's middle whenever the menu was open. They now take the whole
   window, the way a checkout does, and the menu is back the moment you leave.
   Measured against the window, not against the content area, because that is
   what a person compares it with. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

for (const [w, h] of [[1440, 900], [1280, 720], [1024, 768]]) {
  section(w + 'px: Upgrade is centred on the window');
  const app = await bootApp({ tab: 'chat', viewport: { width: w, height: h } });
  const { page, errors } = app;
  const r = await page.evaluate(async () => {
    const sbShown = () => { const sb = document.getElementById('sb'); return !!sb && getComputedStyle(sb).display !== 'none' && sb.getBoundingClientRect().width > 0; };
    const before = sbShown();
    setTab('plans'); await new Promise(x => setTimeout(x, 500));
    openUpgrade('ultra'); await new Promise(x => setTimeout(x, 700));
    const box = (document.querySelector('.upg-sum') || document.querySelector('.upg')).getBoundingClientRect();
    const mid = Math.round(box.left + box.width / 2), win = Math.round(innerWidth / 2);
    const during = sbShown();
    setTab('chat'); await new Promise(x => setTimeout(x, 400));
    return { before, during, after: sbShown(), mid, win };
  });
  ok(Math.abs(r.mid - r.win) <= 2, 'the plan’s middle is the window’s middle', r);
  ok(r.before && !r.during, 'the side menu steps aside while a plan is being chosen', r);
  ok(r.after, 'and is back the moment you leave', r);
  ok(errors.length === 0, 'no page errors', errors.slice(0, 2));
  await app.close();
}

section('A phone is unchanged: it already uses the whole width');
{
  const app = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 }, hasTouch: true });
  const r = await app.page.evaluate(async () => {
    setTab('plans'); await new Promise(x => setTimeout(x, 500)); openUpgrade('pro'); await new Promise(x => setTimeout(x, 700));
    const b = document.querySelector('.upg').getBoundingClientRect();
    return { l: Math.round(b.left), r: Math.round(innerWidth - b.right), sw: document.documentElement.scrollWidth, vw: innerWidth };
  });
  ok(Math.abs(r.l - r.r) <= 2 && r.sw <= r.vw, 'centred, nothing wider than the screen', r);
  await app.close();
}

report();
done();
