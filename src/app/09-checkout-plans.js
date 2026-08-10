/* ============================================================
   SECURE CHECKOUT
   Security model: raw card data NEVER enters AMV's JavaScript.
   - If a Stripe publishable key is set, we mount Stripe Elements
     (an isolated iframe owned by Stripe). We only ever receive a
     PaymentMethod token - never the PAN/CVC.
   - Without a key, we run a locked preview that refuses real card
     entry, so no sensitive data is ever typed into an unsafe field.
   ============================================================ */
const PLANS={
  free:{name:'Free',price:0,blurb:'Daily usage to explore everything',mult:'1\u00d7'},
  pro:{name:'Pro',price:15,blurb:'5\u00d7 the usage, all models, agents, and priority speed',mult:'5\u00d7'},
  elite:{name:'Elite',price:75,blurb:'20\u00d7 usage, full-stack builds, one-click deploy, 5 parallel agents, Apex first',mult:'20\u00d7'},
  ultra:{name:'Ultra',price:200,blurb:'50\u00d7 usage, unlimited parallel agents, whole-codebase context, autonomous projects, team workspaces',mult:'50\u00d7'},
  /* Priced PER SEAT, so `price` here is the price of one seat and the card that
     sells it multiplies. Every seat adds its own allowance to a shared pool
     rather than dividing a fixed one, which is why adding a teammate is worth
     paying for instead of something to ration. */
  team:{name:'Teams',price:20,perSeat:true,blurb:'Apex and a full Pro allowance for every person, pooled and shared',mult:''},
  custom:{name:'Custom',price:0,blurb:'A plan sized exactly to your usage',mult:''},
};
const TEAM_SEAT_MIN=3, TEAM_SEAT_MAX=500;
const PLAN_RANK={free:0,pro:1,elite:2,ultra:3,custom:2,team:2};

/* ============================================================
   CUSTOM PLAN - pay-for-what-you-need, guaranteed profitable.
   ------------------------------------------------------------
   PROFIT GUARANTEE (the part that can't be abused):
   - The customer pre-pays a FIXED monthly price for a HARD-CAPPED
     pool of usage. The cap is enforced server-side; once hit,
     requests stop until next cycle or a top-up.
   - Price is computed so it ALWAYS exceeds the worst-case API
     cost of that pool, by a fixed margin. Even if every token is
     spent on the most expensive model, you still profit.

   How the math protects you:
   - 1 "credit" = 1,000 tokens of allowance.
   - Worst-case cost of 1k tokens on our priciest engine (Apex,
     ~$100 / 1M output) ≈ $0.10. We price each credit well above
     that worst case, so margin is locked in regardless of model.
   - COST_PER_CREDIT below is the PRICE we charge; WORST_COST_PER_CREDIT
     is the most it can ever cost us. PRICE > WORST_COST always.
   ============================================================ */
