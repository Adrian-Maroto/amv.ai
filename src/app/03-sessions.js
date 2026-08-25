/* ============================================================
   UNIFIED WORK SESSIONS  (Dev / Lab / Studio, etc.)
   Anything the user builds in a workspace tool is saved as a
   lightweight, resumable session and shown in Recents alongside
   conversations. Clicking one restores its exact state and jumps
   to the right tool. Stored per-user under amv_sessions.
   ============================================================ */
const SESSION_KINDS = {
  dev:    { label:'Dev',    tab:'dev',    icon:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>' },
  lab:    { label:'Lab',    tab:'lab',    icon:'<path d="M10 2h4M12 2v6.5L7 19a1 1 0 0 0 .9 1.5h8.2A1 1 0 0 0 17 19l-5-10.5"/>' },
  studio: { label:'Studio', tab:'studio', icon:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>' },
};
const _LAB_DEFAULT_CODE = "// AMV Lab - real execution.";  // prefix marker for "untouched" detection
let _SESSIONS = [];          // [{id, kind, title, updated, state}]
let _activeSession = {};     // { dev:id, lab:id, studio:id } - current session per kind
/* One debounce timer PER KIND. This used to be a single shared timer, so
   _sessTouch('studio') followed quickly by _sessTouch('dev') cancelled the
   Studio save entirely - Studio work silently never reached Recents. */
let _sessSaveTimers = {};

function _sessKey(){ const e=S.user&&S.user.email; return e ? 'amv_sessions' : 'amv_sessions_guest'; }
function _loadSessions(){
  try{ const v=load(_sessKey()); _SESSIONS = Array.isArray(v)?v:[]; }catch(e){ _SESSIONS=[]; }
  return _SESSIONS;
}
function _persistSessions(){
  try{
    _SESSIONS.sort((a,b)=>(b.updated||0)-(a.updated||0));
    if(_SESSIONS.length>60) _SESSIONS.length=60;
    store(_sessKey(), _SESSIONS);
    // Recents/Dev/Lab aren't AMVState keys, so tell the sync layer explicitly.
    try{ window.dispatchEvent(new Event("amv:sessions-changed")); }catch(e){}
  }catch(e){ if(_isQuotaErr(e)) _notifyStorageFull(); }
}
function _sessTitleFor(kind, state){
  try{
    if(kind==='dev'){
      const firstUser=(state.log||[]).find(l=>l.role==='user'&&l.text);
      if(firstUser) return firstUser.text.slice(0,42);
      if(state.activePath) return state.activePath.split('/').pop();
    }
    if(kind==='lab'){
      const c=(state.code||'').split('\n').find(l=>l.trim()&&!l.trim().startsWith('//'));
      if(c) return c.trim().slice(0,42);
    }
    if(kind==='studio'){
      const a=(state.artifacts||[]).find(x=>x.id===state.activeId)||(state.artifacts||[])[0];
      if(a&&a.brief) return a.brief.slice(0,42);
      if(a&&a.name) return a.name;
    }
  }catch(e){}
  return (SESSION_KINDS[kind]?.label||'Session');
}
function _sessSnapshot(kind){
  try{
    if(kind==='dev')    return { log:(_DEV.log||[]).slice(-40), lang:_DEV.lang, project:_DEV.project, activePath:_DEV.activePath, curCode:_DEV.curCode, curLang:_DEV.curLang };
    if(kind==='lab')    return { lang:_LAB.lang, code:_LAB.code, files:_LAB.files||[], chat:(_LAB.chat||[]).slice(-30) };
    if(kind==='studio') return { artifacts:_STUDIO.artifacts, activeId:_STUDIO.activeId, prompt:_STUDIO.prompt };
  }catch(e){}
  return {};
}
function _sessHasContent(kind, snap){
  try{
    if(kind==='dev')    return (snap.log||[]).some(l=>l.role==='user') || Object.keys(snap.project||{}).length>0 || !!snap.curCode;
    if(kind==='lab')    return !!(snap.code && snap.code.trim() && !snap.code.trim().startsWith(_LAB_DEFAULT_CODE));
    if(kind==='studio') return (snap.artifacts||[]).some(a=>a.html || a.brief);
  }catch(e){}
  return false;
}
function _sessTouch(kind){
  if(!SESSION_KINDS[kind]) return;
  clearTimeout(_sessSaveTimers[kind]);
  _sessSaveTimers[kind]=setTimeout(()=>{
    const snap=_sessSnapshot(kind);
    if(!_sessHasContent(kind, snap)) return;
    let id=_activeSession[kind];
    let rec=id ? _SESSIONS.find(s=>s.id===id) : null;
    if(!rec){
      id='sess_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
      rec={ id, kind, title:'', updated:0, state:{} };
      _SESSIONS.push(rec);
      _activeSession[kind]=id;
    }
    rec.state=snap;
    rec.title=_sessTitleFor(kind, snap);
    rec.updated=Date.now();
    _persistSessions();
    try{ renderHist(); }catch(e){}
  }, 700);
}
function _sessNew(kind){ _activeSession[kind]=''; }
// Save the active session for a kind RIGHT NOW (no debounce). Used when the
// user navigates away from a tool, so nothing is ever lost mid-debounce.
function _sessFlush(kind){
  if(!SESSION_KINDS[kind]) return;
  clearTimeout(_sessSaveTimers[kind]);   // only this kind's pending save
  try{
    const snap=_sessSnapshot(kind);
    if(!_sessHasContent(kind, snap)) return;
    let id=_activeSession[kind];
    let rec=id ? _SESSIONS.find(s=>s.id===id) : null;
    if(!rec){
      id='sess_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
      rec={ id, kind, title:'', updated:0, state:{} };
      _SESSIONS.push(rec);
      _activeSession[kind]=id;
    }
    rec.state=snap; rec.title=_sessTitleFor(kind, snap); rec.updated=Date.now();
    _persistSessions();
    try{ renderHist(); }catch(e){}
  }catch(e){}
}
// Called when leaving a workspace tool: flush its work to Recents, then clear
// the active pointer so the NEXT visit starts a fresh session automatically
// (the just-saved work stays available in Recents to resume anytime).
function _sessLeave(kind){
  _sessFlush(kind);
  _activeSession[kind]='';
}
try{ window._sessFlush=_sessFlush; window._sessLeave=_sessLeave; }catch(e){}
// Reset a tool's live state to empty (after its work was saved to Recents).
let _resumingSession=false;
/* WHAT A RESET MEANS, WRITTEN AS WHAT SURVIVES RATHER THAN WHAT IS CLEARED.

   This used to name the fields to clear, and it drifted the way that always
   drifts: a field added later was simply not in the list, and nothing said so.
   Two real defects came out of exactly that gap.

     - `deploySlug` survived a new session, so building a different app and
       publishing it REPLACED the previous app at its own public address.
     - `lastHTML` survived a sign-out. `_devDeploy` falls back to it when the
       project is empty, so the next person to sign in on that browser could
       press Deploy on a blank screen and publish the PREVIOUS ACCOUNT'S work
       to a public URL - at the previous account's slug, overwriting their site.
       `_wipeAccountState` exists to stop precisely that; it just did not know
       about the field.

   So the defaults are declared, and a reset restores them wholesale. A field
   added tomorrow is cleared by default and has to be added to KEEP on purpose
   to survive - which is the safe direction for it to fail in. Guarded by
   tests/e2e/a-reset-really-resets, which enumerates every field assigned
   anywhere and fails on one that is in neither list. */
const _TOOL_DEFAULTS = {
  dev: { log:[], project:{}, activePath:'', curCode:'', curLang:'', curRun:null,
         deploySlug:'', deployedOnce:false, lastHTML:'', name:'', files:[],
         handoff:null, dirHandle:null, usingWorkspace:false, busy:false },
  lab: { code:'', files:[], chat:[], busy:false, deploySlug:'' },
  studio: { artifacts:[], activeId:'', prompt:'', html:'', history:[] },
};
/* `lang` is a preference, not work - somebody who writes Python should not have
   to say so again every session. `sessId` is owned by the session machinery,
   which assigns it before this runs. */
const _TOOL_KEEP = { dev:['lang','sessId'], lab:['lang','sessId'], studio:['sessId'] };
function _toolStateObj(kind){
  return kind==='dev' ? (typeof _DEV!=='undefined'?_DEV:null)
       : kind==='lab' ? (typeof _LAB!=='undefined'?_LAB:null)
       : kind==='studio' ? (typeof _STUDIO!=='undefined'?_STUDIO:null) : null;
}
function _resetToolState(kind){
  try{
    const obj = _toolStateObj(kind), def = _TOOL_DEFAULTS[kind];
    if(!obj || !def) return;
    for(const k of Object.keys(def)){
      const v = def[k];
      obj[k] = Array.isArray(v) ? [] : (v && typeof v === 'object') ? {} : v;
    }
  }catch(e){}
}
try{ window._TOOL_DEFAULTS=_TOOL_DEFAULTS; window._TOOL_KEEP=_TOOL_KEEP; }catch(e){}
function _sessResume(id){
  const rec=_SESSIONS.find(s=>s.id===id); if(!rec) return;
  const k=rec.kind, st=rec.state||{};
  // If we're currently in a different workspace tool, save & reset it first so
  // its work isn't lost when we jump away to resume this session.
  try{
    const cur=S.tab, KIND_TAB={dev:1,lab:1,studio:1};
    if(cur && KIND_TAB[cur] && cur!==k){ _sessLeave(cur); _resetToolState(cur); }
  }catch(e){}
  _resumingSession=true;   // prevent setTab's leave-hook from wiping what we restore
  _activeSession[k]=id;
  try{
    if(k==='dev'){
      _DEV.log = Array.isArray(st.log)?st.log:[];
      _DEV.lang = st.lang||'js';
      _DEV.project = st.project||{};
      _DEV.activePath = st.activePath||'';
      _DEV.curCode = st.curCode||''; _DEV.curLang = st.curLang||'';
    } else if(k==='lab'){
      _LAB.lang = st.lang||'js';
      if(st.code!=null) _LAB.code = st.code;
      _LAB.files = Array.isArray(st.files)?st.files:[];
      _LAB.chat  = Array.isArray(st.chat)?st.chat:[];
    } else if(k==='studio'){
      _STUDIO.artifacts = Array.isArray(st.artifacts)?st.artifacts:[];
      _STUDIO.activeId = st.activeId||( _STUDIO.artifacts[0]?_STUDIO.artifacts[0].id:'' );
      _STUDIO.prompt = st.prompt||'';
    }
  }catch(e){}
  const tab=SESSION_KINDS[k]?.tab||'chat';
  setTab(tab);
  _resumingSession=false;
}
function _sessDelete(id){
  _SESSIONS = _SESSIONS.filter(s=>s.id!==id);
  Object.keys(_activeSession).forEach(k=>{ if(_activeSession[k]===id) _activeSession[k]=''; });
  _persistSessions();
  try{ renderHist(); }catch(e){}
}
try{ window._sessResume=_sessResume; window._sessDelete=_sessDelete; window._sessNew=_sessNew; window._sessTouch=_sessTouch; }catch(e){}

function chkRate(email) {
  const k = email.toLowerCase();
  const a = _fails[k];
  if (!a||a.n<10) return true;
  const sec = (Date.now()-a.t)/1000;
  if (sec>=60){ _fails[k]={n:0,t:0}; return true; }
  return Math.ceil(60-sec);
}
function logFail(email) { const k=email.toLowerCase(); _fails[k]=_fails[k]||{n:0,t:0}; _fails[k].n++; _fails[k].t=Date.now(); }
function clearFails(email) { delete _fails[email.toLowerCase()]; }

function loginUser(acct) {
  S.user = { name:acct.name, email:acct.email, ini:acct.ini, provider:acct.provider||'email' };
  store('amv_user', S.user);
  /* Before anything reads a profile key. These used to be device-wide, so on a
     shared machine the second account inherited the first person's nickname,
     job and custom instructions - and those go into the system prompt. */
  try{ _migrateScopedKeys(acct.email); }catch(e){}
  clearFails(acct.email);
  const uc = loadUserConvs(acct.email);
  if (uc && uc.length) {
    S.convs = uc;
    S.cur = S.convs[0].id;
  } else {
    S.convs = [newConvObj()];
    S.cur = S.convs[0].id;
  }
  S.memory = load('amv_memory')||load('amv_mem')||[];
  _loadSessions();
  S.prompts = load('amv_pl')||getDefaultPrompts();
  S.workspaces = load('amv_ws')||getDefaultWorkspaces();
  S.mk = loadStr('amv_mk');
  closeOvr();
  goApp();
  // If they typed a message before signing in, send it now automatically.
  _sendPendingMessage();
  // First-run onboarding popup removed per product direction - it read as an
  // intrusive modal on sign-in. Mark onboarded so nothing re-triggers it.
  try{ saveStr('amv_onboarded','1'); }catch(e){}
  // if a backend session exists, pull the user's data from the server and keep it synced
  try{ if(AMVSync.enabled()){ AMVSync.pull().then(pulled=>{ if(pulled){ try{ renderView&&renderView(); updateSbUser&&updateSbUser(); }catch(e){} } }); AMVSync.start(); } }catch(e){}
}
function newConvObj(title) {
  return { id:'c'+Date.now()+Math.random().toString(36).slice(2,6), title:title||'New Conversation', msgs:[], model:'auto', starred:false, created:Date.now() };
}

function showAuthErr(msg, kind){
  const e=$('auth-err');
  if(!e) return;
  e.textContent=msg;
  e.style.display='block';
  // a success message must not be painted red
  e.classList.toggle('ae-ok', kind==='ok');
}

/* Mount the Cloudflare Turnstile CAPTCHA widget - ONLY when a site key is
   configured. Until then the container stays empty and auth relies on the
   honeypot + rate limits, so we never show a broken or blank captcha box to
   real users.

   The key arrives from /v1/public-config, which reads TURNSTILE_SITE_KEY from
   the Worker. That is deliberate: the site key is the half of Turnstile that
   is public by design (it appears in the rendered widget's own markup), and
   the Worker is the only place that knows whether this deployment has one.

   It used to come from `window.__AMV_TURNSTILE_SITE_KEY__` alone, which no
   build step, no script and no deploy path ever set - so the box hid itself on
   every page load and no browser ever produced a token. That was harmless
   while TURNSTILE_SECRET was unset, and a site-wide outage the moment an
   operator set it: _verifyCaptcha would refuse every sign-up and every sign-in
   for want of a token that could not exist. The global is still honoured as a
   deploy-time override for anyone injecting it by hand. */
function _mountTurnstile(){
  let siteKey='';
  try{ siteKey=loadStr('amv_turnstile_site')||''; }catch(e){}
  if(!siteKey && typeof window!=='undefined') siteKey=window.__AMV_TURNSTILE_SITE_KEY__||'';
  const box = document.getElementById('a-turnstile');
  if(!box) return;
  if(!siteKey){ box.style.display='none'; return; }   // not set up → hide the empty box
  box.style.display='';
  box.setAttribute('data-sitekey', siteKey);
  const render = ()=>{ try{ if(window.turnstile && box && !box.dataset.rendered){ turnstile.render(box, { sitekey: siteKey }); box.dataset.rendered='1'; } }catch(e){} };
  if(window.turnstile){ render(); return; }
  // load the script once
  if(!document.getElementById('cf-turnstile-js')){
    const s=document.createElement('script');
    s.id='cf-turnstile-js';
    s.src='https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async=true; s.defer=true;
    s.onload=render;
    document.head.appendChild(s);
  } else {
    setTimeout(render, 400);
  }
}
try{ window._mountTurnstile=_mountTurnstile; }catch(e){}

/* Collect the anti-bot fields from the auth form: the honeypot value (should be
   empty for a human) and the Turnstile token if the widget rendered. */
function _authBotFields(){
  const out = {};
  /* An invite code, if they arrived through someone's link. The server decides
     whether it is real, whose it is, and whether it is ever worth anything. */
  try{ const rc = (typeof _refPending==='function') ? _refPending() : ''; if(rc) out.ref = rc; }catch(e){}
  try{ const hp=$('a-company'); if(hp && hp.value) out.company = hp.value; }catch(e){}
  try{ if(window.turnstile && typeof turnstile.getResponse==='function'){ const t=turnstile.getResponse(); if(t) out.captchaToken=t; } }catch(e){}
  return out;
}

async function doSignupForm() {
  const nm=$('a-name')?.value.trim(), em=$('a-email')?.value.trim().toLowerCase(), pw=$('a-pass')?.value;
  if(!nm){showAuthErr('Please enter your full name.');return;}
  if(!em||!em.includes('@')||!em.includes('.')){showAuthErr('Please enter a valid email.');return;}
  if(!pw||pw.length<6){showAuthErr('Password must be at least 6 characters.');return;}
  const existing=findAccount(em);
  if(existing){
    const how = existing.provider==='google' ? 'Google' : 'email';
    // Switch straight to the sign-in form with the email filled in and focus on password.
    openAuth('login');
    const ef=$('a-email'); if(ef) ef.value=em;
    showAuthErr('You already have an account (via '+how+'). Enter your password to sign in.');
    const pf=$('a-pass'); if(pf) pf.focus();
    return;
  }
  const btn=$('auth-submit');
  if(btn){btn.disabled=true;btn.textContent='Creating…';}
  // When a backend is connected, create a real SERVER account + session token.
  if(window.AMV_API && AMV_API.live){
    try{
      const d=await AMV_API.signup(em, nm, pw, _authBotFields());
      if(d&&d.token){
        // The invite has been spent on this account. Leaving it would attach it
        // to the next person who signs up on this browser too.
        try{ if(typeof _refClear==='function') _refClear(); }catch(e){}
        const ini=nm.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2)||'??';
        // keep a local mirror so offline still recognizes the account
        await createAccount(nm,em,pw);
        closeOvr(); _completeIntroLogin({name:nm,email:em,ini,provider:'email'});
        try{ AEGIS.log('signup_complete',{provider:'email'}); }catch(e){}
        return;
      }
    }catch(e){
      if(/exists/i.test(e.message||'')){
        openAuth('login'); const ef=$('a-email'); if(ef) ef.value=em;
        showAuthErr('You already have an account. Enter your password to sign in.');
        const pf=$('a-pass'); if(pf) pf.focus(); return;
      }
      if(btn){btn.disabled=false;btn.textContent='Create Free Account';}
      showAuthErr(e.message||'Could not create account.'); return;
    }
  }
  const acct=await createAccount(nm,em,pw);
  if(acct){ closeOvr(); _completeIntroLogin(acct); try{ AEGIS.log('signup_complete',{provider:'email'}); }catch(e){} }
  else { const b=$('auth-submit');if(b){b.disabled=false;b.textContent='Create Free Account';} showAuthErr('Could not create account. Try again.'); }
}

/* Password reset - sends a secure reset link via the backend's email service.
   Real apps do exactly this: no "current password" needed. */
async function sendPasswordReset(email){
  const em=String(email||'').trim().toLowerCase();
  if(!em||!em.includes('@')) return false;
  if(window.AMV_API && AMV_API.live){
    try{
      const r=await AMV_API._fetch('/auth/reset',{method:'POST',body:JSON.stringify({email:em})});
      /* The server always returns ok:true so this cannot be used to discover
         which emails exist. `sent` is what says an email ACTUALLY went out.

         It is in the BODY, and this used to read it off the Response - `r.sent`
         on a Response is undefined, so `r.sent === true` was false on every
         call including the ones that really did send. The body was never
         parsed at all. */
      const d=await r.json().catch(()=>({}));
      if(!r.ok || d.error) return { ok:false, sent:false, error:d.error||('the server answered '+r.status) };
      return { ok:true, sent: d.sent === true };
    }
    catch(e){ return { ok:false, sent:false, error:(e&&e.message)||'' }; }
  }
  return { ok:false, sent:false, error:'no backend connected' }; // nothing can send
}
/* ══════════════════════════════════════════════════════════════
   FORGOT PASSWORD  -  email, then a 6-digit code, then a new password.

   This used to fire a "reset link" email and tell you to check your inbox
   (even when nothing had been sent, and even though the link 404'd). Now it's
   the flow people actually expect, and every state tells the truth.
   ══════════════════════════════════════════════════════════════ */
const _RESET = { email:'', token:'', step:1, sending:false, local:false };

/* Can we reset this account right here, with no server?

   When no Worker is connected, AMV keeps the account in this browser
   (localStorage, keyed by email). The forgot-password flow used to dead-end in
   that case - "AMV isn't connected to its engine" - and the only way back in
   was to open devtools and run a function by hand. That's not a real answer for
   anyone, and it's the exact situation the owner of this app was stuck in.

   So: if there's no backend AND the account exists on this device, let them set
   a new password directly. This is not a weakening. Anyone who can run this
   already has the browser open, and a local account's data lives in that same
   localStorage - they could read it regardless. The account is device-bound by
   nature, so recovery is device-bound too. */
function _localResetPossible(email){
  try{
    if(window.AMV_API && AMV_API.live) return false;   // server is the source of truth
    const acct = findAccount(email);
    if(!acct) return false;
    if(!acct.pwHash) return 'google';                  // signed up with Google - no password to reset
    return true;
  }catch(e){ return false; }
}

function openForgot(prefillEmail){
  _RESET.email = (prefillEmail || ($('a-email')?.value || '')).trim().toLowerCase();
  _RESET.token = '';
  _RESET.step = 1;
  _renderForgot();
}

function _forgotMsg(text, kind){
  const e = $('fp-msg');
  if(!e) return;
  e.textContent = text || '';
  e.className = 'fp-msg' + (text ? (' on ' + (kind || 'err')) : '');
}

function _renderForgot(){
  const ovr = $('ovr'); if(!ovr) return;
  const step = _RESET.step;

  const body =
    step === 1 ? (
      '<p class="fp-sub">Enter the email on your account and we\u2019ll send you a 6-digit code.</p>'+
      '<label class="fp-lbl" for="fp-email">Email</label>'+
      '<input id="fp-email" class="fp-in" type="email" autocomplete="email" placeholder="you@example.com" value="'+escH(_RESET.email)+'">'+
      '<button class="btn bp fp-go" id="fp-send">Send code</button>'
    ) : step === 2 ? (
      '<p class="fp-sub">We sent a 6-digit code to <b>'+escH(_RESET.email)+'</b>. It expires in 15 minutes.</p>'+
      '<label class="fp-lbl" for="fp-code">Verification code</label>'+
      '<input id="fp-code" class="fp-in fp-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000">'+
      '<button class="btn bp fp-go" id="fp-verify">Verify code</button>'+
      '<div class="fp-alt"><button id="fp-resend">Didn\u2019t get it? Send again</button>'+
      '<button id="fp-back">Use a different email</button></div>'
    ) : (
      (_RESET.local
        ? '<p class="fp-sub">Your account is saved on <b>this device only</b> - AMV isn\u2019t connected to a server yet, so there\u2019s nowhere to email a code. You can set a new password right here; your chats and projects stay exactly where they are.</p>'+
          '<div class="fp-warn">\u26a0 Because this account only exists in this browser, clearing your browsing data will delete it permanently. Connect the AMV engine in Settings to make it recoverable by email.</div>'
        : '<p class="fp-sub">Code confirmed. Choose a new password for <b>'+escH(_RESET.email)+'</b>.</p>')+
      '<label class="fp-lbl" for="fp-pw">New password</label>'+
      '<input id="fp-pw" class="fp-in" type="password" autocomplete="new-password" placeholder="At least 8 characters">'+
      '<label class="fp-lbl" for="fp-pw2">Confirm password</label>'+
      '<input id="fp-pw2" class="fp-in" type="password" autocomplete="new-password" placeholder="Type it again">'+
      '<button class="btn bp fp-go" id="fp-save">Set new password</button>'
    );

  ovr.innerHTML =
    '<div class="share-modal fp-modal">'+
      '<button class="oc" id="fp-x">&#215;</button>'+
      // The device-local path has no email step, so don't show a phantom step 3.
      (_RESET.local
        ? '<div class="fp-steps">'+
            '<span class="on">1</span><i></i>'+
            '<span class="'+(step>=3?'on':'')+'">2</span>'+
          '</div>'
        : '<div class="fp-steps">'+
            '<span class="'+(step>=1?'on':'')+'">1</span><i></i>'+
            '<span class="'+(step>=2?'on':'')+'">2</span><i></i>'+
            '<span class="'+(step>=3?'on':'')+'">3</span>'+
          '</div>')+
      '<div class="share-title">'+(step===1?'Reset your password':step===2?'Check your email':'Set a new password')+'</div>'+
      '<div id="fp-msg" class="fp-msg"></div>'+
      body+
    '</div>';
  ovr.classList.add('on');

  on($('fp-x'),'click',()=>{ closeOvr(); try{ openAuth('login'); }catch(e){} });

  if(step===1){
    const go=()=>_forgotSend();
    on($('fp-send'),'click',go);
    on($('fp-email'),'keydown',e=>{ if(e.key==='Enter') go(); });
    setTimeout(()=>$('fp-email')?.focus(),60);
  }
  if(step===2){
    const go=()=>_forgotVerify();
    on($('fp-verify'),'click',go);
    const ci=$('fp-code');
    on(ci,'keydown',e=>{ if(e.key==='Enter') go(); });
    on(ci,'input',()=>{
      ci.value = ci.value.replace(/\D/g,'').slice(0,6);
      if(ci.value.length===6) go();          // auto-submit, like every OTP field
    });
    on($('fp-resend'),'click',()=>{ _RESET.step=1; _forgotSend(true); });
    on($('fp-back'),'click',()=>{ _RESET.step=1; _renderForgot(); });
    setTimeout(()=>ci?.focus(),60);
  }
  if(step===3){
    const go=()=>_forgotSave();
    on($('fp-save'),'click',go);
    on($('fp-pw2'),'keydown',e=>{ if(e.key==='Enter') go(); });
    setTimeout(()=>$('fp-pw')?.focus(),60);
  }
}

function _resetApi(path, body){
  if(!(window.AMV_API && AMV_API.live))
    return Promise.reject(new Error('not-connected'));
  return fetch(AMV_API.base.replace(/\/$/,'')+path, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body||{})
  }).then(async r=>{
    const d = await r.json().catch(()=>({}));
    if(!r.ok || d.error) throw new Error(d.error || 'Something went wrong. Try again.');
    return d;
  });
}

