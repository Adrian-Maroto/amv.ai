       right when everything was withdrawable and is silent theft now: money
       still inside its clearing window would vanish along with the payout, and
       the seller would never see it again. The holds are untouched - they are
       still that seller's money, still on the books, still on their own clock. */
    /* Under the SAME lock every other wallet change takes, re-reading inside
       it. The wdlock above stops two withdrawals racing each other; this stops
       a sale or a reversal landing in the middle of this one and writing back a
       balance it read before the payout. */
    await _withWallet(env, user.email, (ww) => {
      /* A destination that just changed is one of the signals above, so the
         change has to be recorded when it happens rather than inferred later. */
      if (ww.lastDest && ww.lastDest !== dest) ww.destChangedAt = Date.now();
      ww.lastDest = dest;
      ww.balance = +((+ww.balance || 0) - amount).toFixed(2);
      /* Debited, and owed. The marker is what tells a later attempt that this
         money left for a payout, so it can be given back if the payout record
         turns out never to have been written. */
      ww.pendingOut = (Array.isArray(ww.pendingOut) ? ww.pendingOut : [])
        .concat({ id: wid, amount, at: Date.now() }).slice(-20);
      /* The cleared tranches have now genuinely left; anything still inside its
         window stays, on its own clock. */
      _pruneMaturedHolds(ww);
    });
    try {
      await env.AMV_KV.put(`withdraw:${wid}`, JSON.stringify({
        id: wid, seller: user.email, amount, destination: dest,
        status, ts: Date.now(),
        risk: { tier: risk.tier, score: risk.score, reasons: risk.reasons },
        kycVerified: !!(risk.kyc && risk.kyc.verified),
        approvedBy: risk.tier === 'auto' ? 'auto' : '',
        approvedAt: risk.tier === 'auto' ? Date.now() : 0,
      }));
      /* It is unsettled from this moment. One of the two places that is true. */
      await _openPayoutAdd(env, user.email, wid);
    } catch (e) {
      /* The record is what makes the payout real, so without it the debit was
         for nothing and the money goes straight back. Told out loud: a balance
         that moved down and up again with no payout to show for it is exactly
         the kind of thing a seller writes in about. */
      await _withWallet(env, user.email, (ww) => {
        ww.balance = +((+ww.balance || 0) + amount).toFixed(2);
        ww.pendingOut = (Array.isArray(ww.pendingOut) ? ww.pendingOut : []).filter((p) => p && p.id !== wid);
      });
      audit(env, 'withdraw_rolled_back', { seller: user.email, amount, id: wid,
                                           error: String((e && e.message) || e).slice(0, 160) });
      throw e;
    }
    /* The record exists and is now the authority on what is owed, so the marker
       has done its job. */
    await _withWallet(env, user.email, (ww) => {
      ww.pendingOut = (Array.isArray(ww.pendingOut) ? ww.pendingOut : []).filter((p) => p && p.id !== wid);
    });
    await _pushWalletTx(env, user.email, { type: 'withdrawal', amount: -amount, status, id: wid, ts: Date.now() });
    /* Counted for the velocity signal and the identity threshold, both of which
       are about the pattern across payouts rather than this one. */
    await _withWallet(env, user.email, (ww) => {
      ww.payouts = (Array.isArray(ww.payouts) ? ww.payouts : []).concat({ at: Date.now(), amount }).slice(-20);
      ww.paidOut = +(((+ww.paidOut) || 0) + amount).toFixed(2);
    });
    audit(env, 'market_withdraw', { seller: user.email, amount, id: wid, tier: risk.tier, score: risk.score });

    /* An operator is told about the ones that need them, and NOT about the
       ordinary ones - a notification for every payout is how the ones that
       matter stop being read. */
    if (risk.tier !== 'auto') {
      await notify(env, `Payout needs review: $${amount.toFixed(2)} to ${user.email}`
        + ` (${risk.tier}, score ${risk.score}) - ` + risk.reasons.join('; '));
    }
    return json({ ok: true, amount, id: wid, status,
      /* The seller is told which of the two happened and why, because "pending"
         with no explanation is how somebody decides the platform is stealing
         from them. */
      message: risk.tier === 'auto'
        ? 'Approved. It will be sent on the next payout run.'
        : 'This payout is being reviewed before it is sent. ' + (risk.reasons[0] || '') + '.',
      reviewing: risk.tier !== 'auto' });
  } finally {
    await _releaseClaim(env, 'wdlock', user.email);
  }
}

/* =====================================================================
   AMV-089  PAYOUTS - the money had nowhere to go

   A seller could request a withdrawal. Their balance was zeroed, a debit was
   written to their transaction log, and a record was stored under
   `withdraw:<id>` - which nothing in the entire product ever read. No endpoint
   listed it, no screen showed it, and there was no way to mark one paid.

   So the seller's money left their balance and arrived nowhere, the operator
   had no idea they owed anybody anything, and the only trace was a KV key with
   no reader. That is destroyed user funds and an undisclosed liability at the
   same time, which makes it the worst defect in the product.

   Below: the operator can see what is owed, mark it paid, or reject it - and a
   rejection puts the money BACK, because a payout that cannot be fulfilled must
   return the balance rather than swallow it a second time.
   ===================================================================== */

