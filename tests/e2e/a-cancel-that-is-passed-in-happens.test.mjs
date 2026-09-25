/* A CANCEL THAT IS PASSED IN IS A CANCEL THAT HAPPENS.  (AMV-AUD-014)

   Both network wrappers - `fetchDeadline` and `AMV_API._fetch` - build their
   own AbortController for the deadline and hand fetch ITS signal, which
   silently replaced any signal the caller passed. A cancelled request went on:
   the model kept generating and billing, and a retry could send it again after
   it was cancelled. An already-cancelled signal was never even looked at.

   And the one Stop button that matters most did not use a signal at all: the
   agent that works on somebody's computer checked its stop flag between
   rounds, so Stop waited out the round in the air - up to three minutes of a
   model writing an answer nobody would read.

   Driven in the page with `fetch` replaced by one that behaves like the real
   thing about signals: it rejects when its signal aborts, before the headers
   or while the body streams. The questions are all "did the request that went
   out get cancelled", not "did the wrapper throw". */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* A fetch that honours its signal the way the browser's does, records every
   call, and can be told to answer, stall, or stream for ever. */
await page.evaluate(() => {
  window.__calls = [];
  window.__mode = 'stall';
  window.__realFetch = window.fetch;
  window.fetch = (url, init) => {
    const sig = init && init.signal;
    const call = { url: String(url), signal: sig, abortedAt: null };
    window.__calls.push(call);
    if (sig) sig.addEventListener('abort', () => { call.abortedAt = Date.now(); });
    const abortErr = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };
    if (sig && sig.aborted) return Promise.reject(abortErr());
    /* A queue of modes, one per call, for "fail twice, then stall". */
    if (Array.isArray(window.__modes) && window.__modes.length) window.__mode = window.__modes.shift();
    /* Retry-After: 3 makes the backoff three seconds, so "the cancel ended the
       wait" and "the wait ran out" are seconds apart rather than milliseconds. */
    if (window.__mode === '503') return Promise.resolve(new Response('{}', { status: 503, headers: { 'Retry-After': '3' } }));
    if (window.__mode === 'stream') {
      /* Headers now; a body that never finishes unless the signal ends it. */
      const body = new ReadableStream({ start(c) {
        c.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"usage":{}}}\n\n'));
        if (sig) sig.addEventListener('abort', () => { try { c.error(abortErr()); } catch (e) {} });
      } });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    }
    return new Promise((_, rej) => { if (sig) sig.addEventListener('abort', () => rej(abortErr())); });
  };
});

section('fetchDeadline: a signal already cancelled sends nothing');
{
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__mode = 'stall';
    const c = new AbortController(); c.abort();
    try { await fetchDeadline('https://x.example/a', { signal: c.signal }, 30000); return { threw: null }; }
    catch (e) { return { threw: e.name, calls: window.__calls.length }; }
  });
  ok(r.threw === 'AbortError', 'it says cancelled', r);
  ok(r.calls === 0, 'and no request went out', r);
}

section('fetchDeadline: cancelling while waiting for the headers cancels the request that went out');
{
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__mode = 'stall';
    const c = new AbortController();
    setTimeout(() => c.abort(), 80);
    const t0 = Date.now();
    let name = '', msg = '';
    try { await fetchDeadline('https://x.example/b', { signal: c.signal }, 30000); }
    catch (e) { name = e.name; msg = e.message; }
    return { name, msg, ms: Date.now() - t0, sent: !!(window.__calls[0] && window.__calls[0].signal && window.__calls[0].signal.aborted) };
  });
  ok(r.sent === true, 'the signal fetch was given is aborted - this was the finding', r);
  ok(r.name === 'AbortError' && !/did not respond/.test(r.msg),
     'and it is reported as a cancel, not as the server failing to answer', r);
  ok(r.ms < 5000, 'at once, not at the thirty-second deadline', r.ms);
}

section('fetchDeadline: cancelling while the body streams stops the stream');
{
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__mode = 'stream';
    const c = new AbortController();
    const res = await fetchDeadline('https://x.example/c', { signal: c.signal, stream: true }, 30000);
    setTimeout(() => c.abort(), 80);
    let name = '';
    try { const rd = res.body.getReader(); for (;;) { const s = await rd.read(); if (s.done) break; } }
    catch (e) { name = e.name; }
    return { name, aborted: window.__calls[0].signal.aborted };
  });
  ok(r.aborted === true && r.name === 'AbortError', 'the body read ends with the cancel', r);
}

