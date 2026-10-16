  if (!ent || !ent.renewsAt) return null;
  if (+ent.renewsAt < Date.now()) return null;
  return {
    autoRenew: ent.autoRenew !== false,
    renewsAt: +ent.renewsAt,
    cycle: ent.cycle === 'year' ? 'year' : (ent.cycle === 'month' ? 'month' : ''),
    /* Whether the app may offer the switch at all. Without a subscription id
       there is nothing to write to, and a control that cannot act is one that
       fails at the moment somebody presses it. */
    manageable: !!ent.subId,
  };
}

function _billingState(ent) {
  if (!ent || !ent.pastDueSince) return null;
  const since = ent.pastDueSince;
  const graceEndsAt = since + PAST_DUE_GRACE_MS;
  const recoverEndsAt = since + PAST_DUE_RECOVER_MS;
  const now = Date.now();
  /* Flagged by the renewal sweep rather than by a processor telling us a
     payment failed. We do NOT know their card failed - we know we have not
     seen a renewal, which can equally mean our own webhook stopped arriving.
     Saying "your payment did not go through" to somebody whose payments are
     going through is a lie that costs them their subscription. */
  if (ent.pastDueReason === 'no_renewal_seen') {
    const over = now > graceEndsAt;
    return { state: over ? 'unconfirmed_lapsed' : 'unconfirmed', since, graceEndsAt, recoverEndsAt,
      message: over
        ? 'We could not confirm your subscription renewed, so your account is on Free for now. If you are still being '
        + 'charged, nothing is wrong on your side and we want to fix it - contact support and we will restore your plan.'
        : 'We have not been able to confirm your latest renewal. Your plan stays active until '
        + new Date(graceEndsAt).toUTCString().replace(/ GMT$/, ' UTC')
        + '. If your payments are going through normally, contact support rather than changing anything.' };
  }
  if (now <= graceEndsAt) {
    return { state: 'past_due', since, graceEndsAt,
      message: 'Your last payment did not go through. Update your card to keep your plan - it stays active until ' +
               new Date(graceEndsAt).toUTCString().replace(/ GMT$/, ' UTC') + '.' };
  }
  if (now <= recoverEndsAt) {
    return { state: 'paused', since, graceEndsAt, recoverEndsAt,
      message: 'Your plan is paused because the payment did not go through. We are still trying your card - '
             + 'update it and your plan comes back immediately, with nothing lost.' };
  }
  return { state: 'lapsed', since, graceEndsAt, recoverEndsAt,
    message: 'Your last payment could not be collected, so your plan has ended and your account is on Free. '
           + 'Your data is untouched - subscribe again any time to pick up where you left off.' };
}
/* Mark a subscription as unpaid without touching the plan that was sold, so
   that a later successful payment restores it exactly. */
