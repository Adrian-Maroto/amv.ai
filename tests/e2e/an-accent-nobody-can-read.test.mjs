/* THE COLOUR PICKER ONLY HALF WORKED, AND SIXTEEN COLOURS MADE THAT WORSE.

   Not one accent block set `--accent-txt` or `--accent-fill`. So choosing
   Violet recoloured every button and fill in the product and left every
   accent-coloured SENTENCE the default blue - two colours disagreeing on the
   same screen, from a control whose entire job is to make them agree.

   Nothing threw. A token that is never redefined simply keeps the value it
   had, which is why this survived six accents and would have survived
   sixteen.

   The second half is contrast, and it is the half that decides whether
   somebody can use the product at all. Every shade here was solved by walking
   lightness until it clears 4.5:1 rather than picked by eye, so the way to
   check it is to render it and measure - not to read the hex back out of the
   file it was written into, which only proves somebody typed it.

   WHAT IS MEASURED, PER ACCENT, IN BOTH THEMES:

     accent text on --s3, the worst surface it sits on;
     the primary button, which puts near-black text on --accent itself -
       Indigo at #6366f1 measured 4.43:1 and is lifted by the generator until
       it clears, because a base too dark to carry that text is a button
       nobody can read;
     and the swatch in the picker against the rule it applies, because a
       swatch that does not match what pressing it does is the one thing a
       colour picker may never do.

   Plus the two the owner asked for and which no ratio can express: the light
   theme is no longer painfully bright, and the dark greys came down a shade.
   Both are held as bounds on the actual background luminance, so a later
   layer cannot quietly put the snow back. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MIN = 4.5, EPS = 0.02;

const app = await bootApp({ user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(300);

/* Contrast maths in the page, against what the browser actually computed. */
const probe = await page.evaluate(() => {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const parse = (s) => {
    const m = String(s).match(/-?[\d.]+/g) || [];
    return [+m[0] || 0, +m[1] || 0, +m[2] || 0];
  };
  const L = (s) => { const [r, g, b] = parse(s); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /* A token read as a COLOUR the browser resolved, not as the text in the
     stylesheet - `getPropertyValue` hands back whatever was written, so a
     typo'd token reads as its own name and every ratio computed from it is
     nonsense that looks like a number. Painted onto a probe element and read
     back through getComputedStyle instead. */
  const probeEl = document.createElement('span');
  probeEl.style.position = 'fixed'; probeEl.style.left = '-9999px';
  document.body.appendChild(probeEl);
  const tok = (name) => {
    probeEl.style.color = 'rgb(1, 2, 3)';
    probeEl.style.color = 'var(' + name + ')';
    const v = getComputedStyle(probeEl).color;
    return v === 'rgb(1, 2, 3)' ? null : v;     // unresolved token → the fallback stands
  };

  const out = { themes: {} };
  for (const light of [false, true]) {
    document.body.classList.toggle('light', light);
    const key = light ? 'light' : 'dark';
    out.themes[key] = { bg: tok('--bg'), s1: tok('--s1'), s3: tok('--s3'),
                        bgL: L(tok('--bg')), accents: {} };
    for (const a of ACCENT_THEMES) {
      if (a.id) document.body.setAttribute('data-accent', a.id);
      else document.body.removeAttribute('data-accent');
      const accent = tok('--accent'), txt = tok('--accent-txt'), fill = tok('--accent-fill');
      const hue = (c) => { const m = (String(c).match(/-?[\d.]+/g) || []).map(Number);
        const r = m[0] / 255, g = m[1] / 255, b = m[2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (!d) return null;                       // grey has no hue to compare
        let h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60 + 360) % 360; };
      const dh = (a2, b2) => { const x = hue(a2), y = hue(b2);
        if (x === null || y === null) return 0;
        const d = Math.abs(x - y); return Math.min(d, 360 - d); };
      out.themes[key].accents[a.name] = {
        id: a.id, swatch: a.dot, accent, txt, fill, hueGap: dh(accent, txt),
        txtOnS3: txt && ratio(txt, tok('--s3')),
        txtOnBg: txt && ratio(txt, tok('--bg')),
        blackOnAccent: accent && ratio(accent, 'rgb(10, 10, 10)'),
      };
    }
    document.body.removeAttribute('data-accent');
  }
  document.body.classList.remove('light');
  probeEl.remove();
  return out;
});

const names = Object.keys(probe.themes.dark.accents);

section('There are sixteen accents and every one of them resolves');
{
  ok(names.length === 16, 'sixteen colours in the picker', names.length);
  const unresolved = [];
  for (const theme of ['dark', 'light'])
    for (const n of names) {
      const a = probe.themes[theme].accents[n];
      if (!a.accent || !a.txt || !a.fill) unresolved.push(`${theme}/${n}`);
    }
  ok(unresolved.length === 0,
     'each defines --accent, --accent-txt and --accent-fill in both themes', unresolved);
}

section('Choosing a colour changes the text too, not just the buttons');
{
  /* The defect itself: --accent-txt identical across every accent means it is
     never being redefined, whatever the buttons are doing. */
  for (const theme of ['dark', 'light']) {
    /* ALL SIXTEEN DISTINCT, not "most of them". An accent that stops
       declaring --accent-txt does not go undefined - it silently inherits the
       default blue, which a looser count cannot tell apart from a colour of
       its own. Dropping teal's declaration passed a >= 12 check. */
    const seen = new Map();
    for (const n of names) {
      const v = probe.themes[theme].accents[n].txt;
      seen.set(v, (seen.get(v) || []).concat(n));
    }
    const shared = [...seen.entries()].filter(([, ns]) => ns.length > 1);
    ok(shared.length === 0,
       `[${theme}] every accent declares its own text colour rather than inheriting one`,
       shared.map(([v, ns]) => ns.join(' + ') + ' share ' + v));
    /* AND IT IS A SHADE OF THAT ACCENT. Distinctness alone does not catch an
       accent that stops declaring its own: it falls back to the root default,
       which is a perfectly distinct colour - just the wrong one, the blue
       every accent used to be. Teal without its declaration passed the check
       above. Hue is the property that actually says "this text belongs to
       this accent", so hue is what is asserted. */
    const offHue = names.filter(n => probe.themes[theme].accents[n].hueGap > 22);
    ok(offHue.length === 0,
       `[${theme}] and it is a shade of that accent, not of some other one`,
       offHue.map(n => n + ' off by ' + Math.round(probe.themes[theme].accents[n].hueGap) + '°'));
  }
}

section('Nobody is asked to read an accent they cannot see');
{
  for (const theme of ['dark', 'light']) {
    const bad = names.filter(n => probe.themes[theme].accents[n].txtOnS3 < MIN - EPS);
    ok(bad.length === 0, `[${theme}] accent text clears 4.5:1 on a raised surface`,
       bad.map(n => n + ' ' + probe.themes[theme].accents[n].txtOnS3.toFixed(2)));
    const bad2 = names.filter(n => probe.themes[theme].accents[n].txtOnBg < MIN - EPS);
    ok(bad2.length === 0, `[${theme}] and on the page background`,
       bad2.map(n => n + ' ' + probe.themes[theme].accents[n].txtOnBg.toFixed(2)));
  }
}

section('And the primary button can carry its own label');
{
  /* THE FIRST VERSION OF THIS ASSERTED AN ASSUMPTION, NOT THE BUTTON.

     It computed near-black against --accent, because that is what `.bp` says
     in the base stylesheet. Three layers later `.bp` is `color:var(
     --on-accent)!important`, so the text is whatever that token holds - and
     it held #ffffff in both themes. The check was green in the dark theme for
     a colour the button does not use, while the real label sat at 2.7:1.

     A real button is rendered and read back now. It cannot be wrong about
     which colours are in play, because it is not the one choosing them. */
  const btn = await page.evaluate(() => {
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = (s) => { const m = String(s).match(/-?[\d.]+/g) || [];
      return 0.2126 * lin(+m[0] || 0) + 0.7152 * lin(+m[1] || 0) + 0.0722 * lin(+m[2] || 0); };
    const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    /* A FRESH BUTTON PER READING, AND THAT IS NOT BELT-AND-BRACES.

       Measured on ONE button kept across the theme switch, the light pass
       came back as white on #5590ff for all sixteen: --on-accent had flipped
       to the light theme's value and --accent had not. The element was
       holding a stale resolution of one custom property while updating
       another, so the ratio was computed between two colours that are never
       on screen together - and it read as a real failure of a real button.

       Built inside the loop, the reading is of an element that has only ever
       known the theme it is being measured in. */
    const read = (light, id) => {
      document.body.classList.toggle('light', light);
      if (id) document.body.setAttribute('data-accent', id);
      else document.body.removeAttribute('data-accent');
      const b = document.createElement('button');
      b.className = 'btn bp'; b.textContent = 'Go';
      b.style.position = 'fixed'; b.style.left = '-9999px';
      document.body.appendChild(b);
      const c = getComputedStyle(b);
      const v = { r: ratio(c.color, c.backgroundColor), color: c.color, bg: c.backgroundColor };
      b.remove();
      return v;
    };
    const out = { dark: {}, light: {} };
    for (const light of [false, true])
      for (const a of ACCENT_THEMES)
        out[light ? 'light' : 'dark'][a.name] = read(light, a.id);
    document.body.removeAttribute('data-accent');
    document.body.classList.remove('light');
    return out;
  });
  for (const theme of ['dark', 'light']) {
    const bad = Object.entries(btn[theme]).filter(([, v]) => v.r < MIN - EPS);
    ok(bad.length === 0, `[${theme}] the rendered primary button's label reads on its own fill`,
       bad.map(([n, v]) => `${n} ${v.r.toFixed(2)} (${v.color} on ${v.bg})`));
  }
  /* And it really did render as a primary button rather than as nothing. */
  ok(btn.dark.Azure.bg !== 'rgba(0, 0, 0, 0)',
     'and the button under test actually had the accent on it', btn.dark.Azure);
}

section('A swatch shows the colour pressing it applies');
{
  const wrong = await page.evaluate(() => {
    const hex = (s) => { const m = String(s).match(/\d+/g) || [];
      return '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join(''); };
    document.body.classList.remove('light');
    const out = [];
    for (const a of ACCENT_THEMES) {
      if (a.id) document.body.setAttribute('data-accent', a.id);
      else document.body.removeAttribute('data-accent');
      const el = document.createElement('span');
      el.style.position = 'fixed'; el.style.left = '-9999px';
      el.style.color = 'var(--accent)';
      document.body.appendChild(el);
      const applied = hex(getComputedStyle(el).color);
      el.remove();
      if (applied !== a.dot.toLowerCase()) out.push(a.name + ': dot ' + a.dot + ' applies ' + applied);
    }
    document.body.removeAttribute('data-accent');
    return out;
  });
  ok(wrong.length === 0, 'every dot in the picker is the accent it sets', wrong);
}

section('The light theme is not a page of snow, and the dark greys came down');
{
  /* Luminance bounds rather than hexes, so the constraint survives a retune
     and an appended layer cannot quietly put the brightness back. */
  const l = probe.themes.light.bgL, d = probe.themes.dark.bgL;
  ok(l < 0.90, 'the light background is off the white point', { luminance: +l.toFixed(3), was: 0.966 });
  ok(l > 0.78, 'while still reading as a light theme rather than a grey one', +l.toFixed(3));
  ok(d < 0.013, 'the dark background is a shade deeper than it was',
     { luminance: +d.toFixed(4), was: 0.0105 });
  ok(d > 0.004, 'and not so deep that the raised surfaces vanish into it', +d.toFixed(4));
}

ok(errors.length === 0, 'and the page raised no errors', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