section('AMV_API: a cancel during the backoff is not retried');
{
  const r = await page.evaluate(async () => {
    window._defaultApiBase = () => 'https://api.example.workers.dev';
    saveStr('amv_api_base', '');
    window.__calls = []; window.__mode = '503';
    const c = new AbortController();
    setTimeout(() => c.abort(), 150);                 // inside the three-second backoff
    let name = '';
    const t0 = Date.now();
    try { await AMV_API._fetch('/sync/pull', { method: 'POST', body: '{}', signal: c.signal }); }
    catch (e) { name = e.name; }
    const ms = Date.now() - t0;
    await new Promise(res => setTimeout(res, 3500)); // long enough for any retry to have gone out
    return { name, ms, calls: window.__calls.length };
  });
  ok(r.name === 'AbortError', 'the caller is told it was cancelled', r);
  ok(r.ms < 1500, 'when the cancel happens, not when the backoff would have ended', r.ms);
  ok(r.calls === 1, 'and the request is never sent again after the cancel', r);
}

section('AMV_API: cancelling while waiting for the headers cancels the request that went out');
{
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__mode = 'stall';
    const c = new AbortController();
    setTimeout(() => c.abort(), 80);
    let name = '';
    const t0 = Date.now();
    try { await AMV_API._fetch('/sync/pull', { method: 'POST', body: '{}', signal: c.signal }); }
    catch (e) { name = e.name; }
    const ms = Date.now() - t0;
    await new Promise(res => setTimeout(res, 1500));
    return { name, ms, calls: window.__calls.length, aborted: !!(window.__calls[0] && window.__calls[0].signal.aborted) };
  });
  ok(r.aborted === true && r.name === 'AbortError', 'the request in the air is aborted and reported as a cancel', r);
  /* The first version of this section had no clock, and a mutation that
     dropped the caller's signal passed it: the request was aborted twenty
     seconds later by its own header deadline, and the loop's "was this
     cancelled?" check then reported that as the cancel. */
  ok(r.ms < 5000, 'by the cancel, not by the twenty-second header deadline', r.ms);
  ok(r.calls === 1, 'and not retried as if it were a network failure', r);
}

section('AMV_API: a cancel on the LAST attempt is still called a cancel');
{
  /* Two 503s use up the retries; the third attempt stalls and is cancelled.
     With no retry left, a cancel that is not recognised as one falls through
     to "Network error - please check your connection", which sends somebody
     to check a connection that is fine. */
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__modes = ['503', '503', 'stall'];
    const c = new AbortController();
    const watch = setInterval(() => { if (window.__calls.length === 3) { clearInterval(watch); setTimeout(() => c.abort(), 50); } }, 20);
    let name = '', msg = '';
    try { await AMV_API._fetch('/sync/pull', { method: 'POST', body: '{}', signal: c.signal }); }
    catch (e) { name = e.name; msg = e.message; }
    clearInterval(watch); window.__modes = null;
    return { name, msg, calls: window.__calls.length };
  });
  ok(r.calls === 3 && r.name === 'AbortError' && !/network error/i.test(r.msg),
     'it is reported as cancelled, not as a network error', r);
}

section('AMV_API: a signal already cancelled sends nothing');
{
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__mode = 'stall';
    const c = new AbortController(); c.abort();
    let name = '';
    try { await AMV_API._fetch('/sync/pull', { method: 'POST', body: '{}', signal: c.signal }); }
    catch (e) { name = e.name; }
    return { name, calls: window.__calls.length };
  });
  ok(r.name === 'AbortError' && r.calls === 0, 'cancelled before dispatch, nothing dispatched', r);
}

