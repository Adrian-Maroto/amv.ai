/* A COLOUR THAT WORKS IN THE DARK AND VANISHES IN THE LIGHT.

   The changelist card's `+7` was `var(--grn)`, which is #4ade80. Against the
   dark surface it is a clean green. Against the light theme's near-white
   background it measures about 1.8:1 - not "a bit low", but effectively
   invisible, and the number it renders is the one somebody uses to decide
   whether to read a diff.

   This codebase already draws the distinction and writes it down in
   `:root`: `--grn`, `--gold` and `--red` are FILLS, and `--grn-txt`,
   `--gold-txt` and `--red-txt` are the text variants, defined separately per
   theme for exactly this reason. Every new component used the fill.

   Nothing caught it because every screenshot taken of this work was dark.
   So this measures, in both themes, on the components that were wrong and
   the ones beside them - compositing translucent fills over what is behind
   them, because a colour-mix background is not the colour the eye sees. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* Every new surface, in one place, so a component added later is added here
   rather than quietly skipped. */
const SELECTORS = [
  '.dvc-n', '.dvc-path', '.dvc-kind', '.dvc-note',
  '.dvc-head .dvc-add', '.dvc-head .dvc-del',
  '.dvc-row .dvc-add', '.dvc-row .dvc-del',
  '.dvc-undo', '.dvc-apply', '.dvc-reject', '.dvc-peek',
  '.dvv-h', '.dvv-i', '.dvv-rem',
  '.dvi-sel', '.dvi-busy', '#dev-msg',
  '.dvc-ext',
];

const measure = (light) => page.evaluate(async ([sels, useLight]) => {
  /* body.light is how AMV switches it - not an attribute on the root, which
     is what the first version of this probe set and got a dark page back. */
  document.body.classList.toggle('light', useLight);
  setTab('dev');
  await new Promise(s => setTimeout(s, 500));
  _DEV.project = {}; _DEV.log = [];
  _devSetFile('index.html', '<h1>a</h1>', 'html');
  const before = _devSnapshot();
  _devSetFile('index.html', '<h1>b</h1>\n<p>c</p>', 'html');
  _devSetFile('app.js', 'x\ny', 'js');
  const after = _devSnapshot();
  _DEV.log.push({ role: 'ai', text: 'Built it.', changes: _devChangeSet(before, after),
                  chgId: _devRecordTurn(before, after),
                  verify: _devVerify(Object.keys(after), { previewed: true }) });
  const w = [{ path: 'index.html', body: '<h1>z</h1>' }];
  const prop = Object.assign({}, after); prop['index.html'] = '<h1>z</h1>';
  _DEV.log.push({ role: 'ai', text: 'A proposal.', changes: _devChangeSet(after, prop),
                  chgId: _devStageTurn(after, prop, w) });
  _devRenderLog();
  await new Promise(s => setTimeout(s, 400));
  /* The busy indicator only exists while it is working, and it is exactly the
     sort of thing that gets a colour nobody ever looks at. */
  _devBusy(true, 'Building');
  const peek = document.querySelector('.dvc-row[data-dvc-peek]');
  if (peek) peek.click();
  await new Promise(s => setTimeout(s, 250));

  const rgb = (s) => { const m = s.match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const over = (fg, bg) => { const a = fg[3] === undefined ? 1 : fg[3];
    return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)); };
  /* Composited up the tree: a translucent fill is not the colour the eye
     sees, and every new card uses colour-mix over transparent. */
  const bgOf = (el) => { let cur = el; const chain = [];
    while (cur && cur !== document.documentElement) {
      const c = rgb(getComputedStyle(cur).backgroundColor);
      if (c && (c[3] === undefined || c[3] > 0)) chain.push(c);
      cur = cur.parentElement;
    }
    chain.push(rgb(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255]);
    let acc = chain[chain.length - 1];
    for (let i = chain.length - 2; i >= 0; i--) acc = over(chain[i], acc);
    return acc; };
  const lum = (c) => { const f = c.map(v => { v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  const out = [];
  for (const sel of sels) {
    const el = document.querySelector('#vc ' + sel) || document.querySelector(sel);
    if (!el) { out.push({ sel, missing: true }); continue; }
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') { out.push({ sel, missing: true }); continue; }
    out.push({ sel, ratio: Math.round(ratio(rgb(cs.color), bgOf(el)) * 100) / 100 });
  }
  _devBusy(false);
  return out;
}, [SELECTORS, light]);

for (const [name, light] of [['dark', false], ['light', true]]) {
  section('Everything new on the Build surface is readable in the ' + name + ' theme');
  const rows = await measure(light);
  const found = rows.filter(r => !r.missing);
  /* Without this the whole file passes for a page that rendered nothing. */
  ok(found.length >= 14,
     'the components were actually found and measured, not silently skipped',
     found.length + ' of ' + SELECTORS.length);
  const bad = found.filter(r => r.ratio < 4.5);
  ok(bad.length === 0,
     'every one of them clears 4.5:1 against what is actually behind it',
     bad.map(b => b.sel + ' ' + b.ratio));
}

section('The text tokens are used for text, which is the rule that was broken');
{
  /* The measurement above is the property; this is the cause, and it is
     worth naming so the next component does not have to rediscover it. The
     fill tokens are fine as fills - a background, a border - and are the
     wrong thing for a colour somebody has to read. */
  const usesFillAsText = await page.evaluate(() => {
    const bad = [];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (!r.selectorText || !r.style) continue;
        if (!/dvc|dvv|dvi-|ghp-|ghr|ghd|prev-degraded/.test(r.selectorText)) continue;
        const c = r.style.getPropertyValue('color');
        if (/var\(--(grn|red|gold)\)/.test(c)) bad.push(r.selectorText + ' { color:' + c + ' }');
      }
    }
    return bad;
  });
  ok(usesFillAsText.length === 0,
     'no new rule paints text with a fill token instead of its text variant',
     usesFillAsText.slice(0, 4));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('the-new-build-surface-reads-in-both-themes') > 0) process.exitCode = 1;
done();
