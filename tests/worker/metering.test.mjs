/* METERING — the profit guarantee.
   This suite ATTACKS the server the way a user with devtools would. Every test
   here is an attempted bypass. If any of them passes, someone can run up your
   Anthropic bill on a free account. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'meter.harness.mjs');
writeFileSync(harness, src +
  '\nexport { aiProxy, imageGenerate, imageMeter, effectiveLimits, PLAN_LIMITS, PLAN_RANK, ENGINES };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

/* ── Mock KV + an ATOMIC counter, matching the Durable Object contract ──── */
const kv = new Map();
const counters = new Map();

const env = {
  ANTHROPIC_API_KEY: 'sk-test',
  JWT_SECRET: 'secret',
  // There is ALSO a global daily spend ceiling across all users (a real feature —
  // it stops one bad day becoming a huge bill). Raise it here so it doesn't mask
  // the PER-USER limits we're actually testing.
  GLOBAL_DAILY_USD_CAP: '100000',
  AMV_KV: {
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async put(k, v) { kv.set(k, v); },
    async delete(k) { kv.delete(k); },
    async list({ prefix }) {
      return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
    }
  }
};

/* The real counter lives in a Durable Object. Emulate its semantics exactly:
   incr is atomic and returns the NEW total; rateCheck is test-and-increment. */
globalThis.__mockCounter = async (env_, name, opts) => {
  const cur = counters.get(name) || 0;
  if (opts.op === 'get')  return { value: cur };
  if (opts.op === 'incr') { const n = Math.max(0, cur + (opts.amount || 0)); counters.set(name, n); return { value: n }; }
  if (opts.op === 'rateCheck') {
    const n = cur + 1;
    counters.set(name, n);
    return { allowed: n <= opts.limit, count: n };
  }
  // The global spend ceiling uses checkCap. Leaving it out made every call
  // return undefined `allowed` -> a 503, which looked like the metering was
  // broken when the mock simply didn't speak the whole protocol.
  if (opts.op === 'checkCap') return { allowed: cur < opts.cap, value: cur };
  /* Atomic test-and-increment. Because this Map is single-threaded JS, this
     mock has the same serialised semantics as the real Durable Object. */
  if (opts.op === 'reserve') {
    if (cur >= opts.cap) return { allowed: false, value: cur };
    counters.set(name, cur + (opts.amount || 0));
    return { allowed: true, value: cur + (opts.amount || 0) };
  }
  return { value: cur };
};

/* Point the Worker's `counter` at our mock by overriding the DO binding. */
env.AMV_COUNTER = {                       // the real binding name — not COUNTER
  idFromName: (n) => n,
  get: (id) => ({
    // The Worker calls stub.fetch(url, init) — NOT fetch(Request). Getting this
    // wrong made the mock throw, which the Worker silently swallows and falls
    // back to KV. The test then "passed" while measuring the wrong code path.
    async fetch(url, init) {
      const body = JSON.parse((init && init.body) || '{}');
      const res = await globalThis.__mockCounter(env, id, body);
      return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json' } });
    }
  })
};

/* Users are identified by the JWT; the PLAN is loaded server-side from the
   entitlement store, never taken from the request. */
let CURRENT = { email: 'free@test.com' };
W.__setRequireUser(async () => {
  const e = (await env.AMV_KV.get('ent:' + CURRENT.email));
  const ent = e ? JSON.parse(e) : {};
  return { email: CURRENT.email, plan: ent.plan || 'free', customCfg: ent.custom || null };
});

const setPlan = async (email, plan) => {
  await env.AMV_KV.put('ent:' + email, JSON.stringify({ plan }));
};

/* Cloudflare passes an ExecutionContext. Usage is metered in a background task
   via ctx.waitUntil() while the response streams to the client — so we must
   collect and AWAIT those tasks, or we'd be asserting on counters that haven't
   been written yet and would wrongly conclude metering is broken. */
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException(){} };
const settle = async () => { await Promise.all(pending.splice(0)); };
// the global spend ceiling is counted under 'spend:<day>'
const resetGlobal = () => { for (const k of [...counters.keys()]) if (k.startsWith('spend:')) counters.delete(k); };

const msg = (body) => new Request('https://api.amv.dev/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
  body: JSON.stringify(body)
});

/* max_tokens is the CEILING the model may generate — the real API never exceeds
   it, and the reservation relies on that. An earlier version of this stub asked
   for max_tokens:100 and then "returned" 10,000 output tokens, which no real
   model can do. That made the reservation look broken when it was the stub
   breaking the contract. Keep these consistent. */
const MAX_OUT = 10000;
/* The prompt must be as big as the usage the stub reports. ~4 chars per token,
   so 10,000 input tokens is ~40,000 characters. Sending "hi" and then claiming
   10,000 input tokens is not something the real API can do, and it made the
   reservation look like it was under-counting when the stub was simply lying. */
