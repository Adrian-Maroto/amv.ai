/* ══════════════════════════════════════════════════════════════════════════
   BUYING, PHASE 1 (Nov 16, the owner's decision; design in docs/BUYING.md).

   AMV shops in AMV's browser on the person's own computer, where they are
   signed in to the store, and the store charges the payment method they saved
   there. AMV never holds a card. What the SERVER holds is the money side of
   the person's own limits:

     POST /v1/spend/hold     { amount, currency, store, item }  before the click
     POST /v1/spend/settle   { hold, total, order }             after the store confirms
     POST /v1/spend/release  { hold }                           when it did not happen
     GET  /v1/spend/buys                                        the receipts

   A hold books the amount atomically against the month (_spendReserve, the
   same booking every purchase AMV makes goes through), so two purchases at
   once cannot both fit under a cap that only has room for one. Spending must
   be switched on, the amount within the per-purchase limit and what is left
   this month - all read from the account, never from the page.

   The limits are numbers in ONE currency (`currency` on the limits, US
   dollars unless the person chose another). There is no exchange rate here
   that AMV could stand behind, so a purchase in another currency is refused
   with the reason, never converted with a guess. */
const BUY_HOLD_WINDOW_MS = 30 * 60 * 1000;     // a hold not settled in this long is released
const BUY_SETTLE_WINDOW_MS = 24 * 3600 * 1000; // a confirmation can still be recorded this late

/* ONE KEY PER PURCHASE, UNDER THE PERSON (Build 17 audit B17-003, 004, 007,
   008). A person's purchases used to be found through two lists, each one KV
   value rewritten on every purchase: read, add, write back. KV answers reads
   from a cache, so a second purchase could rewrite the list from a copy that
   did not yet hold the first, and the first vanished; and KV takes about one
   write a second to a key, so two purchases close together failed the second
   write after the money had already been closed. Neither list could hold
   more than its cap either, so export and erasure lost the oldest.

   Now each purchase writes its OWN index key, under a prefix that is the
   person's, named so the newest sort first: nothing is read back to write
   it, no two purchases share a key, and a listing of the prefix finds every
   one of them, page by page. The purchase itself is still its hold record,
   by id - the receipt is what a settled hold says. */
const _buyIxPrefix = (email) => 'buyix:' + String(email).toLowerCase() + ':';
const _buyIxKey = (email, at, id) => _buyIxPrefix(email) + String(1e13 - Math.max(0, Math.floor(+at || 0))).padStart(13, '0') + ':' + id;
/* A person's hold ids, newest first, a page at a time; then, once the index
   is exhausted, any from the legacy list not already seen. */
async function _buyHoldIds(env, email, cursor, limit){
  const ids = [];
  if (!cursor || !String(cursor).startsWith('legacy')) {
    const page = await env.AMV_KV.list({ prefix: _buyIxPrefix(email), cursor: cursor || undefined, limit: Math.max(1, Math.min(1000, limit || 100)) });
    for (const k of (page.keys || [])) { const id = String(k.name).split(':').pop(); if (/^bh_[a-f0-9]{24}$/.test(id) && !ids.includes(id)) ids.push(id); }
    if (!page.list_complete) return { ids, next: page.cursor || null };
  }
  /* Purchases made before the index existed, from the old list. */
  let legacy = [];
  try { const l = await DB.get(env, 'buyholds', email); legacy = Array.isArray(l) ? l.filter(x => /^bh_[a-f0-9]{24}$/.test(String(x))) : []; }
  catch (e) { throw e; }
  return { ids: ids.concat(legacy.filter(x => !ids.includes(x))), next: null, legacy: legacy.length };
}

const _buyHost = (s) => {
  const h = String(s || '').trim().toLowerCase();
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(h) && h.length <= 120 ? h : '';
};
const _buyText = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const _buyMoney = (n) => { const v = +n; return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN; };

