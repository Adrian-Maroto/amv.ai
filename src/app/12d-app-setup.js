/* === APP SETUP === */
function setupApp(){
  // -- Icon Rail wiring --
  // Logo does nothing (avoids confusing "signout" feeling)
  on($('tsb'),'click',toggleSb); // tsb toggles hist-drawer
  on($('nav-back'),'click',()=>{ navBack(); });
  try{ _navPaint(); }catch(e){}
  on($('theme-btn'),'click',function(){
    document.body.classList.toggle('light');
    saveStr('amv_theme',document.body.classList.contains('light')?'light':'dark');
  });
  on($('nav-av'),'click',function(e){ e.stopPropagation(); showProfMenu(this); });

  // All data-tab buttons in icon rail - includes the bottom-left tools row
  document.querySelectorAll('.snb[data-tab], .sb-tool[data-tab]').forEach(btn=>{
    on(btn,'click',()=>{ if(!btn.dataset.tab) return;
      /* Pressing the Build entry means "show me the list", never "put me back
         in what I had open". Every other tab is unaffected. */
      if(btn.dataset.tab==='build' && typeof buildHome==='function') buildHome();
      if(btn.dataset.tab==='chat'){ openFreshChat(); return; }
      setTab(btn.dataset.tab); });
  });
  on($('hist-search'),'input',renderHist);
  /* The pressed state is one attribute rather than an inline colour, so what
     the eye sees and what a screen reader announces cannot drift apart. */
  on($('star-filter'),'click',()=>{
    S.starFilter=!S.starFilter;
    const b=$('star-filter');
    if(b){
      b.setAttribute('aria-pressed', S.starFilter?'true':'false');
      const lbl = S.starFilter ? 'Showing starred chats only. Show all chats' : 'Show starred chats only';
      b.setAttribute('title', lbl); b.setAttribute('aria-label', lbl);
    }
    renderHist();
  });
  /* The sidebar's own profile button is gone: it opened the same menu as the
     avatar at the top right, and the space it took is Recents' now. */

  /* The history drawer and the canvas button were replaced by the sidebar and
     the composer toolbar. Their handlers stayed, binding to elements that no
     longer exist - silently, which is exactly how the Admin tab became
     unreachable and went unnoticed for months. Removed rather than kept as
     no-ops that read like live wiring. */
  on($('kb-btn'),'click',()=>openShortcuts());
  // Star filter
  // Sidebar nav tabs
  document.querySelectorAll('.snb[data-tab]').forEach(btn=>{
    on(btn,'click',()=>{ if(!btn.dataset.tab) return;
      /* Pressing the Build entry means "show me the list", never "put me back
         in what I had open". Every other tab is unaffected. */
      if(btn.dataset.tab==='build' && typeof buildHome==='function') buildHome();
      if(btn.dataset.tab==='chat'){ openFreshChat(); return; }
      setTab(btn.dataset.tab); });
  });
  // History search
  on($('hist-search'),'input',renderHist);
  // File input
  on($('fi'),'change',function(){ if(this.files.length) handleFiles(this.files); this.value=''; });
  // Global delegation for data-gs (go to settings pane) buttons
  document.addEventListener('click',e=>{
    const gs=e.target.closest('[data-gs]');
    if(gs) { e.stopPropagation(); goSettings(gs.dataset.gs); return; }
    const da=e.target.closest('[data-dact]');
    if(da) { e.stopPropagation(); const fn=da.dataset.dact,arg=da.dataset.darg; if(fn==='askAmv')askAmv(); else if(fn==='toastInfo')toastInfo(arg); else if(window[fn])window[fn](arg); return; }
    const st=e.target.closest('[data-stab]');
    if(st) { e.stopPropagation(); setTab(st.dataset.stab); return; }
    const au=e.target.closest('[data-auth]');
    if(au) { e.stopPropagation(); openAuth(au.dataset.auth); return; }
  });
  // Sidebar history context menu via delegation
  on($('hist'),'contextmenu',e=>{
    e.preventDefault();
    const item=e.target.closest('[data-cid]');
    if(item) showConvMenu(e, item.dataset.cid);
  });
  // History action buttons via delegation
  on($('hist'),'click',e=>{
    const btn=e.target.closest('[data-hact]');
    if(!btn) return;
    e.stopPropagation();
    const id=btn.dataset.hid, act=btn.dataset.hact;
    if(act==='star') starConv(id);
    else if(act==='rename') renameConv(id);
    else if(act==='del') deleteConv(id);
  });
}

/* === MISSING CRITICAL FUNCTIONS === */

/* -- Navigation helpers -- */
function goSettings(pane){ S.settingsPane=pane; setTab('settings'); }
/* The owner console is fetched the first time it is opened. The screen says
   it is loading, and says so plainly if the file cannot be reached. */
let _adminP = null;
function _loadAdmin(){
  if(typeof window.renderAdminView === 'function') return Promise.resolve(true);
  if(_adminP) return _adminP;
  _adminP = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'admin.js';
    s.onload = () => res(typeof window.renderAdminView === 'function');
    s.onerror = () => { _adminP = null; s.remove(); res(false); };
    document.head.appendChild(s);
  });
  return _adminP;
}
function _openAdmin(){
  const vc = $('vc');
  if(vc && typeof window.renderAdminView !== 'function') vc.innerHTML = '<div class="sv fi"><div class="vi"><p class="vsub">'+escH(T('Opening the console…'))+'</p></div></div>';
  _loadAdmin().then(ok => {
    if(S.tab !== 'admin') return;
    if(ok){ window.renderAdminView(); return; }
    if(vc) vc.innerHTML = '<div class="sv fi"><div class="vi"><p class="vsub">'+escH(T('The console could not be loaded. Check your connection and try again.'))+'</p>'
      +'<button type="button" class="btn bs" data-dact="_openAdmin">'+escH(T('Try again'))+'</button></div></div>';
  });
}
try{ window._openAdmin=_openAdmin; }catch(e){}
function askAmv(){ setTab('chat'); setTimeout(()=>{ const ta=document.getElementById('mta'); if(ta){ta.value='I need help with: ';ta.focus();} },150); }
/* In-app feedback: bug reports & feature suggestions. Stored locally and surfaced
   to the operator in the admin, and sent to a support email/endpoint if configured. */
function openFeedback(kind){
  kind=(kind==='idea')?'idea':'bug';
  const ovr=$('ovr'); if(!ovr) return;
  const isBug=kind==='bug';
  ovr.innerHTML=
    '<div class="fb-modal">'+
      '<div class="fb-title">'+(isBug?'Report a bug':'Suggest a feature')+'</div>'+
      '<p class="fb-sub">'+(isBug?'What went wrong? The more detail, the faster we can fix it.':'What would make AMV better for you?')+'</p>'+
      '<div class="fb-types"><button class="fb-type'+(isBug?' on':'')+'" data-fbk="bug">\uD83D\uDC1E Bug</button><button class="fb-type'+(!isBug?' on':'')+'" data-fbk="idea">\uD83D\uDCA1 Idea</button></div>'+
      '<textarea id="fb-text" class="inp" rows="5" placeholder="'+(isBug?'When I click\u2026 I expected\u2026 but instead\u2026':'It would be great if AMV could\u2026')+'"></textarea>'+
      '<input id="fb-email" class="inp" style="margin-top:10px" placeholder="Your email (optional - so we can follow up)" value="'+escH((S.user&&S.user.email)||'')+'">'+
      '<div class="fb-actions"><button class="btn bs" id="fb-cancel">Cancel</button><button class="btn bp" id="fb-send">Send feedback</button></div>'+
    '</div>';
  ovr.classList.add('on');
  let curKind=kind;
  ovr.querySelectorAll('[data-fbk]').forEach(b=>on(b,'click',()=>{ curKind=b.dataset.fbk; ovr.querySelectorAll('.fb-type').forEach(x=>x.classList.remove('on')); b.classList.add('on'); }));
  on($('fb-cancel'),'click',closeOvr);
  on($('fb-send'),'click',async ()=>{
    const text=($('fb-text')?$('fb-text').value:'').trim();
    if(!text){ $('fb-text')&&$('fb-text').focus(); return; }
    const btn=$('fb-send');
    if(btn){ btn.disabled=true; btn.textContent='Sending\u2026'; }
    const res=_submitFeedback(curKind, text, ($('fb-email')?$('fb-email').value.trim():''));

    /* IT SAID "SENT TO THE TEAM" AND NOTHING LEFT THE DEVICE.

       _submitFeedback wrote to localStorage and only transmitted if
       `amv_feedback_endpoint` was set - a key no screen in the product could
       write. /v1/feedback is the thumbs up/down counter, which deliberately
       stores no content and would have refused a sentence. So somebody
       reporting a broken payment was thanked, told the team had it, and their
       report sat in their own browser for ever.

       Saying so instead of lying was the first fix and left the real problem:
       a product taking money with no way to be told it is broken. /v1/support
       is that way. It answers what actually happened - stored, and separately
       whether it reached a person - so this can still only claim what is
       true. */
    let sent=null;
    try{ sent = await AMV_API.support(curKind, text, { plan: loadStr('amv_plan')||'free', tab: S.tab }); }
    catch(e){ sent = { error: e && e.message }; }
    closeOvr();

    if(sent && sent.ok && sent.notified){
      toast('Thank you - your report is with the team.','success',4000);
    } else if(sent && sent.ok){
      /* It IS on the server and an operator will see it in the inbox; what we
         cannot promise is that anybody was paged about it tonight. */
      toast('Thank you - your report was received.'+(_supportEmail()?' If it is urgent, email '+_supportEmail()+' as well.':''),'success',6000);
    } else if(_supportEmail()){
      toast('That could not be sent'+(sent&&sent.error?' ('+sent.error+')':'')+'. It is saved on this device - to reach a person now, email '+_supportEmail()+'.','info',9000);
    } else {
      toast('That could not be sent, so it is saved on this device only and nobody has seen it. AMV has no support address configured - ask the operator to set one.','info',9000);
    }
    void res;
  });
}
/* Returns what actually happened, so the caller cannot thank somebody for a
   delivery that did not occur. */
