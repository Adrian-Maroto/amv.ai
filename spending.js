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

  // What is standing between the user and being able to spend at all. Said up
  // front, because the alternative is a purchase failing for a reason that is
  // only explained after they have tried.
  let gate = '';
  if(comp && !accepted){
    gate = '<div class="mf-gate" role="group" aria-labelledby="mf-gate-h">'+
      '<h3 id="mf-gate-h">Before AMV can spend anything</h3>'+
      '<p>Read what AMV can and cannot do with money, then accept. You can withdraw this at any time by turning spending off.</p>'+
      '<ul class="mf-terms">'+ (comp.SUMMARY||[]).map(s => '<li>'+escH(s)+'</li>').join('') +'</ul>'+
      '<button class="btn bp" id="mf-accept-terms" type="button">I accept these terms</button></div>';
  } else if(comp && !ageKnown){
    gate = '<div class="mf-gate" role="group" aria-labelledby="mf-age-h">'+
      '<h3 id="mf-age-h">Confirm your age</h3>'+
      '<p id="mf-age-why">Money features are for people ' + comp.ADULT_AGE + ' and over. We ask for the year only.</p>'+
      '<label class="lbl" for="mf-birth">Year you were born</label>'+
      '<input class="inp" id="mf-birth" type="number" inputmode="numeric" min="1900" max="'+(new Date().getFullYear())+'" '+
        'placeholder="1998" autocomplete="bday-year" aria-describedby="mf-age-why mf-age-say">'+
      '<div class="mf-say" id="mf-age-say" role="status" aria-live="polite"></div>'+
      '<button class="btn bp" id="mf-save-birth" type="button">Confirm</button></div>';
  } else if(comp && !adult){
    gate = '<div class="mf-gate warn" role="note">'+
      '<h3>Money features are ' + comp.ADULT_AGE + '+</h3>'+
      '<p>Everything else in AMV keeps working. An adult can add you to their '+
      '<b>Family</b> and set what AMV may spend for you.</p></div>';
  }

  const canConfigure = !gate;

  pane.innerHTML =
    '<h2 class="set-title">What AMV may spend for you</h2>'+
    '<div class="set-sub">Set preferences for supported payment integrations. Browser checkout is completed by you.</div>'+
    /* What this IS, before what it is set to.

       The pane opened straight into three number fields. Somebody who has never
       heard of AMV spending money on their behalf met "Buy without asking,
       under" with no idea what would be bought, by what, or why they would want
       it - which is the worst possible first impression for the one screen
       about money. */
    /* Folded behind one line. The consent gate below is NOT - agreeing to it
       is the decision, and a decision is never hidden behind a tap. */
    '<details class="set-fold mf-what"><summary class="set-fold-s">What these settings control</summary><div class="set-merged">'+
      '<p>These are USD budget preferences for supported payment integrations. Linking a bank does not authorize payments or turn on a merchant integration.</p>'+
      '<p>Generic browser checkout and page changes require you to finish the step. A merchant charge completed by you is outside these limits. The monthly counter includes reservations, not just settled purchases.</p>'+
    '</div></details>'+
    gate +
    (canConfigure ?
    '<div class="ss2"><h3>Limits</h3>'+
      '<div class="prv-pref"><div><div class="prv-pref-t">Let AMV spend money for me</div>'+
        '<div class="prv-pref-s">Save an on/off preference. This does not activate a payment provider or authorize browser checkout.</div></div>'+
        '<label class="sw"><input type="checkbox" id="mf-enabled" '+(c.enabled?'checked':'')+
        ' aria-label="Let AMV spend money for me"><span class="sw-sl"></span></label></div>'+
      '<div class="mf-grid">'+
        '<div><label class="lbl" for="mf-auto">Buy without asking, under</label>'+
          '<input class="inp" id="mf-auto" type="number" inputmode="decimal" min="0" step="1" value="'+escH(String(c.autoUnder))+'" '+
          'aria-describedby="mf-auto-h"><div class="mf-hint" id="mf-auto-h">USD approval threshold for a supported purchase flow.</div></div>'+
        '<div><label class="lbl" for="mf-per">Never spend more than, in one go</label>'+
          '<input class="inp" id="mf-per" type="number" inputmode="decimal" min="0" step="1" value="'+escH(String(c.perPurchase))+'" '+
          'aria-describedby="mf-per-h"><div class="mf-hint" id="mf-per-h">USD limit for a supported, verified purchase flow.</div></div>'+
        '<div><label class="lbl" for="mf-cap">Monthly ceiling</label>'+
          '<input class="inp" id="mf-cap" type="number" inputmode="decimal" min="0" step="1" value="'+escH(String(c.monthlyCap))+'" '+
          'aria-describedby="mf-cap-h"><div class="mf-hint" id="mf-cap-h">For supported payment integrations. Resets on the first at 00:00 UTC.</div></div>'+
      '</div>'+
      '<div class="mf-say" id="mf-limits-say" role="status" aria-live="polite"></div>'+
      '<button class="btn bp" id="mf-save-limits" type="button">Save limits</button>'+
      /* Where the ceiling is actually held. Without a backend these numbers are
         a preference on this device, and saying otherwise would be the exact
         false reassurance this screen exists to avoid. */
      '<p class="mf-hint mf-where">'+ (AMVSpend.serverBacked()
        ? 'These preferences are saved to your account after server confirmation. They do not attest a merchant checkout amount.'
        : 'AMV is not connected to a backend yet, so these limits are kept on this device only. Local edits do not change a server spending policy.') +'</p>'+
    '</div>'+
    '<div class="ss2"><h3>This month</h3>'+
      '<div class="mf-bar" role="img" aria-label="'+escH(_mfMoney(spent))+' spent or reserved of '+escH(_mfMoney(cap))+'">'+
        '<span style="width:'+pct+'%"></span></div>'+
      '<div class="mf-bar-l">'+escH(_mfMoney(spent))+' spent or reserved · '+escH(_mfMoney(AMVSpend.remaining()))+' left of '+escH(_mfMoney(cap))+'</div>'+
    '</div>' : '')+
    '<div class="ss2"><h3>Purchases</h3>'+
      (hist.length ?
        '<table class="mf-tbl"><caption class="mf-cap">Recorded purchase history</caption>'+
        '<thead><tr><th scope="col">When</th><th scope="col">Item</th><th scope="col">Where</th><th scope="col">Amount</th></tr></thead><tbody>'+
        hist.map(h => '<tr><td>'+escH(_mfWhen(h.at))+'</td><td>'+escH(h.item||'-')+'</td>'+
          '<td>'+escH(h.merchant||'-')+'</td><td>'+escH(_mfMoney(h.amount))+'</td></tr>').join('')+
        '</tbody></table>'
        : '<p class="mf-empty">No purchases are recorded on this device. This is not a verified bank or merchant statement.</p>')+
    '</div>'+
    '<details class="set-fold"><summary class="set-fold-s">'+escH(T('Your responsibility'))+'</summary><div class="set-merged"><p class="mf-legal">'+escH(AMVSpend.TERMS)+'</p></div></details>';

  on($('mf-accept-terms'),'click',function(){
    try{ AMVCompliance.accept(); toast('Terms accepted','success',2500); _again(); }
    catch(e){ toast(e.message||'Could not save that','error'); }
  });
  on($('mf-save-birth'),'click',function(){
    const v = ($('mf-birth')||{}).value;
    try{
      AMVCompliance.setBirthYear(v);
      toast('Thanks - that is saved','success',2500); _again();
    }catch(e){ _mfSay('mf-age-say', e.message || 'That year does not look right.', 'err'); $('mf-birth')?.focus(); }
  });
  on($('mf-enabled'),'change',async function(){
    const want = this.checked, box = this;
    box.disabled = true;
    try{
      if(!AMVSpend.serverBacked()) throw new Error('Connect your account before changing its spending policy.');
      const cur = AMVSpend.cfg();
      await AMVSpend.push({ autoUnder:cur.autoUnder, perPurchase:cur.perPurchase,
                            monthlyCap:cur.monthlyCap, enabled:want });
      _mfSay('mf-limits-say', want ? 'Preference saved. Purchases still require a supported payment integration; browser checkout stays manual.' : 'Spending is off. AMV will not pay for anything.', 'ok');
    }catch(e){
      /* Leaving the switch showing "off" while the account still allows spending
         is the one outcome worth reverting the control for. */
      box.checked = !want;
      _mfSay('mf-limits-say', (e && e.message) || 'Could not change that on your account. It is unchanged.', 'err');
    }finally{ box.disabled = false; if(typeof _spvFillBalance==='function') _spvFillBalance(); }
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
      if(!AMVSpend.serverBacked()) throw new Error('Connect your account before saving account limits.');
      const r = await AMVSpend.push({ autoUnder:auto, perPurchase:per, monthlyCap:capv });
      const L = r.limits;
      if($('mf-auto')) $('mf-auto').value = String(L.autoUnder);
      if($('mf-per')) $('mf-per').value = String(L.perPurchase);
      if($('mf-cap')) $('mf-cap').value = String(L.monthlyCap);
      const changed = (L.autoUnder !== auto || L.perPurchase !== per || L.monthlyCap !== capv);
      _mfSay('mf-limits-say',
        (changed ? 'Saved, adjusted to the highest AMV allows. ' : 'Saved. ')+
        'Saved monthly cap: '+_mfMoney(L.monthlyCap)+'. This does not activate a payment integration.', 'ok');
    }catch(e){
      /* Saying "Saved" when the write failed would leave somebody believing a
         lower ceiling is in force while the old, higher one still is. */
      _mfSay('mf-limits-say', (e && e.message) || 'Could not save those limits. Your previous limits are still in force.', 'err');
    }finally{ btn.disabled = false; if(typeof _spvFillBalance==='function') _spvFillBalance(); }
  });

  /* Adopt the server's numbers, then redraw once. */
  if(canConfigure && AMVSpend.serverBacked() && !_SPEND_PULLED && !_SPEND_BUSY){
    _SPEND_BUSY = true;
    AMVSpend.pull().then(function(){
      _SPEND_PULLED = true; _SPEND_BUSY = false;
      try{ if(document.getElementById('mf-save-limits')) _again(); }catch(e){}
    }).catch(function(){
      /* Not fatal - the local mirror still renders. Marked pulled so a failed
         read does not retry on every redraw. */
      _SPEND_PULLED = true; _SPEND_BUSY = false;
      _mfSay('mf-limits-say','Could not check these against your account just now. These are this device\'s copy.','err');
    });
  }
}
try{ window._renderSpendingPaneNow=_renderSpendingPaneNow; }catch(e){}
