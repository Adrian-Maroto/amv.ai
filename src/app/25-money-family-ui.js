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
/* WHO REDRAWS THIS PANE IS NOT ALWAYS SETTINGS.

   It called `renderSetPane()` in four places - after accepting terms, after
   saving a birth year, and after the server's real limits come back. That is
   correct while this only ever lives inside Settings, and wrong the moment it
   is also the money section of the Spending tab: a pull finishing there would
   have thrown the person into Settings, or redrawn a pane that is not on
   screen and quietly dropped the server's numbers.

   So the caller says how to redraw itself. Settings passes nothing and keeps
   the behaviour it had. */
function _renderSpendingPane(pane, redraw){
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
    '<h2 class="set-title">Spending</h2>'+
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
      try{ if(document.getElementById('mf-save-limits')) _again(); }catch(e){}
    }).catch(function(){
      /* Not fatal - the local mirror still renders. Marked pulled so a failed
         read does not retry on every redraw. */
      _SPEND_PULLED = true; _SPEND_BUSY = false;
      _mfSay('mf-limits-say','Could not check these against your account just now. These are this device\'s copy.','err');
    });
  }
}
try{ window._renderSpendingPane = _renderSpendingPane; }catch(e){}

/* ---------- FAMILY ---------- */
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
/* Family invitations waiting for THIS account, from the server. null = not asked yet. */
let _FAM_PENDING = null;
/* In flight, as distinct from not yet asked. This pane makes TWO independent
   requests, and each one's reply re-renders - so a guard that only asks "is
   the state still null" re-issues the other request every time its sibling
   lands, and the count grows with each redraw. */
let _FAM_BUSY = false, _FAM_PEND_BUSY = false;
/* What was typed and what was last said, kept OUTSIDE the markup. The pane is
   redrawn whenever one of its two requests lands, and on a slow connection that
   can be after somebody pressed Send - which wiped the address and the answer,
   so they never learned whether the invitation went out. */
const _FAM_UI = { email: '', say: '' };

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
      '<p class="fam-p fam-quiet">Nobody is in your family yet.</p></div>';
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
    '<button class="btn bs" id="fam-leave" style="font-size:var(--t-sm);color:var(--red-txt);border-color:var(--red-txt)">Leave this family</button>'+
    '<div class="fam-say" id="fam-leave-say" role="status" aria-live="polite"></div>'+
  '</div>';
}

/* Wire the parent's controls. Each save sends only that child's settings, so
   two rows open at once cannot overwrite each other. */
function _wireFamilyChild(pane){
  on($('fam-leave'),'click',async()=>{
    const say=$('fam-leave-say');
    if(!await _askDestructive('Leave this family?',
        'Their limits stop applying to you, and they stop paying for your AMV. You go back to your own plan.',
        'Leave family')) return;
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
    if(!await _askDestructive('Remove '+em+' from your family?',
        'Their limits stop applying and you stop paying for them. You can invite them again later.',
        'Remove them')) return;
    b.disabled=true;
    try{ await AMV_API.familyRemove(em); _FAM_STATE=null; _renderFamilyPane(pane); }
    catch(e){ b.disabled=false; toast((e&&e.message)||'Could not remove them','error'); }
  }));
}

