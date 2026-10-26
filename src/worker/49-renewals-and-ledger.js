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
  try { body = await request.json(); } catch (e) {}
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
async function _recordTxn(env, tx) {
  try {
    const entry = {
      id: tx.id || ('tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      ts: tx.ts || Date.now(),
      provider: tx.provider || 'unknown',
      email: (tx.email || '').toLowerCase(),
      amount: +(+tx.amount || 0).toFixed(2),
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
    if (tx.id) {
      const seen = await env.AMV_KV.get('txn:id:' + tx.id);
      if (seen) { try { return JSON.parse(seen); } catch (e) {} }
      const legacy = await env.AMV_KV.get('txn:log');
      if (legacy) { const old = (JSON.parse(legacy) || []).find((e) => e && e.id === tx.id); if (old) return old; }
    }
    /* ONE KEY PER TRANSACTION. This used to be one record, read, prepended to
       and written back - so two sales in the same moment each read the list
       without the other and the second write erased the first, and the
       thousand-entry cap would have held minutes of history at any volume.
       Each entry now has its own key, named so the newest sorts first, and
       carries itself as the key's metadata so the statement can list them
       without reading each one. */
    const body = JSON.stringify(entry);
    await env.AMV_KV.put('txn:e:' + _txnOrder(entry), body, body.length <= 1000 ? { metadata: entry } : undefined);
    if (tx.id) await env.AMV_KV.put('txn:id:' + tx.id, body);
    return entry;
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
  } catch (e) {}
  try {
    const raw = await env.AMV_KV.get('txn:log');
    if (raw) { const have = new Set(out.map((e) => e.id)); for (const e of JSON.parse(raw) || []) if (e && !have.has(e.id)) out.push(e); }
  } catch (e) {}
  out.sort((x, y) => (y.ts || 0) - (x.ts || 0));
  return out.slice(0, limit);
}

/* ---- ADMIN: financial statement - ALL real transactions across every customer.
   Owner-only (admin token). Pulls actual charges from Stripe so you see real
   money in, refunds, and net - not estimates. Honestly returns empty + a
   configured:false flag when Stripe isn't set up yet. ---- */
async function adminFinance(request, env) {
  /* AMV-052: through the SAME gate as every other admin route. This was a bare
     token comparison with no rate limit, so three of the sixteen admin routes
     were an unbounded channel for guessing the token while the other thirteen
     were not - and an attacker only has to find the unbounded one. */
  { const g = await _adminGate(request, env, 'read', 60, 2000); if (g) return g; }

  // Non-Stripe payments (PayPal, marketplace/wallet) come from our own ledger.
  const ledger = await _readTxnLog(env, 300);
  const ledgerTx = ledger.map(t => ({
    id: t.id, date: t.ts, email: t.email || '-', amount: t.amount, refunded: t.status === 'refunded' ? t.amount : 0,
    currency: t.currency, status: t.status, description: t.kind || '', provider: t.provider, last4: null, receipt: null,
  }));

  if (!env.STRIPE_SECRET_KEY) {
    // No Stripe, but we may still have PayPal / marketplace transactions.
    let gross = 0, refunded = 0;
    for (const t of ledgerTx) { if (t.status === 'succeeded') gross += t.amount; refunded += t.refunded; }
    return json({ ok: true, configured: ledgerTx.length > 0, transactions: ledgerTx,
      totals: { count: ledgerTx.length, gross: +gross.toFixed(2), refunded: +refunded.toFixed(2), net: +(gross - refunded).toFixed(2), currency: 'USD' },
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
    amount: (c.amount || 0) / 100,
    refunded: (c.amount_refunded || 0) / 100,
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
  let gross = 0, refunded = 0, currency = 'USD';
  for (const t of transactions) {
    // gross = all money that came in (paid), refunds tracked separately as net.
    const camePaid = t._paid != null ? t._paid : (t.status === 'succeeded' || t.status === 'paid' || t.status === 'refunded');
    if (camePaid) gross += t.amount;
    refunded += t.refunded;
    currency = t.currency || currency;
    delete t._paid;
  }
  const net = +(gross - refunded).toFixed(2);
  return json({
    ok: true, configured: true,
    transactions,
    hasMore: !!d.has_more,
    nextCursor: stripeTx.length ? stripeTx[stripeTx.length - 1].id : null,
    totals: { count: transactions.length, gross: +gross.toFixed(2), refunded: +refunded.toFixed(2), net, currency },
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
    amount: (inv.amount_paid != null ? inv.amount_paid : inv.total) / 100,
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
const _CLAIM_OWNERS = new Map();

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
        if(r.claimed && r.owner) _CLAIM_OWNERS.set(kind + ':' + id, r.owner);
        return { claimed: r.claimed };
      }
    }catch(e){ /* fall through to the next strategy */ }
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
    try{ await _releaseClaim(env, kind, id); }catch(_){}
    audit(env, 'claim_released_after_failure', { kind, id: String(id).slice(0, 120),
                                                 error: String((e && e.message) || e).slice(0, 160) });
    throw e;
  }
}

async function _releaseClaim(env, kind, id){
  try{
    // release wherever it was claimed - the DO first, mirroring _claimOnce
    if(env && env.AMV_COUNTER){
      const mapKey = kind + ':' + id;
      const owner = _CLAIM_OWNERS.get(mapKey) || '';
      _CLAIM_OWNERS.delete(mapKey);
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
            + 'lease is too short for what it is guarding.', 60); }catch(_){}
        }
      }catch(e){}
    }
    if(DB._hasD1(env)){
      await env.DB.prepare('DELETE FROM kv WHERE kind=? AND id=?').bind(kind, String(id)).run();
    } else { await env.AMV_KV.delete(`${kind}:${id}`); }
  }catch(e){}
}

