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
    if(!base) return { ok:false, stale:true, code:'needs_service', ready:this.ready(), linked:this.linked() };
    try{
      const r = await fetchDeadline(base + '/v1/finance/status', {
        method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + this._tok() },
        body:'{}' });
      const d = await r.json().catch(()=>({}));
      /* ok:false marks these as the LAST KNOWN values rather than a fresh
         answer, so a caller cannot mistake a failed refresh for a current one. */
      if(!r.ok || !d || d.ok!==true || typeof d.ready!=='boolean' || typeof d.linked!=='boolean')
        return { ok:false, stale:true, ready:this.ready(), linked:this.linked() };
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
      /* Which country's banks to offer. The server accepts it only where this
         deployment may link banks, and otherwise uses the network's country. */
      body: JSON.stringify({ country: (typeof _cwCountryGuess === 'function' ? _cwCountryGuess() : '') || '' }) });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.url){ const e=new Error(_refusalText(d, 'Could not start the link.')); e.code=d.code||'provider_error'; throw e; }
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
    if(!r.ok){ const e=new Error(_refusalText(d, 'Could not disconnect.')); e.code=d.code||'provider_error'; throw e; }
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
    if(!r.ok) throw new Error(_refusalText(d, 'Could not reach your bank data.'));
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
   LINKING A BANK, ON SCREEN (was the investing check-in until Nov 15, when
   the owner removed investing and kept the link). The link itself is the
   finance layer above; this is where somebody starts and ends it, and every
   state is asked of the server rather than assumed.
   ============================================================ */
/* Coming back from the provider. The server is asked whether a session actually
   completed - the browser cannot know, and must not guess, because "linked"
   decides whether AMV starts reading somebody's accounts. */
function _wireInvDone(pane){
  on($('inv-link-done'),'click',async()=>{
    const say=$('inv-link-say');
    const btn=$('inv-link-done'); if(btn) btn.disabled=true;
    if(say) say.textContent=T('Checking…');
    const r=await AMVFinance.linkFinish();
    if(btn) btn.disabled=false;
    if(r.ok){
      try{ saveStr('amv_fin_pending',''); }catch(e){}
      _renderInvestPane(pane);
      const s=$('inv-say'); if(s) s.textContent=T('Linked. Crew and chat can read it now.');
      return;
    }
    if(say) say.textContent = r.code==='not_finished'
      ? T('That link was not completed, so nothing was connected. Start it again when you are ready.')
      : (r.error||T('Could not finish the link.'))+' '+T('Nothing was connected.');
  });
}

/* The pane itself lives in invest.js (src/finance/invest.js), fetched the
   first time it is opened. */
let _investP = null;
function _investLoad(){
  if(typeof window._renderInvestPaneNow === 'function') return Promise.resolve(true);
  if(!_investP) _investP = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'invest.js';
    sc.onload = () => res(typeof window._renderInvestPaneNow === 'function');
    sc.onerror = () => { _investP = null; sc.remove(); res(false); };
    document.head.appendChild(sc);
  });
  return _investP;
}
function _renderInvestPane(pane){
  if(typeof window._renderInvestPaneNow === 'function') return window._renderInvestPaneNow(pane);
  if(!pane) return;
  pane.innerHTML = '<div style="color:var(--mu);font-size:var(--t-sm)">' + escH(T('Loading…')) + '</div>';
  _investLoad().then(ok => {
    if(ok) window._renderInvestPaneNow(pane);
    else pane.innerHTML = '<div style="color:var(--mu);font-size:var(--t-sm)">' + escH(T('That could not be loaded. Check your connection and try again.')) + '</div>';
  });
}
try{ window._renderInvestPane=_renderInvestPane; }catch(e){}
/* LINKING A BANK, WHEREVER IT IS ASKED FOR (Nov 15).

   Spending is the monthly budget only now (the owner's call), so the link
   that used to sit at the bottom of it opens here instead: the same pane, the
   same flow at the institution's own sign-in, in a dialog that a Crew job
   needing a bank and the Bank & money row in Integrations both open. One copy
   of the money flow, as before - this only gives it a door of its own. */
function openBankLink(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ov" id="bank-bg"><div class="ccp bank-dlg" role="dialog" aria-modal="true" aria-label="'+escH(T('Link a bank'))+'">'
    +'<header class="ccp-h"><h2>'+escH(T('Link a bank'))+'</h2><button class="cwp-x" id="bank-x" aria-label="'+escH(T('Close'))+'">\u2715</button></header>'
    +'<div class="bank-b" id="bank-pane" data-mode="bank"></div></div></div>';
  r.classList.add('on');
  onBackdrop($('bank-bg'), closeOvr);
  on($('bank-x'),'click',closeOvr);
  try{ _renderInvestPane($('bank-pane')); }catch(e){}
}
try{ window.openBankLink=openBankLink; }catch(e){}

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
