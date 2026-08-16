/* WHOEVER GETS TURNED AWAY ON A BUSY DAY, IT IS NOT THE PERSON WHO PAID.

   There is one global daily spend cap, and it existed for a good reason: a
   runaway bill is the thing that kills a company faster than no customers. But
   it was checked identically for everybody.

   So a busy day of free usage spends the day's budget, and the next request
   refused belongs to somebody on Ultra. AMV has taken their two hundred
   dollars and answered "at capacity" - which is a refund, then a chargeback,
   then a review that says AMV takes your money and stops working, all caused by
   traffic that pays nothing.

   The cap stays. It is shared unequally: free accounts may reach part of it,
   paying accounts may reach all of it. On a busy day the free tier is what gets
   shed, and that is the only order that is not a refund waiting to happen.

   Two things this must not become. A free user turned away must be told the
   truth - "busy for free accounts today", not "AMV is broken" - because the
   first is honest and the second loses somebody who would have paid. And the
   spend that was reserved for a refused call has to come back, or being turned
   away would also cost them their own allowance. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'freecap.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, FREE_TIER_CAP_SHARE, todayKey };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
let modelCalls = 0;
/* A REAL streamed response. The proxy tees the body to meter it, so a stub
   with `body: null` does not exercise the path at all - it throws before any of
   the capacity logic is reached. */
const sse = (t) => 'data: ' + JSON.stringify(t) + '\n\n';
globalThis.fetch = async (url) => {
  if (/model\.example/.test(String(url))) {
    modelCalls++;
    const body = sse({ type: 'message_start', message: { usage: { input_tokens: 5 } } })
               + sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
               + sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })
               + 'data: [DONE]\n\n';
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

const GLOBAL_CAP = 100;
function mkEnv() {
  const m = new Map(); const vals = new Map(); modelCalls = 0;
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a',
    APP_URL: 'https://amv.test', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    GLOBAL_DAILY_USD_CAP: String(GLOBAL_CAP),
    _vals: vals,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(x) || 0;
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
        /* The real Durable Object REFUSES a reservation that would take the
           counter past its cap. This stub used to allow every one of them,
           which made it more permissive than the thing it stands in for - so a
           ceiling that had stopped working would still look enforced here. */
        if (b.op === 'reserve') {
          const amt = Number(b.amount);
          if (!Number.isFinite(amt) || amt < 0) return new Response(JSON.stringify({ allowed: false, value: cur }));
          if (b.cap != null && b.cap !== Infinity && cur + amt > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(x, cur + amt); return new Response(JSON.stringify({ allowed: true, value: vals.get(x) }));
        }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { vals.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') { if (vals.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { vals.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const PW = 'A-real-Passw0rd!';
const signup = async (env, email) =>
  (await (await worker.fetch(new Request('https://api.amv.test/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '60.1.2.' + Math.floor(Math.random() * 250) },
    body: JSON.stringify({ email, name: 'N', password: PW }),
  }), env, ctx)).json()).token;

const ask = async (env, tok) => {
  const r = await worker.fetch(new Request('https://api.amv.test/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok, 'CF-Connecting-IP': '60.1.2.3' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
  }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
/* Put the day's spend at a chosen point, the way a busy day would. */
const spendToday = (env, usd) => env._vals.set(`spend:${W.todayKey()}`, usd);

section('On a quiet day everybody is served');
{
  const env = mkEnv();
  const free = await signup(env, 'free@example.com');
  const paid = await signup(env, 'paid@example.com');
  await W.setEntitlement(env, 'paid@example.com', 'ultra', { source: 'stripe' });
  spendToday(env, 1);

  const a = await ask(env, free);
  const b = await ask(env, paid);
  ok(a.status === 200, 'a free account gets an answer', a.status + ' ' + (a.body.error || ''));
  ok(b.status === 200, 'and so does a paying one', b.status + ' ' + (b.body.error || ''));
}

section('Past the free share, the FREE tier is what stops');
{
  const env = mkEnv();
  const free = await signup(env, 'free2@example.com');
  /* Above the free share, below the whole cap - the busy afternoon this is
     about. */
  spendToday(env, GLOBAL_CAP * W.FREE_TIER_CAP_SHARE + 1);

  const a = await ask(env, free);
  ok(a.status === 503, 'the free account is turned away', a.status);
  ok(a.body.code === 'free_capacity', 'with a reason that names what happened', a.body.code);
  ok(/free accounts/i.test(a.body.error || ''), 'saying it is about free accounts, not AMV being broken', a.body.error);
  ok(/paid plans are running/i.test(a.body.error || ''),
     'and that paying is unaffected, which is true and worth knowing', a.body.error);
  ok(modelCalls === 0, 'and nothing was spent on the refused call', modelCalls);
}

section('While the paying customer keeps working - the whole point');
{
  const env = mkEnv();
  const paid = await signup(env, 'paid2@example.com');
  await W.setEntitlement(env, 'paid2@example.com', 'ultra', { source: 'stripe' });
  spendToday(env, GLOBAL_CAP * W.FREE_TIER_CAP_SHARE + 1);

  const b = await ask(env, paid);
  ok(b.status === 200, 'somebody who paid still gets their answer', b.status + ' ' + (b.body.error || ''));
  ok(modelCalls > 0, 'and it really went to the model', modelCalls);
}

section('At the true ceiling, everything stops - including paying');
{
  /* The cap is a cap. Past it AMV is spending money it decided not to spend,
     and a paying customer being told to come back tomorrow is bad but a
     runaway bill is worse. */
  const env = mkEnv();
  const paid = await signup(env, 'paid3@example.com');
  await W.setEntitlement(env, 'paid3@example.com', 'ultra', { source: 'stripe' });
  spendToday(env, GLOBAL_CAP + 1);

  const b = await ask(env, paid);
  ok(b.status === 503, 'the hard ceiling still holds for everybody', b.status);
  ok(b.body.code === 'global_cap', 'and it is the global cap that says so', b.body.code);
}

section('Being turned away does not also cost them their own allowance');
{
  /* The reservation is taken before these checks. Refusing without giving it
     back would mean a free user who was turned away for capacity ALSO lost the
     tokens they never used. */
  const env = mkEnv();
  const free = await signup(env, 'free3@example.com');
  spendToday(env, GLOBAL_CAP * W.FREE_TIER_CAP_SHARE + 1);

  const before = env._vals.get(`usg:free3@example.com:${W.todayKey()}`) || 0;
  await ask(env, free);
  const after = env._vals.get(`usg:free3@example.com:${W.todayKey()}`) || 0;
  ok(after <= before, 'the reserved allowance is given back', { before, after });
}

section('The share is a stated number, not a guess');
{
  ok(typeof W.FREE_TIER_CAP_SHARE === 'number', 'it is defined', W.FREE_TIER_CAP_SHARE);
  ok(W.FREE_TIER_CAP_SHARE > 0 && W.FREE_TIER_CAP_SHARE < 1,
     'free gets a real share, and not all of it', W.FREE_TIER_CAP_SHARE);
  ok(W.FREE_TIER_CAP_SHARE >= 0.5,
     'generous enough that the free tier is still a real product', W.FREE_TIER_CAP_SHARE);
}

globalThis.fetch = realFetch;
if (report('the-free-tier-cannot-lock-out-a-customer') > 0) process.exitCode = 1;
done();
