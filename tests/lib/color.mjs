/* ONE COLOUR PARSER, BECAUSE SEVEN OF THEM WERE WRONG THE SAME WAY.

   Seven suites each grew their own `c.match(/[\d.]+/g)` to read a computed
   colour, and every one of them read `color(srgb 0.95 0.96 0.99)` as the
   RGB triple (0.95, 0.96, 0.99) - which is black. Chromium returns that
   form for anything computed from `color-mix()`, and this stylesheet uses
   `color-mix()` in 95 rules.

   The consequence is not a crash and not a wrong-looking number. It is a
   FALSE PASS: text on a `color-mix()` background is measured against black,
   so light text scores 18:1 and the guard says the screen is fine. The one
   time it surfaced as a false alarm - `.rw-note` reported at 3.13:1 in a
   dialog that reads perfectly well - is the only reason anybody looked.

   Parse here, in Node, from the strings the page hands back. A suite that
   parses inside `page.evaluate` cannot import this, and that is exactly how
   seven copies happened; collect the computed strings in the browser and
   bring them out. */

/* `color(srgb r g b)` and `color(display-p3 r g b)` carry 0..1 components;
   `rgb()` / `rgba()` carry 0..255. Alpha is 0..1 in both. Returns
   [r, g, b, a] on the 0..255 scale, or null for a colour with no numbers in
   it at all (`transparent`, a keyword, an empty string). */
export const parseColor = c => {
  const s = String(c || '');
  const p = s.match(/[\d.]+/g);
  if (!p) return null;
  const n = p.map(Number);
  if (n.length < 3) return null;
  /* `color(...)` names a colour space first, so the numbers start at the
     components either way - but they are fractions, not bytes. */
  const scale = /^color\(/i.test(s.trim()) ? 255 : 1;
  return [n[0] * scale, n[1] * scale, n[2] * scale, n.length > 3 ? n[3] : 1];
};

/* Composite a translucent layer over an opaque one. */
export const over = (f, b) => [
  f[0] * f[3] + b[0] * (1 - f[3]),
  f[1] * f[3] + b[1] * (1 - f[3]),
  f[2] * f[3] + b[2] * (1 - f[3]),
  1,
];

export const luminance = ([r, g, b]) => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export const contrast = (a, b) => {
  const L1 = luminance(a), L2 = luminance(b);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
};

/* A stack of computed background strings, outermost LAST (the way a walk up
   `parentElement` collects them), flattened to one opaque colour. */
export const flatten = stack => {
  let bg = parseColor(stack[stack.length - 1]);
  if (!bg) return null;
  bg = [bg[0], bg[1], bg[2], 1];
  for (let i = stack.length - 2; i >= 0; i--) {
    const l = parseColor(stack[i]);
    if (l) bg = over(l, bg);
  }
  return bg;
};
