/* THE BANNER HAD NO STYLES, SO IT APPEARED UNSTYLED AND NEVER LEFT.

   `_initOfflineWatch` has been appending `<div class="offline-bar">` to the
   body and toggling a `show` class on it since it was written. Nothing in
   styles.css has ever matched either selector - measured in Chromium rather
   than read: position:static, z-index:auto, in normal document flow, an
   unstyled 1280x22 line of text.

   The consequence was not merely that it looked wrong. Because `show` had no
   rule, `classList.remove('show')` removed nothing, so after going offline and
   coming back ONLINE the bar was still on screen still saying "You're
   offline". Telling somebody they are offline while they are online sends them
   looking for a connection problem that does not exist, which is worse than
   having no indicator at all.

   Every assertion here is about what is ON THE SCREEN - computed display, a
   real height, a position in the viewport - and not about which classes are
   set. The old code set and unset its class perfectly; the class was the thing
   that did nothing. A test written against class names would have passed
   throughout.

   The bar also gained a second reason to exist, which is why it is now shared
   rather than the offline notice's private element: a network that refuses
   AMV's backend. Those two differ in kind and the difference is load-bearing -
   see the sticky section below. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* MEASURE IT WHERE IT LANDS, NOT WHILE IT IS STILL ARRIVING.

   This failed in CI twice and passed locally every time, on one assertion:
   the bar reported display:flex, position:fixed and a height of 59, and
   "visible" false. The bar slides in from translateY(-100%), so for the first
   220ms its rect is entirely above the viewport - and the check waited a fixed
   200ms. Locally that landed after the animation; on a shared CI runner it
   landed inside it.

   A longer sleep would be the same bet with better odds. This waits for the
   animation the page is actually running, through the Web Animations API, so
   the measurement happens when the element has stopped moving however slow the
   machine is. */
const settled = () => page.waitForFunction(() => {
  const b = document.getElementById('offline-bar');
  if (!b) return true;
  if (typeof b.getAnimations !== 'function') return true;
  return b.getAnimations().every(a => a.playState === 'finished' || a.playState === 'idle');
}, null, { timeout: 5000 }).catch(() => {});

const seen = async () => (await settled(), page.evaluate(() => {
  const b = document.getElementById('offline-bar');
  if (!b) return { missing: true };
  const cs = getComputedStyle(b);
  const r = b.getBoundingClientRect();
  return {
    display: cs.display, position: cs.position, zIndex: cs.zIndex,
    visible: cs.display !== 'none' && cs.visibility !== 'hidden'
             && r.height > 0 && r.top < window.innerHeight && r.bottom > 0,
    h: Math.round(r.height), text: (b.textContent || '').trim(),
  };
}));
const fire = (name) => page.evaluate((n) => window.dispatchEvent(new Event(n)), name);

await page.evaluate(() => { try { _initOfflineWatch(); } catch (e) {} });

section('Nothing is announced until there is something to announce');
{
  const s = await seen();
  ok(s.missing || !s.visible, 'no bar on a page that is working', s);
}

section('Going offline puts a real thing on the screen');
{
  await fire('offline');
  await page.waitForTimeout(200);
  const s = await seen();
  ok(s.visible, 'the bar is actually visible, not merely class-flagged', s);
  ok(s.position === 'fixed',
     'and fixed rather than in the document flow, where it shifted the page', s.position);
  ok(s.h > 0, 'with a height', s.h);
  ok(/offline/i.test(s.text), 'saying what happened', s.text.slice(0, 80));
}

section('Coming back online takes it away - the whole bug, in one assertion');
{
  await fire('online');
  await page.waitForTimeout(200);
  const s = await seen();
  ok(!s.visible, 'the bar is gone from the screen', s);
  ok(s.display === 'none', 'because hiding is now something the class does', s.display);
}

section('A backend this network refuses is a different kind of problem');
{
  await page.evaluate(() => _netBlockedNotice("this network's security policy"));
  await page.waitForTimeout(200);
  const s = await seen();
  ok(s.visible, 'it is announced at page level, once', s);
  ok(/blocking AMV from reaching its own server/i.test(s.text),
     'naming what is actually wrong', s.text.slice(0, 120));
  ok(/security policy/i.test(s.text), 'and the reason it was given', s.text.slice(0, 160));
  ok(/different network|mobile data/i.test(s.text),
     'and something the person can actually try', s.text.slice(0, 220));
  ok(!/you’re offline|you're offline/i.test(s.text),
     'without calling it an outage, which it is not', s.text.slice(0, 120));
}

section('And being online does not make it untrue');
{
  /* THE PROPERTY THAT MAKES ONE SHARED BAR SAFE. A policy on the origin
     refuses every call AMV makes; connectivity has nothing to do with it.
     Clearing this on an `online` event would erase the only explanation the
     person has while everything quietly fails around them. */
  await fire('online');
  await page.waitForTimeout(200);
  const s = await seen();
  ok(s.visible, 'the blocked notice survives an online event', s);
  await fire('offline');
  await page.waitForTimeout(150);
  await fire('online');
  await page.waitForTimeout(200);
  const s2 = await seen();
  ok(s2.visible && /reaching its own server/i.test(s2.text),
     'and survives an offline/online round trip without being overwritten', s2.text.slice(0, 90));
}

section('It can always be got rid of');
{
  /* It is a FIXED element. One with no way to close it can cover something on
     a small screen with no recourse. */
  const tap = await page.evaluate(() => {
    const x = document.querySelector('.offline-bar-x');
    if (!x) return null;
    const r = x.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), label: x.getAttribute('aria-label') || '' };
  });
  ok(tap, 'there is a dismiss control');
  ok(tap.w >= 40 && tap.h >= 40, 'big enough to hit', tap);
  ok(/dismiss/i.test(tap.label), 'and named for a screen reader', tap.label);

  await page.evaluate(() => document.querySelector('.offline-bar-x').click());
  await page.waitForTimeout(200);
  ok(!(await seen()).visible, 'dismissing really dismisses it');

  /* And it stays dismissed - a sticky notice that returns is not a dismiss. */
  await fire('online');
  await page.waitForTimeout(150);
  ok(!(await seen()).visible, 'and it does not come straight back');
}

section('It never sits over a dialog somebody is answering');
{
  await page.evaluate(() => _netBlockedNotice('test'));
  await page.waitForTimeout(150);
  const z = await page.evaluate(() => {
    const b = document.getElementById('offline-bar');
    return parseInt(getComputedStyle(b).zIndex, 10);
  });
  ok(z > 0, 'it is above ordinary content', z);
  ok(z < 9999, 'and below the toast stack and the modal layer', z);
}

section('On a phone it fits, and is still operable');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const b = document.getElementById('offline-bar');
    const x = document.querySelector('.offline-bar-x');
    const br = b.getBoundingClientRect(), xr = x.getBoundingClientRect();
    return {
      overflowsX: br.width > window.innerWidth + 1,
      bodyScrollsX: document.documentElement.scrollWidth > window.innerWidth + 1,
      tap: { w: Math.round(xr.width), h: Math.round(xr.height) },
      h: Math.round(br.height),
    };
  });
  ok(!r.overflowsX, 'the bar does not run off the side', r);
  ok(!r.bodyScrollsX, 'and does not give the page a sideways scroll', r);
  ok(r.tap.w >= 40 && r.tap.h >= 40, 'the dismiss control is still a real target', r.tap);
  ok(r.h < 844 / 2, 'and it does not eat half the screen', r.h);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('a-status-bar-that-lies-is-worse-than-none') > 0) process.exitCode = 1;
done();
