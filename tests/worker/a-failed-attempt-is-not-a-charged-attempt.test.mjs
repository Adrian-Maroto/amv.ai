/* THE RETRY NOBODY REFUNDED.

   `aiProxy` books a token reservation before it calls the model, and every way
   the call can fail gives it back - there is a comment saying why, because an
   outage that charges everybody for answers they never received burns a free
   account's whole day in a handful of requests.

   Every way but one. When the provider rejects an OPTIONAL parameter with a
   400, AMV strips the tuning and calls again, so a model that stops accepting
   `thinking` or `cache_control` does not take chat down for everyone. That
   second call sat outside the try/catch that refunds. If the network failed on
   the retry, the reservation stayed booked and the customer was charged for
   nothing.

   The path that reaches it is already a bad one - the first attempt was
   rejected - so this is the failure that fires when something is already going
   wrong, which is the worst time to also start silently taking people's
   allowance.

   Checked by running it: two responses from the provider, a 400 then a thrown
   socket error, and then the counter is read. Reading the code for a
   `try` around the right line would pass on a `try` that catches and then
   forgets to refund. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'retryrefund.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'spender@example.com';
const PW = 'A-real-Passw0rd!';

/* What the provider does, call by call. Set per case. */
let script = [];
let calls = 0;
const realFetch = globalThis.fetch;
const sse = () => 'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
                + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
                + 'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n'
                + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!/model\.example/.test(u)) return { ok: true, status: 200, json: async () => ({}) };
  const step = script[calls++] || 'ok';
  if (step === 'throw') throw new TypeError('fetch failed');
  if (step === 'param400') {
    return new Response(JSON.stringify({ error: { message: 'unsupported parameter: thinking' } }),
                        { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

function mkEnv() {
  const m = new Map(); const vals = new Map(); calls = 0;
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    _vals: vals,
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const cur = vals.get(n) || 0;
        if (b.op === 'reserve') {
          if (b.cap != null && b.cap !== Infinity && cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount }));
        }
        if (b.op === 'incr') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: b.cap == null || cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };

const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '40.40.40.40' }, headers || {}),
  body: JSON.stringify(body),
}), env, ctx);

async function signedIn(env) {
  const r = await call(env, '/auth/signup', { email: USER, name: 'S', password: PW });
  const tok = (await r.json()).token;
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const ask = (env, tok) => call(env, '/v1/messages',
  { model: 'amv-core', max_tokens: 128, thinking: { type: 'enabled', budget_tokens: 64 },
    messages: [{ role: 'user', content: 'hello' }] },
  { 'Authorization': 'Bearer ' + tok });

/* Everything the reservation touched, netted. Zero means the customer's
   allowance is exactly where it started.

   The prefix is `usg:`, taken from the two counter names aiProxy reserves
   against. Guessed wrong the first time, and every case still passed except
   the control below - which is the reason the control is there. A measure that
   reads nothing reports zero, and zero is also what a correct refund looks
   like. */
const booked = (env) => [...env._vals.entries()]
  .filter(([k]) => k.startsWith('usg:'))
  .reduce((n, [, v]) => n + v, 0);

section('An ordinary turn does book something, so the measure means anything');
{
  /* Without this the case below could pass on a reservation that never
     happened - nothing booked and nothing refunded look identical at the end. */
  const env = mkEnv();
  const tok = await signedIn(env);
  script = ['ok'];
  const r = await ask(env, tok);
  await ctx.settle();
  ok(r.status === 200, 'the turn is served', r.status);
  ok(booked(env) > 0, 'and the allowance records it', booked(env));
}

section('The first call failing gives the reservation back');
{
  /* The case that was already correct. It is here so the two are compared:
     the retry has to behave the same way, and a file that only tested the
     broken one would not notice if the fix made them differ. */
  const env = mkEnv();
  const tok = await signedIn(env);
  script = ['throw'];
  const r = await ask(env, tok);
  await ctx.settle();
  ok(r.status === 503, 'the person is told AMV could not reach the model', r.status);
  ok(booked(env) === 0, 'and nothing is left booked against them', booked(env));
}

section('The RETRY failing gives it back too - this is the one that did not');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  script = ['param400', 'throw'];
  const r = await ask(env, tok);
  await ctx.settle();
  ok(calls === 2, 'the provider was called twice - a 400 about tuning, then a retry', calls);

  const body = await r.json().catch(() => ({}));
  ok(r.status >= 500, 'the failure is reported as a failure', r.status);
  ok(body.code === 'upstream_unreachable', 'with a code that names what happened', body.code);
  ok(/[Nn]othing was charged/.test(body.error || ''),
     'and a sentence saying the allowance was not touched', body.error);

  /* The claim in that sentence, checked rather than trusted. This is the whole
     finding: the words were never the problem, the counter was. */
  ok(booked(env) === 0, 'and the allowance really was not touched', booked(env));
}

section('A retry that succeeds still charges, because the answer was delivered');
{
  /* The other direction. A refund on every retry would be a free-chat bug, and
     it would look exactly as correct as the fix does. */
  const env = mkEnv();
  const tok = await signedIn(env);
  script = ['param400', 'ok'];
  const r = await ask(env, tok);
  await ctx.settle();
  ok(r.status === 200, 'the stripped retry serves the person', r.status);
  ok(booked(env) > 0, 'and that turn is counted, because they got an answer', booked(env));
}

globalThis.fetch = realFetch;
if (report('a-failed-attempt-is-not-a-charged-attempt') > 0) process.exitCode = 1;
done();
