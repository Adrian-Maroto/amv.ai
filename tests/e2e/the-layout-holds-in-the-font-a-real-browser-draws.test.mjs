/* THE LOCAL GATE SAID SHIPPABLE FOR DAYS WHILE CI SAID NOT, AND BOTH WERE
   HONEST. THE DIFFERENCE WAS A FONT.

   `styles.css` ships a metric-matched fallback so text does not reflow when
   Inter arrives late:

     @font-face{ font-family:'Inter fallback';
                 src:local('Arial'),local('Helvetica Neue'),local('Roboto');
                 size-adjust:107%; ... }

   Every one of those is a LOCAL font. On a machine that has one - a runner,
   a laptop, essentially any real computer - the fallback resolves and text is
   drawn about 7% wider. On a machine that has none, the declaration errors,
   the stack falls through to the generic sans-serif, and text is narrower.

   So the same page has two different line-break patterns depending on the
   machine, and a layout assertion that depends on where text wraps has two
   different answers. Two real bugs were shipped behind that gap, both of them
   invisible locally:

     - the plan cards' reassurance note ran to THREE lines rather than two, so
       its 31px reservation did nothing and the four buttons drifted 15px
       apart, on the one row where somebody is deciding to pay;
     - an engine description wrapped, and the five-item picker came out 2px
       taller than the room it had, so a roomy desktop menu grew a scrollbar.

   Neither is exotic and neither was flaky. They were simply true on every
   machine except the one the gate ran on, which is the worst possible place
   for a defect to live.

   This file renders the affected screens with the fallback FORCED onto a font
   that is present in both places, carrying the exact size-adjust the product
   ships. That is not a simulation of the bug; it is the same declaration
   resolving, which is what happens in production.

   THE CONTROL MATTERS MORE THAN THE ASSERTIONS. If the forced font were
   missing too, the override would do nothing and every check below would pass
   for the wrong reason - a green that means "the sabotage did not apply",
   which is the failure mode this whole file exists to prevent. So the first
   thing measured is that the text really did get wider. */
import { chromium } from 'playwright';
import { serveApp, LAUNCH } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* The shipped declaration, pointed at a font both machines have. Liberation
   Sans is what `playwright install --with-deps chromium` brings on Ubuntu and
   what this container carries. */
const WIDER = `@font-face{font-family:'Inter fallback';src:local('Liberation Sans');
  size-adjust:107%;ascent-override:90%;descent-override:22.4%;line-gap-override:0%;}`;

const { url, server } = await serveApp({ apiBase: '' });
const browser = await chromium.launch(LAUNCH);

async function open(width, height, force) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  if (force) await page.addStyleTag({ content: WIDER });
  await page.evaluate(() => {
    localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
    S.user = { name: 'A', email: 'a@x.com', ini: 'A' };
    goApp();
  });
  return page;
}
const textWidth = page => page.evaluate(() => {
  const p = document.createElement('span');
  p.style.cssText = "position:absolute;white-space:nowrap;font:600 13.5px 'Inter fallback'";
  p.textContent = 'Full-power engines and agents, with the highest limits';
  document.body.appendChild(p);
  const w = p.getBoundingClientRect().width;
  p.remove();
  return Math.round(w);
});

section('The sabotage applies at all - without this nothing below means anything');
{
  const plain = await open(1440, 1600, false);
  const wide = await open(1440, 1600, true);
  const a = await textWidth(plain), b = await textWidth(wide);
  await plain.close(); await wide.close();
  ok(b > a, 'forcing the metric-matched fallback really does widen the text', a + ' -> ' + b);
  ok(b - a >= 5, 'by enough to change where a line breaks', (b - a) + 'px');
}

section('The plan buttons stay level when the text is wider');
{
  for (const width of [1440, 1280]) {
    const page = await open(width, 1600, true);
    await page.evaluate(() => setTab('plans'));
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.plnc .plnbtn')]
        .filter(b => b.getBoundingClientRect().top > 100)
        .map(b => Math.round(b.getBoundingClientRect().top));
      const groups = [];
      btns.sort((a, b) => a - b).forEach(y => {
        const g = groups.find(g => Math.abs(g[0] - y) < 40);
        if (g) g.push(y); else groups.push([y]);
      });
      const notes = [...document.querySelectorAll('.plnreassure')]
        .filter(n => n.getBoundingClientRect().height > 0)
        .map(n => Math.round(n.getBoundingClientRect().height));
      return { spreads: groups.map(g => Math.max(...g) - Math.min(...g)), notes };
    });
    await page.close();
    ok(r.spreads.length > 0, `there are plan buttons to check at ${width}px`, r.spreads);
    ok(r.spreads.every(s => s === 0), `and every row of them is level at ${width}px`, r.spreads);
    /* The cause, asserted directly: the buttons drift because the note under
       them is a different height, so holding the notes equal is what holds
       the row level, and it says so when it breaks. */
    ok(new Set(r.notes).size === 1,
       `the reassurance notes are all one height at ${width}px`, JSON.stringify(r.notes));
  }
}

section('The engine picker still fits on a desktop when the text is wider');
{
  const page = await open(1280, 860, true);
  await page.evaluate(() => { S.tab = 'chat'; setTab('chat'); });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll('.model-picker').forEach(m => m.remove());
    showModelPicker();
  });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const m = document.querySelector('.model-picker');
    if (!m) return { missing: true };
    const q = m.getBoundingClientRect();
    return {
      canScroll: m.scrollHeight > m.clientHeight + 1,
      h: Math.round(q.height), vh: window.innerHeight,
      onScreen: q.top >= -0.5 && q.bottom <= window.innerHeight + 0.5,
      items: m.querySelectorAll('.mp-item').length,
      /* One line each is the property that makes the total fit, so it is the
         one worth naming when it stops being true. */
      itemHeights: [...m.querySelectorAll('.mp-item')].map(i => Math.round(i.getBoundingClientRect().height)),
    };
  });
  await page.close();
  ok(!r.missing, 'the picker opened');
  ok(r.items === 5, 'with all five engines', r.items);
  ok(r.onScreen, 'entirely on the screen', r);
  ok(!r.canScroll, 'and it fits, so a five-item menu has no scrollbar', r);
  ok(new Set(r.itemHeights).size === 1,
     'because no engine description wraps at this width', JSON.stringify(r.itemHeights));
}

await browser.close();
server.close();
report();
done();