const CUSTOM_PLAN = {
  MIN_PRICE: 15,           // $15 is the floor - matches everything the $15 Pro plan includes
  APEX_MIN_PRICE: 20,      // the top models (Apex) unlock at $20+
  MAX_PRICE: 5000,
  // Which models a custom plan can use for a given price. Below $20 you get the
  // full Pro model set; at $20+ the top models (Apex) unlock. This stops a cheap
  // custom plan from out-featuring the named tiers.
  modelsForPrice(price){ return (price>=this.APEX_MIN_PRICE) ? ['fast','core','coding','smart'] : ['fast','core','coding']; },
  hasApex(price){ return price>=this.APEX_MIN_PRICE; },
  /* ----------------------------------------------------------
     PROFIT MODEL (corrected & abuse-proof):
     Usage is metered in CREDITS, not raw tokens. Each model
     consumes credits at a rate equal to its REAL cost to us, so
     the pool drains faster on expensive models. This removes the
     "all-Apex worst case" - Apex burns ~20× the credits of Pulse.

     1 credit ≈ our cost of 1,000 Core tokens (~$0.0084).
     We sell credits at a price that locks in margin no matter
     which model is used, because the credit rate already reflects
     each model's cost. The hard cap is the final backstop.
     ---------------------------------------------------------- */
  // our REAL blended cost per 1M tokens, by model
  MODEL_COST_PER_M: { fast:2.8, core:8.4, coding:42, smart:56 },
  // credits charged per 1k tokens of each model (= cost-weighted)
  creditRate(model){
    const c=this.MODEL_COST_PER_M[model]||this.MODEL_COST_PER_M.core;
    return c/1000*1000/8.4; // normalize so Core≈1 credit / 1k tokens
  },
  // we SELL credits at this price; our cost per credit ≈ $0.0084 → ~3.5× margin
  PRICE_PER_CREDIT: 0.03,
  tier(credits){
    if(credits>=500000) return 0.022;
    if(credits>=100000) return 0.025;
    if(credits>=20000)  return 0.027;
    return 0.03;
  },
  creditsForPrice(price){
    price=Math.max(this.MIN_PRICE, Math.min(this.MAX_PRICE, price));
    let rate=0.03, credits=Math.floor(price/rate);
    for(let i=0;i<4;i++){ rate=this.tier(credits); credits=Math.floor(price/rate); }
    return credits;
  },
  // WORST-CASE real cost to us = if every credit is spent (cost per credit ≈ $0.0084)
  COST_PER_CREDIT: 0.0084,
  worstCost(price){ return this.creditsForPrice(price)*this.COST_PER_CREDIT; },
  margin(price){ const wc=this.worstCost(price); return wc>0 ? (price-wc)/price : 1; },
  // headline "tokens" = credits expressed as Core-equivalent tokens (1 credit ≈ 1k Core tokens)
  monthlyTokens(price){ return this.creditsForPrice(price)*1000; },
  dailyTokenCap(price){ return Math.max(50000, Math.floor(this.monthlyTokens(price)/8)); },
  rpmFor(price){ return price>=200?80:price>=75?40:price>=30?24:16; },
};
function _customPlanSummary(price){
  const credits=CUSTOM_PLAN.creditsForPrice(price);
  // realistic value framing: how much usage on a typical mix (mostly Core/Pulse)
  const coreTokens=credits*1000;                  // if all Core
  const apexTokens=Math.floor(credits*1000/ (CUSTOM_PLAN.MODEL_COST_PER_M.smart/CUSTOM_PLAN.MODEL_COST_PER_M.core)); // if all Apex
  return {
    price, credits,
    monthlyTokens: coreTokens,
    apexTokens,
    dailyCap: CUSTOM_PLAN.dailyTokenCap(price),
    rpm: CUSTOM_PLAN.rpmFor(price),
    hasApex: CUSTOM_PLAN.hasApex(price),
    worstCost: CUSTOM_PLAN.worstCost(price),
    margin: CUSTOM_PLAN.margin(price),
    approxMessages: Math.floor(credits/2),
    approxImages: Math.floor(credits/3),
  };
}
function _stripePK(){ return loadStr('amv_stripe_pk')||''; }
function _stripeLink(plan){ try{ const m=load('amv_pay_links')||{}; return m[plan]||''; }catch(e){ return ''; } }

function openCheckout(plan, customPrice){
  try{ track('upgrade_checkout_started', { plan }); }catch(e){}
  if(plan==='free'){ _setPlan('free'); renderBillingView(); toast('Switched to Free','info'); return; }
  if(plan==='custom'){
    const cfg=load('amv_custom_cfg')||{}; const price=customPrice||cfg.price||30;
    store('amv_custom_cfg',{price, ts:Date.now()});
    PLANS.custom.price=price; PLANS.custom.mult=''; PLANS.custom.blurb='Your custom plan - '+_customPlanSummary(price).monthlyTokens.toLocaleString()+' tokens/mo';
    openPaymentSheet('custom');
    return;
  }
  if(plan==='team'){
    /* A per-seat plan has no single price to put on a payment sheet - the total
       depends on how many people are on it. So it goes to the screen that asks
       that question, rather than a sheet that would show one seat's price as if
       it were the bill. */
    try{ S.tab='team'; setTab('team'); }catch(e){}
    return;
  }
  const p=PLANS[plan]; if(!p) return;
  openPaymentSheet(plan);
}

function openPaymentSheet(plan){
  const p=PLANS[plan]||PLANS.pro;
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="pay-ov" id="pay-bg"><div class="pay-modal" onclick="event.stopPropagation()">'+
    '<div class="pay-head"><div><div class="pay-title">Upgrade to '+p.name+'</div><div class="pay-sub">'+(p.blurb||'')+'</div></div><button class="dna-x" id="pay-x">✕</button></div>'+
    '<div class="pay-amount"><span class="pay-amt">$'+p.price+'</span><span class="pay-per">/month</span></div>'+
    '<div class="pay-methods-tabs" id="pay-tabs">'+
      '<button class="pay-tab on" data-pt="card">💳 Card</button>'+
      '<button class="pay-tab" data-pt="stripe">Stripe</button>'+
      '<button class="pay-tab" data-pt="paypal">PayPal / Venmo</button>'+
    '</div>'+
    '<div class="pay-body" id="pay-body"></div>'+
    '<div class="pay-secure"><span class="pay-lock">🔒</span> Encrypted &amp; secure · PCI-DSS Level 1 processing</div>'+
    '</div></div>';
  on($('pay-bg'),'click',closePaySheet); on($('pay-x'),'click',closePaySheet);
  $('pay-tabs').querySelectorAll('.pay-tab').forEach(t=>on(t,'click',()=>{ $('pay-tabs').querySelectorAll('.pay-tab').forEach(x=>x.classList.toggle('on',x===t)); _payRenderMethod(t.dataset.pt,plan); }));
  _payRenderMethod('card',plan);
}
function closePaySheet(){ const r=$('ovr'); if(r) r.innerHTML=''; }

