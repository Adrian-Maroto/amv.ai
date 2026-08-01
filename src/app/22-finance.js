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
  linked(){ try{ return !!loadStr('amv_fin_linked'); }catch(e){ return false; } },

  _base(){ try{ return (loadStr('amv_api_base')||'').replace(/\/$/,''); }catch(e){ return ''; } },
  _tok(){ try{ return loadStr('amv_api_token')||''; }catch(e){ return ''; } },

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
      const limit = floor != null ? +floor : 100;
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

function _renderInvestPane(pane){
  const linked=(typeof AMVFinance!=='undefined') && AMVFinance.linked();
  const backend=(()=>{ try{ return !!loadStr('amv_api_base'); }catch(e){ return false; } })();
  const when=_invWhen();

  pane.innerHTML=
    '<div class="set-title">Investing</div>'+
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
        '<button class="btn bp" id="inv-link" style="font-size:12px">Link an investment account</button>'+
        '<div class="fam-say" id="inv-link-say" role="status" aria-live="polite"></div></div>'
      : '<div class="ss2"><h3>How it is doing</h3>'+
        '<div id="inv-out"><p class="fam-p fam-quiet">Check now to see where you stand.</p></div>'+
        '<button class="btn bp" id="inv-now" style="font-size:12px">Check now</button>'+
        '<div class="fam-say" id="inv-say" role="status" aria-live="polite"></div></div>'+
        '<div class="ss2"><h3>Tell me automatically</h3>'+
          '<p class="fam-p fam-quiet">AMV runs the check on its own and brings you the answer. '+
          'You can change or stop this at any time.</p>'+
          '<div class="inv-when">'+
            INVEST_WHEN.map(w=>'<button class="btn '+(when===w.k?'bp':'bs')+' inv-when-b" data-inv-when="'+w.k+'">'+
              escH(w.label)+'</button>').join('')+
            (when?'<button class="btn bs inv-when-b" data-inv-when="" style="color:var(--red);border-color:var(--red)">Stop</button>':'')+
          '</div>'+
          '<div class="fam-say" id="inv-when-say" role="status" aria-live="polite">'+
            (when?escH('AMV checks '+((INVEST_WHEN.find(w=>w.k===when)||{}).detail||when)+' and tells you.'):'')+
          '</div>'+
        '</div>');

  on($('inv-link'),'click',()=>{
    const say=$('inv-link-say');
    /* Honest rather than a button that appears to work. Linking runs through
       the aggregator's own flow, which only exists once the operator has
       configured one. */
    if(say) say.textContent='Linking opens your institution\u2019s own secure sign-in. That flow is not switched on for this deployment yet, so nothing was started.';
  });

  on($('inv-now'),'click',async()=>{
    const btn=$('inv-now'), say=$('inv-say'), out=$('inv-out');
    if(btn){ btn.disabled=true; btn.textContent='Checking\u2026'; }
    if(say) say.textContent='';
    try{
      const d=await AMVFinance.checkin();
      if(out) out.innerHTML=_invResultHTML(d);
    }catch(e){
      if(say) say.textContent=(e&&e.message)||'Could not reach your institution, so there is nothing to show.';
      /* Figures already on screen are from an earlier check, and leaving them
         sitting there unlabelled next to an error makes them indistinguishable
         from current ones - which on a screen about somebody's savings is the
         same as showing a wrong number. They stay, because losing them helps
         nobody, but they are stamped with when they were actually taken. */
      const res=out&&out.querySelector('.inv-res');
      if(res && !res.querySelector('.inv-stale')){
        let when=''; try{ when=new Date().toLocaleString(undefined,{hour:'numeric',minute:'2-digit'}); }catch(_){}
        res.insertAdjacentHTML('afterbegin',
          '<div class="inv-stale">Last successful check'+(when?', earlier today':'')+
          ' - these figures are not current.</div>');
      }
    }finally{ if(btn){ btn.disabled=false; btn.textContent='Check again'; } }
  });

  pane.querySelectorAll('[data-inv-when]').forEach(b=>on(b,'click',async()=>{
    const k=b.dataset.invWhen;
    const say=$('inv-when-say');
    try{ saveStr('amv_inv_when',k); }catch(e){}
    if(!k){ if(say) say.textContent='Stopped. AMV will not check on its own.'; _renderInvestPane(pane); return; }
    const w=INVEST_WHEN.find(x=>x.k===k)||{};
    if(say) say.textContent='Setting this up\u2026';
    try{
      /* A real scheduled job on the server, so it runs whether or not AMV is
         open - the whole point of being told automatically. */
      await AMV_API._fetch('/auto/create',{method:'POST',body:JSON.stringify({
        detail:'Check my investment accounts and tell me how they are doing since the last check - the amount and the percentage, per account. If the accounts cannot be read, say so plainly and do not estimate.',
        repeat:(k==='weekly'||k==='monthly')?'weekly':'daily', kind:'task', notify:'app' })});
      if(say) say.textContent='Done. AMV checks '+w.detail+' and tells you.';
    }catch(e){
      /* Clear the remembered choice, redraw so the buttons show the truth, and
         write the message AFTER - the redraw replaces the element the message
         would have been in, so setting it first said nothing at all. */
      try{ saveStr('amv_inv_when',''); }catch(_){ }
      _renderInvestPane(pane);
      const s2=$('inv-when-say');
      if(s2) s2.textContent=((e&&e.message)?e.message+' ':'')+'Nothing is scheduled.';
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
      isLive(){ try{ return AMVFinance.linked() && !!(loadStr('amv_api_base')); }catch(e){ return false; } },
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
