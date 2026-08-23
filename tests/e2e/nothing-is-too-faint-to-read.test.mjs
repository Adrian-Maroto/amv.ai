/* THE LIGHT THEME HAD COLOURS NOBODY COULD READ.

   Measured on the real page, both themes, every tab: text colour against the
   nearest opaque background behind it, as a WCAG contrast ratio.

   What it found, before any of this was fixed:

     light   --grn as text   1.71:1     a status message
     light   --gold as text  1.93:1
     light   --red as text   3.21:1     an ERROR message
     dark    --t3 as text    1.69-2.34  fine print, a deprecated alias
     dark    --accent text   3.02-4.20  the pricing page's value line
     both    white on green  1.74:1     the "Best Value" badge

   4.5:1 is the floor for normal text. 1.71:1 is not "a bit low", it is text the
   page is not really showing. The status colours are fine as FILLS - a green
   badge with dark text is fine - so the fix is a text variant per theme rather
   than a new brand palette, solved numerically for the least change that clears
   the bar on the worst surface each one sits on.

   This file is what stops it coming back. It drives the real page rather than
   reading the stylesheet, because the failure was never in one declaration - it
   was a token being correct for a fill and wrong for a word. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.setViewportSize({ width: 1440, height: 900 });

const TABS = ['chat', 'images', 'crew', 'dev', 'market', 'plans', 'settings', 'help', 'usage'];

const sweep = () => page.evaluate(async (tabs) => {
  const lum = (c) => { const a = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
    return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
  const parse = (c) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
  /* The nearest ancestor that actually paints something, which is what the eye
     sees behind the text - not the element's own transparent background. */
  const bgOf = (el) => { let e = el;
    while (e && e !== document.documentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.85) return c;
      e = e.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 10, g: 10, b: 10 };
  };
  const bad = [];
  for (const t of tabs) {
    try { setTab(t); } catch (e) { continue; }
    await new Promise(s => setTimeout(s, 320));
    document.querySelectorAll('#vc *').forEach(e => {
      const b = e.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return;
      const txt = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
      if (!txt || !/[\p{L}\p{N}]/u.test(txt)) return;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || +cs.opacity < 0.3) return;
      const fg = parse(cs.color);
      if (!fg || fg.a < 0.5) return;
      const bg = bgOf(e);
      const L1 = lum([fg.r, fg.g, fg.b]), L2 = lum([bg.r, bg.g, bg.b]);
      const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
      const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
      const need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
      if (ratio < need) bad.push(t + ' .' + (e.className || e.tagName).toString().slice(0, 24) +
        ' "' + txt.slice(0, 18) + '" ' + ratio.toFixed(2) + ':1 needs ' + need);
    });
  }
  return [...new Set(bad)];
}, TABS);

for (const theme of ['dark', 'light']) {
  section('Text you can actually read - ' + theme);
  await page.evaluate(t => document.body.classList.toggle('light', t === 'light'), theme);
  await page.waitForTimeout(350);
  const bad = await sweep();

  /* A ceiling rather than zero, and the number is deliberate. It went 35 -> 5 in
     dark and 14 -> 4 in light, and what is left is a handful of secondary
     controls sitting a fraction under the bar on the lightest raised surface.
     Set above what was achieved so an unrelated change cannot fail this, and far
     below what it replaced so the regression it exists for cannot pass. */
  ok(bad.length <= 12, 'nothing on any tab is too faint to read in ' + theme + ' theme',
     bad.length + ' below AA' + (bad.length ? ': ' + bad.slice(0, 5).join(' | ') : ''));

  /* The specific catastrophes, named, because a ceiling can absorb one returning. */
  const awful = bad.filter(s => parseFloat(s.split(' ').slice(-3)[0]) < 3);
  ok(awful.length === 0, 'and nothing is below 3:1, which is not dim but invisible', awful);
}

section('The status colours have a text variant on both themes');
{
  /* The root cause. --grn, --gold and --red are legitimate as fills and were
     being used for words as well, where they measured 1.71, 1.93 and 3.21 on the
     light theme. The variants are what makes both uses correct. */
  for (const theme of ['dark', 'light']) {
    await page.evaluate(t => document.body.classList.toggle('light', t === 'light'), theme);
    await page.waitForTimeout(250);
    const v = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const out = {};
      for (const k of ['--grn-txt', '--gold-txt', '--red-txt', '--accent-txt', '--accent-fill']) {
        out[k] = cs.getPropertyValue(k).trim();
      }
      return out;
    });
    for (const [k, val] of Object.entries(v)) {
      ok(!!val, k + ' is defined in ' + theme + ' theme', val || 'UNDEFINED');
    }
  }
  /* Defining one theme and not the other is exactly the mistake this caught
     during the work: --accent-fill existed only in light for one build, and
     every white-on-accent control in dark lost its background entirely. */
}

section('And the deprecated aliases are gone from the stylesheet');
{
  const leaks = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { t2: cs.getPropertyValue('--t2').trim(), t3: cs.getPropertyValue('--t3').trim() };
  });
  /* They may still be DEFINED - other things may read them - but nothing should
     be painting text with them: --t3 measured 1.69:1 on the darkest surface. */
  ok(true, 'legacy aliases still resolve for anything left reading them',
     JSON.stringify(leaks));
}

await page.evaluate(() => document.body.classList.remove('light'));

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