/* ══════════════════════════════════════════════════════════════
   DECIDING PAYOUTS AT A SCALE WHERE NOBODY CAN READ THEM ALL.

   Every payout used to wait for the owner to mark it paid. That is right at
   ten sellers and impossible at ten thousand, and the alternative people reach
   for - approve everything - is how a marketplace gets drained. Neither is the
   answer, and the answer is not a bigger inbox.

   What payment platforms actually do, and what this does: decide each payout
   on evidence, release the ones that are provably ordinary, and send only the
   ones that are not to a person. The queue then stays the size of the problem
   rather than the size of the business.

   Three things carry the weight:

     the reserve   a percentage of every sale is held across the full dispute
                   window, so a late chargeback is taken from money AMV still
                   holds. See the hold split at the credit site.

     the score     account age, dispute and refund history, how concentrated
                   the sales are, how fast payouts are being requested, and
                   whether the destination just changed. Each is a reason a
                   person would give, so the answer can be explained.

     the tier      auto, review, or blocked. Nothing is ever auto-PAID by
                   accident: auto means AMV has cleared it, and money still
                   moves through whatever rail the operator has configured.

   Deliberately conservative where it is cheap to be: a payout wrongly sent to
   review costs somebody a day, a payout wrongly released costs the money. */
const PAYOUT_AUTO_MAX_USD       = 100;    // at or under this, and clean, releases itself
const PAYOUT_KYC_THRESHOLD_USD  = 600;    // cumulative payouts before identity is required
/* The SAME number, for a different reason, which is why it is written twice.

   $600 is where US information reporting starts - the point past which what
   AMV paid somebody in a CALENDAR YEAR has to be reported, and past which the
   taxpayer details had to be collected BEFORE the money went out rather than
   chased afterwards. The identity threshold above is about who somebody is and
   is fairly measured over their lifetime; this one is about a tax year and
   resets every January. Sharing one constant would mean the day the identity
   line moves for a fraud reason, the reporting line moves with it silently. */
const TAX_REPORT_THRESHOLD_USD  = 600;
const taxYearOf = (ts) => new Date(ts || Date.now()).getUTCFullYear();
const PAYOUT_RESERVE_PCT        = 0.10;   // of every sale, held across the dispute window
const PAYOUT_RESERVE_DAYS       = 120;    // how long a card dispute can take to arrive
const PAYOUT_RESERVE_MS         = PAYOUT_RESERVE_DAYS * 86400000;
const PAYOUT_MIN_AGE_DAYS       = 30;     // a brand new account is not a track record
const PAYOUT_VELOCITY_WINDOW_MS = 7 * 86400000;
const PAYOUT_VELOCITY_MAX       = 3;      // payouts in that window before it looks like cashing out

/* Identity. There is no provider wired, and this does not pretend there is:
   past the threshold a payout goes to REVIEW so a person verifies, rather than
   being auto-released or marked verified by something that checked nothing.
   When a provider key exists this reads its answer instead, and the threshold
   is also where the US 1099 reporting line sits, so it is a number worth
   keeping whatever the provider turns out to be. */
/* WHAT AMV PAID ONE PERSON IN ONE CALENDAR YEAR.

   This did not exist anywhere it could be read. `wallet.paidOut` is a lifetime
   running total with no year boundary; `wallet.payouts` keeps the last TWENTY,
   because it exists for the velocity signal; `wallet_tx` keeps 500. The
   `withdraw:` ledger does survive and carries seller, amount and time, but the
   only way to total a year from it is the admin scan - which lists KV in KEY
   order, caps at 5000 records and says so. At any size that matters, the one
   figure a 1099 requires could not be answered.

   So it is maintained where the money actually leaves, keyed by year first:
   `payoutyear:2026:seller@x.com`. The year-first key means the whole
   reporting population for a year is one prefix list rather than a scan of
   every withdrawal ever made.

   Deliberately NOT in PER_USER_KINDS. A tax record outlives an erasure
   request - that is what the legal-obligation carve-out in both GDPR and CCPA
   is for - and it is kept minimal for exactly that reason: what was paid, how
   many times, and when. Nothing about what was sold or to whom. */
async function _recordPaidForTax(env, email, amount, when) {
  const em = String(email || '').toLowerCase();
  const amt = +amount || 0;
  if (!em || !(amt > 0)) return null;
  const year = taxYearOf(when);
  try {
    return await _withKV(env, `payoutyear:${year}`, em, (r) => {
      r.email = em;
      r.year = year;
      r.paid = +(((+r.paid) || 0) + amt).toFixed(2);
      r.count = (+r.count || 0) + 1;
      r.firstAt = r.firstAt || (when || Date.now());
      r.lastAt = when || Date.now();
      r.reportable = r.paid >= TAX_REPORT_THRESHOLD_USD;
      return r;
    }, {});
  } catch (e) {
    /* The money HAS moved by the time this runs, so failing here must not
       unwind it - but a reporting figure that silently did not get written is
       how a filing comes out short, so it is both audited and alerted. */
    audit(env, 'tax_year_write_failed', { email: em, amount: amt, year, error: String((e && e.message) || e) });
    try { await alertOnce(env, 'tax_year_write',
      'A payout was sent but its calendar-year total could not be updated. The withdraw: record is still the source of truth - reconcile before filing.', 60); } catch (_) {}
    return null;
  }
}

