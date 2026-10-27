/* === SETTINGS VIEW === */

/* AMV-D009: EIGHTEEN PANES, AND A GROUP CALLED "THE REST".

   Measured before anything moved. The groups already existed and did no work:
   General held TWELVE of the eighteen user panes and Workspace held one. A
   group holding two-thirds of everything is a list with a title on it.

   Five merges, each of two panes that answer the same question:

     privacy    + security    -> Privacy & security
     billing    + usage       -> Plan & usage
     capabilities + skills    -> What AMV can do
     appearance + language    -> Appearance & language
     invite     -> teamset       (180 characters and no controls at all: it was
                                  a button on the Team pane with its own address)

   Eighteen panes to thirteen, and no group holding more than three.

   NOTHING IS DELETED. A merge is two sections on one pane, both rendered, each
   under its own heading. And every retired id still works: `S.settingsPane` is
   set by name from at least six places in the product - Mission Control's
   "connect", the marketplace's pay button, the team invite flow, the profile
   menu - so an id that stopped resolving would be a dead link somewhere nobody
   would think to look. They resolve through this table instead, and the pane
   scrolls to the half that was asked for. */
/* THIRTEEN PANES WAS TOO MANY, AND THE GROUPS WERE ALREADY THE ANSWER.

   Reported as "settings is too much very overwhelming simplify". It was
   thirteen user-facing panes in six labelled groups - and the groups were
   right, so the fix was not to invent a new structure but to let the groups BE
   the panes. Five more merges take it to eight, and each of the eight is a
   thing somebody would actually go looking for.

   Nothing was deleted. Every merged pane renders under its own heading inside
   its new home, every retired id still resolves, and a deep link to one still
   scrolls to it - the machinery for that already existed for the first five
   merges and is unchanged. What moved is where you find it, not what it says.

   Why each one:
     family     -> account       both are "who this account is and who shares it"
     spending   -> billing       a limit on money belongs with the money
     investing  -> capabilities  it is a feature switch, not a bill
     api        -> integrations  an API key is how a developer connects a thing
     projects   -> teamset       both are the shared workspace */
const SET_MERGED_INTO = {
  security: 'privacy',
  usage: 'billing',
  skills: 'integrations',
  language: 'appearance',
  invite: 'account',
  /* The six-section Settings (see USER_SET_SECTIONS). Family is a section of
     its own again, so it is not here. */
  teamset: 'account',
  about: 'account',
  capabilities: 'privacy',
  /* `spending` is NOT here any more. It is its own section, so a request for
     it has to render it rather than being redirected to Billing and scrolled
     to an anchor that no longer exists - which is exactly what happened when
     it was added to the list above and left in this map: pressing Spending
     opened Plan & usage and landed on "Usage". Promoting a merged pane is two
     edits, and this is the second one. */
  investing: 'capabilities',
  api: 'integrations',
  projects: 'account',
};
/* The pane that actually renders for a requested id. */
function _setPaneFor(id){ return SET_MERGED_INTO[id] || id; }
/* The half of a merged pane a retired id was asking for, or ''. */
function _setSectionFor(id){ return SET_MERGED_INTO[id] ? id : ''; }
try{ window._setPaneFor=_setPaneFor; window._setSectionFor=_setSectionFor;
     window.SET_MERGED_INTO=SET_MERGED_INTO; }catch(e){}