function _submitFeedback(kind, text, email){
  const out={ stored:false, delivered:false };
  try{
    const entry={ id:'fb'+Date.now(), kind, text, email, ts:Date.now(),
      context:{ tab:S.tab, plan:loadStr('amv_plan')||'free', lang:_lang(), ua:navigator.userAgent.slice(0,120) } };
    // store locally (ring buffer) for the operator's admin view
    let list=[]; try{ list=JSON.parse(loadStr('amv_feedback')||'[]'); }catch(e){}
    list.unshift(entry); if(list.length>200) list.length=200;
    saveStr('amv_feedback', JSON.stringify(list));
    out.stored=true;
    try{ track('feedback_submitted',{kind}); }catch(e){}
    // send to the operator's endpoint if there is one. sendBeacon returns
    // false when the browser refuses to queue it, which is the only signal
    // available here - and it is more than was being read before.
    const ep=loadStr('amv_feedback_endpoint');
    if(ep){ try{ out.delivered=!!navigator.sendBeacon(ep, JSON.stringify(entry)); }catch(e){} }
  }catch(e){ _logErr('submitFeedback',e); }
  return out;
}
try{ window.openFeedback=openFeedback; }catch(e){}
/* Changelog / What's New - transparent product updates. Newest first. */
const CHANGELOG=[
  { v:'2.5', date:'2026-10-04', title:'Settings, Team and staying in touch', items:[
    'Settings opens in the middle of the screen, over your work, with search that finds a setting by what it does',
    'Team is one plan for organisations: a price per person, monthly or yearly, with roles and one bill',
    'Email me when AMV is done - for long answers and builds you walk away from',
    'More room for your chats: the account menu is the avatar at the top right, and the status line only appears when something is wrong',
    'Crew opens noticeably faster on phones' ] },
  { v:'2.4', date:'2026-01-15', title:'Share, install, and export', items:[
    'Share any conversation with a private read-only link',
    'Install AMV as an app on your phone or desktop (PWA)',
    'Export all your data anytime from Settings \u2192 Privacy',
    'In-app bug reports and feature suggestions in the Help Center' ] },
  { v:'2.3', date:'2026-01-08', title:'Speaks your language', items:[
    'Full interface translation across 17 languages',
    'Automatic language detection on first visit',
    'Right-to-left support for Arabic and Urdu' ] },
  { v:'2.2', date:'2026-01-02', title:'Smarter billing & usage', items:[
    'In-app invoice history and payment management',
    '14-day activity trend on your Usage dashboard',
    'Clearer plan limits with contextual upgrade prompts' ] },
  { v:'2.1', date:'2025-12-20', title:'Crew works while you sleep', items:[
    'Standing jobs - schedule AMV to email you news, reports and summaries',
    'Approval queue so nothing sends without your OK',
    'A refreshed, friendlier design across the whole app' ] },
];
function _latestVersion(){ return CHANGELOG.length?CHANGELOG[0].v:''; }
function _whatsNewUnread(){ try{ return (loadStr('amv_changelog_seen')||'')!==_latestVersion(); }catch(e){ return false; } }
/* The unread dot is drawn with the account menu each time it opens
   (_whatsNewUnread), so there is no standing element to keep in step. The
   avatar carries it too, so an unread note is visible before the menu is. */
function _checkWhatsNew(){
  try{ const av=$('nav-av'); if(av) av.classList.toggle('has-news', _whatsNewUnread()); }catch(e){}
}
function openWhatsNew(){
  const ovr=$('ovr'); if(!ovr) return;
  ovr.innerHTML=
    '<div class="wn-modal">'+
      '<div class="wn-head"><div class="wn-title">What\u2019s New</div><button class="wn-close" id="wn-close" aria-label="close">\u00d7</button></div>'+
      '<div class="wn-list">'+CHANGELOG.map(r=>
        '<div class="wn-rel"><div class="wn-rel-head"><span class="wn-ver">v'+escH(r.v)+'</span><span class="wn-date">'+new Date(r.date+'T00:00:00').toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})+'</span></div>'+
        '<div class="wn-rel-title">'+escH(r.title)+'</div>'+
        '<ul class="wn-items">'+r.items.map(i=>'<li>'+escH(i)+'</li>').join('')+'</ul></div>'
      ).join('')+'</div>'+
    '</div>';
  ovr.classList.add('on');
  on($('wn-close'),'click',closeOvr);
  // mark newest as seen → clears the notification dot
  try{ saveStr('amv_changelog_seen', _latestVersion()); }catch(e){}
  _checkWhatsNew();
}
try{ window.openWhatsNew=openWhatsNew; }catch(e){}

/* -- Cookie consent -- */
function accCk(){ localStorage.setItem('amv_ck','1'); const ck=document.getElementById('ck'); if(ck)ck.remove(); }

/* Two buttons did two things each, written as a semicolon in an onclick
   attribute. Named, so the delegated dispatcher can run them and so the script
   CSP does not have to allow inline script for the sake of one comma. */
function _acceptCookies(){ accCk(); closeOvr(); }
function _closeThenPrivacy(){ closeOvr(); openPrivacy(); }
try{ window._acceptCookies=_acceptCookies; window._closeThenPrivacy=_closeThenPrivacy; }catch(e){}

function renderCk(){
  if(localStorage.getItem('amv_ck')) return;
  const div=document.createElement('div');
  div.id='ck';
  div.innerHTML='<p>We use essential cookies to keep you signed in. By continuing you agree to our <button class="ckl" data-dact="openTerms">Terms</button> and <button class="ckl" data-dact="openPrivacy">Privacy Policy</button>.</p>'+
    '<div style="display:flex;gap:7px;flex-shrink:0"><button class="btn bp" id="ck-acc" style="padding:5px 13px;font-size:var(--t-sm)">Accept</button><button class="btn bs" id="ck-nec" style="padding:5px 11px;font-size:var(--t-sm)">Necessary Only</button></div>';
  document.body.appendChild(div);
  document.getElementById('ck-acc')?.addEventListener('click',accCk);
  document.getElementById('ck-nec')?.addEventListener('click',accCk);
}

/* WHEN THESE DOCUMENTS TOOK EFFECT.

   Both said `Effective ' + new Date().toLocaleDateString()`, so the date was
   whatever day you happened to open them. That is not a formatting nicety: the
   Privacy Policy's own section 9 promises "material changes will be noted with
   a new effective date", and a date that moves every day makes that promise
   impossible to keep or to check. Somebody trying to work out whether the terms
   changed since they agreed has nothing to compare.

   A constant, bumped by hand when the text below materially changes - which is
   the only thing an effective date can honestly mean. */
const LEGAL_EFFECTIVE = '2026-08-05';
function _legalEffective(){
  try{ return new Date(LEGAL_EFFECTIVE + 'T00:00:00').toLocaleDateString(undefined,
        { year:'numeric', month:'long', day:'numeric' }); }
  catch(e){ return LEGAL_EFFECTIVE; }
}
try{ window._legalEffective=_legalEffective; }catch(e){}

/* -- Terms & Privacy modal -- */
function openTerms(){
  const r=document.getElementById('ovr'); if(!r) return;
  r.innerHTML=
    '<div class="ov" id="terms-bg"><div class="ob wide tall">'+
      '<button class="oc" data-dact="closeOvr">&#215;</button>'+
      '<h2>Terms of Service</h2>'+
      '<p class="ob-sub">Effective '+escH(_legalEffective())+' - please read carefully.</p>'+
      '<div class="ts">'+
        '<h4>1. Acceptance</h4>By using AMV.AI you agree to these terms. If you disagree, stop using the platform.'+
        /* ELIGIBILITY, WHICH THESE TERMS DID NOT STATE AT ALL.

           The Privacy Policy already says AMV is not directed to under-13s, so
           the product had a position on age in the document that explains data
           handling and none in the one that forms the agreement. Stated here
           to match it rather than inventing a second number.

           The payment line is not decoration. A minor cannot form a binding
           contract, which is the reason the compliance module gives for gating
           money at all - "which is exactly why a teenager's purchases come
           straight back as chargebacks" - and it is what _moneyAgeGate
           enforces on spending, buying and withdrawing.

           The family sentence is there because AMV actually supports it: a
           family manager pays, sets what may be spent, and decides whether
           that person can buy or withdraw. Terms that ignored it would be
           terms this product breaks on its own feature. */
        '<h4>2. Who may use AMV</h4>You must be at least 13 to use AMV.AI, and at least 16 where your country sets a higher minimum for online services. You must be 18 or older to buy a subscription, purchase anything in the marketplace, withdraw money, or let AMV spend on your behalf - a minor cannot enter a binding contract. If you are under 18 you may use AMV through a family manager who is over 18, has accepted these terms, pays, and controls what may be spent. We may suspend an account we believe is held by somebody below these ages.'+
        '<h4>3. Content Policy</h4>Prohibited: explicit sexual/pornographic content; child sexual abuse material (CSAM - all violations reported to NCMEC and law enforcement); content intended to harass or harm; impersonation for fraud; attempts to generate malware or facilitate illegal activity. We may suspend accounts that violate this policy.'+
        '<h4>4. Automation &amp; Connected Tools</h4>By enabling automation or connected features you grant AMV.AI permission to access the accounts and files you configure (e.g. browser, email, calendar), used solely for tasks you request. Revoke access in Settings at any time.'+
        '<h4>5. AI Disclaimer</h4>AI outputs may be inaccurate. Do not rely on AMV.AI for medical, legal, or financial decisions without independent professional verification. AMV.AI does not provide financial advice; scheduled research reports information only.'+
        '<h4>6. Payments &amp; Refunds</h4>Subscriptions are billed monthly by our payment processor and can be cancelled any time; access continues to the end of the paid period. Refunds are handled per our posted policy. Chargeback or refund abuse may result in account suspension.'+
        '<h4>7. Acceptable Use &amp; Limits</h4>Each plan includes usage limits. Automated scraping of the service, reselling access, or circumventing limits is prohibited.'+
        '<h4>8. Privacy</h4>Your use of AMV.AI is also governed by our <button class="lnk-inline" data-dact="_closeThenPrivacy">Privacy Policy</button>, which explains what we collect and how it is handled.'+
        '<h4>9. Contact</h4>'+(_supportEmail()?escH(_supportEmail()):'Contact support from the Help Center in the app.')+
      '</div>'+
      '<div style="display:flex;gap:9px"><button class="btn bp" data-dact="_acceptCookies" style="flex:1">I Accept</button><button class="btn bs" data-dact="closeOvr">Close</button></div>'+
    '</div></div>';
  onBackdrop($('terms-bg'),closeOvr);
}

