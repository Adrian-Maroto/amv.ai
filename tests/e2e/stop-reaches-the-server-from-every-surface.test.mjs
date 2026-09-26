/* STOP REACHES THE SERVER FROM EVERY SURFACE, AND A LONG ANSWER IS NOT CUT.

   Two defects on the engine calls every surface but chat goes through
   (aiComplete, aiCompleteLong, aiAgentLoop):

     · Stop in the Build agent and in Dev cancelled the request in the browser
       only. To the server that is a phone losing signal, so it finished the
       answer in the background and charged for all of it. Chat already named
       its turn to /v1/stop first; these now do the same.

     · The requests went through fetchDeadline without `stream`, which arms a
       20-second limit on reading the WHOLE body. Measured: a stream still
       sending a word a second was cut off at 21s. Any Dev build or agent round
       longer than that failed - and the agent loop reported it as "stopped".
       Silence now ends a stream; length does not.

   The model's side is a stream in the page that writes a word on a timer and
   records when its connection is cut. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', apiBase: 'https://api.example.workers.dev' });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

await page.evaluate(() => {
  AMV_API.token = 'tok-for-this-test';
  window._aiBackendReady = () => true;
  window.__log = [];
  window.__mode = { every: 50, words: 1e9, quietAfter: 1e9 };   // how the model writes
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const u = String(url);
    if (/\/v1\/stop/.test(u)) {
      window.__log.push({ what: 'stop', at: performance.now(), body: String((init && init.body) || '') });
      await new Promise(r => setTimeout(r, 120));        // a stop that takes a moment to land
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/\/v1\/messages/.test(u)) {
      const h = (init && init.headers) || {};
      const turn = h['X-AMV-Request-Id'] || '';
      window.__log.push({ what: 'ask', at: performance.now(), turn });
      const m = Object.assign({}, window.__mode);
      const sig = init && init.signal;
      const enc = new TextEncoder();
      const ev = (d) => enc.encode('event: ' + d.type + '\ndata: ' + JSON.stringify(d) + '\n\n');
      let timer = null, n = 0;
      const body = new ReadableStream({
        start(c) {
          c.enqueue(ev({ type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } }));
          c.enqueue(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
          timer = setInterval(() => {
            try {
              if (n >= m.quietAfter) return;                // goes silent, connection left open
              if (n >= m.words) {
                clearInterval(timer);
                c.enqueue(ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: n } }));
                c.enqueue(ev({ type: 'message_stop' }));
                c.close();
                return;
              }
              n++;
              c.enqueue(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'w' + n + ' ' } }));
            } catch (e) {}
          }, m.every);
          if (sig) sig.addEventListener('abort', () => {
            window.__log.push({ what: 'cut', at: performance.now(), turn });
            clearInterval(timer);
            try { c.error(new DOMException('aborted', 'AbortError')); } catch (e) {}
          });
        },
        cancel() { window.__log.push({ what: 'cut', at: performance.now(), turn }); clearInterval(timer); },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return real(url, init);
  };
});

/* Stop is pressed once the model has been writing for a moment, and the log
   is read after the cut has had time to happen. */
async function stopMidAnswer(start) {
  await page.evaluate(() => { window.__log = []; window.__mode = { every: 50, words: 1e9, quietAfter: 1e9 }; });
  const run = page.evaluate(start);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__ctrl.abort());
  const out = await run;
  await page.waitForTimeout(300);
  const log = await page.evaluate(() => window.__log);
  const ask = log.find(x => x.what === 'ask'), s = log.find(x => x.what === 'stop'), c = log.find(x => x.what === 'cut');
  return { out, log, ask, s, c };
}

section('The Build agent: Stop names the round to the server, then cuts');
{
  const r = await stopMidAnswer(async () => {
    window.__ctrl = new AbortController();
    const o = await aiAgentLoop({ prompt: 'build it', signal: window.__ctrl.signal, runTool: async () => ({ ok: true, text: '' }) });
    return { why: o.why };
  });
  ok(r.out.why === 'stopped', 'the loop ends as stopped', r.out);
  ok(!!r.s && !!r.ask && r.ask.turn && r.s.body.includes(r.ask.turn), 'the server is told, by the id the round was requested with', r.log);
  ok(!!r.c && !!r.s && r.c.at >= r.s.at + 100, 'and the connection is cut only after the stop has landed', r.log);
}

