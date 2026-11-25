/* ============================================================
   ADMIN CONTROL CENTER (operator-only)
   Spend monitoring · user management · abuse/anomaly detection ·
   health & audit. Reads real AEGIS + usage data; pulls server data
   when a backend is connected; honestly labels anything that needs
   the live backend rather than faking numbers.
   ============================================================ */
/* ============================================================
   AMVFraud - operator-only fraud-prevention monitor.

   For every money-touching event it produces a fair, evidence-
   based assessment: the suspected abuse category, a risk rating,
   the exact signals that triggered it, the linked accounts /
   devices / payments / addresses / transactions, plausible
   legitimate explanations, the minimum extra evidence needed to
   decide, a recommended action, a confidence score, and an
   explicit "insufficient evidence" note when the signals are weak.

   Fairness is built in, never bolted on:
   - It never scores anyone on nationality, location, language,
     disability, age or any other protected characteristic. A
     regional or language mismatch is treated as ordinary life
     (travel, immigration, international families, study, work,
     VPN) and is kept only as context - it carries zero weight on
     its own.
   - Asking for a refund or filing a chargeback never auto-punishes.
     On its own it can never push the recommendation past
     "request verification".
   - High-impact actions are routed to a human, records are kept
     for appeal, and nothing is auto-enforced from one weak signal.
   - It only ever describes what to watch for. It never explains
     how to carry any of these out.

   Honest degradation: on-device it assesses the categories whose
   signals really exist client-side. The rest are watched server-
   side the moment the backend keys are in - the coverage panel
   marks which is which and never claims a server-only check is
   active on this device.
   ============================================================ */
