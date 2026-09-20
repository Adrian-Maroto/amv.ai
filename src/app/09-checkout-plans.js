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
  free:{name:'Free',price:0,blurb:'A monthly allowance, enough to explore everything',get allowance(){return _allowanceLabel('free');}},
  pro:{name:'Pro',price:15,blurb:'Every model, autonomous agents, and the app sandbox',get allowance(){return _allowanceLabel('pro');}},
  elite:{name:'Elite',price:75,blurb:'Ship real apps to a live URL, on our most capable engine',get allowance(){return _allowanceLabel('elite');}},
  ultra:{name:'Ultra',price:200,blurb:'Whole codebases, autonomous projects, and a team around them',get allowance(){return _allowanceLabel('ultra');}},
  /* Priced PER SEAT, so `price` here is the price of one seat and the card that
     sells it multiplies. Every seat adds its own allowance to a shared pool
     rather than dividing a fixed one, which is why adding a teammate is worth
     paying for instead of something to ration. */
  team:{name:'Teams',price:20,perSeat:true,blurb:'Apex and a full Pro allowance for every person, pooled and shared',allowance:''},
  custom:{name:'Custom',price:0,blurb:'A plan sized exactly to your usage',allowance:''},
};
const TEAM_SEAT_MIN=3, TEAM_SEAT_MAX=500;
const PLAN_RANK={free:0,pro:1,elite:2,ultra:3,custom:2,team:2};

/* WHAT THE PLANS PAGE MAY SAY ABOUT BACKGROUND JOBS.

   The page sold Elite and above "Unlimited scheduled automations", in the
   feature list and again in the comparison table. The server has never allowed
   that: AUTO_MAX_BY_PLAN caps Elite at 25 and Ultra at 100, a Teams seat gets
   five per seat, and a Custom plan gets 25 or 100 by its tier. So somebody paid
   seventy-five dollars a month for a word the product could not honour, and
   found out at their twenty-sixth job.

   Nothing was wrong with the limit. The claim was wrong, and the honest fix is
   to say the number - which is a good number, and reads better than a word
   nobody believes anyway.

   Mirrored from the Worker rather than restated: a test lifts BOTH functions
   out of their own source and compares what they answer, plan by plan, so the
   page cannot drift away from the thing that enforces it the way it just did.
   Comparing the tables alone would not have been enough - free is 0 in the
   table and 1 in the answer, because `|| 1` turns the zero into the single
   weekly job the refusal message promises. */
const AUTO_MAX_BY_PLAN={free:0,pro:5,elite:25,ultra:100};

/* WHAT "PARALLEL AGENTS" WAS SELLING, AND WHAT IS ACTUALLY TIERED.

   The comparison table read: Free "-", Pro "Limited", Elite "Up to 5", Ultra
   "Unlimited". Nothing in the Worker caps how many agents run at once, at any
   tier - so Pro and Elite already had what Ultra was sold as having, and the
   headline reason to pay $125 more was fiction.

   It was never a spend hole. Every agent's model calls go through the atomic
   per-account meter, so somebody running twenty at once simply burns their own
   allowance faster. What it cost was the reason to upgrade.

   Not fixed by adding a concurrency cap. That would REMOVE capability from
   accounts that have it today, to make a table honest, for no margin gain -
   and concurrency limits exist to protect infrastructure, which here is already
   protected by the per-account meter and the global daily ceiling.

   Fixed by selling the throughput tier that is real and already enforced:
   PLAN_LIMITS.rpm, checked atomically through the Durable Object on every
   request. Mirrored here the same way the automation count is, with a test that
   lifts both and compares what they answer. */
const PLAN_RPM={free:8,pro:20,elite:40,ultra:80};

/* THE MULTIPLE IS GONE, BECAUSE IT STOPPED BEING TRUE.

   This advertised "7x / 25x / 70x the free allowance", computed from the token
   caps. That claim died with the engine change, and not because anything
   broke: the paid floor now runs an engine costing five times per token what
   the free one does, so the same money buys a far smaller multiple of tokens.
   Funded honestly, Pro is about 1.5x Free - and "1x the free allowance" on the
   card somebody reads before paying is worse than saying nothing.

   The multiple was always the weaker claim anyway. It compared token counts
   across engines of completely different cost, which is a ratio of two things
   that are not the same thing. What is actually better about a paid plan is
   WHICH ENGINE it runs, and that is now what the cards say - with the
   allowance as a real number beside it rather than a ratio to somewhere else.

   Mirrored from the Worker, with a test comparing both tables, exactly as
   before. */
const PLAN_MONTH_TOKENS={free:325000,pro:2340000,elite:9100000,ultra:23400000};
/* Short enough to sit on a card, and never rounded UP - an advertised
   allowance is a promise, so 2,470,000 shows as 2.4M rather than 2.5M. */
function _allowanceLabel(p){
  const n=PLAN_MONTH_TOKENS[p];
  if(!n) return '';
  if(n>=1e6){ const m=Math.floor(n/1e5)/10; return (m%1===0?m.toFixed(0):m.toFixed(1))+'M'; }
  return Math.floor(n/1000)+'K';
}

/* WHAT A PLAN IS ACTUALLY SOLD ON NOW: MESSAGES, AND WHEN THEY COME BACK.

   Tokens were never a unit anybody could hold. "2.3M tokens" answers no
   question a person walking up to a pricing page is asking, and the ratio that
   used to sit beside it - "5x the usage" - compared token counts across
   engines of completely different cost, which is a ratio of two things that
   are not the same thing.

   So the cards lead with three numbers the server genuinely enforces:

     how many messages a month,
     how many in any five-hour window, and
     how many of those may run the top engines in a week.

   The third is the one holding the economics up, and it is stated rather than
   buried: the dearest engine costs about two and a half cents a message, so a
   hundred a week is roughly the entire compute budget a fifteen dollar plan
   has after overhead. Printing it is what makes "the best engine at the
   cheapest paid tier" a sentence that survives the invoice. Hiding it would
   make the first refusal a surprise, which is the thing this repository has
   been burned for twice.

   MIRRORED FROM THE WORKER, NOT RESTATED. PLAN_LIMITS is what actually
   refuses a request; these are its numbers copied for the page to print, and a
   suite lifts both and compares them plan by plan - the same arrangement
   AUTO_MAX_BY_PLAN and PLAN_RPM already have, for the same reason. A price
   that disagrees with its enforcement is the defect, not the number. */
const PLAN_MONTH_MESSAGES={free:3000,pro:100000,elite:300000,ultra:1000000};
const PLAN_MESSAGES_5H={free:25,pro:1000,elite:3000,ultra:10000};
const PLAN_TOP_WEEK={free:0,pro:100,elite:500,ultra:1300};
/* Five hours, named once. It is the shape of the window, not a number to tune
   on a page. */
const USAGE_WINDOW_HOURS=5;

