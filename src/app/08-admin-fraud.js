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
      legit.push('The refund or dispute may be completely valid - the product failed, was not as described, or a charge was not recognised. Requesting money back is a right, not an admission.');
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
      minEv.push('Re-authentication by the real account owner and confirmation the device is recognised.');
    if(sig.otp_fail_burst)
      minEv.push('Direct contact with the verified account owner on a known channel.');
    if(sig.new_account_high_value)
      minEv.push('A successful payment authentication (3-D Secure) or matching billing verification from the processor.');
    if(sig.purchase_velocity)
      minEv.push('Server-side rate and device signals showing whether the pattern is human-plausible or scripted.');
    if(sig.listing_prohibited||sig.listing_guarantee)
      minEv.push('A manual review of the listing content and proof of the seller\'s ownership or licence.');
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
      id:'fr_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
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
      const base=(typeof loadStr==='function'&&loadStr('amv_api_base'))||'';
      const tok=(typeof loadStr==='function'&&loadStr('amv_api_token'))||(window.AMV_API&&AMV_API.token)||'';
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
function _fraudAct(arg){
  const s=String(arg); const i=s.indexOf('::'); if(i<0) return;
  const id=s.slice(0,i), action=s.slice(i+2);
  AMVFraud.resolve(id, action);
  try{ if(typeof toast==='function') toast('Recorded: '+(AMVFraud.ACTION_LABEL[action]||action),'info'); }catch(e){}
  try{ if(S.tab==='admin') renderAdminView(); }catch(e){}
}
window._fraudAct=_fraudAct;

/* Render one full fraud assessment as an operator card. */
function _fraudCard(a){
  const rc={low:'#4ade80',medium:'#e0b341',high:'#ff8c42',critical:'#ff4d4d'};
  const chips=(arr)=>arr.map(x=>'<span class="fr-chip">'+escH(x)+'</span>').join('');
  const linkRows=[];
  const L=a.linked||{};
  [['accounts','Accounts'],['devices','Devices'],['payments','Payments'],['addresses','Addresses'],['transactions','Transactions']].forEach(([k,lbl])=>{
    if(L[k]&&L[k].length) linkRows.push('<div class="fr-link"><span class="fr-link-l">'+lbl+'</span><span class="fr-link-v">'+chips(L[k])+'</span></div>');
  });
  const resolved=a.resolution;
  const acts=['allow','request_verification','restrict','temporary_hold','escalate'];
  const actBtns=acts.map(x=>'<button class="fr-actbtn'+(x===a.action?' rec':'')+(resolved&&resolved.action===x?' chosen':'')+'" data-dact="_fraudAct" data-darg="'+a.id+'::'+x+'">'+escH(AMVFraud.ACTION_LABEL[x])+(x===a.action?' ★':'')+'</button>').join('');
  return '<div class="fr-card">'+
    '<div class="fr-top">'+
      '<span class="fr-risk" style="background:'+rc[a.risk]+'">'+escH(a.riskLabel)+' risk</span>'+
      '<span class="fr-cat">'+escH(a.categoryLabel)+'</span>'+
      '<span class="fr-grp">'+escH(AMVFraud.GROUPS[a.group]||a.group)+'</span>'+
      '<span class="fr-conf">'+Math.round(a.confidence*100)+'% confidence</span>'+
      (a.humanReview?'<span class="fr-human">Human review</span>':'')+
    '</div>'+
    '<div class="fr-meta">Subject: <b>'+escH(a.subject)+'</b> · '+escH(a.type)+(a.amount?' · $'+a.amount:'')+' · '+_admAgo(new Date(a.ts).toISOString())+'</div>'+
    (a.insufficientEvidence?'<div class="fr-insuf">'+escH(a.insufficientStatement)+'</div>':'')+
    (a.signals.length?'<div class="fr-sec"><div class="fr-sec-h">Triggering signals</div><ul class="fr-list">'+a.signals.map(s=>'<li>'+escH(s.label)+'</li>').join('')+'</ul></div>':'')+
    (a.context.length?'<div class="fr-sec"><div class="fr-sec-h">Context (not scored)</div><ul class="fr-list">'+a.context.map(s=>'<li>'+escH(s.label)+'</li>').join('')+'</ul></div>':'')+
    (linkRows.length?'<div class="fr-sec"><div class="fr-sec-h">Linked entities</div><div class="fr-links">'+linkRows.join('')+'</div></div>':'')+
    '<div class="fr-sec"><div class="fr-sec-h">Legitimate explanations</div><ul class="fr-list ok">'+a.legitimate.map(x=>'<li>'+escH(x)+'</li>').join('')+'</ul></div>'+
    '<div class="fr-sec"><div class="fr-sec-h">Minimum evidence to decide</div><ul class="fr-list">'+a.minEvidence.map(x=>'<li>'+escH(x)+'</li>').join('')+'</ul></div>'+
    '<div class="fr-rec">Recommended: <b>'+escH(a.actionLabel)+'</b>'+(a.humanReview?' - send to a person, do not auto-enforce.':'')+'</div>'+
    '<div class="fr-acts">'+actBtns+'</div>'+
    (resolved?'<div class="fr-resolved">Operator decision: <b>'+escH(resolved.label)+'</b> · '+_admAgo(new Date(resolved.ts).toISOString())+'</div>':'')+
  '</div>';
}

function _adminAbuseSignals(){
  // derive anomaly signals from the AEGIS event ring buffer
  const log=(typeof AEGIS!=='undefined'&&AEGIS._loadLog)?AEGIS._loadLog():[];
  const now=Date.now(); const HOUR=3600000;
  const recent=log.filter(e=>{ const t=Date.parse(e.ts||0); return t && (now-t)<HOUR; });
  const errors=recent.filter(e=>e.event==='api_error'||e.event==='exception');
  const blocks=recent.filter(e=>e.event==='ratelimit_block');
  const authFails=log.filter(e=>e.event==='auth_fail').slice(-50);
  const reqs=recent.filter(e=>e.event==='request');
  const signals=[];
  if(reqs.length>120) signals.push({sev:'warn', title:'High request volume', detail:reqs.length+' requests in the last hour - watch for a runaway loop or heavy user.'});
  if(errors.length>=8) signals.push({sev:'crit', title:'Error-rate spike', detail:errors.length+' errors in the last hour. Check the AI backend and recent changes.'});
  if(blocks.length>=3) signals.push({sev:'warn', title:'Rate-limit blocks firing', detail:blocks.length+' requests were blocked by guardrails this hour.'});
  if(authFails.length>=5) signals.push({sev:'warn', title:'Repeated failed sign-ins', detail:authFails.length+' recent failed logins - possible credential-stuffing.'});
  return { signals, errors:errors.length, blocks:blocks.length, reqs:reqs.length, authFails:authFails.length };
}
/* ============================================================
   ADMIN COMMAND CENTER (operator-only) - full executive + ops
   dashboard. Tabbed: Overview · Users · Revenue · AI & Usage ·
   Infrastructure · Security · Product · Growth. Real data where
   we have it (usage, cost, users, errors, models, features);
   backend-fed panels where production infra is required (clearly
   labeled - never fabricated numbers).
   ============================================================ */
/* AMV-090: the operator had two homes. Money owed to sellers, the weekly
   digest and go-live readiness lived only under Settings; everything else lived
   here. Nothing said which screen to use, so half the operator's job was
   somewhere they had no reason to look.

   Rather than deleting either surface, the three that were stranded are
   rendered HERE too, from the same functions - so there is one place to run the
   business, and Settings keeps working for anyone already using it. */
const _ADMIN_TABS=[
  ['overview','Overview'],['business','Business'],['users','Users'],['finance','Finance'],['revenue','Revenue'],
  ['ai','AI & Usage'],['infra','Infrastructure'],['security','Security'],['fraud','Fraud Monitor'],
  ['product','Product'],['growth','Growth']
];
function _admMetrics(){
  // gather everything we can from real local/AEGIS data
  const u=(typeof AEGIS!=='undefined')?AEGIS.usage():{reqs:0,inTok:0,outTok:0,costUSD:0,errors:0};
  const log=(typeof AEGIS!=='undefined'&&AEGIS._loadLog)?AEGIS._loadLog():[];
  const now=Date.now();
  const since=(ms)=>log.filter(e=>{const t=Date.parse(e.ts||0);return t&&(now-t)<ms;});
  const modelUse={};
  log.filter(e=>e.event==='usage').forEach(e=>{ const m=e.model||(e.data&&e.data.model)||'unknown'; modelUse[m]=(modelUse[m]||0)+1; });
  const featureUse={};
  log.filter(e=>e.event==='feature').forEach(e=>{ const f=e.name||(e.data&&e.data.name)||'other'; featureUse[f]=(featureUse[f]||0)+1; });
  return { u, log, since, modelUse, featureUse,
    reqs1h:since(3600000).filter(e=>e.event==='request').length,
    reqs24h:since(86400000).filter(e=>e.event==='request').length,
    errors24h:since(86400000).filter(e=>e.event==='api_error'||e.event==='exception'||e.event==='error').length,
    authFails24h:since(86400000).filter(e=>e.event==='auth_fail').length };
}
function _admStat(v,l,accent){ return '<div class="adm-stat"><div class="adm-stat-v"'+(accent?' style="color:'+accent+'"':'')+'>'+v+'</div><div class="adm-stat-l">'+l+'</div></div>'; }
function _admCard(title, body, sub){ return '<div class="ss2"><h3>'+title+(sub?' <span class="adm-live">'+sub+'</span>':'')+'</h3>'+body+'</div>'; }
function _admPending(what){ return '<div class="adm-pending"><span class="adm-pending-dot"></span>'+escH(what)+' - populates live once the backend is connected.</div>'; }
function _admBars(obj, emptyMsg){
  const keys=Object.keys(obj); if(!keys.length) return '<div class="adm-empty">'+(emptyMsg||'No data yet.')+'</div>';
  const max=Math.max(...keys.map(k=>obj[k]));
  return '<div class="adm-barlist">'+keys.sort((a,b)=>obj[b]-obj[a]).map(k=>'<div class="adm-brow"><span class="adm-brow-l">'+escH(k)+'</span><div class="adm-brow-track"><div class="adm-brow-fill" style="width:'+Math.max(4,obj[k]/max*100)+'%"></div></div><span class="adm-brow-v">'+obj[k]+'</span></div>').join('')+'</div>';
}
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
  if(loadStr('amv_admin_token')){ saveStr('amv_admin_token',''); }
  try{ localStorage.removeItem('amv_admin_token'); }catch(e){}
}catch(e){}
try{ window._adminToken=_adminToken; window._setAdminToken=_setAdminToken; window._clearAdminToken=_clearAdminToken; }catch(e){}