const USER_SET_SECTIONS=[
  /* SIX, AND NO HEADINGS OVER THEM.

     "Fix settings. WAY TOO MUCH." It was nine sections under four headings,
     several with other screens merged into their bottoms - and the owner chose
     six short ones: who you are, what you pay, your family, what AMV connects
     to, what it may keep, how it looks. Six items need no headings; a heading
     over two is a label read twice.

     Nothing a person could do was removed. Team, invites and About are part of
     Account; usage is part of Plan & billing; skills and API keys are part of
     Connectors; security and the web-search, memory and answer-block switches
     are part of Privacy; language is part of Appearance. Spending has its own
     tab. Every old id still opens where its content now lives (SET_MERGED_INTO).

     `find` is what search matches besides the name: six names cannot answer
     "password" or "language", so each section lists the words of what is in
     it - and a suite renders every pane and fails on a word it does not show,
     so search never sends anybody to a section that is not about it. */
  {id:'account',label:'Account',find:['name','photo','profile','instructions','email','notifications','email me when amv is done','team','invite','seats','projects','about','terms','support','keyboard shortcuts','sign out'],icon:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'},
  {id:'billing',label:'Plan & billing',find:['plan','usage','upgrade','payment','invoices'],icon:'<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'},
  {id:'family',label:'Family',find:['family','invitation'],icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'},
  {id:'integrations',label:'Connectors',find:['connectors','skills','api keys','presets'],icon:'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>'},
  {id:'privacy',label:'Privacy',find:['export','delete','memory','clear chats','password','security','account activity','web search','analytics','location','sign out'],icon:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'},
  {id:'appearance',label:'Appearance',find:['theme','dark','light','accent','font size','motion','sound','language'],icon:'<circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>'},
];
/* OWNER-ONLY - platform controls. Hidden from end users entirely. */
const ADMIN_SET_SECTIONS=[
  {id:'dashboard',label:'Founder Dashboard',icon:'<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'},
  {id:'apikeys',label:'AI Connection',icon:'<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'},
  {id:'backend',label:'Live / Backend',icon:'<path d="M5 12h14M12 5l7 7-7 7"/>'},
  {id:'widget',label:'Website Widget',icon:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'},
  {id:'platform',label:'Platform',icon:'<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'},
];

/* EVERY id the pane chain below actually renders - the merged ids included,
   because renderSetPane(only) is called with them directly and bypasses
   SET_MERGED_INTO. Anything not here falls back to Account rather than
   rendering nothing at all. */
const _KNOWN_SET_PANES=['about','account','api','apikeys','appearance','backend','billing',
  'capabilities','dashboard','family','integrations','investing','invite','language','platform',
  'privacy','projects','security','skills','spending','teamset','usage','widget'];

/* AMV-089: money owed to sellers. A withdrawal used to zero a seller's balance
   and write a record nothing ever read - so this is the first screen that can
   see it, and the only place it can be settled. It leads the dashboard because
   an unpaid payout is a liability, not a statistic. */
function _payoutCardHTML(){
  return '<div class="ss2" id="fd-payouts"><h3>Payouts owed</h3>'+
    '<div class="fd-loading">Checking what is owed\u2026</div></div>';
}
async function _loadPayouts(){
  const host=$('fd-payouts'); if(!host) return;
  const base=apiBase()||'';
  const tok=($('fd-token')&&$('fd-token').value||'').trim()||((typeof _adminToken==='function')?_adminToken():'');
  if(!base||!tok){ host.innerHTML='<h3>Payouts owed</h3><div class="fd-empty">Enter your admin token to see money owed to sellers.</div>'; return; }
  try{
    const r=await fetchDeadline(base.replace(/\/$/,'')+'/admin/payouts',{headers:{'Authorization':'Bearer '+tok}},15000);
    const d=await r.json().catch(()=>({}));
    if(r.status===403) _forgetRejectedAdminToken();
    if(!r.ok||!d.ok){ host.innerHTML='<h3>Payouts owed</h3><div class="fd-empty">'+(r.status===403?'That admin token was rejected. Enter the current one to try again.':'Could not load payouts.')+'</div>'; return; }
    _payoutsPaint(host, d);
  }catch(e){ host.innerHTML='<h3>Payouts owed</h3><div class="fd-empty">Could not reach the backend, so this would be out of date.</div>'; }
}
function _payoutsPaint(host, d){
  const money=n=>'$'+(+n||0).toFixed(2);
  /* The QUEUE, not the ledger. Payouts AMV cleared by itself are not what
     somebody has to read - showing them here would rebuild the inbox this was
     built to empty, and a queue nobody finishes is one where the dangerous
     rows get the same glance as the rest. What is shown is what has a reason
     against it, WITH the reason, so the operator is deciding rather than
     guessing. */
  const pending=(d.needsReview||(d.payouts||[]).filter(p=>(p.status||'pending')==='pending'));
  const rows=pending.map(p=>
    '<div class="po-row" data-po="'+escH(p.id)+'">'+
      '<div class="po-main"><div class="po-who">'+escH(p.seller||'')+'</div>'+
        '<div class="po-dest">'+escH(p.destination||'no destination given')+'</div></div>'+
      '<div class="po-amt">'+money(p.amount)+
        ((p.reasons&&p.reasons.length)
          ? '<span class="po-why">'+escH(p.reasons.join(' \u00b7 '))+'</span>'
          : '')+'</div>'+
      '<div class="po-acts">'+
        '<button class="btn bs" type="button" data-po-paid="'+escH(p.id)+'">Mark paid</button>'+
        '<button class="btn bs" type="button" data-po-rej="'+escH(p.id)+'">Reject</button>'+
      '</div>'+
    '</div>').join('');
  const auto=+d.approvedCount||0;
  host.innerHTML='<h3>Payouts</h3>'+
    '<div class="po-total'+(d.owed>0?' owe':'')+'">'+money(d.owed)+' owed'+
      '<span class="po-sub">'+money(d.paidTotal)+' paid out so far'+
        (d.reservePct?' \u00b7 '+Math.round(d.reservePct*100)+'% of every sale held '+(d.reserveDays||120)+' days against late disputes':'')+
      '</span></div>'+
    /* The number that says whether this is working: how much cleared without
       anybody reading it. If that figure is not most of them, the thresholds
       are wrong and the queue is about to become an inbox again. */
    '<div class="po-auto">'+auto+' cleared automatically ('+money(d.approvedTotal||0)+')'+
      '<span class="po-sub">under $'+(d.autoMaxUSD||100)+', clean history, identity verified past $'+(d.kycThresholdUSD||600)+'</span></div>'+
    '<div class="po-qh">'+pending.length+' need'+(pending.length===1?'s':'')+' you</div>'+
    (rows||'<div class="fd-empty">Nothing is waiting on you.</div>')+
    '<div class="po-say" id="po-say" role="status" aria-live="polite"></div>'+
    '<div class="po-fine">Rejecting returns the money to the seller\u2019s balance. Marking paid does not send anything - do that with your payment provider first.</div>';
  /* Rejecting CREDITS the seller's wallet, so sending it twice pays the same
     money out twice. The buttons stayed live for the whole round trip, which
     makes a double-click the ordinary way to do it by accident rather than an
     exotic race. Locked here AND on the server - this only stops the accident,
     the server is what makes it impossible. */
  let _poBusy=false;
  const settle=async(id,status)=>{
    if(_poBusy) return;
    const say=$('po-say');
    const what = status==='paid'
      ? 'Mark this payout as already sent? It does not transfer anything - confirm you have paid it.'
      : 'Reject this payout and return the money to the seller\u2019s balance?';
    if(!await _askDestructive(status==='paid' ? 'Mark this payout as already sent?' : 'Reject this payout?',
        what, status==='paid' ? 'Mark as sent' : 'Reject payout')) return;
    _poBusy=true;
    const btns=[...host.querySelectorAll('[data-po-paid],[data-po-rej]')];
    btns.forEach(b=>{ b.disabled=true; });
    if(say) say.textContent='Working\u2026';
    const base=apiBase()||'';
    const tok=($('fd-token')&&$('fd-token').value||'').trim()||((typeof _adminToken==='function')?_adminToken():'');
    try{
      const r=await fetchDeadline(base.replace(/\/$/,'')+'/admin/payouts/mark',{
        method:'POST', headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
        body:JSON.stringify({ id, status })},15000);
      const d2=await r.json().catch(()=>({}));
      if(!r.ok||!d2.ok){ if(say) say.textContent = d2.error || 'That did not go through - nothing was changed.'; return; }
      if(say) say.textContent = status==='paid' ? 'Marked paid.' : 'Rejected, and the money is back with the seller.';
      _loadPayouts();
    }catch(e){ if(say) say.textContent='Could not reach the backend - nothing was changed.'; }
    finally{
      _poBusy=false;
      /* Re-enable only the ones still on screen: a successful settle repaints
         the card, and these nodes are gone. */
      btns.forEach(b=>{ if(b.isConnected) b.disabled=false; });
    }
  };
  host.querySelectorAll('[data-po-paid]').forEach(b=>on(b,'click',()=>settle(b.dataset.poPaid,'paid')));
  host.querySelectorAll('[data-po-rej]').forEach(b=>on(b,'click',()=>settle(b.dataset.poRej,'rejected')));
}
try{ window._loadPayouts=_loadPayouts; }catch(e){}
/* Reported listings, next to the payouts they sit beside in kind: both are
   things somebody has to DO something about, and both were invisible before
   there was a screen for them. This one exists because the marketplace policy
   told buyers their reports were reviewed by a team, and until the route
   behind it was built there was nothing to review and nobody to review it. */
function _reportsCardHTML(){
  return '<div class="ss2" id="fd-reports"><h3>Reported listings</h3>'+
    '<div class="fd-loading">Checking what has been reported\u2026</div></div>';
}
async function _loadReports(){
  const host=$('fd-reports'); if(!host) return;
  const base=apiBase()||'';
  const tok=($('fd-token')&&$('fd-token').value||'').trim()||((typeof _adminToken==='function')?_adminToken():'');
  if(!base||!tok){ host.innerHTML='<h3>Reported listings</h3><div class="fd-empty">Enter your admin token to see what has been reported.</div>'; return; }
  try{
    const r=await fetchDeadline(base.replace(/\/$/,'')+'/admin/reports',{headers:{'Authorization':'Bearer '+tok}},15000);
    const d=await r.json().catch(()=>({}));
    if(r.status===403) _forgetRejectedAdminToken();
    if(!r.ok||!d.ok){ host.innerHTML='<h3>Reported listings</h3><div class="fd-empty">'+(r.status===403?'That admin token was rejected. Enter the current one to try again.':'Could not load reports.')+'</div>'; return; }
    _reportsPaint(host, d);
  }catch(e){ host.innerHTML='<h3>Reported listings</h3><div class="fd-empty">Could not reach the backend, so this would be out of date.</div>'; }
}
function _reportsPaint(host, d){
  const list=d.reports||[];
  const when=(t)=>t?new Date(t).toLocaleDateString():'';
  const rows=list.map(r=>
    '<div class="rp-row">'+
      '<div class="rp-main">'+
        '<div class="rp-title">'+escH(r.title||r.itemId||'')+'</div>'+
        '<div class="rp-sub">'+escH(r.seller||'unknown seller')+' \u00b7 '+escH((r.reasons||[]).join(', '))+' \u00b7 '+escH(when(r.lastAt))+'</div>'+
        ((r.notes||[]).length?'<div class="rp-note">'+escH(String(r.notes[0]).slice(0,220))+'</div>':'')+
      '</div>'+
      '<div class="rp-count'+((r.count||0)>=(d.autoHideAt||3)?' hot':'')+'">'+(r.count||0)+'</div>'+
    '</div>').join('');
  host.innerHTML='<h3>Reported listings</h3>'+
    '<div class="rp-total'+(list.length?' hot':'')+'">'+(d.openCount||0)+' open'+
      '<span class="rp-sub2">hidden automatically at '+(d.autoHideAt||3)+' reports from different people</span></div>'+
    (rows||'<div class="fd-empty">Nothing has been reported.</div>')+
    (d.truncated?'<div class="rp-fine">More reports exist than this screen reads, so this is the busiest part of a longer list.</div>':'');
}
try{ window._loadReports=_loadReports; }catch(e){}


/* AMV-081: the weekly digest, on the one screen that already holds the admin
   token. Preview shows exactly what would be sent; sending is a separate,
   explicit action because it puts a message in someone's inbox. */
function _digestCardHTML(){
  return '<div class="ss2" style="margin-top:16px"><h3>Weekly digest</h3>'+
    '<p style="font-size:var(--t-sm);color:var(--mu);line-height:1.6;margin:-4px 0 12px">'+
      'These figures are emailed to the owner once a week, with the change since the week before. '+
      'It needs OWNER_EMAIL and an email provider configured on the Worker.</p>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn bs" id="fd-digest-preview" type="button" style="font-size:var(--t-sm)">Preview this week</button>'+
      '<button class="btn bs" id="fd-digest-send" type="button" style="font-size:var(--t-sm)">Send it now</button>'+
    '</div>'+
    '<div id="fd-digest-out" class="fd-digest-out" role="status" aria-live="polite"></div>'+
  '</div>';
}
function _wireDigestCard(){
  /* RESOLVED WHEN IT IS WRITTEN TO, FOR THE SAME REASON THE TOKEN IS.

     This captured the output node once, when the card was wired. The business
     tab re-renders itself with `el.innerHTML = ...` - on a stats refresh, or
     on leaving and coming back - which detaches that node and puts a fresh
     empty one in its place. A preview in flight across a re-render then wrote
     its answer into the detached one: the request succeeded, the digest was
     built, and it landed somewhere no longer on the page. From the outside the
     button did nothing at all.

     The comment two lines down was already careful about exactly this for the
     admin token, and this element had the same problem and no guard. */
  const say = (t, kind) => {
    const out = $('fd-digest-out');
    if(out){ out.className = 'fd-digest-out' + (kind ? ' ' + kind : ''); out.textContent = t; }
  };
  /* Read at click time, not captured when the card was built - the operator may
     correct the token after this card exists. */
  const call = async (qs) => {
    const base = apiBase()||'';
    const tok = ($('fd-token') && $('fd-token').value || '').trim()
      || ((typeof _adminToken==='function') ? _adminToken() : '');
    if(!base) throw new Error('connect your backend first');
    if(!tok) throw new Error('enter your admin token above');
    const r = await fetchDeadline(base.replace(/\/$/,'')+'/admin/digest'+qs,
      { headers:{ 'Authorization':'Bearer '+tok } }, 20000);
    const d = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error || ('failed ('+r.status+')'));
    return d;
  };
  on($('fd-digest-preview'),'click', async ()=>{
    say('Loading\u2026');
    try{
      const d = await call('');
      // The plain-text version IS what gets sent, so showing it is not a mock-up.
      say(d.subject + '\n\n' + d.text);
    }catch(e){ say('Could not build the digest: ' + e.message, 'bad'); }
  });
  on($('fd-digest-send'),'click', async ()=>{
    /* Outward-facing: it puts mail in someone's inbox, so it is confirmed. */
    if(!await _askDestructive('Email this week\u2019s digest to the owner now?',
        'It goes to the owner\u2019s inbox immediately. Mail that has been sent cannot be recalled.',
        'Send it')) return;
    say('Sending\u2026');
    try{
      const d = await call('?send=1');
      say(d.sent ? 'Sent to the owner.' : ('Not sent: ' + (d.reason || 'unknown')), d.sent ? 'good' : 'bad');
    }catch(e){ say('Could not send: ' + e.message, 'bad'); }
  });
}

/* AMV-088: say when the per-account lists below are a sample. Reading them as
   totals is the mistake this exists to prevent. */
function _scanNoteHTML(d){
  const sc = d && d.scan;
  if(!sc || !sc.truncated) return '';
  return '<div class="fd-scan">'+escH(sc.note||'')+'</div>';
}

/* The connector catalogue entry for a waitlist slug, if it is one. */
function _fdApp(slug){
  try{ for(const c of _appCats()) for(const a of c.apps) if(a.slug===slug) return a; }catch(e){}
  return null;
}
/* Render the founder dashboard from the /v1/admin/stats payload. */
function _founderDashHTML(d){
  const fmt=n=>(n||0).toLocaleString();
  const money=n=>'$'+(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const sp=d.spend||{}, us=d.users||{}, rev=d.revenue||{}, mg=d.margin||{};
  const byPlan=us.byPlan||{};
  const spendPct=Math.min(100, sp.pctOfCap||0);
  const spendColor = spendPct>=90?'#ff4d4d':(spendPct>=70?'#e0b341':'var(--accent)');
  const rows=(d.topSpenders||[]).slice(0,12).map(u=>
    '<div class="fd-row"><span class="fd-row-email">'+_esc(u.email)+'</span><span class="fd-row-plan">'+u.plan+'</span><span class="fd-row-cost">'+money(u.monthCostUSD)+'</span></div>').join('')
    || '<div class="fd-row"><span style="color:var(--mu)">No usage yet.</span></div>';
  const estProfit=(rev.estMRR||0)-(mg.estMonthlyCost||0);
  return ''+
    _scanNoteHTML(d)+
    // hero metrics
    '<div class="fd-grid">'+
      '<div class="fd-card"><div class="fd-n">'+money(rev.estMRR)+'</div><div class="fd-l">Est. MRR</div><div class="fd-sub">'+money(rev.estARR)+' ARR</div></div>'+
      '<div class="fd-card"><div class="fd-n">'+fmt(us.paying)+'</div><div class="fd-l">Paying users</div><div class="fd-sub">'+fmt(us.total)+' total</div></div>'+
      '<div class="fd-card"><div class="fd-n">'+money(estProfit)+'</div><div class="fd-l">Est. gross profit / mo</div><div class="fd-sub">after AI cost '+money(mg.estMonthlyCost)+'</div></div>'+
      '<div class="fd-card"><div class="fd-n">'+money(sp.today)+'</div><div class="fd-l">AI spend today</div><div class="fd-sub">cap '+money(sp.cap)+'</div></div>'+
      /* Work actually done: actions on people's accounts AMV checked were done. */
      (d.outcomes?'<div class="fd-card"><div class="fd-n">'+fmt(d.outcomes.verified)+'</div><div class="fd-l">Actions confirmed done</div><div class="fd-sub">'+(d.outcomes.verifiedRatePct==null?'none yet this month':d.outcomes.verifiedRatePct+'% confirmed')+' \u00b7 '+fmt(d.outcomes.failed+d.outcomes.not_confirmed)+' failed \u00b7 '+fmt(d.outcomes.undone)+' undone</div></div>':'')+
    '</div>'+
    // spend bar + kill switch
    '<div class="ss2"><h3>Today\u2019s global spend</h3>'+
      '<div class="usage-bar"><div class="usage-bar-f" style="width:'+spendPct+'%;background:'+spendColor+'"></div></div>'+
      '<div class="usage-meta"><span>'+money(sp.today)+' of '+money(sp.cap)+' ('+spendPct+'%)</span><span>'+(sp.killed?'\u26D4 Service PAUSED':'\u2705 Service live')+'</span></div>'+
      '<button class="btn '+(sp.killed?'bp':'bs')+'" id="fd-kill" style="margin-top:12px;font-size:var(--t-sm)">'+(sp.killed?'Resume service':'Pause service (kill switch)')+'</button>'+
    '</div>'+
    // one part at a time (80-switches.js on the server; drawn by settings-panes.js)
    '<div class="ss2" id="fd-switches"><h3>Switch off one part</h3><div class="fd-sw-body fd-loading">Loading\u2026</div></div>'+
    // plan breakdown
    '<div class="ss2"><h3>Users by plan</h3><div class="fd-plans">'+
      ['free','pro','elite','ultra','custom'].map(p=>'<div class="fd-plan"><div class="fd-plan-n">'+fmt(byPlan[p]||0)+'</div><div class="fd-plan-l">'+p+'</div></div>').join('')+
    '</div></div>'+
    // top spenders (abuse / margin watch)
    '<div class="ss2"><h3>Top spenders this month <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(margin &amp; abuse watch)</span></h3>'+
      '<div class="fd-table"><div class="fd-row fd-head"><span>User</span><span>Plan</span><span>AI cost</span></div>'+rows+'</div>'+
    '</div>'+
    /* What to connect next: the apps people pressed Notify me on. */
    (function(){
      const ar=d.appRequests||{}, top=ar.top||[];
      return '<div class="ss2"><h3>Apps people asked for <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(Notify me - connect these next)</span></h3>'+
        '<div class="fd-table"><div class="fd-row fd-head"><span>App</span><span></span><span>People</span></div>'+
        (top.length ? top.slice(0,20).map(a=>{
            /* Once an app connects, the people who asked are told - by one press here. */
            const slug=String(a.app||'').replace(/^app-/,''), app=_fdApp(slug);
            return '<div class="fd-row"><span class="fd-row-email">'+_esc(app?app.name:slug)+'</span>'
              +'<span>'+(app&&app.how?'<button class="btn bs fd-tell" data-fd-tell="'+_esc(slug)+'" data-fd-name="'+_esc(app.name)+'" data-fd-n="'+(+a.people||0)+'">'+_esc(T('It connects now - tell them'))+'</button>':'')+'</span>'
              +'<span class="fd-row-cost">'+fmt(a.people)+'</span></div>';
          }).join('')
                    : '<div class="fd-row"><span style="color:var(--mu)">'+(ar.error?_esc(ar.error):'Nobody has asked yet.')+'</span></div>')+
        '</div>'+(ar.complete===false&&!ar.error?'<p class="fd-sub">A sample: there are more requests than one read covers.</p>':'')+
      '</div>';
    })();
}

// Leave settings and go back where you came from - the last screen that was
// not Settings, however many Settings sections were opened on the way.
function closeSettings(){
  let back=null;
  try{
    while(_NAV.stack.length){
      const e=_NAV.stack.pop();
      if(e && e.tab && e.tab!=='settings'){ back=e; break; }
    }
  }catch(e){}
  S.settingsPane=null;
  const tab=back ? back.tab : ((S._preSettingsTab && S._preSettingsTab!=='settings') ? S._preSettingsTab : 'chat');
  _NAV.popping=true;
  try{ setTab(tab); } finally { _NAV.popping=false; }
  try{ _navPaint(); }catch(e){}
}
try{ window.closeSettings=closeSettings; }catch(e){}

/* The mobile settings picker: a single button showing the current section,
   which opens a popup list. Hidden on desktop (the full sidebar shows there). */
function _curSetSection(){
  const admin=isAdmin()?ADMIN_SET_SECTIONS:[];
  const all=[...USER_SET_SECTIONS,...admin].filter(s=>s.id);
  return all.find(s=>s.id===_setPaneFor(S.settingsPane)) || all[0];
}
function _settingsPickerBtnHTML(){
  const s=_curSetSection(); if(!s) return '';
  return '<button class="set-picker" id="set-picker" type="button" aria-haspopup="true">'+
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+s.icon+'</svg>'+
    '<span class="set-picker-lbl">'+escH(T(s.label))+'</span>'+
    '<svg class="set-picker-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'+
  '</button>';
}
function _openSettingsPicker(){
  const r=$('ovr'); if(!r) return;
  const adminExtra=isAdmin()?[{group:'Operator'},...ADMIN_SET_SECTIONS]:[];
  const sections=[...USER_SET_SECTIONS,...adminExtra];
  const rows=sections.map(s=>{
    if(s.group!==undefined) return s.group?'<div class="setpick-group">'+escH(T(s.group))+'</div>':'';
    if(s.type==='div') return '';
    return '<button class="setpick-row '+(s.id===_setPaneFor(S.settingsPane)?'on':'')+'" data-setpick="'+s.id+'" data-lbl="'+escH([(s.label||''),T(s.label||'')].concat(s.find||[]).join(' ').toLowerCase())+'">'+
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+s.icon+'</svg>'+
      '<span>'+escH(T(s.label))+'</span></button>';
  }).join('');
  r.innerHTML='<div class="ov" id="setpick-bg"><div class="ob setpick-modal" style="max-width:460px">'+
    '<button class="oc" data-dact="closeOvr" aria-label="Close">×</button>'+
    '<h2 style="margin:0 0 12px;font-size:var(--t-xl)">Settings</h2>'+
    '<div class="set-search-wrap setpick-searchwrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'+
      '<input id="setpick-search" class="set-search" type="search" name="amv-settings-search" placeholder="Search settings…" autocomplete="off"></div>'+
    '<div class="setpick-list" id="setpick-list">'+rows+'</div></div></div>';
  onBackdrop($('setpick-bg'),closeOvr);
  r.querySelectorAll('[data-setpick]').forEach(b=>on(b,'click',()=>{
    S.settingsPane=b.dataset.setpick; closeOvr(); renderSettingsView();
    try{ const c=document.querySelector('.settings-content'); if(c) c.scrollTop=0; }catch(e){}
  }));
  // Filter as you type. No autofocus - opening straight to the keyboard was the
  // old complaint; the list is visible first, tap search only if you want it.
  const si=$('setpick-search');
  if(si) on(si,'input',()=>{
    const query=si.value.toLowerCase().trim();
    r.querySelectorAll('.setpick-row').forEach(row=>{ row.style.display=(!query||(row.dataset.lbl||'').includes(query))?'':'none'; });
    r.querySelectorAll('.setpick-group').forEach(g=>{ g.style.display=query?'none':''; });
  });
}
window._openSettingsPicker=_openSettingsPicker;

/* SETTINGS OPENS OVER YOUR WORK, NOT INSTEAD OF IT.

   Asked for: "when you click it, it opens in the middle", with search at the
   top of its list. It used to replace the page - the tab you were on vanished
   and Settings took the whole width. It is a centred panel now, drawn into its
   own layer on top of the page, which stays where it was underneath, dimmed.
   Still a tab as far as routing goes (#/settings, Back, Esc, every
   setTab('settings')), so nothing that opens or closes it had to change; the
   router removes the layer the moment any other tab is drawn. A phone gets the
   whole screen, as before. It closes on X or Esc, never a click beside it. */
let _setLayerFrom=null, _setLayerFresh=false;
const _SET_UNDER=['anav','abody','bottom-nav'];
/* Which section a search finds, and by what: its own name first, else the
   first of its contents the words typed name ("dark mode" finds Appearance by
   "dark"). Null when it is not about that at all. */
function _setSearchHit(s,q){
  if(!q) return {};
  const lbl=(s.label||'').toLowerCase(), tl=String(T(s.label||'')).toLowerCase();
  if(lbl.includes(q) || tl.includes(q)) return {};
  const k=(s.find||[]).find(f=>f.includes(q) || (q.length>=3 && q.includes(f)));
  return k ? {by:k} : null;
}
function _settingsLayer(){
  let host=$('set-modal');
  if(!host){
    host=document.createElement('div');
    host.id='set-modal'; host.className='set-modal';
    host.setAttribute('role','dialog'); host.setAttribute('aria-modal','true'); host.setAttribute('aria-label','Settings');
    /* A dialog takes the keyboard with it and gives it back: focus goes into
       the panel when it opens and returns to whatever opened it on close. */
    _setLayerFrom=document.activeElement; _setLayerFresh=true;
    ($('app')||document.body).appendChild(host);
    try{ document.body.classList.add('set-open'); }catch(e){}
    /* The page underneath is a picture while the panel is up: Tab and a
       screen reader stay inside the dialog instead of wandering behind it. */
    _SET_UNDER.forEach(id=>{ const e=$(id); if(e) e.inert=true; });
    /* Opened straight from a link there is no page under it yet: draw the chat
       home there, so the panel is over AMV and not over nothing. */
    try{ const v=$('vc'); if(v && !v.firstElementChild && typeof renderChatView==='function') renderChatView(); }catch(e){}
  }
  return host;
}
function _settingsLayerClose(){
  const m=$('set-modal'); if(!m) return;
  m.remove();
  try{ document.body.classList.remove('set-open'); }catch(e){}
  _SET_UNDER.forEach(id=>{ const e=$(id); if(e) e.inert=false; });
  try{ const f=_setLayerFrom; _setLayerFrom=null; if(f && f.isConnected && f.focus) f.focus({preventScroll:true}); }catch(e){}
}
try{ window._settingsLayerClose=_settingsLayerClose; }catch(e){}
function renderSettingsView(){
  if(!$('vc')) return;
  /* Spending and investing have their own tab now, not a Settings section. An
     address that still asks for them - a link, an error message, an older
     build - opens that tab rather than landing on Account. */
  if(S.settingsPane==='spending' || S.settingsPane==='investing'){
    S.settingsPane=null;
    setTab('spend');
    return;
  }
  const vc=_settingsLayer();
  const adminExtra=isAdmin()?[{group:'Operator'},...ADMIN_SET_SECTIONS]:[];
  const visibleSections=[...USER_SET_SECTIONS,...adminExtra];
  const q=(S._setSearch||'').toLowerCase().trim();
  const navHtml=visibleSections.map(s=>{
    if(s.group!==undefined){
      if(q) return '';                       // hide group headers while searching
      return s.group?'<div class="sn-group">'+escH(s.group)+'</div>':'<div class="sn-div"></div>';
    }
    if(s.type==='div') return q?'':'<div class="sn-div"></div>';
    const hit=_setSearchHit(s,q);
    if(!hit) return '';   // filter
    return '<button class="sn-btn '+(s.id===_setPaneFor(S.settingsPane)?'on':'')+'" data-sp="'+s.id+'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+s.icon+'</svg>'+T(s.label)+
      (hit.by?'<span class="sn-hit" data-no-i18n>'+escH(hit.by)+'</span>':'')+'</button>';
  }).join('');
  const noMatch = q && !visibleSections.some(s=>s.id && _setSearchHit(s,q));
  vc.innerHTML=
    '<div class="settings-shell">'+
      '<button class="set-close" id="set-close" title="Close settings (Esc)" aria-label="Close settings">'+
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'+
        '<span class="set-close-lbl">Close</span>'+
      '</button>'+
      '<div class="settings-nav">'+
        _settingsPickerBtnHTML()+
        '<div class="set-search-wrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'+
          '<input id="set-search" class="set-search" type="search" name="amv-settings-search" placeholder="Search settings\u2026" value="'+escH(S._setSearch||'')+'" autocomplete="off">'+
        '</div>'+
        '<div class="settings-nav-list">'+navHtml+(noMatch?'<div class="sn-empty">No settings match \u201c'+escH(q)+'\u201d</div>':'')+'</div>'+
      '</div>'+
      '<div class="settings-content"><div class="set-pane" id="set-pane"></div></div>'+
    '</div>';
  vc.querySelectorAll('.sn-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const target=btn.dataset.sp;
      /* A section is a place too: Back from it returns to the one before. */
      try{ _navRecord(_navHere(), { tab:'settings', pane: target }); }catch(e){}
      S.settingsPane=target;
      vc.querySelectorAll('.sn-btn').forEach(b=>b.classList.toggle('on',b===btn));
      renderSetPane();
    });
  });
  // Mobile: the picker button opens the section list as a popup.
  on($('set-picker'),'click',_openSettingsPicker);
  // Close settings: the X button or Esc - never a stray click beside the panels.
  on($('set-close'),'click',closeSettings);
  const si=$('set-search');
  if(si){
    on(si,'input',()=>{ S._setSearch=si.value; const pos=si.selectionStart; renderSettingsView(); const s2=$('set-search'); if(s2){ s2.focus(); try{ s2.setSelectionRange(pos,pos); }catch(e){} } });
    // Enter opens the first section the search found.
    on(si,'keydown',e=>{ if(e.key==='Enter'){ const b=vc.querySelector('.sn-btn'); if(b){ e.preventDefault(); b.click(); } } });
  }
  renderSetPane();
  /* Search where the list is visible; on a phone, where the list is behind
     the picker, the picker - never a field that would raise the keyboard. */
  if(_setLayerFresh){
    _setLayerFresh=false;
    try{ const t=(si && si.offsetParent) ? si : ($('set-picker') && $('set-picker').offsetParent ? $('set-picker') : $('set-close')); if(t) t.focus({preventScroll:true}); }catch(e){}
  }
}

/* === SETTINGS PANE RENDERER === */

/* ---------------- Website Widget config pane (owner/admin) ----------------
   Loads the owner's widget config from the backend, lets them customize it,
   generates the copy-paste embed snippet, and (when saved) the widget goes
   live on their site. Requires the backend to be connected - the config and
   the public site key live server-side. */
let _WIDGET_CFG=null;
function _renderWidgetPane(pane){
  const live=!!(window.AMV_API && AMV_API.live && AMV_API.hasSession);
  const base=(apiBase()||'').replace(/\/+$/,'');
  if(!live){
    pane.innerHTML=
      '<h2 class="set-title">Website Widget</h2>'+
      '<div class="set-sub">Add an AMV chat bubble to any website with one line of code.</div>'+
      '<div class="wb">Connect your backend first (Settings \u2192 AI Connection and sign in). The widget\u2019s config and public key live on your server so it works securely on the open web.</div>';
    return;
  }
  pane.innerHTML=
    '<h2 class="set-title">Website Widget</h2>'+
    '<div class="set-sub">Add an AMV chat bubble to any website with one line of code. Your visitors chat with an AI you control - no account needed on their end.</div>'+
    '<div id="wg-body"><div class="lab-placeholder">Loading your widget\u2026</div></div>';

  const body=$('wg-body');
  (async()=>{
    let cfg=null;
    try{
      const r=await AMV_API._fetch('/v1/widget/config',{method:'POST',body:'{}'});
      const d=await r.json();
      if(d&&d.config) cfg=d.config;
    }catch(e){}
    if(!cfg){ body.innerHTML='<div class="wb">Couldn\u2019t load the widget config. Make sure your backend is deployed with the latest code, then reload.</div>'; return; }
    _WIDGET_CFG=cfg;
    if(!(await _widgetFormLoad())){ body.innerHTML='<div class="wb">'+escH(T('The widget settings could not be loaded. Check your connection and try again.'))+'</div>'; return; }
    window._paintWidgetForm(body, cfg, base);
  })();
}
/* The form lives in widget-form.js, fetched when this pane is first opened. */
let _widgetFormP = null;
function _widgetFormLoad(){
  if(typeof window._paintWidgetForm === 'function') return Promise.resolve(true);
  if(!_widgetFormP) _widgetFormP = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'widget-form.js';
    sc.onload = () => res(typeof window._paintWidgetForm === 'function');
    sc.onerror = () => { _widgetFormP = null; sc.remove(); res(false); };
    document.head.appendChild(sc);
  });
  return _widgetFormP;
}