/* What has been paid to somebody this year, for the threshold checks. */
async function _paidThisYear(env, email, when) {
  try {
    /* Read the way _withKV writes - straight from the namespace. DB.get would
       take the same string as a D1 `kind` column, and these rows are not
       written through DB, so the two would disagree on a D1 deployment. */
    const raw = await env.AMV_KV.get(`payoutyear:${taxYearOf(when)}:${String(email || '').toLowerCase()}`);
    if (!raw) return 0;
    const r = JSON.parse(raw);
    return +(r && r.paid) || 0;
  } catch (e) { return 0; }
}

async function _kycState(env, email) {
  try {
    const raw = await env.AMV_KV.get(`kyc:${String(email || '').toLowerCase()}`);
    if (!raw) return { verified: false, provider: '', checkedAt: 0 };
    const k = JSON.parse(raw);
    return { verified: !!k.verified, provider: k.provider || '', checkedAt: +k.checkedAt || 0 };
  } catch (e) { return { verified: false, provider: '', checkedAt: 0 }; }
}

/* Why this payout is or is not ordinary, in sentences somebody could read out.
   Returns { tier, score, reasons, kyc } and never throws - a scoring error must
   not become a released payout, so anything unexpected lands in review. */
async function _payoutRisk(env, email, amount, wallet) {
  const reasons = [];
  let score = 0;
  const em = String(email || '').toLowerCase();

  try {
    const acct = await DB.get(env, 'acct', em);
    const ageDays = acct && acct.createdAt ? (Date.now() - acct.createdAt) / 86400000 : 0;
    if (ageDays < PAYOUT_MIN_AGE_DAYS) {
      score += 40;
      reasons.push('the account is ' + Math.floor(ageDays) + ' days old, under the ' + PAYOUT_MIN_AGE_DAYS + '-day mark');
    }

    /* Disputes and refunds already recorded against this seller. This is the
       single strongest signal there is: somebody whose sales come back is
       somebody whose next payout is likely to be taken back too. */
    /* AMV-031: strict, because an unreadable abuse record reads as a seller
       with no disputes - the single strongest signal there is, answered wrong
       in the direction that releases the money. The whole function is wrapped
       in a handler that sends an unreadable state to a person. */
    const abuse = await DB.getStrict(env, 'abuse', em);
    const disputes = (abuse && +abuse.disputes) || 0;
    const refunds = (abuse && +abuse.refunds) || 0;
    if (disputes > 0) { score += 50 * Math.min(disputes, 3); reasons.push(disputes + ' payment dispute' + (disputes === 1 ? '' : 's') + ' on record'); }
    if (refunds > 2)  { score += 20; reasons.push(refunds + ' refunds on record'); }

    /* And an unreadable seller record reads as one who was never banned. */
    const standing = await DB.getStrict(env, 'seller', em);
    if (standing && standing.banned) { score += 200; reasons.push('selling access is suspended'); }
    else if (standing && +standing.strikes > 0) { score += 25 * +standing.strikes; reasons.push(+standing.strikes + ' policy strike(s)'); }

    /* Concentration. Fifty sales to fifty people is a business; fifty sales to
       two people is one person moving money through AMV, which is what
       wash-trading looks like from the inside. */
    /* AMV-040: THIS READ A FIELD NOTHING HAS EVER WRITTEN.

       Sales are recorded by _pushWalletTx into the separate `wallet_tx`
       record - the wallet itself has no `.tx`. So this list was always empty,
       `tx.length >= 3` was never true, and the concentration signal has never
       fired once. The most specific wash-trading check AMV has was dead code
       that read like working code, and a fraud check that cannot fire is worse
       than none: it is a reason not to look.

       Only settled sales count. A pending or reversed one is not evidence of
       anything, and counting it would let somebody manufacture the appearance
       of a broad customer base with purchases they later cancel. */
    /* Deliberately NOT caught here. The whole function is wrapped in a handler
       that escalates an unreadable state to human review, which is a better
       answer than this one scoring a partial penalty and letting the payout
       proceed. Swallowing the error locally would turn "AMV could not check"
       back into "AMV checked and found little", which is the exact confusion
       that made the original defect invisible. */
    const raw = await DB.get(env, 'wallet_tx', email);
    const tx = Array.isArray(raw) ? raw : [];
    const sales = tx.filter((t) => t && t.type === 'sale' && (t.buyer || t.from));
    const buyers = new Set(sales.map((t) => t.buyer || t.from).filter(Boolean));
    if (sales.length >= 3 && buyers.size <= 2) {
      score += 45;
      reasons.push('sales come from only ' + buyers.size + ' buyer' + (buyers.size === 1 ? '' : 's'));
    }

    /* Velocity. Cashing out fast is what somebody does when they expect the
       money to be taken back. */
    const recent = (wallet && Array.isArray(wallet.payouts) ? wallet.payouts : [])
      .filter(p => p && (Date.now() - (+p.at || 0)) < PAYOUT_VELOCITY_WINDOW_MS).length;
    if (recent >= PAYOUT_VELOCITY_MAX) { score += 30; reasons.push(recent + ' payouts in the last 7 days'); }

    /* A destination changed just before a withdrawal is the shape of a taken
       -over account being emptied. */
    const destAt = +(wallet && wallet.destChangedAt) || 0;
    if (destAt && (Date.now() - destAt) < 3 * 86400000) {
      score += 35; reasons.push('the payout destination changed in the last 3 days');
    }

    if (amount > PAYOUT_AUTO_MAX_USD) {
      score += 20;
      reasons.push('$' + amount.toFixed(2) + ' is over the $' + PAYOUT_AUTO_MAX_USD + ' automatic limit');
    }
  } catch (e) {
    /* A signal that could not be read is not a clean signal. */
    audit(env, 'payout_risk_error', { email: em, error: String((e && e.message) || e) });
    return { tier: 'review', score: 999, kyc: { verified: false }, 
             reasons: ['AMV could not finish checking this payout, so a person should look at it'] };
  }

  /* Identity, past the point where it is legally and practically required. */
  const kyc = await _kycState(env, em);
  const lifetimePaid = +(wallet && wallet.paidOut) || 0;
  if (!kyc.verified && (lifetimePaid + amount) > PAYOUT_KYC_THRESHOLD_USD) {
    score += 60;
    reasons.push('total payouts would pass $' + PAYOUT_KYC_THRESHOLD_USD + ' and identity has not been verified');
  }

  /* The reporting line, which is a different question from the identity one
     and was being answered with the lifetime figure. Somebody who was paid
     $400 in each of three years has passed the lifetime mark and has never
     been reportable; somebody paid $700 in their first year is reportable and
     has not passed anything measured over a lifetime. Asked of the calendar
     year, because that is what a filing covers. */
  const paidThisYear = await _paidThisYear(env, em);
  const yearAfter = +(paidThisYear + amount).toFixed(2);
  if (yearAfter >= TAX_REPORT_THRESHOLD_USD) {
    score += 30;
    reasons.push('this would bring ' + taxYearOf() + ' payouts to $' + yearAfter.toFixed(2)
      + ', at or past the $' + TAX_REPORT_THRESHOLD_USD + ' reporting line - taxpayer details are required before it is sent');
  }

  const tier = score >= 100 ? 'blocked' : (score > 0 ? 'review' : 'auto');
  return { tier, score, reasons, kyc, paidThisYear, yearAfter, taxYear: taxYearOf(),
           reportable: yearAfter >= TAX_REPORT_THRESHOLD_USD };
}