function _planMsgNum(tbl,p){
  if(p==='team'||p==='custom') return tbl.pro;   // the tier those rank at
  return tbl[p]||tbl.free;
}
/* Written out in full on a card. "100K messages" reads as a rounding; 100,000
   reads as a promise, and it is the promise that is true. */
function _msgMonthLabel(p){ return _planMsgNum(PLAN_MONTH_MESSAGES,p).toLocaleString(); }
function _msg5hLabel(p){ return _planMsgNum(PLAN_MESSAGES_5H,p).toLocaleString(); }
function _topWeekLabel(p){ return _planMsgNum(PLAN_TOP_WEEK,p).toLocaleString(); }

function _rpmForPlan(p){
  if(p==='team') return PLAN_RPM.elite;      // a seat carries Elite capability
  if(p==='custom') return PLAN_RPM.elite;    // the tier a Custom plan ranks at
  return PLAN_RPM[p]||PLAN_RPM.free;
}
/* Two forms, because a table cell and a sentence want different things. The
   automation row taught this the first time: with the row already labelled
   "Scheduled & background jobs", printing "25 scheduled jobs" in every cell
   says it twice. Same here. */
function _rpmCell(p){ return String(_rpmForPlan(p)); }
function _rpmLabel(p){ return _rpmForPlan(p)+' requests a minute'; }
const AUTO_MAX_PER_USER=100;
function _autoMaxForPlan(p,seats){
  if(p==='team') return Math.min(AUTO_MAX_PER_USER, 5*(Number(seats)||TEAM_SEAT_MIN));
  if(p==='custom') return 25;               // the tier a Custom plan ranks at
  return AUTO_MAX_BY_PLAN[p]||1;            // 0 means "the one free weekly job", not none
}
/* THE ONE APPROVED WAY TO SAY THE NUMBER IN A SENTENCE.

   I DELETED THIS AS DEAD CODE AND A TEST REVERSED ME, which is the third time
   in this codebase and the first where the reason was already written down.
   tests/worker/the-page-cannot-promise-what-the-server-refuses says it plainly:

     "_autoMaxLabel stays and is still checked against the server's table
      further down, because it is the one function that turns the cap into a
      sentence: the next screen that wants to say '25 scheduled jobs' must
      reach for it rather than typing the number, which is how the word
      'unlimited' got onto the page the first time."

   So it has no callers ON PURPOSE, and the absence of callers is the thing I
   read as permission to remove it. The comparison row prints the bare number
   because that row is already labelled; the next screen that needs the words
   must not type them. That suite also evaluates this function against the
   Worker's own AUTO_MAX_BY_PLAN, so the wording and the server's table cannot
   drift apart.

   Do not remove it for having no callers. That is the point of it. */
function _autoMaxLabel(p){
  const n=_autoMaxForPlan(p);
  return n===0 ? '-' : n+' scheduled job'+(n===1?'':'s');
}

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

/* The owner's own Stripe payment link for a plan, opened in a new tab.

   Was `onclick="window.open(S.sp,'_blank','noopener')"` - an inline handler,
   and one that opened whatever string was in that setting without asking what
   scheme it was. The setting is the operator's, so this is not the usual
   untrusted-input case, but it is stored in localStorage and reaches
   window.open: safeUrl costs nothing and a `javascript:` in a settings field
   would otherwise be a live one.

   A missing or rejected link says so instead of opening a blank tab, because
   "nothing happened" on the button that takes somebody's money is the worst
   possible way to find out a setting is wrong. */
function _openPlanLink(which){
  const raw = which==='elite' ? (S.se||'') : (S.sp||'');
  const url = safeUrl(raw);
  if(!url){
    toast('That plan link is not set up yet. Add it in Settings and try again.','error',4500);
    return;
  }
  try{ track('upgrade_checkout_started', { plan: which==='elite'?'elite':'pro' }); }catch(e){}
  window.open(url,'_blank','noopener');
}
try{ window._openPlanLink=_openPlanLink; }catch(e){}

/* THE ACCOUNT IS ASKED FOR BEFORE THE PAYMENT SHEET, NOT AFTER IT.

   A signed-out visitor could walk the whole way: pick a plan, read its page,
   press Proceed to payment, get the sheet, press Pay by card - and be told
   "Session expired - sign in again". They never had a session. The server is
   right to refuse (stripeCheckout and paypalSubscribe both requireUser, so no
   money moved and nothing was granted to nobody), but the refusal arrives as a
   401, and 01-core reads a 401 on any non-/auth call as an expired session.

   So the last screen before paying blamed the visitor for a session they never
   had. That is the worst place in the product to lose somebody, and it looked
   like a bug in AMV rather than a step they had missed.

   Asked only when the server is the one that would take the payment. A hosted
   payment link collects the email at the processor and needs no account here,
   and with no backend at all the sheet's own panels already say plainly that
   nothing can be charged - putting a sign-up wall in front of either would be
   demanding an account for something that does not need one. */
let _pendingUpgrade='';
function _rememberUpgrade(plan){
  _pendingUpgrade=plan||'';
  /* sessionStorage as well as the variable, so a sign-in that leaves the page
     and comes back - the Google round trip - still knows what they were
     buying. It is this tab only and it is cleared the moment it is used. */
  try{ sessionStorage.setItem('amv_pending_upgrade', _pendingUpgrade); }catch(e){}
}
function _takePendingUpgrade(){
  let p=_pendingUpgrade;
  if(!p){ try{ p=sessionStorage.getItem('amv_pending_upgrade')||''; }catch(e){} }
  _pendingUpgrade='';
  try{ sessionStorage.removeItem('amv_pending_upgrade'); }catch(e){}
  return p;
}
/* Called from _completeIntroLogin, beside _sendPendingMessage, which is the
   same idea for a message typed before signing up. */
function _resumePendingUpgrade(){
  const plan=_takePendingUpgrade();
  if(!plan || !PLANS[plan]) return false;
  try{ if(typeof openUpgrade==='function'){ openUpgrade(plan); return true; } }catch(e){}
  return false;
}
function _needsAccountToPay(plan){
  /* Free changes nothing but a local setting, and the per-seat plan goes to
     the seat screen, which is gated already and asks for the account itself.

     `custom` is NOT on this list, though the first version of it was. It goes
     straight to openPaymentSheet like every other paid plan, so it reached the
     same card button and the same 401 - the one plan still told somebody their
     session had expired. Excluding it was the bug repeated once. */
  if(plan==='free' || plan==='team') return false;
  const signedIn=!!(typeof S!=='undefined' && S.user && S.user.email);
  if(signedIn) return false;
  /* Only when the SERVER is the one that would be asked. */
  let live=false; try{ live=!!(window.AMV_API && AMV_API.live); }catch(e){}
  return live;
}
try{ window._resumePendingUpgrade=_resumePendingUpgrade;
     window._needsAccountToPay=_needsAccountToPay;
     window._takePendingUpgrade=_takePendingUpgrade; }catch(e){}