const AMVFraud = {
  KEY:'amv_fraud_log',
  HIGH_IMPACT_USD:200,

  GROUPS:{
    payment:'Payments & pricing', refund:'Refunds & returns',
    promo:'Promos, trials & loyalty', account:'Accounts & identity',
    social:'Social engineering', logistics:'Delivery & logistics',
    market:'Marketplace & sellers', payout:'Payouts & laundering',
    partner:'Affiliate, ads & insider'
  },

  // 50+ abuse categories this monitor is built to cover. [id, label, group].
  CATS:[
    ['regional_pricing_abuse','Regional price arbitrage','payment'],
    ['geo_mismatch','VPN / geo mismatch','payment'],
    ['digital_currency_resale','Digital-currency / license resale','payment'],
    ['stolen_card','Stolen-payment purchase','payment'],
    ['card_testing','Card testing / BIN probing','payment'],
    ['friendly_fraud','Friendly fraud','refund'],
    ['chargeback_after_use','Chargeback after consumption','refund'],
    ['false_non_delivery','False non-delivery claim','refund'],
    ['missing_item_claim','Missing-item refund abuse','refund'],
    ['damaged_item_claim','Damaged-item refund abuse','refund'],
    ['fake_evidence','Fabricated evidence','refund'],
    ['refund_without_return','Refund without returning','refund'],
    ['duplicate_refund','Duplicate-refund attempt','refund'],
    ['refund_velocity_abuse','Serial refund abuse','refund'],
    ['empty_box_return','Empty-box return','logistics'],
    ['item_switch_return','Item-switch return','logistics'],
    ['wardrobing','Wardrobing (use then return)','logistics'],
    ['serial_switch','Serial-number switching','logistics'],
    ['promo_abuse','Promo-code abuse','promo'],
    ['referral_farming','Referral farming','promo'],
    ['coupon_stacking','Coupon stacking','promo'],
    ['trial_abuse','Free-trial cycling','promo'],
    ['loyalty_theft','Loyalty / points theft','promo'],
    ['account_takeover','Account takeover (ATO)','account'],
    ['credential_stuffing','Credential stuffing','account'],
    ['multi_account','Multi-accounting','account'],
    ['device_farm','Device farm','account'],
    ['bot_automation','Bot / automated abuse','account'],
    ['synthetic_identity','Synthetic identity','account'],
    ['disposable_signup','Disposable-email abuse','account'],
    ['document_verification_fraud','Document-verification fraud','account'],
    ['support_impersonation','Support impersonation','social'],
    ['otp_phishing','OTP phishing / interception','social'],
    ['recovery_scam','Account-recovery scam','social'],
    ['social_engineering_escalation','Social-engineering escalation','social'],
    ['courier_account_rental','Courier account rental','logistics'],
    ['gps_spoofing','GPS spoofing','logistics'],
    ['address_forwarding','Address-forwarding abuse','logistics'],
    ['reshipping','Reshipping mule','logistics'],
    ['triangulation','Triangulation fraud','logistics'],
    ['fake_merchant','Fake merchant / listing','market'],
    ['seller_exit_scam','Seller exit scam','market'],
    ['counterfeit_listing','Counterfeit / IP theft','market'],
    ['wash_trading','Wash trading / self-dealing','market'],
    ['review_manipulation','Review manipulation','market'],
    ['collusion_ring','Buyer-seller collusion','market'],
    ['gift_card_laundering','Gift-card laundering','payout'],
    ['payout_muling','Payout muling','payout'],
    ['affiliate_fraud','Affiliate fraud','partner'],
    ['ad_credit_fraud','Ad-credit fraud','partner'],
    ['invoice_fraud','Invoice / vendor fraud','partner'],
    ['insider_refund_collusion','Insider / refund collusion','partner']
  ],

  // Categories whose triggering signals genuinely exist on-device today.
  // Everything else is watched server-side once the keys are in.
  _clientCats:new Set([
    'wash_trading','payout_muling','refund_without_return','false_non_delivery',
    'friendly_fraud','chargeback_after_use','duplicate_refund','refund_velocity_abuse',
    'multi_account','device_farm','account_takeover','credential_stuffing',
    'otp_phishing','stolen_card','card_testing','bot_automation',
    'counterfeit_listing','fake_merchant','promo_abuse','referral_farming','geo_mismatch'
  ]),

  // Observable signals. w = weight toward risk. cap = the strongest action this
  // signal alone may recommend (fairness cap). protected = never scores, kept
  // only as context. cats = candidate categories this signal points at.
  SIGNALS:{
    self_purchase:{w:0.70, label:'Buyer and seller are the same account', cats:['wash_trading','payout_muling']},
    payout_after_selfbuy:{w:0.80, label:'A withdrawal followed a linked self-purchase', cats:['wash_trading','payout_muling']},
    duplicate_refund:{w:0.75, label:'The same transaction was submitted for refund more than once', cats:['duplicate_refund']},
    refund_velocity:{w:0.50, label:'Unusually many refunds from this account recently', cats:['refund_velocity_abuse']},
    refund_request:{w:0.25, cap:'request_verification', label:'A refund was requested', cats:['refund_without_return','false_non_delivery']},
    chargeback:{w:0.30, cap:'request_verification', label:'A payment dispute (chargeback) was filed', cats:['chargeback_after_use','friendly_fraud']},
    multi_account_device:{w:0.60, label:'Several accounts seen on the same device', cats:['multi_account','device_farm']},
    auth_fail_burst:{w:0.55, label:'Many failed sign-ins shortly before access', cats:['account_takeover','credential_stuffing']},
    otp_fail_burst:{w:0.50, label:'Repeated one-time-code failures', cats:['otp_phishing','account_takeover']},
    new_account_high_value:{w:0.35, label:'A brand-new account made a high-value purchase', cats:['stolen_card']},
    purchase_velocity:{w:0.45, label:'Many purchases in a very short window', cats:['card_testing','bot_automation']},
    listing_prohibited:{w:0.80, label:'A listing hit the prohibited-goods screen', cats:['counterfeit_listing','fake_merchant']},
    listing_guarantee:{w:0.50, label:'A listing promised guaranteed profit or returns', cats:['fake_merchant']},
    promo_multi:{w:0.40, label:'The same promo or referral used across linked accounts', cats:['promo_abuse','referral_farming']},
    geo_mismatch:{w:0, protected:true, label:'Sign-in region differs from the usual region', cats:['geo_mismatch']}
  },

  ACTION_LABEL:{
    allow:'Allow (monitor only)', request_verification:'Request verification',
    restrict:'Restrict activity', temporary_hold:'Temporary hold',
    escalate:'Escalate to human review'
  },
  RISK_LABEL:{low:'Low', medium:'Medium', high:'High', critical:'Critical'},

  evaluate(ev){
    ev=ev||{};
    const sig=ev.signals||{};
    const active=[]; const protectedCtx=[];
    Object.keys(this.SIGNALS).forEach(code=>{
      if(!sig[code]) return;
      const s=this.SIGNALS[code];
      if(s.protected){ protectedCtx.push({code,...s}); return; }
      active.push({code,...s});
    });
    let score=active.reduce((a,s)=>a+s.w,0);
    score=Math.min(0.99, score);
    const strongest=active.reduce((m,s)=>Math.max(m,s.w),0);

    // pick the category from the strongest active signal
    let catId=ev.category||'';
    if(active.length){ const top=active.slice().sort((a,b)=>b.w-a.w)[0]; catId=(top.cats&&top.cats[0])||catId; }
    const cat=this.CATS.find(c=>c[0]===catId)||['unknown','Unspecified anomaly','account'];

    // insufficient evidence: too few independent signals and nothing strong
    const insufficient=(active.length<2 && strongest<0.70) || score<0.35;
    // fairness cap: if every scoring signal is a refund/dispute signal, the
    // recommendation may never exceed "request verification".
    const allCapped=active.length>0 && active.every(s=>s.cap==='request_verification');

    let risk = score<0.40?'low' : score<0.65?'medium' : score<0.85?'high' : 'critical';
    if(allCapped && (risk==='high'||risk==='critical')) risk='medium';
    if(insufficient) risk='low';

    const moneyOut = ev.type==='payout' || !!sig.payout_after_selfbuy;
    let action = risk==='low'?'allow'
      : risk==='medium'?'request_verification'
      : risk==='high'?(moneyOut?'temporary_hold':'restrict')
      : 'escalate';
    if(allCapped && action!=='allow' && action!=='request_verification') action='request_verification';

    const amount=+ev.amount||0;
    const highImpact = amount>=this.HIGH_IMPACT_USD || moneyOut || action==='restrict' || action==='temporary_hold' || action==='escalate';
    const humanReview = action==='escalate' || (highImpact && action!=='allow');

    const serverLive=(typeof _aiBackendReady==='function' && _aiBackendReady());
    let confidence=0.35 + 0.16*active.length + (serverLive?0.12:0);
    if(insufficient) confidence=Math.min(confidence,0.45);
    confidence=Math.max(0.20, Math.min(0.95, confidence));

    // legitimate explanations - always lead with the benefit of the doubt
    const legit=['A genuine customer with an unusual but honest pattern (a new device, travel, a first large purchase, or a gift).'];
    if(protectedCtx.some(s=>s.code==='geo_mismatch'))
      legit.push('A different sign-in region is normal for travel, immigration, international families, study, work, or ordinary VPN use. It is never evidence of fraud on its own.');
    if(sig.refund_request||sig.chargeback||sig.refund_velocity)
      legit.push('The refund or dispute may be completely valid - the product failed, was not as described, or a charge was not recognized. Requesting money back is a right, not an admission.');
    if(sig.new_account_high_value)
      legit.push('New customers routinely make a first large purchase. Account age alone means nothing.');
    if(sig.multi_account_device)
      legit.push('Shared or family devices, public computers and households legitimately show several accounts.');
    if(sig.purchase_velocity)
      legit.push('A burst of activity can simply be an engaged customer or a batch of intended purchases.');

    // minimum additional evidence needed
    const minEv=[];
    if(sig.refund_request||sig.chargeback||sig.refund_velocity||sig.duplicate_refund)
      minEv.push('Delivery and consumption logs for the disputed transaction, checked against the specific claim.');
    if(sig.self_purchase||sig.payout_after_selfbuy)
      minEv.push('Independent confirmation that the buyer and seller are genuinely different people with different funding sources.');
    if(sig.multi_account_device||sig.promo_multi)
      minEv.push('A second independent link between the accounts (a shared payment instrument or coordinated timing), not the shared device or code alone.');
    if(sig.auth_fail_burst)
      minEv.push('Re-authentication by the real account owner and confirmation the device is recognized.');
    if(sig.otp_fail_burst)
      minEv.push('Direct contact with the verified account owner on a known channel.');
    if(sig.new_account_high_value)
      minEv.push('A successful payment authentication (3-D Secure) or matching billing verification from the processor.');
    if(sig.purchase_velocity)
      minEv.push('Server-side rate and device signals showing whether the pattern is human-plausible or scripted.');
    if(sig.listing_prohibited||sig.listing_guarantee)
      minEv.push('A manual review of the listing content and proof of the seller\'s ownership or license.');
    if(!minEv.length) minEv.push('At least one more independent signal before any enforcement.');

    const en=ev.entities||{};
    const linked={
      accounts:en.accounts||[], devices:en.devices||[], payments:en.payments||[],
      addresses:en.addresses||[], transactions:en.transactions||[]
    };

    const insufficientStatement = insufficient
      ? 'Insufficient evidence to act. The available signals are weak or could easily be legitimate, so the recommendation is to keep monitoring only - do not restrict, charge, or accuse anyone on this alone.'
      : '';

    return {
      id:'fr_'+Date.now().toString(36)+_rid(4),
      ts:Date.now(),
      subject:ev.subject||ev.userEmail||'-',
      type:ev.type||'event',
      amount,
      category:cat[0], categoryLabel:cat[1], group:cat[2],
      risk, riskLabel:this.RISK_LABEL[risk],
      signals:active.map(s=>({code:s.code,label:s.label})),
      context:protectedCtx.map(s=>({code:s.code,label:s.label})),
      linked, legitimate:legit, minEvidence:minEv,
      action, actionLabel:this.ACTION_LABEL[action],
      humanReview, confidence,
      insufficientEvidence:insufficient, insufficientStatement,
      resolution:null
    };
  },

  _log(){ try{ return load(this.KEY)||[]; }catch(e){ return []; } },
  _save(l){ try{ store(this.KEY, l.slice(0,200)); }catch(e){} },

  // Evaluate an event and, if it carries any real signal, keep the assessment.
  // Clean events (no active or context signal) are not stored - the monitor
  // only ever shows genuine flags. Best-effort mirror to the backend when live.
  record(ev){
    let a; try{ a=this.evaluate(ev); }catch(e){ return null; }
    if(!a.signals.length && !a.context.length) return a;
    const l=this._log(); l.unshift(a); this._save(l);
    try{ if(typeof AEGIS!=='undefined'&&AEGIS.log) AEGIS.log('fraud_flag',{category:a.category,risk:a.risk,action:a.action}); }catch(e){}
    try{
      const base=(typeof apiBase==='function'&&apiBase())||'';
      /* Through AMV_API, not off disk. In cookie mode the access token is in
         memory and this key is empty, so a storage read here is a request sent
         with no Authorization header - a 401 on a screen that was working. */
      const tok=(window.AMV_API&&AMV_API.token)||'';
      if(base) fetch(base.replace(/\/$/,'')+'/v1/fraud/record',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify(a)}).catch(()=>{});
    }catch(e){}
    return a;
  },

  resolve(id, action){
    const l=this._log(); const it=l.find(x=>x.id===id); if(!it) return;
    it.resolution={action, label:this.ACTION_LABEL[action]||action, ts:Date.now()};
    this._save(l);
  },

  // Derive fresh flags from the real local audit trail (no fabrication). Today
  // this surfaces repeated failed sign-ins (possible ATO / credential stuffing)
  // and rate-limit-block bursts (possible bot activity) from the AEGIS log.
  scan(){
    const out=[];
    try{
      const log=(typeof AEGIS!=='undefined'&&AEGIS._loadLog)?AEGIS._loadLog():[];
      const now=Date.now(); const HOUR=3600000; const bucket=Math.floor(now/HOUR);
      const recent=log.filter(e=>{ const t=Date.parse(e.ts||0); return t&&(now-t)<HOUR; });
      const fails=recent.filter(e=>e.event==='auth_fail');
      if(fails.length>=5){
        const subj=(fails[fails.length-1].email)||'-';
        const a=this.evaluate({type:'login', subject:subj, signals:{auth_fail_burst:true}, entities:{accounts:[subj]}});
        a.id='scan_ato_'+subj+'_'+bucket; a.scan=true; out.push(a);   // stable id: one flag per subject per hour
      }
      const blocks=recent.filter(e=>e.event==='ratelimit_block');
      if(blocks.length>=4){
        const a=this.evaluate({type:'usage', subject:'this device', signals:{purchase_velocity:true}, category:'bot_automation'});
        a.id='scan_bot_'+bucket; a.scan=true; out.push(a);
      }
    }catch(e){}
    return out;
  },

  // Fold live scan flags into the stored log (dedupe by their stable id) so an
  // operator decision on a scan-detected flag persists like any other, and the
  // same burst is never listed twice across renders.
  ingestScan(){
    const l=this._log(); let changed=false;
    this.scan().forEach(a=>{ if(!l.some(x=>x.id===a.id)){ l.unshift(a); changed=true; } });
    if(changed) this._save(l);
    return l;
  }
};
window.AMVFraud=AMVFraud;
/* The owner console that lived on either side of this block - fraud review,
   the Command Center and its user list - is src/admin/admin.js now, fetched
   on demand by _loadAdmin (12-handoff.js). */
