/* ============================================================
   CENTRALIZED STATE STORE
   One source of truth. All app state lives in `S`. Writing to a
   persisted key (see _PERSIST) automatically saves it; subscribers
   are notified on every change so views can react instead of state
   drifting across S / localStorage / the DOM.
     S.tab = 'chat'            -> updates + notifies 'tab' subscribers
     AMVState.subscribe('tab', fn)   -> run fn(newVal) on change
     AMVState.set('model','core')    -> same as S.model='core'
     AMVState.persistedKeys           -> which keys auto-save
   ============================================================ */
const _PERSIST = {            // key on S  ->  storage key
  user:'amv_user', mk:'amv_mk', rl:'amv_rl', sp:'amv_sp', se:'amv_se',
  model:'amv_model', memory:'amv_memory', workspaces:'amv_workspaces',
  prompts:'amv_prompts', settingsPane:null, imgStyle:'amv_imgstyle',
  imgRatio:'amv_imgratio',
};
const _subs = {};   // key -> [fns]
const _AMVState = {
  subscribe(key, fn){ (_subs[key]||(_subs[key]=[])).push(fn); return ()=>{ _subs[key]=(_subs[key]||[]).filter(f=>f!==fn); }; },
  _notify(key, val){ (_subs[key]||[]).forEach(fn=>{ try{ fn(val); }catch(e){ console.warn('state subscriber error', key, e); } }); (_subs['*']||[]).forEach(fn=>{ try{ fn(key,val); }catch(e){} }); },
  set(key, val){ _raw[key]=val; _persist(key,val); this._notify(key,val); },
  get(key){ return _raw[key]; },
  get persistedKeys(){ return Object.keys(_PERSIST); },
};
function _persist(key, val){
  if(!(key in _PERSIST)) return;
  const sk=_PERSIST[key]; if(!sk) return;
  try{
    if(val===undefined||val===null){ /* keep */ }
    if(typeof val==='string') saveStr(sk, val);
    else store(sk, val);
  }catch(e){ console.warn('state persist failed', key, e); }
}
const _raw = {
  tab: 'chat',
  sbOpen: true,
  user: load('amv_user'),
  mk: loadStr('amv_mk'),
  rl: loadStr('amv_rl'),
  sp: loadStr('amv_sp'),
  se: loadStr('amv_se'),
  convs: [],
  cur: null,
  openTabs: [],
  model: loadStr('amv_model')||'auto',
  imgs: [],
  imgStyle: loadStr('amv_imgstyle')||'Normal',
  imgRatio: loadStr('amv_imgratio')||'1:1',
  vids: [],
  memory: load('amv_memory')||[],
  prompts: load('amv_prompts')||[],
  workspaces: load('amv_workspaces')||[],
  busy: false,
  att: null,
  streaming: false,
  starFilter: false,
  settingsPane: 'account',
};
/* Move the previously-unscoped keys into this account BEFORE anything reads
   them. Doing it only in loginUser() was wrong: a returning session is restored
   straight from storage above and never calls loginUser, so every existing user
   would have loaded to an empty profile, no custom instructions, and no
   scheduled jobs - the data still on disk under the old key and nothing looking
   there. It is idempotent, so running it here and at sign-in is safe. */
try{ if(_raw.user && _raw.user.email) _migrateScopedKeys(_raw.user.email); }catch(e){}

const S = new Proxy(_raw, {
  set(target, key, val){
    const prev=target[key];
    target[key]=val;
    _persist(key, val);
    _AMVState._notify(key, val);
    if(key==='busy' && prev!==val){ try{ _onBusyChange(!!val, !!prev); }catch(e){} }
    return true;
  },
  get(target, key){ return target[key]; },
});

/* ── Chat "working" presence + completion cue (modern-assistant style) ──
   A quiet bottom-right pill shows while AMV is working; a soft two-note
   chime plays when a longer/background reply finishes. Fully self-contained
   (Web Audio, no assets) and respectful - muteable, and silent on quick
   foreground replies so it never nags. */
let _busyStartedAt=0;
function _onBusyChange(now, was){
  // swap the send button to a Stop control while generating
  try{
    const snd=document.getElementById('snd');
    if(snd){
      if(now){ snd.classList.add('stop'); snd.title='Stop generating'; snd.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'; }
      else { snd.classList.remove('stop'); snd.title='Send'; snd.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'; }
    }
  }catch(e){}
  if(now && !was){ _busyStartedAt=Date.now(); _showWorkingPill(true); }
  else if(!now && was){
    const took=Date.now()-_busyStartedAt;
    _showWorkingPill(false);
    try{ _renderSbUsage(); }catch(e){}   // update the sidebar meter after each response
    // chime only if it took a moment OR the tab is in the background
    const backgrounded=(typeof document!=='undefined' && document.hidden);
    if(took>3500 || backgrounded) _playDoneChime();
  }
}
function _showWorkingPill(on){
  try{
    let el=document.getElementById('amv-working');
    if(on){
      if(!el){
        el=document.createElement('div'); el.id='amv-working';
        el.innerHTML='<span class="amv-working-dot"></span><span class="amv-working-tx">AMV is working…</span>';
        document.body.appendChild(el);
        requestAnimationFrame(()=>el.classList.add('show'));
      }
    } else if(el){ el.classList.remove('show'); setTimeout(()=>{ try{el.remove();}catch(e){} },260); }
  }catch(e){}
}
let _audioCtx=null;
function _playDoneChime(){
  try{
    if(loadStr('amv_mute_chime')==='1') return;
    const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
    _audioCtx=_audioCtx||new AC();
    const ctx=_audioCtx; if(ctx.state==='suspended') ctx.resume();
    const now=ctx.currentTime;
    // soft two-note "done" - E5 then A5, gentle sine, quick fade (not a beep)
    [[659.25,0],[880,0.13]].forEach(([f,t])=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0, now+t);
      g.gain.linearRampToValueAtTime(0.12, now+t+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now+t+0.28);
      o.connect(g); g.connect(ctx.destination);
      o.start(now+t); o.stop(now+t+0.3);
    });
  }catch(e){}
}
try{ window._playDoneChime=_playDoneChime; }catch(e){}
const AMVState = _AMVState;
try{ window.AMVState = AMVState; }catch(e){}

/* ============================================================
   AMVSync - keeps user data on the server so it follows them
   across devices. Local storage is the offline cache; the server
   is the source of truth when a backend + session exist.
     AMVSync.pull()  -> fetch server data, hydrate S + local cache
     AMVSync.push()  -> upload current user data (debounced)
   It auto-pushes whenever synced state keys change.
   ============================================================ */
const _SYNC_KEYS = ['convs','memory','workspaces','prompts','imgs','model','imgStyle','imgRatio'];
/* Your actual WORK - Recents (Dev projects, Lab sessions), skills, handoffs,
   profile. These are NOT AMVState keys (_SESSIONS is a module-level array), so
   they're gathered and restored explicitly below. Before this they never left
   the browser: switch device or clear cache and a 10,000-line Dev project was
   simply gone. */
const _SYNC_EXTRA = ['sessions','skills','handoffs','profile'];
/* Keys whose values are id-bearing lists, so a pull can merge them item by item
   instead of replacing the list. `model`/`imgStyle`/`imgRatio` are scalars and
   deliberately absent - last write genuinely should win on a preference. */
