/* THE ROW OF TOOLS AT THE BOTTOM OF THE SIDEBAR.

   Three things are being held here and only the first is cosmetic.

   ONE - the order. The rail is the shortest description of what this product
   is, read left to right by somebody deciding whether to pay for it, so its
   order is a decision and not an accident of what got added when.

   TWO - it does not overflow. It was a flex row of `flex:1` buttons, which
   works while the count is fixed. The count is not fixed: Team appears with a
   plan, Admin is appended at runtime, and Pricing was added. At seven each one
   was 28px wide on a desktop, and on a phone - where a floor holds every
   control at 44px and flex can no longer shrink them - two were pushed clean
   OUTSIDE the rail. Not clipped, not scrolled: laid out past its right edge.

   THREE - and this is the one that had actually shipped - `hidden` hid
   nothing. `_revealTeamNav` sets `btn.hidden = !allowed` and always has. But
   `[hidden]{display:none}` is a user-agent rule and `.sb-tool{display:flex}`
   is an author rule at the same specificity, so the author rule won and the
   Team tool sat in the rail of every free account. Both halves looked right,
   which is why reading either one would never have found it. Only the
   rendered width says so, so that is what this reads.

   EVERY TOOL IS ALSO CLICKED. A rail entry that routes nowhere is worse than
   no entry: it is a promise on the one screen that lists what there is.

   BROKEN THREE WAYS TO SEE WHETHER IT NOTICES. Letting `hidden` go back to
   doing nothing fails the width line, not the attribute line - which is the
   split this file was written around. Putting the flex row back fails the
   overflow line on the phone. Taking Pricing out of the rail fails the order
   line. Each caught by the assertion that names it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, eq, section, report, done } from '../lib/assert.mjs';

const ORDER = ['tasks', 'abilities', 'plans', 'memory', 'team', 'integrations', 'market'];
const MIN_TOUCH = 44;

function railShape() {
  const rail = document.getElementById('sb-tools');
  if (!rail) return null;
  const rr = rail.getBoundingClientRect();
  return {
    order: [...rail.querySelectorAll('.sb-tool[data-tab]')].map(e => e.dataset.tab),
    tools: [...rail.querySelectorAll('.sb-tool[data-tab]')].map(e => {
      const r = e.getBoundingClientRect();
      return { tab: e.dataset.tab, w: r.width, h: r.height,
               shown: r.width > 0 && r.height > 0,
               pastRight: r.right - rr.right, pastLeft: rr.left - r.left };
    }),
  };
}

/* ── Desktop: order, routing, and who is allowed to be there ───────────── */
{
  const app = await bootApp({ user: { name: 'A', email: 'a@x.com', ini: 'A' } });
  const { page, errors } = app;
  await page.waitForTimeout(400);

  section('The rail says what AMV is, in the order it should be read');
  const s = await page.evaluate(railShape);
  ok(!!s, 'the rail is on the screen');
  eq(s && s.order, ORDER, 'and the tools are in the intended order');

  section('Team is a plan, so a free account does not see it offered');
  const free = await page.evaluate(() => {
    saveStr('amv_plan', 'free');
    _revealTeamNav();
    const e = document.querySelector('.sb-tool[data-tab="team"]');
    const r = e.getBoundingClientRect();
    return { attr: e.hidden, w: r.width, h: r.height };
  });
  ok(free.attr === true, 'the attribute is set', free);
  ok(free.w === 0 && free.h === 0,
     'and it is the width of nothing, which is the part that was not true',
     free);

  const paid = await page.evaluate(() => {
    saveStr('amv_plan', 'elite');
    _revealTeamNav();
    const e = document.querySelector('.sb-tool[data-tab="team"]');
    const r = e.getBoundingClientRect();
    return { attr: e.hidden, w: r.width, h: r.height };
  });
  ok(paid.attr === false && paid.w > 0, 'and a plan that has teams gets it back', paid);
  await page.evaluate(() => { saveStr('amv_plan', 'free'); _revealTeamNav(); });

  section('Every tool in it goes somewhere real');
  for (const tab of ORDER.filter(t => t !== 'team')) {
    const r = await page.evaluate(async (t) => {
      document.querySelector(`.sb-tool[data-tab="${t}"]`).click();
      await new Promise(res => setTimeout(res, 420));
      const vc = document.getElementById('vc');
      return { tab: S.tab, chars: ((vc && vc.innerText) || '').trim().length,
               lit: !!document.querySelector(`.sb-tool[data-tab="${t}"].on`) };
    }, tab);
    ok(r.tab === tab && r.chars > 120 && r.lit,
       `${tab} opens, renders and lights up`, r);
  }

  section('Nothing is laid out past the edge of the rail');
  const fit = await page.evaluate(railShape);
  const out = fit.tools.filter(t => t.shown && (t.pastRight > 0.5 || t.pastLeft > 0.5));
  ok(out.length === 0, 'at desktop width', out);

  ok(errors.length === 0, 'and the page raised no errors', errors);
  await app.close();
}

/* ── A phone, where a control cannot shrink out of the way ─────────────── */
{
  const app = await bootApp({ user: { name: 'A', email: 'a@x.com', ini: 'A' },
                              viewport: { width: 390, height: 844 }, hasTouch: true });
  const { page, errors } = app;
  await page.waitForTimeout(400);
  /* With every tool present, which is the case that broke: a plan with teams
     is seven, and an owner gets an eighth appended at runtime. */
  const s = await page.evaluate(() => {
    saveStr('amv_plan', 'elite'); _revealTeamNav();
    return (function () {
      const rail = document.getElementById('sb-tools');
      const rr = rail.getBoundingClientRect();
      return { tools: [...rail.querySelectorAll('.sb-tool[data-tab]')].map(e => {
        const r = e.getBoundingClientRect();
        return { tab: e.dataset.tab, w: r.width, h: r.height,
                 shown: r.width > 0 && r.height > 0,
                 pastRight: r.right - rr.right, pastLeft: rr.left - r.left }; }) };
    })();
  });

  section('On a phone it wraps instead of walking off the side');
  const shown = s.tools.filter(t => t.shown);
  ok(shown.length === 7, 'all seven tools are present', shown.map(t => t.tab));
  const out = shown.filter(t => t.pastRight > 0.5 || t.pastLeft > 0.5);
  ok(out.length === 0, 'and not one of them is laid out outside the rail', out);

  section('And each is still the size of a thumb');
  const small = shown.filter(t => t.w < MIN_TOUCH - 0.5 || t.h < MIN_TOUCH - 0.5);
  ok(small.length === 0, 'every tool clears 44px',
     small.map(t => `${t.tab} ${Math.round(t.w)}x${Math.round(t.h)}`));

  ok(errors.length === 0, 'and the page raised no errors', errors);
  await app.close();
}

process.exit(report() === 0 ? (done(), 0) : 1);