function _payCfg(){ try{ return load('amv_pay_cfg')||{}; }catch(e){ return {}; } }
function _payRenderMethod(method,plan){
  const body=$('pay-body'); if(!body) return;
  const price=PLANS[plan].price;

  // ---- PAYPAL / VENMO - opens PayPal/Venmo externally ----
  if(method==='paypal'){
    const liveBackend=window.AMV_API&&AMV_API.live;
    if(liveBackend){
      // Real recurring subscription - opens PayPal's approval page externally.
      body.innerHTML='<div class="pay-wallet">'+
        '<button class="pay-wallet-b paypal" id="pay-pp-sub">Subscribe with PayPal →</button>'+
        '<button class="pay-wallet-b venmo" id="pay-vm-sub">Subscribe with Venmo →</button>'+
        '<p class="pay-note">Sets up a real monthly subscription through PayPal or Venmo. Opens securely, then brings you back.</p></div>';
      const go=async ()=>{ const pre=_preopenPay(); try{ const u=await AMV_API.paypalSubscribe(plan,(S.user&&S.user.email)||''); _openExternalPay(u,plan,'paypal',pre); }catch(e){ _closePay(pre); toast('PayPal: '+(e.message||'could not start'),'error',4500); } };
      on($('pay-pp-sub'),'click',go); on($('pay-vm-sub'),'click',go);
      return;
    }
    /* No backend. This used to load the PayPal JS SDK and take a one-time
       capture entirely in the browser - the comment beside it read "still gets
       you paid", and it did the opposite.

       The order was built here, with the amount read out of PLANS, which the
       payer can edit. The capture ran here. A capture that failed was swallowed
       and the plan granted anyway. And AMV's server never heard about any of
       it, so a customer who really paid had no receipt, no entitlement on any
       other device, and every reason to call their bank. A one-time capture was
       also unlocking a MONTHLY plan, permanently, for a single payment.

       The operator's own hosted PayPal link is a real page taking a real
       payment, so that stays. Everything else here says plainly that no
       payment can be taken, which is the truth. */
    body.innerHTML='<div class="pay-wallet">'+
      '<div id="paypal-fallback"><button class="pay-wallet-b paypal" id="pay-pp">Pay with PayPal →</button>'+
      '<button class="pay-wallet-b venmo" id="pay-vm">Pay with Venmo →</button></div>'+
      '<p class="pay-note" id="pay-pp-note">Opens PayPal or Venmo to confirm, then brings you back.</p></div>';
    _payPalNoServer(plan);
    return;
  }

  // ---- STRIPE - opens Stripe checkout externally (real subscription via backend) ----
  if(method==='stripe'){
    const link=_stripeLink(plan);
    const liveBackend=window.AMV_API&&AMV_API.live;
    body.innerHTML='<div class="pay-stripe-cta">'+
      '<div class="pay-brandmark stripe">stripe</div>'+
      '<button class="btn bp pay-submit" id="pay-stripe-go">Pay with Stripe →</button>'+
      '<div class="pay-stripe-badges"><span> Pay</span><span>G Pay</span><span>Visa</span><span>Mastercard</span><span>Amex</span></div>'+
      '<p class="pay-note">'+((link||liveBackend)?'Opens Stripe\u2019s secure checkout - card, Apple Pay, or Google Pay. Your plan unlocks once payment is confirmed.':'Connect your backend (Settings → Live/Backend) or add a Stripe link (Settings → Platform) to enable this.')+'</p></div>';
    on($('pay-stripe-go'),'click',async ()=>{
      const sb=$('pay-stripe-go');
      // Preferred: backend creates a real subscription Checkout session
      if(liveBackend){
        const pre=_preopenPay();
        if(sb){ sb.disabled=true; sb.textContent='Opening…'; }
        try{ const u=await AMV_API.stripeCheckout(plan, (S.user&&S.user.email)||''); _openExternalPay(u,plan,'stripe',pre); }
        catch(e){ _closePay(pre); toast('Stripe: '+(e.message||'could not start'),'error',4500); }
        finally{ if(sb){ sb.disabled=false; sb.textContent='Pay with Stripe →'; } }
        return;
      }
      // Fallback: a hosted Payment Link
      if(link){ _openExternalPay(link,plan,'stripe'); return; }
      toast('Add your backend URL or Stripe link in Settings','info',4500);
    });
    return;
  }

  // ---- CARD - secure card entry ----
  const pk=_stripePK();
  const liveBackend=window.AMV_API&&AMV_API.live;
  /* Best path: Stripe Elements iframe (card never touches AMV) when a
     publishable key is set AND there is a server to confirm the charge.

     The second half used to be missing. A publishable key only TOKENISES a
     card - it cannot charge one. The charge happens at /v1/subscribe, on the
     server. With a key and no backend, this rendered a full card form, took a
     real card number, tokenised it against real Stripe, charged nothing at
     all, and then said "You're now on Pro!". _payCard, forty lines down, has
     always refused to do exactly that: "No processor connected - do NOT
     pretend to charge." The rule is the same here. */
  if(pk && liveBackend){
    body.innerHTML='<div id="stripe-card-element" class="pay-stripe-el"></div><div id="stripe-card-errors" class="pay-err"></div>'+
      '<button class="btn bp pay-submit" id="pay-submit">Pay $'+price+' / month</button>';
    _mountStripe(pk,plan);
    return;
  }
  // Next best: route card payment through the backend's Stripe Checkout (real, secure).
  if(liveBackend || _stripeLink(plan)){
    const link=_stripeLink(plan);
    body.innerHTML='<div class="pay-stripe-cta">'+
      '<div class="pay-card-ic">💳</div>'+
      '<button class="btn bp pay-submit" id="pay-card-go">Pay by card →</button>'+
      '<div class="pay-stripe-badges"><span>Visa</span><span>Mastercard</span><span>Amex</span><span>Discover</span></div>'+
      '<p class="pay-note">Opens a secure card checkout. Your plan unlocks once payment is confirmed.</p></div>';
    on($('pay-card-go'),'click',async ()=>{
      const sb=$('pay-card-go');
      if(liveBackend){ const pre=_preopenPay(); if(sb){sb.disabled=true;sb.textContent='Opening…';} try{ const u=await AMV_API.stripeCheckout(plan,(S.user&&S.user.email)||''); _openExternalPay(u,plan,'card',pre); }catch(e){ _closePay(pre); toast('Card: '+(e.message||'failed'),'error',4500);} finally{ if(sb){sb.disabled=false;sb.textContent='Pay by card →';} } return; }
      if(link){ _openExternalPay(link,plan,'card'); }
    });
    return;
  }
  /* No processor connected. We deliberately do NOT render a card form here.
     Collecting a raw card number and CVC - even just in the browser - drags
     the whole business into PCI-DSS scope and creates breach liability for
     data we have no right to hold. Card details are only ever entered on the
     processor's own hosted page. So this states what to connect instead. */
  body.innerHTML=
    '<div class="pay-setup">'+
      '<div class="pay-setup-t">Secure checkout is not connected yet</div>'+
      '<div class="pay-setup-s">Card details are always entered on the payment provider’s own secure page - AMV never handles or stores card numbers. Connect Stripe in Settings → Platform and checkout turns on immediately.</div>'+
      '<button class="btn bp pay-submit" id="pay-card">Open secure checkout</button>'+
    '</div>';
  on($('pay-card'),'click',()=>_payCard(plan));
}