section('Dev’s long completion: the same, and what was written is kept');
{
  const r = await stopMidAnswer(async () => {
    window.__ctrl = new AbortController();
    const text = await aiCompleteLong('write it', 'sys', { signal: window.__ctrl.signal, noLang: true });
    return { text };
  });
  ok(/w1 w2/.test(r.out.text), 'the words that arrived before Stop are returned', r.out.text.slice(0, 60));
  ok(!!r.s && !!r.ask && r.ask.turn && r.s.body.includes(r.ask.turn), 'the server is told, by the id the round was requested with', r.log);
  ok(!!r.c && !!r.s && r.c.at >= r.s.at + 100, 'and the connection is cut only after the stop has landed', r.log);
}

section('Dev’s Stop button cancels the round in the air, not only the next one');
{
  await page.evaluate(() => { _setPlan('ultra'); setTab('dev'); });
  await page.waitForSelector('#dev-stop', { state: 'attached', timeout: 8000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const btn = document.getElementById('dev-stop');
    if (!btn) return { btn: false };
    const c = new AbortController();
    _DEV.ctrl = c;
    btn.click();
    const out = { btn: true, aborted: c.signal.aborted, stop: _DEV.stop };
    try { _devIdle(); } catch (e) {}
    return out;
  });
  ok(r.btn && r.aborted === true && r.stop === true, 'pressing it aborts the controller the request was sent with', r);
}

section('Between rounds there is nothing to name, and the cut is immediate');
{
  const r = await page.evaluate(() => {
    window.__log = [];
    const l = _aiStopLink((window.__c2 = new AbortController()).signal);
    l.begin(); l.end();
    window.__c2.abort();
    return { aborted: l.signal.aborted, stops: window.__log.filter(x => x.what === 'stop').length };
  });
  ok(r.aborted === true && r.stops === 0, 'no stop request, and the request signal is already cut', r);
}

section('A long answer that is still arriving is not cut off');
{
  /* A word every second for 24 seconds: over the 20s that used to cut every
     one of these, and inside the 60s of silence that ends a stream. All three
     engine calls at once, so each is measured in the same 24 seconds. */
  await page.evaluate(() => { window.__log = []; window.__mode = { every: 1000, words: 24, quietAfter: 1e9 }; });
  const r = await page.evaluate(async () => {
    const t0 = performance.now();
    const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String((e && e.message) || e) }));
    const [a, b, c] = await Promise.all([
      settle(aiComplete('go', 'sys', { noLang: true, noFloor: true })),
      settle(aiCompleteLong('go', 'sys', { noLang: true })),
      settle(aiAgentLoop({ prompt: 'go', runTool: async () => ({ ok: true, text: '' }) }).then(o => ({ why: o.why, text: o.text }))),
    ]);
    return { a, b, c, ms: Math.round(performance.now() - t0) };
  });
  ok(r.ms > 21000, 'the answers took longer than the old limit', r.ms);
  ok(r.a.ok && /w24/.test(r.a.v), 'aiComplete returns the whole answer', r.a);
  ok(r.b.ok && /w24/.test(r.b.v), 'aiCompleteLong returns the whole answer', r.b);
  ok(r.c.ok && r.c.v.why === 'done' && /w24/.test(r.c.v.text), 'the agent loop finishes as done, not "stopped"', r.c);
}

section('Silence still ends a stream, with a sentence');
{
  await page.evaluate(() => { window.__amvStreamIdleMs = 1500; window.__mode = { every: 50, words: 1e9, quietAfter: 3 }; });
  const t0 = Date.now();
  /* Raced against a limit of our own, so a reader with no watchdog fails this
     section with a sentence instead of hanging the suite. */
  const r = await page.evaluate(() => Promise.race([
    aiComplete('go', 'sys', { noLang: true, noFloor: true }).then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e.message) })),
    new Promise(res => setTimeout(() => res({ ok: 'hung', e: 'still waiting after 12s' }), 12000)),
  ]));
  const ms = Date.now() - t0;
  await page.evaluate(() => { delete window.__amvStreamIdleMs; });
  ok(r.ok === false && /stalled/.test(r.e), 'a connection that goes quiet fails with a sentence', r);
  ok(ms < 10000, 'at the idle limit, not never', ms);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