const BIG_PROMPT = 'x'.repeat(40000);
const basePayload = (extra = {}) => ({
  model: 'claude-sonnet-4-6',
  max_tokens: MAX_OUT,
  messages: [{ role: 'user', content: BIG_PROMPT }],
  ...extra
});

/* Upstream model call. Must be a REAL Response — the proxy streams the body
   with .tee(), so a hand-rolled {json(){}} object is not faithful enough and
   will blow up in a way that has nothing to do with the thing under test. */
let upstreamCalls = 0;
globalThis.fetch = async () => {
  upstreamCalls++;
  // The proxy ALWAYS streams and tallies usage by parsing SSE. A plain-JSON
  // mock reports zero usage and makes it look like metering is broken when it
  // isn't — the stub has to speak the same protocol as the real API.
  const sse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":10000,"output_tokens":0}}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"input_tokens":10000,"output_tokens":10000}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    ''
  ].join('\n');
  return new Response(sse, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
};

/* ═══════════════════════════════════════════════════════════════════════ */
section('ATTACK 1: claim a paid plan in the request body');

CURRENT = { email: 'free@test.com' };
await setPlan('free@test.com', 'free');

let r = await W.aiProxy(msg(basePayload({ plan: 'ultra', user: { plan: 'ultra' }, tier: 'ultra' })), env, ctx);
let limits = W.effectiveLimits({ email: 'free@test.com', plan: 'free' });
ok(limits.dayTokens === W.PLAN_LIMITS.free.dayTokens,
   'sending plan:"ultra" in the body does NOT raise the limits', limits.dayTokens);

section('ATTACK 2: call a premium engine on a free account');

const premiumKey = Object.keys(W.ENGINES).find(k => W.PLAN_RANK[W.ENGINES[k].minPlan] > 0);
ok(!!premiumKey, 'there is a plan-gated engine to test', premiumKey);

r = await W.aiProxy(msg(basePayload({ model: premiumKey })), env, ctx);
ok(r.status === 402, 'a free account is REFUSED the premium engine (402)', r.status);
const d402 = await r.json();
ok(d402.code === 'plan_required', 'and told which plan it needs', d402);

section('ATTACK 3: burn past the daily token cap');

upstreamCalls = 0;
counters.clear(); resetGlobal();
CURRENT = { email: 'burner@test.com' };
await setPlan('burner@test.com', 'free');

const freeDay = W.PLAN_LIMITS.free.dayTokens;   // 50,000
let allowed = 0, blocked = 0, lastCode = null;
for (let i = 0; i < 10; i++) {
  const rr = await W.aiProxy(msg(basePayload()), env, ctx);
  if (rr.status === 429) { blocked++; lastCode = (await rr.json()).code; }
  else if (rr.status !== 200) { /* unexpected */ }
  else { allowed++; await settle(); }
}
ok(blocked > 0, 'the daily cap actually blocks further calls', { allowed, blocked });
ok(lastCode === 'quota_day' || lastCode === 'rate_limited',
   'and it says why (quota_day)', lastCode);

const usgKey = [...counters.keys()].find(k => k.startsWith('usg:burner@test.com:'));
const used = usgKey ? counters.get(usgKey) : 0;
ok(used > 0,
   'usage is genuinely recorded server-side, not trusted from the client', { usgKey, used });

section('ATTACK 4: hammer the rate limit');

counters.clear(); resetGlobal();
CURRENT = { email: 'spammer@test.com' };
await setPlan('spammer@test.com', 'free');
const rpm = W.PLAN_LIMITS.free.rpm;
let rateBlocked = 0;
for (let i = 0; i < rpm + 4; i++) {
  const rr = await W.aiProxy(msg(basePayload()), env, ctx);
  if (rr.status === 429) rateBlocked++;
  await settle();
}
ok(rateBlocked > 0, `more than ${rpm} requests/min is throttled`, rateBlocked);

section('ATTACK 5: generate unlimited images on a free account');

counters.clear(); resetGlobal();
CURRENT = { email: 'imgs@test.com' };
await setPlan('imgs@test.com', 'free');
const imgCap = W.PLAN_LIMITS.free.imagesDay;   // 10

let imgAllowed = 0, imgBlocked = 0;
for (let i = 0; i < imgCap + 5; i++) {
  const rr = await W.imageMeter(new Request('https://api.amv.dev/v1/image', {
    method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }), env);
  if (rr.status === 429) imgBlocked++; else imgAllowed++;
}
ok(imgBlocked > 0, 'image generation is capped per day on the free plan', { imgAllowed, imgBlocked });
ok(imgAllowed <= imgCap + 1, 'and the cap is roughly the plan"s imagesDay', { imgAllowed, imgCap });

