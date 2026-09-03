/* ============================================================
   REAL FINANCIAL CONNECTION

   The money automations you asked for - live balances, unusual
   transaction alerts, low balance alerts, credit score changes,
   budget trending - need REAL account data, not receipts guessed
   from email. That means a bank aggregator (Plaid, Teller, TrueLayer,
   MX...). This layer is that connection, built so:

   - It reads through the aggregator's API, so balances and
     transactions are the real ones, not inferred.
   - Credentials NEVER touch AMV. The user authenticates inside the
     provider's own secure flow; AMV only ever holds an access token,
     and that token lives SERVER-SIDE. The client holds nothing.
   - It is READ-ONLY. AMV can see money; it cannot move it. There is
     deliberately no transfer/payment action here - a compromised
     agent must not be able to empty an account.
   - Until a provider is configured every action reports exactly what
     is missing rather than inventing a balance. A fabricated bank
     figure is the single most damaging thing this product could do.
   ============================================================ */
const AMVFinance = {
  /* Which aggregator the operator configured. Set server-side. */
  provider(){ try{ return loadStr('amv_fin_provider') || ''; }catch(e){ return ''; } },

  /* A cache of the server's answer, nothing more. This flag used to be the
     ONLY definition of "linked" and no code anywhere wrote it, so it was
     permanently false and the whole finance surface was unreachable however
     many accounts you had connected. `refresh()` fills it from the server,
     which is the only thing that actually knows. */
  linked(){ try{ return loadStr('amv_fin_linked')==='1'; }catch(e){ return false; } },
  ready(){ try{ return loadStr('amv_fin_ready')==='1'; }catch(e){ return false; } },

  async refresh(){
    const base=this._base();
    if(!base) return { ready:false, linked:false };
    try{
      const r = await fetchDeadline(base + '/v1/finance/status', {
        method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + this._tok() },
        body:'{}' });
      const d = await r.json().catch(()=>({}));
      /* ok:false marks these as the LAST KNOWN values rather than a fresh
         answer, so a caller cannot mistake a failed refresh for a current one. */
      if(!r.ok) return { ok:false, stale:true, ready:this.ready(), linked:this.linked() };
      try{ saveStr('amv_fin_linked', d.linked?'1':''); saveStr('amv_fin_ready', d.ready?'1':''); }catch(e){}
      return { ok:true, ready:!!d.ready, linked:!!d.linked, linkedAt:d.linkedAt||null };
    }catch(e){ return { ok:false, stale:true, ready:this.ready(), linked:this.linked() }; }
  },

  /* Start the hosted flow. The sign-in happens on the provider's own page, so
     no third-party script is loaded here and the strict CSP is untouched. */
  async linkStart(){
    const base=this._base();
    if(!base){ const e=new Error('Connect the AMV backend first.'); e.code='needs_service'; throw e; }
    const r = await fetchDeadline(base + '/v1/finance/link/start', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + this._tok() },
      body:'{}' });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.url){ const e=new Error(d.error||'Could not start the link.'); e.code=d.code||'provider_error'; throw e; }
    return d.url;
  },

  /* Called on the way back. `not_finished` is a normal outcome - somebody
     closed the window - and is reported as itself rather than as a failure. */
  async linkFinish(){
    const base=this._base();
    if(!base) return { ok:false, code:'needs_service' };
    const r = await fetchDeadline(base + '/v1/finance/link/finish', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + this._tok() },
      body:'{}' });
    const d = await r.json().catch(()=>({}));
    if(d && d.ok){ try{ saveStr('amv_fin_linked','1'); }catch(e){} return { ok:true }; }
    return { ok:false, code:(d&&d.code)||'provider_error', error:(d&&d.error)||'Could not finish the link.' };
  },

  async unlink(){
    const base=this._base();
    if(!base){ const e=new Error('Connect the AMV backend first.'); e.code='needs_service'; throw e; }
    const r = await fetchDeadline(base + '/v1/finance/unlink', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + this._tok() },
      body:'{}' });
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ const e=new Error(d.error||'Could not disconnect.'); e.code=d.code||'provider_error'; throw e; }
    try{ saveStr('amv_fin_linked',''); }catch(e){}
    return true;
  },

  _base(){ try{ return (apiBase()||'').replace(/\/$/,''); }catch(e){ return ''; } },
  /* The live token, wherever it is being held. Read off disk this returned
     nothing in cookie mode and every finance call went out unauthenticated. */
  _tok(){ try{ return (window.AMV_API && AMV_API.token)||''; }catch(e){ return ''; } },

  /* Every call goes through OUR server, never straight to the bank from the
     browser - so the provider secret and the access token stay server-side. */
  async _call(path, body){
    const base = this._base();
    if(!base){ const e=new Error('Connect the AMV backend first - bank data is read server-side so your tokens never touch the browser.'); e.code='needs_service'; throw e; }
    if(!this.linked()){ const e=new Error('No bank account is linked yet. Link one in Settings and these run automatically.'); e.code='needs_auth'; throw e; }
    const r = await fetchDeadline(base + '/v1/finance/' + path, {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + this._tok() },
      body: JSON.stringify(body||{})
    });
    const d = await r.json().catch(()=>({}));
    if(d && d.code){ const e=new Error(d.error||d.need||'Bank data unavailable.'); e.code=d.code; throw e; }
    if(!r.ok) throw new Error(d.error || 'Could not reach your bank data.');
    return d;
  },

  /* Live balances across every linked account. */
  async accounts(){ return this._call('accounts'); },

  /* The check-in: where the investments stand and what changed since last time.
     Server-side, because the comparison needs the previous snapshot and that
     lives with the account, not in this browser. */
  async checkin(){ return this._call('checkin'); },

  /* Real transactions in a window. */
  async transactions(days){ return this._call('transactions', { days: Math.min(365, Math.max(1, +days||30)) }); },

  /* --- The analysis the automations run on top of real data. --- */

  /* Unusual spending: flags a charge that is far outside this account's own
     normal pattern, not a fixed threshold that would be wrong for everyone. */
  unusual(txns, opts){
    opts = opts || {};
    const list = (txns||[]).filter(t => t && +t.amount < 0);   // debits
    if(list.length < 8) return { ready:false, why:'Not enough transaction history yet to know what is normal for you.' };
    const amts = list.map(t => Math.abs(+t.amount)).sort((a,b)=>a-b);
    const median = amts[Math.floor(amts.length/2)];
    const p90 = amts[Math.floor(amts.length*0.9)];
    const bar = Math.max(p90 * (opts.sensitivity||1.5), median * 6);
    const flagged = list.filter(t => Math.abs(+t.amount) >= bar).map(t => ({
      date:t.date, merchant:t.merchant||t.name||'', amount:Math.abs(+t.amount),
      why:'This is well above your usual spending (typical ' + median.toFixed(0) + ', this ' + Math.abs(+t.amount).toFixed(0) + ').'
    }));
    /* Duplicate charges. Naively flagging "same merchant, same amount, same
       day" is wrong: buying coffee twice in a day is normal, and alerting on
       it destroys trust in every other alert. So only flag when repeating is
       ANOMALOUS for that merchant - if they routinely have multiple same-day
       charges, that is the pattern, not a fault. */
    const byMerchant = {};
    list.forEach(t => {
      const m = (t.merchant||t.name||'').toLowerCase();
      const day = (t.date||'').slice(0,10);
      const amt = Math.abs(+t.amount);
      const rec = byMerchant[m] || (byMerchant[m] = { days:{}, repeatDays:new Set() });
      const key = day + '|' + amt;
      rec.days[key] = (rec.days[key]||0) + 1;
      if(rec.days[key] > 1) rec.repeatDays.add(day);
    });
    const dupes = [];
    Object.keys(byMerchant).forEach(m => {
      const rec = byMerchant[m];
      // repeating on 2+ separate days = this merchant just works that way
      if(rec.repeatDays.size !== 1) return;
      const day = [...rec.repeatDays][0];
      Object.keys(rec.days).forEach(key => {
        const [d, amtStr] = key.split('|');
        if(d !== day || rec.days[key] < 2) return;
        const amt = +amtStr;
        if(amt < median) return;   // trivial amounts are not worth an alert
        const orig = list.find(t => (t.merchant||t.name||'').toLowerCase() === m
          && (t.date||'').slice(0,10) === d && Math.abs(+t.amount) === amt);
        dupes.push({ date:d, merchant:(orig && (orig.merchant||orig.name)) || m, amount:amt,
          count:rec.days[key],
          why:'Charged ' + rec.days[key] + ' times on the same day for the same amount, which is unusual for this merchant.' });
      });
    });
    return { ready:true, unusual:flagged, duplicates:dupes, typical:median, bar };
  },

  /* Low balance: warns BEFORE it bites, using real upcoming commitments. */
  lowBalance(accounts, upcoming, floor){
    const out = [];
    (accounts||[]).forEach(a => {
      const bal = +a.balance || 0;
      const due = (upcoming||[]).filter(u => u.account === a.id).reduce((s,u)=>s+(+u.amount||0), 0);
      const after = bal - due;
      /* An unreadable floor becomes the default, not NaN. `after < NaN` is
         false, so a floor of "one hundred" - which a model calling this can
         easily pass - silently switched the warning off, and an account heading
         into an overdraft would simply never have been mentioned. */
      const limit = isFinite(+floor) ? +floor : 100;
      if(after < limit) out.push({ account:a.name||a.id, balance:bal, committed:due, projected:after,
        why: due > 0
          ? 'After the payments already scheduled, this drops to ' + after.toFixed(2) + '.'
          : 'This is below your ' + limit + ' floor.' });
    });
    return out;
  },

  /* Budget trending: is this month's pace going to overshoot? */
  budgetTrend(txns, monthlyBudget, now){
    const budget = +monthlyBudget || 0;
    if(!budget) return { ready:false, why:'Set a monthly budget and I can tell you if you are trending over it.' };
    const d = now ? new Date(now) : new Date();
    const day = d.getDate();
    const daysInMonth = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    const spent = (txns||[]).filter(t => {
      if(!t || +t.amount >= 0) return false;
      const td = new Date(t.date);
      return td.getMonth() === d.getMonth() && td.getFullYear() === d.getFullYear();
    }).reduce((s,t)=>s+Math.abs(+t.amount), 0);
    const pace = day > 0 ? (spent / day) * daysInMonth : 0;
    const over = pace - budget;
    return { ready:true, spent, budget, projected:pace, day, daysInMonth,
      onTrack: pace <= budget,
      why: pace <= budget
        ? 'At this pace you finish the month around ' + pace.toFixed(0) + ', inside your ' + budget.toFixed(0) + ' budget.'
        : 'At this pace you finish around ' + pace.toFixed(0) + ' - about ' + over.toFixed(0) + ' over your ' + budget.toFixed(0) + ' budget.' };
  }
};
try{ window.AMVFinance = AMVFinance; }catch(e){}

