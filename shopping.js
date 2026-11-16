/* SHOPPING IN AMV'S BROWSER (Nov 16, buying phase 1 - docs/BUYING.md).

   Fetched when AMV's browser is running (it is the only thing that uses it).
   Four things, each read from the live page rather than from the model:

   1. ONE APPROVAL PER SHOPPING TRIP. AMV's browser is AMV's own pinned
      connector (MCP_BROWSER), whose tools are known, so it can be trusted with
      a trip: the first action on a store asks once, and the rest of the trip
      on that store runs without a prompt per click. Any other site asks again.
      Third-party connectors keep their per-call consent - this is not them.
   2. MONEY BUTTONS STAY LOCKED. Before every click the page takes its own
      snapshot and reads the target's real label from it. A button or link
      named like Buy, Place order, Pay, Purchase, Confirm order is refused
      unless one purchase is armed for that store; so are Enter on a page that
      shows one, and a form sent with submit.
   3. THE PURCHASE CARD. propose_purchase is refused unless the browser is on
      that store and the total appears on the page. Otherwise the person sees
      item, store and total, and taps "Buy for $X" - or does not.
   4. HELD, THEN ARMED, THEN READ BACK. The amount is held on the server
      against their Spending limits (69-buying.js) before one money click is
      armed, for three minutes. confirm_purchase checks the order number and
      total on the confirmation page and settles the hold at the real total. */
const SHOP_MONEY = /\b(buy( it)?( now)?|place (my |your )?order|pay( now)?|purchase|complete (my |your )?(order|purchase)|confirm (and pay|order|purchase|payment)|submit (my |your )?order|checkout and pay|order now|book now|subscribe( now)?)\b/i;
const SHOP_ARM_MS = 3 * 60 * 1000;
const SHOP = { trips: new Set(), armed: null, clicked: null, snap: { at: 0, text: '', host: '' } };

const _shopAlias = (tool) => _mcpAliasFor(MCP_BROWSER.id, tool);
function _shopTool(name){ const who = mcpToolIdentity(name); return (who && who.id === MCP_BROWSER.id) ? who.tool : ''; }
const _shopHostOf = (u) => { try{ return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); }catch(e){ return ''; } };
const _shopSame = (host, store) => !!host && !!store && (host === store || host.endsWith('.' + store) || store.endsWith('.' + host));

/* The page as the browser has it now, read by the page itself. */
async function _shopSnap(fresh){
  if(!fresh && Date.now() - SHOP.snap.at < 1500) return SHOP.snap;
  const r = await runMcpTool(_shopAlias('browser_snapshot'), {});
  const text = String((r && r.text) || '');
  const m = /Page URL:\s*(\S+)/.exec(text);
  SHOP.snap = { at: Date.now(), text, host: m ? _shopHostOf(m[1]) : '' };
  return SHOP.snap;
}
function _shopLabelOf(text, ref){
  if(!ref) return '';
  const esc = String(ref).replace(/[^A-Za-z0-9_-]/g, '');
  const m = new RegExp('-\\s+([\\w-]+)(?:\\s+"([^"]*)")?[^\\n]*\\[ref=' + esc + '\\]').exec(text);
  return m ? ((m[1] || '') + ' ' + (m[2] || '')).trim() : '';
}
const _shopHasMoneyButton = (text) => [...String(text).matchAll(/-\s+(?:button|link)\s+"([^"]*)"/g)].some(m => SHOP_MONEY.test(m[1]));
/* The total as a page prints it: 1234.5 -> 1,234.50 / 1.234,50 / 1234.50 / 1234,50. */
function _shopTotalOnPage(text, total){
  const n = +total; if(!(n >= 0)) return false;
  const f = n.toFixed(2), [i, d] = f.split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const ways = [g + '.' + d, g.replace(/,/g, '.') + ',' + d, i + '.' + d, i + ',' + d, g.replace(/,/g, ' ') + ',' + d];
  if(d === '00') ways.push(g, i);
  return ways.some(w => new RegExp('(^|[^\\d.,])' + w.replace(/[.]/g, '\\.') + '(?![\\d])').test(text));
}

/* CONSENT for AMV's browser: once per store trip. */
async function _shopConsent(name, input){
  const tool = _shopTool(name);
  let host = '';
  if(tool === 'browser_navigate') host = _shopHostOf(_browserUrl(input && input.url));
  else { try{ host = (await _shopSnap(true)).host; }catch(e){ host = ''; } }
  if(host && SHOP.trips.has(host)) return true;
  const where = host || T('this site');
  const ok = await _showModalAsync({
    title: T('Let AMV shop on {0}?').replace('{0}', where),
    body: T('For this request AMV can search, open pages and fill in your cart and checkout on {0}, in AMV’s browser where you are signed in. It cannot pay: the last step needs your OK, and anything it buys is held against your Spending limits first.').replace('{0}', where)
      + (host ? '' : '\n\n' + T('AMV could not tell which site the browser is on, so it will ask again for the next step.')),
    okText: T('Let AMV shop'), cancelText: T('Not now'),
  });
  if(ok === true && host) SHOP.trips.add(host);
  return ok === true;
}

