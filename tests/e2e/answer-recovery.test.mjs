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
  AMV_API.base = 'https://api.test'; AMV_API.token = 'tok';
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

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
