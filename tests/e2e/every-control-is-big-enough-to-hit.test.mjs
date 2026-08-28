/* THE ROSTER WENT STALE, SO THIS MEASURES INSTEAD.

   There was already a rule for tap targets on phones, and it was a list of five
   class names given min 40x40. Every control added after it was written was
   missed, because a list does not know about the next one. Measured at 390x844
   across fifteen screens, nine to twenty controls per screen came in under
   40px - twenty-four sidebar tools at 50x34, a 24x24 overflow menu, and, worst
   of all, #snd: the send button, the most-pressed control in the product, 34px
   wide.

   The fix is still partly a roster, because CSS cannot select an element by how
   big it renders. What has changed is that the roster can no longer go stale
   QUIETLY. This renders every screen at phone size and measures what a thumb
   would actually be aiming at, so the next control that arrives too small fails
   the gate instead of shipping.

   THE NUMBER: 44px. Apple asks for 44, Android for 48dp, and WCAG 2.5.8 sets
   the floor at 24. 44 is the target rather than the floor because this is a
   product that can spend money, and the cost of a mis-tap is not a mis-tap.

   Half a pixel of slack, for the same reason armGeom has it: a flex row can
   produce 43.98 for something laid out as 44, and a check that fails on that is
   a check people learn to ignore. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MIN = 44, EPS = 0.5;
const PHONE = { width: 390, height: 844 };
const TABS = ['chat','dashboard','workspaces','memory','usage','billing','plans',
              'settings','help','apps','tasks','integrations','crew','market','team'];

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' }, viewport: PHONE });
const { page, errors } = app;

const small = [];
const overflow = [];
const escaped = [];
let counted = 0;

for (const tab of TABS) {
  await page.evaluate(t => { try { setTab(t); } catch (e) {} }, tab);
  await page.waitForTimeout(350);
  const r = await page.evaluate(({ t, min, eps }) => {
    const out = [];
    const els = document.querySelectorAll('#app button, #app a[href], #app [role="button"], #app summary');
    for (const e of els) {
      const b = e.getBoundingClientRect();
      /* Only what is actually on the screen. A control inside a closed panel
         has no size and is not something anybody is aiming at. */
      if (b.width < 1 || b.height < 1) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      if (b.width < min - eps || b.height < min - eps) {
        out.push(t + ' :: ' + (e.id ? '#' + e.id : (e.className || '').toString().slice(0, 30) || e.tagName)
                 + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
      }
    }
    /* CLIPPED, NOT JUST SCROLLED.

       The first version of this only asked whether the PAGE scrolled sideways,
       and that missed the obvious way to cheat: min-width on every button
       passed cleanly, because the containers clip rather than scroll. A control
       pushed outside its container is worse than one that causes a scrollbar -
       it is simply not there, and nothing about the page says so.

       So: does any control run past the right edge of the window, and is any
       control wider than the window. */
    const escaped = [];
    for (const e of els) {
      const b = e.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      if (b.right > window.innerWidth + 1 || b.width > window.innerWidth + 1) {
        escaped.push(t + ' :: ' + (e.id ? '#' + e.id : (e.className || '').toString().slice(0, 30) || e.tagName)
                     + ' right=' + Math.round(b.right) + ' w=' + Math.round(b.width));
      }
    }
    return { out, n: els.length, escaped,
             over: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  }, { t: tab, min: MIN, eps: EPS });
  counted += r.n;
  if (r.over) overflow.push(tab);
  small.push(...r.out);
  escaped.push(...r.escaped);
}

section('Every screen was really measured');
{
  /* A selector that matches nothing passes this whole file. Named, because a
     check that silently measures zero controls is worse than no check. */
  ok(counted > 300, 'hundreds of controls were found and sized', counted);
}

section('Nothing on a phone is too small to hit');
{
  ok(small.length === 0,
     'every control is at least ' + MIN + 'px in both directions', small.slice(0, 12));
}

section('And nothing was made wide enough to push the page sideways');
{
  /* The obvious way to fail this file is min-width on everything, which fixes
     the tap target by breaking the layout. Sideways scroll on a phone is the
     defect this product already fixed once. */
  ok(overflow.length === 0, 'no screen scrolls horizontally at 390px', overflow);
  ok(escaped.length === 0,
     'and no control is pushed off the right edge or made wider than the screen', escaped.slice(0, 8));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('every-control-is-big-enough-to-hit') > 0) process.exitCode = 1;
done();
