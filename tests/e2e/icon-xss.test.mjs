/* ICON XSS DEFENCE - the marketplace/project icon field renders UNescaped (it
   can hold one of our own file-type SVGs). _safeIcon() must let legitimate
   icons through while neutralising any smuggled markup, so a crafted listing
   can never run script in another user's browser. If this goes red, a stored
   XSS hole is back. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const { page, errors } = app;

section('_safeIcon: legitimate icons pass, every markup injection is neutralised');
const r = await page.evaluate(() => {
  const F = window._safeIcon;
  if (!F) return { missing: true };
  const realSvg = window._fileIcon('pdf', 'x.pdf');
  return {
    missing: false,
    svgPass: F(realSvg) === realSvg,
    emojiPass: F('✨') === '✨',
    img: F('<img src=x onerror=alert(1)>'),
    svgInj: F('<svg onload=alert(1)>'),
    script: F('<scr' + 'ipt>alert(1)</scr' + 'ipt>'),
    strayLt: F('A<b>c'),
    empty: F(''),
    nul: F(null)
  };
});
ok(!r.missing, '_safeIcon is exposed on window');
ok(r.svgPass, 'a legitimate file-type SVG passes through unchanged');
ok(r.emojiPass, 'a plain emoji passes through');
ok(!/onerror/i.test(r.img) && !/</.test(r.img), 'an <img onerror> payload is neutralised (no tag, no handler)', r.img);
ok(!/onload/i.test(r.svgInj) && !/<svg/i.test(r.svgInj), 'an injected <svg onload> is neutralised', r.svgInj);
ok(!/<scr/i.test(r.script), 'an injected <script> is neutralised', r.script);
ok(!/</.test(r.strayLt), 'text with a stray < is escaped, never raw markup', r.strayLt);
ok(r.empty === '✨' && r.nul === '✨', 'empty / null fall back to a safe default');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
