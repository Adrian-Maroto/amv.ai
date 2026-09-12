/* THE SIGNATURE IS WHAT MAKES A SALE REAL.

   Every marketplace credit, every plan upgrade and every renewal is granted by
   the Stripe webhook. Nothing else stands between "somebody POSTed JSON at the
   worker" and "the seller's balance went up", so this one function is the
   boundary the whole money path rests on - and it had no coverage whatsoever.

   Two directions matter equally. A forged event must never be accepted, or
   anybody can grant themselves a plan. And a GENUINE event must never be
   rejected, because a rejected webhook means a customer paid and got nothing,
   which they experience as theft and charge back.

   The second direction is where the bug was: Stripe sends every valid signature
   for an event, and during a webhook-secret rotation that is more than one v1.
   The header was parsed with Object.fromEntries, which keeps only the LAST. If
   the configured secret produced the first, every real event was rejected as
   forged - at exactly the moment somebody is rotating a secret. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'wsig.harness.mjs');
writeFileSync(harness, src + `
export { verifyStripeSignature, stripeWebhook, paypalWebhook, DB };
export function __setVerifyPaypal(fn){ verifyPaypalWebhook = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

/* Sign exactly the way Stripe does, so the test exercises the real format. */
async function sign(secret, payload, t){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
}
const now = () => Math.floor(Date.now() / 1000);
const BODY = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
const SECRET = 'whsec_test_secret_value';

section('A genuine event is accepted');
{
  const t = now();
  const v1 = await sign(SECRET, BODY, t);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${v1}`) === true,
     'a correctly signed event passes', true);
}

section('A forged event is not');
{
  const t = now();
  const v1 = await sign('whsec_the_wrong_secret', BODY, t);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${v1}`) === false,
     'signed with the wrong secret, it is refused', false);

  const good = await sign(SECRET, BODY, t);
  ok(await W.verifyStripeSignature(SECRET, JSON.stringify({ id: 'evt_1', type: 'tampered' }), `t=${t},v1=${good}`) === false,
     'and a valid signature for DIFFERENT content does not carry over to this one', false);

  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=` + '0'.repeat(64)) === false,
     'nor does a made-up signature of the right shape', false);
}

section('During a secret rotation, real events still get through');
{
  /* Stripe signs with the old AND the new secret while both are active, and
     sends both. Only reading the last one meant a rotation rejected genuine
     events - a customer pays, the webhook is refused as forged, and they get
     nothing for their money. */
  const t = now();
  const mine = await sign(SECRET, BODY, t);
  const other = await sign('whsec_the_other_one_in_rotation', BODY, t);

  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${other},v1=${mine}`) === true,
     'accepted when our signature is the last offered', true);
  /* The case that used to fail. */
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${mine},v1=${other}`) === true,
     'and accepted when it is the FIRST, which is where this broke', true);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${other},v1=${mine},v1=${other}`) === true,
     'and among several', true);

  /* Accepting any of several must not become accepting anything. */
  const wrongA = await sign('whsec_nope_one', BODY, t);
  const wrongB = await sign('whsec_nope_two', BODY, t);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${wrongA},v1=${wrongB}`) === false,
     'while several wrong signatures are still all wrong', false);
}

section('An old signature cannot be replayed');
{
  const old = now() - 600;                       // ten minutes ago
  const v1 = await sign(SECRET, BODY, old);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${old},v1=${v1}`) === false,
     'a correctly signed but stale event is refused', false);

  const future = now() + 600;
  const v1f = await sign(SECRET, BODY, future);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${future},v1=${v1f}`) === false,
     'and so is one timestamped in the future', false);

  const recent = now() - 60;
  const v1r = await sign(SECRET, BODY, recent);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${recent},v1=${v1r}`) === true,
     'while an ordinary slightly-delayed delivery still works', true);
}

section('Malformed input is refused rather than throwing');
{
  const t = now();
  const v1 = await sign(SECRET, BODY, t);
  const cases = [
    ['no header', ''],
    ['no timestamp', `v1=${v1}`],
    ['no signature', `t=${t}`],
    ['nonsense', 'garbage'],
    ['empty parts', ',,,'],
  ];
  for(const [label, hdr] of cases){
    const r = await W.verifyStripeSignature(SECRET, BODY, hdr);
    ok(r === false, label + ' is refused', { label, r });
  }
  ok(await W.verifyStripeSignature('', BODY, `t=${t},v1=${v1}`) === false,
     'and with no secret configured, nothing is trusted', false);
}