async function spendHold(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const blocked = await guardAction(env, 'buyhold:' + user.email, 10, 60, 'purchases');
  if(blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const amount = _buyMoney(body.amount);
  const currency = String(body.currency || '').toUpperCase();
  const store = _buyHost(body.store), item = _buyText(body.item, 200);
  if(!(amount > 0) || amount > WEB_ABSOLUTE_SPEND_CAP)
    return json({ error:'That amount cannot be bought here.', code:'bad_amount' }, 400);
  if(!/^[A-Z]{3}$/.test(currency)) return json({ error:'Say which currency the store charges in.', code:'bad_currency' }, 400);
  if(!store || !item) return json({ error:'Say which store and what is being bought.', code:'bad_request' }, 400);
  /* ONE PURCHASE, ONE HOLD, HOWEVER MANY TIMES IT IS ASKED (Build 17 audit
     B17-005). Each hold used to get a fresh random id, so the same request
     sent twice - a retry after an answer that never arrived - held the
     amount twice. The page names each approved purchase with a key, and the
     hold's id is made from the person and that key: asked again, the same
     hold comes back; asked again with different terms, it is refused. */
  const key = String(body.key || '');
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(key))
    return json({ error:'Reload AMV to buy - this page is older than the server.', code:'reload_needed' }, 400);

  const limits = await _spendLimits(env, user.email);
  if(currency !== limits.currency)
    return json({ ok:false, code:'currency_mismatch',
      need:'This store charges in ' + currency + ', and your spending limits are in ' + limits.currency + '.',
      message:'Change the currency of your limits in Spending to ' + currency + ' to buy here. AMV does not convert with a guessed rate.' }, 400);
  const id = 'bh_' + (await _sha256Hex(user.email + '\n' + key)).slice(0, 24);
  const now = Date.now();
  const prior = await DB.get(env, 'buyhold', id);
  if(prior){
    if(prior.email !== user.email || prior.amount !== amount || prior.currency !== currency || prior.store !== store || prior.item !== item)
      return json({ ok:false, code:'hold_terms_differ', error:'This purchase was already held with different terms. Start it again.' }, 409);
    if(prior.status === 'held') return json({ ok:true, repeat:true, hold:{ id, amount, currency, store, expiresAt: (+prior.at || now) + BUY_HOLD_WINDOW_MS } });
    if(prior.status === 'refused') return json({ ok:false, repeat:true, code:'refused', error:'This purchase was refused by your Spending limits.' }, 400);
    if(prior.status !== 'reserving') return json({ ok:false, code:'decided', status:prior.status, error:'This purchase was already ' + prior.status + '.' }, 409);
    /* 'reserving': the first request may still be booking it. Going on is
       safe - the booking is named after the hold, so it lands once. */
  }
  /* THE HOLD IS WRITTEN DOWN BEFORE THE MONEY IS BOOKED (Build 16 audit
     STATE16-07). Booked first, a hold whose record then failed to save was
     money taken from the month with nothing anywhere that named it. Now the
     record exists first ('reserving', with the total it will book against),
     the booking is named after the hold so a retry cannot book it twice, and a
     record that cannot be finished closes its own booking - so every failure
     leaves either a hold that can be found or nothing booked at all. */
  const base = { id, email:user.email, amount, currency, store, item, at: prior ? (+prior.at || now) : now,
    ledgerKey: _spendMonthKey(user.email, limits.currency), named:true };
  /* Indexed by the person first (Build 16 audit SEC-14): a hold is kept by
     its id, and without this neither their data export nor erasing their
     account could find it. */
  try {
    if(!prior){
      await env.AMV_KV.put(_buyIxKey(user.email, now, id), '1');
      await DB.put(env, 'buyhold', id, Object.assign({}, base, { status:'reserving', reserved:0 }));
    }
  }
  catch (e) {
    audit(env, 'buy_hold_unrecorded', { by:user.email, id, stage:'intent' });
    return json({ ok:false, code:'hold_unavailable', error:'AMV could not hold this purchase right now. Nothing was held - try again in a moment.' }, 503);
  }
  const booked = await _spendReserve(env, user.email, amount, undefined,
    { once:_buyBooked(id), unless:_buyClosed(id), ledgerKey:base.ledgerKey });
  if(booked.refused){
    try { await DB.put(env, 'buyhold', id, Object.assign({}, base, { status:'refused', reserved:0 })); }
    catch (e) { audit(env, 'buy_hold_unrecorded', { by:user.email, id, stage:'refused' }); }
    audit(env, 'buy_hold_refused', { by:user.email, amount, currency, store, why:booked.refused.code });
    return json(Object.assign({ ok:false }, booked.refused), 400);
  }
  try { await DB.put(env, 'buyhold', id, Object.assign({}, base, { status:'held', reserved: booked.reserved || 0 })); }
  catch (e) {
    const end = await _buyClose(env, base, -amount, { kind:'released', at:Date.now() });
    audit(env, 'buy_hold_unrecorded', { by:user.email, id, stage:'held', closed: !end.pending });
    return json({ ok:false, code:'hold_unavailable', error: end.pending
      ? 'AMV could not finish holding this purchase. Do not buy it now - the amount will be given back to your month.'
      : 'AMV could not hold this purchase right now. Nothing was held - try again in a moment.' }, 503);
  }
  audit(env, 'buy_hold', { by:user.email, id, amount, currency, store });
  return json({ ok:true, hold:{ id, amount, currency, store, expiresAt: now + BUY_HOLD_WINDOW_MS } });
}

