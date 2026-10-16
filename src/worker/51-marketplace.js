/* AMV-063: bind a Stripe customer to an AMV account, BOTH ways.
   Every webhook after the first payment (renewal, cancellation, chargeback,
   refund) identifies the person only by customer id, so without the reverse
   map they cannot be resolved and NOTHING happens: the cancelled subscriber
   keeps their plan, the chargeback keeps their access, the refund keeps their
   access. The forward map is what lets them reach the billing portal and their
   invoices at all. Both writes must happen wherever a customer id is learned. */
/* One account holds one plan, so one customer holds one subscription.

   An upgrade is a NEW subscription at Stripe, not an edit of the old one. With
   nothing cancelling the old one, the customer paid for both - $15 and $75 at
   the same time - and only the newest was reachable from the billing portal, so
   there was no way to stop the other from inside AMV. The person's remedy was a
   chargeback, which then flags THEIR account for abuse.

   Cancelled rather than left to expire: they are already paying for the plan
   that replaced it. Only subscriptions on the same customer, only ones still
   capable of charging, and never the one that was just created. Every
   cancellation is audited, and a failure raises an alert, because a card still
   being charged is the failure here that costs a real person real money. */
const _SUB_STILL_BILLS = ['active', 'trialing', 'past_due', 'unpaid'];
async function _cancelSupersededSubs(env, customerId, keepSubId, email) {
  if (!customerId || !env.STRIPE_SECRET_KEY) return { cancelled: 0, failed: 0 };
  const sk = { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
               'Content-Type': 'application/x-www-form-urlencoded' };
  let cancelled = 0, failed = 0;
  try {
    const ls = await fetchDeadline('https://api.stripe.com/v1/subscriptions?status=all&limit=100&customer=' +
      encodeURIComponent(customerId), { headers: sk });
    const ld = await ls.json().catch(() => ({}));
    for (const sub of ((ld && ld.data) || [])) {
      if (!sub || !sub.id || sub.id === keepSubId) continue;
      if (_SUB_STILL_BILLS.indexOf(String(sub.status || '')) < 0) continue;
      try {
        const dr = await fetchDeadline('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(sub.id),
          { method: 'DELETE', headers: sk });
        if (dr.ok) { cancelled++; audit(env, 'stripe_superseded_cancelled', { email, sub: sub.id, kept: keepSubId || '' }); }
        else failed++;
      } catch { failed++; }
    }
  } catch { failed++; }
  if (failed) {
    /* Audited as well as alerted: alertOnce is a no-op when no ALERT_WEBHOOK is
       configured, and a card still being charged has to leave a trace either
       way. */
    audit(env, 'stripe_supersede_cancel_failed', { email, customer: customerId, failed });
    try {
      await alertOnce(env, 'supersede_cancel_fail_' + email,
        'A superseded subscription could not be cancelled for ' + email +
        '. Cancel it in Stripe now - this customer is being charged for two plans.', 1);
    } catch {}
  }
  return { cancelled, failed };
}

async function _linkCustomer(env, email, customerId) {
  const em = String(email || '').toLowerCase();
  if (!em || !customerId) return;
  try {
    await env.AMV_KV.put(`stripecust:${em}`, customerId);
    await env.AMV_KV.put(`custemail:${customerId}`, em);
  } catch (e) { /* KV write failure is logged by the caller's audit trail */ }
}

// resolve email from a Stripe customer id (we store the reverse map at checkout)
async function _emailFromCustomer(env, customerId) {
  if (!customerId) return '';
  // we stored stripecust:<email> = customerId; do a tiny reverse lookup via a cust->email key
  const e = await env.AMV_KV.get(`custemail:${customerId}`);
  if (e) return e.toLowerCase();
  /* Fall back to asking Stripe. Customers created before the reverse map was
     written - or if a KV write was lost - would otherwise be unresolvable
     forever, which means their cancellations and chargebacks silently do
     nothing. We set metadata.amv_user at creation, so Stripe itself can tell
     us who this is. Back-fill KV so it is a one-time cost. */
  if (!env.STRIPE_SECRET_KEY) return '';
  try {
    const r = await fetchDeadline('https://api.stripe.com/v1/customers/' + encodeURIComponent(customerId), {
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    if (!r.ok) return '';
    const c = await r.json();
    const em = String((c.metadata && c.metadata.amv_user) || c.email || '').toLowerCase();
    if (em) { await _linkCustomer(env, em, customerId); audit(env, 'customer_relinked', { email: em }); }
    return em;
  } catch (e) { return ''; }
}

/* =====================================================================
   MARKETPLACE (auditor #12) - community template store.
   Templates are stored as market:<id>; install counts rank them. Publishing
   requires auth (so submissions are attributable + moderatable). This is the
   technical substrate for the network effect - it lights up as real users
   publish and install.
   ===================================================================== */
/* THE CATALOGUE, WHICH ANYBODY CAN ASK FOR.

   This walked every `market:` key and did a full read of each one, on a PUBLIC
   unauthenticated route, with no cache. One HTTP request from anybody at all
   turned into one storage read per listing in the product. That is a bill and
   a way to generate load, and it grew with every listing anybody published.

   The bound it had was worse than none: `while (cursor && out.length < 500)`
   counts VISIBLE results, so a catalogue of a hundred thousand hidden or
   removed listings and ten active ones read all hundred thousand. And it
   sorted by installs AFTER stopping, so "most popular" was the most popular of
   whichever listings happened to come first in KEY order - the same defect
   already found and fixed in the payouts screen, still here on the page every
   visitor sees.

   So: one snapshot, built at most once a minute and shared by everybody who
   asks. The bound is on KEYS READ rather than on results kept, which is the
   only version of it that bounds the work. Publishing or removing a listing
   clears it, because a seller not seeing their own new listing is the thing
   people actually notice; anything else is a minute stale, which a catalogue
   can be. */
const MARKET_CACHE_KEY = 'mktcache:v1';
const MARKET_CACHE_TTL_S = 60;
const MARKET_LIST_MAX = 500;      // items returned
/* A rebuild in flight in this isolate, so eight simultaneous visitors do not
   start eight full reads of the store. Module scope on purpose: an isolate is
   exactly the scope that serves concurrent requests. */
let _mktBuilding = null;

async function _marketCacheBust(env) {
  try { await env.AMV_KV.delete(MARKET_CACHE_KEY); } catch (e) { /* stale for a minute is survivable */ }
  /* And release the rebuild claim, or a publish clears the snapshot and the
     next request finds no copy AND no permission to build one. */
  try { await _releaseClaim(env, 'mktbuild', 'snapshot'); } catch (e) {}
  /* AND the in-flight build, which is the subtle one. A build that started
     BEFORE this publish will not contain the new listing, and a request
     arriving now would join it and be handed a catalogue that is already
     wrong - the seller looks straight at the marketplace and does not find
     what they just published. Dropping the handle means the next request
     starts a fresh build; the old one still finishes and writes, and is
     immediately superseded. */
  _mktBuilding = null;
}

async function _marketSnapshot(env) {
  const items = [];
  let cursor, scanned = 0, truncated = false;
  do {
    const page = await env.AMV_KV.list({ prefix: 'market:', cursor, limit: 1000 });
    for (const k of (page.keys || [])) {
      scanned++;