/* Real, SEPARATE privacy policy - required to take payments (Stripe) and to
   comply with GDPR/CCPA. Written to be ACCURATE to how AMV actually works:
   server-side storage in Cloudflare, PBKDF2-hashed passwords, and the specific
   third parties that receive data. Keep this in sync if the stack changes. */
function openPrivacy(){
  const r=document.getElementById('ovr'); if(!r) return;
  const contact=_supportEmail()?escH(_supportEmail()):'the Help Center in the app';
  r.innerHTML=
    '<div class="ov" id="priv-bg"><div class="ob wide tall">'+
      '<button class="oc" data-dact="closeOvr">&#215;</button>'+
      '<h2>Privacy Policy</h2>'+
      '<p class="ob-sub">Effective '+escH(_legalEffective())+' - how AMV.AI handles your data.</p>'+
      '<div class="ts">'+
        '<h4>1. What we collect</h4>'+
          '<b>Account:</b> your name and email. '+
          '<b>Content:</b> the chats, projects, memory, and automations you create. '+
          '<b>Usage:</b> counts and timestamps of requests, for limits, billing, and abuse prevention. '+
          '<b>Payment:</b> handled entirely by our payment processor - we never see or store your full card number.'+
        '<h4>2. How we store it</h4>Your account and content are stored on Cloudflare\u2019s infrastructure (KV / D1) in encrypted transit and at rest. Passwords are never stored in plain text - they are salted and hashed with PBKDF2-SHA256 at current OWASP-recommended strength. Access tokens are short-lived and can be revoked.'+
        /* CATEGORIES, not the vendor's name. AMV is branded as AMV throughout,
           and naming the model provider in copy every visitor can open is the
           one place that leaked. GDPR Art. 13(1)(e) asks for "the recipients or
           categories of recipients" - categories are sufficient on their own,
           and the current list is offered on request, which is how a
           subprocessor list is normally maintained. Nothing is hidden: what
           leaves, why, and to what kind of company is all still stated. */
        '<h4>3. Who we share it with</h4>We do <b>not</b> sell your data. We share the minimum necessary with the providers that make the service work: '+
          'our <b>AI model provider</b> (processes your prompts to generate AI responses), '+
          '<b>Stripe</b> (payments), '+
          '<b>Resend</b> (transactional email such as password resets), and '+
          '<b>Twilio</b> (only if you enable text messaging). '+
          'If you sign in with Google, Google authenticates you. Each provider handles data under its own privacy terms. '+
          'For the current list of the specific companies in each category, contact us at '+contact+'.'+
        '<h4>4. What we do NOT do</h4>We do not sell or rent your data, do not show third-party ads, and do not use your private chats to train models.'+
        '<h4>5. Your rights</h4>You can access, export, or delete your data. Deleting your account removes your account record, content, and automations from our storage. To exercise these rights, use the controls in Settings or contact us at '+contact+'.'+
        '<h4>6. Data retention</h4>We keep your data while your account is active. Usage counters expire automatically. When you delete your account, your data is removed from active storage; residual copies in routine backups age out on their normal cycle.'+
        '<h4>7. Cookies &amp; local storage</h4>We use essential storage to keep you signed in and remember your preferences, and optional analytics only if you consent. You can change this any time in Settings.'+
        '<h4>8. Children</h4>AMV.AI is not directed to children under 13 (or the minimum age in your region), and we do not knowingly collect their data.'+
        '<h4>9. Changes &amp; contact</h4>We may update this policy; material changes will be noted with a new effective date. Questions: '+contact+'.'+
      '</div>'+
      '<div style="display:flex;gap:9px"><button class="btn bp" data-dact="closeOvr" style="flex:1">Got it</button></div>'+
    '</div></div>';
  onBackdrop($('priv-bg'),closeOvr);
}
try{ window.openPrivacy=openPrivacy; }catch(e){}

/* -- Auth modal -- */
function openAuth(mode){
  const r=document.getElementById('ovr'); if(!r) return;
  const isL=(mode==='login');
  r.innerHTML=
    '<div class="ov" id="auth-bg"><div class="ob">'+
      '<button class="oc" id="auth-x">&#215;</button>'+
      '<h2>'+(isL?'Welcome back':'Create your account')+'</h2>'+
      '<p class="ob-sub">'+(isL?'Sign in to your AMV.AI account.':'Free forever. No credit card required.')+'</p>'+
      '<div id="auth-err" class="ae"></div>'+
      '<div class="af">'+
        '<button class="gbtn" id="g-btn">'+
          '<svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>'+
          'Continue with Google'+
        '</button>'+
        /* A passkey: offered where the browser can make one sign in. */
        (isL && window.PublicKeyCredential ? '<button class="gbtn" id="pk-btn" type="button">'+escH(T('Sign in with a passkey'))+'</button>' : '')+
        '<div class="ord"><span>or</span></div>'+
        (!isL?'<div><label class="lbl">Full Name</label><input type="text" id="a-name" placeholder="Alex Johnson" autocomplete="name"></div>':'')+
        '<div><label class="lbl">Email</label><input type="email" id="a-email" placeholder="you@example.com" autocomplete="email"></div>'+
        '<div><label class="lbl">Password</label><input type="password" id="a-pass" placeholder="'+escH(isL?T('Your password'):T('At least 15 characters'))+'" autocomplete="'+(isL?'current-password':'new-password')+'"></div>'+
        // Honeypot: hidden from humans, bots fill it → server rejects. Not display:none
        // (some bots skip those); off-screen + aria-hidden + tab-skipped instead.
        '<div aria-hidden="true" style="position:absolute;left:-9999px;top:-9999px;height:0;overflow:hidden"><label>Company<input type="text" id="a-company" name="company" tabindex="-1" autocomplete="off"></label></div>'+
        '<div id="a-turnstile" class="cf-turnstile" style="margin:4px 0"></div>'+
        '<button class="btn bp" id="auth-submit" style="width:100%;padding:11px;font-size:var(--t-md)">'+(isL?'Sign In':'Create Free Account')+'</button>'+
      '</div>'+
      '<div class="asw">'+(isL?'No account? <button id="auth-sw">Sign up free</button>':'Already have an account? <button id="auth-sw">Sign in</button>')+'</div>'+
      (isL?'<div class="asw" style="margin-top:6px"><button id="auth-forgot" style="color:var(--mu)">Forgot password?</button></div>':'')+
      (isL?'<div class="asw" style="margin-top:6px"><button id="auth-sso">Sign in with your company</button></div>':'')+
      '<p class="an">By continuing you agree to our <button id="a-terms">Terms</button> and <button id="a-priv">Privacy Policy</button></p>'+
    '</div></div>';
  onBackdrop($('auth-bg'),closeOvr);
  document.getElementById('auth-x')?.addEventListener('click',_dismissOvr);
  document.getElementById('g-btn')?.addEventListener('click',triggerGoogle);
  document.getElementById('pk-btn')?.addEventListener('click',signInWithPasskey);
  document.getElementById('auth-submit')?.addEventListener('click',()=>isL?doLoginForm():doSignupForm());
  try{ _mountTurnstile(); }catch(e){}
  /* The sheet is open and "Continue with Google" is on screen, so this is the
     last moment the library can still be needed - and the first moment we know
     it is actually wanted. */
  try{ if(typeof _gauthStart==='function') _gauthStart(); }catch(e){}
  document.getElementById('auth-sw')?.addEventListener('click',()=>openAuth(isL?'signup':'login'));
  document.getElementById('auth-sso')?.addEventListener('click',()=>ssoBegin($('a-email')?.value));
  document.getElementById('auth-forgot')?.addEventListener('click',()=>{ const em=(document.getElementById('a-email')?.value||'').trim(); closeOvr(); openForgot(em); });
  document.getElementById('a-terms')?.addEventListener('click',()=>{closeOvr();openTerms();});
  document.getElementById('a-priv')?.addEventListener('click',()=>{closeOvr();openPrivacy();});
  document.getElementById('a-pass')?.addEventListener('keydown',e=>{if(e.key==='Enter')isL?doLoginForm():doSignupForm();});
  document.getElementById('a-email')?.addEventListener('keydown',e=>{if(e.key==='Enter')isL?doLoginForm():doSignupForm();});
}