/* ══════════════════════════════════════════════════════════════
   AMV-082  THE ADMIN TOKEN - one place, in memory, never at rest.

   Three surfaces needed it and all three did something different. The Founder
   Dashboard asked for it every session and promised, in its own copy, that it
   is "never stored". The Errors dashboard saved it into localStorage, which is
   exactly storing it - readable by any script that ever gets injected, and
   still sitting there tomorrow. And the Command Center sent the signed-in
   user's ACCESS token to an endpoint gated on the admin secret, which can only
   ever be refused: that panel could not load, and said "network error" when it
   did not.

   So: one holder, in memory for the session only, shared by all three. It dies
   with the tab, which is the property the copy already promised.
   ══════════════════════════════════════════════════════════════ */
let _ADMIN_TOK = '';
function _adminToken(){ return _ADMIN_TOK; }
function _setAdminToken(v){ _ADMIN_TOK = String(v || '').trim(); return _ADMIN_TOK; }
function _clearAdminToken(){ _ADMIN_TOK = ''; }
/* Anything a previous build left on disk is a live secret in the wrong place.
   Remove it once, on load, rather than waiting for someone to notice. */
try{
  /* Both spellings, and every account's. saveStr files under the CURRENT
     account, so clearing only that one left a token an older build wrote while
     somebody else was signed in sitting on the disk indefinitely. A secret in
     the wrong place is not less of one because the person who put it there has
     since logged out. */
  try{ localStorage.removeItem('amv_admin_token'); }catch(e){}
  try{
    Object.keys(localStorage)
      .filter(k => k === 'amv_admin_token' || k.endsWith('|amv_admin_token'))
      .forEach(k => { try{ localStorage.removeItem(k); }catch(e){} });
  }catch(e){}
}catch(e){}
try{ window._adminToken=_adminToken; window._setAdminToken=_setAdminToken; window._clearAdminToken=_clearAdminToken; }catch(e){}
function renderUsageView(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi">'+
      '<span class="eyebrow">Your impact</span>'+
      '<h2>What AMV has done for you</h2>'+
      '<p class="vsub">A running tally of the work AMV has handled and the time it\u2019s saved you.</p>'+
      '<div id="usage-body"></div>'+
    '</div></div>';
  _usageFill($('usage-body'));
}


