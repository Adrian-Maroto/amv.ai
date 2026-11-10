/* THE ANSWER BAR AND THE BOX THAT GROWS (Nov 10, owner's request).

   "make it like ChatGPT ... the chat box keeps getting bigger when you type so
   you can see everything you type", and after every answer: copy, thumbs up
   and down, share, read aloud, and three dots with more.

   What this holds: the box grows with what is typed and stops at about half
   the visible height, where it scrolls instead (a box that grows forever
   pushes the conversation off the screen); the row under an answer carries
   exactly those controls; the three dots open a menu whose items are named,
   close on Escape with focus back on the button, and close on a tap outside;
   and on a phone every one of them is big enough for a thumb. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('The box grows with what you write, then scrolls');
{
  const r = await page.evaluate(async () => {
    const ta = document.getElementById('mta');
    const h0 = ta.getBoundingClientRect().height;
    ta.focus(); ta.value = 'line\n'.repeat(6); ta.dispatchEvent(new Event('input', { bubbles: true }));
    const h6 = ta.getBoundingClientRect().height;
    ta.value = 'line\n'.repeat(80); ta.dispatchEvent(new Event('input', { bubbles: true }));
    const big = ta.getBoundingClientRect().height;
    const vh = (window.visualViewport && window.visualViewport.height) || innerHeight;
    const out = { h0, h6, big, vh, scrolls: getComputedStyle(ta).overflowY, fits: ta.scrollHeight <= big + 1 };
    ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }));
    out.back = ta.getBoundingClientRect().height;
    return out;
  });
  ok(r.h6 > r.h0 + 60, 'six lines make the box taller than one, enough to see them', r);
  ok(r.h6 > 130, 'past the old four-line stop', r.h6);
  ok(r.big <= r.vh * 0.46 + 1 && r.big >= 120, 'eighty lines stop at about half the screen', r);
  ok(r.scrolls === 'auto' && !r.fits, 'and from there it scrolls instead of growing', r.scrolls);
  ok(r.back <= r.h0 + 2, 'emptied, it goes back to one line', r);
}

section('Under an answer: copy, thumbs, read aloud, share, and More');
{
  await page.evaluate(() => {
    newChat();
    setMsgs([{ r: 'u', c: 'Plan a weekend in Porto' }, { r: 'a', c: 'Day one: Ribeira. Day two: Gaia.' }]);
    renderChatMsgs();
  });
  const bar = await page.evaluate(() => [...document.querySelectorAll('.mr:not(.u) .mact-bar > .mact, .mr:not(.u) .mact-bar > .mact-morewrap > .mact')]
    .map(b => b.dataset.action));
  for (const a of ['like-up', 'like-down', 'copy-a', 'speak', 'share-answer', 'answer-more'])
    ok(bar.includes(a), a + ' is in the row', bar);
  ok(!bar.includes('export') && !bar.includes('branch'), 'Download and Branch are in the menu, not the row', bar);
  const named = await page.evaluate(() => [...document.querySelectorAll('.mr:not(.u) .mact-bar > .mact, .mr:not(.u) .mact-morewrap > .mact')]
    .filter(b => !(b.getAttribute('aria-label') || b.title)).map(b => b.dataset.action));
  ok(named.length === 0, 'every icon has a name a screen reader says', named);
}

section('The three dots open a named menu, and let go of it properly');
{
  await page.click('[data-action="answer-more"][data-idx="1"]');
  const open = await page.evaluate(() => {
    const m = document.querySelector('.mact-menu:not([hidden])'); if (!m) return null;
    const r = m.getBoundingClientRect();
    return { items: [...m.querySelectorAll('.mact-mi')].map(b => b.textContent.trim()), expanded: document.querySelector('[data-action="answer-more"][data-idx="1"]').getAttribute('aria-expanded'),
             inside: r.left >= 0 && r.right <= innerWidth, focus: document.activeElement && document.activeElement.classList.contains('mact-mi') };
  });
  ok(open && open.items.length === 3 && open.items.every(t => t.length > 3), 'three items, each with words', open);
  ok(open && open.expanded === 'true' && open.focus, 'the button says it is open, and focus moves into the menu', open);
  ok(open && open.inside, 'and the menu is inside the window', open);
  await page.keyboard.press('Escape');
  const shut = await page.evaluate(() => ({ any: !!document.querySelector('.mact-menu:not([hidden])'),
    back: document.activeElement && document.activeElement.dataset.action === 'answer-more' }));
  ok(!shut.any && shut.back, 'Escape closes it and puts focus back on the button', shut);
  await page.click('[data-action="answer-more"][data-idx="1"]');
  await page.mouse.click(5, 300);
  ok(!(await page.evaluate(() => !!document.querySelector('.mact-menu:not([hidden])'))), 'a tap outside closes it');
}

section('Share hands over the answer text and nothing else');
{
  const r = await page.evaluate(async () => {
    let got = null; navigator.share = async (d) => { got = d; };
    document.querySelector('[data-action="share-answer"][data-idx="1"]').click();
    await new Promise(s => setTimeout(s, 50));
    return got;
  });
  ok(r && r.text === 'Day one: Ribeira. Day two: Gaia.' && !r.url, 'the answer, with no link to the chat', r);
}
await app.close();

section('On a phone, every control under an answer is big enough for a thumb');
{
  const phone = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = phone.page;
  await p.evaluate(() => { newChat(); setMsgs([{ r: 'u', c: 'Hi' }, { r: 'a', c: 'Hello.' }]); renderChatMsgs(); });
  await p.evaluate(() => document.querySelector('[data-action="answer-more"][data-idx="1"]').click());
  const small = await p.evaluate(() => [...document.querySelectorAll('.mr:not(.u) .mact-bar .mact, .mact-menu:not([hidden]) .mact-mi')]
    .map(b => { const r = b.getBoundingClientRect(); return { a: b.dataset.action, w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; })
    .filter(x => x.h < 44 || x.w < 44 || x.right > 390));
  ok(small.length === 0, 'nothing under 44px, and nothing past the edge', small);
  ok(phone.errors.length === 0, 'no page errors on the phone', phone.errors.slice(0, 3));
  await phone.close();
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
report();
done();
