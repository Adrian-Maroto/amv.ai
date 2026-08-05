/* AN ERROR THAT NAMES THE WRONG CAUSE SENDS SOMEBODY TO FIX THE WRONG THING.

   Ask a question while the engine is returning 500 and AMV said:

     "Network error - could not reach the API. Check your connection,
      ad-blockers, or CORS/extension interference."

   The server was reached. It answered. It answered 500. Every word of that
   sentence is wrong, and all of it points at the person's own browser - so the
   one failure they can do nothing about is the one they are told to go and
   debug.

   The cause is a handler that decided whether a message was already
   human-readable by looking for certain WORDS in it. aegisErrorMessage writes
   "The AI service had a temporary error (500). Please retry in a moment." for a
   5xx, which contains none of the words on the list, so the message was thrown
   away and rebuilt by the fallback - which is called with status 0, and status
   0 means network error.

   A correct message, discarded for not being phrased the way a regex expected.

   Errors that were already written for a person now say so, and are used as
   they stand. The word list survives only as a guess for the ones that were
   not. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Ask one question with the engine answering however the case needs.

   The reply is described as DATA - a status, a body, or a thrown message -
   rather than as a function compiled in the page. Passing code through
   new Function put the stub one scope away from the fetch it was replacing,
   and every case silently fell through to a real request at a hostname that
   does not resolve. Which produces a genuine network error, which is the exact
   message under test: the harness was manufacturing the bug it was checking
   for, and nine assertions failed against a fix that worked. */
async function askWith({ status = 200, body = '{}', throwMsg = null, settleMs = 2500 }) {
  await page.evaluate(({ status, body, throwMsg }) => {
    S.convs = []; S.cur = null;
    try { newChat(); } catch (e) {}
    saveStr('amv_api_base', 'https://engine.test');
    saveStr('amv_api_token', 'tok');
    try { AEGIS.check = () => ({ ok: true }); } catch (e) {}
    if (!window.__realFetch) window.__realFetch = window.fetch;
    const real = window.__realFetch;
    window.fetch = async (u, o) => {
      if (!String(u).includes('engine.test')) return real(u, o);
      if (throwMsg) throw new TypeError(throwMsg);
      return new Response(body, { status });
    };
  }, { status, body, throwMsg });
  await page.evaluate(() => {
    const ta = document.getElementById('mta');
    ta.value = 'hello';
    return sendMsg();
  });
  await page.waitForTimeout(settleMs);
  return page.evaluate(() => {
    const m = getMsgs();
    const last = m[m.length - 1] || {};
    return String(last._error || last.c || '');
  });
}

section('A server error says the server had an error');
{
  const msg = await askWith({ status: 500, body: JSON.stringify({ error: { message: 'upstream exploded' } }), settleMs: 9000 });
  ok(/500/.test(msg), 'the status the server actually returned is named', msg.slice(0, 90));
  ok(!/ad-?block/i.test(msg), 'and nobody is sent to check their ad-blocker', msg.slice(0, 110));
  ok(!/could not reach/i.test(msg),
     'nor told the API was unreachable when it answered', msg.slice(0, 110));
}

section('So does a 503 and a 529');
{
  for (const status of [503, 529]) {
    const msg = await askWith({ status, settleMs: 9000 });
    ok(new RegExp(String(status)).test(msg), `${status} is reported as ${status}`, msg.slice(0, 80));
    ok(!/ad-?block/i.test(msg), `and ${status} is not blamed on the browser`, msg.slice(0, 80));
  }
}

section('A rate limit is a rate limit');
{
  const msg = await askWith({ status: 429, body: JSON.stringify({ error: { message: 'rate limited' } }), settleMs: 9000 });
  ok(/429|too many/i.test(msg), 'named as such', msg.slice(0, 90));
  ok(!/ad-?block/i.test(msg), 'not as a connection problem', msg.slice(0, 90));
}

section('A plan gate points at billing, not at the network');
{
  const msg = await askWith({ status: 402, body: JSON.stringify({ error: { message: 'amv-apex requires the elite plan' } }) });
  ok(/plan|billing|upgrade/i.test(msg), 'it names the plan', msg.slice(0, 110));
  ok(!/ad-?block/i.test(msg), 'and not the browser', msg.slice(0, 90));
}

section('An expired session says to sign in again');
{
  const msg = await askWith({ status: 401, body: JSON.stringify({ error: { message: 'authentication failed' } }) });
  ok(/sign out and back in|session/i.test(msg), 'it names the session', msg.slice(0, 110));
  ok(!/ad-?block/i.test(msg), 'and not the browser', msg.slice(0, 90));
}

section('A real connection failure still says so');
{
  /* The message was never wrong for its own case - only for everybody else's.
     It has to survive. */
  const msg = await askWith({ throwMsg: 'Failed to fetch', settleMs: 6000 });
  ok(/network|reach|connection/i.test(msg),
     'a genuine failure to reach the API is named that way', msg.slice(0, 110));
}

section('And being offline says offline');
{
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); });
  const msg = await askWith({ status: 200 });
  ok(/offline/i.test(msg), 'named as offline', msg.slice(0, 110));
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });
}

section('The decision is a tag, not a guess at the wording');
{
  /* The whole defect was a regex deciding whether prose "looked" already
     human. Any message somebody rewrites now keeps working. */
  const src = await page.evaluate(() => String(_callAI));
  ok(/_saidPlainly/.test(src), 'errors that were written for a person carry a mark', true);
  const helper = await page.evaluate(() => typeof _saidPlainly);
  ok(helper === 'function', 'and there is one place that sets it', helper);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('errors-name-the-real-cause') > 0) process.exitCode = 1;
done();
