/* A TEXT SIZE SETTING THAT MOVED TWELVE PERCENT OF THE TEXT.

   AMV offers Small / Default / Large / Largest. It works by writing
   `--fs-scale`, and the type scale is defined in terms of it:

       --fs-s: var(--fs-scale, 1);
       --t-xs: calc(11px * var(--fs-s));   ... and so on

   Which means a hardcoded `font-size:11px` does not merely skip a token - it
   ignores the reader's preference entirely. Measured across eight tabs before
   any change: 597 visible text elements, and setting Largest moved **74 of
   them. Twelve percent.** Somebody who needs bigger text chose the largest
   option and the product looked essentially the same.

   511 rules in styles.css used a size that is an EXACT step on the scale - 11,
   12, 13.5, 14 and 16px - so they could be tokenised with no visual change at
   all at the default size, while starting to obey the setting. That was done,
   and proved rather than argued: 740 text elements across fourteen tabs
   compared before and after, ZERO changed.

   This file is what stops it regressing. It does not check how many rules use a
   token - that is a proxy, and this session has been burned by proxies four
   times. It checks the thing the setting is FOR: that choosing a larger size
   makes the text larger, on a real page, and does not break the layout. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
const TABS = ['chat', 'crew', 'dev', 'market', 'plans', 'settings', 'help'];

/* TEXT, NOT GLYPHS - and the difference is the whole point.

   An icon is a character sized to fill a box the stylesheet pins exactly, and it
   deliberately does NOT follow the reading preference: growing a glyph inside a
   box that cannot grow with it is an overflow, not an accessibility win. Same
   reasoning as the AMV mark in the corner.

   So the coverage number here has to measure text. When 39 icon rules moved off
   the type scale onto --ic-*, this read 99% -> 87% and called it a regression,
   which is the instrument counting a deliberate decision as a failure. The
   filter is a property rather than a class list: an element whose visible text
   contains no letter and no digit is a glyph, not a sentence. Icons get their
   own check below, asserting the opposite. */
const isText = (s) => /[\p{L}\p{N}]/u.test(s);

const sample = async () => page.evaluate(async (tabs) => {
  const out = {};
  for (const t of tabs) {
    try { setTab(t); } catch (e) { continue; }
    await new Promise(s => setTimeout(s, 300));
    [...document.querySelectorAll('#vc *')].forEach(e => {
      const b = e.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return;
      if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
      const txt = (e.textContent || '').trim();
      if (!/[\p{L}\p{N}]/u.test(txt)) return;            // a glyph, not text
      out[t + '|' + (e.className || e.tagName) + '|' + txt.slice(0, 20)]
        = getComputedStyle(e).fontSize;
    });
  }
  return out;
}, TABS);

section('Choosing a bigger size makes the text bigger');
{
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = await sample();
  await page.evaluate(() => { _applyZoom(20 / 14); });
  await new Promise(s => setTimeout(s, 450));
  const after = await sample();

  const keys = Object.keys(before).filter(k => after[k] !== undefined);
  const moved = keys.filter(k => before[k] !== after[k]);
  const pct = Math.round(moved.length / keys.length * 100);

  ok(keys.length > 300, 'there is a real page to measure', keys.length);
  /* 99% at the time of writing: 12% -> 42% -> 99%. The only text left behind is
     the AMV mark in the top-left, which is a logo in a fixed box and SHOULD NOT
     grow with a reading preference. The floor sits below what was achieved so an
     unrelated layout change cannot fail this, and far above the 42% it replaced
     so the regression it exists for cannot pass. */
  ok(pct >= 90, 'nearly all visible text follows the setting',
     moved.length + ' of ' + keys.length + ' (' + pct + '%)');
  /* WHY THIS NUMBER MOVED. The floor is here so a page that shrank to a
     handful of elements cannot pass the percentage above on almost nothing -
     it guards the SIZE of the sample, not the product. The Settings picker
     lost five rows when thirteen panes were merged into eight, which is the
     change that took this from just over five hundred to 467, and the ratio
     it exists to protect is untouched at 99%.

     Lowered to 400 rather than to whatever today's number is: a floor set at
     the current value fails on the next honest edit, which is how a check
     becomes something people raise without reading. */
  ok(moved.length > 400, 'measured as a count, not only a ratio', moved.length);

  /* The half that took longest to see, and the first version of this check was
     too weak to catch it. Body text was tokenised before headings were, so at
     Largest the body grew while every heading stayed frozen and the hierarchy
     inverted on every screen. A percentage cannot show that - it went UP while
     the product got worse.

     Checking "the headline is still bigger than the body" does NOT catch it
     either: a frozen 38px headline is still comfortably bigger than scaled body
     text, so that assertion passes on the broken build. Proved by re-freezing
     the headline and watching it pass.

     What catches it is the thing that was actually wrong: the headline has to
     GROW. Measured on the real page at both sizes. Every heading in the product
     is sized the same way, so this one standing in for them is a sample, not a
     proxy - and it is the specific one that regressed. */
  const heads = await page.evaluate(async () => {
    const read = () => {
      const head = document.querySelector('.plans-head h2');
      const sub  = document.querySelector('.plans-head .vsub');
      return head && sub
        ? { head: parseFloat(getComputedStyle(head).fontSize),
            sub:  parseFloat(getComputedStyle(sub).fontSize) }
        : null;
    };
    setTab('plans');
    await new Promise(s => setTimeout(s, 400));
    _applyZoom(1);
    await new Promise(s => setTimeout(s, 300));
    const small = read();
    _applyZoom(20 / 14);
    await new Promise(s => setTimeout(s, 300));
    const large = read();
    return { small, large };
  });
  ok(heads.small && heads.large, 'the plans headline is on the page to measure');
  ok(heads.large.head > heads.small.head * 1.15,
     'a heading grows with the setting, it is not left behind',
     heads.small.head + 'px -> ' + heads.large.head + 'px');
  ok(heads.large.head > heads.large.sub * 1.5,
     'and it stays clearly bigger than the text beneath it',
     heads.large.head + 'px over ' + heads.large.sub + 'px');
}