/* SIGN IN WHERE YOU ARE, NOT "SIGN OUT AND BACK IN".

   A device can look signed in - the name in the corner, the chats on screen -
   while the server has no session for it: the renewal ran out after thirty
   days unused, or it was made by a build whose sign-in lost the cookie. Every
   screen then failed and told the owner to sign out and back in, which is two
   steps, the first of them pointless, and loses where they were.

   Now the page asks for the sign-in itself, with the email already filled in,
   the moment the server says there is no session (never on a network failure).
   Signing in keeps the tab they were on, keeps everything stored for the
   account, and runs what they were doing - a Connect carries straight on.

   Asked on its own at most once per page load, so dismissing it is respected;
   a press of something that needs the session (`explicit`) asks again. */
/* "SIGN IN TO CONTINUE", CLOSED WITHOUT SIGNING IN.

   The server has said this device's session is over. Closing the question used
   to leave the page exactly as it was - the name in the corner, the chats on
   screen - looking signed in to an account the server no longer recognises.
   Every reload asked again, because nothing had changed, and everything that
   needed the account failed one screen at a time.

   The way the large assistants handle an ended session is that it is ended:
   you are signed out, and signing in is one click away. So the person closing
   the question (its X, or Escape - see _dismissOvr) signs this device out
   properly. Run a tick after the close, so a step that replaces it is still
   the person deciding, and a sign-in that succeeded is left alone. */
function _sessionEndedSettle(){
  if(!_sessionEndedAsk) return;
  const o = document.getElementById('ovr');
  if(o && o.classList.contains('on') && o.innerHTML) return;
  _sessionEndedAsk = false;
  if(window.AMV_API && AMV_API.token && AMV_API.tokenValid()) return;
  if(!(S.user && S.user.email)) return;
  _askToSignInAgain.then = null;
  signOut();
  if(typeof toast === 'function') toast(T('Your sign-in had ended, so this device is now signed out. Sign in whenever you are ready.'), 'info', 6000);
}
function _askToSignInAgain(then, explicit){
  try{
    if(!(S.user && S.user.email)) return;
    const me = _askToSignInAgain;
    if(typeof then === 'function') me.then = { fn: then, email: S.user.email };
    if(document.getElementById('auth-bg')) return;
    if(me.asked && !explicit) return;
    me.asked = true;
    _sessionEndedAsk = true;
    openAuth('login');
    const h = document.querySelector('#auth-bg h2'); if(h) h.textContent = T('Sign in to continue');
    const sub = document.querySelector('#auth-bg .ob-sub');
    if(sub) sub.textContent = T('Your sign-in on this device has ended. Sign in and AMV carries on where you were - your chats and connected apps are kept.');
    const ef = document.getElementById('a-email'); if(ef) ef.value = S.user.email;
    const pf = document.getElementById('a-pass'); if(pf) setTimeout(()=>{ try{ pf.focus(); }catch(e){} }, 50);
  }catch(e){ try{ console.error('AMV: could not ask for a sign-in', e); }catch(_){} }
}
/* Run what the sign-in interrupted - only for the account that was asked for. */
function _afterSignInAgain(email){
  try{
    const me = _askToSignInAgain, t = me.then; me.then = null; me.asked = false;
    if(t && t.email === email) setTimeout(()=>{ try{ t.fn(); }catch(e){ console.error('AMV: could not resume after sign-in', e); } }, 250);
  }catch(e){}
}
try{ window._askToSignInAgain=_askToSignInAgain; window._afterSignInAgain=_afterSignInAgain; }catch(e){}

/* THE FIVE-STEP TOUR NOBODY EVER SAW.

   showIntro() had zero callers and so did goLand(). Every branch of the boot
   chain hid the intro, hid the landing, and went straight into the app - which
   is the deliberate funnel (sign-up is required at the first send, not before
   it), confirmed by the owner. So the tour, its five slides, its progress dots,
   its swipe handling and its own sign-up form were unreachable code that every
   visitor still downloaded.

   Removed rather than left as something that reads like a feature. What stays
   is _completeIntroLogin below: it is named for the intro and belongs to
   nothing of the sort - signup, sign-in and password reset all finish through
   it. Deleting this block wholesale would have taken sign-up with it. */

function _completeIntroLogin(acct){
  if(!acct) return;
  // Nothing from any previous account may survive into this one.
  try{ _wipeAccountState(); }catch(e){}
  S.user={name:acct.name,email:acct.email,ini:acct.ini,provider:acct.provider||'email'};
  store('amv_user',S.user);
  // Now load THIS account's own sessions/memory (scoped by email).
  try{ _loadSessions(); }catch(e){}
  try{ S.memory = load('amv_memory') || []; }catch(e){ S.memory=[]; }
  accCk();
  const ck=document.getElementById('ck'); if(ck)ck.remove();
  const uc=loadUserConvs(acct.email);
  if(uc&&uc.length){S.convs=uc;S.cur=_openingChatId(S.convs);}
  else{S.convs=[newConvObj()];S.cur=S.convs[0].id;}
  
  document.getElementById('land')?.classList.add('hidden');
  S.tab='chat';   // new sign-ins land straight in chat
  goApp();
  setTab('chat');
  // First-run activation. This lives in loginUser(), but signup comes through
  // HERE - so brand-new users (the only people who need it) never saw it.
  // Onboarding popup removed per product direction (looked intrusive on sign-in).
  try{ saveStr('amv_onboarded','1'); }catch(e){}
  // if they typed a message before signing up, send it now
  try{ _sendPendingMessage(); }catch(e){}
  /* And if they were part-way through buying a plan when they were asked for
     an account, put them back on it rather than landing them in chat with no
     sign that the thing they came for is still waiting. */
  try{ if(typeof _resumePendingUpgrade==='function') _resumePendingUpgrade(); }catch(e){}
}

/* -- Keyboard shortcuts --

   THE CHEAT SHEET PROMISED ⌘ AND ONLY Ctrl WAS LISTENED FOR.

   Every branch below tested `e.ctrlKey` alone. On a Mac that is the Control
   key, which nobody presses for an application shortcut - so ⌘⇧O, ⌘⇧L, ⌘B,
   ⌘, ⌘/ ⌘⇧D and ⌘⇧V all did nothing, while the shortcut sheet rendered them
   with ⌘ symbols because it detects the platform. Every shortcut in the
   product except the command palette was dead on macOS, and the one screen
   that documents them told Mac users exactly which dead key to press.

   The palette had it right already - 01-core tests `(e.metaKey||e.ctrlKey)`.
   `_mod` is that test, used everywhere, so Windows and Linux are unchanged and
   the Mac keys are the ones the sheet shows. */
function _mod(e){ return !!(e && (e.metaKey || e.ctrlKey)); }
try{ window._mod=_mod; }catch(e){}
function setupKeyboard(){
  document.addEventListener('keydown',e=>{
    const tag=document.activeElement?.tagName;
    const inInput=tag==='INPUT'||tag==='TEXTAREA'||document.activeElement?.contentEditable==='true';
    if(e.key==='Escape'){
      // In settings, Esc closes it and returns you to your work.
      if(S.tab==='settings' && !document.querySelector('.ovr.on, #ovr.on')){ e.preventDefault(); try{ closeSettings(); }catch(err){} return; }
      // While the AI is generating, Esc stops it (as chat apps do).
      if(S.busy){ e.preventDefault(); try{ stopGenerating(); }catch(err){} return; }
      if(!inInput){ const ta=document.getElementById('mta'); if(ta)ta.focus(); return; }
    }
    if(_mod(e)&&e.shiftKey&&(e.key==='O'||e.key==='o')){e.preventDefault();newChat();return;}
    if(_mod(e)&&!e.shiftKey&&(e.key==='b'||e.key==='B')&&!inInput){
      e.preventDefault();
      /* Ctrl+B toggled a history drawer that the sidebar replaced, so the
         shortcut had quietly done nothing. It toggles the sidebar, which is
         where the history actually is now. */
      try{ toggleSb(); }catch(_){}
      return;
    }
    if(_mod(e)&&e.shiftKey&&(e.key==='L'||e.key==='l')){e.preventDefault();document.body.classList.toggle('light');saveStr('amv_theme',document.body.classList.contains('light')?'light':'dark');return;}
    if(_mod(e)&&e.key===','){e.preventDefault();S.settingsPane='account';setTab('settings');return;}
    if(_mod(e)&&e.key==='/'){e.preventDefault();setTab('help');return;}
    // "?" (Shift+/) opens the keyboard shortcut cheat sheet
    if(e.key==='?'&&!inInput){ e.preventDefault(); try{ openShortcutSheet(); }catch(err){} return; }
    // Ctrl+Shift+V toggles hands-free voice mode
    if(_mod(e)&&e.shiftKey&&(e.key==='V'||e.key==='v')){ e.preventDefault(); try{ toggleVoiceMode(); }catch(err){} return; }
    // Ctrl+Shift+D collapses / expands the sidebar
    if(_mod(e)&&e.shiftKey&&(e.key==='D'||e.key==='d')){ e.preventDefault(); try{ toggleSb(); }catch(err){} return; }
  });
}

