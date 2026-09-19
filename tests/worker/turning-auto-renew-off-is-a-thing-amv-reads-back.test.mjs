/* "AUTO RENEW" IS ONE FIELD AT STRIPE, AND AMV MUST NOT GUESS ITS VALUE.

   A subscription renews by itself. The only question worth a control is
   whether this one stops at the end of the period already paid for, and Stripe
   holds that as `cancel_at_period_end`. So the route writes that field and
   nothing else - and then writes onto the entitlement what STRIPE'S RESPONSE
   says the subscription now is, not what was asked of it. An action AMV cannot
   read back is an action AMV cannot claim, and a billing screen that reports
   the request rather than the result will happily tell somebody their plan has
   been cancelled when the call was rejected.

   The rest of this file is the ways a route that touches somebody's billing
   goes wrong: acting without saying which way, acting on a subscription that
   belongs to somebody else, acting on a deployment with no processor, and
   leaving a renewal date on an account that no longer has a subscription. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'autorenew.harness.mjs');
writeFileSync(harness, src + `
export { stripeAutoRenew, getEntitlement, setEntitlement, _renewalState, _renewalFromSub, DB };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  STRIPE_SECRET_KEY: 'sk_test_x',
  APP_URL: 'https://amv.test',
  STRIPE_PRICE_PRO: 'price_pro_m',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
    },
  },
};
const noStripe = Object.assign({}, env, { STRIPE_SECRET_KEY: '' });
W.__setRequireUser(async () => ({ email: 'sub@x.com', plan: 'pro' }));

const MONTH = 30 * 86400000;
const post = (body) => new Request('https://x/v1/stripe/auto-renew', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
  body: body === undefined ? '' : JSON.stringify(body),
});

/* Stand in for Stripe. `reply` decides what the subscription comes back as,
   which is the whole point: the route must believe THAT and not the request. */
let sent = [];
let reply = null;
const keepFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const url = String(u);
  if (/api\.stripe\.com\/v1\/subscriptions\//.test(url)) {
    sent.push({ url, body: String((o && o.body) || '') });
    if (reply && reply.status && reply.status !== 200)
      return new Response(JSON.stringify(reply.json || { error: { message: 'no' } }), { status: reply.status });
    return new Response(JSON.stringify(reply && reply.json ? reply.json : {}), { status: 200 });
  }
  return keepFetch(u, o);
};

const sub = (over) => Object.assign({
  id: 'sub_live', object: 'subscription', customer: 'cus_me',
  cancel_at_period_end: false,
  current_period_end: Math.floor((Date.now() + MONTH) / 1000),
  items: { data: [{ price: { id: 'price_pro_m', recurring: { interval: 'month' } } }] },
}, over || {});

async function seed(entOver) {
  store.clear();
  store.set('stripecust:sub@x.com', 'cus_me');
  await W.DB.put(env, 'ent', 'sub@x.com', Object.assign({
    plan: 'pro', subId: 'sub_live', updatedAt: Date.now(),
    autoRenew: true, renewsAt: Date.now() + MONTH, cycle: 'month',
  }, entOver || {}));
}
const ent = () => W.DB.get(env, 'ent', 'sub@x.com');

section('Turning it off writes the one field Stripe answers this with');
{
  await seed();
  sent = []; reply = { json: sub({ cancel_at_period_end: true }) };
  const r = await W.stripeAutoRenew(post({ on: false }), env);
  const d = await r.json();
  ok(r.status === 200, 'the change is accepted', r.status);
  ok(sent.length === 1 && /subscriptions\/sub_live$/.test(sent[0].url),
     'exactly one call, to the subscription on the record', sent);
  ok(/cancel_at_period_end=true/.test(sent[0].body),
     'setting cancel_at_period_end, which is what auto-renew IS', sent[0].body);
  /* Nothing else. A stray field here is a plan change or a price change on
     somebody's live subscription. */
  ok(sent[0].body.split('&').length === 1,
     'and nothing else about the subscription is touched', sent[0].body);
  ok(d.renewal && d.renewal.autoRenew === false, 'the answer says it is off', d.renewal);
  const e = await ent();
  ok(e.autoRenew === false, 'and the record says so too', e.autoRenew);
}

section('What is stored is what Stripe said, not what was asked');
{
  /* THE ONE THAT MATTERS. Stripe accepted the call and the subscription is
     still renewing - a schedule elsewhere, a different field winning, a
     partially applied change. Believing the request here tells somebody their
     billing has stopped when it has not, and the next charge arrives anyway. */
  await seed();
  sent = []; reply = { json: sub({ cancel_at_period_end: false }) };
  const r = await W.stripeAutoRenew(post({ on: false }), env);
  const d = await r.json();
  const e = await ent();
  ok(r.status === 200, 'Stripe accepted it', r.status);
  ok(d.renewal.autoRenew === true,
     'but the answer reports what the subscription IS, not what was asked', d.renewal);
  ok(e.autoRenew === true, 'and nothing was stored claiming otherwise', e.autoRenew);
}

