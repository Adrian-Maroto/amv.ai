/* THE COMPOSER WAS 128 PIXELS TALL TO HOLD ONE LINE OF TEXT.

   It got there by stacking two sets of padding that neither rule knew about:
   the box padded its inside, and the textarea inside it padded itself again
   within that. Both numbers were reasonable alone. The total is what somebody
   looks at, and nothing was measuring the total.

   Then shrinking it introduced the opposite defect, which is the more
   interesting one. A textarea does not crop to a whole line - it shows
   whatever height is left. Four pixels short of two lines displays one line
   and the top four pixels of the next: a row of letter-tops sliced off under
   the placeholder. It appeared on a phone, where the placeholder wraps, and it
   looked like a rendering bug rather than a number being wrong.

   So this measures both ends of the same rule: the box is compact, and the
   inner height is a whole number of line boxes rather than almost one.

   WHY IT MEASURES RATHER THAN READS THE STYLESHEET. Every figure here is the
   sum of rules from several layers, one of which is only reachable behind a
   media query. Reading `padding:9px 14px 3px` out of the file proves that line
   exists; it proves nothing about what the padding IS once A6, A53 and this
   layer have all had their say. Those are two different claims and only the
   second one is the product.

   THE PHONE IS NOT A NARROW DESKTOP. A textarea is a control somebody aims at,
   so on a coarse pointer it keeps the 44px floor every other control has. The
   shrink and that floor are written as complementary media queries on purpose,
   and this is what would notice if one of them started overlapping the other.

   WHAT BREAKING IT SHOWED. Six mutations. Restoring the double padding fails
   the compact line at both widths. Deleting the phone rule, and separately
   giving it the desktop's padding, both fail the sliver line - which is the
   defect that actually shipped in the first draft. Letting the desktop
   min-height reach the phone fails the touch line.

   Two did NOT fail, and that is worth writing down rather than tidying away.
   The chips stay 44px on a phone whatever this layer does, because three
   separate rules floor them - A53's roster, a catch-all on every button under
   720px, and another under `hover:none`. So the chip line below is not what
   keeps them big; `every-control-is-big-enough-to-hit` is. It is kept because
   it is the line somebody editing THIS layer will read, and it still fails if
   all three of those floors go. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MIN_TOUCH = 44;
/* A ceiling, not a target. The box measured 97 when this was written; the
   number here is the height at which it has stopped being compact and is
   back to being the room. */
const COMPACT_MAX = 112;

async function shape(page) {
  return page.evaluate(() => {
    const px = (v) => parseFloat(v) || 0;
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect(), c = getComputedStyle(e);
      /* line-height can compute to "normal", which has no fixed ratio. Where
         it does, the font size times 1.2 is the browser's own floor and is
         close enough to catch a sliver. */
      const lh = c.lineHeight === 'normal' ? px(c.fontSize) * 1.2 : px(c.lineHeight);
      return {
        h: r.height, w: r.width, lh,
        inner: r.height - px(c.paddingTop) - px(c.paddingBottom)
                        - px(c.borderTopWidth) - px(c.borderBottomWidth),
      };
    };
    return { cib: box('#cib'), mta: box('#mta'), itb: box('#itb'),
             chip: box('.chome-chip'), snd: box('#snd') };
  });
}

/* How much of a line is showing that is not a whole line. A value near zero
   is a clean fit; a value near half a line is the sliver. */
function leftover(m) {
  const over = m.inner % m.lh;
  /* Just under a whole line counts as clean too - 25.6 of a 25.6 line is a
     line, and floating point will report it either side of the boundary. */
  return Math.min(over, Math.abs(m.lh - over));
}

/* ── A mouse, and a window with room ───────────────────────────────────── */
{
  const app = await bootApp({ user: { name: 'A', email: 'a@x.com', ini: 'A' } });
  const { page, errors } = app;
  await page.waitForTimeout(300);
  const m = await shape(page);

  section('On a desktop the composer is a composer, not the room');
  ok(!!m.cib, 'the composer is on the home screen');
  ok(m.cib && m.cib.h <= COMPACT_MAX,
     'the whole box holds one line without becoming the page',
     m.cib && Math.round(m.cib.h));
  ok(m.mta && m.mta.inner >= m.mta.lh - 0.5,
     'and a full line of text fits inside it',
     m.mta && { inner: m.mta.inner, line: m.mta.lh });
  ok(m.mta && leftover(m.mta) < 3,
     'with no sliver of a second line showing under it',
     m.mta && { leftover: leftover(m.mta), line: m.mta.lh });

  section('The starter chips read as suggestions, not as five more buttons');
  ok(m.chip && m.chip.h < 32, 'each one is smaller than the box above it',
     m.chip && Math.round(m.chip.h));
  ok(m.chip && m.chip.h >= 24, 'and still big enough to read and click',
     m.chip && Math.round(m.chip.h));

  ok(errors.length === 0, 'and the page raised no errors', errors);
  await app.close();
}

/* ── A thumb ───────────────────────────────────────────────────────────── */
{
  const app = await bootApp({ user: { name: 'A', email: 'a@x.com', ini: 'A' },
                              viewport: { width: 390, height: 844 }, hasTouch: true });
  const { page, errors } = app;
  await page.waitForTimeout(300);
  const m = await shape(page);

  section('On a phone the shrink stops at the size of a thumb');
  ok(m.mta && m.mta.h >= MIN_TOUCH - 0.5,
     'the text field keeps the floor every other control has',
     m.mta && Math.round(m.mta.h));
  ok(m.snd && m.snd.h >= MIN_TOUCH - 0.5 && m.snd.w >= MIN_TOUCH - 0.5,
     'so does send, which is the most pressed control here',
     m.snd && { w: Math.round(m.snd.w), h: Math.round(m.snd.h) });
  ok(m.chip && m.chip.h >= MIN_TOUCH - 0.5,
     'and the chips, which this shrink does not get to reach',
     m.chip && Math.round(m.chip.h));

  section('And the wrapped placeholder is not sliced through the middle');
  ok(m.mta && m.mta.inner >= m.mta.lh - 0.5,
     'a whole line of text fits',
     m.mta && { inner: m.mta.inner, line: m.mta.lh });
  ok(m.mta && leftover(m.mta) < 3,
     'and what is left over is not half of the next one',
     m.mta && { leftover: leftover(m.mta), line: m.mta.lh });

  ok(m.cib && m.cib.h <= COMPACT_MAX + 8,
     'the box is still compact at phone width',
     m.cib && Math.round(m.cib.h));
  ok(errors.length === 0, 'and the page raised no errors', errors);
  await app.close();
}

process.exit(report() === 0 ? (done(), 0) : 1);