/* ---------- Apple Pay via external secure checkout ----------
   Apple Pay through raw PaymentRequest fails in embedded/iframe
   contexts and needs Apple merchant + domain verification. The
   reliable path: route to a hosted checkout (Stripe Checkout shows
   the native Apple Pay button automatically when supported, or your
   own backend creates the session). It opens the REAL payment page.
*/

/* THE CHECKOUT TAB HAS TO BE OPENED ON THE CLICK, NOT AFTER THE AWAIT.

   Every payment button did this:

       onclick -> await AMV_API.stripeCheckout(...) -> window.open(url)

   A browser only allows window.open while the page still has "transient user
   activation" from the click. Awaiting a network round trip spends it. Safari
   blocks the result outright, Firefox blocks it by default, and Chrome blocks
   it once the request is slow enough - so the person who pressed Pay waits,
   then reads "Allow pop-ups to open the secure checkout." on the one screen
   where hesitation costs the sale.

   So the tab is opened EMPTY during the click, while the activation is still
   valid, and pointed at the real URL when it arrives. If the request fails the
   placeholder is closed again rather than left sitting there. */
function _preopenPay(){
  try{
    const w=window.open('','_blank');
    if(w){
      /* The opener reference is the reason 'noopener' exists, and a window we
         navigate ourselves cannot use that flag - so it is cut by hand. */
      try{ w.opener=null; }catch(e){}
      try{ w.document.write('<!doctype html><meta charset="utf-8"><title>Opening secure checkout…</title>'+
        '<body style="margin:0;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;background:#fff;display:flex;align-items:center;justify-content:center;height:100vh">'+
        '<div style="text-align:center"><div style="font-weight:600;margin-bottom:6px">Opening secure checkout…</div>'+
        '<div style="opacity:.65;font-size:13px">One moment - do not close this tab.</div></div>'); }catch(e){}
    }
    return w||null;
  }catch(e){ return null; }
}
/* Opens the real external payment page. On success your checkout
   redirects back to ?paid=PLAN and the app activates the plan.
   `pre` is the tab opened during the click, if there was one. */
