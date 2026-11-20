/* A CUT-OFF ANSWER NEVER ACTS, AND THE TIME LIMIT HOLDS BEFORE EVERY EFFECT
   (Build 16 audit AG-05, AG-06, Nov 20).

   The audit drove the agent loop with streams that ended early: a tool call
   whose arguments had not all arrived was run with {}, and words cut off
   part way were reported as done. And a model that answered after the time
   limit still had its tool run. Here the real loop runs on the page against
   streams the test writes, event by event. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await app.connect();
await app.stubFetch(async (u, o) => {
  if (/\/v1\/messages/.test(u)) {
    const plan = window.__plan.shift() || { text: 'Done.', stop: 'end_turn' };
    if (plan.delay) await new Promise(r => setTimeout(r, plan.delay));
    if (plan.clock) window.__clock += plan.clock;
    const ev = (d) => 'data: ' + JSON.stringify(d) + '\n\n';
    let s = ev({ type: 'message_start', message: { usage: { input_tokens: 5 } } });
    s += ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    s += ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: plan.text || '' } });
    s += ev({ type: 'content_block_stop', index: 0 });
    (plan.tools || []).forEach((t, i) => {
      s += ev({ type: 'content_block_start', index: i + 1, content_block: { type: 'tool_use', id: t.id || ('tu' + i), name: t.name } });
      s += ev({ type: 'content_block_delta', index: i + 1, delta: { type: 'input_json_delta', partial_json: t.raw !== undefined ? t.raw : JSON.stringify(t.input) } });
      if (!plan.cut) s += ev({ type: 'content_block_stop', index: i + 1 });
    });
    if (plan.error) s += ev({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } });
    if (!plan.cut) { s += ev({ type: 'message_delta', delta: { stop_reason: plan.stop || 'end_turn' }, usage: { output_tokens: 3 } }); s += ev({ type: 'message_stop' }); }
    return new Response(s, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});

const run = (plan, extra = {}) => page.evaluate(async ({ plan, extra }) => {
  window.__plan = plan; window.__ran = []; window.__clock = 0;
  const realNow = Date.now; const t0 = realNow();
  if (extra.clock) Date.now = () => realNow() + window.__clock;
  try {
    const out = await aiAgentLoop({ prompt: 'Save a note', noLang: true, wallMs: extra.wallMs, maxRounds: 4,
      tools: [{ name: 'save_note', description: 'Save a note', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
      runTool: async (name, input) => { window.__ran.push({ name, input }); return { ok: true, text: 'saved' }; } });
    return { why: out.why, text: out.text, ran: window.__ran, sent: window.__plan.length, steps: (out.steps || []).map(s => ({ ok: s.ok, refused: !!s.refused, detail: s.detail })) };
  } catch (e) {
    return { error: e.code || e.message, partial: e.partial, ran: window.__ran };
  } finally { Date.now = realNow; }
}, { plan, extra });

section('A stream that ends before the model said it ended');
{
  let r = await run([{ text: 'Saving it', stop: 'tool_use', tools: [{ name: 'save_note', raw: '{"text":"buy mi' }], cut: true }]);
  ok(r.error === 'stream_incomplete' && r.ran.length === 0, 'a tool call cut off part way is never run', r);
  r = await run([{ text: 'The answer is that you should', cut: true }]);
  ok(r.error === 'stream_incomplete' && r.partial === 'The answer is that you should', 'words cut off are an interruption carrying what arrived, not "done"', r);
  r = await run([{ text: 'x', stop: 'something_else' }]);
  ok(r.error === 'stream_incomplete', 'a reason the protocol does not have is not an ending either', r);
  r = await run([{ text: 'Saving', stop: 'tool_use', tools: [{ name: 'save_note', input: { text: 'milk' } }], error: true }]);
  ok(r.error && r.ran.length === 0, 'an error part way through stops it before anything runs', r);
}

section('A call that is not well formed is answered, not run');
{
  let r = await run([
    { text: 'Saving', stop: 'tool_use', tools: [{ name: 'save_note', raw: '{"text": milk}' }] },
    { text: 'Again', stop: 'tool_use', tools: [{ name: 'save_note', input: { text: 'milk' } }] },
    { text: 'Saved.', stop: 'end_turn' }]);
  ok(r.ran.length === 1 && r.ran[0].input.text === 'milk', 'arguments that are not JSON are never run as {}; the corrected call runs once', r);
  ok(r.steps[0].refused && /not valid JSON/.test(r.steps[0].detail), 'and the model was told why', r.steps);
  r = await run([
    { text: 'Saving', stop: 'tool_use', tools: [{ name: 'save_note', input: {} }] },
    { text: 'Done.', stop: 'end_turn' }]);
  ok(r.ran.length === 0 && /missing text/.test(r.steps[0].detail), 'a required field that is missing: not run', r);
  r = await run([
    { text: 'Saving', stop: 'tool_use', tools: [{ name: 'save_note', id: 'same', input: { text: 'a' } }, { name: 'save_note', id: 'same', input: { text: 'b' } }] },
    { text: 'Done.', stop: 'end_turn' }]);
  ok(r.ran.length === 1 && r.ran[0].input.text === 'a', 'a second call under the same id is not run', r);
  r = await run([{ text: 'Saving', stop: 'tool_use', tools: [{ name: 'save_note', input: { text: 'milk' } }] }, { text: 'Saved.', stop: 'end_turn' }]);
  ok(r.why === 'done' && r.ran.length === 1, 'a complete, valid call runs exactly once', r);
}

section('The time limit is checked before every effect');
{
  const r = await run([{ text: 'Saving', stop: 'tool_use', clock: 5000, tools: [{ name: 'save_note', input: { text: 'milk' } }] }], { clock: true, wallMs: 1000 });
  ok(r.why === 'time' && r.ran.length === 0, 'a model that answers after the limit has passed does not get its tool run', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
