/* THE WEBHOOK IS THE ONLY THING STANDING BETWEEN PAYING AND GETTING IT.

   Revocation was deliberately made not to depend on a single delivery, because
   a plan that should have ended and did not costs AMV money. The mirror case
   costs a CUSTOMER money and nothing was watching it at all: a dropped webhook,
   a deploy inside the retry window, a signing secret rotated an hour early, and
   somebody has paid and has nothing.

   They do not file a bug about it. They charge it back, and they leave.

   So every payment that starts is remembered, every webhook that completes one
   forgets it, and anything still outstanding is asked about directly at the
   provider. Paid means finish it. Not paid means drop it. Somebody is told when
   a payment had to be rescued, because a webhook path that dropped one will
   drop the next.

   All three doors money comes through are covered here - a plan by card, a
   marketplace purchase, and a PayPal subscription - because covering one of
   them leaves the identical hole with a different name on it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'reconcile.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, reconcilePayments, _pendStart, PEND_KIND, PEND_GRACE_MS };\n');
const W = await import(harness + '?t=' + Date.now());

const BUYER = 'paid@example.com';
const SELLER = 'seller@example.com';

/* What each provider says when AMV asks about an outstanding payment. */
let stripeSession = null;
let paypalSub = null;
const alerts = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/checkout\/sessions\//.test(u))
    return stripeSession
      ? { ok: true, status: 200, json: async () => stripeSession }
      : { ok: false, status: 404, json: async () => ({}) };
  if (/billing\/subscriptions\//.test(u))
    return paypalSub
      ? { ok: true, status: 200, json: async () => paypalSub }
      : { ok: false, status: 404, json: async () => ({}) };
  if (/oauth2\/token/.test(u)) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
  if (/hooks\.|slack|discord/i.test(u)) { alerts.push(String((opts && opts.body) || '')); return { ok: true, status: 200, json: async () => ({}) }; }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv() {
  const m = new Map(); alerts.length = 0; stripeSession = null; paypalSub = null;
  return {
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    STRIPE_SECRET_KEY: 'sk_test', PAYPAL_CLIENT_ID: 'c', PAYPAL_SECRET: 's',
    STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_ELITE: 'price_elite', STRIPE_PRICE_ULTRA: 'price_ultra',
    PAYPAL_PLAN_PRO: 'P-PRO', ALERT_WEBHOOK: 'https://hooks.example/a',
  };
}
/* A payment started long enough ago that the webhook has had its chance. */
async function pendingSince(env, id, data, minsAgo) {
  await W.DB.put(env, W.PEND_KIND, id, Object.assign({ at: Date.now() - minsAgo * 60000 }, data));
}
const planOf = async (env, em) => ((await W.DB.get(env, 'ent', em)) || {}).plan || 'free';
const pendings = async (env) => (await W.DB.list(env, W.PEND_KIND, 100)).length;

/* Signed in, so the real checkout routes can be called. */
const PW = 'A-real-Passw0rd!';
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '90.90.90.90',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);

