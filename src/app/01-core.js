"use strict";

const $ = id => document.getElementById(id);
// Bind an event listener. To make setup/render functions safe to run repeatedly
// (e.g. on every tab switch) without stacking duplicate listeners on persistent
// elements, we de-duplicate bindings of the SAME named handler for the same
// event on the same element. Anonymous closures are always bound (they're
// normally attached to freshly-created elements, so there's nothing to stack,
// and skipping the name-based key avoids any chance of two distinct closures
// colliding). This closes the double-fire class by construction with zero risk
// to existing behavior.
const on = (el, ev, fn) => {
  if(!el || typeof fn!=='function') return;
  if(fn.name){
    try{
      const sig = ev+'|'+fn.name;
      el.__amvOn = el.__amvOn || {};
      if(el.__amvOn[sig]) return;   // this named handler is already bound for this event
      el.__amvOn[sig] = true;
    }catch(e){ /* fall through and bind normally */ }
  }
  el.addEventListener(ev, fn);
};

/* CLICKING THE DARK PART CLOSES IT. CLICKING THE PANEL DOES NOT.

   Every overlay in AMV is a backdrop with a panel inside it, and the backdrop's
   click closes the thing. Keeping that click off the panel used to be written
   ON the panel, as onclick="event.stopPropagation()" - thirty-seven times.

   That is the wrong element to put it on, and it broke things. `data-dact` is
   dispatched by ONE listener on `document`, so a stopPropagation anywhere
   inside a panel kills every delegated button underneath it during the bubble.
   A recent-chat row in a project card shipped like that and did nothing at all
   when clicked (LESSONS #5, and the e2e file named after it). It also required
   an inline handler on every panel, which is what kept 'unsafe-inline' in the
   script CSP - so one wrong idiom cost the strongest header we have.

   The question the backdrop is actually asking is "did this click land on ME",
   and only the backdrop can answer it. `e.target === e.currentTarget` answers
   it exactly, needs nothing on the panel, and lets the click keep bubbling to
   the delegated dispatcher where it belongs. */
const onBackdrop = (el, fn) => {
  if(!el || typeof fn!=='function') return;
  el.addEventListener('click', (e) => { if(e.target === e.currentTarget) fn(e); });
};
try{ window.onBackdrop = onBackdrop; }catch(e){}
/* THE ONE DIRECTIVE A META TAG CANNOT DELIVER.

   The page's CSP carries `frame-ancestors 'none'`, and it has never done
   anything. The spec requires a policy delivered in a <meta> element to DROP
   frame-ancestors, and browsers say so out loud in the console. So the line
   that was supposed to stop AMV being put inside somebody else's page was a
   defence on paper for as long as it has been written down.

   That matters here more than on most sites. This page is where somebody
   approves a payment, confirms a payout, deletes their account and connects a
   bank. Clickjacking is exactly the attack those buttons are worth.

   The API is covered - the Worker sends X-Frame-Options and frame-ancestors as
   real headers, which work. A static file served by the host cannot, so the
   page answers the question itself, in code that runs.

   One frame is legitimate: the embeddable widget IS AMV's own page loaded in an
   iframe on a customer's site, deliberately, with `#embed=1`. It has no signed
   in account and no session to steal, so it is the exception and the only one.

   A cross-origin parent makes reading `top.location` throw, and that throw is
   itself the answer: something is framing us that we cannot see. Treated as
   framed rather than swallowed, because the case where the check breaks is the
   case where it is needed. */
function _framedWithoutPermission(){
  try{
    if(window.top === window.self) return false;                  // nobody is framing us
    if(String(location.hash||'').indexOf('embed=1') >= 0) return false;  // the widget, on purpose
    return true;
  }catch(e){
    /* Reading window.top threw, which only happens cross-origin - so we are
       framed, by someone we are not allowed to look at. */
    return String(location.hash||'').indexOf('embed=1') < 0;
  }
}

/* Refuse to render, and say why in a sentence somebody can act on. Deliberately
   NOT a frame-buster: navigating a page the visitor did not ask to leave is its
   own hostile act, and a sandboxed iframe blocks it anyway. A link they choose
   to click ends up in the same place, honestly. */
function _renderFramedRefusal(){
  try{
    const url = location.origin + location.pathname;
    document.body.className = 'framed-stop';
    document.body.innerHTML =
      '<div class="fstop">' +
        '<div class="fstop-mark">AMV</div>' +
        '<h1 class="fstop-t">AMV does not run inside another site</h1>' +
        '<p class="fstop-p">This page is embedded in a page that is not AMV. ' +
          'Because AMV can approve payments and change your account, it will not ' +
          'load here - a page you cannot see should not be able to sit over those ' +
          'buttons.</p>' +
        '<a class="fstop-b" href="' + escH(url) + '" target="_top" rel="noopener noreferrer">Open AMV directly</a>' +
      '</div>';
  }catch(e){
    try{ document.body.textContent = 'AMV does not run inside another site.'; }catch(_){}
  }
}

/* === per-account storage scoping ===
   Every data key is namespaced by the logged-in user's email so accounts
   on the same browser cannot see each other's data. A small allowlist of
   device-level keys (login record, theme, oauth handoff) stays global. */
/* NOTE: 'amv_links' (linked/family accounts) is deliberately global rather
   than per-user. A link is shared data BETWEEN two accounts - the person being
   asked must be able to see and approve the request from their own session, so
   it cannot live in the requester's private bucket. It is safe because every
   read filters by the signed-in identity (AMVFamily.check/mine), and because
   the server is authoritative for links once the backend is connected. */
const _GLOBAL_KEYS = new Set(['amv_links','amv_user','amv_theme','amv_accent','amv_sb_rail','amv_session_started','amv_credits','amv_credits_autoreload','amv_reduce_motion','amv_mute_chime','amv_oauth_return','amv_oauth_state','amv_gtoken','amv_gtoken_exp','amv_gauth','amv_api_base','amv_api_token','amv_api_refresh','amv_token_exp','amv_refresh_cookie','amv_owner','amv_lang','amv_support_email','amv_turnstile_site',
  'amv_market_local','amv_market_purchases','amv_market_wallet','amv_market_ratings','amv_market_reviews','amv_market_installed','amv_market_threads',
  'amv_cookie_consent','amv_analytics_id',
  /* An invite code is captured before anyone is signed in, and belongs to the
     visit rather than to an account - scoping it per-user would file it under
     'guest' and then hide it the moment the account it was meant for existed. */
  'amv_ref_code']);
/* These were global, and should never have been. They are one person's
   profile and choices - the nickname AMV calls you, what you do, and the custom
   instructions that go into the system prompt - so on a shared device the
   second account to sign in was greeted by the first person's name, assumed to
   do their job, and answered according to their instructions. Custom
   instructions are exactly where people write things they would not say twice.

   Moved on sign-in rather than simply re-scoped, because re-scoping alone would
   make an existing user's profile appear to vanish. The move is one-off per
   device: whoever signs in first inherits what was already visible to everyone,
   and nobody after them sees it. */
const _MIGRATE_TO_USER = ['amv_nickname','amv_work','amv_instructions',
  'amv_location_opt','amv_improve_opt','amv_cap_websearch','amv_cap_memory',
  'amv_cap_suggestions','amv_skills','amv_active_skills','amv_plugin_web',
  'amv_plugin_code','amv_plugin_canvas','amv_plugin_automations','amv_plugin_vision',
  /* These three were written through raw localStorage, which skips scoping
     entirely - so they were shared by every account on the device. The
     scheduled-jobs list is the serious one: it carries goal text and was
     executed under whoever was signed in. */
  'amv_autosched','amv_autonomy_paused','amv_build_models'];

function _migrateScopedKeys(email){
  try{
    const who = String(email||'').toLowerCase(); if(!who) return;
    for(const k of _MIGRATE_TO_USER){
      const scoped = 'u:'+who+'|'+k;
      if(localStorage.getItem(scoped) !== null) continue;   // already theirs
      const old = localStorage.getItem(k);
      if(old === null) continue;
      localStorage.setItem(scoped, old);
      /* Removed, not copied. Leaving it is the leak. */
      localStorage.removeItem(k);
    }
  }catch(e){}
}
try{ window._migrateScopedKeys=_migrateScopedKeys; }catch(e){}

function _scopeKey(k){
  if(_GLOBAL_KEYS.has(k)) return k;
  let who='guest';
  try{ if(typeof S!=='undefined' && S && S.user && S.user.email) who=S.user.email.toLowerCase(); }
  catch(e){}
  if(who==='guest'){ try{ const u=JSON.parse(localStorage.getItem('amv_user')||'null'); if(u&&u.email) who=u.email.toLowerCase(); }catch(e){} }
  return 'u:'+who+'|'+k;
}
/* ONE WAY TO HAND SOMEBODY A FILE.

   There were fourteen copies of this four-line dance across the app, and they
   had drifted: three append the anchor to the document before clicking it and
   the rest click a detached one. Studio's Download appends; Dev's did not.

   Being straight about the evidence: a detached anchor downloads fine in
   Chromium, which is the only engine testable here, so no failure was
   REPRODUCED. Appending is the pattern browsers have historically required and
   that every serious implementation still uses defensively, and it costs
   nothing - the element is added and removed within one synchronous call and
   never paints. So this is alignment on the safer of two behaviours, not a
   verified bug fix, and it should not be read as one.

   What IS certain is that fourteen copies of anything drift, and these already
   had. AMV-D007 is about exactly that.

   Converted so far: the Build surfaces (Studio and Dev), which is where the
   divergence was found. The remaining sites - chat artifacts, activity log,
   audit log, workspace exports, integrations - are catalogued in
   docs/PLAN-D007-BUILD.md rather than changed in a commit about something else. */
function amvDownload(filename, content, type){
  try{
    const blob = (content instanceof Blob) ? content : new Blob([content], { type: type || 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filename || 'download.txt';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* Revoked on a timer rather than immediately: some browsers read the blob
       asynchronously after the click returns, and revoking too early gives an
       empty file. */
    setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(e){} }, 2000);
    return true;
  }catch(e){ return false; }
}
try{ window.amvDownload = amvDownload; }catch(e){}

// Detect a storage-quota failure across browsers (name varies by engine).
function _isQuotaErr(e){
  return !!e && (e.name==='QuotaExceededError' || e.name==='NS_ERROR_DOM_QUOTA_REACHED' || e.code===22 || e.code===1014);
}
// One-time, non-nagging notice when local storage is full. We don't auto-evict
// the user's conversations (that would lose their work silently); instead we
// tell them once so they can connect a backend to sync, or clear old chats.
let _quotaNotified=false;
function _notifyStorageFull(){
  if(_quotaNotified) return; _quotaNotified=true;
  try{
    if(typeof toast==='function'){
      toast('This device\u2019s storage is full - new changes may not be saved. Connect your backend in Settings to sync, or remove some old chats.','error',7000);
    }
  }catch(e){}
}
const store = (k,v) => { try{localStorage.setItem(_scopeKey(k),JSON.stringify(v));}catch(e){ if(_isQuotaErr(e)) _notifyStorageFull(); else console.warn('localStorage store failed', k, e); } };
const load = k => { try{return JSON.parse(localStorage.getItem(_scopeKey(k)));}catch(e){ console.warn('localStorage load failed', k, e); return null; } };
const loadStr = k => { try{ return localStorage.getItem(_scopeKey(k))||''; }catch(e){ console.warn('localStorage loadStr failed', k, e); return ''; } };
const saveStr = (k,v) => { try{ localStorage.setItem(_scopeKey(k),v); }catch(e){ if(_isQuotaErr(e)) _notifyStorageFull(); else console.warn('localStorage saveStr failed', k, e); } };
/* ============================================================
   AMV_API - backend client.
   When AMV_API.base is set (to your deployed Worker URL), the app
   talks to the live backend for AI, jobs, approvals, and handoff.
   When it is empty, the app runs in LOCAL mode (per-browser demo,
   using the same storage as before). Flip live by setting the URL
   in Settings (saved to amv_api_base) - no code change needed.
   ============================================================ */
/* AMV-013: only ever attach the bearer token to the exact HTTPS origin that
   issued it. If the configured API base is swapped to another origin (injected
   config, a tricked user, or a future DOM bug), refuse to attach the token so it
   can't be exfiltrated. Re-pointing to a new backend just requires signing in
   again. localhost/127.0.0.1 are allowed for local development. */
/* AMV-061: fetch() with an actual deadline, for the calls that do not go through
   AMV_API._fetch (the AI engine, the connection test, third-party APIs).
   A plain fetch() only rejects when the connection FAILS. A connection that
   stalls - captive portal, phone switching networks, a dead tunnel whose socket
   is still open - leaves the promise pending forever, and every caller waiting
   on it is stuck with a spinner that will never stop. `ms` bounds time to the
   first byte; the body then gets its own grace so a half-delivered response
   cannot hang either. Pass stream:true when the caller reads the body itself. */
