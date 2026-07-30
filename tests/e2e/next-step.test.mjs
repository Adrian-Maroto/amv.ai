/* THE NEXT STEP — a new user types one thing, gets a good answer, and leaves,
   never learning that AMV can do the work rather than describe it. Crew, Dev,
   Job Hunt and background automations are invisible from an empty chat box, so
   the product gets judged as a chatbot by people who never saw the rest of it.
   These assertions cover the offer being earned rather than constant, and every
   action doing real work. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

const LONG = 'A thorough answer. '.repeat(40);
const CODE = 'Here is the implementation.\n\n```js\n' + 'const x = 1;\n'.repeat(60) + '```\n\nThat should do it.';

section('It only fires when the exchange has earned it');
const matches = await page.evaluate(([long, code]) => ({
  news:   (_nextStepFor('what is the latest news on the election', long) || {}).kind,
  code:   (_nextStepFor('write me a rate limiter', code) || {}).kind,
  jobs:   (_nextStepFor('help me write a cover letter for a part time job', long) || {}).kind,
  crew:   (_nextStepFor('research the top five suppliers and then compare their pricing for each of them', long) || {}).kind,
  plain:  _nextStepFor('what is the capital of France', long),
  short:  _nextStepFor('what is the latest news', 'Not much happened.'),
}), [LONG, CODE]);
ok(matches.news === 'daily', 'a question about today offers to have it ready every morning', matches.news);
ok(matches.code === 'dev', 'an answer containing real code offers to open it in Dev', matches.code);
ok(matches.jobs === 'jobs', 'a job-hunting question offers Job Hunt', matches.jobs);
ok(matches.crew === 'crew', 'a multi-part goal offers Crew', matches.crew);
ok(matches.plain === null, 'an ordinary question gets NOTHING - silence is the default', matches.plain);
ok(matches.short === null, 'and a one-line answer has not earned a follow-up', matches.short);

section('It renders under a complete answer');
const shown = await page.evaluate((long) => {
  newChat();
  setMsgs([{ r: 'u', c: 'what is the latest news on AI regulation' }, { r: 'a', c: long }]);
  renderChatMsgs();
  const el = document.querySelector('.next-step');
  return { shown: !!el, text: el ? el.textContent : '', hasGo: !!document.querySelector('[data-next-go]') };
}, LONG);
ok(shown.shown, 'the suggestion appears');
ok(/every morning/i.test(shown.text), 'saying what it will do', shown.text.slice(0, 80));
ok(shown.hasGo, 'with a control that performs it');

section('Never on a failure, a cut-off answer, or mid-stream');
const suppressed = await page.evaluate((long) => {
  const cases = {};
  newChat(); setMsgs([{ r: 'u', c: 'latest news' }, { r: 'a', c: '', _error: 'it broke' }]);
  renderChatMsgs(); cases.error = !!document.querySelector('.next-step');
  newChat(); setMsgs([{ r: 'u', c: 'latest news' }, { r: 'a', c: long, _interrupted: true }]);
  renderChatMsgs(); cases.cut = !!document.querySelector('.next-step');
  newChat(); setMsgs([{ r: 'u', c: 'latest news' }, { r: 'a', c: long, streaming: true }]);
  renderChatMsgs(); cases.streaming = !!document.querySelector('.next-step');
  return cases;
}, LONG);
ok(suppressed.error === false, 'not after an error - that would be tone deaf');
ok(suppressed.cut === false, 'not under an answer that was cut off');
ok(suppressed.streaming === false, 'and not while it is still being written');

section('Accepting it does real work, not a description of the work');
const ran = await page.evaluate((code) => {
  newChat();
  setMsgs([{ r: 'u', c: 'write me a rate limiter' }, { r: 'a', c: code }]);
  renderChatMsgs();
  document.querySelector('[data-next-go]').click();
  return { tab: S.tab };
}, CODE);
ok(ran.tab === 'dev', 'the Dev offer actually opens Dev', ran.tab);

section('The daily offer creates a genuine background automation');
const scheduled = await page.evaluate(async (long) => {
  let posted = null;
  AMV_API.base = 'https://api.test'; AMV_API.token = 'tok';
  window.fetch = async (u, o) => {
    if (String(u).includes('/auto/create')) { posted = JSON.parse(o.body); }
    return { ok: true, status: 200, headers: new Headers(),
      json: async () => ({ ok: true, item: { id: 'a1', detail: posted && posted.detail } }) };
  };
  newChat();
  setMsgs([{ r: 'u', c: 'what is the latest news on AI regulation' }, { r: 'a', c: long }]);
  renderChatMsgs();
  document.querySelector('[data-next-go]').click();
  await new Promise(r => setTimeout(r, 400));
  return { posted, tab: S.tab };
}, LONG);
ok(!!scheduled.posted, 'it calls the real automation endpoint', scheduled.posted);
ok(/latest news on AI regulation/.test((scheduled.posted || {}).detail || ''),
   'carrying what the user actually asked for', (scheduled.posted || {}).detail);
ok((scheduled.posted || {}).repeat === 'daily', 'scheduled daily, as offered', (scheduled.posted || {}).repeat);

section('It does not nag: once per kind per conversation');
const once = await page.evaluate((long) => {
  newChat();
  setMsgs([{ r: 'u', c: 'latest news please' }, { r: 'a', c: long }]);
  renderChatMsgs();
  document.querySelector('[data-next-go]').click();
  // same conversation, another matching exchange
  setMsgs([{ r: 'u', c: 'and the latest news on markets' }, { r: 'a', c: long }]);
  renderChatMsgs();
  return !!document.querySelector('.next-step');
}, LONG);
ok(once === false, 'having offered and been taken up, it does not offer the same thing again');

section('Dismissing it is permanent');
const off = await page.evaluate((long) => {
  saveStr('amv_nextstep_off', '');
  newChat();
  setMsgs([{ r: 'u', c: 'latest news' }, { r: 'a', c: long }]);
  renderChatMsgs();
  document.querySelector('[data-next-off]').click();
  const goneNow = !document.querySelector('.next-step');
  newChat();
  setMsgs([{ r: 'u', c: 'latest news again' }, { r: 'a', c: long }]);
  renderChatMsgs();
  return { goneNow, staysGone: !document.querySelector('.next-step'), flag: loadStr('amv_nextstep_off') };
}, LONG);
ok(off.goneNow, 'it disappears when dismissed');
ok(off.staysGone, 'and does not come back in a new conversation');
ok(off.flag === '1', 'the choice is remembered');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