function _openExternalPay(url, plan, kind, pre){
  const safe=safeUrl(url);
  if(!safe){
    _closePay(pre);
    toast('That payment link is not valid. Please try again.','error',5000);
    return;
  }
  if(pre && !pre.closed){
    try{ pre.location.replace(safe); toast('Complete your payment in the new tab - your plan updates once it succeeds.','info',6000); return; }
    catch(e){ /* fall through to a fresh window */ }
  }
  const w=window.open(safe,'_blank','noopener');
  if(!w){ toast('Allow pop-ups to open the secure checkout.','error',5000); return; }
  toast('Complete your payment in the new tab - your plan updates once it succeeds.','info',6000);
}
/* A placeholder left open after a failure is worse than none - it sits on
   "Opening secure checkout…" for ever. */
function _closePay(pre){ try{ if(pre && !pre.closed) pre.close(); }catch(e){} }
try{ window._preopenPay=_preopenPay; window._closePay=_closePay; }catch(e){}

/* ---------- PayPal / Venmo with no backend connected ----------

   The only caller is the no-backend branch of the PayPal tab; when a server IS
   live, that tab creates a real PayPal SUBSCRIPTION through it instead and
   never comes here.

   This used to load the PayPal JS SDK and take a one-time capture in the
   browser. See the call site for why that had to go. What is left is the one
   honest option: the operator's own hosted PayPal or Venmo link, which is a
   real page taking a real payment, and a plain statement when there is not
   even that. */
function _payPalNoServer(plan){
  const cfg=_payCfg();
  const none='PayPal is not connected on this deployment, so no payment can be taken here and nothing has been charged. Ask the operator to connect a backend or add a PayPal link.';
  const wire=(id, link, kind)=>{
    const b=$(id); if(!b) return;
    if(!link){
      /* Not hidden. A button that vanishes leaves somebody staring at a tab
         with nothing in it and no idea why; one that says what is missing can
         be repeated to whoever can fix it. */
      b.setAttribute('aria-disabled','true');
    }
    on(b,'click',()=>{ if(link){ _openExternalPay(link,plan,kind); } else { toast(none,'info',7000); } });
  };
  wire('pay-pp', cfg.paypalLink||'', 'paypal');
  wire('pay-vm', cfg.venmoLink||cfg.paypalLink||'', 'venmo');
  const note=$('pay-pp-note');
  if(note && !cfg.paypalLink && !cfg.venmoLink){
    note.textContent='PayPal is not connected on this deployment yet, so no payment can be taken here.';
  }
}
/* Take a card payment WITHOUT ever touching the card.
   Raw card numbers must never reach AMV's own servers: receiving a PAN puts
   the whole business in PCI-DSS scope, and storing a CVC is prohibited
   outright. So this hands off to the processor's own hosted checkout, where
   the card is entered on THEIR page. AMV only ever learns that a payment
   succeeded - which is also what makes chargeback defence possible, because
   the processor holds the authentication record (3-D Secure). */
async function _payCard(plan){
  const sb=$('pay-card');
  const reset=()=>{ if(sb){sb.disabled=false;sb.textContent='Pay $'+PLANS[plan].price+' / month';} };
  if(sb){ sb.disabled=true; sb.textContent='Opening secure checkout…'; }

  if(!(window.AMV_API && AMV_API.live)){
    // No processor connected - do NOT pretend to charge.
    reset();
    toast('Connect a payment processor in Settings → Platform to take real card payments.','info',5500);
    return;
  }
  try{
    const email=(S.user&&S.user.email)||'';
    const url=safeUrl(await AMV_API.stripeCheckout(plan, email));
    if(!url) throw new Error('no checkout url');
    // The card is entered on the processor's page, never here.
    location.href=url;
  }catch(e){
    reset();
    toast('Could not open secure checkout. Please try again.','error',5000);
  }
}
function _cardBrand(d){ if(/^4/.test(d))return'visa'; if(/^5[1-5]/.test(d)||/^2[2-7]/.test(d))return'mastercard'; if(/^3[47]/.test(d))return'amex'; if(/^6/.test(d))return'discover'; return'card'; }
/* Single entry point for a completed payment, regardless of processor or path
   (Stripe redirect, PayPal capture, in-app card, or test simulation). Refreshes
   entitlement from the server when live, updates local plan + UI, and confirms
   to the user. Every success path should call this so behavior stays identical. */
async function handlePaymentSuccess(plan, opts){
  opts = opts || {};
  try{
    if(plan) _setPlan(plan);
    if(window.AMV_API && AMV_API.live && AMV_API.token){
      let tries=0; const poll=async()=>{ await syncEntitlement(); if(++tries<3) setTimeout(poll, 2500); };
      poll();
    }
  }catch(e){}
  try{ closePaySheet(); }catch(e){}
  try{ renderBillingView(); }catch(e){}
  try{ if(typeof setTab==='function' && opts.goBilling) setTab('billing'); }catch(e){}
  const nm = (PLANS[plan] && PLANS[plan].name) || plan;
  try{ toast(opts.simulated ? ('Test: activated '+nm+' plan') : ('You\u2019re now on '+nm+'!'), 'success', 4000); }catch(e){}
  try{ AEGIS.log('plan_upgrade',{plan, simulated:!!opts.simulated}); }catch(e){}
}
try{ window.handlePaymentSuccess=handlePaymentSuccess; }catch(e){}

