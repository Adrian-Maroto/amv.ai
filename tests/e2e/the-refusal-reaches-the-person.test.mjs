/* THE SERVER WROTE A SENTENCE FOR A PERSON. THE PERSON HAS TO SEE IT.

   The backend is careful about refusals. "AMV is at capacity for free accounts
   today - it resets tomorrow. Paid plans are running normally." is not a status
   line; it is the difference between somebody understanding why they were
   turned away and somebody deciding the product is broken. One of those people
   comes back and pays.

   None of it reached anybody. The chat read `err?.error?.message` - the shape
   of an upstream PROVIDER's error object - while AMV sends
   `{error:"<sentence>", code}`, where `error` is a string. So `.message` was
   undefined every time, the raw text was always empty, and aegisErrorMessage
   fell through to "The AI service had a temporary error (503)". Every refusal
   AMV worded on purpose came out as a generic status.

   And because a 503 looked transient, it was retried twice first - so the
   person waited through two more round trips, each of which reserved and
   refunded their allowance on the server again, before being told the wrong
   thing.

   This drives the real chat in a real browser against the real Worker, because
   the defect lives exactly in the gap between what the server said and what the
   screen showed, and nothing that stubs either side can see it. */
import { bootLive, makeEnv, makeOutbound, BACKEND } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MODEL = 'https://model.example';
const MRE = new RegExp(MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const CAP = 100;                       // the day's hard ceiling, in dollars
const today = new Date().toISOString().slice(0, 10);

let modelStatus = 200;
const sse = () => [
  `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } })}\n\n`,
  `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } })}\n\n`,
  `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 5 } })}\n\n`,
  'data: {"type":"message_stop"}\n\n',
].join('');

const outbound = makeOutbound();
outbound.on(MRE, () => modelStatus === 200
  ? new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  : new Response(JSON.stringify({ error: { message: 'upstream had a moment' } }), { status: modelStatus }));
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const env = makeEnv({
  AMV_MODEL_KEY: 'test-model-key', MODEL_API_URL: MODEL,
  APP_URL: 'http://localhost:9209', GLOBAL_DAILY_USD_CAP: String(CAP),
});
const L = await bootLive({ env, outbound, port: 9209 });
const { page } = L;

const EMAIL = 'shed@example.com';
const PW = 'A-real-Passw0rd!';

/* Put the day's spend where the handler reads it. Without the Durable Object
   bound, `counter` falls back to KV under `ctr:` - the same number either way. */
const spendToday = (usd) => env.AMV_KV.put(`ctr:spend:${today}`, String(usd));
const setPlan = (plan) => env.AMV_KV.put('ent:' + EMAIL, JSON.stringify({
  plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));

/* Ask through the CHAT, not through fetch. The whole defect is in what the
   chat does with the answer. */
async function askInChat(question) {
  const before = L.hit(/\/v1\/messages/).length;
  /* Wait for the previous turn to finish before starting this one. Sending
     while the app is still busy is silently dropped, and a dropped send looks
     exactly like a turn that produced no error - which is the assertion this
     file is making, so it would read as a pass or a mystery failure depending
     on the day. */
  await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === false,
                             null, { timeout: 30000 }).catch(() => {});
  /* The app has its own floor between sends (800ms) and answers a faster one
     locally with "slow down a moment" - never reaching the backend. Without
     this pause a case asserting on a REFUSAL would instead be reading the
     throttle, and would have passed or failed depending on how quick the
     previous turn was. */
  await page.waitForTimeout(1000);
  /* And a burst window on top of that: several turns inside ten seconds are
     answered locally with "pause briefly", which is right for a person and
     wrong for a file that asks six questions in a row.

     `_lastSend` is cleared with it now, and that was the last flake in this
     file. The 1000ms above is measured from when the PREVIOUS ask returned,
     which is normally well clear of the 800ms floor - but a case that drives
     the RETRY path pushes `_lastSend` forward with every attempt, so on a
     loaded machine the last retry landed a few hundred milliseconds before the
     next send and the case asserting on a quota card read "Slow down a moment"
     instead. Under the parallel runner only, three times in four, which is
     exactly how a race hides.

     Both halves of the throttle are the app protecting a person from their own
     typing speed. Neither has anything to do with what this file asserts, and
     clearing one and not the other left the timing dependency in place while
     looking as though it had been dealt with. */
  await page.evaluate(() => { try { AEGIS._times = []; AEGIS._lastSend = 0; } catch (e) {} });
  /* AND THE SERVER'S OWN BURST CONTROL, WHICH IS A THIRD THROTTLE.

     The two above are the app protecting somebody from their own typing speed.
     The server has its own, per email per minute, and it is checked at step 2
     of the chat route - BEFORE the quota check at step 3. So once a section
     has spent the minute's requests, every later section is refused with
     `rate_limited` and never reaches the thing it is asserting about.

     That is what turned the gate red: the retry case makes several attempts by
     design, and on a machine running suites four at a time they all land in
     one minute window, so the quota case read "Rate limit reached. Slow down a
     moment." - the SERVER's wording - where it expected the countdown card.
     Locally the sections drift across a minute boundary and it passes.

     Note the two messages are nearly identical and come from opposite ends of
     the system; the client says "Slow down a moment BEFORE SENDING AGAIN". It
     is worth reading which one arrived before concluding anything, because the
     first look at this said AEGIS and AEGIS had already been dealt with.

     Cleared here rather than in the quota case because nothing in this file
     asserts on the rate limit, and any section could be preempted by it. */
  for (const k of [...env.AMV_KV._map.keys()]) {
    if (/^ctr:rl:/.test(k)) await env.AMV_KV.delete(k);
  }
  /* THE SEND USED TO BE ABLE TO TAKE THE WHOLE FILE DOWN WITH IT.

     This evaluate awaits 200ms inside the page before it sends. Anything that
     replaces the document in that window - the app re-rendering the shell, the
     service worker taking over - destroys the execution context, and Playwright
     rejects with "Execution context was destroyed". Nothing caught it, so it
     surfaced as an UNCAUGHT exception: the process died mid-file and every
     other assertion in it was never reported. That is the expensive part. The
     flake costs a rerun; a crash costs the results.

     It only ever showed up under the parallel runner, where four browsers share
     a machine and the timing moves. Alone it passed three times out of three,
     which is exactly how a race hides.

     So the send is retried once against a re-established page, and if it still
     will not go it is REPORTED rather than thrown. Retrying cannot paper over a
     real failure: `had` is re-read first, and the assertion below still
     requires two new messages to have actually appeared. */
  const readCount = () => page.evaluate(() => (getMsgs() || []).length);
  /* The wait for `S.busy` and the send happen in ONE round trip, deliberately.

     `sendMsg` is a no-op while `S.busy` is true and it says nothing when it
     declines - so a turn started a moment too early simply does not happen,
     and the assertion below reports "before 12, after 12" with no hint as to
     why. Waiting in a separate evaluate leaves a gap between the check and the
     press that a loaded machine can fit a state change into; inside one
     evaluate there is no gap.

     It also reports whether the messages actually grew, so a decline is
     distinguishable from a send that went out and came back empty. */
  const doSend = (q) => page.evaluate(async (text) => {
    setTab('chat');
    const t0 = Date.now();
    while (S.busy && Date.now() - t0 < 60000) await new Promise(r => setTimeout(r, 50));
    /* Kept at 200ms. The app answers a send inside 800ms of the last one
       locally with "slow down a moment" and never reaches the backend, and the
       waits above this add up to just over that - shortening this tipped a
       case that asserts on a REFUSAL into reading the throttle instead. */
    await new Promise(r => setTimeout(r, 200));
    const n0 = (getMsgs() || []).length;
    const box = document.getElementById('mta');
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    sendMsg();
    return { busyAtSend: S.busy, grewTo: (getMsgs() || []).length, from: n0 };
  }, q);
  const gone = (e) => /Execution context was destroyed|Target closed|page has been closed/i
    .test(String((e && e.message) || e));

  let had = await readCount();
  let sent = null;
  try {
    sent = await doSend(question);
  } catch (e) {
    if (!gone(e)) throw e;
    /* Let the page finish becoming itself again, then start the turn over from
       a count read on the NEW document - the old one is not there to compare
       against. */
    await page.waitForFunction(() => typeof S !== 'undefined' && typeof getMsgs === 'function',
                               null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(300);
    try {
      had = await readCount();
      sent = await doSend(question);
    } catch (e2) {
      ok(false, 'the chat stayed put long enough to send a question',
         String((e2 && e2.message) || e2).slice(0, 120));
      return { error: '', text: '', quota: false, count: had, calls: 0 };
    }
  }
  /* Wait for the TURN, not for a moment: both the question and whatever came
     back have to be on screen. */
  await page.waitForFunction((n) => typeof S !== 'undefined' && S.busy === false
                                    && (getMsgs() || []).length >= n + 2,
                             had, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(300);
  await L.settle();
  const last = await page.evaluate(() => {
    const all = getMsgs() || [];
    const m = all.slice(-1)[0] || {};
    return { error: m._error || '', text: m.c || '', quota: !!m._quota, count: all.length };
  });
  ok(last.count >= had + 2, 'the turn was actually sent',
     { before: had, after: last.count, atSend: sent });
  return { ...last, calls: L.hit(/\/v1\/messages/).length - before };
}

section('An account that is signed in and under the cap gets an answer');
{
  /* Signed up through the real form, not by calling AMV_API directly: the app
     only considers somebody signed in after its own post-signup work runs, and
     a test that skips it is testing a signed-out browser. */
  await spendToday(1);
  await page.evaluate(async ([em, pw]) => {
    setTab('chat');
    await new Promise(r => setTimeout(r, 200));
    const box = document.getElementById('mta');
    box.value = 'hello'; box.dispatchEvent(new Event('input', { bubbles: true }));
    sendMsg();                                   // with no account, this opens the form
    await new Promise(r => setTimeout(r, 600));
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Shed'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
  }, [EMAIL, PW]);
  await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === false
                                   && (getMsgs() || []).length > 0, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400);
  await L.settle();

  const first = await page.evaluate(() => {
    const m = (getMsgs() || []).slice(-1)[0] || {};
    return { signedIn: !!(window.AMV_API && AMV_API.token), error: m._error || '', text: m.c || '' };
  });
  ok(first.signedIn === true, 'they are signed in', first.signedIn);
  ok(!first.error, 'no error card on a normal turn', first.error || 'none');
  ok(/ok/i.test(first.text), 'and the answer is on screen', first.text.slice(0, 40));
}

section('Shed for capacity, they are told what actually happened');
{
  /* The sentence exists so a free user knows this is about the free tier being
     busy and not about AMV failing - and knows that paying is unaffected, which
     is true and is the only reason this refusal is survivable as a business. */
  await spendToday(CAP * 0.7 + 1);
  const a = await askInChat('are you there');

  ok(!!a.error, 'the turn ends in an error card rather than silence',
     { error: a.error || 'none', text: a.text.slice(0, 80), calls: a.calls });
  ok(/free account/i.test(a.error), 'saying it is about free accounts', a.error);
  ok(/paid plans are running/i.test(a.error),
     'and that paying is unaffected - the server’s own words, intact', a.error);
  ok(!/temporary error|503/i.test(a.error),
     'not the generic status line that used to replace it', a.error);
}

section('And they are told once, not after two silent retries');
{
  /* The refusal is settled until tomorrow. Retrying it makes the person wait
     while AMV reserves and refunds their allowance twice more for nothing. */
  await spendToday(CAP * 0.7 + 1);
  const a = await askInChat('again');
  ok(a.calls === 1, 'exactly one request went to the backend', a.calls);
}

section('The hard ceiling reaches a paying customer in its own words too');
{
  await setPlan('ultra');
  await spendToday(CAP + 1);
  const a = await askInChat('and now');
  ok(/at capacity for today/i.test(a.error),
     'the global cap says what it is', a.error);
  ok(!/temporary error/i.test(a.error), 'and is not rewritten into a shrug', a.error);
}

section('A refusal that is not about capacity survives intact too');
{
  /* The capacity cases above would pass even if the guesser still had the last
     word, because it now hands back the text it was given. This one does not:
     "AMV is not connected to a model on this deployment yet" matches none of
     the guesser's patterns, so a 503 there is rewritten into "temporary error"
     and the one fact that matters - that nothing was charged - is lost.

     Somebody told to retry will retry. Somebody told AMV is not connected to a
     model, and that nothing was charged, knows it is not their problem and
     that they have not paid for it. */
  const savedKey = env.AMV_MODEL_KEY;
  delete env.AMV_MODEL_KEY;
  await spendToday(1);
  const a = await askInChat('anyone there');
  env.AMV_MODEL_KEY = savedKey;

  ok(/not connected to a model/i.test(a.error), 'it says what is actually wrong', a.error);
  ok(/nothing has been charged/i.test(a.error),
     'and that it cost them nothing, which is the part they would worry about', a.error);
  ok(!/temporary error/i.test(a.error), 'rather than a status the guesser made up', a.error);
}

section('A real transient failure is still retried, so nothing was traded away');
{
  /* The other direction, and the reason this is not simply "never retry": an
     upstream hiccup carries no AMV code, and giving up on the first one would
     turn a blip into a failed answer. */
  await spendToday(1);
  await setPlan('ultra');
  modelStatus = 500;
  const a = await askInChat('is anyone home');
  modelStatus = 200;
  ok(a.calls > 1, 'a failure AMV did not choose is tried again', a.calls);
  ok(!!a.error, 'and once it keeps failing, it is reported', a.error || 'none');
}

section('A usage limit still shows the countdown card, not an error card');
{
  /* The quota path reads the same body and must not have been broken by
     reading it earlier. */
  await spendToday(1);
  await setPlan('free');
  for (const k of [...env.AMV_KV._map.keys()]) {
    if (/^ctr:usg:/.test(k) && k.includes(EMAIL)) await env.AMV_KV.put(k, '600000');
  }
  const a = await askInChat('one more');
  ok(a.quota === true, 'the quota card is what appears', { quota: a.quota, error: a.error });
}

await L.close();
outbound.restore();
if (report('the-refusal-reaches-the-person') > 0) process.exitCode = 1;
done();
