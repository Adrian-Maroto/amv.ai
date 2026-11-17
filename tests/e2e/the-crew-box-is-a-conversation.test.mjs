/* THE CREW BOX IS A CONVERSATION (Nov 17, the owner: "make the search like a
   chatbot ... I search twitter. They open a new tab and say say more. I say
   tell me every time trump tweets about something finance. AMV asks by email
   or in AMV? They respond and AMV does it.")

   What it has to do, measured against what reaches the server:
     · two words are not a job - AMV opens a conversation and asks for more;
     · the answer becomes the job, and "every time" means it WATCHES (hourly),
       not one run at 9 tomorrow;
     · it asks how to tell you, and the answer is what the job is created with;
     · watching and telling is read-only, so it runs without asking each time;
       a job that does something says it will ask first;
     · if the server stores "in AMV" because email cannot be sent, the
       conversation says so instead of promising an email;
     · a failure is said, and the conversation stays open to try again;
     · signed out, the box does what it did before - no conversation that ends
       in nothing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

const log = () => page.evaluate(() => [...document.querySelectorAll('#cv-log .cv-msg')].map(m => ({
  who: m.classList.contains('you') ? 'you' : 'amv', t: m.querySelector('.cv-bubble').textContent.trim(),
  chips: [...m.querySelectorAll('.cv-chip')].map(c => c.dataset.cv) })));
const last = async () => { const l = await log(); return l[l.length - 1] || {}; };
const type = async (text) => { await page.fill('#cv-in', text); await page.press('#cv-in', 'Enter'); await page.waitForTimeout(150); };
const ask = async (text) => {
  await page.fill('#mc-cmd-input', text);
  await page.evaluate(() => document.getElementById('mc-cmd-go').click());
  await page.waitForTimeout(250);
};
/* A server that records what it was asked for. */
const fakeServer = (reply) => page.evaluate((reply) => {
  window.__made = [];
  try { Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); } catch (e) {}
  AMV_API._fetch = async (path, opts) => {
    if (path === '/auto/create') { const b = JSON.parse(opts.body); window.__made.push(b);
      return new Response(JSON.stringify(reply === 'fail' ? { error: 'The scheduler is busy.' } : { ok: true, item: { id: 'j1', notify: reply === 'noemail' ? 'app' : b.notify } }),
        { status: reply === 'fail' ? 503 : 200, headers: { 'content-type': 'application/json' } }); }
    return new Response(JSON.stringify({ items: [], results: [] }), { headers: { 'content-type': 'application/json' } });
  };
}, reply);

await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
await page.waitForSelector('#mc-cmd-input', { timeout: 15000 });

section('Two words open a conversation that asks for more');
{
  await fakeServer('ok');
  await ask('twitter');
  const open = await page.evaluate(() => !!document.querySelector('#ovr .cv[role=dialog]') && document.activeElement && document.activeElement.id);
  const l = await log();
  ok(open === 'cv-in', 'a conversation opens with the answer box focused', open);
  ok(l[0] && l[0].who === 'you' && l[0].t === 'twitter', 'what they typed is the first message', l[0]);
  ok(/Say more/.test((l[1] || {}).t || '') && /twitter/.test(l[1].t), 'AMV asks for more, naming it', l[1]);
  const box = await page.inputValue('#mc-cmd-input');
  ok(box === '', 'the Crew box is cleared - the conversation holds it now', box);
}

