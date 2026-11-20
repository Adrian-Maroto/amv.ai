/* SHOPPING IN AMV'S BROWSER (Nov 16, buying phase 1 - docs/BUYING.md;
   contained Nov 20 after the build 16 audit, AG-01..AG-04).

   Fetched when AMV's browser is running. What it holds, read from the live
   page rather than from the model:

   1. AMV NEVER PRESSES A PAY BUTTON ITSELF. The final step is the person's
      own press on the store's own button, in AMV's browser where they can
      see it. A pay / place-order button is recognised by its real label in
      seventeen languages and more; a press whose target cannot be read on a
      page that looks like a checkout is refused too; so are Enter, a
      submitted form and an accepted dialog there. If the page cannot be
      read at all, nothing that writes is done. (Audit AG-01: a label list in
      one language failed open, and so did an unreadable page.)
   2. EVERY SURFACE, ONE GUARD. This check is called from runMcpTool, which
      every surface (chat, Build, anything later) goes through to reach AMV's
      browser - not from one surface that remembered to.
   3. THE PURCHASE CARD SAYS EXACTLY WHAT THE PAGE SAYS. propose_purchase is
      refused unless the browser is on that store (the store itself or a
      subdomain of it - never a parent, never a public suffix like co.uk),
      and the total appears on the page next to its currency and is the
      largest amount there - so a shipping line or a subtotal cannot pass as
      the total, and EUR 500 cannot pass as USD 5 (AG-02).
   4. HELD, THEN PRESSED BY THE PERSON, THEN READ BACK. The amount is held
      on the server against their Spending limits (69-buying.js) first. Only
      an order number and total found on the store's confirmation page is
      "Bought"; anything else is "Not confirmed" and says what to check
      (AG-03).
   5. A SHOPPING TRIP IS ONE REQUEST. The one-time approval to shop on a
      store belongs to this account, this conversation and this request, and
      lasts twenty minutes at most (AG-04). */
/* Seventeen languages and the common store wording in each. Bounded by
   letters on either side (any script), so "pay" is not found in "payment
   details" and "comprar" not in "comprarlo" - but "Pagar ahora" is. */
const SHOP_MONEY = new RegExp('(?<![\\p{L}\\p{N}])(' + [
  'buy( it)?( now)?', 'place (my |your )?order', 'pay( now| securely)?', 'purchase', 'complete (my |your )?(order|purchase)',
  'confirm (and pay|order|purchase|payment)', 'submit (my |your )?order', 'checkout and pay', 'order now', 'book now', 'subscribe( now)?',
  'comprar( ahora| ya)?', 'pagar( ahora)?', 'realizar (el )?pedido', 'finalizar (la |el |o )?(compra|pedido)', 'confirmar (el |la |o )?(pedido|pago|compra)', 'tramitar pedido', 'hacer pedido',
  'acheter( maintenant)?', 'payer', 'commander', 'passer (la )?commande', 'valider (la |ma )?commande', 'confirmer (la |ma )?commande',
  '(jetzt )?kaufen', '(jetzt )?bezahlen', 'zahlungspflichtig bestellen', 'kaufen', 'bestellung (abschicken|absenden)', 'jetzt bestellen',
  'acquista( ora)?', 'paga( ora)?', 'ordina( ora)?', "conferma (l'|l’)?ordine", "procedi (all'|all’)?acquisto",
  'betalen', 'bestellen', 'afrekenen', 'nu kopen',
  'satın al', 'öde', 'ödeme yap', 'siparişi (onayla|tamamla|ver)',
  'mua( ngay)?', 'thanh toán', 'đặt hàng',
  'beli( sekarang)?', 'bayar( sekarang)?', 'pesan sekarang',
  'kupuję', 'zapłać', 'zamawiam',
  'купить', 'оплатить', 'оформить заказ', 'подтвердить заказ', 'заказать', 'оплата',
  'شراء', 'اشتر الآن', 'ادفع', 'دفع', 'إتمام الطلب', 'تأكيد الطلب', 'اطلب الآن',
  'खरीदें', 'अभी खरीदें', 'भुगतान करें', 'ऑर्डर करें', 'ऑर्डर दें',
  'কিনুন', 'পেমেন্ট করুন', 'অর্ডার করুন',
  'خریدیں', 'ادائیگی کریں', 'آرڈر کریں',
  'வாங்கு', 'பணம் செலுத்து', 'ஆர்டர் செய்',
].join('|') + ')(?![\\p{L}\\p{N}])', 'iu');
/* Scripts written without spaces: found anywhere in the label. */
const SHOP_MONEY_CJK = /(购买|立即购买|提交订单|去结算|结算|支付|付款|購買|購入|今すぐ購入|注文を確定|注文する|注文確定|支払う|お支払い|구매|구매하기|결제|결제하기|주문하기|주문 완료)/;
const _shopIsMoney = (label) => { const l = String(label || ''); return SHOP_MONEY.test(l) || SHOP_MONEY_CJK.test(l); };
/* A page that is a checkout, read from its words: card fields, payment
   words, or a pay button anywhere on it. Where this is true, a press AMV
   cannot identify is not made. */