async function _forgotSend(isResend){
  const em = (($('fp-email')?.value) || _RESET.email || '').trim().toLowerCase();
  if(!em || !em.includes('@')){ _forgotMsg('Enter a valid email address.'); return; }
  _RESET.email = em;

  const btn = $('fp-send');

  // No server? The account may still be right here on this device.
  const local = _localResetPossible(em);
  if(local === 'google'){
    _forgotMsg('This account signs in with Google - there\u2019s no password to reset. Close this and use \u201cContinue with Google\u201d.');
    return;
  }
  if(local === true){
    _RESET.local = true;
    _RESET.step  = 3;                       // straight to "set a new password"
    _renderForgot();
    return;
  }

  if(btn){ btn.disabled=true; btn.textContent='Sending\u2026'; }
  _forgotMsg('');
  try{
    const d = await _resetApi('/auth/reset/code', { email: em });
    if(!d.emailConfigured){
      // Honest. Do NOT tell them to check an inbox that will stay empty.
      _forgotMsg('Password reset isn\u2019t set up on this workspace yet, so no email can be sent. Contact the workspace owner'+(_supportEmail()?' at '+_supportEmail():'')+'.','err');
      if(btn){ btn.disabled=false; btn.textContent='Send code'; }
      return;
    }
    _RESET.step = 2;
    _renderForgot();
    if(isResend) _forgotMsg('New code sent.','ok');
  }catch(e){
    if(btn){ btn.disabled=false; btn.textContent='Send code'; }
    _forgotMsg(e.message==='not-connected'
      ? 'AMV isn\u2019t connected to its engine, so it can\u2019t send email. The workspace owner needs to switch it on in Settings.'
      : e.message, 'err');
  }
}

