/* ══════════════════════════════════════════════════════════════════════════
   REFUNDS (Nov 16, the owner's decision: "14 days, light use").

   The policy, exactly as the Billing screen and Help state it:
     · Within 14 days of a plan charge, if less than 20% of what the plan
       includes was used since that charge, the whole charge comes back in one
       press - instantly, from Stripe - and the plan ends at once.
     · One such automatic refund per account in any twelve months.
     · Anything else (a duplicate charge, a billing error, heavier use, the
       EU/UK right to withdraw) is a REQUEST the owner approves or declines in
       the owner console, with the usage beside it.

   Why bounded and not "anything within 7 days": the plan's real cost is the
   AI it runs, and that is spent the moment it is used. A refund after a
   heavy fortnight hands back money that has already gone to the engines - at
   scale, a stadium of people doing it every week. "Under 20% used" is measured
   by the server, from the same per-period cost counter that enforces the
   plan's ceiling (`cost:<account>:<period>`), never from anything the page
   says.

   Order of operations, chosen for the failure that hurts a person most: the
   money goes back FIRST and is read back from Stripe; only then is the plan
   ended. If ending the subscription at Stripe fails, access still ends here
   (the server is the authority on the plan) and the owner is alerted to end
   it by hand - so nobody ever loses their plan without their money, and
   nobody is billed again without being told. A refund Stripe did not accept
   ends nothing.

   Double presses, two tabs, a retry after a timeout: every refund of an
   invoice carries the idempotency key amv-refund-<invoice>, so Stripe returns
   the same refund rather than a second one. */
const REFUND_DAYS = 14;
const REFUND_LIGHT_USE = 0.20;
const REFUND_AUTO_EVERY_MS = 365 * 86400000;
const REFUND_REASON_MAX = 1000;

function _stripeAuth(env){ return { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }; }

/* The latest PAID charge of this account's own plan subscription, from
   Stripe - with everything needed to refund it. { inv } or { code, error }. */