async function fetchDeadline(url, init, ms){
  const o = init || {};
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  let timedOut = false;
  const arm = t => setTimeout(() => { timedOut = true; try{ ctrl && ctrl.abort(); }catch(_){} }, t);
  const timer = ctrl ? arm(ms || 30000) : null;
  try{
    const r = await fetch(url, ctrl ? Object.assign({}, o, { signal: ctrl.signal }) : o);
    clearTimeout(timer);
    // Deliberately not cleared: harmless once the body is read, and the only
    // thing standing between a stalled body and an infinite wait.
    if(ctrl && !o.stream) arm(o.bodyTimeout || 20000);
    return r;
  }catch(e){
    clearTimeout(timer);
    if(typeof navigator !== 'undefined' && navigator.onLine === false){
      throw new Error('You appear to be offline. Check your connection and try again.');
    }
    if(timedOut) throw new Error('The server did not respond in time. Please try again.');
    throw e;
  }
}
try{ window.fetchDeadline = fetchDeadline; }catch(e){}
function _originOf(u){ try{ return new URL(u).origin; }catch(e){ return ''; } }
function _isSecureApiOrigin(o){ return /^https:\/\/[^/]+$/.test(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o); }
/* THE BACKEND THIS BUILD SHIPS WITH.

   `base` read localStorage and nothing else, so it was empty for anybody who
   had not typed a Worker URL in themselves. The owner does that once in
   Settings and their own browser is fully live - which is precisely why it
   survived: on the only machine anyone tested, everything worked. For every
   other visitor the app fell back to its local demo permanently. No engine, no
   server account, no checkout. AMV could not take money from a stranger.

   The address now travels with the artifact, in a meta tag written either by
   hand or by `AMV_API_BASE=... node build.mjs`. Read once and cached, and held
   to the same secure-origin rule as a typed one - the access token is bound to
   the origin that issued it, so an http or cross-origin default would simply
   have its Authorization header stripped and fail in a confusing way. */
let _apiBaseDefault=null;
function _defaultApiBase(){
  if(_apiBaseDefault!==null) return _apiBaseDefault;
  _apiBaseDefault='';
  try{
    const m=document.querySelector('meta[name="amv-api-base"]');
    const v=((m&&m.getAttribute('content'))||'').trim().replace(/\/+$/,'');
    if(v && _isSecureApiOrigin(_originOf(v))) _apiBaseDefault=v;
  }catch(e){}
  return _apiBaseDefault;
}
try{ window._defaultApiBase=_defaultApiBase; }catch(e){}

/* THE ADDRESS, RESOLVED - NOT THE PER-DEVICE OVERRIDE.

   `loadStr('amv_api_base')` is the override somebody types in Settings to point
   ONE browser somewhere else. It is empty on every normal visit, because a
   configured deployment carries its address in a meta tag the build writes.

   Twenty-odd places read that key directly and treated an empty answer as "no
   backend": the founder dashboard's Load stats did nothing, the go-live
   readiness panel said connect a backend first, the embed widget fell back to
   its own origin, and the API docs printed a placeholder URL - all on a
   deployment that was correctly configured. Every one of them looked like a
   dead button rather than a wrong lookup.

   This is what they should have been asking. Same resolution as AMV_API.base,
   written standalone so it is safe to call before that object exists. */
function apiBase(){
  try{ return String(loadStr('amv_api_base') || _defaultApiBase() || '').replace(/\/+$/, ''); }
  catch(e){ return ''; }
}
try{ window.apiBase=apiBase; }catch(e){}

/* THE PUBLIC SETTINGS A VISITOR NEEDS, FROM THE BACKEND THAT HAS THEM.

   The Worker holds GOOGLE_CLIENT_ID. The browser did not - so "Continue with
   Google", the first button on the sign-up sheet, was dead for everybody
   except the owner, who had pasted the id into their own Settings once. The
   same shape as the backend URL: config living in one person's localStorage
   that every visitor needs.

   Fetched once on boot and written into the keys the app already reads, so
   nothing downstream changes. A value the owner has set LOCALLY is never
   overwritten - a device pointed at staging keeps its own ids. Only values
   that are public by design are served; see publicConfig in the Worker. */
const _PUBLIC_CONFIG_MAP = {
  googleClientId: 'amv_gauth',
  /* No paypalClientId. It was here for a browser-side PayPal SDK that built
     and captured its own orders, which had to go - the browser stated the
     price and confirmed the capture. PayPal is server-side now, so the client
     id has no consumer in a browser and serving it would be surface with no
     purpose. */
  supportEmail:   'amv_support_email',
  /* The half of Turnstile that is public by design - it appears in the widget's
     own markup. Without a route to the browser the widget can never render, and
     a Worker that has TURNSTILE_SECRET would refuse every sign-up on the site
     for want of a token nobody could produce. */
  turnstileSiteKey: 'amv_turnstile_site',
};
/* DONE MEANS IT HAPPENED, NOT THAT IT WAS ATTEMPTED.

   This set `_publicConfigDone = true` as its second statement - before reading
   the base, before the fetch, before knowing there was anything to do. The page
   calls it exactly once, at boot, so any early return burned the only attempt
   that would ever be made and left every value it fetches permanently absent:
   the Google button dead, and the captcha's site key never arriving, on a
   deployment whose Worker was serving both correctly.

   Two early returns could do it. An empty base - a first paint where the
   address had not resolved yet, or a device with no backend configured - and a
   fetch that simply failed, which on a school or office network is an ordinary
   Tuesday. Neither is a permanent condition, and both were treated as one.
   Worse, it is invisible: there is no error, the values are just missing, and
   reloading looks like it should help while the flag is set again in the same
   place.

   So the flag now means "we have the config", and a separate in-flight flag
   does the job it was accidentally doing - keeping two concurrent calls from
   both fetching. A missing base or a failed request leaves both clear, so the
   next caller gets a real attempt. */
/* WHY THE CONFIG IS MISSING, WHICH IS NOT THE SAME AS IT BEING ABSENT.

   "This deployment has no captcha" and "this deployment has a captcha whose
   key we could not fetch" are the same value downstream - an empty string -
   and they need opposite behaviour. The first should hide the box; the second
   must say so, because the SERVER will still demand a token and the person is
   about to be told to complete a verification that is not on their screen.

   Nothing recorded the difference, so the honest message could not be written
   even though everything needed to write it was known at the time. */