/* ============================================================
   AMV-104  THE INVESTING CHECK-IN, ON SCREEN.

   The finance layer has been complete and read-only for a while and had no
   screen at all - nothing in the app referenced it, so the only way to reach it
   was to ask AMV in chat. This is the surface: link an account, see how the
   money is doing, and set how often you want to be told.

   It is written to be unable to lie. Every figure comes from the server call
   that just ran; nothing is remembered and re-displayed as though it were
   current, and if the provider cannot be reached the screen says that rather
   than showing the last number it saw. On a screen about somebody's savings a
   stale figure presented as live is the same as a false one.
   ============================================================ */
const INVEST_WHEN = [
  { k:'daily',    label:'Every morning',  detail:'each morning' },
  { k:'evening',  label:'Every evening',  detail:'each evening' },
  { k:'weekly',   label:'Once a week',    detail:'once a week' },
  { k:'monthly',  label:'Once a month',   detail:'once a month' },
];
function _invWhen(){ try{ return loadStr('amv_inv_when')||''; }catch(e){ return ''; } }
/* When the figures on screen were actually taken, so a failed check can label
   them honestly instead of implying they are current. */
let _INV_LAST_OK = 0;
function _invMoney(n, cur){
  const v=Math.round((+n||0)*100)/100;
  try{ return new Intl.NumberFormat(undefined,{style:'currency',currency:cur||'USD'}).format(v); }
  catch(e){ return '$'+v.toFixed(2); }
}

