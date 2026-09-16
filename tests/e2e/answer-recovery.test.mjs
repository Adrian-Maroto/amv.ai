/* RECOVERY, FROM THE APP'S SIDE - when a stream stalls, the model may already
   have finished on the server. Those tokens are paid for either way, so the
   app asks for the answer back instead of showing an error and making the user
   regenerate the whole thing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

const FULL = 'Here is the complete answer that finished on the server. '.repeat(6);

section('A stalled stream recovers the finished answer instead of failing');
const recovered = await page.evaluate(async (full) => {
  window.__amvStreamIdleMs = 250;
  AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 'tok';
  S.busy = false;
  let askedResume = 0;
  window.fetch = async (u) => {
    if (String(u).includes('/v1/resume')) {
      askedResume++;
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, text: full }) };
    }
    // A stream that opens, says nothing, and never closes.
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: new ReadableStream({ start() {} }) };
  };
  document.getElementById('mta').value = 'a hard question';
  sendMsg();
  await new Promise(r => setTimeout(r, 2500));
  const msgs = getMsgs(); const last = msgs[msgs.length - 1];
  return { askedResume, text: last && last.c, err: last && last._error,
           recovered: !!(last && last._recovered), interrupted: !!(last && last._interrupted),
           notice: !!document.querySelector('.ai-recovered'), busy: S.busy };
}, FULL);
ok(recovered.askedResume > 0, 'the app asks the server for the answer it lost', recovered.askedResume);
ok(recovered.text === FULL, 'and gets the complete answer, not a fragment', (recovered.text || '').length + ' chars');
ok(!recovered.err, 'so the user never sees an error at all', recovered.err);
ok(recovered.recovered === true, 'it is marked as recovered');
ok(recovered.interrupted === false, 'and NOT as cut off - it is a complete answer');
ok(recovered.notice === true, 'with a line explaining why it arrived that way');
ok(recovered.busy === false, 'and AMV stops working');

section('The turn carries an id the server can park the answer under');
const sentId = await page.evaluate(async () => {
  let seen = null;
  window.__amvStreamIdleMs = 250;
  S.busy = false; newChat();
  window.fetch = async (u, o) => {
    if (String(u).includes('/v1/resume')) return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: false }) };
    seen = (o && o.headers && o.headers['X-AMV-Request-Id']) || null;
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n')); } }) };
  };
  document.getElementById('mta').value = 'hello';
  sendMsg();
  // Long enough to outlast the recovery poll, so the turn has actually settled.
  await new Promise(r => setTimeout(r, 4500));
  return seen;
});
ok(typeof sentId === 'string' && sentId.length >= 6, 'a request id is sent with every turn', sentId);
ok(/^[A-Za-z0-9_-]+$/.test(sentId || ''), 'in the shape the server will accept', sentId);

section('When nothing was parked, the partial answer is still kept');
const partial = await page.evaluate(async () => {
  const msgs = getMsgs(); const last = msgs[msgs.length - 1];
  return { text: last && last.c, interrupted: !!(last && last._interrupted), recovered: !!(last && last._recovered) };
});
ok(/partial/.test(partial.text || ''), 'what did arrive is not thrown away', partial.text);
ok(partial.interrupted === true, 'and it is honestly marked as cut off');
ok(partial.recovered === false, 'not claimed as recovered when nothing was');

section('Recovery failing never becomes the error the user sees');
const resilient = await page.evaluate(async () => {
  window.__amvStreamIdleMs = 250;
  S.busy = false; newChat();
  window.fetch = async (u) => {
    if (String(u).includes('/v1/resume')) throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: new ReadableStream({ start() {} }) };
  };
  document.getElementById('mta').value = 'another question';
  sendMsg();
  await new Promise(r => setTimeout(r, 4500));
  const msgs = getMsgs(); const last = msgs[msgs.length - 1];
  return { err: last && last._error, busy: S.busy };
});
ok(/stalled|offline/i.test(resilient.err || ''), 'the user is told the stream stalled, the real problem', resilient.err);
ok(!/resume|Failed to fetch/i.test(resilient.err || ''), 'not about the recovery attempt that also failed', resilient.err);
ok(resilient.busy === false, 'and it stops rather than hanging');

section('A stream that is cut and closed says so, instead of looking finished');
{
  /* `_stalled` was set only when the reader TIMED OUT - silence for IDLE_MS
     with text already in hand, which is the case every section above is about.
     A stream that is cut and then CLOSED does not time out: read() returns
     done, the loop breaks on the ordinary path, and the half-sentence that
     arrived is rendered as a finished answer with nothing to say otherwise.
     That is the common shape of a dropped upstream, a proxy timeout, or a
     worker dying mid-answer - and the machinery to report it already existed,
     it was simply never reached from this direction.

     The two cases are told apart by whether the producer said it had finished,
     not by how the socket behaved: a terminal event or [DONE] means concluded,
     and its absence means cut off. */
  const sse = (evts) => evts.map(e => 'event: ' + e.e + '\ndata: ' + JSON.stringify(e.d) + '\n\n').join('');
  const HEAD = [
    { e: 'message_start', d: { type: 'message_start', message: { id: 'm', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } } },
    { e: 'content_block_start', d: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { e: 'content_block_delta', d: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The answer is ' } } },
  ];
  const run = (body) => page.evaluate(async (b) => {
    window.__amvStreamIdleMs = 8000;            // long, so nothing here is a stall
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 'tok';
    S.busy = false; setMsgs([]);
    /* Three sends in a row from one page trips AMV's own send-rate guard, and
       "Slow down a moment before sending again" is not the stream under test.
       Cleared between cases so each one measures the stream it was given. */
    try { AEGIS._lastSend = 0; AEGIS._times = []; } catch (e) {}
    window.fetch = async (u) => {
      if (String(u).includes('/v1/resume'))
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, text: '' }) };
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(b)); c.close(); } }) };
    };
    document.getElementById('mta').value = 'a question';
    try { await sendMsg(); } catch (e) {}
    for (let i = 0; i < 40 && S.busy; i++) await new Promise(r => setTimeout(r, 150));
    await new Promise(r => setTimeout(r, 300));
    const m = getMsgs(); const last = m[m.length - 1] || {};
    const cm = document.getElementById('cm');
    return { text: String(last.c || ''), interrupted: !!last._interrupted,
             banner: !!cm.querySelector('.ai-cut'),
             retry: !!cm.querySelector('.ai-cut .ai-snag-retry') };
  }, body);

  const cut = await run(sse(HEAD));
  ok(cut.text === 'The answer is ', 'what arrived is kept, not thrown away', JSON.stringify(cut.text));
  ok(cut.interrupted === true, 'and it is marked as cut off rather than finished', cut);
  ok(cut.banner === true, 'so the screen says the connection dropped partway through', cut);
  ok(cut.retry === true, 'with a way to ask again right there', cut);

  /* A provider error arriving mid-stream ends the stream the same way, and the
     half-answer before it is no more finished than any other half-answer. */
  const boom = await run(sse([...HEAD,
    { e: 'error', d: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }]));
  ok(boom.interrupted === true, 'an overloaded error mid-stream is cut off too', boom);

  /* AND THE OTHER HALF, which is what stops this being "mark everything cut
     off": a stream that concludes properly must stay unmarked, or the banner
     appears on every healthy answer and stops meaning anything. */
  const whole = await run(sse([...HEAD,
    { e: 'content_block_delta', d: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'forty-two.' } } },
    { e: 'content_block_stop', d: { type: 'content_block_stop', index: 0 } },
    { e: 'message_delta', d: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } } },
    { e: 'message_stop', d: { type: 'message_stop' } }]));
  ok(whole.text === 'The answer is forty-two.', 'a complete answer arrives complete', whole.text);
  ok(whole.interrupted === false, 'and is NOT marked cut off', whole);
  ok(whole.banner === false, 'so the banner means something when it does appear', whole);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
