/* ============================================================
   SPENDING + FAMILY LINKS - the screens.

   AMVSpend, AMVFamily and AMVCompliance shipped as working logic with no
   way for anyone to reach them. Spending was enforced but not configurable;
   links could be created from chat but not seen, approved or revoked; and
   AMVCompliance.gate('spend') refuses every purchase until the user has
   accepted terms and confirmed their age, which there was no screen to do.
   That last one is a dead end: the product blocks you and offers no way out.

   Both panes are keyboard-operable and screen-reader labelled: every control
   has a real <label for>, the scope choices are a fieldset with a legend,
   results are announced through aria-live, and validation errors are tied to
   their input with aria-describedby rather than only turning something red.
   ============================================================ */

function _mfMoney(n){ return '$' + (+n || 0).toFixed(2); }
function _mfWhen(ts){
  try{ return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
  catch(e){ return ''; }
}
/* One place to say something happened, out loud for screen readers too. */
function _mfSay(id, msg, kind){
  const el = document.getElementById(id); if(!el) return;
  el.className = 'mf-say' + (kind ? ' ' + kind : '');
  el.textContent = msg || '';
}

/* ---------- SPENDING ---------- */
/* The limits shown here must be the ones the server will enforce, not the
   browser's copy of them. Pulled once per visit; the guard is on the REQUEST,
   not on the result, because the reply re-renders this pane and a result-only
   guard re-issues the fetch every redraw. */
let _SPEND_PULLED = false, _SPEND_BUSY = false;
function _renderSpendingPane(pane){
  if(typeof AMVSpend === 'undefined'){ pane.innerHTML = '<div class="set-title">Spending</div>'; return; }
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
      '<p>Everything else in AMV keeps working. An adult can set spending up on their own account, and link yours to it from '+
      '<b>Family &amp; linked accounts</b> if they want to buy things for you.</p></div>';
  }

  const canConfigure = !gate;

  pane.innerHTML =
    '<div class="set-title">Spending</div>'+
    '<div class="set-sub">What AMV is allowed to spend for you, and what it has actually spent. Nothing is bought outside these limits.</div>'+
    /* What this IS, before what it is set to.

       The pane opened straight into three number fields. Somebody who has never
       heard of AMV spending money on their behalf met "Buy without asking,
       under" with no idea what would be bought, by what, or why they would want
       it - which is the worst possible first impression for the one screen
       about money. */
    '<div class="ss2 mf-what"><h3>What this is</h3>'+
      '<p>When AMV is doing a job for you and that job needs something bought - a domain for a site '+
      'it is deploying, an API key, a stock photo, a paid data source - this is what decides whether '+
      'it may buy it, and how much it may spend without stopping to ask you.</p>'+
      '<p><b>It is off until you turn it on.</b> With it off, AMV will never pay for anything, however '+
      'it is asked - it stops and tells you what it needs instead.</p>'+
      '<ul class="mf-what-l">'+
        '<li><b>What it buys</b> - only things a job you started actually needs. Never a subscription, '+
          'never anything recurring, and never on a site you have not approved.</li>'+
        '<li><b>What it never does</b> - it does not move money between your accounts, does not send '+
          'money to people, and cannot spend anything after you switch this off.</li>'+
        '<li><b>Why the limits matter</b> - the three numbers below are hard stops, checked before '+
          'every purchase. The monthly ceiling is the one that decides the most you can lose in a bad '+
          'month, so set it to a number you would not mind losing.</li>'+
        '<li><b>Everything is written down</b> - every purchase appears below with what it was, where, '+
          'and how much, and it is only visible to you.</li>'+
      '</ul>'+
    '</div>'+
    gate +
    (canConfigure ?
    '<div class="ss2"><h3>Limits</h3>'+
      '<div class="prv-pref"><div><div class="prv-pref-t">Let AMV spend money for me</div>'+
        '<div class="prv-pref-s">Off means AMV will never pay for anything, however it is asked.</div></div>'+
        '<label class="sw"><input type="checkbox" id="mf-enabled" '+(c.enabled?'checked':'')+
        ' aria-label="Let AMV spend money for me"><span class="sw-sl"></span></label></div>'+
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
      '</div>'+
      '<div class="mf-say" id="mf-limits-say" role="status" aria-live="polite"></div>'+
      '<button class="btn bp" id="mf-save-limits" type="button">Save limits</button>'+
      /* Where the ceiling is actually held. Without a backend these numbers are
         a preference on this device, and saying otherwise would be the exact
         false reassurance this screen exists to avoid. */
      '<p class="mf-hint mf-where">'+ (AMVSpend.serverBacked()
        ? 'These limits are held on your account, so they apply on every device and cannot be raised from this browser.'
        : 'AMV is not connected to a backend yet, so these limits are kept on this device only. Once it is connected they move to your account and apply everywhere.') +'</p>'+
    '</div>'+
    '<div class="ss2"><h3>This month</h3>'+
      '<div class="mf-bar" role="img" aria-label="'+escH(_mfMoney(spent))+' spent of '+escH(_mfMoney(cap))+'">'+
        '<span style="width:'+pct+'%"></span></div>'+
      '<div class="mf-bar-l">'+escH(_mfMoney(spent))+' spent · '+escH(_mfMoney(AMVSpend.remaining()))+' left of '+escH(_mfMoney(cap))+'</div>'+
    '</div>' : '')+
    '<div class="ss2"><h3>Purchases</h3>'+
      (hist.length ?
        '<table class="mf-tbl"><caption class="mf-cap">Everything AMV has bought for you</caption>'+
        '<thead><tr><th scope="col">When</th><th scope="col">Item</th><th scope="col">Where</th><th scope="col">Amount</th></tr></thead><tbody>'+
        hist.map(h => '<tr><td>'+escH(_mfWhen(h.at))+'</td><td>'+escH(h.item||'-')+'</td>'+
          '<td>'+escH(h.merchant||'-')+'</td><td>'+escH(_mfMoney(h.amount))+'</td></tr>').join('')+
        '</tbody></table>'
        : '<p class="mf-empty">AMV has not bought anything for you. When it does, every purchase is listed here with the rule that allowed it.</p>')+
    '</div>'+
    '<div class="ss2"><h3>Your responsibility</h3><p class="mf-legal">'+escH(AMVSpend.TERMS)+'</p></div>';

  on($('mf-accept-terms'),'click',function(){
    try{ AMVCompliance.accept(); toast('Terms accepted','success',2500); renderSetPane(); }
    catch(e){ toast(e.message||'Could not save that','error'); }
  });
  on($('mf-save-birth'),'click',function(){
    const v = ($('mf-birth')||{}).value;
    try{
      AMVCompliance.setBirthYear(v);
      toast('Thanks - that is saved','success',2500); renderSetPane();
    }catch(e){ _mfSay('mf-age-say', e.message || 'That year does not look right.', 'err'); $('mf-birth')?.focus(); }
  });
  on($('mf-enabled'),'change',async function(){
    const want = this.checked, box = this;
    box.disabled = true;
    try{
      const cur = AMVSpend.cfg();
      await AMVSpend.push({ autoUnder:cur.autoUnder, perPurchase:cur.perPurchase,
                            monthlyCap:cur.monthlyCap, enabled:want });
      _mfSay('mf-limits-say', want ? 'AMV can now spend within your limits.' : 'Spending is off. AMV will not pay for anything.', 'ok');
    }catch(e){
      /* Leaving the switch showing "off" while the account still allows spending
         is the one outcome worth reverting the control for. */
      box.checked = !want;
      _mfSay('mf-limits-say', (e && e.message) || 'Could not change that on your account. It is unchanged.', 'err');
    }finally{ box.disabled = false; }
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
      const r = await AMVSpend.push({ autoUnder:auto, perPurchase:per, monthlyCap:capv });
      const L = r.limits;
      if($('mf-auto')) $('mf-auto').value = String(L.autoUnder);
      if($('mf-per')) $('mf-per').value = String(L.perPurchase);
      if($('mf-cap')) $('mf-cap').value = String(L.monthlyCap);
      const changed = (L.autoUnder !== auto || L.perPurchase !== per || L.monthlyCap !== capv);
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

  /* Adopt the server's numbers, then redraw once. */
  if(canConfigure && AMVSpend.serverBacked() && !_SPEND_PULLED && !_SPEND_BUSY){
    _SPEND_BUSY = true;
    AMVSpend.pull().then(function(){
      _SPEND_PULLED = true; _SPEND_BUSY = false;
      try{ if(document.getElementById('mf-save-limits')) renderSetPane(); }catch(e){}
    }).catch(function(){
      /* Not fatal - the local mirror still renders. Marked pulled so a failed
         read does not retry on every redraw. */
      _SPEND_PULLED = true; _SPEND_BUSY = false;
      _mfSay('mf-limits-say','Could not check these against your account just now. These are this device\'s copy.','err');
    });
  }
}
try{ window._renderSpendingPane = _renderSpendingPane; }catch(e){}

/* ---------- FAMILY / LINKED ACCOUNTS ---------- */
/* ============================================================
   AMV-102  THE PARENT'S PANEL.

   The controls underneath are real and enforced - a monthly cap checked in the
   same backstop that protects the plan, buying refused at the purchase, taking
   money out refused at the withdrawal. This is the screen that lets a parent
   actually use them, written for a parent rather than for whoever built it.

   Two rules it follows throughout:

     - Say what is visible and what is not, before anything else. A parent
       deciding whether to add their child needs to know they will not be able
       to read their conversations, and the child needs to know it too. Both
       sentences come from the server, so neither can drift from what is
       enforced.
     - Every control is one the parent can act on and the child cannot. Nothing
       here is a suggestion.
   ============================================================ */
let _FAM_STATE = null;
/* The server's list of who can reach this account. null = not asked yet. */
let _LINK_STATE = null;
/* In flight, as distinct from not yet asked. This pane now makes TWO
   independent requests, and each one's reply re-renders - so a guard that only
   asks "is the state still null" re-issues the other request every time its
   sibling lands, and the count grows with each redraw. Nothing loops forever,
   which is exactly why it would have gone unnoticed. */
let _FAM_BUSY = false, _LINK_BUSY = false;

function _famMoney(n){ return '$' + (Math.round((+n || 0) * 100) / 100).toFixed(2); }

function _famChildRow(m){
  const L = m.limits || {};
  const e = escH(m.email);
  return '<div class="fam-kid" data-fam-kid="'+e+'">'+
    '<div class="fam-kid-top">'+
      '<div class="fam-kid-who">'+e+'</div>'+
      '<button class="btn bs fam-kid-x" type="button" data-fam-remove="'+e+'">Remove</button>'+
    '</div>'+
    '<div class="fam-kid-ctl">'+
      '<div class="fam-ctl">'+
        '<label class="lbl" for="fam-cap-'+e+'">Monthly limit</label>'+
        '<input class="inp fam-cap" id="fam-cap-'+e+'" type="number" inputmode="decimal" min="0" max="500" step="1" value="'+escH(String(L.monthlyUSD||0))+'">'+
        '<div class="fam-hint">The most AMV will spend on their account in a month. Zero switches paid work off for them.</div>'+
      '</div>'+
      '<label class="fam-tog"><input type="checkbox" class="fam-mkt" '+(L.marketplace?'checked':'')+'>'+
        '<span><b>Can buy things</b> in the marketplace</span></label>'+
      '<label class="fam-tog"><input type="checkbox" class="fam-pay" '+(L.payouts?'checked':'')+'>'+
        '<span><b>Can take money out</b> of anything they sell</span></label>'+
    '</div>'+
    '<div class="fam-kid-act">'+
      '<button class="btn bp" type="button" data-fam-save="'+e+'">Save</button>'+
      '<span class="fam-say" data-fam-say="'+e+'" role="status" aria-live="polite"></span>'+
    '</div>'+
  '</div>';
}

function _famParentHTML(st){
  const p = st && st.parentOf;
  if(!p){
    return '<div class="ss2"><h3>Your family</h3>'+
      '<p class="fam-p">Add someone and you pay for their AMV, and you decide what it may spend on their '+
      'account, whether they can buy anything, and whether they can take money out. They keep their own '+
      'sign-in and their own conversations.</p>'+
      '<p class="fam-p fam-quiet">Nobody is in your family yet. Use the invitation below - the confirmation '+
      'code goes to <b>their</b> inbox, so naming an address is not enough.</p></div>';
  }
  const kids = p.members || [];
  return '<div class="ss2"><h3>Your family</h3>'+
    '<p class="fam-p">You pay for these accounts and you set what each of them may spend. '+
    'They keep their own sign-in and their own conversations.</p>'+
    '<div class="fam-seen">'+
      '<div class="fam-seen-col fam-can"><div class="fam-seen-h">You can see</div>'+
        '<ul><li>How much of each limit they have used</li><li>Which limits you have set</li></ul></div>'+
      '<div class="fam-seen-col fam-cant"><div class="fam-seen-h">You cannot see</div>'+
        '<ul><li>Their conversations</li><li>What they ask AMV</li><li>Anything AMV writes for them</li></ul></div>'+
    '</div>'+
    (kids.length ? kids.map(_famChildRow).join('')
      : '<p class="fam-p fam-quiet">Nobody is in your family yet.</p>')+
    '<p class="fam-p fam-quiet">'+kids.length+' of '+(p.max||5)+' accounts used.</p>'+
  '</div>';
}

function _famChildHTML(st){
  const c = st && st.childOf;
  if(!c) return '';
  const L = c.limits || {};
  return '<div class="ss2 fam-child-note"><h3>You are in '+escH(c.parent)+'\u2019s family</h3>'+
    '<p class="fam-p">They pay for your AMV. Here is exactly what that means, and it is the whole list.</p>'+
    '<div class="fam-seen">'+
      '<div class="fam-seen-col fam-can"><div class="fam-seen-h">They can see</div><ul>'+
        (c.canSee||[]).map(x=>'<li>'+escH(x)+'</li>').join('')+'</ul></div>'+
      '<div class="fam-seen-col fam-cant"><div class="fam-seen-h">They cannot see</div><ul>'+
        (c.cannotSee||[]).map(x=>'<li>'+escH(x)+'</li>').join('')+'</ul></div>'+
    '</div>'+
    '<div class="fam-mine">'+
      '<div><span class="fam-mine-k">Monthly limit</span><span class="fam-mine-v">'+escH(_famMoney(L.monthlyUSD))+'</span></div>'+
      '<div><span class="fam-mine-k">Buying things</span><span class="fam-mine-v">'+(L.marketplace?'On':'Off')+'</span></div>'+
      '<div><span class="fam-mine-k">Taking money out</span><span class="fam-mine-v">'+(L.payouts?'On':'Off')+'</span></div>'+
    '</div>'+
    '<p class="fam-p fam-quiet">Only they can change these. Ask them if you need more.</p>'+
    /* The way out. Without it, accepting an invitation once meant somebody else
       controlled this account's spending permanently - and AMV cannot tell a
       parent from a stranger who talked you into it. */
    '<button class="btn bs" id="fam-leave" style="font-size:12px;color:var(--red);border-color:var(--red)">Leave this family</button>'+
    '<div class="fam-say" id="fam-leave-say" role="status" aria-live="polite"></div>'+
  '</div>';
}

/* Wire the parent's controls. Each save sends only that child's settings, so
   two rows open at once cannot overwrite each other. */
function _wireFamilyChild(pane){
  on($('fam-leave'),'click',async()=>{
    const say=$('fam-leave-say');
    if(typeof confirm==='function' &&
       !confirm('Leave this family? Their limits stop applying to you, and they stop paying for your AMV.')) return;
    const b=$('fam-leave'); if(b){ b.disabled=true; b.textContent='Leaving\u2026'; }
    try{ await AMV_API.familyLeave(); _FAM_STATE=null; _renderFamilyPane(pane); }
    catch(e){
      if(b){ b.disabled=false; b.textContent='Leave this family'; }
      if(say) say.textContent=((e&&e.message)?e.message+' ':'')+'You are still in the family.';
    }
  });
}

function _wireFamilyParent(pane){
  pane.querySelectorAll('[data-fam-save]').forEach(b=>on(b,'click',async()=>{
    const em=b.dataset.famSave;
    const row=pane.querySelector('[data-fam-kid="'+CSS.escape(em)+'"]');
    const say=pane.querySelector('[data-fam-say="'+CSS.escape(em)+'"]');
    if(!row) return;
    const limits={
      monthlyUSD:+((row.querySelector('.fam-cap')||{}).value||0),
      marketplace:!!(row.querySelector('.fam-mkt')||{}).checked,
      payouts:!!(row.querySelector('.fam-pay')||{}).checked,
    };
    b.disabled=true; if(say) say.textContent='Saving\u2026';
    try{
      const d=await AMV_API.familyLimits(em, limits);
      /* Show what the SERVER stored, not what was typed - it bounds the number,
         and a screen that shows the typed value would quietly disagree with
         what is actually enforced. */
      if(say) say.textContent='Saved. Limit '+_famMoney(d.limits.monthlyUSD)+'.';
      const cap=row.querySelector('.fam-cap'); if(cap) cap.value=String(d.limits.monthlyUSD);
    }catch(e){
      /* Whatever the reason, the sentence a parent needs is that the limit is
         unchanged - a raw server message on its own reads like it might have
         half-worked. The reason follows it, if there is one worth showing. */
      const why=(e&&e.message)?(' ('+e.message+')'):'';
      if(say) say.textContent='Could not save, so nothing changed.'+why;
    }
    finally{ b.disabled=false; }
  }));
  pane.querySelectorAll('[data-fam-remove]').forEach(b=>on(b,'click',async()=>{
    const em=b.dataset.famRemove;
    if(typeof confirm==='function' && !confirm('Remove '+em+' from your family? Their limits stop applying and you stop paying for them.')) return;
    b.disabled=true;
    try{ await AMV_API.familyRemove(em); _FAM_STATE=null; _renderFamilyPane(pane); }
    catch(e){ b.disabled=false; toast((e&&e.message)||'Could not remove them','error'); }
  }));
}

function _renderFamilyPane(pane){
  if(typeof AMVFamily === 'undefined'){ pane.innerHTML = '<div class="set-title">Family</div>'; return; }
  /* Fetch once, then redraw with the real thing. Guarded on not already having
     it, because an unguarded redraw here is a fetch loop. */
  const needState = _FAM_STATE === null;
  const needLinks = _LINK_STATE === null;
  const local = AMVFamily.mine();
  /* The SERVER's answer about who can reach this account, with the local store
     as a fallback only when there is no backend to ask.

     This screen used to read the local store alone, which meant a second device
     showed nobody at all - and, far worse, "Remove" wrote `active:false` into
     localStorage and never told the server, while the server is the thing that
     actually authorises a linked account. So the one control that exists to cut
     somebody off reported "that access stopped immediately" and stopped
     nothing. */
  const m = _LINK_STATE
    ? { iCanAccess:_LINK_STATE.iCanAccess||[], canAccessMe:_LINK_STATE.canAccessMe||[],
        pendingForMe:local.pendingForMe, revoked:local.revoked }
    : local;
  const scopes = AMVFamily.SCOPES;
  const high = AMVFamily.HIGH_RISK || [];

  const linkRow = (l, dir) =>
    '<li class="mf-link"><div><div class="mf-link-a">'+escH(l.account)+'</div>'+
      '<div class="mf-link-s">'+(l.scopes||[]).map(s => escH(scopes[s]||s)).join(' · ')+'</div></div>'+
      '<button class="btn bs mf-revoke" type="button" data-link="'+escH(l.id)+'" '+
      'aria-label="Remove the link '+escH(dir==='out'?('to '+l.account):('that lets '+l.account+' access your account'))+'">Remove</button></li>';

  pane.innerHTML =
    '<div class="set-title">Family</div>'+
    '<div class="set-sub">Carry someone else\u2019s AMV the way a phone plan does - you pay, and you set what it may spend on their account. They keep their own sign-in and their own conversations.</div>'+
    /* The parent's panel first, because that is who this screen is for. The
       generic account-linking below it is a different, rarer thing. */
    _famParentHTML(_FAM_STATE)+
    _famChildHTML(_FAM_STATE)+
    '<div class="ss2"><h3>Linking accounts generally</h3>'+
      '<p class="fam-p fam-quiet">Separately from a family, two accounts can grant each other named permissions - '+
      'useful for an assistant or a colleague. Both sides have to agree and either side can cut it instantly.</p></div>'+

    '<div class="ss2"><h3>How this stays safe</h3>'+
      '<ul class="mf-terms">'+
        '<li>A link needs a request from one account and an approval from the other.</li>'+
        '<li>The approval code is sent to the inbox of the account being accessed, so naming an address is not enough - you have to control it.</li>'+
        '<li>You choose exactly what the link covers. Sending email, buying things and editing a calendar are never granted quietly.</li>'+
        '<li>Every cross-account action is written to a log both of you can read.</li>'+
      '</ul></div>'+

    '<div class="ss2"><h3>Ask for access to someone’s account</h3>'+
      '<label class="lbl" for="mf-inv-email">Their email address</label>'+
      '<input class="inp" id="mf-inv-email" type="email" autocomplete="email" placeholder="them@example.com" aria-describedby="mf-inv-say">'+
      '<fieldset class="mf-scopes"><legend>What should this link allow?</legend>'+
        Object.keys(scopes).map(k =>
          '<label class="mf-scope"><input type="checkbox" name="mf-scope" value="'+escH(k)+'"> '+
          '<span>'+escH(scopes[k])+(high.indexOf(k)>=0?' <em class="mf-hi">needs their explicit OK</em>':'')+'</span></label>').join('')+
      '</fieldset>'+
      '<label class="lbl" for="mf-inv-label">A name for this link (optional)</label>'+
      '<input class="inp" id="mf-inv-label" type="text" maxlength="40" placeholder="Mum’s account">'+
      '<div class="mf-say" id="mf-inv-say" role="status" aria-live="polite"></div>'+
      '<button class="btn bp" id="mf-invite" type="button">Send the request</button>'+
    '</div>'+

    '<div class="ss2"><h3>Waiting for your approval</h3>'+
      (m.pendingForMe.length ?
        '<ul class="mf-list">'+ m.pendingForMe.map(p =>
          '<li class="mf-pend"><div class="mf-link-a">'+escH(p.from)+' wants access to your account</div>'+
          '<div class="mf-link-s">'+(p.scopes||[]).map(s => escH(scopes[s]||s)).join(' · ')+'</div>'+
          '<label class="lbl" for="mf-code-'+escH(p.id)+'">Enter the 6-digit code we emailed you</label>'+
          '<div class="mf-codeline">'+
            '<input class="inp" id="mf-code-'+escH(p.id)+'" type="text" inputmode="numeric" maxlength="6" '+
              'autocomplete="one-time-code" placeholder="123456" aria-describedby="mf-code-say-'+escH(p.id)+'">'+
            '<button class="btn bp mf-approve" type="button" data-inv="'+escH(p.id)+'">Approve</button>'+
            '<button class="btn bs mf-deny" type="button" data-inv="'+escH(p.id)+'">Refuse</button>'+
          '</div>'+
          '<div class="mf-say" id="mf-code-say-'+escH(p.id)+'" role="status" aria-live="polite"></div></li>').join('')+'</ul>'
        : '<p class="mf-empty">Nobody is asking for access to your account.</p>')+
    '</div>'+

    '<div class="ss2"><h3>Accounts you can act on</h3>'+
      (m.iCanAccess.length ? '<ul class="mf-list">'+ m.iCanAccess.map(l => linkRow(l,'out')).join('') +'</ul>'
        : '<p class="mf-empty">None yet. Ask for access above.</p>')+
    '</div>'+

    '<div class="ss2"><h3>People who can act on yours</h3>'+
      /* "Nobody can touch your account" is a strong claim. It is only made when
         the server actually answered - if the list could not be loaded, saying
         it would be reassurance based on a failed request. */
      (m.canAccessMe.length ? '<ul class="mf-list">'+ m.canAccessMe.map(l => linkRow(l,'in')).join('') +'</ul>'
        : (_LINK_STATE && _LINK_STATE._failed)
          ? '<p class="mf-empty">Could not check who has access just now. This list is not complete - try again in a moment.</p>'
          : '<p class="mf-empty">Nobody else can touch your account.</p>')+
      '<div class="mf-say" id="mf-links-say" role="status" aria-live="polite"></div>'+
    '</div>';

  on($('mf-invite'),'click',function(){
    const email = ($('mf-inv-email')||{}).value || '';
    const want = [...pane.querySelectorAll('input[name="mf-scope"]:checked')].map(x => x.value);
    const label = ($('mf-inv-label')||{}).value || '';
    try{
      const r = AMVFamily.invite(email, want, { label });
      /* Honest about delivery: with no backend the code cannot be emailed, and
         the link genuinely cannot be approved. `sent === null` means the answer
         has not come back yet - the claim is corrected once it does, rather
         than announced before it is known. */
      _mfSay('mf-inv-say', r.delivery.how, r.delivery.sent === false ? 'warn' : 'info');
      if(r.delivery.settled){
        r.delivery.settled.then(d => {
          _mfSay('mf-inv-say', d.how, d.sent ? 'ok' : 'err');
        }).catch(()=>{});
      }
    }catch(e){
      _mfSay('mf-inv-say', e.message || 'That did not work.', 'err');
      $('mf-inv-email')?.focus();
    }
  });

  pane.querySelectorAll('.mf-approve').forEach(b => b.addEventListener('click', async function(){
    const id = this.dataset.inv;
    const code = (document.getElementById('mf-code-'+id)||{}).value || '';
    this.disabled = true; const was = this.textContent; this.textContent = 'Checking…';
    try{
      await AMVFamily.acceptRemote(id, code);
      toast('Link approved','success',3000); renderSetPane();
    }catch(e){
      _mfSay('mf-code-say-'+id, e.message || 'That code could not be verified.', 'err');
      this.disabled = false; this.textContent = was;
      document.getElementById('mf-code-'+id)?.focus();
    }
  }));

  pane.querySelectorAll('.mf-deny').forEach(b => b.addEventListener('click', function(){
    const id = this.dataset.inv;
    try{
      AMVFamily.refuse(id);
      _mfSay('mf-code-say-'+id, 'Refused. They were not given access, and the code no longer works.', 'ok');
      this.closest('.mf-pend')?.classList.add('mf-gone');
    }catch(e){ _mfSay('mf-code-say-'+id, e.message || 'Could not refuse that.', 'err'); }
  }));

  _wireFamilyParent(pane);
  _wireFamilyChild(pane);
  if(needState && !_FAM_BUSY && window.AMV_API && AMV_API.live && AMV_API.token){
    _FAM_BUSY = true;
    AMV_API.familyGet()
      .then(d => { _FAM_BUSY = false; _FAM_STATE = d; _renderFamilyPane(pane); })
      .catch(() => { _FAM_BUSY = false; _FAM_STATE = { parentOf:null, childOf:null }; });
  }
  /* Same shape, same trap: set on BOTH paths so a failure cannot leave this
     null and re-fetch on every redraw forever. */
  if(needLinks && !_LINK_BUSY && window.AMV_API && AMV_API.live && AMV_API.token){
    _LINK_BUSY = true;
    AMV_API.linkList()
      .then(d => { _LINK_BUSY = false; _LINK_STATE = d; _renderFamilyPane(pane); })
      /* Redrawn on failure too. Recording it without redrawing left the screen
         showing the empty local fallback, which reads as "nobody has access" -
         the one reassurance this pane must not give on a failed request. */
      .catch(() => { _LINK_BUSY = false; _LINK_STATE = { iCanAccess:[], canAccessMe:[], _failed:true }; _renderFamilyPane(pane); });
  }

  pane.querySelectorAll('.mf-revoke').forEach(b => b.addEventListener('click', function(){
    const id = this.dataset.link;
    const go = async () => {
      /* The SERVER decides whether that account can still act. Revoking used to
         write active:false into localStorage and say "that access stopped
         immediately" - which was false, because nothing had told the authority
         that enforces it. So the server goes first, and nothing is claimed
         unless it agreed. */
      const online = !!(window.AMV_API && AMV_API.live && AMV_API.token);
      if(online){
        this.disabled = true;
        try{
          await AMV_API.linkRevoke(id);
        }catch(e){
          this.disabled = false;
          _mfSay('mf-links-say', ((e&&e.message)||'Could not remove that link.')+
                 ' That account can still act - nothing was changed.', 'err');
          return;
        }
        /* Dropped from the cached list rather than re-fetched. Nulling it makes
           the redraw below fire a fresh request, whose late reply redraws again
           and wipes the confirmation off the screen - the same trap as writing
           a message before a re-render. */
        if(_LINK_STATE){
          _LINK_STATE = {
            iCanAccess:(_LINK_STATE.iCanAccess||[]).filter(l => l.id !== id),
            canAccessMe:(_LINK_STATE.canAccessMe||[]).filter(l => l.id !== id),
          };
        }
      }
      // Keep the local mirror in step, then re-render FIRST and speak after:
      // saying it before the redraw wiped the confirmation off the screen.
      try{ AMVFamily.revoke(id); }catch(e){}
      renderSetPane();
      _mfSay('mf-links-say', online
        ? 'Link removed. That access stopped immediately.'
        : 'Removed on this device. Connect AMV and it will stop on the server too.', online?'ok':'err');
    };
    if(typeof confirmModal === 'function'){
      confirmModal('Remove this link?','Access stops straight away. You can always set it up again later.', go);
    } else go();
  }));
}
try{ window._renderFamilyPane = _renderFamilyPane; }catch(e){}
