/* ══════════════════════════════════════════════════════════════════════════
   PREDICTION MARKETS - READING THEM, AND PLACING A TRADE ON ONE.

   This moves real money on a regulated venue, so the design is mostly about
   what AMV is NOT allowed to do.

   THE MODEL CANNOT TRADE. That is the whole architecture and everything else
   follows from it. A trade is two requests: one that QUOTES it and one that
   EXECUTES a quote by its id. The quote is stored server-side with the exact
   market, side, size and cost, it expires in a minute, and it can be spent
   once. So the model's reach ends at proposing terms a person has not seen
   yet, and the only thing that can turn a proposal into a position is a human
   pressing a button next to the exact numbers.

   A confirmation dialog in the browser would NOT have achieved this. The
   model drives the browser; anything the browser can do unaided, the model
   can do unaided. The approval has to be something the server requires and
   the client cannot mint, which is why it is a stored ticket rather than a
   flag on the request.

   JURISDICTION IS NOT A DISCLAIMER. Where somebody is decides which venue may
   legally serve them at all, and getting this wrong is not a bug report, it is
   an enforcement action. The country comes from the edge, not from the client,
   because a value the browser supplies is a value the browser chooses.

   AND THE CAPS ARE HARD. Per trade, per day, checked on the server before the
   quote is even issued. A model that misreads a market can be wrong; it must
   not be able to be wrong for more than a stated number of dollars.
   ══════════════════════════════════════════════════════════════════════════ */

const PREDICT_VENUES = {
  /* CFTC-regulated, US persons permitted. Its own eligibility rules still
     apply on their side; this is about which venue AMV may even offer. */
  kalshi:     { name: 'Kalshi', allow: 'US_ONLY',
                api: 'https://api.elections.kalshi.com/trade-api/v2',
                keyEnv: 'KALSHI_API_KEY' },
  /* Blocks US persons on its main venue. Offering it to somebody in the
     United States would be inviting them to break its terms and possibly the
     law, on AMV's suggestion. */
  polymarket: { name: 'Polymarket', allow: 'NON_US',
                api: 'https://clob.polymarket.com',
                keyEnv: 'POLYMARKET_API_KEY' },
};

const PREDICT_MAX_TRADE_USD = 100;      // one trade
const PREDICT_MAX_DAY_USD   = 250;      // all trades in a day
const PREDICT_QUOTE_TTL_MS  = 60 * 1000;

/* Which venues may be offered to somebody in this country. The answer for the
   United States and the answer for everywhere else are different venues, not
   the same venue with a warning. */
function _predictVenuesFor(country) {
  const us = String(country || '').toUpperCase() === 'US';
  return Object.keys(PREDICT_VENUES).filter((k) => {
    const v = PREDICT_VENUES[k];
    return v.allow === 'US_ONLY' ? us : !us;
  });
}

/* NOT ARMED BY A KEY, BECAUSE THE KEY WOULD BE THE OWNER'S (LESSONS 554).

   The venue key is one secret for the whole deployment, so a trade any person
   approved would be placed from the operator's own venue account and paid for
   from the operator's balance - and the order itself is not yet in either
   venue's signed format (Kalshi signs each request with the account's private
   key; Polymarket takes an order signed by the trader's wallet). Trading is
   held off until each person connects their OWN account, whatever is set here:
   a pasted key must not be able to switch on spending somebody else's money. */
let PREDICT_TRADING_LIVE = false;
function _predictConfigured(env, venue) {
  const v = PREDICT_VENUES[venue];
  return PREDICT_TRADING_LIVE && !!(v && _has(env, v.keyEnv));
}

/* Everything a trade has to clear before a quote is even issued. Returned as a
   refusal or null, so no caller can forget half of it. */
async function _predictGate(request, env, user) {
  const held = await _accountHold(env, user, 'predict');
  if (held) return held;
  /* Money means adult, and this is the same gate the subscription checkout
     uses rather than a second opinion about the same question. */
  const ageBad = await _moneyAgeGate(env, user.email);
  if (ageBad) return json(ageBad, ageBad.code === 'age_required' ? 428 : 403);
  return null;
}

async function predictMarkets(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first', code: 'needs_auth' }, 401);
  const country = (request.cf && request.cf.country) || '';
  const allowed = _predictVenuesFor(country);
  const venues = allowed.map((k) => ({
    id: k, name: PREDICT_VENUES[k].name, ready: _predictConfigured(env, k),
  }));
  /* Said plainly rather than by an empty list. "Nothing here" reads as broken;
     "not available where you are" is the truth and is actionable. */
  return json({
    ok: true, country, venues,
    caps: { perTrade: PREDICT_MAX_TRADE_USD, perDay: PREDICT_MAX_DAY_USD },
    note: venues.length
      ? ''
      : 'Prediction markets are not available in your country, so AMV does not offer them here.',
  });
}