async function _refundLatestCharge(env, email){
  const ent = (await DB.get(env, 'ent', email)) || {};
  const subId = String(ent.subId || '');
  if (!subId) return { code: 'no_subscription', error: 'There is no plan charge on this account to refund.' };
  const custId = await env.AMV_KV.get(`stripecust:${email}`);
  const q = 'https://api.stripe.com/v1/invoices?subscription=' + encodeURIComponent(subId)
          + '&status=paid&limit=1&expand[]=data.payments';
  const r = await fetchDeadline(q, { headers: _stripeAuth(env) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { code: 'stripe_error', error: (d.error && d.error.message) || 'Stripe could not be reached.' };
  const inv = (d.data || [])[0];
  if (!inv) return { code: 'no_charge', error: 'There is no paid plan charge on this account to refund.' };
  const owner = typeof inv.customer === 'string' ? inv.customer : (inv.customer && inv.customer.id) || '';
  if (custId && owner && owner !== custId) {
    audit(env, 'refund_customer_mismatch', { email, sub: subId, expected: custId, got: owner });
    return { code: 'forbidden', error: 'That charge does not belong to this account.' };
  }
  /* The payment behind the invoice, in whichever shape this Stripe account's
     API version gives it: the invoice's own charge or payment intent, or its
     payments list. */
  const pay = ((inv.payments && inv.payments.data) || [])[0];
  const payPi = pay && pay.payment && (pay.payment.payment_intent || '');
  const charge = typeof inv.charge === 'string' ? inv.charge : '';
  const pi = typeof inv.payment_intent === 'string' ? inv.payment_intent : (typeof payPi === 'string' ? payPi : '');
  if (!charge && !pi) return { code: 'stripe_error', error: 'Stripe did not say which payment this charge was.' };
  const paidAt = 1000 * (+(inv.status_transitions && inv.status_transitions.paid_at) || +inv.created || 0);
  return { inv: { id: String(inv.id || ''), subId, charge, pi, paidAt,
    amount: +inv.amount_paid || 0, currency: String(inv.currency || 'usd').toLowerCase() } };
}

/* How much of what the plan includes has been used this period, 0..1+, from
   the server's own cost counter - the same one the plan's ceiling reads. */
async function _refundUsedShare(env, user){
  const ceiling = _monthlyCeilingUSD(user);
  if (!(ceiling > 0)) return 0;
  const name = `cost:${user.billingSubject || user.email}:${_periodKeyOf(user)}`;
  const used = +((await counter(env, name, { op: 'get' })).value || 0);
  return used / ceiling;
}

/* THE ONCE-A-YEAR LIMIT OUTLIVES THE ACCOUNT (owner, Nov 24: "do anything
   you recommend").

   `refundauto` is keyed by the email and erased with the account, so deleting
   the account and signing up again - or simply using a new email - reset the
   limit: subscribe, use under 20%, refund, repeat. So an automatic refund also
   leaves two marks that are NOT erased: a one-way hash of the email and of the
   card's fingerprint (Stripe's id for the physical card, the same across every
   customer it is used on). The card is the mark that matters; a new email
   does not get past it.

   Nothing that names anybody is kept: each mark is an HMAC under the server's
   secret, so it can answer "was this card refunded automatically in the last
   year?" and nothing else, and it expires by itself after the year it exists
   for. The Privacy Policy says so (section 2). A card fingerprint that cannot
   be read leaves the email mark to decide - never an open door, never a
   refusal on its own. */
const REFUND_SEEN_TTL_S = 366 * 86400;
async function _refundMarkId(env, what){
  if (!env.JWT_SECRET || !what) return '';
  const key = await _hmacKey(env.JWT_SECRET);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('refundseen:' + what)));
  return Array.from(mac.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
}
/* Stripe's fingerprint of the card behind this charge, or '' (not a card, or
   Stripe could not say). */
async function _refundCardPrint(env, inv){
  try {
    const url = inv.charge
      ? 'https://api.stripe.com/v1/charges/' + encodeURIComponent(inv.charge)
      : 'https://api.stripe.com/v1/payment_intents/' + encodeURIComponent(inv.pi) + '?expand[]=latest_charge';
    const r = await fetchDeadline(url, { headers: _stripeAuth(env) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return '';
    const ch = inv.charge ? d : (d.latest_charge && typeof d.latest_charge === 'object' ? d.latest_charge : {});
    const fp = ch && ch.payment_method_details && ch.payment_method_details.card && ch.payment_method_details.card.fingerprint;
    return typeof fp === 'string' && /^[A-Za-z0-9]{8,64}$/.test(fp) ? fp : '';
  } catch (e) {
    audit(env, 'refund_card_print_unreadable', { invoice: inv.id });
    return '';
  }
}
/* The marks this charge would leave, and whether either is already there. */
async function _refundMarks(env, email, inv){
  const ids = [];
  const e = await _refundMarkId(env, 'e:' + String(email || '').toLowerCase());
  if (e) ids.push(e);
  const fp = await _refundCardPrint(env, inv);
  const c = fp ? await _refundMarkId(env, 'c:' + fp) : '';
  if (c) ids.push(c);
  let seen = false;
  for (const id of ids) {
    const m = await DB.get(env, 'refundseen', id);
    if (m && m.at && Date.now() - m.at < REFUND_AUTO_EVERY_MS) { seen = true; break; }
  }
  return { ids, seen, card: !!c };
}

/* Everything the screen needs to say, and the server needs to decide. */
async function _refundState(env, user){
  if (!env.STRIPE_SECRET_KEY)
    return { code: 'needs_service', error: 'Payments are not connected on this deployment, so there is nothing to refund here.' };
  /* A team member's plan is the team's; only whoever pays can ask for it back. */
  if (user.billingSubject && user.billingSubject !== user.email)
    return { code: 'team_member', error: 'Your plan is paid for by your team. The team owner can ask for a refund.' };
  const c = await _refundLatestCharge(env, user.email);
  if (c.code) return c;
  const inv = c.inv;
  const open = await DB.get(env, 'refundopen', user.email);
  const done = await DB.get(env, 'refunddone', inv.id);
  const last = await DB.get(env, 'refundauto', user.email);
  const answered = await DB.get(env, 'refundlast', user.email);
  const share = await _refundUsedShare(env, user);
  const age = Date.now() - inv.paidAt;
  const why = [];
  if (done) why.push('already_refunded');
  if (!(inv.amount > 0)) why.push('nothing_paid');
  if (age > REFUND_DAYS * 86400000) why.push('over_14_days');
  if (share >= REFUND_LIGHT_USE) why.push('used_20_percent');
  if (last && last.at && Date.now() - last.at < REFUND_AUTO_EVERY_MS) why.push('refunded_this_year');
  /* Asked only when nothing else has ruled it out: it costs a Stripe read. */
  let marks = null;
  if (!why.length) {
    marks = await _refundMarks(env, user.email, inv);
    if (marks.seen) why.push('refunded_this_year');
  }
  return {
    inv,
    marks,
    state: {
      ok: true,
      auto: why.length === 0,
      why,
      charge: { amount: _fromMinor(inv.amount, inv.currency), currency: inv.currency.toUpperCase(), paidAt: inv.paidAt },
      daysLeft: Math.max(0, Math.ceil((REFUND_DAYS * 86400000 - age) / 86400000)),
      usedPercent: Math.round(Math.min(1, share) * 100),
      refunded: !!done,
      request: open && open.id ? { id: open.id, at: open.at || 0 } : null,
      /* The owner's answer to the last request, so the person is not left
         wondering - approved or declined, and when. */
      answered: answered && answered.status ? { status: answered.status, at: answered.at || 0 } : null,
    },
  };
}

/* Refund one invoice's payment at Stripe and read the refund back. Returns
   { refund } with Stripe's own status, or { code, error }. */
async function _refundAtStripe(env, inv, email, why){
  const body = new URLSearchParams({ reason: 'requested_by_customer',
    'metadata[email]': email, 'metadata[invoice]': inv.id, 'metadata[why]': why });
  if (inv.charge) body.set('charge', inv.charge); else body.set('payment_intent', inv.pi);
  const r = await fetchDeadline('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': 'amv-refund-' + inv.id }, _stripeAuth(env)),
    body: body.toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (d.error && d.error.message) || 'Stripe refused the refund.';
    if (/already been refunded|already refunded/i.test(msg)) return { code: 'already_refunded', error: 'This charge has already been refunded.' };
    return { code: 'stripe_error', error: msg };
  }
  /* Read back: what Stripe says the refund IS, not what the create answered. */
  let rf = d;
  if (d.id) {
    const g = await fetchDeadline('https://api.stripe.com/v1/refunds/' + encodeURIComponent(d.id), { headers: _stripeAuth(env) });
    const gd = await g.json().catch(() => ({}));
    if (g.ok && gd && gd.id) rf = gd;
  }
  const status = String(rf.status || '');
  if (status !== 'succeeded' && status !== 'pending')
    return { code: 'refund_failed', error: 'Stripe did not complete the refund (' + (status || 'no status') + '). Nothing else was changed.' };
  return { refund: { id: String(rf.id || ''), status, amount: _fromMinor(+rf.amount || inv.amount, inv.currency), currency: inv.currency.toUpperCase() } };
}

/* After the money is back: the plan ends. At Stripe if it can, here always. */
async function _refundEndPlan(env, email, subId, why){
  let endedAtStripe = false;
  try {
    const custId = await env.AMV_KV.get(`stripecust:${email}`);
    const url = 'https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(subId);
    const pre = await fetchDeadline(url, { headers: _stripeAuth(env) });
    const cur = await pre.json().catch(() => ({}));
    const owner = typeof cur.customer === 'string' ? cur.customer : (cur.customer && cur.customer.id) || '';
    if (pre.ok && cur.status === 'canceled') endedAtStripe = true;
    else if (pre.ok && (!custId || !owner || owner === custId)) {
      const del = await fetchDeadline(url, { method: 'DELETE', headers: _stripeAuth(env) });
      const dd = await del.json().catch(() => ({}));
      endedAtStripe = del.ok && dd.status === 'canceled';
    }
  } catch (e) {
    audit(env, 'refund_cancel_error', { email, sub: subId, error: String((e && e.message) || e).slice(0, 200) });
  }
  if (!endedAtStripe)
    await alertOnce(env, 'refund_cancel_' + subId,
      'A refund went through for ' + email + ' but their subscription ' + subId + ' could not be ended at Stripe. Access has ended in AMV; end it in Stripe so it is not billed again.', 1440);
  await setEntitlement(env, email, 'free', { source: 'refund', canceled: true, sub: subId, eventAt: Date.now() });
  audit(env, 'refund_plan_ended', { email, sub: subId, atStripe: endedAtStripe, why });
  return endedAtStripe;
}

/* GET /v1/billing/refund - what this account can do, and why. Reads only:
   the router sends a GET here and nowhere else, so a link cannot act. */
async function billingRefundState(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const s = await _refundState(env, user);
  if (s.code) return json({ ok: false, code: s.code, error: s.error }, s.code === 'stripe_error' ? 502 : 200);
  return json(s.state);
}

/* POST /v1/billing/refund - { mode:'auto' } or { mode:'request', reason } */
async function billingRefund(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const sp = await guardAction(env, `refund:${user.email}`, 6, 20, 'refund requests');
  if (sp) return sp;
  let body = {};
  try { body = await request.json(); } catch (e) { /* an unreadable body is an empty one, refused below */ }
  const mode = body && body.mode;
  if (mode !== 'auto' && mode !== 'request')
    return json({ error: 'Say whether this is a refund or a request for one.', code: 'bad_request' }, 400);

  const s = await _refundState(env, user);
  if (s.code) return json({ ok: false, code: s.code, error: s.error }, s.code === 'stripe_error' ? 502 : 400);

  if (mode === 'auto') {
    /* Decided again HERE, from Stripe and the server's counters. The screen
       showing the button is not a reason to refund. */
    if (!s.state.auto)
      return json({ ok: false, code: 'not_eligible', why: s.state.why,
        error: 'This charge cannot be refunded automatically. You can ask for a refund instead, and it will be looked at.' }, 400);
    const r = await _refundAtStripe(env, s.inv, user.email, 'auto');
    if (r.code) {
      audit(env, 'refund_failed', { email: user.email, invoice: s.inv.id, code: r.code });
      return json({ ok: false, code: r.code, error: r.error }, r.code === 'already_refunded' ? 409 : 502);
    }
    await DB.put(env, 'refunddone', s.inv.id, { at: Date.now(), email: user.email, refund: r.refund.id, why: 'auto' });
    await DB.put(env, 'refundauto', user.email, { at: Date.now(), invoice: s.inv.id });
    /* The marks that survive the account (above). A failure to write one is
       loud, not silent: the refund has happened and the limit is weaker. */
    for (const id of ((s.marks && s.marks.ids) || [])) {
      try { await DB.put(env, 'refundseen', id, { at: Date.now() }, { expirationTtl: REFUND_SEEN_TTL_S }); }
      catch (e) { audit(env, 'refund_mark_failed', { invoice: s.inv.id }); }
    }
    const atStripe = await _refundEndPlan(env, user.email, s.inv.subId, 'auto');
    audit(env, 'refund_auto', { email: user.email, invoice: s.inv.id, refund: r.refund.id, amount: r.refund.amount, currency: r.refund.currency, status: r.refund.status });
    await _userEvent(env, request, user.email, 'refund_auto', { amount: r.refund.amount, currency: r.refund.currency });
    return json({ ok: true, refund: r.refund, planEnded: true, endedAtStripe: atStripe });
  }

  /* A request. One open at a time; asking again returns the one already open. */
  if (s.state.request) return json({ ok: true, request: s.state.request, already: true });
  if (s.state.refunded) return json({ ok: false, code: 'already_refunded', error: 'This charge has already been refunded.' }, 409);
  const reason = String((body && body.reason) || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, REFUND_REASON_MAX);
  if (reason.length < 3) return json({ error: 'Say in a few words why you are asking.', code: 'bad_request' }, 400);
  const id = 'rr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const rec = { id, email: user.email, at: Date.now(), status: 'open', reason,
    invoice: s.inv.id, subId: s.inv.subId, charge: s.inv.charge, pi: s.inv.pi, amount: s.inv.amount, currency: s.inv.currency,
    paidAt: s.inv.paidAt, usedPercent: s.state.usedPercent, why: s.state.why };
  await DB.put(env, 'refundreq', id, rec);
  await DB.put(env, 'refundopen', user.email, { id, at: rec.at });
  audit(env, 'refund_requested', { email: user.email, id, invoice: s.inv.id, usedPercent: s.state.usedPercent });
  await alertOnce(env, 'refund_request_' + id,
    'Refund request from ' + user.email + ': ' + _fromMinor(rec.amount, rec.currency) + ' ' + rec.currency.toUpperCase()
    + ', ' + rec.usedPercent + '% used. Decide it in the owner console, under Refunds.', 60);
  return json({ ok: true, request: { id, at: rec.at } });
}