function _payActivate(kind,plan){ _savePM({type:kind,brand:kind,last4:'••'}); handlePaymentSuccess(plan); }
/* When the user returns from an external checkout with ?paid=<plan>&pm=<method>, activate it. */
function _checkPayReturn(){
  try{
    const q=new URLSearchParams(window.location.search);
    // --- marketplace purchase return ---
    const bought=q.get('bought');
    if(bought){
      history.replaceState(null,'',window.location.pathname);
      /* The purchase that was left "pending" when checkout opened has now
         completed, so the transaction list is told. Without this a successful
         marketplace purchase read as Pending for ever. */
      try{ if(typeof _settleMarketTxn==='function') _settleMarketTxn('paid'); }catch(e){}
      S._mktTab='purchases'; setTab('market');
      toast('Purchase complete - it\u2019s in your purchases, ready to use.','success',5000);
      // entitlement is granted by the webhook; give it a moment then refresh
      setTimeout(()=>{ if(S.tab==='market'&&S._mktTab==='purchases') renderMarketView(); }, 3000);
      return;
    }
    const paid=q.get('paid');
    if(paid && PLANS[paid]){
      const pm=q.get('pm')||'card';
      const sid=q.get('session_id');
      // clean the URL so refresh doesn't re-trigger
      const url=window.location.pathname+window.location.hash;
      window.history.replaceState({},document.title,url);
      if(!window.AMV_API||!AMV_API.live){
        if(!sid && !q.get('pm') && !q.get('l4')){
          console.warn('Payment return ignored: missing verification params', { paid, pm, sid });
          return;
        }
      }
      // If a backend is live, trust the SERVER's entitlement, not the URL.
      if(window.AMV_API&&AMV_API.live&&S.user&&S.user.email){
        AMV_API.entitlement(S.user.email).then(ent=>{
          if(ent&&ent.plan&&PLANS[ent.plan]&&ent.plan!=='free'){
            if(ent.token) saveStr('amv_ent_token',ent.token);
            _savePM({type:pm,brand:pm,last4:'••'}); _setPlan(ent.plan);
            toast('Payment complete - welcome to '+PLANS[ent.plan].name+'!','success',5000);
            if(S.tab==='billing') renderBillingView();
          } else {
            // payment not yet confirmed by webhook; check again shortly
            setTimeout(()=>_verifyEntitlement(),4000);
            toast('Confirming your payment…','info',4000);
          }
        }).catch(()=>{
          /* A failed check is not a confirmed payment. This used to fall back to
             the plan named in the URL, so `?paid=elite` with the entitlement
             call blocked granted the plan outright - the exact faked unlock the
             server check exists to stop. Nothing is granted; it is retried, and
             the screen says what is happening. */
          _savePM({type:pm,brand:pm,last4:'••'});
          setTimeout(()=>_verifyEntitlement(), 4000);
          try{ toast('Confirming your payment… this can take a moment.','info',4500); }catch(e){}
          if(S.tab==='billing') renderBillingView();
        });
        return;
      }
      // No backend: this is local/demo mode only. A redirect param can't be
      // trusted as a real payment, so unlock only as a local preview and say so.
      _savePM({type:pm,brand:pm,last4:(q.get('l4')||'••').replace(/[^0-9•]/g,'').slice(0,4)||'••'});
      _setPlan(paid);
      setTimeout(()=>{ toast('Local preview: '+PLANS[paid].name+' enabled on this device. Real payments activate once your backend is connected.','info',5000); if(S.tab==='billing') renderBillingView(); },400);
    }
  }catch(e){ console.warn('_checkPayReturn failed:', e); }
}
window._checkPayReturn=_checkPayReturn;
/* Verify the real plan from the server (prevents faked unlocks). */
async function _verifyEntitlement(){
  try{
    if(!(window.AMV_API&&AMV_API.live)) return;
    if(!(S.user&&S.user.email)) return;
    const ent=await AMV_API.entitlement(S.user.email);
    if(ent&&ent.plan&&PLANS[ent.plan]){
      if(ent.token) saveStr('amv_ent_token',ent.token);
      const cur=loadStr('amv_plan')||'free';
      if(ent.plan!==cur){ _setPlan(ent.plan); if(S.tab==='billing') renderBillingView(); }
    }
  }catch(e){}
}
window._verifyEntitlement=_verifyEntitlement;

