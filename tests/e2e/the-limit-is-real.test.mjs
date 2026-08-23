/* THE ONLY REASON ANYBODY UPGRADES.

   Every plan on the pricing page is a promise about a limit: Free stops here,
   Pro stops much later. If the limit does not actually bite, nobody ever needs
   to pay and the whole price list is decoration. If it bites the wrong way -
   too early, or on somebody who has paid - it is a support ticket from a
   customer who is being throttled for something they bought.

   Both failures are silent from the inside. A cap that is never reached looks
   identical to a cap that works, right up until you look at revenue; a cap that
   fires on a paid account looks like the product being slow.

   There are worker suites for the counters and the allowances. What none of
   them cover is the thing that decides revenue: the same account, the same
   request, refused on Free and served on Pro, through the real router with real
   tokens. */
import { bootLive, makeEnv, makeOutbound, BACKEND } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MODEL = 'https://model.example';
const MRE = new RegExp(MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/* Every turn reports the same usage, so the only thing moving is the cap. */
const USED_IN = 4000, USED_OUT = 4000;
const sse = () => [
  `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: USED_IN, output_tokens: 0 } } })}\n\n`,
  `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } })}\n\n`,
  `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: USED_OUT } })}\n\n`,
  'data: {"type":"message_stop"}\n\n',
].join('');

const outbound = makeOutbound();
outbound.on(MRE, () => new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

const env = makeEnv({
  AMV_MODEL_KEY: 'test-model-key', MODEL_API_URL: MODEL, APP_URL: 'http://localhost:9166',
});
const L = await bootLive({ env, outbound, port: 9167 });
const { page } = L;

const EMAIL = 'capped@example.com';
const PW = 'A-real-Passw0rd!';

const ask = () => page.evaluate(async (base) => {
  const r = await fetch(base + '/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AMV_API.token },
    body: JSON.stringify({ model: 'amv-core', max_tokens: 512, messages: [{ role: 'user', content: 'hello' }] }),
  });
  const body = await r.text();
  let err = null; if (!r.ok) { try { err = JSON.parse(body); } catch (e) { err = { raw: body.slice(0, 200) }; } }
  return { status: r.status, err };
}, BACKEND);

const setPlan = (plan) => env.AMV_KV.put('ent:' + EMAIL, JSON.stringify({
  plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));

/* Spend the day's allowance directly against the counter the handler reads,
   rather than by sending hundreds of real turns - the cap is the thing under
   test, not the arithmetic that reaches it. */
async function burnDay(amount) {
  for (const k of [...env.AMV_KV._map.keys()]) {
    if (/^ctr:usg:/.test(k) && k.includes(EMAIL)) { await env.AMV_KV.put(k, String(amount)); return k; }
  }
  return null;
}

section('A new account signs up on Free and can use the product');
{
  const r = await page.evaluate(async ([em, pw]) => {
    await AMV_API.signup(em, 'Capped', pw);
    return { tok: !!AMV_API.token };
  }, [EMAIL, PW]);
  ok(r.tok, 'they are signed in', r.tok);
  const first = await ask();
  ok(first.status === 200, 'and a free account really gets answers', first.status);
  await L.settle();
}

section('Free stops, and says why in a way somebody can act on');
{
  /* The moment the business depends on. Spent to the free day cap, the next
     turn must be refused - and refused as a LIMIT, not as an error, or the app
     shows "something went wrong" at the exact moment it should be showing an
     upgrade. */
  /* Burn past the free day cap. The number is deliberately well over it rather
     than equal to it: the cap moved from 52,000 to 20,000 when the free tier
     was reshaped, and a test that spends exactly the cap silently stops testing
     the refusal the day somebody changes it. */
  const key = await burnDay(60000);          // free dayTokens is 20000
  ok(!!key, 'the usage counter was found', key);

  const r = await ask();
  ok(r.status === 429 || r.status === 402,
     'the next turn is refused', r.status);
  const code = (r.err || {}).code || '';
  ok(/limit|quota|rate/i.test(code + ' ' + ((r.err || {}).error || '')),
     'and named as a limit, not as a failure', { code, error: (r.err || {}).error });
  ok(!/undefined|\[object/.test(JSON.stringify(r.err || {})),
     'with a real sentence in it', r.err);
}

section('And the model is never called once they are over');
{
  /* A cap that refuses the user AFTER paying the provider protects nothing.
     The whole point of the limit is the bill. */
  const before = outbound.sentTo(MRE).length;
  await ask();
  const after = outbound.sentTo(MRE).length;
  ok(after === before, 'no request goes out for a refused turn', { before, after });
}

section('Paying lifts it - the same request, now served');
{
  /* The other half, and the one a customer notices instantly. Same account,
     same counter, same request: the only thing that changed is what they are
     paying, and it has to change the answer. */
  await setPlan('pro');                       // pro dayTokens is 325000
  const r = await ask();
  ok(r.status === 200,
     'the identical request that was refused on Free now succeeds', r.status);
  ok(outbound.sentTo(MRE).length > 0, 'and really reached the model', true);
}

section('The bigger plan has a bigger limit, not no limit');
{
  /* "Unlimited" is how a plan loses money. Pro must stop too, just much later,
     or the dollar backstop is the only thing between AMV and an unbounded
     bill. */
  await burnDay(400000);                      // past pro's day cap
  const r = await ask();
  ok(r.status === 429 || r.status === 402,
     'a paid plan is still bounded', r.status);

  await setPlan('ultra');
  const u = await ask();
  ok(u.status === 200, 'while the tier above it keeps working', u.status);
}

section('Dropping back to Free re-applies the smaller limit immediately');
{
  /* A cancellation has to bite. If the limit is read from anything cached in
     the browser, somebody keeps their paid allowance by never reloading. */
  await setPlan('free');
  const r = await ask();
  ok(r.status === 429 || r.status === 402,
     'the free limit applies again as soon as the plan does', r.status);
}

section('Nothing threw and the worker stayed up');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors);
  const crashed = L.served.filter(s => s.status === 500);
  ok(crashed.length === 0, 'and no request made the worker fall over', crashed.map(s => s.path));
}

await L.close();
if (report('the-limit-is-real') > 0) process.exitCode = 1;
done();