const _SYNC_MERGEABLE = new Set(['convs','memory','workspaces','prompts','imgs','vids']);
const _syncStamp = it => (it && (it.updated || it.updatedAt || it.ts || it.added || it.created || it.createdAt)) || 0;
/* How much substance an item carries - only breaks a tie, and it is what stops
   an upload that was trimmed to fit the size cap from erasing the full copy. */
function _syncWeight(it){
  if(!it || typeof it!=='object') return 0;
  let w=0;
  if(Array.isArray(it.msgs)) w += it.msgs.length*10;
  if(it.state) w += 5;
  if(typeof it.text==='string') w += Math.min(5, it.text.length/500);
  return w;
}
function _mergeById(localList, remoteList){
  const byId=new Map(), loose=[];
  const add=it=>{
    const id=it && (it.id||it.key||it.name);
    if(id==null){ loose.push(it); return; }
    if(!byId.has(id)){ byId.set(id,it); return; }
    const a=byId.get(id);
    const sa=_syncStamp(a), sb=_syncStamp(it);
    if(sa!==sb){ byId.set(id, sa>sb?a:it); return; }
    byId.set(id, _syncWeight(it)>_syncWeight(a)?it:a);
  };
  (localList||[]).forEach(add); (remoteList||[]).forEach(add);
  return [...byId.values()].sort((x,y)=>_syncStamp(y)-_syncStamp(x)).concat(loose);
}
try{ window._mergeById=_mergeById; }catch(e){}
const SYNC_SOFT_LIMIT = 3.5 * 1024 * 1024;   // stay under the server's 4MB ceiling
/* Snapshot Recents for upload. Dev projects can be enormous (a 12k-line file is
   ~680KB), and the server caps a sync payload at 4MB - so we upload newest-first
   and drop the heavy `state` blob from older sessions rather than failing the
   whole sync. Titles/ids always survive, so nothing disappears from Recents. */
function _syncSessionList(){
  try{
    const list = (Array.isArray(_SESSIONS) ? _SESSIONS : []).slice()
      .sort((a,b)=>(b.updated||0)-(a.updated||0));
    return list.map(s=>({
      id:s.id, tool:s.tool, title:s.title, updated:s.updated, created:s.created,
      state: s.state || null
    }));
  }catch(e){ return []; }
}

/* Keep the payload under the server's ceiling. Sheds the biggest, oldest
   session bodies first; never sheds chats, memory, or session titles. */
function _syncTrim(out){
  try{
    let size = JSON.stringify(out).length;
    if(size <= SYNC_SOFT_LIMIT) return out;
    const sess = out.sessions || [];
    // oldest first - those lose their heavy body first
    for(let i = sess.length - 1; i >= 0 && size > SYNC_SOFT_LIMIT; i--){
      if(sess[i] && sess[i].state){
        sess[i] = { ...sess[i], state:null, _trimmed:true };
        size = JSON.stringify(out).length;
      }
    }
    out.sessions = sess;
    if(size > SYNC_SOFT_LIMIT && Array.isArray(out.imgs)){
      out.imgs = out.imgs.slice(-20);   // images are the next-biggest thing
    }
  }catch(e){}
  return out;
}
try{ window._syncSessionList=_syncSessionList; }catch(e){}

const AMVSync = {
  _timer: null,
  enabled(){ try{ return !!(window.AMV_API && AMV_API.live && AMV_API.token); }catch(e){ return false; } },
  async pull(){
    if(!this.enabled()) return false;
    try{
      const data = await AMV_API.syncPull();
      if(!data) return false;
      /* AMV-069: MERGE, do not overwrite. "Server wins" destroyed anything done
         on this device since its last push - work done offline, or on a device
         that had not synced yet, was simply gone the moment the user signed in.
         Lists are merged by id, newest wins, and on a tie the copy carrying
         more content wins so a trimmed upload can never erase a full one. */
      _SYNC_KEYS.forEach(k=>{
        if(data[k]===undefined) return;
        const local=_raw[k];
        const merged=(Array.isArray(data[k]) && Array.isArray(local) && _SYNC_MERGEABLE.has(k))
          ? _mergeById(local, data[k]) : data[k];
        _raw[k]=merged; _persist(k,merged);
      });

      // Restore the user's actual WORK into memory, not just into storage -
      // otherwise Recents stays empty until a reload.
      if(Array.isArray(data.sessions)){
        try{
          // Same rule for Recents: a Dev project that only exists on this
          // device must survive a pull, not be replaced out of existence.
          const merged=_mergeById(Array.isArray(_SESSIONS)?_SESSIONS.slice():[], data.sessions);
          _SESSIONS.length = 0;
          merged.forEach(x=>_SESSIONS.push(x));
          store(_sessKey(), _SESSIONS);
        }catch(e){ _logErr('sync.sessions', e); }
      }
      /* Skills and handoffs get the same treatment as Recents. The server
         merges them, so its copy is a union of everything it has SEEN - but a
         skill written on this device since the last push is not in that union,
         and storing the server list over the top would delete it. */
      if(Array.isArray(data.skills)){
        try{ store('amv_skills', _mergeById(load('amv_skills')||[], data.skills)); }catch(e){ _logErr('sync.skills', e); }
      }
      if(Array.isArray(data.handoffs)){
        try{ store('amv_handoffs', _mergeById(load('amv_handoffs')||[], data.handoffs)); }catch(e){ _logErr('sync.handoffs', e); }
      }
      if(data.profile)                 { try{ store('amv_profile', data.profile); }catch(e){} }

      try{ renderHist && renderHist(); }catch(e){}          // Recents repaint
      try{ if(S.tab) renderView&&renderView(); }catch(e){}
      return true;
    }catch(e){ _logErr('AMVSync.pull', e); return false; }
  },
  collect(){
    const out={};
    _SYNC_KEYS.forEach(k=>{ out[k]=_raw[k]; });
    // Recents / Dev projects / Lab sessions live in a module array, not AMVState.
    try{ out.sessions = _syncSessionList(); }catch(e){ out.sessions = []; }
    try{ out.skills   = load('amv_skills')   || []; }catch(e){}
    try{ out.handoffs = load('amv_handoffs') || []; }catch(e){}
    try{ out.profile  = load('amv_profile')  || null; }catch(e){}
    return _syncTrim(out);
  },
  push(){ // debounced
    if(!this.enabled()) return;
    clearTimeout(this._timer);
    this._timer=setTimeout(()=>{ Promise.resolve(AMV_API.syncPush(this.collect())).catch(e=>_logErr('AMVSync.push', e)); }, 1200);
  },
  start(){
    if(!this.enabled()) return;
    // push whenever a synced key changes
    _SYNC_KEYS.forEach(k=>AMVState.subscribe(k, ()=>this.push()));
    // _SESSIONS isn't an AMVState key, so nothing would ever trigger a push for
    // Dev/Lab work. Hook the save path directly.
    try{ window.addEventListener('amv:sessions-changed', ()=>this.push()); }catch(e){}
  },
};
try{ window.AMVSync = AMVSync; }catch(e){}

/* ============================================================
   AMVValue - tracks the value AMV delivers for the user so we can
   show it back to them ("X tasks done, ~Y hours saved this week").
   Quantified value is a top retention + willingness-to-pay driver.
   ============================================================ */