/* Ask the server what is configured. Needs the admin token, because the shape
   of a deployment is operator information. */
/* A REJECTED TOKEN IS DROPPED, EVERYWHERE IT IS KEPT.

   Platform stats already did this. Go-live status, payouts and reports did
   not: they showed "rejected" and kept the token - in memory and in the
   dashboard's token field - so the next attempt sent the same one, and the
   box to paste another never came back. After rotating ADMIN_TOKEN that is a
   screen that can only ever say "rejected" until the tab is reloaded. */
function _forgetRejectedAdminToken(){
  try{ if(typeof _clearAdminToken==='function') _clearAdminToken(); }catch(e){}
  try{ const f=$('fd-token'); if(f) f.value=''; }catch(e){}
}
try{ window._forgetRejectedAdminToken=_forgetRejectedAdminToken; }catch(e){}
async function _loadReadiness(note){
  const host = $('golive-body'); if(!host) return;
  const base = apiBase()||'';
  const tok = ($('fd-token') && $('fd-token').value || '').trim()
    || ((typeof _adminToken==='function') ? _adminToken() : '');
  if(!base){ host.innerHTML = '<div class="gl-note">Connect your backend first (Settings \u2192 Live / Backend) and this reads your real configuration.</div>'; return; }
  if(!tok){
    /* Ask right here rather than sending the operator to another screen. This
       is the page they are on at the exact moment they are pasting secrets. */
    host.innerHTML =
      (note ? '<div class="gl-note" role="alert">'+escH(note)+'</div>' : '')+
      '<div class="gl-note">Your admin token reads this from the Worker. It is kept in memory for this tab only.</div>'+
      '<div class="adm-tokrow" style="margin-top:10px">'+
        '<label class="sr-only" for="gl-tok">Admin token</label>'+
        '<input id="gl-tok" type="password" autocomplete="new-password" class="inp" placeholder="Admin token">'+
        '<button class="btn bp" id="gl-tok-go" type="button">Check</button>'+
      '</div>';
    const go = () => {
      const v = ($('gl-tok') && $('gl-tok').value || '').trim();
      if(!v) return;
      try{ if(typeof _setAdminToken==='function') _setAdminToken(v); }catch(e){}
      _loadReadiness();
    };
    on($('gl-tok-go'),'click',go);
    on($('gl-tok'),'keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } });
    return;
  }
  try{
    const r = await fetchDeadline(base.replace(/\/$/,'')+'/admin/readiness', { headers:{ 'Authorization':'Bearer '+tok } }, 15000);
    const d = await r.json().catch(()=>({}));
    if(r.status===403){
      _forgetRejectedAdminToken();
      return _loadReadiness('That admin token was rejected. Paste the current value of ADMIN_TOKEN from Cloudflare - exactly, with no quotes or spaces.');
    }
    if(!r.ok || !d.ok){ host.innerHTML = '<div class="gl-note">'+escH(d.error||'Could not read your configuration.')+'</div>'; return; }
    host.innerHTML = _readinessHTML(d) +
      /* One real send, and the provider's own answer (adminEmailTest): the only
         way to tell an unverified sender from a spam folder. */
      /* Any address, not only the owner's: Gmail taking it says nothing about
         Outlook, Yahoo or iCloud, which check more - so each can be tried. */
      '<div class="gl-note gl-mailtest">'+
        '<label class="sr-only" for="gl-mailto">Send the test to</label>'+
        '<input id="gl-mailto" class="fp-in" type="email" autocomplete="email" placeholder="Any address - leave empty for yours">'+
        '<button class="btn bs" id="gl-mailtest" type="button">Send a test email</button>'+
      '</div>'+
      '<div id="gl-mailsay" class="gl-how" role="status" aria-live="polite"></div>';
    on($('gl-mailtest'),'click',async()=>{
      const say=$('gl-mailsay'); if(say) say.textContent='Sending\u2026';
      const to=(($('gl-mailto')||{}).value||'').trim();
      try{
        const r=await fetchDeadline(base.replace(/\/$/,'')+'/admin/email-test',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify(to?{to}:{})},20000);
        const x=await r.json().catch(()=>({}));
        let t = x.ok ? ('Sent to '+x.to+'. '+(x.hint||'')) : ((x.hint||x.error||'Not sent.')+(x.provider?' The provider said: '+x.provider:''));
        /* What Outlook, Hotmail and Yahoo look for on the sending domain. */
        const b=x.inboxes;
        if(b){
          const mark=v=>v===true?'\u2713':(v===false?'missing':'could not check');
          t+='\nEvery-inbox check for '+x.domain+': SPF '+mark(b.spf)+', DKIM '+mark(b.dkim)+', DMARC '+mark(b.dmarc)+'.';
          if(x.fixes && x.fixes.length) t+='\nTo fix: '+x.fixes.join('\n');
          else if(b.spf&&b.dkim&&b.dmarc) t+='\nAll three in place: every major inbox accepts it.';
        }
        if(say) say.textContent=t;
      }catch(e){ if(say) say.textContent='Could not reach your Worker.'; }
    });
  }catch(e){
    host.innerHTML = '<div class="gl-note">Could not reach your Worker, so this would be out of date. It will load when you are back online.</div>';
  }
}
try{ window._loadReadiness=_loadReadiness; }catch(e){}