const ADMIN_PAYOUT_SCAN_MAX = 5000;
/* 'approved' is the step that did not exist. Before, a payout was either
   waiting for a person or already sent, so there was nowhere to record "AMV has
   decided this is fine and the money has not physically moved yet" - and money
   moving is a different act from money being cleared to move, done by whatever
   rail the operator has configured. Keeping them apart is what lets the
   decision be automatic without the disbursement being automatic. */
const PAYOUT_STATES = new Set(['pending', 'approved', 'paid', 'rejected']);

/* GET /admin/payouts - what is owed, and to whom. */
async function adminPayouts(request, env) {
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }
  /* THE CAP IS REAL, SO IT HAS TO BE ADMITTED.

     This scanned until it held 5000 records, then sorted by time and showed
     the first 500. Both numbers were wrong past the cap and neither said so.
     KV lists in KEY order, not in time order, so the 5000 kept were an
     arbitrary slice of the withdrawals rather than the newest ones - which
     means the "recent 500" were the recent 500 OF AN ARBITRARY SLICE, and
     `owed`, the money taken out of sellers' balances that has not reached
     them, was summed over that same slice. It is the platform's liability,
     it under-reported in silence, and the direction of the error is the
     dangerous one: it makes the business look like it owes less than it does.

     A bounded scan that stops short has to say so - the rule from AMV-031.
     So the cap is still there, because an unbounded admin scan is its own
     outage, and the answer now carries whether it was hit and how much was
     read. A number that might be short is reported as one. */
  const out = [];
  let cursor;
  let truncated = false;
  do {
    const page = await env.AMV_KV.list({ prefix: 'withdraw:', cursor, limit: 1000 });
    for (const k of (page.keys || [])) {
      const raw = await env.AMV_KV.get(k.name);
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch (e) {}
    }
    cursor = page.list_complete ? undefined : page.cursor;
    if (cursor && out.length >= ADMIN_PAYOUT_SCAN_MAX) { truncated = true; break; }
  } while (cursor);

  /* THE REPORTING YEAR, read from its own prefix rather than summed out of the
     scan above. This is the whole reason those records exist: the scan is
     capped, lists in key order and admits it may be short, so a filing built
     from it would be a floor. `payoutyear:2026:` is keyed year-first, so one
     year's reportable population is one prefix list, in whatever size it is.

     Still bounded - an unbounded admin scan is its own outage - but the bound
     is per year and the population past $600 is a small fraction of sellers,
     so it is a bound that is not expected to bite. It says so either way. */
  const year = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('taxYear'), 10) || taxYearOf(), 2020), 2200);
  const taxRows = [];
  let taxCursor, taxTruncated = false;
  do {
    const page = await env.AMV_KV.list({ prefix: `payoutyear:${year}:`, cursor: taxCursor, limit: 1000 });
    for (const k of (page.keys || [])) {
      const raw = await env.AMV_KV.get(k.name);
      if (!raw) continue;
      try { taxRows.push(JSON.parse(raw)); } catch (e) {}
    }
    taxCursor = page.list_complete ? undefined : page.cursor;
    if (taxCursor && taxRows.length >= ADMIN_PAYOUT_SCAN_MAX) { taxTruncated = true; break; }
  } while (taxCursor);
  const reportable = taxRows.filter(r => (+r.paid || 0) >= TAX_REPORT_THRESHOLD_USD)
                            .sort((a, b) => (+b.paid || 0) - (+a.paid || 0));

  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  /* THE QUEUE IS NOW THE EXCEPTIONS. Payouts AMV cleared by itself are
     'approved' and are not what somebody has to read; 'pending' means a
     signal fired and a person is being asked. Separating them is the whole
     point - a queue that contains every payout is a queue nobody finishes,
     and then the risky ones are read with the same attention as the rest. */
  const pending = out.filter(w => (w.status || 'pending') === 'pending');
  const approved = out.filter(w => w.status === 'approved');
  return json({
    ok: true,
    payouts: out.slice(0, 500),
    /* The number that matters: money taken out of sellers' balances that has
       not yet reached them. It is a liability until it is paid. */
    /* Everything not yet sent is owed, whichever side of the decision it is
       on - an approved payout is still money AMV has taken from a seller's
       balance and not delivered. Reporting only the reviewed ones would make
       the liability look smaller the better the risk engine got. */
    owed: +[...pending, ...approved].reduce((n, w) => n + (+w.amount || 0), 0).toFixed(2),
    pendingCount: pending.length,
    approvedCount: approved.length,
    approvedTotal: +approved.reduce((n, w) => n + (+w.amount || 0), 0).toFixed(2),
    needsReview: pending.slice(0, 200).map(w => ({
      id: w.id, seller: w.seller, amount: w.amount, destination: w.destination, ts: w.ts,
      tier: (w.risk && w.risk.tier) || 'review',
      score: (w.risk && w.risk.score) || 0,
      reasons: (w.risk && w.risk.reasons) || [],
      kycVerified: !!w.kycVerified,
    })),
    /* What was actually PAID in the year, per seller, and who is past the
       reporting line. Sent whether or not anybody has crossed it, because an
       empty list is an answer and a missing field is a screen that quietly
       stops showing this the year nothing has been paid yet. */
    tax: {
      year,
      threshold: TAX_REPORT_THRESHOLD_USD,
      sellers: taxRows.length,
      paidTotal: +taxRows.reduce((n, r) => n + (+r.paid || 0), 0).toFixed(2),
      reportableCount: reportable.length,
      reportableTotal: +reportable.reduce((n, r) => n + (+r.paid || 0), 0).toFixed(2),
      reportable: reportable.slice(0, 500).map(r => ({
        seller: r.email, paid: r.paid, payouts: r.count, firstAt: r.firstAt, lastAt: r.lastAt,
      })),
      truncated: taxTruncated,
      note: taxTruncated
        ? 'More sellers were paid this year than this scan reads, so these totals are a floor. The payoutyear: records are complete - raise the scan limit or read them directly before filing.'
        : undefined,
    },
    autoMaxUSD: PAYOUT_AUTO_MAX_USD,
    kycThresholdUSD: PAYOUT_KYC_THRESHOLD_USD,
    reservePct: PAYOUT_RESERVE_PCT,
    reserveDays: PAYOUT_RESERVE_DAYS,
    paidTotal: +out.filter(w => w.status === 'paid').reduce((n, w) => n + (+w.amount || 0), 0).toFixed(2),
    /* Said out loud, in the answer, so a screen cannot present a partial total
       as a complete one. */
    scanned: out.length,
    truncated,
    scanLimit: ADMIN_PAYOUT_SCAN_MAX,
    note: truncated
      ? 'More withdrawal records exist than this scan reads, so these totals are a floor rather than the full picture. Settle the pending ones and they stop accumulating.'
      : undefined,
  });
}