const AMVValue = {
  // minutes a human would plausibly spend doing each thing manually
  _MIN:{ message:4, image:20, video:45, code:35, document:30, agent_action:12, research:25, design:40 },
  _key(){ return 'amv_value'; },
  _load(){ try{ return load(this._key())||{events:[]}; }catch(e){ return {events:[]}; } },
  _save(v){ try{ store(this._key(), v); }catch(e){} },
  record(type, meta){
    const v=this._load();
    v.events.push({ t:type, ts:Date.now(), min:this._MIN[type]||3, meta:meta||null });
    // keep last ~2000 events
    if(v.events.length>2000) v.events=v.events.slice(-2000);
    this._save(v);
    try{ if(S.tab==='usage' && typeof renderUsageView==='function') renderUsageView(); }catch(e){}
  },
  // aggregate over a window (days). null = all time
  stats(days){
    const v=this._load();
    const since = days? Date.now()-days*864e5 : 0;
    const ev=v.events.filter(e=>e.ts>=since);
    const byType={}; let minutes=0;
    ev.forEach(e=>{ byType[e.t]=(byType[e.t]||0)+1; minutes+=e.min||0; });
    return { total:ev.length, byType, minutesSaved:minutes, hoursSaved:+(minutes/60).toFixed(1) };
  },
  // per-day counts for the last N days (for the chart)
  daily(days){
    days=days||14;
    const v=this._load();
    const out=[];
    for(let i=days-1;i>=0;i--){
      const day=new Date(Date.now()-i*864e5).toISOString().slice(0,10);
      const count=v.events.filter(e=>new Date(e.ts).toISOString().slice(0,10)===day).length;
      out.push({day, count});
    }
    return out;
  },
};
try{ window.AMVValue = AMVValue; }catch(e){}
/* Analytics - track key product/funnel events (signup, activation, upgrades).
   Privacy-first: fully local by default, and honors the user's opt-out. Data
   never leaves the browser unless the operator connects an analytics backend. */
function track(event, props){
  try{
    if(loadStr('amv_analytics_opt_out')==='1') return;           // user opted out
    if(window.AEGIS && AEGIS.log) AEGIS.log('track', { name:event, ...(props||{}) });
    const ep=loadStr('amv_analytics_endpoint');                  // operator-configured sink
    if(ep){ try{ navigator.sendBeacon(ep, JSON.stringify({ event, props:props||{}, ts:Date.now(), anon:_anonId() })); }catch(e){} }
  }catch(e){}
}
function _anonId(){ let id=loadStr('amv_anon_id'); if(!id){ id='a_'+Math.random().toString(36).slice(2,12); saveStr('amv_anon_id',id); } return id; }
try{ window.track=track; window._anonId=_anonId; }catch(e){}

/* ============================================================
   AMVUsage - rolling usage window (Task #7)
   Tracks tokens consumed in a rolling window (default 5 hours).
   When the window expires it resets automatically. The Usage page
   shows how much of your plan you have left and when it refreshes.
   ============================================================ */
const AMVUsage = {
  WINDOW_MS: 5*60*60*1000,           // 5-hour rolling window
  KEY: 'amv_usage_window',
  // The per-window token allowance for each plan ("messages per window").
  // Derived from the daily cap so heavier plans get proportionally more.
  _windowCap(){
    try{
      const plan=loadStr('amv_plan')||'free';
      let t=(typeof PLAN_TIERS!=='undefined' && PLAN_TIERS[plan])||null;
      // custom plan: use the saved caps
      if(plan==='custom'){ try{ const c=load('amv_plan_caps'); if(c&&c.dailyTokenCap) t={dailyTokenCap:c.dailyTokenCap}; }catch(e){} }
      const daily=(t&&t.dailyTokenCap)|| (typeof AEGIS!=='undefined'&&AEGIS.cfg&&AEGIS.cfg.dailyTokenCap) || 50000;
      // a day ≈ ~4.8 five-hour windows; give a generous ~1/3 of daily per window
      return Math.max(5000, Math.round(daily/3));
    }catch(e){ return 50000; }
  },
  _win(){
    let w=null; try{ w=load(this.KEY); }catch(e){}
    const now=Date.now();
    if(!w || !w.start || (now - w.start) >= this.WINDOW_MS){
      w={ start:now, used:0, reqs:0 };           // fresh window
      try{ store(this.KEY, w); }catch(e){}
    }
    return w;
  },
  record(tokens){
    const w=this._win();
    w.used += Math.max(0, tokens||0);
    w.reqs += 1;
    try{ store(this.KEY, w); }catch(e){}
    try{ if(S.tab==='usage' && typeof renderUsageView==='function') renderUsageView(); }catch(e){}
    return w;
  },
  // current status: {used, cap, pct, remaining, resetsInMs, resetsAt, reqs}
  status(){
    const w=this._win();
    const cap=this._windowCap();
    const used=Math.min(w.used, cap);
    const remaining=Math.max(0, cap-w.used);
    const resetsAt=w.start + this.WINDOW_MS;
    const resetsInMs=Math.max(0, resetsAt - Date.now());
    return {
      used:w.used, cap, remaining,
      pct: cap>0 ? Math.min(100, Math.round((w.used/cap)*100)) : 0,
      reqs:w.reqs, resetsAt, resetsInMs,
      windowHours: Math.round(this.WINDOW_MS/3600000)
    };
  },
  // human "resets in 4h 12m"
  resetLabel(){
    return _fmtResetIn(this.status().resetsInMs);
  }
};
// Human wording for a reset countdown: "3 hours 12 minutes", "14 minutes", "under a minute".
function _fmtResetIn(ms){
  const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000);
  if(h>0) return h+(h===1?' hour ':' hours ')+m+(m===1?' minute':' minutes');
  if(m>0) return m+(m===1?' minute':' minutes');
  return 'under a minute';
}
try{ window.AMVUsage = AMVUsage; }catch(e){}

/* ── Out-of-usage lock ─────────────────────────
   When usage runs out (locally-tracked window OR a server quota_day/month),
   the chat stops: sends are blocked, a notice with a LIVE countdown shows in
   the composer, and everything unlocks automatically the moment usage resets. */
let _quotaLockUntil=0, _quotaTimer=null;
function quotaLock(resetAt){
  _quotaLockUntil=Math.max(_quotaLockUntil, resetAt||0);
  _renderQuotaNotice();
  if(!_quotaTimer){
    _quotaTimer=setInterval(()=>{
      if(Date.now()>=_quotaLockUntil){ quotaUnlock(); return; }
      _renderQuotaNotice();                       // live countdown tick
      const card=document.querySelector('.quota-reset-live');
      if(card) card.textContent=_fmtResetIn(_quotaLockUntil-Date.now());
    }, 30000);                                     // update every 30s
  }
}
function quotaUnlock(){
  _quotaLockUntil=0;
  if(_quotaTimer){ clearInterval(_quotaTimer); _quotaTimer=null; }
  const n=$('quota-notice'); if(n) n.remove();
  const ta=$('mta'); if(ta){ ta.disabled=false; ta.placeholder=ta.dataset.ph||ta.placeholder; }
  toast('Your usage has reset - you\u2019re good to go.','success',3500);
}
function quotaLocked(){ return _quotaLockUntil>0 && Date.now()<_quotaLockUntil; }
function _renderQuotaNotice(){
  const cia=$('cia'); if(!cia) return;
  let n=$('quota-notice');
  if(!n){
    n=document.createElement('div');
    n.id='quota-notice'; n.className='quota-notice';
    cia.insertBefore(n, cia.firstChild);
  }
  n.innerHTML='<span class="quota-notice-dot"></span>You\u2019re out of usage - resets in <b class="quota-reset-live">'+escH(_fmtResetIn(_quotaLockUntil-Date.now()))+'</b>'+
    '<button class="quota-notice-up" data-stab="plans">Upgrade</button>';
  const ta=$('mta');
  if(ta && !ta.disabled){ ta.dataset.ph=ta.placeholder; ta.disabled=true; ta.placeholder='Out of usage - resets in '+_fmtResetIn(_quotaLockUntil-Date.now()); }
}
try{ window.quotaLock=quotaLock; window.quotaLocked=quotaLocked; }catch(e){}

