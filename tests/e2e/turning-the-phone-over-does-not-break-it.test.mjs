/* THREE MOBILE FAULTS, ONE MISSING LISTENER.

   Reported as three things: "why is it down and side on mobile", "no send
   button showing", and a reply that looks "off centred with the response, like
   AMV isn't connected, then smushed".

   One cause. _initMobileSidebar decides phone-or-desktop from the viewport and
   runs once, from goApp(). Nothing listened for the viewport CHANGING - no
   resize handler, no orientationchange, nothing in the whole product.

   Open AMV on a phone held sideways: 844px clears the 720 breakpoint, so it
   boots desktop with the sidebar open. Turn the phone upright and the viewport
   is 390px - and the sidebar stays open, on top of the conversation. Chat
   squeezed into what is left, replies cut off mid-word, send button behind the
   panel. Every symptom, from one missing listener.

   WHY THE EXISTING MOBILE SWEEP NEVER SAW IT: it boots the harness at 390 and
   measures. Booted at 390 everything is correct. The fault needs the viewport
   to change AFTER boot, which is what a phone does when you turn it over and
   what no test was doing. So this one rotates. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' },
                            viewport: LANDSCAPE });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());
await page.waitForTimeout(500);

/* A conversation on screen, because "off centre and smushed" is about a reply. */
await page.evaluate(() => {
  setMsgs([{ r: 'u', c: 'hello, can you help me plan my week?' },
           { r: 'a', c: 'Of course. Here is a plan that fits around what you already have on.', streaming: false }]);
  renderChatMsgs();
});

const look = () => page.evaluate(() => {
  const de = document.documentElement;
  const sb = document.getElementById('sb');
  const snd = document.getElementById('snd');
  const sbr = sb ? sb.getBoundingClientRect() : null;
  const sr = snd ? snd.getBoundingClientRect() : null;
  /* How much of the sidebar is actually ON the screen - a closed sidebar is
     translated off to the left, so its width alone says nothing. */
  const sbOnScreen = sbr ? Math.max(0, Math.min(sbr.right, window.innerWidth) - Math.max(sbr.left, 0)) : 0;
  const bubbles = [...document.querySelectorAll('#cm .mb')].map(e => {
    const b = e.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) };
  });
  return {
    w: window.innerWidth,
    sbOnScreen: Math.round(sbOnScreen),
    sendOnScreen: sr ? (sr.width > 1 && sr.left >= 0 && sr.right <= window.innerWidth + 1) : false,
    sendBehindSidebar: (sbr && sr && sbOnScreen > 1) ? !(sr.right < sbr.left || sr.left > sbr.right) : false,
    sideways: de.scrollWidth - de.clientWidth,
    bubbles,
  };
});

section('Held sideways, it lays out for the width it has');
{
  const r = await look();
  ok(r.w > 720, 'this really is over the phone breakpoint', r.w);
  ok(r.sideways <= 0, 'nothing scrolls sideways', r.sideways);
  ok(r.sendOnScreen, 'the send button is on screen');
}

section('Turn it upright and the sidebar gets out of the way');
{
  await page.setViewportSize(PORTRAIT);
  await page.waitForTimeout(700);
  const r = await look();

  ok(r.w < 720, 'now under the phone breakpoint', r.w);
  /* The bug, named: the panel stayed open across the boundary and covered the
     conversation. */
  ok(r.sbOnScreen <= 1, 'the sidebar is not sitting on top of the chat', r.sbOnScreen + 'px of it on screen');
  ok(!r.sendBehindSidebar, 'the send button is not behind it');
  ok(r.sendOnScreen, 'and it is still on screen');
  ok(r.sideways <= 0, 'nothing scrolls sideways', r.sideways);

  /* "Off centred and smushed" - a reply squeezed into the strip left over. */
  ok(r.bubbles.length >= 2, 'there are messages to measure', r.bubbles.length);
  const widest = Math.max(...r.bubbles.map(b => b.w));
  ok(widest > r.w * 0.5, 'a reply gets a real share of the width, not a leftover strip',
     widest + 'px of ' + r.w);
  ok(r.bubbles.every(b => b.left >= -1 && b.right <= r.w + 1),
     'and no message hangs off either edge', JSON.stringify(r.bubbles));
}

section('And turning it back restores the full layout');
{
  await page.setViewportSize(LANDSCAPE);
  await page.waitForTimeout(700);
  const r = await look();
  ok(r.sbOnScreen > 50, 'the sidebar comes back when there is room for it', r.sbOnScreen);
  ok(r.sideways <= 0, 'still nothing sideways', r.sideways);
  ok(r.sendOnScreen, 'and the send button survived the round trip');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
