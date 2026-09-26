/* STOP TELLS THE SERVER BEFORE IT LETS GO.

   From the server's side, a closed connection looks exactly like a phone that
   lost signal - and for that, the server finishes the answer and keeps it so it
   can be collected. So a Stop that only cut the connection made the model write
   the whole answer, at the person's expense. The server now stops the model
   when the turn has been named to /v1/stop first (the Worker suite
   `stop-stops-the-model-and-the-meter` covers that side).

   This is the page's side, and it has two jobs that pull against each other:
     · the answer must stop APPEARING the moment Stop is pressed;
     · the connection must NOT close until /v1/stop has been sent - the chat
       loop used to cancel its reader on the next chunk after Stop, which would
       have closed it first and made every Stop look like a dropped signal.

   The model's side is a stream in the page that writes a word every 50ms and
   records when its connection is aborted. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', apiBase: 'https://api.example.workers.dev' });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

await page.evaluate(() => {
  AMV_API.token = 'tok-for-this-test';
  window._aiBackendReady = () => true;
  window.__log = [];
  window.__turnHeader = '';
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const u = String(url);
    if (/\/v1\/stop/.test(u)) {
      window.__log.push({ what: 'stop', at: performance.now(), body: String((init && init.body) || '') });
      await new Promise(r => setTimeout(r, 120));       // a stop that takes a moment to land
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/\/v1\/messages/.test(u)) {
      const h = (init && init.headers) || {};
      window.__turnHeader = h['X-AMV-Request-Id'] || (h.get && h.get('X-AMV-Request-Id')) || '';
      const sig = init && init.signal;
      const enc = new TextEncoder();
      let timer = null;
      const ev = (t, d) => enc.encode('event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n');
      const body = new ReadableStream({
        start(c) {
          c.enqueue(ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } }));
          c.enqueue(ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
          timer = setInterval(() => {
            try { c.enqueue(ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'word ' } })); } catch (e) {}
          }, 50);
          if (sig) sig.addEventListener('abort', () => {
            window.__log.push({ what: 'cut', at: performance.now() });
            clearInterval(timer);
            try { c.error(new DOMException('aborted', 'AbortError')); } catch (e) {}
          });
        },
        cancel() { window.__log.push({ what: 'cut', at: performance.now() }); clearInterval(timer); },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return real(url, init);
  };
});

const lastText = () => page.evaluate(() => {
  const m = (getMsgs() || []).filter(x => x.r === 'a').pop();
  return m ? String(m.c || '') : '';
});

section('An answer is streaming');
await page.evaluate(() => { const i = document.getElementById('inp') || document.querySelector('textarea'); if (i) i.value = 'Tell me a long story'; sendMsg(); });
await page.waitForFunction(() => { const m = (getMsgs() || []).filter(x => x.r === 'a').pop(); return m && String(m.c || '').length > 20; }, null, { timeout: 8000 });
ok((await lastText()).length > 20, 'words are arriving', (await lastText()).length);

section('Stop: the words stop at once, and the server hears before the line is cut');
{
  await page.evaluate(() => stopGenerating());
  const atStop = (await lastText()).replace(/\s*_\(stopped\)_\s*$/, '').length;
  await page.waitForTimeout(700);
  const after = (await lastText()).replace(/\s*_\(stopped\)_\s*$/, '').length;
  const log = await page.evaluate(() => window.__log);
  const turn = await page.evaluate(() => window.__turnHeader);
  const s = log.find(x => x.what === 'stop'), c = log.find(x => x.what === 'cut');
  ok(after <= atStop + 5, 'no more of the answer appears after Stop', { atStop, after });
  ok(!!s, 'the server is told the turn was stopped', log);
  ok(s && turn && s.body.includes(turn), 'about this turn, by the id the answer was requested with', { body: s && s.body, turn });
  ok(!!c && s && c.at >= s.at + 100, 'and the connection is cut only after the stop has landed', log);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