async function _forgotVerify(){
  const code = (($('fp-code')?.value)||'').replace(/\D/g,'');
  if(code.length !== 6){ _forgotMsg('Enter the 6-digit code.'); return; }
  const btn = $('fp-verify');
  if(btn){ btn.disabled=true; btn.textContent='Verifying\u2026'; }
  _forgotMsg('');
  try{
    const d = await _resetApi('/auth/reset/verify', { email:_RESET.email, code });
    _RESET.token = d.token;
    _RESET.step = 3;
    _renderForgot();
  }catch(e){
    if(btn){ btn.disabled=false; btn.textContent='Verify code'; }
    _forgotMsg(e.message, 'err');
    const ci=$('fp-code'); if(ci){ ci.value=''; ci.focus(); }
  }
}

async function _forgotSave(){
  const pw  = ($('fp-pw')?.value)||'';
  const pw2 = ($('fp-pw2')?.value)||'';
  if(pw.length < 8){ _forgotMsg('Password must be at least 8 characters.'); return; }
  if(pw !== pw2){ _forgotMsg('Those passwords don\u2019t match.'); return; }

  const btn = $('fp-save');
  if(btn){ btn.disabled=true; btn.textContent='Saving\u2026'; }
  _forgotMsg('');

  // ── Device-local reset: no server involved. ──
  if(_RESET.local){
    try{
      const existing = findAccount(_RESET.email) || {};
      const nm = existing.name || _RESET.email.split('@')[0];
      await createAccount(nm, _RESET.email, pw);   // overwrites the stored hash, same email
      const acct = await verifyLogin(_RESET.email, pw);
      if(!acct) throw new Error('Could not set the password on this device.');
      closeOvr();
      // Data is scoped by EMAIL, not password - chats and projects are untouched.
      _completeIntroLogin({ name:acct.name, email:acct.email, ini:acct.ini, provider:'email' });
      if(typeof toast==='function') toast('Password updated - you\u2019re signed in.','success',4000);
    }catch(e){
      if(btn){ btn.disabled=false; btn.textContent='Set new password'; }
      _forgotMsg(e.message || 'Could not set the password.');
    }
    return;
  }

  try{
    await _resetApi('/auth/reset/confirm', { token:_RESET.token, password:pw });
    // Straight into the account - don't make them retype what they just set.
    //
    // NOTE: AMV_API._fetch returns the raw Response, NOT parsed JSON. This code
    // used to do `const r = await _fetch(...); if(r.token)` - a Response has no
    // .token, so the auto sign-in could never fire and silently fell through to
    // the login screen. AMV_API.login() exists for exactly this: it parses the
    // body and stores the tokens properly.
    try{
      const d = await AMV_API.login(_RESET.email, { password: pw, provider:'email' });
      if(d && d.token){
        const nm = (d.user && d.user.name) || _RESET.email.split('@')[0];
        closeOvr();
        _completeIntroLogin({ name:nm, email:_RESET.email,
                              ini:String(nm)[0].toUpperCase(), provider:'email' });
        if(typeof toast==='function') toast('Password updated - you\u2019re signed in.','success',4000);
        return;
      }
    }catch(e){ /* fall through to the sign-in screen below */ }
    closeOvr();
    try{ openAuth('login'); }catch(e){}
    showAuthErr('Password updated. Sign in with your new password.','ok');
  }catch(e){
    if(btn){ btn.disabled=false; btn.textContent='Set new password'; }
    _forgotMsg(e.message, 'err');
  }
}
try{ window.openForgot=openForgot; }catch(e){}

/* doForgotPassword() removed - replaced by the 3-step code flow (openForgot).
   It produced "Couldn't send the reset email" and emailed a magic link. */