/* === USAGE (legacy owner view, unused) === */

/* === BILLING === */
/* BILLING'S SCREEN IS FETCHED WITH SETTINGS (settings-panes.js, prefetched
   once the page is idle), because only somebody who opens it needs it - about
   5KB gzipped off every first visit (Nov 25). This stand-in fetches it; the
   file's own renderBillingView replaces it as it loads. Inside Settings the
   file is already here, so the pane never waits. */
function renderBillingView(targetEl){
  if(!targetEl && !(S.tab === 'settings' && S.settingsPane === 'billing')){
    _lazyScreen('settings-panes.js', renderBillingView, 'renderBillingView', 'Billing'); return; }
  const stand = renderBillingView;
  _lazyLoad('settings-panes.js', () => window.renderBillingView !== stand).then(ok => {
    if(ok) window.renderBillingView(targetEl);
    else toast(T('That could not be loaded. Check your connection and try again.'), 'error', 5000);
  });
}
/* Per-plan local usage caps (the browser guardrail; server enforces the real ones). */
/* Kept in step with the server's PLAN_LIMITS (AMV-072). If the browser guard is
   tighter than the server's, the user is stopped early by a number the server
   would have allowed - a limit that exists nowhere but here. */
const PLAN_TIERS={
  free:  { dailyTokenCap:20000,    rpmMax:8,  models:['fast','core'] },
  /* Moved with the server's, which is the only reason these numbers exist.
     The allowances were reset to what the margin backstop actually funds, and
     a browser guard left on the old figure is the failure the note above
     names, in its other direction: it would let somebody spend past the point
     the server stops them, so the stop arrives as a refusal rather than as the
     limit they were shown. */
  pro:   { dailyTokenCap:325000,   rpmMax:20, models:['fast','core','swift','coding'] },
  elite: { dailyTokenCap:1170000,  rpmMax:40, models:['fast','core','swift','coding','smart'] },
  ultra: { dailyTokenCap:2860000,  rpmMax:80, models:['fast','core','swift','coding','smart'] },
  /* The server's fallback for a custom plan with no explicit dayTokens is
     Math.round(50000 * TOKENIZER_SCALE) = 65,000. This said 52,000, which is
     the failure the comment above names: a browser guard TIGHTER than the
     server stops somebody at a number the server would have allowed, and it
     exists nowhere but here. Found by grepping for the old free-tier value
     after changing it, not by looking for it. */
  custom:{ dailyTokenCap:65000,    rpmMax:16, models:['fast','core','swift','coding','smart'] }, // overridden per-user below
};
function _setPlan(plan){
  if(!PLANS[plan]) plan='free';
  const prev=loadStr('amv_plan')||'free';
  saveStr('amv_plan',plan);
  /* The "Free plan · Upgrade" line on the chat screen follows the plan. */
  try{ _cvPlanPaint(); }catch(e){ console.error('AMV: the plan line could not be drawn', e); }
  // record start date when the plan actually changes
  if(prev!==plan) saveStr('amv_plan_since',String(Date.now()));
  if(prev!==plan && plan!=='free' && prev==='free'){ try{ AEGIS.log('plan_upgrade',{plan}); }catch(e){} }
  /* A PLAN IS ACCESS. A PAYMENT IS MONEY. THIS FUNCTION ONLY KNOWS ABOUT ONE.

     It used to append a `paid` subscription at the plan's list price whenever
     the plan went up - and the plan goes up for reasons that are not payments:
     an entitlement sync from the server, an admin grant, a trial, a preview.
     Every one of those wrote "Pro plan - monthly, $X, paid" into the billing
     history, titled monthly even for a yearly plan, with no charge behind it.

     Nothing is lost by removing it. Real subscription payments are the
     processor's invoices, which the Billing screen reads from the server and
     already calls the full record; with no backend, nothing is ever charged,
     so there was never a real payment here to describe. A record written by a
     function that cannot know whether money moved is a record that will
     sometimes say it did when it did not. (AMV-AUD-012) */
  // resolve the effective tier (custom = the user's purchased config)
  let t=PLAN_TIERS[plan]||PLAN_TIERS.free;
  if(plan==='custom'){
    try{ const cfg=load('amv_custom_cfg'); if(cfg&&cfg.price){ const s=_customPlanSummary(cfg.price); t={dailyTokenCap:s.dailyCap, rpmMax:s.rpm, models:CUSTOM_PLAN.modelsForPrice(cfg.price)}; } }catch(e){}
  }
  // apply the usage tier to the local guardrail
  try{ if(window.AEGIS&&AEGIS.cfg){ AEGIS.cfg.dailyTokenCap=t.dailyTokenCap; AEGIS.cfg.rpmMax=t.rpmMax; } saveStr('amv_plan_caps',JSON.stringify(t)); }catch(e){}
  // if the user's selected model isn't allowed on this plan, drop to an allowed one
  /* AUTO IS NOT AN ENGINE, AND CLAMPING IT COSTS MONEY.

     PLAN_TIERS[plan].models lists engines - fast, core, coding, smart. 'auto'
     is not one, so changing plan found it "not allowed" and dropped to
     allowed[length-1], the LAST and therefore most expensive engine the plan
     permits. Somebody on auto who upgraded was silently moved onto Apex and
     billed for it on every turn afterwards.

     Same shape as the server-side clamp fixed in _planAllowedModel: auto is a
     request for routing, and the ceiling it needs is applied by the router on
     the server, which is where it belongs. */
  try{ const allowed=t.models;
    if(S.model!=='auto' && allowed.indexOf(S.model)<0){ S.model=allowed[allowed.length-1]; }
  }catch(e){}
  updateSbUser&&updateSbUser();
  // Teams is packaged with Elite and above, so its entry point follows the plan.
  try{ if(typeof _revealTeamNav==='function') _revealTeamNav(); }catch(e){}
  try{ if(typeof renderView==='function' && S.tab) renderView(); }catch(e){}
}
/* Reads the plan the SERVER confirmed, not the value in local storage.

   verifiedPlan existed for exactly this and was called by nothing, so the one
   client-side gate that decides which engines somebody may pick read a value
   anybody can edit in a console. The sync below corrects that value whenever
   it runs, so the exposure is the window before the first sync answers - but
   that window is every cold start, and "the server refuses it a moment later"
   means an error instead of an honest "your plan does not include this".

   Display-only reads elsewhere still use the synced local value on purpose:
   they need an answer before the first round trip, and showing the last known
   plan name is better than showing Free to somebody who pays. This one gates
   a capability, so it waits for the server. */
