/* AN ANSWER SAYS WHICH MEMORIES IT HAD (owner, Nov 25: "fix everything AMV is
   behind"). The leading assistant shows the memories behind an answer; AMV
   sent memories with every question and showed nothing. Held, through a real
   send with the stream answered on the wire:
     · the answer records which saved memories went with the question - by id,
       never their text;
     · under it, "N of your memories" opens the list, with a way to Memory;
     · a memory deleted later is gone from old answers too;
     · with memory switched off, none is sent and none is shown. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 1280, height: 900 }, user: { name: 'Ana', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(500);

const send = (text) => page.evaluate(async (text) => {
  AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 'tok';
  window._aiBackendReady = () => true;
  window.__sent = null;
  if (!window.__realFetch) window.__realFetch = window.fetch;
  window.fetch = async (url, init) => {
    if (/\/v1\/messages/.test(String(url))) {
      try { window.__sent = JSON.parse(init.body); } catch (e) {}
      const ev = (d) => 'event: ' + d.type + '\ndata: ' + JSON.stringify(d) + '\n\n';
      const body = [ev({ type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 1 } } }),
        ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Here is a plan.' } }),
        ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }),
        ev({ type: 'message_stop' })].join('');
      return new Response(new TextEncoder().encode(body), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return window.__realFetch(url, init);
  };
  document.getElementById('mta').value = text;
  sendMsg();
  for (let i = 0; i < 100 && !window.__sent; i++) await new Promise(r => setTimeout(r, 50));
  for (let i = 0; i < 60 && S.busy; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 150));
  const last = getMsgs().at(-1) || {};
  return { mem: last.mem || null, sys: JSON.stringify((window.__sent || {}).system || ''),
    chip: (document.querySelector('#cm .mr:last-of-type .mem-used-b') || document.querySelectorAll('.mem-used-b')[document.querySelectorAll('.mem-used-b').length - 1] || {}).textContent || '' };
}, text);

await page.evaluate(() => { document.querySelectorAll('.cc-banner').forEach(b => b.remove());
  saveStr('amv_cap_memory', '1');
  S.memory = [{ id: 'm1', text: 'Has a dog called Biscuit', added: 1 }, { id: 'm2', text: 'Lives in Ponta Delgada', added: 2 }];
  newChat(); });

section('The answer records which memories went with the question');
const r1 = await send('Plan a walk for Biscuit in Ponta Delgada this weekend');
ok(/Biscuit/.test(r1.sys) && /Ponta Delgada/.test(r1.sys), 'both memories were sent', r1.sys.slice(0, 120));
ok(JSON.stringify(r1.mem) === JSON.stringify(['m1', 'm2']), 'and the answer records them by id', r1.mem);
ok(await page.evaluate(() => !/Biscuit/.test(JSON.stringify(getMsgs().at(-1).mem))), 'not by their text');

section('Under the answer: "2 of your memories", which opens the list');
ok(r1.chip === '2 of your memories', 'the line says how many', r1.chip);
await page.click('.mem-used-b >> nth=-1');
const open = await page.evaluate(() => { const l = [...document.querySelectorAll('.mem-used-l')].at(-1);
  return { shown: !l.hidden, items: [...l.querySelectorAll('li')].map(x => x.textContent), exp: [...document.querySelectorAll('.mem-used-b')].at(-1).getAttribute('aria-expanded') }; });
ok(open.shown && open.items.join('|') === 'Has a dog called Biscuit|Lives in Ponta Delgada' && open.exp === 'true', 'the two memories, listed', open);
await page.click('.mem-used-go >> nth=-1');
await page.waitForTimeout(300);
ok(await page.evaluate(() => S.tab === 'memory'), 'Manage memory goes to Memory');

section('A memory deleted later is gone from old answers too');
await page.evaluate(() => { S.memory = S.memory.filter(m => m.id !== 'm1'); setTab('chat'); renderChatMsgs(); });
await page.waitForTimeout(200);
const after = await page.evaluate(() => { const b = [...document.querySelectorAll('.mem-used-b')].at(-1);
  return { chip: b ? b.textContent : "", html: [...document.querySelectorAll(".mem-used-l")].some(l => l.innerHTML.includes("Biscuit")) }; });
ok(after.chip === '1 of your memories' && !after.html, 'one left, and Biscuit appears nowhere', after);

section('Memory switched off: none sent, none shown');
await page.evaluate(() => { newChat(); });
await page.waitForTimeout(900);   /* the send floor between two messages is 800ms */
await page.evaluate(() => saveStr('amv_cap_memory', '0'));
const r2 = await send('What should I cook tonight?');
ok(!r2.mem && !/Ponta Delgada|Biscuit/.test(r2.sys) && !/of your memories/.test(r2.chip), 'memory off: nothing sent, nothing recorded, nothing shown', { mem: r2.mem, chip: r2.chip });

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
report();
await app.close();
done();