function _readinessHTML(d){
  const rows = (list) => (list||[]).map(i =>
    '<div class="gl-row '+(i.on?'gl-done':(i.blocking?'gl-block':''))+'">'+
      '<span class="gl-ic">'+(i.on?'\u2713':'\u25CB')+'</span>'+
      '<div class="gl-body">'+
        '<div class="gl-label">'+escH(i.name)+
          (i.on?' <span class="gl-tag">live</span>'
              :' <span class="gl-tag '+(i.blocking||(i.problem&&!i.tag)?'req':'off')+'">'+escH(i.tag||(i.problem?'refused':(i.blocking?'required':'not set up')))+'</span>')+
        '</div>'+
        /* Set, and still not working: the provider's own words, ahead of
           the description, because they are the thing to act on. */
        (i.problem?'<div class="gl-how gl-problem" role="status">'+escH(i.problem)+'</div>':'')+
        '<div class="gl-how">'+escH(i.turnsOn)+'</div>'+
        (i.on?'':'<code class="gl-cmd">'+escH(i.how)+'</code>')+
      '</div>'+
    '</div>').join('');
  /* GROUPED, BECAUSE THIRTY-SIX ROWS IN ONE COLUMN IS A WALL.

     The screen used to carry sixteen and read as a list. Every capability the
     Worker can actually switch on has a row now, and an undivided list that
     long is one somebody scrolls past rather than reads - so the money rows,
     the delivery rows and the sign-in rows each get their own heading.

     The server sends the heading order, because it is the server that decides
     which group each row belongs to. A group the server names but sends no
     rows for is skipped rather than rendered empty, and any row whose group
     this browser does not recognise still appears under its own heading rather
     than being dropped - a row that renders in the wrong place is a smaller
     failure than a capability that silently is not on the screen at all. */
  const grouped = (list) => {
    const byGroup = new Map();
    (list||[]).forEach(i => {
      const g = i.group || 'Other';
      if(!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(i);
    });
    const order = (d.groupOrder||[]).slice();
    byGroup.forEach((_, g) => { if(order.indexOf(g)<0) order.push(g); });
    return order.filter(g => byGroup.has(g)).map(g =>
      '<div class="gl-sec">'+escH(g)+'</div>'+rows(byGroup.get(g))).join('');
  };
  /* Knobs with working defaults. Reported as "using the default" rather than
     as off, because a red row for a deployment behaving exactly as intended is
     how a screen full of red teaches somebody to stop reading it. The VALUE is
     never shown - a spend ceiling is not a secret, but a screen that prints one
     env var's value is one that will print the next one's. */
  const tune = (d.tuning||[]).map(t =>
    '<div class="gl-tune">'+
      '<div class="gl-label">'+escH(t.name)+
        ' <span class="gl-tag '+(t.set?'':'off')+'">'+(t.set?'set':'default')+'</span></div>'+
      '<div class="gl-how">'+escH(t.effect)+'</div>'+
      '<code class="gl-cmd">wrangler secret put '+escH(t.env)+'</code>'+
    '</div>').join('');
  const s = d.summary || {};
  return '<div class="gl-verdict '+(s.blockingMissing?'bad':'good')+'">'+escH(s.verdict||'')+
           ' <span class="gl-count">'+(s.on||0)+' of '+(s.total||0)+' configured</span></div>'+
         grouped(d.items)+
         '<div class="gl-sec">Storage bindings</div>'+
         rows(d.storage)+
         (tune ? '<div class="gl-sec">Settings with a working default</div>'+tune : '');
}