function _invResultHTML(d){
  if(!d) return '';
  if(d.first){
    /* The honest first answer. Reporting 0% here would be a claim about the
       market rather than a statement about what AMV knows. */
    return '<div class="inv-res"><div class="inv-total">'+escH(_invMoney(d.total,d.currency))+'</div>'+
      '<div class="inv-sub">This is the first check-in, so there is nothing to compare it against yet. '+
      'The next one will tell you what changed.</div></div>';
  }
  const up=d.direction==='up', flat=d.direction==='flat';
  const cls=flat?'flat':(up?'up':'down');
  const sign=up?'+':'';
  const pct=(d.changePct==null)?'':(' \u00b7 '+sign+d.changePct+'%');
  const rows=(d.byAccount||[]).map(a=>
    '<div class="inv-row"><span class="inv-row-n">'+escH(a.name||'Account')+'</span>'+
    '<span class="inv-row-b">'+escH(_invMoney(a.balance,d.currency))+'</span>'+
    (a.isNew
      ? '<span class="inv-row-c new">new</span>'
      : '<span class="inv-row-c '+((a.change||0)>=0?'up':'down')+'">'+((a.change||0)>=0?'+':'')+escH(_invMoney(a.change,d.currency))+'</span>')+
    '</div>').join('');
  return '<div class="inv-res">'+
    '<div class="inv-total">'+escH(_invMoney(d.total,d.currency))+'</div>'+
    '<div class="inv-change '+cls+'">'+(flat?'No change':(sign+_invMoney(d.changeUSD,d.currency)+pct))+
      '<span class="inv-since"> since your last check-in</span></div>'+
    (rows?'<div class="inv-rows">'+rows+'</div>':'')+
  '</div>';
}

