/* AMV's owner console - the Command Center, its fraud review and its user
   list - fetched the first time the owner opens it (_loadAdmin), the way the
   Office exporter and the spreadsheet editor are. Every visitor used to
   download it with the page: about 11KB gzipped that only one person reads.

   It is a classic script, so these function declarations land on window just
   as they did inside the page. The admin token helpers stay in the page
   (08-admin-fraud.js): the dashboard and design surfaces use them too. */
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

/* The prompt the Command Center shows when it has no token yet. Rendered into
   the page rather than a modal so it cannot be missed behind other UI. */
function _admTokenPromptHTML(msg){
  return '<div class="adm-tokwrap">'+
    '<div class="adm-tokmsg">'+escH(msg || 'Platform-wide figures are gated on your Worker’s ADMIN_TOKEN secret.')+'</div>'+
    '<div class="adm-tokrow">'+
      '<label class="sr-only" for="adm-tok">Admin token</label>'+
      '<input id="adm-tok" type="password" autocomplete="new-password" class="inp" placeholder="Admin token">'+
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
  if((apiBase()||'') && _adminToken() && (!S._admStats || stale) && !S._admStatsLoading){ _admFetchStats(); }
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
    ((apiBase()||'') && !live && !S._admStatsLoading ? _admTokenPromptHTML(S._admStatsError) : '')+
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
  const base=apiBase()||'';
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
  const base=apiBase()||''; const tok=_adminToken();
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
      /* Each currency on its own row: a euro and a dollar are not two of
         anything, so nothing here adds them (Nov 7 audit FIN-022). */
      const t=f.totals||{};
      const money=_admMoney;
      const by=f.byCurrency||{ [t.currency||'USD']: t };
      totalsHtml=Object.keys(by).map(cur=>{ const b=by[cur]||{}; return '<div class="adm-stats">'+
        _admStat(escH(money(b.gross,cur)),'Gross received'+(Object.keys(by).length>1?' ('+escH(cur)+')':''))+
        _admStat(escH(money(b.refunded,cur)),'Refunded', (b.refunded>0?'#e0b341':''))+
        _admStat(escH(money(b.net,cur)),'Net', '#4ade80')+
        _admStat((b.count||0).toLocaleString(),'Transactions')+
      '</div>'; }).join('')+(t.scope==='page'?'<p class="adm-note">These totals cover the transactions on this page, not all time.</p>':'');
    }
    let tableHtml='';
    if(f && f.configured!==false && (f.transactions||[]).length){
      tableHtml='<div class="adm-fin-table-wrap"><table class="adm-fin-table"><thead><tr>'+
        '<th>Date</th><th>Customer</th><th>Method</th><th>Amount</th><th>Status</th><th>Card</th><th></th></tr></thead><tbody>'+
        f.transactions.map(tx=>'<tr>'+
          '<td>'+new Date(tx.date).toLocaleDateString()+'</td>'+
          '<td class="adm-fin-email">'+escH(tx.email||'-')+'</td>'+
          '<td><span class="adm-fin-prov p-'+escH(tx.provider||'')+'">'+escH((tx.provider||'-').replace(/^\w/,c=>c.toUpperCase()))+'</span></td>'+
          '<td class="adm-fin-amt">'+escH(_admMoney(tx.amount,tx.currency))+(tx.refunded>0?' <span class="adm-fin-ref">-'+escH(_admMoney(tx.refunded,tx.currency))+'</span>':'')+'</td>'+
          '<td><span class="adm-fin-status s-'+escH(tx.status||'')+'">'+escH(tx.status||'')+'</span></td>'+
          '<td>'+(tx.last4?('\u2022\u2022\u2022\u2022 '+escH(tx.last4)):'-')+'</td>'+
          '<td>'+(safeUrl(tx.receipt)?'<a href="'+escH(safeUrl(tx.receipt))+'" target="_blank" rel="noopener noreferrer" class="adm-fin-rc">Receipt</a>':'')+'</td>'+
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
      /* COST PER GOOD OUTCOME (Nov 1 audit USAGE-005): by kind of work, how
         much of it came out right and what each good one cost. */
      /* THE SERVICE OBJECTIVES (REL-010), measured from what happened. */
      _admCard('Service objectives this month', live
        ? ((live.slo||[]).length
          ? '<div class="adm-fin-table-wrap"><table class="adm-fin-table"><thead><tr><th>Objective</th><th>Target</th><th>Actual</th><th>Budget spent</th></tr></thead><tbody>'
            + live.slo.map(o=>'<tr><td>'+escH(o.what)+'</td><td>'+o.objective+'%</td><td>'+(o.actualPct==null?'-':o.actualPct+'%')+'</td><td>'
              + (o.status==='too_few'?'too few to judge':(o.budgetUsedPct+'%'+(o.status==='broken'?' - over':o.status==='burning'?' - burning':'')))+'</td></tr>').join('')
            + '</tbody></table></div>'
            /* p50/p95/p99 of the time to the first word, from the histogram -
               "under N ms", as fine as the buckets that counted it. */
            + (()=>{ const f=live.slo.find(o=>o.id==='chat_starts_fast'&&o.p50); return f
                ? '<div class="adm-note">Time to the first word: half of answers '+escH(String(f.p50))+' ms, 95% '+escH(String(f.p95))+' ms, 99% '+escH(String(f.p99))+' ms.</div>' : ''; })()
          : '<div class="adm-empty">Nothing measured yet this month.</div>')
        : _admPending('Each objective, what it actually was, and how much error budget is spent'))+
      _admCard('Cost per good outcome', live
        ? (Object.keys(live.outcomes||{}).length
          ? '<div class="adm-fin-table-wrap"><table class="adm-fin-table"><thead><tr><th>Work</th><th>Runs</th><th>Good</th><th>Cost</th><th>Per good one</th></tr></thead><tbody>'
            + Object.entries(live.outcomes).sort((a,b)=>(b[1].runs||0)-(a[1].runs||0)).map(([k,o])=>'<tr><td>'+escH(k)+'</td><td>'+(o.runs||0).toLocaleString()+'</td><td>'
              + (o.goodPct==null?'-':o.goodPct+'%')+'</td><td>$'+(o.costUSD||0).toLocaleString()+'</td><td>'+(o.costPerGoodUSD==null?'-':'$'+o.costPerGoodUSD)+'</td></tr>').join('')
            + '</tbody></table></div><div class="adm-econ-note">Good means an answer delivered whole, a background or agent run that produced its result in the form promised, or an action AMV read back as done.</div>'
          : '<div class="adm-empty">No outcomes recorded yet this month.</div>')
        : _admPending('How much of each kind of work came out right, and what each good one cost'))+
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
    /* FROM THE SERVER, ACROSS EVERYBODY. This tab used to build its funnel
       from the events logged in THIS browser - the owner's own clicks - and
       label it "tracked from real user events". The server has counted the
       real funnel all along (_funnelReport) and the cohorts now (_retentionReport). */
    const f = live && live.funnel, r = live && live.retention;
    const steps = f ? [
      { label: 'Signed up', n: f.signup || 0 },
      { label: 'Got a real answer', n: f.activated || 0, pct: f.activatedPct },
      { label: 'Set something to run again on its own', n: f.habit || 0, pct: f.habitPct },
      { label: 'Came back on another day', n: f.returned || 0, pct: f.returnedPct },
      { label: 'Paid', n: f.paid || 0, pct: f.paidPct },
    ] : [];
    const top = Math.max(1, ...steps.map(x => x.n));
    const funnel = f ? '<div class="adm-funnel">' + steps.map(x =>
      '<div class="adm-fnl-row"><div class="adm-fnl-top"><span>' + escH(x.label) + '</span><span class="adm-fnl-n">' + x.n.toLocaleString()
      + (x.pct != null ? ' <span class="adm-fnl-conv">' + x.pct + '% of sign-ups</span>' : '') + '</span></div>'
      + '<div class="adm-fnl-track"><div class="adm-fnl-fill" style="width:' + Math.max(Math.round(x.n / top * 100), 2) + '%"></div></div></div>').join('') + '</div>'
      + (f.firstAnswer && f.firstAnswer.measured ? '<p class="adm-note">' + (f.firstAnswer.under3MinPct != null ? f.firstAnswer.under3MinPct + '% got their first real answer within three minutes of signing up.' : '') + (f.avgDaysToPay != null ? ' Those who pay take ' + f.avgDaysToPay + ' days on average.' : '') + '</p>' : '')
      : '';
    /* WHICH FIRST STEP KEEPS PEOPLE (Nov 8 audit GROWTH-010): for each
       starting chip, of those who clicked it first, how many got an answer,
       made something recurring, came back and paid. The chips' order is a
       guess until this says otherwise. */
    const g = live && live.firstGoals;
    const gNames = { advice: 'Advice', research: 'Look up', write: 'Edit', build: 'Build', automate: 'Automate' };
    const gPct = (v, n) => n > 0 ? Math.round(v / n * 100) + '%' : '-';
    const goals = g && Object.values(g).some(x => x && x.chose)
      ? '<div class="adm-fin-table-wrap"><table class="adm-fin-table"><thead><tr><th>First chip</th><th>Chose it</th><th>Got an answer</th><th>Made it recurring</th><th>Came back</th><th>Paid</th></tr></thead><tbody>'
        + Object.keys(gNames).map(k => { const x = g[k] || {}; const n = +x.chose || 0;
            return '<tr><td>' + gNames[k] + '</td><td>' + n.toLocaleString() + '</td><td>' + gPct(+x.activated || 0, n) + '</td><td>' + gPct(+x.habit || 0, n) + '</td><td>' + gPct(+x.returned || 0, n) + '</td><td>' + gPct(+x.paid || 0, n) + '</td></tr>'; }).join('')
        + '</tbody></table></div><p class="adm-note">Of the people who clicked each one first. Put the chip that keeps the most people first.</p>'
      : '<div class="adm-empty">Nobody has clicked a starting chip yet.</div>';
    /* Retention by the week people started: the number to steer by. Each cell
       is the share of that week's sign-ups active that many weeks later; a
       week that has not finished yet is left empty, not counted as zero. */
    const shown = [1, 2, 4, 8, 12];
    const cohorts = r && (r.cohorts || []).filter(c => c.size > 0);
    const table = cohorts && cohorts.length
      ? '<div class="adm-fin-table-wrap"><table class="adm-fin-table"><thead><tr><th>Started the week of</th><th>People</th>' + shown.map(n => '<th>Week ' + n + '</th>').join('') + '</tr></thead><tbody>'
        + cohorts.map(c => '<tr><td>' + escH(c.week) + '</td><td>' + c.size.toLocaleString() + '</td>' + shown.map(n => { const w = (c.weeks || []).find(x => x.n === n); return '<td>' + (w && w.pct != null ? w.pct + '%' : '\u2013') + '</td>'; }).join('') + '</tr>').join('')
        + '</tbody></table></div><p class="adm-note">Of the people who started each week, the share who used AMV again that many weeks later. Week 4 above 30% is a product people keep; under 10% is a product people try.</p>'
      : '<div class="adm-empty">No cohort has started yet. The first row appears a week after people start signing up.</div>';
    /* What brought people back this month: a notification or a result email
       opened, by distinct person and day, and how many of those were somebody
       returning rather than on their first day. Sent is not opened. */
    const a = live && live.arrivals;
    const names = { push: 'Notifications', email: 'Result emails' };
    const brought = a
      ? '<div class="adm-fin-table-wrap"><table class="adm-fin-table"><thead><tr><th>Channel</th><th>Opened from it</th><th>Of those, came back</th></tr></thead><tbody>'
        + Object.keys(names).map(k => { const v = a[k] || {}; return '<tr><td>' + names[k] + '</td><td>' + (+v.arrivals || 0).toLocaleString() + '</td><td>' + (+v.returns || 0).toLocaleString() + '</td></tr>'; }).join('')
        + '</tbody></table></div><p class="adm-note">This month, one count per person per day. A channel that is opened but brings nobody back is noise, not a habit.</p>'
      : '<div class="adm-empty">Nothing counted yet this month.</div>';
    /* What one person who is actually here costs: the month's AI spend over
       the distinct people active this month. */
    const mg = live && live.margin;
    const perActive = mg && mg.costPerActiveUser != null
      ? '<div class="adm-stats">' + _admStat((+mg.activeThisMonth || 0).toLocaleString(), 'People active this month')
        + _admStat('$' + mg.costPerActiveUser.toFixed(3), 'AI cost per active person')
        + (live.revenue && mg.activeThisMonth > 0 ? _admStat('$' + (live.revenue.estMRR / mg.activeThisMonth).toFixed(2), 'Revenue per active person') : '')
        /* The north star is work done, not messages (Nov 8 audit GROWTH-011):
           actions on people's accounts that AMV read back and confirmed. */
        + (live.actionOutcomes && mg.activeThisMonth > 0 ? _admStat((((+live.actionOutcomes.verified || 0)) / mg.activeThisMonth).toFixed(2), 'Confirmed actions per active person') : '') + '</div>'
        + '<p class="adm-note">Revenue per active person above cost per active person is a business that gets better as it grows. Below it, every new user is a loss to be paid for.</p>'
      : '<div class="adm-empty">Nobody counted as active this month yet.</div>';
    el.innerHTML =
      _admCard('Who signs up, and who stays', live ? (f ? funnel : '<div class="adm-empty">Nothing counted yet.</div>') : _admPending('Sign-up, first answer, coming back and paying, across everybody'))
      + _admCard('Retention by the week they started', live ? table : _admPending('Of each week\u2019s sign-ups, the share still here one, two, four, eight and twelve weeks later'))
      + _admCard('What brought people back', live ? brought : _admPending('Opened from a notification or a result email, and how many of those were returns'))
      + _admCard('Which first step keeps people', live ? goals : _admPending('For each starting chip, how many who clicked it first got an answer, made it recurring, came back and paid'))
      + _admCard('Invite links', '<p class="adm-note">With SIGNUP_INVITE_ONLY=1, a new account needs one of these or an existing person\u2019s referral link.</p>'
        + '<div class="adm-stats"><label class="adm-note" for="adm-inv-n">How many</label> <input id="adm-inv-n" type="number" min="1" max="200" value="10" style="width:70px"> '
        + '<label class="adm-note" for="adm-inv-u">Uses each</label> <input id="adm-inv-u" type="number" min="1" max="50" value="1" style="width:70px"> '
        + '<button class="btn bp" type="button" id="adm-inv-go">Make links</button> <button class="btn" type="button" id="adm-inv-ls">Show invites</button></div><pre id="adm-inv-out" class="adm-note" style="white-space:pre-wrap"></pre><div id="adm-inv-list"></div>')
      + _admCard('What one active person costs', live ? perActive : _admPending('This month\u2019s AI cost and revenue per person who used AMV'));
  }

}
/* An amount in its own currency, written the way that currency is written. */
/* Owner: make invite links for the beta (POST /admin/invites). */
async function _admMakeInvites(){
  const out = document.getElementById('adm-inv-out'); if(!out) return;
  const n = +(document.getElementById('adm-inv-n')||{}).value || 1, u = +(document.getElementById('adm-inv-u')||{}).value || 1;
  out.textContent = 'Making\u2026';
  try{
    const r = await AMV_API._fetch('/admin/invites', { method:'POST', body: JSON.stringify({ count: n, uses: u }) });
    const d = await r.json().catch(()=>({}));
    out.textContent = r.ok && d.ok ? ((d.links && d.links.length ? d.links : d.codes) || []).join('\n') : (d.error || 'The links could not be made.');
  }catch(e){ out.textContent = 'The links could not be made. Check the connection and try again.'; }
}
/* Owner: every invite made, how much of each is spent, and a way to stop one
   (GET /admin/invites/list, POST /admin/invites/revoke). */