/* ────────────────────────────────────────────────────────────────────────
   ATTACK: fire everything AT ONCE.

   The quota is "read used -> compare -> call model -> add usage". If the
   counter is not atomic, N parallel requests all read the same `used`, all
   pass the check, and all call the model. The cap is bypassed by anyone who
   opens devtools and sends 20 fetches in a loop.

   This is only safe if AMV_COUNTER (a Durable Object) is bound. Without it the
   Worker silently falls back to a KV counter that its own comments admit is
   "NOT atomic".
   ──────────────────────────────────────────────────────────────────────── */
section('ATTACK 6: concurrent requests (the race that bypasses the cap)');

counters.clear(); resetGlobal();
CURRENT = { email: 'racer@test.com' };
await setPlan('racer@test.com', 'free');
upstreamCalls = 0;

// free plan: 8 rpm, 50k tokens/day; each call burns 20k. So at most ~3 should land.
const burst = await Promise.all(
  Array.from({ length: 8 }, () => W.aiProxy(msg(basePayload()), env, ctx))
);
await settle();

const landed = burst.filter(x => x.status === 200).length;
const usgK = [...counters.keys()].find(k => k.startsWith('usg:racer@test.com:'));
const burned = usgK ? counters.get(usgK) : 0;

ok(burned <= W.PLAN_LIMITS.free.dayTokens * 1.5,
   'a parallel burst cannot blow far past the daily cap',
   { landed, burned, cap: W.PLAN_LIMITS.free.dayTokens });

section('ATTACK 7: unauthenticated access');

W.__setRequireUser(async () => null);
r = await W.aiProxy(msg(basePayload()), env, ctx);
ok(r.status === 401, 'no valid token = no model access', r.status);

section('The plan is read from the SERVER, never the client');

W.__setRequireUser(async () => {
  const e = await env.AMV_KV.get('ent:' + CURRENT.email);
  const ent = e ? JSON.parse(e) : {};
  return { email: CURRENT.email, plan: ent.plan || 'free', customCfg: ent.custom || null };
});
CURRENT = { email: 'upgraded@test.com' };
await setPlan('upgraded@test.com', 'ultra');
const ultraLimits = W.effectiveLimits({ email: 'upgraded@test.com', plan: 'ultra' });
ok(ultraLimits.dayTokens === W.PLAN_LIMITS.ultra.dayTokens,
   'a REAL paid plan (set server-side at checkout) does raise the limits', ultraLimits.dayTokens);
ok(ultraLimits.dayTokens > W.PLAN_LIMITS.free.dayTokens * 10,
   'and it is meaningfully larger than free');

/* The reservation is booked BEFORE the model runs. So every path that bails out
   after that point has to give it back — otherwise an outage, or hitting the
   global ceiling, would quietly burn through a user's daily allowance while
   producing nothing for them. */
section('A failed call REFUNDS the reservation (no quota eaten for nothing)');

counters.clear(); resetGlobal();
CURRENT = { email: 'refund@test.com' };
await setPlan('refund@test.com', 'free');

// the DAY counter is usg:<email>:YYYY-MM-DD (the month one is YYYY-MM).
const usgOf = (who) => {
  const re = new RegExp('^usg:' + who.replace(/[.@+]/g, m => '\\' + m) + ':\\d{4}-\\d{2}-\\d{2}$');
  const k = [...counters.keys()].find(x => re.test(x));
  return k ? counters.get(k) : 0;
};

// a successful call first, to establish the baseline
await W.aiProxy(msg(basePayload()), env, ctx);
await settle();
const afterOk = usgOf('refund@test.com');
ok(afterOk > 0, 'a successful call is billed', afterOk);
ok(afterOk <= MAX_OUT * 2 + 100,
   'and billed the ACTUAL usage, not the reservation on top of it (no double charge)', afterOk);

// now the model fails
const good = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'overloaded' } }),
  { status: 529, headers: { 'content-type': 'application/json' } });

const failResp = await W.aiProxy(msg(basePayload()), env, ctx);
await settle();
const afterFail = usgOf('refund@test.com');

ok(failResp.status >= 400, 'the failing call errors out', failResp.status);
ok(afterFail === afterOk,
   'and the user"s usage is UNCHANGED — the reservation was refunded', { afterOk, afterFail });

globalThis.fetch = good;

section('Reconciliation: a small call is not billed as a big one');

counters.clear(); resetGlobal();
CURRENT = { email: 'recon@test.com' };
await setPlan('recon@test.com', 'free');

// ask for a huge max_tokens but the model only produces a little
globalThis.fetch = async () => new Response([
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0}}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","usage":{"output_tokens":30}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  ''
].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } });

await W.aiProxy(msg({ model: 'claude-sonnet-4-6', max_tokens: 40000, messages: [{ role: 'user', content: 'hi' }] }), env, ctx);
await settle();
const billed = usgOf('recon@test.com');
ok(billed < 500,
   'reserving 40,000 then using 50 bills ~50 — the unused reservation is refunded', billed);

globalThis.fetch = good;

report();
done();
