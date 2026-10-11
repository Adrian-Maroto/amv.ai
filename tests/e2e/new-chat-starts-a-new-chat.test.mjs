/* NEW CHAT STARTS A NEW CHAT.

   The sidebar entry said "Chat" and reopened whatever conversation was last
   open, so coming back from Crew or Build dropped somebody into the middle of
   an old thread. It says New chat now and starts one - the way the chat
   products people already use behave - and old conversations are reached
   from Recents.

   An empty chat already open is reused, so pressing New chat twice does not
   stack blank conversations in Recents. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

/* An old conversation, open, with something in it. */
await page.evaluate(() => {
  const c = newConvObj('Trip plans');
  c.msgs = [{ r: 'u', c: 'Plan a weekend in Lisbon' }, { r: 'a', c: 'Here is a plan.' }];
  S.convs.unshift(c); S.cur = c.id; renderHist();
  window.__old = c.id;
});

section('The sidebar says New chat');
{
  const t = await page.evaluate(() => document.querySelector('.snb[data-tab="chat"]').textContent.trim());
  ok(t === 'New chat', 'the entry is called New chat', t);
}

section('From another screen, New chat opens a fresh conversation, not the old one');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(200);
  await page.click('.snb[data-tab="chat"]');
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => ({ tab: S.tab, cur: S.cur, old: window.__old,
    empty: !(getCurConv().msgs || []).length, kept: S.convs.some(c => c.id === window.__old), n: S.convs.length,
    marked: document.querySelector('.snb[data-tab="chat"]').classList.contains('on') }));
  ok(r.tab === 'chat' && r.cur !== r.old && r.empty, 'a new, empty chat is open', r);
  ok(r.kept, 'and the old one is still there in Recents', r);
  ok(!r.marked, 'New chat is an action, so it is not shown as the screen you are on', r);

  await page.click('.snb[data-tab="chat"]');
  await page.click('.snb[data-tab="chat"]');
  await page.waitForTimeout(200);
  const again = await page.evaluate(() => ({ n: S.convs.length, empty: !(getCurConv().msgs || []).length }));
  ok(again.n === r.n && again.empty, 'pressing it again does not stack blank chats', { before: r.n, after: again.n });

  /* The owner's words: "remove the new chat section". There was a second New
     chat, a pill in the top bar, doing the same job as the sidebar's. One
     button for one job - the top bar holds none. */
  const top = await page.evaluate(() => [...document.querySelectorAll('#anav button')]
    .filter(b => b.getBoundingClientRect().width > 0 && /new chat/i.test(b.textContent + ' ' + (b.title || '') + ' ' + (b.getAttribute('aria-label') || '')))
    .map(b => b.id || b.className));
  ok(top.length === 0, 'and there is no second New chat in the top bar', top);
}

section('An old chat is opened from Recents');
{
  await page.evaluate(() => loadConv(window.__old));
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ cur: S.cur, old: window.__old, msgs: getCurConv().msgs.length }));
  ok(r.cur === r.old && r.msgs === 2, 'and opens with its messages', r);
}

section('On a phone, the bottom bar says New chat and does the same');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { setTab('crew'); _renderBottomNav(); });
  await page.waitForTimeout(250);
  const lbl = await page.evaluate(() => (document.querySelector('[data-bntab="chat"] .bn-lbl') || {}).textContent);
  ok(lbl === 'New chat', 'the bottom bar entry is called New chat', lbl);
  await page.click('[data-bntab="chat"]');
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => ({ tab: S.tab, cur: S.cur, old: window.__old, empty: !(getCurConv().msgs || []).length }));
  ok(r.tab === 'chat' && r.cur !== r.old && r.empty, 'and opens a fresh chat, not the last one', r);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('new-chat-starts-a-new-chat') > 0) process.exitCode = 1;
done();
