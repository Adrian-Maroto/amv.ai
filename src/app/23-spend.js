/* ============================================================
   SPENDING CONTROLS - money AMV can spend on your behalf.

   The design follows the norm every serious agent platform uses:
   small amounts flow without interruption, larger ones get one tap,
   and a hard ceiling can never be crossed. That is not red tape - it
   is what keeps the payment processing alive. Unauthorised charges
   come back as chargebacks regardless of any terms text (card network
   rules outrank a ToS), and a high chargeback rate gets a merchant
   dropped. Loose spending is therefore a revenue risk, not a feature.

   - autoUnder: buy silently below this (the convenience case)
   - perPurchase: never spend more than this in one go, ever
   - monthlyCap: hard ceiling across everything, resets monthly
   - Every attempt is logged with the outcome, so there is always a
     record of what was authorised and by what rule.
   ============================================================ */
const AMVSpend = {
  KEY:'amv_spend',

  cfg(){
    let c; try{ c = load(this.KEY); }catch(e){ c = null; }
    return Object.assign({
      enabled:false,
      autoUnder:50,        // spend up to this without asking
      perPurchase:250,     // absolute max for a single purchase
      monthlyCap:500,      // absolute max per month
      requireApprovalOver:0, // 0 = use autoUnder
      log:[], month:'', spent:0
    }, c||{});
  },
  save(c){ try{ store(this.KEY, c); }catch(e){} },

  /* A limit that cannot be read is ZERO, never "no limit".
     `amt > +c.perPurchase` is FALSE when perPurchase is undefined, empty, or a
     leftover string - so a config damaged by a half-finished write, an older
     shape, or a hand-edited storage key passed every ceiling AND came back
     needsApproval:false, which is the one combination that must never occur.
     Deny by default means a broken number blocks, it does not wave through. */
  _n(v){ const n = Math.floor(+v); return (isFinite(n) && n > 0) ? n : 0; },

  /* Whether these limits are the ones the server will actually enforce.
     Without a backend the local numbers are all there is, and the screen says
     so rather than implying a ceiling nobody is holding. */
  serverBacked(){ try{ return !!(AMV_API.base && AMV_API.token); }catch(e){ return false; } },

  /* The server is the authority - the browser copy is the editable one. */
  async pull(){
    if(!this.serverBacked()) return { ok:false, code:'local_only' };
    const d = await AMV_API.spendLimits();
    const c = this.cfg();
    c.autoUnder = this._n(d.limits.autoUnder);
    c.perPurchase = this._n(d.limits.perPurchase);
    c.monthlyCap = this._n(d.limits.monthlyCap);
    /* Including the master switch. If the account says spending is off, the
       toggle on this screen says off, because the account is what decides. */
    c.enabled = !!d.limits.enabled;
    c.month = this._month();
    c.spent = +d.spentThisMonth || 0;      // counted where it cannot be edited
    this.save(c);
    return { ok:true, limits:d.limits, absoluteCap:d.absoluteCap, remaining:d.remaining };
  },
  /* Writes go to the server FIRST and the local mirror adopts whatever comes
     back, so what the screen shows afterwards is what is really enforced -
     including the server pulling a number down. */
  async push(limits){
    const cur = this.cfg();
    /* The switch travels with the numbers. Sending the limits without it would
       let the server's copy of "spending is on" drift from the toggle. */
    const body = { autoUnder:limits.autoUnder, perPurchase:limits.perPurchase,
                   monthlyCap:limits.monthlyCap,
                   enabled: (limits.enabled === undefined ? !!cur.enabled : !!limits.enabled) };
    if(!this.serverBacked()){
      cur.autoUnder = this._n(body.autoUnder); cur.perPurchase = this._n(body.perPurchase);
      cur.monthlyCap = this._n(body.monthlyCap); cur.enabled = body.enabled; this.save(cur);
      return { ok:true, code:'local_only', limits:{ autoUnder:cur.autoUnder, perPurchase:cur.perPurchase,
                                                    monthlyCap:cur.monthlyCap, enabled:cur.enabled } };
    }
    const d = await AMV_API.spendSet(body);
    const c = this.cfg();
    c.autoUnder = this._n(d.limits.autoUnder);
    c.perPurchase = this._n(d.limits.perPurchase);
    c.monthlyCap = this._n(d.limits.monthlyCap);
    c.enabled = !!d.limits.enabled;
    this.save(c);
    return { ok:true, limits:d.limits };
  },

  _month(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); },

  /* Roll the monthly counter when the month genuinely changes.
     A missing or malformed month must NOT zero the total - otherwise clearing
     one field resets the cap, which is exactly the bypass a cap exists to
     prevent. In that case we adopt the current month and KEEP what is spent. */
  _sync(c){
    const m = this._month();
    const valid = /^\d{4}-\d{2}$/.test(String(c.month||''));
    if(!valid){ c.month = m; this.save(c); return c; }        // adopt, do not wipe
    if(c.month !== m){ c.month = m; c.spent = 0; this.save(c); }  // real rollover
    return c;
  },

  spentThisMonth(){ return this._sync(this.cfg()).spent || 0; },
  remaining(){ const c = this._sync(this.cfg()); return Math.max(0, (+c.monthlyCap||0) - (+c.spent||0)); },

  /* THE GATE. Every spend request passes here first.
     Returns {allow, needsApproval, reason}. Deny by default. */
  check(amount, opts){
    opts = opts || {};
    const c = this._sync(this.cfg());
    const amt = +amount;
    /* Read through _n, so an unreadable limit is a closed door rather than an
       open one. Reconciled in the same order the server uses: a single purchase
       cannot exceed the month, and auto-buy cannot exceed a single purchase. */
    const cap = this._n(c.monthlyCap);
    const per = Math.min(this._n(c.perPurchase), cap);

    if(!isFinite(amt) || amt <= 0)
      return { allow:false, reason:'I could not read a valid amount for this purchase, so I will not pay.' };
    if(!c.enabled)
      return { allow:false, reason:'Spending is switched off. Turn it on in Settings and set your limits.' };
    if(amt > per)
      return { allow:false, reason:'This is ' + this._m(amt) + ', over your ' + this._m(per) + ' single-purchase limit. Raise the limit yourself if you want it.' };

    const left = Math.max(0, cap - (+c.spent||0));
    if(amt > left)
      return { allow:false, reason:'This would take you past your ' + this._m(cap) + ' monthly cap - ' + this._m(left) + ' is left this month.' };

    const bar = Math.min(this._n(c.requireApprovalOver) || this._n(c.autoUnder), per);
    if(amt > bar)
      return { allow:true, needsApproval:true,
        reason:'This is ' + this._m(amt) + ', above your ' + this._m(bar) + ' auto-buy limit, so it needs one tap from you.' };

    return { allow:true, needsApproval:false,
      reason:'Within your ' + this._m(bar) + ' auto-buy limit and monthly budget.' };
  },

  _m(n){ return '$' + (+n||0).toFixed(2); },

  /* Record a real spend AFTER it happened. Counts against the cap. */
  record(amount, detail){
    const c = this._sync(this.cfg());
    const amt = +amount || 0;
    c.spent = +((+c.spent||0) + amt).toFixed(2);
    c.log = [{ at:Date.now(), amount:amt, item:String((detail&&detail.item)||'').slice(0,120),
      merchant:String((detail&&detail.merchant)||'').slice(0,80),
      approved:!!(detail&&detail.approved), rule:String((detail&&detail.rule)||'') }, ...(c.log||[])].slice(0,300);
    this.save(c);
    return { spent:c.spent, remaining:Math.max(0, (+c.monthlyCap||0) - c.spent) };
  },

  history(n){ return (this._sync(this.cfg()).log || []).slice(0, n || 50); },

  /* The terms shown wherever AMV can spend. Plain, honest, and it does not
     pretend to be more protection than it is. */
  TERMS:'You set these limits and you are responsible for purchases made within them, including purchases made by anyone using your account or device. AMV acts on your instructions and does not guarantee price, availability, delivery, or that a purchase can be cancelled or refunded. Refunds and returns are between you and the seller. Keep your limits at a level you are comfortable with, and keep your account secure.'
};
try{ window.AMVSpend = AMVSpend; }catch(e){}