async function _markPastDue(env, email, detail) {
  const em = String(email || '').toLowerCase(); if (!em) return;
  /* AMV-202: THE ONE THAT COSTS A PAYING CUSTOMER THEIR ACCOUNT.

     A past-due mark written from a copy read before a payment landed puts that
     copy back - so somebody who has just paid is marked past due and loses what
     they bought, with nothing failing anywhere. Under the lock, and re-read
     inside it, so the plan this judges is the plan as it is now. */
  const ent = await _withRecord(env, 'ent', em,
    async (e, k) => (await DB.get(e, 'ent', k)) || { plan: 'free' },
    async (e, k, rec) => { if (rec) await DB.put(e, 'ent', k, rec); },
    (rec) => {
      if (rec.plan === 'free') return null;              // nothing to lose
      if (rec.pastDueSince) return null;                 // keep the FIRST failure date
      rec.pastDueSince = Date.now();
      /* WHY, kept on the record, because the honest sentence differs. A declined
         card is the customer's to fix. A renewal we never saw might be nothing
         but our own webhook being broken, and telling somebody who is paying
         that their payment failed sends them to cancel a card that works. */
      if (detail && detail.reason) rec.pastDueReason = String(detail.reason).slice(0, 40);
      return rec;
    });
  /* Nothing to do is not a failure - the record is written back exactly as it
     was read inside the lock, which changes nothing. */
  if (!ent) return;
  /* A failed payment never touched the team, so a team whose owner stopped
     paying kept its plan until something else happened to write the record -
     and the grace window expires on a clock, not on a write (AMV-100). */
  await _refreshTeamPlan(env, em, ent);
  audit(env, 'payment_failed', Object.assign({ email: em, plan: ent.plan }, detail || {}));
}
/* ══════════════════════════════════════════════════════════════════════
   THE RENEWAL SWEEP - so a plan cannot outlive the money paying for it.

   Everything that revokes a plan is a webhook: invoice.payment_failed,
   customer.subscription.updated, BILLING.SUBSCRIPTION.CANCELLED. Grants are
   webhooks too, but a grant that never arrives is visible immediately - the
   customer pays and shouts. A REVOCATION that never arrives is silent: the
   subscription ends, nothing tells us, and the account keeps a paid plan for
   ever. If STRIPE_WEBHOOK_SECRET is unset, or the endpoint is deleted, or
   Stripe disables it after enough failures, that is the state of every account
   at once and nothing in the product would say so.

   So an entitlement has to be RE-CONFIRMED, not just granted. renewedAt is
   stamped whenever a processor tells us money is behind the plan; past
   RENEWAL_MAX_AGE_MS with no such word, the plan is no longer known to be paid
   for.

   The dangerous half is what to do about it. "No renewal seen" has two causes
   and they call for opposite actions:

     - their subscription really ended and we missed the event  -> revoke
     - OUR webhook is broken and they are paying fine           -> revoking is
       cancelling a paying customer's service over our own bug

   The two are told apart by how many at once. Cards fail one at a time;
   plumbing fails for everybody simultaneously. So when a large share of paid
   accounts go stale together, the sweep touches NOBODY, and pages the operator
   instead - loudly, because that state is also silently un-revoking every
   cancellation in the meantime.

   When it is isolated, the account is marked past due rather than dropped:
   that is the existing pipeline, and it gives seven days of full access and a
   message that says we could not CONFIRM the renewal, which is the only thing
   we actually know. */
const RENEWAL_MAX_AGE_MS = 40 * 24 * 60 * 60 * 1000;   // a month, plus retries, plus room
const SWEEP_SYSTEMIC_FRACTION = 0.25;                  // this much at once is not coincidence
const SWEEP_SYSTEMIC_MIN = 3;                          // and below this there is no pattern to see
const SWEEP_SCAN_LIMIT = 2000;

/* ---- IS THE HEAVY SHARE STILL SMALL ENOUGH FOR THE CAP TO BE SAFE ----

   The caps are set beyond what a person can reach, which is only safe while
   the accounts that behave that way stay rare. This is the check that says
   whether that is still true, and it is the difference between a cap that is
   safe by observation and one that is safe by assumption.

   Two counters, no scan. Nothing here reads an account, so the cost does not
   grow with the number of customers - which is what keeps a measurement alive
   long enough to be useful.

   It reports rather than acts. Nothing is throttled, nothing is billed, no
   account is touched: the answer is a number for the owner, because what to do
   about a rising heavy share is a pricing decision and pricing is not
   something a cron job should be making at four in the morning. */
