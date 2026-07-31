/* SUBSCRIPTION LIFECYCLE - everything that happens AFTER the first payment.
   Getting paid once was covered. Cancellations, failed renewals, chargebacks
   and refunds identify the customer only by Stripe customer id, so all of it
   depends on being able to turn that id back into an AMV account. It could
   not, for anyone who subscribed with a card in the app, because the reverse
   map was only ever written on the hosted-checkout path. The consequence was
   not subtle: cancel and keep the plan, charge back and keep the plan, and no
   way to reach the billing portal to cancel in the first place. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'sublife.harness.mjs');
writeFileSync(harness, src +
  '\nexport { _linkCustomer, _emailFromCustomer, _planOf, _billingState, _markPastDue, _clearPastDue,' +
  ' setEntitlement, requireUser, stripeWebhook, paypalWebhook, PAST_DUE_GRACE_MS, PAST_DUE_RECOVER_MS, DB, signToken };\n');
const W = await import(harness + '?t=' + Date.now());

/* ---- a KV + env good enough for these paths ---- */
function makeEnv(extra) {
  const kv = new Map();
  return Object.assign({
    _kv: kv,
    JWT_SECRET: 'test-secret-abcdefghijklmnop',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRICE_PRO: 'price_pro',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }),
    },
  }, extra || {});
}
const ent = (env, email) => W.DB.get(env, 'ent', email);

/* Sign a webhook the way Stripe does, so these go through the real signature
   check rather than around it. */
const WHSEC = 'whsec_test_secret';
async function stripeEvent(env, event) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WHSEC),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + body));
  const v1 = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return W.stripeWebhook(new Request('https://w/v1/stripe/webhook', {
    method: 'POST', headers: { 'Stripe-Signature': 't=' + t + ',v1=' + v1 }, body }), env, {});
}

section('The reverse map is written both ways, so a webhook can find the person');
{
  const env = makeEnv();
  await W._linkCustomer(env, 'Alice@X.com', 'cus_1');
  const fwd = await env.AMV_KV.get('stripecust:alice@x.com');
  const rev = await W._emailFromCustomer(env, 'cus_1');
  ok(fwd === 'cus_1', 'email -> customer, which is what the billing portal and invoices need', fwd);
  ok(rev === 'alice@x.com', 'customer -> email, which is what every later webhook needs', rev);
}

section('A customer created before the fix is still resolvable');
{
  const env = makeEnv();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ id: 'cus_old', email: 'bob@x.com', metadata: { amv_user: 'bob@x.com' } }) };
  };
  const email = await W._emailFromCustomer(env, 'cus_old');
  const backfilled = await env.AMV_KV.get('custemail:cus_old');
  ok(email === 'bob@x.com', 'it asks Stripe rather than giving up silently', email);
  ok(/customers\/cus_old/.test(calls[0] || ''), 'by looking the customer up', calls[0]);
  ok(backfilled === 'bob@x.com', 'and back-fills the map so it is a one-time cost');
}

section('The in-app card path links the customer (this was the leak)');
{
  // The subscribe route must record the customer id; without it every event
  // below is a no-op for that user.
  const linked = /await _linkCustomer\(env, user\.email, customer\)/.test(src);
  ok(linked, 'the subscribe route calls _linkCustomer');
  const before = src.indexOf('await _linkCustomer(env, user.email, customer)');
  const grant = src.indexOf("await setEntitlement(env, user.email, plan)");
  ok(before > 0 && before < grant, 'and it does so before the plan is granted, not after');
}

