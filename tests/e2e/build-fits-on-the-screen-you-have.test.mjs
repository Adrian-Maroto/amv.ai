/* THE ENTRY SCREEN THAT RAN OFF THE BOTTOM, AND THE ROOM WITH NO DOOR.

   Measured before anything was changed, on a 390x844 phone: Lab's entry box
   was 482px tall and held 735px of content. The row that says what AMV can do
   with your code began at y=759 - below the window - inside a scroller nested
   in a shell that was itself `overflow:hidden`. So the page did not scroll, the
   box did, and the two most important buttons on the screen were reachable only
   by finding the inner scrollbar. On a 700px laptop the same row sat under the
   cookie bar.

   Three separate claims are pinned here because three separate rules produce
   them and any one of them can be undone on its own:

     1. the entry scrolls as a page, with no scroller inside a scroller,
     2. the head and the cards sit on ONE measure rather than 660 and 800,
     3. a loaded Lab still shows the way out and the way to the other two
        sections - it was possible to be stuck in Lab with the switcher hidden
        and the only exit rendered as unbordered text.

   And Build's entry is centred in the window rather than pinned to the top,
   which is what the owner asked for after it left 363px of nothing under it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 }, hasTouch: true });
const page = app.page;

section('Lab entry scrolls as one page on a phone');
{
  await page.evaluate(() => { _LAB.code = ''; setTab('lab'); });
  await page.waitForTimeout(400);
  /* A REAL WHEEL, NOT `scrollTop = ...`.

     Assigning scrollTop moves an `overflow:hidden` box just as happily as a
     scrollable one, so the first version of this passed with the fix undone.
     The claim is that somebody can reach the buttons by scrolling, and the
     only honest way to check it is to scroll. */
  await page.mouse.move(195, 500);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const shell = document.getElementById('lab-shell');
    const entry = document.getElementById('lab-entry');
    const acts = document.getElementById('lab-entry-acts');
    const r = acts.getBoundingClientRect();
    return {
      innerScroll: entry.scrollHeight - entry.clientHeight,
      moved: Math.round(shell.scrollTop),
      actsBottom: Math.round(r.bottom),
      viewport: window.innerHeight,
    };
  });
  ok(m.innerScroll <= 1, 'the entry is not a scroller inside a scroller', JSON.stringify(m));
  ok(m.moved > 0, 'a wheel over the page actually scrolls the page', JSON.stringify(m));
  ok(m.actsBottom <= m.viewport, 'and scrolling it reaches the actions', JSON.stringify(m));
}

section('The head and the cards share one measure');
{
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => renderBuildView());
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const head = document.querySelector('.lab-shell > .build-head');
    const grid = document.querySelector('.lab-entry-grid');
    const h = head.getBoundingClientRect(), g = grid.getBoundingClientRect();
    return { headL: Math.round(h.left), headR: Math.round(h.right),
             gridL: Math.round(g.left), gridR: Math.round(g.right) };
  });
  ok(Math.abs(m.headL - m.gridL) <= 26, 'the heading starts where the cards start', JSON.stringify(m));
  ok(Math.abs(m.headR - m.gridR) <= 26, 'and ends where they end', JSON.stringify(m));
}

section('A loaded Lab is not a room with no door');
{
  const m = await page.evaluate(async () => {
    _LAB.code = 'const a = 1;\n'.repeat(80);
    renderBuildView();
    await new Promise(r => setTimeout(r, 200));
    const vis = el => !!(el && el.getBoundingClientRect().height > 0);
    const modes = document.querySelector('.lab-shell > .build-modes');
    const home = document.getElementById('bld-home');
    const cs = home ? getComputedStyle(home) : null;
    return {
      switcher: vis(modes),
      others: modes ? modes.querySelectorAll('[data-bmode]').length : 0,
      home: vis(home),
      homeBorder: cs ? cs.borderTopWidth : '',
    };
  });
  ok(m.switcher, 'the section switcher survives into the working screen', JSON.stringify(m));
  ok(m.others === 3, 'with all three sections still reachable', JSON.stringify(m));
  ok(m.home, 'the way out is on the screen', JSON.stringify(m));
  ok(parseFloat(m.homeBorder) > 0, 'and is shaped like a control, not like text', m.homeBorder);
}

section('Build opens in the middle of the window, not against the top');
{
  const m = await page.evaluate(async () => {
    _LAB.code = '';
    setBuildMode('code');
    await new Promise(r => setTimeout(r, 250));
    const pane = document.querySelector('.dev-shell.dev-blank .dev-chat-pane');
    const first = pane.firstElementChild;
    const kids = Array.from(pane.children).filter(k => k.getBoundingClientRect().height > 0);
    const last = kids[kids.length - 1];
    const p = pane.getBoundingClientRect();
    return {
      above: Math.round(first.getBoundingClientRect().top - p.top),
      below: Math.round(p.bottom - last.getBoundingClientRect().bottom),
    };
  });
  ok(m.above > 60, 'there is room above the heading', JSON.stringify(m));
  /* Not equality: the pane carries its own padding, and a rule that demands
     the two match to the pixel is a rule somebody deletes the first time a
     designer changes the padding. Balance is the claim. */
  ok(Math.abs(m.above - m.below) < 120, 'and about as much below it', JSON.stringify(m));
}

await app.close();
if (report('build-fits-on-the-screen-you-have') > 0) process.exitCode = 1;
done();
