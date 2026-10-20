/* ══ EXTRA USAGE: PREPAID CREDIT FOR WHEN A PLAN RUNS OUT ════════════════════

   A paying customer who reaches their plan's limit used to have two choices:
   wait, or upgrade a whole tier. Most did neither - they left for the evening,
   and some left for good. Extra usage is the third: a prepaid pack, bought
   once, spent only after the plan's own allowance is used up.

   WHY IT CANNOT LOSE MONEY.
     - It is prepaid. Nothing runs on credit that has not already arrived.
     - It is spent at CREDIT_MARKUP times what the engines cost - the same
       share of revenue the plans themselves are allowed to spend (their
       ceiling is 45% of the price) - so an overflow message earns what an
       ordinary one does.
     - Each message books its cost against the credit BEFORE the model runs,
       atomically, exactly as the plan ceiling is booked, and settles the real
       cost after. A burst of parallel requests cannot spend past the balance.
     - The day's global spending cap still applies to every overflow message.
     - The message ceiling that exists to stop scripts is never bypassed.
     - Paid plans only, and never a family member's account: a child's limit is
       the parent's decision, not something a card can raise.
     - A refund or a chargeback takes the credit back and never touches the
       subscription; a chargeback is recorded as one.

   Money in is read from Stripe's own total, never from what AMV wrote into the
   session - so a session altered on the way can only ever credit what was
   actually paid. */
const CREDIT_PACKS_USD = [10, 25, 50];
const CREDIT_MARKUP = 2.2;
const CREDIT_MAX_USD = 500;
const CREDIT_TTL_MS = 400 * 86400000;
const _creditBuyName = (subject) => `creditbuy:${subject}`;
const _creditSpentName = (subject) => `creditspent:${subject}`;
async function _creditState(env, subject){
  const bought = +((await counter(env, _creditBuyName(subject), { op: 'get' })).value || 0);
  const spent = +((await counter(env, _creditSpentName(subject), { op: 'get' })).value || 0);
  /* `left` is exact - it is what decides whether a message may book against
     the credit, and a fraction of a cent paid for is still paid for. `balance`
     is the same rounded to cents, for saying. */
  return { bought, spent, left: Math.max(0, bought - spent), balance: Math.max(0, Math.round((bought - spent) * 100) / 100) };
}
function _creditEligible(user){
  return !!(user && _planPriceUSD(user.plan, user.customCfg) > 0 && !user.family);
}
/* Credit a paid pack exactly once, however many times it is reported (the
   webhook, its retries, and the reconciliation sweep can all arrive).

   The claim is GIVEN BACK if crediting fails. Taking it and then failing at
   the counter used to leave the payment marked as handled with nothing
   credited: Stripe's retry and the reconciliation sweep both found the claim
   taken and stopped, and somebody who had paid for a pack never got it.
   Marketplace sales already went through _onceOrRetry for exactly this; packs
   now do too. Only the record of the payment and the credit itself are inside
   it - both are safe to run again up to the credit, and the credit is last,
   so a retry can never add it twice.

   `strict`: a failing counter used to fall back to KV, where the credit was
   written to a key the balance is never read from - lost without an error,
   so nothing would ever have retried it. Money is counted where it is read,
   or the attempt fails and says so. */
async function _creditGrant(env, { subject, email, usd, ref }){
  if(!subject || !(usd > 0) || !ref) return false;
  const once = await _onceOrRetry(env, 'creditref', ref, CLAIM_ONCE_TTL_S, async () => {
    await env.AMV_KV.put('creditpay:' + ref, JSON.stringify({ subject, email, usd, at: Date.now() }));
    await counter(env, _creditBuyName(subject), { op: 'incr', amount: usd, ttlMs: CREDIT_TTL_MS, strict: true });
  });
  if(!once.claimed) return false;
  await _recordTxn(env, { provider: 'stripe', email, amount: usd, currency: 'USD', kind: 'credit', status: 'succeeded', ref });
  audit(env, 'credit_bought', { by: email, usd });
  return true;
}
/* A refund or dispute on a pack. True when the payment WAS a pack, so the
   caller does not go on to treat it as the subscription. */
/* ONE AT A TIME PER PACK. This reads how much was already taken back, takes
   the rest and writes the new total - and Stripe sends a refund and a dispute
   as separate events, delivered concurrently. Two arriving together each read
   "nothing taken yet" and each took the whole pack, out of credit the person
   had paid for separately (a-refund-takes-a-pack-back-once). The second waits
   by failing: the webhook answers 500, Stripe retries, and the retry finds
   nothing left to take. A partial refund then a full one still take the
   difference, so this cannot be a once-only claim. */
