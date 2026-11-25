/* WHAT YOU TYPE WHILE IT WORKS JOINS THE TURN - AT ITS NEXT STEP, NOT AFTER.

   Build queued a message typed during an agent turn and sent it only once the
   whole job had ended - a job that can run twenty rounds. The leading agent
   workspaces dropped that queue this year: a follow-up joins the running turn
   at its next safe point. So does AMV's, now (owner, Nov 25).

   The safe point is the boundary between rounds: after every tool in a round
   has finished, never between two halves of one step. Driven through the real
   engine (aiAgentLoop) and the real Build surface (_devSendAgent), with only
   the model and the computer stood in for:

   - a message typed during a step reaches the model with the NEXT request,
     after that round's tool results, marked as the person's;
   - one typed while it writes its final answer keeps the turn going rather
     than waiting behind it;
   - one handed in but never read - Stop, the round limit - comes back to be
     sent after, never swallowed;
   - nothing is taken when there is no next round to read it;
   - the screen says where it went: "joins this turn at its next step" while
     it waits, and "You added" in the steps where it joined, escaped. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await app.connect();

/* The engine against a stubbed model. `script[i]` is round i's reply; a
   function in it runs while that round's tool runs or while the reply is
   read. Every request body is recorded. */
const run = (spec) => page.evaluate(async (spec) => {
  const bodies = [], queue = [];
  let round = 0, stopNow = false;
  window.fetchDeadline = async (_u, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, status: 200, headers: { get: () => '' }, body: null }; };
  window._aiReadStream = async () => {
    round++;
    if (spec.typeWhileAnswering === round) queue.push(spec.text);
    if (spec.stopAfterRound === round) stopNow = true;
    if (round === 1) return { content: [{ type: 'text', text: 'Writing it.' }, { type: 'tool_use', id: 't1', name: 'write_file', input: { path: 'a.txt', content: 'x' } }], stop_reason: 'tool_use', usage: {} };
    return { content: [{ type: 'text', text: 'Done after round ' + round + '.' }], stop_reason: 'end_turn', usage: {} };
  };
  const steered = [];
  let out, thrown = null;
  try {
    out = await aiAgentLoop({
      prompt: 'make a page', maxRounds: spec.maxRounds || 6,
      tools: [{ name: 'write_file', description: 'd', input_schema: { type: 'object' } }],
      runTool: async () => { if (spec.typeDuringStep) queue.push(spec.text); if (spec.stopDuringStep) stopNow = true; return { ok: true, text: 'wrote a.txt' }; },
      steer: () => queue.splice(0, queue.length),
      stopped: () => stopNow,
      onStep: (ev) => { if (ev.phase === 'steered') { steered.push(ev.texts); if (spec.stopOnSteer) stopNow = true; } },
    });
  } catch (e) { thrown = String(e && e.message || e); }
  return { bodies, steered, left: queue.slice(), thrown,
           out: out && { rounds: out.rounds, why: out.why, unanswered: out.unanswered, text: out.text } };
}, spec);

section('Typed during a step: it reaches the model with the next request');
{
  const r = await run({ typeDuringStep: true, text: 'make it blue' });
  ok(r.out && r.out.rounds === 2 && r.out.why === 'done', 'the same turn carried on to its end', r.out);
  const last = r.bodies[1] && r.bodies[1].messages[r.bodies[1].messages.length - 1];
  const parts = last && Array.isArray(last.content) ? last.content : [];
  ok(parts.length === 2 && parts[0].type === 'tool_result' && parts[1].type === 'text',
     'after the round’s tool results - not in the middle of a step', parts.map(p => p.type));
  ok(parts[1] && /"make it blue"/.test(parts[1].text) && /While you were working, I added/.test(parts[1].text),
     'in the person’s own words, marked as theirs', parts[1] && parts[1].text);
  ok(!JSON.stringify(r.bodies[0]).includes('make it blue'), 'and not in the request that was already in the air');
  ok(r.steered.length === 1 && r.left.length === 0 && r.out.unanswered.length === 0, 'taken once, read, nothing left over', r);
}

section('Typed while it writes its final answer: the turn keeps going');
{
  const r = await run({ typeWhileAnswering: 2, text: 'also add a footer' });
  ok(r.out && r.out.rounds === 3, 'a third round answered it, rather than ending', r.out);
  const last = r.bodies[2].messages[r.bodies[2].messages.length - 1];
  ok(typeof last.content === 'string' && /"also add a footer"/.test(last.content), 'with the message as the next thing to do', last.content);
  ok(r.out.unanswered.length === 0 && r.left.length === 0, 'and nothing waits behind it', r);
}