let _publicConfigFail = '';
function configUnreachable(){ return _publicConfigFail; }
try{ window.configUnreachable=configUnreachable; }catch(e){}
let _publicConfigDone=false, _publicConfigInFlight=false;
async function _loadPublicConfig(){
  if(_publicConfigDone || _publicConfigInFlight) return;
  const base=(AMV_API && AMV_API.base) || '';
  if(!base) return;
  _publicConfigInFlight=true;
  try{
    const r=await fetchDeadline(base.replace(/\/$/,'')+'/v1/public-config',{method:'GET'},8000);
    if(!r.ok){ _publicConfigFail = _publicConfigFail || ('the server answered ' + r.status); return; }
    const d=await r.json().catch(()=>null);
    if(!d || !d.ok){ _publicConfigFail = _publicConfigFail || 'the server sent something unreadable'; return; }
    _publicConfigDone=true;
    _publicConfigFail='';
    Object.keys(_PUBLIC_CONFIG_MAP).forEach(k=>{
      const key=_PUBLIC_CONFIG_MAP[k];
      const val=String(d[k]||'').trim();
      if(!val) return;
      /* Local wins. Somebody testing against a different Google project has
         typed that id in deliberately. */
      let have=''; try{ have=loadStr(key)||''; }catch(e){}
      if(!have){ try{ saveStr(key, val); }catch(e){} }
    });
    /* Google's library is initialised at load with whatever id existed then,
       which was nothing on a first visit. Re-run it now one has arrived. */
    try{ if(typeof initGAuth==='function') initGAuth(); }catch(e){}
    /* Same for the captcha - if the sign-up sheet is already open it was drawn
       before the site key existed, and the box hid itself. */
    try{ if(typeof _mountTurnstile==='function') _mountTurnstile(); }catch(e){}
  }catch(e){
    /* A refusal that never left the browser and a server that is down look
       identical here. The policy listener below names the first one properly
       when it happens, so this is only the fallback wording - and it does not
       overwrite a reason already recorded, because that one is better. */
    _publicConfigFail = _publicConfigFail || 'the request could not be sent';
  }
  finally{ _publicConfigInFlight=false; }
}
try{ window._loadPublicConfig=_loadPublicConfig; }catch(e){}
const AMV_API = {
  /* A URL saved in Settings wins, so one device can be pointed at a staging
     Worker without rebuilding. Clearing it falls back to what shipped. */
  get base(){ try{ return loadStr('amv_api_base')||_defaultApiBase(); }catch(e){ return _defaultApiBase(); } },
  set base(v){ try{ const val=(v||'').trim(); if(val && !_isSecureApiOrigin(_originOf(val))){ try{ toast('Backend URL must be a valid https:// address','error'); }catch(e){} return; } saveStr('amv_api_base', val); }catch(e){} },
  /* AMV-019 PART TWO: THE SHORT-LIVED HALF LEAVES STORAGE TOO.

     Part one put the REFRESH token in an HttpOnly cookie, which was the half
     worth the most: weeks valid, and a copy of it is a copy of the account.
     This is the access token, and it is worth being precise about what moving
     it does and does not buy, because the sentence "the session token is no
     longer in localStorage" sounds like more than it is.

     It does NOT stop an injected script that is running on this page right now.
     Script that can read localStorage can read a module variable just as
     easily - they are both in reach of code executing in the page, and anything
     claiming otherwise is describing a different threat.

     What it does stop is everything that reads storage WITHOUT executing here:
     an extension enumerating localStorage, a shared or stolen machine, a disk
     image, a browser profile copied off a laptop - and the plain fact that a
     token in localStorage outlives the tab, so a page closed on Friday leaves a
     working credential on that machine. A token in memory dies with the page.
     That is a real and bounded win, and it is the same reasoning that took the
     Google token off disk.

     ONLY IN COOKIE MODE, and that is not a hedge. Without the cookie there is
     nothing to re-mint from, so a memory-only access token would mean signing
     in again on every reload - the feature would be "more secure" by being
     broken. A deployment with no configured origin keeps the old path and keeps
     working, which is honest degradation rather than a compromise. */
  get token(){
    if(this.cookieAuth) return this._atMem||'';
    try{ return loadStr('amv_api_token')||''; }catch(e){ return ''; }
  },
  set token(v){
    if(this.cookieAuth){
      this._atMem = v||'';
      /* Anything an earlier build left behind goes on the way past. Leaving it
         would mean this change protects new sessions only, and every existing
         one keeps the exposure it was supposed to lose. */
      try{ localStorage.removeItem('amv_api_token'); }catch(e){}
      try{ localStorage.removeItem('amv_token_exp'); }catch(e){}
      return;
    }
    try{ saveStr('amv_api_token', v||''); }catch(e){}
  },
  /* IS THERE A SESSION - which on a fresh tab is NOT "is a token in hand".

     In cookie mode a reload starts with an empty memory and a valid session in
     a cookie the page cannot read. For the few hundred milliseconds before the
     first mint, `token` is correctly empty and every screen that asked
     `AMV_API.live && AMV_API.token` would have rendered as signed out and then
     never corrected itself.

     That is the same mistake this codebase has made repeatedly in the other
     direction: one question standing in for another. "May I make a request
     right now" is `token`. "Is this person signed in" is this. The thirty-one
     places that only ever wanted the second one ask for it by name.

     `_restoring` is set synchronously at load, before anything renders, so it
     is never briefly false while a session is being restored. */
  get hasSession(){
    try{ return !!this.token || !!this._restoring; }catch(e){ return false; }
  },
  _restoring: false,
  /* AMV-019: the refresh token is the long-lived half of a session - weeks
     valid, and it mints access tokens on demand, so a copy of it is a copy of
     the account. Written to localStorage it was readable by anything that ended
     up running on the page.

     When the server holds it in an HttpOnly cookie it says so, and nothing is
     kept here at all: script cannot read the cookie, so the same injection that
     used to walk off with a month-long credential gets nothing.

     The fallback is not a compromise, it is honest degradation. A deployment
     with no configured origin cannot use a cross-origin cookie - the browser
     refuses it - so the old path stays for those, and the session keeps working
     rather than silently failing to survive a reload. */
  /* GLOBAL, NOT PER-ACCOUNT, and it was per-account - which broke the whole
     feature in a way nothing noticed.

     Everything else here is filed under the signed-in account by _scopeKey.
     This is not about a person: it is "does the server on this deployment put
     the refresh token in a cookie", which is the same answer for everybody who
     opens this build.

     Scoped, the sequence was fatal. Signing up writes it while nobody is signed
     in yet, so it lands under the anonymous scope; a moment later the account
     is created and the scope changes; and from then on cookieAuth reads a
     DIFFERENT key, finds nothing, and answers false. So the client believed it
     was holding its own refresh token, the getter went to localStorage where
     nothing had been written, and a reload restored no session at all. On the
     deployment the cookie was built for, pressing F5 signed you out.

     It was invisible because the two halves were tested apart: the Worker
     tests proved the cookie is set with the right flags, and the client tests
     read the source of the setter. Neither signed in and reloaded. Correct at
     both ends, not joined in the middle - for the sixth time in this codebase,
     and the reason a suite now does the whole round trip. */
  get cookieAuth(){ try{ return loadStr('amv_refresh_cookie')==='1'; }catch(e){ return false; } },
  set cookieAuth(v){ try{ saveStr('amv_refresh_cookie', v?'1':''); }catch(e){} },
  get refreshTok(){
    if(this.cookieAuth) return this._rtMem||'';
    try{ return loadStr('amv_api_refresh')||''; }catch(e){ return ''; }
  },
  set refreshTok(v){
    if(this.cookieAuth){
      /* Held for this page only, so a tab that has just signed in can refresh
         before the cookie has been round-tripped. It never reaches storage. */
      this._rtMem = v||'';
      try{ localStorage.removeItem('amv_api_refresh'); }catch(e){}
      return;
    }
    try{ saveStr('amv_api_refresh', v||''); }catch(e){}
  },
  get live(){ return !!this.base; },

  async _fetch(path, opts, _retried){
    const o = opts||{};
    o.headers = Object.assign({'Content-Type':'application/json'}, o.headers||{});
    // AMV-013: attach the bearer token ONLY to the secure origin it was issued for.
    const _reqOrigin = _originOf(this.base.replace(/\/$/,'') + path);
    const _boundOrigin = (loadStr('amv_api_token_origin')||'');
    if(this.token && _isSecureApiOrigin(_reqOrigin) && (!_boundOrigin || _boundOrigin===_reqOrigin)){
      o.headers['Authorization'] = 'Bearer '+this.token;
    } else { delete o.headers['Authorization']; }

    // --- Retry/backoff for transient failures (auditor #6) ---
    // Retries network errors and 5xx/429 with exponential backoff + jitter.
    // We DO NOT retry: auth endpoints, streaming, or anything caller marks
    // non-idempotent (payments), to avoid double-charging or replaying.
    const url = this.base.replace(/\/$/,'') + path;
    /* WHICH REQUESTS MAY BE SENT TWICE.

       This was a roster: a list of paths that must not be retried, extended
       each time somebody noticed another one. Rosters go stale silently, and
       this one had. /auto/create, /v1/keys/create, /v1/share/create,
       /team/create, /v1/market/message and /v1/feedback were all missing, so a
       5xx raised AFTER the write went through would send them again - leaving
       up to three live API keys the person never saw, three public share URLs
       where revoking the one they know about leaves two live, or three
       scheduled jobs quietly spending money forever.

       So the default is inverted. A mutation is not retried unless it is named
       here as safe to repeat, and "safe to repeat" means doing it twice is the
       same as doing it once: setting a value, reading through a POST, or a
       write the server makes idempotent itself. A new endpoint added tomorrow
       is not retried until somebody has thought about it, which is the way
       round that fails safely.

       GET and HEAD are always retryable - they change nothing by definition. */
    const method = String((o && o.method) || 'GET').toUpperCase();
    const mutating = method !== 'GET' && method !== 'HEAD';

    /* Safe to repeat, each because doing it twice is doing it once.

       - sync/pull, keys/list, share/list, link/list, team/get, team/audit,
         market/(threads|mylistings|purchases|earnings), family/get: reads that
         are POSTs because they take a body. Nothing is created.
       - sync/push, spend/(set|limits), widget/config, market/status,
         thread/read, approvals/edit, auto/update, team/(presence|tasks):
         they SET a value. The second write stores what the first one did.
       - the AI proxy is metered and carries its own idempotency. */
    const REPEATABLE = /\/(v1\/(chat|messages|proxy)|sync\/(pull|push)|keys\/list|share\/(list|visibility)|link\/list|team\/(get|audit|presence|tasks)|market\/(threads|mylistings|purchases|earnings|status|thread\/read|unlist|rate)|family\/get|spend\/(set|limits)|widget\/config|approvals\/edit|auto\/update)(\/|$|\?)/;

    const noRetry = o.noRetry
      || /^\/auth\//.test(path)
      || (mutating && !REPEATABLE.test(path));
    const MAX = noRetry ? 0 : 2;        // up to 2 retries (3 total attempts)

    /* AMV-061: a request with no deadline can hang forever.
       fetch() only REJECTS when the connection fails outright. A stalled
       connection - a captive portal that swallows packets, a phone moving from
       wifi to cellular, a tunnel that died with the socket still open - leaves
       the promise pending indefinitely. The retry loop below never runs, and
       every caller awaiting it is stuck: the spinner spins, "Saving..." never
       finishes, and the user has no idea whether it worked.
       So every attempt gets a hard deadline. headerMs covers time-to-first-byte;
       once the response arrives we allow a further bodyMs to read it, which also
       catches a body that stalls halfway. Callers streaming a response pass
       stream:true and take over the deadline themselves. */
    const headerMs = ('timeout' in o) ? o.timeout : (/^\/v1\/messages/.test(path) ? 120000 : 20000);
    const bodyMs = ('bodyTimeout' in o) ? o.bodyTimeout : 20000;
    let attempt = 0, r, lastErr;
    while (true) {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      let timedOut = false;
      const arm = ms => setTimeout(() => { timedOut = true; try{ ctrl && ctrl.abort(); }catch(_){} }, ms);
      let timer = (ctrl && headerMs > 0) ? arm(headerMs) : null;
      try {
        r = await fetch(url, ctrl ? Object.assign({}, o, { signal: ctrl.signal }) : o);
        clearTimeout(timer);
        /* Not cleared on purpose: if the caller reads the body promptly this
           fires against an already-consumed response and does nothing. If the
           body stalls, it turns an infinite hang into a real error. */
        if (ctrl && !o.stream && bodyMs > 0) arm(bodyMs);
      } catch (netErr) {
        clearTimeout(timer);
        lastErr = netErr;
        // Offline is not transient-in-the-next-400ms. Say so immediately rather
        // than making the user watch three silent retries first.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          throw new Error('You appear to be offline. Check your connection and try again.');
        }
        if (attempt < MAX) { await this._backoff(attempt++); continue; }
        if (timedOut) throw new Error('The server did not respond in time. Please try again.');
        throw new Error('Network error - please check your connection and try again.');
      }
      // retry on transient server errors
      if ((r.status === 500 || r.status === 502 || r.status === 503 || r.status === 504 || r.status === 529 || r.status === 429) && attempt < MAX && !noRetry) {
        // honor Retry-After if present, else exponential backoff
        const ra = parseInt(r.headers.get('Retry-After')||'0', 10);
        await this._backoff(attempt++, ra ? ra*1000 : 0);
        continue;
      }
      break;
    }

    // On 401 for an authenticated call, try a one-time silent refresh, then retry.
    if(r.status===401 && !/^\/auth\//.test(path)){
      /* Cookie mode has no refresh token on this side to test for, and that
         is the whole point of it - the browser carries one. Without this the
         401 retry never fired for exactly the deployments the cookie is for. */
      if(!_retried && (this.refreshTok || this.cookieAuth)){
        const refreshed = await this._doRefresh();
        if(refreshed){
          // re-run through _fetch so the token is re-attached under the origin guard
          return this._fetch(path, opts||{}, true);
        }
      }
      throw new Error('Session expired - sign in again');
    }
    return r;
  },
  // exponential backoff with jitter; optional floor (e.g. from Retry-After)
  _backoff(attempt, floorMs){
    const base = Math.min(8000, 400 * Math.pow(2, attempt));   // 400ms, 800ms, 1600ms...
    const jitter = Math.random() * 300;
    const wait = Math.max(floorMs||0, base + jitter);
    return new Promise(res => setTimeout(res, wait));
  },

  // sign in -> get a real server-issued access + refresh token pair
  async login(email, opts){
    if(!this.live) return null;
    const o = opts||{};
    const body = { email, name:o.name||'', password:o.password||'', provider:o.provider||'email' };
    if(o.company!=null) body.company = o.company;
    if(o.captchaToken) body.captchaToken = o.captchaToken;
    const r = await this._fetch('/auth/login', {method:'POST', body:JSON.stringify(body)});
    const d = await r.json().catch(()=>({}));
    if(d.token){ this._setTokens(d); return d; }
    throw new Error(d.error || 'Login failed');
  },
  _setTokens(d){
    /* Set BEFORE the token is stored: the setter below reads it to decide
       whether the refresh token may touch storage at all. */
    if(d && d.refreshInCookie) this.cookieAuth = true;
    this.token = d.token||'';
    if(d.refreshToken) this.refreshTok = d.refreshToken;
    // AMV-013: bind these tokens to the origin that issued them.
    try{ saveStr('amv_api_token_origin', _originOf(this.base)); }catch(e){}
    this._storeTokenMeta(d.token);
  },
  // exchange refresh token for a fresh pair; returns true on success.
  // Single-flight: if a refresh is already in progress, concurrent callers
  // await the same promise instead of each firing their own request (which
  // would race and, with refresh-token rotation, invalidate each other).
  async _doRefresh(){
    if(this._refreshInFlight) return this._refreshInFlight;
    this._refreshInFlight = (async()=>{
      // Hard timeout so a hung/stalled network request can never leave the
      // single-flight lock stuck (which would block all future refreshes).
      const ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
      const to = setTimeout(()=>{ try{ ctrl && ctrl.abort(); }catch(_){} }, 12000);
      try{
        /* In cookie mode the browser carries the token and this side may have
           nothing - which is the point, and is not a reason to give up. */
        if(!this.refreshTok && !this.cookieAuth) return false;
        const r = await fetch(this.base.replace(/\/$/,'')+'/auth/refresh', {
          method:'POST', headers:{'Content-Type':'application/json'},
          /* Sends the cookie. Only honoured cross-origin when the server
             answers with a concrete Allow-Origin and Allow-Credentials, which
             is exactly the deployment that sets the cookie in the first place. */
          credentials: this.cookieAuth ? 'include' : 'same-origin',
          body: JSON.stringify(this.refreshTok ? { refreshToken: this.refreshTok } : {}),
          signal: ctrl ? ctrl.signal : undefined
        });
        if(!r.ok) return false;
        const d = await r.json().catch(()=>({}));
        if(d.token){ this._setTokens(d); return true; }
        return false;
      }catch(e){ return false; }
      finally{ clearTimeout(to); }
    })();
    try{ return await this._refreshInFlight; }
    finally{ this._refreshInFlight = null; }
  },
  // decode exp from the JWT PAYLOAD (second segment, base64url) and remember it
  _storeTokenMeta(token){
    try{
      const seg=token.split('.')[1];
      const b64=seg.replace(/-/g,'+').replace(/_/g,'/');
      const json=decodeURIComponent(escape(atob(b64.padEnd(b64.length+(4-b64.length%4)%4,'='))));
      const body=JSON.parse(json);
      if(body.exp) saveStr('amv_token_exp', String(body.exp*1000)); // exp is in seconds
    }catch(e){}
  },
  tokenValid(){
    if(!this.token) return false;
    try{ const exp=parseInt(loadStr('amv_token_exp')||'0',10); if(exp && Date.now()>exp) return false; }catch(e){}
    return true;
  },

  // streaming AI call through the backend (same shape the app already uses)
  async messages(body){
    // stream:true - the caller reads the SSE body itself, so _fetch must not
    // arm a deadline against a response that is meant to arrive slowly.
    return this._fetch('/v1/messages', {method:'POST', body:JSON.stringify(body), stream:true});
  },

  // ---- server-side data sync ----
  // The server revision this client last saw. Echoed on push so the server can
  // tell an up-to-date client (whose deletions should stick) from a stale one
  // (whose list must be merged, never allowed to delete).
  get syncRev(){ try{ return +(loadStr('amv_sync_rev')||0) || 0; }catch(e){ return 0; } },
  set syncRev(v){ try{ saveStr('amv_sync_rev', String(+v||0)); }catch(e){} },

  async syncPull(){
    if(!this.live || !this.token) return null;
    try{ const r = await this._fetch('/sync/pull', {method:'POST', body:'{}'}); const d = await r.json();
      if(d && d.ok){ this.syncRev = d.rev || 0; return d.data; }
      return null; }
    catch(e){ return null; }
  },
  async syncPush(data, _retried){
    if(!this.live || !this.token) return false;
    try{ const r = await this._fetch('/sync/push', {method:'POST', body:JSON.stringify({data, baseRev:this.syncRev})}); const d = await r.json();
      if(d && d.ok){
        this.syncRev = d.rev || 0;
        /* The server merged because another device had written. Our in-memory
           copy is now behind what the server holds, so pull it back rather than
           carrying on from a stale list and pushing the same conflict again. */
        if(d.merged && typeof AMVSync !== 'undefined'){ try{ AMVSync.pull(); }catch(e){} }
        return true;
      }
      /* AMV-078: the server refused to write over a version it had not shown us
         - another device landed a push mid-flight. Pull what actually won, then
         push once more on top of it. One retry only: past that the honest
         answer is that this attempt did not save, and the next autosave will. */
      if(d && d.code === 'sync_busy' && !_retried && typeof AMVSync !== 'undefined'){
        try{ await AMVSync.pull(); }catch(e){}
        try{ return await this.syncPush(AMVSync.collect(), true); }catch(e){ return false; }
      }
      return false; }
    catch(e){ return false; }
  },
  async signup(email, name, password, extra){
    if(!this.live) return null;
    const body = {email,name,password, ...(extra||{})};
    const r = await this._fetch('/auth/signup', {method:'POST', body:JSON.stringify(body)});
    const d = await r.json().catch(()=>({}));
    if(d.token){ this._setTokens(d); return d; }
    throw new Error(d.error || 'Signup failed');
  },

  /* Programmatic access to this account. The key is returned exactly once, at
     creation - the server never stores it and cannot show it again. */
  async keysList(){
    if(!this.live || !this.token) return null;
    const r = await this._fetch('/v1/keys/list', {method:'POST', body:'{}'});
    return await r.json().catch(()=>null);
  },
  async keyCreate(name){
    if(!this.live || !this.token) return null;
    const r = await this._fetch('/v1/keys/create', {method:'POST', body:JSON.stringify({name})});
    const d = await r.json().catch(()=>null);
    if(!r.ok || !d || !d.ok){ const e=new Error((d&&d.error)||'could not create a key'); if(d&&d.code) e.code=d.code; throw e; }
    return d;
  },
  async keyRevoke(id){
    if(!this.live || !this.token) return false;
    const r = await this._fetch('/v1/keys/revoke', {method:'POST', body:JSON.stringify({id})});
    const d = await r.json().catch(()=>null);
    return !!(d && d.ok);
  },

  /* The allowance the SERVER actually enforces, which is the only one that can
     stop a request. Everything the Usage screen showed before this came from
     device-local counters that the server has never seen. */
  async usage(){
    if(!this.live || !this.token) return null;
    const r = await this._fetch('/v1/usage');
    return await r.json().catch(()=>null);
  },

  /* This account's own security history. Read-only, and the server is the only
     thing that writes it - nothing here can add, edit or hide an entry. */
  async activity(){
    if(!this.live || !this.token) return null;
    const r = await this._fetch('/v1/activity');
    return await r.json().catch(()=>null);
  },
  /* Sign out. `everywhere` kills every session on the account; without it this
     device's refresh token is retired and the others are left alone. */
  async logout(everywhere){
    if(!this.live || !this.token) return false;
    try{
      /* In cookie mode this side has no refresh token to name, so the cookie
         has to travel or the server cannot tell WHICH session is signing out -
         and its only safe reading of an unscoped sign-out is to end every
         session on every device. Sending the cookie is what keeps an ordinary
         sign-out about this device. */
      const r = await this._fetch('/auth/logout', {method:'POST',
        credentials: this.cookieAuth ? 'include' : 'same-origin',
        body: JSON.stringify(everywhere ? {everywhere:true} : (this.refreshTok ? {refreshToken: this.refreshTok} : {}))});
      /* Whatever the answer, this device is signed out here. */
      this._rtMem = '';
      const d = await r.json().catch(()=>({}));
      return !!(d && d.ok);
    }catch(e){ return false; }
  },

  /* This account's invite link and what it has earned. The server is the only
     source of these numbers - nothing about a referral is decided here. */
  async referral(){
    if(!this.live) return null;
    const r = await this._fetch('/v1/referral');
    return await r.json().catch(()=>null);
  },

  /* THE ANSWER HAS TO BE READ, NOT JUST WAITED FOR.

     `_fetch` resolves with the Response for every status except 401 - that is
     deliberate, because callers need the status. The cost is that `await
     this._fetch(...)` on its own succeeds just as happily on a 429, a 403, a
     400 or a 500 that outlived its retries as it does on a 200. Four writes
     were written that way, and each one then told somebody it had happened.

     The worst of them was the autonomy kill switch, whose caller was already
     careful: it waits, it has a failure branch, and that branch says "anything
     scheduled to run in the background is STILL RUNNING." It could only ever
     fire on a dropped connection. A server that answered "no" resolved, and the
     emergency stop reported "nothing runs until you resume" over jobs that were
     still running.

     One place decides what an answer means, so a write cannot be added later
     that forgets to look. */
  async _wrote(path, body, what){
    const r = await this._fetch(path, {method:'POST', body:JSON.stringify(body)});
    const d = await r.json().catch(()=>({}));
    if(!r.ok || d.error){
      /* THE SENTENCE, NOT THE CODE.

         The Worker's convention is `error` for a machine-readable code and
         `message` for the sentence a person reads - "That return address is not
         this deployment", "This account is on hold". This threw d.error, so
         every one of those routes showed somebody `bad_redirect` or
         `action_failed` and kept the sentence written for them in the response
         body, unread.

         Older routes send only `error` and send it as prose, so that is still
         the fallback. Preferring `message` when it exists costs those nothing
         and stops the newer ones speaking in codes. */
      const e = new Error(d.message || d.error || what || 'That could not be completed.');
      e.code = d.code || (r.status===429 ? 'rate_limited' : 'failed');
      e.status = r.status;
      throw e;
    }
    return d;
  },

  // jobs / approvals / handoff
  async jobs(){ const r=await this._fetch('/api/jobs'); return (await r.json()).jobs||[]; },
  async toggleJob(id,on){ return this._wrote('/api/jobs',{id,on},'That switch could not be saved.'); },
  async approvals(){ const r=await this._fetch('/api/approvals'); return (await r.json()).approvals||[]; },
  async actApproval(id,action){ return this._wrote('/api/approvals/act',{id,action}); },
  async pauseAutonomy(paused){ return this._wrote('/auto/pause',{paused:!!paused},'The server did not accept that.'); },
  /* Public on purpose, and unauthenticated: it is an aggregate count of a
     public catalogue. No token is attached because none is needed, and one
     less endpoint that reads a session is one less endpoint to get wrong. */
  async crewPopular(){ const r=await this._fetch('/crew/popular'); return await r.json(); },
  /* CONNECTED ACCOUNTS. Note what is absent: there is no method here that
     fetches a provider token, because no route on the server returns one. The
     browser can start a connection, finish one, list what exists as metadata,
     and remove one. It can never hold the credential. */
  async connectStart(provider, scopes, redirect){
    return this._wrote('/v1/connect/start', { provider, scopes, redirect },
      'That connection could not be started.');
  },
  async connectFinish(code, state){
    return this._wrote('/v1/connect/finish', { code, state },
      'That connection could not be completed.');
  },
  async connectList(){ const r=await this._fetch('/v1/connect/list'); return await r.json(); },
  async connectRemove(id){
    return this._wrote('/v1/connect/remove', { id }, 'That could not be disconnected.');
  },
  /* ACT on a connected account. Note what this does NOT do: it does not fetch a
     token and then use it. It asks the server to do the thing, and the answer
     is the result. That is the whole difference between this system and the one
     it replaces - the credential never comes here, so nothing that gets a
     foothold on this page can take it, and the same call works when the tab is
     shut because it was never the tab doing it. */
  async connectAct(action, args){
    return this._wrote('/v1/connect/act', { action, args: args || {} },
      'That could not be done on your connected account.');
  },
  async createHandoff(h){ return this._wrote('/api/handoff',h,'That handoff was not accepted.'); },
  async listHandoff(){ const r=await this._fetch('/api/handoff'); return await r.json(); },
  async actHandoff(id,action){ return this._wrote('/api/handoff/act',{id,action},'That could not be updated.'); },

  // ---- PAYMENTS (secure backend) ----
  async stripeCheckout(plan,email,seats){ const r=await this._fetch('/v1/stripe/checkout',{method:'POST',body:JSON.stringify({plan,email,seats})}); const d=await r.json(); if(!r.ok||!d.url){ const e=new Error(d.error||'checkout failed'); e.code=d.code; throw e; } return d.url; },
  /* There is deliberately no paypalCreate/paypalCapture here. Those routes
     back a one-time ORDER, and the browser flow that used them built the order
     with a client-stated amount and captured it client-side - so a plan could
     be bought for a price the payer chose, and a payment AMV's server never
     confirmed still unlocked a monthly plan. AMV sells subscriptions, and
     paypalSubscribe below is how: PayPal states the price from the plan the
     server registered, and the webhook is what grants anything. */
  async paypalSubscribe(plan,email){ const r=await this._fetch('/v1/paypal/subscribe',{method:'POST',body:JSON.stringify({plan,email})}); const d=await r.json(); if(!r.ok||!d.url) throw new Error(d.error||'subscribe failed'); return d.url; },
  /* A bug report that reaches a person. Returns what really happened - `ok`
     that it is stored server-side, and `notified` separately, because those
     are different promises and only one of them is always true. */
  async support(kind, text, ctx){
    if(!this.live) throw new Error('AMV is not connected to a backend on this device.');
    const r = await this._fetch('/v1/support', {method:'POST',
      body: JSON.stringify(Object.assign({ kind, text }, ctx||{}))});
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.ok) throw new Error(d.error || 'That could not be sent.');
    return d;
  },
  async entitlement(email){ const r=await this._fetch('/v1/entitlement?email='+encodeURIComponent(email||'')); return await r.json(); },
  /* Family (AMV-102). The parent's controls; there is deliberately no method
     here for reading a child's conversations, because no such route exists. */
  async familyGet(){ const r=await this._fetch('/v1/family/get',{method:'POST',body:'{}'}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  async familyLimits(child,limits){ const r=await this._fetch('/v1/family/limits',{method:'POST',body:JSON.stringify({child,limits})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  async familyLeave(){ const r=await this._fetch('/v1/family/leave',{method:'POST',body:'{}'}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  async familyRemove(child){ const r=await this._fetch('/v1/family/remove',{method:'POST',body:JSON.stringify({child})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  /* Who can reach this account, and taking it back. Both routes existed and
     were careful - revoking deactivates the link on BOTH sides - and no client
     code had ever called either, so access could be granted and never seen
     again, let alone withdrawn. */
  async linkList(){ const r=await this._fetch('/v1/link/list',{method:'POST',body:'{}'}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  async linkRevoke(id){ const r=await this._fetch('/v1/link/revoke',{method:'POST',body:JSON.stringify({id})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },

  /* Spending limits live on the server, because the browser copy is the
     editable one. These are the only way the screen should read or write them. */
  async spendLimits(){ const r=await this._fetch('/v1/spend/limits',{method:'POST',body:'{}'}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  async spendSet(limits){ const r=await this._fetch('/v1/spend/set',{method:'POST',body:JSON.stringify({limits})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },

  /* THE THINGS PEOPLE ALREADY DO, WHERE THEY LIVE.
     A GET, because the catalogue is public and the answer for a country is the
     same for everybody who asks - so the browser and the edge can both cache
     it, and somebody clicking through five countries costs five cached reads
     rather than five calls. */
  async everyday(country){ const r=await this._fetch('/v1/everyday?country='+encodeURIComponent(country||'')); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Could not load these.'); return d; },
  /* WHAT AMV DOES, PER COUNTRY. Computed on the server from the same
     registries the features use, so this can never claim more than exists. */
  async coverage(){ const r=await this._fetch('/v1/coverage',{method:'POST',body:'{}'}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Could not load coverage.'); return d; },
  async telegramStatus(){ const r=await this._fetch('/v1/telegram/status',{method:'POST',body:'{}'}); return await r.json().catch(()=>({})); },
  async telegramConnect(b){ const r=await this._fetch('/v1/telegram/connect',{method:'POST',body:JSON.stringify(b)}); const d=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(d.error||'Could not connect.'),{code:d.code}); return d; },
  async telegramDisconnect(){ const r=await this._fetch('/v1/telegram/disconnect',{method:'POST',body:'{}'}); return await r.json().catch(()=>({})); },
  async telegramSend(text){ const r=await this._fetch('/v1/telegram/send',{method:'POST',body:JSON.stringify({text})}); const d=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(d.error||'Could not send.'),{code:d.code}); return d; },
  /* GLOBAL JOB BOARDS. The apply call is the one that was missing entirely:
     the job hunt has always described an email application as something AMV
     submits end to end, and there was no route behind it. */
  async jobBoards(){ const r=await this._fetch('/v1/jobs/boards',{method:'POST',body:'{}'}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Could not load job boards.'); return d; },
  async jobApply(body){ const r=await this._fetch('/v1/jobs/apply',{method:'POST',body:JSON.stringify(body)}); const d=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(d.error||'Could not send the application.'),{code:d.code}); return d; },
  /* GLOBAL MAIL - the same shape as every other call here.

     `password` goes up and never comes back: the server encrypts it, stores
     the ciphertext and returns only what a person needs to see. Nothing in
     this file keeps a copy, so a person's mailbox password never sits in
     localStorage the way an integration token does. */
  async mailProviders(){ const r=await this._fetch('/v1/mail/providers',{method:'POST',body:'{}'}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Could not load providers.'); return d; },
  async mailStatus(){ const r=await this._fetch('/v1/mail/status',{method:'POST',body:'{}'}); return await r.json().catch(()=>({})); },
  async mailConnect(body){ const r=await this._fetch('/v1/mail/connect',{method:'POST',body:JSON.stringify(body)}); const d=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(d.error||'Could not connect.'),{code:d.code}); return d; },
  async mailDisconnect(){ const r=await this._fetch('/v1/mail/disconnect',{method:'POST',body:'{}'}); return await r.json().catch(()=>({})); },
  async mailInbox(limit){ const r=await this._fetch('/v1/mail/inbox',{method:'POST',body:JSON.stringify({limit:limit||20})}); const d=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(d.error||'Could not read the mailbox.'),{code:d.code}); return d; },
  async mailMessage(uid){ const r=await this._fetch('/v1/mail/message',{method:'POST',body:JSON.stringify({uid})}); const d=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(d.error||'Could not read that message.'),{code:d.code}); return d; },
  async mailSend(body){ const r=await this._fetch('/v1/mail/send',{method:'POST',body:JSON.stringify(body)}); const d=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(d.error||'Could not send.'),{code:d.code}); return d; },
  async portal(customer){ const r=await this._fetch('/v1/stripe/portal',{method:'POST',body:JSON.stringify({customer})}); const d=await r.json(); if(!r.ok||!d.url) throw new Error(d.error||'Could not open billing.'); return d.url; },
};
window.AMV_API = AMV_API;

/* SET BEFORE ANYTHING RENDERS, AND SET SYNCHRONOUSLY.

   In cookie mode a reload begins with no access token in hand and a live
   session in a cookie this page cannot read. If `_restoring` were set later -
   inside the boot refresh, say - there would be a window where hasSession
   answered false while a perfectly good session was being restored, and every
   screen that rendered in that window would have drawn itself signed out.

   The condition is deliberately "cookie mode AND somebody was signed in here",
   not cookie mode alone: a first-time visitor has no session to restore and
   must not be told they have one. `amv_user` is a name and an address, not a
   credential, which is why it is still on disk and can be asked. */
try{
  AMV_API._restoring = !!(AMV_API.cookieAuth && loadStr('amv_user'));
}catch(e){ AMV_API._restoring = false; }
/* CAN THIS PAGE EVEN TALK TO THAT HOST?

   connect-src is fixed when the page is built, so a backend typed in here can
   be perfectly correct and still unreachable - the browser refuses the request
   before it leaves, and every call comes back "Failed to fetch". Indis-
   tinguishable, from the outside, from a server that is down or a URL with a
   typo, and somebody would reasonably spend an evening on the wrong problem.

   The policy is readable from the page, so this is answerable rather than
   guessable. Returns null when it cannot be read, and the caller says nothing
   in that case: a warning invented from an unknown is worse than silence. */
function _cspReachable(origin){
  try{
    var m=document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if(!m || !m.content) return null;
    var d=(m.content.match(/connect-src\s([^;]*);/)||[,''])[1];
    if(!d) return null;
    var toks=d.split(/\s+/).filter(Boolean);
    if(toks.indexOf('*')>=0 || toks.indexOf('https:')>=0) return true;
    if(origin===location.origin && toks.indexOf("'self'")>=0) return true;
    for(var i=0;i<toks.length;i++){
      var t=toks[i];
      if(t===origin) return true;
      if(t.indexOf('https://*.')===0 && origin.slice(-(t.length-9))===t.slice(9)) return true;
    }
    return false;
  }catch(e){ return null; }
}
function amvSaveBackend(){
  var v=(document.getElementById('be-url')||{}).value||'';
  AMV_API.base=v.trim();
  if(!v.trim()){ toast('Cleared - local mode','info'); }
  else {
    var origin=''; try{ origin=new URL(v.trim()).origin; }catch(e){}
    var reach=origin?_cspReachable(origin):null;
    if(reach===false){
      toast('Saved, but this page is not allowed to contact '+origin+'. Its security policy is '
           +'fixed when AMV is built, so a backend on a new host has to be built in with '
           +'AMV_API_BASE - otherwise every request is refused before it is sent.','error',9000);
    } else {
      toast('Backend URL saved','info');
    }
  }
  if(typeof renderSetPane==='function') renderSetPane();
}
async function amvBackendLogin(){ var em=(document.getElementById('be-email')||{}).value||''; var pw=(document.getElementById('be-pass')||{}).value||''; if(!em.trim()){ toast('Enter your email','error'); return; } if(!pw){ toast('Enter your password','error'); return; } if(!AMV_API.live){ toast('Set the backend URL first','error'); return; } try{ await AMV_API.login(em.trim(), {name:(S.user&&S.user.name)||'', password:pw}); var p=document.getElementById('be-pass'); if(p) p.value=''; toast('Connected to backend','info'); if(typeof renderSetPane==='function') renderSetPane(); }catch(e){ toast(e.message||'Login failed','error'); } }
window.amvSaveBackend=amvSaveBackend; window.amvBackendLogin=amvBackendLogin;



function escH(t) {
  return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/* Zero em/en dashes anywhere AMV produces text - so nothing reads as
   AI-generated and the site uses only a plain hyphen. */
function _noDash(t){ return (t==null?'':String(t)).replace(/[\u2014\u2013]/g,'-'); }

/* ============================================================
   A URL THAT CAME FROM SOMEWHERE ELSE, ON ITS WAY INTO A LINK

   escH stops a value from breaking OUT of an attribute. It says nothing about
   whether the value is safe INSIDE one, and those are different questions.
   `javascript:alert(1)` contains not one character escH touches, so it passes
   through untouched and runs when the link is clicked. A browser enforcing the
   CSP would refuse it too, now that script-src no longer allows inline script -
   but that is a second line, not this one. It depends on the header arriving,
   on the browser honouring it, and on nobody widening the directive later.

   The URLs that reach an href, a src, or window.open in this app are not all
   ours. They come from web search results, an image or video provider's CDN,
   an artifact somebody shared by link, a payment processor's redirect. Each of
   those is a place where a wrong string becomes an executable one.

   So a scheme allowlist, in one place: only what fetches. Everything else
   returns empty, which renders as a dead link instead of a live hazard, and a
   dead link is a bug somebody reports rather than an account somebody loses.
   ============================================================ */
function safeUrl(u){
  const s = String(u == null ? '' : u).trim();
  if(!s) return '';
  if(/^https?:\/\//i.test(s)) return s;
  if(/^\/(?!\/)/.test(s)) return s;        // same-origin path, but not //evil.com
  if(/^mailto:[^\s<>"']+$/i.test(s)) return s;
  return '';
}
/* Images and video may additionally be a base64 data URL, because a provider
   can answer with the bytes rather than a link. Held to an exact shape - a
   known media type and a base64 payload - rather than "starts with data:",
   which would also admit data:text/html. */
function safeMediaSrc(u){
  const s = String(u == null ? '' : u).trim();
  if(/^data:(image\/(png|jpeg|jpg|gif|webp|avif)|video\/(mp4|webm));base64,[A-Za-z0-9+/=]+$/i.test(s)) return s;
  return safeUrl(s);
}
try{ window.safeUrl=safeUrl; window.safeMediaSrc=safeMediaSrc; }catch(e){}

/* ============================================================
   AVATARS - one shared source of truth so the default is identical
   everywhere. If a user hasn't set a photo, they get the generic AMV
   avatar (a branded SVG mark on the brand gradient). They can change
   it in Settings; once set, amv_pfp_<email> holds their image.
   ============================================================ */
/* ── AMV signature mark ────────────────────────────────────────
   The brand monogram: an abstract ascending "A" built from a rising
   chevron + a spark, in the signature periwinkle→violet gradient.
   It's the one ownable visual idea, reused at every size. Pass a size
   (px) and optional {glow, id} - id keeps the gradient defs unique so
   multiple marks on one page don't collide. */
let _amvMarkSeq = 0;
function amvMark(size, opts){
  opts = opts || {};
  const s = size || 28;
  const gid = 'amvMk' + (opts.id || (++_amvMarkSeq));
  // glow softens strokes at tiny sizes - keep small marks crisp automatically
  const glow = (opts.glow !== false) && s >= 24;
  // viewBox 0..40. The mark: a bold upward chevron (the peak of an "A"),
  // its left leg extended, and a small detached spark at the apex - reads
  // as momentum/craft. Rounded joins keep it friendly at small sizes.
  return (
    '<svg class="amv-mark" width="'+s+'" height="'+s+'" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block">'+
      '<defs>'+
        '<linearGradient id="'+gid+'" x1="6" y1="34" x2="34" y2="6" gradientUnits="userSpaceOnUse">'+
          '<stop stop-color="#5590ff"/><stop offset="1" stop-color="#4d7ef5"/>'+
        '</linearGradient>'+
        (glow?'<filter id="'+gid+'f" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.1" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>':'')+
      '</defs>'+
      '<g'+(glow?' filter="url(#'+gid+'f)"':'')+' stroke="url(#'+gid+')" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">'+
        // the A: left leg rising to apex, then down the right - an open peak
        '<path d="M9 32 L20 10 L31 32" fill="none"/>'+
        // the crossbar, offset for a distinctive asymmetric cut
        '<path d="M14.5 24 L23.5 24" fill="none"/>'+
      '</g>'+
      // apex spark - a small detached mark that gives the logo its signature
      '<circle cx="20" cy="6.2" r="2.4" fill="url(#'+gid+')"/>'+
    '</svg>'
  );
}
try{ window.amvMark = amvMark; }catch(e){}

// The generic AMV profile picture - same for everyone until they change it.
function _defaultAvatarSVG(){
  // Unique gradient id per call - two avatars on one page must not share an id
  // (a duplicate SVG def id makes the second reference the first, misrendering).
  const g='amvAvG'+(++_amvMarkSeq);
  return '<svg viewBox="0 0 40 40" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style="display:block">'+
    '<defs><linearGradient id="'+g+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5590ff"/><stop offset="1" stop-color="#4478e8"/></linearGradient></defs>'+
    '<rect width="40" height="40" fill="url(#'+g+')"/>'+
    '<text x="20" y="26" text-anchor="middle" font-family="Inter,Segoe UI,sans-serif" font-size="15" font-weight="800" letter-spacing="-1" fill="#fff">A</text>'+
  '</svg>';
}
// The stored photo for an email, or '' if none.
function _pfpFor(email){ try{ return email?loadStr('amv_pfp_'+String(email).toLowerCase()):''; }catch(e){ return ''; } }
// Inner avatar markup: the photo if set, else the generic AMV avatar.
// (Caller provides the round container; this fills it.)
function _avatarInner(email){
  const pfp=_pfpFor(email);
  /* Always a data:image URL this browser made with FileReader, so in practice
     it is safe - but "in practice" is what every one of these was before it
     was not, and a stored value is a stored value. It goes through the same
     allowlist as every other picture, and anything the allowlist will not
     vouch for falls back to the generic mark rather than to a broken image
     icon: a picture that cannot be shown is not a reason to show nothing. */
  const safePfp = pfp ? safeMediaSrc(pfp) : '';
  if(safePfp) return '<img src="'+escH(safePfp)+'" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">';
  return _defaultAvatarSVG();
}
// A complete round avatar element of a given pixel size.
function _avatarHTML(email, size){
  size=size||32;
  return '<div class="amv-av" style="width:'+size+'px;height:'+size+'px;border-radius:var(--r-2xs);overflow:hidden;flex-shrink:0;background:var(--accent)">'+_avatarInner(email)+'</div>';
}


/* NOTHING IN AMV SAID ANYTHING OUT LOUD.

   Swept the whole product for live regions and found zero. Not "not enough" -
   none. Every toast, every status change, and every answer AMV streamed back
   was silent to a screen reader: the page changed and nothing announced it, so
   somebody using one had no way to know a thing had happened.

   One region, polite, off-screen but not display:none - a hidden element is not
   announced, so it has to be positioned away rather than removed. Polite rather
   than assertive because these are confirmations, not alarms, and assertive
   interrupts whatever the reader is in the middle of.

   The text is cleared first and set on the next frame. Assigning the same string
   twice in a row is not a change, so a repeated message ("Copied", "Copied")
   would be announced once and then never again. */
function announce(msg){
  try{
    const r = $('sr-live'); if(!r || !msg) return;
    r.textContent = '';
    requestAnimationFrame(()=>{ r.textContent = String(msg).slice(0, 300); });
  }catch(e){}
}
try{ window.announce = announce; }catch(e){}

function toast(msg, type='info', dur=3000) {
  const wrap = $('toast-wrap');
  if (!wrap) return;
  const icons = {success:'✓', error:'✕', info:'ℹ'};
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = '<div class="ticon">' + (icons[type]||'ℹ') + '</div><span>' + escH(msg) + '</span>';
  wrap.appendChild(t);
  /* Toasts are the product's main feedback channel, so this is most of the fix. */
  announce(msg);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, dur);
}
/* A toast with a single action button (e.g. "Undo"). The action fires once,
   then the toast dismisses. Used so a Reject/Delete is recoverable. */
function toastAction(msg, actionLabel, fn, dur=6000){
  const wrap=$('toast-wrap'); if(!wrap){ return; }
  const t=document.createElement('div'); t.className='toast info toast-act';
  t.innerHTML='<div class="ticon">↩</div><span>'+escH(msg)+'</span><button class="toast-btn">'+escH(actionLabel)+'</button>';
  wrap.appendChild(t);
  announce(msg + '. ' + actionLabel + ' available.');
  let done=false;
  const kill=()=>{ if(done) return; done=true; t.classList.add('out'); setTimeout(()=>t.remove(),200); };
  t.querySelector('.toast-btn').addEventListener('click',()=>{ try{ fn(); }catch(e){} kill(); });
  setTimeout(kill, dur);
}
window.toastAction=toastAction;

/* Everything in an overlay that a keyboard can actually land on.

   Not just "focusable": the sign-up sheet carries a honeypot input that is
   aria-hidden and tabindex="-1" precisely so no human ever reaches it, and
   handing focus to it would put a keyboard user in an invisible field with no
   way to know why. Anything hidden from assistive technology is hidden from
   this list too. */
function _ovrFocusables(root){
  if(!root) return [];
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]';
  return [...root.querySelectorAll(sel)].filter(el=>{
    if(el.getAttribute('tabindex')==='-1') return false;
    if(el.closest('[aria-hidden="true"]')) return false;
    if(el.hidden) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  });
}

/* WHERE A KEYBOARD USER WAS BEFORE THE MODAL OPENED.

   Nothing moved focus into an overlay when it opened, and nothing put it back
   when it closed. There is a Tab trap, but a trap only helps once focus is
   ALREADY inside - before that a keyboard user tabs through the page behind
   the modal, filling in a form they cannot see. And closing dropped them
   wherever the app happened to focus next, which measured as the chat box: not
   an error, just no way back to what they were doing.

   Handled centrally rather than in each of the dozens of functions that write
   into #ovr, because the one that gets forgotten is the one that matters. */
let _ovrReturnFocus = null;
function _initOverlayFocus(){
  try{
    const ovr=$('ovr'); if(!ovr || typeof MutationObserver==='undefined') return;
    new MutationObserver(()=>{
      if(!ovr.children.length) return;
      if(ovr.contains(document.activeElement)) return;   // it already has focus
      const cur=document.activeElement;
      if(!_ovrReturnFocus && cur && cur!==document.body) _ovrReturnFocus=cur;
      const f=_ovrFocusables(ovr)[0];
      if(f){ try{ f.focus(); }catch(e){} }
    }).observe(ovr,{childList:true,subtree:true});

  }catch(e){}
}

function closeOvr() {
  try{ if(typeof _AUTO!=='undefined' && _AUTO.running && typeof stopAutonomous==='function') stopAutonomous(); }catch(e){}
  const r=$('ovr'); if(r){ r.classList.remove('on'); r.innerHTML=''; }
  /* Put them back. Deferred by a tick because closing often triggers a render
     that focuses something of its own, and the last write wins. */
  const back=_ovrReturnFocus; _ovrReturnFocus=null;
  if(back && back.isConnected){
    setTimeout(()=>{ try{ back.focus(); }catch(e){} },0);
  }
}

/* CONFIRM SOMETHING DESTRUCTIVE, IN AMV'S OWN LANGUAGE.

   Three places asked for this - erasing this device's data, removing a link,
   signing out everywhere - each guarded by `typeof confirmModal === 'function'`
   with a native window.confirm() underneath. The guard was permanently false,
   because confirmModal was never written. So the fallback was not a fallback:
   it was the only path, and three destructive actions were confirmed in the
   browser's grey box while the rest of the product has a modal of its own.

   Nothing was broken - a native confirm does confirm - so this is not a bug
   fix. It is the difference between a product and a page: these are exactly the
   moments somebody should be able to read what is about to happen, and the
   native dialog cannot show a second line, cannot be styled, cannot be
   dismissed with the backdrop, and looks like the browser rather than like AMV.

   Same overlay, same classes, same focus handling as every other modal here.
   The destructive button is `bd2`, which is what the account-deletion dialog
   uses, so the colour means the same thing everywhere.

   THE FALLBACK STAYS AT EACH CALL SITE. If the overlay is missing - an embedded
   context, a partial render - this returns false rather than throwing, and the
   caller's window.confirm still runs. A confirmation that silently does not
   happen is worse than an ugly one. */
function confirmModal(title, body, onConfirm, opts){
  const o = opts || {};
  const ovr = $('ovr');
  if(!ovr) return false;
  ovr.innerHTML =
    '<div class="ov" id="cfm-bg"><div class="ob" role="alertdialog" aria-modal="true" aria-labelledby="cfm-t">'+
      '<button class="oc" data-dact="closeOvr" aria-label="Close">&#215;</button>'+
      '<h2 id="cfm-t">'+escH(title||'Are you sure?')+'</h2>'+
      (body ? '<p class="ob-sub">'+escH(body)+'</p>' : '')+
      '<div style="display:flex;gap:9px;margin-top:14px">'+
        '<button class="btn bs" id="cfm-no" style="flex:1">'+escH(o.cancel||'Cancel')+'</button>'+
        '<button class="btn '+(o.safe ? 'bp' : 'bd2')+'" id="cfm-yes" style="flex:1">'+escH(o.confirm||'Continue')+'</button>'+
      '</div>'+
    '</div></div>';
  ovr.classList.add('on');
  onBackdrop($('cfm-bg'), closeOvr);
  on($('cfm-no'), 'click', closeOvr);
  on($('cfm-yes'), 'click', () => {
    closeOvr();
    /* After the overlay is down, so a handler that opens its own modal is not
       fighting the one being closed. */
    setTimeout(() => { try{ if(typeof onConfirm==='function') onConfirm(); }catch(e){} }, 0);
  });
  /* Cancel is focused, not Continue. Somebody who arrives here and presses
     Enter out of habit should not have destroyed anything. */
  setTimeout(() => { try{ const n=$('cfm-no'); if(n) n.focus(); }catch(e){} }, 0);
  return true;
}
try{ window.confirmModal = confirmModal; }catch(e){}

/* Reusable polished empty state: icon + title + subtitle + optional action.
   emptyState({icon,title,sub,btn:{label,act,arg}}) -> HTML string */
function emptyState(o){
  o=o||{};
  const btn = o.btn ? '<button class="es-btn" data-dact="'+(o.btn.act||'')+'" data-darg="'+(o.btn.arg||'')+'">'+escH(o.btn.label||'Get started')+'</button>' : '';
  // icon can be an emoji (o.icon) or an SVG path (o.svg). SVG reads more premium.
  const iconInner = o.svg
    ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+o.svg+'</svg>'
    : (o.icon||'\u2728');
  return '<div class="empty-state es-aura">'+
    '<div class="es-icon'+(o.svg?' es-icon-svg':'')+'">'+iconInner+'</div>'+
    '<div class="es-title">'+escH(o.title||'Nothing here yet')+'</div>'+
    (o.sub?'<div class="es-sub">'+escH(o.sub)+'</div>':'')+
    btn+
  '</div>';
}

/* Empty-state CTA helpers - guide a new user to their first action. */
function _focusMemInput(){ const i=$('mem-inp'); if(i){ i.focus(); i.scrollIntoView({behavior:'smooth',block:'center'}); } }
window._focusMemInput=_focusMemInput;
function _newPromptCTA(){ try{ createPromptModal(); }catch(e){} }
window._newPromptCTA=_newPromptCTA;

/* ============================================================
   ACCESSIBILITY - ARIA labels, roles, and full keyboard navigation.
   Runs after render so it covers dynamically-created controls too.
   Enterprise buyers audit this; it also helps every keyboard user.
   ============================================================ */
const _TAB_LABELS={dashboard:'Dashboard',chat:'Chat',workspaces:'Projects',memory:'Memory',team:'Team',usage:'Usage',billing:'Billing',plans:'Plans',settings:'Settings',help:'Help Center',apps:'Apps',tasks:'Tasks',integrations:'Integrations',crew:'Crew',studio:'Studio',dev:'Dev',handoff:'Handoff',lab:'Lab',market:'Marketplace'};
function _initA11y(){
  try{
    // landmark roles
    const sb=$('sb'); if(sb){ sb.setAttribute('role','navigation'); sb.setAttribute('aria-label','Main navigation'); }
    const main=$('vc'); if(main){ main.setAttribute('role','main'); }
    const app=$('app'); if(app) app.setAttribute('role','application');
    // label every icon-only button from its title / data-tab / id
    document.querySelectorAll('button:not([aria-label])').forEach(b=>{
      const hasText=(b.textContent||'').trim().length>0 && !b.querySelector('svg,img') || (b.textContent||'').trim().length>2;
      let label=b.getAttribute('title')||'';
      if(!label && b.dataset.tab) label=_TAB_LABELS[b.dataset.tab]||b.dataset.tab;
      if(!label && b.dataset.dact) label=b.dataset.dact.replace(/([A-Z])/g,' $1');
      if(!label && b.id) label=b.id.replace(/[-_]/g,' ');
      if(label && !hasText) b.setAttribute('aria-label',label.trim());
    });
    // nav buttons: mark current
    document.querySelectorAll('.snb').forEach(b=>{
      b.setAttribute('role','tab');
      b.setAttribute('aria-selected', b.classList.contains('on')?'true':'false');
      if(!b.getAttribute('aria-label')&&b.dataset.tab) b.setAttribute('aria-label',_TAB_LABELS[b.dataset.tab]||b.dataset.tab);
    });
    // inputs without labels get aria-label from placeholder
    document.querySelectorAll('input:not([aria-label]),textarea:not([aria-label])').forEach(i=>{
      const ph=i.getAttribute('placeholder'); if(ph) i.setAttribute('aria-label',ph);
    });
    // overlay, when populated, is a dialog
    const ovr=$('ovr');
    if(ovr && ovr.children.length){ ovr.setAttribute('role','dialog'); ovr.setAttribute('aria-modal','true'); }
  }catch(e){}
}
/* Focus trap + Escape handling for modals, and arrow-key nav for the sidebar. */
function _initKeyboardNav(){
  try{
    document.addEventListener('keydown',(e)=>{
      // Escape closes any open overlay
      if(e.key==='Escape'){
        const ovr=$('ovr');
        if(ovr && ovr.children.length){ closeOvr(); e.preventDefault(); return; }
        const pop=document.querySelector('.sb-popup.on,.menu.on,.ctx-menu'); if(pop){ pop.classList.remove('on'); }
      }
      // Cmd/Ctrl+K opens the command palette
      if((e.metaKey||e.ctrlKey)&&e.key==='k'){ e.preventDefault(); try{ openCommandPalette(); }catch(err){} }
      // Arrow up/down to move through sidebar nav when focus is in the sidebar
      const inNav=document.activeElement&&document.activeElement.classList&&document.activeElement.classList.contains('snb');
      if(inNav && (e.key==='ArrowDown'||e.key==='ArrowUp')){
        e.preventDefault();
        const btns=[...document.querySelectorAll('.snb')];
        const i=btns.indexOf(document.activeElement);
        const next=e.key==='ArrowDown'?Math.min(btns.length-1,i+1):Math.max(0,i-1);
        btns[next] && btns[next].focus();
      }
    });
    // focus trap inside an open overlay
    document.addEventListener('keydown',(e)=>{
      if(e.key!=='Tab') return;
      const ovr=$('ovr'); if(!ovr||!ovr.children.length) return;
      /* The same list the opener uses, so the trap and the entry point cannot
         disagree about what is reachable - and neither can land on a honeypot
         that exists to be invisible. */
      const f=_ovrFocusables(ovr);
      if(!f.length) return;
      const first=f[0], last=f[f.length-1];
      if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    });
  }catch(e){}
}

/* Respect the user's reduced-motion preference in JS-driven effects too. */
const _reduceMotion = (()=>{ try{ return window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; } })();
function prefersReducedMotion(){ try{ return (loadStr('amv_reduce_motion')==='1') || (window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){ return false; } }
// Apply the combined reduced-motion state (in-app toggle OR OS setting) as a
// class the CSS keys off, so the toggle genuinely reduces motion app-wide.
function _applyReduceMotion(){
  try{ document.documentElement.classList.toggle('reduce-motion', prefersReducedMotion()); }catch(e){}
}
try{ window._applyReduceMotion=_applyReduceMotion; }catch(e){}
try{ if(_reduceMotion) document.documentElement.classList.add('reduce-motion'); }catch(e){}
try{ const _mq=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)'); if(_mq&&_mq.addEventListener) _mq.addEventListener('change',e=>{ document.documentElement.classList.toggle('reduce-motion', e.matches); }); }catch(e){}

/* ============================================================
   TRUST / STATUS SURFACE (#17)
   A status indicator + panel that transparently shows service
   health, connection state, and security/privacy posture.
   ============================================================ */
let _statusState='ok'; // ok | degraded | offline
function _setStatusIndicator(state){
  _statusState=state;
  const dot=$('sb-status-dot'), txt=$('sb-status-txt');
  if(dot) dot.className='sb-status-dot '+state;
  if(txt) txt.textContent = state==='ok'?'All systems operational' : state==='degraded'?'Some services degraded' : 'You\u2019re offline';
}
// Lightweight, non-blocking health check. Backend reachability defines "ok".
async function _checkStatus(){
  if(!navigator.onLine){ _setStatusIndicator('offline'); return {net:false}; }
  let backend='unknown';
  try{
    if(window.AMV_API && AMV_API.base){
      const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(),4000);
      /* /v1/health, which is the route the Worker actually serves. This asked
         for /health and got a 404 from every healthy deployment there has ever
         been, so `r.ok` was false, so the indicator whose entire job is to say
         whether the backend is fine sat permanently on "Some services
         degraded". Settings has always used the right path, which is why the
         two screens disagreed and nobody chased it. */
      const r=await fetch(AMV_API.base.replace(/\/$/,'')+'/v1/health',{signal:ctrl.signal}).catch(()=>null);
      clearTimeout(to);
      backend = (r && r.ok) ? 'ok' : (r ? 'degraded' : 'unreachable');
    }
  }catch(e){ backend='unreachable'; }
  /* A backend that cannot be reached at all used to map to "All systems
     operational" - only an answering-but-unhappy one counted as degraded. So
     the two states were the wrong way round: a Worker that was up and
     answering read as broken, and a Worker that was gone read as perfect.
     Direct mode, where no backend is CONFIGURED, is genuinely operational and
     is the 'unknown' case below. */
  const state = (backend==='degraded' || backend==='unreachable') ? 'degraded' : 'ok';
  _setStatusIndicator(state);
  return { net:true, backend };
}
function openStatusPanel(){
  const r=$('ovr'); if(!r) return;
  if($('status-modal-bg')) return;
  const online=navigator.onLine;
  const svc=(label,ok,note)=>'<div class="st-svc"><span class="st-svc-dot '+(ok?'ok':'down')+'"></span>'+
    '<span class="st-svc-name">'+escH(label)+'</span>'+
    '<span class="st-svc-state">'+escH(note||(ok?'Operational':'Unavailable'))+'</span></div>';
  const trust=(svg,title,sub)=>'<div class="st-trust"><span class="st-trust-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+svg+'</svg></span>'+
    '<div><div class="st-trust-t">'+escH(title)+'</div><div class="st-trust-s">'+escH(sub)+'</div></div></div>';
  r.insertAdjacentHTML('beforeend',
    '<div class="ov" id="status-modal-bg"><div class="status-modal">'+
      '<div class="st-head"><div class="st-head-l"><span class="sb-status-dot '+_statusState+'" style="width:11px;height:11px"></span>'+
        '<span id="st-head-txt">'+(_statusState==='ok'?'All systems operational':_statusState==='degraded'?'Some services degraded':'You\u2019re offline')+'</span></div>'+
        '<button class="art-x" id="st-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>'+
      '<div class="st-body">'+
        '<div class="st-sec-h">Services</div>'+
        '<div class="st-svcs" id="st-svcs">'+
          svc('AMV chat & agents', online, online?'Checking\u2026':'Offline')+
          svc('Image generation', online)+
          svc('Your connection', online, online?'Connected':'Offline')+
        '</div>'+
        '<div class="st-sec-h">Your data & security</div>'+
        trust('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>','Encrypted in transit','All traffic uses HTTPS/TLS. Your API keys stay server-side and are never exposed to the browser.')+
        trust('<path d="M12 2 4 5v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V5z"/>','Server-enforced limits','Usage limits, billing, and access are verified on the server - they can\u2019t be bypassed from the client.')+
        trust('<path d="M20 6 9 17l-5-5"/>','You control your data','Conversations are stored to your account. Analytics are opt-in and off unless you allow them.')+
        '<div class="st-foot"><button class="btn bp" id="st-recheck">Re-check status</button></div>'+
      '</div>'+
    '</div></div>');
  $('st-x')?.addEventListener('click',closeStatusPanel);
  onBackdrop($('status-modal-bg'),closeStatusPanel);
  $('st-recheck')?.addEventListener('click',async()=>{ await _refreshStatusPanel(); });
  _refreshStatusPanel();
}
async function _refreshStatusPanel(){
  const box=$('st-svcs'); if(!box) return;
  const res=await _checkStatus();
  const online=navigator.onLine;
  const backendOk = res.backend==='ok' || res.backend==='unknown';
  const svc=(label,ok,note)=>'<div class="st-svc"><span class="st-svc-dot '+(ok?'ok':'down')+'"></span>'+
    '<span class="st-svc-name">'+escH(label)+'</span>'+
    '<span class="st-svc-state">'+escH(note)+'</span></div>';
  box.innerHTML=
    svc('AMV chat & agents', online&&backendOk, online?(backendOk?'Operational':'Degraded'):'Offline')+
    svc('Image generation', online, online?'Operational':'Offline')+
    svc('Your connection', online, online?'Connected':'Offline');
  const ht=$('st-head-txt'); if(ht) ht.textContent=_statusState==='ok'?'All systems operational':_statusState==='degraded'?'Some services degraded':'You\u2019re offline';
  const hd=document.querySelector('#status-modal-bg .sb-status-dot'); if(hd) hd.className='sb-status-dot '+_statusState;
}
function closeStatusPanel(){ const el=$('status-modal-bg'); if(el) el.remove(); }
try{ window.openStatusPanel=openStatusPanel; }catch(e){}

/* Global offline indicator - shows a banner when the connection drops. */
function _initOfflineWatch(){  const show=()=>{ try{ _setStatusIndicator('offline'); }catch(e){} let bar=$('offline-bar'); if(!bar){ bar=document.createElement('div'); bar.id='offline-bar'; bar.className='offline-bar'; bar.innerHTML='\u26A0 You\u2019re offline - changes are saved locally and will sync when you\u2019re back online.'; document.body.appendChild(bar); } bar.classList.add('show'); };
  const hide=()=>{ const bar=$('offline-bar'); if(bar) bar.classList.remove('show'); try{ _checkStatus(); }catch(e){} };
  try{
    window.addEventListener('offline',show);
    window.addEventListener('online',()=>{ hide(); try{ if(window.AMVSync&&AMVSync.enabled()) AMVSync.push(); }catch(e){} });
    if(navigator.onLine===false) show();
  }catch(e){}
}

/* PWA: a real manifest and a real service worker, both served as files.

   THIS NEVER WORKED, AND SAID SO IN ITS OWN COMMENT. The previous version built
   both out of Blobs, explaining that it was done that way "so the single-file
   app needs no extra files on the server". A service worker script cannot be a
   blob: URL - every browser refuses it outright:

       Failed to register a ServiceWorker: The URL protocol of the script
       ('blob:https://...') is not supported.

   and the registration ended in `.catch(()=>{})`, so the refusal was swallowed
   on every page load since the feature was written. A blob manifest is not
   installable either. So there was no offline support and no install prompt -
   `beforeinstallprompt` needs both halves and therefore never fired, which is
   why the install chip nobody ever saw was not obviously broken. The changelog
   advertised "Install AMV as an app on your phone or desktop (PWA)".

   The build emits `sw.js` and `manifest.webmanifest` beside index.html now,
   because that is the only shape a PWA can have.

   The service worker is deliberately NETWORK-FIRST for the page itself. A
   cache-first worker over a single-file app means every returning visitor runs
   the previous build - so the deploy that fixes a broken checkout does not
   reach the person hitting it - and a bad cache is the one bug that survives
   redeploying. Network first, cache as the fallback, gives real offline with
   none of that. */
function _initPWA(){
  try{
    const mLink=document.createElement('link');
    mLink.rel='manifest'; mLink.href='/manifest.webmanifest';
    document.head.appendChild(mLink);
    const aicon=document.createElement('link');
    aicon.rel='apple-touch-icon'; aicon.href='/icon-192.png';
    document.head.appendChild(aicon);

    if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
      /* A failure is REPORTED, not swallowed. Silence is what let a feature
         that could never work look like one that did. */
      navigator.serviceWorker.register('/sw.js').catch(e=>{
        try{ _logErr('serviceWorker.register', e); }catch(_){}
      });
    }

    window.addEventListener('beforeinstallprompt',(e)=>{ e.preventDefault(); window._amvInstallEvt=e; _showInstallHint(); });
    window.addEventListener('appinstalled',()=>{ window._amvInstallEvt=null; try{ toast('AMV installed - launch it from your home screen anytime','success'); }catch(_){} });
  }catch(e){ _logErr('initPWA',e); }
}
function _showInstallHint(){
  // subtle, one-time install chip (dismissible), never nags
  try{
    if(loadStr('amv_install_dismissed')==='1'||document.getElementById('amv-install-chip')) return;
    const chip=document.createElement('div'); chip.id='amv-install-chip'; chip.className='install-chip';
    chip.innerHTML='<span>Install AMV as an app</span><button id="ic-yes">Install</button><button id="ic-no" aria-label="dismiss">\u00d7</button>';
    document.body.appendChild(chip);
    setTimeout(()=>chip.classList.add('show'),50);
    on($('ic-yes'),'click',async()=>{ const ev=window._amvInstallEvt; if(ev){ ev.prompt(); try{ await ev.userChoice; }catch(_){} window._amvInstallEvt=null; } chip.remove(); });
    on($('ic-no'),'click',()=>{ saveStr('amv_install_dismissed','1'); chip.remove(); });
  }catch(e){}
}
try{ window._initPWA=_initPWA; }catch(e){}

/* Global error boundary - catches unexpected JS errors and unhandled promise
   rejections so a single failure never leaves the user with a frozen screen.
   It shows a brief, non-alarming recovery toast and keeps the app usable.
   (auditor #6 - graceful degradation) */
let _errBoundaryArmed=false, _lastErrToast=0;
function _initErrorBoundary(){
  if(_errBoundaryArmed) return; _errBoundaryArmed=true;
  const softNotify=(where)=>{
    const now=Date.now();
    if(now-_lastErrToast < 4000) return;   // don't spam on cascading errors
    _lastErrToast=now;
    try{ if(typeof toast==='function') toast('Something hiccuped, but your work is safe. If anything looks stuck, refresh the page.','info',5000); }catch(e){}
    try{ if(window.AEGIS&&AEGIS.log) AEGIS.log('uncaught',{where:String(where).slice(0,60)}); }catch(e){}
  };
  try{
    window.addEventListener('error',(ev)=>{
      // ignore benign resource load errors (images, etc.)
      if(ev && ev.target && (ev.target.tagName==='IMG'||ev.target.tagName==='SCRIPT'||ev.target.tagName==='LINK')) return;
      softNotify(ev && ev.message);
      try{ _errQueue('uncaught', (ev&&ev.filename)||'window', (ev&&ev.error)||{message:ev&&ev.message}); }catch(e){}
    }, true);
    window.addEventListener('unhandledrejection',(ev)=>{
      const msg = ev && ev.reason && (ev.reason.message || ev.reason);
      // session-expiry is already handled with its own UX; don't double-toast
      if(String(msg).indexOf('Session expired')>=0) return;
      softNotify(msg);
      try{ _errQueue('rejection', 'promise', (ev&&ev.reason)||{message:String(msg)}); }catch(e){}
    });
  }catch(e){}
}

/* Observability for HANDLED errors. Use in catch blocks that matter (AI calls,
   data saves, backend ops, render paths) so a failure surfaces instead of
   vanishing - console in dev, plus the AEGIS ring buffer that feeds the admin
   error view. Trivial catches (localStorage setters, DOM cleanup, optional
   ops) intentionally stay silent to avoid noise. Never throws. */
/* ── Error reporting ────────────────────────────────────────────────────
   Errors used to land in a localStorage ring buffer and die there: a user hit
   a crash, saw a toast, and left. You never found out. Now they're batched and
   sent to the Worker, grouped by fingerprint.

   PRIVACY: we send the error, where it happened, and coarse environment.
   Never message contents, prompts, code, or the user's email (only a hash). */
/* A stable, non-reversible per-user id, so we can count how many people a bug
   affects without ever transmitting who they are. */
let _errUidCache = null;
function _errUid(){
  try{
    if(_errUidCache) return _errUidCache;
    const email = (typeof S!=='undefined' && S.user && S.user.email) ? S.user.email : '';
    if(!email) return '';
    // FNV-1a - deterministic, one-way for our purposes, no async needed.
    let h = 2166136261;
    const src = 'amv:' + email;
    for(let i=0;i<src.length;i++){ h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
    _errUidCache = (h >>> 0).toString(16).padStart(8,'0');
    return _errUidCache;
  }catch(e){ return ''; }
}

const _ERR_QUEUE = [];
let _errFlushTimer = null;
let _errSentCount = 0;
const ERR_MAX_PER_SESSION = 25;      // never spam ourselves or the user's network
const ERR_BUILD = (typeof AMV_BUILD !== 'undefined') ? AMV_BUILD : '';

function _errQueue(kind, where, err, extra){
  try{
    if(_errSentCount >= ERR_MAX_PER_SESSION) return;
    const msg = (err && (err.message || String(err))) || 'unknown';
    if(!msg || msg === 'unknown') return;
    // Ignore noise we can't act on
    if(/ResizeObserver loop|Script error\.?$|Load failed|NetworkError|Failed to fetch/i.test(msg)) return;

    _ERR_QUEUE.push({
      kind: String(kind||'error'),
      msg: String(msg).slice(0,300),
      where: String(where||'').slice(0,120),
      stack: String((err && err.stack) || '').slice(0,1200),
      tab: String((typeof S!=='undefined' && S.tab) || ''),
      ua: String(navigator.userAgent||'').slice(0,120),
      ver: ERR_BUILD,
      // Hash the email BEFORE it leaves the browser. The server only ever needs
      // to count DISTINCT users, never to know who they are. Sending the raw
      // address would put it on the wire and into Worker logs.
      uid: _errUid()
    });
    if(_ERR_QUEUE.length >= 5) _errFlush();
    else if(!_errFlushTimer) _errFlushTimer = setTimeout(_errFlush, 8000);
  }catch(e){}
}

async function _errFlush(){
  clearTimeout(_errFlushTimer); _errFlushTimer = null;
  if(!_ERR_QUEUE.length) return;
  if(!(window.AMV_API && AMV_API.live)) { _ERR_QUEUE.length = 0; return; }   // nowhere to send
  const events = _ERR_QUEUE.splice(0, 20);
  _errSentCount += events.length;
  try{
    await fetchDeadline(AMV_API.base.replace(/\/$/,'') + '/errors', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true            // still sends if the tab is closing
    });
  }catch(e){ /* reporting must never throw */ }
}
try{
  window.addEventListener('pagehide', ()=>{ try{ _errFlush(); }catch(e){} });
}catch(e){}

function _logErr(where, err){
  try{
    const msg = (err && (err.message || String(err))) || 'unknown';
    if(typeof console!=='undefined' && console.warn) console.warn('[AMV] '+where+':', msg);
    if(window.AEGIS && AEGIS.log) AEGIS.log('error',{ where:String(where).slice(0,80), msg:String(msg).slice(0,200) });
    _errQueue('handled', where, err);
  }catch(e){}
}
try{ window._errQueue=_errQueue; window._errFlush=_errFlush; }catch(e){}
try{ window._logErr=_logErr; }catch(e){}

/* WHEN THE HEADER REFUSES SOMETHING, SAY SO.

   script-src no longer allows inline script: it names the three scripts AMV
   ships, by hash, and refuses everything else. That is the point - an injected
   script is not on the list and does not run.

   The failure mode of getting it wrong is the worst kind there is. A hash that
   no longer matches, or a third party that starts injecting an inline script
   of its own, does not throw and does not appear in any log; the browser
   declines quietly and a feature is simply absent. Payments, the bot check and
   sign-in with Google are all third-party scripts on this page.

   The browser will tell us, if anybody listens. `securitypolicyviolation`
   fires on every refusal with the directive and the blocked source, so a
   mistake in this header arrives as a reported error with a name on it rather
   than as a customer saying a button does nothing.

   Rate-limited to the first few, because a page that violates once usually
   violates in a loop and the sink is a shared resource. */
let _cspSeen = 0;
try{
  document.addEventListener('securitypolicyviolation', (e) => {
    try{
      if(_cspSeen >= 5) return;
      _cspSeen++;
      /* The blocked URI only - never e.sample, which is a slice of the source
         that was refused and can quote whatever was in scope. */
      _logErr('csp.' + String(e.violatedDirective || 'unknown').slice(0, 40),
              new Error(String(e.blockedURI || 'inline').slice(0, 120)));
      /* AND WHEN WHAT WAS REFUSED IS AMV'S OWN BACKEND, THAT IS NOT A LOG LINE.

         A console entry nobody reads was the entire visible consequence of a
         page that cannot reach its own server. Everything downstream then
         degraded as though the deployment were simply unconfigured - the
         captcha hid its empty box, and the sign-up came back "please complete
         the verification", blaming the person for their network.

         This is the one violation AMV can name exactly: the blocked address is
         the backend the build shipped, so the cause is not a mystery and not
         the visitor's fault. Recorded here so the surfaces that go quiet can
         say which of the two things happened. */
      var blocked = String(e.blockedURI || '');
      if(blocked && String(e.violatedDirective||'').indexOf('connect-src')===0){
        var ab=''; try{ ab = (typeof apiBase==='function') ? apiBase() : ''; }catch(_e){}
        if(ab && blocked.indexOf(ab)===0) _publicConfigFail = "this network's security policy blocked it";
      }
    }catch(_){}
  });
}catch(e){}

/* Lightweight pagination for data-heavy lists. Renders items in pages and adds
   a "Show more" button so a user with hundreds of memories/images/etc. gets a
   fast, small DOM instead of thousands of nodes at once. State is kept per-key
   so each list remembers how much it's shown. */
const _PAGE = {};
function _paginate(key, total, pageSize){
  pageSize = pageSize || 30;
  if(_PAGE[key]===undefined) _PAGE[key]=pageSize;
  const shown = Math.min(_PAGE[key], total);
  return { shown, hasMore: shown < total, remaining: total - shown, pageSize };
}
function _pageMore(key, pageSize){ _PAGE[key] = (_PAGE[key]||30) + (pageSize||30); }
function _showMoreBtn(key, remaining, pageSize){
  const n = Math.min(remaining, pageSize||30);
  return '<button class="show-more-btn" data-pagemore="'+key+'">Show '+n+' more <span class="show-more-count">'+remaining+' remaining</span></button>';
}
try{ window._paginate=_paginate; window._pageMore=_pageMore; }catch(e){}


function _showModalAsync({title, body, okText='OK', cancelText, placeholder, defaultValue=''}){
  return new Promise(resolve=>{
    const r=$('ovr'); if(!r){ resolve(null); return; }
    r.innerHTML=
      '<div class="ov" id="modal-bg"><div class="ob" id="modal-box" style="max-width:520px;min-width:320px;cursor:auto;position:relative">'+
        '<button class="oc" id="modal-close" aria-label="Close" style="position:absolute;top:10px;right:10px">×</button>'+
        (title?'<h2 style="margin-bottom:10px">'+escH(title)+'</h2>':'')+
        '<div class="ob-sub" style="margin-bottom:16px;white-space:pre-wrap;line-height:1.5">'+escH(body)+'</div>'+
        (placeholder!==undefined?'<input id="modal-input" type="text" value="'+escH(defaultValue||'')+'" placeholder="'+escH(placeholder||'')+'" style="width:100%;margin-bottom:16px;padding:12px;border-radius:var(--r-lg);border:1px solid var(--bd);font-size:var(--t-base)">':'')+
        '<div style="display:flex;gap:10px;justify-content:flex-end">'+
          (cancelText?'<button class="btn bs" id="modal-cancel" style="padding:10px 16px;font-size:var(--t-base)">'+escH(cancelText)+'</button>':'')+
          '<button class="btn bp" id="modal-ok" style="padding:10px 16px;font-size:var(--t-base)">'+escH(okText)+'</button>'+ 
        '</div>'+ 
      '</div></div>';
    on($('modal-close'),'click',()=>{ closeOvr(); resolve(null); });
    if(cancelText) on($('modal-cancel'),'click',()=>{ closeOvr(); resolve(null); });
    on($('modal-ok'),'click',()=>{ const hasInput=!!$('modal-input'); const val=hasInput?$('modal-input').value:true; closeOvr(); resolve(val); });
    onBackdrop($('modal-bg'),()=>{ closeOvr(); resolve(null); });
    const input=$('modal-input'); if(input){ input.focus(); input.select(); }
  });
}
async function showConfirmAsync(message){
  const result = await _showModalAsync({title:'Confirm', body:message, okText:'Confirm', cancelText:'Cancel'});
  return !!result;
}
async function showTextPromptAsync(message, defaultValue=''){
  return await _showModalAsync({title:'Input required', body:message, placeholder:'Enter text here', defaultValue, okText:'Save', cancelText:'Cancel'});
}
function showError(message){ toast(message,'error',5000); }


/* ── AMV WILL NOT TAKE YOUR PASSWORD ─────────────────────────────────────────

   The owner's ask was that a Crew job have a box where somebody "puts account
   details passwords etc so AMV can act". The box already existed - every job
   with an `asks` prompt writes what you type into the job's detail, and that
   detail is POSTed to the server, stored in KV against the job, and sent to
   the model on every single run for as long as the job is on.

   So the feature was already half built, in the worst possible direction:
   nothing stopped anybody pasting their bank password into it, and if they had,
   it would have been persisted server-side and shipped to a model provider
   every morning, forever, in plain text.

   The right version of what was asked for is not a nicer box. It is:

     - the account is CONNECTED (a real sign-in the person controls and can
       revoke), which AMV already does for Google and is the only safe shape;
     - or AMV does everything up to the credential and hands that one step
       back, which is worth almost as much and cannot leak anything.

   So this refuses. It runs before anything is sent anywhere, it never logs or
   transmits the text it matched, and it names what it saw so the person can
   remove that line rather than guessing which of six lines was the problem.

   It is deliberately conservative about what counts. "Reset my password on the
   supplier site" is an instruction and must go through; "password: hunter2" is
   a credential and must not. The difference is a separator and a value.        */

/* Luhn, so a sixteen digit order reference is not mistaken for a card. */
function _luhnOk(digits){
  let sum = 0, alt = false;
  for(let i = digits.length - 1; i >= 0; i--){
    let n = digits.charCodeAt(i) - 48;
    if(n < 0 || n > 9) return false;
    if(alt){ n *= 2; if(n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

const _SECRET_RULES = [
  ['a private key',        /-----BEGIN[ A-Z]*PRIVATE KEY-----/],
  ['an API key or token',  /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{10,}|rk_live_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})\b/],
  ['an authorization header', /\bBearer\s+[A-Za-z0-9._-]{20,}/i],
  /* Label, separator, value. The separator is what makes it a credential being
     handed over rather than a sentence about one. */
  ['a password',           /\b(?:password|passwd|pass\s?word|passphrase|pwd)\b\s*(?:is|=|:)\s*\S/i],
  /* THE SAME THING WITHOUT THE SEPARATOR, which is how people actually type it.

     The rule above requires `is`, `=` or `:` after the label, on the reasoning
     that the separator is what marks a credential being handed over rather than
     a sentence about one. Sound, and far too narrow. Tested against what
     somebody would really put in the Crew requirements box, BOTH of these were
     allowed straight through and written to the server:

         "my LinkedIn login is adrian@x.com password Hunter2!"
         "Point72 portal user amaroto pass Tr@d3r2024"

     The second is the worse one: `pass` was not in the list at all. So the box
     promised "AMV does not store them" while storing them, and a standing job
     re-reads its instructions on every run - meaning a work password would sit
     in KV for as long as the job was on.

     Widened by requiring the VALUE to look like a credential rather than like
     the next word of a sentence: six or more characters containing a digit or a
     symbol. "reset my password today" and "boarding pass yesterday" do not
     match, because English words are letters. Real passwords almost always are
     not.

     False positives are the acceptable direction here. Being asked to rephrase
     costs somebody ten seconds; the other error puts a plaintext password to
     someone's employer in a database. */
  ['a password',           /\b(?:password|passwd|pass\s?word|passphrase|pwd|pass)\b\s+(?=\S*[0-9!@#$%^&*()_+=\[\]{}|<>?~\/\\-])(\S{6,})/i],
  /* The pairing, which is how a sign-in is usually written down: a name and
     then a password label, on one line, whatever punctuation is between them.
     Catches "user amaroto pass ..." and "login adrian@x.com / Hunter2". */
  ['a sign-in',            /\b(?:user(?:name)?|login|log\s?in|acct|account|email)\b[^\n]{0,60}?\b(?:pass(?:word|wd)?|pwd|pin)\b/i],
  /* The abbreviated form, which is how anybody writes a pair down in a hurry:
     "u: amaroto p: whatever". No credential-shaped value is required here,
     because the SHAPE is the giveaway - a one-letter label, a value, another
     one-letter label. Nothing in an ordinary sentence looks like that. */
  ['a sign-in',            /(?:^|[\s,;(])u(?:ser)?\s*[:=]\s*\S+\s*[,;|\/]?\s*p(?:ass|w|wd)?\s*[:=]\s*\S/i],
  /* An address followed by a slash or a pipe and a value. Writing
     "adrian@x.com / Hunter2!" is handing over a sign-in whatever words are
     around it, and there is no ordinary sentence that takes that shape. */
  ['a sign-in',            /\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\s*[\/|]\s*\S{4,}/],
  ['a PIN or passcode',    /\b(?:pin|passcode|pass\s?code)\b\s*(?:is|=|:)\s*[0-9A-Za-z]/i],
  ['a one-time code',      /\b(?:otp|one[\s-]?time\s?(?:code|password)|2fa\s?code|verification\s?code|security\s?code|auth\s?code)\b\s*(?:is|=|:)\s*[0-9A-Za-z]/i],
  ['a card security code', /\b(?:cvv|cvc|cv2|card\s?(?:security|verification)\s?(?:code|value))\b\s*(?:is|=|:)\s*\d{3,4}/i],
  ['a secret or token',    /\b(?:api[\s_-]?key|secret[\s_-]?key|client[\s_-]?secret|access[\s_-]?token|refresh[\s_-]?token|auth[\s_-]?token|private[\s_-]?key)\b\s*(?:is|=|:)\s*\S{8,}/i],
  ['bank account details', /\b(?:sort[\s-]?code|routing[\s-]?number|iban|account[\s-]?number|acct[\s.-]?(?:no|number)|swift|bic)\b\s*(?:is|=|:)\s*[0-9A-Z]/i],
  ['a national ID number', /\b(?:social[\s-]?security(?:\s?number)?|ssn|national[\s-]?insurance(?:\s?number)?|nino|tax[\s-]?id|tin)\b\s*(?:is|=|:)\s*[0-9A-Z]/i],
  ['a recovery phrase',    /\b(?:seed|recovery|mnemonic)\s?phrase\b\s*(?:is|=|:)?\s*(?:\b[a-z]{3,10}\b[\s,]+){11,}/i],
  ['a security answer',    /\b(?:mother'?s\s?maiden\s?name|security\s?(?:question|answer)|memorable\s?(?:word|information))\b\s*(?:is|=|:)\s*\S/i],
];

/* Returns a short list of WHAT was found, never the text that matched it.
   Nothing here may be logged, sent or shown back - naming the kind is enough
   for somebody to find their own line, and is all AMV should ever hold. */
function findSecrets(text){
  const t = String(text || '');
  if(!t) return [];
  const found = [];
  for(const [label, rx] of _SECRET_RULES){
    try{ if(rx.test(t) && found.indexOf(label) < 0) found.push(label); }catch(_e){}
  }
  /* Card numbers are structure rather than a label: 13 to 19 digits, spaced or
     dashed however somebody typed them, that satisfy Luhn. */
  try{
    const runs = t.match(/\b(?:\d[ -]?){12,22}\d\b/g) || [];
    for(const r of runs){
      const d = r.replace(/[^0-9]/g, '');
      if(d.length >= 13 && d.length <= 19 && _luhnOk(d)){
        if(found.indexOf('a card number') < 0) found.push('a card number');
        break;
      }
    }
  }catch(_e){}
  return found;
}

/* The refusal, said once and in one place so every surface says the same
   thing. Returns true when the text is safe to send. */
function refuseSecrets(text, whereFor){
  const found = findSecrets(text);
  if(!found.length) return true;
  const what = found.length === 1 ? found[0]
    : found.slice(0, -1).join(', ') + ' and ' + found[found.length - 1];
  try{
    /* Recorded as a COUNT and a KIND. Never the text, never a fragment of it. */
    if(typeof AEGIS !== 'undefined' && AEGIS.log)
      AEGIS.log('secret_refused', { kinds: found.length, where: String(whereFor || '').slice(0, 24) });
  }catch(_e){}
  /* WHICH SERVICE THEY WERE TRYING TO HAND OVER.

     Named only so the way out can be specific. A refusal that says "use
     Integrations" leaves somebody to work out which of forty rows they need;
     one that says "connect Gmail" is the same refusal with the next step
     already taken. Matched on the service word alone - never on anything
     next to it, because the whole point is that this text is not kept. */
  let service = '';
  try{
    const t = String(text||'').toLowerCase();
    const known = [['gmail','Gmail'],['google','Google'],['outlook','Microsoft 365'],
                   ['microsoft','Microsoft 365'],['slack','Slack'],['github','GitHub'],
                   ['linkedin','LinkedIn'],['dropbox','Dropbox'],['notion','Notion'],
                   ['calendar','Google Calendar'],['drive','Google Drive']];
    for(const [k,label] of known){ if(t.indexOf(k)>=0){ service = label; break; } }
  }catch(_e){}
  try{
    if(typeof _showModalAsync === 'function'){
      /* The primary button DOES the safe thing rather than describing it. The
         refusal is unchanged - nothing is saved either way - but the person
         who came here to get a job done leaves with it moving instead of with
         a paragraph telling them where to look. */
      _showModalAsync({ title:'AMV will not store that',
        okText: service ? ('Connect ' + service) : 'Connect an account',
        cancelText:'Not now', body:
        'That looks like it contains ' + what + '. AMV does not keep passwords, card numbers or '+
        'security codes - not encrypted, not briefly, not at all. A standing job keeps its '+
        'instructions on the server and reads them on every run, so anything in this box would be '+
        'stored and read for as long as the job is on.\n\n'+
        'Nothing was saved and nothing was sent.\n\n'+
        'What works instead: connect the account, which is a real sign-in you control and can '+
        'revoke at any time. AMV gets a token scoped to what you allow, the password never '+
        'reaches AMV, and you can take the access back without changing it. Where there is no '+
        'way to connect one, describe the task without the credential - AMV will do everything '+
        'up to the sign-in and hand that one step back to you.\n\n'+
        'Remove that part and try again.' })
        .then(go => { if(go && typeof _mcGoConnect === 'function') _mcGoConnect(); })
        .catch(() => {});
    } else if(typeof toast === 'function'){
      toast('AMV will not store ' + what + '. Nothing was saved. Remove it and try again.', 'error', 9000);
    }
  }catch(_e){}
  return false;
}
try{ window.findSecrets = findSecrets; window.refuseSecrets = refuseSecrets; }catch(e){}