/* THE CANVAS AUTOMATION SYSTEM IS GONE, AND SO IS THE RESIDUE OF IT.

   Two things lived here and neither was reachable. runCanvasAutomation was
   a shim whose own comment said "this name is kept because things still
   call it" - nothing did, once the Connectors row started naming schoolOpen
   directly. And openOvernightQueue was a whole modal, about eighty lines of
   it, referenced by nothing anywhere in the bundle: a queue people could
   not open, promising overnight work that needed their computer left on,
   which is the automation this area was rebuilt to stop pretending about.

   What replaced both is real and has a door: Connectors -> Canvas LMS opens
   schoolConnectOpen, and once connected the same row opens schoolOpen. Work
   that should run without anybody present belongs to Crew, which has a
   server to run on. */



// === BOOT - wire everything up ===
/* This file is the WEBSITE, not anyone's data. All user data lives only in
   the visitor's own browser (localStorage), never inside this HTML. Each
   person who opens it gets their own private, separate account. To prove a
   clean slate (or wipe this browser), run amvReset() in the console. */
window.amvReset=function(){ try{ localStorage.clear(); }catch(e){} location.reload(); };
/* Premium reveal-on-scroll for landing sections */
function _initReveal(){
  try{
    const els=document.querySelectorAll('.lsec, .fgrid, .vs-grid, .step-g, .cta-sec');
    if(prefersReducedMotion()){ els.forEach(e=>e.classList.add('in')); return; }
    if(!('IntersectionObserver' in window)){ els.forEach(e=>e.classList.add('in')); return; }
    els.forEach(e=>e.classList.add('reveal'));
    const io=new IntersectionObserver((ents)=>{ ents.forEach(en=>{ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } }); },{threshold:.12});
    els.forEach(e=>io.observe(e));
  }catch(e){}
}
/* Run low-priority work when the browser is idle so first paint + the main
   chat view become interactive immediately instead of waiting on everything. */
const _idle = (fn)=>{ try{ (window.requestIdleCallback||function(f){return setTimeout(f,1)})(fn,{timeout:2000}); }catch(e){ setTimeout(fn,1); } };
try {
  /* THE ERROR BOUNDARY GOES FIRST, BEFORE ANYTHING CAN FAIL IN FRONT OF IT.

     It used to be armed inside goApp, eleventh in a list of twenty - after
     five UNGUARDED calls including setTab, which renders the entire current
     view. So the window in which a boot failure was least likely to be
     reported was exactly the window in which one was most likely to happen: a
     throw in any of those five meant no toast, no telemetry, no console
     handler, and boot simply stopped. Injecting a failure into goApp confirms
     it - the visitor is left looking at a half-drawn shell that answers
     nothing, with the product having no idea anything went wrong.

     Worse, goApp only runs once somebody is INSIDE the app. Every error on the
     landing page - the first thing every visitor sees, and the only thing most
     of them see - happened outside any boundary at all.

     Armed here instead: it installs two window listeners and depends on
     nothing, so there is no reason for it to wait its turn. The call in goApp
     stays and is a no-op, because it guards itself with _errBoundaryArmed and
     a second arming point costs nothing next to a missing one.

     Note what this does NOT do: it does not wrap those five calls in
     try/catch. A boot step that fails should fail loudly - see LESSONS 297.
     The point is that when it does, somebody hears about it. */
  if(typeof _initErrorBoundary === 'function'){
    try{ _initErrorBoundary(); }catch(e){ try{ console.error('AMV: the error boundary could not be armed', e); }catch(_){} }
  }
  // critical: the app must be usable right away
  setupLanding();
  setupApp();
  setupKeyboard();
  try{ _initCookieConsent(); }catch(e){ try{ renderCk(); }catch(_){} }
  /* NAMED, NOT BLANKET-CAUGHT. This was `try{ checkOAuthCallback(); }catch(e){}`
     and the function was deleted underneath it - so a ReferenceError went into
     the catch and every account connection returned to a page that did nothing.
     A missing handler is now a visible failure at boot rather than a feature
     that quietly stopped existing. */
  if(typeof checkOAuthCallback === 'function'){
    try{ checkOAuthCallback(); }catch(e){ try{ console.error('AMV: the connection return could not be handled', e); }catch(_){} }
  } else {
    try{ console.error('AMV: checkOAuthCallback is missing - account connections cannot complete'); }catch(_){}
  }
  try{ _setPlan(loadStr('amv_plan')||'free'); }catch(e){}
  // deferred: not needed for first interaction - run when idle
  _idle(()=>{ try{ _initReveal(); }catch(e){} });
  /* Where somebody is, asked as AMV loads rather than when Crew first opens,
     so every screen that is specialised by country already knows it. */
  _idle(()=>{ try{ if(typeof _cwAskWhere==='function') _cwAskWhere(); }catch(e){ try{ console.error('AMV: could not ask where you are', e); }catch(_){} } });
  _idle(()=>{ try{ _translateUI(); }catch(e){} });
  _idle(()=>{ try{ _checkPayReturn(); }catch(e){} });
  _idle(()=>{ try{ _verifyEntitlement(); }catch(e){} });
  _idle(()=>{
  if(document.getElementById('amv-tip')) return;
  var tip=document.createElement('div'); tip.id='amv-tip'; document.body.appendChild(tip);
  document.addEventListener('mouseover',function(e){
    var b=e.target.closest && e.target.closest('.snb'); if(!b) return;
    var lbl=b.getAttribute('data-label')|| (b.dataset?b.dataset.tab:'') ||''; if(!lbl) return;
    var r=b.getBoundingClientRect();
    tip.textContent=lbl; tip.style.left=(r.right+10)+'px'; tip.style.top=(r.top+r.height/2)+'px'; tip.classList.add('on');
  });
  document.addEventListener('mouseout',function(e){
    var b=e.target.closest && e.target.closest('.snb'); if(b) document.getElementById('amv-tip').classList.remove('on');
  });
  });
  _idle(()=>{ try{ var _lbl={dashboard:'Dashboard',chat:'New chat',workspaces:'Projects',memory:'Memory',usage:'Usage',billing:'Billing',plans:'Plans',settings:'Settings',help:'Help Center',apps:'Apps',tasks:'Tasks',integrations:'Integrations',extensions:'Extensions',crew:'Crew',studio:'Studio',dev:'Dev',handoff:'Handoff',market:'Marketplace'}; document.querySelectorAll('.snb').forEach(function(b){var t=b.dataset.tab; if(_lbl[t]) b.setAttribute('data-label',_lbl[t]);}); }catch(e){} });

} catch(e) {
  console.error('Boot error:', e);
}