async function runCohortCheck(env, now = Date.now()) {
  const period = new Date(now).toISOString().slice(0, 7);          // the calendar month
  const active = (await counter(env, `cohort:active:${period}`, { op: 'get' })).value || 0;
  const heavy  = (await counter(env, `cohort:heavy:${period}`,  { op: 'get' })).value || 0;

  /* A share computed from a handful of accounts is noise. Three heavy out of
     five is sixty percent and means nothing at all, and an alarm that fires on
     a number that means nothing is an alarm somebody turns off. */
  if (active < COHORT_MIN_ACCOUNTS) return { ran: true, active, heavy, share: null, reason: 'too few accounts to judge' };

  const share = heavy / active;
  if (share < COHORT_HEAVY_SHARE_ALARM) return { ran: true, active, heavy, share: +share.toFixed(4) };

  /* Once per month, because this is a trend and not an incident - it will
     still be true tomorrow, and paging somebody daily about a number that
     moves slowly is how the next real page gets ignored. */
  await alertOnce(env, 'cohort_heavy:' + period,
    Math.round(share * 100) + '% of paying accounts are past the point where they pay for themselves ('
    + heavy + ' of ' + active + ' this month). The message caps are set beyond what a person can reach, '
    + 'which is safe while that share stays under ' + Math.round(COHORT_HEAVY_SHARE_ALARM * 100) + '%. '
    + 'Past it the margin goes quickly: at 2% there is almost none left and at 5% every subscriber is '
    + 'losing money. Nothing has been changed automatically - what to do about it is a pricing decision. '
    + 'Check the usage report for the real cost per message before moving a price: if replies have got '
    + 'longer, that is the cause rather than the customers.',
    24 * 60);
  audit(env, 'cohort_heavy_alarm', { period, active, heavy, share: +share.toFixed(4) });
  return { ran: true, active, heavy, share: +share.toFixed(4), alarmed: true };
}

async function runRenewalSweep(env, now = Date.now()) {
  const day = todayKey();
  /* Once a day, atomically, so overlapping 5-minute ticks cannot double-mark
     or double-page. */
  if (!(await _claimOnce(env, 'renewsweep', day, 3 * 86400))) return { ran: false, reason: 'already swept today' };

  /* Through scan(), so hitting the ceiling pages somebody. Until it did, the
     sweep past 2000 entitlements checked a stable arbitrary subset and the
     rest were never examined for a lapsed payment again - silently, forever,
     with `truncated` computed here and thrown away by the caller. */
  const { rows, truncated } = await scan(env, 'ent', SWEEP_SCAN_LIMIT, 'renewal sweep');
  let paid = 0;
  const stale = [];
  for (const row of rows) {
    const e = row.value || {};
    if (_planPriceUSD(e.plan, e.custom) <= 0) continue;   // nothing is being paid for
    /* Comped, negotiated and owner accounts are granted by a person, not by a
       subscription, so there is no renewal to wait for and never will be. */
    if (e.source === 'admin') continue;
    paid++;
    if (e.pastDueSince) continue;                         // already in the pipeline
    /* updatedAt as the fallback so records written before renewedAt existed
       are covered rather than silently exempt - an exemption is exactly where
       this class of defect hides. */
    const lastSeen = e.renewedAt || e.updatedAt || 0;
    if (!lastSeen) continue;                              // cannot judge; do not guess
    if (now - lastSeen > RENEWAL_MAX_AGE_MS) stale.push({ email: row.id, plan: e.plan, lastSeen });
  }

  if (!stale.length) return { ran: true, paid, stale: 0, truncated };

  const share = paid ? stale.length / paid : 1;
  if (stale.length >= SWEEP_SYSTEMIC_MIN && share >= SWEEP_SYSTEMIC_FRACTION) {
    /* Everybody at once. That is us, not them. Touch nothing. */
    audit(env, 'renewal_sweep_systemic', { stale: stale.length, paid, share: +share.toFixed(2) });
    try {
      await alertOnce(env, 'renewal_systemic:' + day,
        'RENEWALS ARE NOT ARRIVING. ' + stale.length + ' of ' + paid + ' paid accounts have had no renewal '
        + 'confirmed in over ' + Math.round(RENEWAL_MAX_AGE_MS / 86400000) + ' days. That is almost certainly the '
        + 'payment webhook, not that many cards failing at once - so NO account has been touched. While this lasts, '
        + 'cancellations and failed payments are also not reaching AMV, so plans are not being revoked either. '
        + 'Check STRIPE_WEBHOOK_SECRET and the endpoint in the Stripe dashboard (and PAYPAL_WEBHOOK_ID).',
        6 * 60);
    } catch (e) {}
    return { ran: true, paid, stale: stale.length, systemic: true, marked: 0, truncated };
  }

  for (const s of stale) {
    await _markPastDue(env, s.email, { reason: 'no_renewal_seen', lastSeen: s.lastSeen, plan: s.plan });
  }
  audit(env, 'renewal_sweep', { marked: stale.length, paid });
  try {
    await alertOnce(env, 'renewal_stale:' + day,
      stale.length + ' subscription(s) have had no renewal confirmed in over '
      + Math.round(RENEWAL_MAX_AGE_MS / 86400000) + ' days and are now past due: '
      + stale.map(s => s.email).slice(0, 10).join(', ')
      + '. They keep full access for the grace period and are told we could not confirm the renewal, not that their '
      + 'card failed - because we do not know that.', 12 * 60);
  } catch (e) {}
  return { ran: true, paid, stale: stale.length, marked: stale.length, truncated };
}