/* THE CHECK before AMV's browser acts: a money button is never pressed by
   accident, a prompt or a page that asked for it. Returns a refusal, or null. */
async function _shopCheck(name, input){
  const tool = _shopTool(name);
  const risky = tool === 'browser_click' || tool === 'browser_press_key' || tool === 'browser_type' || tool === 'browser_fill_form' || tool === 'browser_select_option';
  if(!risky) return null;
  let s;
  try{ s = await _shopSnap(true); }catch(e){ return { ok:false, text:'AMV could not read the page before acting, so it did not act. Try again.' }; }
  const armed = SHOP.armed && Date.now() < SHOP.armed.until && _shopSame(s.host, SHOP.armed.store);
  let money = false;
  if(tool === 'browser_click') money = SHOP_MONEY.test(_shopLabelOf(s.text, input && input.ref));
  else if(tool === 'browser_press_key') money = /^(Enter| |Space)$/i.test(String((input && input.key) || '')) && _shopHasMoneyButton(s.text);
  else if(input && input.submit === true) money = _shopHasMoneyButton(s.text);
  if(!money) return null;
  if(!armed) return { ok:false, text:'Refused: that would press a pay or place-order button, and no purchase has been approved. Get the checkout to its final review step, then call propose_purchase with the store, the item and the total the page shows - the person approves it with one tap.' };
  /* One click per approval. */
  SHOP.clicked = Object.assign({}, SHOP.armed, { at: Date.now() });
  SHOP.armed = null;
  return null;
}

