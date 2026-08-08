/* THE PRODUCT ITSELF, THROUGH THE REAL STACK.

   Everything else proven so far is about whether somebody can sign up and pay.
   This is about whether they get anything for it. A person who pays and then
   cannot get an answer is a refund and a chargeback, and it is the one failure
   no amount of correct billing makes up for.

   Nothing tested it end to end. There are worker suites for metering, routing
   and quotas, and browser suites for the chat screen, and between them sits the
   actual transaction: a real browser posts a real turn to the real handler, the
   handler checks the plan, reserves quota, calls the model, streams words back,
   and meters what it cost. Each half was covered. The seam was not.

   The model endpoint is the one thing genuinely outside AMV, so it is stubbed -
   pointed at a neutral host by MODEL_API_URL, which is configuration the worker
   already supports, rather than by intercepting a vendor by name.

   The cases that matter most are the refusals. A free account asking for a paid
   engine, a deployment with no model key at all, and an upstream that fails
   after the quota was already reserved - because a reservation that is not
   given back turns one outage into everybody's daily allowance. */
import { bootLive, makeEnv, makeOutbound, BACKEND } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MODEL = 'https://model.example';

/* One SSE turn, in the shape the worker's meter reads: content, then usage. */
function sse(text, inTok = 12, outTok = 34) {
  return [
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: inTok, output_tokens: 0 } } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: outTok } })}\n\n`,
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join('');
}
const stream = (text) => new Response(sse(text), {
  status: 200, headers: { 'Content-Type': 'text/event-stream' },
});

const outbound = makeOutbound();
const env = makeEnv({
  AMV_MODEL_KEY: 'test-model-key-never-real',
  MODEL_API_URL: MODEL,
  APP_URL: 'http://localhost:9162',
});

let upstreamMode = 'ok';
outbound.on(new RegExp(MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), () => {
  if (upstreamMode === '500') return new Response(JSON.stringify({ error: { message: 'upstream down' } }), { status: 500 });
  if (upstreamMode === '401') return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
  return stream('Yes - here is the answer.');
});

const L = await bootLive({ env, outbound, port: 9163 });
const { page } = L;

const EMAIL = 'asker@example.com';
const PASSWORD = 'A-real-Passw0rd!';

/* Post one turn the way the app does, and read back what the browser got:
   the words, the engine the server says answered, and the status. */
async function ask(model, text) {
  return page.evaluate(async ([m, t, base]) => {
    const r = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AMV_API.token },
      body: JSON.stringify({ model: m, max_tokens: 256, messages: [{ role: 'user', content: t }] }),
    });
    const engine = r.headers.get('X-AMV-Engine') || '';
    const why = r.headers.get('X-AMV-Engine-Why') || '';
    const body = await r.text();
    let err = null;
    if (!r.ok) { try { err = JSON.parse(body); } catch (e) { err = { raw: body }; } }
    return { status: r.status, engine, why, body, err };
  }, [model, text, BACKEND]);
}

section('They sign up and are on Free, from the server');
{
  const r = await page.evaluate(async ([em, pw]) => {
    await AMV_API.signup(em, 'Asker', pw);
    const ent = await AMV_API.entitlement(em);
    return { plan: (ent.entitlement || {}).plan || 'free', tok: !!AMV_API.token };
  }, [EMAIL, PASSWORD]);
  ok(r.tok === true, 'they have a real token', r.tok);
  ok(r.plan === 'free', 'and a free plan', r.plan);
}

section('A free account asks a question and gets a real answer back');
{
  upstreamMode = 'ok';
  const r = await ask('amv-core', 'What is the capital of France?');
  ok(r.status === 200, 'the turn is accepted', r.status);
  ok(/here is the answer/.test(r.body),
     'and the model’s words reach the browser', r.body.slice(0, 120));
  ok(r.engine === 'amv-core',
     'labelled with the engine that actually ran, not the one asked for', r.engine);

  /* It really went out, with the key attached on the SERVER. */
  const calls = outbound.sentTo(new RegExp(MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  ok(calls.length === 1, 'the server called the model once', calls.length);
  ok(/capital of France/.test(calls[0].body), 'carrying the question', true);
}

section('The key never leaves the server');
{
  /* The whole reason the browser talks to AMV instead of the model directly.
     A key in the page is a key in every visitor's devtools. */
  const inPage = await page.evaluate(() => {
    const hay = document.documentElement.innerHTML + ' ' + JSON.stringify(localStorage);
    return /test-model-key-never-real/.test(hay);
  });
  ok(inPage === false, 'it is nowhere in the page or its storage', inPage);
}

section('What it cost is metered against the account that spent it');
{
  await L.settle();
  const keys = [...env.AMV_KV._map.keys()];
  const spent = keys.filter(k => /^ctr:(tok|cost)/.test(k) && k.includes(EMAIL));
  ok(spent.length > 0,
     'the tokens and cost are counted, or nothing bounds the bill', spent.slice(0, 4));
}

section('A free account cannot call an engine it has not paid for');
{
  /* The gate that makes the plans mean anything. Without it the price list is
     decoration. */
  const before = outbound.sentTo(new RegExp(MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).length;
  const r = await ask('amv-apex', 'Do something expensive.');
  ok(r.status === 402, 'it is refused, and refused as a payment problem', r.status);
  ok((r.err || {}).code === 'plan_required',
     'with a code the app can turn into an upgrade prompt', (r.err || {}).code);
  ok(/plan/i.test((r.err || {}).error || ''),
     'and a sentence naming what is needed', (r.err || {}).error);
  const after = outbound.sentTo(new RegExp(MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).length;
  ok(after === before,
     'and the model is never called, so a refusal costs nothing', { before, after });
}

section('Paying for it changes the answer');
{
  /* The other half, and the one that would be a support ticket from somebody
     who has just paid: the gate has to OPEN. */
  await env.AMV_KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  upstreamMode = 'ok';
  const r = await ask('amv-apex', 'Now do the expensive thing.');
  ok(r.status === 200, 'the same request now succeeds', r.status);
  ok(/here is the answer/.test(r.body), 'and they get their answer', r.body.slice(0, 80));
}

section('An upstream failure gives the quota back');
{
  /* Quota is RESERVED before the model is called, so a concurrent turn cannot
     overspend. If a failure does not release it, one bad afternoon at the
     provider silently eats every customer's daily allowance and they are
     throttled for something that was never their usage. */
  /* Read the DAILY USAGE COUNTER either side, not just "does the next turn
     work". A single lost reservation never exhausts a fresh account, so a
     weaker assertion passes happily while every failed turn quietly bills the
     customer for words they never received - which over an outage is the whole
     allowance. Confirmed by deleting the refund: the counter is what notices. */
  const usage = () => {
    for (const [k, v] of env.AMV_KV._map) if (/^ctr:usg:/.test(k) && k.includes(EMAIL)) return parseFloat(v) || 0;
    return 0;
  };
  await L.settle();
  const before = usage();

  upstreamMode = '500';
  const r = await ask('amv-core', 'This one will fail.');
  ok(r.status >= 500, 'the failure is reported honestly, not faked', r.status);
  ok(!/here is the answer/.test(r.body), 'and no invented answer is shown', r.body.slice(0, 80));

  await L.settle();
  const after = usage();
  ok(after <= before,
     'and their allowance is exactly where it was, because nothing was delivered',
     { before, after });

  upstreamMode = 'ok';
  const next = await ask('amv-core', 'And this one should still work.');
  ok(next.status === 200, 'the next turn still works', next.status);
}

section('With no model key at all, it says so rather than pretending');
{
  const env2 = makeEnv({ MODEL_API_URL: MODEL, APP_URL: 'http://localhost:9164' });
  const ob2 = makeOutbound();
  ob2.on(/model\.example/, () => stream('should never be reached'));
  const L2 = await bootLive({ env: env2, outbound: ob2, port: 9165 });
  const r = await L2.page.evaluate(async ([em, pw, base]) => {
    await AMV_API.signup(em, 'B', pw);
    const res = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AMV_API.token },
      body: JSON.stringify({ model: 'amv-core', max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] }),
    });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  }, ['nokey@example.com', PASSWORD, BACKEND]);
  ok(r.status === 503, 'the turn is refused as a configuration problem', r.status);
  ok(/needs_service/.test(r.body), 'with a code the app already knows how to show', r.body.slice(0, 160));
  ok(/Nothing has been charged or counted/.test(r.body),
     'and says their allowance was not spent on it', r.body.slice(0, 200));
  ok(!/should never be reached/.test(r.body),
     'nothing was invented to fill the gap', r.body.slice(0, 120));
  ok(ob2.sentTo(/model\.example/).length === 0,
     'and no request went out with an empty key', ob2.sentTo(/model\.example/).length);
  await L2.close();
}

section('Nothing threw, and the worker never fell over');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors);
  ok(L.served.every(s => s.status !== 500 || /messages/.test(s.path)),
     'no unexpected worker crash', L.served.filter(s => s.status === 500).map(s => s.path));
}

await L.close();
if (report('a-customer-gets-an-answer') > 0) process.exitCode = 1;
done();