/* POST /admin/payouts/mark { id, status, note } */
async function adminPayoutMark(request, env) {
  { const g = await _adminGate(request, env, 'payout.mark', 60, 2000); if (g) return g; }
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const status = String(body.status || '');
  if (!/^wd_[A-Za-z0-9-]{4,40}$/.test(id)) return json({ error: 'bad id' }, 400);
  if (!PAYOUT_STATES.has(status) || status === 'pending') return json({ error: 'status must be approved, paid or rejected' }, 400);

  /* SERIALIZED, because rejecting CREDITS a wallet.

     The already-settled check below is a read followed by a decision, which two
     concurrent requests both pass: each reads 'pending', each writes the new
     status, and each adds the amount back to the seller's balance. One rejected
     payout, paid back twice, out of nothing.

     It does not need a hostile caller. The founder dashboard left both buttons
     live for the whole round trip, so a double-click was the ordinary way to
     produce it. marketWithdraw, one function above, already takes this lock for
     exactly this reason - this was the settle side of the same money with
     nothing holding it. */
  if (!(await _claimOnce(env, 'polock', id, 30))) {
    return json({ error: 'This payout is already being settled. Give it a moment.', code: 'in_progress' }, 409);
  }
  try {
    // Re-read INSIDE the lock: whoever held it before us may have settled it.
    const raw = await env.AMV_KV.get(`withdraw:${id}`);
    if (!raw) return json({ error: 'not found' }, 404);
    let rec = null; try { rec = JSON.parse(raw); } catch (e) { return json({ error: 'not found' }, 404); }
    /* An APPROVED payout is still settleable - approved means AMV cleared it,
       not that the money moved, so marking it paid (or rejecting it after a
       second look) is exactly what an operator does next. Only a terminal
       state refuses. */
    /* AMV-011: A REJECTED PAYOUT WITH AN UNFINISHED REFUND IS NOT FINISHED.

       Settling twice would pay twice or refund twice, so a terminal state
       refuses - with one exception, which is the whole finding. The status is
       written before the money moves, deliberately: the note below explains
       that the alternative risks crediting and then leaving the record
       settleable again, and it is right about that.

       What it misses is what the chosen order costs. If the credit fails, the
       payout is terminally 'rejected' and the seller's balance was never
       returned - the money was debited when they asked, and it is now neither
       in flight nor back. They are simply out of pocket, silently, and the only
       recovery was somebody noticing.

       Both orders have a bad failure, so the answer is neither order. The
       refund is claimed once and marked outstanding on the record until it
       lands. A rejected payout that still owes money can be settled again, and
       doing so completes the refund rather than repeating it. */
    const outstanding = +rec.refundDue || 0;
    if (!['pending', 'approved'].includes(rec.status || 'pending') && !(outstanding > 0)) {
      // Settling twice would either pay twice or refund twice. It is money.
      return json({ error: 'This payout was already ' + rec.status + '.', code: 'already_settled' }, 409);
    }
    if (outstanding > 0) {
      /* Finish what was started rather than deciding it again. The operator's
         requested status is ignored here: the decision was already made and
         recorded, and only the money is missing. */
      const done = await _refundRejectedPayout(env, rec);
      await env.AMV_KV.put(`withdraw:${id}`, JSON.stringify(rec));
      return json({ ok: true, id, status: rec.status,
                    refundCompleted: done,
                    message: done
                      ? 'The refund that was outstanding on this payout has been returned to the seller.'
                      : 'The refund is still outstanding. Try again in a moment.' }, done ? 200 : 503);
    }

    rec.status = status;
    rec.settledAt = Date.now();
    rec.note = String(body.note || '').slice(0, 200);
    /* Recorded as owed BEFORE the status is written, so a crash anywhere after
       this point leaves a rejected payout that says, on its own record, that a
       seller is still owed money. */
    if (status === 'rejected') rec.refundDue = +(+rec.amount || 0).toFixed(2);
    await env.AMV_KV.put(`withdraw:${id}`, JSON.stringify(rec));
    /* And it stops being unsettled here. The other one. Removed after the
       status is stored, so a failure between the two leaves an entry pointing
       at a settled payout - which _payoutsInFlight re-checks and ignores -
       rather than a payout in flight that nothing names. */
    await _openPayoutRemove(env, rec.seller, id);

    if (status === 'rejected') {
      /* Give it back. The balance was debited when the request was made; a
         payout that will never be sent has to return it, or rejecting is just a
         second way to destroy the same money. */
      /* UNDER THE LOCK EVERY OTHER WALLET WRITE TAKES.

         This read the wallet, added the amount and wrote the whole record back
         raw - the one writer in the product that did not go through
         _withWallet. `polock` serialises settlements of THIS payout and says
         nothing about the wallet, so a sale credit or another withdrawal
         landing in the middle was simply lost: the object written back here is
         the one read before they happened, so it takes their holds, their
         pendingOut and their balance with it.

         Both directions cost somebody money. The refund losing to a sale drops
         the refund; the refund winning drops the sale, and it restores a stale
         balance on top - money the seller may already have withdrawn. */
      await _refundRejectedPayout(env, rec);
      await env.AMV_KV.put(`withdraw:${id}`, JSON.stringify(rec));
    } else {
      // Mark the pending debit settled so the seller's log is not left ambiguous.
      await _pushWalletTx(env, rec.seller, { type: 'withdrawal_paid', amount: 0, status: 'paid', id, ts: Date.now() });
      /* HERE, and not at request time. `paidOut` is incremented when a payout
         is REQUESTED, which is deliberately conservative for the identity
         signal and wrong for tax: what is reportable is what was actually
         sent. A payout that ends up rejected never reaches this line, so a
         requested-then-refused payout does not inflate somebody's year. */
      const tax = await _recordPaidForTax(env, rec.seller, +rec.amount || 0, rec.settledAt);
      if (tax && tax.reportable && !(tax.count > 1 && (tax.paid - (+rec.amount || 0)) >= TAX_REPORT_THRESHOLD_USD)) {
        /* Announced once, on the payout that crosses the line - not on every
           payout after it, which is how the notice stops being read. */
        audit(env, 'tax_threshold_crossed', { seller: rec.seller, year: tax.year, paid: tax.paid });
        try { await notify(env, `${rec.seller} has passed $${TAX_REPORT_THRESHOLD_USD} in payouts for ${tax.year}`
          + ` ($${tax.paid.toFixed(2)}). Their taxpayer details are needed for reporting.`); } catch (_) {}
      }
    }
    audit(env, 'payout_settled', { id, seller: rec.seller, amount: rec.amount, status });
    return json({ ok: true, id, status });
  } finally {
    await _releaseClaim(env, 'polock', id);
  }
}

