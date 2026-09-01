/* THE FIVE SURFACES THAT COULD NEVER HAVE WORKED.

   `/v1/messages` has exactly one success path and it returns
   `text/event-stream`. Not conditionally - the handler writes `stream: true`
   into the upstream body as a literal and never reads what the caller asked
   for. Chat knew that and reads the events.

   Everything that is not chat goes through `aiComplete` or `aiCompleteLong`,
   and both did `await res.json()`. On a body of `data: {...}` lines that
   throws before the first word. Build, Design, Crew, the agents, the accuracy
   pass and the translation cache were all, in production, on every call,
   parsing a stream as an object and failing.

   The reason it survived is the whole point of this file. Every browser suite
   stubs `fetch` and hands back a JSON object, so the parse always succeeded
   and the tests proved the stub. The one suite that drives the real Worker
   posts with `fetch` directly and reads `r.text()`, so it exercised the
   handler and never these two functions. Two correct halves, never introduced.

   So this runs the real Worker, streams a real SSE turn back through it, and
   then calls the engine functions THE APP USES - not fetch. That is the only
   arrangement in which the defect is visible, and it is the arrangement
   nobody had.

   It also covers what only a stream can get wrong: a turn that arrives in
   many small pieces, a tool call whose arguments are split across events,
   and an error that arrives after a 200 has already been sent. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

/* THE RULE, CHECKED STRUCTURALLY, BEFORE ANY BROWSER STARTS.

   The behavioural half of this file needs a real Worker and a real browser,
   which is slow and which only covers the callers somebody thought to drive.
   This half covers ALL of them, cheaply, and is what would have caught the
   third instance: `runAgentic`, a whole second tool loop with the same
   `res.json()` against the same streaming route, which nothing called and
   nothing therefore noticed.

   The rule is simple enough to state as one: any function that posts to
   `_aiBase()` is talking to a route that only ever answers with an event
   stream, so it must read it as one. */
{
  const bundle = codeOnly(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app.js'), 'utf8'));

  /* Which function each call to the proxy sits inside, found by walking back
     to the nearest top-level declaration rather than by testing every
     function in a 1.4MB bundle against a regex - that took long enough to be
     the slowest thing in the suite for no extra certainty. */
  const enclosing = (idx) => {
    const before = bundle.lastIndexOf('\nfunction ', idx);
    const beforeAsync = bundle.lastIndexOf('\nasync function ', idx);
    const at = Math.max(before, beforeAsync);
    if (at < 0) return null;
    const m = /^\n(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(bundle.slice(at, at + 80));
    return m ? m[1] : null;
  };
  const callers = [...new Set([...bundle.matchAll(/_aiBase\s*\(\s*\)/g)]
    /* Its own definition contains its own name followed by a paren. */
    .filter(m => !/function\s+$/.test(bundle.slice(Math.max(0, m.index - 20), m.index)))
    .map(m => enclosing(m.index))
    .filter(Boolean))];

  section('Nothing reads the streaming proxy as if it were an object');
  {
    ok(callers.length >= 3,
       'the functions that post to the AI proxy were found', callers.join(', '));
    const wrong = callers.filter(n => {
      const body = functionBody(bundle, n);
      /* Either it hands the response to the shared reader, or it reads the
         stream itself, which is what chat does. Anything else is the bug. */
      return !(/_aiReadStream\s*\(/.test(body) || /getReader\s*\(/.test(body));
    });
    ok(wrong.length === 0,
       'every one of them reads the response as the stream it is', wrong);
    /* Deliberately NOT "nothing calls .json()". Reading an ERROR body as JSON
       is correct - AMV's refusal envelope is JSON and chat depends on it - so
       banning the method would fail the one caller that was always right. The
       rule that separates the three real defects from that is whether the
       SUCCESS path reads a stream at all, which is what is asserted above. */
    ok(callers.every(n => (functionBody(bundle, n) || '').length > 0),
       'and every one of them was read as a whole function, not a fragment', callers.length);
  }
}

const MODEL = 'https://model.example';
const MRE = new RegExp(MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/* An SSE turn in the shape the provider really sends: a start with the input
   count, content blocks that arrive in pieces, a delta carrying the stop
   reason and the output count, then a stop. */
function sse(parts) {
  const out = [`data: ${JSON.stringify({ type: 'message_start', message: { model: 'test-engine', usage: { input_tokens: 11, output_tokens: 0 } } })}\n\n`];
  parts.blocks.forEach((b, i) => {
    if (b.text !== undefined) {
      out.push(`data: ${JSON.stringify({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } })}\n\n`);
      /* In pieces, because one chunk per block is the case that a naive reader
         also passes. Words are split mid-sentence on purpose. */
      for (const piece of String(b.text).match(/[\s\S]{1,7}/g) || []) {
        out.push(`data: ${JSON.stringify({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: piece } })}\n\n`);
      }
    } else {
      out.push(`data: ${JSON.stringify({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: b.id, name: b.name } })}\n\n`);
      const j = JSON.stringify(b.input);
      for (const piece of j.match(/[\s\S]{1,5}/g) || []) {
        out.push(`data: ${JSON.stringify({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: piece } })}\n\n`);
      }
    }
    out.push(`data: ${JSON.stringify({ type: 'content_block_stop', index: i })}\n\n`);
  });
  out.push(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: parts.stop || 'end_turn' }, usage: { output_tokens: 40 } })}\n\n`);
  out.push('data: {"type":"message_stop"}\n\n');
  return out.join('');
}
const stream = (parts) => new Response(sse(parts), {
  status: 200, headers: { 'Content-Type': 'text/event-stream' },
});

const outbound = makeOutbound();
const env = makeEnv({
  AMV_MODEL_KEY: 'test-model-key-never-real',
  MODEL_API_URL: MODEL,
  APP_URL: 'http://localhost:9201',
});

let mode = 'ok';
let longCalls = 0;
outbound.on(MRE, () => {
  if (mode === 'tool') {
    return stream({ blocks: [{ text: 'Let me look.' },
                             { id: 'tu_1', name: 'run_command', input: { command: 'npm test', cwd: 'app' } }],
                    stop: 'tool_use' });
  }
  if (mode === 'midstream-error') {
    return new Response(
      `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 3 } } })}\n\n`
      + `data: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'The engine is overloaded right now.' } })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (mode === 'silence') {
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (mode === 'continued') {
    /* The first pass is cut off at the token limit; the second finishes. This
       is how one build writes more than a single response can hold. */
    longCalls++;
    return longCalls === 1
      ? stream({ blocks: [{ text: 'line one\nline two' }], stop: 'max_tokens' })
      : stream({ blocks: [{ text: '\nline three' }], stop: 'end_turn' });
  }
  return stream({ blocks: [{ text: 'A real answer, assembled from a stream.' }] });
});