async function doLoginForm() {
  const em=$('a-email')?.value.trim().toLowerCase(), pw=$('a-pass')?.value;
  if(!em||!em.includes('@')){showAuthErr('Please enter a valid email.');return;}
  if(!pw){showAuthErr('Please enter your password.');return;}
  const rl=chkRate(em);
  if(rl!==true){showAuthErr('Too many attempts. Wait '+rl+'s.');return;}
  const btn=$('auth-submit');
  if(btn){btn.disabled=true;btn.textContent='Signing in…';}
  // When a backend is connected, authenticate against the SERVER for a real session.
  if(window.AMV_API && AMV_API.live){
    try{
      const d=await AMV_API.login(em, {password:pw, provider:'email', ..._authBotFields()});
      if(d&&d.token){
        clearFails(em);
        const nm=d.name||(findAccount(em)?.name)||em.split('@')[0];
        const ini=nm.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2)||'??';
        try{ await createAccount(nm,em,pw); }catch(e){}
        loginUser({name:nm,email:em,ini,provider:'email'});
        return;
      }
    }catch(e){
      logFail(em);
      if(btn){btn.disabled=false;btn.textContent='Sign In';}
      if(/no such|not found|404/i.test(e.message||'')){
        // Account genuinely doesn't exist on the server - carry them into signup
        // with the email filled, rather than leaving them stuck.
        openAuth('signup');
        const ef=$('a-email'); if(ef) ef.value=em;
        const nf=$('a-name'); if(nf) nf.focus();
        showAuthErr('No account found for '+em+'. Create one below.');
        return;
      }
      const msg=/wrong password/i.test(e.message||'')?'Wrong password. Please try again.':(e.message||'Sign in failed.');
      showAuthErr(msg); const pf=$('a-pass'); if(pf){ pf.value=''; pf.focus(); }
      return;
    }
  }
  const exists=findAccount(em);
  if(!exists){
    if(btn){btn.disabled=false;btn.textContent='Sign In';}
    // Don't dead-end with a bare error. This is the "no account for my email"
    // trap: the local record may be missing (cleared storage, different browser)
    // even though they think they signed up. Switch them to signup with the
    // email carried over, so one click gets them an account instead of confusion.
    openAuth('signup');
    const ef=$('a-email'); if(ef) ef.value=em;
    const nf=$('a-name'); if(nf) nf.focus();
    showAuthErr('No account found for '+em+'. Create one below - it only takes a moment.');
    return;
  }
  // Account exists but only ever used Google (no password) - point them to Google.
  if(!exists.pwHash){ if(btn){btn.disabled=false;btn.textContent='Sign In';} showAuthErr('This email uses Google sign-in. Tap \u201cContinue with Google\u201d above.'); return; }
  const acct=await verifyLogin(em,pw);
  if(!acct){
    logFail(em);
    if(btn){btn.disabled=false;btn.textContent='Sign In';}
    const r=Math.max(0,10-(_fails[em]?.n||0));
    showAuthErr(r<=5 && r>0 ? 'Wrong password. Please try again. ('+r+' attempts left)' : 'Wrong password. Please try again.');
    const pf=$('a-pass'); if(pf){ pf.value=''; pf.focus(); }
    return;
  }
  loginUser(acct);
}