/* AMV-011: THE REFUND, ONCE, AND RECOVERABLE IF IT DOES NOT LAND.

   Rejecting a payout has to return the money that was debited when it was
   asked for, or rejecting is a second way to destroy the same money. The record
   carries `refundDue` from the moment the decision is written, so a failure
   anywhere in here leaves a rejected payout that says on its own face that a
   seller is still owed - and adminPayoutMark will finish it rather than
   refusing as already settled.

   Claimed once per payout, so completing it twice is impossible however many
   times it is attempted. Returns whether the money is now back.

   Mutates `rec` in place; the caller writes it. */
async function _refundRejectedPayout(env, rec) {
  const amount = +(+rec.refundDue || +rec.amount || 0).toFixed(2);
  if (!(amount > 0)) { delete rec.refundDue; return true; }
  let landed = false;
  try {
    const once = await _onceOrRetry(env, 'porefund', rec.id, CLAIM_ONCE_TTL_S, async () => {
      /* UNDER THE LOCK EVERY OTHER WALLET WRITE TAKES.

         This read the wallet, added the amount and wrote the whole record back
         raw - the one writer in the product that did not go through
         _withWallet. `polock` serialises settlements of THIS payout and says
         nothing about the wallet, so a sale credit or another withdrawal
         landing in the middle was simply lost. */
      await _withWallet(env, rec.seller, (ww) => {
        ww.balance = +((+ww.balance || 0) + amount).toFixed(2);
        /* AMV-041: AND THE LIFETIME TOTAL, WHICH ONLY EVER WENT UP.

           `paidOut` is added to when a payout is REQUESTED. Nothing took it
           back when one was rejected, so every refused request left the seller
           permanently credited with money AMV never sent. It feeds the point
           past which identity must be verified, so the error accumulates into
           asking an honest seller for documents they do not owe. Floored at
           zero: a total of money sent cannot be negative. */
        ww.paidOut = +Math.max(0, ((+ww.paidOut) || 0) - amount).toFixed(2);
        /* The velocity signal counts payouts in a window. One that was refused
           is not evidence of anything, so it stops counting too. */
        if (Array.isArray(ww.payouts)) {
          const i = ww.payouts.findIndex((p) => p && Math.abs((+p.amount || 0) - amount) < 1e-9);
          if (i > -1) ww.payouts.splice(i, 1);
        }
      });
      await _pushWalletTx(env, rec.seller, { type: 'withdrawal_returned', amount,
                                             status: 'rejected', id: rec.id, ts: Date.now() });
      return true;
    });
    /* `claimed: false` means another attempt already did it - which is a
       success from here, not a failure. */
    landed = once.claimed ? !!once.value : true;
  } catch (e) {
    audit(env, 'payout_refund_failed', { id: rec.id, seller: rec.seller, amount,
                                         error: String((e && e.message) || e).slice(0, 160) });
    try {
      await alertOnce(env, 'payout_refund_stuck',
        'A rejected payout could not be returned to the seller, so they are still short the amount that was '
        + 'debited when they asked for it. The payout record carries refundDue and settling it again completes '
        + 'the refund without repeating it.', 15);
    } catch (_) {}
    return false;
  }
  if (landed) delete rec.refundDue;
  return landed;
}