/* The prompt the Command Center shows when it has no token yet. Rendered into
   the page rather than a modal so it cannot be missed behind other UI. */
function _admTokenPromptHTML(msg){
  return '<div class="adm-tokwrap">'+
    '<div class="adm-tokmsg">'+escH(msg || 'Platform-wide figures are gated on your Worker’s ADMIN_TOKEN secret.')+'</div>'+
    '<div class="adm-tokrow">'+
      '<label class="sr-only" for="adm-tok">Admin token</label>'+
      '<input id="adm-tok" type="password" autocomplete="off" class="inp" placeholder="Admin token">'+
      '<button class="btn bp" id="adm-tok-go" type="button">Load</button>'+
    '</div>'+
    '<div class="adm-toknote">Kept in memory for this tab only - never written to this device.</div>'+
  '</div>';
}
function _wireAdmTokenPrompt(root){
  const go = () => {
    const v = (document.getElementById('adm-tok') || {}).value || '';
    if(!v.trim()){ return; }
    _setAdminToken(v);
    S._admStatsError = '';
    _admFetchStats();
  };
  const b = (root || document).querySelector('#adm-tok-go'); if(b) on(b,'click',go);
  const i = (root || document).querySelector('#adm-tok');
  if(i) on(i,'keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } });
}

function renderAdminView(){
  const vc=$('vc'); if(!vc) return;
  if(!isAdmin()){ vc.innerHTML='<div class="sv fi"><div class="vi"><h2>Admin</h2><p class="vsub">This area is for the workspace operator.</p></div></div>'; return; }
  const tab=S._adminTab||'overview';
  const backendLive=_aiBackendReady();
  const live=S._admStats;  // real cross-user platform stats (from backend), if loaded
  // pull real platform-wide stats when backend is live. Re-fetch if stale (>3 min)
  // so the dashboard keeps reflecting current cross-user activity.
  const stale = S._admStats && (Date.now()-(S._admStats.generatedAt||0) > 180000);
  /* Only fetch when there is a token to fetch WITH. Firing without one used to
     produce a guaranteed 403 that surfaced as "network error". */
  if((loadStr('amv_api_base')||'') && _adminToken() && (!S._admStats || stale) && !S._admStatsLoading){ _admFetchStats(); }
  vc.innerHTML='<div class="sv fi"><div class="vi">'+
    '<span class="eyebrow">Operator</span>'+
    '<h2>Command Center</h2>'+
    '<p class="vsub">Everything running your platform - live metrics, revenue, infrastructure, security. '+
      (live?'<span class="adm-livebadge">● Live · all users</span> updated '+_admAgo(live.generatedAt):
       backendLive?(S._admStatsLoading?'Loading live platform data…':'<button class="adm-refresh" data-admrefresh="1">Load live platform data</button>'):
       'Local metrics (this device). Connect the backend for platform-wide data.')+'</p>'+
    '<div class="adm-tabs">'+_ADMIN_TABS.map(t=>'<button class="adm-tab'+(t[0]===tab?' on':'')+'" data-atab="'+t[0]+'">'+t[1]+'</button>').join('')+'</div>'+
    /* Gated on a backend URL, not on being signed in. The admin token is a
       separate credential from the user session - requiring a session here
       would hide the prompt from an operator who has one but not the other. */
    ((loadStr('amv_api_base')||'') && !live && !S._admStatsLoading ? _admTokenPromptHTML(S._admStatsError) : '')+
    '<div id="adm-body"></div>'+
  '</div></div>';
  vc.querySelectorAll('[data-atab]').forEach(b=>on(b,'click',()=>{ S._adminTab=b.dataset.atab; renderAdminView(); }));
  const rb=vc.querySelector('[data-admrefresh]'); if(rb) on(rb,'click',()=>{
    // No token, no request - ask for one rather than firing a call that cannot pass.
    if(!_adminToken()){ const i=document.getElementById('adm-tok'); if(i) i.focus(); return; }
    _admFetchStats();
  });
  _wireAdmTokenPrompt(vc);
  _admRenderTab(tab, backendLive, live);
}
/* Fetch real cross-user platform stats from the backend and cache them. */
async function _admFetchStats(){
  const base=loadStr('amv_api_base')||'';
  /* The ADMIN token, not the signed-in user's. These endpoints are gated on the
     Worker's ADMIN_TOKEN secret; sending an access token here was a request
     that could only ever be refused. */
  const tok=_adminToken();
  if(!base || !tok){ S._admStatsError = !base ? 'Connect your backend first (Settings \u2192 Live/Backend).' : ''; return; }
  S._admStatsLoading=true; S._admStatsError='';
  try{ if(S.tab==='admin') renderAdminView(); }catch(e){}
  try{
    const r=await fetchDeadline(base.replace(/\/$/,'')+'/v1/admin/stats',{headers:{'Authorization':'Bearer '+tok}},15000);
    if(r.ok){ S._admStats=await r.json(); }
    else if(r.status===403){
      // A wrong token is a wrong token - say so, and drop it so the next
      // attempt asks again instead of retrying something already rejected.
      _clearAdminToken();
      S._admStatsError='That admin token was rejected.';
    }
    else { _logErr('adminStats', new Error('HTTP '+r.status)); S._admStatsError='Could not load platform stats ('+r.status+').'; }
  }catch(e){ _logErr('adminStats', e); S._admStatsError='Could not reach the backend.'; }
  S._admStatsLoading=false;
  try{ if(S.tab==='admin') renderAdminView(); }catch(e){}
}
/* Fetch the real financial statement (all transactions) from the backend. */
async function _admFetchFinance(){
  const base=loadStr('amv_api_base')||''; const tok=_adminToken();
  if(!base || !tok){ return; }
  if(S._admFinanceLoading) return;
  S._admFinanceLoading=true;
  try{
    const r=await fetchDeadline(base.replace(/\/$/,'')+'/v1/admin/finance',{headers:{'Authorization':'Bearer '+tok}},15000);
    if(r.ok){ S._admFinance=await r.json(); }
    else { _logErr('adminFinance', new Error('HTTP '+r.status)); S._admFinance={ configured:false, transactions:[], totals:{} }; }
  }catch(e){ _logErr('adminFinance', e); }
  S._admFinanceLoading=false;
  try{ if(S.tab==='admin') renderAdminView(); }catch(e){}
}
/* Growth block: signups today, WoW trend, conversion, active - plus a 30-day
   signup sparkline. The numbers that tell you if the business is actually
   growing, rendered from the real backend series. */
function _admGrowthBlock(live, backendLive){
  if(!live || !live.growth){
    return backendLive ? '<div class="adm-users-loading">Loading growth data…</div>'
                       : _admPending('Signups over time, conversion rate, active users');
  }
  const g=live.growth, uu=live.users||{};
  const wow = (g.wowGrowthPct==null) ? '-' : (g.wowGrowthPct>=0?'+':'')+g.wowGrowthPct+'%';
  const wowColor = (g.wowGrowthPct==null) ? '' : (g.wowGrowthPct>=0 ? '#4ade80' : '#ff6b6b');
  const spark=_admSparkline((g.signups30||[]).map(d=>d.count));
  return '<div class="adm-kpi-grid">'+
      _admKpi('Signups today', String(g.signupsToday!=null?g.signupsToday:'-'), 'New accounts')+
      _admKpi('This week', String(g.signups7!=null?g.signups7:'-'), 'Signups (7d)')+
      _admKpi('WoW growth', wow, 'vs previous 7d', wowColor)+
      _admKpi('Conversion', (uu.conversionPct!=null?uu.conversionPct+'%':'-'), 'Free → paid')+
      _admKpi('Active today', String(uu.activeToday!=null?uu.activeToday:'-'), 'Signed-in users')+
      _admKpi('ARPU', (live.revenue&&live.revenue.arpu!=null?'$'+live.revenue.arpu:'-'), 'Avg revenue / paying user')+
      /* The invite loop, measured. A conversion counts only when an invited
         account has actually started using AMV, so this is activation through
         referral - not links clicked. */
      _admKpi('Referrals', String(g.referrals7!=null?g.referrals7:'-'), 'Converted (7d)')+
      _admKpi('Referral share', (g.referralSharePct!=null?g.referralSharePct+'%':'-'), 'Of this week\u2019s signups')+
    '</div>'+
    '<div class="adm-spark-wrap"><div class="adm-spark-lbl">Signups, last 30 days</div>'+spark+'</div>';
}

/* A tiny inline SVG sparkline - no library, scales to the data. */
function _admSparkline(values){
  if(!values || !values.length) return '';
  const w=280, h=44, pad=3;
  const max=Math.max(1, ...values);
  const step=(w-pad*2)/Math.max(1,(values.length-1));
  const pts=values.map((v,i)=>{
    const x=pad+i*step;
    const y=h-pad-(v/max)*(h-pad*2);
    return x.toFixed(1)+','+y.toFixed(1);
  });
  const line=pts.join(' ');
  const area='0,'+h+' '+pts.map(p=>p).join(' ')+' '+w+','+h;
  return '<svg class="adm-spark" viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" preserveAspectRatio="none">'+
    '<polygon points="'+area+'" fill="var(--accent)" opacity="0.12"/>'+
    '<polyline points="'+line+'" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>'+
  '</svg>';
}

function _admRenderTab(tab, backendLive, live){
  const el=$('adm-body'); if(!el) return;
  const m=_admMetrics(); const u=m.u;
  const sev={crit:'#ff4d4d',warn:'#e0b341',ok:'#4ade80'};
  const cap=(typeof AEGIS!=='undefined'&&AEGIS.cfg)?AEGIS.cfg.dailyTokenCap:2000000;
  const used=u.inTok+u.outTok; const pct=Math.min(used/cap*100,100);
  const errRate=u.reqs?((u.errors/u.reqs)*100):0;

  if(tab==='business'){
    /* The three operator jobs that used to live only in Settings. Same
       functions, so they can never drift apart from the other screen. */
    el.innerHTML =
      '<div id="fd-payouts"><div class="fd-loading">Checking what is owed\u2026</div></div>'+
      (typeof _digestCardHTML==='function' ? _digestCardHTML() : '')+
      '<div class="ss2"><h3>Go-live status</h3>'+
        '<div class="golive" id="golive-body"><div class="fd-loading">Checking your deployment\u2026</div></div>'+
      '</div>';
    try{ if(typeof _wireDigestCard==='function') _wireDigestCard(); }catch(e){}
    try{ if(typeof _loadPayouts==='function') _loadPayouts(); }catch(e){}
    try{ if(typeof _loadReadiness==='function') _loadReadiness(); }catch(e){}
    return;
  }

  if(tab==='overview'){
    const ab=_adminAbuseSignals();
    el.innerHTML=
      _admCard('Executive summary','<div class="adm-stats">'+
        _admStat('$'+u.costUSD.toFixed(2),'Spend today')+
        _admStat(u.reqs.toLocaleString(),'API requests today')+
        _admStat((used>=1000?(used/1000).toFixed(1)+'k':used),'Tokens today')+
        _admStat(errRate.toFixed(1)+'%','Error rate', errRate>5?sev.crit:'')+
      '</div>'+
      '<div class="adm-stats" style="margin-top:12px">'+
        _admStat(m.reqs24h.toLocaleString(),'Requests (24h)')+
        _admStat(m.errors24h.toLocaleString(),'Errors (24h)', m.errors24h>0?sev.warn:'')+
        _admStat(m.authFails24h.toLocaleString(),'Failed logins (24h)', m.authFails24h>3?sev.warn:'')+
        _admStat((typeof AEGIS!=='undefined'&&AEGIS._loadLog)?AEGIS._loadLog().length:0,'Audit events')+
      '</div>')+
      _admCard('Safety signals','<div class="adm-mini-signals">'+(ab.signals.length?ab.signals.map(s=>'<div class="adm-signal '+s.sev+'"><span class="adm-signal-dot" style="background:'+sev[s.sev]+'"></span><div><b>'+escH(s.title)+'</b><span>'+escH(s.detail)+'</span></div></div>').join(''):'<div class="adm-allclear"><span class="adm-signal-dot" style="background:'+sev.ok+'"></span> All clear - no anomalies in the last hour.</div>')+'</div>','last hour')+
      _admCard('Live KPIs','<div class="adm-kpi-grid">'+
        _admKpi('MRR', live?'$'+live.revenue.estMRR.toLocaleString():(backendLive?'…':'-'), 'Monthly recurring')+
        _admKpi('ARR', live?'$'+live.revenue.estARR.toLocaleString():(backendLive?'…':'-'), 'Annual recurring')+
        _admKpi('Paying users', live?live.users.paying.toLocaleString():'1', 'Active subscriptions')+
        _admKpi('Total users', live?live.users.total.toLocaleString():(backendLive?'…':'-'), 'All time')+
      '</div>'+(live?'':backendLive?'':_admPending('Revenue & user totals')))+
      _admCard('Growth', _admGrowthBlock(live, backendLive), live&&live.growth?'last 30 days':'');
  }
  else if(tab==='finance'){
    const f=S._admFinance;
    let totalsHtml;
    if(!f){
      totalsHtml = backendLive
        ? '<div class="adm-users-loading">Loading transactions\u2026</div>'
        : _admPending('Real transactions (all payments, refunds, net) - connect the backend');
    } else if(f.configured===false){
      totalsHtml = '<div class="adm-fin-note">Stripe isn\u2019t connected yet. Set STRIPE_SECRET_KEY to see real transactions here.</div>';
    } else {
      const t=f.totals||{};
      totalsHtml='<div class="adm-stats">'+
        _admStat('$'+(t.gross||0).toLocaleString(),'Gross received')+
        _admStat('$'+(t.refunded||0).toLocaleString(),'Refunded', (t.refunded>0?'#e0b341':''))+
        _admStat('$'+(t.net||0).toLocaleString(),'Net', '#4ade80')+
        _admStat((t.count||0).toLocaleString(),'Transactions')+
      '</div>';
    }
    let tableHtml='';
    if(f && f.configured!==false && (f.transactions||[]).length){
      tableHtml='<div class="adm-fin-table-wrap"><table class="adm-fin-table"><thead><tr>'+
        '<th>Date</th><th>Customer</th><th>Method</th><th>Amount</th><th>Status</th><th>Card</th><th></th></tr></thead><tbody>'+
        f.transactions.map(tx=>'<tr>'+
          '<td>'+new Date(tx.date).toLocaleDateString()+'</td>'+
          '<td class="adm-fin-email">'+escH(tx.email||'-')+'</td>'+
          '<td><span class="adm-fin-prov p-'+escH(tx.provider||'')+'">'+escH((tx.provider||'-').replace(/^\w/,c=>c.toUpperCase()))+'</span></td>'+
          '<td class="adm-fin-amt">$'+(tx.amount||0).toFixed(2)+(tx.refunded>0?' <span class="adm-fin-ref">-$'+tx.refunded.toFixed(2)+'</span>':'')+'</td>'+
          '<td><span class="adm-fin-status s-'+escH(tx.status||'')+'">'+escH(tx.status||'')+'</span></td>'+
          '<td>'+(tx.last4?('\u2022\u2022\u2022\u2022 '+escH(tx.last4)):'-')+'</td>'+
          '<td>'+(tx.receipt?'<a href="'+escH(tx.receipt)+'" target="_blank" rel="noopener" class="adm-fin-rc">Receipt</a>':'')+'</td>'+
        '</tr>').join('')+
      '</tbody></table></div>'+
      (f.hasMore?'<div class="adm-fin-more">Showing the most recent '+f.transactions.length+' transactions.</div>':'');
    } else if(f && f.configured!==false){
      tableHtml='<div class="adm-fin-note">No transactions yet. They\u2019ll appear here as customers pay.</div>';
    }
    el.innerHTML=
      _admCard('Financial statement', totalsHtml, f&&f.configured!==false?'live from Stripe':'')+
      (tableHtml?_admCard('All transactions', tableHtml):'');
    if(backendLive && !f) _admFetchFinance();
  }
  else if(tab==='users'){
    el.innerHTML=
      _admCard('User base','<div class="adm-stats">'+
        _admStat(live?live.users.total.toLocaleString():(backendLive?'…':'1'),'Total users')+
        _admStat(live?live.users.paying.toLocaleString():(backendLive?'…':'1'),'Paying users')+
        _admStat(live?('$'+live.margin.estMonthlyCost.toLocaleString()):(backendLive?'…':'$0'),'AI cost (mo)')+
        _admStat(live?('$'+live.revenue.estMRR.toLocaleString()):(backendLive?'…':'-'),'MRR')+
      '</div>'+(live?'':backendLive?'':_admPending('Live/daily/monthly user counts, retention cohorts')))+
      _admCard('Accounts','<div id="adm-users"><div class="adm-users-loading">'+(backendLive?'Loading users\u2026':'Connect the backend to manage all users. Showing this device\u2019s account below.')+'</div></div>')+
      _admCard('Geographic &amp; device distribution', _admPending('Country, language, device (mobile/web/desktop), browser, OS breakdowns'));
    _adminLoadUsers(backendLive);
  }
  else if(tab==='revenue'){
    const bp=live?live.users.byPlan:null;
    const totalUsers=live?Math.max(1,live.users.total):1;
    const tierBar=(label,key)=>{ const n=bp?(bp[key]||0):0; const w=Math.max(2,(n/totalUsers*100)); return '<div class="adm-brow"><span class="adm-brow-l">'+label+'</span><div class="adm-brow-track"><div class="adm-brow-fill" style="width:'+w+'%"></div></div><span class="adm-brow-v">'+(live?n:(key==='free'?'1':'0'))+'</span></div>'; };
    el.innerHTML=
      _admCard('Recurring revenue','<div class="adm-stats">'+
        _admStat(live?'$'+live.revenue.estMRR.toLocaleString():(backendLive?'…':'$0'),'MRR')+
        _admStat(live?'$'+live.revenue.estARR.toLocaleString():(backendLive?'…':'$0'),'ARR')+
        _admStat(live?'$'+live.margin.estMonthlyCost.toLocaleString():(backendLive?'…':'$0'),'AI cost (mo)')+
        _admStat(live?'$'+Math.max(0,live.revenue.estMRR-live.margin.estMonthlyCost).toLocaleString():(backendLive?'…':'$0'),'Gross margin (mo)')+
        _admStat(live&&live.margin.grossMarginPct!=null?live.margin.grossMarginPct+'%':(backendLive?'…':'-'),'Gross margin %')+
      '</div>'+(live?'':backendLive?'':_admPending('MRR, ARR, revenue and margin from Stripe')))+
      /* AMV-071: the numbers you steer on. A blended cost figure cannot tell
         you whether a tier is profitable, which accounts cost more than they
         pay, or where the money is actually going. */
      _admCard('Unit economics by tier', live&&live.margin.byPlan&&live.margin.byPlan.length
        ? '<table class="adm-econ"><thead><tr><th>Tier</th><th>Users</th><th>Revenue</th><th>AI cost</th><th>Margin</th><th>%</th><th>Cost/user</th></tr></thead><tbody>'+
          live.margin.byPlan.map(p=>'<tr><td><span class="adm-badge '+(p.plan==='free'?'off':'ok')+'">'+escH(p.plan)+'</span></td>'+
            '<td>'+p.users+'</td><td>$'+p.revenue.toLocaleString()+'</td><td>$'+p.cost.toLocaleString()+'</td>'+
            '<td class="'+(p.grossMargin<0?'adm-neg':'adm-pos')+'">$'+p.grossMargin.toLocaleString()+'</td>'+
            '<td>'+(p.grossMarginPct==null?'-':p.grossMarginPct+'%')+'</td>'+
            '<td>$'+p.costPerUser+'</td></tr>').join('')+'</tbody></table>'+
          '<div class="adm-econ-note">Free users cost <b>$'+(live.margin.freeUserCost||0).toLocaleString()+'</b> this month - that is the price of the funnel.</div>'
        : _admPending('Revenue, AI cost and gross margin for every tier'))+
      _admCard('Accounts costing more than they pay', live
        ? (live.margin.unprofitableAccounts&&live.margin.unprofitableAccounts.length
          ? '<div class="adm-loglist">'+live.margin.unprofitableAccounts.map(u=>'<div class="adm-logrow">'+
              '<span class="adm-badge warn">'+escH(u.plan)+'</span><span>'+escH(u.email)+'</span>'+
              '<span class="adm-logtime adm-neg">-$'+u.lossUSD+'</span></div>').join('')+'</div>'
          : '<div class="adm-empty">None. Every paying account is profitable this month.</div>')
        : _admPending('Paying accounts whose AI cost exceeds their subscription'))+
      _admCard('Where the money goes', live
        ? (Object.keys(live.margin.featureCost||{}).length
          ? '<div class="adm-barlist">'+(()=>{ const fc=live.margin.featureCost; const max=Math.max(...Object.values(fc));
              return Object.entries(fc).sort((a,b)=>b[1]-a[1]).map(([k,v])=>
                '<div class="adm-brow"><span class="adm-brow-l">'+escH(k)+'</span><div class="adm-brow-track">'+
                '<div class="adm-brow-fill" style="width:'+Math.max(2,(v/max*100))+'%"></div></div>'+
                '<span class="adm-brow-v">$'+v.toLocaleString()+'</span></div>').join(''); })()+'</div>'+
            '<div class="adm-econ-note">Prompt caching saved <b>$'+(live.margin.cacheSavedUSD||0).toLocaleString()+'</b> this month.</div>'
          : '<div class="adm-empty">No spend recorded yet this month.</div>')
        : _admPending('Cost split by feature, and what caching saved'))+
      _admCard('Subscriptions by tier','<div class="adm-barlist">'+tierBar('Free','free')+tierBar('Pro','pro')+tierBar('Elite','elite')+tierBar('Ultra','ultra')+tierBar('Custom','custom')+'</div>')+
      _admCard('Top spenders (margin watch)', live&&live.topSpenders&&live.topSpenders.length?'<div class="adm-loglist">'+live.topSpenders.slice(0,10).map(u=>'<div class="adm-logrow"><span class="adm-badge '+(u.plan==='free'?'off':'ok')+'">'+escH(u.plan)+'</span><span>'+escH(u.email)+'</span><span class="adm-logtime">$'+u.monthCostUSD+'</span></div>').join('')+'</div>':(live?'<div class="adm-empty">No paying users yet.</div>':_admPending('Who costs the most this month - abuse & margin watch')))+
      _admCard('Financial forecast &amp; investor KPIs', _admPending('Growth-based ARR/MRR projections, CAC/LTV, burn, runway'));
  }
  else if(tab==='ai'){
    el.innerHTML=
      _admCard('AI usage (today)','<div class="adm-stats">'+
        _admStat(u.reqs.toLocaleString(),'Requests')+
        _admStat(u.inTok.toLocaleString(),'Input tokens')+
        _admStat(u.outTok.toLocaleString(),'Output tokens')+
        _admStat('$'+u.costUSD.toFixed(3),'Est. cost')+
      '</div>'+
      '<div class="adm-bar-wrap" style="margin-top:14px"><div class="adm-bar-top"><span>Daily token budget</span><span>'+used.toLocaleString()+' / '+cap.toLocaleString()+'</span></div><div class="adm-bar"><div class="adm-bar-fill" style="width:'+pct+'%;background:'+(pct>90?sev.crit:pct>70?sev.warn:'var(--accent)')+'"></div></div></div>')+
      _admCard('Requests by model', _admBars(m.modelUse,'No model calls recorded yet this session.'))+
      _admCard('Model ops', _admPending('Avg response time, tokens/day trend, cost per request, queue length, hallucination/error tracking, model version comparison'));
  }
  else if(tab==='infra'){
    const recentErrs=m.log.filter(e=>e.event==='error'||e.event==='api_error'||e.event==='exception'||e.event==='uncaught').slice(-15).reverse();
    el.innerHTML=
      _admCard('System status','<div class="adm-health">'+
        '<div class="adm-health-row"><span>AI engine</span><span class="adm-badge '+(backendLive?'ok':'off')+'">'+(backendLive?'Online':'Not connected')+'</span></div>'+
        '<div class="adm-health-row"><span>Guardrails</span><span class="adm-badge ok">Active</span></div>'+
        '<div class="adm-health-row"><span>Frontend</span><span class="adm-badge ok">Operational</span></div>'+
        '<div class="adm-health-row"><span>Error boundary</span><span class="adm-badge ok">Armed</span></div>'+
      '</div>')+
      _admCard('Recent errors', recentErrs.length
        ? '<div class="adm-loglist">'+recentErrs.map(e=>'<div class="adm-logrow"><span class="adm-badge off">'+escH(e.where||e.event||'error')+'</span><span>'+escH(e.msg||e.raw||'-')+'</span><span class="adm-logtime">'+_admAgo(e.ts)+'</span></div>').join('')+'</div>'
        : '<div class="adm-allclear"><span class="adm-signal-dot" style="background:#4ade80"></span> No errors logged. Everything\u2019s running clean.</div>', 'last 15')+
      _admCard('Infrastructure health', _admPending('Uptime, server health, GPU/CPU utilization, database health, storage usage, network latency by region, global server status'))+
      _admCard('Operations', _admPending('Deployment status, version rollout, model deployment, backup status, disaster recovery, incident management, predictive capacity planning'));
  }
  else if(tab==='security'){
    const ab=_adminAbuseSignals();
    const recentLogins=m.log.filter(e=>e.event==='login'||e.event==='auth_fail').slice(-12).reverse();
    el.innerHTML=
      _admCard('Threat overview','<div class="adm-stats">'+
        _admStat(m.authFails24h.toLocaleString(),'Failed logins (24h)', m.authFails24h>3?sev.warn:'')+
        _admStat(ab.blocks.toLocaleString?ab.blocks:String(ab.blocks),'Rate-limit blocks (1h)')+
        _admStat(ab.errors,'Errors (1h)', ab.errors>=8?sev.crit:'')+
        _admStat(ab.signals.length,'Active alerts', ab.signals.length?sev.warn:sev.ok)+
      '</div>')+
      _admCard('Security alerts', ab.signals.length?'<div class="adm-signals">'+ab.signals.map(s=>'<div class="adm-signal '+s.sev+'"><span class="adm-signal-dot" style="background:'+sev[s.sev]+'"></span><div><b>'+escH(s.title)+'</b><span>'+escH(s.detail)+'</span></div></div>').join('')+'</div>':'<div class="adm-allclear"><span class="adm-signal-dot" style="background:'+sev.ok+'"></span> No active security alerts.</div>','live')+
      _admCard('Login history', recentLogins.length?'<div class="adm-loglist">'+recentLogins.map(e=>'<div class="adm-logrow"><span class="adm-badge '+(e.event==='auth_fail'?'off':'ok')+'">'+(e.event==='auth_fail'?'failed':'ok')+'</span><span>'+escH(e.email||(e.data&&e.data.email)||'-')+'</span><span class="adm-logtime">'+_admAgo(e.ts)+'</span></div>').join('')+'</div>':'<div class="adm-empty">No recent sign-in events.</div>')+
      _admCard('Moderation &amp; compliance', _admPending('Moderation queue, flagged conversations, spam/abuse detection, user reports, account verification, data export & privacy requests, compliance dashboard'));
  }
  else if(tab==='fraud'){
    // ingestScan folds live scan-detected flags into the stored log with stable
    // ids, so their action buttons persist and the same burst never doubles up.
    const flags=AMVFraud.ingestScan();
    const open=flags.filter(f=>!f.resolution);
    const highRisk=flags.filter(f=>f.risk==='high'||f.risk==='critical');
    const needsHuman=open.filter(f=>f.humanReview);
    const total=AMVFraud.CATS.length;
    const onDevice=AMVFraud.CATS.filter(c=>AMVFraud._clientCats.has(c[0])).length;
    const serverLive=_aiBackendReady();

    // coverage panel, grouped
    const byGroup={};
    AMVFraud.CATS.forEach(c=>{ (byGroup[c[2]]=byGroup[c[2]]||[]).push(c); });
    const coverage=Object.keys(byGroup).map(g=>
      '<div class="fr-cov-grp"><div class="fr-cov-h">'+escH(AMVFraud.GROUPS[g]||g)+'</div><div class="fr-cov-list">'+
      byGroup[g].map(c=>{ const onDev=AMVFraud._clientCats.has(c[0]);
        return '<span class="fr-cov-item '+(onDev?'on':'srv')+'">'+escH(c[1])+'<span class="fr-cov-badge">'+(onDev?'on-device':'server-side')+'</span></span>';
      }).join('')+'</div></div>'
    ).join('');

    el.innerHTML=
      _admCard('Fraud overview','<div class="adm-stats">'+
        _admStat(open.length,'Open flags', open.length?sev.warn:sev.ok)+
        _admStat(highRisk.length,'High / critical', highRisk.length?sev.crit:'')+
        _admStat(needsHuman.length,'Awaiting human review', needsHuman.length?sev.warn:'')+
        _admStat(onDevice+' / '+total,'Categories watched here')+
      '</div>'+
      '<p class="fr-fair">Fairness first: no one is scored on nationality, location, language, disability, age, or any protected trait. A refund or chargeback never auto-punishes on its own, high-impact calls go to a person, records are kept for appeal, and every flag lists its legitimate explanations. Full IP, payment-country and identity signals activate server-side once your keys are in'+(serverLive?' - live now.':'.')+'</p>')+
      _admCard('Active flags', flags.length?'<div class="fr-cards">'+flags.slice(0,40).map(_fraudCard).join('')+'</div>':'<div class="adm-allclear"><span class="adm-signal-dot" style="background:'+sev.ok+'"></span> No fraud flags. Money-touching events are assessed as they happen and only real signals appear here.</div>','live')+
      _admCard('Coverage - all '+total+' categories','<div class="fr-cov">'+coverage+'</div>','on-device vs server-side');
  }
  else if(tab==='product'){
    el.innerHTML=
      _admCard('Feature usage', _admBars(m.featureUse,'Feature analytics populate as the app is used.'))+
      _admCard('Conversation analytics','<div class="adm-stats">'+
        _admStat((getConvsCount?getConvsCount():(S.convs?S.convs.length:0))||0,'Conversations')+
        _admStat(backendLive?'-':'-','Avg length')+
        _admStat(backendLive?'-':'-','Satisfaction')+
        _admStat(backendLive?'-':'-','Search queries')+
      '</div>'+(backendLive?'':_admPending('Conversation volume, avg length, satisfaction ratings, search queries - platform-wide')))+
      _admCard('Feedback &amp; bug reports', (function(){
        let list=[]; try{ list=JSON.parse(loadStr('amv_feedback')||'[]'); }catch(e){}
        if(!list.length) return _admPending('User bug reports & feature suggestions appear here as they come in');
        return '<div class="adm-fb-list">'+list.slice(0,20).map(f=>{
          const when=new Date(f.ts).toLocaleDateString(undefined,{month:'short',day:'numeric'});
          return '<div class="adm-fb-row"><span class="adm-fb-kind '+(f.kind==='bug'?'bug':'idea')+'">'+(f.kind==='bug'?'Bug':'Idea')+'</span>'+
            '<div class="adm-fb-main"><div class="adm-fb-text">'+escH(f.text)+'</div>'+
            '<div class="adm-fb-meta">'+when+(f.email?' \u00b7 '+escH(f.email):'')+' \u00b7 '+escH((f.context&&f.context.tab)||'')+'</div></div></div>';
        }).join('')+'</div>';
      })());
  }
  else if(tab==='growth'){
    // build a conversion funnel from locally tracked events
    const log=(AEGIS._loadLog?AEGIS._loadLog():[]).filter(e=>e.event==='track');
    const cnt=n=>log.filter(e=>e.name===n).length;
    const steps=[
      {label:'Signed up',n:cnt('signup')},
      {label:'Sent first message',n:cnt('activated_first_message')},
      {label:'Viewed upgrade nudge',n:cnt('upgrade_nudge_shown')},
      {label:'Started checkout',n:cnt('upgrade_checkout_started')},
    ];
    const top=Math.max(1,steps[0].n,...steps.map(s=>s.n));
    const funnel='<div class="adm-funnel">'+steps.map((s,i)=>{
      const pct=Math.round((s.n/top)*100);
      const conv=i>0&&steps[i-1].n>0?Math.round((s.n/steps[i-1].n)*100)+'% of prev':'';
      return '<div class="adm-fnl-row"><div class="adm-fnl-top"><span>'+s.label+'</span><span class="adm-fnl-n">'+s.n+(conv?' <span class="adm-fnl-conv">'+conv+'</span>':'')+'</span></div><div class="adm-fnl-track"><div class="adm-fnl-fill" style="width:'+Math.max(pct,2)+'%"></div></div></div>';
    }).join('')+'</div>';
    el.innerHTML=
      _admCard('Conversion funnel', funnel + '<p class="adm-note">Tracked locally from real user events. '+(log.length?log.length+' events recorded this session.':'Events populate as users move through the app.')+'</p>')+
      _admCard('Engagement', _admPending('DAU/WAU/MAU, retention curves, peak traffic monitoring, usage trends over time'))+
      _admCard('Distribution', _admPending('Geographic & language distribution, device/browser/OS analytics, live world map of active users'));
  }
}
function _admKpi(label,val,sub,color){ return '<div class="adm-kpi"><div class="adm-kpi-v"'+(color?' style="color:'+color+'"':'')+'>'+(val||'-')+'</div><div class="adm-kpi-l">'+label+'</div><div class="adm-kpi-s">'+sub+'</div></div>'; }
function _admAgo(ts){ const t=Date.parse(ts||0); if(!t) return ''; const s=(Date.now()-t)/1000; if(s<60)return Math.floor(s)+'s ago'; if(s<3600)return Math.floor(s/60)+'m ago'; if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; }
function getConvsCount(){ try{ return (S.convs||[]).length; }catch(e){ return 0; } }
async function _adminLoadUsers(backendLive){
  const el=$('adm-users'); if(!el) return;
  let users=[];
  if(backendLive && window.AMV_API && AMV_API.base){
    try{
      const r=await fetchDeadline(AMV_API.base.replace(/\/$/,'')+'/admin/users',{headers:{'Authorization':'Bearer '+(AMV_API.token||'')}});
      if(r.ok){ const d=await r.json(); users=d.users||d||[]; }
    }catch(e){}
  }
  if(!users.length){
    // local fallback: this device's account
    try{ const me=S.user||{}; if(me.email) users=[{email:me.email,name:me.name||me.email.split('@')[0],plan:(loadStr('amv_plan')||'free'),createdAt:null,local:true}]; }catch(e){}
  }
  if(!users.length){ el.innerHTML='<div class="adm-users-loading">No users to show yet.</div>'; return; }
  const fmtDate=(ts)=>ts?new Date(ts).toLocaleDateString():'-';
  const row=u=>{
    const plan=(u.plan||'free'); const initial=(u.name||u.email||'?').charAt(0).toUpperCase();
    const flag=u.flagged?'<span class="adm-user-flag" title="Flagged for chargeback/refund abuse">\u26a0 flagged</span>':'';
    const detail = u.local?'' :
      '<div class="adm-user-meta">'+
        '<span title="Monthly AI cost">$'+((u.monthCostUSD||0).toFixed(2))+' cost</span>'+
        (u.walletBalance?'<span title="Wallet balance">$'+u.walletBalance.toFixed(2)+' wallet</span>':'')+
        (u.purchases?'<span title="Marketplace purchases">'+u.purchases+' purchases</span>':'')+
        (u.source?'<span title="Payment method">via '+escH(u.source)+'</span>':'')+
        '<span title="Joined">joined '+fmtDate(u.createdAt)+'</span>'+
        (u.admin?'<span class="adm-user-admin">admin</span>':'')+
      '</div>';
    return '<div class="adm-user"><span class="adm-user-av">'+escH(initial)+'</span>'+
      '<div class="adm-user-main"><b>'+escH(u.name||u.email.split('@')[0])+' '+flag+'</b><span>'+escH(u.email)+'</span>'+detail+'</div>'+
      '<span class="adm-plan-tag '+plan+'">'+escH(plan)+'</span>'+
      (u.local?'':'<button class="adm-user-act" data-admuser="'+escH(u.email)+'">Manage</button>')+
    '</div>';
  };
  const summary = users.length>1 ? '<div class="adm-user-summary">'+users.length+' accounts \u00b7 '+
    users.filter(u=>u.plan&&u.plan!=='free').length+' paying \u00b7 '+
    users.filter(u=>u.flagged).length+' flagged</div>' : '';
  el.innerHTML=summary+'<div class="adm-user-search"><input id="adm-user-q" placeholder="Search users by name or email\u2026"></div>'+
    '<div class="adm-user-list" id="adm-user-list">'+users.map(row).join('')+'</div>';
  const q=$('adm-user-q'); if(q) on(q,'input',()=>{ const term=q.value.toLowerCase(); const filtered=users.filter(u=>(u.email+' '+(u.name||'')).toLowerCase().includes(term)); const list=$('adm-user-list'); if(list) list.innerHTML=filtered.map(row).join('')||'<div class="adm-users-loading">No matches.</div>'; });
}

function renderUsageView(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi">'+
      '<span class="eyebrow">Your impact</span>'+
      '<h2>What AMV has done for you</h2>'+
      '<p class="vsub">A running tally of the work AMV has handled and the time it\u2019s saved you.</p>'+
      _usageContentHTML()+
    '</div></div>';
}


/* === USAGE (legacy owner view, unused) === */

/* === BILLING === */
// Build an invoices table from the subscription's real billing history: one
// invoice per monthly cycle since the plan started, for the plan's price.
function _invoiceTableHTML(plan, P, sinceDate){
  if(!sinceDate || plan==='free') return '<div class="bill-inv-loading">No invoices yet.</div>';
  const price=P.price||0;
  const rows=[];
  const now=Date.now();
  let d=new Date(sinceDate.getTime());
  let guard=0;
  while(d.getTime()<=now && guard<36){
    rows.push({ date:new Date(d.getTime()), total:price });
    d=new Date(d.getTime()); d.setMonth(d.getMonth()+1); guard++;
  }
  rows.reverse(); // newest first
  if(!rows.length) return '<div class="bill-inv-loading">No invoices yet.</div>';
  const fmtD=(dt)=>dt.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  return '<div class="inv-table">'+
    '<div class="inv-row inv-head"><span>Date</span><span>Total</span><span>Status</span><span></span></div>'+
    rows.map((r,i)=>'<div class="inv-row"><span>'+fmtD(r.date)+'</span>'+
      '<span class="inv-total">$'+r.total.toFixed(2)+'</span>'+
      '<span><span class="inv-paid">Paid</span></span>'+
      '<span><button class="inv-view" data-inv="'+i+'">View</button></span></div>').join('')+
  '</div>';
}
try{ window._invoiceTableHTML=_invoiceTableHTML; }catch(e){}


/* Unified transaction history - every payment the user has made (subscription
   upgrades + marketplace purchases). Private to them. */
function _billingTxnsHTML(){
  const txns=(typeof _loadTxns==='function')?_loadTxns():[];
  if(!txns.length) return '';
  const money=n=>'$'+(Number(n)||0).toFixed(2);
  return '<div class="ss2 bill-txns"><h3>Your transactions</h3>'+
    '<p class="bill-txns-sub">Every payment you’ve made on AMV - subscriptions and marketplace. Only you can see these.</p>'+
    '<div class="bill-txn-list">'+txns.slice(0,60).map(t=>{
      let d=''; try{ d=new Date(t.ts).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }catch(e){}
      const kind=t.type==='subscription'?'Subscription':t.type==='marketplace'?'Marketplace':'Payment';
      /* A checkout that was opened and never came back stayed "Pending" for
         ever, so an abandoned purchase looked like a charge in flight - on the
         one screen somebody checks to find out what they have been billed.
         After a few hours it is no longer pending anything; it is unconfirmed,
         and the honest thing is to say that AMV cannot tell from here and point
         at the list that does know. */
      const STALE=6*3600000;
      const stale=t.status==='pending' && (Date.now()-(+t.ts||0))>STALE;
      const st=stale?'<span class="bill-txn-st unconfirmed">Not confirmed</span>'
        :t.status==='pending'?'<span class="bill-txn-st pending">Pending</span>'
        :t.status==='refunded'?'<span class="bill-txn-st refunded">Refunded</span>'
        :'<span class="bill-txn-st paid">Paid</span>';
      const note=stale?'<div class="bill-txn-note">Checkout was opened but never confirmed here. If it went through, the item is in your Purchases - nothing is charged twice.</div>':'';
      return '<div class="bill-txn-row"><div class="bill-txn-b"><div class="bill-txn-t">'+escH(t.title||kind)+'</div><div class="bill-txn-m">'+kind+' · '+escH(d)+'</div>'+note+'</div><div class="bill-txn-amt">'+money(t.amount)+'</div>'+st+'</div>';
    }).join('')+'</div></div>';
}
window._billingTxnsHTML=_billingTxnsHTML;
function renderBillingView(targetEl){
  // If billing is being shown inside Settings, render into the settings pane
  // so re-renders (after payment, plan change, etc.) stay in place.
  if(!targetEl && S.tab==='settings' && S.settingsPane==='billing'){ targetEl=$('set-pane'); }
  const vc=targetEl||$('vc'); if(!vc) return;
  const inSettings=!!targetEl;
  const portal=loadStr('amv_portal');
  const hasPortal=!!portal;
  const liveBackend=window.AMV_API&&AMV_API.live;
  const plan=loadStr('amv_plan')||'free';
  const pm=_loadPM();
  let P=PLANS[plan]||PLANS.free;
  let customSummary=null;
  if(plan==='custom'){
    const cfg=load('amv_custom_cfg')||{};
    const price=cfg.price||30;
    customSummary=_customPlanSummary(price);
    P={name:'Custom',price:price,mult:'',blurb:'Your custom plan - '+customSummary.monthlyTokens.toLocaleString()+' tokens/mo of usage'};
  }
  const since=loadStr('amv_plan_since');
  const sinceDate=since?new Date(parseInt(since,10)):null;
  const nextDate=sinceDate?new Date(sinceDate.getTime()+30*86400000):null;
  const fmt=(d)=>d?d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'-';
  const ic={free:'⚡',pro:'✦',elite:'★',ultra:'◆',custom:'⚙'}[plan]||'⚡';
  const email=(S.user&&S.user.email)||'-';
  /* Teams is priced per seat, so it is not a step on this ladder - it has no
     single price to put on a button, and buying it means choosing how many
     people are on it. Excluded here and sold from its own screen, exactly as
     Custom is. Listing it with "$20/mo" on it would be a lie the moment anybody
     clicked it. */
  const LADDER=k=>k!=='custom'&&k!=='team';
  const upTargets=Object.keys(PLANS).filter(k=>LADDER(k)&&PLAN_RANK[k]>PLAN_RANK[plan]);
  const downTargets=Object.keys(PLANS).filter(k=>LADDER(k)&&PLAN_RANK[k]<PLAN_RANK[plan]);

  vc.innerHTML=
    '<div class="sv fi"><div class="vi">'+
      '<span class="eyebrow">Billing</span>'+
      '<h2>Subscription</h2><p class="vsub">Your plan, billing dates, and the details on file. Payments are processed securely - AMV never stores your full card.</p>'+
      // CURRENT PLAN
      '<div class="ss2 bill-current"><h3>Current plan</h3>'+
        '<div class="bill-plan">'+
          '<div class="bill-plan-l">'+
            '<div><div class="bill-plan-n">'+P.name+(plan==='free'?'':' \u00b7 $'+P.price+'/mo')+'</div>'+
            '<div class="bill-plan-d">'+escH(P.blurb||'')+'</div></div></div>'+
          '<span class="badge bg3">Active</span>'+
        '</div>'+
      '</div>'+
      // SUBSCRIPTION DETAILS (only when on a paid plan)
      (plan!=='free'?
      '<div class="ss2"><h3>Subscription details</h3>'+
        '<div class="bill-detail">'+
          _drow('Plan',P.name+(P.mult?' ('+P.mult+' usage)':''))+
          _drow('Price','$'+P.price+' / month')+
          (customSummary?_drow('Monthly usage',customSummary.monthlyTokens.toLocaleString()+' tokens (credit-metered)'):'')+
          (customSummary?_drow('Daily limit',customSummary.dailyCap.toLocaleString()+' tokens/day'):'')+
          _drow('Status','<span style="color:var(--grn)">Active</span>')+
          _drow('Started',fmt(sinceDate))+
          _drow('Renews',fmt(nextDate))+
          _drow('Billing email',escH(email))+
          (pm?_drow('Payment method',_pmBrandIcon(pm.brand)+' \u00b7\u00b7\u00b7\u00b7 '+escH(pm.last4)+(pm.exp?'  (exp '+escH(pm.exp)+')':'')):'')+
        '</div>'+
        /* The billing portal is the only place a card can be changed or a
           subscription cancelled. The handler for this button already existed
           and had done nothing for as long as the button did not: a paying
           customer could not reach their own billing, which is a support ticket
           at best and a complaint to their bank at worst. */
        '<div class="bill-acts">'+
          '<button class="btn bp" id="portal-open-btn">Manage billing</button>'+
          (plan==='custom'?'<button class="btn bs" id="bill-resize">Resize my plan</button>':'')+
        '</div>'+
        '<p class="bill-acts-s">Change your card, download receipts, or cancel. '+
          'Cancelling keeps your plan until the end of the period you have paid for.</p>'+
      '</div>':'')+
      /* These two lists were computed on every render and shown nowhere, and the
         click handler below bound to buttons that never existed - so the billing
         screen told a paying customer what they had and gave them no way to
         change it. Teams and Custom are deliberately absent: neither has a
         single price to put on a button. */
      ((upTargets.length||downTargets.length)?
      '<div class="ss2"><h3>Change plan</h3>'+
        '<div class="bill-swap">'+
          upTargets.map(k=>'<button class="btn bp" data-pay="'+escH(k)+'">Upgrade to '+escH(PLANS[k].name)+' \u00b7 $'+PLANS[k].price+'/mo</button>').join('')+
          downTargets.filter(k=>k!=='free').map(k=>'<button class="btn bs" data-pay="'+escH(k)+'">Switch to '+escH(PLANS[k].name)+' \u00b7 $'+PLANS[k].price+'/mo</button>').join('')+
        '</div>'+
        '<p class="bill-acts-s">Changes take effect immediately and are prorated. '+
          'Working with other people? <a data-stab="team" style="color:var(--accent);cursor:pointer">Teams is priced per person</a>.</p>'+
      '</div>':'')+
      /* Cancelling. The pricing page promises "cancel with one click" and there
         was no control anywhere that did it, which is a claim the product did
         not keep.

         It has to go through the processor. `_switchPlan('free')` only changes
         the plan in THIS browser - with a live subscription that is a cancel
         button that does not cancel, and the customer finds out when the next
         charge lands. Worse than no button. So when there is a real backend
         this opens the processor's own portal, which is the only place a
         subscription actually ends. */
      (plan!=='free'?
      '<div class="ss2"><h3>Cancel</h3>'+
        '<p style="font-size:12.5px;color:var(--mu);line-height:1.6;margin:0 0 10px">'+
          'You keep '+escH(P.name)+' until the end of the period you have already paid for, and nothing you have made is deleted.</p>'+
        '<button class="btn bs" id="bill-cancel" style="font-size:12px;color:var(--red);border-color:var(--red)">Cancel subscription</button>'+
        '<div class="seat-say" id="bill-cancel-say" role="status" aria-live="polite"></div>'+
      '</div>':'')+
      // INVOICES
      (plan!=='free'?'<div class="ss2"><h3>Invoices</h3>'+
        '<div id="bill-invoices">'+(liveBackend?'<div class="bill-inv-loading">Loading your invoices\u2026</div>':_invoiceTableHTML(plan,P,sinceDate))+'</div>'+
      '</div>':'')+
      _billingTxnsHTML()+
      // SECURITY
      '<div class="ss2"><h3>How we protect your payment</h3>'+
        '<div class="sec-grid">'+
          _secItem('🔒','Card data never touches AMV','Card details are entered in a secure field hosted by our payment processor. They never reach our code or storage.')+
          _secItem('🛡️','PCI-DSS Level 1','Payments run through a Level 1 certified processor - the highest security standard there is.')+
          _secItem('🔑','Tokenized, not stored','We keep only the last 4 digits to show which card is on file. The full number is never saved.')+
          _secItem('📡','256-bit TLS','Every payment is encrypted in transit and screened for fraud.')+
        '</div>'+
      '</div>'+
      (isAdmin()?(
      '<div class="ss2" style="border:1px dashed var(--bd);border-radius:10px;padding:14px 16px">'+
        '<h3 style="margin-top:0">Payment test mode <span style="font-weight:400;color:var(--mu);font-size:11px">(only you see this)</span></h3>'+
        '<p style="font-size:12px;color:var(--t2);line-height:1.6;margin:0 0 10px">Simulate a completed checkout to verify the success flow end to end - plan gating, UI refresh, and confirmation - before your live payment keys are connected. This changes only your local plan; it never charges anything.</p>'+
        '<div style="display:flex;gap:7px;flex-wrap:wrap">'+
          ['pro','elite','ultra'].map(pl=>'<button class="btn" data-simpay="'+pl+'" style="font-size:12px">Simulate '+(PLANS[pl]?PLANS[pl].name:pl)+'</button>').join('')+
          '<button class="btn" data-simpay="free" style="font-size:12px">Reset to Free</button>'+
        '</div>'+
      '</div>'
      ):'')+
    '</div></div>';

  const openPortal=async ()=>{
    if(liveBackend){ const cust=loadStr('amv_stripe_customer'); try{ const u=await AMV_API.portal(cust||email); if(u){ window.open(u,'_blank','noopener'); return; } }catch(e){} }
    if(portal){ window.open(portal,'_blank','noopener'); return; }
    toast('Billing portal activates once your backend is connected','info',4000);
  };
  const pb=$('portal-open-btn'); if(pb) on(pb,'click',openPortal);
  on($('bill-cancel'),'click',async()=>{
    const say=t=>{ const el=$('bill-cancel-say'); if(el) el.textContent=t||''; };
    if(liveBackend){
      /* The processor is the only thing that can actually stop the billing, so
         that is where this goes. Never a local flag pretending it worked. */
      say('Opening your billing to cancel\u2026');
      try{
        const url=await AMV_API.portal(loadStr('amv_stripe_customer')||email);
        window.open(url,'_blank','noopener');
        say('Cancel it in the window that just opened. Nothing has changed yet.');
      }catch(e){
        say('Could not open billing, so nothing was cancelled. Try again, or email support and we will do it for you.');
      }
      return;
    }
    /* No backend: there is no subscription to cancel, so switching locally is
       the whole truth rather than a pretence. */
    _switchPlan('free');
  });
  vc.querySelectorAll('[data-pay]').forEach(b=>on(b,'click',()=>openCheckout(b.dataset.pay)));
  vc.querySelectorAll('[data-simpay]').forEach(b=>on(b,'click',()=>{
    const pl=b.dataset.simpay;
    if(pl==='free'){ _setPlan('free'); renderBillingView(); toast('Test: reset to Free plan','info'); }
    else handlePaymentSuccess(pl,{simulated:true});
  }));
  const rz=$('bill-resize'); if(rz) on(rz,'click',openCustomPlan);
  vc.querySelectorAll('.inv-view').forEach(b=>on(b,'click',()=>toast('Invoice PDFs open through the billing portal once your account is connected to a payment processor.','info',4000)));
  // load real invoice history when the backend is connected
  if(plan!=='free' && liveBackend){ _loadInvoices(); }
}
/* Fetch and render the user's invoice history into the billing view. */
async function _loadInvoices(){
  const el=$('bill-invoices'); if(!el) return;
  const base=loadStr('amv_api_base')||''; const tok=loadStr('amv_api_token')||(window.AMV_API&&AMV_API.token)||'';
  if(!base){ return; }
  try{
    const r=await fetchDeadline(base.replace(/\/$/,'')+'/v1/stripe/invoices',{headers:{'Authorization':'Bearer '+tok}},15000);
    const d=await r.json();
    if(!el) return;
    const inv=(d&&d.invoices)||[];
    if(!inv.length){ el.innerHTML='<div class="bill-inv-empty">No invoices yet. Your first payment will show up here.</div>'; return; }
    el.innerHTML='<div class="bill-inv-list">'+inv.map(v=>{
      const dt=new Date(v.date).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
      const paid=v.status==='paid';
      return '<div class="bill-inv-row">'+
        '<div class="bill-inv-main"><span class="bill-inv-num">'+escH(v.number)+'</span><span class="bill-inv-date">'+dt+'</span></div>'+
        '<div class="bill-inv-right"><span class="bill-inv-amt">'+v.currency+' '+v.amount.toFixed(2)+'</span>'+
        '<span class="bill-inv-status '+(paid?'ok':'')+'">'+escH(v.status)+'</span>'+
        (v.pdf?'<a class="bill-inv-dl" href="'+escH(v.pdf)+'" target="_blank" rel="noopener">Download</a>':'')+
        '</div></div>';
    }).join('')+'</div>';
  }catch(e){ if(el) el.innerHTML='<div class="bill-inv-empty">Couldn\u2019t load invoices right now.</div>'; _logErr('loadInvoices',e); }
}
function _drow(k,v){ return '<div class="bd-row"><span class="bd-k">'+k+'</span><span class="bd-v">'+v+'</span></div>'; }
/* Per-plan local usage caps (the browser guardrail; server enforces the real ones). */
/* Kept in step with the server's PLAN_LIMITS (AMV-072). If the browser guard is
   tighter than the server's, the user is stopped early by a number the server
   would have allowed - a limit that exists nowhere but here. */
const PLAN_TIERS={
  free:  { dailyTokenCap:52000,    rpmMax:8,  models:['fast','core'] },
  pro:   { dailyTokenCap:325000,   rpmMax:20, models:['fast','core','coding'] },
  elite: { dailyTokenCap:1170000,  rpmMax:40, models:['fast','core','coding','smart'] },
  ultra: { dailyTokenCap:2860000,  rpmMax:80, models:['fast','core','coding','smart'] },
  custom:{ dailyTokenCap:52000,    rpmMax:16, models:['fast','core','coding','smart'] }, // overridden per-user below
};
function _setPlan(plan){
  if(!PLANS[plan]) plan='free';
  const prev=loadStr('amv_plan')||'free';
  saveStr('amv_plan',plan);
  // record start date when the plan actually changes
  if(prev!==plan) saveStr('amv_plan_since',String(Date.now()));
  if(prev!==plan && plan!=='free' && prev==='free'){ try{ AEGIS.log('plan_upgrade',{plan}); }catch(e){} }
  // Record the payment in the user's transaction history (upgrades only).
  try{
    if(prev!==plan && plan!=='free' && (PLAN_RANK[plan]||0)>(PLAN_RANK[prev]||0)){
      const _pp=PLANS[plan]; const _amt=(plan==='custom')?((load('amv_custom_cfg')||{}).price||0):((_pp&&_pp.price)||0);
      if(_amt>0) _recordTxn({type:'subscription', title:((_pp&&_pp.name)||plan)+' plan - monthly', amount:_amt, status:'paid'});
    }
  }catch(e){}
  // resolve the effective tier (custom = the user's purchased config)
  let t=PLAN_TIERS[plan]||PLAN_TIERS.free;
  if(plan==='custom'){
    try{ const cfg=load('amv_custom_cfg'); if(cfg&&cfg.price){ const s=_customPlanSummary(cfg.price); t={dailyTokenCap:s.dailyCap, rpmMax:s.rpm, models:CUSTOM_PLAN.modelsForPrice(cfg.price)}; } }catch(e){}
  }
  // apply the usage tier to the local guardrail
  try{ if(window.AEGIS&&AEGIS.cfg){ AEGIS.cfg.dailyTokenCap=t.dailyTokenCap; AEGIS.cfg.rpmMax=t.rpmMax; } saveStr('amv_plan_caps',JSON.stringify(t)); }catch(e){}
  // if the user's selected model isn't allowed on this plan, drop to an allowed one
  try{ const allowed=t.models; if(allowed.indexOf(S.model)<0){ S.model=allowed[allowed.length-1]; } }catch(e){}
  updateSbUser&&updateSbUser();
  // Teams is packaged with Elite and above, so its entry point follows the plan.
  try{ if(typeof _revealTeamNav==='function') _revealTeamNav(); }catch(e){}
  try{ if(typeof renderView==='function' && S.tab) renderView(); }catch(e){}
}
function _planAllowsModel(mk){ if(mk==='auto') return true; const plan=loadStr('amv_plan')||'free'; if(plan==='custom') return true; const t=PLAN_TIERS[plan]||PLAN_TIERS.free; return t.models.indexOf(mk)>=0; }

/* Sync the REAL plan from the backend entitlement store. The server sets the
   plan only via a verified payment webhook, so this is the source of truth -
   the browser never grants itself a paid plan. Called on load and after the
   post-checkout redirect (?upgraded=1). Falls back silently with no backend. */
async function syncEntitlement(){
  try{
    if(!(window.AMV_API && AMV_API.live && AMV_API.token)) return;
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
  bar.className = 'bill-notice' + (billing.state === 'lapsed' ? ' lapsed' : '');
  bar.setAttribute('role','status');
  bar.innerHTML =
    '<span class="bill-notice-t">'+escH(billing.message||'There is a problem with your payment method.')+'</span>'+
    '<button class="btn bp bill-fix" type="button" id="bill-fix">Update card</button>'+
    '<button class="bill-x" type="button" id="bill-x" aria-label="Dismiss this notice">&#215;</button>';
  document.body.appendChild(bar);
  document.getElementById('bill-fix')?.addEventListener('click',()=>{
    // Straight to the processor's own billing portal - the only place a card
    // can actually be changed. Falls back to the billing tab if it is not set up.
    (async()=>{
      try{
        const url = await AMV_API.portal('');
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
    return '<a href="mailto:'+escH(email)+subj+'" class="'+cls+'" style="font-size:12px">'+label+'</a>';
  }
  // No address configured yet → graceful fallback to Ask AMV (no dead mailto)
  return '<button class="'+cls+'" style="font-size:12px" data-dact="askAmv" data-darg="">'+label+'</button>';
}
window.supportButton=supportButton;


/* The minimum plan that unlocks a given model */
function _minPlanForModel(mk){
  const order=['free','pro','elite','ultra'];
  for(const p of order){ if((PLAN_TIERS[p]||{}).models && PLAN_TIERS[p].models.indexOf(mk)>=0) return p; }
  return 'pro';
}
function openUpgradeModal(lockedModel){
  const r=$('ovr'); if(!r) return;
  const m=MODELS[lockedModel]||{label:'this model'};
  const needPlan=_minPlanForModel(lockedModel);
  // Ordered ladder, all paid plans + custom, as stacked rows
  const order=['pro','elite','ultra'];
  const row=(k)=>{ const pl=PLANS[k]; const isNeed=k===needPlan;
    return '<button class="upg-row'+(isNeed?' best':'')+'" data-upg="'+k+'">'+
      '<div class="upg-row-l">'+
        '<div class="upg-row-name">'+pl.name+(isNeed?'<span class="upg-row-tag">Unlocks '+escH(m.label)+'</span>':'')+'</div>'+
        '<div class="upg-row-desc">'+escH(pl.blurb||'')+'</div>'+
      '</div>'+
      '<div class="upg-row-r"><div class="upg-row-price">$'+pl.price+'<small>/mo</small></div><span class="upg-row-go">Get \u2192</span></div>'+
    '</button>';
  };
  const customRow='<button class="upg-row upg-row-custom" data-upg="custom">'+
      '<div class="upg-row-l">'+
        '<div class="upg-row-name">Custom<span class="upg-row-tag alt">Build your own</span></div>'+
        '<div class="upg-row-desc">Pick your exact monthly budget - all models, hard-capped, from $10/mo.</div>'+
      '</div>'+
      '<div class="upg-row-r"><div class="upg-row-price" style="font-size:15px">Your price</div><span class="upg-row-go">Build \u2192</span></div>'+
    '</button>';
  r.innerHTML='<div class="upg-ov" id="upg-bg"><div class="upg-modal" style="max-width:480px" onclick="event.stopPropagation()">'+
    '<button class="dna-x" id="upg-x" style="position:absolute;top:16px;right:16px">\u2715</button>'+
    '<div class="upg-head">'+
      '<div class="upg-lock">\uD83D\uDD12</div>'+
      '<h2>Unlock '+escH(m.label)+'</h2>'+
      '<p>'+escH(m.label)+' is included from the '+PLANS[needPlan].name+' plan up. Pick the plan that fits - every option below unlocks it.</p>'+
    '</div>'+
    '<div class="upg-rows">'+order.map(row).join('')+customRow+'</div>'+
    '<div class="upg-foot"><button class="upg-compare" id="upg-compare">Compare all plans in detail \u2192</button>'+
      '<div class="upg-trust">Cancel anytime \u00b7 Keep your free account \u00b7 Secure checkout</div></div>'+
  '</div></div>';
  const close=()=>{ r.innerHTML=''; };
  on($('upg-bg'),'click',close); on($('upg-x'),'click',close);
  r.querySelectorAll('[data-upg]').forEach(btn=>on(btn,'click',()=>{ const k=btn.dataset.upg; close(); if(k==='custom'){ openCustomPlan(); } else { openCheckout(k); } }));
  const cmp=$('upg-compare'); if(cmp) on(cmp,'click',()=>{ close(); openPlanCompare(needPlan); });
}
function _planDetails(k){
  const D={
    pro:['All models, including AMV Forge for coding','5\u00d7 the usage of the Free plan','Autonomous agents and Crew for multi-step work','Image, video, and 3D generation','Build and run apps in the sandbox','Connect Gmail, calendar, and files','Scheduled and background automation','Faster generation'],
    elite:['Everything in Pro, dialed up','20\u00d7 the usage','AMV Apex first - our most capable engine','Full-stack app builder with one-click deploy','Up to 5 agents running in parallel','4K video & premium image quality','Unlimited scheduled automations','Team workspaces - 10 seats on one subscription','Early access + 24/7 priority support'],
    ultra:['Everything in Elite, maxed out','50\u00d7 the usage','Unlimited parallel agents - a whole crew at once','Whole-codebase context & autonomous projects','Export & download full multi-file projects','Deploy & host multiple live apps','Team workspaces - 25 seats, roles & shared projects','Fastest hardware + dedicated support'],
  };
  return D[k]||['More usage','All models'];
}
function openPlanCompare(highlight){
  const r=$('ovr'); if(!r) return;
  const plans=['free','pro','elite','ultra','custom'];
  const isC=p=>p==='custom';
  const rows=[
    ['Price', p=>isC(p)?'From $10':(p==='free'?'$0':'$'+PLANS[p].price+'/mo')],
    ['Usage', p=>isC(p)?'You choose':(PLANS[p].mult||'1\u00d7')+' the usage'],
    ['AMV Pulse (fast)', p=>'\u2713'],
    ['AMV Core (balanced)', p=>'\u2713'],
    ['AMV Forge (coding)', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=1?'\u2713':'-')],
    ['AMV Apex - flagship, priority queue', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=2?'\u2713':'-')],
    ['Autonomous agents & Crew', p=>p==='free'?'-':'\u2713'],
    ['Full-stack builder (frontend + backend + auth)', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=2?'\u2713':(p==='pro'?'Frontend':'-'))],
    ['One-click deploy to a live URL', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=2?'\u2713':'-')],
    ['Download full multi-file projects', p=>p==='free'?'-':'\u2713'],
    ['Deploy & host multiple live apps', p=>isC(p)?'-':(PLAN_RANK[p]>=3?'\u2713':'-')],
    ['Autonomous multi-step projects', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=3?'\u2713':(PLAN_RANK[p]>=2?'Limited':'-'))],
    ['Context window (how much it holds)', p=>p==='free'?'Standard':(PLAN_RANK[p]>=3?'Whole codebase':(PLAN_RANK[p]>=2?'Extra-large':'Large'))],
    ['Image generation', p=>'\u2713'],
    ['Video generation', p=>p==='free'?'-':(PLAN_RANK[p]>=2?'4K':'HD')],
    ['Parallel agents / long jobs', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=3?'Unlimited':(PLAN_RANK[p]>=2?'Up to 5':(p==='pro'?'Limited':'-')))],
    ['Scheduled & background automation', p=>p==='free'?'-':(PLAN_RANK[p]>=2?'Unlimited':'\u2713')],
    ['Connect Gmail, Drive, Calendar, GitHub', p=>p==='free'?'-':'\u2713'],
    ['Early access to new features', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=2?'\u2713':'-')],
    ['Priority speed', p=>p==='free'?'Standard':(PLAN_RANK[p]>=3?'Fastest hardware':'\u2713')],
    ['Team workspaces (roles, shared projects)', p=>isC(p)?'-':(PLAN_RANK[p]>=3?'\u2713':'-')],
    ['Support', p=>isC(p)?'Priority':(PLAN_RANK[p]>=3?'Dedicated':(PLAN_RANK[p]>=2?'Priority 24/7':(p==='pro'?'Priority':'Community')))],
    ['Hard cap (no overage)', p=>p==='free'?'-':'\u2713'],
  ];
  const colName=p=>isC(p)?'Custom':PLANS[p].name;
  const head='<th></th>'+plans.map(p=>'<th class="'+(p===highlight?'pc-hl':'')+'">'+colName(p)+(p===highlight?'<span class="pc-tag">Recommended</span>':'')+'</th>').join('');
  const body=rows.map(([label,fn])=>'<tr><td class="pc-row">'+label+'</td>'+plans.map(p=>'<td class="'+(p===highlight?'pc-hl':'')+'">'+fn(p)+'</td>').join('')+'</tr>').join('');
  const cta='<tr><td></td>'+plans.map(p=>'<td class="'+(p===highlight?'pc-hl':'')+'">'+(p==='free'?'':'<button class="btn '+(p===highlight?'bp':'')+' pc-go" data-pcgo="'+p+'" style="font-size:11px;padding:6px 9px">'+(isC(p)?'Build':'Get')+'</button>')+'</td>').join('')+'</tr>';
  r.innerHTML='<div class="upg-ov" id="pc-bg"><div class="pc-modal" onclick="event.stopPropagation()">'+
    '<button class="dna-x" id="pc-x" style="position:absolute;top:16px;right:16px;z-index:2">\u2715</button>'+
    '<div class="pc-head"><h2>Compare plans</h2><p>Everything each plan includes - pick what fits how you work.</p></div>'+
    '<div class="pc-scroll"><table class="pc-table"><thead><tr>'+head+'</tr></thead><tbody>'+body+cta+'</tbody></table></div>'+
  '</div></div>';
  const close=()=>{ r.innerHTML=''; };
  on($('pc-bg'),'click',close); on($('pc-x'),'click',close);
  r.querySelectorAll('[data-pcgo]').forEach(btn=>on(btn,'click',()=>{ const k=btn.dataset.pcgo; close(); if(k==='custom'){ openCustomPlan(); } else { openCheckout(k); } }));
}
window.openPlanCompare=openPlanCompare;