async function _admListInvites(){
  const box = document.getElementById('adm-inv-list'); if(!box) return;
  box.textContent = 'Loading\u2026';
  try{
    const r = await AMV_API._fetch('/admin/invites/list', { method:'POST', body: '{}' });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.ok){ box.textContent = d.error || 'The invites could not be read.'; return; }
    const rows = (d.invites || []).map(v => '<tr><td>' + escH(v.code) + '</td><td>' + (v.used == null ? '?' : v.used) + ' / ' + v.uses + '</td><td>'
      + (v.expires ? escH(new Date(v.expires).toLocaleDateString()) : '-') + '</td><td>' + (v.revoked ? 'Revoked' : v.open ? 'Open' : 'Closed') + '</td><td>'
      + (v.revoked ? '' : '<button class="btn" type="button" data-adm-revoke="' + escH(v.code) + '">Revoke</button>') + '</td></tr>').join('');
    box.innerHTML = rows ? '<div class="adm-fin-table-wrap"><table class="adm-fin-table"><thead><tr><th>Code</th><th>Used</th><th>Ends</th><th>State</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (d.complete ? '' : '<p class="adm-note">Showing the first part of a long list.</p>') : '<p class="adm-note">No invites made yet.</p>';
  }catch(e){ box.textContent = 'The invites could not be read. Check the connection and try again.'; }
}
async function _admRevokeInvite(code){
  try{
    const r = await AMV_API._fetch('/admin/invites/revoke', { method:'POST', body: JSON.stringify({ code }) });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.ok){ const box = document.getElementById('adm-inv-list'); if(box) box.insertAdjacentText('afterbegin', (d.error || 'That invite could not be revoked.') + ' '); return; }
  }catch(e){ /* the list below is read again and shows what is true */ }
  _admListInvites();
}
document.addEventListener('click', (e) => {
  if(!e.target) return;
  if(e.target.id === 'adm-inv-go') _admMakeInvites();
  if(e.target.id === 'adm-inv-ls') _admListInvites();
  const rv = e.target.getAttribute && e.target.getAttribute('data-adm-revoke'); if(rv) _admRevokeInvite(rv);
});
function _admMoney(n,cur){ try{ return new Intl.NumberFormat(undefined,{style:'currency',currency:String(cur||'USD').toUpperCase()}).format(+n||0); }catch(e){ return String(cur||'')+' '+(+n||0).toLocaleString(); } }
function _admKpi(label,val,sub,color){ return '<div class="adm-kpi"><div class="adm-kpi-v"'+(color?' style="color:'+color+'"':'')+'>'+(val||'-')+'</div><div class="adm-kpi-l">'+label+'</div><div class="adm-kpi-s">'+sub+'</div></div>'; }
function _admAgo(ts){ const t=Date.parse(ts||0); if(!t) return ''; const s=(Date.now()-t)/1000; if(s<60)return Math.floor(s)+'s ago'; if(s<3600)return Math.floor(s/60)+'m ago'; if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; }
function getConvsCount(){ try{ return (S.convs||[]).length; }catch(e){ return 0; } }
/* One page of the admin user list. Returns null rather than throwing, because
   a failed page must leave the screen saying so instead of empty. */