async function _creditReverse(env, ref, why, refundedUSD){
  if(!ref) return false;
  if(!(await env.AMV_KV.get('creditpay:' + ref))) return false;
  if(!(await _claimOnce(env, 'crevlock', ref, 30))) throw new Error('credit reversal already in progress for this payment');
  let rec, take = 0;
  try{
    rec = _safeJson(await env.AMV_KV.get('creditpay:' + ref));
    if(!rec || !rec.subject) return false;
    const already = +rec.reversed || 0;
    const want = Math.min(+rec.usd || 0, refundedUSD > 0 ? refundedUSD : +rec.usd || 0);
    take = Math.max(0, Math.round((want - already) * 100) / 100);
    if(take > 0){
      await counter(env, _creditBuyName(rec.subject), { op: 'incr', amount: -take, ttlMs: CREDIT_TTL_MS, strict: true });
      rec.reversed = already + take;
      await env.AMV_KV.put('creditpay:' + ref, JSON.stringify(rec));
    }
  } finally { await _releaseClaim(env, 'crevlock', ref); }
  audit(env, 'credit_reversed', { by: rec.email, usd: take, why });
  if(why === 'dispute' && rec.email) await _abuseRecord(env, rec.email, 'dispute', { chargeId: ref, amount: Math.round((+rec.usd || 0) * 100) });
  return true;
}

/* GET /v1/credit - the balance, and whether packs can be bought here. */
async function creditInfo(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error: 'unauthorized' }, 401);
  const subject = user.billingSubject || user.email;
  const st = await _creditState(env, subject);
  return json({ ok: true, balance: st.balance, eligible: _creditEligible(user),
                available: !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET), packs: CREDIT_PACKS_USD,
                max: CREDIT_MAX_USD });
}

/* POST /v1/credit/checkout {usd} - a Stripe checkout for one pack. */
async function creditCheckout(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error: 'unauthorized' }, 401);
  if(!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET))
    return json({ error: 'Card payments are not switched on for this deployment yet.', code: 'needs_service' }, 503);
  if(!_creditEligible(user))
    return json({ error: user.family ? 'Extra usage is not available on a family member’s account - whoever manages the family sets its limits.'
                                     : 'Extra usage comes with a paid plan. Upgrade first, then add more whenever you run out.',
                  code: 'plan_required' }, 402);
  const blocked = await guardAction(env, 'creditbuy:' + user.email, 5, 20, 'extra usage purchases');
  if(blocked) return blocked;
  const hold = await _accountHold(env, user, 'credit');
  if(hold) return hold;
  const body = await request.json().catch(() => ({}));
  const usd = +body.usd;
  if(CREDIT_PACKS_USD.indexOf(usd) < 0) return json({ error: 'Choose one of the packs offered.', code: 'bad_pack' }, 400);
  const subject = user.billingSubject || user.email;
  const st = await _creditState(env, subject);
  if(st.balance + usd > CREDIT_MAX_USD)
    return json({ error: 'That would take the balance over $' + CREDIT_MAX_USD + '. Use some first.', code: 'credit_max' }, 400);
  const origin = String(env.APP_URL || '').replace(/\/$/, '');
  if(!origin) return json({ error: 'APP_URL is not set, so there is nowhere to come back to after paying.', code: 'needs_service' }, 503);
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][product_data][name]', 'AMV extra usage - $' + usd);
  form.set('line_items[0][price_data][unit_amount]', String(usd * 100));
  form.set('success_url', origin + '/?credit=1');
  form.set('cancel_url', origin + '/');
  form.set('customer_email', user.email);
  form.set('metadata[kind]', 'usage_credit');
  form.set('metadata[subject]', subject);
  form.set('metadata[email]', user.email);
  form.set('payment_intent_data[metadata][kind]', 'usage_credit');
  const r = await fetchDeadline('https://api.stripe.com/v1/checkout/sessions', { method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString() });
  const d = await r.json().catch(() => ({}));
  if(!r.ok || !d.url) return json({ error: (d.error && d.error.message) || 'The payment page could not be opened.', code: 'stripe_error' }, 502);
  await _pendStart(env, d.id, { provider: 'stripe', kind: 'credit', email: user.email, subject });
  audit(env, 'credit_checkout', { by: user.email, usd });
  return json({ ok: true, url: d.url });
}

