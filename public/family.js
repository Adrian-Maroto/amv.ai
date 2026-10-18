/* THE FAMILY PANE - fetched the first time it is opened (the stub in
   25-money-family-ui.js loads it). It runs in the page's global scope; its own
   redraws go back through the stub, which by then calls straight here. */
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

function _renderFamilyPaneNow(pane){
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
try{ window._renderFamilyPaneNow=_renderFamilyPaneNow; }catch(e){}
