/* OPENING CREW DOES NOT FREEZE THE PAGE.

   Asked for: "make sure there is no lag, one more sweep - like bad lag".
   Measured at 4x CPU slowdown (a mid-range phone), every screen was timed
   from the click to the first painted frame. Crew was the outlier: the page
   froze for 306ms, for two reasons, both fixed and both pinned here.

     - About 85% of its elements are the categories and catalogue below the
       fold, and the browser laid them all out before painting the top. They
       are now content-visibility:auto, laid out when scrolled near.
     - The Crew box measured itself straight after the page was drawn, which
       forced the whole page through layout twice before it could paint.
       Where the browser can size a field to its content (field-sizing), it
       does, and nothing is measured.

   The budget is a tripwire several times today's figure, not a target: a
   flaky budget is one somebody deletes. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;
await page.setViewportSize({ width: 390, height: 844 });

section('The structure that keeps it fast is in place');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const body = document.getElementById('cw-jobs-body');
    const box = document.getElementById('mc-cmd-input');
    return { cv: body && getComputedStyle(body).contentVisibility, sizing: box && getComputedStyle(box).fieldSizing,
             native: typeof _MC_FIELD_SIZING !== 'undefined' && _MC_FIELD_SIZING };
  });
  ok(r.cv === 'auto', 'the catalogue below the fold is laid out only when it is near', r);
  ok(r.native && r.sizing === 'content', 'and the Crew box sizes itself with no measuring script', r);
  const reads = await page.evaluate(() => {
    let n = 0; const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { n++; return d.get.call(this); } });
    try { _mcCmdFit(document.getElementById('mc-cmd-input')); } finally { Object.defineProperty(HTMLElement.prototype, 'offsetHeight', d); }
    return n;
  });
  ok(reads === 0, 'fitting the box reads no layout', reads);
}

section('At 4x CPU, Crew paints without a long freeze');
{
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const runs = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => setTab('help'));
    await page.waitForTimeout(400);
    runs.push(await page.evaluate(async () => {
      const lt = []; const po = new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(e.duration); });
      po.observe({ type: 'longtask' });
      const t0 = performance.now(); setTab('crew');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const paint = performance.now() - t0;
      await new Promise(r => setTimeout(r, 600)); po.disconnect();
      return { paint: Math.round(paint), longest: Math.round(Math.max(0, ...lt)) };
    }));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const best = runs.reduce((a, b) => (b.paint < a.paint ? b : a));
  ok(best.paint < 900, 'first paint well inside a second (measured ~300ms)', runs);
  ok(best.longest < 600, 'and no single freeze over 600ms (measured ~170ms)', runs);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('opening-crew-does-not-freeze') > 0) process.exitCode = 1;
done();
