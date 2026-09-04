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
    /* FORM CONTROLS COUNT, AND THEY WERE NOT COUNTED.

       This selector was buttons, links, role=button and summary. A checkbox, a
       text field and a select are the HARDEST things on a phone to hit
       accurately - they are small by default and the browser gives them no
       generous padding - and none of them were ever measured. The family
       permission list is the case that matters: "Read their email", "Send email
       as them", "Make purchases on their account" are 16x16 boxes, and a
       mis-tap there grants a permission.

       WHAT A THUMB ACTUALLY HITS. A checkbox inside a <label> is not a 16px
       target: pressing anywhere in the label toggles it, so the label IS the
       control. Reporting those boxes as 16px would be false, and a check that
       reports false things is one somebody switches off - so the measurement
       walks up to the wrapping label and uses that. What is left is the honest
       number: the family rows measured 266x32, which is real, above WCAG's 24px
       floor and below the 44 this product holds everything else to. */
    const els = document.querySelectorAll(
      '#app button, #app a[href], #app [role="button"], #app summary, ' +
      '#app input:not([type="hidden"]), #app select, #app textarea');
    for (const e of els) {
      const b = e.getBoundingClientRect();
      /* Only what is actually on the screen. A control inside a closed panel
         has no size and is not something anybody is aiming at. */
      if (b.width < 1 || b.height < 1) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      /* The label is the target where there is one. Only when it is genuinely
         bigger - a label wrapped tight around its box changes nothing. */
      const lab = e.closest('label');
      const lb = lab ? lab.getBoundingClientRect() : null;
      const box = (lb && lb.height >= b.height && lb.width >= b.width) ? lb : b;
      if (box.width < min - eps || box.height < min - eps) {
        out.push(t + ' :: ' + (e.id ? '#' + e.id : (e.className || '').toString().slice(0, 30) || e.tagName)
                 + ' ' + Math.round(box.width) + 'x' + Math.round(box.height)
                 + (box === lb ? ' (its label)' : ''));
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
  /* REPORTED PER CONTROL, NOT PER SCREEN.

     This printed the first twelve entries, and the sidebar is on every screen -
     so one search box at 36px filled all twelve slots and pushed everything
     unique out of the message. The run that first caught the family permission
     rows showed nothing but `#hist-search 276x36` repeated, which reads as one
     small problem rather than two, and the second one was the one that mattered.

     So: collapse by the control itself and say how many screens it is on. A
     dozen identical lines are one finding, and the list is then short enough to
     show all of it. */
  const byControl = new Map();
  for (const entry of small) {
    const [screen, what] = entry.split(' :: ');
    if (!byControl.has(what)) byControl.set(what, []);
    byControl.get(what).push(screen);
  }
  const report = [...byControl].map(([what, screens]) =>
    what + (screens.length > 1 ? ' (on ' + screens.length + ' screens)' : ' (' + screens[0] + ')'));
  ok(small.length === 0,
     'every control is at least ' + MIN + 'px in both directions', report);
}

section('The permission checkboxes, which the tab sweep never reaches');
{
  /* THE HIGHEST-STAKES CONTROLS IN AMV, AND THE SWEEP ABOVE WALKS PAST THEM.

     _renderFamilyPane draws a fieldset of scope checkboxes - "See their
     calendar", "Read their email", "Send email as them", "Make purchases on
     their account" - and the tab sweep does not land on the sub-pane that holds
     it, so none of them were ever measured. They were 16x16 boxes inside 266x32
     labels: the label is the real target, 32px is above WCAG's 24px floor, and
     it is below the 44 everything else here is held to.

     A mis-tap on an ordinary button costs a wrong screen. A mis-tap here grants
     somebody the right to read a mailbox or spend money, so if anything in this
     product deserves the larger target it is this fieldset. Rendered directly
     rather than navigated to, because the point is to measure it at all. */
  const r = await page.evaluate((min) => {
    const host = document.getElementById('vc') || document.getElementById('app');
    const probe = document.createElement('div');
    host.appendChild(probe);
    try { _renderFamilyPane(probe); } catch (e) { return { error: String(e && e.message || e) }; }
    const rows = [...probe.querySelectorAll('.mf-scope')];
    const out = rows.map(l => {
      const b = l.getBoundingClientRect();
      const box = l.querySelector('input[type="checkbox"]');
      return { label: Math.round(b.width) + 'x' + Math.round(b.height),
               h: b.height, hasBox: !!box,
               text: (l.textContent || '').trim().slice(0, 28) };
    });
    probe.remove();
    return { rows: out, n: rows.length };
  }, MIN);

  ok(!r.error, 'the family pane renders', r.error);
  ok(r.n >= 4, 'and draws its permission rows', r.n);
  ok(r.rows.every(x => x.hasBox), 'each row is a real checkbox, not a picture of one');
  const under = r.rows.filter(x => x.h < MIN - EPS);
  ok(under.length === 0,
     'and each is at least ' + MIN + 'px tall, because the label is what a thumb hits',
     under.map(x => x.text + ' ' + x.label));
  ok(r.rows.some(x => /email|purchase|spend/i.test(x.text)),
     'the ones this is really about are among them',
     r.rows.map(x => x.text).slice(0, 4));
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
