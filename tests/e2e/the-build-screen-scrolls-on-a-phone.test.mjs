/* THE BUILD SCREEN WAS CUT OFF ON A PHONE AND WOULD NOT SCROLL.

   Reported from an iPhone with a screenshot: the mode picker's first option was
   sliced off at the top, the composer was sliced off at the bottom, and no
   amount of dragging reached either.

   Measured at 390x620 - a real phone's usable height once Safari's own bars are
   accounted for - `.dev-chat-pane` held 563px of content in a 472px box, inside
   a `#dev-shell` that is `overflow:hidden`. Ninety-one pixels simply did not
   exist for the person holding the phone.

   THE CAUSE IS THE CENTRING, NOT THE HEIGHT. The blank state sets
   `justify-content:center`, and a flex column centring content taller than
   itself pushes the overflow out of BOTH ends. That is why it was clipped at
   the top as well: the first row sits ABOVE the box, where scrollTop 0 is
   already past it, so it is unreachable even once the box scrolls.

   Why it survived every previous device sweep: at 844px of emulated height the
   content fits and nothing is wrong. Only a viewport short enough to overflow
   shows it, and a desktop browser told to be 390 wide is still 844 tall.

   WHAT THIS ASSERTS: not that the CSS says a particular thing, but that at a
   phone's real height the first control and the last control are both
   reachable. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;

const openBuild = async (w, h) => {
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate(() => { if (typeof setTab === 'function') setTab('build'); });
  await page.waitForFunction(() => !!document.querySelector('.dev-shell.dev-blank .dev-chat-pane'),
                             null, { timeout: 10000 }).catch(() => {});
};

/* Reads the pane the way somebody using it would: scroll to one end, ask
   whether the thing that should be there is actually inside the visible box. */
const reach = () => page.evaluate(() => {
  const pane = document.querySelector('.dev-shell.dev-blank .dev-chat-pane');
  if (!pane) return { noPane: true };
  const inside = (el) => {
    if (!el) return false;
    const p = pane.getBoundingClientRect(), b = el.getBoundingClientRect();
    return b.top >= p.top - 1 && b.bottom <= p.bottom + 1;
  };
  const byText = (t) => [...pane.querySelectorAll('*')]
    .find(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === t));

  /* SCROLLED THE WAY A FINGER WOULD, AND CHECKED THAT IT MOVED.

     Assigning scrollTop works even on an `overflow:hidden` element, so a probe
     that only assigns and then measures reports "reachable" for content the
     person cannot actually get to. Reverting the fix proved it: the overflow
     assertion failed and every reachability one still passed. So the movement
     is recorded - though note even that is not enough on its own, because
     Chromium moves an `overflow:hidden` element programmatically too. The
     check that actually discriminates is the wheel gesture below, which is
     what a finger does and what `hidden` genuinely refuses. */
  pane.scrollTop = 0;
  const first = byText('Design it') || byText('Build an app');
  const firstVisible = inside(first);

  pane.scrollTop = pane.scrollHeight;
  const movedTo = pane.scrollTop;
  const composer = [...pane.querySelectorAll('textarea')].pop();
  const composerVisible = inside(composer);

  return {
    overflowY: getComputedStyle(pane).overflowY,
    scrollable: pane.scrollHeight > pane.clientHeight + 2,
    hiddenPx: pane.scrollHeight - pane.clientHeight,
    firstLabel: first ? first.textContent.trim().slice(0, 24) : null,
    firstVisible, composerFound: !!composer, composerVisible,
    reallyMoved: movedTo > 0,
  };
});

/* A REAL GESTURE, not an assignment. This is the one that tells a pane the
   person can scroll apart from a pane that merely responds to scripting. */
const wheelMoves = async () => {
  const box = await page.evaluate(() => {
    const p = document.querySelector('.dev-shell.dev-blank .dev-chat-pane');
    if (!p) return null;
    p.scrollTop = 0;
    const b = p.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(250);
  return page.evaluate(() =>
    document.querySelector('.dev-shell.dev-blank .dev-chat-pane').scrollTop > 0);
};

section('On a phone-sized screen the whole Build home can be reached');
{
  await openBuild(390, 620);
  const moved = await wheelMoves();
  ok(moved, 'a scroll gesture over the pane actually scrolls it', moved);
  const r = await reach();
  ok(!r.noPane, 'the Build home is on screen', r);
  ok(r.overflowY === 'auto' || r.overflowY === 'scroll',
     'the pane that holds it can scroll', r.overflowY);
  ok(r.scrollable, 'and it has more content than fits, which is the case that was broken', r.hiddenPx);
  ok(r.firstVisible, 'scrolled to the top, the FIRST mode is fully on screen', r);
  ok(r.reallyMoved, 'and dragging it actually moves it, rather than only appearing to', r);
  ok(r.composerFound && r.composerVisible,
     'scrolled to the bottom, the composer is fully on screen', r);
}

section('And on a very short screen, which is where centring did the damage');
{
  /* 560 is a small phone with the keyboard partly up. The centred layout hid
     more here than anywhere, because the taller the overflow the more goes off
     the TOP - the end that scrolling cannot recover. */
  await openBuild(390, 560);
  const r = await reach();
  ok(r.scrollable, 'there is still more than fits', r.hiddenPx);
  ok(r.firstVisible, 'the first mode is still reachable', r);
  ok(r.reallyMoved, 'and the pane genuinely moves', r);
  ok(r.composerVisible, 'and so is the composer', r);
}

section('With room to spare it stays centred, rather than jammed to the top');
{
  /* The fix must not cost the layout it was protecting: `safe center` centres
     while there is room and only gives up when there is not. */
  await openBuild(390, 900);
  const r = await reach();
  ok(!r.scrollable, 'nothing needs scrolling at this height', r.hiddenPx);
  ok(r.firstVisible && r.composerVisible, 'and everything is visible at once', r);
}

section('Nothing broke');
{
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
}

if (report('the-build-screen-scrolls-on-a-phone') > 0) process.exitCode = 1;
done();