section('The answer becomes the job, and "every time" watches');
{
  await type('tell me every time Trump tweets about something finance');
  const a = await last();
  ok(/by email or in AMV/.test(a.t) && a.chips.join() === 'email,app', 'AMV asks how to tell them, with both choices', a);
  await page.click('.cv-chip[data-cv="email"]');
  await page.waitForTimeout(400);
  const made = await page.evaluate(() => window.__made);
  const j = made[0] || {};
  ok(made.length === 1, 'one job reaches the server', made.length);
  ok(/Trump tweets about something finance/.test(j.detail) && /twitter/i.test(j.detail), 'it is what they said, with what they first typed', j.detail);
  ok(j.notify === 'email', 'it is created to tell them by email', j.notify);
  ok(j.repeat === 'hourly', '"every time" means it watches, hourly - not once a day', j.repeat);
  ok(j.approval === 'auto', 'watching and telling is read-only, so it does not ask each time', j.approval);
  const d = await last();
  ok(/Done - it is running/.test(d.t) && /by email/.test(d.t) && !/asks you before/.test(d.t), 'AMV says it is running and how it will tell them', d.t);
  ok(d.chips.join() === 'close', 'and offers to show it running', d.chips);
  await page.click('.cv-chip[data-cv="close"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.querySelector('#ovr .cv')), 'which closes the conversation, back to Running now');
}

section('A job that does something asks when, and says it will ask first');
{
  await fakeServer('ok');
  await ask('reply to every new email from my landlord politely');
  const a = await last();
  ok(/by email or in AMV/.test(a.t), 'a full sentence goes straight to how to tell them', a.t);
  await page.click('.cv-chip[data-cv="app"]');
  await page.waitForTimeout(200);
  let b = await last();
  /* "every new email" is not a schedule word, so AMV asks when. */
  if (/When should AMV/.test(b.t)) { await page.click('.cv-chip[data-cv="morning"]'); await page.waitForTimeout(400); b = await last(); }
  const j = (await page.evaluate(() => window.__made))[0] || {};
  ok(j.approval === 'require' && j.notify === 'app', 'it is created to ask first, told in AMV', j);
  ok(/here in AMV/.test(b.t) && /asks you before it sends or changes anything/.test(b.t), 'and says so', b.t);
  await page.click('#cv-x');
}

section('No email from this deployment: it says so instead of promising one');
{
  await fakeServer('noemail');
  await ask('tell me whenever bitcoin falls under 50000 dollars');
  await page.click('.cv-chip[data-cv="email"]');
  await page.waitForTimeout(400);
  const d = await last();
  ok(/here in AMV/.test(d.t) && /Email cannot be sent/.test(d.t) && !/AMV tells you by email/.test(d.t), 'the conversation tells the truth about where it will hear', d.t);
  await page.click('#cv-x');
}

section('A failure is said, and the conversation stays');
{
  await fakeServer('fail');
  await ask('tell me whenever bitcoin falls under 50000 dollars');
  await page.click('.cv-chip[data-cv="app"]');
  await page.waitForTimeout(400);
  const d = await last();
  ok(/scheduler is busy/.test(d.t) && !/Done/.test(d.t), 'the server’s reason is shown, nothing claims done', d.t);
  ok(await page.evaluate(() => !!document.querySelector('#ovr .cv') && !document.querySelector('#cv-in').disabled), 'and the conversation is still open to try again');
  await page.keyboard.press('Escape');
  await page.click('#cv-x').catch(() => {});
}

section('On a phone it fills the screen, and the answer box is reachable');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeServer('ok');
  await ask('twitter');
  const r = await page.evaluate(() => { const c = document.querySelector('#ovr .cv').getBoundingClientRect(); const i = document.getElementById('cv-in').getBoundingClientRect();
    return { w: Math.round(c.width), h: Math.round(c.height), inBottom: Math.round(i.bottom), inH: Math.round(i.height), sw: document.documentElement.scrollWidth }; });
  ok(r.w === 390 && r.h >= 800, 'the conversation is the whole screen', r);
  ok(r.inBottom <= 844 && r.inH >= 40, 'the answer box is on screen and big enough to hit', r);
  ok(r.sw <= 390, 'nothing runs off the side', r.sw);
  await page.click('#cv-x');
  await page.setViewportSize({ width: 1280, height: 800 });
}

section('Signed out, the box does what it did before');
{
  await page.evaluate(() => { S.user = null; });
  await ask('twitter');
  ok(await page.evaluate(() => !document.querySelector('#ovr .cv')), 'no conversation that would end in nothing');
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