/* Budget guard for multi-step runs (autonomous, autoDebug). Each step/iteration
   can burn several thousand tokens, so before starting (and between steps) we
   check the rolling window has enough headroom. Prevents one run from blowing
   your whole quota. Returns {ok, reason, remaining}. */
function _budgetGuard(estPerStep){
  estPerStep = estPerStep || 4000;
  try{
    if(typeof AMVUsage==='undefined') return {ok:true};
    const s = AMVUsage.status();
    // need room for at least one more step; warn/stop if under that
    if(s.remaining < estPerStep){
      return { ok:false, remaining:s.remaining,
        reason:'You\u2019re out of usage for this window. It resets in '+AMVUsage.resetLabel()+'. Upgrade for more, or try again after the reset.' };
    }
    return { ok:true, remaining:s.remaining };
  }catch(e){ return {ok:true}; }  // never block on a guard error
}
try{ window._budgetGuard = _budgetGuard; }catch(e){}


/* === OWNER MODE vs USER MODE - the multi-user safety boundary ===
   When connected to a live backend (AMV_API.live), the person is a normal
   END USER: the backend holds the real API key, billing and platform controls.
   Users can ONLY touch their own account - never platform settings, never
   other users. Owner controls appear only in local/self-host mode, and a user
   cannot flip this from the browser (it is derived from backend state). */
/* OWNER MODE - only the platform operator (you) ever sees platform controls
   (AI keys, backend, Stripe, platform stats). A regular user NEVER sees them,
   whether the site is deployed or run locally.

   Owner is granted ONLY to the operator's own account. The operator email is
   the single source of truth: even with the ?owner=1 flag or the localStorage
   key set, owner mode is denied unless the logged-in account matches
   OWNER_EMAIL. This means a curious user setting the flag still gets nothing.
   To transfer ownership to a new email, change OWNER_EMAIL below. When a live
   backend is connected, the server (OWNER_EMAIL env var / admin:true) is the
   authority; the browser flag never grants admin on production. */
/* Operator email. Configurable for white-label/resale via a build-time global
   (window.__AMV_OWNER_EMAIL__ injected at deploy), defaulting to the current
   operator. NOTE: this is deliberately NOT read from user-settable localStorage
   - allowing that would let anyone grant themselves owner in local/demo mode.
   On a live backend the server (OWNER_EMAIL env / admin:true) is the real
   authority; this client value only gates local UI affordances. */
const OWNER_EMAIL = (function(){
  try{ if(typeof window!=='undefined' && typeof window.__AMV_OWNER_EMAIL__==='string' && window.__AMV_OWNER_EMAIL__.includes('@')) return window.__AMV_OWNER_EMAIL__.trim().toLowerCase(); }catch(e){}
  return 'amarotovaleria@gmail.com';
})();
function _isOwnerEmail(email){
  try{ return !!email && String(email).trim().toLowerCase() === OWNER_EMAIL.toLowerCase(); }catch(e){ return false; }
}
function isOwnerMode(){
  // The logged-in account MUST be the operator email. No exceptions in the UI.
  // (This is the single gate - being this email is necessary AND sufficient.)
  return _isOwnerEmail(S.user && S.user.email);
}
function isAdmin(){ return isOwnerMode(); }
/* Recorded for support only - nothing reads it, and nothing should. isOwnerMode
   above is the single gate and it is email-only, so a flag anybody can set by
   typing ?owner=1 grants exactly nothing. Do not wire this into a check. */
try{ if(typeof location!=='undefined' && /[?&]owner=1\b/.test(location.search)){ saveStr('amv_owner','1'); } }catch(e){}
try{ window.OWNER_EMAIL=OWNER_EMAIL; window._isOwnerEmail=_isOwnerEmail; }catch(e){}
// Models
const MODELS = {
  auto:   { label:'AMV Auto', desc:'Automatically picks the right model for each task', color:'#5590ff', model:'auto', tokens:6000, cost:0, rec:'free' },
  fast:   { label:'AMV Pulse', desc:'Fast and efficient for everyday tasks', color:'#4ade80', model:'amv-pulse', tokens:4000, cost:1, rec:'free' },
  core:   { label:'AMV Core',  desc:'Balanced performance for most work', color:'#5590ff', model:'amv-core', tokens:16000, cost:2, rec:'free' },
  coding: { label:'AMV Forge', desc:'Built for complex coding and engineering', color:'#ff4d4d', model:'amv-forge', tokens:32000, cost:3, rec:'pro' },
  smart:  { label:'AMV Apex',  desc:'The most capable model, for the hardest problems', color:'var(--indigo)', model:'amv-apex', tokens:16000, cost:4, rec:'elite' },
  image:  { label:'AMV Vision', desc:'Image generation', color:'#5590ff', model:'image', tokens:0, cost:0, hidden:true },
};
const MODEL_ORDER=['auto','fast','core','coding','smart'];
/* The server's engine keys, in AMV's own names. Used to label a turn that AMV
   Auto routed, so the user can always see which engine answered them. */
const ENGINE_LABEL={ 'amv-pulse':'AMV Pulse', 'amv-core':'AMV Core', 'amv-forge':'AMV Forge', 'amv-apex':'AMV Apex' };
try{ window.ENGINE_LABEL=ENGINE_LABEL; }catch(e){}

/* ===== BUILD-SECTION MODEL PICKER =====
   Lab, Dev, and Studio let the user choose which model runs their work, so they
   control how much usage they spend. The choice is REAL - it's passed straight to
   aiComplete/runCode paths. Persisted per section. */
const _BUILD_MODEL = { dev:'smart', lab:'smart', studio:'smart' };
/* Scoped like every other preference - raw localStorage skips _scopeKey. */
try{ const saved=load('amv_build_models'); if(saved && typeof saved==='object') Object.assign(_BUILD_MODEL, saved); }catch(e){}
function _saveBuildModels(){ try{ store('amv_build_models', _BUILD_MODEL); }catch(e){} }
/* The best engine this plan can actually run, at or below the one chosen.

   Dev, Lab and Studio all defaulted to `smart` - Apex, which needs Elite. A
   free account opening Dev saw "Apex . heaviest" on the chip and got a 402
   plan_required on its first message, because the server enforces minPlan and
   is right to. Three whole surfaces dead on the free tier, with the cause
   printed at the top of the screen in a colour nobody reads as an error.

   The picker still offers everything; a tier above the plan just runs on the
   best one below it rather than failing. Chat has always done this through
   _routeModel - the build sections bypassed it by keeping their own default. */
