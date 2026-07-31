/* DEGRADED NETWORK - what the user sees when the connection goes bad mid-action.
   The dangerous case is not an outright failure, which the code already
   handles. It is a connection that STALLS: the socket stays open, no bytes
   arrive, and fetch() never settles. Nothing times out, so the spinner spins
   forever and the user cannot tell whether their action worked. These
   assertions cover the deadline on every API call and the deadline on a chat
   answer that is cut off halfway. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

section('Every API call has a deadline');
const hung = await page.evaluate(async () => {
  AMV_API.base = 'https://api.test'; AMV_API.token = 'tok';
  // a connection that accepts the request and then says nothing, ever
  window.fetch = (u, o) => new Promise((_, rej) => {
    if (o && o.signal) o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const t0 = Date.now();
  try {
    await AMV_API._fetch('/auth/ping', { timeout: 200 });   // /auth/ is never retried
    return { settled: true };
  } catch (e) {
    return { settled: true, ms: Date.now() - t0, msg: e.message };
  }
});
ok(hung.settled === true, 'a stalled request eventually gives up instead of hanging forever');
ok(hung.ms < 3000, 'and it gives up quickly, not after minutes', hung.ms + 'ms');
ok(/did not respond in time/i.test(hung.msg || ''), 'the message says the server did not respond', hung.msg);

section('Being offline says so, and does not burn retries first');
const off = await page.evaluate(async () => {
  let calls = 0;
  window.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  let msg = '';
  const t0 = Date.now();
  try { await AMV_API._fetch('/sync/pull', { method: 'POST', body: '{}' }); }
  catch (e) { msg = e.message; }
  const ms = Date.now() - t0;
  Object.defineProperty(navigator, 'onLine', real || { configurable: true, get: () => true });
  return { msg, calls, ms };
});
ok(/offline/i.test(off.msg), 'the error names the real problem: you are offline', off.msg);
ok(off.calls === 1, 'it does not silently retry a request that cannot possibly work', off.calls);
ok(off.ms < 1000, 'so the user is told immediately', off.ms + 'ms');

section('The deadline covers reading the body too, but never a stream');
const sig = await page.evaluate(async () => {
  const seen = [];
  window.fetch = async (u, o) => { seen.push(o && o.signal); return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) }; };
  await AMV_API._fetch('/auth/a', { bodyTimeout: 80 });          // ordinary call
  await AMV_API._fetch('/auth/b', { bodyTimeout: 80, stream: true }); // caller reads the stream itself
  await new Promise(r => setTimeout(r, 300));
  return { attached: seen.every(s => s && typeof s.aborted === 'boolean'),
           normalAborted: seen[0].aborted, streamAborted: seen[1].aborted };
});
ok(sig.attached === true, 'an abort signal is attached to every request');
ok(sig.normalAborted === true, 'a body that never arrives is aborted, so .json() cannot hang');
ok(sig.streamAborted === false, 'but a streamed response is left alone - it is meant to arrive slowly');

section('A chat answer cut off halfway keeps what arrived');
const cut = await page.evaluate(async () => {
  window.__amvStreamIdleMs = 300;
  AMV_API.base = 'https://api.test'; AMV_API.token = 'tok';
  S.busy = false;
  window.fetch = async (u) => {
    const sse = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"The first half of the answer"}}\n\n';
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); /* then silence, forever */ } });
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body };
  };
  document.getElementById('mta').value = 'hello';
  sendMsg();
  await new Promise(r => setTimeout(r, 2000));
  const msgs = getMsgs(); const last = msgs[msgs.length - 1];
  return {
    busy: S.busy,
    text: last && last.c,
    interrupted: !!(last && last._interrupted),
    streaming: !!(last && last.streaming),
    notice: !!document.querySelector('.ai-cut'),
    retry: !!document.querySelector('.ai-cut [data-action="retry-ai"]')
  };
});
ok(cut.busy === false, 'AMV stops thinking instead of spinning forever');
ok(cut.streaming === false, 'the message is no longer marked as still streaming');
ok(/first half of the answer/.test(cut.text || ''), 'the half that arrived is kept, not thrown away', cut.text);
ok(cut.interrupted === true, 'and it is recorded as cut off, not as a complete answer');
ok(cut.notice === true, 'the user is told the connection dropped partway through');
ok(cut.retry === true, 'with a Retry right there');

section('A stall before any text gives a real error, not an empty bubble');
const dead = await page.evaluate(async () => {
  window.__amvStreamIdleMs = 300;
  S.busy = false;
  window.fetch = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: new ReadableStream({ start() {} }) });   // opens, then nothing at all
  newChat();
  document.getElementById('mta').value = 'hello again';
  sendMsg();
  await new Promise(r => setTimeout(r, 2000));
  const msgs = getMsgs(); const last = msgs[msgs.length - 1];
  return { busy: S.busy, err: last && last._error, card: !!document.querySelector('.ai-snag-retry') };
});
ok(dead.busy === false, 'it does not stay busy');
ok(/stalled|offline/i.test(dead.err || ''), 'the error explains that the connection stalled', dead.err);
ok(dead.card === true, 'and offers Retry');

section('Sending while already offline never reaches the network');
const pre = await page.evaluate(async () => {
  const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  let called = 0;
  window.fetch = async () => { called++; throw new TypeError('Failed to fetch'); };
  S.busy = false; newChat();
  document.getElementById('mta').value = 'offline question';
  sendMsg();
  await new Promise(r => setTimeout(r, 600));
  const msgs = getMsgs(); const last = msgs[msgs.length - 1];
  Object.defineProperty(navigator, 'onLine', real || { configurable: true, get: () => true });
  return { called, err: last && last._error, busy: S.busy };
});
ok(pre.called === 0, 'AMV does not fire a request it knows cannot succeed', pre.called);
ok(/offline/i.test(pre.err || ''), 'it says you are offline', pre.err);
ok(pre.busy === false, 'and it stops, rather than waiting on nothing');

section('No network call is left without a deadline');
/* Read the shipped bundle rather than the sources: this is about what actually
   runs. Three call sites manage their own AbortController and are listed by
   name; everything else must go through _fetch or fetchDeadline. A new raw
   fetch() added later fails here instead of shipping a hang. */
const { readFileSync } = await import('fs');
const bundle = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const OWN_CONTROLLER = [
  "await fetch(url, ctrl ? Object.assign",            // inside _fetch
  "await fetch(url, ctrl ? Object.assign({}, o, { signal: ctrl.signal }) : o)", // inside fetchDeadline
  "/auth/refresh'",                                   // _doRefresh - 12s timeout of its own
  "'/health',{signal:ctrl.signal}",                   // reachability probe - 4s of its own
  "res=await fetch(_endpoint,",                       // chat stream - 45s + idle guard
];
const raw = bundle.split('\n')
  .map((l, i) => ({ n: i + 1, l }))
  .filter(x => /(?:await |= )fetch\(/.test(x.l))
  .filter(x => !OWN_CONTROLLER.some(a => x.l.includes(a)))
  .filter(x => !/fetch\(req\)|fetch\(pic\)|fetch\(p\.picture\)/.test(x.l));   // cache race + avatar, no UI waits on them
ok(raw.length === 0, 'every network call has a deadline or its own abort controller',
   raw.slice(0, 5).map(x => x.n + ': ' + x.l.trim().slice(0, 70)));

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
