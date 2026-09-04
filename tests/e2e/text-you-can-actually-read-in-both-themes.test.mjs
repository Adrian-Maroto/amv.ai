/* THE TASKS SCREEN WAS INVISIBLE IN LIGHT MODE.

   `.tk-t{color:#e6edf3}` - a hardcoded near-white, not a token. In dark that is
   #e6edf3 on #1a1b1f and fine. Switch to light and the page becomes #fdfdfc
   while the text stays #e6edf3: a contrast of 1.16:1. Every item title on the
   Tasks screen - "Write an email", "Plan a trip", "Make flashcards" - was white
   text on a white background. Seven sibling rules had the same shape.

   Nothing caught it because nothing had ever measured a colour. The design
   standard says colour comes from tokens precisely so a theme switch works, and
   a rule that opts out of the tokens opts out of the theme with it.

   TWO THINGS THIS FILE HAD TO GET RIGHT BEFORE IT COULD BE TRUSTED, both of
   which produced confident wrong answers first:

   1. The theme is `body.light`, not a data-theme attribute. Toggling the wrong
      thing measured dark twice and reported the two themes as identical.

   2. Backgrounds are often TRANSLUCENT. Reading `backgroundColor` off the first
      ancestor that has one gives `rgba(63,118,245,.14)` and treats it as
      opaque - which reported the active sidebar item at 1.00:1, a number that
      would mean invisible text on a control that plainly works. Every layer up
      to the body has to be composited. Doing that honestly took the failure
      count from 35 to 11, and the 24 that vanished were never real.

   So this composites, and it skips what it cannot judge: emoji paint themselves
   whatever the CSS colour says, and gradient text sets a transparent fill.

   THE FLOOR WAS 3:1 AND IS NOW 4.5. It started at 3 because what shipped was
   1.16 - text nobody could see at all - and the AA-marginal badges left over
   were called "a design decision about brand colours rather than a gate
   failure", counted and pinned so they could not grow.

   That decision has been made. Sixteen of them were one of three light-theme
   token values set just light enough to fail on the chips they are used on;
   the rest reached past the tokens entirely - a bare `--accent`, which is a
   FILL colour, used as small text, and a `#d9912f` written by hand. Neither
   needed the brand to change: the `-txt` variants already existed for text on
   a tinted ground, and `--accent-fill` already existed for a surface somebody
   reads on. See LAYER A152.

   The list included "Start Pro - $15/mo" at 4.10:1, which is the button that
   takes the money, and "Manual" on Integrations at 2.19:1. So the allowance is
   zero now, in both themes, and this file is a rule rather than a ratchet. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const INVISIBLE = 3.0;      // below this, nobody can read it in any theme
const AA = 4.5;
const TABS = ['chat','build','crew','tasks','projects','memory','usage',
              'plans','settings','integrations','market','teams','activity'];

/* Zero. Measured at zero across thirteen screens in both themes after LAYER
   A152; anything above it is a regression with a name attached, not a backlog
   entry. Kept as a named constant rather than inlined so that raising it is a
   visible decision somebody has to write down. */
const MARGINAL_ALLOWED = { dark: 0, light: 0 };

const parse = c => { const p = (c || '').match(/[\d.]+/g); if (!p) return null;
  const n = p.map(Number); return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1]; };
const over = (f, b) => [f[0]*f[3]+b[0]*(1-f[3]), f[1]*f[3]+b[1]*(1-f[3]), f[2]*f[3]+b[2]*(1-f[3]), 1];
const lum = ([r,g,b]) => { const f = v => { v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4); };
  return .2126*f(r)+.7152*f(g)+.0722*f(b); };
const ratio = (a,b) => { const L1=lum(a), L2=lum(b); return (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05); };

const collect = (page, tab) => page.evaluate(t => {
  const EMOJI = /^[\s\p{Extended_Pictographic}\p{Emoji_Component}←-⇿☀-➿️]+$/u;
  const out = [];
  for (const el of document.querySelectorAll('#app *')) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if (own.length < 3 || EMOJI.test(own)) continue;
    const s = getComputedStyle(el);
    if (s.webkitTextFillColor && /rgba\(0, 0, 0, 0\)/.test(s.webkitTextFillColor)) continue;
    if (/rgba\([^)]*,\s*0\)$/.test(s.color)) continue;
    if (s.visibility === 'hidden' || +s.opacity === 0) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    const stack = []; let x = el;
    while (x) { const c = getComputedStyle(x).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)$/.test(c)) stack.push(c); x = x.parentElement; }
    stack.push(getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)');
    out.push({ tab: t, fg: s.color, stack, size: parseFloat(s.fontSize), weight: +s.fontWeight,
               cls: String(el.className || '').split(' ').slice(0,2).join('.'), text: own.slice(0,26) });
  }
  return out;
}, tab);

const measure = async (page, theme) => {
  await page.evaluate(t => document.body.classList.toggle('light', t === 'light'), theme);
  await page.waitForTimeout(400);
  const invisible = [], marginal = [];
  let counted = 0;
  for (const tab of TABS) {
    await page.evaluate(t => { try { setTab(t); } catch (e) {} }, tab);
    await page.waitForTimeout(300);
    for (const x of await collect(page, tab)) {
      let bg = parse(x.stack[x.stack.length - 1]); if (!bg) continue; bg[3] = 1;
      for (let i = x.stack.length - 2; i >= 0; i--) { const l = parse(x.stack[i]); if (l) bg = over(l, bg); }
      const fg0 = parse(x.fg); if (!fg0) continue;
      const c = ratio(fg0[3] < 1 ? over(fg0, bg) : fg0, bg);
      counted++;
      const large = x.size >= 24 || (x.size >= 18.66 && x.weight >= 700);
      const need = large ? 3 : AA;
      const label = `${x.tab}/${x.cls || '(none)'} ${c.toFixed(2)}:1 ${x.size}px "${x.text}"`;
      if (c < INVISIBLE - 0.01) invisible.push(label);
      else if (c < need - 0.01) marginal.push(label);
    }
  }
  return { invisible: [...new Set(invisible)], marginal: [...new Set(marginal)], counted };
};

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 900 },
                            user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;

const dark = await measure(page, 'dark');
const light = await measure(page, 'light');

section('The scan actually looked at something');
{
  /* The negative control. If the walk stops finding text, everything below
     passes on an empty set and the file becomes decoration. */
  ok(dark.counted > 200, 'hundreds of pieces of text were measured in dark', dark.counted);
  ok(light.counted > 200, 'and in light', light.counted);
}

section('No text is invisible against what is behind it');
{
  ok(dark.invisible.length === 0,
     'nothing in the dark theme is under ' + INVISIBLE + ':1', dark.invisible.slice(0, 8));
  ok(light.invisible.length === 0,
     'nothing in the light theme is either - which is where it was 1.16:1',
     light.invisible.slice(0, 8));
}

section('And the AA-marginal set does not grow');
{
  ok(dark.marginal.length <= MARGINAL_ALLOWED.dark,
     'dark has no more marginal contrast than it did (' + MARGINAL_ALLOWED.dark + ')',
     dark.marginal.length + ': ' + dark.marginal.slice(0, 6).join(' | '));
  ok(light.marginal.length <= MARGINAL_ALLOWED.light,
     'light has no more marginal contrast than it did (' + MARGINAL_ALLOWED.light + ')',
     light.marginal.length + ': ' + light.marginal.slice(0, 6).join(' | '));
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
if (report('text-you-can-actually-read-in-both-themes') > 0) process.exitCode = 1;
done();
await app.close();
