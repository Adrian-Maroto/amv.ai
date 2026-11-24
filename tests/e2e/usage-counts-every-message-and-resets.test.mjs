/* USAGE COUNTS EVERY MESSAGE, AND IT RESETS (owner, Nov 24: "make sure the
   usage counting actually works ... and resets").

   The unit suites hold each window's arithmetic. This holds the thing a person
   sees, end to end on the real worker: each message they send is counted once
   on the same endpoint the Usage screen reads; the five-hour window stops them
   at exactly its limit, by name; and when five hours have passed the window is
   fresh and they are served again - while the month keeps counting, because a
   window reopening is not a month resetting.

   The worker runs in this process, so the clock is moved here, not mocked in
   the page: the counters are keyed on Date.now() and roll on it. */
import { bootLive, makeEnv, makeOutbound, BACKEND } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MODEL = 'https://model.example';
const MRE = new RegExp(MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
/* A short turn, so the day's token cap is never what stops them here. */
const sse = () => [
  `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } })}\n\n`,
  `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } })}\n\n`,
  `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 10 } })}\n\n`,
  'data: {"type":"message_stop"}\n\n',
].join('');

const outbound = makeOutbound();
outbound.on(MRE, () => new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
const env = makeEnv({ AMV_MODEL_KEY: 'test-model-key', MODEL_API_URL: MODEL });
const L = await bootLive({ env, outbound });
const { page } = L;

const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;

/* A message a minute, as a person sends them: the burst limiter (a separate,
   per-minute guard) is not what this file measures. And the sign-in is
   refreshed the way the app refreshes it, since five hours outlives the
   short-lived access token. */
const ask = async () => { shift += 61e3; return page.evaluate(async (base) => {
  const go = () => fetch(base + '/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AMV_API.token },
    body: JSON.stringify({ model: 'amv-core', max_tokens: 256, messages: [{ role: 'user', content: 'hello' }] }),
  });
  let r = await go();
  if (r.status === 401 && await AMV_API._doRefresh()) r = await go();
  const body = await r.text();
  let err = null; if (!r.ok) { try { err = JSON.parse(body); } catch (e) { err = { raw: body.slice(0, 200) }; } }
  return { status: r.status, err };
}, BACKEND); };
const usage = () => page.evaluate(() => AMV_API.usage());

try {
  section('A new Free account starts at zero');
  {
    await page.evaluate(async () => { await AMV_API.signup('counted@example.com', 'Counted', 'A-real-Passw0rd!'); });
    const u = await usage();
    ok(u && u.plan === 'free', 'signed in on Free', u && u.plan);
    ok(u.window5h.used === 0 && u.window5h.resetAt === null, 'no messages yet, and the window has not started', u.window5h);
    ok(u.window5h.limit > 0, 'with a real five-hour limit', u.window5h.limit);
  }

  section('Each message is counted once, where the Usage screen reads it');
  let limit = 0;
  {
    for (let i = 0; i < 3; i++) { const r = await ask(); ok(r.status === 200, 'message ' + (i + 1) + ' is answered', r.status); }
    await L.settle();
    const u = await usage();
    limit = u.window5h.limit;
    ok(u.window5h.used === 3, 'three messages, three counted in the window', u.window5h);
    ok(u.messages.used === 3, 'and three in the month', u.messages);
    ok(u.window5h.resetAt && Math.abs(u.window5h.resetAt - u.window5h.startedAt - 5 * 3600e3) < 1000, 'the window reopens five hours after the first', u.window5h);
  }

  section('The window stops them at exactly its limit, and says which window');
  {
    let served = 3, refusal = null;
    for (let i = 0; i < limit + 5; i++) {
      const r = await ask();
      if (r.status === 200) served++; else { refusal = r; break; }
    }
    await L.settle();
    ok(served === limit, 'served exactly the limit (' + limit + ')', served);
    ok(refusal && (refusal.status === 429 || refusal.status === 402), 'then refused', refusal && refusal.status);
    const said = JSON.stringify(refusal && refusal.err || {});
    ok(/5|five|hour|window/i.test(said), 'naming the five-hour window', said.slice(0, 200));
    const before = outbound.sentTo(MRE).length; await ask(); ok(outbound.sentTo(MRE).length === before, 'and the model is not called for a refused message');
  }

  section('Five hours later the window is fresh, and the month kept counting');
  {
    shift += 5 * 3600e3 + 60e3;
    const r = await ask();
    ok(r.status === 200, 'they are served again', r.status);
    await L.settle();
    const u = await usage();
    ok(u.window5h.used === 1, 'the new window has the one message in it', u.window5h);
    ok(u.messages.used === limit + 1, 'the month still holds every message', u.messages);
  }

  section('Nothing threw and the worker stayed up');
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors);
  ok(L.served.filter(s => s.status === 500).length === 0, 'no request made the worker fall over');
} finally {
  Date.now = realNow;
  await L.close();
}
if (report('usage-counts-every-message-and-resets') > 0) process.exitCode = 1;
done();