// Nav scroll behavior
(function(){
  const land = document.getElementById('land');
  const nav = document.getElementById('lnav');
  if(land && nav){
    land.addEventListener('scroll', function(){
      if(land.scrollTop > 60){
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    }, {passive: true});
  }
})();

// Apply saved theme
const savedTheme = loadStr('amv_theme');
// Default to DARK. Only use light if the user explicitly chose it.
if(savedTheme === 'light') document.body.classList.add('light');
// Apply saved accent theme (default azure = no attribute).
/* Sixteen. The dot is the colour the stylesheet actually applies in dark
   mode, not a sample of it - a swatch that does not match what pressing it
   does is the one thing a colour picker may never do. Indigo is #898bf4 and
   not #6366f1 for the reason written beside the accent blocks: the primary
   button puts near-black text on it, and #6366f1 could not carry it. */
const ACCENT_THEMES=[
  {id:'',        name:'Azure',   dot:'#5590ff'},
  {id:'violet',  name:'Violet',  dot:'#9d7bff'},
  {id:'indigo',  name:'Indigo',  dot:'#686bf1'},
  {id:'magenta', name:'Magenta', dot:'#e879f9'},
  {id:'rose',    name:'Rose',    dot:'#fb7185'},
  {id:'crimson', name:'Crimson', dot:'#f04444'},
  {id:'coral',   name:'Coral',   dot:'#ff8a65'},
  {id:'orange',  name:'Orange',  dot:'#fb923c'},
  {id:'amber',   name:'Amber',   dot:'#f5a623'},
  {id:'gold',    name:'Gold',    dot:'#eab308'},
  {id:'lime',    name:'Lime',    dot:'#a3e635'},
  {id:'forest',  name:'Forest',  dot:'#22c55e'},
  {id:'emerald', name:'Emerald', dot:'#34d399'},
  {id:'teal',    name:'Teal',    dot:'#14b8a6'},
  {id:'cyan',    name:'Cyan',    dot:'#38bdf8'},
  {id:'slate',   name:'Slate',   dot:'#94a3b8'},
];
function applyAccent(id){
  if(id) document.body.setAttribute('data-accent',id);
  else document.body.removeAttribute('data-accent');
  try{ saveStr('amv_accent', id||''); }catch(e){}
}
function _restoreAccent(){ try{ const a=loadStr('amv_accent'); if(a) document.body.setAttribute('data-accent',a); }catch(e){} }
try{ window.applyAccent=applyAccent; }catch(e){}
_restoreAccent();

// Apply saved font size (zoom-based, applied when app boots via _applyFontSize)
try{ _applyFontSize&&_applyFontSize(); }catch(e){}

/* GOOGLE SIGN-IN MUST NOT WAIT FOR THE SLOWEST THING ON THE PAGE.

   This was `window.addEventListener('load', () => setTimeout(initGAuth, 500))`,
   and `load` does not fire until every async script has resolved - including
   `accounts.google.com/gsi/client`, which is the very script this is waiting
   for. So initialisation was chained to the slowest resource on the page and
   then delayed a further half second.

   Measured: first paint at 236ms, `loadEventEnd` at 12,567ms on a network
   where Google's host does not answer. Signing up is the first thing a new
   person does, and "Continue with Google" is the first button on the sheet -
   so for that whole window the button is on screen and dead. A school or
   workplace filter blocking accounts.google.com does not degrade sign-in, it
   removes it, silently, while the page looks ready.

   Now it starts from whichever happens first: the library already being
   present, its own script finishing, or somebody opening the auth sheet. None
   of those is coupled to `load`. */
function _gauthStart(){
  try{
    if(window.__amvGAuthStarted) return;
    if(window.google && google.accounts){ window.__amvGAuthStarted = true; initGAuth(); return; }
    const s = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if(s && !s.dataset.amvHooked){
      s.dataset.amvHooked = '1';
      s.addEventListener('load', ()=>{ if(!window.__amvGAuthStarted){ window.__amvGAuthStarted = true; try{ initGAuth(); }catch(e){} } }, { once:true });
    }
  }catch(e){}
}
try{ window._gauthStart = _gauthStart; }catch(e){}
_gauthStart();
/* A late safety net for the case where the script was already cached and
   fired its load before this ran. Cheap, bounded, and not on the critical
   path of anything. */
try{ setTimeout(_gauthStart, 800); }catch(e){}
// Init PWA (installable app + offline shell)
try{ _initPWA(); }catch(e){}
/* The public settings a visitor needs - the Google client id above all, since
   "Continue with Google" is the first button on the sign-up sheet and was dead
   for everybody who had not typed the id into their own Settings. Fired at
   boot, not on demand, so the id is usually there before anybody reaches the
   button; if it is not, the button still says plainly that it is unavailable
   rather than failing silently. */
try{ _loadPublicConfig(); }catch(e){}

/* Count this arrival, once per session.

   Everything AMV measures starts at signup, so the largest group there is -
   people who opened the page and left - was invisible, and visitors-to-accounts
   is the number that says whether any of the marketing works.

   Deliberately the smallest thing that answers it: a POST to AMV's own backend
   that increments a daily COUNTER. Nothing identifying is sent - no id, no
   address, no referrer, no user agent - so there is nothing here to leak, to
   join back to a person, or to need a consent banner for. It cannot answer
   "who", and "how many" is the whole question.

   sessionStorage, not localStorage: one arrival per visit is what a funnel
   means, and a returning visitor tomorrow is a new arrival. Failure is
   silence - a metric must never be able to break the page it is measuring. */
function _countVisit(){
  try{
    if(sessionStorage.getItem('amv_visit_counted')==='1') return;
    sessionStorage.setItem('amv_visit_counted','1');
    const base=(window.AMV_API && AMV_API.base)||'';
    if(!base) return;
    /* keepalive so it survives the user leaving immediately, which is exactly
       the visit most worth counting. */
    fetch(base.replace(/\/$/,'')+'/v1/visit',{method:'POST',keepalive:true}).catch(()=>{});
  }catch(e){}
}
try{ _countVisit(); window._countVisit=_countVisit; }catch(e){}
// Show a "new" dot on What's New if there are unseen updates
try{ setTimeout(()=>{ try{ _checkWhatsNew(); }catch(e){} }, 800); }catch(e){}

// Boot logic
/* FIRST, because everything after it renders something worth clicking.
   `frame-ancestors` in a <meta> CSP is ignored by every browser - the spec
   says so - so this is what actually stops AMV being framed by a page that
   wants your click on Approve. The widget (#embed=1) is framed on purpose and
   is excluded inside the check. */
if(typeof _framedWithoutPermission==='function' && _framedWithoutPermission()){
  try{ _renderFramedRefusal(); }catch(e){ try{ document.body.textContent='AMV does not run inside another site.'; }catch(_){} }
} else
// If this is the embeddable widget (#embed=1&k=pk_...), render the compact chat panel and stop.
if(typeof _checkEmbedView==='function' && _checkEmbedView()){
  // embed chat rendered; skip normal app boot
} else
// If this is a shared-conversation link (#share=...), show the read-only view and stop.
if(typeof _checkSharedView==='function' && _checkSharedView()){
  // shared view rendered; skip normal app boot
} else
// If this is a shared-artifact link (#art=...), show the branded artifact page and stop.
if(typeof _checkSharedArtifact==='function' && _checkSharedArtifact()){
  // shared artifact rendered; skip normal app boot
} else if(S.user&&S.user.email){
  const acct=findAccount(S.user.email);
  if(acct){
    const uc=loadUserConvs(S.user.email);
    if(uc&&uc.length){S.convs=uc;S.cur=_openingChatId(S.convs);}
    else if(!S.convs.length){S.convs=[newConvObj()];S.cur=S.convs[0].id;}
    else if(!S.cur) S.cur=S.convs[0].id;
    try{ _loadSessions(); }catch(e){}
    document.getElementById('land')?.classList.add('hidden');
    goApp();
  } else {
    // No account yet: skip the intro wall - let them into the app immediately.
    // Sign-up is required the moment they try to send a message (see sendMsg).
    S.user=null; localStorage.removeItem('amv_user');
    document.getElementById('land')?.classList.add('hidden');
    if(!S.convs||!S.convs.length){ S.convs=[newConvObj()]; S.cur=S.convs[0].id; }
    S.tab='chat';   // always land in chat (never a gated tab that would pop signup on load)
    goApp();
  }
} else {
  // First-ever visit, no session: straight into the app, gated at first send.
  document.getElementById('land')?.classList.add('hidden');
  if(!S.convs||!S.convs.length){ S.convs=[newConvObj()]; S.cur=S.convs[0].id; }
  S.tab='chat';
  goApp();
}

function toastInfo(msg){ toast(msg||'Done','info'); }

/* ---------------- Cookie consent banner ----------------
   Shows once per device (not per account - stored in the global,
   unscoped bucket) until the person accepts, declines non-essential
   cookies, or picks preferences. Analytics code should check
   _cookieConsent().analytics before firing anything. */
function _cookieConsent(){
  try{
    const raw = localStorage.getItem('amv_cookie_consent');
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function _setCookieConsent(choice){
  // choice: {essential:true, analytics:bool}
  try{
    localStorage.setItem('amv_cookie_consent', JSON.stringify(Object.assign({essential:true, ts:Date.now()}, choice)));
  }catch(e){}
  const el = $('cookie-consent-banner');
  if(el){ el.classList.add('cc-hide'); setTimeout(()=>{ try{ el.remove(); }catch(e){} }, 350); }
  try{ if(choice.analytics && typeof _analyticsInit==='function') _analyticsInit(); }catch(e){}
}
function _initCookieConsent(){
  if(_cookieConsent()) return; // already decided
  if($('cookie-consent-banner')) return; // already showing
  const wrap = document.createElement('div');
  wrap.id = 'cookie-consent-banner';
  wrap.className = 'cc-banner';
  wrap.setAttribute('role','dialog');
  wrap.setAttribute('aria-label','Cookie preferences');
  wrap.innerHTML =
    '<div class="cc-inner">'+
      /* THREE BUTTONS OF EQUAL WEIGHT FOR ONE REAL CHOICE (AMV-D059).

         Manage, Essential only and Accept all were all `.btn`, and on a phone
         `.cc-actions .btn{flex:1}` gave each of them a third of the row - so a
         tertiary link to a settings pane was drawn at the same size as the two
         answers, and the first thing a new visitor met was a legal control
         with the visual weight of the product's own call to action.

         Two answers keep button weight. Manage becomes a quiet text link. It
         stays a <button> rather than becoming an <a>, because it performs an
         action rather than navigating - the change is presentation only, so
         keyboard and screen-reader behaviour are untouched. Three sentences
         are one: the same commitment, without the paragraph. */
      '<div class="cc-text">Essential cookies keep AMV running; analytics cookies are optional, and you can change this any time in Settings.</div>'+
      '<div class="cc-actions">'+
        '<button class="cc-manage-link" id="cc-manage">Manage</button>'+
        '<button class="btn" id="cc-decline">Essential only</button>'+
        '<button class="btn bp" id="cc-accept">Accept all</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(wrap);
  on($('cc-accept'),'click',()=>_setCookieConsent({analytics:true}));
  on($('cc-decline'),'click',()=>_setCookieConsent({analytics:false}));
  /* `render` is not a function anywhere in the bundle, so `render&&render()` on
     a bare undeclared identifier threw ReferenceError - inside a try, which
     swallowed it along with the toast on the line after. Somebody pressing
     Manage landed on Settings with no idea why. Sent to the Privacy pane, which
     is where the control actually is. */
  on($('cc-manage'),'click',()=>{
    _setCookieConsent({analytics:false});
    try{
      S.tab='settings'; S.settingsPane='privacy';
      if(typeof goApp==='function') goApp();
      if(typeof setTab==='function') setTab('settings');
      if(typeof toast==='function') toast('Analytics are off for now - turn them on here whenever you like.','info',5000);
    }catch(e){}
  });
}
window._cookieConsent = _cookieConsent;
window._initCookieConsent = _initCookieConsent;

/* ---------------- Analytics ----------------
   Lightweight, provider-agnostic tracker. Nothing fires unless the person
   has consented to analytics cookies AND a tracking ID has been entered in
   Settings > Privacy. Supports Google Analytics (GA4) or Plausible - pick
   one by the shape of the ID ("G-XXXX" = GA4, anything else = Plausible
   domain). Also tracks a small conversion funnel (visit -> signup -> first
   message -> upgrade) as local events, visible in Settings even with no
   provider configured, so the funnel itself never depends on a 3rd party. */
function _analyticsId(){ try{ return loadStr('amv_analytics_id')||''; }catch(e){ return ''; } }
function _analyticsSetId(id){ try{ saveStr('amv_analytics_id', (id||'').trim()); }catch(e){} }
function _analyticsAllowed(){
  const c=_cookieConsent();
  return !!(c && c.analytics && _analyticsId());
}
let _analyticsLoaded=false;
/* WHETHER THE PROVIDER SCRIPT ACTUALLY LOADED.

   Both providers are injected as third-party <script> tags, and the page's
   Content-Security-Policy `script-src` allows neither googletagmanager.com nor
   plausible.io. So pasting a tracking ID and consenting to analytics did
   nothing at all, silently: the browser blocked the script, no error surfaced,
   and Settings went on showing analytics as configured.

   Widening the CSP is not something to do quietly - a third-party script gets
   the same reach over this page as AMV's own code, and adding analytics is on
   the list of changes that need the owner's say-so. So the block is DETECTED
   and reported instead, and the Privacy screen says the truth: configured, and
   not running, and why. */
function _analyticsBlocked(){ try{ return loadStr('amv_analytics_blocked')==='1'; }catch(e){ return false; } }
function _analyticsMarkBlocked(on){ try{ saveStr('amv_analytics_blocked', on?'1':''); }catch(e){} }
try{ window._analyticsBlocked=_analyticsBlocked; }catch(e){}
function _analyticsInit(){
  if(_analyticsLoaded || !_analyticsAllowed()) return;
  const id=_analyticsId();
  const watch=(s)=>{
    /* A CSP-blocked script fires `error` on the element. So does a network
       failure or an ad-blocker - all three mean the same thing here, which is
       that nothing is being measured. */
    s.addEventListener('error',()=>{ _analyticsLoaded=false; _analyticsMarkBlocked(true); });
    s.addEventListener('load',()=>{ _analyticsMarkBlocked(false); });
  };
  try{
    if(/^G-/i.test(id)){
      const s=document.createElement('script');
      s.async=true; s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id);
      watch(s);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer||[];
      window.gtag = function(){ window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', id, { anonymize_ip:true });
    } else {
      const s=document.createElement('script');
      s.defer=true; s.dataset.domain=id; s.src='https://plausible.io/js/script.js';
      watch(s);
      document.head.appendChild(s);
    }
    _analyticsLoaded=true;
  }catch(e){}
}
// Local conversion-funnel counters, independent of any 3rd-party provider.
function _funnel(){ try{ return JSON.parse(loadStr('amv_funnel')||'')||{visit:0,signup:0,first_msg:0,upgrade:0}; }catch(e){ return {visit:0,signup:0,first_msg:0,upgrade:0}; } }
function _funnelMark(step){
  try{
    const f=_funnel();
    if(!f[step]) f[step]=0;
    f[step]+=1;
    saveStr('amv_funnel', JSON.stringify(f));
  }catch(e){}
}
function _trackEvent(name, data){
  // Always keep the local funnel signal (no consent needed - it's first-party,
  // aggregate counts only, no PII), separate from 3rd-party forwarding below.
  if(name==='page' && data && data.name==='landing') _funnelMark('visit');
  if(name==='signup_complete') _funnelMark('signup');
  if(name==='first_message') _funnelMark('first_msg');
  if(name==='plan_upgrade') _funnelMark('upgrade');
  if(!_analyticsAllowed()) return;
  try{
    if(typeof window.gtag==='function'){
      window.gtag('event', name, Object.assign({}, data||{}));
    } else if(window.plausible){
      window.plausible(name, { props: data||{} });
    } else if(typeof window.plausible!=='function' && document.querySelector('script[data-domain]')){
      // Plausible's script defines window.plausible once loaded; queue until then
      (window.plausible = window.plausible || function(){ (window.plausible.q = window.plausible.q||[]).push(arguments); })(name, {props:data||{}});
    }
  }catch(e){}
}
window._analyticsId=_analyticsId; window._analyticsSetId=_analyticsSetId;
window._analyticsAllowed=_analyticsAllowed; window._analyticsInit=_analyticsInit;
window._funnel=_funnel; window._trackEvent=_trackEvent;
// If consent was already granted in a prior session, load the provider now.
try{ if(_analyticsAllowed()) _analyticsInit(); }catch(e){}




/* ----------------------------------------------
   TARGETED FIXES - added here
   Uses saveStr/loadStr (existing helpers)
   Does NOT override any existing functions
   ---------------------------------------------- */

/* 1. VOICE FIX - mic permission + better errors */
(function(){
  // Keep the copyright year current everywhere it appears - never stale.
  try{ const cy=document.getElementById('copy-year'); if(cy) cy.textContent=String(new Date().getFullYear()); }catch(e){}
})();
(function(){
  const orig = window.toggleVoice;
  window.toggleVoice = function(){
    const btn = $('voice-btn');
    if(!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)){
      toast('Voice needs Chrome or Edge','error',4000); return;
    }
    if(window._isRecording){ try{ window._voiceRec && window._voiceRec.stop(); }catch(e){} return; }
    if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
      navigator.mediaDevices.getUserMedia({audio:true})
        .then(s=>{ s.getTracks().forEach(t=>t.stop()); _amvStartVoice(btn); })
        .catch(err=>{ if(err.name==='NotAllowedError') toast('Microphone blocked - allow in browser settings','error',5000); else _amvStartVoice(btn); });
    } else _amvStartVoice(btn);
  };
})();

function _amvStartVoice(btn){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  window._voiceRec = new SR();
  window._voiceRec.continuous = true;
  window._voiceRec.interimResults = true;
  window._voiceRec.lang = _speechLang();
  window._voiceRec.onstart = ()=>{ window._isRecording=true; if(btn){btn.classList.add('rec');} toast('Listening - click mic to stop','info',4000); };
  window._voiceRec.onresult = e=>{
    let final='', interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      if(e.results[i].isFinal) final+=e.results[i][0].transcript;
      else interim+=e.results[i][0].transcript;
    }
    const ta=$('mta');
    if(ta){
      const base=ta.dataset.vb||'';
      ta.value=base+final+(interim?'['+interim+']':'');
      if(final) ta.dataset.vb=base+final;
      ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,130)+'px';
    }
  };
  window._voiceRec.onend = ()=>{
    window._isRecording=false; if(btn) btn.classList.remove('rec');
    const ta=$('mta');
    if(ta){ ta.value=(ta.value||'').replace(/\[.*?\]/g,'').trim(); delete ta.dataset.vb; }
  };
  window._voiceRec.onerror = e=>{
    window._isRecording=false; if(btn) btn.classList.remove('rec');
    const m={'not-allowed':'Mic blocked - allow in browser settings','no-speech':'No speech detected','audio-capture':'No microphone found'};
    if(e.error!=='aborted') toast(m[e.error]||'Voice error: '+e.error,'error',4000);
  };
  try{ window._voiceRec.start(); } catch(e){ toast('Voice failed: '+e.message,'error'); }
}