/* A payment succeeded - the account is current again. */
async function _clearPastDue(env, email) {
  const em = String(email || '').toLowerCase(); if (!em) return;
  /* AMV-202: under the record's lock, so clearing the mark cannot write back a
     plan that changed while this was being read. */
  const ent = await _withEnt(env, em, (e) => {
    if (!e || !e.pastDueSince) return null;
    delete e.pastDueSince;
    return e;
  });
  if (!ent) return;
  await _refreshTeamPlan(env, em, ent);
  audit(env, 'payment_recovered', { email: em, plan: ent.plan });
}

// Read current entitlement (for the app to reflect the real plan).
async function getEntitlement(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  /* AMV-075: the invited account opening the app is the natural moment to check
     whether it has now earned its referral. Gated on a marker that is already
     in the record requireUser just read, so an account that was never invited -
     which is almost all of them - does no extra work at all. Best-effort: a
     failure here must never stop someone seeing their plan. */
  let converted = null;
  const ent0 = (await DB.get(env, 'ent', user.email)) || { plan: 'free' };
  if (ent0.refPending) { try { converted = await _referralMaybeConvert(env, user.email); } catch (e) {} }
  const ent = converted ? ((await DB.get(env, 'ent', user.email)) || { plan: 'free' }) : ent0;
  // The effective plan is what the client must reflect; `sold` and `billing`
  // explain a mismatch so the app can ask them to fix their card.
  return json({ ok: true, entitlement: Object.assign({}, ent, { plan: _planOf(ent), sold: ent.plan || 'free' }),
                billing: _billingState(ent),
                renewal: _renewalState(ent),
                bonusTokens: _bonusTokens(ent),
                teamEngines: user.teamEngines || null,
                referralEarned: converted && converted.paidJoiner ? converted.tokens : 0 });
}