async function stripeWebhook(request, env, ctx) {
  const sig = request.headers.get('Stripe-Signature') || '';
  const raw = await request.text();
  const ok = await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, raw, sig);
  if (!ok) { audit(env, 'forged_webhook', { kind: 'stripe' }); return new Response('bad signature', { status: 400 }); }

  let evt; try { evt = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  const type = evt.type;
  const obj = evt.data?.object || {};

  // Exactly-once: ignore a re-delivered/duplicate event so it can't double-credit
  // a sale, double-record a renewal payment, or re-run any side effect. If later
  // processing throws we RELEASE the claim (below) so the provider's retry is
  // allowed to reprocess a genuinely-failed event.
  if (evt.id && !(await _claimOnce(env, 'stripeevt', evt.id, CLAIM_ONCE_TTL_S))) {
    return json({ received: true, duplicate: true });
  }
  /* AMV-200: WHEN this happened, not when it arrived. Stripe gives no ordering
     guarantee and retries a failed delivery for days, so the order events land
     in is not the order they occurred in. `created` is seconds; everything else
     here works in milliseconds. Falling back to now is deliberate: an event
     with no time is treated as the newest thing we know, which applies it
     rather than discarding it. */
  const evtAt = (+evt.created ? +evt.created * 1000 : Date.now());

  try {
    if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
      /* A COMPLETED SESSION IS NOT A PAID ONE.

         `automatic_payment_methods` is on, deliberately, so that the rest of
         the world can pay the way it pays - and two of the methods it turns on
         do not move money when the session completes. OXXO is a voucher the
         customer takes to a shop counter in Mexico and has three days to pay in
         cash. SEPA Direct Debit can take up to fourteen days and can come back
         failed. For both, Stripe fires checkout.session.completed IMMEDIATELY
         with payment_status: 'unpaid', and then, later, either
         async_payment_succeeded or async_payment_failed.

         This branch granted the plan on 'completed' and never looked at
         payment_status. So the way to get AMV free, from any country where
         those methods are enabled, was to choose one at checkout and then
         simply not pay: the plan was granted in full, immediately, on a voucher
         nobody ever redeemed. The marketplace branch was worse - it credited
         the SELLER eighty percent of money that had not arrived, so AMV owed a
         real payout on an imaginary sale.

         Fulfilment now waits for the money. An unpaid session is acknowledged
         (200, so Stripe stops retrying a delivery that was fine) and left in
         the pending ledger, which is what the reconciliation sweep watches -
         so a lost async event still gets picked up. async_payment_succeeded
         arrives here and takes the same path, because a payment that took nine
         days is still a payment and must fulfil exactly once. */
      if (!_stripeSessionPaid(obj)) {
        audit(env, 'payment_awaiting', {
          id: obj.id, status: obj.payment_status || '',
          email: (obj.metadata?.email || obj.client_reference_id || obj.customer_email || '').toLowerCase(),
        });
        return new Response('ok', { status: 200 });
      }

      /* Extra usage: credited from what Stripe says was paid, once. */
      if (obj.metadata?.kind === 'usage_credit') {
        await _creditGrant(env, { subject: String(obj.metadata.subject || '').toLowerCase(),
          email: String(obj.metadata.email || obj.customer_email || '').toLowerCase(),
          usd: Math.round(+obj.amount_total || 0) / 100, ref: obj.payment_intent || obj.id });
        await _pendDone(env, obj.id);
        return new Response('ok', { status: 200 });
      }
      // Marketplace one-time purchase → grant item + 80/20 split
      if (obj.metadata?.kind === 'market_purchase') {
        await _creditSale(env, {
          itemId: obj.metadata.itemId,
          buyer: (obj.metadata.buyer || obj.customer_email || '').toLowerCase(),
          seller: (obj.metadata.seller || '').toLowerCase(),
          amountCents: obj.amount_total,
          // What a later refund or dispute will arrive quoting.
          ref: obj.payment_intent || obj.id,
        });
        await _pendDone(env, obj.id);          // finished the normal way
        return new Response('ok', { status: 200 });
      }
      const email = (obj.metadata?.email || obj.client_reference_id || obj.customer_email || '').toLowerCase();
      const plan = obj.metadata?.plan || 'pro';
      if (email) {
        await _pendDone(env, obj.id);        // finished the normal way
        /* This metadata was written by AMV when it created the session, not by
           the browser, so the seat count here is ours. It grants immediately so
           somebody who just paid is not left waiting on a second event - and
           the subscription event that follows reads the real quantity off
           Stripe and corrects this if they ever diverge. */
        const first = { source: 'stripe', sub: obj.subscription };
        if (plan === 'team') first.custom = { seats: _teamSeatCount({ seats: obj.metadata?.seats }) };
        await setEntitlement(env, email, plan, { ...first, eventAt: evtAt });
        if (obj.customer) {
          await _linkCustomer(env, email, obj.customer);   // both directions
          /* The plan they just bought replaces the one they had. Stripe does
             not know that - a Checkout upgrade is a second subscription, not an
             edit - so the old one has to be stopped here or they pay twice. */
          await _cancelSupersededSubs(env, obj.customer, obj.subscription, email);
        }
        // Record the initial subscription payment so it shows in admin finance
        // even beyond Stripe's own retention window.
        const amt = (obj.amount_total != null ? obj.amount_total : 0) / 100;
        if (amt > 0) await _recordTxn(env, { provider: 'stripe', email, amount: amt,
          currency: (obj.currency || 'usd').toUpperCase(), kind: plan, status: 'succeeded',
          ref: obj.subscription || obj.id || '' });
      }
    } else if (type === 'checkout.session.async_payment_failed') {
      /* The voucher expired, or the direct debit came back. Nothing was granted
         when the session completed, so there is nothing to take away - what
         matters is closing the pending row so the sweep stops asking Stripe
         about a session that is never going to be paid, and telling the
         operator, because a customer who chose a delayed method and failed is
         somebody who tried to give AMV money and did not manage it. */
      await _pendDone(env, obj.id);
      audit(env, 'payment_async_failed', {
        id: obj.id,
        email: (obj.metadata?.email || obj.client_reference_id || obj.customer_email || '').toLowerCase(),
      });
      await alertOnce(env, 'stripe_async_failed',
        'A customer chose a delayed payment method (voucher or direct debit) and it did not complete. '
        + 'Nothing was granted. If this becomes common, check which methods are enabled in Stripe.', 60);
    } else if (type === 'invoice.payment_failed') {
      /* The renewal was DECLINED. Stripe will keep retrying for weeks; until
         this existed the plan stayed fully granted for all of it. Mark the
         account past due (the plan is kept through the grace period, then
         drops to free by itself) so a broken card cannot buy another month. */
      const email = (obj.metadata?.email || '').toLowerCase() || await _emailFromCustomer(env, obj.customer);
      if (email) await _markPastDue(env, email, { invoice: obj.id || '', attempt: obj.attempt_count || 0 });
    } else if (type === 'customer.subscription.updated' || type === 'invoice.paid') {
      // renewal or plan change - re-derive plan from the price
      const email = (obj.metadata?.email || '').toLowerCase() || await _emailFromCustomer(env, obj.customer);
      const priceId = obj.items?.data?.[0]?.price?.id || obj.lines?.data?.[0]?.price?.id;
      const plan = priceId ? PLAN_FROM_PRICE(env)[String(priceId)] : undefined;
      /* Stripe's own status is the authority on whether this subscription is
         paid for. Granting a plan off the price alone re-granted access to
         subscriptions Stripe had already marked unpaid. */
      const status = type === 'customer.subscription.updated' ? (obj.status || '') : 'active';
      /* AMV-007: which subscription this is about. On a subscription event the
         object IS the subscription; on an invoice it names the one it belongs
         to. Passed through so a message from a subscription that no longer owns
         the plan cannot revoke one the customer is currently paying for. */
      const subId = (type === 'customer.subscription.updated' ? obj.id : obj.subscription) || '';
      const DEAD = ['unpaid', 'canceled', 'incomplete_expired'];
      if (email && DEAD.indexOf(status) >= 0) {
        await setEntitlement(env, email, 'free', { source: 'stripe', canceled: true, status, eventAt: evtAt, sub: subId });
      } else if (email && status === 'past_due') {
        await _markPastDue(env, email, { sub: obj.id || '' });
      } else if (email && plan) {
        /* For the per-seat plan the QUANTITY is the entitlement. Stripe is the
           only thing that knows how many seats are actually being paid for, so
           it is read off the subscription item rather than trusted from a
           client, a metadata field, or a number we stored at checkout and hoped
           stayed true through a seat change. */
        const extra = { source: 'stripe', sub: subId };
        /* Only on a subscription event, because only that object carries them.
           An invoice leaves them alone, so the last known answer stands rather
           than being overwritten with a blank. */
        if (type === 'customer.subscription.updated') {
          const rn = _renewalFromSub(obj);
          if (rn) { extra.autoRenew = rn.autoRenew; extra.renewsAt = rn.renewsAt; if (rn.cycle) extra.cycle = rn.cycle; }
        }
        if (plan === 'team') {
          const qty = obj.items?.data?.[0]?.quantity ?? obj.lines?.data?.[0]?.quantity;
          extra.custom = { seats: _teamSeatCount({ seats: qty }) };
        }
        await setEntitlement(env, email, plan, { ...extra, eventAt: evtAt });   // clears pastDueSince
      }
      // Record each recurring renewal payment (invoice.paid carries amount_paid).
      if (type === 'invoice.paid' && email) {
        await _clearPastDue(env, email);                 // a payment landed: current again
        const amt = (obj.amount_paid != null ? obj.amount_paid : 0) / 100;
        if (amt > 0) await _recordTxn(env, { provider: 'stripe', email, amount: amt,
          currency: (obj.currency || 'usd').toUpperCase(), kind: (plan || 'renewal'), status: 'succeeded',
          ref: obj.id || obj.subscription || '' });
      }
    } else if (type === 'customer.subscription.deleted') {
      // cancellation/expiry - downgrade to free
      const email = await _emailFromCustomer(env, obj.customer);
      if (email) await setEntitlement(env, email, 'free', { source: 'stripe', canceled: true, eventAt: evtAt, sub: obj.id || '' });
    } else if (type === 'charge.dispute.created') {
      /* CHARGEBACK - the customer told their bank to reverse the payment. This
         is the DoorDash method: they keep the compute they already used and get
         the money back. Treat it as fraud: revoke access immediately and flag
         the account so they can't just re-subscribe and do it again. */
      /* A dispute on a MARKETPLACE purchase is a different thing from a
         dispute on a subscription, and treating them the same was wrong in both
         directions (AMV-091): the marketplace sale was never undone, and a
         paying subscriber who charged back a $9 listing had their whole
         subscription revoked for it. */
      const mkRef = obj.payment_intent || obj.charge || obj.id;
      /* A pack of extra usage disputed: the credit goes, the plan stays. */
      const reversed = (await _creditReverse(env, mkRef, 'dispute', 0)) || await _reverseSale(env, mkRef, 'dispute');
      if (!reversed) {
        const email = await _emailFromCustomer(env, obj.customer)
                   || (obj.metadata?.email || '').toLowerCase();
        if (email) {
          await setEntitlement(env, email, 'free', { source: 'stripe', disputed: true, eventAt: evtAt });
          await _abuseRecord(env, email, 'dispute', { chargeId: obj.charge || obj.id, amount: obj.amount });
          audit(env, 'chargeback', { email, amount: obj.amount });
        }
      }
    } else if (type === 'charge.refunded' || type === 'refund.created') {
      /* REFUND - revoke the entitlement that was paid for. A single refund is
         fine (support does them); _abuseRecord only blocks on a PATTERN. */
      const charge = obj.charge ? obj : (obj.data?.object || obj);
      // Same split as a dispute: undo the sale, or fall through to the plan.
      const reversedR = (await _creditReverse(env, charge.payment_intent || charge.id, 'refund',
                          Math.round(+(charge.amount_refunded || charge.amount) || 0) / 100))
                     || await _reverseSale(env, charge.payment_intent || charge.id, 'refund');
      if (!reversedR) {
        const email = await _emailFromCustomer(env, charge.customer)
                   || (charge.metadata?.email || '').toLowerCase();
        if (email) {
          await setEntitlement(env, email, 'free', { source: 'stripe', refunded: true, eventAt: evtAt });
          await _abuseRecord(env, email, 'refund', { chargeId: charge.id, amount: charge.amount_refunded || charge.amount });
          audit(env, 'refund', { email, amount: charge.amount_refunded || charge.amount });
        }
      }
    }
  } catch (e) {
    audit(env, 'webhook_error', { kind: 'stripe', msg: String(e.message).slice(0, 120) });
    // release the exactly-once claim so Stripe's retry can reprocess this event
    // (it genuinely failed - do NOT swallow it as "already processed"), and
    // return 500 so Stripe knows to retry.
    if (evt.id) await _releaseClaim(env, 'stripeevt', evt.id);
    return new Response('processing error', { status: 500 });
  }
  return json({ received: true });
}

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