/* GET /v1/admin/refunds - every request, open ones first. */
async function adminRefunds(request, env){
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }
  /* Through scan, so a list cut short says so here and pages the owner. */
  const { rows: all, truncated, unreadable } = await scan(env, 'refundreq', 500, 'owner refund requests');
  const rows = all.map(x => x.value).filter(Boolean)
    .sort((a, b) => ((a.status === 'open') === (b.status === 'open') ? (b.at || 0) - (a.at || 0) : (a.status === 'open' ? -1 : 1)))
    .map(r => ({ id: r.id, email: r.email, at: r.at, status: r.status, reason: r.reason, usedPercent: r.usedPercent,
      amount: _fromMinor(r.amount, r.currency), currency: String(r.currency || 'usd').toUpperCase(), paidAt: r.paidAt,
      why: r.why || [], decidedAt: r.decidedAt || 0, refund: r.refund || null }));
  return json({ ok: true, requests: rows, truncated: !!truncated, unreadable: unreadable || 0 });
}

/* POST /v1/admin/refunds/decide { id, approve } */
async function adminRefundDecide(request, env){
  { const g = await _adminGate(request, env, 'write', 20, 200); if (g) return g; }
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Payments are not connected on this deployment.', code: 'needs_service' }, 503);
  let body = {};
  try { body = await request.json(); } catch (e) { /* refused below */ }
  const id = String((body && body.id) || '');
  if (!/^rr_[a-f0-9]{8,32}$/.test(id) || typeof body.approve !== 'boolean')
    return json({ error: 'Name the request and say approve or decline.', code: 'bad_request' }, 400);
  const rec = await DB.get(env, 'refundreq', id);
  if (!rec) return json({ error: 'No such request.', code: 'not_found' }, 404);
  if (rec.status !== 'open') return json({ error: 'This request was already decided.', code: 'decided', status: rec.status }, 409);

  if (!body.approve) {
    rec.status = 'declined'; rec.decidedAt = Date.now();
    await DB.put(env, 'refundreq', id, rec);
    await DB.del(env, 'refundopen', rec.email);
    await DB.put(env, 'refundlast', rec.email, { id, status: 'declined', at: rec.decidedAt });
    audit(env, 'refund_declined', { id, email: rec.email });
    return json({ ok: true, status: 'declined' });
  }
  const inv = { id: rec.invoice, subId: rec.subId, charge: rec.charge, pi: rec.pi, amount: rec.amount, currency: rec.currency };
  const r = await _refundAtStripe(env, inv, rec.email, 'approved');
  if (r.code && r.code !== 'already_refunded') {
    audit(env, 'refund_failed', { id, email: rec.email, invoice: rec.invoice, code: r.code });
    return json({ ok: false, code: r.code, error: r.error }, 502);
  }
  rec.status = 'approved'; rec.decidedAt = Date.now(); rec.refund = r.refund || null;
  await DB.put(env, 'refundreq', id, rec);
  await DB.put(env, 'refunddone', rec.invoice, { at: Date.now(), email: rec.email, refund: r.refund ? r.refund.id : '', why: 'approved' });
  await DB.del(env, 'refundopen', rec.email);
  await DB.put(env, 'refundlast', rec.email, { id, status: 'approved', at: rec.decidedAt });
  /* The plan the money paid for ends - if that charge still pays for the
     plan the account has now. A refund of an older charge leaves today's plan. */
  const ent = (await DB.get(env, 'ent', rec.email)) || {};
  let ended = false;
  if (ent.subId && ent.subId === rec.subId) { await _refundEndPlan(env, rec.email, rec.subId, 'approved'); ended = true; }
  audit(env, 'refund_approved', { id, email: rec.email, invoice: rec.invoice, refund: r.refund ? r.refund.id : '', planEnded: ended });
  return json({ ok: true, status: 'approved', refund: r.refund || null, planEnded: ended });
}