const _BUILD_FALLBACK = ['smart', 'coding', 'core', 'fast'];
/* Clamp any model key to the best one this plan can actually run. */
function _planAllowedModel(want){
  want = want || 'smart';
  /* AUTO IS NOT AN ENGINE, AND CLAMPING IT COST REAL MONEY.

     PLAN_TIERS[plan].models lists engines - fast, core, coding, smart. 'auto'
     is not one of them and never was, so this function found it missing and
     "clamped" it, walking _BUILD_FALLBACK from the top and handing back the
     HEAVIEST engine the plan allows. On Elite and Ultra that is Apex, the most
     expensive engine in the product, on every Studio, Dev and Lab call from
     anybody who picked "AMV Auto - picks for you".

     The server has routed auto for real since AMV-065: _autoRoute reads the
     turn, picks the cheapest engine that will not visibly do a worse job,
     applies the plan ceiling ITSELF, and reports back which engine answered so
     the interface can name it. All of that was unreachable from the build
     surfaces, because the clamp happened in the browser first.

     So auto passes through. It is the one value here that is a request for
     routing rather than a request for an engine, and the ceiling it needs is
     already enforced on the server, which is where it belongs. */
  if(want === 'auto') return 'auto';
  try{
    const plan = loadStr('amv_plan') || 'free';
    if(plan === 'custom') return want;
    const tier = (typeof PLAN_TIERS !== 'undefined' && PLAN_TIERS[plan]) || null;
    if(!tier || !Array.isArray(tier.models)) return want;
    if(tier.models.indexOf(want) >= 0) return want;
    const from = Math.max(0, _BUILD_FALLBACK.indexOf(want));
    for(const k of _BUILD_FALLBACK.slice(from)){ if(tier.models.indexOf(k) >= 0) return k; }
    return 'core';
  }catch(e){ return want; }
}
function _buildModelAllowed(section){ return _planAllowedModel(_BUILD_MODEL[section] || 'smart'); }
// resolve a section's chosen model key → real API model string for aiComplete/opts.model
function _buildModelStr(section){ const k=_buildModelAllowed(section); const m=MODELS[k]; return (m&&m.model&&m.model!=='auto')?m.model:'amv-core'; }
// usage dots (1-4) as a compact visual - clearly shows how much each model costs
function _usageDots(cost){ let s=''; for(let i=1;i<=4;i++){ s+='<span class="mp-dot'+(i<=cost?' on':'')+'"></span>'; } return '<span class="mp-dots" title="Usage per run">'+s+'</span>'; }
function _usageWord(cost){ return ['No','Low','Medium','High','Maximum'][cost]||'Medium'; }
// build a model picker for a section
function _modelPickerHTML(section){
  /* Show what will RUN, not what was stored - a chip naming an engine the plan
     cannot reach is the thing that made this look like it worked. */
  const cur=_buildModelAllowed(section);
  const opts=MODEL_ORDER.filter(k=>k!=='auto'||section==='studio').map(k=>{ const m=MODELS[k]; return '<option value="'+k+'"'+(k===cur?' selected':'')+'>'+m.label+' \u00b7 '+_usageWord(m.cost).toLowerCase()+' usage</option>'; }).join('');
  const m=MODELS[cur];
  return '<div class="mp-wrap"><label class="mp-label">Model</label>'+
    '<select class="mp-sel" data-mp="'+section+'" aria-label="Engine for '+escH(section)+'">'+opts+'</select>'+
    _usageDots(m.cost)+
    '<span class="mp-note" data-mp-note="'+section+'">'+_usageWord(m.cost)+' usage per run</span>'+
  '</div>';
}
function _wireModelPicker(root){
  (root||document).querySelectorAll('[data-mp]').forEach(sel=>on(sel,'change',()=>{
    const section=sel.dataset.mp; _BUILD_MODEL[section]=sel.value; _saveBuildModels();
    const m=MODELS[sel.value];
    const wrap=sel.closest('.mp-wrap'); if(wrap){ const dots=wrap.querySelector('.mp-dots'); if(dots) dots.outerHTML=_usageDots(m.cost); const note=wrap.querySelector('[data-mp-note]'); if(note) note.textContent=_usageWord(m.cost)+' usage per run'; }
    toast(m.label+' selected - '+_usageWord(m.cost).toLowerCase()+' usage per run','info',2500);
  }));
}

/* ============================================================
   PER-SECTION MODEL CHOICE - lets users decide which model powers
   each heavy section (Dev/Code, Lab/Debug, Studio/Design) so they
   control how much usage those consume. Stored per section; falls
   back to a sensible default. Every one of these sections calls
   _sectionModel(section) instead of hardcoding a model string.
   ============================================================ */
/* THE DEFAULT IS AUTO, NOT THE DEAREST ENGINE.

   These three sections defaulted to `smart` - Apex, the most expensive engine
   in the product - for everybody who never opened the picker, which is almost
   everybody. A one-line CSS tweak in Build and a "fix this typo" in Lab both
   ran on the heaviest model available.

   The server has routed auto properly since AMV-065: it reads the turn, picks
   the cheapest engine that will not visibly do a worse job, and applies the
   plan ceiling itself. Defaulting to that is what chat already does, and it is
   the single largest lever on model spend in the product. Anybody who wants a
   specific engine still picks one, and their choice is remembered. */
const _SECTION_DEFAULTS = { code:'auto', debug:'auto', design:'auto' };
/* There are two of these - _BUILD_MODEL for the pickers in the panels, and
   this one for the chip and for _sectionModel, which is what aiCompleteLong
   and the agentic runner are handed. Both defaulted to Apex, so both needed
   the same clamp; fixing one would have moved the failure rather than ended
   it. */
function _sectionModelKey(section){
  const k=loadStr('amv_secmodel_'+section);
  return _planAllowedModel((k && MODELS[k]) ? k : (_SECTION_DEFAULTS[section]||'smart'));
}
function _sectionModel(section){ return MODELS[_sectionModelKey(section)].model; }
function _setSectionModel(section, key){ if(MODELS[key]) saveStr('amv_secmodel_'+section, key); }
/* WHAT A MODEL IS FOR, NOT HOW HEAVY IT IS.

   The picker read "Apex \u00b7 heaviest", "Forge \u00b7 higher", "Pulse \u00b7 light". That is
   this file's internal cost ladder shown to somebody who has never seen it, and
   it asks them to translate. "Heaviest" is not a reason to pick something - read
   plainly it sounds slow and expensive, which is exactly the wrong impression of
   the model you reach for when the work is hard.

   The label says what you would choose it FOR. The ladder still exists and still
   decides routing and billing; it is simply not the thing a person is asked to
   reason about.

   (_modelCostLabel used to sit here returning "heaviest usage" and had no
   callers at all - the live labels were built inline below. Removed rather than
   left looking like the thing that produces them.) */
function _modelOutcomeLabel(key){
  const m=MODELS[key]||{};
  if(m.model==='auto') return 'picks for you';
  const c=m.cost||0;
  if(c<=1) return 'fastest';
  if(c<=2) return 'balanced';
  if(c<=3) return 'built for code';
  return 'highest quality';
}
/* Build a <select> of pickable models for a section (excludes hidden/image).

   AN OPTION YOU CAN PICK AND CANNOT GET IS A LIE THE PICKER TELLS.
   Every engine was offered on every plan. Choosing Apex on Free selected it,
   toasted "Design model set to AMV Apex", stored it - and then ran Core,
   because _sectionModelKey clamps on the way back out. Present, chooseable,
   and inert, which is the defect this whole pass keeps finding.

   Now an engine the plan cannot run is disabled and says which plan unlocks it.
   Same information, and it turns a silent downgrade into the one thing a
   refusal should be: an offer. (Auto is never disabled - it is a request for
   routing, and the server routes it within whatever the plan allows.) */
