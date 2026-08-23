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
const TABS = ['chat', 'images', 'crew', 'dev', 'market', 'plans', 'settings', 'help'];

const sample = async () => page.evaluate(async (tabs) => {
  const out = {};
  for (const t of tabs) {
    try { setTab(t); } catch (e) { continue; }
    await new Promise(s => setTimeout(s, 300));
    [...document.querySelectorAll('#vc *')].forEach(e => {
      const b = e.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return;
      if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
      out[t + '|' + (e.className || e.tagName) + '|' + (e.textContent || '').trim().slice(0, 20)]
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
  ok(moved.length > 500, 'measured as a count, not only a ratio', moved.length);

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
  const smallest = found[0] || { px: 0, tab: '?', text: '' };
  ok(smallest.px >= 20, 'no visible heading has collapsed to body size',
     smallest.px + 'px on ' + smallest.tab + ' - "' + smallest.text + '"');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
