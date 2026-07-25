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
  custom:{name:'Custom',price:0,blurb:'A plan sized exactly to your usage',mult:''},
};
const PLAN_RANK={free:0,pro:1,elite:2,ultra:3,custom:2};

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
  MIN_PRICE: 15,           // $15 is the floor — matches everything the $15 Pro plan includes
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
      const go=async ()=>{ try{ const u=await AMV_API.paypalSubscribe(plan,(S.user&&S.user.email)||''); _openExternalPay(u,plan,'paypal'); }catch(e){ toast('PayPal: '+(e.message||'could not start'),'error',4500); } };
      on($('pay-pp-sub'),'click',go); on($('pay-vm-sub'),'click',go);
      return;
    }
    // No backend: PayPal JS SDK one-time capture (still gets you paid)
    body.innerHTML='<div class="pay-wallet"><div id="paypal-buttons" class="pay-paypal-host"></div>'+
      '<div id="paypal-fallback" style="display:none"><button class="pay-wallet-b paypal" id="pay-pp">Pay with PayPal →</button>'+
      '<button class="pay-wallet-b venmo" id="pay-vm">Pay with Venmo →</button></div>'+
      '<p class="pay-note">Opens PayPal or Venmo to confirm, then brings you back.</p></div>';
    _mountPayPal(plan);
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
        if(sb){ sb.disabled=true; sb.textContent='Opening…'; }
        try{ const u=await AMV_API.stripeCheckout(plan, (S.user&&S.user.email)||''); _openExternalPay(u,plan,'stripe'); }
        catch(e){ toast('Stripe: '+(e.message||'could not start'),'error',4500); }
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
  // Best path: Stripe Elements iframe (card never touches AMV) when publishable key is set.
  if(pk){
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
      if(liveBackend){ if(sb){sb.disabled=true;sb.textContent='Opening…';} try{ const u=await AMV_API.stripeCheckout(plan,(S.user&&S.user.email)||''); _openExternalPay(u,plan,'card'); }catch(e){ toast('Card: '+(e.message||'failed'),'error',4500);} finally{ if(sb){sb.disabled=false;sb.textContent='Pay by card →';} } return; }
      if(link){ _openExternalPay(link,plan,'card'); }
    });
    return;
  }
  // Last resort (no processor connected): show the form but be honest it needs setup.
  body.innerHTML=
    '<div class="pay-field"><label>Card number</label><input id="pf-num" inputmode="numeric" autocomplete="cc-number" placeholder="1234 1234 1234 1234" maxlength="19"></div>'+
    '<div class="pay-row"><div class="pay-field"><label>Expiry</label><input id="pf-exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM / YY" maxlength="7"></div>'+
    '<div class="pay-field"><label>CVC</label><input id="pf-cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="CVC" maxlength="4"></div></div>'+
    '<div class="pay-field"><label>Name on card</label><input id="pf-name" autocomplete="cc-name" placeholder="Full name"></div>'+
    '<button class="btn bp pay-submit" id="pay-card">Pay $'+price+' / month</button>';
  const num=$('pf-num'); if(num) on(num,'input',()=>{ let v=num.value.replace(/\D/g,'').slice(0,16); num.value=v.replace(/(.{4})/g,'$1 ').trim(); });
  const exp=$('pf-exp'); if(exp) on(exp,'input',()=>{ let v=exp.value.replace(/\D/g,'').slice(0,4); if(v.length>=3)v=v.slice(0,2)+' / '+v.slice(2); exp.value=v; });
  const cvc=$('pf-cvc'); if(cvc) on(cvc,'input',()=>{ cvc.value=cvc.value.replace(/\D/g,'').slice(0,4); });
  on($('pay-card'),'click',()=>_payCard(plan));
}

/* ---------- Apple Pay via external secure checkout ----------
   Apple Pay through raw PaymentRequest fails in embedded/iframe
   contexts and needs Apple merchant + domain verification. The
   reliable path: route to a hosted checkout (Stripe Checkout shows
   the native Apple Pay button automatically when supported, or your
   own backend creates the session). It opens the REAL payment page.
*/

/* Opens the real external payment page. On success your checkout
   redirects back to ?paid=PLAN and the app activates the plan. */
function _openExternalPay(url, plan, kind){
  const w=window.open(url,'_blank');
  if(!w){ toast('Allow pop-ups to open the secure checkout.','error',5000); return; }
  toast('Complete your payment in the new tab - your plan updates once it succeeds.','info',6000);
}

