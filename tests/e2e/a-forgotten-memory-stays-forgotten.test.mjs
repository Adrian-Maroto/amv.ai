/* A FORGOTTEN MEMORY STAYS FORGOTTEN (Nov 17, the owner: "make sure memory
   100 percent works").

   Memory is merged by id between devices, the way chats were before the
   shelf. So a memory deleted on the laptop was still on the phone; the
   phone's next pull merged it back, then pushed it as the device that had seen
   the latest version, and it was remembered everywhere again. Forgetting is
   the memory action that has to be certain.

   Two devices are played by one page and a hand-made server record, which is
   exactly what the sync pull hands the merge - the same method as
   a-deleted-chat-stays-deleted. Also here: every door that adds a memory
   refuses a secret, Clear all asks first, signing out forgets nothing, and
   what is remembered is what reaches the next conversation. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const NOW = Date.now();
await page.evaluate((now) => {
  S.memory = [
    { id: 'm-coffee', text: 'I drink my coffee black', added: now - 5000 },
    { id: 'm-job', text: 'I work as a nurse in Leeds', added: now - 6000 },
    { id: 'm-kid', text: 'My daughter is called Ana', added: now - 7000 },
  ];
  try{ localStorage.removeItem(_scopeKey('amv_memory_gone')); }catch(e){}
  Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
  Object.defineProperty(AMV_API, 'hasSession', { configurable: true, get: () => true });
}, NOW);
const ids = () => page.evaluate(() => S.memory.map(m => m.id));

section('Forgotten on this device, it does not come back from the other one');
{
  await page.evaluate(() => delMemory('m-coffee'));
  ok(!(await ids()).includes('m-coffee'), 'the × removes it here', await ids());
  /* The server's copy still has it: the phone pushed before it heard. */
  const r = await page.evaluate(async (now) => {
    AMV_API.syncPull = async () => ({ memory: [
      { id: 'm-coffee', text: 'I drink my coffee black', added: now - 5000 },
      { id: 'm-job', text: 'I work as a nurse in Leeds', added: now - 6000 },
      { id: 'm-kid', text: 'My daughter is called Ana', added: now - 7000 },
    ] });
    await AMVSync.pull();
    const sent = AMVSync.collect().memory || [];
    return { live: S.memory.map(m => m.id), sent: sent.map(m => ({ id: m.id, gone: !!m.gone, text: m.text })) };
  }, NOW);
  ok(!r.live.includes('m-coffee') && r.live.length === 2, 'a pull with the stale copy does not bring it back', r.live);
  ok(r.sent.some(m => m.id === 'm-coffee' && m.gone && m.text === ''), 'what goes to the server says it was forgotten - and carries none of its words', r.sent);
  ok(r.sent.filter(m => !m.gone).length === 2, 'beside the two still remembered', r.sent);
}

section('On the other device, the forgetting arrives and wins');
{
  /* This page now plays the phone: it still remembers the coffee, older than
     the delete, and the server's record carries the tombstone. */
  const r = await page.evaluate(async (now) => {
    try{ localStorage.removeItem(_scopeKey('amv_memory_gone')); }catch(e){}
    S.memory = [
      { id: 'm-coffee', text: 'I drink my coffee black', added: now - 5000 },
      { id: 'm-job', text: 'I work as a nurse in Leeds', added: now - 6000 },
    ];
    AMV_API.syncPull = async () => ({ memory: [ { id: 'm-coffee', gone: true, text: '', updated: now - 1000 },
      { id: 'm-job', text: 'I work as a nurse in Leeds', added: now - 6000 } ] });
    await AMVSync.pull();
    return { live: S.memory.map(m => m.id), texts: S.memory.map(m => m.text), sent: (AMVSync.collect().memory || []).map(m => m.id + (m.gone ? ':gone' : '')) };
  }, NOW);
  ok(r.live.length === 1 && r.live[0] === 'm-job', 'the phone forgets it too', r.live);
  ok(r.texts.every(t => t), 'and nothing it remembers is an empty line', r.texts);
  ok(r.sent.includes('m-coffee:gone'), 'and passes the forgetting on, so a third device learns it as well', r.sent);
  const prompt = await page.evaluate(() => _relevantMemories([{ r: 'u', c: 'What should I drink this morning?' }]));
  ok(prompt.length === 1 && !prompt.some(t => /coffee/.test(t)), 'the next conversation is told only what is still remembered', prompt);
}

section('Remembered on the other device, it arrives here');
{
  const r = await page.evaluate(async (now) => {
    AMV_API.syncPull = async () => ({ memory: [ { id: 'm-new', text: 'I am allergic to peanuts', added: now },
      { id: 'm-coffee', gone: true, text: '', updated: now - 1000 }, { id: 'm-job', text: 'I work as a nurse in Leeds', added: now - 6000 } ] });
    await AMVSync.pull();
    return { live: S.memory.map(m => m.id), prompt: _relevantMemories([{ r: 'u', c: 'Plan a dinner for me' }]) };
  }, NOW);
  ok(r.live.includes('m-new') && r.live.includes('m-job') && !r.live.includes('m-coffee'), 'a memory added elsewhere is here after a pull', r.live);
  ok(r.prompt.includes('I am allergic to peanuts'), 'and reaches the next conversation', r.prompt);
}

