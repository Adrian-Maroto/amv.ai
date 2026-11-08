/* ══════════════════════════════════════════════════════════════════════════
   (Prediction markets used to live at the top of this file: a quote-then-trade
   flow on Kalshi and Polymarket. It was removed on the owner's decision - see
   LESSONS 595. The file was renamed for what it holds - renewals, the
   transaction ledger, invoices and the claim-once helpers - keeping its 49-
   prefix, so the build order did not move.)
   ══════════════════════════════════════════════════════════════════════════ */

async function stripeAutoRenew(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const sp = await guardAction(env, `stripear:${user.email}`, 12, 100, 'auto-renew changes');
  if (sp) return sp;
  if (!env.STRIPE_SECRET_KEY)
    return json({ error: 'Payments are not connected on this deployment yet, so auto-renew cannot be changed here.',
                  code: 'needs_service' }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { /* a body that does not parse is an empty request, refused by the checks after it */ }
  /* Explicit, both ways. A missing field is not "off" - it is a caller that
     did not say, and guessing either way changes somebody's billing. */
  if (typeof body.on !== 'boolean')
    return json({ error: 'Say whether auto-renew should be on or off.', code: 'bad_request' }, 400);
  const on = body.on;

  const ent = (await DB.get(env, 'ent', user.email)) || {};
  const subId = String(ent.subId || '');
  if (!subId) return json({ error: 'No subscription to change.', code: 'no_subscription' }, 404);

  const url = 'https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(subId);
  const auth = { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` };
  const custId = await env.AMV_KV.get(`stripecust:${user.email}`);
  const ownerOf = (sub) => (typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || '');
  const notOurs = (sub) => { const c = ownerOf(sub); return !!(custId && c && custId !== c); };

  /* ASKED BEFORE IT IS TOUCHED, NOT AFTER.

     This check used to run on the response to the UPDATE - which refused, and
     returned 403, having already written cancel_at_period_end to whosever
     subscription it was. The record was protected and the stranger's billing
     was not, which is the wrong half: our record is recoverable and somebody
     else's cancelled subscription is not.

     Reaching that state needs `subId` to be wrong, and it is written only by
     the signature-verified webhook for this account - so this is
     defence-in-depth rather than a live hole. It is also one extra read on an
     action somebody takes at most a few times in the life of an account, which
     is about the cheapest a guarantee ever gets. */
  const pre = await fetchDeadline(url, { method: 'GET', headers: auth });
  const cur = await pre.json().catch(() => ({}));
  if (!pre.ok) return json({ error: cur.error?.message || 'stripe error', code: 'stripe_error' }, 502);
  if (notOurs(cur)) {
    audit(env, 'autorenew_customer_mismatch', { email: user.email, sub: subId, expected: custId, got: ownerOf(cur), when: 'before' });
    return json({ error: 'That subscription does not belong to this account.', code: 'forbidden' }, 403);
  }

  const r = await fetchDeadline(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, auth),
    body: new URLSearchParams({ cancel_at_period_end: on ? 'false' : 'true' }).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: d.error?.message || 'stripe error', code: 'stripe_error' }, 502);

  /* Asked again of what came back. The subscription cannot normally change
     owner between two calls a moment apart, but the answer is in hand and a
     record is the thing that outlives the request. */
  if (notOurs(d)) {
    audit(env, 'autorenew_customer_mismatch', { email: user.email, sub: subId, expected: custId, got: ownerOf(d), when: 'after' });
    return json({ error: 'That subscription does not belong to this account.', code: 'forbidden' }, 403);
  }

  /* From the RESPONSE, so the record says what the subscription is rather than
     what was asked of it. */
  const rn = _renewalFromSub(d);
  await _withEnt(env, user.email, (e) => {
    if (!e) return null;
    if (rn) {
      e.autoRenew = rn.autoRenew;
      e.renewsAt = rn.renewsAt;
      if (rn.cycle) e.cycle = rn.cycle;
    } else {
      e.autoRenew = !d.cancel_at_period_end;
    }
    return e;
  });

  audit(env, 'autorenew_set', { email: user.email, sub: subId, on: rn ? rn.autoRenew : on });
  await _userEvent(env, request, user.email, 'autorenew_changed', { on: rn ? rn.autoRenew : on });
  return json({ ok: true, renewal: rn || { autoRenew: !d.cancel_at_period_end, renewsAt: 0, cycle: '', manageable: true } });
}

// ---- Stripe: list this user's invoices (for the in-app billing history) ----
/* ---- Unified transaction ledger - records a payment from ANY provider
   (Stripe, PayPal, marketplace/wallet) so the admin finance page shows ALL
   money, not just Stripe. Stored as a capped list under 'txn:log'. Each entry:
   {id, ts, provider, email, amount, currency, kind, status, ref}. ---- */
const TXN_PREFIX = 'txn:e:';
/* Newest sorts first. The prefix is spelled out at each write, not taken
   from here, because the backup coverage check reads the writes to know
   which kinds of record exist. */
const _txnOrder = (e) => String(9999999999999 - (e.ts || 0)).padStart(13, '0') + ':' + e.id;
/* The canonical record of a transaction id: { rec, mine } - `mine` when
   this call is the one that made it. null when the strong object could not
   answer, which the caller reports as not recorded. Without the object (a
   development machine) KV is the record, as it always was. */
async function _txnCanonical(env, id, entry) {
  const fromKv = async () => {
    const seen = await env.AMV_KV.get('txn:id:' + id);
    if (seen) { try { const o = JSON.parse(seen); if (o) { const { pending: _p, ...was } = o; return was; } } catch (e) { /* unreadable: the legacy list is asked next */ } }
    const legacy = await env.AMV_KV.get('txn:log');
    if (legacy) { try { const o = (JSON.parse(legacy) || []).find((e) => e && e.id === id); if (o) return o; } catch (e) { /* unreadable list: nothing known from it */ } }
    return null;
  };
  if (!env.AMV_COUNTER) { const old = await fromKv(); return old ? { rec: old, mine: false } : { rec: entry, mine: true }; }
  const name = 'txnrec:' + id;
  const read = async () => {
    const g = await counter(env, name, { op: 'revGet' });
    if (!g || g.unavailable) return { unavailable: true };
    if (g.committed && g.digest) { try { return { rec: JSON.parse(g.digest) }; } catch (e) { return { unavailable: true }; } }
    return { rec: null };
  };
  let g = await read();
  if (g.unavailable) return null;
  if (g.rec) return { rec: g.rec, mine: false };
  /* Not in the object yet: a record kept before it existed is the first. */
  const old = await fromKv();
  const want = old || entry;
  const c = await counter(env, name, { op: 'revCommit', expect: 0, set: 1, digest: JSON.stringify(want) });
  if (!c || c.unavailable) return null;
  if (c.ok) return { rec: want, mine: !old };
  g = await read();
  return g.rec ? { rec: g.rec, mine: false } : null;
}
async function _recordTxn(env, tx) {
  try {
    const entry = {
      id: tx.id || ('tx_' + Date.now().toString(36) + _randId(10)),
      ts: tx.ts || Date.now(),
      provider: tx.provider || 'unknown',
      email: (tx.email || '').toLowerCase(),
      amount: _moneyRound(tx.amount, tx.currency),
      currency: (tx.currency || 'USD').toUpperCase(),
      kind: tx.kind || '',           // e.g. 'subscription', 'plan', 'marketplace'
      status: tx.status || 'succeeded',
      ref: tx.ref || '',
    };
    /* A caller that supplies its own id is saying this entry IS this event, so
       writing it again is the same write rather than a second one. That is what
       lets a retried sale record its fee without recording it twice - and the
       id has to be supplied, because a generated one is different every time
       and would make every replay look new. */
    /* The same id has to be the same transaction (Nov 7 audit FIN-024): one
       recorded under it before is answered only if it is the same money -
       account, amount, currency, kind, provider. A different payload under a
       reused id is a conflict, told to the owner, and answered as nothing
       recorded, which callers already treat as a failure. */
    /* The same id is the same transaction: account, amount, currency, kind,
       provider - and the provider's own reference (Nov 8 verified audit R08),
       so an id reused for a different invoice is not taken for a replay. */
    const same = (old) => old && old.email === entry.email && +old.amount === entry.amount
      && String(old.currency || 'USD').toUpperCase() === entry.currency && String(old.kind || '') === entry.kind && String(old.provider || 'unknown') === entry.provider
      && String(old.ref || '') === entry.ref;
    const conflict = async (old) => {
      audit(env, 'txn_id_conflict', { id: tx.id, kind: entry.kind });
      try { await alertOnce(env, 'txn_id_conflict', 'A money record was written again under an id it already had, with a different amount, account, currency or provider reference. The new one was refused; the first stands. Look at transaction ' + tx.id + '.', 60); } catch (e) { /* the audit line above is the record */ }
      return null;
    };
    /* THE TRANSACTION ITSELF LIVES IN THE STRONG OBJECT (Nov 8 verified audit
       R09, R16). The first writer of an id commits the whole record there
       before any line is written; every later writer - a retry, a duplicate
       delivery, another region reading KV a moment behind - reads that record
       back and writes the SAME line under the SAME key, at the time the first
       writer chose. So a write that stopped half way is finished by its retry
       rather than doubled, and the id's KV record is written exactly once per
       attempt, never twice inside KV's one-write-a-second limit. A record
       from before this (in KV only) is adopted as the canonical one. */
    let rec = entry;
    if (tx.id) {
      const canon = await _txnCanonical(env, tx.id, entry);
      if (!canon) return null;                        // nothing could be asked: not recorded, the caller retries
      if (!canon.mine) {
        if (!same(canon.rec)) return conflict(canon.rec);
        rec = canon.rec;
      }
    }
    const body = JSON.stringify(rec);
    /* With no strong object, the id's KV record is the only memory of the
       time the first attempt chose, so it goes first, marked pending. */
    if (tx.id && !env.AMV_COUNTER && rec === entry) await env.AMV_KV.put('txn:id:' + tx.id, JSON.stringify(Object.assign({}, entry, { pending: true })));
    await env.AMV_KV.put('txn:e:' + _txnOrder(rec), body, body.length <= 1000 ? { metadata: rec } : undefined);
    if (tx.id) await env.AMV_KV.put('txn:id:' + tx.id, body);
    return rec;
  } catch (e) { return null; }
}

/* Newest first. `txn:log`, the single record from before the move, is still
   read and merged in, and never written again. */
async function _readTxnLog(env, limit = 200) {
  const out = [];
  try {
    let cursor;
    for (let pages = 0; pages < 10 && out.length < limit; pages++) {
      const r = await env.AMV_KV.list({ prefix: TXN_PREFIX, limit: Math.min(1000, limit - out.length), cursor });
      for (const k of (r && r.keys) || []) {
        let e = k.metadata || null;
        if (!e) { try { e = JSON.parse(await env.AMV_KV.get(k.name) || 'null'); } catch (_) { e = null; } }
        if (e) out.push(e);
      }
      if (!r || r.list_complete || !r.cursor) break;
      cursor = r.cursor;
    }
  } catch(e) { /* an unreadable record is treated as absent here, and the caller fails closed on absent */ }
  try {
    const raw = await env.AMV_KV.get('txn:log');
    if (raw) { const have = new Set(out.map((e) => e.id)); for (const e of JSON.parse(raw) || []) if (e && !have.has(e.id)) out.push(e); }
  } catch(e) { /* an unreadable record is treated as absent here, and the caller fails closed on absent */ }
  out.sort((x, y) => (y.ts || 0) - (x.ts || 0));
  return out.slice(0, limit);
}

/* ---- ADMIN: financial statement - ALL real transactions across every customer.
   Owner-only (admin token). Pulls actual charges from Stripe so you see real
   money in, refunds, and net - not estimates. Honestly returns empty + a
   configured:false flag when Stripe isn't set up yet. ---- */
/* MONEY IN ITS OWN UNITS (Nov 7 audit FIN-022, FIN-023). Stripe sends an
   amount in the currency's smallest unit, and not every currency has
   cents: a yen charge of 1000 is 1000 yen, not 10, and a dinar has three
   decimals. And totals summed every currency into one number labelled with
   whichever came last - a euro and a dollar are not two of anything. */
const ZERO_DECIMAL = new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF']);
const THREE_DECIMAL = new Set(['BHD','JOD','KWD','OMR','TND']);
function _minorDigits(cur){ const c = String(cur || 'USD').toUpperCase(); return ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2; }
function _fromMinor(n, cur){ const d = _minorDigits(cur); return +((+n || 0) / Math.pow(10, d)).toFixed(d); }
function _moneyRound(n, cur){ const d = _minorDigits(cur); return +(+n || 0).toFixed(d); }
/* Totals per currency, never across them. `totals` stays the figure for the
   main currency and says when there are
   others, so a screen reading only it is told it is not the whole story.
   The main currency is the one most transactions are in. */
function _totalsByCurrency(rows, paidOf){
  const by = {};
  for (const t of rows) {
    const cur = String(t.currency || 'USD').toUpperCase();
    const b = by[cur] = by[cur] || { count: 0, gross: 0, refunded: 0 };
    b.count++;
    if (paidOf(t)) b.gross += +t.amount || 0;
    b.refunded += +t.refunded || 0;
  }
  for (const [cur, b] of Object.entries(by)) { b.gross = _moneyRound(b.gross, cur); b.refunded = _moneyRound(b.refunded, cur); b.net = _moneyRound(b.gross - b.refunded, cur); }
  /* By how many transactions, not by amount: amounts in different currencies
     do not compare either (1000 yen is not more than 20 dollars). */
  const main = Object.keys(by).sort((a, b) => (by[b].count - by[a].count) || ((b === 'USD') - (a === 'USD')))[0] || 'USD';
  const m = by[main] || { count: 0, gross: 0, refunded: 0, net: 0 };
  const others = Object.keys(by).filter(c => c !== main);
  return { totals: { count: rows.length, gross: m.gross, refunded: m.refunded, net: m.net, currency: main,
                     ...(others.length ? { otherCurrencies: others } : {}), scope: 'page' }, byCurrency: by };
}
async function adminFinance(request, env) {
  /* AMV-052: through the SAME gate as every other admin route. This was a bare
     token comparison with no rate limit, so three of the sixteen admin routes
     were an unbounded channel for guessing the token while the other thirteen
     were not - and an attacker only has to find the unbounded one. */
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }

  // Non-Stripe payments (PayPal, marketplace/wallet) come from our own ledger.
  /* Read one past the cap, so a ledger longer than the page says so
     (Nov 8 audit FIN-021): the totals already say they cover the page. */
  const ledgerAll = await _readTxnLog(env, 301);
  const ledgerMore = ledgerAll.length > 300;
  const ledger = ledgerAll.slice(0, 300);
  /* A line recorded twice under one id - left by the code before the
     transaction's record lived in the strong object (Nov 8 verified audit
     R09) - is shown once and named, so it is counted once and looked at. */
  const seenTx = new Set(), duplicateIds = [];
  const ledgerTx = ledger.filter(t => { if (!t || !t.id) return true; if (seenTx.has(t.id)) { if (duplicateIds.length < 50 && !duplicateIds.includes(t.id)) duplicateIds.push(t.id); return false; } seenTx.add(t.id); return true; }).map(t => ({
    id: t.id, date: t.ts, email: t.email || '-', amount: t.amount, refunded: t.status === 'refunded' ? t.amount : 0,
    currency: t.currency, status: t.status, description: t.kind || '', provider: t.provider, last4: null, receipt: null,
  }));
  if (duplicateIds.length) audit(env, 'ledger_duplicate_lines', { n: duplicateIds.length });

  if (!env.STRIPE_SECRET_KEY) {
    // No Stripe, but we may still have PayPal / marketplace transactions.
    const sum = _totalsByCurrency(ledgerTx, (t) => t.status === 'succeeded');
    return json({ ok: true, configured: ledgerTx.length > 0, transactions: ledgerTx, hasMore: ledgerMore, duplicateIds,
      totals: sum.totals, byCurrency: sum.byCurrency,
      note: ledgerTx.length ? 'Stripe not connected - showing PayPal & marketplace transactions.' : 'Connect Stripe (STRIPE_SECRET_KEY) to see card transactions.' });
  }
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));
  const after = url.searchParams.get('after') || '';
  let q = `https://api.stripe.com/v1/charges?limit=${limit}`;
  if (after) q += `&starting_after=${encodeURIComponent(after)}`;
  const r = await fetchDeadline(q, { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    await alertOnce(env, 'admin_finance_fail', `Admin finance: Stripe charges fetch failed (${d.error?.message || r.status}).`, 30);
    return json({ error: d.error?.message || 'stripe error' }, 502);
  }
  const stripeTx = (d.data || []).map(c => ({
    id: c.id,
    date: (c.created || 0) * 1000,
    email: c.billing_details?.email || c.receipt_email || (c.metadata && c.metadata.email) || '-',
    amount: _fromMinor(c.amount, c.currency),
    refunded: _fromMinor(c.amount_refunded, c.currency),
    currency: (c.currency || 'usd').toUpperCase(),
    status: c.refunded ? 'refunded' : (c.disputed ? 'disputed' : c.status),
    // was this a real captured payment? (true even if later refunded - gross = money that came in)
    _paid: !!(c.paid && (c.status === 'succeeded' || c.captured)),
    description: c.description || (c.metadata && c.metadata.plan) || '',
    provider: 'stripe',
    last4: c.payment_method_details?.card?.last4 || null,
    receipt: c.receipt_url || null,
  }));

  // Merge Stripe (live) + ledger. The live Stripe pull is the source of truth
  // for card payments, so from the ledger we take only NON-Stripe entries
  // (PayPal, marketplace) to avoid double-counting recurring charges that the
  // webhook also logged.
  const ledgerNonStripe = ledgerTx.filter(t => t.provider !== 'stripe');
  const transactions = [...stripeTx, ...ledgerNonStripe].sort((a, b) => b.date - a.date);
  // gross = all money that came in (paid), refunds tracked separately as net.
  const sum = _totalsByCurrency(transactions, (t) => t._paid != null ? t._paid : (t.status === 'succeeded' || t.status === 'paid' || t.status === 'refunded'));
  for (const t of transactions) delete t._paid;
  return json({
    ok: true, configured: true,
    transactions,
    hasMore: !!d.has_more || ledgerMore, duplicateIds,
    nextCursor: stripeTx.length ? stripeTx[stripeTx.length - 1].id : null,
    totals: sum.totals, byCurrency: sum.byCurrency,
  });
}

async function stripeInvoices(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  /* AMV-184: it was exempt from the bound because it creates no session and
     reads only the caller's own invoices. Both true, and neither is the
     argument. Every call spends a slot of AMV's Stripe rate limit, and the
     people who lose when that runs out are everybody else trying to check out.
     Reading your own billing history a hundred times a day is generous; the
     hundred-and-first is somebody testing what happens. */
  const ib = await guardAction(env, `stripeinv:${user.email}`, 10, 100, 'billing history requests');
  if (ib) return ib;
  if (!env.STRIPE_SECRET_KEY) return json({ ok: true, invoices: [] });
  const custId = await env.AMV_KV.get(`stripecust:${user.email}`);
  if (!custId) return json({ ok: true, invoices: [] });
  const r = await fetchDeadline(`https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(custId)}&limit=24`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const d = await r.json();
  if (!r.ok) return json({ error: d.error?.message || 'stripe error' }, 502);
  const invoices = (d.data || []).map(inv => ({
    id: inv.id,
    number: inv.number || inv.id,
    date: inv.created * 1000,
    amount: _fromMinor(inv.amount_paid != null ? inv.amount_paid : inv.total, inv.currency),
    currency: (inv.currency || 'usd').toUpperCase(),
    status: inv.status,
    pdf: inv.invoice_pdf || inv.hosted_invoice_url || null,
  }));
  return json({ ok: true, invoices });
}
/* ── Atomic exactly-once guard ─────────────────────────────────────────────
   Money must never be credited, captured or withdrawn twice. Payment providers
   retry webhooks, and concurrent/duplicate deliveries can race. _claimOnce
   returns true ONLY for the first caller for a given (kind,id); every duplicate
   or concurrent caller gets false. On D1 this is a hard atomic guarantee - the
   PRIMARY KEY (kind,id) makes the second INSERT fail. On KV it is best-effort
   (KV is eventually consistent - enable D1 for the money paths, see DEPLOY.md).
   ttlSec is the claim's LIFETIME and every caller states it - see below. */

/* HOW LONG "EXACTLY ONCE" LASTS, AND WHY IT IS NOT THIRTY SECONDS.

   This function does two different jobs. Most callers want a MUTEX: hold it
   while a withdrawal is processed, release it after. Those pass a small number
   of seconds and are correct. Five callers wanted the other thing - a claim
   that says this event has been handled, FOR EVER - and none of them passed
   anything, so they got the default, which was thirty seconds.

   What that meant:

     stripeevt / paypalevt  the webhook replay guard. Both providers deliver
                            AT LEAST once and say so. A duplicate arriving
                            thirty-one seconds later was processed as new: the
                            seller credited twice for one sale, the platform
                            fee recorded twice, a renewal payment booked twice.
     sale                   the same, one layer in.
     vidrefund              a failed video refunds the quota "EXACTLY ONCE",
                            says the comment. Polling the job's status once a
                            minute refunded it once a minute.
     inviteused             "this invite has already been used" was true for
                            thirty seconds and then stopped being true.

   Nothing caught it because THE TWO BACKENDS DISAGREED. The KV path put the
   key with no expiry at all when ttlSec was absent - permanent, correct - and
   the Durable Object path, which is the one that actually runs in production
   and the one chosen precisely because it is atomic enough for money, turned
   the same absent argument into a thirty-second lease. The safer storage had
   the weaker guarantee, and the difference lived in one `|| 30`.

   So the default is now permanent-ish rather than momentary, because the two
   ways of being wrong are not equal. A claim held too long refuses a retry
   that should have run, and somebody notices and complains. A claim released
   too early pays twice, and nobody notices at all. Every call site still
   states its own lifetime - a test asserts that - so the default is a
   backstop, not an invitation to leave it out. */
const CLAIM_ONCE_TTL_S = 400 * 86400;

/* AMV-013: the token for each lock this isolate currently holds.

   An isolate handles one request at a time for a given lock - it takes it,
   works, releases - so a map keyed by lock name is exactly right, and it keeps
   the token off every call signature. Seventeen claim sites and fourteen
   release sites would otherwise each have to thread it through, and the one
   that forgot would be the one that deletes somebody else's lock.

   Bounded: an entry is removed the moment its lock is released, and a lock
   whose release never runs is one whose isolate is gone with the map. */
/* Nov 8 verified audit R02: ONE NAME PER ISOLATE WAS NOT ENOUGH. A lease that
   expired and was taken again in the same isolate overwrote the first
   holder's token, and the first holder's release - naming no owner - then
   freed the SECOND holder's lock. Owners are now kept per request (the
   request's own async context, and the environment it was given), oldest
   first: a release that names no owner gives back the oldest claim this
   request took on that name, which the object refuses when that lease has
   already passed to somebody else. A release from a request that never took
   the name (a claim taken in one request and given back by another) names
   no owner, as before. */
const _CLAIM_SCOPES = new WeakMap();
const _CLAIM_NOCTX = {};
function _claimOwners(env){
  let c = null; try { c = _ctxStore ? _ctxStore.getStore() : null; } catch (e) { c = null; }
  const top = (c && typeof c === 'object') ? c : _CLAIM_NOCTX;
  let byEnv = _CLAIM_SCOPES.get(top); if(!byEnv){ byEnv = new WeakMap(); _CLAIM_SCOPES.set(top, byEnv); }
  const ek = (env && typeof env === 'object') ? env : _CLAIM_NOCTX;
  let m = byEnv.get(ek); if(!m){ m = new Map(); byEnv.set(ek, m); }
  return m;
}

async function _claimOnce(env, kind, id, ttlSec){
  return (await _claimOnceDetail(env, kind, id, ttlSec)).claimed;
}
/* The same claim, saying WHY it was not taken: `unavailable` when nothing
   could be asked, as opposed to somebody having taken it already. Every
   caller that only needs yes/no keeps _claimOnce; a caller that treats "taken"
   as an accusation - refresh-token reuse revokes the whole account - must not
   make that accusation over a store that did not answer. */
async function _claimOnceDetail(env, kind, id, ttlSec){
  if(!id) return { claimed: true };
  /* Prefer the Durable Object: it serializes ops, so the check and the claim
     cannot interleave. This matters most for money - two simultaneous
     withdrawals must not both pass. D1 is next (PRIMARY KEY is atomic). The
     KV path is last and is best-effort ONLY, because get-then-put races. */
  if(env && env.AMV_COUNTER){
    try{
      const r = await counter(env, 'claim:' + kind + ':' + id, { op:'claim', ttlMs:(ttlSec||CLAIM_ONCE_TTL_S)*1000 });
      /* AMV-032: a bound Durable Object that could not answer is a fault, not a
         reason to take the lock through a path that cannot hold it. Refusing
         means the caller retries or reports busy; falling through would mean
         two holders. */
      if(r && r.unavailable) return { claimed: false, unavailable: true };
      if(r && typeof r.claimed === 'boolean'){
        /* AMV-013: remember WHICH claim this is, so the matching release can
           prove it is giving back the lock it took rather than whatever lock
           happens to be there when it gets around to it. Kept beside the
           request rather than returned, so all seventeen call sites keep their
           boolean and none of them can forget to carry it. */
        if(r.claimed){
          const mk = kind + ':' + id, owners = _claimOwners(env);
          const list = owners.get(mk) || []; list.push(r.owner || ''); owners.set(mk, list);
        }
        /* Also handed back (Nov 7 audit LOCK-002): the map holds one owner
           per name, so a lease that expired and was retaken in the same
           isolate overwrote it, and the first holder's release then freed
           the second's lock. A caller that keeps its own owner releases
           with that, whatever the map says now. */
        return { claimed: r.claimed, owner: r.claimed ? (r.owner || '') : '' };
      }
    }catch(e){ /* answered below: the object is bound, so nothing else may decide */ }
    /* Bound but no usable answer - a malformed reply, a throw (Nov 8 verified
       audit R01). Never D1 or KV: a lock the strong object could not grant is
       not granted. */
    return { claimed: false, unavailable: true };
  }
  if(DB._hasD1(env)){
    try{
      await env.DB.prepare('INSERT INTO kv (kind,id,json,updated_at) VALUES (?,?,?,?)')
        .bind(kind, String(id), '1', Date.now()).run();
      return { claimed: true };
    }catch(e){
      /* A PRIMARY KEY violation is "already claimed". Anything else is the
         database not answering, which is not the same fact. */
      return /UNIQUE|PRIMARY|constraint/i.test(String((e && e.message) || e))
        ? { claimed: false } : { claimed: false, unavailable: true };
    }
  }
  const k = `${kind}:${id}`;
  if(await env.AMV_KV.get(k)) return { claimed: false };
  await env.AMV_KV.put(k, '1', ttlSec ? { expirationTtl: ttlSec } : undefined);
  return { claimed: true };
}
/* A CLAIM TAKEN BEFORE THE WORK MUST BE GIVEN BACK IF THE WORK DID NOT HAPPEN.

   Making the exactly-once claims permanent closed the hole where a duplicate
   webhook paid a seller twice. It opened the opposite one, which is worse:
   the claim is taken FIRST, and if the credit then failed halfway - storage
   refusing, the wallet lock unavailable - the retry would find the claim held
   and return immediately. Not "paid twice" but "never paid", for ever, with
   the buyer already holding the item. The thirty-second expiry had been
   covering for that by accident, which is not a design.

   The webhook handler one level up already does exactly this: it releases the
   event claim in its catch so the provider's retry can reprocess a genuinely
   failed event. This is that, made reusable, so the two places do not have to
   agree by memory.

   Rethrows deliberately. A caller that swallowed the error here would report
   success for work that did not happen, and the retry it just re-enabled would
   never be asked for. */
async function _onceOrRetry(env, kind, id, ttlSec, work){
  if(!(await _claimOnce(env, kind, id, ttlSec))) return { claimed: false };
  try{
    const value = await work();
    return { claimed: true, value };
  }catch(e){
    try{ await _releaseClaim(env, kind, id); }catch(_){ /* a lock that expires on its own if this fails */ }
    audit(env, 'claim_released_after_failure', { kind, id: String(id).slice(0, 120),
                                                 error: String((e && e.message) || e).slice(0, 160) });
    throw e;
  }
}

async function _releaseClaim(env, kind, id, ownerIn){
  try{
    // release wherever it was claimed - the DO first, mirroring _claimOnce
    if(env && env.AMV_COUNTER){
      const mapKey = kind + ':' + id;
      const owners = _claimOwners(env), list = owners.get(mapKey) || [];
      let owner;
      if(ownerIn != null){ owner = String(ownerIn); const at = list.indexOf(owner); if(at >= 0) list.splice(at, 1); }
      else owner = list.length ? list.shift() : '';
      if(list.length) owners.set(mapKey, list); else owners.delete(mapKey);
      try{
        const r = await counter(env, 'claim:' + kind + ':' + id, { op:'release', owner });
        /* Refused means this holder's lease had already expired and somebody
           else has the lock - so the work just finished ran outside it. That is
           a real condition to know about: it is how two writers end up believing
           they are alone, and it shows up under load rather than under attack. */
        if(r && r.released === false && r.reason === 'not_owner'){
          audit(env, 'lock_lease_expired', { kind, id: String(id).slice(0, 120) });
          try{ await alertOnce(env, 'lock_lease_expired:' + kind,
            'A lock on ' + kind + ' expired while the work it was protecting was still running, so another '
            + 'writer took it. Two writers were briefly inside the same critical section. If this recurs, the '
            + 'lease is too short for what it is guarding.', 60); }catch(_){ /* logging: it never decides anything */ }
        }
      }catch(e) { /* a lock that expires on its own if this fails */ }
    }
    if(DB._hasD1(env)){
      await env.DB.prepare('DELETE FROM kv WHERE kind=? AND id=?').bind(kind, String(id)).run();
    } else { await env.AMV_KV.delete(`${kind}:${id}`); }
  }catch(e) { /* a lock that expires on its own if this fails */ }
}