async function predictQuote(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first', code: 'needs_auth' }, 401);
  const blocked = await guardAction(env, 'pquote:' + user.email, 30, 300, 'trade quotes');
  if (blocked) return blocked;
  const gate = await _predictGate(request, env, user);
  if (gate) return gate;

  const body = await request.json().catch(() => ({}));
  const venue = String(body.venue || '');
  const market = String(body.market || '').slice(0, 120);
  const side = String(body.side || '').toLowerCase();
  const usd = Math.round(Number(body.usd) * 100) / 100;

  if (!PREDICT_VENUES[venue]) return json({ error: 'Unknown venue.', code: 'bad_venue' }, 400);
  const country = (request.cf && request.cf.country) || '';
  if (_predictVenuesFor(country).indexOf(venue) < 0) {
    audit(env, 'predict_venue_refused', { by: user.email, venue, country });
    return json({ error: PREDICT_VENUES[venue].name + ' is not available in your country, so AMV will not place a trade on it.',
                  code: 'venue_blocked' }, 403);
  }
  if (!_predictConfigured(env, venue)) {
    return json({ error: PREDICT_VENUES[venue].name + ' is not connected on this deployment, so no trade can be placed. Nothing was attempted.',
                  code: 'needs_service' }, 503);
  }
  if (!market) return json({ error: 'Which market?', code: 'bad_request' }, 400);
  if (side !== 'yes' && side !== 'no') return json({ error: 'A trade is yes or no.', code: 'bad_request' }, 400);
  if (!Number.isFinite(usd) || usd <= 0) return json({ error: 'How much?', code: 'bad_request' }, 400);
  if (usd > PREDICT_MAX_TRADE_USD) {
    return json({ error: 'AMV places at most $' + PREDICT_MAX_TRADE_USD + ' on one trade. That is a hard limit, not a setting.',
                  code: 'over_trade_cap' }, 400);
  }

  /* The daily cap is counted atomically and BEFORE the quote exists, so two
     quotes issued in the same second cannot both fit under it. */
  const spent = (await counter(env, `pspend:${user.email}:${todayKey()}`, { op: 'get' })).value || 0;
  if (spent + usd > PREDICT_MAX_DAY_USD) {
    return json({ error: 'That would take today past the $' + PREDICT_MAX_DAY_USD + ' daily limit AMV will place. It resets tomorrow.',
                  code: 'over_day_cap', spent }, 429);
  }

  const id = 'q_' + crypto.randomUUID().replace(/-/g, '');
  const quote = { id, venue, market, side, usd, by: user.email, at: Date.now(), country };
  /* Stored server-side with a short life. A ticket the client could mint would
     be no approval at all - the point is that the browser holds a REFERENCE to
     terms it cannot alter. */
  await env.AMV_KV.put('pquote:' + id, JSON.stringify(quote), { expirationTtl: 300 });
  audit(env, 'predict_quote', { by: user.email, venue, market, side, usd });
  return json({ ok: true, quote: { id, venue, venueName: PREDICT_VENUES[venue].name, market, side, usd,
                                   expiresAt: Date.now() + PREDICT_QUOTE_TTL_MS } });
}

