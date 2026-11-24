/* WHAT YOU ASK TO BE CALLED IS WHAT YOU ARE CALLED (owner, Nov 24: "when I
   change [What should AMV call you? / What best describes your work?] it's
   not updating ... they can't just be there for visuals").

   The settings were saved and did reach every chat, but the greeting - the
   one place the name is plainly on screen - used the account name, so the
   change looked like it did nothing. Held, through the real Account screen:
     · saving a new name, work and instructions keeps them;
     · the chat home greets you by the name you asked for;
     · all three are in what the assistant is told on every message. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 1280, height: 900 }, user: { name: 'Adrian Maroto', email: 'a@x.com', ini: 'AM' } });
const { page, errors } = app;
await page.waitForTimeout(500);

section('Saving the Account screen keeps what was typed');
const saved = await page.evaluate(async () => {
  S.settingsPane = 'account'; setTab('settings');
  for (let i = 0; i < 40 && !document.getElementById('s-nick'); i++) await new Promise(r => setTimeout(r, 50));
  document.getElementById('s-nick').value = 'Addy';
  const sel = document.getElementById('s-work'); sel.value = 'Student';
  document.getElementById('s-instr').value = 'Always answer in bullet points.';
  document.getElementById('save-profile').click();
  await new Promise(r => setTimeout(r, 200));
  return { nick: loadStr('amv_nickname'), work: loadStr('amv_work'), instr: loadStr('amv_instructions'),
           msg: (document.getElementById('acct-msg') || {}).textContent || '' };
});
ok(saved.nick === 'Addy' && saved.work === 'Student' && /bullet points/.test(saved.instr), 'all three are kept', saved);
ok(/saved/i.test(saved.msg), 'and the screen says so', saved.msg);

section('The chat home greets you by that name');
const greet = await page.evaluate(async () => {
  closeOvr && closeOvr();
  newChat(); await new Promise(r => setTimeout(r, 300));
  const h = document.querySelector('#chat-home h1, .ch-greet, .home-greet, #cm h1, #cm h2');
  return (h ? h.textContent : (document.getElementById('cm') || document.body).innerText).replace(/\s+/g, ' ').trim();
});
ok(/Addy/.test(greet) && !/Adrian/.test(greet), 'it says Addy, not the account name', greet.slice(0, 80));

section('The assistant is told all three on every message');
const ctx = await page.evaluate(() => _profileContext());
ok(/Addy/.test(ctx) && /Student/.test(ctx) && /bullet points/.test(ctx), 'name, work and instructions are in the context', ctx.slice(0, 200));

section('And it is in what is actually sent - and a change counts from the next message');
{
  /* Read off the wire, not off _profileContext(): a context function that is
     right and never reaches the request is the defect this file exists for. */
  const sendAndRead = (text) => page.evaluate(async (text) => {
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 'tok';
    window._aiBackendReady = () => true;
    window.__sent = null;
    if (!window.__realFetch) window.__realFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (/\/v1\/messages/.test(String(url))) {
        try { window.__sent = JSON.parse(init.body); } catch (e) {}
        const enc = new TextEncoder();
        const ev = (d) => 'event: ' + d.type + '\ndata: ' + JSON.stringify(d) + '\n\n';
        const body = [ev({ type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 1 } } }),
          ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
          ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
          ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }),
          ev({ type: 'message_stop' })].join('');
        return new Response(enc.encode(body), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return window.__realFetch(url, init);
    };
    newChat(); await new Promise(r => setTimeout(r, 100));
    document.getElementById('mta').value = text;
    sendMsg();
    for (let i = 0; i < 100 && !window.__sent; i++) await new Promise(r => setTimeout(r, 50));
    for (let i = 0; i < 60 && S.busy; i++) await new Promise(r => setTimeout(r, 50));
    const b = window.__sent || {};
    if (!window.__sent) return 'NOT SENT: ' + JSON.stringify(getMsgs().map(m => String(m.d || m.c).slice(0, 60))).slice(0, 300);
    return typeof b.system === 'string' ? b.system : JSON.stringify(b.system || '');
  }, text);

  await page.evaluate(() => { saveStr('amv_personality', 'concise');
    S.memory = (S.memory || []).concat([{ id: 'm-test', text: 'Has a dog called Biscuit', t: Date.now(), cat: 'personal' }]); });
  const sys1 = await sendAndRead('Plan a walk for my dog Biscuit this weekend');
  ok(/Addy/.test(sys1), 'the name they asked for is sent', sys1.slice(0, 120));
  ok(/Student/.test(sys1) && /bullet points/.test(sys1), 'with their work and their standing instructions', '');
  ok(/Be brief and direct/.test(sys1), 'and the personality they picked', '');
  ok(/Biscuit/.test(sys1), 'and what AMV remembers about them, when it is relevant', '');

  await page.evaluate(() => { saveStr('amv_nickname', 'Captain'); saveStr('amv_personality', 'warm'); });
  await page.waitForTimeout(900);   /* the send floor between two messages is 800ms */
  const sys2 = await sendAndRead('What should I cook for dinner tonight?');
  ok(/Captain/.test(sys2) && !/called Addy/.test(sys2), 'a new name counts from the very next message', sys2.slice(0, 160));
  ok(/warm, patient/.test(sys2) && !/Be brief and direct/.test(sys2), 'and so does a new personality', '');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

report();
await app.close();
done();