async function _buyOwnHold(env, user, id){
  if(!/^bh_[a-f0-9]{24}$/.test(String(id || ''))) return null;
  const rec = await DB.get(env, 'buyhold', id);
  return (rec && rec.email === user.email) ? rec : null;
}

/* A HOLD CLOSES ONCE, AND THE COUNTER DECIDES (Build 16 audit STATE16-06/08).

   A hold ends settled or released, and the only thing that knew which was the
   hold's record in KV - read, checked, and written back as three steps. A
   release replayed against a stale copy still read 'held' and gave the money
   back a second time, out of some other purchase's booking. A settlement
   whose adjustment failed fell back to a separate store, reported success,
   and the month never learned what the store charged.

   Now closing a hold is ONE named step on the month's own counter: the
   adjustment (all of it back for a release; what the store charged minus what
   was held for a settlement, either way round) and the hold's closing are one
   write, under a name only this hold has. A second close of either kind is
   told it already happened and is handed what the first recorded, so it can
   finish the record from the counter rather than from a stale copy. Settling
   and releasing are therefore one or the other, never both. It is `strict`:
   a counter that cannot answer is not a close, the hold stays open, and the
   person is told it is pending - never that it is done. `requires` means a
   hold whose booking never arrived gives nothing back. */
const _buyBooked = (id) => 'buybooked:' + id;
const _buyClosed = (id) => 'buyclosed:' + id;
async function _buyClose(env, rec, amount, note){
  if(!rec.ledgerKey) return { pending:true };
  const payload = { op:'incr', amount: _buyMoney(amount) || 0, once:_buyClosed(rec.id), note, strict:true, ttlMs: SPEND_MONTH_TTL_MS };
  if(rec.named) payload.requires = _buyBooked(rec.id);
  let r = null;
  try { r = await counter(env, rec.ledgerKey, payload); }
  catch (e) { audit(env, 'buy_close_pending', { id:rec.id, kind:note.kind, why:String((e && e.message) || e).slice(0, 120) }); return { pending:true }; }
  if(!r || r.unavailable) return { pending:true };
  return { note: r.replay ? (r.note || null) : note, replay: !!r.replay };
}

/* The record, brought up to what the counter says happened. */
function _buyFinish(rec, note){
  if(note && note.kind === 'settled'){
    Object.assign(rec, { status:'settled', settledAt:note.at, total:note.total, order:note.order, over:note.over,
      seenOnPage: note.seenOnPage === true || note.verified === true, verified: false });
  } else Object.assign(rec, { status:'released', releasedAt:(note && note.at) || Date.now() });
  return rec;
}
/* WHAT A RECEIPT CAN STAND BEHIND (Build 17 audit B17-006, B17-021). AMV
   has no line to any store: the order number and total come from the
   person's own computer, which read them off the store's confirmation page
   (`seenOnPage`) or did not. That is reported, not verified - nobody at AMV
   asked the store - so `verified` is false on every receipt until a store's
   own API is used, and the screen says "seen on the store's page", never
   "verified". A client saying verified:true is read as what it is: the page
   check it ran. */
const _buyReceiptOf = (rec) => ({ id:rec.id, at:rec.settledAt, store:rec.store, item:rec.item, approved:rec.amount, total:rec.total,
  currency:rec.currency, order:rec.order, over:rec.over, seenOnPage: rec.seenOnPage === true || (rec.verified === true && rec.seenOnPage == null),
  verified: false, source: 'reported' });

/* Receipts are the settled holds, found through the person's index
   (_buyHoldIds); nothing is appended to a shared list any more. */

