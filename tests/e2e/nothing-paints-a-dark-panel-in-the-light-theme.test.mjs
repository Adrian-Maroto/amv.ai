/* A BLACK TILE IS NOT A CONTRAST FAILURE, AND THAT IS WHY NOTHING CAUGHT IT.

   `text-you-can-actually-read-in-both-themes` measures TEXT against what is
   behind it. `.tk-ic{background:#161b22}` - a hardcoded near-black, not a
   token - holds an emoji, and an emoji paints itself: it is perfectly legible
   on black. So every row of the Tasks screen carried a black square down a
   white page and every ratio came back fine.

   This asks the other question. Composite each element's background up the
   tree in the light theme and report anything that lands dark. It is the
   background half of the bug at the top of that file, where `.tk-t` was a
   hardcoded near-white and seven siblings had the same shape.

   THE THRESHOLD IS 0.055 RELATIVE LUMINANCE, NOT 0.15. The first run used
   0.15 and returned forty rows, every one of them the primary button, the
   avatar and the selected chip - the accent colour in the light theme is
   #3366d4, luminance 0.150, and a saturated fill under white text is the
   design working. A guard that fires on the design is a guard somebody
   deletes. 0.055 is below every accent AMV offers (the darkest, emerald, sits
   at 0.13) and above nothing but genuine near-black.

   Light only. The dark theme is allowed dark panels; that is what it is. */
import { bootApp } from '../lib/harness.mjs';
import { luminance, flatten } from '../lib/color.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const NEAR_BLACK = 0.055;

/* The same surfaces the contrast sweep walks, and for the same reason: a
   screen nobody visits is a screen that can ship a black tile. A
   `settings:<pane>` entry goes through `goSettings`. */
const TABS = ['chat','build','crew','tasks','memory','usage','billing','plans',
              'settings','settings:account','settings:privacy','settings:billing',
              'settings:spending','settings:capabilities','settings:integrations',
              'settings:teamset','settings:appearance','settings:about',
              'integrations','market','team','prompts','apps','extensions',
              'help','handoff','dashboard'];

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 900 },
                            user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;

/* `body` transitions its background over .2s, so a computed read taken right
   after the class flip returns a colour part-way between the themes. Every
   number below would be wrong by a different amount. */
await page.evaluate(() => document.body.classList.add('light'));
await page.waitForTimeout(800);

const found = new Map();
let counted = 0;
for (const tab of TABS) {
  await page.evaluate(t => { try { const i = t.indexOf(':');
    if (i > 0) goSettings(t.slice(i + 1)); else setTab(t); } catch (e) {} }, tab);
  await page.waitForTimeout(280);
  const rows = await page.evaluate(t => {
    const out = [];
    for (const el of document.querySelectorAll('#app *, #sb *')) {
      const cs = getComputedStyle(el);
      if (!cs.backgroundColor || /rgba\(0, 0, 0, 0\)$/.test(cs.backgroundColor)) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 8 || b.height < 8) continue;
      if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const stack = []; let x = el;
      while (x) { const c = getComputedStyle(x).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)$/.test(c)) stack.push(c); x = x.parentElement; }
      stack.push(getComputedStyle(document.body).backgroundColor);
      out.push({ tab: t, tag: el.tagName,
                 cls: String(el.className || '').split(' ').slice(0, 3).join('.'), stack });
    }
    return out;
  }, tab);
  for (const r of rows) {
    const bg = flatten(r.stack); if (!bg) continue;
    counted++;
    const L = luminance(bg);
    if (L < NEAR_BLACK) {
      const k = `${r.tab}/${r.tag}.${r.cls} L=${L.toFixed(3)}`;
      if (!found.has(k)) found.set(k, true);
    }
  }
}

section('The sweep actually looked at something');
{
  /* Without this the file passes on an empty set the day a selector changes. */
  ok(counted > 400, 'hundreds of painted surfaces were composited', counted);
}

section('No surface is near-black while the light theme is on');
{
  ok(found.size === 0,
     'nothing under ' + NEAR_BLACK + ' luminance - the Tasks icon tile was 0.011',
     [...found.keys()].slice(0, 10));
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
if (report('nothing-paints-a-dark-panel-in-the-light-theme') > 0) process.exitCode = 1;
done();
await app.close();
