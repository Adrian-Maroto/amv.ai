/* A TEMPORARY CHAT LEAVES NOTHING BEHIND; A BRANCH LEAVES THE ORIGINAL ALONE.

   Temporary means four separate things, and each is checked where it would
   leak: the chat is not written to this device, not sent to the server,
   nothing is learned from it or saved to memory, and memories are not read
   into it. It ends when another chat is opened.

   Branching copies a conversation up to one answer into a new chat, so a
   different direction can be tried without losing the first. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

await page.evaluate(() => {
  S.memory = [{ id: 'm1', text: 'Lives in Valencia and has a dog called Turrón', added: Date.now() }];
  window.__extracted = 0;
  window._maybeExtractMemory = async () => { window.__extracted++; };
  /* A turn has to get as far as building its request for "were memories read"
     to mean anything, so the engine is reported as connected and the
     allowance as open; the request itself then fails at the network. */
  window._aiBackendReady = () => true;
  try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {}
  try { AEGIS.check = () => ({ ok: true }); } catch (e) {}
  /* Did the turn get as far as the network? Without this, a turn stopped
     early by a gate reads exactly like one that left the memories out. */
  window.__fetched = 0;
  window.__reachedNet = () => window.__fetched > 0;
  window.__memRead = 0;
  const realRel = window._relevantMemories;
  window._relevantMemories = (...a) => { window.__memRead++; return realRel(...a); };
});

section('Turning it on says so, in words');
{
  await page.evaluate(() => { newChat(); renderChatMsgs(); });
  const before = await page.evaluate(() => !!document.querySelector('.temp-toggle'));
  ok(before, 'a new chat offers a temporary one');
  await page.click('.temp-toggle');
  await page.waitForTimeout(150);
  const s = await page.evaluate(() => ({ temp: _isTempChat(), banner: (document.querySelector('.temp-banner') || {}).textContent || '' }));
  ok(s.temp, 'pressing it opens a temporary chat');
  ok(/Temporary chat/.test(s.banner) && /not saved/.test(s.banner), 'and the screen says what that means', s.banner);
}

section('It is not saved, not synced, and nothing is learned from it');
{
  const r = await page.evaluate(async () => {
    const c = getCurConv();
    setMsgs([{ r: 'u', c: 'My bank PIN reminder is under the blue mug' }, { r: 'a', c: 'Noted for this chat only.' }]);
    const stored = JSON.stringify(load(convKey(S.user.email)) || []);
    const synced = JSON.stringify(AMVSync.collect().convs || []);
    const mem = await _sectionTool('memory_add', { text: 'PIN reminder is under the blue mug' });
    return { id: c.id, stored, synced, mem: mem && mem.text, memCount: S.memory.length,
             banner: (document.querySelector('.temp-banner') || {}).textContent || '' };
  });
  ok(!r.stored.includes(r.id) && !r.stored.includes('blue mug'), 'nothing of it is written to this device', r.stored.slice(0, 120));
  ok(!r.synced.includes(r.id) && !r.synced.includes('blue mug'), 'nothing of it goes to the server');
  ok(/temporary chat/i.test(r.mem || '') && r.memCount === 1, 'asking AMV to remember something is refused, and memory is unchanged', r.mem);
  ok(/Temporary chat/.test(r.banner), 'the banner stays at the top of the conversation');
}

section('Memories are not read into it, and nothing is extracted from it');
{
  const r = await page.evaluate(async () => {
    window.__memRead = 0; window.__extracted = 0;
    const realFetch = window.fetch;
    window.__fetched = 0; window.fetch = async () => { window.__fetched++; throw new Error('offline for the test'); };
    try { await _callAITurn(getMsgs().concat([{ r: 'u', c: 'What city do I live in?' }])); } catch (e) {}
    window.fetch = realFetch;
    S.busy = false;
    return { read: window.__memRead, extracted: window.__extracted, net: window.__reachedNet() };
  });
  ok(r.net, 'the turn really went as far as sending', r.net);
  ok(r.read === 0, 'its turns are sent without the saved memories', r.read);
  ok(r.extracted === 0, 'and no memory is extracted from it', r.extracted);
}

section('Leaving it ends it');
{
  const r = await page.evaluate(() => {
    const id = getCurConv().id;
    newChat();
    return { gone: !S.convs.some(c => c.id === id), temp: _isTempChat() };
  });
  ok(r.gone && !r.temp, 'opening another chat removes the temporary one', r);
}

section('An ordinary chat still reads memory, so the rule is the temporary one');
{
  const r = await page.evaluate(async () => {
    setMsgs([{ r: 'u', c: 'hello' }]);
    window.__memRead = 0;
    const realFetch = window.fetch;
    window.__fetched = 0; window.fetch = async () => { window.__fetched++; throw new Error('offline for the test'); };
    try { await _callAITurn(getMsgs()); } catch (e) {}
    window.fetch = realFetch;
    S.busy = false;
    return { read: window.__memRead, net: window.__reachedNet() };
  });
  ok(r.net && r.read > 0, 'a normal chat, sent the same way, does read memories', r);
}

section('Branch from an answer: a new chat, the original untouched');
{
  await page.evaluate(() => {
    newChat();
    setMsgs([{ r: 'u', c: 'Plan a weekend in Porto' }, { r: 'a', c: 'Day one: Ribeira.' },
             { r: 'u', c: 'Make it cheaper' }, { r: 'a', c: 'Stay in Gaia instead.' }]);
    renderChatMsgs();
    window.__orig = getCurConv().id;
  });
  await page.click('[data-action="branch"][data-idx="1"]');
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const now = getCurConv(), orig = S.convs.find(c => c.id === window.__orig);
    return { newId: now.id, orig: window.__orig, n: now.msgs.length, last: now.msgs[now.msgs.length - 1].c,
             from: now.from, origN: orig.msgs.length, title: now.title,
             storedHasBranch: JSON.stringify(load(convKey(S.user.email)) || []).includes(now.id) };
  });
  ok(r.newId !== r.orig, 'a new chat is opened');
  ok(r.n === 2 && r.last === 'Day one: Ribeira.', 'holding the conversation up to that answer', r);
  ok(r.origN === 4, 'and the original still has all four messages', r.origN);
  ok(r.from && r.from.id === r.orig && r.from.at === 2, 'the branch remembers where it came from', r.from);
  ok(/^Branch: /.test(r.title) && r.storedHasBranch, 'it is named as a branch, and saved like any chat', r.title);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-temporary-chat-leaves-nothing') > 0) process.exitCode = 1;
done();