section('A cancellation actually downgrades');
{
  const env = makeEnv();
  await W._linkCustomer(env, 'alice@x.com', 'cus_2');
  await W.setEntitlement(env, 'alice@x.com', 'ultra', { source: 'stripe' });
  await stripeEvent(env, { id: 'evt_c1', type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_2' } } });
  const e = await ent(env, 'alice@x.com');
  ok(e.plan === 'free', 'the plan drops to free when the subscription ends', e.plan);
  ok(e.canceled === true, 'and it is recorded as a cancellation');
}

section('A chargeback revokes access and flags the account');
{
  const env = makeEnv();
  await W._linkCustomer(env, 'alice@x.com', 'cus_3');
  await W.setEntitlement(env, 'alice@x.com', 'ultra', { source: 'stripe' });
  await stripeEvent(env, { id: 'evt_d1', type: 'charge.dispute.created',
      data: { object: { customer: 'cus_3', charge: 'ch_1', amount: 20000 } } });
  const e = await ent(env, 'alice@x.com');
  const abuse = await W.DB.get(env, 'abuse', 'alice@x.com');
  ok(e.plan === 'free', 'they do not keep the plan they reversed the payment for', e.plan);
  ok(!!abuse, 'and the dispute is on the account, so they cannot just re-subscribe and repeat it');
}

section('A FAILED renewal does not buy another month');
{
  const env = makeEnv();
  await W._linkCustomer(env, 'alice@x.com', 'cus_4');
  await W.setEntitlement(env, 'alice@x.com', 'ultra', { source: 'stripe' });
  await stripeEvent(env, { id: 'evt_f1', type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_4', id: 'in_1', attempt_count: 1 } } });
  const e = await ent(env, 'alice@x.com');
  ok(typeof e.pastDueSince === 'number', 'the failure is recorded against the account', e.pastDueSince);
  ok(e.plan === 'ultra', 'the plan they paid for is not deleted - a card can be fixed', e.plan);
  ok(W._planOf(e) === 'ultra', 'and it still works during the stated grace period', W._planOf(e));

  // ... but not forever. This is the part that was free money before.
  const lapsed = Object.assign({}, e, { pastDueSince: Date.now() - W.PAST_DUE_GRACE_MS - 1000 });
  ok(W._planOf(lapsed) === 'free', 'once the grace period is over the plan is free again', W._planOf(lapsed));

  /* Three states, because they ask for three different things (AMV-085). While
     the plan still works, say by when. Once it has stopped but the card is
     still being retried, say it comes straight back - that is the window where
     cards actually get fixed, and "your plan has dropped" reads as final and
     stops people fixing it. Only once the processor has given up is it over. */
  const dead = Object.assign({}, e, { pastDueSince: Date.now() - W.PAST_DUE_RECOVER_MS - 1000 });
  const state = W._billingState(e), paused = W._billingState(lapsed), gone = W._billingState(dead);
  ok(state.state === 'past_due' && /card/i.test(state.message), 'the user is told to update their card', state.message);
  ok(paused.state === 'paused' && /comes back immediately/.test(paused.message),
     'past the grace window it is paused, not written off', paused.message);
  ok(W._planOf(lapsed) === 'free', 'and paused really does mean Free limits, not a warning with no teeth');
  ok(gone.state === 'lapsed' && /Free/.test(gone.message), 'and told plainly once it is genuinely over', gone.message);
  ok(/data is untouched/i.test(gone.message), 'with the one reassurance that matters at that point', gone.message);
}

section('A later successful payment restores it exactly');
{
  const env = makeEnv();
  await W._linkCustomer(env, 'alice@x.com', 'cus_5');
  await W.setEntitlement(env, 'alice@x.com', 'ultra', { source: 'stripe' });
  await W._markPastDue(env, 'alice@x.com', {});
  const due = await ent(env, 'alice@x.com');
  await stripeEvent(env, { id: 'evt_p1', type: 'invoice.paid',
      data: { object: { customer: 'cus_5', id: 'in_2', amount_paid: 20000, currency: 'usd' } } });
  const after = await ent(env, 'alice@x.com');
  ok(due.pastDueSince > 0, 'the account really was past due');
  ok(after.pastDueSince === undefined, 'a payment landing clears it');
  ok(W._planOf(after) === 'ultra', 'and the plan they bought is theirs again', W._planOf(after));
}

section('Only the FIRST failure starts the clock');
{
  const env = makeEnv();
  await W.setEntitlement(env, 'alice@x.com', 'pro', { source: 'stripe' });
  await W._markPastDue(env, 'alice@x.com', {});
  const first = (await ent(env, 'alice@x.com')).pastDueSince;
  await new Promise(r => setTimeout(r, 15));
  await W._markPastDue(env, 'alice@x.com', {});
  const second = (await ent(env, 'alice@x.com')).pastDueSince;
  ok(first === second,
     'Stripe retries the same invoice several times - each retry must not extend the free window', { first, second });
}

section('Stripe’s own status decides, not just the price');
{
  const env = makeEnv();
  await W._linkCustomer(env, 'alice@x.com', 'cus_6');
  await W.setEntitlement(env, 'alice@x.com', 'pro', { source: 'stripe' });
  const send = status => stripeEvent(env, { id: 'evt_s' + status, type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_6', status, id: 'sub_1',
        items: { data: [{ price: { id: 'price_pro' } }] } } } });

  await send('unpaid');
  const unpaid = await ent(env, 'alice@x.com');
  ok(unpaid.plan === 'free', 'an unpaid subscription is not re-granted just because its price is Pro', unpaid.plan);

  await W.setEntitlement(env, 'alice@x.com', 'pro', { source: 'stripe' });
  await send('past_due');
  const pd = await ent(env, 'alice@x.com');
  ok(pd.plan === 'pro' && pd.pastDueSince > 0, 'past_due keeps the plan but starts the clock', pd);

  await send('active');
  const back = await ent(env, 'alice@x.com');
  ok(back.plan === 'pro' && back.pastDueSince === undefined, 'active restores it cleanly', back);
}

section('Every read of the plan honours the lapse - not just some of them');
{
  // The risk is one caller using ent.plan directly and handing out compute a
  // lapsed account has not paid for.
  const raw = src.split('\n')
    .filter(l => /\.plan \|\| 'free'/.test(l))
    .filter(l => !/sold:/.test(l))            // the one deliberate report of what was SOLD
    .filter(l => !/_planOf\(/.test(l));        // lines that already check
  ok(raw.length === 0, 'no code path falls back to the sold plan without checking the lapse',
     raw.map(l => l.trim().slice(0, 70)));
  ok(/data\.plan = _planOf\(e\)/.test(src), 'requireUser - so every authenticated request is covered');
  ok(/const plan = _planOf\(ent\)/.test(src), 'the cron that runs automations, which spends real money');
  ok(/plan: _planOf\(e\)/.test(src), 'and the SMS path, which also costs per message');
  ok(/const plan = _planOf\(e\);/.test(src),
     'and the founder dashboard, so MRR is not inflated by subscriptions that stopped paying');
  ok(/mrrAtRisk/.test(src), 'which instead reports past-due accounts and the revenue at risk');
}

section('PayPal is held to the same rule');
{
  const env = makeEnv({ PAYPAL_WEBHOOK_ID: 'wh_1' });
  globalThis.fetch = async (url) => {
    if (String(url).includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
    return { ok: true, json: async () => ({ verification_status: 'SUCCESS' }) };
  };
  await W.setEntitlement(env, 'alice@x.com', 'elite', { source: 'paypal' });
  await W.paypalWebhook(new Request('https://w/x', { method: 'POST',
    body: JSON.stringify({ event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      resource: { custom_id: 'alice@x.com|elite' } }) }), env, {});
  const e = await ent(env, 'alice@x.com');
  ok(e.pastDueSince > 0, 'a failed PayPal payment starts the same clock', e.pastDueSince);

  await W.paypalWebhook(new Request('https://w/x', { method: 'POST',
    body: JSON.stringify({ event_type: 'BILLING.SUBSCRIPTION.EXPIRED',
      resource: { custom_id: 'alice@x.com|elite' } }) }), env, {});
  ok((await ent(env, 'alice@x.com')).plan === 'free', 'and an expired PayPal subscription downgrades');
}

report();
done();
