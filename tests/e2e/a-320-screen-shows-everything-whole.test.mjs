/* A 320PX SCREEN SHOWS EVERYTHING WHOLE (Nov 28, Build 19 audit B19-D-01,
   D-11, NEW-16).

   Measured at 320x640 with touch, three things were cut:
   - the header's account button ran 8-23px off the right edge on every tab,
     and the bell sat on top of New chat;
   - Crew's country button was squeezed to 59px - "Pak" for Pakistan;
   - the consent notice's "Essential only" broke over two lines.
   None of it showed as page overflow, which is what the older sweeps
   measured: each was clipped inside its own box. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 320, height: 640 }, hasTouch: true });
const { page, errors } = app;
await page.waitForFunction(() => typeof window._ccReady === 'function', null, { timeout: 15000 });

section('The header, on every main screen');
for (const tab of ['chat', 'crew', 'tasks', 'integrations', 'build', 'settings']) {
  const r = await page.evaluate(async (t) => {
    setTab(t); await new Promise(x => setTimeout(x, 700));
    const items = [...document.querySelectorAll('#anav .nav-l > *, #anav .nav-r > *')]
      .filter(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0)
      .map(e => { const b = e.getBoundingClientRect(); return { id: e.id || e.className, l: b.left, r: b.right }; });
    const off = items.filter(x => x.r > innerWidth + 0.5 || x.l < -0.5).map(x => x.id);
    const sorted = items.slice().sort((a, b) => a.l - b.l);
    const overlap = sorted.filter((x, i) => i && x.l < sorted[i - 1].r - 0.5).map(x => x.id);
    return { off, overlap, n: items.length };
  }, tab);
  ok(r.n >= 4 && !r.off.length && !r.overlap.length, tab + ': every header control is on screen and none sits on another', r);
}

section('Crew names the whole country');
{
  const r = await page.evaluate(async () => {
    _cwSetCountry('PK'); setTab('crew'); await new Promise(x => setTimeout(x, 2000));
    const c = document.querySelector('.cj-country');
    return { fits: c.scrollWidth <= c.clientWidth + 1, w: Math.round(c.getBoundingClientRect().width), text: c.textContent.trim() };
  });
  ok(/Pakistan/.test(r.text) && r.fits && r.w > 100, 'the country button shows "Pakistan" in full', r);
}

section('The consent notice: three choices, one line of answers');
{
  /* Lines counted from the text itself: two short lines still fit in a
     44px button, so its height says nothing. */
  const r = await page.evaluate(() => [...document.querySelectorAll('#cookie-consent-banner .cc-actions .btn')].map(b => {
    const rg = document.createRange(); rg.selectNodeContents(b);
    const tops = new Set([...rg.getClientRects()].filter(x => x.width > 1).map(x => Math.round(x.top)));
    return { t: b.textContent.trim(), lines: tops.size };
  }));
  ok(r.length === 2 && r.every(b => b.lines === 1), 'each answer is on one line', r);
  const all = await page.evaluate(() => [...document.querySelectorAll('#cookie-consent-banner button')].map(b => b.textContent.trim()));
  ok(all.includes('Manage') && all.includes('Essential only') && all.includes('Accept all'), 'and all three choices are still there', all);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