function _planAllowsModel(mk){ if(mk==='auto') return true; const plan=(typeof verifiedPlan==='function'?verifiedPlan():(loadStr('amv_plan')||'free')); if(plan==='custom') return true;
  /* A partner engine carries its own plan floor; the server enforces it regardless. */
  if(MODELS[mk] && MODELS[mk].partner){ const R={free:0,pro:1,elite:2,ultra:3}; return (R[plan]||0) >= (R[MODELS[mk].rec]||1); }
  const t=PLAN_TIERS[plan]||PLAN_TIERS.free; return t.models.indexOf(mk)>=0; }

/* WHAT THE PERSON'S TEAM HAS TURNED ON.

   The owner or an admin of a team can choose which engines its people use
   (Team > Engines). The server enforces it on every request; this copy of the
   list, from the entitlement, only lets the picker say so before a send is
   refused. null means no team rule - everything the plan allows. */
let _teamEngines = null;
function _teamAllowsModel(mk){
  if(mk==='auto' || !Array.isArray(_teamEngines)) return true;
  const id = MODELS[mk] && MODELS[mk].model;
  return !id || _teamEngines.indexOf(id) >= 0;
}

/* Sync the REAL plan from the backend entitlement store. The server sets the
   plan only via a verified payment webhook, so this is the source of truth -
   the browser never grants itself a paid plan. Called on load and after the
   post-checkout redirect (?upgraded=1). Falls back silently with no backend. */