// Google
function parseGJWT(token) {
  try{
    const p=token.split('.')[1];
    const b=p.replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(decodeURIComponent(atob(b).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')));
  }catch{return null;}
}
async function handleGoogleCred(resp) {
  // SECURE PATH: when a backend is connected, send the Google credential to our
  // own server to VERIFY it with Google (signature, audience, expiry) and mint a
  // real session. Never trust an unverified token client-side for anything
  // sensitive. We still read basic profile for instant UI, but the session of
  // record comes from the server.
  const p=parseGJWT(resp.credential);
  if(!p||!p.email){ showError('Google sign-in failed. Try email signup.'); return; }

  if(window.AMV_API && AMV_API.live && AMV_API.base){
    try{
      const r=await fetchDeadline(AMV_API.base.replace(/\/$/,'')+'/auth/google', {
        method:'POST', headers:{'Content-Type':'application/json'},
        // The invite code, if they arrived through one, so a Google sign-up is
        // attributed the same way an email one is. The server verifies the
        // credential itself with Google.
        body:JSON.stringify({ credential:resp.credential, ...((typeof _refPending==='function' && _refPending()) ? { ref:_refPending() } : {}) })
      });
      if(r.ok){
        const data=await r.json();
        // Spent - see doSignupForm for why it must not carry to the next account.
        try{ if(typeof _refClear==='function') _refClear(); }catch(e){}
        // server returns the verified profile + a session token
        const acct=saveGoogleAccount((data.name||p.name||p.email.split('@')[0]), (data.email||p.email));
        if(data.token){ try{ AMV_API.token=data.token; saveStr('amv_api_token', data.token); }catch(e){} }
        const pic=data.picture||p.picture;
        if(pic&&acct.email){ fetch(pic).then(x=>x.blob()).then(b=>{const rd=new FileReader();rd.onload=e=>{saveStr('amv_pfp_'+acct.email,e.target.result);updateSbUser();};rd.readAsDataURL(b);}).catch(()=>{}); }
        /* accCk, not saveStr: cookie consent is per DEVICE, so it lives in the
           unscoped bucket. saveStr would file it under this account, where the
           banner - which reads the raw key - can never find it again. */
        closeOvr(); accCk(); S.ck=true;
        document.getElementById('land')?.classList.add('hidden');
        loginUser(acct); return;
      }
      // server rejected the token - do NOT fall back to trusting it locally
      if(r.status===401||r.status===403){ showError('Google sign-in couldn\u2019t be verified. Please try again or use email.'); return; }
      // other server errors (500/offline) fall through to local demo behavior below
    }catch(e){ /* network issue → local fallback below */ }
  }

  // LOCAL / DEMO PATH (no backend connected): profile is read client-side only.
  // This is the offline/demo experience; it grants no server privileges.
  const acct=saveGoogleAccount(p.name||p.email.split('@')[0], p.email);
  if(p.picture&&acct.email) {
    fetch(p.picture).then(r=>r.blob()).then(b=>{const rd=new FileReader();rd.onload=e=>{saveStr('amv_pfp_'+acct.email,e.target.result);updateSbUser();};rd.readAsDataURL(b);}).catch(()=>{});
  }
  closeOvr();
  accCk(); S.ck=true;   // per device, through the same door the banner reads
  document.getElementById('land')?.classList.add('hidden');
  loginUser(acct);
}
function initGAuth() {
  const cid=loadStr('amv_gauth');
  if(!cid||!window.google?.accounts?.id)return;
  try{ window.google.accounts.id.initialize({client_id:cid,callback:handleGoogleCred,auto_select:false,cancel_on_tap_outside:true}); }catch(e){}
}
async function triggerGoogle() {
  const cid=loadStr('amv_gauth');
  // Real Google Sign-In: only works with a configured Client ID on a secure origin.
  if(cid && window.google?.accounts?.id){
    try{
      window.google.accounts.id.prompt(n=>{
        // If Google itself can't show the one-tap (blocked, not on HTTPS, etc.),
        // tell the user plainly instead of asking them to type an email.
        if(n && (n.isNotDisplayed?.() || n.isSkippedMoment?.())){
          toast('Google Sign-In couldn\u2019t open. Make sure you\u2019re on the live site, or sign up with email instead.','info',5000);
        }
      });
    }catch(e){
      toast('Google Sign-In is unavailable here. Please sign up with email.','info',5000);
    }
    return;
  }
  // No Client ID configured yet - Google sign-in isn't set up. Be honest, no fake prompt.
  toast('Google Sign-In isn\u2019t enabled yet. Please sign up with your email - it only takes a second.','info',5500);
}


function _wireHdrAuth(){
  const su=document.getElementById('hdr-signup');
  const li=document.getElementById('hdr-login');
  if(su && !su._wired){ su._wired=1; su.addEventListener('click',()=>{ try{ openAuth('signup'); }catch(e){} }); }
  if(li && !li._wired){ li._wired=1; li.addEventListener('click',()=>{ try{ openAuth('login'); }catch(e){} }); }
}
function goApp(){ try{ _wireHdrAuth(); }catch(e){} try{ const cy=document.getElementById('copy-year'); if(cy) cy.textContent=String(new Date().getFullYear()); }catch(e){} document.getElementById('land').classList.add('hidden'); document.getElementById('app').classList.add('on'); updateSbUser(); _initMobileSidebar(); _restoreSidebarState(); try{ _applyReduceMotion(); }catch(e){} setTab(S.tab); _ensureBackendSession(); try{ _applyFontSize(); }catch(e){} try{ _initOfflineWatch(); }catch(e){} try{ _initErrorBoundary(); }catch(e){} try{ syncEntitlement(); _checkUpgradeReturn(); }catch(e){} /* Whether a bank account is linked is the server's answer, and three different screens read it. Refreshed once on start so Crew and the chat tool are not left showing 'not connected' on a device that simply has an empty cache. */ try{ if(typeof AMVFinance!=='undefined') AMVFinance.refresh(); }catch(e){} try{ _checkTeamInvite(); }catch(e){} try{ _initKeyboardNav(); _initOverlayFocus(); _initA11y(); }catch(e){} try{ _revealAdminNav(); }catch(e){} try{ _revealTeamNav(); }catch(e){} try{ _initBuildGroup(); }catch(e){} try{ _localizePrices(document); }catch(e){} try{ const sbtn=$('sb-status'); if(sbtn) sbtn.addEventListener('click',openStatusPanel); _checkStatus(); }catch(e){} try{ _initI18nObserver(); }catch(e){} try{ _translateUI(); setTimeout(_translateUI,120); }catch(e){ console.error('Translate UI error in goApp', e); } }

/* The sidebar's "More" group was replaced by the tool rail in #sb-tools, so
   the collapsible it managed no longer exists. The function stayed behind,
   returning early on a missing element every time it was called - the same
   silent shape that made the Admin tab unreachable. Removed rather than left
   as a no-op that reads like working code. */
/* "Build" (Studio, Dev, Lab) collapses under one tappable header so the default
   sidebar stays short and calm - more room for Chat, Images, Video, Crew and
   Handoff. Collapsed by default; opens if remembered or if you're on a build
   tab (so the active item is always visible). */
const _BUILD_TABS=['studio','dev','lab'];
function _buildGroupSetOpen(open){
  const grp=document.getElementById('build-group'), tog=document.getElementById('build-toggle');
  if(!grp||!tog) return;
  grp.classList.toggle('collapsed', !open);
  tog.classList.toggle('open', open);
  tog.setAttribute('aria-expanded', open?'true':'false');
  try{ saveStr('amv_sb_build', open?'1':'0'); }catch(e){}
}
function _initBuildGroup(){
  const tog=document.getElementById('build-toggle'); if(!tog) return;
  if(!tog._b){
    tog._b=1;
    const toggle=()=>{ const grp=document.getElementById('build-group'); _buildGroupSetOpen(grp?grp.classList.contains('collapsed'):true); };
    on(tog,'click',toggle);
    on(tog,'keydown',(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } });
  }
  const remembered=(()=>{ try{ return loadStr('amv_sb_build')==='1'; }catch(e){ return false; } })();
  _buildGroupSetOpen(remembered || _BUILD_TABS.includes(S.tab));
}
/* Keep the group open whenever a build tab is active, so the highlighted item
   is never hidden. Called from setTab. */
function _buildGroupSync(){ if(_BUILD_TABS.includes(S.tab)) _buildGroupSetOpen(true); }
try{ window._initBuildGroup=_initBuildGroup; window._buildGroupSync=_buildGroupSync; }catch(e){}
function _revealAdminNav(){
  try{
    const existing=document.getElementById('nav-admin');
    if(isAdmin()){
      if(existing) return;   // already present
      /* Anchored to the tool rail, which is where Tasks actually lives. This
         used to look for `.snb[data-tab="tasks"]` - a selector the sidebar
         stopped matching when Tasks moved into the rail - so the injection
         silently found nothing and the Admin tab, whose ONLY entry point this
         is, could not be reached from the app at all. */
      const rail=document.getElementById('sb-tools');
      if(!rail) return;
      const b=document.createElement('button');
      b.className='sb-tool'; b.setAttribute('data-tab','admin'); b.id='nav-admin';
      b.title='Admin'; b.setAttribute('aria-label','Admin');
      b.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span class="sb-tool-tip">Admin</span>';
      b.addEventListener('click',()=>setTab('admin'));
      rail.appendChild(b);
    } else {
      // not the owner - the element must not exist in the DOM at all
      if(existing) existing.remove();
    }
  }catch(e){}
}

/* Teams is packaged with Elite and above, so the entry point appears for the
   people who have it - and for anyone who was invited onto a team, whatever
   they are on themselves, because the team is paying for their seat. Hidden
   rather than injected: a nav item that has to be built at runtime is a nav
   item that can silently fail to appear, which is what happened to Admin. */
function _revealTeamNav(){
  try{
    const btn=document.getElementById('nav-team');
    if(!btn) return;
    const allowed=(typeof _planAllowsTeams==='function' && _planAllowsTeams())
      || !!(window.AMVTeam && AMVTeam._cache);
    btn.hidden=!allowed;
  }catch(e){}
}
try{ window._revealTeamNav=_revealTeamNav; }catch(e){}
/* On mobile the sidebar is a fixed overlay - start it collapsed so it
   never covers the content on load. On desktop it stays open. */
function _initMobileSidebar(){
  try{
    const isMobile = window.matchMedia('(max-width:720px)').matches;
    const sb=$('sb'), ab=$('abody');
    if(isMobile){
      S.sbOpen=false;
      if(sb) sb.classList.add('cl');
      if(ab) ab.classList.add('sb-collapsed');
    } else {
      S.sbOpen=true;
      if(sb) sb.classList.remove('cl');
      if(ab) ab.classList.remove('sb-collapsed');
    }
    _renderBottomNav();
  }catch(e){}
}
// Native-feeling bottom navigation for mobile. Five primary destinations;
// "More" opens the full sidebar for everything else.
const BOTTOM_NAV=[
  {tab:'chat',   label:'Chat',   svg:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'},
  {tab:'studio', label:'Studio', svg:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>'},
  {tab:'dev',    label:'Dev',    svg:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'},
  {tab:'__more', label:'More',   svg:'<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>'},
];
function _renderBottomNav(){
  const nav=$('bottom-nav'); if(!nav) return;
  const cur=S.tab;
  nav.innerHTML=BOTTOM_NAV.map(item=>{
    const active=(item.tab===cur)||(item.tab==='chat'&&(cur==='chat'));
    return '<button class="bn-item'+(active?' on':'')+'" data-bntab="'+item.tab+'">'+
      '<span class="bn-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+item.svg+'</svg></span>'+
      '<span class="bn-lbl">'+item.label+'</span></button>';
  }).join('');
  nav.querySelectorAll('[data-bntab]').forEach(b=>b.addEventListener('click',()=>{
    const t=b.dataset.bntab;
    if(t==='__more'){ if(!S.sbOpen) toggleSb(); return; }
    setTab(t);
  }));
}
window._renderBottomNav=_renderBottomNav;
window._initMobileSidebar=_initMobileSidebar;

/* THE LAYOUT WAS DECIDED ONCE, AT BOOT, AND NEVER AGAIN.

   _initMobileSidebar picks phone-or-desktop from the viewport and runs from
   goApp(). Nothing in the product listened for the viewport CHANGING - no
   resize handler, no orientationchange, nothing.

   So: open AMV on a phone held sideways. 844px is over the 720 breakpoint, so
   it boots in desktop mode with the sidebar open. Turn the phone upright and
   the viewport becomes 390px - and the sidebar stays open, sitting on top of
   the conversation. The chat is squeezed into what is left, replies are cut
   off mid-word, and the send button is behind the panel. Which is exactly the
   three things the owner reported as separate faults: "down and side on
   mobile", "no send button showing", and a reply that looks "off centred and
   smushed". One cause.

   matchMedia's change event is the right listener rather than resize: it fires
   when the breakpoint is CROSSED and not on every pixel of a drag, so somebody
   who deliberately collapsed their sidebar on a desktop does not have it
   reopened by nudging the window. */
try{
  const _mqPhone = window.matchMedia && window.matchMedia('(max-width:720px)');
  if(_mqPhone && _mqPhone.addEventListener){
    _mqPhone.addEventListener('change', ()=>{
      try{
        _initMobileSidebar();
        /* A desktop rail preference is only meaningful on a desktop, and
           _initMobileSidebar has just cleared it on the way down. */
        if(typeof _restoreSidebarState==='function') _restoreSidebarState();
      }catch(e){}
    });
  }
}catch(e){}
async function _ensureBackendSession(){
  try{
    if(window.AMV_API && AMV_API.live && S.user && S.user.email){
      // valid token already? nothing to do.
      if(AMV_API.token && AMV_API.tokenValid()) return;
      // Token missing or expired, but we hold a refresh token → refresh NOW,
      // on boot, so the first authenticated action doesn't eat a 401+retry
      // round-trip. Single-flight in _doRefresh means this is safe to call
      // even if something else triggers a refresh at the same time.
      if(AMV_API.refreshTok){
        try{ await AMV_API._doRefresh(); }catch(e){ /* fall through */ }
      }
      // If refresh failed (or there was none), we keep whatever token we have;
      // the proxy will 401 and the user is cleanly asked to sign in again. For
      // password accounts we can't silently re-auth (no stored password).
    }
  }catch(e){ /* backend offline → app falls back to direct mode */ }
}
function toggleSb(){
  const sb=$('sb'); if(!sb) return;
  const ab=$('abody');
  const isMobile=window.matchMedia('(max-width:720px)').matches;
  if(isMobile){
    // Mobile: slide the overlay sidebar in/out
    S.sbOpen=!S.sbOpen;
    S.sbOpen?sb.classList.remove('cl'):sb.classList.add('cl');
    try{ if(ab) ab.classList.toggle('sb-collapsed', !S.sbOpen); }catch(e){}
    try{
      let bd=$('sb-backdrop');
      if(!bd){ bd=document.createElement('div'); bd.id='sb-backdrop'; bd.addEventListener('click',()=>toggleSb()); (ab||document.body).appendChild(bd); }
      bd.classList.toggle('on', S.sbOpen);
    }catch(e){}
    return;
  }
  // Desktop: collapse to a slim icon rail (not fully hidden), remembered.
  const rail=document.body.classList.toggle('sb-rail');
  try{ saveStr('amv_sb_rail', rail?'1':'0'); }catch(e){}
}
// Restore the desktop rail preference on load.
function _restoreSidebarState(){
  try{
    if(!window.matchMedia('(max-width:720px)').matches && loadStr('amv_sb_rail')==='1'){
      document.body.classList.add('sb-rail');
    }
  }catch(e){}
}
try{ window._restoreSidebarState=_restoreSidebarState; }catch(e){}
function setTab(t){
  try{ if(t==='settings' && S.tab && S.tab!=='settings') S._preSettingsTab=S.tab; }catch(e){}
  /* Counted here because this is the one place every surface is opened through,
     so the count cannot drift from what somebody actually did. The nudge itself
     is checked after the view has rendered, never before. */
  try{ if(typeof _habitTouch==='function') _habitTouch(t); }catch(e){}
  // Leaving a workspace tool (Dev/Lab/Studio): save its work to Recents, then
  // reset it so the next visit starts fresh (the work stays saved and resumable).
  // Skip entirely while resuming - _sessResume restores state and then navigates,
  // and we must not save/reset over the freshly restored session.
  try{
    const prev=S.tab;
    const KIND_TAB={dev:1,lab:1,studio:1};
    if(!_resumingSession && prev && KIND_TAB[prev] && prev!==t){
      // Lab persists across tab switches - leaving and coming back keeps your
      // code and results. Only the "+" button (new session) or a page refresh
      // starts fresh. Other tools keep the save-to-Recents-then-reset behavior.
      if(prev!=='lab'){
        _sessLeave(prev);
        _resetToolState(prev);
      }
    }
  }catch(e){}
  // Auth gate: a logged-out visitor can browse the chat tab, but using any AMV
  // feature (crew, studio, dev, lab, etc.) requires an account.
  const _gatedTabs=['crew','studio','dev','lab','handoff','workspaces','memory','team','market','tasks','integrations','apps','extensions','prompts'];
  if((!S.user||!S.user.email) && _gatedTabs.indexOf(t)>=0){
    try{ openAuth('signup'); }catch(e){}
    if(typeof toast==='function') toast('Create a free account to use '+(t.charAt(0).toUpperCase()+t.slice(1)),'info',3500);
    return;
  }
  try{ if(t!=='team' && window.AMVTeam && AMVTeam.stopPresence) AMVTeam.stopPresence(); }catch(e){}
  try{ if(t!=='chat' && window.AMVSpeech){ AMVSpeech.stop(); _voiceMode=false; const vb=$('voicemode-btn'); if(vb) vb.classList.remove('on'); } }catch(e){}
  try{ if(typeof AEGIS!=='undefined' && AEGIS.log && t && t!==S.tab){ const _fmap={chat:'chat',dev:'dev',lab:'lab',crew:'crew',studio:'studio',handoff:'handoff',workspaces:'projects',memory:'memory',team:'team',market:'marketplace',tasks:'tasks'}; if(_fmap[t]) AEGIS.log('feature',{name:_fmap[t]}); } }catch(e){}
  S.tab=t;
  try{ _renderBottomNav(); }catch(e){}
  document.querySelectorAll('.snb, .sb-tool').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  try{ _buildGroupSync(); }catch(e){}   // keep Build open when a build tab is active
  /* (old 'More' section removed - tools now live in the bottom-left row) */
  const _titles={dashboard:'Dashboard',chat:'',prompts:'Prompt Library',workspaces:'Projects',memory:'Memory',usage:'Usage',billing:'Billing',plans:'Plans',settings:'Settings',help:'Help Center',apps:'Apps',tasks:'Tasks',integrations:'Integrations',extensions:'Extensions',crew:'Crew',studio:'Studio',dev:'Dev',handoff:'Handoff',lab:'Lab',market:'Marketplace'};
  const _nt=document.getElementById('nav-title');
  if(_nt){ const lbl=_titles[t]!==undefined?_titles[t]:''; _nt.textContent=lbl; _nt.style.opacity=lbl?'1':'0'; }
  // On mobile, close the overlay sidebar after picking a destination
  try{
    if(window.matchMedia('(max-width:720px)').matches){
      const sb=$('sb'),ab=$('abody');
      S.sbOpen=false; if(sb)sb.classList.add('cl'); if(ab)ab.classList.add('sb-collapsed');
      const bd=$('sb-backdrop'); if(bd) bd.classList.remove('on');
    }
  }catch(e){}
  renderView();
  try{ _mountMobilePaneToggle(t); }catch(e){}
  try{ if(_lang()!=='auto'&&_lang()!=='en'){ _translateUI(); } }catch(e){}
  try{ _initA11y(); }catch(e){}
  try{ setTimeout(()=>{ if(typeof maybeHabitNudge==='function') maybeHabitNudge(); }, 1200); }catch(e){}
}

/* ── Mobile: stack the workbench panes and toggle between them ──────────────
   Dev and Lab show an input pane and an output pane side by side. On a phone
   that leaves each ~195px wide and the code editor unusably short. On mobile we
   stack them and show one at a time; this injects the Editor/Preview switch and
   drives the .mv-show-out class the mobile CSS keys off. No-op on desktop. */
function _mountMobilePaneToggle(tab){
  const onMobile = window.matchMedia('(max-width:760px)').matches;

  const spec = tab==='dev'
    ? { shell:'.dev-shell', blank:'dev-blank', inLabel:'Build', outLabel:'Preview', barSel:'.dev-prev-bar' }
    : tab==='lab'
    ? { shell:'.lab-split', blank:null, inLabel:'Editor', outLabel:'Output', barSel:'.lab-out-top' }
    /* Studio was the one Build surface without this (AMV-D007 step 5). Measured
       on a 390px phone: its side panel took 575px of an 844px screen and the
       live preview - the entire point of a design canvas - got a 190px strip.
       Nothing was broken, everything was reachable; it was simply the only one
       of the three that could not give the result the full screen. */
    : tab==='studio'
    ? { shell:'.studio-canvas', blank:null, inLabel:'Design', outLabel:'Preview', barSel:'.studio-frame-bar' }
    : null;
  if(!spec) return;

  const shell = document.querySelector(spec.shell);
  if(!shell) return;

  // clean any stale toggle first (tab re-renders)
  document.querySelectorAll('.mv-toggle').forEach(el=>el.remove());
  shell.classList.remove('mv-show-out');
  if(!onMobile) return;
  if(spec.blank && shell.classList.contains(spec.blank)) return;   // nothing to toggle yet

  const bar = document.createElement('div');
  bar.className = 'mv-toggle';
  bar.innerHTML =
    '<button class="on" data-mv="in">'+escH(spec.inLabel)+'</button>'+
    '<button data-mv="out">'+escH(spec.outLabel)+'</button>';

  // place it at the very top of the shell so it's always reachable
  shell.insertBefore(bar, shell.firstChild);

  const btns = bar.querySelectorAll('button');
  const show = which => {
    shell.classList.toggle('mv-show-out', which==='out');
    btns.forEach(b=>b.classList.toggle('on', b.dataset.mv===which));
  };
  btns.forEach(b=> on(b,'click', ()=>show(b.dataset.mv)));
}
try{ window._mountMobilePaneToggle=_mountMobilePaneToggle; }catch(e){}

/* When Dev/Lab produce output, auto-flip to the output pane on mobile so the
   user sees the result without hunting for the toggle. */
function _mobileShowOutput(tab){
  if(!window.matchMedia('(max-width:760px)').matches) return;
  const shell = document.querySelector(tab==='dev' ? '.dev-shell' : '.lab-split');
  if(!shell) return;
  shell.classList.add('mv-show-out');
  const bar = shell.querySelector('.mv-toggle');
  if(bar) bar.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.mv==='out'));
}
try{ window._mobileShowOutput=_mobileShowOutput; }catch(e){}
/* Wipe every scrap of per-account state from memory.
   Storage is already namespaced per account, but the in-memory copies are NOT
   automatically cleared - without this, one account's Recents / Dev project /
   Lab code leak into the next account signed in on the same browser. */
/* The S fields that may legitimately outlive a sign-out: where you were, what
   the sidebar looked like, which model and image style you picked. Anything NOT
   here and not cleared below is a field nobody has classified, and
   tests/e2e/a-reset-really-resets fails on it - which is how _entVerified and
   the admin totals were caught. A view preference crossing accounts is
   untidy; content or an entitlement crossing accounts is a defect. */
const _S_SIGNOUT_KEEP = [
  'tab','sbOpen','openTabs','settingsPane','starFilter','busy','ck','se','sp',
  'model','imgStyle','imgRatio','_researchDepth','_researchTier',
  '_adminTab','_mktTab','_setSearch','user',
];
try{ window._S_SIGNOUT_KEEP=_S_SIGNOUT_KEEP; }catch(e){}
function _wipeAccountState(){
  try{ _SESSIONS.length = 0; }catch(e){ try{ _SESSIONS=[]; }catch(e2){} }
  /* Signing out clears MORE than a new session does: the same defaults, plus the
     preferences a reset deliberately keeps. Nothing of one account's may still
     be sitting there when the next one signs in on this browser. */
  try{
    _resetToolState('dev'); _DEV.lang='js'; _DEV.sessId=null;
    _resetToolState('lab'); _LAB.lang='js'; _LAB.sessId=null;
    _resetToolState('studio'); _STUDIO.sessId=null;
  }catch(e){}
  try{
    S.memory=[]; S.convs=[]; S.cur=null; S.att=null;
    S._chatFiles=[]; S._labFiles=[]; S._chatHandoff=null; S._preSettingsTab=null;
    S.workspaces=getDefaultWorkspaces(); S.prompts=getDefaultPrompts(); S.mk='';
    /* FOUND BY ENUMERATING WHAT SURVIVED, NOT BY REMEMBERING TO ADD THEM.

       _entVerified is the SERVER'S confirmation of a plan, and verifiedPlan()
       returns it whenever a backend is connected. It outlived the account it
       belonged to: Alice on Ultra signs out, Bob signs in on the same browser,
       and verifiedPlan() answered "ultra" for Bob until the next entitlement
       sync happened to correct it. The server stays the authority on what is
       actually spent, so this was not a way to take Alice's usage - it unlocked
       the paid surfaces for a free account, which is wrong on its own.

       The admin figures are the owner's revenue and payout totals. They render
       only behind isAdmin(), so nobody else would have SEEN them, but leaving
       one account's money in memory for the next one is not a thing to leave. */
    S._entVerified=null;
    S._admFinance=null; S._admStats=null; S._admStatsError=null;
    S._admFinanceLoading=false; S._admStatsLoading=false;
    S._hoPulledConv=null;
  }catch(e){}
  try{ _CREW_RESULTS.length=0; }catch(e){}
  try{ if(typeof _TASKS!=='undefined' && Array.isArray(_TASKS)) _TASKS.length=0; }catch(e){}
}
try{ window._wipeAccountState=_wipeAccountState; }catch(e){}

/* Erase everything this device has stored for an account.
   Ordinary sign-out deliberately KEEPS your data so signing back in restores
   your work - right for a personal device. But on a shared or public computer
   (a school library, a family laptop) that leaves chats, memories, purchase
   history and an uploaded resume readable by whoever sits down next. This is
   the explicit "this is not my computer" exit.

   It removes every key namespaced to the account, plus the connection tokens
   that are stored globally. It cannot touch what the SERVER holds - deleting
   the account itself is a separate, server-side action. */
function eraseDeviceData(email){
  const who = String(email || (S.user && S.user.email) || '').toLowerCase();
  if(!who) return 0;
  const prefix = 'u:' + who + '|';
  let removed = 0;
  try{
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(k && k.indexOf(prefix) === 0){ localStorage.removeItem(k); removed++; }
    }
  }catch(e){}
  // Keys that live OUTSIDE the per-account namespace but are still personal to
  // whoever was signed in. Device preferences (theme, accent, language, rail,
  // reduced motion, backend URL, cookie choice) are deliberately NOT here: they
  // belong to the machine, and wiping them would reset the next person's screen
  // for no privacy gain.
  ['amv_gtoken','amv_gtoken_exp','amv_gauth','amv_api_token','amv_api_refresh','amv_token_exp',
   'amv_user','amv_owner','amv_credits','amv_credits_autoreload','amv_nickname','amv_work',
   'amv_instructions','amv_location_opt','amv_improve_opt','amv_cap_websearch','amv_cap_memory',
   'amv_cap_suggestions','amv_skills','amv_active_skills','amv_oauth_return','amv_oauth_state',
   'amv_analytics_id','amv_market_local','amv_market_purchases','amv_market_wallet',
   'amv_market_ratings','amv_market_reviews','amv_market_installed','amv_market_threads']
    .forEach(k => { try{ if(localStorage.getItem(k)!==null){ localStorage.removeItem(k); removed++; } }catch(e){} });
  // account-scoped records that are keyed differently
  try{
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(k && (k.indexOf('amv_oauthtx_') === 0 || k.indexOf('amv_pfp_' + who) === 0)){
        localStorage.removeItem(k); removed++;
      }
    }
  }catch(e){}
  // Family links are one shared store because a link belongs to TWO accounts.
  // Prune only the rows this person is part of - deleting the whole key would
  // silently cut the other account's links as collateral damage.
  try{
    const raw = localStorage.getItem('amv_links');
    if(raw){
      const d = JSON.parse(raw) || {};
      const keep = o => o && o.owner !== who && o.grantee !== who;
      const links = (d.links||[]).filter(keep), invites = (d.invites||[]).filter(keep);
      const dropped = ((d.links||[]).length - links.length) + ((d.invites||[]).length - invites.length);
      if(dropped > 0){
        removed += dropped;
        if(links.length || invites.length){
          localStorage.setItem('amv_links', JSON.stringify(Object.assign({}, d, { links, invites })));
        } else { localStorage.removeItem('amv_links'); }
      }
    }
  }catch(e){}
  return removed;
}
try{ window.eraseDeviceData = eraseDeviceData; }catch(e){}

