/* THE SPENDING LIMITS PANE - fetched the first time it is opened (the stub in
   25-money-family-ui.js loads it). It runs in the page's global scope and
   uses the page's helpers directly; its own redraws go back through the stub,
   which by then calls straight here. */
function _renderSpendingPaneNow(pane, redraw){
  const _again = (typeof redraw === 'function') ? redraw
               : function(){ try{ renderSetPane(); }catch(e){} };
  if(typeof AMVSpend === 'undefined'){ pane.innerHTML = '<h2 class="set-title">Spending</h2>'; return; }
  const c = AMVSpend.cfg();
  const spent = AMVSpend.spentThisMonth();
  const cap = +c.monthlyCap || 0;
  const pct = cap ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
  const comp = (typeof AMVCompliance !== 'undefined') ? AMVCompliance : null;
  const accepted = comp ? comp.accepted() : true;
  const ageKnown = comp ? comp.ageKnown() : true;
  const adult = comp ? comp.isAdult() : true;
  const hist = AMVSpend.history(25);

  /* ONE COLUMN, IN THE ORDER IT IS DECIDED (Nov 27, owner: "spending, what
     it is, then the maximum spent this month, auto spend off, then the
     limits, then save limits - very simple, centred, no lag").

     It was three fact cards and then the same three things again in a pane
     beneath them, the cards' buttons pressing the pane's controls - so
     "Turn on" scrolled away and said to accept the terms first, and the card
     changed only after the server answered. Now there is one of each: this
     month, the switch, the limits. The switch changes the moment it is
     pressed and goes back, saying why, if the account refuses; and where the
     terms are still to be accepted they open right under the switch, with
     the one button that accepts them and turns spending on. */
  const needTerms = !!(comp && !accepted), needAge = !!(comp && accepted && !ageKnown), minor = !!(comp && accepted && ageKnown && !adult);
  const inSettings = typeof redraw !== 'function';
  const money = (n) => _mfMoney(n);
  const stateLine = (on) => on ? T('AMV may buy within your limits') : T('AMV will not pay for anything');
  const consentBox = needTerms
    ? '<div class="mf-gate spx-consent" id="mf-consent" role="group" aria-labelledby="mf-gate-h" hidden>'+
        '<h3 id="mf-gate-h">'+escH(T('Before AMV can spend anything'))+'</h3>'+
        '<p>'+escH(T('Read what AMV can and cannot do with money, then accept. You can withdraw this at any time by turning spending off.'))+'</p>'+
        '<ul class="mf-terms">'+ (comp.SUMMARY||[]).map(x => '<li>'+escH(x)+'</li>').join('') +'</ul>'+
        '<button class="btn bp" id="mf-accept-terms" type="button">'+escH(T('I accept these terms'))+'</button></div>'
    : needAge
    ? '<div class="mf-gate spx-consent" id="mf-consent" role="group" aria-labelledby="mf-age-h" hidden>'+
        '<h3 id="mf-age-h">'+escH(T('Confirm your age'))+'</h3>'+
        '<p id="mf-age-why">Money features are for people ' + comp.ADULT_AGE + ' and over. We ask for the year only.</p>'+
        '<label class="lbl" for="mf-birth">Year you were born</label>'+
        '<input class="inp" id="mf-birth" type="number" inputmode="numeric" min="1900" max="'+(new Date().getFullYear())+'" '+
          'placeholder="1998" autocomplete="bday-year" aria-describedby="mf-age-why mf-age-say">'+
        '<div class="mf-say" id="mf-age-say" role="status" aria-live="polite"></div>'+
        '<button class="btn bp" id="mf-save-birth" type="button">'+escH(T('Confirm'))+'</button></div>'
    : '';

  pane.innerHTML =
    (inSettings ? '<h2 class="set-title">'+escH(T('Spending'))+'</h2>'+
      '<div class="set-sub">'+escH(T('When you ask chat or Crew to buy something, this decides whether AMV may pay for it, and caps what it spends in a month.'))+'</div>' : '')+
    '<div class="spx">'+
    /* This month: what is spent, of the most AMV may spend. */
    '<div class="spx-card spx-month" id="spv-money-facts">'+
      '<h3 class="spx-l">'+escH(T('Spent this month'))+'</h3>'+
      '<div class="spx-big"><b id="spx-spent">'+escH(money(spent))+'</b> <span id="spx-of">/ '+escH(money(cap))+'</span></div>'+
      '<div class="mf-bar" role="img" aria-label="'+escH(money(spent)+' / '+money(cap))+'"><span id="spx-bar" style="width:'+pct+'%"></span></div>'+
      '<div class="spx-s"><span>'+escH(T('Monthly maximum'))+': <b id="spx-cap">'+escH(money(cap))+'</b></span><span>'+escH(T('Left this month'))+': <b id="spx-left">'+escH(money(AMVSpend.remaining()))+'</b></span></div>'+
    '</div>'+
    /* The switch. */
    '<div class="spx-card spx-auto">'+
      '<div class="spx-auto-t"><h3 class="spx-l">'+escH(T('Auto-spend'))+'</h3>'+
        '<div class="spx-auto-s" id="spx-auto-s" role="status" aria-live="polite">'+escH(minor ? T('Money features are for adults.') : stateLine(c.enabled))+'</div>'+
        '<div class="mf-say" id="mf-auto-say" aria-live="assertive"></div></div>'+
      '<label class="sw"><input type="checkbox" id="mf-enabled" '+(c.enabled?'checked':'')+(minor?' disabled':'')+
        ' aria-label="'+escH(T('Let AMV spend money for me'))+'" aria-describedby="spx-auto-s"><span class="sw-sl"></span></label>'+
    '</div>'+
    consentBox +
    (minor ? '<div class="mf-gate warn" role="note"><h3>Money features are ' + comp.ADULT_AGE + '+</h3>'+
      '<p>Everything else in AMV keeps working. An adult can add you to their <b>Family</b> and set what AMV may spend for you.</p></div>' : '')+
    /* The limits, and the one button that saves them - not offered to
       somebody the account would refuse to spend for. */
    (minor ? '' : '<div class="spx-card spx-limits"><h3>'+escH(T('Limits'))+'</h3>'+
      '<div class="mf-grid">'+
        '<div><label class="lbl" for="mf-auto">Buy without asking, under</label>'+
          '<input class="inp" id="mf-auto" type="number" inputmode="decimal" min="0" step="1" value="'+escH(String(c.autoUnder))+'" '+
          'aria-describedby="mf-auto-h"><div class="mf-hint" id="mf-auto-h">Anything above this needs one tap from you.</div></div>'+
        '<div><label class="lbl" for="mf-per">Never spend more than, in one go</label>'+
          '<input class="inp" id="mf-per" type="number" inputmode="decimal" min="0" step="1" value="'+escH(String(c.perPurchase))+'" '+
          'aria-describedby="mf-per-h"><div class="mf-hint" id="mf-per-h">A hard stop for a single purchase.</div></div>'+
        '<div><label class="lbl" for="mf-cap">Monthly ceiling</label>'+
          '<input class="inp" id="mf-cap" type="number" inputmode="decimal" min="0" step="1" value="'+escH(String(c.monthlyCap))+'" '+
          'aria-describedby="mf-cap-h"><div class="mf-hint" id="mf-cap-h">Across everything. Resets on the first of the month.</div></div>'+
        /* The currency these numbers are in. A store charging another one is
           refused, never converted with a guessed rate (69-buying.js). */
        '<div><label class="lbl" for="mf-cur">Currency</label>'+
          '<select class="inp" id="mf-cur" aria-describedby="mf-cur-h">'+
            [...new Set([c.currency||'USD','USD','EUR','GBP','INR','BRL','MXN','CAD','AUD','JPY','KRW','CNY','IDR','TRY','SAR','AED','PKR','BDT','VND','NGN','ZAR','CHF','SEK','PLN','RUB'])]
              .map(k => '<option value="'+k+'"'+(k===(c.currency||'USD')?' selected':'')+'>'+k+'</option>').join('')+
          '</select><div class="mf-hint" id="mf-cur-h">Stores that charge in another currency are not bought from.</div></div>'+
      '</div>'+
      '<div class="mf-say" id="mf-limits-say" role="status" aria-live="polite"></div>'+
      '<button class="btn bp spx-save" id="mf-save-limits" type="button">'+escH(T('Save limits'))+'</button>'+
      /* Where the ceiling is actually held. Without a backend these numbers are
         a preference on this device, and saying otherwise would be the exact
         false reassurance this screen exists to avoid. */
      '<p class="mf-hint mf-where">'+ (AMVSpend.serverBacked()
        ? 'These limits are held on your account, so they apply on every device and cannot be raised from this browser.'
        : 'AMV is not connected to a backend yet, so these limits are kept on this device only. Once it is connected they move to your account and apply everywhere.') +'</p>'+
    '</div>')+
    (hist.length ?
      '<div class="spx-card"><h3>'+escH(T('Purchases'))+'</h3>'+
        '<table class="mf-tbl"><caption class="mf-cap">'+escH(T('Purchases recorded on this device'))+'</caption>'+
        '<thead><tr><th scope="col">When</th><th scope="col">Item</th><th scope="col">Where</th><th scope="col">Amount</th></tr></thead><tbody>'+
        hist.map(h => '<tr><td>'+escH(_mfWhen(h.at))+'</td><td>'+escH(h.item||'-')+'</td>'+
          '<td>'+escH(h.merchant||'-')+'</td><td>'+escH(_mfMoney(h.amount))+'</td></tr>').join('')+
        '</tbody></table></div>' : '')+
    /* What AMV bought in its browser, from the server's receipts
       (69-buying.js): store, total, order number, and whether the order was
       seen on the store's own confirmation page. */
    (AMVSpend.serverBacked() ? '<div class="spx-card" id="mf-buys"><h3>Bought in AMV’s browser</h3><div id="mf-buys-b" role="status" aria-live="polite"><p class="mf-empty">'+escH(T('Loading what AMV bought…'))+'</p></div></div>' : '')+
    /* How it works, folded, at the end: read when wanted, never in the way. */
    '<details class="set-fold mf-what"><summary class="set-fold-s">'+escH(T('How this works'))+'</summary><div class="set-merged">'+
      '<p>When AMV is doing a job for you and that job needs something bought - a domain for a site '+
      'it is deploying, an API key, a stock photo, a paid data source - this is what decides whether '+
      'it may buy it, and how much it may spend without stopping to ask you.</p>'+
      '<dl class="mf-src">'+
        '<div><dt>'+escH(T('Purchases'))+'</dt><dd>'+escH(T('Paid at the store’s own checkout, with the payment method you choose there. AMV never holds or sees it.'))+'</dd></div>'+
        '<div><dt>'+escH(T('Your AMV plan'))+'</dt><dd>'+escH(T('Billed separately, and not counted here.'))+' <button type="button" class="lnk-inline" data-dact="setTab" data-darg="billing">'+escH(T('Billing'))+'</button></dd></div>'+
        '<div><dt>'+escH(T('Connected banks'))+'</dt><dd>'+escH(T('Read only. AMV cannot pay from them or move money.'))+'</dd></div>'+
      '</dl>'+
      '<p><b>It is off until you turn it on.</b> With it off, AMV approves no purchase, however '+
      'it is asked - it stops and tells you what it needs instead.</p>'+
      '<ul class="mf-what-l">'+
        '<li><b>How it buys</b> - AMV fills in the store’s checkout in its browser and asks you first; '+
          'you press the store’s own pay button. It never presses it for you.</li>'+
        '<li><b>What it does not do</b> - it does not move money between your accounts or send money '+
          'to people. Switching this off stops any new purchase being approved; one you already paid for '+
          'at the store is between you and the store.</li>'+
        '<li><b>Why the limits matter</b> - the three numbers above are checked on your account before '+
          'each purchase is approved, and the amount is held against the month first. A store can still '+
          'charge more than it showed; when that happens it is booked and said on the receipt. The '+
          'monthly ceiling decides the most AMV can approve in a month, so set it to a number you would '+
          'not mind losing.</li>'+
        '<li><b>It is written down</b> - each purchase recorded on your account appears here with what '+
          'it was, where, and how much, and only you can see it.</li>'+
      '</ul>'+
    '</div></details>'+
    '<details class="set-fold"><summary class="set-fold-s">'+escH(T('Your responsibility'))+'</summary><div class="set-merged"><p class="mf-legal">'+escH(AMVSpend.TERMS)+'</p></div></details>'+
    '</div>';

  /* This month's figures, written in place - after a pull, a save or a switch -
     so nothing on the screen is drawn twice. */
  const paintMonth = () => {
    const cc = AMVSpend.cfg(), sp = AMVSpend.spentThisMonth(), cp = +cc.monthlyCap || 0;
    const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
    set('spx-spent', money(sp)); set('spx-of', '/ ' + money(cp)); set('spx-cap', money(cp)); set('spx-left', money(AMVSpend.remaining()));
    const bar = $('spx-bar'); if(bar) bar.style.width = (cp ? Math.min(100, Math.round(sp / cp * 100)) : 0) + '%';
    const sw = $('mf-enabled'); if(sw && !sw.disabled && !sw.dataset.busy) sw.checked = !!cc.enabled;
    const st = $('spx-auto-s'); if(st && !minor) st.textContent = stateLine(!!(sw ? sw.checked : cc.enabled));
  };

  /* EVERY STATE SAID, AND EVERY RECEIPT REACHABLE (Build 16 audit D16-02).
     The section stayed hidden when the request failed or came back with
     nothing, which read as "nothing bought"; and only the first 25 were ever
     shown. Now loading, could-not-load (with Retry), nothing yet and the
     list - all of it, 25 at a time - are four different things on screen. */
  /* Pages from the server (Build 17 audit B17-008): every receipt, the
     next page fetched only when somebody asks for more. Each says whether
     the person's computer saw the order on the store's page - reported, not
     verified: AMV has no line to the store (B17-006). */
  const _mfBuys = () => {
    const b = $('mf-buys-b'); if(!b) return;
    b.innerHTML = '<p class="mf-empty">'+escH(T('Loading what AMV bought…'))+'</p>';
    const fetchPage = (cursor) => AMV_API._fetch('/v1/spend/buys' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),{method:'GET'}).then(async r => {
      const d = await r.json().catch(() => null);
      if(!r.ok || !d || d.ok !== true || !Array.isArray(d.buys)) throw new Error('HTTP ' + r.status);
      return d;
    });
    const fail = (e) => {
      try{ console.error('AMV: could not load the purchase receipts', e); }catch(_){}
      const box = $('mf-buys-b'); if(!box) return;
      box.innerHTML = '<p class="mf-empty">'+escH(T('AMV could not load what it bought just now. This is not the same as nothing bought.'))+'</p>'
        + '<button type="button" class="btn bs" id="mf-buys-retry">'+escH(T('Try again'))+'</button>';
      on($('mf-buys-retry'),'click',_mfBuys);
    };
    fetchPage(null).then(d => {
      const box = $('mf-buys-b'); if(!box) return;
      const list = d.buys.slice(); let next = d.next || null;
      if(!list.length && !next){ box.innerHTML = '<p class="mf-empty">'+escH(T('Nothing has been bought in AMV’s browser yet.'))+'</p>'; return; }
      const fmt=(n,c)=>{ try{ return new Intl.NumberFormat(undefined,{style:'currency',currency:c}).format(+n||0); }catch(e){ return c+' '+n; } };
      let shown = 25;
      const draw = () => {
        const more = list.length > shown || !!next;
        box.innerHTML='<table class="mf-tbl"><thead><tr><th scope="col">When</th><th scope="col">Item</th><th scope="col">Store</th><th scope="col">Total</th><th scope="col">Order</th></tr></thead><tbody>'+
          list.slice(0,shown).map(x=>'<tr><td>'+escH(_mfWhen(x.at))+'</td><td>'+escH(x.item||'-')+'</td><td>'+escH(x.store||'-')+'</td><td>'+escH(fmt(x.total,x.currency))
            +(x.over>0?' <span class="mf-over">'+escH('+'+fmt(x.over,x.currency)+' over approved')+'</span>':'')+'</td><td>'+escH(x.order||'-')
            +' <span class="'+(x.seenOnPage?'mf-seen':'mf-over')+'">'+escH(x.seenOnPage?T('seen on the store’s page'):T('not seen on the page'))+'</span></td></tr>').join('')+'</tbody></table>'
          + (more ? '<button type="button" class="btn bs" id="mf-buys-more">'+escH(T('Show more'))+'</button>' : '');
        on($('mf-buys-more'),'click',async()=>{
          shown += 25;
          if(list.length < shown && next){
            const btn = $('mf-buys-more'); if(btn) btn.disabled = true;
            try{ const d2 = await fetchPage(next); list.push(...d2.buys); next = d2.next || null; }
            catch(e){ return fail(e); }
          }
          draw();
        });
      };
      draw();
    }).catch(fail);
  };
  if($('mf-buys')) _mfBuys();
  /* The switch: changed on the screen at once, saved behind it, and put back
     - with the reason - only if the account refuses. Where the terms (or the
     year of birth) are still to come, pressing it opens them right here
     instead, and accepting turns spending on in the same press. */
  const turnOn = async (want) => {
    const box = $('mf-enabled'); if(!box) return;
    box.checked = want; box.dataset.busy = '1';
    const st = $('spx-auto-s'); if(st) st.textContent = stateLine(want);
    try{
      const cur = AMVSpend.cfg();
      /* The state line above has already said it; nothing else moves. */
      _mfSay('mf-auto-say', '', '');
      await AMVSpend.push({ autoUnder:cur.autoUnder, perPurchase:cur.perPurchase, monthlyCap:cur.monthlyCap, enabled:want });
    }catch(e){
      /* Leaving the switch showing "off" while the account still allows spending
         is the one outcome worth reverting the control for. */
      box.checked = !want; if(st) st.textContent = stateLine(!want);
      _mfSay('mf-auto-say', (e && e.message) || T('Could not change that on your account. It is unchanged.'), 'err');
    }finally{ delete box.dataset.busy; paintMonth(); }
  };
  on($('mf-enabled'),'change',function(){
    const want = this.checked;
    const gate = $('mf-consent');
    if(want && gate){
      this.checked = false;
      gate.hidden = false;
      try{ gate.scrollIntoView({ block:'nearest', behavior:'smooth' }); }catch(e){}
      try{ (gate.querySelector('#mf-birth') || gate.querySelector('button')).focus({ preventScroll:true }); }catch(e){}
      return;
    }
    turnOn(want);
  });
  on($('mf-accept-terms'),'click',function(){
    try{ AMVCompliance.accept(); }catch(e){ toast(e.message||'Could not save that','error'); return; }
    /* The year of birth is the one step left, if it is not known: drawn in
       the same place, then the switch goes on. */
    if(comp && !comp.ageKnown()){
      _again();
      const g = $('mf-consent'); if(g){ g.hidden = false; try{ $('mf-birth').focus({ preventScroll:true }); }catch(e){} }
      return;
    }
    if(comp && !comp.isAdult()){ _again(); return; }
    const g = $('mf-consent'); if(g) g.remove();
    turnOn(true);
  });
  on($('mf-save-birth'),'click',function(){
    const v = ($('mf-birth')||{}).value;
    try{ AMVCompliance.setBirthYear(v); }
    catch(e){ _mfSay('mf-age-say', e.message || 'That year does not look right.', 'err'); $('mf-birth')?.focus(); return; }
    if(comp && !comp.isAdult()){ _again(); return; }
    const g = $('mf-consent'); if(g) g.remove();
    turnOn(true);
  });
  on($('mf-save-limits'),'click',async function(){
    const auto = +($('mf-auto')||{}).value, per = +($('mf-per')||{}).value, capv = +($('mf-cap')||{}).value;
    // Limits that contradict each other are worse than no limits, because the
    // user believes they are protected by a number that can never apply.
    if(![auto,per,capv].every(n => isFinite(n) && n >= 0)){
      _mfSay('mf-limits-say','Enter a number in each box.','err'); $('mf-auto')?.focus(); return;
    }
    if(auto > per){ _mfSay('mf-limits-say','The auto-buy limit cannot be higher than your single-purchase limit.','err'); $('mf-auto')?.focus(); return; }
    if(per > capv){ _mfSay('mf-limits-say','A single purchase cannot be larger than your whole monthly ceiling.','err'); $('mf-per')?.focus(); return; }
    const btn = this;
    btn.disabled = true; _mfSay('mf-limits-say','Saving to your account...','');
    try{
      /* What the server stored is what gets read back - it may have pulled a
         number down to its own ceiling, and the confirmation has to say the
         number that will really apply, not the one that was typed. */
      const r = await AMVSpend.push({ autoUnder:auto, perPurchase:per, monthlyCap:capv, currency:(($('mf-cur')||{}).value||'USD') });
      const L = r.limits;
      if($('mf-auto')) $('mf-auto').value = String(L.autoUnder);
      if($('mf-per')) $('mf-per').value = String(L.perPurchase);
      if($('mf-cap')) $('mf-cap').value = String(L.monthlyCap);
      const changed = (L.autoUnder !== auto || L.perPurchase !== per || L.monthlyCap !== capv);
      paintMonth();
      _mfSay('mf-limits-say',
        (changed ? 'Saved, adjusted to the highest AMV allows. ' : 'Saved. ')+
        'AMV buys under '+_mfMoney(L.autoUnder)+' on its own, asks up to '+_mfMoney(L.perPurchase)+
        ', and never passes '+_mfMoney(L.monthlyCap)+' a month.', 'ok');
    }catch(e){
      /* Saying "Saved" when the write failed would leave somebody believing a
         lower ceiling is in force while the old, higher one still is. */
      _mfSay('mf-limits-say', (e && e.message) || 'Could not save those limits. Your previous limits are still in force.', 'err');
    }finally{ btn.disabled = false; }
  });

  /* Adopt the server's numbers, written into the fields in place - the
     whole pane drawn again here was the jump the owner saw ("it shows
     something and then something else"). A field somebody is typing in is
     left alone. */
  if(AMVSpend.serverBacked() && !_SPEND_PULLED && !_SPEND_BUSY){
    _SPEND_BUSY = true;
    AMVSpend.pull().then(function(){
      _SPEND_PULLED = true; _SPEND_BUSY = false;
      const cc = AMVSpend.cfg();
      [['mf-auto','autoUnder'],['mf-per','perPurchase'],['mf-cap','monthlyCap']].forEach(([id,k]) => {
        const el = $(id); if(el && document.activeElement !== el) el.value = String(cc[k]); });
      const cur = $('mf-cur'); if(cur && document.activeElement !== cur && cc.currency) cur.value = cc.currency;
      paintMonth();
    }).catch(function(){
      /* Not fatal - the local mirror still renders. Marked pulled so a failed
         read does not retry on every redraw. */
      _SPEND_PULLED = true; _SPEND_BUSY = false;
      _mfSay('mf-limits-say','Could not check these against your account just now. These are this device\'s copy.','err');
    });
  }
}
try{ window._renderSpendingPaneNow=_renderSpendingPaneNow; }catch(e){}