/* 2. GOOGLE OAUTH.

   The block that stood here described the design as it was: an implicit flow
   chosen so AMV worked without a backend, with the honest tradeoff written out
   - "the Google access token lands in localStorage" - and a note that a
   hardened deployment should broker the exchange through the Worker instead.

   Every clause of that is now false. The exchange IS brokered through the
   Worker, the token never reaches this page, and the sign-in token that does
   is held in memory rather than on disk. A comment that describes a tradeoff
   the code no longer makes is worse than no comment: the next person to touch
   this reads it as the current design and reasons from it. */
/* WHAT COMES BACK FROM A PROVIDER, AND THE ONLY THING THAT NOW HANDLES IT.

   A provider returns somebody to the app root with `?code=...&state=...`. This
   is the boot-time handler for that, and it is the whole of it.

   It used to be much larger, because two flows returned to this same URL: the
   older Google grant did its own exchange from here, holding a PKCE verifier
   this browser had minted, and connected accounts arrived alongside it. That is
   why the server prefixes its state with `c_` - so the two could be told apart
   without guessing. The older flow is retired, so this handler is now only ever
   looking at its own return, and the prefix has become the thing that stops it
   consuming a return that is not its.

   THIS FUNCTION WAS DELETED ONCE AND THE DELETION SHIPPED THROUGH A SYNTAX
   CHECK, A BUILD AND THE WHOLE SUITE. The call at boot is wrapped in a bare
   try/catch, so a missing function threw a ReferenceError into a swallowed
   catch and every account connection came back to a page that did nothing at
   all - no error, no tick, no reason to look. The guard there names this
   function now instead of catching everything, so the same removal fails loudly
   rather than quietly.

   Nothing is stored here and nothing is decided here: the code is single-use,
   the verifier is sealed on the server, and the exchange is the server's. All
   this does is get the code out of the address bar and hand it over. */