async function _shopPropose(input){
  const store = String((input && input.store) || '').toLowerCase().replace(/^www\./, '').trim();
  const item = String((input && input.item) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const total = Math.round((+((input && input.total)) || 0) * 100) / 100;
  const currency = String((input && input.currency) || '').toUpperCase();
  if(!store || !item || !(total > 0) || !/^[A-Z]{3}$/.test(currency))
    return { ok:false, text:'propose_purchase needs the store (its address), the item, the total and the 3-letter currency, exactly as the checkout page shows them.' };
  let s;
  try{ s = await _shopSnap(true); }catch(e){ return { ok:false, text:'AMV could not read the checkout page, so nothing was proposed.' }; }
  if(!_shopSame(s.host, store)) return { ok:false, text:'The browser is on ' + (s.host || 'an unknown page') + ', not ' + store + '. Open the checkout there first.' };
  if(!_shopTotalOnPage(s.text, total)) return { ok:false, text:'The total ' + total.toFixed(2) + ' does not appear on the checkout page. Read the page again and pass the total it shows - AMV only proposes a price the person can see on the store’s own page.' };
  const money = (() => { try{ return new Intl.NumberFormat(undefined, { style:'currency', currency }).format(total); }catch(e){ return currency + ' ' + total.toFixed(2); } })();
  const ok = await _showModalAsync({
    title: T('Buy for {0}?').replace('{0}', money),
    body: item + '\n' + store + '\n\n' + T('{0}, as the store’s checkout page shows it. The store charges what you saved there; AMV holds the amount against your Spending limits first and reads the confirmation back.').replace('{0}', money),
    okText: T('Buy for {0}').replace('{0}', money), cancelText: T('Not now'),
  });
  if(ok !== true) return { ok:false, text:'The person chose not to buy it. Do not press the final button. Ask what they want instead.' };
  let d;
  try{
    const r = await AMV_API._fetch('/v1/spend/hold', { method:'POST', body: JSON.stringify({ amount: total, currency, store, item }) });
    d = await r.json().catch(() => ({}));
    if(!r.ok || !d.ok){
      const why = [d.need, d.message].filter(Boolean).join(' ') || d.error || 'The purchase could not be held.';
      return { ok:false, text:'Not bought: ' + why + ' Tell the person exactly this; do not press the final button.',
        render:'<div class="chat-buy bad"><b>' + escH(T('Not bought')) + '</b> ' + escH(why) + '</div>' };
    }
  }catch(e){ return { ok:false, text:'Not bought: AMV could not reach its server to hold the amount, so nothing was approved.' }; }
  SHOP.armed = { store, item, total, currency, hold: d.hold.id, until: Date.now() + SHOP_ARM_MS, money };
  /* If the click never comes, the hold is given back. */
  const hold = d.hold.id;
  setTimeout(() => {
    if(SHOP.armed && SHOP.armed.hold === hold){
      SHOP.armed = null;
      AMV_API._fetch('/v1/spend/release', { method:'POST', body: JSON.stringify({ hold }) })
        .catch(e => { try{ console.error('AMV: could not release a purchase hold', e); }catch(_){} });
    }
  }, SHOP_ARM_MS + 1000);
  return { ok:true, text:'Approved and held: ' + money + ' at ' + store + '. Now press the final place-order button ONCE (it is unlocked for three minutes), then read the confirmation page and call confirm_purchase with the order number and the total it shows.',
    render:'<div class="chat-buy"><b>' + escH(T('Approved')) + '</b> ' + escH(item) + ' · ' + escH(money) + ' · ' + escH(store) + '</div>' };
}

async function _shopConfirm(input){
  const c = SHOP.clicked;
  if(!c) return { ok:false, text:'There is no purchase waiting to be confirmed.' };
  const order = String((input && input.order) || '').trim().slice(0, 80);
  const total = Math.round((+((input && input.total)) || 0) * 100) / 100;
  if(!order) return { ok:false, text:'confirm_purchase needs the order number the confirmation page shows.' };
  let s = { text:'', host:'' };
  try{ s = await _shopSnap(true); }catch(e){}
  const seen = _shopSame(s.host, c.store) && s.text.indexOf(order) >= 0 && _shopTotalOnPage(s.text, total);
  let d;
  try{
    const r = await AMV_API._fetch('/v1/spend/settle', { method:'POST', body: JSON.stringify({ hold: c.hold, total, order, verified: seen }) });
    d = await r.json().catch(() => ({}));
    if(!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
  }catch(e){ return { ok:false, text:'The purchase may have gone through, but AMV could not record it (' + ((e && e.message) || 'error') + '). Tell the person to check the store’s confirmation email.' }; }
  SHOP.clicked = null;
  const rc = d.receipt || {};
  const money = (() => { try{ return new Intl.NumberFormat(undefined, { style:'currency', currency: rc.currency || c.currency }).format(rc.total); }catch(e){ return String(rc.total); } })();
  const note = !seen ? T('AMV could not find this order number and total on the store’s page - check the store’s confirmation email.')
             : rc.over > 0 ? T('The store charged more than you approved.')
             : T('Checked on the store’s confirmation page.');
  return { ok:true, text:'Recorded: ' + c.item + ', ' + money + ', order ' + order + (seen ? ' (seen on the confirmation page)' : ' (NOT found on the page - say so)') + (rc.over > 0 ? '. The store charged ' + rc.over + ' more than approved - tell the person.' : '.'),
    render:'<div class="chat-buy' + (seen && !(rc.over > 0) ? ' done' : ' bad') + '"><b>' + escH(T('Bought')) + '</b> ' + escH(c.item) + ' · ' + escH(money)
      + ' · ' + escH(T('Order {0}').replace('{0}', order)) + '<span class="chat-buy-n">' + escH(note) + '</span></div>' };
}

const SHOP_TOOLS = [
  { name:'propose_purchase', description:'Ask the person to approve a purchase. Use ONLY when they asked you to buy something and the checkout in AMV’s browser is on its final review step. Pass exactly what the page shows. They approve with one tap; only then is the final place-order button unlocked, for one press.',
    input_schema:{ type:'object', properties:{
      store:{ type:'string', description:'The store’s address, e.g. amazon.es' },
      item:{ type:'string', description:'What is being bought, as the page names it' },
      total:{ type:'number', description:'The order total the checkout page shows, tax and delivery included' },
      currency:{ type:'string', description:'ISO currency code, e.g. EUR' } }, required:['store', 'item', 'total', 'currency'] } },
  { name:'confirm_purchase', description:'After pressing the final place-order button, read the confirmation page and record the order. Pass the order number and total exactly as the page shows them.',
    input_schema:{ type:'object', properties:{ order:{ type:'string' }, total:{ type:'number' } }, required:['order', 'total'] } },
];

window.amvShop = {
  tools: SHOP_TOOLS,
  live: () => !!(MCP.live && MCP.live[MCP_BROWSER.id]) && !!(window.AMV_API && AMV_API.live),
  mine: (name) => !!_shopTool(name),
  consent: _shopConsent,
  check: _shopCheck,
  run: async (name, input) => name === 'propose_purchase' ? _shopPropose(input) : _shopConfirm(input),
  /* For the suite: the parts that read a page. */
  _labelOf: _shopLabelOf, _totalOnPage: _shopTotalOnPage, _state: SHOP,
};
