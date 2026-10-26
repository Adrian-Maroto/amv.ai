/* THE INVEST PANE - fetched the first time it is opened (22-finance.js has
   the stub that loads it). Few accounts open it, and every visitor used to
   download it with the page. It runs in the same global scope as the page, so
   it uses the page's helpers directly; its own redraws go back through the
   stub, which by then calls straight here. */
function _renderInvestPaneNow(pane){
  const linked=(typeof AMVFinance!=='undefined') && AMVFinance.linked();
  const backend=(()=>{ try{ return !!apiBase(); }catch(e){ return false; } })();
  /* Ask the server what is actually true, then redraw only if it disagrees with
     what was just drawn. Without this the pane would keep showing whatever the
     last cached answer was - including on another device, where the cache is
     empty and a linked account would look unlinked. Guarded on a change so this
     cannot become a render loop. */
  try{
    if(backend && typeof AMVFinance!=='undefined' && !pane._invChecked){
      pane._invChecked=1;
      AMVFinance.refresh().then(st=>{
        if(!!st.linked !== !!linked) _renderInvestPane(pane);
      }).catch(()=>{});
    }
  }catch(e){}
  const when=_invWhen();

  pane.innerHTML=
    '<h2 class="set-title">Investing</h2>'+
    '<div class="set-sub">Link an investment account and AMV tells you how it is doing, as often as you like.</div>'+
    /* Folded: the four promises are there for whoever wants them, not stacked
       above the one button somebody came here to press. */
    '<details class="set-fold set-what"><summary class="set-fold-s">'+escH(T('How this works'))+'</summary><div class="set-merged">'+
      '<p>A check-in, not a dashboard. Each one records where your investments stand and tells you what '+
      'changed since the last one - the amount and the percentage, broken down by account.</p>'+
      '<ul class="mf-what-l">'+
        '<li><b>It can only look.</b> AMV reads balances. It cannot buy, sell, or move anything, and there '+
          'is no setting that would let it.</li>'+
        '<li><b>Your login never touches AMV.</b> You sign in with your institution through their own flow; '+
          'AMV only ever holds a read token, and it stays on the server.</li>'+
        '<li><b>Investment accounts only.</b> A current account swinging with payday and rent is noise in '+
          'the question of how your investments are doing.</li>'+
        '<li><b>No number is ever guessed.</b> If your institution cannot be reached, this says so instead '+
          'of showing you the last figure it happened to have.</li>'+
      '</ul>'+
    '</div></details>'+
    (!backend
      ? '<div class="ss2"><h3>Not connected yet</h3><p class="fam-p fam-quiet">Bank data is read through your '+
        'AMV backend so your tokens never reach the browser. Connect it and this starts working.</p></div>'
      : !linked
      ? '<div class="ss2"><h3>Link an account</h3>'+
        '<p class="fam-p fam-quiet">You will sign in with your institution directly. AMV never sees your '+
        'username or password.</p>'+
        '<button class="btn bp" id="inv-link" style="font-size:var(--t-sm)">Link an investment account</button>'+
        '<div class="fam-say" id="inv-link-say" role="status" aria-live="polite"></div></div>'
      : '<div class="ss2"><h3>How it is doing</h3>'+
        '<div id="inv-out"><p class="fam-p fam-quiet">Check now to see where you stand.</p></div>'+
        '<button class="btn bp" id="inv-now" style="font-size:var(--t-sm)">Check now</button> '+
        /* Connecting a bank must be as easy to undo as it was to do. */
        '<button class="btn bs" id="inv-unlink" style="font-size:var(--t-sm)">Disconnect</button>'+
        '<div class="fam-say" id="inv-say" role="status" aria-live="polite"></div></div>'+
        '<div class="ss2"><h3>Tell me automatically</h3>'+
          '<p class="fam-p fam-quiet">AMV runs the check on its own and brings you the answer. '+
          'You can change or stop this at any time.</p>'+
          '<div class="inv-when">'+
            INVEST_WHEN.map(w=>'<button class="btn '+(when===w.k?'bp':'bs')+' inv-when-b" data-inv-when="'+w.k+'">'+
              escH(w.label)+'</button>').join('')+
            (when?'<button class="btn bs inv-when-b" data-inv-when="" style="color:var(--red-txt);border-color:var(--red-txt)">Stop</button>':'')+
          '</div>'+
          '<div class="fam-say" id="inv-when-say" role="status" aria-live="polite">'+
            (when?escH('AMV checks '+((INVEST_WHEN.find(w=>w.k===when)||{}).detail||when)+' and tells you.'):'')+
          '</div>'+
        '</div>');

  on($('inv-link'),'click',async()=>{
    const say=$('inv-link-say');
    const btn=$('inv-link');
    if(btn) btn.disabled=true;
    if(say) say.textContent='Opening your institution\u2019s secure sign-in\u2026';
    /* Opened during the click. Awaiting linkStart first spends the user
       activation, and a blocked window here means somebody cannot connect a
       bank account at all - see _preopenPay. */
    const pre=(typeof _preopenPay==='function')?_preopenPay():null;
    try{
      const url=await AMVFinance.linkStart();
      /* Remembered so the return can be recognised even if they come back in a
         new tab, or the redirect drops the query string. */
      try{ saveStr('amv_fin_pending','1'); }catch(e){}
      if(say) say.textContent='Continue in the window that opened. Come back here when you are done.';
      _openExternalPay(url,null,'finance',pre);
      /* Replaced rather than renamed. Changing the id left THIS handler still
         bound to the same element, so the next click - the one labelled "I have
         finished linking" - started a second link and opened another sign-in
         window at the institution, on top of finishing the first. A fresh node
         carries no listeners. */
      if(btn && btn.parentNode){
        const done=btn.cloneNode(false);
        done.disabled=false; done.textContent='I have finished linking'; done.id='inv-link-done';
        btn.parentNode.replaceChild(done, btn);
      }
      _wireInvDone(pane);
    }catch(e){
      if(typeof _closePay==='function') _closePay(pre);
      if(btn) btn.disabled=false;
      /* needs_service is the operator not having switched it on, which is a
         different thing from a failure and is said as itself. */
      if(say) say.textContent = (e&&e.code==='needs_service')
        ? 'Account linking is not switched on for this deployment yet, so nothing was started.'
        : ((e&&e.message)||'Could not start the link.')+' Nothing was linked.';
    }
  });
  _wireInvDone(pane);

  on($('inv-unlink'),'click',async()=>{
    const say=$('inv-say');
    if(!await _askDestructive('Disconnect this account?',
        'AMV stops reading it, and the history it compares against is deleted. This cannot be undone.',
        'Disconnect')) return;
    try{
      await AMVFinance.unlink();
      _renderInvestPane(pane);
      const s=$('inv-link-say'); if(s) s.textContent='Disconnected. AMV can no longer read that account.';
    }catch(e){
      if(say) say.textContent=((e&&e.message)||'Could not disconnect.')+' The account is still connected.';
    }
  });

  on($('inv-now'),'click',async()=>{
    const btn=$('inv-now'), say=$('inv-say'), out=$('inv-out');
    if(btn){ btn.disabled=true; btn.textContent='Checking\u2026'; }
    if(say) say.textContent='';
    try{
      const d=await AMVFinance.checkin();
      if(out) out.innerHTML=_invResultHTML(d);
      _INV_LAST_OK=Date.now();
    }catch(e){
      if(say) say.textContent=(e&&e.message)||'Could not reach your institution, so there is nothing to show.';
      /* Figures already on screen are from an earlier check, and leaving them
         sitting there unlabelled next to an error makes them indistinguishable
         from current ones - which on a screen about somebody's savings is the
         same as showing a wrong number. They stay, because losing them helps
         nobody, but they are stamped with when they were actually taken. */
      const res=out&&out.querySelector('.inv-res');
      if(res && !res.querySelector('.inv-stale')){
        /* Stamped with when the figures were actually taken, not with now. It
           used to format the CURRENT time and then say "earlier today", so a
           check-in from three days ago was labelled as today's - a false
           statement about somebody's savings, which is the one thing the top of
           this file says it will not do. */
        let when='';
        try{ if(_INV_LAST_OK) when=new Date(_INV_LAST_OK).toLocaleString(undefined,
          { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }catch(_){}
        res.insertAdjacentHTML('afterbegin',
          '<div class="inv-stale">These figures are from the last successful check'+
          (when?' on '+escH(when):'')+', not from now.</div>');
      }
    }finally{ if(btn){ btn.disabled=false; btn.textContent='Check again'; } }
  });

  pane.querySelectorAll('[data-inv-when]').forEach(b=>on(b,'click',async()=>{
    const k=b.dataset.invWhen;
    const say=$('inv-when-say');
    /* The job that is already running, if any. Without this, picking a new
       frequency left the old one running and you got two check-ins, and "Stop"
       cleared a setting on this device while the server kept checking - the
       screen would have said stopped and been wrong. */
    const prev=loadStr('amv_inv_auto')||'';
    let stillRunning=!!prev;
    const dropPrev=async()=>{
      if(!prev) return;
      /* Read the answer before declaring it stopped. `_fetch` resolves for
         every status except 401, so awaiting and moving on set stillRunning to
         false over a refusal - and the comment above is precisely about not
         doing that: the server would have carried on checking somebody's bank
         account while the screen said it had stopped. Throwing here is what
         the caller's catch is already written for. */
      const r=await AMV_API._fetch('/auto/update',{method:'POST',
        body:JSON.stringify({id:prev,action:'delete'})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok || d.error) throw new Error(_refusalText(d, 'the server would not stop it'));
      stillRunning=false;
      try{ saveStr('amv_inv_auto',''); }catch(e){}
    };

    if(!k){
      if(say) say.textContent='Stopping\u2026';
      try{
        await dropPrev();
        try{ saveStr('amv_inv_when',''); }catch(e){}
        _renderInvestPane(pane);
        const s0=$('inv-when-say');
        if(s0) s0.textContent='Stopped. AMV will not check on its own.';
      }catch(e){
        /* Still scheduled, so the screen must keep saying so. */
        _renderInvestPane(pane);
        const s0=$('inv-when-say');
        if(s0) s0.textContent=((e&&e.message)?e.message+' ':'')+'It is still scheduled - try again.';
      }
      return;
    }

    const w=INVEST_WHEN.find(x=>x.k===k)||{};
    if(say) say.textContent='Setting this up\u2026';
    try{
      /* Replace rather than add, so the buttons show one choice and one job
         exists to match it. */
      await dropPrev();
      /* A real scheduled job on the server, so it runs whether or not AMV is
         open - the whole point of being told automatically.

         kind:'invest' is what makes this real. The server runs the check-in
         itself and reports the institution's own numbers; it does not hand the
         wording below to a model, which could not read an account and would
         have to guess. The text is the job's description in the list. */
      const r=await AMV_API._fetch('/auto/create',{method:'POST',body:JSON.stringify({
        detail:'Check my investment accounts and report how they changed since the last check - the amount and the percentage, per account.',
        repeat:(k==='weekly'||k==='monthly')?'weekly':'daily', kind:'invest', notify:'app' })});
      const d=await r.json().catch(()=>({}));
      /* Without the id there is nothing to delete later, so a following change
         of frequency would leave this one running alongside the new one. */
      const item=(d&&d.item)||null;
      try{ saveStr('amv_inv_when',k); saveStr('amv_inv_auto',(item&&item.id)||''); }catch(e){}
      if(say) say.textContent='Done. AMV checks '+w.detail+', and the result waits for you in Tasks.';
    }catch(e){
      /* Clear the remembered choice, redraw so the buttons show the truth, and
         write the message AFTER - the redraw replaces the element the message
         would have been in, so setting it first said nothing at all. */
      /* Only claim nothing is scheduled when nothing is. If removing the
         previous job is what failed, that one is still running and saying
         otherwise would be the same lie in the opposite direction. */
      try{ saveStr('amv_inv_when', stillRunning?(loadStr('amv_inv_when')||''):''); }catch(_){ }
      _renderInvestPane(pane);
      const s2=$('inv-when-say');
      if(s2) s2.textContent=((e&&e.message)?e.message+' ':'')
        +(stillRunning?'Your existing check-in is still running and was not changed.':'Nothing is scheduled.');
    }
  }));
}
try{ window._renderInvestPaneNow=_renderInvestPaneNow; }catch(e){}