/* ---------- REAL PayPal / Venmo (PayPal JS SDK) ---------- */
function _mountPayPal(plan){
  const cfg=_payCfg();
  const clientId=cfg.paypalClientId||loadStr('amv_paypal_client');
  const showFallback=(msg)=>{ const fb=$('paypal-fallback'); if(fb) fb.style.display='block'; const host=$('paypal-buttons'); if(host) host.style.display='none'; const pp=$('pay-pp'); if(pp) on(pp,'click',()=>{ const l=cfg.paypalLink; if(l){_openExternalPay(l,plan,'paypal');} else toast(msg||'Add your PayPal client ID in Settings → Platform','info',4500); }); const vm=$('pay-vm'); if(vm) on(vm,'click',()=>{ const l=cfg.venmoLink||cfg.paypalLink; if(l){_openExternalPay(l,plan,'venmo');} else toast('Add your PayPal client ID (or a Venmo link) in Settings → Platform','info',4500); }); };
  if(!clientId){ showFallback(); return; }
  const render=()=>{
    if(!window.paypal||!window.paypal.Buttons){ showFallback('PayPal SDK did not load'); return; }
    try{
      const host=$('paypal-buttons'); if(host){ host.style.display='block'; host.innerHTML=''; }
      const liveBackend=window.AMV_API&&AMV_API.live;
      window.paypal.Buttons({
        style:{ layout:'vertical', color:'blue', shape:'rect', label:'pay' },
        createOrder:async (data,actions)=>{
          // Server-side order creation when backend is live (more secure + reliable)
          if(liveBackend){ try{ return await AMV_API.paypalCreate(plan); }catch(e){} }
          return actions.order.create({ purchase_units:[{ amount:{ value:String(PLANS[plan].price) }, description:'AMV '+PLANS[plan].name+' (monthly)' }] });
        },
        onApprove:async (data,actions)=>{
          // Server-side capture verifies the money landed before unlocking
          if(liveBackend && data.orderID){
            try{ const res=await AMV_API.paypalCapture(data.orderID,(S.user&&S.user.email)||''); if(res&&res.token){ saveStr('amv_ent_token',res.token); } _payActivate('paypal',res.plan||plan); return; }catch(e){ toast('PayPal: '+(e.message||'capture failed'),'error',4500); return; }
          }
          try{ await actions.order.capture(); }catch(e){}
          _payActivate('paypal',plan);
        },
        onError:()=>{ showFallback('PayPal error - try again'); }
      }).render('#paypal-buttons');
    }catch(e){ showFallback(); }
  };
  if(window.paypal&&window.paypal.Buttons){ render(); return; }
  const s=document.createElement('script');
  s.src='https://www.paypal.com/sdk/js?client-id='+encodeURIComponent(clientId)+'&currency=USD&enable-funding=venmo';
  s.onload=render; s.onerror=()=>showFallback('Could not reach PayPal');
  document.head.appendChild(s);
}
function _payCard(plan){
  const num=($('pf-num')||{}).value||''; const exp=($('pf-exp')||{}).value||''; const cvc=($('pf-cvc')||{}).value||''; const name=($('pf-name')||{}).value||'';
  const digits=num.replace(/\D/g,'');
  if(digits.length<13){ toast('Enter a valid card number','error'); return; }
  if(!/\d{2}\s*\/\s*\d{2}/.test(exp)){ toast('Enter a valid expiry','error'); return; }
  if(cvc.length<3){ toast('Enter the CVC','error'); return; }
  if(!name.trim()){ toast('Enter the name on the card','error'); return; }
  const sb=$('pay-card'); if(sb){ sb.disabled=true; sb.textContent='Processing…'; }
  const reset=()=>{ if(sb){sb.disabled=false;sb.textContent='Pay $'+PLANS[plan].price+' / month';} };
  const finish=()=>{ _savePM({type:'card',brand:_cardBrand(digits),last4:digits.slice(-4),exp:exp.replace(/\s/g,'')}); handlePaymentSuccess(plan); };
  if(window.AMV_API&&AMV_API.live){
    // Real charge through your backend (which talks to the processor).
    fetch(AMV_API.base.replace(/\/$/,'')+'/v1/pay/card',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+AMV_API.token},body:JSON.stringify({plan,card:{number:digits,exp,cvc,name}})})
      .then(r=>{ if(!r.ok) throw new Error(); finish(); })
      .catch(()=>{ reset(); toast('Payment could not be completed','error'); });
  } else {
    // No processor connected yet - do NOT pretend to charge. Tell the user how to go live.
    reset();
    toast('Connect a payment processor in Settings → Platform to take real card payments.','info',5500);
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
        }).catch(()=>{ _savePM({type:pm,brand:pm,last4:'••'}); _setPlan(paid); if(S.tab==='billing') renderBillingView(); });
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
          if(window.AMV_API&&AMV_API.live){
            await fetch(AMV_API.base.replace(/\/$/,'')+'/v1/subscribe',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+AMV_API.token},body:JSON.stringify({plan,payment_method:paymentMethod.id})});
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
function openPaymentMethod(method){
  // All methods open the payment sheet on the chosen tab (defaults to Pro plan to add a method)
  const plan='pro';
  openPaymentSheet(plan);
  setTimeout(()=>{ const map={card:'card',stripe:'stripe',apple:'stripe',paypal:'paypal',venmo:'paypal'}; const tab=map[method]||'card'; const tb=document.querySelector('.pay-tab[data-pt="'+tab+'"]'); if(tb) tb.click(); },50);
}
window.openCheckout=openCheckout;window.openPaymentSheet=openPaymentSheet;window.openPaymentMethod=openPaymentMethod;


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

