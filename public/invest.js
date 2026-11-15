/* THE BANK LINK PANE - fetched the first time it is opened (22-finance.js has
   the stub that loads it, and openBankLink the dialog it fills). It runs in the
   same global scope as the page, so it uses the page's helpers directly; its
   own redraws go back through the stub, which by then calls straight here.

   It was the Investing pane: a link, a check-in on investment balances and a
   schedule for it. The owner removed investing (Nov 15) and kept linking a
   bank, which is what a Crew job or chat that reads a bank needs - so this is
   the link and nothing else, said for a bank rather than for investments. A
   check-in somebody had already scheduled is an ordinary running job, listed
   and stopped in Crew like every other. */
function _renderInvestPaneNow(pane){
  if(!pane) return;
  const linked=(typeof AMVFinance!=='undefined') && AMVFinance.linked();
  const backend=(()=>{ try{ return !!apiBase(); }catch(e){ return false; } })();
  /* Ask the server what is actually true, then redraw only if it disagrees with
     what was just drawn - on another device the cache is empty and a linked
     bank would look unlinked. Guarded on a change so it cannot loop. */
  try{
    if(backend && typeof AMVFinance!=='undefined' && !pane._invChecked){
      pane._invChecked=1;
      AMVFinance.refresh().then(st=>{
        if(!!st.linked !== !!linked) _renderInvestPane(pane);
      }).catch(()=>{});
    }
  }catch(e){}

  pane.innerHTML=
    '<p class="bank-lead">'+escH(T('AMV reads balances and transactions so Crew and chat answer from your real figures. It can never move money.'))+'</p>'+
    '<ul class="bank-facts">'+
      '<li>'+escH(T('You sign in at your bank, in its own window. AMV never sees your username or password.'))+'</li>'+
      '<li>'+escH(T('AMV holds a read-only permission, on its server - never in this browser.'))+'</li>'+
      '<li>'+escH(T('Disconnect any time, and AMV stops reading at once.'))+'</li>'+
    '</ul>'+
    (!backend
      ? '<div class="bank-st"><b>'+escH(T('Not connected yet'))+'</b><p>'+escH(T('Bank data is read through your AMV backend so your tokens never reach the browser. Connect it and this starts working.'))+'</p></div>'
      : !linked
      ? '<div class="bank-st"><button class="btn bp" id="inv-link">'+escH(T('Link a bank'))+'</button>'+
        '<div class="fam-say" id="inv-link-say" role="status" aria-live="polite"></div></div>'
      : '<div class="bank-st on"><b>'+escH(T('Your bank is linked'))+'</b><p>'+escH(T('Crew jobs and chat that read a bank use it now.'))+'</p>'+
        '<button class="btn bs" id="inv-unlink">'+escH(T('Disconnect'))+'</button>'+
        '<div class="fam-say" id="inv-say" role="status" aria-live="polite"></div></div>');

  on($('inv-link'),'click',async()=>{
    const say=$('inv-link-say');
    const btn=$('inv-link');
    if(btn) btn.disabled=true;
    if(say) say.textContent=T('Opening your bank’s secure sign-in…');
    /* Opened during the click. Awaiting linkStart first spends the user
       activation, and a blocked window here means somebody cannot connect a
       bank account at all - see _preopenPay. */
    const pre=(typeof _preopenPay==='function')?_preopenPay():null;
    try{
      const url=await AMVFinance.linkStart();
      /* Remembered so the return can be recognised even if they come back in a
         new tab, or the redirect drops the query string. */
      try{ saveStr('amv_fin_pending','1'); }catch(e){}
      if(say) say.textContent=T('Continue in the window that opened. Come back here when you are done.');
      _openExternalPay(url,null,'finance',pre);
      /* Replaced rather than renamed: a renamed node keeps THIS handler, so the
         next click - "I have finished linking" - would start a second link. A
         fresh node carries no listeners. */
      if(btn && btn.parentNode){
        const done=btn.cloneNode(false);
        done.disabled=false; done.textContent=T('I have finished linking'); done.id='inv-link-done';
        btn.parentNode.replaceChild(done, btn);
      }
      _wireInvDone(pane);
    }catch(e){
      if(typeof _closePay==='function') _closePay(pre);
      if(btn) btn.disabled=false;
      /* needs_service is the operator not having switched it on, which is a
         different thing from a failure and is said as itself. */
      if(say) say.textContent = (e&&e.code==='needs_service')
        ? T('Account linking is not switched on for this deployment yet, so nothing was started.')
        : ((e&&e.message)||T('Could not start the link.'))+' '+T('Nothing was linked.');
    }
  });
  _wireInvDone(pane);

  /* The question takes over the same overlay the bank dialog is in, so the
     answer - yes or no - comes back to the dialog rather than to nothing. */
  const back=()=>{
    if(pane.isConnected) return pane;
    if(pane.id==='bank-pane'){ try{ openBankLink(); }catch(e){} return $('bank-pane')||pane; }
    return pane;
  };
  on($('inv-unlink'),'click',async()=>{
    const yes=await _askDestructive(T('Disconnect your bank?'),
        T('AMV stops reading it, and what it kept from it is deleted. This cannot be undone.'),
        T('Disconnect'));
    const p=back();
    if(!yes) return;
    try{
      await AMVFinance.unlink();
      _renderInvestPane(p);
      const s=$('inv-link-say'); if(s) s.textContent=T('Disconnected. AMV can no longer read that account.');
    }catch(e){
      const say=$('inv-say');
      if(say) say.textContent=((e&&e.message)||T('Could not disconnect.'))+' '+T('The account is still connected.');
    }
  });
}
try{ window._renderInvestPaneNow=_renderInvestPaneNow; }catch(e){}
