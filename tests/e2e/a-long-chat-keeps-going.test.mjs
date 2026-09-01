/* "MAKE IT SO PEOPLE CAN USE THE SAME LONG CHAT FOR AGES."

   Two things were in the way and only one of them was visible.

   The visible one: a meter that read "Context 75% full" from halfway through
   any conversation, and at 92% told you the chat was full and to start a new
   one. The invisible one, which is worse: the request had ALWAYS been
   `msgs.slice(-20)`. Twenty turns, whatever they weighed. Everything older
   was dropped with no summary and no notice, so the percentage was a number
   about content that was not being sent, used to justify ending a
   conversation that had already been quietly truncated.

   THE PROPERTY THIS FILE EXISTS FOR: what leaves the browser must still
   describe the whole conversation. Not "a card appeared", not "the meter is
   gone" - the payload. So the checks below read the request body.

   And the honest half: with no engine there is nothing to summarise WITH.
   The old code dropped those turns silently; this has to say so, because a
   brief invented locally would be the one thing worse than forgetting, which
   is remembering wrongly. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { functionBody, codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('The split is by weight, not by a count of twenty');
{
  const r = await page.evaluate(() => {
    const turn = (i, len) => ({ r: i % 2 ? 'a' : 'u', c: 'x'.repeat(len) });
    /* Fifty small turns weigh nothing, so every one of them still fits -
       the old rule would have thrown away thirty of them regardless. */
    const small = Array.from({ length: 50 }, (_, i) => turn(i, 40));
    /* A handful of very large ones cannot all fit, so the split has to move. */
    const big = Array.from({ length: 40 }, (_, i) => turn(i, 40000));
    return { small: _ctxSplit(small).from, smallLen: small.length,
             big: _ctxSplit(big).from, bigLen: big.length };
  });
  ok(r.small === 0,
     'fifty short turns all still go, where the old rule dropped thirty of them',
     r.small + ' of ' + r.smallLen);
  ok(r.big > 0 && r.big < r.bigLen,
     'and a conversation of huge turns is split rather than sent whole', r.big);
  ok(r.bigLen - r.big >= 6,
     'always keeping the most recent turns, which are what somebody is talking about',
     r.bigLen - r.big);
}

section('What is dropped comes back as a brief, in the same chat');
{
  const r = await page.evaluate(async () => {
    /* The engine is stubbed so the brief is produced without a key, and so
       this can assert on what was ASKED of it. */
    window.__summaries = [];
    window.aiComplete = async (prompt) => {
      window.__summaries.push(prompt);
      return 'BRIEF: the user is called Sam and the project deadline is 4 March.';
    };
    const conv = { id: 'c1', msgs: [], compact: null };
    conv.msgs.push({ r: 'u', c: 'My name is Sam and the deadline is 4 March.' });
    for (let i = 0; i < 30; i++) {
      conv.msgs.push({ r: i % 2 ? 'a' : 'u', c: 'filler '.repeat(2000) });
    }
    const out = await _ctxPrepare(conv, conv.msgs.length);
    return { from: out.from, brief: out.brief,
             asked: window.__summaries.length,
             sawTheName: window.__summaries.some(p => /My name is Sam/.test(p)),
             stored: !!(conv.compact && conv.compact.summary),
             upto: conv.compact && conv.compact.upto };
  });
  ok(r.from > 0, 'the early turns fall outside the window', r.from);
  ok(r.asked === 1, 'they are summarised once, not once per turn', r.asked);
  ok(r.sawTheName,
     'and the summariser was actually shown the message it has to remember',
     r.sawTheName);
  ok(/BRIEF: the user is called Sam/.test(r.brief),
     'the brief comes back ready to travel with the request', r.brief.slice(0, 60));
  ok(r.stored && r.upto === r.from,
     'and is stored on the conversation, covering exactly what fell out', r.upto);
}

section('It is not re-summarised from scratch every time');
{
  /* A chat crosses the boundary again and again. Re-reading the whole history
     on every message would cost a call proportional to the chat's length,
     forever. The previous brief is an input to the next one. */
  const r = await page.evaluate(async () => {
    window.__summaries = [];
    window.aiComplete = async (prompt) => {
      window.__summaries.push(prompt);
      return 'BRIEF v' + window.__summaries.length;
    };
    const conv = { id: 'c2', msgs: [], compact: null };
    for (let i = 0; i < 30; i++) conv.msgs.push({ r: i % 2 ? 'a' : 'u', c: 'filler '.repeat(2000) });
    await _ctxPrepare(conv, conv.msgs.length);
    const first = window.__summaries.length;
    /* Nothing new has fallen out yet, so nothing should be spent. */
    await _ctxPrepare(conv, conv.msgs.length);
    const afterNoChange = window.__summaries.length;
    /* Now push it well past the boundary again. */
    for (let i = 0; i < 30; i++) conv.msgs.push({ r: i % 2 ? 'a' : 'u', c: 'more '.repeat(2000) });
    await _ctxPrepare(conv, conv.msgs.length);
    return { first, afterNoChange, afterGrowth: window.__summaries.length,
             carried: /BRIEF v1/.test(window.__summaries[window.__summaries.length - 1] || '') };
  });
  ok(r.first === 1, 'the first crossing costs one call', r.first);
  ok(r.afterNoChange === 1,
     'sending again with nothing newly dropped costs nothing', r.afterNoChange);
  ok(r.afterGrowth === 2, 'and growing past it again costs one more', r.afterGrowth);
  ok(r.carried,
     'the second call is handed the first brief, so it never re-reads what is already covered',
     r.carried);
}