function _mountStripe(pk,plan){
  const go=()=>{
    try{
      const stripe=Stripe(pk);
      const elements=stripe.elements();
      const card=elements.create('card',{style:{base:{color:'#e9edf2',fontFamily:'Inter,sans-serif',fontSize:'14px','::placeholder':{color:'#8b939e'}}}});
      card.mount('#stripe-card-element');
      card.on('change',e=>{ const el=$('stripe-card-errors'); if(el) el.textContent=e.error?e.error.message:''; });
      const sb=$('pay-submit');
      on(sb,'click',async ()=>{
        sb.disabled=true; sb.textContent='Processing…';
        // Create a PaymentMethod token client-side - card data goes Stripe→Stripe, never to us.
        const {paymentMethod,error}=await stripe.createPaymentMethod({type:'card',card});
        if(error){ const el=$('stripe-card-errors'); if(el) el.textContent=error.message; sb.disabled=false; sb.textContent='Pay $'+PLANS[plan].price+' / month'; return; }
        // Send ONLY the token to your backend to create the subscription.
        try{
          /* The server is what charges the card. Without one the token is
             worth nothing and no money has moved, so there is nothing to
             celebrate and no plan to grant. openPaymentSheet no longer mounts
             this form without a backend; this is the second lock, because the
             failure it prevents is telling somebody they have paid when they
             have not. */
          if(!(window.AMV_API&&AMV_API.live)){
            const el=$('stripe-card-errors');
            if(el) el.textContent='Payments are not connected on this deployment, so your card has NOT been charged. Nothing was taken.';
            sb.disabled=false; sb.textContent='Pay $'+PLANS[plan].price+' / month';
            return;
          }
          // The SERVER decides whether the plan is granted. Never assume the
          // charge worked: an unchecked response here would hand out paid
          // plans for free whenever the request failed or needed 3-D Secure.
          const r=await fetchDeadline(AMV_API.base.replace(/\/$/,'')+'/v1/subscribe',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+AMV_API.token},body:JSON.stringify({plan,payment_method:paymentMethod.id})});
          const d=await r.json().catch(()=>({}));
          if(!r.ok || !d.ok){
            const el=$('stripe-card-errors');
            if(el) el.textContent = d.need || d.error || 'Payment was not completed.';
            sb.disabled=false; sb.textContent='Pay $'+PLANS[plan].price+' / month';
            return;   // no plan, no payment method saved
          }
          const c=paymentMethod.card||{};
          _savePM({type:'card',brand:c.brand||'card',last4:c.last4||'',exp:(c.exp_month?String(c.exp_month).padStart(2,'0'):'')+'/'+(c.exp_year?String(c.exp_year).slice(-2):'')});
          _setPlan(plan); closePaySheet(); renderBillingView(); toast('You are now on '+PLANS[plan].name+'!','success');
        }catch(e){ const el=$('stripe-card-errors'); if(el) el.textContent='Could not complete subscription. Try again.'; sb.disabled=false; sb.textContent='Pay $'+PLANS[plan].price+' / month'; }
      });
    }catch(e){ const b=$('pay-body'); if(b) b.innerHTML='<div class="pay-err">Could not load secure payment field. Check your Stripe key.</div>'; }
  };
  if(window.Stripe){ go(); return; }
  const s=document.createElement('script'); s.src='https://js.stripe.com/v3/'; s.onload=go; s.onerror=()=>{ const b=$('pay-body'); if(b) b.innerHTML='<div class="pay-err">Could not reach Stripe. Check your connection.</div>'; }; document.head.appendChild(s);
}
/* openPaymentMethod lived here: it opened the payment sheet on a chosen tab,
   for a "manage your payment methods" screen that no longer exists. Referenced
   by nothing. Adding or changing a card is the billing portal's job, which is
   Stripe's own screen and always current. */
window.openCheckout=openCheckout;window.openPaymentSheet=openPaymentSheet;