section('Starting a payment is what makes it findable later');
{
  /* Every other case here writes the pending record itself, so all of them
     would pass against a build that never records one - and then the sweep
     would have nothing to find, for ever, in production. That is the same
     shape as a sweep the cron never calls, one step earlier.

     So: the three real routes that take money, each asserted to leave
     something behind for the sweep. */
  const env = mkEnv();
  const tok = (await (await call(env, '/auth/signup', { email: BUYER, name: 'B', password: PW })).json()).token;
  ok(!!tok, 'signed in', !!tok);

  /* Stripe answers checkout-session creation for the plan and the purchase. */
  const keep = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (/checkout\/sessions$/.test(u)) return { ok: true, status: 200, json: async () => ({ id: 'cs_real', url: 'https://pay/x' }) };
    if (/billing\/subscriptions$/.test(u))
      return { ok: true, status: 200, json: async () => ({ id: 'I-REAL', links: [{ rel: 'approve', href: 'https://pp/x' }] }) };
    return keep(url, opts);
  };

  const planRes = await (await call(env, '/v1/stripe/checkout', { plan: 'pro' }, tok)).json();
  const afterPlan = await W.DB.list(env, W.PEND_KIND, 50);
  ok(!planRes.error, 'the checkout route ran (a bail here is a fixture problem, not a product one)', planRes.error || 'ok');
  ok(afterPlan.some(r => r.id === 'cs_real' && r.value.kind === 'plan'),
     'a plan checkout leaves a pending payment behind', afterPlan.map(r => r.id));

  await W.DB.put(env, 'market', 'itm9', { id: 'itm9', title: 'Thing', price: 15, authorEmail: SELLER });
  /* Money routes are gated on a server-side age record, which is the point of
     having one - so the fixture has to satisfy the real gate rather than route
     around it. */
  await W.DB.put(env, 'consent', BUYER, { birthYear: 1990, at: Date.now() });
  const buyRes = await (await call(env, '/v1/market/buy', { id: 'itm9' }, tok)).json();
  ok(!buyRes.error, 'and so did the purchase route', buyRes.error || 'ok');

  await call(env, '/v1/paypal/subscribe', { plan: 'pro' }, tok);
  const all = await W.DB.list(env, W.PEND_KIND, 50);
  globalThis.fetch = keep;

  ok(all.some(r => r.id === 'I-REAL' && r.value.provider === 'paypal'),
     'and so does a PayPal subscription', all.map(r => r.id));
  /* The marketplace one needs Stripe configured and the age gate passed; if it
     did not get that far it is reported rather than quietly skipped. */
  const mkt = all.find(r => r.value.kind === 'market');
  ok(!!mkt, 'and so does a marketplace purchase', all.map(r => r.id + ':' + (r.value.kind || r.value.provider)));
}

section('A card payment that completed but was never applied');
{
  const env = mkEnv();
  await pendingSince(env, 'cs_lost', { provider: 'stripe', kind: 'plan', email: BUYER, plan: 'elite' }, 30);
  stripeSession = { id: 'cs_lost', payment_status: 'paid', status: 'complete', amount_total: 4900 };

  ok((await planOf(env, BUYER)) === 'free', 'they have paid and have nothing', await planOf(env, BUYER));
  const r = await W.reconcilePayments(env);
  ok(r.rescued === 1, 'the sweep finds and finishes it', r);
  ok((await planOf(env, BUYER)) === 'elite', 'and they are on the plan they paid for', await planOf(env, BUYER));
  ok((await pendings(env)) === 0, 'with nothing left outstanding', await pendings(env));
}

section('And somebody is told, because the next one will drop too');
{
  /* A rescued payment is not a happy ending - it means the webhook path is
     broken. Fixing it quietly would hide the thing that needs fixing. */
  ok(alerts.some(a => /never applied|reconciliation sweep/i.test(a)),
     'the operator is alerted that a payment had to be rescued', alerts.length);
  ok(alerts.some(a => /webhook/i.test(a)), 'and pointed at the webhook', true);
}

section('A payment still within its grace period is left alone');
{
  /* Racing the webhook would double-apply, and asking the provider about every
     checkout the instant it starts is a bill of its own. */
  const env = mkEnv();
  await pendingSince(env, 'cs_new', { provider: 'stripe', kind: 'plan', email: BUYER, plan: 'pro' }, 1);
  stripeSession = { id: 'cs_new', payment_status: 'paid', status: 'complete' };
  const r = await W.reconcilePayments(env);
  ok(r.checked === 0, 'it is not chased yet', r);
  ok((await pendings(env)) === 1, 'and still remembered for later', await pendings(env));
}

section('A checkout they abandoned is dropped, not granted');
{
  const env = mkEnv();
  await pendingSince(env, 'cs_gone', { provider: 'stripe', kind: 'plan', email: BUYER, plan: 'ultra' }, 30);
  stripeSession = { id: 'cs_gone', payment_status: 'unpaid', status: 'expired' };
  const r = await W.reconcilePayments(env);
  ok((await planOf(env, BUYER)) === 'free', 'nothing is granted for a payment nobody made', await planOf(env, BUYER));
  ok(r.dropped === 1 && (await pendings(env)) === 0, 'and it stops being chased', r);
}

