/* THE PROCESSOR THAT WAS NOT BILLING THEM REVOKED THEIR PLAN.

   Both providers deliver at-least-once, in no order, and retry a failed
   delivery for days. AMV already knew a late event must not undo a newer one,
   and compared timestamps to decide - per provider, deliberately, because two
   processors' clocks are not one timeline and the comment says so correctly.

   Which leaves the case the comparison never reaches. When the event comes from
   the OTHER processor the guard does not apply at all, so it wins by default.

   The sequence: somebody cancels PayPal, resubscribes on Stripe, and PayPal's
   cancellation webhook lands afterwards. They are paying, the payment is live,
   and AMV sets them to free. They did everything right and the product took
   their plan away. It runs the other way too - a retried PayPal "still active"
   reactivating an account that cancelled on Stripe, which is a paid plan given
   away for nothing.

   The fix cannot be to compare the two clocks; that is the thing the existing
   comment is right about. It is OWNERSHIP, which needs no shared clock: one
   subscription owns the plan, its events are authoritative, and an event from
   any other subscription may do exactly one thing - take ownership by granting
   a paid plan, the one message that can only follow real money moving.

   These cases are run through the real webhook handlers with signed events,
   because the finding is about which handler wins, and a unit test of the
   helper would not have caught the call site that forgot to say which
   subscription it was talking about. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'entowner.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, _entEventVerdict, ENT_MAX_RETIRED };\n');
const W = await import(harness + '?t=' + Date.now());

const USER = 'payer@example.com';

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'j', APP_URL: 'https://amv.test',
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
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'claim') {
          if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
          vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const plan = async (env) => (await W.DB.get(env, 'ent', USER)) || {};

/* The two shapes a processor event arrives in, as setEntitlement sees them. */
const stripe = (env, p, sub, at, extra) =>
  W.setEntitlement(env, USER, p, { source: 'stripe', sub, eventAt: at, ...(extra || {}) });
const paypal = (env, p, sub, at, extra) =>
  W.setEntitlement(env, USER, p, { source: 'paypal', sub, eventAt: at, ...(extra || {}) });

section('The first processor event to arrive takes the plan');
{
  const env = mkEnv();
  await paypal(env, 'pro', 'P-AAA', 1000);
  const e = await plan(env);
  ok(e.plan === 'pro', 'the plan is granted', e.plan);
  ok(e.subId === 'P-AAA', 'and the subscription that pays for it is recorded', e.subId);
  ok(e.lastEventSrc === 'paypal', 'with the processor billing it', e.lastEventSrc);
}

section('The owning subscription can do anything, including cancel');
{
  const env = mkEnv();
  await paypal(env, 'pro', 'P-AAA', 1000);
  await paypal(env, 'free', 'P-AAA', 2000, { canceled: true });
  const e = await plan(env);
  ok(e.plan === 'free', 'a cancellation from the paying subscription applies', e.plan);
}

section('A late cancel from the OLD processor cannot take the new plan away');
{
  /* The finding, in the order it actually happens. */
  const env = mkEnv();
  await paypal(env, 'pro', 'P-AAA', 1000);            // paying by PayPal
  await paypal(env, 'free', 'P-AAA', 2000, { canceled: true });   // they cancel
  await stripe(env, 'ultra', 'sub_BBB', 3000);        // and resubscribe on Stripe

  let e = await plan(env);
  ok(e.plan === 'ultra', 'the new subscription grants the plan', e.plan);
  ok(e.subId === 'sub_BBB', 'and owns it', e.subId);

  /* PayPal retries the cancellation it delivered days ago. */
  await paypal(env, 'free', 'P-AAA', 2000, { canceled: true });
  e = await plan(env);
  ok(e.plan === 'ultra',
     'a retried cancellation from the old processor does not revoke the plan they are paying for', e.plan);
  ok(e.subId === 'sub_BBB', 'and ownership is unchanged', e.subId);
}

