/* A MESSAGE OF ANY LENGTH GOES THROUGH, AND THE CREW BOX TAKES A PARAGRAPH.

   Asked for: the chat and Crew boxes should take anything, however long, and
   both should be able to connect whatever the person names.

   What was true before:
   - Chat took the text and then the request was refused by the server (over
     600,000 characters) or overflowed the engine - an error for pasting.
   - An attached text file was cut to its first 20,000 characters, silently.
   - An Enter that confirmed a character in a Chinese, Japanese or Korean
     input method sent the message half written.
   - The Crew box was one line: pasted line breaks were lost, and a long
     request ran off the edge where it could not be read back.
   - "connect my ..." typed into the Crew box went to the job planner, because
     the connect tool was only ever wired to chat.

   Each of those is driven here through the real controls. The engine is
   replaced at its seam (`aiComplete`, `_callAI`) so what is asserted is what
   AMV would have sent, not what a model said back. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await app.connect();

/* The engine's seams, recorded. Function declarations in a classic script
   live on window, so replacing them there replaces what the code calls. */
await page.evaluate(() => {
  window.__parts = [];
  window.__sent = null;
  window.aiComplete = async (prompt) => {
    const m = String(prompt).match(/PART (\d+) OF (\d+)/);
    window.__parts.push({ k: m ? +m[1] : 0, n: m ? +m[2] : 0, len: String(prompt).length });
    return 'NOTES ' + (m ? m[1] : '?');
  };
  window._callAI = async (msgs) => { window.__sent = msgs[msgs.length - 1]; S.busy = false; };
  try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {}
});

/* A long message that reads like one: paragraphs, and the question at the end. */
const longText = (chars, ask) => {
  const para = 'The quarterly figures for the northern region rose by four percent, while the southern stores held steady and two sites closed for refurbishment.\n\n';
  return para.repeat(Math.ceil(chars / para.length)).slice(0, chars - ask.length) + ask;
};
const send = async (text) => page.evaluate((t) => {
  const ta = document.getElementById('mta'); ta.value = t; return sendMsg();
}, text);
const reset = () => page.evaluate(() => { window.__parts = []; window.__sent = null; S.busy = false;
  try { closeOvr(); } catch (e) {} });
/* The async confirm, answered through its real buttons. */
/* No dialog is an answer too - it is reported by the assertions that expected
   one, section by section, rather than ending the run at the first. */
const answer = async (yes) => {
  try { await page.waitForSelector('#modal-ok', { timeout: 5000 }); } catch (e) { return ''; }
  const body = await page.evaluate(() => (document.querySelector('#modal-box .ob-sub') || {}).textContent || '');
  await page.click(yes ? '#modal-ok' : '#modal-cancel');
  return body;
};
/* A send that never settles (a dialog nobody answered) must not hold the run. */
const settle = (p) => Promise.race([p.catch(() => {}), new Promise(r => setTimeout(r, 4000))]);

section('A message too long for one request is read in parts, after asking');
{
  await reset();
  const ASK = '\n\nQUESTION: which region grew, and by how much?';
  const text = longText(700000, ASK);
  const sending = send(text);
  const said = await answer(true);
  await settle(sending);
  const r = await page.evaluate(() => ({ parts: window.__parts, sent: window.__sent }));
  ok(/700,000 characters/.test(said) && /parts/.test(said) && /messages of your allowance/.test(said),
     'it says how long it is, that it will read it in parts, and what that uses', said);
  ok(r.parts.length >= 4 && r.parts.every(p => p.n === r.parts.length),
     'every part was read, each knowing how many there are', r.parts.map(p => p.k + '/' + p.n));
  ok(r.parts.every(p => p.len < 200000), 'no single read is larger than an engine takes', r.parts.map(p => p.len));
  const c = r.sent && typeof r.sent.c === 'string' ? r.sent.c : '';
  ok(c.length > 0 && c.length < 600000, 'what is finally sent fits the server bound', c.length);
  ok(/read it in \d+ parts/.test(c) && /NOTES 1/.test(c) && c.endsWith(ASK),
     'it carries the notes and ends with the exact end of the message, question included', c.slice(-120));
  ok(r.sent && r.sent.d.length < 21000 && /more characters - read in \d+ parts/.test(r.sent.d),
     'and what is kept on screen is a readable head and a count, not megabytes', r.sent && r.sent.d.length);
}