/* Spending is exposed to chat/Crew as a CHECK plus a recorder - never as a
   raw "pay" action. Anything that actually moves money goes through the
   browser agent, which has its own approval gate on top of this one. */
try{
  if(typeof AMVConnectors !== 'undefined'){
    AMVConnectors.register({
      id:'spend', name:'Spending limits', auth:'none', channel:'local',
      isLive(){ return true; },
      actions:{
        limits:{ desc:'Your spending limits, what you have spent this month, and what is left.',
          async run(){ const c=AMVSpend.cfg();
            return { enabled:c.enabled, autoUnder:c.autoUnder, perPurchase:c.perPurchase,
              monthlyCap:c.monthlyCap, spentThisMonth:AMVSpend.spentThisMonth(),
              remaining:AMVSpend.remaining(), terms:AMVSpend.TERMS }; } },
        can_i_spend:{ desc:'Check whether a purchase is allowed before attempting it. Args: {amount}',
          async run(a){ return AMVSpend.check((a&&a.amount)||0); } },
        history:{ desc:'Every purchase AMV has made for you.',
          async run(){ const h=AMVSpend.history();
            if(!h.length){ const e=new Error('AMV has not made any purchases for you.'); e.code='needs_info'; throw e; }
            return { count:h.length, purchases:h }; } }
      }
    });
  }
}catch(e){}