section('Signing out cancels what the account still had in the air, and not its own logout');
{
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__mode = 'stall';
    let name = '', settledAt = 0;
    const t0 = Date.now();
    const inAir = AMV_API._fetch('/sync/pull', { method: 'POST', body: '{}' }).catch(e => { name = e.name; settledAt = Date.now(); });
    await new Promise(res => setTimeout(res, 30));
    const order = [];
    const realAbort = AMV_API.abortAll.bind(AMV_API), realLogout = AMV_API.logout;
    AMV_API.abortAll = () => { order.push('abortAll'); return realAbort(); };
    AMV_API.logout = async (e) => { order.push('logout'); return false; };
    const realHas = Object.getOwnPropertyDescriptor(AMV_API, 'hasSession');
    Object.defineProperty(AMV_API, 'hasSession', { configurable: true, get: () => true });
    try { signOut(); } catch (e) {}
    AMV_API.abortAll = realAbort; AMV_API.logout = realLogout;
    if (realHas) Object.defineProperty(AMV_API, 'hasSession', realHas); else delete AMV_API.hasSession;
    await inAir;
    /* And a request made after sign-out is not born cancelled. */
    window.__calls = [];
    const fresh = AMV_API._fetch('/sync/pull', { method: 'POST', body: '{}' }).catch(() => {});
    await new Promise(res => setTimeout(res, 30));
    const freshAborted = window.__calls[0] ? window.__calls[0].signal.aborted : null;
    AMV_API.abortAll(); await fresh;
    return { name, order, freshAborted, ms: settledAt - t0 };
  });
  ok(r.name === 'AbortError', 'the request from before sign-out is cancelled', r);
  ok(r.ms < 5000, 'at sign-out, not when its own deadline ran out', r.ms);
  ok(r.order[0] === 'abortAll' && r.order.includes('logout'),
     'the cancel happens BEFORE the logout is sent, so the logout is not what gets cancelled', r.order);
  ok(r.freshAborted === false, 'and the next request after sign-out goes out normally', r);
}

section('The agent loop: Stop cancels the round in the air');
{
  const r = await page.evaluate(async () => {
    window.__calls = []; window.__mode = 'stream';
    const c = new AbortController();
    setTimeout(() => c.abort(), 150);
    const t0 = Date.now();
    let out = null, err = '';
    /* Whether a backend is configured is another suite's question; this one
       needs the loop to get as far as sending. */
    const realReady = window._aiBackendReady;
    window._aiBackendReady = () => true;
    try { out = await aiAgentLoop({ prompt: 'x', tools: [], signal: c.signal, runTool: async () => ({ ok: true, text: '' }) }); }
    catch (e) { err = e.name + ': ' + e.message; }
    window._aiBackendReady = realReady;
    return { why: out && out.why, err, ms: Date.now() - t0, aborted: !!(window.__calls[0] && window.__calls[0].signal.aborted) };
  });
  ok(r.aborted === true, 'the model request that was streaming is aborted', r);
  ok(r.why === 'stopped' && !r.err, 'and the turn ends as stopped, not as an error', r);
  ok(r.ms < 5000, 'straight away', r.ms);
}

section('The Build agent’s Stop button reaches that signal');
{
  const r = await page.evaluate(async () => {
    const realLoop = window.aiAgentLoop, realConsent = window._agentConsent;
    let seen = null;
    window._agentConsent = async () => true;
    window.aiAgentLoop = (opts) => new Promise(res => {
      seen = opts;
      if (opts.signal) opts.signal.addEventListener('abort', () => res({ text: '', why: 'stopped', steps: [] }));
    });
    const wasConnected = BRIDGE.connected; BRIDGE.connected = true;
    const turn = _devSendAgent('tidy the readme', null);
    for (let i = 0; i < 50 && !seen; i++) await new Promise(res => setTimeout(res, 20));
    const hadSignal = !!(seen && seen.signal);
    _agentStop();
    const settled = await Promise.race([turn.then(() => true), new Promise(res => setTimeout(() => res(false), 3000))]);
    window.aiAgentLoop = realLoop; window._agentConsent = realConsent; BRIDGE.connected = wasConnected;
    return { hadSignal, aborted: !!(seen && seen.signal && seen.signal.aborted), settled };
  });
  ok(r.hadSignal, 'the turn hands the loop a signal', r);
  ok(r.aborted && r.settled, 'and pressing Stop aborts it, ending the turn', r);
}

await page.evaluate(() => { window.fetch = window.__realFetch; });

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