const SHOP_CHECKOUT = /(card number|security code|\bcvv\b|\bcvc\b|expiry|expiration date|billing address|payment method|checkout|order summary|n[uú]mero de (la )?tarjeta|m[ée]todo de pago|r[ée]sum[ée] de (la )?commande|moyen de paiement|kartennummer|zahlungsart|kasse|metodo di pagamento|riepilogo (dell'|dell’)?ordine|forma de pagamento|betaalmethode|kart numarası|ödeme yöntemi|số thẻ|metode pembayaran|номер карты|способ оплаты|رقم البطاقة|طريقة الدفع|कार्ड नंबर|भुगतान का तरीका|支付方式|银行卡号|お支払い方法|カード番号|결제 수단|카드 번호)/i;
const SHOP_TRIP_MS = 20 * 60 * 1000;
const SHOP_PENDING_MS = 15 * 60 * 1000;
const SHOP = { trips: new Map(), pending: null, snap: { at: 0, text: '', host: '' } };

const _shopAlias = (tool) => _mcpAliasFor(MCP_BROWSER.id, tool);
function _shopTool(name){ const who = mcpToolIdentity(name); return (who && who.id === MCP_BROWSER.id) ? who.tool : ''; }
const _shopHostOf = (u) => { try{ return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); }catch(e){ return ''; } };
/* A store's address is a registrable name: never a bare public suffix. Two
   labels under a country code whose second level is a generic one (co.uk,
   com.au, co.jp, com.br...) are a suffix, not a store. */
const SHOP_SECOND = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'or', 'ne', 'go', 'gob', 'gouv', 'nic', 'ltd', 'plc', 'biz', 'info']);
function _shopRegistrable(host){
  const p = String(host || '').split('.').filter(Boolean);
  if(p.length < 2) return false;
  if(p.length === 2 && p[1].length === 2 && SHOP_SECOND.has(p[0])) return false;
  return true;
}
/* The browser is on the store: the store itself or a subdomain of it. Never
   the other way round - approving merchant-a.co.uk must not reach co.uk or
   merchant-b.co.uk (AG-02). */
const _shopSame = (host, store) => !!host && !!store && _shopRegistrable(store) && (host === store || host.endsWith('.' + store));
/* Who is asking, now: the account, the conversation and the request. */
function _shopWho(){
  let user = '', conv = '';
  try{ user = String((S.user && S.user.email) || '').toLowerCase(); conv = String(S.cur || ''); }catch(e){}
  return { user, conv, req: +(window.__amvReq || 0) };
}
const _shopSameWho = (a, b) => !!a && !!b && a.user === b.user && a.conv === b.conv && a.req === b.req;

/* The page as the browser has it now, read by the page itself. A page that
   cannot be read is an error, never an empty page (AG-01). */