const L = await bootLive({ env, outbound, port: 9201 });
const { page } = L;

await page.evaluate(async () => {
  await AMV_API.signup('builder@example.com', 'Builder', 'A-real-Passw0rd!');
});

/* The functions the app actually calls. Nothing here reaches for fetch. */
const complete = (opts) => page.evaluate(async (o) =>
  await window.aiComplete('do the thing', 'you are a builder', o || {}), opts || {});
const completeLong = (opts) => page.evaluate(async (o) =>
  await window.aiCompleteLong('build the thing', 'you are a builder', o || {}), opts || {});
const caught = (fn) => fn().then(v => ({ ok: true, v }), e => ({ ok: false, m: String(e && e.message || e) }));

section('Build asks the real server a real question and gets words back');
{
  mode = 'ok';
  const r = await caught(() => complete({ max_tokens: 256 }));
  ok(r.ok === true, 'aiComplete resolves rather than throwing on the stream', r.m || 'resolved');
  ok(/assembled from a stream/.test(r.v || ''),
     'and returns the words, reassembled from every piece they arrived in', String(r.v).slice(0, 80));
  ok(outbound.sentTo(MRE).length === 1, 'having gone out through the server once', outbound.sentTo(MRE).length);
}

section('And so does the long form, including past one response’s limit');
{
  mode = 'continued'; longCalls = 0;
  const r = await caught(() => completeLong({ max_tokens: 64 }));
  ok(r.ok === true, 'aiCompleteLong resolves', r.m || 'resolved');
  ok(/line one/.test(r.v || '') && /line three/.test(r.v || ''),
     'and both passes are in the result, so a long build is not cut off', String(r.v).slice(0, 90));
  ok(longCalls === 2,
     'it really continued rather than stopping at the first stop_reason', longCalls);
}

section('A tool call survives being delivered in fragments');
{
  /* The agentic loop stands on this. Tool arguments arrive as JSON split
     across events, and a reader that parses each fragment - or keeps only the
     last - produces a command that is not the command the model asked for. */
  mode = 'tool';
  const r = await page.evaluate(async () => {
    const res = await fetch(AMV_API.base.replace(/\/$/, '') + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AMV_API.token },
      body: JSON.stringify({ model: 'amv-core', max_tokens: 256, messages: [{ role: 'user', content: 'run the tests' }] }),
    });
    const d = await window._aiReadStream(res);
    return { stop: d.stop_reason, blocks: d.content.map(b => ({ t: b.type, n: b.name, i: b.input })) };
  });
  ok(r.stop === 'tool_use', 'the turn is reported as ending in a tool call', r.stop);
  const call = r.blocks.find(b => b.t === 'tool_use');
  ok(!!call && call.n === 'run_command', 'the tool is named', call && call.n);
  ok(!!call && call.i && call.i.command === 'npm test' && call.i.cwd === 'app',
     'and its arguments are whole, not the last fragment of them', call && call.i);
  ok(r.blocks.some(b => b.t === 'text'),
     'with what it said alongside, not instead', r.blocks.map(b => b.t).join('+'));
}

section('An error that arrives after a 200 is still an error');
{
  /* The status line said fine and the stream then said otherwise. A caller
     that checks only res.ok sees a successful empty answer, which a surface
     renders as AMV having nothing to say. */
  mode = 'midstream-error';
  const r = await caught(() => complete({ max_tokens: 64 }));
  ok(r.ok === false, 'it throws rather than returning an empty success', r.ok);
  ok(/overloaded/i.test(r.m || ''),
     'and carries what the engine said, not a generic snag', r.m);
}

section('And a stream that says nothing at all is not an empty answer');
{
  mode = 'silence';
  const r = await caught(() => complete({ max_tokens: 64 }));
  ok(r.ok === false, 'a connection that died mid-turn is reported', r.ok);
  ok(/stalled|try again/i.test(r.m || ''), 'in words that say what to do', r.m);
}

section('What it cost is still metered, because the stream still flowed');
{
  await L.settle();
  const keys = [...env.AMV_KV._map.keys()];
  const spent = keys.filter(k => /^ctr:(tok|cost)/.test(k) && k.includes('builder@example.com'));
  ok(spent.length > 0,
     'Build turns are counted against the account like chat turns', spent.slice(0, 3));
}

await L.close();
if (report('every-surface-that-is-not-chat') > 0) process.exitCode = 1;
done();
