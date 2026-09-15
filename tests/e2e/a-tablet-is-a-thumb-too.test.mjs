/* THE FLOOR WAS KEYED TO WIDTH, AND A TABLET IS NOT NARROW.

   every-control-is-big-enough-to-hit measures at 390x844 with touch emulated,
   and it passes. A187 went further and said "the touch floor is 44 everywhere,
   not only where it was seen". Both were one dimension short of it: the rules
   that actually deliver 44 live in `@media(max-width:560px)`, so the signal
   they key on is how NARROW the screen is, not whether there is a fingertip.

   A tablet is a touch device that is not narrow. Measured before the fix, with
   touch emulated: 0 controls under 44px at 390x844, and 328 at 768x1024 - the
   send button, the sidebar tools sixty times over, every plan button, every
   marketplace tab, every control in Settings. An iPad is an ordinary way to
   use a product like this, and every target on it was under the size this
   product holds itself to everywhere else.

   This is the same file's own lesson in a second dimension: "a list does not
   know about the next one" is true of a list of VIEWPORTS as well as a list of
   class names. It is a separate file because the phone one is a careful
   artefact whose every comment is about phones; this measures the same thing
   at the width nobody was looking at.

   Portrait AND landscape, because an iPad is used both ways and the rules that
   were missing keyed on width. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MIN = 44, EPS = 0.5;
const TABS = ['chat', 'crew', 'billing', 'plans', 'market', 'tasks',
              'integrations', 'settings', 'help', 'apps', 'usage', 'handoff'];

const measure = (page, t) => page.evaluate(({ t, min, eps }) => {
  const small = [], escaped = [];
  const W = window.innerWidth;
  const els = document.querySelectorAll(
    '#app button, #app a[href], #app [role="button"], #app summary, ' +
    '#app input:not([type="hidden"]), #app select, #app textarea');
  for (const e of els) {
    const b = e.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    /* The label is the target where there is one - the same rule the phone
       file uses, so the two cannot disagree about what a control is. */
    const lab = e.closest('label');
    const lb = lab ? lab.getBoundingClientRect() : null;
    const box = (lb && lb.height >= b.height && lb.width >= b.width) ? lb : b;
    const name = e.id ? '#' + e.id : (e.className || '').toString().slice(0, 30) || e.tagName;
    if (box.width < min - eps || box.height < min - eps) {
      small.push(t + ' :: ' + name + ' ' + Math.round(box.width) + 'x' + Math.round(box.height));
    }
    if (box.right > W + 1) escaped.push(t + ' :: ' + name + ' right=' + Math.round(box.right));
  }
  return { small, escaped, sideways: document.documentElement.scrollWidth > W + 1 };
}, { t, min: MIN, eps: EPS });

for (const v of [{ n: 'portrait', width: 768, height: 1024 },
                 { n: 'landscape', width: 1024, height: 768 }]) {
  const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' },
                              viewport: { width: v.width, height: v.height }, hasTouch: true });
  const { page, errors } = app;
  const small = [], escaped = [], sideways = [];
  for (const t of TABS) {
    await page.evaluate(t => { try { setTab(t); } catch (e) {} }, t);
    await page.waitForTimeout(320);
    const r = await measure(page, t);
    small.push(...r.small);
    escaped.push(...r.escaped);
    if (r.sideways) sideways.push(t);
  }

  section('Every control is big enough to hit on a tablet in ' + v.n);
  {
    /* Proof this measured something: a screen with no controls would pass
       trivially, and that is how a check like this goes quietly dead. */
    const counted = await page.evaluate(() =>
      document.querySelectorAll('#app button, #app a[href], #app input:not([type="hidden"])').length);
    ok(counted > 10, 'there were controls on screen to measure', counted);
    ok(small.length === 0,
       'no control is under ' + MIN + 'px at ' + v.width + 'x' + v.height,
       small.slice(0, 10));
  }

  section('And the floor did not break the layout in ' + v.n);
  {
    /* The obvious way to pass the section above is min-width on everything,
       which fixes the target by pushing the page sideways. The phone file
       guards this at 390; the fix that made tablets pass added min-width to
       icon buttons and chips, so it has to be guarded here too. */
    ok(sideways.length === 0, 'no screen scrolls horizontally', sideways);
    ok(escaped.length === 0, 'and no control is pushed past the right edge', escaped.slice(0, 8));
  }

  section('No JavaScript errors in ' + v.n);
  ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

  await app.close();
}

report();
done();
