/* UPGRADING A PLAN CHARGED FOR BOTH OF THEM.

   Checkout was created with `customer_email` and no `customer`. Stripe treats
   that as "make a new Customer", every time. So the most ordinary paid action
   after signing up - pressing Upgrade - produced a SECOND Stripe customer
   carrying a SECOND subscription, and `_linkCustomer` then repointed the
   account at the new one.

   The old subscription kept billing. Nothing cancelled it, because from
   Stripe's side an upgrade through Checkout is not an edit of the old
   subscription, it is a new one. And the billing portal opens whichever
   customer the account currently points at, so the first subscription was not
   merely still charging - it was unreachable. $15 and $75 a month, at once,
   with no way to stop half of it from inside AMV.

   The remedy left to the customer is a chargeback, which then trips the abuse
   flag on THEIR account. So the bug's second act is to punish the person it
   overcharged.

   Two properties fix it, and both are asserted here: the same customer is
   reused, so everything lands in one place the portal can open; and a
   subscription that has been superseded is cancelled, so nothing bills for a
   plan the account no longer holds. Cancelling is the destructive half, so the
   limits on it are asserted too - same customer only, never the new
   subscription, and never one that was already dead. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'one-sub.harness.mjs');
writeFileSync(harness, src + `
export { stripeCheckout, stripeWebhook, _cancelSupersededSubs, _linkCustomer,
         setEntitlement, issueTokens, DB };
export function __setRequireUser(fn){ requireUser = fn; }
export function __setVerify(fn){ verifyStripeSignature = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  STRIPE_SECRET_KEY: 'sk_test_x',
  ALERT_WEBHOOK: 'https://alert.test/hook',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_ELITE: 'price_elite',
  APP_URL: 'https://amv.test',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
  },
};
W.__setRequireUser(async () => ({ email: 'buyer@x.com', plan: 'free', customCfg: null }));
W.__setVerify(async () => true);

/* A tiny Stripe. Subscriptions live here so a cancellation is observable. */
let SUBS = [];
let calls = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url), method = (opts && opts.method) || 'GET';
  calls.push({ u, method, body: (opts && opts.body) ? String(opts.body) : '' });
  if (u.includes('/v1/checkout/sessions')) {
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.test/s' }), { status: 200 });
  }
  if (u.includes('/v1/subscriptions?')) {
    return new Response(JSON.stringify({ data: SUBS }), { status: 200 });
  }
  if (method === 'DELETE' && u.includes('/v1/subscriptions/')) {
    const id = decodeURIComponent(u.split('/v1/subscriptions/')[1]);
    SUBS = SUBS.filter(s => s.id !== id);
    return new Response(JSON.stringify({ id, status: 'canceled' }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
const post = (path, body) => new Request('https://api.amv.dev' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
  body: JSON.stringify(body),
});
const hook = (obj) => new Request('https://api.amv.dev/v1/stripe/webhook', {
  method: 'POST', headers: { 'Stripe-Signature': 't=1,v1=x' },
  body: JSON.stringify({ type: 'checkout.session.completed', data: { object: obj } }),
});
const sessionForm = () => {
  const c = calls.filter(x => x.u.includes('/v1/checkout/sessions')).pop();
  return new URLSearchParams(c ? c.body : '');
};

section('The very first checkout has no customer to reuse');
{
  calls = [];
  const r = await W.stripeCheckout(post('/v1/stripe/checkout', { plan: 'pro' }), env);
  const d = await r.json();
  ok(d.url === 'https://checkout.test/s', 'a session is created', d);
  const f = sessionForm();
  ok(f.get('customer_email') === 'buyer@x.com', 'so Stripe is given the email', f.get('customer_email'));
  ok(!f.get('customer'), 'and no customer id, because there is not one yet', f.get('customer'));
}

section('Paying binds the account to that customer');
{
  SUBS = [{ id: 'sub_pro', status: 'active' }];
  await W.stripeWebhook(hook({
    metadata: { email: 'buyer@x.com', plan: 'pro' },
    customer: 'cus_A', subscription: 'sub_pro', amount_total: 1500, currency: 'usd',
  }), env, { waitUntil(){} });

  ok(await env.AMV_KV.get('stripecust:buyer@x.com') === 'cus_A', 'the forward map', await env.AMV_KV.get('stripecust:buyer@x.com'));
  ok(await env.AMV_KV.get('custemail:cus_A') === 'buyer@x.com', 'and the reverse one', await env.AMV_KV.get('custemail:cus_A'));
  ok(SUBS.length === 1 && SUBS[0].id === 'sub_pro',
     'and the subscription they just bought is untouched', SUBS.map(s => s.id));
}

section('Upgrading reuses that customer instead of making another');
{
  calls = [];
  await W.stripeCheckout(post('/v1/stripe/checkout', { plan: 'elite' }), env);
  const f = sessionForm();
  ok(f.get('customer') === 'cus_A', 'the session is attached to the customer they already have', f.get('customer'));
  ok(!f.get('customer_email'),
     'and not the email, which Stripe rejects alongside it and which is what made a second customer', f.get('customer_email'));
}

section('And the plan it replaces stops billing');
{
  SUBS = [{ id: 'sub_pro', status: 'active' }, { id: 'sub_elite', status: 'active' }];
  await W.stripeWebhook(hook({
    metadata: { email: 'buyer@x.com', plan: 'elite' },
    customer: 'cus_A', subscription: 'sub_elite', amount_total: 7500, currency: 'usd',
  }), env, { waitUntil(){} });

  ok(SUBS.some(s => s.id === 'sub_elite'), 'the new subscription survives', SUBS.map(s => s.id));
  ok(!SUBS.some(s => s.id === 'sub_pro'), 'the one it superseded does not', SUBS.map(s => s.id));
  const ent = await W.DB.get(env, 'ent', 'buyer@x.com');
  ok(ent.plan === 'elite', 'and the account holds the plan they paid for', ent.plan);
}

section('It only ever touches the customer in front of it');
{
  /* The destructive half, bounded. Somebody else's subscription must not be
     reachable from this path even if the id were guessed. */
  SUBS = [{ id: 'sub_elite', status: 'active' }];
  calls = [];
  await W._cancelSupersededSubs(env, 'cus_A', 'sub_elite', 'buyer@x.com');
  const listed = calls.filter(c => c.u.includes('/v1/subscriptions?'));
  ok(listed.length === 1, 'one listing', listed.length);
  ok(listed[0].u.includes('customer=cus_A'), 'scoped to this customer', listed[0].u);
  ok(!calls.some(c => c.method === 'DELETE'), 'and nothing was cancelled', calls.filter(c => c.method === 'DELETE'));
  ok(SUBS.length === 1, 'the subscription they are paying for is still there', SUBS.map(s => s.id));
}

section('A subscription that was already dead is left alone');
{
  /* Cancelling a canceled subscription is a pointless write against a live
     billing system, and an incomplete one never charged anybody. */
  SUBS = [{ id: 'sub_new', status: 'active' },
          { id: 'sub_dead', status: 'canceled' },
          { id: 'sub_never', status: 'incomplete_expired' }];
  calls = [];
  const res = await W._cancelSupersededSubs(env, 'cus_A', 'sub_new', 'buyer@x.com');
  ok(res.cancelled === 0, 'nothing needed cancelling', res);
  ok(SUBS.length === 3, 'and the records are as they were', SUBS.length);
}

section('One that is failing to charge does get cancelled');
{
  /* past_due and unpaid are still attached to the card and still retrying, so
     leaving them is the same double charge with a delay on it. */
  SUBS = [{ id: 'sub_new', status: 'active' },
          { id: 'sub_old', status: 'past_due' },
          { id: 'sub_trial', status: 'trialing' }];
  const res = await W._cancelSupersededSubs(env, 'cus_A', 'sub_new', 'buyer@x.com');
  ok(res.cancelled === 2, 'both of the ones that could still charge', res);
  ok(SUBS.length === 1 && SUBS[0].id === 'sub_new', 'leaving the current one', SUBS.map(s => s.id));
}

section('A cancellation that fails reaches a human');
{
  /* This is the one failure that costs a real person real money, and it must
     not be swallowed by the try/catch that keeps it from breaking the grant. */
  SUBS = [{ id: 'sub_new', status: 'active' }, { id: 'sub_old', status: 'active' }];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if ((opts && opts.method) === 'DELETE') return new Response('{}', { status: 500 });
    return realFetch(url, opts);
  };
  const res = await W._cancelSupersededSubs(env, 'cus_A', 'sub_new', 'buyer@x.com');
  globalThis.fetch = realFetch;

  ok(res.failed === 1, 'the failure is counted rather than ignored', res);
  const alerted = [...store.keys()].some(k => k.startsWith('alerted:') && k.includes('supersede_cancel_fail'));
  ok(alerted, 'and an alert was raised', [...store.keys()].filter(k => k.startsWith('alerted:')));
}

section('With no Stripe key configured it does nothing at all');
{
  const res = await W._cancelSupersededSubs({ ...env, STRIPE_SECRET_KEY: '' }, 'cus_A', 'sub_new', 'buyer@x.com');
  ok(res.cancelled === 0 && res.failed === 0, 'no calls, no alarm', res);
}

if (report('one-subscription-per-account') > 0) process.exitCode = 1;
done();
