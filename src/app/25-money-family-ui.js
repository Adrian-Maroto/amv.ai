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
  on($('mf-enabled'),'change',function(){
    const cur = AMVSpend.cfg(); cur.enabled = this.checked; AMVSpend.save(cur);
    _mfSay('mf-limits-say', this.checked ? 'AMV can now spend within your limits.' : 'Spending is off. AMV will not pay for anything.', 'ok');
  });
  on($('mf-save-limits'),'click',function(){
    const auto = +($('mf-auto')||{}).value, per = +($('mf-per')||{}).value, capv = +($('mf-cap')||{}).value;
    // Limits that contradict each other are worse than no limits, because the
    // user believes they are protected by a number that can never apply.
    if(![auto,per,capv].every(n => isFinite(n) && n >= 0)){
      _mfSay('mf-limits-say','Enter a number in each box.','err'); $('mf-auto')?.focus(); return;
    }
    if(auto > per){ _mfSay('mf-limits-say','The auto-buy limit cannot be higher than your single-purchase limit.','err'); $('mf-auto')?.focus(); return; }
    if(per > capv){ _mfSay('mf-limits-say','A single purchase cannot be larger than your whole monthly ceiling.','err'); $('mf-per')?.focus(); return; }
    const cur = AMVSpend.cfg();
    cur.autoUnder = auto; cur.perPurchase = per; cur.monthlyCap = capv;
    AMVSpend.save(cur);
    _mfSay('mf-limits-say','Saved. AMV buys under '+_mfMoney(auto)+' on its own, asks up to '+_mfMoney(per)+', and never passes '+_mfMoney(capv)+' a month.','ok');
  });
}
try{ window._renderSpendingPane = _renderSpendingPane; }catch(e){}

/* ---------- FAMILY / LINKED ACCOUNTS ---------- */
function _renderFamilyPane(pane){
  if(typeof AMVFamily === 'undefined'){ pane.innerHTML = '<div class="set-title">Family &amp; linked accounts</div>'; return; }
  const m = AMVFamily.mine();
  const scopes = AMVFamily.SCOPES;
  const high = AMVFamily.HIGH_RISK || [];

  const linkRow = (l, dir) =>
    '<li class="mf-link"><div><div class="mf-link-a">'+escH(l.account)+'</div>'+
      '<div class="mf-link-s">'+(l.scopes||[]).map(s => escH(scopes[s]||s)).join(' · ')+'</div></div>'+
      '<button class="btn bs mf-revoke" type="button" data-link="'+escH(l.id)+'" '+
      'aria-label="Remove the link '+escH(dir==='out'?('to '+l.account):('that lets '+l.account+' access your account'))+'">Remove</button></li>';

  pane.innerHTML =
    '<div class="set-title">Family &amp; linked accounts</div>'+
    '<div class="set-sub">Let someone act on your account, or ask to act on theirs. Both sides have to agree, and either side can cut the link instantly.</div>'+

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
      (m.canAccessMe.length ? '<ul class="mf-list">'+ m.canAccessMe.map(l => linkRow(l,'in')).join('') +'</ul>'
        : '<p class="mf-empty">Nobody else can touch your account.</p>')+
      '<div class="mf-say" id="mf-links-say" role="status" aria-live="polite"></div>'+
    '</div>';

  on($('mf-invite'),'click',function(){
    const email = ($('mf-inv-email')||{}).value || '';
    const want = [...pane.querySelectorAll('input[name="mf-scope"]:checked')].map(x => x.value);
    const label = ($('mf-inv-label')||{}).value || '';
    try{
      const r = AMVFamily.invite(email, want, { label });
      // Honest about delivery: with no backend the code cannot be emailed, and
      // the link genuinely cannot be approved. Say that instead of implying it
      // was sent.
      _mfSay('mf-inv-say', r.delivery.how, r.delivery.sent ? 'ok' : 'warn');
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

  pane.querySelectorAll('.mf-revoke').forEach(b => b.addEventListener('click', function(){
    const id = this.dataset.link;
    const go = () => {
      // Re-render FIRST, then speak: saying it before the redraw wiped the
      // confirmation off the screen the instant it appeared.
      try{ AMVFamily.revoke(id); renderSetPane(); _mfSay('mf-links-say','Link removed. That access stopped immediately.','ok'); }
      catch(e){ _mfSay('mf-links-say', e.message || 'Could not remove that link.', 'err'); }
    };
    if(typeof confirmModal === 'function'){
      confirmModal('Remove this link?','Access stops straight away. You can always set it up again later.', go);
    } else go();
  }));
}
try{ window._renderFamilyPane = _renderFamilyPane; }catch(e){}