/* THE BILLING CYCLE TRAVELS WITH THE PURCHASE, NOT BESIDE IT.

   The plan page offers Monthly or Yearly. Everything between that choice and
   the charge - this function, the payment sheet, the method panel, the call
   that asks the server for a checkout session - has to carry it, because the
   only thing that decides what somebody is actually billed is the price id the
   SERVER picks from `cycle`. A toggle whose value stops one function short of
   that call is a control that changes nothing, which is worse than not
   offering the choice at all.

   Anything that is not the literal 'year' is monthly. The server does the same
   normalisation, so a value mangled anywhere in between can only ever fall
   back to the cheaper, expected charge. */
function _payCycle(c){ return String(c || '') === 'year' ? 'year' : 'month'; }

function openCheckout(plan, customPrice, cycle){
  cycle = _payCycle(cycle);
  try{ track('upgrade_checkout_started', { plan, cycle }); }catch(e){}
  if(_needsAccountToPay(plan)){
    _rememberUpgrade(plan);
    try{ openAuth('signup'); }catch(e){}
    try{ toast('Create a free account first - your plan needs somewhere to live. It takes a moment and you will come straight back here.','info',6000); }catch(e){}
    return;
  }
  if(plan==='free'){ _setPlan('free'); renderBillingView(); toast('Switched to Free','info'); return; }
  if(plan==='custom'){
    const cfg=load('amv_custom_cfg')||{}; const price=customPrice||cfg.price||30;
    store('amv_custom_cfg',{price, ts:Date.now()});
    PLANS.custom.price=price; PLANS.custom.allowance=''; PLANS.custom.blurb='Your custom plan - '+_customPlanSummary(price).monthlyTokens.toLocaleString()+' tokens/mo';
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
  openPaymentSheet(plan, cycle);
}

function openPaymentSheet(plan, cycle){
  cycle = _payCycle(cycle);
  const p=PLANS[plan]||PLANS.pro;
  const yearly = cycle === 'year';
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="pay-ov" id="pay-bg"><div class="pay-modal">'+
    '<div class="pay-head"><div><div class="pay-title">Upgrade to '+p.name+'</div><div class="pay-sub">'+(p.blurb||'')+'</div></div><button class="dna-x" id="pay-x" aria-label="Close checkout">✕</button></div>'+
    /* NO YEARLY FIGURE IS INVENTED HERE EITHER. The monthly price is AMV's to
       show; the yearly one is a price object the operator created in Stripe,
       and multiplying by twelve would state a number nobody agreed to and that
       the checkout page would then contradict. So the sheet names the cycle
       and lets the processor state the amount. */
    '<div class="pay-amount">'+(yearly
      ? '<span class="pay-amt">'+escH(T('Yearly'))+'</span><span class="pay-per">'+escH(T('total shown at checkout'))+'</span>'
      : '<span class="pay-amt">$'+p.price+'</span><span class="pay-per">/month</span>')+'</div>'+
    '<div class="pay-methods-tabs" id="pay-tabs">'+
      '<button class="pay-tab on" data-pt="card">💳 Card</button>'+
      '<button class="pay-tab" data-pt="stripe">Stripe</button>'+
      /* PAYPAL IS NOT OFFERED FOR A YEARLY PURCHASE, BECAUSE IT CANNOT DO ONE.
         A PayPal subscription is its own plan id on PayPal's side and AMV has
         one of those per plan - the monthly one. Leaving the tab up would let
         somebody who pressed Yearly set up a monthly billing agreement while
         the sheet above it said Yearly. Better to offer one honest method than
         two where one lies. */
      (yearly ? '' : '<button class="pay-tab" data-pt="paypal">PayPal / Venmo</button>')+
    '</div>'+
    '<div class="pay-body" id="pay-body"></div>'+
    '<div class="pay-secure"><span class="pay-lock">🔒</span> Encrypted &amp; secure · PCI-DSS Level 1 processing</div>'+
    '</div></div>';
  onBackdrop($('pay-bg'),closePaySheet); on($('pay-x'),'click',closePaySheet);
  $('pay-tabs').querySelectorAll('.pay-tab').forEach(t=>on(t,'click',()=>{ $('pay-tabs').querySelectorAll('.pay-tab').forEach(x=>x.classList.toggle('on',x===t)); _payRenderMethod(t.dataset.pt,plan,cycle); }));
  _payRenderMethod('card',plan,cycle);
}
function closePaySheet(){ const r=$('ovr'); if(r) r.innerHTML=''; }

function _payCfg(){ try{ return load('amv_pay_cfg')||{}; }catch(e){ return {}; } }

/* THE PANEL THAT SAYS A PROCESSOR IS NOT CONNECTED.

   This markup existed once, at the bottom of _payRenderMethod, for the case
   where there is no backend and no Stripe link. There is a SECOND case that
   reaches the same fact by a different road - a live backend whose deployment
   has no STRIPE_SECRET_KEY - and that one was landing in a red toast reading
   "Card: payments not configured", which is a log line with a person's name on
   it. Both are "AMV cannot take a card here yet", so both say so the same way.

   A missing processor is not a failed payment. Nothing was attempted, nothing
   was charged, and there is nothing for somebody to retry - so it is stated in
   the sheet where they are looking, not thrown at them in an error colour that
   suggests they did something wrong. */
function _paySetupHTML(title, sub, btnId, btnLabel){
  return '<div class="pay-setup">'+
    '<div class="pay-setup-t">'+escH(title)+'</div>'+
    '<div class="pay-setup-s">'+escH(sub)+'</div>'+
    (btnId ? '<button class="btn bp pay-submit" id="'+escH(btnId)+'">'+escH(btnLabel)+'</button>' : '')+
  '</div>';
}
/* Returns true when it handled the rejection, so the caller's toast is skipped.
   Only a deployment that is not set up is handled here. A card that was
   declined, a network that dropped, an account on hold: those ARE failures,
   they are the person's business to retry, and they keep the toast.

   TWO CODES, BECAUSE THE SERVER HAS ALWAYS SENT TWO.

   This tested `needs_service` alone. The Teams branch of checkout has been
   answering `not_configured` the whole time - a real plan on the pricing page
   whose per-seat price was never set - so that refusal fell straight past this
   and out as a raw red toast, on the screen that takes money. Nobody noticed
   because it needs a deployment with Stripe connected and no seat price, which
   is exactly the state the day Teams is switched on.

   Both mean the same thing to the person reading it: this deployment cannot
   take the payment, nothing was charged, it is not your fault. */
function _payNotConnected(err, host){
  if(!err || (err.code !== 'needs_service' && err.code !== 'not_configured')) return false;
  const body = host || $('pay-body');
  if(!body || !body.isConnected) return false;
  body.innerHTML = _paySetupHTML(
    'Payments are not connected yet',
    (err.message || 'This deployment cannot take a payment yet.') +
    ' Nothing has been charged, and your plan has not changed.');
  return true;
}
try{ window._paySetupHTML=_paySetupHTML; window._payNotConnected=_payNotConnected; }catch(e){}
function _payRenderMethod(method,plan,cycle){
  cycle = _payCycle(cycle);
  const body=$('pay-body'); if(!body) return;
  const price=PLANS[plan].price;

  // ---- PAYPAL / VENMO - opens PayPal/Venmo externally ----
  if(method==='paypal'){
    const liveBackend=window.AMV_API&&AMV_API.live;
    /* The tab is not drawn for a yearly purchase; this is the second lock, for
       any caller that reaches the method by name. Nothing is offered rather
       than a monthly agreement dressed as a yearly one. */
    if(cycle === 'year'){
      body.innerHTML = _paySetupHTML(
        'Yearly billing goes through card checkout',
        'PayPal and Venmo set up a monthly agreement on this deployment, so they cannot take a yearly payment. Choose Card or Stripe above, or switch back to Monthly.');
      return;
    }
    if(liveBackend){
      // Real recurring subscription - opens PayPal's approval page externally.
      body.innerHTML='<div class="pay-wallet">'+
        '<button class="pay-wallet-b paypal" id="pay-pp-sub">Subscribe with PayPal →</button>'+
        '<button class="pay-wallet-b venmo" id="pay-vm-sub">Subscribe with Venmo →</button>'+
        '<p class="pay-note">Sets up a real monthly subscription through PayPal or Venmo. Opens securely, then brings you back.</p></div>';
      const go=async ()=>{ const pre=_preopenPay(); try{ const u=await AMV_API.paypalSubscribe(plan,(S.user&&S.user.email)||''); _openExternalPay(u,plan,'paypal',pre); }catch(e){ _closePay(pre); if(!_payNotConnected(e)) toast('PayPal could not start: '+(e.message||'try again'),'error',4500); } };
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
    /* A hosted Payment Link is ONE price object, and AMV only ever holds the
       monthly one. So for a yearly purchase there is no link - only the
       server-side session, which is told the cycle. */
    const link=(cycle === 'year') ? '' : _stripeLink(plan);
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
        try{ const u=await AMV_API.stripeCheckout(plan, (S.user&&S.user.email)||'', undefined, cycle); _openExternalPay(u,plan,'stripe',pre); }
        catch(e){ _closePay(pre); if(!_payNotConnected(e)) toast('Stripe could not start: '+(e.message||'try again'),'error',4500); }
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
  /* NOT FOR A YEARLY PURCHASE. Elements tokenises a card and hands it to
     /v1/subscribe, which knows one price per plan - the monthly one. Sending a
     yearly buyer down this path would charge them a month and tell them it was
     a year. The hosted checkout below takes the cycle, so yearly falls through
     to it. */
  if(pk && liveBackend && cycle !== 'year'){
    /* APPLE PAY, ON THE DEVICES THAT HAVE IT, ABOVE THE FORM IT REPLACES.

       Elements here is a card FIELD: a number, an expiry and a CVC, typed on a
       phone. Apple Pay is one authentication and the card details never exist
       as text at all - it is both faster and safer, and on a phone it is the
       difference between a purchase and an abandoned one.

       It is not mounted as a Payment Request Button on AMV's own domain, which
       would need the domain registered with the processor before it renders at
       all - an owner step that silently produces a missing button. It goes to
       the processor's HOSTED checkout, which is on THEIR domain, already
       verified, and offers Apple Pay there with no configuration. That is also
       why this can be offered honestly: AMV is not claiming to take an Apple
       Pay payment, it is taking somebody to the page that does.

       The card form stays exactly where it was, underneath, for anybody whose
       card is not in a Wallet. */
    body.innerHTML=(_applePayLikely()
      ? '<button class="btn pay-ap" id="pay-ap" type="button">'
        + '<span class="pay-ap-m" aria-hidden="true">\uF8FF</span>'
        + '<span>'+escH(T('Pay'))+'</span></button>'
        + '<div class="pay-or"><span>'+escH(T('or pay by card'))+'</span></div>'
      : '')+
      '<div id="stripe-card-element" class="pay-stripe-el"></div><div id="stripe-card-errors" class="pay-err"></div>'+
      '<button class="btn bp pay-submit" id="pay-submit">Pay $'+price+' / month</button>';
    /* The same hosted checkout the Stripe tab opens, and the same cycle. */
    on($('pay-ap'),'click',async ()=>{
      const ab=$('pay-ap'); const pre=_preopenPay();
      if(ab){ ab.disabled=true; ab.classList.add('busy'); }
      try{ const u=await AMV_API.stripeCheckout(plan,(S.user&&S.user.email)||'', undefined, cycle);
           _openExternalPay(u,plan,'applepay',pre); }
      catch(e){ _closePay(pre); if(!_payNotConnected(e)) toast('Apple Pay could not start: '+(e.message||'try again'),'error',4500); }
      finally{ if(ab){ ab.disabled=false; ab.classList.remove('busy'); } }
    });
    _mountStripe(pk,plan);
    return;
  }
  // Next best: route card payment through the backend's Stripe Checkout (real, secure).
  if(liveBackend || (cycle !== 'year' && _stripeLink(plan))){
    const link=(cycle === 'year') ? '' : _stripeLink(plan);
    body.innerHTML='<div class="pay-stripe-cta">'+
      '<div class="pay-card-ic">💳</div>'+
      '<button class="btn bp pay-submit" id="pay-card-go">Pay by card →</button>'+
      '<div class="pay-stripe-badges"><span>Visa</span><span>Mastercard</span><span>Amex</span><span>Discover</span></div>'+
      '<p class="pay-note">Opens a secure card checkout. Your plan unlocks once payment is confirmed.</p></div>';
    on($('pay-card-go'),'click',async ()=>{
      const sb=$('pay-card-go');
      if(liveBackend){ const pre=_preopenPay(); if(sb){sb.disabled=true;sb.textContent='Opening…';} try{ const u=await AMV_API.stripeCheckout(plan,(S.user&&S.user.email)||'', undefined, cycle); _openExternalPay(u,plan,'card',pre); }catch(e){ _closePay(pre); if(!_payNotConnected(e)) toast('Card payment could not start: '+(e.message||'try again'),'error',4500);} finally{ if(sb){sb.disabled=false;sb.textContent='Pay by card →';} } return; }
      if(link){ _openExternalPay(link,plan,'card'); }
    });
    return;
  }
  /* No processor connected. We deliberately do NOT render a card form here.
     Collecting a raw card number and CVC - even just in the browser - drags
     the whole business into PCI-DSS scope and creates breach liability for
     data we have no right to hold. Card details are only ever entered on the
     processor's own hosted page. So this states what to connect instead. */
  body.innerHTML = _paySetupHTML(
    'Secure checkout is not connected yet',
    'Card details are always entered on the payment provider’s own secure page - AMV never handles or stores card numbers. Connect Stripe in Settings → Platform and checkout turns on immediately.',
    'pay-card', 'Open secure checkout');
  on($('pay-card'),'click',()=>_payCard(plan,cycle));
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
        '<div style="opacity:.65;font-size:var(--t-base)">One moment - do not close this tab.</div></div>'); }catch(e){}
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
/* CAN THIS DEVICE DO APPLE PAY AT ALL.

   Asked of the browser, not guessed from a user-agent string. `ApplePaySession`
   exists only where Apple Pay is actually available - Safari on a Mac with a
   paired device, or an iPhone or iPad - and `canMakePayments()` is its own
   answer to whether the device is set up for it.

   Deliberately the cheap check and not `canMakePaymentsWithActiveCard`: that
   one is asynchronous, needs a registered merchant identifier, and answers a
   question nobody here is asking. This decides whether to OFFER Apple Pay. The
   offer leads to Stripe's hosted checkout, which asks Apple itself and simply
   does not show the button if there is no card in the Wallet - so the worst a
   false positive costs is one extra tap on a page that was already the fastest
   way to pay.

   Wrapped, because touching ApplePaySession can throw in an insecure context
   or a sandboxed frame, and a thrown exception here would take the whole
   payment sheet with it. */
function _applePayLikely(){
  try{
    if(typeof window.ApplePaySession === 'undefined' || !window.ApplePaySession) return false;
    return !!window.ApplePaySession.canMakePayments();
  }catch(e){ return false; }
}
try{ window._applePayLikely=_applePayLikely; }catch(e){}

/* Take a card payment WITHOUT ever touching the card.
   Raw card numbers must never reach AMV's own servers: receiving a PAN puts
   the whole business in PCI-DSS scope, and storing a CVC is prohibited
   outright. So this hands off to the processor's own hosted checkout, where
   the card is entered on THEIR page. AMV only ever learns that a payment
   succeeded - which is also what makes chargeback defence possible, because
   the processor holds the authentication record (3-D Secure). */
async function _payCard(plan, cycle){
  cycle = _payCycle(cycle);
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
    const url=safeUrl(await AMV_API.stripeCheckout(plan, email, undefined, cycle));
    if(!url) throw new Error('no checkout url');
    // The card is entered on the processor's page, never here.
    location.href=url;
  }catch(e){
    reset();
    toast('Could not open secure checkout. Please try again.','error',5000);
  }
}
/* Single entry point for a completed payment, regardless of processor or path
   (Stripe redirect, PayPal capture, in-app card, or test simulation). Refreshes
   entitlement from the server when live, updates local plan + UI, and confirms
   to the user. Every success path should call this so behavior stays identical. */
async function handlePaymentSuccess(plan, opts){
  opts = opts || {};
  try{
    if(plan) _setPlan(plan);
    if(window.AMV_API && AMV_API.live && AMV_API.hasSession){
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

/* When the user returns from an external checkout with ?paid=<plan>&pm=<method>, activate it. */
/* _savePM WAS DELETED AND FOUR CALLS TO IT WERE NOT.

   It was removed on purpose - it invented `token:'tok_'+random` and stored it
   as though it meant something - and the comment recording that removal says
   "Nothing ever called _savePM". Four things did, all of them here, all on the
   path somebody is on immediately after paying.

   So the call threw a ReferenceError and took the rest of the line with it.
   Measured, with the server confirming plan 'pro':

     · the return from a hosted checkout: _setPlan never ran, the plan stayed
       `free`, and instead of "Payment complete - welcome to Pro!" the screen
       said "Something hiccuped, but your work is safe";
     · the in-page card subscribe: the subscription SUCCEEDED, then the throw
       skipped _setPlan, closePaySheet and the success toast, and the catch
       below it told the customer "Could not complete subscription. Try again."
       - which invites paying twice for the thing they have already bought.

   The card itself lives at Stripe and the control for it is the billing portal
   this product already opens; nothing is lost by the calls going. */
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
        AMV_API.entitlement(S.user.email).then(d=>{
          /* `/v1/entitlement` answers `{ok, entitlement:{plan,...}, billing,
             bonusTokens, referralEarned}`. This read `ent.plan` off the whole
             RESPONSE, which is always undefined - so the condition was never
             true, and the moment somebody had just paid for their plan it fell
             through to the "not yet confirmed" branch instead.

             Nothing said so, because `syncEntitlement` elsewhere reads
             `d.entitlement.plan` correctly and eventually corrects the plan on
             the next load. What was lost was everything that happens HERE: the
             welcome, the card being recorded, and the billing screen
             refreshing - at the one moment a customer is looking for proof
             their money did something.

             `ent.token` went with it. The server has never sent a `token` on
             this response, so `amv_ent_token` was written from `undefined` and
             read by nothing; it is not a field that exists. */
          const ent=(d&&d.entitlement)||null;
          if(ent&&ent.plan&&PLANS[ent.plan]&&ent.plan!=='free'){
            _setPlan(ent.plan);
            toast('Payment complete - welcome to '+PLANS[ent.plan].name+'!','success',5000);
            try{ if(typeof _showBillingNotice==='function') _showBillingNotice(d.billing||null); }catch(_e){}
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
          setTimeout(()=>_verifyEntitlement(), 4000);
          try{ toast('Confirming your payment… this can take a moment.','info',4500); }catch(e){}
          if(S.tab==='billing') renderBillingView();
        });
        return;
      }
      // No backend: this is local/demo mode only. A redirect param can't be
      // trusted as a real payment, so unlock only as a local preview and say so.
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
    /* Same shape mistake as above, and this function's whole job is to be the
       check that "prevents faked unlocks" - a guard reading a field the server
       does not send has never once run. */
    const d=await AMV_API.entitlement(S.user.email);
    const ent=(d&&d.entitlement)||null;
    if(ent&&ent.plan&&PLANS[ent.plan]){
      const cur=loadStr('amv_plan')||'free';
      if(ent.plan!==cur){ _setPlan(ent.plan); if(S.tab==='billing') renderBillingView(); }
      try{ if(typeof _showBillingNotice==='function') _showBillingNotice(d.billing||null); }catch(_e){}
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
          app('🌐','AMV for Web','Runs in any browser right now - full chat, agents, and automations. Add it to your home screen for one-tap access.','<button class="btn bp" style="width:100%" data-dact="installPWA">Add to home screen</button>','rgba(66,133,244,.12)','auto')+
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


/* ═══════════════════════════════════════════════════════════════════════
   THE NUDGE THAT HAS TO EARN ITSELF.

   The owner asked for "you have been using xyz a lot, would you like to look at
   the xyz plan?" - at most once a fortnight, dismissible, low-key.

   The rule that makes it worth building rather than annoying: it must name a
   feature the person ACTUALLY leaned on. A nudge that guesses is worse than no
   nudge, because it tells somebody the product is not paying attention. So this
   counts real opens per surface over a rolling fortnight and stays silent until
   one of them clears a threshold that means habit rather than curiosity.

   Everything here is local. Which screens somebody opens is not worth sending
   anywhere, and a counter in their own browser answers the question just as
   well as a server would.

   It is deliberately NOT a modal. AMV already has one of those for the moment
   you hit a wall, which is the right shape for a wall. This is the other case -
   nothing is wrong, nothing is blocked - so it sits in the corner and waits.
   ═══════════════════════════════════════════════════════════════════════ */
const HABIT_WINDOW_MS = 14 * 86400000;
const HABIT_MIN_OPENS = 12;            // habit, not a look around
const HABIT_QUIET_MS  = 14 * 86400000; // at most one per fortnight, dismissed or not

/* Which surfaces are worth mentioning, what a heavier plan actually adds, and
   the plan that adds it. Anything not listed here never nudges - there is no
   point telling somebody their chat habit could be improved by paying. */
/* `counts` is what the number in the nudge actually MEASURES, and the copy is
   built from it rather than assuming.

   Every entry used to be counted by `setTab`, which fires when somebody opens
   the tab and leaves again - and the nudge then said "You have been using Crew
   a lot. 15 times in the last two weeks." Fifteen glances read as fifteen jobs.
   This is the one dialog in the product that asks for money, so the sentence
   behind it has to be the thing the plan improves: Pro runs jobs in the
   background, and the evidence for that offer is jobs RUN.

   Crew has a single place where a job really starts (`crewRun`), so it counts
   runs. The others have no equivalent single action, so they still count opens
   and the copy says "opened" - which is true, and weaker on purpose. The same
   file already dropped its `images` entry rather than ask for money on the
   strength of something that could not be received; this is that rule applied
   to the number instead of the feature. */
const HABIT_FEATURES = {
  crew:   { label:'Crew',   plan:'pro',   counts:'runs',  gain:'run jobs in the background while AMV is closed' },
  dev:    { label:'Build',  plan:'pro',   counts:'opens', gain:'build and ship real apps, with the app sandbox' },
  studio: { label:'Studio', plan:'pro',   counts:'opens', gain:'every model, and designs that keep their own style' },
  lab:    { label:'Lab',    plan:'pro',   counts:'opens', gain:'the deeper engine on debugging, and longer files' },
  /* No `images` entry. It offered "a far larger daily allowance and HD output"
     for a feature that no longer exists - so the one nudge that asks somebody
     for money was ready to ask for it on the strength of something they could
     never receive. */
  team:   { label:'Teams',  plan:'elite', counts:'opens', gain:'shared projects, roles and one bill for everyone' },
};

/* Already per-account: `store`/`load` route every key that is not in
   _GLOBAL_KEYS through `_scopeKey`, which prefixes `u:<email>|`. `amv_habit` is
   not a global key, so two people sharing a browser already have separate
   counts. A second layer of scoping was written here and removed again - it was
   duplicated logic dressed as a fix, and the only thing it added was a nested
   shape nobody else reads. */
function _habitLog(){ try{ return load('amv_habit') || {}; }catch(e){ return {}; } }
function _habitSave(h){ try{ store('amv_habit', h); }catch(e){} }

/* Called when a surface is opened. Keeps timestamps rather than a bare count so
   the window can actually roll - a count with no dates only ever grows. */
function _habitRecord(tab){
  try{
    const h=_habitLog(); const now=Date.now();
    const list=(h[tab]||[]).filter(t=>now-t < HABIT_WINDOW_MS);
    list.push(now);
    if(list.length>60) list.splice(0, list.length-60);   // no unbounded growth
    h[tab]=list; _habitSave(h);
  }catch(e){}
}
/* Navigation. Skips anything counted by a real action, so opening the tab to
   look at yesterday's jobs does not become evidence that you ran any. */
function _habitTouch(tab){
  const f = HABIT_FEATURES[tab];
  if(!f || f.counts !== 'opens') return;
  _habitRecord(tab);
}
/* A real use of the feature, called from where the work actually starts. */
function _habitAction(tab){
  const f = HABIT_FEATURES[tab];
  if(!f || f.counts !== 'runs') return;
  _habitRecord(tab);
}
try{ window._habitTouch=_habitTouch; window._habitAction=_habitAction; }catch(e){}

function _habitCandidate(){
  const plan = loadStr('amv_plan') || 'free';
  const rank = { free:0, pro:1, elite:2, ultra:3, team:2, custom:2 };
  const mine = rank[plan] === undefined ? 0 : rank[plan];
  const h=_habitLog(); const now=Date.now();
  let best=null;
  for(const tab in HABIT_FEATURES){
    const f=HABIT_FEATURES[tab];
    if((rank[f.plan]||0) <= mine) continue;              // already have it
    const uses=(h[tab]||[]).filter(t=>now-t < HABIT_WINDOW_MS).length;
    if(uses < HABIT_MIN_OPENS) continue;
    if(!best || uses > best.uses) best={ tab, uses, ...f };
  }
  return best;
}

function _habitNudgeDue(){
  try{
    const last=+(loadStr('amv_habit_nudge')||0);
    return !last || (Date.now()-last) > HABIT_QUIET_MS;
  }catch(e){ return false; }
}

function _habitNudgeSeen(){ try{ saveStr('amv_habit_nudge', String(Date.now())); }catch(e){} }

function maybeHabitNudge(){
  try{
    if(!S.user) return;                       // nothing to upgrade yet
    if(!_habitNudgeDue()) return;
    if(document.getElementById('habit-nudge')) return;
    const c=_habitCandidate(); if(!c) return;
    const P=(typeof PLANS!=='undefined'&&PLANS[c.plan])||{name:c.plan,price:''};
    const el=document.createElement('div');
    el.id='habit-nudge'; el.className='habit-nudge'; el.setAttribute('role','status');
    el.innerHTML=
      '<button class="habit-x" id="habit-x" aria-label="'+escH(T('Close'))+'">×</button>'+
      '<div class="habit-t">'+escH(T('You have been using')+' '+c.label+' '+T('a lot'))+'</div>'+
      /* The verb matches the counter. "Ran" is a claim about work done and is
         only made where a run is what was counted; everywhere else it says
         "opened", which is exactly what the number is. */
      '<p class="habit-p">'+escH((c.counts==='runs'
          ? T('Ran')+' '+c.uses+' '+T('jobs in the last two weeks')
          : T('Opened it')+' '+c.uses+' '+T('times in the last two weeks'))
        +'. '+P.name+' '+T('lets you')+' '+c.gain+'.')+'</p>'+
      '<div class="habit-acts">'+
        '<button class="btn bp habit-go" id="habit-go">'+escH(T('See')+' '+P.name)+'</button>'+
        '<button class="btn bs" id="habit-later">'+escH(T('Not now'))+'</button>'+
      '</div>';
    document.body.appendChild(el);
    try{ track('habit_nudge_shown', { feature:c.tab, uses:c.uses, plan:loadStr('amv_plan')||'free' }); }catch(e){}
    try{ if(typeof announce==='function') announce(T('Suggestion')+': '+c.label); }catch(e){}
    const close=()=>{ _habitNudgeSeen(); el.remove(); };
    on($('habit-x'),'click',close);
    on($('habit-later'),'click',close);
    on($('habit-go'),'click',()=>{ close(); try{ setTab('plans'); }catch(e){} });
  }catch(e){}
}
try{ window.maybeHabitNudge=maybeHabitNudge; }catch(e){}

/* ── THE PAGE YOU LAND ON WHEN YOU PICK A PLAN ───────────────────────────────

   Pressing "Upgrade to Elite" used to jump to the pricing tab and put a ring
   around one card in a row of four. That is a highlight, not a decision: the
   plan you chose is still sitting beside three you did not, at the same size,
   and the thing you actually wanted - what do I get, and how do I pay - is a
   scroll away inside a box.

   So it opens its own page. One plan, its price, everything it gives you, and
   one button. Nothing else on the screen competes with it.

   The copy is _planPitch, which the pricing cards render from too, so this
   page cannot drift away from what the pricing page promises. The two figures
   under the price are the ones the server enforces - the usage multiple and
   the scheduled-job cap - because this page has been burned before for selling
   a word the backend did not honour, and a number somebody can check is more
   convincing than an adjective anyway. */
let _upgradeFor = '';
/* WHERE THEY CAME FROM, SO BACK GOES BACK.

   This always returned to Billing, because Billing was the only door into it.
   Now the pricing cards and the quota nudge open it too, and sending somebody
   who pressed "Go Elite" on the Plans screen back to Billing is the same small
   insult as dropping them at the top of a page they were already halfway down.
   The origin is remembered and the back button is LABELLED with it, so the
   control says where it goes rather than guessing. */
let _upgradeFrom = 'billing';
/* Reset every time the page opens, below - a cycle left over from a plan
   somebody looked at and did not buy must not decide the next purchase. */
let _upgradeCycle = 'month';
function openUpgrade(key, from){
  if(!PLANS[key] || key === 'free') return;
  _upgradeFor = key;
  _upgradeCycle = 'month';
  /* The tab they are leaving, unless a caller names one. Never 'upgrade'
     itself: pressing a plan while already on a plan page would otherwise make
     back a loop with no way out. */
  try{
    const here = (from && typeof from === 'string') ? from : (S && S.tab) || 'billing';
    _upgradeFrom = (here && here !== 'upgrade') ? here : 'billing';
  }catch(e){ _upgradeFrom = 'billing'; }
  try{ setTab('upgrade'); }catch(e){ _upgradeFor = ''; }
}
function closeUpgrade(){ _upgradeFor = ''; try{ setTab(_upgradeFrom || 'billing'); }catch(e){} }
try{ window.openUpgrade = openUpgrade; window.closeUpgrade = closeUpgrade; }catch(e){}

/* The label on the back button. `_TAB_LABELS` is the one place tab names live,
   so this cannot drift from what the tab is actually called. */
function _upgBackLabel(){
  try{
    const t = _upgradeFrom || 'billing';
    if(typeof _TAB_LABELS !== 'undefined' && _TAB_LABELS[t]) return _TAB_LABELS[t];
  }catch(e){}
  return 'Billing';
}

/* "EVERYTHING IN PRO, PLUS:" IS A POINTER, NOT A LIST.

   Elite's feature list opens with that line and Ultra's opens with the same
   line about Elite. On the pricing grid that works, because Pro's card is
   sitting right there being read at the same time. On this page the plan has
   the whole screen to itself, so the one person looking at it - somebody on
   Free deciding whether Elite is worth $75 - is told the most important part of
   what they would get by being pointed at a card that is not on screen.

   So the pointer is kept and then KEPT: every lower paid rung is expanded
   underneath, in ladder order, from the same `_planPitch` the cards render
   from. A second hand-written copy of what Pro includes would be a second
   description of the product, and the two would disagree the first time a plan
   changed.

   Only the rows a plan HAS. A `[0, ...]` row is something a tier does not
   include, and printing "no autonomous agents" under a heading saying what
   comes free with Elite would be nonsense - Elite has them. */
function _upgInheritedHTML(key){
  try{
    const ladder = ['pro','elite','ultra'];
    const ix = ladder.indexOf(key);
    if(ix <= 0) return '';
    if(typeof _planPitch !== 'function') return '';
    const groups = ladder.slice(0, ix).map(k=>{
      const p = _planPitch(k);
      const P2 = PLANS[k];
      if(!p || !Array.isArray(p.feats) || !P2) return '';
      const items = p.feats.filter(f=>f && f[0] && !/^\s*<b>Everything in/i.test(String(f[1]||'')));
      if(!items.length) return '';
      return '<div class="upg-inh-g">'
        + '<h3 class="upg-inh-h">' + escH(T('Everything in')) + ' ' + escH(P2.name) + '</h3>'
        + '<ul class="plnfl">'
        + items.map(f=>'<li><span class="fck">\u2713</span><span class="plnft">' + f[1] + '</span></li>').join('')
        + '</ul></div>';
    }).filter(Boolean).join('');
    if(!groups) return '';
    return '<div class="upg-inh">'
      + '<p class="upg-inh-lead">' + escH(T('Included too, because every plan carries the ones below it')) + '</p>'
      + groups + '</div>';
  }catch(e){ return ''; }
}

function renderUpgradeView(){
  const vc = $('vc'); if(!vc) return;
  const key = _upgradeFor || 'pro';
  const P = PLANS[key]; if(!P) return;
  const pitch = (typeof _planPitch === 'function' && _planPitch(key)) || { anchor:'', feats:[], reassure:'' };
  const jobs = (typeof AUTO_MAX_BY_PLAN !== 'undefined') ? AUTO_MAX_BY_PLAN[key] : null;
  const now = (typeof S !== 'undefined' && S.plan) ? S.plan : (loadStr('amv_plan') || 'free');
  const nowName = (PLANS[now] && PLANS[now].name) || 'Free';

  /* ALL THE PLANS, ON THE SCREEN WHERE ONE IS BEING CHOSEN.

     This page opened straight into a single plan's detail, which is right for
     somebody who has already decided and wrong for everybody else - the
     question "is the one above this worth it" had no answer on the screen
     asking for the money, and the only way to compare was to go back.

     So the ladder is across the top: every plan, the current one marked, the
     one being considered selected. Pressing another switches the detail below
     without leaving the page. It renders from PLANS and `_planPitch`, the same
     source the cards and the detail use, so a plan cannot appear here saying
     one thing and below saying another. */
  const ladder = ['free', 'pro', 'elite', 'ultra'].map((k) => {
    const P2 = PLANS[k]; if (!P2) return '';
    const isNow = k === now, isPick = k === key;
    return '<button type="button" class="upg-pick' + (isPick ? ' on' : '') + (isNow ? ' now' : '') + '"'
      + ' data-upg-pick="' + escH(k) + '" aria-pressed="' + (isPick ? 'true' : 'false') + '">'
      + '<span class="upg-pick-n">' + escH(P2.name) + '</span>'
      /* Not the plan's own name a second time. "Free / Free" is what the
         first version rendered, because the price slot fell back to the
         word - and a row reading its own title twice is the kind of thing
         that makes a screen feel unfinished. */
      + '<span class="upg-pick-p">' + (P2.price ? '$' + P2.price + '<i>/mo</i>'
          : '<i>' + escH(T('No card')) + '</i>') + '</span>'
      + (isNow ? '<span class="upg-pick-tag">' + escH(T('Your plan')) + '</span>' : '')
    + '</button>';
  }).join('');

  vc.innerHTML =
    '<div class="sv fi upg-sv"><div class="upg">'
      + '<button class="upg-back" id="upg-back">'
        + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>'
        + escH(T(_upgBackLabel())) + '</button>'

      + '<div class="upg-ladder" role="group" aria-label="' + escH(T('Choose a plan')) + '">' + ladder + '</div>'

      + '<div class="upg-head">'
        + '<span class="upg-eyebrow">' + escH(T('You are on')) + ' ' + escH(nowName) + '</span>'
        + '<h1 class="upg-t">' + escH(P.name) + '</h1>'
        + '<p class="upg-anchor">' + pitch.anchor + '</p>'
        + '<div class="upg-price"><span class="upg-cur">$</span>' + P.price
          + '<span class="upg-per">/' + escH(T('month')) + '</span></div>'
        /* MONTHLY OR YEARLY, AND NO NUMBER INVENTED FOR THE SECOND ONE.

           AMV does not compute a yearly amount: the yearly price is a second
           price object the operator created in Stripe, and whatever discount it
           carries is theirs. So this offers the CHOICE and lets checkout state
           the figure - which is also the only way the page and the charge
           cannot drift apart.

           Drawn only where it works. `_yearlyAvailable` is answered by public
           config listing the plans that have a yearly price, so a deployment
           selling monthly only shows nothing here rather than a cheaper-looking
           option that is refused at the till. */
        + (_yearlyAvailable(key)
            ? '<div class="upg-cycle" role="group" aria-label="' + escH(T('How often you are billed')) + '">'
              + '<button type="button" class="upg-cyc on" data-cyc="month" aria-pressed="true">' + escH(T('Monthly')) + '</button>'
              + '<button type="button" class="upg-cyc" data-cyc="year" aria-pressed="false">' + escH(T('Yearly')) + '</button>'
              + '<span class="upg-cyc-n">' + escH(T('The yearly price is shown at checkout')) + '</span>'
            + '</div>'
            : '')
        + '<p class="upg-per-note">' + escH(T('Cancel anytime. Changes are prorated, so you only pay the difference.')) + '</p>'
      + '</div>'

      + (typeof _planFeatsHTML === 'function'
          ? '<div class="upg-feats">' + _planFeatsHTML(key) + '</div>' : '')

      + _upgInheritedHTML(key)

      + ((P.allowance || jobs)
          ? '<div class="upg-figs">'
            /* Messages, like Spending and Billing. This was the last screen
               still quoting the plan in tokens, and it is the one somebody
               reads immediately before paying. */
            + '<div class="upg-fig"><b>' + escH(_msgMonthLabel(key)) + '</b><span>'
                + escH(T('messages a month')) + '</span></div>'
            + (_planMsgNum(PLAN_TOP_WEEK, key)
                ? '<div class="upg-fig"><b>' + escH(_topWeekLabel(key)) + '</b><span>'
                    + escH(T('top-engine messages a week')) + '</span></div>' : '')
            + (jobs ? '<div class="upg-fig"><b>' + jobs + '</b><span>'
                + escH(T('scheduled jobs running for you')) + '</span></div>' : '')
          + '</div>' : '')

      + '<div class="upg-go">'
        + '<button class="btn bp upg-cta" id="upg-pay" data-darg="' + escH(key) + '">'
          + escH(T('Proceed to checkout')) + '</button>'
        + '<p class="upg-reassure">'
          + (pitch.reassure ? pitch.reassure + ' &middot; ' : '')
          + escH(T('Card details go straight to our payment processor - AMV never sees them.'))
        + '</p>'
      + '</div>'
    + '</div></div>';

  on($('upg-back'), 'click', closeUpgrade);
  /* Switching plan redraws this page rather than navigating: it is the same
     decision, not a new one, and a round trip through the tab dispatcher would
     lose which screen to go back to. Free is not a thing to buy, so it opens
     the plan grid instead of a checkout for nothing. */
  vc.querySelectorAll('[data-upg-pick]').forEach(b => on(b, 'click', () => {
    const k = b.dataset.upgPick;
    if (k === 'free') { try { setTab('spend'); } catch (e) {} return; }
    if (!PLANS[k] || k === _upgradeFor) return;
    _upgradeFor = k; _upgradeCycle = 'month';
    renderUpgradeView();
  }));
  /* The chosen cycle lives on the page, not in storage: it is a decision about
     the purchase being made right now, and carrying it into the next visit
     would quietly change what somebody is buying. */
  vc.querySelectorAll('[data-cyc]').forEach(b => on(b, 'click', () => {
    _upgradeCycle = b.dataset.cyc === 'year' ? 'year' : 'month';
    vc.querySelectorAll('[data-cyc]').forEach(x => {
      const on_ = x.dataset.cyc === _upgradeCycle;
      x.classList.toggle('on', on_);
      x.setAttribute('aria-pressed', on_ ? 'true' : 'false');
    });
  }));
  /* The existing checkout, not a second one. Whatever the pricing page does to
     start a payment is what this button does - a parallel path to money is a
     parallel path to getting money wrong. */
  on($('upg-pay'), 'click', () => {
    /* EXACTLY WHAT THE PRICING BUTTON DOES, including the direct-link case:
       when a plan has its own payment link configured, that link is the path,
       and `openCheckout` is the path when it does not. Reproducing the choice
       here rather than calling one of them unconditionally is the difference
       between this button working and this button working most of the time. */
    try{
      /* A configured payment link is ONE price object - the monthly one. It
         cannot be told to bill by the year, so when somebody has asked for
         yearly it is not the path, and the server-side checkout that reads the
         cycle is. Taking the link anyway would charge a month against a button
         that said Yearly. */
      const direct = ((key === 'pro' && S.sp) || (key === 'elite' && S.se)) && _upgradeCycle !== 'year';
      if(direct && typeof _openPlanLink === 'function') return _openPlanLink(key);
      if(typeof openCheckout === 'function') return openCheckout(key, undefined, _upgradeCycle);
    }catch(e){}
    try{ setTab('plans'); }catch(e){}
  });
}
try{ window.renderUpgradeView = renderUpgradeView; }catch(e){}