/* Sign out AND wipe this device. Confirmed, because it is irreversible for
   anything that has not synced to the server. */
function signOutAndErase(){
  const who = (S.user && S.user.email) || '';
  const go = () => {
    const n = eraseDeviceData(who);
    try{ toast('Signed out and erased ' + n + ' items from this device.','success',5000); }catch(e){}
    signOut();
  };
  try{
    if(typeof confirmModal === 'function'){
      confirmModal('Erase AMV data on this device?',
        'This removes your chats, memories, projects, files and saved details from THIS device only. Anything synced to your account stays safe. Use this on a shared or public computer.',
        go);
      return;
    }
  }catch(e){}
  if(typeof confirm !== 'function' || confirm('Erase all AMV data from this device? Your account is not deleted.')) go();
}
try{ window.signOutAndErase = signOutAndErase; }catch(e){}

/* KEYS THAT LIVE OUTSIDE THE PER-ACCOUNT NAMESPACE AND STILL BELONG TO A PERSON.

   Most stored data is namespaced per account by _scopeKey, so it cannot cross.
   _GLOBAL_KEYS is the deliberate exception - things that belong to the DEVICE.
   Some of the entries in it belong to whoever was signed in instead, and
   ordinary sign-out left every one of them sitting there for the next account.

   Reproduced before fixing. Alice connects Google, signs out with the button in
   the profile menu, Bob signs in on the same browser, and Bob had:

     - amv_gtoken, Alice's Google ACCESS TOKEN. AMV reads it to reach Gmail,
       Calendar and Drive, and the Integrations screen reads the same key to
       decide Google is connected. Bob's AMV would have used it as his own.
     - amv_owner, the owner flag.
     - amv_credits, her balance.

   The list existed - eraseDeviceData has it, and calls these keys "personal to
   whoever was signed in" in as many words - but that path is only reached by
   "Sign out AND ERASE", which is presented as the thing to use on a shared
   computer. The ordinary button is the one people press.

   Device preferences are deliberately NOT here: theme, accent, language, rail,
   reduced motion, the backend URL, the cookie choice, the Google client id.
   Those belong to the machine, and clearing them would reset the next person's
   screen and their sign-in configuration for no privacy gain.

   Guarded by tests/e2e/a-reset-really-resets, which fails on any _GLOBAL_KEYS
   entry that is in neither list - so a new global key has to be classified. */
