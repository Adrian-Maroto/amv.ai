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
  const active = await _tallyGet(env, `cohort:active:${period}`);
  const heavy  = await _tallyGet(env, `cohort:heavy:${period}`);

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

/* A PASS OVER EVERY ENTITLEMENT, A FEW PAGES PER TICK.

   This used to read the first SWEEP_SCAN_LIMIT entitlements once a day and
   page somebody when there were more - so past two thousand paying accounts
   the same ones beyond the cut were never examined for a lapsed payment
   again, and a plan nobody was paying for kept its access for ever. Alerting
   about that was honest; it did not fix it.

   Now a pass starts once a day and goes through the whole namespace a page
   at a time, SWEEP_SCAN_LIMIT records per tick, from where the last tick
   stopped (`renewsweep:pass`). Nothing is marked until the pass has seen
   everyone, because the decision needs the whole picture: a quarter of all
   paid accounts stale at once is AMV's webhook, not their cards, and then
   nobody is touched. A deployment smaller than one tick's share finishes in
   one call, with the same answer as before. Two ticks never work on one pass
   at once (`renewpage`). */
const SWEEP_PAGE = 500;
const SWEEP_STALE_KEEP = 20000;
async function runRenewalSweep(env, now = Date.now()) {
  const day = todayKey();
  if (!(await _claimOnce(env, 'renewpage', 'tick', 120))) return { ran: false, reason: 'a sweep is already running' };
  try {
    let pass = null;
    try { pass = JSON.parse((await env.AMV_KV.get('renewsweep:pass')) || 'null'); } catch (e) { pass = null; }
    if (!pass) {
      /* Once a day, atomically, so overlapping 5-minute ticks cannot start two. */
      if (!(await _claimOnce(env, 'renewsweep', day, 3 * 86400))) return { ran: false, reason: 'already swept today' };
      pass = { day, cursor: null, paid: 0, stale: [], staleCount: 0 };
    }
    let read = 0;
    while (read < SWEEP_SCAN_LIMIT) {
      const pg = await DB.page(env, 'ent', pass.cursor, Math.min(SWEEP_PAGE, SWEEP_SCAN_LIMIT - read));
      read += pg.rows.length;
      for (const row of pg.rows) {
        const e = row.value || {};
        if (_planPriceUSD(e.plan, e.custom) <= 0) continue;   // nothing is being paid for
        /* Comped, negotiated and owner accounts are granted by a person, not by a
           subscription, so there is no renewal to wait for and never will be. */
        if (e.source === 'admin') continue;
        pass.paid++;
        if (e.pastDueSince) continue;                         // already in the pipeline
        /* updatedAt as the fallback so records written before renewedAt existed
           are covered rather than silently exempt - an exemption is exactly where
           this class of defect hides. */
        const lastSeen = e.renewedAt || e.updatedAt || 0;
        if (!lastSeen) continue;                              // cannot judge; do not guess
        if (now - lastSeen > RENEWAL_MAX_AGE_MS) {
          pass.staleCount++;
          if (pass.stale.length < SWEEP_STALE_KEEP) pass.stale.push({ email: row.id, plan: e.plan, lastSeen });
        }
      }
      pass.cursor = pg.next;
      if (!pg.next) break;
    }
    if (pass.cursor) {
      await env.AMV_KV.put('renewsweep:pass', JSON.stringify(pass), { expirationTtl: 7 * 86400 });
      return { ran: true, partial: true, paid: pass.paid, stale: pass.staleCount, truncated: false };
    }
    try { await env.AMV_KV.delete('renewsweep:pass'); } catch (e) {}
    const paid = pass.paid, truncated = false;
    /* Held back a share of the list for memory, so the decision uses the count. */
    const stale = pass.stale;
    if (pass.staleCount > stale.length) {
      audit(env, 'renewal_sweep_overflow', { stale: pass.staleCount, kept: stale.length, paid });
    }
    return await _renewalDecide(env, day, paid, stale, pass.staleCount, truncated);
  } finally { await _releaseClaim(env, 'renewpage', 'tick'); }
}
async function _renewalDecide(env, day, paid, stale, staleCount, truncated) {
  if (!staleCount) return { ran: true, paid, stale: 0, truncated };

  const share = paid ? staleCount / paid : 1;
  if (staleCount >= SWEEP_SYSTEMIC_MIN && share >= SWEEP_SYSTEMIC_FRACTION) {
    /* Everybody at once. That is us, not them. Touch nothing. */
    audit(env, 'renewal_sweep_systemic', { stale: staleCount, paid, share: +share.toFixed(2) });
    try {
      await alertOnce(env, 'renewal_systemic:' + day,
        'RENEWALS ARE NOT ARRIVING. ' + staleCount + ' of ' + paid + ' paid accounts have had no renewal '
        + 'confirmed in over ' + Math.round(RENEWAL_MAX_AGE_MS / 86400000) + ' days. That is almost certainly the '
        + 'payment webhook, not that many cards failing at once - so NO account has been touched. While this lasts, '
        + 'cancellations and failed payments are also not reaching AMV, so plans are not being revoked either. '
        + 'Check STRIPE_WEBHOOK_SECRET and the endpoint in the Stripe dashboard (and PAYPAL_WEBHOOK_ID).',
        6 * 60);
    } catch (e) {}
    return { ran: true, paid, stale: staleCount, systemic: true, marked: 0, truncated };
  }

  /* At most SWEEP_STALE_KEEP a pass; any beyond it are still stale tomorrow,
     and tomorrow's pass marks them. */
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
  form.set('metadata[plan]', plan);
  if (plan === 'team') {
    form.set('metadata[seats]', String(seats));
    // let the customer change the seat count from Stripe's own portal too
    form.set('subscription_data[metadata][email]', user.email);
    form.set('subscription_data[metadata][plan]', 'team');
  }

  const r = await fetchDeadline('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const d = await r.json();
  if (!r.ok) {
    // A customer just tried to PAY and Stripe refused. That's lost revenue you
    // need to know about now, not from a support ticket. Throttled so a Stripe
    // outage doesn't spam you.
    await alertOnce(env, 'stripe_checkout_fail', `💳 Stripe checkout failing: ${d.error?.message || 'unknown'} - customers may be unable to subscribe.`, 15);
    return json({ error: d.error?.message || 'stripe error' }, 502);
  }
  /* Remembered until the webhook grants the plan. A dropped delivery would
     otherwise leave somebody who has paid sitting on the free tier with
     nothing watching, so the sweep asks Stripe directly. */
  await _pendStart(env, d.id, { provider:'stripe', kind:'plan', email:user.email, plan });
  return json({ url: d.url, id: d.id });
}

// ---- Stripe: customer billing portal (manage/cancel subscription) ----
async function stripePortal(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const sp = await guardAction(env, `stripepo:${user.email}`, 10, 100, 'billing portal sessions');
  if (sp) return sp;
  /* Same fact, same words as the checkout route above. */
  if (!env.STRIPE_SECRET_KEY)
    return json({ error: 'Payments are not connected on this deployment yet, so the billing portal cannot open.',
                  code: 'needs_service' }, 503);
  const custId = await env.AMV_KV.get(`stripecust:${user.email}`);
  if (!custId) return json({ error: 'no subscription found' }, 404);
  // AMV-025 / AMV-SP-09: the server-configured origin is authoritative for
  // payment redirects, and there is no fallback to the request Origin.
  const origin = _paymentReturnOrigin(env);
  if (!origin) return _paymentOriginMissing();
  const form = new URLSearchParams({ customer: custId, return_url: origin });
  const r = await fetchDeadline('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const d = await r.json();
  if (!r.ok) return json({ error: d.error?.message || 'stripe error' }, 502);
  return json({ url: d.url });
}

/* ---- Stripe: turn auto-renew off, or back on ----

   A subscription renews by itself; that is what a subscription is. So "auto
   renew" is really one question - does this one stop at the end of the period
   it is already paid for - and Stripe answers it with a single field,
   `cancel_at_period_end`. This route writes that field and nothing else.

   WHY NOT JUST SEND THEM TO THE PORTAL. The billing portal is there and stays
   there, but it is a page somewhere else that has to be configured in the
   Stripe dashboard before it opens at all, and it cannot answer the question
   on AMV's own screen. This can, and more importantly the result is READ BACK:
   what gets written to the entitlement is what Stripe's response says the
   subscription now is, not what was asked for. An action AMV cannot read back
   is an action AMV cannot claim.

   WHOSE SUBSCRIPTION. `subId` is put on the entitlement by the webhook for
   this account, so it is this account's by construction - but "by
   construction" is how an IDOR gets written. The customer on Stripe's response
   is compared against the customer id stored for this email, and a mismatch is
   refused and audited rather than quietly corrected. Nothing about the
   subscription is taken from the request: the body carries one boolean.

   NOTHING IS CHARGED OR REFUNDED HERE. Turning it off leaves the plan running
   to the end of the period already paid for; turning it back on resumes the
   schedule. That is why off is reversible right up to the last day, and the
   response says when that day is. */
