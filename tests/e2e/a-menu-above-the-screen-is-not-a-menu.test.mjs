/* THE ENGINE PICKER OPENED OFF THE TOP OF THE PHONE.

   Reported plainly: "on phone when you click to see the models it goes above
   the screen so u cant see it". Measured at 390x844 before the fix, the menu's
   top edge was at -61px.

   showModelPicker anchored the menu's BOTTOM eight pixels above the button and
   let it grow upward, with nothing saying how tall it may be. The list is a
   heading, five engines and a footnote; on a phone the composer sits near the
   bottom, so upward is the only direction with room, and the list is taller
   than the room. A `position:fixed` element cannot be scrolled back into view,
   so the engines above the fold were not merely awkward - they could not be
   reached at all. Shorter phones lose more of them.

   The fix tells it the space it has: the side with more room wins, the height
   is clamped to that space less a margin, and the list scrolls inside itself.

   Everything here is measured against the viewport rather than asserted about
   CSS, because "is it on the screen" is the actual question and a class name
   cannot answer it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* The picker animates in (mpIn), so measure once it has settled - a fixed wait
   here would be the bet that LESSONS 342 is about. */
const settled = () => page.waitForFunction(() => {
  const m = document.querySelector('.model-picker');
  if (!m) return false;
  if (typeof m.getAnimations !== 'function') return true;
  return m.getAnimations().every(a => a.playState === 'finished' || a.playState === 'idle');
}, null, { timeout: 5000 }).catch(() => {});

/* WHICH COMPOSER POSITION ACTUALLY REPRODUCES IT.

   The first version of this pinned the button to the bottom of the screen,
   reasoning that is where a composer lives. It is - once a conversation has
   messages in it - and it is the case that does NOT fail: with the button at
   the bottom of a 667px screen there is more than 600px above it, and the
   431px list fits.

   The report says "on main chat", and a main chat with nothing in it yet
   centres the composer. That is the failing geometry: the button lands around
   y=378 on a 390x844 screen, the menu opens upward from it, and 378 is less
   than 431. Measured before the fix, top = -61.

   So the default here is the reported state, and `pin` covers the other one.
   Verified by putting the old code back: unpinned fails, pinned does not. */
async function openPicker(pin) {
  await page.evaluate((atBottom) => {
    S.tab = 'chat';
    try { setTab('chat'); } catch (e) {}
    const b = document.getElementById('inp-mdl-btn');
    if (b && atBottom) {
      b.style.position = 'fixed';
      b.style.bottom = '10px';
      b.style.right = '16px';
      b.style.zIndex = '50';
    }
  }, !!pin);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    document.querySelectorAll('.model-picker').forEach(m => m.remove());
    showModelPicker();
  });
  await settled();
  return page.evaluate(() => {
    const m = document.querySelector('.model-picker');
    if (!m) return { missing: true };
    const q = m.getBoundingClientRect();
    const items = [...m.querySelectorAll('.mp-item')];
    /* An item is reachable if it is inside the menu's own scrollable box -
       either already visible, or scrollable to. */
    const canScroll = m.scrollHeight > m.clientHeight + 1;
    return {
      top: Math.round(q.top), bottom: Math.round(q.bottom), h: Math.round(q.height),
      vh: window.innerHeight, vw: window.innerWidth,
      offTop: q.top < -0.5, offBottom: q.bottom > window.innerHeight + 0.5,
      offLeft: q.left < -0.5, offRight: q.right > window.innerWidth + 0.5,
      items: items.length, canScroll,
      overflowY: getComputedStyle(m).overflowY,
      firstItemText: items.length ? items[0].textContent.trim().slice(0, 24) : '',
    };
  });
}

section('On a phone, with the composer where it really sits, the menu is on the screen');
{
  for (const [w, h, name] of [[390, 844, 'iPhone 15'], [390, 667, 'small phone'], [360, 640, 'older Android']]) {
    await page.setViewportSize({ width: w, height: h });
    const r = await openPicker(false);
    ok(!r.missing, `[${name}] the picker opens`, r);
    ok(!r.offTop, `[${name}] its top edge is on the screen`, r);
    ok(!r.offBottom, `[${name}] and so is its bottom edge`, r);
    ok(!r.offLeft && !r.offRight, `[${name}] and it does not run off the sides`, r);
    ok(r.items === 5, `[${name}] all five engines are in it`, r.items);
    ok(r.canScroll ? r.overflowY === 'auto' : true,
       `[${name}] and when it is taller than the room, it scrolls rather than overflowing`, r);
  }
}

section('The engine at the top of the list can actually be got to');
{
  /* The specific loss. Before the fix the first entries were the ones above the
     viewport, so the fast engine - the one somebody on a phone most wants - was
     the least reachable. */
  await page.setViewportSize({ width: 390, height: 667 });
  const r = await openPicker(false);
  const reached = await page.evaluate(() => {
    const m = document.querySelector('.model-picker');
    const first = m.querySelector('.mp-item');
    m.scrollTop = 0;
    const q = first.getBoundingClientRect(), mq = m.getBoundingClientRect();
    return { insideMenu: q.top >= mq.top - 1 && q.bottom <= mq.bottom + 1,
             onScreen: q.top >= -0.5 && q.bottom <= window.innerHeight + 0.5,
             text: first.textContent.trim().slice(0, 20) };
  });
  ok(reached.insideMenu, 'the first engine sits inside the menu box', reached);
  ok(reached.onScreen, 'and on the screen', reached);
  ok(r.items === 5, 'with the rest reachable by scrolling', r.items);
}

section('And with the composer at the bottom, where a busy chat puts it');
{
  /* The easier geometry, kept because both exist in normal use and a fix for
     one must not break the other. */
  await page.setViewportSize({ width: 390, height: 844 });
  const r = await openPicker(true);
  ok(!r.offTop && !r.offBottom, 'the menu is on the screen there too', r);
  ok(r.items === 5, 'with all five engines', r.items);
}

section('Desktop is left as it was');
{
  /* There was never anything wrong there, and a fix that changes the roomy case
     to solve the cramped one is a fix that costs somebody something. */
  await page.setViewportSize({ width: 1280, height: 860 });
  const r = await openPicker(false);
  ok(!r.offTop && !r.offBottom, 'the menu is fully on screen', r);
  ok(!r.canScroll, 'and does not need to scroll, because it fits', r);
  ok(r.h > 300, 'at its full height', r.h);
}

section('Even on a screen too short for the list, nothing is lost');
{
  await page.setViewportSize({ width: 390, height: 420 });
  const r = await openPicker(true);
  ok(!r.offTop && !r.offBottom, 'it is still entirely on the screen', r);
  ok(r.h >= 140, 'and still big enough to be worth opening', r.h);
  ok(r.items === 5, 'with every engine still in the list', r.items);
  ok(r.overflowY === 'auto', 'reachable by scrolling', r.overflowY);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('a-menu-above-the-screen-is-not-a-menu') > 0) process.exitCode = 1;
done();