section('And nothing falls off the screen at the largest size');
{
  /* The reason this was worth checking rather than assuming: the code that
     introduced font-scaling did so because the previous zoom approach overflowed
     the app by 229px at Largest. More text now scales than ever has, so the
     layout is under more pressure than it has ever been. */
  const desk = await page.evaluate(async (tabs) => {
    let worst = 0, where = '';
    for (const t of tabs) {
      try { setTab(t); } catch (e) { continue; }
      await new Promise(s => setTimeout(s, 320));
      const de = document.documentElement;
      const o = de.scrollWidth - de.clientWidth;
      if (o > worst) { worst = o; where = t; }
    }
    return { worst, where };
  }, TABS);
  ok(desk.worst <= 0, 'no tab scrolls sideways at Largest on a desktop', desk.worst + 'px ' + desk.where);

  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await page.evaluate(async (tabs) => {
    let worst = 0, where = '';
    for (const t of tabs) {
      try { setTab(t); } catch (e) { continue; }
      await new Promise(s => setTimeout(s, 350));
      const de = document.documentElement;
      const o = de.scrollWidth - de.clientWidth;
      if (o > worst) { worst = o; where = t; }
    }
    return { worst, where };
  }, TABS);
  ok(phone.worst <= 0, 'nor on a phone, which is where it would show first',
     phone.worst + 'px ' + phone.where);

  await page.evaluate(() => { _applyZoom(1); });
  await page.setViewportSize({ width: 1440, height: 900 });
}

section('And at the DEFAULT size, a heading is still a heading');
{
  /* The check that was missing, and it took sabotaging the code to find that
     out. `--fs-s` used to be defined only under `html.fs-scaled`. 157 display
     sizes are now written `calc(Npx * var(--fs-s))`, and an undefined var inside
     calc() does not fall back - it invalidates the whole declaration, which is
     dropped, and the element inherits body size instead. So removing that one
     line from :root collapsed EVERY heading in the product to 14px at the
     default size. Measured: 105 elements.

     Every other assertion in this file passed on that build, because they all
     measure whether text RESPONDS to the setting, and 14px-then-correct is a
     response. Relative checks cannot see an absolute break. This one is
     absolute: at the default size, a heading has to render at heading size. */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { _applyZoom(1); });
  await page.waitForTimeout(300);

  const found = await page.evaluate(async (tabs) => {
    const out = [];
    for (const t of tabs) {
      try { setTab(t); } catch (e) { continue; }
      await new Promise(s => setTimeout(s, 330));
      [...document.querySelectorAll('#vc h1, #vc h2')].forEach(e => {
        const b = e.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return;
        if (!(e.textContent || '').trim()) return;
        out.push({ tab: t, px: parseFloat(getComputedStyle(e).fontSize),
                   text: (e.textContent || '').trim().slice(0, 26) });
      });
    }
    return out;
  }, TABS);

  /* Every visible heading, not three selectors I happened to name - a selector
     that stops matching goes quiet, and this check exists precisely because a
     quiet check let the break through once already. */
  found.sort((a, b) => a.px - b.px);
  ok(found.length >= 6, 'there are real headings on the page to measure', found.length);

  /* AGAINST THE BODY TEXT, NOT AGAINST A MAGIC NUMBER.

     This used to demand 20px, which was the size of the smallest heading on the
     day it was written - not a property of anything. It then failed the moment
     the settings pane title became a real <h2>: that title is 16px, which is a
     perfectly good size for a nested pane header and is nowhere near collapsed.

     What "collapsed" actually means is that a heading came out the size of the
     text it heads. So it is measured against the text: body is --t-base 13.5 and
     prose is --t-prose 15, and a heading has to clear the larger of those. A
     genuine collapse lands AT body size and still fails; a deliberate 16px
     section heading passes, because it is not a collapse. */
  const bodyPx = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const read = (v) => parseFloat(cs.getPropertyValue(v)) || 0;
    return Math.max(read('--t-base'), read('--t-prose'), read('--t-md'));
  });
  ok(bodyPx > 0, 'the body text size is readable from the tokens', bodyPx + 'px');

  const smallest = found[0] || { px: 0, tab: '?', text: '' };
  ok(smallest.px > bodyPx, 'no visible heading has collapsed to body size',
     smallest.px + 'px on ' + smallest.tab + ' - "' + smallest.text +
     '" against body ' + bodyPx + 'px');
}

