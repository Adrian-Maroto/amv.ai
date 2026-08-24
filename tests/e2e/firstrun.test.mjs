/* THE FIRST SCREEN, AFTER THE CARD CAME OFF IT.

   This file used to test a first-run card: three starting points, once, then
   gone. The card was measured, made accessible, held to a fifth of the first
   viewport, and it worked.

   The owner asked for it to go anyway, and was right to. Their words: remove
   the big boxes, make a new chat say good morning and show the small ones.
   The card was the last thing between somebody opening AMV and typing, and a
   thing that must be dismissed before you can start is a toll on the one
   action the whole product exists for.

   So the coverage moves rather than disappearing. Everything this file used to
   guarantee about the card - it reads on a phone, it does not eat the first
   screen, the composer stays reachable, the starting points are real prompts
   with accessible names - is now asserted about the greeting and the chips
   that replaced it. Deleting the file would have quietly dropped all of it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'new@x.com', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

const fresh = () => page.evaluate(() => {
  S.convs = [newConvObj()];
  S.cur = S.convs[0].id;
  setTab('chat'); renderChatMsgs();
});
const home = () => page.evaluate(() => {
  const greet = document.querySelector('.chome-greet');
  const chips = [...document.querySelectorAll('#chome-chips [data-q]')];
  return {
    greet: greet ? greet.textContent.trim() : null,
    chips: chips.map(c => ({ label: c.textContent.trim(), q: c.dataset.q })),
    card: !!document.querySelector('.fr-card'),
  };
});

section('A new chat greets you by name and offers small starting points');
{
  await fresh();
  const h = await home();
  ok(/^good (morning|afternoon|evening), Adrian$/i.test(h.greet || ''),
     'it says good morning and uses their first name', h.greet);
  ok(h.chips.length >= 4, 'with a handful of small chips under the box', h.chips.length);
}

section('And nothing that has to be dismissed before you can type');
{
  const h = await home();
  ok(!h.card, 'the first-run card is gone, as asked');
  const v = await page.evaluate(() => {
    const ovr = document.getElementById('ovr');
    return { overlayOn: !!(ovr && ovr.classList.contains('on')),
             pinned: [...document.querySelectorAll('#cm *')]
               .some(e => getComputedStyle(e).position === 'fixed') };
  });
  ok(!v.overlayOn, 'no overlay is opened on a new chat');
  ok(!v.pinned, 'and nothing in the conversation area is pinned over the app');
}

section('A chip is a real prompt, and it does not send itself');
{
  await fresh();
  const before = await page.evaluate(() => (getMsgs() || []).length);
  const v = await page.evaluate(() => {
    document.querySelector('#chome-chips [data-q]').click();
    const ta = document.getElementById('mta');
    return { composer: ta ? ta.value : '', focused: document.activeElement === ta,
             msgs: (getMsgs() || []).length };
  });
  ok(v.composer.length > 40, 'the composer is filled with a real instruction', v.composer.slice(0, 60));
  ok(v.msgs === before, 'and nothing is sent on the person’s behalf', v.msgs + ' vs ' + before);
  ok(v.focused, 'the cursor is left in the box so they can edit it');
}

section('Every chip carries an instruction worth sending');
{
  await fresh();
  const h = await home();
  const weak = h.chips.filter(c => !c.q || c.q.length < 40);
  ok(weak.length === 0, 'none of them is a bare keyword pretending to be a prompt',
     weak.map(c => c.label).join(', '));
  const unlabelled = h.chips.filter(c => c.label.length < 3);
  ok(unlabelled.length === 0, 'and each has a label you can read', unlabelled.length);
}

section('Someone already talking is not greeted again');
{
  await page.evaluate(() => {
    S.convs = [newConvObj()];
    S.cur = S.convs[0].id;
    S.convs[0].msgs = [{ r: 'u', c: 'hello' }, { r: 'a', c: 'hi' }];
    renderChatMsgs();
  });
  const h = await home();
  ok(h.greet === null, 'a conversation in progress replaces the greeting');
  ok(h.chips.length === 0, 'and the chips clear out of the way');
}

section('It reads on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await fresh();
  await page.waitForTimeout(300);
  ok((await overflowingElement(page)) === null, 'nothing overflows the screen',
     await overflowingElement(page));
  const m = await page.evaluate(() => {
    const c = document.querySelector('#chome-chips [data-q]');
    return { tap: c ? c.getBoundingClientRect().height : 0,
             named: document.getElementById('chome-chips')?.getAttribute('aria-label') || '' };
  });
  ok(m.tap >= 30, 'a chip is a reachable tap target', Math.round(m.tap));
}

section('The greeting takes far less of the first screen than the card did');
{
  /* The card was held to a fifth of the first viewport and needed a 30%
     allowance on a phone to fit three sentences. A greeting and a row of chips
     should be well inside that everywhere, and the composer must be reachable
     without scrolling on all three - which is the whole point of removing it. */
  for (const [w, h] of [[1440, 900], [1366, 768], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await fresh();
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const g = document.querySelector('.chome');
      const ta = document.getElementById('mta').getBoundingClientRect();
      return { pct: g ? +(g.getBoundingClientRect().height / innerHeight * 100).toFixed(1) : 0,
               composerVisible: ta.bottom <= innerHeight + 1 && ta.top >= 0 };
    });
    ok(m.pct <= 20, `at ${w}x${h} the greeting is at most a fifth of the first screen`, m.pct + '%');
    ok(m.composerVisible, `and the composer is reachable at ${w}x${h} without scrolling`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

section('The card was removed from the screen, not half-removed');
{
  /* A render path that still calls it would put it back the first time
     somebody hits whichever branch was missed. */
  const src = await page.evaluate(() => (document.getElementById('amv-app-code') || {}).textContent || '');
  ok(src.length > 0, 'the shipped bundle can be read to check this');
  const calls = (src.match(/_firstRunHTML\s*\(/g) || []).length;
  ok(calls <= 1, 'nothing renders the first-run card any more', calls);
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
report('firstrun');
done();