function _sectionModelSelect(section, id){
  const cur=_sectionModelKey(section);
  const plan=loadStr('amv_plan')||'free';
  const tier=(typeof PLAN_TIERS!=='undefined' && PLAN_TIERS[plan])||null;
  const canRun=k=> k==='auto' || plan==='custom' || !tier || !Array.isArray(tier.models)
    || tier.models.indexOf(k)>=0;
  const PLAN_LABEL={free:'Free',pro:'Pro',elite:'Elite',ultra:'Ultra'};
  return '<select id="'+id+'" class="sel secmodel-sel" aria-label="Engine for '+escH(section)+'">'+MODEL_ORDER.map(k=>{
    const m=MODELS[k];
    const okk=canRun(k);
    const tail=okk ? _modelOutcomeLabel(k)
      : 'on '+(PLAN_LABEL[m.rec]||'a paid plan');
    return '<option value="'+k+'"'+(k===cur?' selected':'')+(okk?'':' disabled')+'>'+
      m.label.replace('AMV ','')+' \u00b7 '+tail+'</option>';
  }).join('')+'</select>';
}

/* RULE 7+8 - cost-aware router. Picks the cheapest model that can do the job.
   Saves money: a trivial question on Pulse costs ~20x less than Apex.
   Respects the user's plan (won't route to a model they can't use). */