function checkOAuthCallback(){
  let q;
  try{ q = new URLSearchParams(window.location.search || ''); }catch(e){ return; }
  const state = q.get('state') || '';
  /* Not ours: leave the address bar exactly as it is. Stripping a return this
     handler does not own would destroy the only copy of somebody else's code. */
  /* `c_` is Connected accounts, `r_` an app connector (Notion, Canva...).
     Anything else is not ours to touch. */
  /* `s_` is company sign-in: the person is not signed in yet, so this is a
     sign-in to finish, not a connection to resume. */
  if(state.indexOf('s_') === 0){
    try{ history.replaceState(null, '', window.location.pathname); }catch(e){}
    const serr = q.get('error'), scode = q.get('code');
    setTimeout(() => {
      if(serr || !scode){
        toast(serr === 'access_denied' ? 'Company sign-in was cancelled. Nothing was signed in.'
                                       : 'Your company\u2019s system did not sign you in. Nothing was changed.', 'info', 7000);
        return;
      }
      ssoComplete(scode, state);
    }, 0);
    return;
  }
  const isApp = state.indexOf('r_') === 0;
  if(state.indexOf('c_') !== 0 && !isApp) return;

  const clear = () => {
    try{ history.replaceState(null, '', window.location.pathname); }catch(e){}
  };
  /* BACK WHERE CONNECT WAS PRESSED, FROM THE FIRST FRAME.

     The page came back to the site root, drew the home screen, and only moved
     to Integrations once the connection had finished - after the session was
     restored and the server had answered, which is seconds, and never if any
     of it went wrong. The owner saw the home page every time. And a cancel or
     a refusal at the provider went nowhere at all. Now the screen they left is
     the screen they come back to, straight away, whatever happens next.

     Deferred one turn: this runs at boot while later modules are still being
     evaluated, and drawing a section that reads their bindings would throw
     (see goApp). The key is left in place for _connGoBack to read and clear. */
  const showReturn = () => {
    try{
      const back = loadStr('amv_conn_return') || 'integrations';
      _showWhenReady(back);
    }catch(e){}
  };

  /* The person said no at the provider, or the provider refused. That is not a
     failure to hide - somebody is waiting on a screen for something to happen. */
  const err = q.get('error');
  if(err){
    clear();
    showReturn();
    try{ setTimeout(()=>{ try{ saveStr('amv_conn_return',''); }catch(e){} }, 50); }catch(e){}
    toast(err === 'access_denied'
      ? 'That connection was cancelled, so AMV has no access to the account.'
      : 'The account could not be connected. Nothing was changed.', 'info', 6000);
    return;
  }

  const code = q.get('code');
  if(!code) return;
  clear();
  showReturn();
  if(!(isApp ? typeof _rmcpFinish === 'function' : typeof _connectFinish === 'function')){
    /* Said out loud rather than swallowed. Somebody has just approved real
       access at a provider; a silent return leaves them believing it worked. */
    toast('AMV could not finish connecting that account. Try again from Settings.', 'error', 8000);
    return;
  }
  _stashConnectReturn(code, state, isApp);
  _finishPendingConnect();
}
try{ window.checkOAuthCallback = checkOAuthCallback; }catch(e){}

/* COMING BACK FROM A PROVIDER IS A PAGE LOAD, AND A PAGE LOAD STARTS SIGNED OUT.

   The session lives in an HttpOnly cookie (cookie mode), so every load begins
   with no token in hand until the restore mints one. The return from Discord
   or Google called finish at boot, inside that window - and when the restore
   then failed, the approval the person had just given was spent on a request
   that could never succeed, and they were back where they started, "not
   connected", with nothing to say why. Seen by the owner.

   So the return is held for this tab only (sessionStorage - never disk that
   outlives the tab) for ten minutes, and finished once there is a session:
   when the restore completes, or right after the person signs in again. The
   code is single use and bound on the server to the account that started it,
   so holding it briefly changes nothing about who can use it. */
/* Functions, not constants: checkOAuthCallback runs at boot from higher up
   this file, before these lines are reached. A const there is in its temporal
   dead zone (it threw on every provider return), and a var is undefined until
   its line runs. A function declaration is whole from the start. */
function _pendingConnectKey(){ return 'amv_pending_connect'; }
function _pendingConnectMaxMs(){ return 10 * 60 * 1000; }
function _stashConnectReturn(code, state, isApp){
  try{ sessionStorage.setItem(_pendingConnectKey(), JSON.stringify({ code, state, isApp: !!isApp, at: Date.now() })); }catch(e){}
}
async function _finishPendingConnect(){
  if(_finishPendingConnect.busy) return;
  let p = null;
  try{ p = JSON.parse(sessionStorage.getItem(_pendingConnectKey()) || 'null'); }catch(e){ p = null; }
  if(!p || !p.code) return;
  if(Date.now() - (p.at || 0) > _pendingConnectMaxMs()){
    try{ sessionStorage.removeItem(_pendingConnectKey()); }catch(e){}
    toast('That connection was approved too long ago to finish. Press Connect again.', 'info', 8000);
    return;
  }
  /* The restore is still running; it calls this again when it ends. */
  if(window.AMV_API && AMV_API._restoring) return;
  _finishPendingConnect.busy = true;
  try{
    /* No token in hand but a way to renew one: renew first, so the finish is
       not spent on a request that 401s. If renewing fails there is no session
       to finish with - hold the approval and ask for a sign-in, which finishes
       it (_setTokens calls back here). */
    const A = window.AMV_API;
    const renewable = !!(A && (A.refreshTok || A.cookieAuth || _authCreds() === 'include'));
    if(A && !A.token && renewable){
      try{ await A._doRefresh(); }catch(e){}
      if(!A.token){
        if(!p.told){
          p.told = 1;
          try{ sessionStorage.setItem(_pendingConnectKey(), JSON.stringify(p)); }catch(e){}
          toast('Sign in to finish connecting - AMV is holding your approval for a few minutes.', 'info', 10000);
        }
        try{ if(A._refreshDenied) _askToSignInAgain(null, true); }catch(e){}
        return;
      }
    }
    try{ sessionStorage.removeItem(_pendingConnectKey()); }catch(e){}
    if(p.isApp) await _rmcpFinish(p.code, p.state);
    else await _connectFinish(p.code, p.state);
  }finally{ _finishPendingConnect.busy = false; }
}
try{ window._finishPendingConnect = _finishPendingConnect; window._stashConnectReturn = _stashConnectReturn; }catch(e){}

/* CONNECTGOOGLE IS GONE NOW, AND THE REASON IT SURVIVED THE LAST ATTEMPT IS
   worth keeping.

   It had no callers, so I removed it as dead code and two suites failed within
   the hour. It was not dead - it was the START of a subsystem that was still
   running underneath: the exchange route, the refresh route, the in-memory
   token, and the mailbox, calendar, Drive and school readers built on them.
   What was missing was the first arrow. Deleting the front door would have
   made an existing gap permanent and silent rather than fixable, and taken
   with it the only place the read-only Classroom scopes were named - which is
   why the school reader was getting a 403 from Google.

   Everything downstream has moved. The readers ask the server, the server holds
   the sealed grant, the routes that handed a token to a page are gone. So this
   one really is a leaf now, and the thing it started has a better replacement
   that a person can actually reach.

   It also took the last implicit flow in the client with it: response_type=token
   returns an access token in the URL fragment, where it lands in history, in
   referrers, and in anything that can read the address bar. It survived here as
   the no-backend fallback, which was an honest trade when the alternative was
   the feature not existing. Connected accounts needs a backend by construction,
   so the trade is no longer on the table and neither is the flow.

   LESSONS 296: a function with no callers is unreachable. Whether it is DEAD
   depends on what is downstream of it. */


/* THE GOOGLE ACCESS TOKEN USED TO LIVE HERE, AND NOW IT LIVES NOWHERE.

   This block held one in a module variable - already an improvement on holding
   it in localStorage, which is where it was before - along with the code to
   mint a fresh one from the refresh token the server kept, and a migration that
   read the old key off disk once and deleted it.

   None of it is needed. Every path that called Google from this page now asks
   the server to act instead, so the token stays in the Worker and the browser
   receives results rather than credentials. A token that never arrives cannot
   be read by anything that gets a foothold on this page, cannot go stale
   mid-job, and does not vanish when the tab closes.

   What is left of Google in this browser is sign-in, which is a different
   thing: it proves who somebody is and grants access to nothing.

   `amv_google_connected` went with it. It was a marker meaning "this account
   granted the older Google connection", and the question it answered is now
   answered by the server's own list of grants, per capability. Two answers to
   one question is how a screen came to say Gmail was connected on an account
   that had granted no mail scope at all. */
/* AND ANYTHING AN EARLIER BUILD LEFT ON DISK GOES ON THE WAY PAST.

   There was a migration here that read `amv_gtoken` into memory and deleted it.
   It went with the memory it was reading into, and the DELETE half went with it
   - so a browser that ran a build where the token was on disk would have kept
   it there indefinitely, cleared only by a sign-out somebody may never perform.

   The token is short-lived and this product has never shipped, so the real
   exposure is a development machine rather than a customer. It is three lines
   either way, and "a live bearer token to somebody's mail sits in localStorage
   until they remember to sign out" is not a sentence worth being true for
   anybody, including us.

   Unconditional and silent: there is nothing to migrate INTO, so the only
   correct thing to do with these keys is remove them. */
(function _purgeRetiredGoogleKeys(){
  ['amv_gtoken', 'amv_gtoken_exp', 'amv_google_connected'].forEach(k => {
    try{ localStorage.removeItem(k); }catch(e){}
    try{ localStorage.removeItem(_scopeKey(k)); }catch(e){}
  });
})();

/* disconnectGoogle lived here and was reachable from nothing.
   disconnectIntegration('google') does the same work from the Connectors list,
   which is where somebody actually looks for it. Two functions for one action
   is how they drift. */
/* Real Gmail/Calendar/Drive actions - open in chat */