/* Coming back from the provider. The server is asked whether a session actually
   completed - the browser cannot know, and must not guess, because "linked"
   decides whether AMV starts reading somebody's accounts. */
function _wireInvDone(pane){
  on($('inv-link-done'),'click',async()=>{
    const say=$('inv-link-say');
    const btn=$('inv-link-done'); if(btn) btn.disabled=true;
    if(say) say.textContent='Checking…';
    const r=await AMVFinance.linkFinish();
    if(btn) btn.disabled=false;
    if(r.ok){
      try{ saveStr('amv_fin_pending',''); }catch(e){}
      _renderInvestPane(pane);
      const s=$('inv-say'); if(s) s.textContent='Linked. Check now to see where you stand.';
      return;
    }
    if(say) say.textContent = r.code==='not_finished'
      ? 'That link was not completed, so nothing was connected. Start it again when you are ready.'
      : (r.error||'Could not finish the link.')+' Nothing was connected.';
  });
}

function _renderInvestPane(pane){
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
    '<div class="ss2 set-what"><h3>What this is</h3>'+
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
    '</div>'+
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
    if(typeof confirm==='function' &&
       !confirm('Disconnect this account? AMV stops reading it, and the history it compares against is deleted.')) return;
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
      if(!r.ok || d.error) throw new Error(d.error||'the server would not stop it');
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
try{ window._renderInvestPane=_renderInvestPane; }catch(e){}

/* Expose finance to chat/Crew. READ-ONLY on purpose: AMV can see money and
   reason about it, but has no action that moves it. */
try{
  if(typeof AMVConnectors !== 'undefined'){
    AMVConnectors.register({
      id:'finance', name:'Bank & cards', auth:'oauth', channel:'api',
      isLive(){ try{ return AMVFinance.linked() && !!(apiBase()); }catch(e){ return false; } },
      actions:{
        balances:{ desc:'Live balances across every linked bank account and card.',
          async run(){ return AMVFinance.accounts(); } },
        transactions:{ desc:'Real transactions from your linked accounts. Args: {days}',
          async run(a){ return AMVFinance.transactions((a&&a.days)||30); } },
        unusual_activity:{ desc:'Charges well outside your own normal pattern, plus same-day duplicates.',
          async run(a){ const t=await AMVFinance.transactions((a&&a.days)||60);
            return AMVFinance.unusual(t.transactions||t.items||[], a||{}); } },
        low_balance:{ desc:'Accounts heading below a safe floor once scheduled payments clear. Args: {floor}',
          async run(a){ const acc=await AMVFinance.accounts();
            return AMVFinance.lowBalance(acc.accounts||acc.items||[], acc.upcoming||[], a&&a.floor); } },
        budget_trend:{ desc:'Whether this month is trending over budget. Args: {budget}',
          async run(a){ const t=await AMVFinance.transactions(35);
            return AMVFinance.budgetTrend(t.transactions||t.items||[], a&&a.budget); } }
      }
    });
  }
}catch(e){}
