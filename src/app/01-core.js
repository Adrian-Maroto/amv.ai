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
const _GLOBAL_KEYS = new Set(['amv_links','amv_user','amv_theme','amv_accent','amv_sb_rail','amv_nickname','amv_work','amv_instructions','amv_session_started','amv_location_opt','amv_improve_opt','amv_credits','amv_credits_autoreload','amv_cap_websearch','amv_cap_memory','amv_cap_suggestions','amv_skills','amv_active_skills','amv_plugin_web','amv_plugin_code','amv_plugin_canvas','amv_plugin_automations','amv_plugin_vision','amv_reduce_motion','amv_oauth_return','amv_oauth_state','amv_gtoken','amv_gtoken_exp','amv_gauth','amv_api_base','amv_api_token','amv_api_refresh','amv_token_exp','amv_owner','amv_lang','amv_support_email',
  'amv_market_local','amv_market_purchases','amv_market_wallet','amv_market_ratings','amv_market_reviews','amv_market_installed','amv_market_threads',
  'amv_cookie_consent','amv_analytics_id',
  /* An invite code is captured before anyone is signed in, and belongs to the
     visit rather than to an account - scoping it per-user would file it under
     'guest' and then hide it the moment the account it was meant for existed. */
  'amv_ref_code']);
function _scopeKey(k){
  if(_GLOBAL_KEYS.has(k)) return k;
  let who='guest';
  try{ if(typeof S!=='undefined' && S && S.user && S.user.email) who=S.user.email.toLowerCase(); }
  catch(e){}
  if(who==='guest'){ try{ const u=JSON.parse(localStorage.getItem('amv_user')||'null'); if(u&&u.email) who=u.email.toLowerCase(); }catch(e){} }
  return 'u:'+who+'|'+k;
}
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
const AMV_API = {
  get base(){ try{ return loadStr('amv_api_base')||''; }catch(e){ return ''; } },
  set base(v){ try{ const val=(v||'').trim(); if(val && !_isSecureApiOrigin(_originOf(val))){ try{ toast('Backend URL must be a valid https:// address','error'); }catch(e){} return; } saveStr('amv_api_base', val); }catch(e){} },
  get token(){ try{ return loadStr('amv_api_token')||''; }catch(e){ return ''; } },
  set token(v){ try{ saveStr('amv_api_token', v||''); }catch(e){} },
  get refreshTok(){ try{ return loadStr('amv_api_refresh')||''; }catch(e){ return ''; } },
  set refreshTok(v){ try{ saveStr('amv_api_refresh', v||''); }catch(e){} },
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
    // AMV-050: never auto-retry a NON-IDEMPOTENT mutation - a retry on a 5xx/429
    // could double-submit it (a second invite, listing, purchase, withdrawal,
    // deploy, etc.). Auth and payments were already excluded; extend to the other
    // state-creating endpoints. Metered/idempotent POSTs (AI proxy, sync) still retry.
    const noRetry = o.noRetry || /^\/auth\//.test(path)
      || /\/(stripe|paypal|pay|subscribe|capture)/.test(path)
      || /\/(family\/(limits|remove|leave)|team\/(invite|join|remove|leave|role|share|unshare|data|task\/(create|update))|market\/(publish|buy|withdraw|review|install)|deploy|sms\/register|widget\/save)/.test(path);
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
      if(!_retried && this.refreshTok){
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
        if(!this.refreshTok) return false;
        const r = await fetch(this.base.replace(/\/$/,'')+'/auth/refresh', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ refreshToken: this.refreshTok }),
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
      const r = await this._fetch('/auth/logout', {method:'POST',
        body: JSON.stringify(everywhere ? {everywhere:true} : {refreshToken: this.refreshTok})});
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

  // jobs / approvals / handoff
  async jobs(){ const r=await this._fetch('/api/jobs'); return (await r.json()).jobs||[]; },
  async toggleJob(id,on){ await this._fetch('/api/jobs',{method:'POST',body:JSON.stringify({id,on})}); },
  async approvals(){ const r=await this._fetch('/api/approvals'); return (await r.json()).approvals||[]; },
  async actApproval(id,action){ await this._fetch('/api/approvals/act',{method:'POST',body:JSON.stringify({id,action})}); },
  async pauseAutonomy(paused){ await this._fetch('/auto/pause',{method:'POST',body:JSON.stringify({paused:!!paused})}); },
  async createHandoff(h){ await this._fetch('/api/handoff',{method:'POST',body:JSON.stringify(h)}); },
  async listHandoff(){ const r=await this._fetch('/api/handoff'); return await r.json(); },
  async actHandoff(id,action){ await this._fetch('/api/handoff/act',{method:'POST',body:JSON.stringify({id,action})}); },

  // ---- PAYMENTS (secure backend) ----
  async stripeCheckout(plan,email,seats){ const r=await this._fetch('/v1/stripe/checkout',{method:'POST',body:JSON.stringify({plan,email,seats})}); const d=await r.json(); if(!r.ok||!d.url){ const e=new Error(d.error||'checkout failed'); e.code=d.code; throw e; } return d.url; },
  async paypalCreate(plan){ const r=await this._fetch('/v1/paypal/create',{method:'POST',body:JSON.stringify({plan})}); const d=await r.json(); if(!r.ok||!d.id) throw new Error(d.error||'paypal create failed'); return d.id; },
  async paypalSubscribe(plan,email){ const r=await this._fetch('/v1/paypal/subscribe',{method:'POST',body:JSON.stringify({plan,email})}); const d=await r.json(); if(!r.ok||!d.url) throw new Error(d.error||'subscribe failed'); return d.url; },
  async paypalCapture(orderId,email){ const r=await this._fetch('/v1/paypal/capture',{method:'POST',body:JSON.stringify({orderId,email})}); const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.error||'capture failed'); return d; },
  async entitlement(email){ const r=await this._fetch('/v1/entitlement?email='+encodeURIComponent(email||'')); return await r.json(); },
  /* Family (AMV-102). The parent's controls; there is deliberately no method
     here for reading a child's conversations, because no such route exists. */
  async familyGet(){ const r=await this._fetch('/v1/family/get',{method:'POST',body:'{}'}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  async familyLimits(child,limits){ const r=await this._fetch('/v1/family/limits',{method:'POST',body:JSON.stringify({child,limits})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  async familyLeave(){ const r=await this._fetch('/v1/family/leave',{method:'POST',body:'{}'}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  async familyRemove(child){ const r=await this._fetch('/v1/family/remove',{method:'POST',body:JSON.stringify({child})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; },
  async portal(customer){ const r=await this._fetch('/v1/stripe/portal',{method:'POST',body:JSON.stringify({customer})}); const d=await r.json(); if(!r.ok||!d.url) throw new Error(d.error||'Could not open billing.'); return d.url; },
};
window.AMV_API = AMV_API;
function amvSaveBackend(){ var v=(document.getElementById('be-url')||{}).value||''; AMV_API.base=v.trim(); toast(v.trim()?'Backend URL saved':'Cleared - local mode','info'); if(typeof renderSetPane==='function') renderSetPane(); }
async function amvBackendLogin(){ var em=(document.getElementById('be-email')||{}).value||''; var pw=(document.getElementById('be-pass')||{}).value||''; if(!em.trim()){ toast('Enter your email','error'); return; } if(!pw){ toast('Enter your password','error'); return; } if(!AMV_API.live){ toast('Set the backend URL first','error'); return; } try{ await AMV_API.login(em.trim(), {name:(S.user&&S.user.name)||'', password:pw}); var p=document.getElementById('be-pass'); if(p) p.value=''; toast('Connected to backend','info'); if(typeof renderSetPane==='function') renderSetPane(); }catch(e){ toast(e.message||'Login failed','error'); } }
window.amvSaveBackend=amvSaveBackend; window.amvBackendLogin=amvBackendLogin;



function escH(t) {
  return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
/* Zero em/en dashes anywhere AMV produces text - so nothing reads as
   AI-generated and the site uses only a plain hyphen. */
function _noDash(t){ return (t==null?'':String(t)).replace(/[\u2014\u2013]/g,'-'); }

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
  if(pfp) return '<img src="'+pfp+'" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">';
  return _defaultAvatarSVG();
}
// A complete round avatar element of a given pixel size.
function _avatarHTML(email, size){
  size=size||32;
  return '<div class="amv-av" style="width:'+size+'px;height:'+size+'px;border-radius:4px;overflow:hidden;flex-shrink:0;background:var(--accent)">'+_avatarInner(email)+'</div>';
}


function toast(msg, type='info', dur=3000) {
  const wrap = $('toast-wrap');
  if (!wrap) return;
  const icons = {success:'✓', error:'✕', info:'ℹ'};
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = '<div class="ticon">' + (icons[type]||'ℹ') + '</div><span>' + escH(msg) + '</span>';
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, dur);
}
/* A toast with a single action button (e.g. "Undo"). The action fires once,
   then the toast dismisses. Used so a Reject/Delete is recoverable. */
function toastAction(msg, actionLabel, fn, dur=6000){
  const wrap=$('toast-wrap'); if(!wrap){ return; }
  const t=document.createElement('div'); t.className='toast info toast-act';
  t.innerHTML='<div class="ticon">↩</div><span>'+escH(msg)+'</span><button class="toast-btn">'+escH(actionLabel)+'</button>';
  wrap.appendChild(t);
  let done=false;
  const kill=()=>{ if(done) return; done=true; t.classList.add('out'); setTimeout(()=>t.remove(),200); };
  t.querySelector('.toast-btn').addEventListener('click',()=>{ try{ fn(); }catch(e){} kill(); });
  setTimeout(kill, dur);
}
window.toastAction=toastAction;

function closeOvr() { try{ if(typeof _AUTO!=='undefined' && _AUTO.running && typeof stopAutonomous==='function') stopAutonomous(); }catch(e){} const r=$('ovr'); if(r){ r.classList.remove('on'); r.innerHTML=''; } }

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
function _tryExampleImage(){ const i=$('img-inp'); if(i){ i.value='a serene mountain lake at golden hour, photorealistic'; i.focus(); } }
window._focusMemInput=_focusMemInput; window._tryExampleImage=_tryExampleImage;
function _newPromptCTA(){ try{ createPromptModal(); }catch(e){} }
window._newPromptCTA=_newPromptCTA;

/* ============================================================
   ACCESSIBILITY - ARIA labels, roles, and full keyboard navigation.
   Runs after render so it covers dynamically-created controls too.
   Enterprise buyers audit this; it also helps every keyboard user.
   ============================================================ */
const _TAB_LABELS={dashboard:'Dashboard',chat:'Chat',images:'Images',video:'Video',workspaces:'Projects',memory:'Memory',team:'Team',usage:'Usage',billing:'Billing',plans:'Plans',settings:'Settings',help:'Help Center',apps:'Apps',tasks:'Tasks',integrations:'Integrations',crew:'Crew',studio:'Studio',dev:'Dev',handoff:'Handoff',lab:'Lab',market:'Marketplace'};
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
      const f=ovr.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
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
      const r=await fetch(AMV_API.base.replace(/\/$/,'')+'/health',{signal:ctrl.signal}).catch(()=>null);
      clearTimeout(to);
      backend = (r && r.ok) ? 'ok' : (r ? 'degraded' : 'unreachable');
    }
  }catch(e){ backend='unreachable'; }
  // Direct mode (no backend configured) is still fully operational.
  const state = (backend==='degraded') ? 'degraded' : 'ok';
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
    '<div class="ov" id="status-modal-bg"><div class="status-modal" onclick="event.stopPropagation()">'+
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
  on($('status-modal-bg'),'click',closeStatusPanel);
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

/* PWA: register a web manifest + service worker at runtime so AMV is installable
   as an app (home screen / desktop) and loads instantly offline. Built entirely
   from Blobs so the single-file app needs no extra files on the server. */
function _initPWA(){
  try{
    // 1) inject a manifest generated on the fly
    const icon='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="112" fill="#4478e8"/><text x="256" y="340" font-family="Arial,sans-serif" font-size="300" font-weight="800" fill="#fff" text-anchor="middle">A</text></svg>');
    const manifest={
      name:'AMV.AI', short_name:'AMV', description:'The AI workforce that does the work, not just answers it.',
      start_url:'.', scope:'.', display:'standalone', orientation:'any',
      background_color:'#232429', theme_color:'#4478e8',
      icons:[
        {src:icon,sizes:'192x192',type:'image/svg+xml',purpose:'any maskable'},
        {src:icon,sizes:'512x512',type:'image/svg+xml',purpose:'any maskable'}
      ]
    };
    const mBlob=new Blob([JSON.stringify(manifest)],{type:'application/manifest+json'});
    const mLink=document.createElement('link'); mLink.rel='manifest'; mLink.href=URL.createObjectURL(mBlob);
    document.head.appendChild(mLink);
    const aicon=document.createElement('link'); aicon.rel='apple-touch-icon'; aicon.href=icon; document.head.appendChild(aicon);

    // 2) register a minimal service worker (offline-first shell cache)
    if('serviceWorker' in navigator && location.protocol==='https:'){
      const swCode=`
        const CACHE='amv-v1';
        self.addEventListener('install',e=>{ self.skipWaiting(); });
        self.addEventListener('activate',e=>{ e.waitUntil(self.clients.claim()); });
        self.addEventListener('fetch',e=>{
          const req=e.request;
          if(req.method!=='GET'){ return; }
          const url=new URL(req.url);
          // network-first for API, cache-first for the app shell & assets
          if(url.pathname.includes('/v1/')||url.hostname.includes('api.')){ return; }
          e.respondWith(
            caches.open(CACHE).then(cache=>cache.match(req).then(hit=>{
              const net=fetch(req).then(res=>{ try{ if(res&&res.status===200) cache.put(req,res.clone()); }catch(_){} return res; }).catch(()=>hit);
              return hit||net;
            }))
          );
        });`;
      const swUrl=URL.createObjectURL(new Blob([swCode],{type:'text/javascript'}));
      navigator.serviceWorker.register(swUrl).catch(()=>{});
    }

    // 3) capture the install prompt and expose an "Install app" affordance
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
function _pageReset(key, pageSize){ _PAGE[key] = pageSize||30; }
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
        '<button class="oc" id="modal-close" style="position:absolute;top:10px;right:10px">×</button>'+
        (title?'<h2 style="margin-bottom:10px">'+escH(title)+'</h2>':'')+
        '<div class="ob-sub" style="margin-bottom:16px;white-space:pre-wrap;line-height:1.5">'+escH(body)+'</div>'+
        (placeholder!==undefined?'<input id="modal-input" type="text" value="'+escH(defaultValue||'')+'" placeholder="'+escH(placeholder||'')+'" style="width:100%;margin-bottom:16px;padding:12px;border-radius:12px;border:1px solid var(--bd);font-size:13px">':'')+
        '<div style="display:flex;gap:10px;justify-content:flex-end">'+
          (cancelText?'<button class="btn bs" id="modal-cancel" style="padding:10px 16px;font-size:13px">'+escH(cancelText)+'</button>':'')+
          '<button class="btn bp" id="modal-ok" style="padding:10px 16px;font-size:13px">'+escH(okText)+'</button>'+ 
        '</div>'+ 
      '</div></div>';
    const box=$('modal-box'); if(box) box.addEventListener('click',e=>e.stopPropagation());
    on($('modal-close'),'click',()=>{ closeOvr(); resolve(null); });
    if(cancelText) on($('modal-cancel'),'click',()=>{ closeOvr(); resolve(null); });
    on($('modal-ok'),'click',()=>{ const hasInput=!!$('modal-input'); const val=hasInput?$('modal-input').value:true; closeOvr(); resolve(val); });
    on($('modal-bg'),'click',()=>{ closeOvr(); resolve(null); });
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

