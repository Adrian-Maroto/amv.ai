/* THREE THINGS THAT LOOKED UNFINISHED, FOUND BY WALKING EVERY SECTION.

   None of them threw, none of them failed a suite, and each one made AMV look
   like a draft on the screen it was on:

   - On a phone the closed sidebar drawer sits translated off the left edge,
     and its 40px shadow went with it. Every phone screen had a dark band down
     the left side, cast by a panel nobody could see. Measured: the page's
     background at x=195 and fifteen levels darker at x=0.
   - On Spending, "How this works" and the consent card under it touched,
     border to border, and read as one broken box.
   - On Memory, the one input on the screen had a transparent border on a
     surface one shade off the page, so it was invisible until it was focused.

   Each is asserted as the thing a person sees, not as the rule that fixed it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 390, height: 844 }, hasTouch: true,
  user: { name: 'Kim', email: 'kim@example.com', ini: 'K' } });
const { page, errors } = app;
await page.waitForTimeout(500);

/* How far into the screen the drawer's shadow reaches, from its computed
   box-shadow and where the drawer actually is. 0 means it casts nothing. */
const shadowReach = () => page.evaluate(() => {
  const sb = document.getElementById('sb');
  const cs = getComputedStyle(sb), r = sb.getBoundingClientRect();
  if (cs.boxShadow === 'none') return { reach: 0, open: !sb.classList.contains('cl') };
  const n = (cs.boxShadow.match(/-?\d+(\.\d+)?px/g) || []).map(parseFloat);
  const [x = 0, , blur = 0, spread = 0] = n;
  return { reach: Math.max(0, r.right + x + blur + spread), open: !sb.classList.contains('cl'), shadow: cs.boxShadow };
});

section('A closed drawer on a phone casts no shadow onto the page');
{
  const closed = await shadowReach();
  ok(!closed.open, 'the drawer starts closed on a phone', closed);
  ok(closed.reach === 0, 'and nothing of it darkens the left edge of the screen', closed);

  await page.evaluate(() => toggleSb());
  await page.waitForTimeout(400);
  const open = await shadowReach();
  ok(open.open && open.reach > 0,
     'while an OPEN drawer still lifts off the page it covers', open);
  await page.evaluate(() => toggleSb());
  await page.waitForTimeout(400);
  const again = await shadowReach();
  ok(!again.open && again.reach === 0, 'and closing it takes the shadow with it', again);
}

section('Spending: the explainer and the consent card are two boxes, not one');
{
  await page.evaluate(() => setTab('spend'));
  await page.waitForTimeout(500);
  const gap = await page.evaluate(() => {
    const fold = document.querySelector('.mf-what'), gate = document.querySelector('.mf-gate');
    if (!fold || !gate) return { missing: !fold ? 'fold' : 'gate' };
    return { gap: gate.getBoundingClientRect().top - fold.getBoundingClientRect().bottom };
  });
  ok(gap.gap >= 8, 'there is clear space between them', gap);
}

/* A field's outline, as drawn: its border width and how opaque its colour is. */
const outline = (sel) => page.evaluate((sel) => {
  const i = document.querySelector(sel); if (!i) return null;
  const cs = getComputedStyle(i);
  const a = (cs.borderTopColor.match(/[\d.]+/g) || []).map(Number);
  return { width: parseFloat(cs.borderTopWidth), alpha: a.length > 3 ? a[3] : 1, color: cs.borderTopColor };
}, sel);

section('Memory and Marketplace: the field you type into can be seen before you tap it');
{
  /* Both are text inputs inside a view, which a broad rule gives a
     transparent border; the connector search is the reference they match. */
  await page.evaluate(() => setTab('memory'));
  await page.waitForTimeout(400);
  const m = await outline('#mem-inp');
  ok(m && m.width >= 1 && m.alpha > 0.05, 'Memory: its border is drawn, not transparent', m);

  await page.evaluate(() => setTab('market'));
  await page.waitForTimeout(500);
  const k = await outline('#mkt-search');
  ok(k && k.width >= 1 && k.alpha > 0.05, 'Marketplace: so is the search', k);
}

section('Marketplace: its four tabs are one row on a phone');
{
  const t = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.mkt-tab')];
    return { n: tabs.length, rows: new Set(tabs.map(x => Math.round(x.getBoundingClientRect().top))).size };
  });
  ok(t.n >= 4 && t.rows === 1, '"Earnings" is not left alone on a second line', t);
}

section('Build on a phone: each mode starts clear of the nav, and reads as one screen');
{
  await page.evaluate(() => setTab('build'));
  await page.waitForTimeout(500);
  const navBottom = await page.evaluate(() => document.getElementById('anav').getBoundingClientRect().bottom);
  const seen = {};
  for (const m of ['studio', 'dev', 'lab']) {
    await page.click('[data-bmode="' + m + '"]');
    await page.waitForTimeout(500);
    seen[m] = await page.evaluate(() => {
      const eb = [...document.querySelectorAll('.build-head .eyebrow')].find(e => e.offsetParent);
      const h2 = [...document.querySelectorAll('.build-head h2')].find(e => e.offsetParent);
      return { eyebrowTop: eb ? eb.getBoundingClientRect().top : -1,
               weight: h2 ? getComputedStyle(h2).fontWeight : '' };
    });
    ok(seen[m].eyebrowTop - navBottom >= 12,
       m + ': the "BUILD" label has room above it rather than touching the nav', { navBottom, ...seen[m] });
  }
  const weights = new Set(Object.values(seen).map(s => s.weight));
  ok(weights.size === 1, 'the three headings are one weight, so switching mode does not change the font', seen);

  /* Build an app, blank: its pane's divider belongs between chat and a
     preview, and on the blank entry there is no preview under it. */
  await page.click('[data-bmode="dev"]');
  await page.waitForTimeout(400);
  const line = await page.evaluate(() => {
    const p = document.querySelector('.dev-shell.dev-blank .dev-chat-pane');
    return p ? getComputedStyle(p).borderBottomWidth : 'no pane';
  });
  ok(line === '0px', 'and no stray line floats above the tab bar', line);
}

section('Design it: the box shows its whole example, at any phone width');
{
  for (const w of [320, 390]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.click('[data-bmode="studio"]');
    await page.waitForTimeout(500);
    const d = await page.evaluate(() => {
      const t = document.getElementById('dsn-prompt'); if (!t || t.value) return null;
      const shown = t.clientHeight;
      t.value = t.placeholder; const needs = t.scrollHeight; t.value = '';
      return { shown, needs };
    });
    ok(d && d.shown >= d.needs, w + 'px: the example is not cut through its last line', d);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

section('Work on code: its two pickers look like pickers');
{
  await page.click('[data-bmode="lab"]');
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ['lab-lang', 'lab-model'].map(id => {
    const e = document.getElementById(id);
    return { id, shown: !!(e && e.offsetParent), arrow: !!e && getComputedStyle(e).backgroundImage.includes('svg') };
  }));
  ok(s.every(x => x.shown && x.arrow), 'language and engine each draw the dropdown arrow', s);
}

ok(errors.length === 0, 'and nothing threw on the way', errors);

await app.close();
if (report('nothing-unfinished-at-the-edges') > 0) process.exitCode = 1;
done();