section('Nor can a stale "still active" give a cancelled plan back');
{
  /* The same defect facing the other way, which costs AMV rather than the
     customer: a retried activation reinstating access nobody is paying for. */
  const env = mkEnv();
  await paypal(env, 'pro', 'P-AAA', 1000);
  await stripe(env, 'ultra', 'sub_BBB', 2000);        // moved to Stripe
  await stripe(env, 'free', 'sub_BBB', 3000, { canceled: true });   // then cancelled

  await paypal(env, 'pro', 'P-AAA', 1500);            // PayPal retries an old activation
  const e = await plan(env);
  ok(e.plan === 'free',
     'a retired subscription cannot put somebody back on a paid plan', e.plan);
  ok(Array.isArray(e.retiredSubs) && e.retiredSubs.includes('P-AAA'),
     'because it was retired when ownership moved', e.retiredSubs);
}

section('But a genuine switch of processor still works');
{
  /* The rule has to let real money through, or somebody who moves from one
     processor to the other is stuck on the plan they left. */
  const env = mkEnv();
  await stripe(env, 'pro', 'sub_AAA', 1000);
  await paypal(env, 'ultra', 'P-NEW', 2000);
  const e = await plan(env);
  ok(e.plan === 'ultra', 'paying on the other processor grants the new plan', e.plan);
  ok(e.subId === 'P-NEW', 'and moves ownership to it', e.subId);
  ok((e.retiredSubs || []).includes('sub_AAA'), 'retiring the one it replaced', e.retiredSubs);
}

section('And an upgrade on the same processor is not a takeover');
{
  /* A Checkout upgrade is a second Stripe subscription, not an edit. It must
     take ownership without anything being treated as suspicious. */
  const env = mkEnv();
  await stripe(env, 'pro', 'sub_AAA', 1000);
  await stripe(env, 'ultra', 'sub_BBB', 2000);
  const e = await plan(env);
  ok(e.plan === 'ultra', 'the upgrade applies', e.plan);
  ok(e.subId === 'sub_BBB', 'and the new subscription owns the plan', e.subId);

  /* And the one it replaced cannot cancel the new one when Stripe closes it. */
  await stripe(env, 'free', 'sub_AAA', 2500, { canceled: true });
  ok((await plan(env)).plan === 'ultra',
     'closing the superseded subscription does not revoke the upgrade', (await plan(env)).plan);
}

section('A chargeback still revokes, because it names no subscription');
{
  /* Disputes and refunds are charge events with no subscription id, so they
     make no ownership claim. They must still work - a chargeback is the one
     revocation that matters most - but only from the processor doing the
     billing. */
  const env = mkEnv();
  await stripe(env, 'ultra', 'sub_BBB', 1000);
  await stripe(env, 'free', '', 2000, { disputed: true });
  ok((await plan(env)).plan === 'free', 'a dispute from the owning processor revokes', (await plan(env)).plan);
}

section('A refund on the other processor does not');
{
  const env = mkEnv();
  await stripe(env, 'ultra', 'sub_BBB', 1000);
  await paypal(env, 'free', '', 2000, { refunded: true });
  ok((await plan(env)).plan === 'ultra',
     'a refund of an old charge elsewhere cannot revoke a live subscription', (await plan(env)).plan);
}

section('A person deciding now always applies');
{
  /* An admin edit, a referral bonus or a team seat change has no event behind
     it and no subscription. Ownership must not be able to block a human. */
  const env = mkEnv();
  await stripe(env, 'ultra', 'sub_BBB', 1000);
  await W.setEntitlement(env, USER, 'free', { source: 'admin' });
  ok((await plan(env)).plan === 'free', 'an operator can still set a plan', (await plan(env)).plan);

  const env2 = mkEnv();
  await paypal(env2, 'pro', 'P-AAA', 1000);
  await W.setEntitlement(env2, USER, 'ultra', { source: 'admin' });
  ok((await plan(env2)).plan === 'ultra', 'in either direction', (await plan(env2)).plan);
}

section('Same-provider staleness still works, since it always did');
{
  const env = mkEnv();
  await stripe(env, 'ultra', 'sub_BBB', 3000);
  await stripe(env, 'free', 'sub_BBB', 2000, { canceled: true });   // delivered late
  ok((await plan(env)).plan === 'ultra',
     'an older event from the owning subscription is still ignored', (await plan(env)).plan);
}