section('A provider AMV cannot reach right now is tried again later');
{
  /* An outage is not an answer. Dropping the record would lose a real payment;
     granting would invent one. */
  const env = mkEnv();
  await pendingSince(env, 'cs_down', { provider: 'stripe', kind: 'plan', email: BUYER, plan: 'pro' }, 30);
  stripeSession = null;                       // the lookup fails
  const r = await W.reconcilePayments(env);
  ok((await planOf(env, BUYER)) === 'free', 'nothing is granted on no information', await planOf(env, BUYER));
  ok((await pendings(env)) === 1, 'and the payment is still remembered', await pendings(env));
  ok(r.rescued === 0 && r.dropped === 0, 'no decision was taken either way', r);
}

section('A marketplace purchase that was paid for is delivered');
{
  /* The buyer gets the item and the seller gets their share - the same two
     things the webhook would have done, because it calls the same function. */
  const env = mkEnv();
  await W.DB.put(env, 'market', 'itm1', { id: 'itm1', title: 'A thing', price: 20, authorEmail: SELLER });
  await pendingSince(env, 'cs_mkt', { provider: 'stripe', kind: 'market', email: BUYER, itemId: 'itm1', seller: SELLER }, 30);
  stripeSession = { id: 'cs_mkt', payment_status: 'paid', status: 'complete', amount_total: 2000, payment_intent: 'pi_1' };

  const r = await W.reconcilePayments(env);
  ok(r.rescued === 1, 'the purchase is completed', r);
  const owned = await W.DB.get(env, 'purchases', BUYER);
  ok(!!owned && JSON.stringify(owned).includes('itm1'), 'the buyer now owns what they paid for', !!owned);
  const wallet = await W.DB.get(env, 'wallet', SELLER);
  ok(!!wallet && (wallet.balance || 0) > 0, 'and the seller has been credited', wallet && wallet.balance);
}

section('A PayPal subscription that went active is granted');
{
  const env = mkEnv();
  await pendingSince(env, 'I-SUB9', { provider: 'paypal', email: BUYER, plan: 'pro' }, 30);
  paypalSub = { id: 'I-SUB9', status: 'ACTIVE', plan_id: 'P-PRO' };
  const r = await W.reconcilePayments(env);
  ok(r.rescued === 1, 'the sweep finishes it', r);
  ok((await planOf(env, BUYER)) === 'pro', 'and they have their plan', await planOf(env, BUYER));
}

section('A PayPal subscription they never approved is dropped');
{
  const env = mkEnv();
  await pendingSince(env, 'I-SUB10', { provider: 'paypal', email: BUYER, plan: 'pro' }, 30);
  paypalSub = { id: 'I-SUB10', status: 'APPROVAL_PENDING', plan_id: 'P-PRO' };
  const r = await W.reconcilePayments(env);
  ok((await planOf(env, BUYER)) === 'free', 'nothing granted', await planOf(env, BUYER));
  ok((await pendings(env)) === 1, 'and still watched, because they may yet approve it', await pendings(env));

  paypalSub = { id: 'I-SUB10', status: 'CANCELLED', plan_id: 'P-PRO' };
  await W.reconcilePayments(env);
  ok((await pendings(env)) === 0, 'once cancelled it stops being watched', await pendings(env));
}

section('And the cron actually runs it');
{
  /* Every case above calls the sweep directly, so all of them would pass with
     it wired to nothing - which is the exact defect this file exists to
     prevent, one level up. This runs the real scheduled handler. */
  const env = mkEnv();
  await pendingSince(env, 'cs_cron', { provider: 'stripe', kind: 'plan', email: BUYER, plan: 'pro' }, 30);
  stripeSession = { id: 'cs_cron', payment_status: 'paid', status: 'complete' };

  const c = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
  await W.default.scheduled({ cron: '*/5 * * * *' }, env, c);
  await c.settle();

  ok((await planOf(env, BUYER)) === 'pro',
     'a payment left half done is finished by the scheduled run, not only by a direct call',
     await planOf(env, BUYER));
}

