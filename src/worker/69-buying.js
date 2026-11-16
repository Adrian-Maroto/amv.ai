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
const BUY_RECEIPTS_MAX = 100;

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

  const limits = await _spendLimits(env, user.email);
  if(currency !== limits.currency)
    return json({ ok:false, code:'currency_mismatch',
      need:'This store charges in ' + currency + ', and your spending limits are in ' + limits.currency + '.',
      message:'Change the currency of your limits in Spending to ' + currency + ' to buy here. AMV does not convert with a guessed rate.' }, 400);
  const booked = await _spendReserve(env, user.email, amount);
  if(booked.refused){
    audit(env, 'buy_hold_refused', { by:user.email, amount, currency, store, why:booked.refused.code });
    return json(Object.assign({ ok:false }, booked.refused), 400);
  }
  const id = 'bh_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const now = Date.now();
  await DB.put(env, 'buyhold', id, { id, email:user.email, amount, currency, store, item, at:now,
    status:'held', ledgerKey: booked.ledgerKey || '', reserved: booked.reserved || 0 });
  audit(env, 'buy_hold', { by:user.email, id, amount, currency, store });
  return json({ ok:true, hold:{ id, amount, currency, store, expiresAt: now + BUY_HOLD_WINDOW_MS } });
}

async function _buyOwnHold(env, user, id){
  if(!/^bh_[a-f0-9]{24}$/.test(String(id || ''))) return null;
  const rec = await DB.get(env, 'buyhold', id);
  return (rec && rec.email === user.email) ? rec : null;
}

async function _buyReceipt(env, email, r){
  await _withKV(env, 'buys', email, (list) => {
    const l = Array.isArray(list) ? list : [];
    l.unshift(r);
    return l.slice(0, BUY_RECEIPTS_MAX);
  }, []);
}

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
     month tells the truth, and it is said out loud on the receipt. */
  let over = 0;
  if(total < rec.amount && rec.reserved > 0 && rec.ledgerKey) await _spendRelease(env, user.email, _buyMoney(rec.amount - total), rec.ledgerKey);
  else if(total > rec.amount){ over = _buyMoney(total - rec.amount); await _spendRecord(env, user.email, over);
    audit(env, 'buy_over_approved', { by:user.email, id:rec.id, approved:rec.amount, charged:total, store:rec.store }); }
  rec.status = 'settled'; rec.settledAt = Date.now(); rec.total = total; rec.order = order; rec.over = over;
  rec.verified = body.verified === true;
  await DB.put(env, 'buyhold', rec.id, rec);
  const receipt = { id:rec.id, at:rec.settledAt, store:rec.store, item:rec.item, approved:rec.amount, total, currency:rec.currency,
    order, over, verified: rec.verified };
  await _buyReceipt(env, user.email, receipt);
  audit(env, 'buy_settled', { by:user.email, id:rec.id, total, currency:rec.currency, store:rec.store, over });
  await _userEvent(env, request, user.email, 'purchase', { store:rec.store, total, currency:rec.currency });
  return json({ ok:true, receipt });
}

async function spendRelease(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const body = await request.json().catch(() => ({}));
  const rec = await _buyOwnHold(env, user, body.hold);
  if(!rec) return json({ error:'No such purchase.', code:'not_found' }, 404);
  if(rec.status !== 'held') return json({ ok:true, status:rec.status });
  if(rec.reserved > 0 && rec.ledgerKey) await _spendRelease(env, user.email, rec.reserved, rec.ledgerKey);
  rec.status = 'released'; rec.releasedAt = Date.now();
  await DB.put(env, 'buyhold', rec.id, rec);
  audit(env, 'buy_released', { by:user.email, id:rec.id });
  return json({ ok:true, status:'released' });
}

async function spendBuys(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const list = await DB.get(env, 'buys', user.email);
  return json({ ok:true, buys: Array.isArray(list) ? list : [] });
}
