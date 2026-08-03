/* STOP HAS TO STOP.

   The Stop button aborts the same AbortController the request timeout uses. The
   retry loop could not tell the two apart, so it treated a deliberate stop as a
   network hiccup: it showed "Taking a while - retrying (1/2)", waited, and
   issued the request AGAIN. Up to the retry limit.

   So pressing Stop kept AMV talking, and each retry is a fresh billed request
   for an answer nobody is waiting for. A Stop that does not stop is worse than
   no Stop button, because somebody who wants it to end has no other move and
   watches it start over. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'S', email: 's@x.com', ini: 'S' } });
const { page, errors } = app;

section('Pressing Stop does not re-issue the request');
{
  const r = await page.evaluate(async () => {
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    let calls = 0;
    const realFetch = window.fetch;
    /* Counted PER ENDPOINT. Other things fetch while a chat is open - the
       automations refresh, for one - and a total would call an unrelated
       request a retry. */
    const isChat = (u) => /\/v1\/messages/.test(String(u));
    // A request that never resolves on its own - only the abort ends it, which
    // is exactly the state the user is in when they reach for Stop.
    window.fetch = (url, opts) => {
      if (isChat(url)) calls++;
      return new Promise((_, reject) => {
        const sig = opts && opts.signal;
        if (sig) sig.addEventListener('abort', () => {
          const e = new Error(String(sig.reason || 'aborted')); e.name = 'AbortError'; reject(e);
        });
      });
    };

    newChat();
    const ta = document.getElementById('mta');
    if (ta) ta.value = 'a question';
    const p = sendMsg();
    await new Promise(r => setTimeout(r, 150));
    const during = calls;

    stopGenerating();                      // the user presses Stop
    await new Promise(r => setTimeout(r, 1200));   // longer than the first backoff
    try { await p; } catch (e) {}

    window.fetch = realFetch;
    const last = (getMsgs() || []).slice(-1)[0] || {};
    return { during, after: calls, busy: S.busy, stopped: !!last._stopped,
             text: String(last.c || '') };
  });

  ok(r.during === 1, 'one request goes out', r.during);
  ok(r.after === 1, 'and Stop does not send another', r.after);
  ok(r.busy === false, 'the composer is released', r.busy);
  ok(!/retrying/i.test(r.text), 'nothing tells the user it is retrying', r.text.slice(0, 80));
}

section('A real network drop still retries, because that is not a stop');
{
  /* The fix must not turn a genuine connection hiccup into a dead end - those
     are the failures retrying exists for. */
  const r = await page.evaluate(async () => {
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    let calls = 0;
    const realFetch = window.fetch;
    window.fetch = async (url) => {
      if (!/\/v1\/messages/.test(String(url))) return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
      calls++;
      if (calls === 1) throw new Error('Failed to fetch');   // transient, not a stop
      return { ok: true, status: 200, headers: new Headers(),
        body: { getReader: () => ({ read: async () => ({ done: true }) }) } };
    };

    newChat();
    const ta = document.getElementById('mta');
    if (ta) ta.value = 'a question';
    try { await sendMsg(); } catch (e) {}
    await new Promise(r => setTimeout(r, 2500));

    window.fetch = realFetch;
    return { calls };
  });
  ok(r.calls >= 2, 'a dropped connection is retried as before', r.calls);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('stop-means-stop') > 0) process.exitCode = 1;
done();