async function _shopSnap(fresh){
  if(!fresh && Date.now() - SHOP.snap.at < 1500) return SHOP.snap;
  const r = await runMcpTool(_shopAlias('browser_snapshot'), {});
  const text = String((r && r.text) || '');
  const m = /Page URL:\s*(\S+)/.exec(text);
  if(!r || r.ok === false || !text || !m) throw new Error('unreadable');
  SHOP.snap = { at: Date.now(), text, host: _shopHostOf(m[1]) };
  return SHOP.snap;
}
/* The control a reference points at: its role and its accessible name. */
function _shopRefOf(text, ref){
  const esc = String(ref || '').replace(/[^A-Za-z0-9_-]/g, '');
  if(!esc) return null;
  const m = new RegExp('-\\s+([\\w-]+)(?:\\s+"([^"]*)")?[^\\n]*\\[ref=' + esc + '\\]').exec(text);
  return m ? { role: m[1] || '', name: String(m[2] || '').trim() } : null;
}
function _shopLabelOf(text, ref){
  const r = _shopRefOf(text, ref);
  return r ? (r.role + ' ' + r.name).trim() : '';
}
const _shopHasMoneyButton = (text) => [...String(text).matchAll(/-\s+(?:button|link)\s+"([^"]*)"/g)].some(m => _shopIsMoney(m[1]));
const _shopCheckoutish = (text) => _shopHasMoneyButton(text) || SHOP_CHECKOUT.test(String(text || ''));

/* MONEY ON A PAGE, with its currency. Symbols for the common ones; the ISO
   code works for every currency. */
const SHOP_SYM = { USD:['$','US$'], EUR:['€'], GBP:['£'], JPY:['¥','円'], CNY:['¥','元','CN¥'], INR:['₹','Rs'], KRW:['₩','원'], BRL:['R$'], RUB:['₽','руб'], TRY:['₺','TL'], VND:['₫','đ'],
  PLN:['zł'], CHF:['CHF','Fr.'], CAD:['$','CA$','C$'], AUD:['$','A$','AU$'], MXN:['$','MX$'], IDR:['Rp'], SAR:['﷼','SR','ر.س'], AED:['د.إ','AED'], EGP:['E£','ج.م'], PKR:['₨','Rs'], BDT:['৳'], NGN:['₦'], ZAR:['R'], SEK:['kr'], NOK:['kr'], DKK:['kr'], HKD:['HK$','$'], SGD:['S$','$'], TWD:['NT$','$'], THB:['฿'], PHP:['₱'], ILS:['₪'], UAH:['₴'] };