section('Asking chat to forget is the same forgetting');
{
  const r = await page.evaluate(async () => {
    const out = await _sectionTool('memory_forget', { match: 'nurse' });
    return { text: out.text, live: S.memory.map(m => m.id), gone: (load('amv_memory_gone') || []).map(t => t.id) };
  });
  ok(/Forgotten/.test(r.text) && !r.live.includes('m-job'), 'chat forgets it', r);
  ok(r.gone.includes('m-job'), 'and leaves the same tombstone, so it stays forgotten on every device', r.gone);
}

section('Signing out forgets nothing');
{
  const r = await page.evaluate(() => {
    const before = (load('amv_memory_gone') || []).length;
    S.memory = [];               // what signing out does to the list on screen
    return { before, after: (load('amv_memory_gone') || []).length, sent: (AMVSync.collect().memory || []).filter(m => !m.gone).length };
  });
  ok(r.after === r.before, 'emptying the list on screen writes no tombstone', r);
}

section('Clear all asks first, and Cancel keeps everything');
{
  await page.evaluate((now) => {
    S.memory = [{ id: 'm-a', text: 'I live in Porto', added: now }, { id: 'm-b', text: 'I like short answers', added: now - 1 }];
    setTab('memory');
  }, NOW);
  await page.click('#mem-clr');
  await page.waitForSelector('#cfm-yes', { timeout: 5000 });
  const asked = await page.evaluate(() => document.getElementById('cfm-t').textContent);
  ok(/Forget everything/.test(asked), 'it asks before forgetting everything', asked);
  await page.click('#cfm-no');
  await page.waitForTimeout(150);
  ok((await ids()).length === 2, 'Cancel forgets nothing', await ids());
  await page.click('#mem-clr');
  await page.waitForSelector('#cfm-yes', { timeout: 5000 });
  await page.click('#cfm-yes');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ live: S.memory.length, gone: (load('amv_memory_gone') || []).map(t => t.id) }));
  ok(r.live === 0 && r.gone.includes('m-a') && r.gone.includes('m-b'), 'Forget all forgets both, on every device', r);
}

section('No door lets a secret in');
{
  const r = await page.evaluate(async () => {
    const def = AMVConnectors.get('memory'), add = def.actions.add;
    let section = '';
    try{ await add.run({ text: 'My bank password is hunter2' }); }catch(e){ section = e.message || 'refused'; }
    const chat = await _sectionTool('memory_add', { text: 'my card number is 4242 4242 4242 4242' });
    const tabIn = document.getElementById('mem-inp'); tabIn.value = 'my api key is sk-123'; addMemory();
    return { section, chat: chat.text, stored: S.memory.map(m => m.text) };
  });
  ok(/will not remember/.test(r.section), 'the connector door refuses a password', r.section);
  ok(/Refused/.test(r.chat), 'chat refuses a card number', r.chat);
  ok(r.stored.length === 0, 'and the Memory tab refuses a key - nothing secret is stored', r.stored);
  const again = await page.evaluate(async () => {
    const add = AMVConnectors.get('memory').actions.add;
    await add.run({ text: 'I prefer metric units' });
    const second = await add.run({ text: 'I prefer metric units' });
    return { second, n: S.memory.length };
  });
  ok(again.n === 1 && again.second.already, 'the same fact twice is remembered once', again);
}

section('A deleted Build project and a deleted prompt stay deleted too');
{
  const r = await page.evaluate(async (now) => {
    const sess = { id: 's-site', kind: 'dev', title: 'Bakery website', updated: now - 9000 };
    _SESSIONS.length = 0; _SESSIONS.push(sess, { id: 's-keep', kind: 'dev', title: 'Keep me', updated: now - 8000 });
    S.prompts = [{ id: 'p-old', title: 'Old prompt', text: 'Say hi', cat: 'Writing' }, { id: 'p-keep', title: 'Keep', text: 'Keep', cat: 'Writing' }];
    _sessDelete('s-site');
    deletePrompt('p-old');
    /* The other device pushed first, still holding both. */
    AMV_API.syncPull = async () => ({ sessions: [sess, { id: 's-keep', kind: 'dev', title: 'Keep me', updated: now - 8000 }],
      prompts: [{ id: 'p-old', title: 'Old prompt', text: 'Say hi', cat: 'Writing' }, { id: 'p-keep', title: 'Keep', text: 'Keep', cat: 'Writing' }] });
    await AMVSync.pull();
    const out = AMVSync.collect();
    return { sessions: _SESSIONS.map(x => x.id), prompts: S.prompts.map(x => x.id),
      sentS: (out.sessions || []).map(x => x.id + (x.gone ? ':gone' : '')), sentP: (out.prompts || []).map(x => x.id + (x.gone ? ':gone' : '')) };
  }, NOW);
  ok(!r.sessions.includes('s-site') && r.sessions.includes('s-keep'), 'the deleted project does not come back to Recents', r.sessions);
  ok(!r.prompts.includes('p-old') && r.prompts.includes('p-keep'), 'the deleted prompt does not come back', r.prompts);
  ok(r.sentS.includes('s-site:gone') && r.sentP.includes('p-old:gone'), 'and both deletes travel to the other devices', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