async function _admUsersPage(offset){
  if(!(window.AMV_API && AMV_API.base)) return null;
  const base=AMV_API.base.replace(/\/$/,'');
  const r=await fetchDeadline(base+'/admin/users?offset='+(offset||0)+'&limit=60',
    { headers:{ 'Authorization':'Bearer '+(AMV_API.token||'') } });
  if(!r.ok) return null;
  const d=await r.json().catch(()=>null);
  if(!d) return null;
  return { users:d.users||[], total:d.total||0, hasMore:!!d.hasMore, note:d.note||'' };
}
/* What /v1/admin/user answered, shown as it came back. Every figure here is
   the server's - nothing is derived in the browser, because the point of
   opening this is to see what the server believes. */
function _admShowUser(d){
  const r=$('ovr'); if(!r) return;
  const ent=d.entitlement||{}; const u=d.usage||{}; const t=d.team;
  const row=(k,v)=>'<div class="admu-row"><span>'+escH(k)+'</span><b>'+escH(String(v))+'</b></div>';
  r.innerHTML='<div class="ov" id="admu-bg"><div class="ob admu-ob">'+
    '<button class="oc" id="admu-x" aria-label="Close">&#215;</button>'+
    '<h2>'+escH(d.email||'')+'</h2>'+
    '<p class="ob-sub">Read from the server just now.</p>'+
    '<div class="admu-grid">'+
      row('Plan', ent.plan||'free')+
      (ent.source?row('Set by', ent.source):'')+
      (ent.blocked?row('Blocked','yes'):'')+
      row('Tokens today', (u.dayTokens||0).toLocaleString())+
      row('Tokens this month', (u.monthTokens||0).toLocaleString())+
      row('AI cost this month', '$'+(u.monthCostUSD||0).toFixed(2))+
      (t?row('Team', t.id+' \u00b7 '+(t.role||'')+' \u00b7 '+(t.plan||'')):'')+
      (u.shared?row('Counted against', u.subject||''):'')+
    '</div>'+
    '<p class="admu-note">Changing a plan or signing this account out everywhere is not offered here.</p>'+
  '</div></div>';
  const close=()=>{ r.innerHTML=''; };
  onBackdrop($('admu-bg'),close); on($('admu-x'),'click',close);
}
try{ window._admShowUser=_admShowUser; }catch(e){}