async function syncEntitlement(){
  try{
    if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)) return;
    const r = await AMV_API._fetch('/v1/entitlement', { method:'GET' });
    const d = await r.json().catch(()=>null);
    if(d && d.ok && d.entitlement){
      // The server is the ABSOLUTE source of truth. Whatever the browser's
      // localStorage claims, the real plan is whatever the server's entitlement
      // store says (set only by a verified payment webhook). If a user spoofed
      // a paid plan in the console, this corrects it back down.
      const serverPlan = d.entitlement.plan || 'free';
      const localPlan = loadStr('amv_plan')||'free';
      if(localPlan !== serverPlan){
        _setPlan(serverPlan);
        if(serverPlan!=='free' && PLAN_RANK[serverPlan] > PLAN_RANK[localPlan]){
          try{ toast('Your '+(PLANS[serverPlan]?PLANS[serverPlan].name:serverPlan)+' plan is active.','success',4000); }catch(e){}
        }
      }
      try{ S._entVerified = { plan:serverPlan, at:Date.now() }; }catch(e){}
      _teamEngines = Array.isArray(d.teamEngines) ? d.teamEngines : null;
      /* WHAT THE NEXT CHARGE IS, FROM THE ONLY THING THAT KNOWS.
         The billing screen used to derive a renewal date from the day THIS
         BROWSER recorded the payment plus thirty - a number with no
         relationship to the subscription, wrong on any second device and wrong
         by eleven months on a yearly plan. `renewal` is the processor's own
         answer, or null, and null means the screen says nothing. */
      try{ S.renewal = (d.renewal && typeof d.renewal === 'object') ? d.renewal : null; }catch(e){}
      /* A failed renewal is the one billing problem the user MUST hear about,
         and the only person who can fix it. Silence here means they lose the
         plan they wanted to keep and we lose the subscription. */
      try{ _showBillingNotice(d.billing || null); }catch(e){}
    }
  }catch(e){ /* offline / no backend - keep local plan */ }
}

/* Persistent, dismissible banner for a payment that did not go through. Not a
   toast: a toast disappears and this needs to still be there next time they
   open the app, until they actually fix the card. */
function _showBillingNotice(billing){
  const existing = document.getElementById('bill-notice');
  if(!billing){ if(existing) existing.remove(); return; }
  // Re-show after a dismissal only if the situation has changed (past_due -> lapsed).
  const seen = loadStr('amv_bill_seen');
  if(seen === billing.state + ':' + billing.since) return;
  if(existing) existing.remove();
  const bar = document.createElement('div');
  bar.id = 'bill-notice';
  /* The two "it has actually stopped" states look the same to the user, so
     they carry the same weight here, whichever of them got us there. */
  const over = billing.state === 'lapsed' || billing.state === 'unconfirmed_lapsed';
  bar.className = 'bill-notice' + (over ? ' lapsed' : '');
  bar.setAttribute('role','status');
  /* "Update card" is the right thing to press when a card was declined and
     exactly the wrong thing when the server merely could not CONFIRM a
     renewal - that state can equally mean our own webhook stopped arriving,
     and sending somebody whose payments are fine to their billing portal to
     fix a working card is how a paying customer ends up cancelling. */
  const unconfirmed = billing.state === 'unconfirmed' || billing.state === 'unconfirmed_lapsed';
  const action = unconfirmed ? 'Contact support' : 'Update card';
  bar.innerHTML =
    '<span class="bill-notice-t">'+escH(billing.message||'There is a problem with your payment method.')+'</span>'+
    '<button class="btn bp bill-fix" type="button" id="bill-fix">'+escH(action)+'</button>'+
    '<button class="bill-x" type="button" id="bill-x" aria-label="Dismiss this notice">&#215;</button>';
  document.body.appendChild(bar);
  if(unconfirmed){
    document.getElementById('bill-fix')?.addEventListener('click',()=>{
      /* The Help Center, which carries the support address and the Email
         Support button. Not the billing portal: there is nothing there for
         somebody whose card is working. */
      try{ setTab('help'); return; }catch(e){}
      try{ setTab('billing'); }catch(e){}
    });
    document.getElementById('bill-x')?.addEventListener('click',()=>{
      try{ saveStr('amv_bill_seen', billing.state + ':' + billing.since); }catch(e){}
      bar.remove();
    });
    return;
  }
  document.getElementById('bill-fix')?.addEventListener('click',()=>{
    // Straight to the processor's own billing portal - the only place a card
    // can actually be changed. Falls back to the billing tab if it is not set up.
    (async()=>{
      try{
        /* A navigation target that came back over the wire. Held to the
           same scheme allowlist as any other outside URL - a javascript: here
           would run in this origin, with the session in it. */
        const url = safeUrl(await AMV_API.portal(''));
        if(url){ location.href = url; return; }
      }catch(e){}
      try{ setTab('billing'); }catch(e){}
    })();
  });
  document.getElementById('bill-x')?.addEventListener('click',()=>{
    try{ saveStr('amv_bill_seen', billing.state + ':' + billing.since); }catch(e){}
    bar.remove();
  });
}
try{ window._showBillingNotice=_showBillingNotice; }catch(e){}
/* The plan the client is ALLOWED to act on. When a backend is live, only a
   server-verified plan counts - a value sitting in localStorage that the server
   hasn't confirmed is treated as 'free', so console-editing amv_plan grants
   nothing. With no backend (pure static/offline demo) the local value is used,
   since there's no server to verify against and nothing real to steal. */
