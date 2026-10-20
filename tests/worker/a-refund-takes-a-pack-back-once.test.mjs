/* A REFUND TAKES A PACK OF EXTRA USAGE BACK ONCE.

   A pack bought and then refunded or disputed has its credit taken away
   (_creditReverse). It read how much had already been taken, took the rest,
   and wrote the new total back - with nothing holding the record in between.
   Stripe sends a refund and a dispute as two separate events, and it delivers
   events concurrently; two arriving together each read "nothing taken yet"
   and each took the whole pack. Somebody who bought $25 of credit and was
   refunded lost $50 of it - the second $25 out of credit they had paid for
   separately. Nothing tested the reversal at all.

   Driven through the real Stripe webhook, signed, against a counter that keeps
   real claims:
     - a refund takes the pack's credit back, and the record says how much;
     - a refund and a dispute for the same pack arriving at the same moment
       take it back once: the second is told to come back (a 500, which Stripe
       retries), and its retry finds nothing left to take;
     - a partial refund takes back that part, and a later full one the rest. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'creditrev.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { stripeWebhook, _creditGrant, _creditState };\n');
const W = await import(harness + '?t=' + Date.now());

function mkEnv() {
  const m = new Map(), vals = new Map(), claims = new Map();
  /* Every storage call yields, as the real ones do, so two webhooks in flight
     really do interleave. */
  const tick = () => new Promise(r => setTimeout(r, 1));
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', APP_URL: 'https://amv.test',
    STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test_secret', _vals: vals, _map: m,
    AMV_KV: {
      async get(k) { await tick(); return m.has(k) ? m.get(k) : null; },
      async put(k, v) { await tick(); m.set(k, v); },
      async delete(k) { await tick(); m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        await tick();
        const b = JSON.parse(init.body); const cur = vals.get(x) || 0;
        if (b.op === 'claim') { if (claims.has(x)) return new Response(JSON.stringify({ claimed: false })); claims.set(x, b.owner || 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { claims.delete(x); return new Response(JSON.stringify({ released: true })); }
        if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const WHSEC = 'whsec_test_secret';
let n = 0;
async function stripe(env, type, obj) {
  const body = JSON.stringify({ id: 'evt_' + (++n), type, created: Math.floor(Date.now() / 1000), data: { object: obj } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WHSEC), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const v1 = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + body)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const r = await W.stripeWebhook(new Request('https://w/v1/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': 't=' + t + ',v1=' + v1 }, body }), env, { waitUntil() {} });
  return { status: r.status, body };
}
const resend = async (env, body) => {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WHSEC), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const v1 = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + body)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return (await W.stripeWebhook(new Request('https://w/v1/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': 't=' + t + ',v1=' + v1 }, body }), env, { waitUntil() {} })).status;
};
const SUBJ = 'u:pack@example.com';
const left = async (env) => (await W._creditState(env, SUBJ)).bought;

section('A refund takes the pack back');
{
  const env = mkEnv();
  await W._creditGrant(env, { subject: SUBJ, email: 'pack@example.com', usd: 25, ref: 'pi_a' });
  ok(await left(env) === 25, 'a $25 pack is credited', await left(env));
  const r = await stripe(env, 'charge.refunded', { id: 'ch_a', payment_intent: 'pi_a', amount: 2500, amount_refunded: 2500 });
  ok(r.status === 200 && await left(env) === 0, 'the refund takes it back', [r.status, await left(env)]);
  ok(JSON.parse(env._map.get('creditpay:pi_a')).reversed === 25, 'and the record says how much', env._map.get('creditpay:pi_a'));
}

section('A refund and a dispute arriving together take it back once');
{
  const env = mkEnv();
  await W._creditGrant(env, { subject: SUBJ, email: 'pack@example.com', usd: 25, ref: 'pi_b' });
  await W._creditGrant(env, { subject: SUBJ, email: 'pack@example.com', usd: 10, ref: 'pi_other' });
  ok(await left(env) === 35, 'two packs, $35 of credit', await left(env));
  const [a, b] = await Promise.all([
    stripe(env, 'charge.refunded', { id: 'ch_b', payment_intent: 'pi_b', amount: 2500, amount_refunded: 2500 }),
    stripe(env, 'charge.dispute.created', { id: 'dp_b', charge: 'ch_b', payment_intent: 'pi_b', amount: 2500 }),
  ]);
  ok(await left(env) === 10, 'only the refunded pack is gone - the other $10 is untouched', [a.status, b.status, await left(env)]);
  const waiting = [a, b].filter(x => x.status === 500);
  ok(waiting.length <= 1, 'at most one was told to come back', [a.status, b.status]);
  for (const w of waiting) ok(await resend(env, w.body) === 200, 'and its retry is accepted', true);
  ok(await left(env) === 10, 'and taking nothing more', await left(env));
}

section('A partial refund, then the rest');
{
  const env = mkEnv();
  await W._creditGrant(env, { subject: SUBJ, email: 'pack@example.com', usd: 50, ref: 'pi_c' });
  await stripe(env, 'charge.refunded', { id: 'ch_c', payment_intent: 'pi_c', amount: 5000, amount_refunded: 2000 });
  ok(await left(env) === 30, 'a $20 refund takes $20', await left(env));
  await stripe(env, 'charge.refunded', { id: 'ch_c', payment_intent: 'pi_c', amount: 5000, amount_refunded: 5000 });
  ok(await left(env) === 0, 'the full refund later takes the other $30, not $50 more', await left(env));
}

if (report('a-refund-takes-a-pack-back-once') > 0) process.exitCode = 1;
done();
