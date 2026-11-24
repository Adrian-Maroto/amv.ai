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

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

report();
await app.close();
done();
