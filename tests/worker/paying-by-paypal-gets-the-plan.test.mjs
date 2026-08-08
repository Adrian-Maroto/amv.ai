/* SOMEBODY PAID BY PAYPAL EVERY MONTH AND STAYED ON THE FREE PLAN.

   The subscribe route created a real recurring subscription at PayPal. The
   webhook verified the signature properly, handled refunds, cancellations and
   failed payments correctly - and on the one event that means "they have paid
   and it is live", called a helper that returns immediately for anybody who is
   not already past due. Which is every new subscriber.

   The only setEntitlement anywhere on the PayPal path set the plan to 'free',
   on cancellation. custom_id had carried the tier since the day it was written
   and the handler destructured it away: `const [email] = custom.split('|')`.

   So: money in, monthly, forever. Nothing out. No error, no log, no alert. The
   customer sees the free plan and concludes the product is broken, and they are
   right - it took their money.

   Nothing caught it because nothing here was ever tested, and because every
   part of it looks correct on its own. The signature check is real. The refund
   path is real. The failure path is real. Only the success path was missing,
   and a success path that does nothing is invisible from every direction except
   the customer's.

   These cases are written from the customer's side: after this sequence of real
   PayPal events, what plan does the account actually have? */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'paypal.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _paypalTierOf };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'paypaluser@example.com';
const PLAN_PRO = 'P-PRO-123';
const PLAN_ELITE = 'P-ELITE-456';

/* The webhook is signature-verified against PayPal's API. That call is the
   outside world, so it is stubbed - and stubbed as ACCEPTING, because every
   case here is about what happens to a payment that is genuinely real. A
   separate case forces it to reject. */
let verifyOk = true;
const alerts = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/oauth2\/token/.test(u)) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
  if (/verify-webhook-signature/.test(u))
    return { ok: true, status: 200, json: async () => ({ verification_status: verifyOk ? 'SUCCESS' : 'FAILURE' }) };
  if (/slack|discord|hooks\./i.test(u)) { alerts.push(String((opts && opts.body) || '')); return { ok: true, status: 200, json: async () => ({}) }; }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv() {
  const m = new Map(); alerts.length = 0; verifyOk = true;
  return {
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
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec', PAYPAL_WEBHOOK_ID: 'wh',
    PAYPAL_PLAN_PRO: PLAN_PRO, PAYPAL_PLAN_ELITE: PLAN_ELITE,
    ALERT_WEBHOOK: 'https://hooks.example/alert',
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };

/* A real PayPal webhook delivery. */
async function hook(env, event_type, resource) {
  const r = await worker.fetch(new Request('https://api.amv.test/v1/paypal/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '80.80.80.80',
               'paypal-transmission-id': 't1', 'paypal-transmission-time': new Date().toISOString(),
               'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-auth-algo': 'SHA256withRSA',
               'paypal-transmission-sig': 'sig' },
    body: JSON.stringify({ event_type, resource }),
  }), env, ctx);
  await ctx.settle();
  return r;
}
const planOf = async (env) => ((await W.DB.get(env, 'ent', USER)) || {}).plan || 'free';
const entOf = async (env) => (await W.DB.get(env, 'ent', USER)) || null;

section('Subscribing and paying gets the plan that was paid for');
{
  /* The assertion the whole file exists for. Before the fix this returned
     'free' - after a real, verified, activated, paid subscription. */
  const env = mkEnv();
  ok((await planOf(env)) === 'free', 'they start on free', await planOf(env));

  await hook(env, 'BILLING.SUBSCRIPTION.ACTIVATED', {
    id: 'I-SUB1', plan_id: PLAN_PRO, custom_id: USER + '|pro' });

  ok((await planOf(env)) === 'pro', 'after activation they are on Pro', await planOf(env));
  const ent = await entOf(env);
  ok(ent.source === 'paypal', 'recorded as a PayPal subscription', ent.source);
  ok(!ent.pastDueSince, 'and not past due', ent.pastDueSince);
}

section('The tier comes from what PayPal is really billing');
{
  /* custom_id round-trips through the client. The plan id is what the money is
     actually against, so where they disagree the charge wins - otherwise a
     tampered checkout claims Ultra and pays for Pro. */
  const env = mkEnv();
  await hook(env, 'BILLING.SUBSCRIPTION.ACTIVATED', {
    id: 'I-SUB2', plan_id: PLAN_PRO, custom_id: USER + '|ultra' });
  ok((await planOf(env)) === 'pro',
     'a claim of Ultra against a Pro billing plan grants Pro', await planOf(env));
}

section('And falls back to the tier they chose when there is no plan id');
{
  const env = mkEnv();
  await hook(env, 'PAYMENT.SALE.COMPLETED', { id: 'S1', custom_id: USER + '|elite' });
  ok((await planOf(env)) === 'elite', 'the tier they subscribed to is honoured', await planOf(env));
}