function verifiedPlan(){
  try{
    const local = loadStr('amv_plan')||'free';
    if(!(window.AMV_API && AMV_API.live)) return local;         // no backend: local is all there is
    const v = S._entVerified;
    if(v && v.plan) return v.plan;                               // server-confirmed
    return 'free';                                               // live but unconfirmed → never trust a paid local value
  }catch(e){ return 'free'; }
}
try{ window.verifiedPlan = verifiedPlan; }catch(e){}
/* After returning from Stripe/PayPal checkout, confirm the upgrade landed. */
function _checkUpgradeReturn(){
  try{
    const p = new URLSearchParams(window.location.search);
    if(p.get('upgraded')==='1'){
      history.replaceState(null,'',window.location.pathname);
      // entitlement is set by the webhook; poll a couple times for propagation
      let tries=0; const poll=()=>{ syncEntitlement(); if(++tries<3) setTimeout(poll, 2500); };
      poll();
    } else if(p.get('canceled')==='1'){
      history.replaceState(null,'',window.location.pathname);
      try{ toast('Checkout canceled - no charge was made.','info',4000); }catch(e){}
    }
  }catch(e){}
}
try{ window.syncEntitlement=syncEntitlement; window._checkUpgradeReturn=_checkUpgradeReturn; }catch(e){}
window._setPlan=_setPlan;

/* === TEAMS PLAN GATING ===
   Teams is a B2B capability. It unlocks on the Elite plan ($75/mo) and above
   - lowered from Ultra so growing companies can collaborate without jumping to
   the top tier (enterprise buyers want teams early). Free/Pro cannot create or
   join a team; Elite, Ultra, and equivalent Custom plans can. */
const TEAM_REQUIRED_PLAN = 'elite';
/* A custom plan is a price, not a tier, so PLAN_RANK has no entry for it. The
   lookup returned undefined and every custom plan was refused - including the
   enterprise ones the copy on this very screen promises teams to. Ranked by
   what was paid, matching the server, which is the side that decides. */
const _CUSTOM_TIERS=[[200,3],[75,2],[15,1]];
function _customRank(){
  let price=0;
  try{ price=+((load('amv_custom_cfg')||{}).price)||0; }catch(e){}
  for(const t of _CUSTOM_TIERS) if(price>=t[0]) return t[1];
  return 0;
}
function _planAllowsTeams(){
  const plan=loadStr('amv_plan')||'free';
  const need=PLAN_RANK[TEAM_REQUIRED_PLAN]||2;
  if(plan==='custom') return _customRank() >= need;
  return (PLAN_RANK[plan]||0) >= need;
}
window._planAllowsTeams=_planAllowsTeams;

/* === SUPPORT EMAIL (Task #5) ===
   ONE source of truth. The owner sets it once in Settings → Platform
   (or via setSupportEmail in console); it then appears everywhere.
   Until an address is set, support buttons route to "Ask AMV directly"
   instead of a dead mailto: link - so it's never broken. */
function _supportEmail(){ return (loadStr('amv_support_email')||'').trim(); }
window._supportEmail=_supportEmail;
window.setSupportEmail=function(addr){
  addr=(addr||'').trim();
  if(addr && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)){ console.warn('Invalid email'); return false; }
  saveStr('amv_support_email', addr);
  try{ if(S.tab==='help') renderHelpView(); }catch(e){}
  return true;
};

/* A support button/link that adapts: real mailto when configured,
   otherwise routes to Ask AMV (never a dead link).
   opts: {label, cls, subject} */
function supportButton(opts){
  opts=opts||{};
  const cls=opts.cls||'btn bp';
  const label=opts.label||'Email Support';
  const email=_supportEmail();
  if(email){
    const subj=opts.subject?('?subject='+encodeURIComponent(opts.subject)):'';
    return '<a href="mailto:'+escH(email)+subj+'" class="'+cls+'" style="font-size:var(--t-sm)">'+label+'</a>';
  }
  // No address configured yet → graceful fallback to Ask AMV (no dead mailto)
  return '<button class="'+cls+'" style="font-size:var(--t-sm)" data-dact="askAmv" data-darg="">'+label+'</button>';
}
window.supportButton=supportButton;