section('The renewal date comes back with it, so no screen has to guess');
{
  await seed();
  const end = Math.floor((Date.now() + 300 * 86400000) / 1000);
  sent = []; reply = { json: sub({ cancel_at_period_end: true, current_period_end: end,
    items: { data: [{ price: { id: 'price_pro_y', recurring: { interval: 'year' } } }] } }) };
  const r = await W.stripeAutoRenew(post({ on: false }), env);
  const d = await r.json();
  ok(d.renewal.renewsAt === end * 1000,
     'the date is the subscription’s own period end', d.renewal);
  ok(d.renewal.cycle === 'year',
     'and the cycle is read off the price, so a yearly plan is not called monthly', d.renewal);
}

section('It refuses to guess which way somebody meant');
{
  await seed();
  sent = [];
  for (const body of [{}, { on: 'false' }, { on: 1 }, undefined]) {
    const r = await W.stripeAutoRenew(post(body), env);
    ok(r.status === 400, 'a body that does not say is refused: ' + JSON.stringify(body), r.status);
  }
  ok(sent.length === 0, 'and none of them reached Stripe', sent.length);
}

section('It will not act on a subscription that is not this account’s');
{
  /* `subId` is put on the record by this account's own webhook, so it is this
     account's by construction - and "by construction" is how an IDOR gets
     written. Stripe names the customer on its response; if that is not the
     customer stored for this email, the id is wrong and acting on it again
     would be acting on a stranger's billing. */
  await seed();
  sent = []; reply = { json: sub({ customer: 'cus_someone_else', cancel_at_period_end: true }) };
  const r = await W.stripeAutoRenew(post({ on: false }), env);
  ok(r.status === 403, 'refused', r.status);
  const e = await ent();
  ok(e.autoRenew !== false,
     'and nothing about the stranger’s subscription was written here', e.autoRenew);
}

section('With no subscription and no processor, it says so instead of failing');
{
  await seed({ subId: '' });
  sent = [];
  const r = await W.stripeAutoRenew(post({ on: false }), env);
  ok(r.status === 404, 'an account with no subscription gets a plain answer', r.status);
  ok(sent.length === 0, 'and nothing is sent', sent.length);

  await seed();
  sent = [];
  const r2 = await W.stripeAutoRenew(post({ on: false }), noStripe);
  const d2 = await r2.json();
  ok(r2.status === 503 && d2.code === 'needs_service',
     'a deployment with no Stripe key says it is not connected, not that it failed', d2);
  ok(sent.length === 0, 'and still nothing is sent', sent.length);
}

section('A Stripe refusal changes nothing here');
{
  await seed();
  sent = []; reply = { status: 402, json: { error: { message: 'card problem' } } };
  const r = await W.stripeAutoRenew(post({ on: false }), env);
  ok(r.status === 502, 'the refusal is reported', r.status);
  const e = await ent();
  ok(e.autoRenew === true,
     'and the record still says what it said before, because nothing changed', e.autoRenew);
}

section('A free account is never shown a renewal it does not have');
{
  /* The renewal fields are carried forward like every other fact on the
     entitlement, which is what keeps a referral bonus or a seat change from
     erasing them - and is exactly how a cancelled account would keep a date
     nobody is billed on. */
  await seed();
  await W.setEntitlement(env, 'sub@x.com', 'free',
    { source: 'stripe', canceled: true, eventAt: Date.now(), sub: 'sub_live' });
  const e = await ent();
  ok(e.plan === 'free', 'the plan is free', e.plan);
  ok(e.renewsAt === undefined && e.autoRenew === undefined,
     'and the renewal facts are gone with it', { renewsAt: e.renewsAt, autoRenew: e.autoRenew });
  ok(W._renewalState(e) === null, 'so there is nothing to report', W._renewalState(e));
}

section('A date that has already passed is not reported as a renewal');
{
  /* Stripe moves current_period_end forward on every renewal, so a stale one
     means the event that would have moved it has not arrived. "Renews three
     weeks ago" is worse than saying nothing. */
  ok(W._renewalState({ renewsAt: Date.now() - 86400000, subId: 's', autoRenew: true }) === null,
     'a past date is dropped', 'null expected');
  const live = W._renewalState({ renewsAt: Date.now() + MONTH, subId: 's', autoRenew: true });
  ok(live && live.manageable === true,
     'a live one is reported, and says there is a subscription to change', live);
  ok(W._renewalState({ renewsAt: Date.now() + MONTH, autoRenew: true }).manageable === false,
     'while one with no subscription id says the control cannot act', 'manageable false');
  ok(W._renewalState({}) === null, 'and an account with nothing stored reports nothing', 'null expected');
}

section('Renewal facts are only ever read off a subscription');
{
  /* An invoice and a checkout session carry neither cancel_at_period_end nor
     the subscription's period. Guessing from them is how a billing screen ends
     up stating a date nobody is billed on. */
  ok(W._renewalFromSub(null) === null, 'nothing in, nothing out', 'null');
  ok(W._renewalFromSub({ object: 'invoice', amount_paid: 1500 }) === null,
     'an invoice cannot answer this and is not asked to', 'null');
  const rn = W._renewalFromSub(sub({ cancel_at_period_end: true }));
  ok(rn.autoRenew === false && rn.cycle === 'month',
     'a subscription can, and does', rn);
}

globalThis.fetch = keepFetch;
if (report('turning-auto-renew-off-is-a-thing-amv-reads-back') > 0) process.exitCode = 1;
done();