function _famRedraw(pane){
  const live = (pane && pane.isConnected) ? pane : document.querySelector('[data-fam-pane]');
  if(live) _renderFamilyPane(live);
}
function _renderFamilyPane(pane){
  /* FAMILY, AND NOTHING ELSE THAT REACHES INTO SOMEBODY'S ACCOUNT.

     This pane also offered "ask for access to someone's account": read their
     email, send as them, change their calendar, spend on their account. The
     owner removed that as the security risk it is - one account reaching into
     another is the account-takeover feature, however carefully it is gated -
     and the server now refuses it (link_removed). What stays is Family: a
     parent pays for a child's AMV and sets what it may spend, and never sees
     what the child writes.

     And Family now works end to end. The page had no way to send a family
     invitation at all, and a child could only accept in the browser that sent
     it - so for a parent and a child, never. The parent's form below sends it;
     the child's list comes from the server, on any device. */
  const needState = _FAM_STATE === null;
  const needPending = _FAM_PENDING === null;
  const online = !!(window.AMV_API && AMV_API.live && AMV_API.hasSession);
  /* Marked, so an answer that lands after Settings has redrawn paints the pane
     that is on screen, not the one it was asked from - which is detached, and
     painting it shows the person nothing. */
  try{ pane.setAttribute('data-fam-pane', '1'); }catch(e){}
  const pend = (_FAM_PENDING && _FAM_PENDING.invitations) || [];

  pane.innerHTML =
    '<h2 class="set-title">Family</h2>'+
    '<div class="set-sub">Pay for someone’s AMV and set what it may spend. They keep their own sign-in and their own conversations.</div>'+
    (pend.length ?
      '<div class="ss2 fam-inbox"><h3>Invitations for you</h3>'+
        pend.map(p =>
          '<div class="fam-inv" data-fam-inv="'+escH(p.id)+'">'+
            '<p class="fam-p"><b>'+escH(p.from)+'</b> wants to add you to their family. They would pay for your AMV and set what it may spend. They could not see your conversations.</p>'+
            '<label class="lbl" for="fam-code-'+escH(p.id)+'">Code from the email we sent you</label>'+
            '<div class="mf-codeline">'+
              '<input class="inp" id="fam-code-'+escH(p.id)+'" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456">'+
              '<button class="btn bp" type="button" data-fam-accept="'+escH(p.id)+'">Join</button>'+
              '<button class="btn bs" type="button" data-fam-decline="'+escH(p.id)+'">Decline</button>'+
            '</div>'+
            '<div class="fam-say" data-fam-inv-say="'+escH(p.id)+'" role="status" aria-live="polite"></div>'+
          '</div>').join('')+
      '</div>' : '')+
    _famParentHTML(_FAM_STATE)+
    _famChildHTML(_FAM_STATE)+
    ((_FAM_STATE && _FAM_STATE.childOf) ? '' :
      '<div class="ss2"><h3>Add someone to your family</h3>'+
        '<label class="lbl" for="fam-inv-email">Their email address</label>'+
        '<div class="mf-codeline">'+
          '<input class="inp" id="fam-inv-email" type="email" autocomplete="email" placeholder="them@example.com" value="'+escH(_FAM_UI.email)+'">'+
          '<button class="btn bp" type="button" id="fam-inv-send">Send invitation</button>'+
        '</div>'+
        '<p class="fam-p fam-quiet">They get a code by email and join from their own account, under Settings, Family. Naming an address is never enough.</p>'+
        '<div class="fam-say" id="fam-inv-say" role="status" aria-live="polite">'+escH(_FAM_UI.say)+'</div>'+
      '</div>')+
    (online ? '' : '<p class="fam-p fam-quiet">Sign in to AMV to use Family - invitations and limits live on the server.</p>');

  _wireFamilyParent(pane);
  _wireFamilyChild(pane);

  on($('fam-inv-email'),'input',function(){ _FAM_UI.email=this.value; });
  /* Said into whichever copy of the pane is on screen, and remembered for the
     next redraw. */
  const famSay=(t)=>{ _FAM_UI.say=t; const el=document.getElementById('fam-inv-say'); if(el) el.textContent=t; };
  on($('fam-inv-send'),'click',async()=>{
    const btn=$('fam-inv-send');
    const email=(($('fam-inv-email')||{}).value||'').trim();
    _FAM_UI.email=email;
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ famSay('Enter their email address.'); return; }
    if(!online){ famSay('Sign in to AMV first - the invitation is sent by the server.'); return; }
    btn.disabled=true; famSay('Sending\u2026');
    try{
      const d=await AMV_API.familyInvite(email);
      /* What the server says happened, not what was hoped: a code that could
         not be emailed is an invitation nobody can accept. */
      if(d.delivered){
        _FAM_UI.email='';
        const i=document.getElementById('fam-inv-email'); if(i) i.value='';
        famSay('Sent. '+email+' has a code in their inbox, valid for 24 hours.');
      } else famSay('The invitation was made but the email did not go out. Try again in a moment.');
    }catch(e){
      famSay(((e&&e.message)||'Could not send that.')+' Nothing was sent.');
    }finally{ const b2=document.getElementById('fam-inv-send'); if(b2) b2.disabled=false; }
  });

  pane.querySelectorAll('[data-fam-accept]').forEach(b=>on(b,'click',async()=>{
    const id=b.dataset.famAccept;
    const say=pane.querySelector('[data-fam-inv-say="'+CSS.escape(id)+'"]');
    const code=((document.getElementById('fam-code-'+id)||{}).value||'').trim();
    if(!/^\d{6}$/.test(code)){ if(say) say.textContent='Enter the 6-digit code from the email.'; return; }
    b.disabled=true; if(say) say.textContent='Checking…';
    try{
      await AMV_API.familyAccept(id, code);
      _FAM_STATE=null; _FAM_PENDING=null; _renderFamilyPane(pane);
    }catch(e){
      b.disabled=false;
      if(say) say.textContent=((e&&e.message)||'That code could not be checked.')+' You have not joined.';
    }
  }));
  pane.querySelectorAll('[data-fam-decline]').forEach(b=>on(b,'click',async()=>{
    const id=b.dataset.famDecline;
    const say=pane.querySelector('[data-fam-inv-say="'+CSS.escape(id)+'"]');
    b.disabled=true;
    try{
      await AMV_API.familyDecline(id);
      _FAM_PENDING=null; _renderFamilyPane(pane);
    }catch(e){
      b.disabled=false;
      if(say) say.textContent=((e&&e.message)||'Could not decline that.')+' It is still waiting.';
    }
  }));

  /* Each asked once, and set on BOTH paths so a failure cannot re-ask on every
     redraw. A failed list of invitations is said, not shown as "none". */
  if(needState && !_FAM_BUSY && online){
    _FAM_BUSY = true;
    AMV_API.familyGet()
      .then(d => { _FAM_BUSY = false; _FAM_STATE = d; _famRedraw(pane); })
      .catch(() => { _FAM_BUSY = false; _FAM_STATE = { parentOf:null, childOf:null }; _famRedraw(pane); });
  }
  if(needPending && !_FAM_PEND_BUSY && online){
    _FAM_PEND_BUSY = true;
    AMV_API.familyPending()
      .then(d => { _FAM_PEND_BUSY = false; _FAM_PENDING = d; _famRedraw(pane); })
      .catch(() => { _FAM_PEND_BUSY = false; _FAM_PENDING = { invitations:[] }; });
  }
}
try{ window._renderFamilyPane = _renderFamilyPane; }catch(e){}