section('Saying no sends nothing and gives the text back');
{
  await reset();
  const text = longText(500000, '\n\nWhat changed?');
  const sending = send(text);
  await answer(false);
  await settle(sending);
  const r = await page.evaluate(() => ({ parts: window.__parts.length, sent: window.__sent,
                                          box: document.getElementById('mta').value.length }));
  ok(r.parts === 0 && r.sent === null, 'nothing was read and nothing was sent', r);
  ok(r.box === text.length, 'and every character is back in the box', r.box);
}

section('A long message that fits is sent whole, with no question asked');
{
  await reset();
  const text = longText(150000, '\n\nSummarise it.');
  await settle(send(text));
  const r = await page.evaluate(() => ({ parts: window.__parts.length, c: window.__sent && window.__sent.c,
                                          modal: !!document.getElementById('modal-ok') }));
  ok(!r.modal && r.parts === 0, 'no confirmation and no reading in parts', r.parts);
  ok(r.c === text, 'the message went exactly as typed, all 150,000 characters', r.c && r.c.length);
}

section('An attached text file is sent whole, not its first 20,000 characters');
{
  await reset();
  const file = 'line of the ledger\n'.repeat(3000) + 'LAST-LINE-OF-THE-FILE';
  await page.evaluate((f) => { S.att = { kind: 'text', name: 'ledger.txt', data: f };
    document.getElementById('mta').value = 'What is on the last line?'; return sendMsg(); }, file);
  const c = await page.evaluate(() => (window.__sent && window.__sent.c) || '');
  ok(c.indexOf('LAST-LINE-OF-THE-FILE') >= 0 && c.indexOf('[truncated]') < 0,
     'the end of a ' + file.length.toLocaleString() + '-character file reaches the engine', c.length);
}

section('The Enter that confirms a character in an input method does not send');
{
  await reset();
  await page.evaluate(() => {
    const ta = document.getElementById('mta'); ta.value = '我想';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ sent: window.__sent, box: document.getElementById('mta').value }));
  ok(r.sent === null && r.box === '我想', 'the half-written message stays in the box', r);
}

section('The Crew box takes a paragraph');
{
  await page.evaluate(() => { setTab('crew'); });
  await page.waitForSelector('#mc-cmd-input', { timeout: 8000 });
  const shape = await page.evaluate(() => { const el = document.getElementById('mc-cmd-input');
    return { tag: el.tagName, h: el.getBoundingClientRect().height }; });
  ok(shape.tag === 'TEXTAREA', 'it is a text area, so line breaks survive a paste', shape.tag);

  await page.fill('#mc-cmd-input', 'Every Monday:\n- check the council site\n- check both local papers\n- tell me what changed about Elm Street');
  const grown = await page.evaluate(() => { const el = document.getElementById('mc-cmd-input');
    return { lines: el.value.split('\n').length, h: el.getBoundingClientRect().height }; });
  ok(grown.lines === 4, 'the four lines are kept', grown.lines);
  ok(grown.h > shape.h + 20, 'and the box grows so all of it can be read back', { before: shape.h, after: grown.h });

  await page.focus('#mc-cmd-input');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  const r = await page.evaluate(() => ({ lines: document.getElementById('mc-cmd-input').value.split('\n').length,
                                          ran: (document.getElementById('mc-cmd-result').textContent || '').trim().length }));
  ok(r.lines === 5 && r.ran === 0, 'Shift+Enter is a new line, not Run', r);
}

section('"Connect my ..." in the Crew box gets the same card chat gives');
{
  const ask = async (text) => {
    await page.evaluate((t) => { document.getElementById('mc-cmd-result').innerHTML = ''; return mcRunCommand(t); }, text);
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const card = document.querySelector('#mc-cmd-result .cx-card');
      return { card: !!card, title: card ? (card.querySelector('.cx-t') || {}).textContent : '',
               buttons: card ? [...card.querySelectorAll('.cx-btn')].map(b => b.textContent) : [] };
    });
  };
  const slack = await ask('connect my Slack');
  ok(slack.card && slack.buttons.some(b => /Connect Slack/.test(b)),
     'a service AMV connects gets its own Connect button', slack);
  const melli = await ask('connect my Bank Melli account');
  ok(melli.card && /Bank Melli/.test(melli.title) && melli.buttons.length >= 1,
     'a bank AMV has no list for still gets an answer with real options, not the planner', melli);
  const job = await ask('connect to my inbox every morning and summarise it');
  ok(!job.card, 'while a job that merely mentions connecting still goes to the planner', job);
}

ok(errors.length === 0, 'and nothing threw on the way', errors);

await app.close();
if (report('a-message-of-any-length-goes-through') > 0) process.exitCode = 1;
done();