section('A tier nobody recognises is never guessed');
{
  /* Guessing high gives product away; guessing low shortchanges somebody who
     paid. Both are worse than saying so and fetching a human. */
  const env = mkEnv();
  await hook(env, 'BILLING.SUBSCRIPTION.ACTIVATED', {
    id: 'I-SUB3', plan_id: 'P-SOMETHING-ELSE', custom_id: USER + '|' });
  ok((await planOf(env)) === 'free', 'nothing is granted on a guess', await planOf(env));
  ok(alerts.some(a => /PAID and has NOT been granted/i.test(a)),
     'and somebody is told a customer has paid and received nothing', alerts.length);
}

section('Every renewal keeps the subscription alive');
{
  /* The renewal sweep revokes a plan that stops looking paid-for. A renewal
     that does not move renewedAt would have the sweep cancel a subscription
     the customer is still being charged for. */
  const env = mkEnv();
  await hook(env, 'BILLING.SUBSCRIPTION.ACTIVATED', {
    id: 'I-SUB4', plan_id: PLAN_PRO, custom_id: USER + '|pro' });

  const ent = await entOf(env);
  ent.renewedAt = Date.now() - 40 * 86400000;        // a month and a half ago
  await W.DB.put(env, 'ent', USER, ent);

  await hook(env, 'PAYMENT.SALE.COMPLETED', { id: 'S2', custom_id: USER + '|pro' });
  const after = await entOf(env);
  ok(after.plan === 'pro', 'they are still on Pro', after.plan);
  ok(Date.now() - after.renewedAt < 60000,
     'and the renewal is recorded as just now, so nothing revokes a live subscription',
     Math.round((Date.now() - after.renewedAt) / 1000) + 's ago');
}

section('A failed payment does not buy another month');
{
  const env = mkEnv();
  await hook(env, 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-SUB5', plan_id: PLAN_PRO, custom_id: USER + '|pro' });
  await hook(env, 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', { id: 'I-SUB5', custom_id: USER + '|pro' });
  const ent = await entOf(env);
  ok(!!ent.pastDueSince, 'the account is marked past due', !!ent.pastDueSince);
}

section('And paying again clears it');
{
  const env = mkEnv();
  await hook(env, 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-SUB6', plan_id: PLAN_PRO, custom_id: USER + '|pro' });
  await hook(env, 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', { id: 'I-SUB6', custom_id: USER + '|pro' });
  ok(!!(await entOf(env)).pastDueSince, 'past due first', true);

  await hook(env, 'PAYMENT.SALE.COMPLETED', { id: 'S3', custom_id: USER + '|pro' });
  const ent = await entOf(env);
  ok(!ent.pastDueSince, 'and recovered once they pay', ent.pastDueSince);
  ok(ent.plan === 'pro', 'still on their plan throughout', ent.plan);
}

section('Cancelling still ends it');
{
  const env = mkEnv();
  await hook(env, 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-SUB7', plan_id: PLAN_ELITE, custom_id: USER + '|elite' });
  ok((await planOf(env)) === 'elite', 'on Elite', await planOf(env));
  await hook(env, 'BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-SUB7', custom_id: USER + '|elite' });
  ok((await planOf(env)) === 'free', 'back to free when they cancel', await planOf(env));
}

section('A refund takes the plan back too');
{
  const env = mkEnv();
  await hook(env, 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-SUB8', plan_id: PLAN_PRO, custom_id: USER + '|pro' });
  await hook(env, 'PAYMENT.CAPTURE.REFUNDED', { id: 'C1', custom_id: USER + '|pro' });
  ok((await planOf(env)) === 'free', 'a refunded payment does not keep the plan', await planOf(env));
}

section('And none of this can be done by forging the webhook');
{
  /* The grant is new, so the thing that stops anybody granting themselves a
     plan by POSTing JSON has to be re-checked against it. */
  const env = mkEnv();
  verifyOk = false;
  const r = await hook(env, 'BILLING.SUBSCRIPTION.ACTIVATED', {
    id: 'I-FAKE', plan_id: PLAN_PRO, custom_id: USER + '|ultra' });
  ok(r.status === 400, 'an unverified delivery is refused', r.status);
  ok((await planOf(env)) === 'free', 'and grants nothing', await planOf(env));
}

section('The tier mapping itself');
{
  const env = mkEnv();
  ok(W._paypalTierOf(env, PLAN_PRO, null) === 'pro', 'a configured plan id maps to its tier', true);
  ok(W._paypalTierOf(env, null, 'elite') === 'elite', 'a known claimed tier is accepted', true);
  ok(W._paypalTierOf(env, null, 'owner') === null, 'an invented tier is not', W._paypalTierOf(env, null, 'owner'));
  ok(W._paypalTierOf(env, null, null) === null, 'and nothing at all maps to nothing', true);
  /* Unconfigured tiers must not collide into a match - the mapping is built
     from env values that may be undefined. */
  ok(W._paypalTierOf(env, undefined, null) === null, 'an absent plan id does not match an unset secret', true);
  ok(W._paypalTierOf(env, 'P-ULTRA-NOT-SET', null) === null, 'nor does an id for a tier with no secret set', true);
}

globalThis.fetch = realFetch;
if (report('paying-by-paypal-gets-the-plan') > 0) process.exitCode = 1;
done();