section('The retired list is bounded');
{
  /* It is a defence against a retry queue, not a history, and an unbounded
     list on a hot record is its own problem. */
  const env = mkEnv();
  for (let i = 0; i < W.ENT_MAX_RETIRED + 5; i++) {
    await stripe(env, 'pro', 'sub_' + i, 1000 + i);
  }
  const e = await plan(env);
  ok((e.retiredSubs || []).length <= W.ENT_MAX_RETIRED,
     'it never grows past its cap', (e.retiredSubs || []).length);
  ok((e.retiredSubs || []).includes('sub_' + (W.ENT_MAX_RETIRED + 3)),
     'and keeps the most recent, which are the ones still being retried', e.retiredSubs);
}

section('Every processor call site says which subscription it means');
{
  /* The helper cannot decide anything if the handler does not tell it. A call
     site that forgets makes its event look like a chargeback - no claim, defers
     to the owner - which is safe but wrong for a subscription event, so this is
     checked rather than assumed. */
  const code = codeOnly(src);
  const sw = codeOnly(functionBody(src, 'stripeWebhook'));
  const pp = codeOnly(functionBody(src, 'paypalWebhook'));
  ok(/const subId = /.test(sw), 'the Stripe handler resolves a subscription id', true);
  ok(/const ppSub = /.test(pp), 'and so does the PayPal one', true);

  /* Every setEntitlement in either handler that is about a SUBSCRIPTION carries
     it. Disputes and refunds legitimately do not, and are named.

     Extracted by balancing parentheses rather than by a regex: the first
     attempt stopped at the `)` of `email.toLowerCase()` and reported a
     complete call as a bare fragment. And a call that spreads `{ ...extra }`
     carries `sub` in the variable, not in the call text, so the spread is
     followed to where it was built - otherwise two correct call sites read as
     omissions and the real check would have been edited away to silence them. */
  const both = sw + '\n' + pp;
  const callAt = (text, i) => {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') { depth--; if (depth === 0) return text.slice(i, j + 1); }
    }
    return '';
  };
  const calls = [];
  for (let i = both.indexOf('setEntitlement('); i > -1; i = both.indexOf('setEntitlement(', i + 1)) {
    const c = callAt(both, i);
    if (c) calls.push(c);
  }
  ok(calls.length >= 5, 'the webhook entitlement writes were found', calls.length);
  ok(calls.every(c => c.endsWith(')')), 'and each was read whole, not to the first bracket', true);

  const carriesSub = (c) => {
    if (/\bsub:/.test(c)) return true;
    /* Follow a spread to the object it came from. */
    for (const m of c.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)) {
      const re = new RegExp('const ' + m[1] + ' = \\{[^}]*\\}');
      const def = re.exec(both);
      if (def && /\bsub:/.test(def[0])) return true;
    }
    return false;
  };
  const missing = calls.filter(c => !carriesSub(c) && !/disputed|refunded/.test(c));
  ok(missing.length === 0,
     'every subscription-shaped write names its subscription', missing);

  /* And the spread-following really resolves something, or the exemption above
     would be quietly excusing every call. */
  const viaSpread = calls.filter(c => !/\bsub:/.test(c) && carriesSub(c));
  ok(viaSpread.length >= 2, 'including the ones that carry it through a spread', viaSpread.length);
}

section('The ownership decision is made before the staleness one');
{
  /* Order matters: "is this processor even billing this customer" comes before
     "is this the newest thing it said". Reversed, a non-owning event with a
     newer timestamp would pass the clock check and be applied. */
  const fn = codeOnly(functionBody(src, 'setEntitlement'));
  const iOwn = fn.indexOf('_entEventVerdict(');
  const iStale = fn.indexOf('entitlement_stale_event');
  ok(iOwn > -1 && iStale > -1 && iOwn < iStale,
     'ownership is decided first', { ownership: iOwn, staleness: iStale });

  /* And the cross-processor comparison the audit suggested is still not there,
     because two clocks are not one timeline. */
  ok(/prev\.lastEventSrc === evtSrc/.test(fn),
     'staleness is still compared only within one provider', true);
}

if (report('one-subscription-owns-the-plan') > 0) process.exitCode = 1;
done();
