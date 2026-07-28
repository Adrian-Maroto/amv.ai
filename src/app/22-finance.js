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
    const r = await fetch(base + '/v1/finance/' + path, {
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