section('Nothing is applied twice');
{
  /* The sweep and the webhook can both reach a payment. Running it repeatedly
     must not credit a seller twice or re-grant anything. */
  const env = mkEnv();
  await W.DB.put(env, 'market', 'itm2', { id: 'itm2', title: 'Another', price: 30, authorEmail: SELLER });
  await pendingSince(env, 'cs_twice', { provider: 'stripe', kind: 'market', email: BUYER, itemId: 'itm2', seller: SELLER }, 30);
  stripeSession = { id: 'cs_twice', payment_status: 'paid', status: 'complete', amount_total: 3000, payment_intent: 'pi_2' };

  await W.reconcilePayments(env);
  const first = ((await W.DB.get(env, 'wallet', SELLER)) || {}).balance || 0;

  /* Put it back and run again - as a redelivered webhook would. */
  await pendingSince(env, 'cs_twice', { provider: 'stripe', kind: 'market', email: BUYER, itemId: 'itm2', seller: SELLER }, 30);
  await W.reconcilePayments(env);
  const second = ((await W.DB.get(env, 'wallet', SELLER)) || {}).balance || 0;
  ok(first > 0 && second === first,
     'a second pass credits the seller nothing further', { first, second });
}

section('A payment that completed normally leaves nothing to rescue');
{
  /* The exactly-once claim means a second application cannot double-credit
     anybody, so this is not about corruption. It is about the alert: if every
     ordinary payment also fires "a payment had to be rescued", the operator
     learns to ignore the one message that means their webhook is broken, and
     then the next real one goes unnoticed. An alert that cries wolf is worse
     than no alert. */
  const env = mkEnv();
  const tok = (await (await call(env, '/auth/signup', { email: BUYER, name: 'B', password: PW })).json()).token;
  await W.DB.put(env, 'consent', BUYER, { birthYear: 1990, at: Date.now() });

  const keep = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (/checkout\/sessions$/.test(u)) return { ok: true, status: 200, json: async () => ({ id: 'cs_ok', url: 'https://pay/x' }) };
    return keep(url, opts);
  };
  await call(env, '/v1/stripe/checkout', { plan: 'pro' }, tok);
  globalThis.fetch = keep;
  ok((await pendings(env)) === 1, 'the payment is outstanding while it is outstanding', await pendings(env));

  /* The webhook arrives and does its job - genuinely signed, because it fails
     closed on a bad signature and an unsigned fixture would test nothing but
     the 400. */
  const SECRET = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_ok', type: 'checkout.session.completed',
    data: { object: { id: 'cs_ok', client_reference_id: BUYER, metadata: { email: BUYER, plan: 'pro' } } } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const v1 = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  const wenv = Object.assign({}, env, { STRIPE_WEBHOOK_SECRET: SECRET });
  const res = await W.default.fetch(new Request('https://api.amv.test/v1/stripe/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
    body,
  }), wenv, ctx);
  await ctx.settle();
  ok(res.status === 200, 'the webhook was accepted', res.status);

  ok((await pendings(env)) === 0,
     'and stops being outstanding the moment the webhook finishes it', await pendings(env));

  alerts.length = 0;
  const r = await W.reconcilePayments(wenv);
  ok(r.rescued === 0, 'so the sweep has nothing to rescue', r);
  ok(alerts.length === 0,
     'and nobody is told their webhooks are broken when they are working', alerts.length);
}

section('And a payment nobody ever resolves stops being chased');
{
  /* Otherwise a provider that answers "unknown" for ever means an unbounded
     list and a request against it on every sweep. */
  const env = mkEnv();
  await pendingSince(env, 'cs_ancient', { provider: 'stripe', kind: 'plan', email: BUYER, plan: 'pro' }, 60 * 48);
  stripeSession = null;
  const r = await W.reconcilePayments(env);
  ok(r.dropped === 1 && (await pendings(env)) === 0,
     'a day-old unresolved payment is let go rather than chased for ever', r);
}

globalThis.fetch = realFetch;
if (report('a-payment-is-never-left-half-done') > 0) process.exitCode = 1;
done();