function _routeModel(msgs){
  const last=(msgs.filter(m=>m.r==='u').slice(-1)[0]||{}).c||'';
  const text=String(last); const len=text.length; const low=text.toLowerCase();
  const plan=loadStr('amv_plan')||'free';
  const tier=PLAN_TIERS[plan]||PLAN_TIERS.free;
  const can=(k)=> plan==='custom' || tier.models.indexOf(k)>=0;
  const pick=(prefs)=>{ for(const k of prefs){ if(can(k)) return k; } return can('core')?'core':'fast'; };
  // complex / coding / building → premium
  if(/\b(code|debug|function|api|build|app|website|component|algorithm|refactor|sql|regex|compile|deploy)\b/.test(low) || /```/.test(text))
    return pick(['coding','smart','core','fast']);
  // deep reasoning / research / long → high-tier
  if(len>900 || /\b(analy|research|compare|strateg|prove|explain in detail|comprehensive|write an essay|in depth)\b/.test(low))
    return pick(['smart','core','coding','fast']);
  // short factual / quick → cheapest
  if(len<160 && !/\?.*\?/.test(text) && /\b(what|who|when|where|define|convert|translate|spell|how many|list)\b/.test(low))
    return pick(['fast','core']);
  // default everyday → balanced
  return pick(['core','fast']);
}
const COST_LABEL={0:'Smart - varies',1:'Lowest usage',2:'Low usage',3:'More usage',4:'Most usage'};
const PLAN_REC={free:'Free',pro:'Pro',elite:'Elite'};

// ====================================================================
// AEGIS - client-side guardrails + observability layer
// HONEST SCOPE: This runs in the browser. It deters casual overuse,
// surfaces clear errors, tracks usage, and keeps a local audit log.
// It is NOT a security boundary - the API key is visible in the
// browser, so a determined user can bypass any of these. Real
// enforcement requires the server proxy (see proxy/ folder).
// ====================================================================
const AEGIS = {
  // ---- tunable limits (soft, client-side) ----
  cfg: {
    rpmMax: 12,            // requests per rolling minute
    burstMax: 4,           // requests per 10s window
    dailyTokenCap: 200000, // input+output tokens per day per device
    minGapMs: 800,         // hard floor between sends
  },
  // ---- approx pricing per model (USD per 1M tokens) for usage view ----
  /* Real published rates. These were overstated (Forge at 15/75, Apex at
     20/100) which made the usage view show a cost two to three times what a
     conversation actually cost. */
  /* Keyed by AMV ENGINE, which is also the only thing the browser ever names
     or sends. What each engine runs on is a server decision and stays there. */
  price: {
    'amv-apex':  { in: 10.00, out: 50.00 },
    'amv-forge': { in: 5.00,  out: 25.00 },
    'amv-core':  { in: 3.00,  out: 15.00 },
    'amv-pulse': { in: 1.00,  out: 5.00 },
    /* An auto-routed call is sent as 'auto' and the SERVER decides the engine,
       so the browser does not know which one answered. Without an entry here
       the lookup misses and the call is costed at zero - and this figure is the
       operator's "Spend today", so a growing share of real spend would simply
       not appear on it. Core is the estimate because Core is what the router
       returns for everything it is not sure about, and the two engines it can
       pick instead sit either side of it. Marked estimated, which the label
       already says. */
    'auto':      { in: 3.00,  out: 15.00 },
  },
  _times: [],            // request timestamps (this session)
  _lastSend: 0,
  // ---------- usage (persisted per day) ----------
  _usageKey(){ return 'amv_usage_'+new Date().toISOString().slice(0,10); },
  usage(){
    try{ return JSON.parse(loadStr(this._usageKey())||'') || this._blankUsage(); }
    catch(e){ return this._blankUsage(); }
  },
  _blankUsage(){ return { reqs:0, inTok:0, outTok:0, costUSD:0, errors:0 }; },
  _saveUsage(u){ try{ saveStr(this._usageKey(), JSON.stringify(u)); }catch(e){} },
  recordUsage(model, inTok, outTok){
    const u=this.usage();
    u.reqs+=1; u.inTok+=inTok||0; u.outTok+=outTok||0;
    const p=this.price[model];
    if(p) u.costUSD += ((inTok||0)/1e6)*p.in + ((outTok||0)/1e6)*p.out;
    this._saveUsage(u);
    this.log('usage', { model, inTok, outTok, dayTotal:u.inTok+u.outTok });
    try{ if(typeof renderUsageView==='function' && S.tab==='usage') renderUsageView(); }catch(e){}
    return u;
  },
  recordError(){ const u=this.usage(); u.errors+=1; this._saveUsage(u); },
  // ---------- rate limit gate ----------
  // returns {ok:true} or {ok:false, reason, retryMs}
  check(){
    const now=Date.now();
    if(now - this._lastSend < this.cfg.minGapMs)
      return { ok:false, reason:'Slow down a moment before sending again.', retryMs:this.cfg.minGapMs-(now-this._lastSend) };
    // prune
    this._times = this._times.filter(t=> now - t < 60000);
    const last10 = this._times.filter(t=> now - t < 10000).length;
    if(last10 >= this.cfg.burstMax)
      return { ok:false, reason:'Too many requests in a few seconds. Pause briefly.', retryMs:3000 };
    if(this._times.length >= this.cfg.rpmMax)
      return { ok:false, reason:'Hit the per-minute request limit. Try again shortly.', retryMs:15000 };
    const u=this.usage();
    if(u.inTok+u.outTok >= this.cfg.dailyTokenCap)
      return { ok:false, reason:'Daily token cap reached for this device. Resets at midnight UTC.', retryMs:null };
    return { ok:true };
  },
  noteSend(){ const now=Date.now(); this._times.push(now); this._lastSend=now; },
  // ---------- observability / structured log ----------
  _logKey:'amv_log',
  _log:null,
  _loadLog(){ if(this._log) return this._log; try{ this._log=JSON.parse(loadStr(this._logKey)||'')||[]; }catch(e){ this._log=[]; } return this._log; },
  log(event, data){
    const L=this._loadLog();
    const entry={ ts:new Date().toISOString(), event, ...data };
    L.push(entry);
    if(L.length>500) L.splice(0, L.length-500); // ring buffer
    try{ saveStr(this._logKey, JSON.stringify(L)); }catch(e){}
    if(window.__AMV_DEBUG) console.debug('[AEGIS]', event, data||'');
    try{ if(typeof _trackEvent==='function') _trackEvent(event, data); }catch(e){}
    return entry;
  },
  exportLog(){
    const blob=new Blob([JSON.stringify(this._loadLog(),null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='amv-audit-log.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  },
  clearLog(){ this._log=[]; try{ saveStr(this._logKey,'[]'); }catch(e){} },
};
window.AEGIS = AEGIS;
function aegisExport(){ AEGIS.exportLog(); if(typeof toast==='function') toast('Audit log exported','info'); }
function aegisClear(){ AEGIS.clearLog(); if(typeof toast==='function') toast('Audit log cleared','info'); if(typeof renderUsageView==='function'&&S.tab==='usage') renderUsageView(); }
window.aegisExport=aegisExport; window.aegisClear=aegisClear;

// Map raw API/network failures to clear, actionable messages
function aegisErrorMessage(status, raw){
  const r=(raw||'').toLowerCase();
  if(status===402||(r.includes('plan')&&r.includes('requires'))) return (raw||'This model needs a higher plan.')+'  →  Open Settings → Billing to upgrade.';
  if(r.includes('daily usage limit')) return 'You’ve hit today’s usage limit. It resets at midnight UTC - or upgrade your plan for much more.';
  if(r.includes('monthly usage limit')) return 'You’ve reached this month’s usage. Upgrade your plan for more room to run.';
  /* Kept as a fallback for callers with no code to go on. The sentence the
     server sent wins when there is one, because "at capacity for FREE accounts,
     paid plans are running normally" and "at capacity for today" are different
     facts and only one of them is true at a time. */
  if(r.includes('at capacity')) return raw || 'AMV is at capacity right now. Please try again shortly.';
  if(status===401||r.includes('authentication')||r.includes('invalid x-api-key')||r.includes('sign in again'))
    return 'Your session needs a refresh - sign out and back in. (If self-hosting, re-check your API key in Settings.)';
  if(status===403) return 'Access forbidden (403). This key lacks permission for this model or endpoint.';
  if(status===429||r.includes('rate')) return 'Too many requests right now (429). Give it a few seconds and try again.';
  if(status===400||r.includes('invalid_request')) return 'The request was malformed (400). '+(raw||'').slice(0,140);
  if(status===413||r.includes('too large')) return 'The conversation is too long for one request (413). Start a new chat or trim earlier messages.';
  if(status===500||status===529||status===503) return 'The AI service had a temporary error ('+status+'). Please retry in a moment.';
  if(status===0||r.includes('failed to fetch')||r.includes('networkerror'))
    return 'Network error - could not reach the API. Check your connection, ad-blockers, or CORS/extension interference.';
  if(status) return 'API error '+status+(raw?': '+raw.slice(0,160):'');
  return raw||'Unknown error.';
}

/* Turn any raw AI error into one short, human sentence - clean and modern.
   Keeps real actionable info (usage, sign-in, plan) but never dumps stack traces. */
function _aiFriendly(msg){
  const m=String(msg||'').toLowerCase();
  if(/isn.t connected|engine|switch on/.test(m)) return 'AMV isn’t connected yet. Turn on the AMV engine in Settings to start.';
  if(/out of usage|usage limit|daily|window/.test(m)) return msg;   // already friendly + actionable
  if(/rate|429|too many/.test(m)) return 'Too many requests right now. Give it a few seconds and try again.';
  if(/network|failed to fetch|offline|timed out|timeout/.test(m)) return 'AMV couldn’t reach the network. Check your connection and try again.';
  if(/401|auth|sign in|session/.test(m)) return 'Your session needs a refresh - sign out and back in.';
  if(/413|too long|too large|context/.test(m)) return 'This is a bit too long to process at once. Try trimming it and running again.';
  if(/5\d\d|529|temporary|capacity/.test(m)) return 'AMV had a brief hiccup. Please try again in a moment.';
  return 'AMV hit a snag. Please try again.';
}

/* THE GUESSER IS FOR ERRORS NOBODY WROTE.

   _aiFriendly takes a STRING and rewrites it by keyword, which is right for a
   provider's raw output and wrong for a sentence AMV composed on purpose. The
   tag that tells them apart lives on the ERROR, so every caller that reached
   for _aiFriendly(err.message) threw the tag away one character before it was
   needed - and the sentences being rewritten were AMV's own, because those are
   the ones written deliberately.

   One function, taking the error rather than its message, so the choice is
   made once instead of remembered at each call site. */
function _errText(err){
  if(err && err._saidPlainly && err.message) return String(err.message);
  return _aiFriendly(err && err.message);
}
try{ window._errText=_errText; }catch(e){}

/* _aiFailCard lived here: an inline "hit a snag" card with a Retry button,
   exported on window and rendered by nothing. Its own comment said
   "Consistent everywhere", which was true in the way that costs nothing. */


// Init state
S.memory = load('amv_memory')||load('amv_mem')||[];
S.prompts = load('amv_pl')||getDefaultPrompts();
S.workspaces = load('amv_ws')||getDefaultWorkspaces();


function getDefaultPrompts() {
  return [
    { id:'p1', title:'Write an Essay', cat:'Writing', text:'Write a complete, well-structured, high-quality essay on the following topic: [TOPIC]. Include an introduction, 3-4 body paragraphs with evidence and analysis, and a strong conclusion.' },
    { id:'p2', title:'Debug My Code', cat:'Coding', text:'I have a bug in my code. Please analyze it carefully, identify the root cause, and provide a fixed version with an explanation of what was wrong:\n\n[CODE]' },
    { id:'p3', title:'Market Analysis', cat:'Business', text:'Write a comprehensive market analysis report for [INDUSTRY/COMPANY] including: market size and growth, key players, competitive dynamics, SWOT analysis, trends, and 5-year forecast.' },
    { id:'p4', title:'Explain Like 5', cat:'Education', text:'Explain the following concept in the simplest possible terms, as if explaining to a 5-year-old: [CONCEPT]' },
    { id:'p5', title:'Interview Prep', cat:'Career', text:'Help me prepare for a [JOB TITLE] interview. Give me the 10 most important questions likely to be asked with detailed model answers using the STAR method.' },
    { id:'p6', title:'Create 3D Model', cat:'3D', text:'Create an interactive, animated 3D model of [SUBJECT] with drag-to-rotate, scroll-to-zoom, and realistic colors and materials.' },
    { id:'p7', title:'Translate Text', cat:'Language', text:'Translate the following text to [TARGET LANGUAGE]. Preserve the tone, style, and nuance. Explain any cultural differences or idioms that required adaptation:\n\n[TEXT]' },
    { id:'p8', title:'Build Full App', cat:'Coding', text:'Build a complete, production-ready [TYPE] application with: frontend UI, backend logic, authentication, database schema, and all necessary code. Make it fully functional with no placeholders.' },
    { id:'p9', title:'Summarize Document', cat:'Analysis', text:'Read the following document and provide: 1) A one-sentence summary, 2) Key points (bullet list), 3) Action items or recommendations, 4) Questions this raises:\n\n[DOCUMENT]' },
    { id:'p10', title:'Generate Ideas', cat:'Creative', text:'Generate 20 creative, diverse, and actionable ideas for [TOPIC]. For each idea, provide a brief explanation of why it would work and how to execute it.' },
    { id:'p11', title:'Solve Math Problem', cat:'Math', text:'Solve the following math problem step by step. Show all working, explain each step clearly, and verify the answer: [PROBLEM]' },
    { id:'p12', title:'Write Story', cat:'Creative', text:'Write a compelling short story (1000-1500 words) with the following elements: Genre: [GENRE], Setting: [SETTING], Main character: [CHARACTER], Core conflict: [CONFLICT]. Make it engaging with vivid descriptions and natural dialogue.' },
  ];
}
function getDefaultWorkspaces() {
  return [
    { id:'ws1', name:'Personal', icon:'👤', desc:'Personal projects and conversations', created:Date.now(), convs:[] },
    { id:'ws2', name:'Work', icon:'💼', desc:'Professional tasks and analysis', created:Date.now(), convs:[] },
    { id:'ws3', name:'Research', icon:'🔬', desc:'Deep research and analysis', created:Date.now(), convs:[] },
    { id:'ws4', name:'Creative', icon:'🎨', desc:'Creative writing and brainstorming', created:Date.now(), convs:[] },
  ];
}


/* == SECURE AUTH == */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* ── PKCE (Proof Key for Code Exchange) - for the secure OAuth auth-code flow ──
   Generates a high-entropy verifier, stores it for the round-trip, and derives
   the S256 challenge. The verifier NEVER leaves the browser except in the final
   token-exchange call to our own backend; the challenge is what goes to Google.
   This is the production-safe replacement for implicit/token-in-URL flows. */
function _b64url(bytes){
  let s=''; const a=new Uint8Array(bytes); for(let i=0;i<a.length;i++) s+=String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function _randToken(len){ const a=new Uint8Array(len||32); crypto.getRandomValues(a); return _b64url(a); }
/* AMV-039: each OAuth attempt gets its OWN transaction, keyed by its random
   state and bound to the provider with an expiry. Concurrent flows (two tabs, or
   starting a second provider before finishing the first) can no longer overwrite
   each other's verifier/state, and a callback for one provider can't consume
   another's transaction. */
function _oauthTxPrune(){
  try{ const now=Date.now(); for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k && k.indexOf('amv_oauthtx_')>-1){ try{ const t=JSON.parse(localStorage.getItem(k)||'{}'); if(!t.exp||t.exp<now) localStorage.removeItem(k); }catch(e){ localStorage.removeItem(k); } } } }catch(e){}
}
function _oauthTxStart(provider, verifier){
  const state=_randToken(16);
  try{ _oauthTxPrune(); saveStr('amv_oauthtx_'+state, JSON.stringify({ provider:String(provider||''), verifier:verifier||'', exp: Date.now()+10*60*1000 })); }catch(e){}
  return state;
}
function _oauthTxConsume(returnedState, expectedProvider){
  const st=String(returnedState||''); if(!st) return null;
  let tx=null; try{ tx=JSON.parse(loadStr('amv_oauthtx_'+st)||'null'); }catch(e){}
  try{ localStorage.removeItem(_scopeKey('amv_oauthtx_'+st)); }catch(e){}   // single-use
  if(!tx) return null;
  if(tx.exp && tx.exp < Date.now()) return null;                            // expired
  if(expectedProvider && tx.provider && tx.provider !== String(expectedProvider)) return null;  // provider mismatch
  return tx;
}
async function _pkceChallenge(provider){
  const verifier=_randToken(48);                       // 64-char high-entropy verifier
  const digest=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge=_b64url(digest);
  const state=_oauthTxStart(provider, verifier);
  return { verifier, challenge, state, method:'S256' };
}
function _pkceConsume(returnedState, provider){
  const tx=_oauthTxConsume(returnedState, provider);
  return tx ? { ok:true, verifier:tx.verifier||'', state:String(returnedState||'') } : { ok:false, verifier:'', state:'' };
}
try{ window._pkceChallenge=_pkceChallenge; window._pkceConsume=_pkceConsume; window._oauthTxStart=_oauthTxStart; window._oauthTxConsume=_oauthTxConsume; }catch(e){}

function acctKey(email) {
  try{ return 'amv_a_'+btoa(unescape(encodeURIComponent(email.toLowerCase().trim()))).replace(/=/g,''); }
  catch(e){ return 'amv_a_'+email.toLowerCase().replace(/[^a-z0-9]/g,'_'); }
}
function convKey(email) {
  try{ return 'amv_cv_'+btoa(unescape(encodeURIComponent(email.toLowerCase().trim()))).replace(/=/g,''); }
  catch(e){ return 'amv_cv_'+email.toLowerCase().replace(/[^a-z0-9]/g,'_'); }
}
async function createAccount(name, email, password) {
  const em = email.toLowerCase().trim();
  const key = acctKey(em);
  const pwHash = await sha256(password+'::amv::'+em);
  const ini = name.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2)||'??';
  const acct = { name, email:em, ini, pwHash, provider:'email', createdAt:Date.now() };
  localStorage.setItem(key, JSON.stringify(acct));
  return acct;
}
function findAccount(email) {
  const em = email.toLowerCase().trim();
  const raw = localStorage.getItem(acctKey(em));
  if (!raw) return null;
  try{ return JSON.parse(raw); }catch{ return null; }
}
async function verifyLogin(email, password) {
  const acct = findAccount(email);
  if (!acct) return null;
  // A password login requires a real password hash on the account. Accounts that
  // only ever signed in with Google have no pwHash - they must use Google (or set
  // a password first), never an arbitrary password through the email form.
  if (!acct.pwHash) return null;
  const hash = await sha256(password+'::amv::'+email.toLowerCase().trim());
  return hash===acct.pwHash ? acct : null;
}
function saveGoogleAccount(name, email) {
  const em = email.toLowerCase().trim();
  const key = acctKey(em);
  const existing = localStorage.getItem(key);
  if (existing) {
    // Same email already has an account (e.g. signed up with email/password).
    // This is the SAME person - link Google to it, don't create a second account.
    try{
      const acct = JSON.parse(existing);
      if(!acct.google){ acct.google = true; localStorage.setItem(key, JSON.stringify(acct)); }
      return acct;
    }catch{}
  }
  const ini = name.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2)||'GU';
  const acct = { name, email:em, ini, pwHash:null, provider:'google', google:true, createdAt:Date.now() };
  localStorage.setItem(key, JSON.stringify(acct));
  try{ if(typeof AEGIS!=='undefined') AEGIS.log('signup_complete',{provider:'google'}); }catch(e){}
  return acct;
}
function loadUserConvs(email) {
  const key = convKey(email.toLowerCase().trim());
  const d = load(key);
  return Array.isArray(d) ? d : null;
}
function saveUserConvs(email, convs) {
  if (!email||!Array.isArray(convs)) return;
  const key = convKey(email.toLowerCase().trim());
  try{
    const slim=convs.map(cv=>({
      ...cv,
      msgs:cv.msgs.map(m=>{
        if(typeof m.c==='string') return m;
        return {...m, c:m.d||'[file attachment]'};
      }).slice(-40)
    }));
    store(key, slim);
  }catch(e){ if(_isQuotaErr(e)) _notifyStorageFull(); else console.warn('saveUserConvs error:',e); }
}

const _fails = {};