/* The minimum plan that unlocks a given model */
function _minPlanForModel(mk){
  const order=['free','pro','elite','ultra'];
  for(const p of order){ if((PLAN_TIERS[p]||{}).models && PLAN_TIERS[p].models.indexOf(mk)>=0) return p; }
  return 'pro';
}
function openUpgradeModal(lockedModel){
  /* THE SAME CARDS AS THE PLANS PAGE, IN A WINDOW.

     This was a stack of four full-width rows under an emoji padlock - a
     different shape from every other place a plan is sold, and the owner's
     word for it was "looks bad". Now it shows only the plans that include the
     engine somebody just picked, side by side, the way the plans page does:
     name, price, one line, one button. The cheapest one that unlocks it leads. */
  const r=$('ovr'); if(!r) return;
  const m=MODELS[lockedModel]||{label:'this model'};
  const needPlan=_minPlanForModel(lockedModel);
  const order=['pro','elite','ultra'].filter(k=>PLAN_RANK[k]>=PLAN_RANK[needPlan]);
  const card=(k)=>{ const pl=PLANS[k]; const isNeed=k===needPlan;
    return '<div class="upg2-card'+(isNeed?' lead':'')+'">'+
      '<div class="pl2-top"><div class="pl2-name">'+escH(pl.name)+(isNeed?'<span class="pl2-tag">'+escH(T('Unlocks {model}').replace('{model}',()=>m.label))+'</span>':'')+'</div>'+
      '<div class="pl2-price"><span class="pl2-amt">$'+pl.price+'</span><span class="pl2-per">'+escH(T('/ month'))+'</span></div>'+
      '<p class="pl2-line">'+escH(T(pl.blurb||''))+'</p></div>'+
      '<button type="button" class="btn '+(isNeed?'bp':'bs')+' pl2-cta" data-upg="'+k+'">'+escH(T('Get {plan}').replace('{plan}',()=>pl.name))+'</button>'+
    '</div>';
  };
  const lock='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  r.innerHTML='<div class="upg-ov" id="upg-bg"><div class="upg-modal upg2" role="dialog" aria-modal="true" aria-labelledby="upg2-t">'+
    '<button class="dna-x upg2-x" id="upg-x" aria-label="'+escH(T('Close'))+'">✕</button>'+
    '<div class="upg2-head"><span class="upg2-ic">'+lock+'</span>'+
      '<h2 id="upg2-t">'+escH(T('Upgrade to use {model}').replace('{model}',()=>m.label))+'</h2>'+
      '<p>'+escH(T('{model} is included from {plan} up. Cancel anytime.').replace('{model}',()=>m.label).replace('{plan}',()=>PLANS[needPlan].name))+'</p>'+
    '</div>'+
    '<div class="upg2-grid">'+order.map(card).join('')+'</div>'+
    '<div class="upg2-foot"><button type="button" class="pl2-link" id="upg-compare">'+escH(T('Compare all plans'))+'</button>'+
      '<span aria-hidden="true">·</span><button type="button" class="pl2-link" data-upg="custom">'+escH(T('Build a custom plan'))+'</button></div>'+
  '</div></div>';
  const close=()=>{ r.innerHTML=''; };
  onBackdrop($('upg-bg'),close); on($('upg-x'),'click',close);
  /* The plan's own page, like every other route to a paid plan. A modal is the
     smallest surface in the product and the worst place to decide on $75 a
     month from; closing it and opening the full argument is what the pricing
     cards and Billing's rows both do now. Custom is quoted, not listed, so it
     keeps its own flow. */
  r.querySelectorAll('[data-upg]').forEach(btn=>on(btn,'click',()=>{ const k=btn.dataset.upg; close(); if(k==='custom'){ openCustomPlan(); } else if(typeof openUpgrade==='function'){ openUpgrade(k); } else { openCheckout(k); } }));
  const cmp=$('upg-compare'); if(cmp) on(cmp,'click',()=>{ close(); openPlanCompare(needPlan); });
}
/* THE PLAN COMPARISON AND THE CUSTOM PLAN BUILDER are fetched with Settings
   (settings-panes.js, prefetched once the page is idle): only somebody on the
   Plans or Billing screen opens them, and they were ~2.7KB gzipped on every
   first visit (Nov 25). These stand-ins fetch the file; its own functions
   replace them as it loads. */
function openPlanCompare(highlight){ _plansLazy('openPlanCompare', openPlanCompare, [highlight]); }
function openCustomPlan(){ _plansLazy('openCustomPlan', openCustomPlan, []); }
function _plansLazy(name, stand, args){
  _lazyLoad('settings-panes.js', () => window[name] !== stand).then(ok => {
    if(ok) window[name].apply(null, args);
    else toast(T('That could not be loaded. Check your connection and try again.'), 'error', 5000);
  });
}
function _switchPlan(target){
  if(target==='free'){
    showConfirmAsync('Cancel your subscription and switch to Free? You\u2019ll keep access until the end of your billing period.').then(confirmed=>{
      if(!confirmed) return;
      _setPlan('free');
      toast('Switched to Free','info');
      renderBillingView();
    });
    return;
  }
  // downgrade to a lower paid plan → run checkout for that plan
  openCheckout(target);
}
/* THE PAYMENT-METHOD CARD IS GONE, AND IT NEVER RENDERED ANYWAY.

   Three functions lived here: _savePM, _loadPM, removePM. Nothing ever called
   _savePM, so amv_pm_display was never written, so _loadPM always returned
   null and the "Payment method  ····  4242" row could not appear. removePM was
   exported with no button. And _savePM invented token:'tok_'+random and stored
   it as though it meant something - a made-up payment token, which is exactly
   the mock-shipped-as-real this product does not do.

   The card is at Stripe and the control for it is the billing portal, which
   this screen already opens. One place, and it is the real one. */