function _shopNum(s){
  /* 1,234.50 / 1.234,50 / 1 234,50 / 1234.5 / 1234 */
  let t = String(s).replace(/[\s\u00a0\u202f']/g, '');
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if(lc > ld){ t = (t.length - lc - 1 === 3 && ld < 0 && t.split(',').length > 2) ? t.replace(/,/g, '') : (t.length - lc - 1 <= 2 ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')); }
  else if(ld > lc){ t = (t.length - ld - 1 === 3 && t.split('.').length > 2 && lc < 0) ? t.replace(/\./g, '') : t.replace(/,/g, ''); }
  const n = +t; return isFinite(n) ? n : NaN;
}
/* Every amount on the page written next to this currency's code or symbol. */
function _shopAmounts(text, currency){
  const marks = [currency].concat(SHOP_SYM[currency] || []).map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mk = '(?:' + marks.join('|') + ')';
  const num = '(\\d{1,3}(?:[.,\\s\\u00a0\\u202f]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
  const re = new RegExp(mk + '\\s?' + num + '|' + num + '\\s?' + mk, 'gu');
  const out = [];
  for(const m of String(text).matchAll(re)){ const v = _shopNum(m[1] || m[2]); if(v >= 0) out.push(v); }
  return out;
}
/* The total is on the page next to its currency, and nothing on the page in
   that currency is larger - so a shipping line or a subtotal cannot stand in
   for the total, and the wrong currency finds nothing. */
function _shopTotalOnPage(text, total, currency){
  const n = +total; if(!(n > 0)) return false;
  const cur = String(currency || '').toUpperCase();
  if(!/^[A-Z]{3}$/.test(cur)) return false;
  const seen = _shopAmounts(text, cur);
  if(!seen.some(v => Math.abs(v - n) < 0.005)) return false;
  return !seen.some(v => v > n + 0.005);
}

/* CONSENT for AMV's browser: once per store, for this request. */
async function _shopConsent(name, input){
  const tool = _shopTool(name);
  let host = '';
  if(tool === 'browser_navigate') host = _shopHostOf(_browserUrl(input && input.url));
  else { try{ host = (await _shopSnap(true)).host; }catch(e){ host = ''; } }
  const who = _shopWho(), g = host ? SHOP.trips.get(host) : null;
  if(g && Date.now() < g.until && _shopSameWho(g.who, who)) return true;
  const where = host || T('this site');
  const ok = await _showModalAsync({
    title: T('Let AMV shop on {0}?').replace('{0}', where),
    body: T('For this request AMV can search, open pages and fill in your cart and checkout on {0}, in AMV’s browser where you are signed in. It cannot pay: the last step needs your OK, and anything it buys is held against your Spending limits first.').replace('{0}', where)
      + (host ? '' : '\n\n' + T('AMV could not tell which site the browser is on, so it will ask again for the next step.')),
    okText: T('Let AMV shop'), cancelText: T('Not now'),
  });
  if(ok === true && host) SHOP.trips.set(host, { who, until: Date.now() + SHOP_TRIP_MS });
  return ok === true;
}

/* THE CHECK before AMV's browser writes anything: a pay button is never
   pressed by AMV. Returns a refusal, or null. */
const SHOP_WRITES = new Set(['browser_click', 'browser_press_key', 'browser_type', 'browser_fill_form', 'browser_select_option', 'browser_handle_dialog', 'browser_drag']);
async function _shopCheck(name, input){
  const tool = _shopTool(name);
  if(!SHOP_WRITES.has(tool)) return null;
  let s;
  try{ s = await _shopSnap(true); }catch(e){ return { ok:false, text:'AMV could not read the page before acting, so it did not act. Read the page again (browser_snapshot), then try.' }; }
  const checkout = _shopCheckoutish(s.text);
  let money = false, unread = false;
  if(tool === 'browser_click' || tool === 'browser_drag'){
    /* A control with no name (an icon, a bare image) or a reference that is
       not on the page cannot be read - and is not pressed on a checkout. */
    const r = _shopRefOf(s.text, input && (input.ref || input.startRef));
    money = !!r && _shopIsMoney(r.name);
    unread = !r || !r.name;
  }
  else if(tool === 'browser_press_key') money = /^(Enter|NumpadEnter| |Space|Spacebar)$/i.test(String((input && input.key) || '')) && checkout;
  else if(tool === 'browser_handle_dialog') money = (input && input.accept !== false) && checkout;
  else if(input && input.submit === true) money = checkout;
  if(unread && checkout) return { ok:false, text:'Refused: AMV could not read what that control is, and this page is a checkout, so it did not press it. Read the page again and use a control it can name - and remember AMV never presses the pay button itself.' };
  if(!money) return null;
  const p = SHOP.pending && Date.now() < SHOP.pending.until && _shopSameWho(SHOP.pending.who, _shopWho()) ? SHOP.pending : null;
  return { ok:false, text: p
    ? 'Refused: AMV never presses the pay button itself. The purchase is approved and held - ask the person to press the store’s own button in AMV’s browser now, then read the confirmation page and call confirm_purchase.'
    : 'Refused: that would press a pay or place-order button, and AMV never presses one itself. Get the checkout to its final review step, then call propose_purchase with the store, the item, the total and its currency as the page shows them; the person approves, and presses the store’s button.' };
}

async function _shopPropose(input){
  const store = String((input && input.store) || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
  const item = String((input && input.item) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const total = Math.round((+((input && input.total)) || 0) * 100) / 100;
  const currency = String((input && input.currency) || '').toUpperCase();
  if(!store || !item || !(total > 0) || !/^[A-Z]{3}$/.test(currency))
    return { ok:false, text:'propose_purchase needs the store (its address), the item, the total and the 3-letter currency, exactly as the checkout page shows them.' };
  if(!_shopRegistrable(store)) return { ok:false, text:'"' + store + '" is not a store’s address. Pass the store’s own address, as the browser shows it.' };
  let s;
  try{ s = await _shopSnap(true); }catch(e){ return { ok:false, text:'AMV could not read the checkout page, so nothing was proposed.' }; }
  if(!_shopSame(s.host, store)) return { ok:false, text:'The browser is on ' + (s.host || 'an unknown page') + ', not ' + store + '. Open the checkout there first.' };
  if(!_shopTotalOnPage(s.text, total, currency)) return { ok:false, text:'The total ' + total.toFixed(2) + ' ' + currency + ' does not appear on the checkout page as its total. Read the page again and pass the order total it shows - the largest amount, in the currency it is shown in. AMV only proposes a price the person can see on the store’s own page.' };
  const money = (() => { try{ return new Intl.NumberFormat(undefined, { style:'currency', currency }).format(total); }catch(e){ return currency + ' ' + total.toFixed(2); } })();
  const ok = await _showModalAsync({
    title: T('Buy for {0}?').replace('{0}', money),
    body: item + '\n' + store + '\n\n' + T('{0}, as the store’s checkout page shows it. AMV holds the amount against your Spending limits, then you press the store’s own pay button in AMV’s browser - AMV never presses it - and AMV reads the confirmation back.').replace('{0}', money),
    okText: T('Buy for {0}').replace('{0}', money), cancelText: T('Not now'),
  });
  if(ok !== true) return { ok:false, text:'The person chose not to buy it. Do not ask them to press the final button. Ask what they want instead.' };
  let d;
  try{
    const r = await AMV_API._fetch('/v1/spend/hold', { method:'POST', body: JSON.stringify({ amount: total, currency, store, item }) });
    d = await r.json().catch(() => ({}));
    if(!r.ok || !d.ok){
      const why = [d.need, d.message].filter(Boolean).join(' ') || d.error || 'The purchase could not be held.';
      return { ok:false, text:'Not bought: ' + why + ' Tell the person exactly this; do not ask them to press the final button.',
        render:'<div class="chat-buy bad"><b>' + escH(T('Not bought')) + '</b> ' + escH(why) + '</div>' };
    }
  }catch(e){ return { ok:false, text:'Not bought: AMV could not reach its server to hold the amount, so nothing was approved.' }; }
  const hold = d.hold.id;
  SHOP.pending = { store, item, total, currency, hold, money, who: _shopWho(), until: Date.now() + SHOP_PENDING_MS };
  /* If nothing is confirmed, the hold is given back - and the person told. */
  setTimeout(() => {
    /* Not one the store may already have charged: once a confirmation was
       tried, giving the hold back would leave a real purchase uncounted. It
       stays counted against the month - the safe side - until a retried
       confirmation records it. */
    if(SHOP.pending && SHOP.pending.hold === hold && !SHOP.pending.settling){
      SHOP.pending = null;
      AMV_API._fetch('/v1/spend/release', { method:'POST', body: JSON.stringify({ hold }) })
        .catch(e => { try{ console.error('AMV: could not release a purchase hold', e); }catch(_){} });
    }
  }, SHOP_PENDING_MS + 1000);
  return { ok:true, text:'Approved and held: ' + money + ' at ' + store + '. AMV does not press the pay button: ask the person to press the store’s own button in AMV’s browser now. Then read the confirmation page and call confirm_purchase with the order number, the total and its currency as the page shows them.',
    render:'<div class="chat-buy"><b>' + escH(T('Approved')) + '</b> ' + escH(item) + ' · ' + escH(money) + ' · ' + escH(store)
      + '<span class="chat-buy-n">' + escH(T('Press the store’s own pay button in AMV’s browser to buy it.')) + '</span></div>' };
}

async function _shopConfirm(input){
  const c = SHOP.pending;
  if(!c || !_shopSameWho(c.who, _shopWho())) return { ok:false, text:'There is no purchase waiting to be confirmed.' };
  const order = String((input && input.order) || '').trim().slice(0, 80);
  const total = Math.round((+((input && input.total)) || 0) * 100) / 100;
  const currency = String((input && input.currency) || c.currency).toUpperCase();
  if(!order) return { ok:false, text:'confirm_purchase needs the order number the confirmation page shows.' };
  let s = { text:'', host:'' };
  try{ s = await _shopSnap(true); }catch(e){}
  /* Bought means the store's own page says so: this order number, and this
     total in this currency, on that store. Anything less is not Bought. */
  const seen = _shopSame(s.host, c.store) && order.length >= 3 && s.text.indexOf(order) >= 0
    && currency === c.currency && _shopAmounts(s.text, currency).some(v => Math.abs(v - total) < 0.005);
  let d;
  c.settling = true;
  try{
    const r = await AMV_API._fetch('/v1/spend/settle', { method:'POST', body: JSON.stringify({ hold: c.hold, total, order, verified: seen }) });
    d = await r.json().catch(() => ({}));
    if(!r.ok || !d.ok) throw Object.assign(new Error(d.error || ('HTTP ' + r.status)), { pending: /_pending$/.test(String(d.code || '')) });
  }catch(e){ return { ok:false, text:'The purchase may have gone through, but AMV could not record it (' + ((e && e.message) || 'error') + ').'
      + ((e && e.pending) ? ' It is still waiting to be recorded: call confirm_purchase again with the same order number in a moment.' : '') + ' Tell the person to check the store’s confirmation email.',
    render:'<div class="chat-buy bad"><b>' + escH(T('Not confirmed')) + '</b> ' + escH(c.item) + '<span class="chat-buy-n">' + escH(T('AMV could not record this purchase. Check the store’s confirmation email.')) + '</span></div>' }; }
  SHOP.pending = null;
  const rc = d.receipt || {};
  const money = (() => { try{ return new Intl.NumberFormat(undefined, { style:'currency', currency: rc.currency || c.currency }).format(rc.total); }catch(e){ return String(rc.total); } })();
  if(!seen){
    /* Counted against the limits all the same - the safe side if it did go
       through - but never shown as bought. */
    return { ok:true, text:'NOT confirmed: the order number ' + order + ' and the total were not found on the store’s page. Tell the person plainly that AMV could not confirm the purchase, and to check the store’s confirmation email.',
      render:'<div class="chat-buy bad"><b>' + escH(T('Not confirmed')) + '</b> ' + escH(c.item) + ' · ' + escH(money)
        + '<span class="chat-buy-n">' + escH(T('AMV could not find this order number and total on the store’s page - check the store’s confirmation email.')) + '</span></div>' };
  }
  const note = rc.over > 0 ? T('The store charged more than you approved.') : T('Checked on the store’s confirmation page.');
  return { ok:true, text:'Recorded: ' + c.item + ', ' + money + ', order ' + order + ' (seen on the confirmation page)' + (rc.over > 0 ? '. The store charged ' + rc.over + ' more than approved - tell the person.' : '.'),
    render:'<div class="chat-buy' + (rc.over > 0 ? ' bad' : ' done') + '"><b>' + escH(T('Bought')) + '</b> ' + escH(c.item) + ' · ' + escH(money)
      + ' · ' + escH(T('Order {0}').replace('{0}', order)) + '<span class="chat-buy-n">' + escH(note) + '</span></div>' };
}

const SHOP_TOOLS = [
  { name:'propose_purchase', description:'Ask the person to approve a purchase. Use ONLY when they asked you to buy something and the checkout in AMV’s browser is on its final review step. Pass exactly what the page shows. They approve with one tap and the amount is held; then THEY press the store’s pay button - you never press it.',
    input_schema:{ type:'object', properties:{
      store:{ type:'string', description:'The store’s address, e.g. amazon.es' },
      item:{ type:'string', description:'What is being bought, as the page names it' },
      total:{ type:'number', description:'The order total the checkout page shows, tax and delivery included' },
      currency:{ type:'string', description:'ISO currency code, e.g. EUR' } }, required:['store', 'item', 'total', 'currency'] } },
  { name:'confirm_purchase', description:'After the person has pressed the store’s own pay button, read the confirmation page and record the order. Pass the order number, the total and its currency exactly as the page shows them.',
    input_schema:{ type:'object', properties:{ order:{ type:'string' }, total:{ type:'number' }, currency:{ type:'string', description:'ISO currency code, e.g. EUR' } }, required:['order', 'total', 'currency'] } },
];

window.amvShop = {
  tools: SHOP_TOOLS,
  live: () => !!(MCP.live && MCP.live[MCP_BROWSER.id]) && !!(window.AMV_API && AMV_API.live),
  mine: (name) => !!_shopTool(name),
  consent: _shopConsent,
  check: _shopCheck,
  run: async (name, input) => name === 'propose_purchase' ? _shopPropose(input) : _shopConfirm(input),
  /* A new request ends the last one's shopping trip; signing out ends all. */
  reset: () => { SHOP.trips.clear(); SHOP.pending = null; SHOP.snap = { at: 0, text: '', host: '' }; },
  /* For the suite: the parts that read a page. */
  _labelOf: _shopLabelOf, _totalOnPage: _shopTotalOnPage, _isMoney: _shopIsMoney, _same: _shopSame, _state: SHOP,
};