// ---- Stripe: create a Checkout Session (subscription) ----
async function stripeCheckout(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  /* Every call creates a Checkout Session at Stripe. Unbounded, one signed-in
     account can burn the whole platform's Stripe API rate limit and take
     checkout down for every real customer - so the damage is to revenue, not to
     the person doing it. Generous enough that a human clicking Upgrade a few
     times never sees it. */
  const sc = await guardAction(env, `stripeco:${user.email}`, 10, 100, 'checkout attempts');
  if (sc) return sc;
  /* NOT CONFIGURED IS A SENTENCE SOMEBODY READS, NOT A LOG LINE.
     This said 'payments not configured' with no code, and the client renders a
     rejected checkout straight into a toast - so pressing Upgrade on a
     deployment with no Stripe key produced "Card: payments not configured".
     The subscribe route a few hundred lines up already does this properly; it
     is the same fact and gets the same words. The code lets the sheet show the
     honest panel instead of a red toast. */
  if (!env.STRIPE_SECRET_KEY)
    return json({ error: 'Payments are not connected on this deployment yet, so checkout cannot open. Nothing has been charged.',
                  code: 'needs_service' }, 503);


  /* An account flagged for chargeback/refund abuse cannot start a new paid plan.
     This is what stops the loop: charge back, then just subscribe again and do
     it once more. They keep a working free account; a human can clear the flag. */
  if (!(await _abuseCheckoutAllowed(env, user.email))) {
    audit(env, 'abuse_checkout_blocked', { email: user.email });
    return json({ error: 'This account can\u2019t start a new subscription. Please contact support.', code: 'account_flagged' }, 403);
  }

  const body = await request.json().catch(() => ({}));
  const plan = body.plan;
  /* Anything that is not the word "year" is a month. A cycle arriving from a
     browser decides only WHICH configured price is used, never an amount, so
     the worst a bad value can do is sell the monthly plan. */
  const cycle = String(body.cycle || '') === 'year' ? 'year' : 'month';
  const price = _stripePriceId(env, plan, cycle);
  if (!price) return _planUnsellable(plan, cycle);
  /* Seats are only meaningful for the per-seat plan, and the server decides the
     number - a client that asks for 1 seat at the 3-seat minimum gets 3, and one
     that asks for a million gets the cap. */
  const seats = plan === 'team' ? _teamSeatCount({ seats: body.seats }) : 1;

  // AMV-025 / AMV-SP-09: the server-configured origin is authoritative for
  // payment redirects, and there is no fallback to the request Origin.
  const origin = _paymentReturnOrigin(env);
  if (!origin) return _paymentOriginMissing();
  /* AFTER every configuration refusal above, on purpose. If this deployment
     cannot take a payment - no processor key, no price for the plan, nowhere
     to return to - then "confirm your age" asks somebody for their birth year
     under false pretences: they answer, and only then find out there is no
     checkout. A configuration failure is about the deployment and is the
     operator's to read; the age question is the person's to answer, and it is
     only worth asking once the answer can lead somewhere.

     A minor cannot form a binding contract, which is exactly why their
     purchases come back as chargebacks - and a subscription is the longest one
     this product sells. `age_required` is a QUESTION, not a refusal: it means
     nobody has ever asked, which is true of every account that existed before
     the gate did. The client asks and retries, the same way buying already
     does, so an existing customer is asked once rather than walled out of
     renewing. 428 says "answer this first"; 403 is the actual no. */
  {
    const ageBad = await _moneyAgeGate(env, user.email);
    if (ageBad) return json(ageBad, ageBad.code === 'age_required' ? 428 : 403);
  }
  const form = new URLSearchParams();
  /* HOW THE REST OF THE WORLD PAYS.

     Checkout offered cards and nothing else. That is fine in the United
     States and it quietly excludes an enormous number of people everywhere
     AMV was just translated for: iDEAL is the majority of Dutch online
     payments, BLIK is how Poland pays, PIX is instant and universal in
     Brazil, OXXO is cash at a shop counter in Mexico, and SEPA Direct Debit
     is the ordinary way a European pays for something monthly. Somebody in
     Warsaw could read a page in Polish, browse boards in Polish, connect a
     Polish mailbox, and then find the only way to subscribe was a card.

     `automatic_payment_methods` is Stripe's own answer to this: it offers the
     methods that are available in the buyer's country AND valid for this kind
     of payment, so a subscription is offered SEPA rather than a one-off method
     that cannot recur. That correctness is exactly why this is one parameter
     rather than a hand-kept list of method names per country - a list would be
     wrong the first time Stripe added a market, and wrong in the direction of
     a failed payment.

     Which methods actually appear is still governed by what is enabled in the
     Stripe dashboard, so this cannot turn anything on that the operator has
     not agreed to. */
  form.set('mode', 'subscription');
  form.set('automatic_payment_methods[enabled]', 'true');
  form.set('line_items[0][price]', price);
  form.set('line_items[0][quantity]', String(seats));
  /* Reuse the Stripe customer this account is already bound to.

     With `customer_email` and no `customer`, Stripe creates a NEW Customer for
     every completed session. So upgrading a plan - the most ordinary paid
     action there is after signing up - produced a second customer carrying a
     second subscription, and _linkCustomer then repointed us at it. The first
     subscription went on billing forever on a customer the billing portal no
     longer opened, so there was no way to stop it from inside AMV.

     Stripe rejects a session that carries both fields, so it is one or the
     other. */
  const knownCust = await env.AMV_KV.get(`stripecust:${user.email}`);
  if (knownCust) form.set('customer', knownCust);
  else form.set('customer_email', user.email);
  form.set('client_reference_id', user.email);       // so the webhook knows who paid
  form.set('success_url', `${origin}?upgraded=1`);
  form.set('cancel_url', `${origin}?canceled=1`);
  form.set('metadata[email]', user.email);