const _SIGNOUT_CLEAR_GLOBAL = [
  'amv_gtoken','amv_gtoken_exp','amv_oauth_return','amv_oauth_state',
  'amv_owner','amv_credits','amv_credits_autoreload',
  'amv_market_local','amv_market_purchases','amv_market_wallet',
  'amv_market_ratings','amv_market_reviews','amv_market_installed','amv_market_threads',
];
const _DEVICE_GLOBAL_KEYS = [
  'amv_user','amv_api_token','amv_api_refresh','amv_token_exp',
  'amv_theme','amv_accent','amv_sb_rail','amv_session_started','amv_reduce_motion',
  'amv_mute_chime','amv_api_base','amv_lang','amv_support_email','amv_gauth',
  'amv_cookie_consent','amv_analytics_id','amv_ref_code','amv_links',
];
try{ window._SIGNOUT_CLEAR_GLOBAL=_SIGNOUT_CLEAR_GLOBAL; window._DEVICE_GLOBAL_KEYS=_DEVICE_GLOBAL_KEYS; }catch(e){}
function signOut(){
  /* Retire THIS device's session server-side, and only this one. This used to
     post to /auth/logout with no body, which revoked every token on the
     account - so signing out of a laptop silently signed out a phone. The
     button says this device; now it means it. */
  try{ if(window.AMV_API && AMV_API.live && AMV_API.token) AMV_API.logout(false); }catch(e){}
  try{ localStorage.removeItem('amv_api_token'); localStorage.removeItem('amv_api_refresh'); localStorage.removeItem('amv_token_exp'); }catch(e){}
  /* Everything unscoped that belongs to the person rather than the machine.
     A connected Google account is the one that matters most: leaving its access
     token behind hands the next account somebody's mail. */
  try{ _SIGNOUT_CLEAR_GLOBAL.forEach(k => { try{ localStorage.removeItem(k); }catch(e){} }); }catch(e){}
  S.user=null; localStorage.removeItem('amv_user');
  _wipeAccountState();                 // clear Recents, Dev project, Lab code, memory - nothing crosses accounts
  const m=$('sb-popup'); if(m)m.classList.remove('on');
  // Go straight to a usable no-account chat (no intro wall). Using any AMV feature
  // will prompt sign-up/login via the auth gate.
  if(!S.convs||!S.convs.length){ S.convs=[newConvObj()]; S.cur=S.convs[0].id; }
  document.getElementById('land')?.classList.add('hidden');
  S.tab='chat'; goApp();
}