section('And an icon deliberately holds its size, because its box cannot grow');
{
  /* The other half of the decision above. A glyph sized to fill a pinned box
     must NOT follow the reading preference - .tk-ic is 38x38, .int-ic 48x48,
     .es-icon 52x52, and inflating the character inside them is how you get an
     overflow at the largest setting rather than a more readable product.

     Asserted on the real page and by measurement, not by reading the stylesheet:
     find glyphs, change the setting, and check that nothing inside a pinned box
     spills out of it. */
  await page.setViewportSize({ width: 1440, height: 900 });
  const read = () => page.evaluate(async (tabs) => {
    const out = {};
    for (const t of tabs) {
      try { setTab(t); } catch (e) { continue; }
      await new Promise(s => setTimeout(s, 320));
      /* Identified by where the size COMES FROM, not by what the class is
         called. A first attempt matched [class*="-ic"] and found almost
         nothing, passing this section on two samples - the same class-name
         fragility that has bitten this session before. An icon is an element
         whose font-size resolves to one of the --ic-* steps. */
      const root = getComputedStyle(document.documentElement);
      const iconSizes = ['--ic-sm', '--ic-md', '--ic-lg']
        .map(v => root.getPropertyValue(v).trim()).filter(Boolean);
      document.querySelectorAll('#vc *').forEach(e => {
        const b = e.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return;
        const cs = getComputedStyle(e);
        if (!iconSizes.includes(cs.fontSize)) return;
        out[t + '|' + (e.className || e.tagName)] = {
          size: cs.fontSize,
          spills: e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2,
        };
      });
    }
    return out;
  }, TABS);

  await page.evaluate(() => { _applyZoom(1); });
  await page.waitForTimeout(320);
  const small = await read();
  await page.evaluate(() => { _applyZoom(20 / 14); });
  await page.waitForTimeout(420);
  const large = await read();

  const keys = Object.keys(small).filter(k => large[k]);
  ok(keys.length >= 3, 'there are glyphs on the page to measure', keys.length);

  const grew = keys.filter(k => small[k].size !== large[k].size);
  ok(grew.length === 0, 'no icon grows with the reading preference',
     grew.slice(0, 4).map(k => k + ' ' + small[k].size + ' -> ' + large[k].size));

  const spilling = keys.filter(k => large[k].spills);
  ok(spilling.length === 0, 'and none of them spills out of its box at the largest size',
     spilling.slice(0, 4));

  await page.evaluate(() => { _applyZoom(1); });
}

section('Chat prose is one size, not two');
{
  /* What you typed was 15px and what came back was 15.5px. Half a pixel apart on
     the two halves of the same conversation is drift, not a decision, and it had
     a second copy of itself in the fs-scaled block to keep in step. Both are
     var(--t-prose) now, so this is what stops them parting again. */
  await page.evaluate(() => { setTab('chat'); });
  await page.waitForTimeout(300);
  const sizes = await page.evaluate(() => {
    const probe = (cls) => {
      const d = document.createElement('div');
      d.className = cls; d.textContent = 'x';
      (document.getElementById('vc') || document.body).appendChild(d);
      const px = getComputedStyle(d).fontSize;
      d.remove();
      return px;
    };
    return { user: probe('mb u'), amv: probe('mb ai') };
  });
  ok(sizes.user === sizes.amv,
     'what you typed and what AMV replies are the same size',
     sizes.user + ' vs ' + sizes.amv);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
