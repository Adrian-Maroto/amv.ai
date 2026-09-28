/* A PAGE ARRIVES STILL.

   "When I fresh load it or refresh there is a lag, like the text moves - make
   sure it's still." Measured on a real reload of each section, before this
   was fixed:

     · every view slid up 8px, every heading rose 22px out of a blur for 0.7s,
       and chat's greeting and five chips came in one after another over a
       second - the page visibly settling after it had arrived;
     · a reload on Settings, Crew or any section drew the chat home screen
       first and switched a few frames later, and the switch was recorded as
       a move: a back arrow appeared (pushing the header along by its width)
       pointing at a chat screen that was never really shown;
     · the sidebar footer grew by a line when the email filled in.

   Each is measured here the way the browser reports it: animations that move
   something, layout shifts, which screen is drawn first, and the back arrow. */
import { chromium } from 'playwright';
import { serveApp, LAUNCH } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const { url, server } = await serveApp({ apiBase: '' });
const browser = await chromium.launch(LAUNCH);
const errors = [];
/* On a laptop and on a phone: the phone has its own furniture (the bottom
   bar), which was drawn empty and grew by 48px on every load. */
for (const [label, viewport, touch] of [['a laptop', { width: 1280, height: 860 }, false], ['a phone', { width: 390, height: 844 }, true]]) {
const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
await ctx.addInitScript(() => {
  window.__shifts = []; window.__moving = []; window.__firstTab = null;
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__shifts.push({ v: e.value,
      src: (e.sources || []).map(s => s.node && (s.node.id || s.node.className || s.node.nodeName)).slice(0, 3) }); })
      .observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  const seen = new Set();
  const poll = () => {
    try {
      /* The first frame after the bundle has run is the first screen anybody sees. */
      if (window.__firstTab === null && window._BUNDLE_READY && typeof S !== 'undefined') window.__firstTab = S.tab;
      for (const a of document.getAnimations()) {
        if (seen.has(a)) continue; seen.add(a);
        const t = a.effect && a.effect.target, timing = a.effect && a.effect.getTiming();
        if (!t || !timing || timing.iterations === Infinity) continue;          // loops: spinners, dots
        if (t.closest && t.closest('.ov, .toast, [role="dialog"]')) continue;   // opened by a press, not a load
        const moves = (a.effect.getKeyframes() || []).some(k => (k.transform && k.transform !== 'none') || (k.filter && k.filter !== 'none'));
        if (moves) window.__moving.push((a.animationName || 'anim') + ' on ' + (t.id ? '#' + t.id : (typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : t.nodeName)));
      }
    } catch (e) {}
    if (performance.now() < 3000) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
  try {
    localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
    localStorage.setItem('amv_user', JSON.stringify({ name: 'Kim', email: 'kim@example.com', ini: 'K' }));
    localStorage.setItem('amv_a_' + btoa('kim@example.com').replace(/=/g, ''), JSON.stringify({ email: 'kim@example.com', name: 'Kim' }));
  } catch (e) {}
});
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));

for (const [addr, want] of [['/', 'chat'], ['/#/crew', 'crew'], ['/#/settings', 'settings'], ['/#/integrations', 'integrations'], ['/#/tasks', 'tasks']]) {
  section('A fresh load of ' + want + ' on ' + label);
  await page.goto(url + addr, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);
  const r = await page.evaluate(() => ({
    tab: S.tab, first: window.__firstTab, moving: window.__moving.slice(0, 6),
    cls: window.__shifts.reduce((a, s) => a + s.v, 0), shifts: window.__shifts.slice(0, 3),
    back: !document.getElementById('nav-back').hidden, stack: (window._NAV && _NAV.stack.length) || 0,
  }));
  ok(r.tab === want, 'it opens ' + want, r.tab);
  ok(r.first === want, 'and ' + want + ' is the first screen drawn, not chat for a few frames first', r.first);
  ok(r.moving.length === 0, 'nothing slides, rises or fades in', r.moving);
  ok(r.cls < 0.001, 'nothing on the page moves after it is drawn', { cls: +r.cls.toFixed(4), shifts: r.shifts });
  ok(!r.back && r.stack === 0, 'and there is no back arrow to a screen that was never shown', r);
}
await ctx.close();
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await browser.close(); server.close();
report();
done();