async function spendSettle(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const blocked = await guardAction(env, 'buysettle:' + user.email, 20, 200, 'purchases');
  if(blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const rec = await _buyOwnHold(env, user, body.hold);
  if(!rec) return json({ error:'No such purchase.', code:'not_found' }, 404);
  if(rec.status !== 'held') return json({ error:'This purchase was already ' + rec.status + '.', code:'decided', status:rec.status }, 409);
  if(Date.now() - rec.at > BUY_SETTLE_WINDOW_MS) return json({ error:'This purchase is too old to confirm.', code:'expired' }, 409);
  const total = _buyMoney(body.total);
  const order = _buyText(body.order, 80);
  if(!(total >= 0)) return json({ error:'Say what the store charged.', code:'bad_amount' }, 400);
  if(!order) return json({ error:'Say the order number the store gave.', code:'bad_request' }, 400);

  /* What the store charged against what was approved. Less: the rest goes
     back to the month. More: it has already happened - it is booked, so the
     month tells the truth, and it is said out loud on the receipt. Either way
     it is the one closing step (above). */
  const held = rec.reserved > 0 ? rec.amount : 0;
  const over = total > rec.amount ? _buyMoney(total - rec.amount) : 0;
  const note = { kind:'settled', at:Date.now(), total, order, over, seenOnPage: body.seenOnPage === true || body.verified === true };
  const end = await _buyClose(env, rec, total - held, note);
  if(end.pending) return json({ ok:false, code:'settle_pending',
    error:'AMV could not record this purchase against your limit yet. Nothing is lost - it will be recorded when you try again.' }, 503);
  _buyFinish(rec, end.note);
  if(over > 0 && !end.replay) audit(env, 'buy_over_approved', { by:user.email, id:rec.id, approved:rec.amount, charged:total, store:rec.store });
  if(rec.status !== 'settled') return json({ error:'This purchase was already released.', code:'decided', status:rec.status }, 409);
  const receipt = _buyReceiptOf(rec);
  /* The money is closed above, on the counter. Writing the record can still
     fail - KV taking one write a second to a key among them - and that must
     not read as the purchase failing: it is counted, and settling again
     finishes the record from the counter (the close replays its note). */
  try { await DB.put(env, 'buyhold', rec.id, rec); }
  catch (e) {
    audit(env, 'buy_record_pending', { by:user.email, id:rec.id, why:String((e && e.message) || e).slice(0, 120) });
    return json({ ok:true, receipt, recordPending:true }, 202);
  }
  if(!end.replay){
    audit(env, 'buy_settled', { by:user.email, id:rec.id, total:rec.total, currency:rec.currency, store:rec.store, over:rec.over });
    await _userEvent(env, request, user.email, 'purchase', { store:rec.store, total:rec.total, currency:rec.currency });
  }
  return json({ ok:true, receipt });
}

async function spendRelease(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const body = await request.json().catch(() => ({}));
  const rec = await _buyOwnHold(env, user, body.hold);
  if(!rec) return json({ error:'No such purchase.', code:'not_found' }, 404);
  /* 'reserving' is a hold whose record could not be finished: its booking may
     or may not have landed, and closing it gives back only one that did. */
  if(rec.status !== 'held' && rec.status !== 'reserving') return json({ ok:true, status:rec.status });
  const back = rec.status === 'held' ? (rec.reserved || 0) : rec.amount;
  const end = await _buyClose(env, rec, -back, { kind:'released', at:Date.now() });
  if(end.pending) return json({ ok:false, code:'release_pending',
    error:'AMV could not give this back to your month yet. Nothing is lost - try again in a moment.' }, 503);
  const replay = end.replay;
  _buyFinish(rec, end.note);
  await DB.put(env, 'buyhold', rec.id, rec);
  if(!replay) audit(env, 'buy_released', { by:user.email, id:rec.id });
  return json({ ok:true, status:rec.status });
}

/* GET /v1/spend/buys?cursor=  Every receipt, a page at a time (Build 17 audit
   B17-008): the settled holds through the person's index, then any from the
   legacy list not already shown. A purchase record that cannot be read makes
   the whole answer "could not load" (503) - never a shorter list that looks
   complete, and never an empty one that looks like nothing was bought. */
async function spendBuys(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const url = new URL(request.url);
  const cursor = String(url.searchParams.get('cursor') || '').slice(0, 400) || null;
  let page, legacyList = [];
  try {
    page = await _buyHoldIds(env, user.email, cursor, 200);
    if (!page.next) { const l = await DB.get(env, 'buys', user.email); legacyList = Array.isArray(l) ? l : []; }
  } catch (e) {
    return json({ ok:false, code:'receipts_unavailable', error:'AMV could not read your purchases just now.' }, 503, { 'Retry-After':'5' });
  }
  const buys = [];
  for (const id of page.ids) {
    let rec;
    try { rec = await DB.get(env, 'buyhold', id); }
    catch (e) { return json({ ok:false, code:'receipts_unavailable', error:'AMV could not read your purchases just now.' }, 503, { 'Retry-After':'5' }); }
    if (rec && rec.email === user.email && rec.status === 'settled') buys.push(_buyReceiptOf(rec));
  }
  /* Receipts written to the old list before the index existed. */
  for (const r of legacyList) if (r && r.id && !buys.some(b => b.id === r.id))
    buys.push(Object.assign({}, r, { seenOnPage: r.seenOnPage === true || r.verified === true, verified: false, source: 'reported' }));
  buys.sort((a, b) => (+b.at || 0) - (+a.at || 0));
  return json({ ok:true, buys, next: page.next || null });
}