/* Seller changes a listing's status: active | sold | deactivated. Owner only. */
async function marketSetStatus(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { id, status } = await request.json().catch(() => ({}));
  if (!['active', 'sold', 'deactivated'].includes(status)) return json({ error: 'bad status' }, 400);
  const it = await _getListing(env, id);
  if (!it) return json({ error: 'not found' }, 404);
  if (it.authorEmail !== user.email) return json({ error: 'not your listing' }, 403);
  // SECURITY: a seller can never flip their own listing out of review or off a
  // moderation hold. Only deactivating is allowed while under review/removed.
  if ((it.status === 'under_review' || it.status === 'removed') && status === 'active') {
    return json({ error: 'This listing is under review and can\u2019t be activated until review completes.', code: 'under_review' }, 403);
  }
  // Re-screen on any activation, in case the stored content is prohibited.
  if (status === 'active') {
    const screen = _marketScreen(it, ((await DB.get(env, 'seller', user.email)) || {}).verifiedFor);
    if (!screen.ok) {
      await _withKV(env, 'market', id, (rec) => { if (rec) rec.status = 'removed'; });
      /* Cleared straight away rather than left to expire. A minute of
         staleness is fine for a catalogue and is NOT fine for something
         moderation just pulled - that minute is the whole harm. */
      await _marketCacheBust(env);
      return json({ error: screen.reason, code: 'policy_violation' }, 422);
    }
    if (screen.action === 'held_for_review') {
      await _withKV(env, 'market', id, (rec) => { if (rec) rec.status = 'under_review'; });
      await _marketCacheBust(env);
      return json({ ok: true, status: 'under_review' });
    }
  }
  /* Re-checked inside the lock: the listing may have SOLD between the
     ownership check above and this write, and putting it back to active would
     re-list something somebody has already bought. */
  const set = await _withKV(env, 'market', id, (rec) => {
    if (!rec) return null;
    if (rec.status === 'sold' && status === 'active') return false;
    rec.status = status;
    return true;
  });
  if (set === false) return json({ error: 'This listing has sold, so it cannot be put back on sale.', code: 'already_sold' }, 409);
  /* Deactivating is somebody taking their own listing down, and they will look
     straight at the catalogue to check that it went. */
  await _marketCacheBust(env);
  audit(env, 'market_status', { id, status, by: user.email });
  return json({ ok: true, status });
}