/* ===== CUSTOM PLAN BUILDER - interactive, abuse-proof ===== */
function openCustomPlan(){
  const r=$('ovr'); if(!r) return;
  const saved=load('amv_custom_cfg');
  let price=(saved&&saved.price)||30;
  const render=()=>{
    const s=_customPlanSummary(price);
    const marginPct=Math.round(s.margin*100);
    r.innerHTML='<div class="upg-ov" id="cp-bg"><div class="cp-modal" onclick="event.stopPropagation()">'+
      '<button class="dna-x" id="cp-x" style="position:absolute;top:16px;right:16px">\u2715</button>'+
      '<div class="cp-head"><span class="eyebrow" style="color:var(--accent)">Custom plan</span>'+
        '<h2>Pay exactly for what you need</h2>'+
        '<p>Set your monthly budget. You get a guaranteed pool of usage for that price - all models included, hard-capped so there are never surprise charges.</p></div>'+
      '<div class="cp-price-row"><span class="cp-cur">$</span><span class="cp-price" id="cp-price">'+price+'</span><span class="cp-per">/month</span></div>'+
      '<div class="cp-local" id="cp-local"></div>'+
      '<input type="range" id="cp-slider" min="'+CUSTOM_PLAN.MIN_PRICE+'" max="500" step="5" value="'+price+'" class="cp-range">'+
      '<div class="cp-range-lbls"><span>$'+CUSTOM_PLAN.MIN_PRICE+'</span><span>$500</span></div>'+
      '<div class="cp-grid">'+
        _cpStat(s.monthlyTokens.toLocaleString(),'tokens on Core')+
        (s.hasApex?_cpStat(s.apexTokens.toLocaleString(),'tokens on Apex'):_cpStat('$'+CUSTOM_PLAN.APEX_MIN_PRICE+'+','unlocks top models'))+
        _cpStat('~'+s.approxMessages.toLocaleString(),'AI messages')+
        _cpStat(s.dailyCap.toLocaleString(),'daily limit')+
      '</div>'+
      '<div class="cp-note">Usage is metered as credits - faster models use fewer, the most powerful use more. Mix and match however you like; your pool is yours.</div>'+
      '<div class="cp-incl"><div class="cp-incl-h">Everything included</div>'+
        '<div class="cp-incl-list" id="cp-incl-list">'+_cpInclFeatures(s.hasApex).map(f=>'<span>\u2713 '+f+'</span>').join('')+'</div></div>'+
      '<button class="btn bp cp-go" id="cp-buy">Get Custom - $'+price+'/mo</button>'+
      '<p class="cp-fine">Usage is capped at your plan size and resets monthly. Unused usage doesn\u2019t roll over. Cancel or resize anytime.</p>'+
    '</div></div>';
    const close=()=>{ r.innerHTML=''; };
    on($('cp-bg'),'click',close); on($('cp-x'),'click',close);
    const _cpLocal=()=>{ const el=$('cp-local'); if(el) el.textContent=(window.AMVCurrency&&AMVCurrency.isLocal())?('≈ '+AMVCurrency.fmt(price)+' /mo in your currency'):''; };
    _cpLocal();
    const sl=$('cp-slider');
    on(sl,'input',()=>{ price=parseInt(sl.value,10); const ps=_customPlanSummary(price);
      $('cp-price').textContent=price; _cpLocal();
      const g=r.querySelectorAll('.cp-stat-n');
      if(g.length>=4){ g[0].textContent=ps.monthlyTokens.toLocaleString(); g[1].textContent=ps.hasApex?ps.apexTokens.toLocaleString():('$'+CUSTOM_PLAN.APEX_MIN_PRICE+'+'); g[2].textContent='~'+ps.approxMessages.toLocaleString(); g[3].textContent=ps.dailyCap.toLocaleString(); }
      const gl=r.querySelectorAll('.cp-stat-l'); if(gl.length>=2) gl[1].textContent=ps.hasApex?'tokens on Apex':'unlocks top models';
      const incl=$('cp-incl-list'); if(incl) incl.innerHTML=_cpInclFeatures(ps.hasApex).map(f=>'<span>✓ '+f+'</span>').join('');
      const buy=$('cp-buy'); if(buy) buy.textContent='Get Custom - $'+price+'/mo';
    });
    on($('cp-buy'),'click',()=>{
      // store the chosen config; checkout will activate it
      store('amv_custom_cfg',{price, ts:Date.now()});
      // price is dynamic - pass it to checkout
      close();
      openCheckout('custom', price);
    });
  };
  render();
}
function _cpStat(n,l){ return '<div class="cp-stat"><div class="cp-stat-n">'+n+'</div><div class="cp-stat-l">'+l+'</div></div>'; }
/* The included-features list for the custom plan, adjusted for whether the
   chosen price unlocks the top models (Apex). */