section('The worker verifies before it parses');
{
  /* Parsing first would run JSON.parse on unauthenticated input and, worse,
     invites a later edit that reads a field before the check. */
  const at = src.indexOf('async function stripeWebhook');
  const body = src.slice(at, at + 900);
  ok(body.indexOf('verifyStripeSignature') < body.indexOf('JSON.parse'),
     'the signature is checked before the payload is read', true);
  ok(/audit\(env, 'forged_webhook'/.test(body),
     'and a refused event is recorded, because a forged webhook is an attack', true);
}

/* ── AND THE ROUTE ACTUALLY REFUSES, WHICH IS A DIFFERENT CLAIM ─────────────

   Everything above proves `verifyStripeSignature` is a correct verifier, and
   the section above that proves the route MENTIONS it in the right order. None
   of it proves the route acts on the answer.

   It did not. Changing the handler to

     if (false) { audit(env, 'forged_webhook', …); return new Response(…, 400); }

   leaves both of those source strings exactly where they were, in the same
   order - and every money suite in the repository still passed while a forged
   event granted plans. This is the same shape as a verifier that is called and
   whose result is dropped, and it is on the one path where the consequence is
   anybody on the internet giving themselves whatever they like.

   So the route is DRIVEN here: a forged event in, a refusal and an untouched
   store out. */
const mkEnv = (extra) => {
  const m = new Map();
  return Object.assign({
    STRIPE_WEBHOOK_SECRET: SECRET,
    PAYPAL_WEBHOOK_ID: 'wh-test',
    AMV_KV: {
      _map: m,
      async get(k){ return m.has(k) ? m.get(k) : null; },
      async put(k, v){ m.set(k, v); },
      async delete(k){ m.delete(k); },
      async list({ prefix }){ return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
  }, extra || {});
};
const post = (fn, env, body, headers) => fn(new Request('https://x/v1/stripe/webhook', {
  method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body,
}), env, { waitUntil(){} });

/* A real-shaped grant: the event that upgrades somebody's plan. If a forgery
   were accepted, THIS is what it would buy. */
const GRANT = JSON.stringify({ id: 'evt_forged_1', type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', mode: 'subscription', customer: 'cus_1',
    customer_email: 'attacker@example.com', subscription: 'sub_1',
    metadata: { email: 'attacker@example.com', plan: 'ultra' } } } });

section('A forged event is refused by the ROUTE, not only by the verifier');
{
  const env = mkEnv();
  const before = env.AMV_KV._map.size;
  const t = now();
  const r = await post(W.stripeWebhook, env, GRANT, { 'Stripe-Signature': `t=${t},v1=` + '0'.repeat(64) });
  ok(r.status === 400, 'the request is refused', r.status);
  ok(env.AMV_KV._map.size === before,
     'and nothing at all was written - no entitlement, no claim, no record',
     [...env.AMV_KV._map.keys()]);
  const ent = await W.DB.get(env, 'ent', 'attacker@example.com');
  ok(!ent, 'in particular, nobody got a plan out of it', ent);
}

section('And the same event, correctly signed, is not refused');
{
  /* The other direction matters just as much: a rejected genuine webhook means
     somebody paid and got nothing, which they experience as theft. This asserts
     the route is a gate and not a wall - it gets past the signature check. */
  const env = mkEnv();
  const t = now();
  const v1 = await sign(SECRET, GRANT, t);
  const r = await post(W.stripeWebhook, env, GRANT, { 'Stripe-Signature': `t=${t},v1=${v1}` });
  ok(r.status !== 400, 'a genuine event is not turned away as a forgery', r.status);
  ok(env.AMV_KV._map.size > 0, 'and the worker got far enough to do real work',
     [...env.AMV_KV._map.keys()].slice(0, 6));
}

section('PayPal refuses at the route too, by the same measurement');
{
  /* The second money path, with the same shape of verifier and the same shape
     of hole available. Its verification is a call to PayPal, so that call is
     the thing stubbed - everything from the answer inward is the real route. */
  const env = mkEnv();
  W.__setVerifyPaypal(async () => false);
  const body = JSON.stringify({ id: 'WH-forged', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
    resource: { id: 'I-1', custom_id: 'attacker@example.com|ultra' } });
  const r = await W.paypalWebhook(new Request('https://x/v1/paypal/webhook',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), env, { waitUntil(){} });
  ok(r.status === 400, 'an unverified PayPal event is refused', r.status);
  ok(env.AMV_KV._map.size === 0, 'with nothing written', [...env.AMV_KV._map.keys()]);
  const ent = await W.DB.get(env, 'ent', 'attacker@example.com');
  ok(!ent, 'and no plan granted', ent);

  W.__setVerifyPaypal(async () => true);
  const env2 = mkEnv();
  const r2 = await W.paypalWebhook(new Request('https://x/v1/paypal/webhook',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), env2, { waitUntil(){} });
  ok(r2.status !== 400, 'while a verified one gets through', r2.status);
}

if (report('webhook-signature') > 0) process.exitCode = 1;
done();
