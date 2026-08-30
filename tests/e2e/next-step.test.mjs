/* THE NEXT STEP - a new user types one thing, gets a good answer, and leaves,
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
  // Start from an empty project so what arrives is unambiguous.
  Object.keys(_DEV.project).forEach(p => delete _DEV.project[p]);
  _DEV.activePath = '';
  setMsgs([{ r: 'u', c: 'write me a rate limiter' }, { r: 'a', c: code }]);
  renderChatMsgs();
  document.querySelector('[data-next-go]').click();
  const files = _devProjectFiles();
  return { tab: S.tab, mode: (typeof _buildMode === 'function' ? _buildMode() : ''),
           files, body: files.length ? _DEV.project[files[0]].content : '' };
}, CODE);
/* Studio, Dev and Lab are sections of one Build surface now rather than three
   sidebar entries, so the tab is `build` and WHICH of the three is the mode.
   The property is unchanged - the offer has to land on the code surface with
   the code in it - so it is checked on the thing that now carries it. */
ok(ran.tab === 'build', 'the Dev offer opens Build', ran.tab);
ok(ran.mode === 'code', 'in the code section, which is what the offer promised', ran.mode);
/* It used to do ONLY that, and the offer says Dev "keeps the files, runs them,
   and lets you keep building on them" - so somebody who accepted it arrived at
   an empty Dev with none of their code in it. Switching tabs is not the work. */
ok(ran.files.length === 1, 'and the code from the answer is really there', ran.files);
ok(/main\.js$/.test(ran.files[0] || ''), 'named for what it is', ran.files[0]);
ok(/const x = 1;/.test(ran.body), 'with the actual contents, not a placeholder', ran.body.slice(0, 40));

section('Opening in Dev never overwrites a file already in the project');
{
  /* Adding to somebody's open project must not silently replace what they are
     working on - the worst possible outcome for a convenience button. */
  const r = await page.evaluate((code) => {
    /* Back to chat and into a fresh conversation FIRST - leaving the Dev tab
       reloads the project, so seeding it before the switch would be undone. */
    setTab('chat');
    newChat();
    Object.keys(_DEV.project).forEach(p => delete _DEV.project[p]);
    _devSetFile('main.js', 'MY OWN WORK');
    setMsgs([{ r: 'u', c: 'write me a rate limiter' }, { r: 'a', c: code }]);
    renderChatMsgs();
    document.querySelector('[data-next-go]').click();
    return { files: _devProjectFiles(), mine: (_DEV.project['main.js'] || {}).content };
  }, CODE);
  ok(r.mine === 'MY OWN WORK', 'the existing file is untouched', r.mine);
  ok(r.files.length === 2, 'and the new code lands beside it', r.files);
}

section('A table is not code, and is not offered as code');
{
  /* stats/compare/steps/choices are fenced blocks that render as interactive
     components. Counting them as code offered "Open this in Dev" on a
     comparison table, and would then have written that table into a project as
     a source file. */
  const r = await page.evaluate(() => {
    const tbl = 'Here is how they compare.\n\n```compare\n' +
      JSON.stringify({ columns: ['A', 'B'], rows: [{ label: 'Price', values: ['$9', '$19'] }] }) +
      '\n```\n\n' + 'Some more explanation. '.repeat(50);
    return { offer: _nextStepFor('compare these two plans for me', tbl),
             blocks: _nextStepBlocks(tbl).length };
  });
  ok(r.blocks === 0, 'a rendered block is not counted as code', r.blocks);
  ok(!r.offer || r.offer.kind !== 'dev', 'so no Dev offer is made for it', r.offer);
}

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
section('A reply the user cut short earns nothing');
{
  /* Stop leaves a truncated answer. Offering to open half a file in Dev would
     carry the truncation forward into a real project. */
  // An earlier section turns suggestions off for good; clear that first, or
  // this would pass for the wrong reason.
  await page.evaluate(() => { saveStr('amv_nextstep_off', ''); const c = getCurConv(); if (c) c._nextShown = []; });
  const html = await page.evaluate(() => _nextStepHTML([
    { r: 'u', c: 'build me a complete todo app with a backend and a database and tests' },
    { r: 'a', _stopped: true, c: '```js\n' + 'const x = 1;\n'.repeat(90) + '```\n' + 'more '.repeat(200) },
  ]));
  ok(html === '', 'a stopped answer offers no next step', JSON.stringify(html).slice(0, 60));

  const finished = await page.evaluate(() => _nextStepHTML([
    { r: 'u', c: 'build me a complete todo app with a backend and a database and tests' },
    { r: 'a', c: '```js\n' + 'const x = 1;\n'.repeat(90) + '```\n' + 'more '.repeat(200) },
  ]));
  ok(finished.includes('next-step'), 'while the same answer, finished, does', finished.slice(0, 40));
}

section('A first good answer about something that CHANGES earns a standing job');
{
  /* A first session that ends with nothing standing usually ends the
     relationship. But this only widens the net over subjects that actually
     change - offering to re-run "the capital of France" weekly would be a
     feature that does nothing, which is worse than offering nothing. */
  const v = await page.evaluate((long) => {
    saveStr('amv_nextstep_off', '');
    saveStr('amv_nextstep_first', '');
    const c = getCurConv(); if (c) c._nextShown = [];
    return {
      tracked: (_nextStepFor('how is my competitor doing and how has their pricing changed', long) || {}).kind,
      compare: (_nextStepFor('compare the best project management tools', long) || {}).kind,
      fact:    _nextStepFor('explain how photosynthesis works in detail', long),
      short:   _nextStepFor('how is the weather trending', 'Fine.'),
    };
  }, 'x '.repeat(400));
  ok(v.tracked === 'first', 'a question about something that moves earns the offer', v.tracked);
  ok(v.compare === 'first', 'so does a comparison worth re-running', v.compare);
  ok(v.fact === null, 'but a settled fact does not - re-running it would do nothing', v.fact);
  ok(v.short === null, 'and a thin answer never earns anything', v.short);
}

section('A better-matching offer always wins over the welcome one');
{
  const v = await page.evaluate((long) => {
    saveStr('amv_nextstep_first', '');
    return {
      news: (_nextStepFor('what is the latest news on chip export rules', long) || {}).kind,
      jobs: (_nextStepFor('help me track down a job and write a cover letter', long) || {}).kind,
    };
  }, 'x '.repeat(400));
  ok(v.news === 'daily', 'a daily-shaped question still offers the daily brief', v.news);
  ok(v.jobs === 'jobs', 'and a job hunt still offers Job Hunt', v.jobs);
}

section('It is asked once, not every session');
{
  const v = await page.evaluate((long) => {
    saveStr('amv_nextstep_first', '');
    const before = (_nextStepFor('how is my competitor doing and how has their pricing changed', long) || {}).kind;
    _nextStepFirstSeen();
    const after = _nextStepFor('how is my competitor doing and how has their pricing changed', long);
    return { before, after };
  }, 'x '.repeat(400));
  ok(v.before === 'first', 'offered the first time');
  ok(v.after === null, 'and never again once it has been answered either way', v.after);
}

ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();

report();
done();
