/* THE FIRST SCREEN.

   A new account lands on an empty chat box, and everything that makes AMV
   different from a chat window is invisible from there. So AMV gets judged as
   a chatbot by people who never saw the rest of it - and the judgement is fair,
   because a chat box is all they were shown.

   The intrusive first-run modal was removed from this product on purpose, so
   the bar here is: one card, once, that does real things and then gets out of
   the way permanently. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'New', email: 'new@x.com', ini: 'N' } });
const { page, errors } = app;

const fresh = () => page.evaluate(() => {
  saveStr('amv_firstrun_done', '');
  S.convs = [newConvObj()];
  S.cur = S.convs[0].id;
  setTab('chat'); renderChatMsgs();
});
const card = () => page.evaluate(() => {
  const c = document.querySelector('.fr-card');
  return c ? { text: c.textContent, items: c.querySelectorAll('.fr-item').length } : null;
});

section('A brand new account is shown what AMV does that a chat box cannot');
{
  await fresh();
  const c = await card();
  ok(!!c, 'the card is there for a new account');
  ok(c.items === 3, 'with a few real starting points', c.items);
  ok(/while you are away/i.test(c.text), 'background work is one of them');
  ok(/build and run/i.test(c.text), 'so is building something that runs');
  ok(!/tour|walkthrough|step 1/i.test(c.text), 'and none of it is a tour', c.text.slice(0, 80));
}

section('It is not a modal - the product removed that on purpose');
{
  const v = await page.evaluate(() => {
    const c = document.querySelector('.fr-card');
    const ovr = document.getElementById('ovr');
    return { inChat: !!document.getElementById('cm').contains(c),
             overlayOn: !!(ovr && ovr.classList.contains('on')),
             blocks: getComputedStyle(c).position === 'fixed' };
  });
  ok(v.inChat, 'it renders inside the conversation area');
  ok(!v.overlayOn, 'no overlay is opened');
  ok(!v.blocks, 'and nothing is pinned over the app');
}

section('Tapping one really starts that work');
{
  await fresh();
  const v = await page.evaluate(() => {
    document.querySelectorAll('.fr-item')[0].click();
    return { composer: (document.getElementById('mta') || {}).value || '',
             gone: !document.querySelector('.fr-card') };
  });
  ok(v.composer.length > 40, 'the composer is filled with a real prompt', v.composer.slice(0, 60));
  ok(/ask me/i.test(v.composer), 'one that asks the user what they want rather than guessing');
  ok(v.gone, 'and the card gets out of the way immediately');
}

section('It is shown once, whatever happens to it');
{
  await page.evaluate(() => { S.convs = [newConvObj()]; S.cur = S.convs[0].id; renderChatMsgs(); });
  ok((await card()) === null, 'after being used it never returns');

  await fresh();
  await page.evaluate(() => document.querySelector('[data-fr-skip]').click());
  ok((await card()) === null, 'dismissing removes it');
  await page.evaluate(() => renderChatMsgs());
  ok((await card()) === null, 'and it stays gone on the next render too');
}

section('Someone already talking is not told where to start');
{
  await page.evaluate(() => {
    saveStr('amv_firstrun_done', '');
    S.convs = [newConvObj()];
    S.cur = S.convs[0].id;
    S.convs[0].msgs = [{ r: 'u', c: 'hello' }, { r: 'a', c: 'hi' }];
    renderChatMsgs();
  });
  ok((await card()) === null, 'a conversation in progress means no welcome');

  await page.evaluate(() => {
    // A returning user with an empty NEW chat but history elsewhere.
    S.convs = [newConvObj(), { id: 'old', title: 'Old', msgs: [{ r: 'u', c: 'x' }], created: 1 }];
    S.cur = S.convs[0].id;
    renderChatMsgs();
  });
  ok((await card()) === null, 'and neither does an empty chat next to real history');
}

section('It reads on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await fresh();
  await page.waitForSelector('.fr-card', { timeout: 15000 });
  const m = await page.evaluate(() => ({
    tap: document.querySelector('.fr-item').getBoundingClientRect().height,
    named: document.querySelector('.fr-card').getAttribute('aria-label'),
    close: document.querySelector('.fr-x').getBoundingClientRect().height,
  }));
  ok((await overflowingElement(page)) === null, 'nothing overflows the screen', await overflowingElement(page));
  ok(m.tap >= 44, 'each starting point is a comfortable tap target', Math.round(m.tap));
  ok(m.close >= 22, 'so is the dismiss control', Math.round(m.close));
  ok(/AMV/.test(m.named || ''), 'and the region is named for screen readers', m.named);
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
report('firstrun');
done();