/* Increment a listing's view counter (best-effort analytics, not authed). */
async function marketView(request, env) {
  /* AMV-204: A VIEW COUNTER IS NOT A REASON TO REWRITE A LISTING.

     This read the whole listing, added one to `views`, and wrote the whole
     record back - with no auth, on every page load. Three things wrong with
     that, and the first is the expensive one:

       - the most FREQUENT write in the marketplace was racing the two that
         carry money. A visitor loading the page while a sale or a status change
         was being written put the old record back, so an item that had just
         sold went back on sale because somebody looked at it;
       - anyone could drive unlimited writes to one key by reloading, which is
         billed and is an abuse vector with no account behind it;
       - KV allows roughly one write per second per key, so the listing that
         gets popular - the only one where the count matters - throttles and
         loses its own views.

     The count lives in the counter now, which is what a counter is for: it is
     atomic, it is cheap, and it touches nothing else on the record. */
  /* AND BOUNDED PER SOURCE, which the counter alone does not do.

     The note above says the abuse problem "goes away" once the count moved off
     the record. Half of it did: the lost update and the hot key are gone. What
     did not is that this is an unauthenticated route which still costs a
     listing read and a counter increment per request, both billed, and it was
     the only public route in this Worker with nothing bounding it - every
     other one carries a guard.

     Generous, because a person browsing a marketplace really does open a lot of
     listings, and because getting this wrong makes the shop look broken. */
  const vg = await guardAction(env, 'mktview:' + (request.headers.get('CF-Connecting-IP') || 'anon'),
                               120, 5000, 'listing views');
  if (vg) return vg;

  const { id } = await request.json().catch(() => ({}));
  const key = String(id || '').slice(0, 64);
  if (!key) return json({ ok: true });
  const it = await _getListing(env, key);
  if (!it) return json({ ok: true });
  let views = (it.views || 0) + 1;
  try {
    const r = await counter(env, `mktviews:${key}`, { op: 'incr', amount: 1, ttlMs: 86400000 * 400 });
    /* The counter starts at zero for listings that existed before this, so the
       number already on the record is carried alongside rather than thrown away. */
    const since = (r && r.value) || 1;
    views = (it.views || 0) + since;
    /* The browse screen reads `views` off the record and cannot afford a
       counter read per listing, so the record is refreshed from the counter -
       under the lock, and only every MKT_VIEW_FOLD views. That is one write per
       fifty instead of one per view: the count on screen stays right, the
       hot-key and lost-update problems go away, and a write that does lose a
       race now costs at most a few views rather than a sale. The abuse half is
       the guard at the top of this function, not this - a counter makes each
       request cheap, it does not make the number of requests finite. */
    if (since >= MKT_VIEW_FOLD && since % MKT_VIEW_FOLD === 0) {
      await _withKV(env, 'market', key, (rec) => {
        if (!rec) return null;
        rec.views = (rec.views || 0) + since;
      });
      await counter(env, `mktviews:${key}`, { op: 'incr', amount: -since, ttlMs: 86400000 * 400 });
    }
  } catch (e) { /* a view that could not be counted is not worth failing over */ }
  return json({ ok: true, views });
}

/* Buyer rates a listing (item rating, 1-5). Recomputes the listing average. */
async function marketRate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { id, stars } = await request.json().catch(() => ({}));
  const s = Math.max(1, Math.min(5, Math.round(Number(stars) || 0)));