section('With no engine it says so, rather than dropping turns in silence');
{
  const r = await page.evaluate(async () => {
    window.aiComplete = async () => { throw new Error('not-connected'); };
    const conv = { id: 'c3', msgs: [], compact: null };
    for (let i = 0; i < 30; i++) conv.msgs.push({ r: i % 2 ? 'a' : 'u', c: 'filler '.repeat(2000) });
    await _ctxPrepare(conv, conv.msgs.length);
    return { degraded: _ctxDegraded(conv), brief: _ctxBriefBlock(conv),
             invented: !!(conv.compact && conv.compact.summary) };
  });
  ok(r.degraded, 'the conversation is marked as missing context', r.degraded);
  ok(!r.invented,
     'and nothing is invented to fill the gap - remembering wrongly is worse than forgetting',
     r.invented);
  ok(r.brief === '', 'so no brief is sent claiming to be a summary', r.brief);
}

section('The chat surface stops telling people their chat is full');
{
  /* Driven through the app's OWN conversation state. The first version of
     this assigned `window.getCurConv`, which the bundle never reads - it is a
     top-level `const`, so the stub was invisible and the meter rendered for
     the real (empty) chat every time. A probe result is evidence about the
     probe first. */
  const r = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.id = 'ctx-probe';
    document.body.appendChild(host);
    const conv = getCurConv() || (setMsgs([]), getCurConv());
    const out = {};
    conv.compact = null;
    _ctxRenderMeter('ctx-probe', 'chat');
    out.quiet = host.innerHTML.trim();
    conv.compact = { summary: 's', upto: 5 };
    _ctxRenderMeter('ctx-probe', 'chat');
    out.summarised = host.textContent.trim();
    out.summarisedBtns = host.querySelectorAll('button').length;
    conv.compact = { degraded: true, upto: 5 };
    _ctxRenderMeter('ctx-probe', 'chat');
    out.degraded = host.textContent.trim();
    conv.compact = null;
    return out;
  });
  ok(r.quiet === '', 'an ordinary chat says nothing at all about its length', r.quiet);
  ok(/summarised so this chat can keep going/i.test(r.summarised),
     'a compacted one says so in one quiet line', r.summarised);
  ok(!/\d+% full|full\b/i.test(r.summarised),
     'with no percentage and no "full"', r.summarised);
  ok(r.summarisedBtns === 0,
     'and nothing to click, because there is nothing to decide', r.summarisedBtns);
  ok(/not being sent/i.test(r.degraded),
     'while missing context is stated plainly', r.degraded);
}

section('The send path really uses it - the seam, not just the helper');
{
  /* `_ctxPrepare` can be perfect while the request still says `.slice(-20)`,
     and every check above would stay green. */
  const src = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));
  const body = functionBody(src, '_callAI');
  ok(body.length > 1000, 'the send function was found, so this has a subject', body.length);
  /* Scoped to the function it was IN. The first version of this asserted the
     bundle held no `slice(-20)` anywhere and failed on three unrelated ones -
     stored images, translation history, a handoff preview - none of which is
     the chat's memory. A check that fails on correct code somewhere else is a
     check somebody deletes. */
  ok(!/slice\(-20\)/.test(body),
     'the twenty-turn window is gone from the send path, not left beside the new one',
     /slice\(-20\)/.test(body));
  ok(/_ctxPrepare\(/.test(body),
     'and the turn prepares its context before building the request', true);
  ok(/_ctx\.brief/.test(body),
     'with the brief actually travelling in the payload', true);
  ok(/_ctx\.from/.test(body),
     'and the history starting where the brief leaves off', true);
}

section('The Build surface remembers what it was asked, which it never did');
{
  /* Dev's prompt was the project files plus the sentence you just typed.
     `_DEV.log` was rendered and used for handoffs and never sent, so the
     second request in any session arrived without the first. */
  const r = await page.evaluate(async () => {
    setTab('dev');
    await new Promise(s => setTimeout(s, 350));
    _DEV.log = []; _DEV.compact = null; _DEV.project = {};
    _DEV.log.push({ role: 'user', text: 'Build a landing page for a coffee brand' });
    _DEV.log.push({ role: 'ai', text: 'Built it with a hero and a signup button.' });
    /* A snag is transient and is not part of what was decided. */
    _DEV.log.push({ role: 'ai', text: '', _snag: 'Could not reach the engine' });
    const hist = await _ctxDevHistory();
    return { hist,
             hasFirst: /landing page for a coffee brand/.test(hist),
             hasReply: /hero and a signup button/.test(hist),
             hasSnag: /Could not reach the engine/.test(hist) };
  });
  ok(r.hasFirst && r.hasReply,
     'what was asked and what was done both travel with the next request', r.hist.slice(0, 90));
  ok(!r.hasSnag,
     'and a transient failure does not, because it is not part of the work', r.hasSnag);

  const empty = await page.evaluate(async () => {
    _DEV.log = []; _DEV.compact = null;
    return await _ctxDevHistory();
  });
  ok(empty === '',
     'a first build is not prefixed with an empty heading', JSON.stringify(empty));

  const wired = await page.evaluate(() => true);
  const devBody = functionBody(codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8')), '_devSend');
  ok(/_ctxDevHistory\(/.test(devBody),
     'and the Build turn actually puts it in the prompt', wired);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-long-chat-keeps-going') > 0) process.exitCode = 1;
done();