async function _adminLoadUsers(backendLive){
  const el=$('adm-users'); if(!el) return;
  let users=[]; let total=0, hasMore=false, note='';
  if(backendLive && window.AMV_API && AMV_API.base){
    /* AMV-198: a page at a time. The server does several storage reads per
       account and a Worker has a ceiling on how many it may make in one
       request, so asking for every account at once is a screen that gets
       slower as AMV grows and eventually stops answering. Nothing has been
       removed - the rest is one click away, and the count says so. */
    try{
      const d=await _admUsersPage(0);
      if(d){ users=d.users||[]; total=d.total||users.length; hasMore=!!d.hasMore; note=d.note||''; }
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
  /* The count says what is ON SCREEN and what exists, separately. "300
     accounts" read off a page that holds the first sixty is a number an
     operator would then go and make decisions with. */
  const shown = () => users.length + (total > users.length ? ' of ' + total : '') + ' account' + (total===1?'':'s');
  const summary = users.length>1 ? '<div class="adm-user-summary">'+shown()+' \u00b7 '+
    users.filter(u=>u.plan&&u.plan!=='free').length+' paying \u00b7 '+
    users.filter(u=>u.flagged).length+' flagged'+
    (note?' \u00b7 <span class="adm-user-note">'+escH(note)+'</span>':'')+'</div>' : '';
  const moreBtn = () => hasMore
    ? '<button class="adm-user-more" id="adm-user-more">Show more accounts</button>'
    : '';
  el.innerHTML=summary+'<div class="adm-user-search"><input id="adm-user-q" placeholder="Search users by name or email\u2026"></div>'+
    '<div class="adm-user-list" id="adm-user-list">'+users.map(row).join('')+'</div>'+moreBtn();

  /* Appends the next page in place, so the list the owner was reading does not
     jump back to the top and whatever they typed in the search box still
     applies to everything now loaded. */
  const wireMore = () => {
    const b=$('adm-user-more'); if(!b) return;
    on(b,'click',async ()=>{
      b.disabled=true; b.textContent='Loading\u2026';
      const d=await _admUsersPage(users.length).catch(()=>null);
      if(!d){ b.disabled=false; b.textContent='That did not load. Try again'; return; }
      users=users.concat(d.users); total=d.total||total; hasMore=d.hasMore; note=d.note||note;
      const list=$('adm-user-list'); if(list) list.innerHTML=users.map(row).join('');
      const sum=el.querySelector('.adm-user-summary');
      if(sum) sum.innerHTML=shown()+' \u00b7 '+users.filter(u=>u.plan&&u.plan!=='free').length+' paying \u00b7 '+
        users.filter(u=>u.flagged).length+' flagged'+(note?' \u00b7 <span class="adm-user-note">'+escH(note)+'</span>':'');
      if(hasMore){ b.disabled=false; b.textContent='Show more accounts'; } else { b.remove(); }
    });
  };
  wireMore();
  /* MANAGE OPENED NOTHING.

     The button was rendered with data-admuser on it, styled, and given a hover
     state - and no click handler, no reader of that attribute anywhere in the
     bundle. It looked exactly like a control and was a label. On the owner's
     own screen, next to the account it names.

     /v1/admin/user answers three things: inspect by default, setPlan, and
     revoke. This wires the INSPECT, which is what "Manage" can honestly do
     without a decision being made for somebody: entitlement, team and the
     usage counters that account actually spends against.

     setPlan grants a paid plan and revoke signs somebody out of every device.
     Both are real and both are the owner's to switch on deliberately, not
     something to appear under a button because the endpoint happened to
     support it. */
  on(el,'click', async (e)=>{
    const b=e.target.closest('[data-admuser]'); if(!b) return;
    e.stopPropagation();
    const email=b.dataset.admuser||''; if(!email) return;
    if(!(window.AMV_API && AMV_API.base)){
      toast('Account detail is read from the server, and this page is not connected to one.','info',5000);
      return;
    }
    const was=b.textContent; b.disabled=true; b.textContent='Reading\u2026';
    try{
      const base=AMV_API.base.replace(/\/$/,'');
      const r=await fetchDeadline(base+'/v1/admin/user',{ method:'POST',
        headers:{ 'Authorization':'Bearer '+(AMV_API.token||''), 'Content-Type':'application/json' },
        body:JSON.stringify({ email }) });
      const d=await r.json().catch(()=>null);
      if(!r.ok || !d || !d.ok){
        toast('That account could not be read: '+((d&&d.error)||('HTTP '+r.status)),'error',5000);
        return;
      }
      _admShowUser(d);
    }catch(err){
      toast('That account could not be read. Check the connection and try again.','error',5000);
    }finally{ b.disabled=false; b.textContent=was; }
  });
  const q=$('adm-user-q'); if(q) on(q,'input',()=>{ const term=q.value.toLowerCase(); const filtered=users.filter(u=>(u.email+' '+(u.name||'')).toLowerCase().includes(term)); const list=$('adm-user-list'); if(list) list.innerHTML=filtered.map(row).join('')||'<div class="adm-users-loading">No matches.</div>'; });
}