/* === APPS & EXTENSIONS === */
function renderAppsView(){
  const vc=$('vc'); if(!vc) return;
  // mode: 'auto' = runs in background once connected; 'manual' = you upload/drive it
  const badge=(mode)=> mode==='auto'
    ? '<span class="ax-badge ax-auto"><span class="ax-dot"></span>Autonomous \u00b7 runs in the background</span>'
    : (mode==='manual' ? '<span class="ax-badge ax-manual">Manual \u00b7 you upload &amp; drive it</span>' : '');
  const app=(icon,name,desc,btn,bg,mode)=>'<div class="appx-card">'
    +'<div class="appx-ic" style="background:'+bg+'">'+icon+'</div>'
    +'<div class="appx-name">'+name+'</div>'
    +badge(mode)
    +'<div class="appx-desc">'+desc+'</div>'+btn+'</div>';
  const row=(icon,name,desc,btn,bg,mode)=>'<div class="appx-row">'
    +'<div class="appx-ic sm" style="background:'+bg+'">'+icon+'</div>'
    +'<div class="appx-row-body"><div class="appx-name">'+name+' '+badge(mode)+'</div><div class="appx-desc">'+desc+'</div></div>'
    +'<div class="appx-row-act">'+btn+'</div></div>';
  vc.innerHTML=
    '<div class="sv fi"><div class="vi" style="max-width:780px">'+
      '<span class="eyebrow">Everywhere you work</span>'+
      '<h2>Apps &amp; Extensions</h2>'+
      '<p class="vsub">Put AMV in your browser, desktop, phone, editor, and the tools you already use. One account, every surface.</p>'+

      // legend explaining the two kinds
      '<div class="ax-legend">'+
        '<div class="ax-legend-item"><span class="ax-badge ax-auto"><span class="ax-dot"></span>Autonomous</span><span>Connect once and AMV works on its own in the background - no uploads needed.</span></div>'+
        '<div class="ax-legend-item"><span class="ax-badge ax-manual">Manual</span><span>You upload a file or kick it off each time - AMV works on what you give it.</span></div>'+
      '</div>'+

      '<div class="ss2"><h3>Featured</h3>'+
        '<div class="appx-grid">'+
          app('🌐','AMV for Web','Runs in any browser right now - full chat, images, agents, and automations. Add it to your home screen for one-tap access.','<button class="btn bp" style="width:100%" data-dact="installPWA">Add to home screen</button>','rgba(66,133,244,.12)','auto')+
          app('💻','VS Code','Generate, explain, and debug code inline. Use the Dev workspace here, or open your project in VS Code.','<button class="btn bp" style="width:100%" data-dact="openDevView">Open Dev workspace</button>','rgba(0,118,212,.12)','auto')+
          app('💬','Slack','Bring AMV into any channel with /amv - answers, summaries, and tasks without leaving Slack.','<button class="btn" style="width:100%" data-dact="setTabBtn" data-darg="integrations">Connect Slack</button>','rgba(74,21,75,.14)','auto')+
        '</div>'+
      '</div>'+

      '<div class="ss2"><h3>Desktop</h3>'+
        '<div class="appx-grid two">'+
          app('🍎','macOS','Menu-bar access, drag-and-drop files, and native system integrations.','<a href="#" class="btn bp" style="width:100%" data-dact="downloadDesktop" data-darg="mac">Download for Mac</a>','rgba(255,255,255,.06)','auto')+
          app('🪟','Windows','Taskbar integration, file analysis, and native automation on Windows.','<a href="#" class="btn bp" style="width:100%" data-dact="downloadDesktop" data-darg="win">Download for Windows</a>','rgba(255,255,255,.06)','auto')+
        '</div>'+
      '</div>'+

      '<div class="ss2"><h3>Mobile</h3>'+
        '<div class="appx-grid two">'+
          app('📱','iPhone & iPad','Voice chat, tasks on the go, file uploads. Works in Safari now - add to your home screen for an app-like experience.','<button class="btn bp" style="width:100%" data-dact="installPWA">Add to home screen</button>','rgba(255,255,255,.06)','auto')+
          app('🤖','Android','Full chat, voice mode, uploads, and automations. Works in Chrome now - install it straight to your home screen.','<button class="btn bp" style="width:100%" data-dact="installPWA">Install app</button>','rgba(63,185,80,.12)','auto')+
        '</div>'+
      '</div>'+

      '<div class="ss2"><h3>Developer tools</h3>'+
        '<div class="appx-rows">'+
          row('🔶','JetBrains','IntelliJ, PyCharm, WebStorm, Rider - AMV across every JetBrains IDE.','<button class="btn" data-dact="amvStoreLink" data-darg="jetbrains">Notify me</button>','rgba(254,113,26,.12)','auto')+
          row('⌨️','CLI / Terminal','Pipe context, run agents, and script AMV from your shell.','<button class="btn" data-dact="toastInfo" data-darg="CLI access ships with the API - add your key in Integrations">Get CLI</button>','rgba(255,255,255,.06)','auto')+
          row('🔌','REST API','Build AMV into your own product. Add your key under Integrations → API.','<button class="btn" data-dact="setTabBtn" data-darg="integrations">Open API setup</button>','rgba(85,144,255,.12)','auto')+
        '</div>'+
      '</div>'+

      '<div class="ss2"><h3>Office &amp; files</h3>'+
        '<div class="appx-rows">'+
          row('📊','Excel &amp; CSV','Upload any sheet - AMV runs formulas, spots trends, builds pivots and charts.','<button class="btn" data-dact="setTabBtn" data-darg="chat">Try in chat</button>','rgba(33,115,70,.12)','manual')+
          row('📑','PowerPoint','Describe a deck and AMV builds slides, notes, and structure. Export .pptx.','<button class="btn" data-dact="setTabBtn" data-darg="chat">Try in chat</button>','rgba(198,67,30,.12)','manual')+
          row('📝','Word','Reports, proposals, letters, contracts - written and exported, ready to edit.','<button class="btn" data-dact="setTabBtn" data-darg="chat">Try in chat</button>','rgba(0,120,212,.12)','manual')+
        '</div>'+
        '<p class="appx-note">These are <b>manual</b>: upload an Office file with the 📎 button in chat, or describe what you need and AMV builds it from scratch - then you download the result.</p>'+
      '</div>'+

    '</div></div>';
}
function setTabBtn(t){ setTab(t); }
window.setTabBtn=setTabBtn;