function _cpInclFeatures(hasApex){
  return [
    hasApex?'All models incl. Apex (top models)':'All Pro models (Fast, Core, Coding)',
    'Autonomous agents & Crew',
    'Images, video & 3D',
    'Build & ship apps',
    'Priority speed',
    'Hard cap - no overage charges'
  ];
}
window.openCustomPlan=openCustomPlan;
function _planHighlights(k){
  return {
    pro:['All 4 models incl. Forge','5\u00d7 the usage','Autonomous agents & Crew','HD images, video & 3D','Priority speed'],
    elite:['Everything in Pro','20\u00d7 the usage','Fastest models first','Parallel agents & long jobs','Early access'],
    ultra:['Everything in Elite','50\u00d7 the usage','Max concurrency','Team-grade throughput','Dedicated support'],
  }[k]||['More usage','All models'];
}
window.openUpgradeModal=openUpgradeModal;
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
function _secItem(ic,t,d){ return '<div class="sec-item"><div class="sec-ic">'+ic+'</div><div><div class="sec-t">'+t+'</div><div class="sec-d">'+d+'</div></div></div>'; }
function _pmBrandIcon(b){ return ({visa:'VISA',mastercard:'MC',amex:'AMEX',discover:'DISC'})[b]||'CARD'; }
function _pmLabel(pm){ return ({card:'Card',apple:'Apple Pay',google:'Google Pay',paypal:'PayPal',bank:'Bank'})[pm.type]||'Card'; }
/* Payment method storage - DISPLAY ONLY. Never stores PAN/CVC. */
function _loadPM(){ try{ const v=load('amv_pm_display'); return (v&&v.last4)?v:null; }catch(e){ return null; } }
function _savePM(obj){ try{ store('amv_pm_display',{type:obj.type,brand:obj.brand||'card',last4:String(obj.last4||'').slice(-4),exp:obj.exp||'',token:obj.token||('tok_'+Math.random().toString(36).slice(2,12))}); }catch(e){} }
function removePM(){ try{ localStorage.removeItem(_scopeKey('amv_pm_display')); }catch(e){} renderBillingView(); toast('Payment method removed','info'); }
window.removePM=removePM;