section('Stopped: nothing typed is lost');
{
  const r = await run({ typeDuringStep: true, stopDuringStep: true, text: 'use a serif font' });
  ok(r.out && r.out.why === 'stopped', 'Stop still stops', r.out);
  ok(r.steered.length === 0 && JSON.stringify(r.left) === JSON.stringify(['use a serif font']),
     'after Stop nothing is taken, so the message is still waiting to be sent', r);
  const h = await run({ typeDuringStep: true, stopOnSteer: true, text: 'use a serif font' });
  ok(h.out && h.out.why === 'stopped' && h.bodies.length === 1, 'stopped just after it was handed in: no round read it', h.out);
  ok(JSON.stringify(h.out.unanswered) === JSON.stringify(['use a serif font']),
     'so it comes back as unanswered rather than vanishing', h.out.unanswered);
}

section('No next round to read it: it is not taken at all');
{
  const r = await run({ typeDuringStep: true, maxRounds: 1, text: 'and a logo' });
  ok(r.out && r.out.why === 'rounds', 'the round limit ended it', r.out);
  ok(JSON.stringify(r.left) === JSON.stringify(['and a logo']) && r.steered.length === 0,
     'the message stayed in the queue, so it is sent after', r);
}

section('On the Build screen: what it says while waiting, and where it joined');
{
  const r = await page.evaluate(async () => {
    document.getElementById('ck')?.remove();
    _setPlan('ultra'); setTab('dev');
    await new Promise(x => setTimeout(x, 450));
    _DEV.queue = []; _DEV.log = []; _DEV.busy = true;
    const bodies = [];
    let round = 0, waitingLine = '';
    window.fetchDeadline = async (_u, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, status: 200, headers: { get: () => '' }, body: null }; };
    window._aiReadStream = async () => {
      round++;
      if (round === 1) return { content: [{ type: 'tool_use', id: 't1', name: 'write_file', input: { path: 'index.html', content: '<h1>hi</h1>' } }], stop_reason: 'tool_use', usage: {} };
      return { content: [{ type: 'text', text: 'Done - it is blue now.' }], stop_reason: 'end_turn', usage: {} };
    };
    const real = { consent: window._agentConsent, tool: window._agentRunTool, offered: window.bridgeToolsOffered };
    window._agentConsent = async () => true;
    window.bridgeToolsOffered = () => [{ name: 'write_file', description: 'd', input_schema: { type: 'object' } }];
    window._agentRunTool = async () => {
      /* The person types and presses Enter while this step runs. */
      const ta = document.getElementById('dev-msg');
      ta.value = 'make it blue <img src=x onerror="window.__xss=1">';
      await _devSend();
      waitingLine = (document.getElementById('dev-queue').innerText || '');
      return { ok: true, text: 'wrote index.html' };
    };
    const wasConnected = BRIDGE.connected; BRIDGE.connected = true;
    try { await _devSendAgent('make a page', null); }
    finally {
      window._agentConsent = real.consent; window._agentRunTool = real.tool; window.bridgeToolsOffered = real.offered;
      BRIDGE.connected = wasConnected; _DEV.busy = false;
    }
    _devRenderLog();
    await new Promise(x => setTimeout(x, 100));
    const joined = document.querySelector('#dev-log .ags-joined');
    /* The agent round that answered the step: its last message holds the tool result. */
    const after = bodies.find(b => { if (!b || !Array.isArray(b.messages)) return false; const m = b.messages[b.messages.length - 1]; return Array.isArray(m.content) && m.content.some(p => p.type === 'tool_result'); });
    const last = after ? after.messages[after.messages.length - 1] : { content: [] };
    return {
      waitingLine, rounds: round,
      secondHas: JSON.stringify(last.content).includes('make it blue') && last.content[0].type === 'tool_result',
      joinedText: joined ? joined.innerText : '',
      joinedImg: joined ? !!joined.querySelector('img') : null,
      xss: !!window.__xss,
      queueLeft: _DEV.queue.length,
      queueHidden: document.getElementById('dev-queue').hidden,
    };
  });
  ok(/Joins this turn at its next step/.test(r.waitingLine), 'while it waits, the queue says it joins this turn', r.waitingLine);
  ok(r.rounds === 2 && r.secondHas, 'the next request carried it', r);
  ok(/You added/i.test(r.joinedText) && /make it blue/.test(r.joinedText), 'the steps show "You added" where it joined', r.joinedText);
  ok(r.joinedImg === false && r.xss === false, 'their words are shown as text, never as markup', r);
  ok(r.queueLeft === 0 && r.queueHidden === true, 'and it is no longer waiting', r);
}

section('Requeued words go back to the front and come off the steps');
{
  const r = await page.evaluate(() => {
    _DEV.queue = ['typed later'];
    _AGENT.steps = [{ name: 'write_file', input: { path: 'a' }, ok: true }, { name: '_joined', input: {}, ok: true, detail: 'first thought' }];
    _agentRequeue(['first thought']);
    return { queue: _DEV.queue.slice(), steps: _AGENT.steps.map(s => s.name) };
  });
  ok(JSON.stringify(r.queue) === JSON.stringify(['first thought', 'typed later']), 'ahead of anything typed since', r.queue);
  ok(JSON.stringify(r.steps) === JSON.stringify(['write_file']), 'and its "You added" line is gone, because it joined nothing', r.steps);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