const getCurConv = ()=>S.convs.find(c=>c.id===S.cur);
const getMsgs = ()=>getCurConv()?.msgs||[];
function _ensureConv(){
  let c=getCurConv();
  if(!c){
    c=newConvObj('New chat');
    S.convs.unshift(c);
    S.cur=c.id;
  }
  return c;
}
function _autoTitle(c){
  // auto-name from the first user message
  if(c && (!c.title || c.title==='New chat' || c.title==='New Conversation')){
    const first=(c.msgs||[]).find(m=>m.r==='u');
    let t='';
    if(first){ t = typeof first.c==='string' ? first.c : (Array.isArray(first.c)? (first.c.find(x=>x.type==='text')?.text||'') : ''); }
    t=(t||'').replace(/\s+/g,' ').trim();
    if(t){ c.title = t.length>42 ? t.slice(0,42).trim()+'\u2026' : t; }
  }
}
function setMsgs(msgs){
  const c=_ensureConv();
  c.msgs=msgs;
  /* Stamp every write. Without it the sync merge can only fall back to
     `created`, so an old chat you just added to would look older than a new
     empty one and could lose to it. */
  c.updated=Date.now();
  _autoTitle(c);
  _autoSave();
  renderHist();
}
function _autoSave(){
  /* Conversations are read back by ONE path: loadUserConvs(email), keyed per
     account. This used to write a second copy to 'amv_convs' as well, and
     nothing has ever read that key.

     It was not merely wasted. It wrote the full, uncapped S.convs including
     every attachment, while saveUserConvs deliberately slims attachments and
     keeps only the last 40 messages precisely to stay inside the quota. So the
     one thing that ignored the budget was the copy nobody could read, and it is
     what pushed a heavy account into a full localStorage - at which point the
     real save fails too. Removing it is the difference between fitting and not. */
  try{
    if(S.user&&S.user.email) saveUserConvs(S.user.email,S.convs);
  }catch(e){ console.warn('AutoSave error:',e); }
  /* Kept apart on purpose: a save that fails must not also stop the history
     list from reflecting what is on screen. */
  try{
    const hdr=$('hist-header');
    if(hdr) hdr.style.display=S.convs.length?'flex':'none';
  }catch(e){}
}
function newChat(){
  const c=newConvObj();
  S.convs.unshift(c);
  S.cur=c.id;
  _autoSave();
  setTab('chat');
  renderHist();
}
function loadConv(id){ S.cur=id; setTab('chat'); renderHist(); }
function deleteConv(id){
  S.convs=S.convs.filter(c=>c.id!==id);
  if(!S.convs.length) S.convs=[newConvObj()];
  if(S.cur===id) S.cur=S.convs[0].id;
  _autoSave(); renderHist();
  if(S.tab==='chat') renderChatMsgs();
}
function starConv(id){
  const c=S.convs.find(x=>x.id===id);
  if(c){ c.starred=!c.starred; _autoSave(); renderHist(); toast(c.starred?'Chat starred':'Star removed','success'); }
}
function addToProject(id){
  const conv=S.convs.find(x=>x.id===id); if(!conv) return;
  const ws=Array.isArray(S.workspaces)?S.workspaces:[];
  const r=$('ovr'); if(!r) return;
  const list = ws.length
    ? ws.map(w=>'<button class="proj-pick" data-wid="'+w.id+'" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 12px;border:1px solid var(--bd);background:var(--s2);border-radius:var(--r-md);color:var(--tx);cursor:pointer;margin-bottom:8px;font-size:var(--t-md)"><span style="font-size:var(--t-xl)">'+_safeIcon(w.icon||'\uD83D\uDCC1')+'</span>'+escH(w.name||'Project')+'</button>').join('')
    : '<p class="ob-sub">No projects yet. Create one in the Projects tab first.</p>';
  r.innerHTML=
    '<div class="ov" id="ap-bg"><div class="ob">'+
      '<button class="oc" data-dact="closeOvr">\u00d7</button>'+
      '<h2 style="margin-bottom:4px">Add to project</h2>'+
      '<p class="ob-sub">Move \u201c'+escH(conv.title||'chat')+'\u201d into a project.</p>'+
      '<div class="af">'+list+'</div>'+
    '</div></div>';
  document.querySelectorAll('.proj-pick').forEach(btn=>{
    on(btn,'click',()=>{
      conv.wsId=btn.dataset.wid; _autoSave(); renderHist();
      const w=ws.find(x=>x.id===btn.dataset.wid);
      toast('Added to '+(w?w.name:'project'),'success');
      closeOvr();
    });
  });
  onBackdrop($('ap-bg'),closeOvr);
}
window.addToProject=addToProject;
function renameConv(id){
  const conv=S.convs.find(x=>x.id===id); if(!conv) return;
  const r=$('ovr'); if(!r) return;
  r.innerHTML=
    '<div class="ov" id="rn-bg"><div class="ob">'+
      '<button class="oc" data-dact="closeOvr">\u00d7</button>'+
      '<h2 style="margin-bottom:4px">Rename chat</h2>'+
      '<p class="ob-sub">Give this conversation a clear name.</p>'+
      '<div class="af">'+
        '<input type="text" id="rn-input" value="'+escH(conv.title||'')+'" placeholder="Chat name" style="width:100%">'+
        '<button class="btn bp" id="rn-save" style="width:100%;padding:11px">Save</button>'+
      '</div>'+
    '</div></div>';
  const inp=$('rn-input'); if(inp){ inp.focus(); inp.select(); }
  const save=()=>{ const v=($('rn-input')||{}).value||''; if(v.trim()){ conv.title=v.trim(); _autoSave(); renderHist(); } closeOvr(); };
  on($('rn-save'),'click',save);
  on($('rn-input'),'keydown',ev=>{ if(ev.key==='Enter') save(); });
  onBackdrop($('rn-bg'),closeOvr);
}
function exportConv(id){
  const c=S.convs.find(x=>x.id===id);
  if(!c) return;
  let md='# '+c.title+'\n\nExported from AMV.AI on '+new Date().toLocaleDateString()+'\n\n---\n\n';
  c.msgs.forEach(m=>{
    md+=(m.r==='u'?'**You:** ':'**AMV:** ')+(typeof m.c==='string'?m.c:(m.d||'[file]'))+'\n\n';
  });
  const blob=new Blob([md],{type:'text/markdown'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=(c.title||'chat').replace(/[^a-z0-9]/gi,'_')+'.md';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast('Chat exported as Markdown','success');
}
function _copyText(text){
  // try modern API, fall back to execCommand for non-secure contexts
  if(navigator.clipboard && window.isSecureContext){
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve,reject)=>{
    try{
      const ta=document.createElement('textarea');
      ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok=document.execCommand('copy'); document.body.removeChild(ta);
      ok?resolve():reject();
    }catch(e){ reject(e); }
  });
}
function shareConv(id){
  const c=S.convs.find(x=>x.id===id);
  if(!c) return;
  _openShareModal(c);
}
function _buildShareLink(c){
  try{
    const payload={ t:c.title||'AMV.AI chat', m:(c.msgs||[]).map(m=>({ r:m.r, c:(typeof m.c==='string'?m.c:(m.d||'[attachment]')) })) };
    const b64=btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return location.origin+location.pathname+'#share='+b64;
  }catch(e){ _logErr('buildShareLink',e); return ''; }
}
/* AMV-074: a hosted share link, when the backend is connected.

   The fragment link below still works and is still the honest fallback with no
   backend - but a fragment is never sent to a server, so a link pasted into
   Slack or X shows no title and no preview. It reads as a bare URL, which
   reads as spam. A hosted page previews properly and can be revoked. */
async function _createHostedShare(c){
  if(!(window.AMV_API && AMV_API.live && AMV_API.token)) return null;
  try{
    const r = await AMV_API._fetch('/v1/share/create', { method:'POST', body: JSON.stringify({
      title: c.title || 'Shared conversation',
      msgs: (c.msgs||[]).map(m=>({ r:m.r, c:(typeof m.c==='string'?m.c:(m.d||'[attachment]')) }))
    })});
    const d = await r.json().catch(()=>null);
    return (d && d.ok && d.url) ? { url: d.url, id: d.id } : null;
  }catch(e){ return null; }
}
/* Put a shared page into search results, or take it back out. The server owns
   the decision; this only carries it. */
async function _setShareListed(id, listed){
  if(!(window.AMV_API && AMV_API.live && AMV_API.token)) return false;
  try{
    const r = await AMV_API._fetch('/v1/share/visibility', { method:'POST', body: JSON.stringify({ id, listed:!!listed }) });
    const d = await r.json().catch(()=>null);
    return !!(d && d.ok);
  }catch(e){ return false; }
}
try{ window._setShareListed=_setShareListed; }catch(e){}
async function _openShareModal(c){
  const ovr=$('ovr'); if(!ovr) return;
  const hosted=await _createHostedShare(c);
  const link=(hosted && hosted.url)||_buildShareLink(c);
  const tooBig=!hosted && link.length>8000;
  ovr.innerHTML=
    '<div class="share-modal">'+
      '<div class="share-title">Share this conversation</div>'+
      '<p class="share-sub">'+(hosted
        ? 'Anyone with the link can read this conversation. Search engines are kept out unless you choose otherwise below, and you can revoke it any time in Settings \u2192 Privacy.'
        : 'Anyone with the link can view a read-only copy. The chat is encoded in the link itself - nothing is stored on a server.')+'</p>'+
      /* Off by default, and the copy says the part that matters: a link can be
         revoked, a search result cannot be un-seen. Anyone who wants the reach
         opts in knowing that; everyone else gets what they assumed. */
      (hosted
        ? '<label class="share-listed"><input type="checkbox" id="share-listed">'+
            '<span><b>Let this page show up in search results</b>'+
            '<em>Off by default. Turning it on can bring people to AMV - but once a page is indexed, revoking the link later does not remove it from search.</em></span>'+
          '</label><div class="share-say" id="share-listed-say" role="status" aria-live="polite"></div>'
        : '')+
      (tooBig?'<div class="share-warn">This conversation is long, so the link is large and may not work in every app. Exporting as a file may work better.</div>':'')+
      '<div class="share-link-row"><input id="share-link" class="inp" readonly value="'+escH(link)+'"><button class="btn bp" id="share-copy">Copy</button></div>'+
      '<div class="share-actions">'+
        '<button class="btn bs" id="share-native">Share via\u2026</button>'+
        '<button class="btn bs" id="share-md">Export as Markdown</button>'+
      '</div>'+
    '</div>';
  ovr.classList.add('on');
  on($('share-copy'),'click',()=>{ _copyText(link).then(()=>{ const b=$('share-copy'); if(b){b.textContent='Copied!';setTimeout(()=>b.textContent='Copy',1500);} }); });
  /* The checkbox reflects what the SERVER accepted, not what was clicked - if
     the call fails it goes back, because a tick that did not take is a lie. */
  on($('share-listed'),'change',async function(){
    const say=$('share-listed-say'); const want=this.checked;
    if(say) say.textContent = want ? 'Adding to search\u2026' : 'Removing from search\u2026';
    const ok = hosted && hosted.id ? await _setShareListed(hosted.id, want) : false;
    if(!ok){
      this.checked = !want;
      if(say) say.textContent = 'Could not change that just now - nothing was altered.';
      return;
    }
    if(say) say.textContent = want
      ? 'This page can now appear in search results.'
      : 'This page is hidden from search results again.';
  });
  on($('share-native'),'click',()=>{ if(navigator.share){ navigator.share({title:c.title||'AMV.AI chat',url:link}).catch(()=>{}); } else { _copyText(link).then(()=>toast('Link copied','success')); } });
  on($('share-md'),'click',()=>{ closeOvr(); _exportConvMarkdown(c); });
}
function _exportConvMarkdown(c){
  let md='# '+(c.title||'AMV.AI Chat')+'\n\n';
  (c.msgs||[]).forEach(m=>{ md+='**'+(m.r==='u'?'You':'AMV')+':** '+(typeof m.c==='string'?m.c:(m.d||'[attachment]'))+'\n\n'; });
  const blob=new Blob([md],{type:'text/markdown'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=(c.title||'amv-chat').replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.md';
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  toast('Exported as Markdown','success');
}
function _checkSharedView(){
  try{
    const m=(location.hash||'').match(/#share=(.+)$/);
    if(!m) return false;
    const data=JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    _renderSharedView(data);
    return true;
  }catch(e){ return false; }
}
function _renderSharedView(data){
  const msgs=(data.m||[]).map(m=>
    '<div class="shared-msg '+(m.r==='u'?'u':'ai')+'"><div class="shared-role">'+(m.r==='u'?'You':'AMV')+'</div><div class="shared-body">'+md(String(m.c||''))+'</div></div>'
  ).join('');
  document.body.innerHTML=
    '<div class="shared-view">'+
      '<div class="shared-head"><div class="shared-brand">AMV.AI</div><a class="btn bp" href="'+location.origin+location.pathname+'">Try AMV free \u2192</a></div>'+
      '<div class="shared-container"><h1 class="shared-h1">'+escH(data.t||'Shared conversation')+'</h1>'+
      '<div class="shared-msgs">'+(msgs||'<p>This conversation is empty.</p>')+'</div>'+
      '<div class="shared-foot">Shared from <b>AMV.AI</b> - the AI workforce that does the work. <a href="'+location.origin+location.pathname+'">Start free</a></div>'+
      '</div>'+
    '</div>';
  document.title=(data.t||'Shared conversation')+' - AMV.AI';
}
/* Manage and revoke hosted share links. The privacy screen already promised
   this; until now the button fell back to a toast because nothing was stored
   anywhere to manage. */
async function openSharedChatsManager(){
  const ovr=$('ovr'); if(!ovr) return;
  const live = !!(window.AMV_API && AMV_API.live && AMV_API.token);
  ovr.innerHTML='<div class="ov" id="shr-bg"><div class="ob">'+
    '<button class="oc" data-dact="closeOvr">&#215;</button>'+
    '<h2>Shared conversations</h2>'+
    '<div id="shr-body"><p class="ob-sub">Loading\u2026</p></div></div></div>';
  ovr.classList.add('on');
  onBackdrop($('shr-bg'),closeOvr);
  const body=document.getElementById('shr-body');
  if(!live){
    body.innerHTML='<p class="ob-sub">Links you create right now hold the conversation inside the link itself, so there is nothing stored to revoke - deleting the link is enough. Connect the AMV engine in Settings for shareable pages you can revoke later.</p>';
    return;
  }
  let items=[];
  try{
    const r=await AMV_API._fetch('/v1/share/list', { method:'POST', body:'{}' });
    const d=await r.json().catch(()=>null);
    items=(d&&d.ok&&d.items)||[];
  }catch(e){
    body.innerHTML='<p class="ob-sub">Could not load your shared conversations. Check your connection and try again.</p>';
    return;
  }
  if(!items.length){ body.innerHTML='<p class="ob-sub">You have not shared any conversations.</p>'; return; }
  body.innerHTML='<p class="ob-sub">Anyone with one of these links can read that conversation. Revoking a link stops it working immediately.</p>'+
    '<ul class="shr-list">'+items.map(i=>
      '<li class="shr-item"><div><div class="shr-t">'+escH(i.title||'Conversation')+'</div>'+
      '<a class="shr-u" href="'+escH(safeUrl(i.url))+'" target="_blank" rel="noopener noreferrer">'+escH(i.url)+'</a></div>'+
      '<button class="btn bs shr-rev" data-id="'+escH(i.id)+'">Revoke</button></li>').join('')+'</ul>';
  body.querySelectorAll('.shr-rev').forEach(b=>b.addEventListener('click',async()=>{
    b.disabled=true; b.textContent='Revoking\u2026';
    try{
      /* The answer decides. `_fetch` resolves for every status except 401, so
         awaiting it and moving on reported "it no longer works" over a 403, a
         404 or a 500 - and the link is public, so somebody who shared a
         conversation they now want private walks away believing they took it
         back. */
      const r=await AMV_API._fetch('/v1/share/revoke', { method:'POST', body: JSON.stringify({ id: b.dataset.id }) });
      const d=await r.json().catch(()=>({}));
      if(!r.ok || d.error){
        b.disabled=false; b.textContent='Revoke';
        toast((d.error?d.error+' ':'')+'That link is STILL WORKING. Please try again.','error',7000);
        return;
      }
      b.closest('.shr-item')?.remove();
      if(!body.querySelector('.shr-item')) body.innerHTML='<p class="ob-sub">You have not shared any conversations.</p>';
      toast('Link revoked - it no longer works.','success',3000);
    }catch(e){ b.disabled=false; b.textContent='Revoke'; toast('Could not revoke that link, so it is still working.','error',6000); }
  }));
}
try{ window.openSharedChatsManager=openSharedChatsManager; }catch(e){}
try{ window.shareConv=shareConv; }catch(e){}