async function predictTrade(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first', code: 'needs_auth' }, 401);
  const blocked = await guardAction(env, 'ptrade:' + user.email, 20, 300, 'trades');
  if (blocked) return blocked;
  const gate = await _predictGate(request, env, user);
  if (gate) return gate;

  const body = await request.json().catch(() => ({}));
  const id = String(body.quoteId || '');
  /* NOTHING ABOUT THE TRADE IS READ FROM THIS REQUEST. Market, side and size
     come only from the stored quote, so a client that alters them after the
     person approved is altering a copy nobody acts on. */
  if (!/^q_[0-9a-f]{32}$/.test(id)) return json({ error: 'Approve the trade first.', code: 'needs_quote' }, 400);

  const raw = await env.AMV_KV.get('pquote:' + id);
  if (!raw) return json({ error: 'That approval has expired. Quote the trade again and confirm the numbers.', code: 'quote_expired' }, 409);
  let q = null; try { q = JSON.parse(raw); } catch (e) { q = null; }
  if (!q) return json({ error: 'That approval could not be read.', code: 'quote_expired' }, 409);

  /* SPENT ONCE. Deleted before the trade is placed, not after: a retry that
     races the first attempt must not be able to place the same trade twice,
     and losing a trade to a delete that succeeded is recoverable in a way that
     a double position is not. */
  await env.AMV_KV.delete('pquote:' + id);

  if (q.by !== user.email) {
    audit(env, 'predict_quote_stolen', { by: user.email, owner: q.by, quote: id });
    return json({ error: 'That approval belongs to another account.', code: 'forbidden' }, 403);
  }
  if (Date.now() - (+q.at || 0) > PREDICT_QUOTE_TTL_MS) {
    return json({ error: 'That approval has expired. Quote the trade again and confirm the numbers.', code: 'quote_expired' }, 409);
  }
  /* Re-checked at EXECUTION, not only at quote time. Somebody can move country
     between the two requests, and the venue rule is about where they are when
     the trade is placed. */
  const country = (request.cf && request.cf.country) || '';
  if (_predictVenuesFor(country).indexOf(q.venue) < 0) {
    audit(env, 'predict_venue_refused', { by: user.email, venue: q.venue, country, at: 'execute' });
    return json({ error: PREDICT_VENUES[q.venue].name + ' is not available in your country, so AMV will not place a trade on it.',
                  code: 'venue_blocked' }, 403);
  }
  if (!_predictConfigured(env, q.venue)) {
    return json({ error: PREDICT_VENUES[q.venue].name + ' is not connected on this deployment, so no trade was placed.',
                  code: 'needs_service' }, 503);
  }

  /* Reserved before the venue is called. A trade that is placed and then found
     to be over the cap is a trade that was over the cap. */
  const res = await counter(env, `pspend:${user.email}:${todayKey()}`,
                            { op: 'reserve', amount: Math.round(q.usd * 100), cap: PREDICT_MAX_DAY_USD * 100, ttlMs: 86400000 * 2 });
  if (!res.allowed) {
    return json({ error: 'That would take today past the $' + PREDICT_MAX_DAY_USD + ' daily limit AMV will place.',
                  code: 'over_day_cap' }, 429);
  }

  const v = PREDICT_VENUES[q.venue];
  let placed = null;
  try {
    const r = await fetchDeadline(v.api + '/orders', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + String(env[v.keyEnv] || ''), 'Content-Type': 'application/json' },
      body: JSON.stringify({ market: q.market, side: q.side, notional_usd: q.usd }),
    }, 15000);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      /* Give the money back: nothing was placed, so nothing should be counted
         against the day. */
      await counter(env, `pspend:${user.email}:${todayKey()}`, { op: 'incr', amount: -Math.round(q.usd * 100), ttlMs: 86400000 * 2 });
      audit(env, 'predict_trade_refused', { by: user.email, venue: q.venue, status: r.status });
      return json({ error: (d && d.error) || (v.name + ' refused the trade. Nothing was placed.'), code: 'venue_error' }, 502);
    }
    placed = d;
  } catch (e) {
    await counter(env, `pspend:${user.email}:${todayKey()}`, { op: 'incr', amount: -Math.round(q.usd * 100), ttlMs: 86400000 * 2 });
    /* UNKNOWN IS NOT THE SAME AS FAILED, and saying "nothing was placed" here
       would be a guess about somebody's money. The request may have arrived. */
    audit(env, 'predict_trade_unknown', { by: user.email, venue: q.venue, error: String((e && e.message) || e) });
    return json({ error: v.name + ' did not answer in time, so AMV cannot tell whether the trade was placed. Check your positions there before trying again.',
                  code: 'venue_timeout' }, 504);
  }

  audit(env, 'predict_trade', { by: user.email, venue: q.venue, market: q.market, side: q.side, usd: q.usd });
  await _userEvent(env, request, user.email, 'trade_placed', { venue: v.name, market: q.market, side: q.side, usd: q.usd });
  return json({ ok: true, placed: { venue: v.name, market: q.market, side: q.side, usd: q.usd,
                                    ref: (placed && (placed.order_id || placed.id)) || '' } });
}

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
  if(env && env.DB && typeof env.DB.prepare === 'function'){
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
    if(env && env.DB && typeof env.DB.prepare === 'function'){
      await env.DB.prepare('DELETE FROM kv WHERE kind=? AND id=?').bind(kind, String(id)).run();
    } else { await env.AMV_KV.delete(`${kind}:${id}`); }
  }catch(e){}
}

