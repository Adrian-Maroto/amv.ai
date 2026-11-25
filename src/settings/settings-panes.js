/* SETTINGS PANES - what each Settings section draws, fetched the first time
   Settings is opened (renderSetPane in 12c-settings-panes.js) and prefetched
   once the page is idle (_crewPrefetch). A classic script in the page's own
   scope, so it uses the page's helpers and state directly; nothing outside
   Settings calls into it. Moved here whole from 12c (audit: code splitting). */
/* THIS DEVICE, AND THE CONTROL THAT REVOKES THE REST.

   Two things were wrong here, and both were in the Security pane - the screen
   somebody opens when they think their account is compromised.

   The heading said "Active sessions - Devices currently signed in to your
   account" above a single row built from navigator.userAgent. There is no
   endpoint that enumerates an account's sessions, so that list was one row of
   local guesswork presented as an account-wide fact, and it can never show the
   session a worried person is actually looking for.

   And "Sign out of all other sessions" wrote a timestamp into localStorage and
   said "Signed out of all other sessions." Nothing was sent anywhere. The
   comment beside it admitted as much - "on a real backend this also revokes
   other tokens" - while /auth/logout {everywhere:true} has existed the whole
   time and revokes every refresh token on the account. A security control that
   reports success without acting is worse than no control: it ends the search
   for the one that works. */
function _activeSessionsHTML(){
  try{
    const live=!!(window.AMV_API && AMV_API.live && AMV_API.hasSession);
    return '<div class="ss2"><h3>'+escH(T('Where you are signed in'))+'</h3>'+
      '<div class="set-sub" style="margin-top:-2px;margin-bottom:12px">'+escH(T('Every browser and app signed in to your account. Sign one out if you do not recognise it - it stops working within a minute.'))+'</div>'+
      '<div id="sess-list" class="sess-list" aria-live="polite">'+(live?'<div class="set-sub">'+escH(T('Loading…'))+'</div>':'')+'</div>'+
      '<button class="btn bs" id="signout-others" style="margin-top:12px;font-size:var(--t-sm)"'+(live?'':' disabled')+'>'+escH(T('Sign out everywhere'))+'</button>'+
      '<div class="set-sub" style="margin-top:8px">'+escH(live
        ? T('Ends every session on your account, including this one. You will be asked to sign in again.')
        : T('Needs the AMV backend connected. Without it there are no server sessions to list or end.'))+'</div>'+
      '<div id="sess-msg" class="set-sub" role="status" aria-live="polite" style="margin-top:8px"></div>'+
    '</div>';
  }catch(e){ return ''; }
}
/* The list is the server's answer. A list it could not read says so; it is
   never shown as "only this device", which would be a reassuring lie. */
async function _loadSignIns(){
  const host=$('sess-list'); if(!host || !(window.AMV_API && AMV_API.live && AMV_API.hasSession)) return;
  const list=await AMV_API.sessions().catch(()=>null);
  if(!host.isConnected) return;
  if(!list || !Array.isArray(list.sessions)){
    host.innerHTML='<div class="set-sub">'+escH(T('AMV could not read your sign-ins just now.'))+' <button type="button" class="skill-link" id="sess-retry">'+escH(T('Try again'))+'</button></div>';
    on($('sess-retry'),'click',_loadSignIns); return;
  }
  const ago=ts=>{ const s=(Date.now()-ts)/1000; return s<120?T('active now'):s<3600?Math.round(s/60)+' '+T('min ago'):s<86400?Math.round(s/3600)+' '+T('h ago'):Math.round(s/86400)+' '+T('days ago'); };
  const day=ts=>{ try{ return new Date(ts).toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' }); }catch(e){ return ''; } };
  const where=c=>{ try{ return c ? new Intl.DisplayNames([document.documentElement.lang||'en'], { type:'region' }).of(c) : ''; }catch(e){ return c||''; } };
  const rows=list.sessions.map(x=>'<div class="sess-row'+(x.current?' sess-current':'')+'"><div class="sess-txt">'+
      '<div class="sess-name">'+escH(x.device||T('Unknown browser'))+(x.current?' <span class="sess-badge">'+escH(T('This device'))+'</span>':'')+'</div>'+
      '<div class="sess-meta">'+escH([where(x.country), T('signed in')+' '+day(x.created), x.current?'':ago(x.seen)].filter(Boolean).join(' · '))+'</div></div>'+
      (x.current?'':'<button type="button" class="btn bs sess-end" data-sess-end="'+escH(x.id)+'" data-sess-name="'+escH(x.device||T('Unknown browser'))+'">'+escH(T('Sign out'))+'</button>')+'</div>');
  host.innerHTML=(rows.join('')||'<div class="set-sub">'+escH(T('No sign-ins recorded yet. This device appears here the next time it renews its sign-in, within the hour.'))+'</div>')
    +(list.current?'':'<div class="set-sub" style="margin-top:8px">'+escH(T('This browser signed in before AMV kept this list; it appears here within the hour.'))+'</div>');
  host.querySelectorAll('[data-sess-end]').forEach(b=>on(b,'click',async()=>{
    b.disabled=true; b.textContent=T('Signing out…');
    const r=await AMV_API.endSession(b.getAttribute('data-sess-end'));
    const msg=$('sess-msg');
    if(r.ok){ if(msg) msg.textContent=T('Signed out')+' '+b.getAttribute('data-sess-name')+'. '+T('It stops working within a minute.'); _loadSignIns(); }
    else { b.disabled=false; b.textContent=T('Sign out'); if(msg) msg.textContent=r.error||T('That sign-in could not be ended. Try again.'); }
  }));
}
try{ window._loadSignIns=_loadSignIns; }catch(e){}
/* NOTIFICATIONS ON THIS DEVICE (src/worker/81-web-push.js). The switch is
   this device's subscription: on means this browser holds one and AMV has
   it; off means neither. Every refusal says what would change it - the
   browser's own permission, an iPhone that needs AMV on its Home Screen
   first, or a deployment that has not switched notifications on. */
async function _pushApi(path, body){
  const r = await AMV_API._fetch(path, body === undefined ? { method: 'GET' } : { method: 'POST', body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(_refusalText(d));
  return d;
}
function _pushKeyBytes(b64){
  const s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function _pushPrefInit(){
  const box = $('acct-push'), msg = $('acct-push-msg');
  if (!box) return;
  const say = (t) => { if (msg) msg.textContent = t; };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  const installed = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    say(ios && !installed ? T('On an iPhone, add AMV to your Home Screen first (Share, then Add to Home Screen), open it from there, and turn this on.') : T('This browser cannot show notifications from a website.'));
    return;
  }
  let st;
  try { st = await _pushApi('/v1/push'); } catch (e) { say(T('AMV could not reach the server to check. Try again in a moment.')); return; }
  if (!st.on) { say(T('Notifications are not switched on for this AMV yet.')); return; }
  let reg = null, sub = null;
  /* ready never settles when the browser would not register AMV's service
     worker (some private windows do that): asked for five seconds, then said. */
  try { reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 5000))]); if (reg) sub = await reg.pushManager.getSubscription(); } catch (e) {}
  if (!reg) { say(T('This browser did not let AMV set up notifications here. Reload the page, or try outside a private window.')); return; }
  box.checked = !!sub && Notification.permission === 'granted';
  box.disabled = false;
  if (Notification.permission === 'denied') say(T('Notifications for AMV are blocked in this browser’s settings. Allow them there, then turn this on.'));
  on(box, 'change', async function(){
    const want = box.checked; box.disabled = true;
    try {
      if (want) {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { box.checked = false; say(T('The browser was not given permission, so nothing changed. You can allow notifications for AMV in its settings.')); return; }
        sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _pushKeyBytes(st.key) });
        await _pushApi('/v1/push/subscribe', { subscription: sub.toJSON(), label: (navigator.userAgentData && navigator.userAgentData.platform) || '', lang: (typeof _amvLangTag === 'function' ? _amvLangTag() : '') });
        const t = await _pushApi('/v1/push/test', {}).catch(() => null);
        say(t && t.sent ? T('On. A test notification is on its way to this device.') : T('On. AMV will notify this device when a job has a result or needs you.'));
      } else {
        const endpoint = sub && sub.endpoint;
        if (sub) { try { await sub.unsubscribe(); } catch (e) {} }
        sub = null;
        if (endpoint) await _pushApi('/v1/push/unsubscribe', { endpoint });
        say(T('Off. This device will not be notified.'));
      }
    } catch (e) {
      box.checked = !want;
      say(T('That did not work: {0}. Nothing changed.').replace('{0}', (e && e.message) || ''));
    } finally { box.disabled = false; }
  });
}

/* Passkeys, the authenticator app and recovery codes are managed by
   security.js, fetched when this pane opens - the page carries only this. */
let _secP=null;
function _loadSecurityFactors(){
  if(!$('sec-mfa')) return;
  if(!_secP) _secP=new Promise(res=>{
    const sc=document.createElement('script'); sc.src='security.js';
    const fail=()=>{ _secP=null; sc.remove(); res(false); };
    sc.onload=()=>typeof window._secRenderNow==='function'?res(true):fail();
    sc.onerror=fail;
    document.head.appendChild(sc);
  });
  _secP.then(ok=>{
    const h=$('sec-mfa'); if(!h) return;
    if(ok) return window._secRenderNow();
    h.innerHTML='<div class="set-sub">'+escH(T('That could not be loaded. Check your connection and try again.'))+'</div>';
  });
}

/* Append a merged-in pane as a second section of the one it now lives on.

   Each renderer writes its own title, so the section keeps the heading it
   always had - the merge changes where you find it, not what it says. The
   anchor id is what a retired deep link scrolls to. */
function _setAppendSection(pane, id, host, fold){
  if(!pane) return;
  const wrap=document.createElement('div');
  wrap.className='set-merged';
  wrap.id='set-sec-'+id;
  /* `host` lets a pane say WHERE its merged half belongs. Without it the only
     answer was "at the end", which on Billing put usage and spending below the
     payment-security block. Falls back to the pane, so every existing caller
     keeps the behaviour it had. */
  /* `fold` - a label - folds the section behind one line that opens it. "WAY
     TOO MUCH": a Settings section should fit on a screen, and its secondary
     parts (Team, About, Skills, API keys, Security) are there for the person
     who goes looking, one tap away, rather than stacked under everybody. A
     link straight to one of them opens it (see _wantSection). */
  let target = wrap;
  if(fold){
    const d=document.createElement('details');
    d.className='set-fold';
    d.innerHTML='<summary class="set-fold-s">'+escH(T(fold))+'</summary>';
    d.appendChild(wrap);
    target = d;
  }
  ((host && host.appendChild) ? host : pane).appendChild(target);
  try{ _renderSetPaneInner(id, wrap); }catch(e){}
}
try{ window._setAppendSection=_setAppendSection; }catch(e){}

/* `only` and `into` exist so a MERGED pane can render its second half without
   any of these branches being extracted into functions. The dispatcher is
   called again with the retired id and a wrapper element, and the branch that
   already knew how to draw that pane draws it there instead.

   Extracting them was the alternative and it is the worse one: five long inline
   branches lifted into functions is five chances to change behaviour while
   claiming to move it, on the surface that holds someone's password, their
   card and their spending limits. */
function _renderSetPaneInner(only, into){
  const pane=into||$('set-pane'); if(!pane) return;
  /* A retired id renders the pane it was merged into, and the pane scrolls to
     the half that was asked for. Resolved HERE rather than by rewriting
     S.settingsPane, so a deep link that arrives as `security` still highlights
     "Privacy & security" in the nav and still reads as the thing it asked for
     in the picker on a phone. */
  const _asked=only||S.settingsPane;
  let sp=only||_setPaneFor(_asked);
  const _wantSection=only?'':_setSectionFor(_asked);
  /* Hard gate: admin/operator panes are OWNER-ONLY. If a non-owner reaches one
     (forced state, stale pane), refuse and fall back to Account.

     The list is READ OFF ADMIN_SET_SECTIONS rather than typed out again. It
     was typed out again, and the two copies had already drifted: `widget` was
     added to the sections and never to the gate, so the pane that configures
     the embed somebody puts on their own website rendered in full for any
     account that reached it. A gate maintained by hand beside the list it is
     gating is a gate that is one addition away from being wrong. */
  const _ADMIN_PANES=ADMIN_SET_SECTIONS.map(s=>s.id).filter(Boolean);
  if(_ADMIN_PANES.indexOf(sp)>=0 && !isAdmin()){ S.settingsPane='account'; sp='account'; }
  /* An id nothing renders used to leave the content column EMPTY - a Settings
     screen with a nav, a picker reading "Account", and nothing beside it. The
     picker already falls back to the first section when it cannot place an id;
     the pane now falls back to the same one, so the two cannot disagree. */
  if(_KNOWN_SET_PANES.indexOf(sp)<0){ S.settingsPane='account'; sp='account'; }
  if(_wantSection){
    setTimeout(()=>{ try{
      const t=document.getElementById('set-sec-'+_wantSection);
      if(t){ const d=t.closest('details'); if(d) d.open=true; }
      if(t) t.scrollIntoView({ block:'start', behavior:'auto' });
    }catch(e){} }, 60);
  }
  // Billing renders its full content INSIDE the settings pane (stays in Settings).
  if(sp==='billing'){
    if(typeof renderBillingView==='function'){ renderBillingView(pane); }
    /* The whole Usage screen used to be appended here; billing has its own
       short Usage card now with a way to the full screen (Nov 23). */
    /* Spending was appended here and is its own section now - see SET_SECTIONS.
       Appending it as well would put the same three limit fields on two
       screens, and the one that is not the real one is the one somebody edits
       and then cannot find again. */
    return;
  }
  // Projects lives in Settings now - render its grid inside the pane.
  if(sp==='projects'){
    pane.innerHTML=
      '<h2 class="set-title">Projects</h2>'+
      '<div class="set-sub">Group related chats, builds, and research into a project so AMV keeps the full context together.</div>'+
      '<button class="btn bp" id="ws-new" style="align-self:flex-start;margin-bottom:16px">+ New project</button>'+
      '<div class="wg" id="ws-grid"></div>';
    on($('ws-new'),'click',createWorkspaceModal);
    try{ renderWsGrid(); }catch(e){}
    return;
  }
  const pfp=S.user&&S.user.email?loadStr('amv_pfp_'+S.user.email):'';
  const pfpHtml=_avatarInner(S.user&&S.user.email);

  if(sp==='account'){
    pane.innerHTML=
      '<h2 class="set-title">Account</h2>'+
      '<div class="set-sub">Manage your profile and account information.</div>'+
      '<div class="ss2">'+
        '<div style="display:flex;align-items:center;gap:17px;margin-bottom:16px;flex-wrap:wrap">'+
          '<div style="position:relative;flex-shrink:0">'+
            '<div id="pfp-c" style="width:72px;height:72px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:background-color .2s,border-color .2s,color .2s,box-shadow .2s,transform .2s,opacity .2s">'+pfpHtml+'</div>'+
            '<div id="pfp-edit" style="position:absolute;bottom:0;right:0;width:22px;height:22px;background:var(--s2);border:1px solid var(--bd);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:var(--t-xs);transition:background-color .12s,border-color .12s,color .12s,box-shadow .12s,transform .12s,opacity .12s">&#x270F;</div>'+
            '<input type="file" id="pfp-fi" accept="image/*" style="display:none">'+
          '</div>'+
          '<div><div style="font-size:var(--t-lg);font-weight:700;letter-spacing:-.3px">'+escH(S.user&&S.user.name?S.user.name:'Guest')+'</div>'+
          '<div style="font-size:var(--t-sm);color:var(--mu);margin-top:2px">'+escH(S.user&&S.user.email?S.user.email:'')+'</div>'+
          '<span class="badge '+(S.user&&S.user.provider==='google'?'bb':'bg3')+'" style="margin-top:7px">'+(S.user&&S.user.provider==='google'?'Google Account':'Email Account')+'</span></div>'+
        '</div>'+
        '<div class="sf">'+
          '<div><label class="lbl" for="s-name">Full name</label><input type="text" id="s-name" value="'+escH(S.user&&S.user.name?S.user.name:'')+'" placeholder="Your name"></div>'+
          '<div><label class="lbl" for="s-nick">What should AMV call you?</label><input type="text" id="s-nick" value="'+escH(loadStr('amv_nickname')||'')+'" placeholder="Nickname"></div>'+
          '<div><label class="lbl">What best describes your work?</label>'+
            '<select id="s-work" class="sel" aria-label="What best describes your work">'+
              ['','Software \u0026 engineering','Design \u0026 creative','Marketing \u0026 content','Sales \u0026 business','Research \u0026 academia','Operations \u0026 admin','Finance','Founder \u2044 entrepreneur','Student','Other'].map(o=>{
                const cur=(loadStr('amv_work')||'');
                return '<option value="'+escH(o)+'"'+(o===cur?' selected':'')+'>'+(o||'Select\u2026')+'</option>';
              }).join('')+
            '</select>'+
          '</div>'+
          '<div><label class="lbl" for="s-pers">'+escH(T('Personality'))+'</label>'+
            '<select id="s-pers" class="sel">'+PERSONALITIES.map(([k,l,d])=>'<option value="'+k+'"'+(k===_personality()?' selected':'')+'>'+escH(T(l))+' - '+escH(T(d))+'</option>').join('')+'</select>'+
            '<div class="lbl-help">'+escH(T('How AMV talks to you in every chat and agent. A tone you set for one chat still wins there.'))+'</div>'+
          '</div>'+
          '<div><label class="lbl" for="s-instr">Instructions for AMV</label>'+
            '<textarea id="s-instr" rows="3" placeholder="e.g. I primarily code in Python (not a beginner). Keep answers concise and skip the preamble." style="width:100%;resize:vertical;min-height:70px">'+escH(loadStr('amv_instructions')||'')+'</textarea>'+
            '<div class="lbl-help">AMV keeps these in mind across every chat and agent. Great for your role, preferences, and how you like answers.</div>'+
          '</div>'+
          '<div id="acct-msg" style="display:none;font-size:var(--t-sm);padding:7px 11px;border-radius:var(--r-sm)"></div>'+
          '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
            '<button class="btn bp" id="save-profile" style="font-size:var(--t-sm)">Save changes</button>'+
            '<button class="btn bs" id="rm-pfp" style="font-size:var(--t-sm);'+(pfp?'':'opacity:.4;pointer-events:none')+'">Remove photo</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      /* Email me when AMV is done (41-done-mail.js). Here so that a "Not now"
         is never final, and a "yes" can always be taken back. */
      '<div class="ss2"><h3>Notifications</h3>'+
        '<div class="prv-pref"><div><div class="prv-pref-t">Email me when AMV is done</div>'+
          '<div class="prv-pref-s">'+((S.user&&S.user.email)
            ? escH(T('When an answer takes a while and you have gone to do something else, AMV emails {email} as soon as it is ready. Only then - never about something you watched finish.')).replace('{email}', escH(S.user.email))
            : escH(T('When an answer takes a while and you have gone to do something else, AMV emails your account address as soon as it is ready. Only then - never about something you watched finish.')))+'</div></div>'+
          '<label class="sw"><input type="checkbox" id="acct-done-mail" aria-label="Email me when AMV is done" '+(loadStr('amv_done_mail')==='1'?'checked':'')+'><span class="sw-sl"></span></label></div>'+
        '<div class="set-sub" id="acct-done-msg" role="status" aria-live="polite" style="margin:6px 0 0"></div>'+
        ((window.AMV_API && AMV_API.live && AMV_API.hasSession) ?
        '<div class="prv-pref" style="margin-top:12px"><div><div class="prv-pref-t">'+escH(T('Notify this device'))+'</div>'+
          '<div class="prv-pref-s">'+escH(T('When a background job has a result or is waiting for your OK, this phone or computer shows a notification - even with AMV closed. It names the job, never what it found.'))+'</div></div>'+
          '<label class="sw"><input type="checkbox" id="acct-push" aria-label="'+escH(T('Notify this device'))+'" disabled><span class="sw-sl"></span></label></div>'+
        '<div class="set-sub" id="acct-push-msg" role="status" aria-live="polite" style="margin:6px 0 0"></div>' : '')+
      '</div>'+
      ((window.AMV_API && AMV_API.live && AMV_API.hasSession) ? '<div id="sec-mfa" aria-live="polite"><div class="ss2"><h3>'+escH(T('Passkeys'))+'</h3><div class="set-sub">'+escH(T('Loading…'))+'</div></div></div>' : '')+
      _activeSessionsHTML();
    _pushPrefInit();
    on($('acct-done-mail'),'change',async function(){
      const box=this, msg=$('acct-done-msg'), want=box.checked;
      box.disabled=true;
      const r=await _doneMailSet(want);
      box.disabled=false;
      if(!r.ok){ box.checked=false; if(msg) msg.textContent=r.why; return; }
      if(msg) msg.textContent=want?'On. AMV will email you when long work finishes while you are away.':'Off. AMV will not email you about finished answers.';
    });
    on($('pfp-c'),'click',()=>$('pfp-fi')?.click());
    on($('pfp-edit'),'click',()=>$('pfp-fi')?.click());
    on($('pfp-fi'),'change',function(){
      const file=this.files[0]; if(!file) return;
      if(file.size>5*1024*1024){toast('Image must be under 5MB','error');return;}
      const r=new FileReader();
      r.onload=e=>{const b=e.target.result;if(S.user&&S.user.email)saveStr('amv_pfp_'+S.user.email,b);updateSbUser();renderSetPane();toast('Photo updated','success');};
      r.readAsDataURL(file); this.value='';
    });
    on($('rm-pfp'),'click',()=>{if(S.user&&S.user.email)localStorage.removeItem('amv_pfp_'+S.user.email);updateSbUser();renderSetPane();});
    /* Straight to the one that already works.

       This was the second control for the same thing, and the fake one:
       _actSignOutEverywhere in 28-activity.js has always confirmed, called
       /auth/logout {everywhere:true}, checked the answer and signed the user
       out - while this button wrote a timestamp into localStorage and said
       "Signed out of all other sessions." Writing a second correct
       implementation here would leave two to keep in step; there is one. */
    _loadSignIns();
    _loadSecurityFactors();
    on($('signout-others'),'click',()=>{
      const msg=$('sess-msg');
      if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)){
        if(msg) msg.textContent='Not connected to the AMV backend, so there are no server sessions to end. Nothing was changed.';
        return;
      }
      _actSignOutEverywhere('sess-msg');
    });
    on($('save-profile'),'click',async()=>{
      const nm=$('s-name')?.value.trim();
      const msg=$('acct-msg');
      function sm(t,ok){if(msg){msg.textContent=t;msg.style.display='block';msg.style.background=ok?'rgba(35,209,139,.07)':'rgba(255,95,87,.07)';msg.style.border='1px solid '+(ok?'rgba(35,209,139,.2)':'rgba(255,95,87,.2)');msg.style.color=ok?'var(--green)':'var(--red)';}}
      if(!nm){sm('Name cannot be empty.',false);return;}
      // Persist the profile fields - these actually feed the assistant (see _profileContext).
      try{
        saveStr('amv_nickname', ($('s-nick')?.value||'').trim().slice(0,60));
        saveStr('amv_work', ($('s-work')?.value||''));
        saveStr('amv_instructions', ($('s-instr')?.value||'').trim().slice(0,2000));
        saveStr('amv_personality', String($('s-pers')?.value||'').slice(0,20));
        /* STAMPED AND PUSHED, because these three keys are the personalization
           that goes into every conversation and they were staying on this
           device. The sync had a `profile` slot at both ends and nothing ever
           filled it, so signing in elsewhere meant AMV had forgotten your name
           and every standing instruction. The timestamp is what lets two
           devices with different instructions be resolved by a rule rather
           than by whichever pull landed last. */
        saveStr('amv_profile_at', String(Date.now()));
        try{ if(typeof AMVSync!=='undefined' && AMVSync.enabled()) AMVSync.push(); }catch(_e){}
      }catch(e){}
      if(S.user){
        const key=acctKey(S.user.email);
        const raw=localStorage.getItem(key);
        if(raw){try{const a=JSON.parse(raw);a.name=nm;a.ini=nm.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2);localStorage.setItem(key,JSON.stringify(a));}catch{}}
        S.user.name=nm; S.user.ini=nm.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2); store('amv_user',S.user); updateSbUser();
        sm('Changes saved!',true);
      }
    });
    /* Projects is added here, not by Team: a merged section renders with
       `only` set, so Team's own "if(!only) add Projects" never runs once Team
       is itself a part of Account - and the shared projects vanished. */
    if(!only){
      _setAppendSection(pane, 'teamset', null, 'Team');
      _setAppendSection(pane, 'projects', null, 'Shared projects');
      _setAppendSection(pane, 'about', null, 'About AMV');
    }

  } else if(sp==='security'){
    pane.innerHTML=
      '<h2 class="set-title">Security</h2>'+
      '<div class="set-sub">Manage your password and account security.</div>'+
      (S.user&&S.user.provider==='google'?
        '<div class="ss2"><p style="font-size:var(--t-base);color:var(--mu)">Signed in with Google. Manage your password at <a href="https://myaccount.google.com" target="_blank" rel="noopener noreferrer" style="color:var(--accent-txt)">myaccount.google.com</a>.</p></div>':
        '<div class="ss2"><h3>Password</h3>'+
          '<div class="br2"><div><div class="opt-name">Reset your password</div><div class="opt-desc">'+((S.user&&S.user.email)
            ? escH(T('We\u2019ll send a secure reset link to {email}. No need to remember your current one.')).replace('{email}', escH(S.user.email))
            : escH(T('We\u2019ll send a secure reset link to your email. No need to remember your current one.')))+'</div></div>'+
          '<button class="btn bp" id="reset-pw-btn" style="font-size:var(--t-sm);white-space:nowrap">Send reset link</button></div>'+
          '<div id="pw-msg" style="display:none;font-size:var(--t-sm);padding:9px 12px;border-radius:var(--r-sm);margin-top:12px"></div>'+
        '</div>')+
      /* Was a hardcoded "This browser - Active now" row wired to nothing. It is
         now the account's real event log; see 28-activity.js. */
      '<div class="ss2"><h3>Account activity</h3>'+
        /* Naming the screen the control is on. "Sign out everywhere" lives in
           Account, and telling somebody to do it without saying where is how a
           worried person ends up hunting for it. */
        '<div class="set-hint">'+escH(T('Where and when this account has been used. If something here was not you: send yourself a reset link above, then use {0} under {1} to end every session.'))
          .replace('{0}', '<b>'+escH(T('Sign out everywhere'))+'</b>').replace('{1}', escH(T('Settings \u2192 Account')))+'</div>'+
        '<div id="act-block"></div>'+
      '</div>'+
      '<div class="ss2"><h3>This device</h3>'+
        '<div class="br2"><div><div style="font-size:var(--t-base);font-weight:500">Signed in on this browser</div><div style="font-size:var(--t-xs);color:var(--mu);margin-top:2px">Signing out here leaves your other devices signed in.</div></div></div>'+
        '<button class="btn bs" style="font-size:var(--t-sm);margin-top:12px" data-dact="signOut">Sign out of this device</button>'+
      '</div>';
    _renderActivityBlock(document.getElementById('act-block'));
    on($('reset-pw-btn'),'click',async()=>{
      const email=(S.user&&S.user.email)||'';
      const msg=$('pw-msg');
      const sm=(t,ok)=>{if(msg){msg.textContent=t;msg.style.display='block';msg.style.background=ok?'rgba(35,209,139,.07)':'rgba(255,95,87,.07)';msg.style.border='1px solid '+(ok?'rgba(35,209,139,.2)':'rgba(255,95,87,.2)');msg.style.color=ok?'var(--green)':'var(--red)';}};
      const btn=$('reset-pw-btn'); if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
      /* `if(ok)` on the RESULT OBJECT was true for every outcome this function
         has - including {ok:false} from the catch and from having no backend at
         all - so the failure message below was unreachable and the button said
         "check your inbox" whatever happened. Somebody locked out of their
         account waits for an email that was never sent. Three real outcomes,
         told apart. */
      const res=await sendPasswordReset(email) || { ok:false, sent:false };
      if(btn){ btn.disabled=false; btn.textContent='Send reset link'; }
      if(res.ok && res.sent){
        sm('Reset link sent to '+email+'. Check your inbox and follow the link to set a new password.',true);
      } else if(res.ok){
        /* The server accepted it and sent nothing, which is what it does with no
           email provider configured. Saying "check your inbox" here is the same
           lie with extra steps. */
        sm('No email was sent - this deployment has no email provider connected, so AMV has no way to deliver the link. Nothing is wrong with your account.',false);
      } else {
        sm('Couldn\u2019t send the reset email'+(res.error?' ('+res.error+')':'')+'. Nothing was sent - please try again.',false);
      }
    });

  } else if(sp==='privacy'){
    pane.innerHTML=
      '<h2 class="set-title">Privacy</h2>'+
      '<div class="set-sub">AMV believes in transparent data practices. Here\u2019s how your information is handled, and the controls you have over it.</div>'+
      // Intro: protect / use
      '<div class="ss2"><div class="prv-cards">'+
        '<div class="prv-card"><div class="prv-card-h"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>How we protect your data</div>'+
          '<p>Everything moves over encrypted HTTPS. Your conversations are tied to your account, payment cards never touch our servers, and usage limits are enforced server-side so they can\u2019t be bypassed.</p></div>'+
        '<div class="prv-card"><div class="prv-card-h"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg>How we use your data</div>'+
          '<p>We use your data to run the product and, only if you allow it, to improve our AI. Analytics are opt-in and off by default. We never sell your data.</p></div>'+
      '</div></div>'+
      // Preferences
      /* No "help improve our AI models" switch: it saved a value nothing read,
         and AMV does not train on private chats (Privacy Policy, section 4),
         so it offered a choice that did not exist. */
      '<div class="ss2"><h3>Preferences</h3>'+
        '<div class="prv-pref"><div><div class="prv-pref-t">Location metadata</div><div class="prv-pref-s">Allow AMV to use coarse location (city/region) to improve results like local search and time-aware answers.</div></div><label class="sw"><input type="checkbox" id="prv-location" '+(loadStr('amv_location_opt')==='1'?'checked':'')+'><span class="sw-sl"></span></label></div>'+
        '<div class="prv-pref"><div><div class="prv-pref-t">Usage analytics</div><div class="prv-pref-s">Anonymous product analytics that help improve AMV. Never sold or shared.</div></div><label class="sw"><input type="checkbox" id="prv-analytics" '+(loadStr('amv_analytics_opt_out')==='1'?'':'checked')+'><span class="sw-sl"></span></label></div>'+
      '</div>'+
      // Your data
      '<div class="ss2"><h3>Your data</h3>'+
        '<div class="prv-data-row"><div><div class="prv-pref-t">Export data</div><div class="prv-pref-s">Download everything AMV has for you as a JSON file.</div></div><button class="btn bs" id="prv-export" style="font-size:var(--t-sm)">Export data</button></div>'+
        '<div class="prv-data-row"><div><div class="prv-pref-t">Shared chats</div><div class="prv-pref-s">Manage conversations you\u2019ve shared with a public link.</div></div><button class="btn bs" id="prv-shared" style="font-size:var(--t-sm)">Manage</button></div>'+
        '<div class="prv-data-row"><div><div class="prv-pref-t">Memory preferences</div><div class="prv-pref-s">Control what AMV remembers about you across chats.</div></div><button class="btn bs" id="prv-memory" style="font-size:var(--t-sm)">Open memory</button></div>'+
        (AMV_API.hasSession?'<div class="prv-data-row"><div><div class="prv-pref-t">Keep conversations</div><div class="prv-pref-s" id="prv-ret-s">Older ones are deleted from AMV and from this device. Anything you are still using is never old.</div></div>'+
          '<select class="inp" id="prv-ret" style="width:auto;font-size:var(--t-sm)" disabled><option value="">Forever</option><option value="365">1 year</option><option value="180">6 months</option><option value="90">90 days</option><option value="30">30 days</option></select></div>':'')+
        '<div class="prv-data-row"><div><div class="prv-pref-t">Clear all chats</div><div class="prv-pref-s">Permanently delete your conversation history.</div></div><button class="btn bs" id="prv-clrchats" style="font-size:var(--t-sm)">Clear chats</button></div>'+
        '<div class="prv-data-row"><div><div class="prv-pref-t" style="color:var(--red-txt)">Delete all data</div><div class="prv-pref-s">Remove everything AMV has stored for you. This can\u2019t be undone.</div></div><button class="btn bd2" id="prv-clrall" style="font-size:var(--t-sm)">Delete everything</button></div>'+
      '</div>'+
      (isAdmin()?(
      '<div class="ss2"><h3>Analytics provider <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(operator setup)</span></h3>'+
        '<div style="font-size:var(--t-sm);color:var(--mu);line-height:1.7;margin-bottom:12px">Connect Google Analytics (GA4) or Plausible to measure real traffic. Enter your GA4 Measurement ID (starts with <code>G-</code>) or your Plausible site domain. Analytics only fire for visitors who accept analytics cookies.</div>'+
        '<div style="display:flex;gap:8px;align-items:center"><input class="inp" id="prv-ga-id" placeholder="G-XXXXXXX  or  yoursite.com" value="'+escH(_analyticsId())+'" style="flex:1"><button class="btn bp" id="prv-ga-save" style="font-size:var(--t-sm)">Save</button></div>'+
        /* "configured" was the whole status, and configured is not the same as
           running. The provider script is a third-party <script> and this page's
           Content-Security-Policy script-src allows neither of the two hosts, so
           an ID that is saved and consented to still measures nothing. Saying
           "configured" over that is the same failure as any other control that
           reports an outcome it did not check. */
        '<div style="font-size:var(--t-xs);color:var(--mu);margin-top:8px">Status: '+(_analyticsId()?('<span style="color:var(--grn-txt)">configured</span> \u00b7 '+(/^G-/i.test(_analyticsId())?'Google Analytics':'Plausible')):'<span style="color:var(--mu)">not set</span>')+'</div>'+
        (_analyticsId()&&_analyticsBlocked()
          ? '<div class="wg-capwarn on" style="margin-top:8px">Saved, but <b>nothing is being measured</b>. The provider\u2019s script was blocked before it loaded - this page\u2019s Content-Security-Policy does not list '+
            (/^G-/i.test(_analyticsId())?'googletagmanager.com':'plausible.io')+
            ', and an ad-blocker would do the same. Add the host to <code>script-src</code> (and its beacon host to <code>connect-src</code>) in index.html to switch it on, or leave analytics off.</div>'
          : '')+
      '</div>'+
      (function(){ const f=_funnel(); const step=(l,n)=>'<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0"><span style="font-size:var(--t-sm);color:var(--mu)">'+l+'</span><span style="font-size:var(--t-md);font-weight:600">'+(n||0)+'</span></div>';
        const conv=(a,b)=>b?Math.round((a/b)*100):0;
        return '<div class="ss2"><h3>Conversion funnel <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(this device)</span></h3>'+
          '<div style="font-size:var(--t-xs);color:var(--mu);margin-bottom:8px">First-party aggregate counts, tracked with no third party. Full cross-device funnels live in your analytics provider.</div>'+
          step('Landing visits', f.visit)+
          '<div style="height:1px;background:var(--bd)"></div>'+
          step('Sign-ups'+(f.visit?' \u00b7 '+conv(f.signup,f.visit)+'%':''), f.signup)+
          '<div style="height:1px;background:var(--bd)"></div>'+
          step('First message'+(f.signup?' \u00b7 '+conv(f.first_msg,f.signup)+'%':''), f.first_msg)+
          '<div style="height:1px;background:var(--bd)"></div>'+
          step('Upgrades'+(f.first_msg?' \u00b7 '+conv(f.upgrade,f.first_msg)+'%':''), f.upgrade)+
        '</div>';
      })()
      ):'');
    on($('prv-clrchats'),'click',()=>{
      const btn=$('prv-clrchats');
      if(btn.dataset.c!=='yes'){btn.textContent='Confirm clear';btn.dataset.c='yes';btn.style.color='var(--red)';setTimeout(()=>{btn.textContent='Clear all chats';btn.dataset.c='';btn.style.color='';},3000);return;}
      S.convs=[newConvObj()];S.cur=S.convs[0].id;_autoSave();renderHist();btn.textContent='Done!';btn.style.color='var(--green)';setTimeout(()=>renderSetPane(),1200);
    });
    on($('prv-export'),'click',()=>_exportUserData());
    /* How long conversations are kept (the server enforces it; 34a-retention.js). */
    if($('prv-ret')){
      const sel=$('prv-ret'), sub=$('prv-ret-s');
      const show=(d)=>{ if(!d) return; sel.value=d.mine?String(d.mine):''; sel.disabled=false;
        if(d.by==='team'&&d.team&&sub) sub.textContent=T('Your team keeps conversations for {n} days, so that applies whatever you choose here.').replace('{n}',d.team); };
      AMV_API._fetch('/account/retention',{method:'POST',body:'{}'}).then(r=>r.json()).then(show).catch(()=>{ if(sub) sub.textContent=T('Could not load this setting. Check your connection and open this page again.'); });
      on(sel,'change',async()=>{
        sel.disabled=true;
        try{
          const r=await AMV_API._fetch('/account/retention',{method:'POST',body:JSON.stringify({days:sel.value?+sel.value:null})});
          const d=await r.json().catch(()=>null);
          if(!r.ok||!d||!d.ok) throw new Error((d&&d.error)||T('Could not save this setting.'));
          show(d); AMV_API.retention=d.days?{days:d.days,by:d.by}:null;
          const n=_retentionTrimLocal(AMV_API.retention);
          toast(d.days?T('Conversations older than {n} days will be deleted.').replace('{n}',d.days)+(n?' '+T('{n} removed from this device.').replace('{n}',n):''):T('Conversations are kept until you delete them.'),'success');
        }catch(e){ toast((e&&e.message)||T('Could not save this setting.'),'error'); }
        sel.disabled=false;
      });
    }
    on($('prv-ga-save'),'click',()=>{
      const v=($('prv-ga-id')?$('prv-ga-id').value:'').trim();
      _analyticsSetId(v);
      if(v){ _analyticsLoaded=false; try{ if(_analyticsAllowed()) _analyticsInit(); }catch(e){} toast('Analytics ID saved','success'); }
      else toast('Analytics disabled','info');
      renderSetPane();
    });
    on($('prv-analytics'),'change',function(){ saveStr('amv_analytics_opt_out', this.checked?'':'1'); toast(this.checked?'Analytics on - thank you for helping improve AMV':'Analytics off - no product data will be collected','success'); });
    on($('prv-location'),'change',function(){ saveStr('amv_location_opt', this.checked?'1':'0'); toast(this.checked?'Location metadata on':'Location metadata off','info',2200); });
    on($('prv-shared'),'click',()=>{ openSharedChatsManager(); });
    on($('prv-memory'),'click',()=>{ S.settingsPane=null; setTab('memory'); });
    on($('prv-clrall'),'click',()=>{
      _confirmDeleteAccount();
    });

    if(!only){ _setAppendSection(pane, 'capabilities'); _setAppendSection(pane, 'security', null, 'Password & security'); }
    /* Where AMV's browser is signed in, kept on this device (web-live.js). */
    if(AMV_API.hasSession){
      const wj = document.createElement('div'); wj.className = 'ss2'; wj.id = 'wj-sites'; pane.appendChild(wj);
      _webLiveLoad().then(ok => { if(ok && wj.isConnected) window._webJarPane(wj); else wj.remove(); });
    }
  } else if(sp==='appearance'){
    const themeNow=_themePref();
    const thBtn=(id,label,svg)=>'<button class="fs-opt'+(themeNow===id?' on':'')+'" role="radio" aria-checked="'+(themeNow===id)+'" data-theme-opt="'+id+'"><span class="fs-pv" aria-hidden="true">'+svg+'</span><span class="fs-lbl">'+escH(T(label))+'</span></button>';
    const SVG_ATTR=' width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
    const curFs=parseInt(loadStr('amv_fs')||'14',10);
    const fsBtn=(px,label)=>'<button class="fs-opt'+(curFs===px?' on':'')+'" data-fs="'+px+'"><span class="fs-pv" style="font-size:'+(px+1)+'px">Aa</span><span class="fs-lbl">'+label+'</span></button>';
    pane.innerHTML=
      '<h2 class="set-title">Appearance</h2>'+
      '<div class="set-sub">Customize how AMV.AI looks and feels. Changes apply instantly across the whole app.</div>'+
      '<div class="ss2"><h3>Theme</h3>'+
        '<div class="opt-desc" style="margin-bottom:14px">'+escH(T('System follows your device, and changes when it does.'))+'</div>'+
        '<div class="fs-row" role="radiogroup" aria-label="'+escH(T('Theme'))+'">'+
          thBtn('light','Light','<svg'+SVG_ATTR+'><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>')+
          thBtn('dark','Dark','<svg'+SVG_ATTR+'><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>')+
          thBtn('system','System','<svg'+SVG_ATTR+'><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>')+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>Accent color</h3>'+
        '<div class="opt-desc" style="margin-bottom:12px">Pick the accent used across buttons, highlights, and the AMV mark.</div>'+
        '<div class="accent-picker">'+
          ACCENT_THEMES.map(a=>{
            const cur=(loadStr('amv_accent')||'')===a.id;
            return '<button class="accent-sw'+(cur?' on':'')+'" data-accent="'+a.id+'" title="'+a.name+'" style="background:'+a.dot+'"></button>';
          }).join('')+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>Font size</h3>'+
        '<div class="opt-desc" style="margin-bottom:14px">Scales the text everywhere so it\u2019s comfortable for you.</div>'+
        '<div class="fs-row">'+fsBtn(13,'Small')+fsBtn(14,'Default')+fsBtn(16,'Large')+fsBtn(18,'Largest')+'</div>'+
      '</div>'+
      '<div class="ss2"><h3>Motion</h3>'+
        '<div class="br2"><div><div class="opt-name">Reduce animation</div><div class="opt-desc">Minimize motion in streaming responses and interface elements.</div></div>'+
          '<label class="sw"><input type="checkbox" id="motion-sw" '+(loadStr('amv_reduce_motion')==='1'?'checked':'')+'><span class="sw-sl"></span></label>'+
        '</div>'+
      '</div>'+
      /* THE CHIME SAID IT WAS MUTEABLE AND NOTHING COULD MUTE IT.
         _playDoneChime checks `amv_mute_chime === '1'` and its own comment
         calls the sound "respectful - muteable", but no screen anywhere ever
         wrote that key, so the check could never be true. A sound the person
         cannot switch off is not respectful, and the code claiming otherwise
         is the reason nobody noticed. Here is the switch. */
      '<div class="ss2"><h3>Sound</h3>'+
        '<div class="br2"><div><div class="opt-name">Completion chime</div><div class="opt-desc">A soft two-note sound when a long reply finishes, or when one finishes while you are in another tab.</div></div>'+
          '<label class="sw"><input type="checkbox" id="chime-sw" '+(loadStr('amv_mute_chime')==='1'?'':'checked')+'><span class="sw-sl"></span></label>'+
        '</div>'+
        /* Read-aloud already read `amv_voice_rate` and nothing could write it,
           so every voice was locked to 1.0x. Speaking speed is the setting
           people using read-aloud change first. */
        /* `for` on a real <label>, not a styled div. A select whose only
           visible name is a sibling div has no accessible name at all - a
           screen reader announces it as "combo box", and the mobile sweep is
           right to fail on it. */
        '<div class="br2" style="margin-top:12px"><div><label class="opt-name" for="voice-rate-sel">Read-aloud speed</label><div class="opt-desc" id="voice-rate-desc">How fast AMV speaks when you use read-aloud.</div></div>'+
          '<select class="sel" id="voice-rate-sel" aria-describedby="voice-rate-desc" style="max-width:150px">'+
            [['0.75','Slower'],['1','Normal'],['1.25','Faster'],['1.5','Fastest']]
              .map(o=>'<option value="'+o[0]+'"'+((loadStr('amv_voice_rate')||'1')===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+
          '</select>'+
        '</div>'+
      '</div>';
    on($('motion-sw'),'change',function(){ saveStr('amv_reduce_motion',this.checked?'1':'0'); _applyReduceMotion(); toast(this.checked?'Reduced motion on':'Reduced motion off','info',2000); });
    /* Checked means the chime is ON, so the stored key is the inverse - it is
       named for muting because that is what the player already reads. */
    on($('chime-sw'),'change',function(){
      saveStr('amv_mute_chime',this.checked?'0':'1');
      if(this.checked){ try{ _playDoneChime(); }catch(e){} }
      toast(this.checked?'Completion chime on':'Completion chime off','info',2000);
    });
    on($('voice-rate-sel'),'change',function(){
      saveStr('amv_voice_rate', this.value);
      /* Spoken back at the new speed, because a number in a dropdown means
         nothing until you hear it. */
      try{ if(typeof AMVSpeech!=='undefined' && AMVSpeech.speak) AMVSpeech.speak('Reading at this speed.'); }catch(e){}
    });
    pane.querySelectorAll('[data-theme-opt]').forEach(b=>on(b,'click',()=>_themeApply(b.dataset.themeOpt)));
    pane.querySelectorAll('[data-accent]').forEach(sw=>on(sw,'click',()=>{
      applyAccent(sw.dataset.accent);
      pane.querySelectorAll('.accent-sw').forEach(x=>x.classList.toggle('on',x===sw));
    }));
    pane.querySelectorAll('[data-fs]').forEach(btn=>on(btn,'click',()=>setFontSize(parseInt(btn.dataset.fs,10))));

    if(!only) _setAppendSection(pane, 'language');
  } else if(sp==='language'){
    const cur=_lang();
    pane.innerHTML=
      '<h2 class="set-title">Language</h2>'+
      '<div class="set-sub">Choose the language for AMV\u2019s responses and everything it writes - chat replies, documents, code and 3D models will all use it. You can still ask for any other language inside a message.</div>'+
      /* Every screen ships with its translation in all of these languages
         (the build refuses an entry missing any of them), so the app switches
         with or without the engine - this used to say the opposite, which had
         stopped being true. */
      '<div class="ss2"><h3>'+escH(T('The app itself'))+'</h3><p style="font-size:var(--t-base);color:var(--mu);line-height:1.65;margin:0">'+
        escH(T('Every screen - chat, Crew, Studio, Dev, Lab, settings - switches with it straight away. What you type, and the names of people and apps, stay exactly as they are.'))+'</p></div>'+
      '<div class="ss2"><h3>Response language</h3>'+
        '<div class="lang-grid">'+
          Object.entries(LANGS).map(([code,l])=>
            '<button class="lang-opt'+(code===cur?' on':'')+'" data-lang="'+code+'">'+
              '<span class="lang-native">'+l.native+'</span>'+
              '<span class="lang-name">'+(code==='auto'?l.native2:l.name)+'</span>'+
              (code===cur?'<span class="lang-check">\u2713</span>':'')+
            '</button>'
          ).join('')+
        '</div>'+
      '</div>'+
      '<details class="set-fold"><summary class="set-fold-s">'+escH(T('How this works'))+'</summary>'+
        '<div class="lang-info set-merged">'+
          '<p>\u2022 <b>Auto-detect</b> replies in whatever language you write in.</p>'+
          '<p>\u2022 Pick a language and every reply comes back in it.</p>'+
          '<p>\u2022 Override anytime - e.g. \u201cmake me a poster, but in Chinese\u201d - and AMV follows that request just for that task.</p>'+
          '<p>\u2022 Not listed? AMV speaks 95+ languages - just write to it in yours and it responds in kind.</p>'+
        '</div>'+
      '</details>';
    pane.querySelectorAll('[data-lang]').forEach(btn=>on(btn,'click',()=>{
      saveStr('amv_lang',btn.dataset.lang);
      // re-render the whole app UI, then translate - so nav, top bar, new-chat,
      // and every dynamic label switch language immediately (and revert cleanly).
      try{ _i18nRoots().forEach(r=>_restoreI18nDOM(r)); }catch(e){}
      try{ updateSbUser(); }catch(e){}
      try{ setTab(S.tab); }catch(e){}
      _translateUI();
      setTimeout(_translateUI, 60);
      toast('Language set to '+(btn.dataset.lang==='auto'?'Auto-detect':_langName(btn.dataset.lang)),'success');
      renderSettingsView();
      setTimeout(()=>{ try{ _translateUI(); }catch(e){} }, 120);
    }));

  } else if(sp==='dashboard'){
    pane.innerHTML=
      '<h2 class="set-title">Founder Dashboard</h2>'+
      '<div class="set-sub">Live platform spend, users, revenue, and abuse signals. Operator-only.</div>'+
      '<div id="fd-body"><div class="fd-loading">Loading platform stats\u2026</div></div>'+
      '<div id="fd-digest-host"></div>'+
      '<div class="fd-token-row"><input id="fd-token" type="password" autocomplete="new-password" placeholder="Admin token" class="inp" style="max-width:240px"/>'+
        '<button class="btn bp" id="fd-load" style="font-size:var(--t-sm)">Load stats</button></div>'+
      '<div class="fd-note">Your admin token is set as the ADMIN_TOKEN secret on your Worker. It\u2019s never stored - paste it here each session.</div>';
    // Pre-fill from the session holder so the operator pastes it once per tab
    // rather than once per screen. Still never written to this device.
    try{ const t0=(typeof _adminToken==='function')?_adminToken():''; if(t0 && $('fd-token')) $('fd-token').value=t0; }catch(e){}
    const loadStats=async()=>{
      const tok=($('fd-token')&&$('fd-token').value||'').trim();
      try{ if(tok && typeof _setAdminToken==='function') _setAdminToken(tok); }catch(e){}
      const base=apiBase()||'';
      const body=$('fd-body');
      if(!base){ body.innerHTML='<div class="fd-empty">Connect your backend first (Settings \u2192 Live/Backend) to see platform stats.</div>'; return; }
      if(!tok){ body.innerHTML='<div class="fd-empty">Enter your admin token above and press Load stats.</div>'; return; }
      body.innerHTML='<div class="fd-loading">Loading\u2026</div>';
      try{
        const r=await fetchDeadline(base.replace(/\/$/,'')+'/v1/admin/stats',{headers:{'Authorization':'Bearer '+tok}},15000);
        if(!r.ok){ body.innerHTML='<div class="fd-empty">'+(r.status===403?'Invalid admin token.':'Could not load stats ('+r.status+').')+'</div>'; return; }
        const d=await r.json();
        body.innerHTML=_founderDashHTML(d);
        /* Rendered once, into its own host. It used to be appended to the
           stats body, so the pane's own delayed reload rebuilt it and wiped a
           preview the operator was in the middle of reading. */
        const dh=$('fd-digest-host');
        if(dh && !dh.firstChild){ dh.innerHTML=_payoutCardHTML()+_reportsCardHTML()+_digestCardHTML(); _wireDigestCard(); _loadPayouts(); _loadReports(); }
        body.querySelectorAll('[data-fd-tell]').forEach(b=>on(b,'click',async()=>{
          const name=b.dataset.fdName, n=+b.dataset.fdN||0;
          if(!await showConfirmAsync('Email the '+n+' '+(n===1?'person':'people')+' who asked for '+name+' that it connects now?\n\nEach of them gets one email, once.')) return;
          b.disabled=true; b.textContent='Sending\u2026';
          try{
            const wr=await fetchDeadline(base.replace(/\/$/,'')+'/v1/admin/waitlist/notify',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({app:b.dataset.fdTell,name})},60000);
            const wd=await wr.json().catch(()=>({}));
            if(!wr.ok||wd.error){ toast(wd.error||('Nobody was emailed ('+wr.status+').'),'error',9000); b.disabled=false; b.textContent=T('It connects now - tell them'); return; }
            toast('Told '+wd.sent+(wd.failed?' - '+wd.failed+' could not be reached and will be tried again next time':'')+(wd.more?' - more are waiting, press again':'')+'.', wd.failed?'info':'success', 8000);
            loadStats();
          }catch(e){ toast('The request did not reach the server, so nobody was emailed.','error',8000); b.disabled=false; b.textContent=T('It connects now - tell them'); }
        }));
        _fdSwitches(base, tok);
        // wire kill switch
        const kbtn=$('fd-kill');
        /* THE PLATFORM KILL SWITCH, and its answer was thrown away.

           A rejected admin token, or any error, resolved exactly like a
           success: nothing was said, loadStats() repainted the button in its
           old state, and the operator - who has just been asked "Pause the
           ENTIRE service for all users?" and said yes - is looking at a screen
           that reports the service is still live with no indication that is
           because their instruction did not land. The one control you press
           during a spend emergency is the last one that may report an outcome
           it did not check. */
        if(kbtn) on(kbtn,'click',async()=>{
          const turnOn=!d.spend.killed;
          if(!await showConfirmAsync(turnOn?'Pause the ENTIRE service for every user?\n\nNobody will be able to use AMV until you resume it.':'Resume the service for everybody?')) return;
          const wasLabel=kbtn.textContent;
          kbtn.disabled=true; kbtn.textContent=turnOn?'Pausing…':'Resuming…';
          try{
            const kr=await fetchDeadline(base.replace(/\/$/,'')+'/v1/admin/kill',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({on:turnOn})},15000);
            const kd=await kr.json().catch(()=>({}));
            if(!kr.ok || kd.error){
              toast((kr.status===403?'That admin token was rejected. ':(kd.error?kd.error+' ':''))+
                    (turnOn?'The service is STILL RUNNING and still spending.':'The service is still paused.'),'error',9000);
              kbtn.disabled=false; kbtn.textContent=wasLabel; return;
            }
            toast(turnOn?'Service paused for all users.':'Service resumed.','success',4000);
          }catch(e){
            toast('Could not reach the backend, so nothing changed. '+
                  (turnOn?'The service is STILL RUNNING and still spending.':'The service is still paused.'),'error',9000);
            kbtn.disabled=false; kbtn.textContent=wasLabel; return;
          }
          kbtn.disabled=false;
          loadStats();
        });
      }catch(e){ body.innerHTML='<div class="fd-empty">Network error loading stats.</div>'; }
    };
    on($('fd-load'),'click',loadStats);
    setTimeout(loadStats,100);

  } else if(sp==='backend'){
    const liveBase=apiBase()||'';
    /* Is there a SESSION, which on a fresh tab in cookie mode is not the same
       question as whether a token has been minted yet. */
    const tokenSet=!!(window.AMV_API && AMV_API.hasSession);
    pane.innerHTML=
      '<h2 class="set-title">Live / Backend</h2>'+
      '<div class="set-sub">Connect AMV to your deployed backend so Crew jobs, approvals and Handoff work for real and across accounts. Leave blank to run in local demo mode.</div>'+
      '<div class="ss2"><h3>Backend URL</h3>'+
        '<div style="display:flex;gap:8px"><input type="url" id="be-url" value="'+escH(liveBase)+'" placeholder="https://amv-ai-backend.your.workers.dev" style="flex:1;font-size:var(--t-sm)"><button class="btn bp" style="font-size:var(--t-sm)" data-dact="amvSaveBackend">Save</button></div>'+
        /* WHERE REQUESTS GO, AND WHY THAT ADDRESS. The box shows the resolved
           address, so after clearing an override the built-in one reappears in
           it - true, and baffling without a word saying which it is. */
        '<p style="font-size:var(--t-xs);color:var(--mu);margin-top:8px">'+(liveBase?('Status: <span style="color:var(--grn-txt)">configured</span>'
          +(apiBaseIsOverride()?' &middot; set on this device':' &middot; this deployment’s built-in backend')
          +(tokenSet?' &middot; signed in':' &middot; not signed in')):'Status: local demo mode - no backend')+'</p>'+
      '</div>'+
      '<div class="ss2" style="margin-top:14px"><h3>Sign in to backend</h3>'+
        '<p style="font-size:var(--t-sm);color:var(--mu);margin:-4px 0 10px">Sign in with your AMV account email and password to sync this device. To use Google, sign in with Google on the main sign-in screen - it is verified server-side.</p>'+
        '<div style="display:flex;flex-direction:column;gap:8px"><input type="email" id="be-email" value="'+escH((S.user&&S.user.email)||'')+'" placeholder="you@email.com" style="font-size:var(--t-sm)" autocomplete="username"><div style="display:flex;gap:8px"><input type="password" id="be-pass" placeholder="Your password" style="flex:1;font-size:var(--t-sm)" autocomplete="current-password"><button class="btn bp" style="font-size:var(--t-sm)" data-dact="amvBackendLogin">Connect</button></div></div>'+
      '</div>';
  } else if(sp==='apikeys'){
    const liveBase=apiBase()||'';
    const connected=!!(window.AMV_API && AMV_API.live);
    pane.innerHTML=
      '<h2 class="set-title">AI Connection</h2>'+
      '<div class="set-sub">AMV runs on your secure backend. The AI key lives <b>only on your server</b> - never in the browser - so usage, billing and limits are decided there, not by this page.</div>'+
      '<div class="conn-status '+(connected?'ok':'off')+'" id="conn-status">'+
        '<span class="conn-dot"></span>'+(connected?'Connected - AMV is ready':'Not connected - add your backend URL below')+
      '</div>'+
      '<div class="ss2"><h3>Backend URL</h3>'+
        '<div class="sf"><div><label class="lbl">Your AMV Worker URL</label><input type="text" id="s-base" value="'+escH(liveBase)+'" placeholder="https://amv-backend.yourname.workers.dev" style="font-family:var(--mn);font-size:var(--t-sm)"></div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
          '<button class="btn bp" id="save-base" style="font-size:var(--t-sm)">Save &amp; connect</button>'+
          '<button class="btn" id="test-base" style="font-size:var(--t-sm)">Test connection</button>'+
        '</div>'+
        '<div id="test-result" class="conn-test"></div></div>'+
      '</div>'+
      '<div class="ss2"><h3>Where does the AI key go?</h3>'+
        /* AMV is the product. Naming somebody else's company here, and linking
           people out to buy from them, is both off-brand and the wrong
           instruction: the key is a Worker secret, and which provider is behind
           it is a deployment decision the operator has already made. This is the
           bundle every visitor downloads. */
        '<p style="font-size:var(--t-sm);color:var(--mu);line-height:1.6;margin:0">Your model key is a secret on the Worker, so it never reaches the browser:</p>'+
        '<pre style="background:var(--surface);border:1px solid var(--hair);border-radius:var(--r-sm);padding:10px;font-size:var(--t-sm);overflow:auto;margin:8px 0 0"><code>wrangler secret put AMV_MODEL_KEY</code></pre>'+
        '<p style="font-size:var(--t-sm);color:var(--dim);line-height:1.6;margin:8px 0 0">Until it is set, AMV says so on every screen that needs it rather than failing quietly.</p>'+
      '</div>';
    on($('save-base'),'click',()=>{
      const v=($('s-base')?.value||'').trim().replace(/\/$/,'');
      if(!v){ toast('Enter your backend URL first','error'); return; }
      if(!/^https:\/\//i.test(v)){ toast('Backend URL must start with https://','error'); return; }
      saveStr('amv_api_base',v); if(window.AMV_API) AMV_API.base=v;
      const b=$('save-base'); if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save & connect';b.style.background='';},1500);}
      updateSbUser&&updateSbUser();
      toast('Backend saved - sign in to activate','success');
    });
    on($('test-base'),'click',async ()=>{
      const v=($('s-base')?.value||'').trim().replace(/\/$/,''); const out=$('test-result');
      if(!v){ toast('Enter a URL to test','error'); return; }
      if(out){ out.className='conn-test testing'; out.textContent='Testing\u2026'; }
      try{
        /* A request this page is not ALLOWED to make fails the same way one
           that times out does, and "check it's deployed and correct" then
           sends the operator to debug a Worker that is working.

           connect-src permits 'self' and *.workers.dev. The documented deploy
           is a workers.dev URL, so the normal path is fine - but putting the
           Worker behind a custom domain, which is the obvious next step for
           anybody who owns one, is blocked by the page's own policy. That is
           not something you would ever guess from "could not reach". So the
           violation is listened for and named. */
        let _csp=null;
        const _onCsp=(e)=>{ try{ if(String(e.blockedURI||'').indexOf(_originOf(v))===0) _csp=e; }catch(_){ _csp=e; } };
        document.addEventListener('securitypolicyviolation',_onCsp);
        let r;
        try{
          // 10s: a backend that has not answered by then is not "reachable",
          // and the user is sitting in front of a button that says Testing.
          r=await fetchDeadline(v+'/v1/health',{method:'GET'},10000);
        } finally { document.removeEventListener('securitypolicyviolation',_onCsp); }
        if(_csp){
          if(out){ out.className='conn-test err';
            out.textContent='\u2717 This page is not allowed to call that address. Its Content-Security-Policy permits your own origin and *.workers.dev - a Worker on a custom domain has to be added to connect-src in index.html before the browser will let AMV reach it. The Worker itself may be perfectly fine.'; }
          return;
        }
        if(r.ok){ const d=await r.json().catch(()=>({})); if(out){out.className='conn-test ok';out.textContent=d.ok?'\u2713 Backend is healthy and reachable.':'\u2713 Reachable.';} saveStr('amv_api_base',v); if(window.AMV_API) AMV_API.base=v; const cs=$('conn-status'); if(cs){cs.className='conn-status ok';cs.innerHTML='<span class="conn-dot"></span>Backend reachable - sign in to activate';} }
        else{ if(out){out.className='conn-test err';out.textContent='\u2717 Backend responded with '+r.status+'. Check the URL.';} }
      }catch(err){ if(out){out.className='conn-test err';out.textContent='\u2717 Could not reach that URL. Check it\u2019s deployed and correct.';} }
    });

  } else if(sp==='widget'){
    _renderWidgetPane(pane);

  } else if(sp==='platform'){
    pane.innerHTML=
      '<h2 class="set-title">Platform &amp; Stripe</h2>'+
      '<div class="set-sub">Configure revenue collection and deployment.</div>'+
      /* WITH A SERVER, PAYMENT LINKS ARE NEVER USED. Checkout always goes
         through the server, which hears about the payment from Stripe and changes
         the plan - so links pasted here did nothing, and the warning above them
         sent the owner to set up the wrong thing. They stay only for a deployment
         with no server, where they are the one way to take money. */
      ((window.AMV_API && AMV_API.live)
        ? '<div class="ss2"><h3>Payments</h3>'+
            '<p style="font-size:var(--t-sm);color:var(--mu);line-height:1.6">Checkout runs through your server: Stripe takes the card, Apple Pay or Google Pay, and the plan changes only when Stripe confirms the payment to the server. Payment links are not used while the server is connected. What is switched on, and what is missing, is listed under <b>Taking money</b> below.</p>'+
          '</div>'
        : (!S.sp&&!S.se?'<div class="wb">&#9888; Add your Stripe payment links to start collecting revenue.</div>':'')+
      '<div class="ss2"><h3>Stripe - card, Apple Pay &amp; Google Pay</h3>'+
        '<p style="font-size:var(--t-sm);color:var(--mu);margin-bottom:11px;line-height:1.6">The startup standard. Create a Payment Link at stripe.com &rarr; Payments &rarr; Payment Links. <b>Apple Pay and Google Pay appear automatically inside Stripe\u2019s checkout</b> - no extra setup. Clicking &ldquo;Card / Apple Pay&rdquo; opens your real Stripe checkout. Revenue goes straight to your Stripe account. Set each link\u2019s success URL to <code>yoursite.com/?paid=pro</code> (or <code>elite</code>) so the plan activates on return.</p>'+
        '<div class="sf">'+
          '<div><label class="lbl">Pro Plan - $'+PLANS.pro.price+'/month</label><input type="url" id="s-sp" value="'+escH(S.sp||'')+'" placeholder="https://buy.stripe.com/…"></div>'+
          '<div><label class="lbl">Elite Plan - $'+PLANS.elite.price+'/month</label><input type="url" id="s-se" value="'+escH(S.se||'')+'" placeholder="https://buy.stripe.com/…"></div>'+
          '<div><label class="lbl">Stripe Customer Portal (subscription management)</label><input type="url" id="s-portal" value="'+escH(loadStr('amv_portal'))+'" placeholder="https://billing.stripe.com/p/…"></div>'+
          '<button class="btn bp" id="save-stripe" style="align-self:flex-start;font-size:var(--t-sm)">Save Stripe Links</button>'+
        '</div>'+
      '</div>')+
      '<div class="ss2"><h3>Support email</h3>'+
        '<p style="font-size:var(--t-sm);color:var(--mu);margin-bottom:11px;line-height:1.6">The address your users reach you at. Once set, the <b>&ldquo;Email Support&rdquo;</b> buttons across the app (Help Center, About, legal) open a pre-filled email to this address. Leave blank and those buttons fall back to <b>&ldquo;Ask AMV directly&rdquo;</b> - never a broken link.</p>'+
        '<div class="sf">'+
          '<div><label class="lbl">Support email address</label><input type="email" id="s-support" value="'+escH(_supportEmail())+'" placeholder="support@yourdomain.com" autocomplete="off"></div>'+
          '<button class="btn bp" id="save-support" style="align-self:flex-start;font-size:var(--t-sm)">Save support email</button>'+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>In-app card field (optional)</h3>'+
        '<p style="font-size:var(--t-sm);color:var(--mu);margin-bottom:11px;line-height:1.6">Prefer the card form inside AMV instead of redirecting? Add your Stripe <b>publishable</b> key (starts with <code>pk_</code>) to enable Stripe Elements - the card field is an isolated Stripe iframe, so card numbers never touch AMV. <b>Never paste a secret (sk_) key.</b></p>'+
        '<div class="sf">'+
          '<div><label class="lbl">Stripe publishable key</label><input type="text" id="s-pk" value="'+escH(loadStr('amv_stripe_pk'))+'" placeholder="pk_live_…" style="font-family:var(--mn);font-size:var(--t-sm)"></div>'+
          '<button class="btn bp" id="save-pk" style="align-self:flex-start;font-size:var(--t-sm)">Save key</button>'+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>PayPal &amp; Venmo</h3>'+
        /* There was a "PayPal client ID" box here, and pasting a real one into
           it did nothing at all. PayPal runs on the SERVER - the Worker holds
           PAYPAL_CLIENT_ID and PAYPAL_SECRET and creates the subscription
           itself, because a browser cannot be trusted to state a price or
           confirm a capture. The box was left over from a browser-side SDK
           flow that had to be removed for exactly that reason, and it read as
           the switch that turns PayPal on. */
        '<p style="font-size:var(--t-sm);color:var(--mu);margin-bottom:11px;line-height:1.6">PayPal and Venmo subscriptions are switched on with Worker secrets, not here: set <b>PAYPAL_CLIENT_ID</b>, <b>PAYPAL_SECRET</b> and <b>PAYPAL_WEBHOOK_ID</b> on your backend and the real PayPal checkout turns on for everyone. The links below are an optional fallback for a deployment with no backend connected - a hosted PayPal or Venmo page that takes the payment instead.</p>'+
        '<div class="sf">'+
          '<div><label class="lbl">PayPal hosted link (optional fallback)</label><input type="url" id="s-ppl" value="'+escH((_payCfg().paypalLink)||'')+'" placeholder="https://www.paypal.com/…"></div>'+
          '<div><label class="lbl">Venmo hosted link (optional fallback)</label><input type="url" id="s-vml" value="'+escH((_payCfg().venmoLink)||'')+'" placeholder="https://venmo.com/…"></div>'+
          '<button class="btn bp" id="save-wallets" style="align-self:flex-start;font-size:var(--t-sm)">Save PayPal / Venmo</button>'+
        '</div>'+
      '</div>'+
      /* AMV-084: this list used to be assembled in the browser, which cannot
         see a single Worker secret - three rows were hardcoded to "not set up"
         and the AI row reported whether THIS BROWSER had a session, which says
         nothing about whether the server holds a key. It is now read from the
         server, which is the only thing that knows. */
      '<div class="ss2" style="background:rgba(35,209,139,.04);border-color:rgba(35,209,139,.15)"><h3 style="color:var(--green)">Go-Live status - what is actually switched on</h3>'+
        '<p style="font-size:var(--t-sm);color:var(--mu);margin:-4px 0 14px;line-height:1.6">Read from your Worker, not guessed here. Each line says what it turns on and how to set it. Values are never shown - only whether a secret exists.</p>'+
        '<div class="golive" id="golive-body"><div class="fd-loading">Checking your deployment\u2026</div></div>'+
      '</div>';
    setTimeout(_loadReadiness, 0);
    on($('save-stripe'),'click',()=>{
      const sp=$('s-sp')?.value.trim(),se=$('s-se')?.value.trim(),portal=$('s-portal')?.value.trim();
      if(sp!==undefined){S.sp=sp;saveStr('amv_sp',sp);}if(se!==undefined){S.se=se;saveStr('amv_se',se);}
      saveStr('amv_portal',portal||'');
      store('amv_pay_links',{pro:sp||'',elite:se||''});
      const b=$('save-stripe');if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save Stripe Links';b.style.background='';},1500);}
      toast('Stripe links saved','success');
    });
    on($('save-support'),'click',()=>{
      const addr=$('s-support')?.value.trim()||'';
      if(addr && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)){ toast('Enter a valid email address (or leave blank).','error',4000); return; }
      saveStr('amv_support_email',addr);
      const b=$('save-support');if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save support email';b.style.background='';},1500);}
      toast(addr?('Support email set to '+addr):'Support email cleared - buttons now route to Ask AMV','success',4000);
    });
    on($('save-pk'),'click',()=>{
      const pk=$('s-pk')?.value.trim()||'';
      /* The secret-key case is checked FIRST because it was unreachable: an
         sk_ key is also "not a pk_ key", so the generic message returned above
         it every time and the one warning that matters never appeared. Being
         told "it must start with pk_" reads as "find a different key"; being
         told you have just pasted a secret reads as "go and rotate it". */
      if(/^sk_/.test(pk)){
        toast('That is a SECRET key (sk_). Never paste one anywhere in a browser - treat it as exposed and roll it in your Stripe dashboard. Use the publishable key (pk_) here.','error',9000);
        const el=$('s-pk'); if(el) el.value='';
        return;
      }
      if(pk && !/^pk_(test|live)_/.test(pk)){ toast('That is not a publishable key. It must start with pk_','error',4000); return; }
      saveStr('amv_stripe_pk',pk);
      const b=$('save-pk');if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save key';b.style.background='';},1500);}
      toast(pk?'Secure card field enabled':'Key cleared','success');
    });
    on($('save-wallets'),'click',()=>{
      const cfg=_payCfg();
      cfg.paypalLink=$('s-ppl')?.value.trim()||'';
      cfg.venmoLink=$('s-vml')?.value.trim()||'';
      /* A client id stored here from an older build would keep being read back
         into a field that no longer exists, so it goes with the field. */
      delete cfg.paypalClientId;
      store('amv_pay_cfg',cfg);
      const b=$('save-wallets');if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save PayPal / Venmo';b.style.background='';},1500);}
      toast('PayPal & Venmo saved','success');
    });

  } else if(sp==='usage'){
    pane.innerHTML=
      '<h2 class="set-title">Usage</h2>'+
      '<div class="set-sub">Your current usage this window, activity, and the impact AMV has had for you.</div>'+
      '<div id="usage-body"></div>';
    _usageFill($('usage-body'));
    /* The upgrade buttons in here need no wiring: data-stab is dispatched by
       the same document listener as everything else, and it sends you to the
       tab the button NAMES. This used to also bind each one directly to
       setTab('plans'), which sent the "team" button to plans first and then
       let the delegation correct it - two renders and the wrong one first. */

  } else if(sp==='integrations'){
    /* WHAT IS CONNECTED, NOT THE WHOLE CATALOGUE A SECOND TIME.

       This pane drew the full integrations catalogue - five thousand
       characters - which the Integrations page already is. Settings answers
       "what is AMV connected to, and how do I stop it": so the same catalogue
       is drawn and everything not connected is taken out, keeping each
       connected row's own Disconnect and Run exactly as they are, and the
       page for adding more is one button away. */
    /* Signed out, nothing can be connected - and this was, and stays, the one
       place a visitor can read what each connector does before making an
       account. Signed in, only what is connected, one row per sign-in. */
    const _guest=!(S.user && S.user.email);
    pane.innerHTML =
      '<h2 class="set-title">Connectors</h2>'+
      '<div class="set-sub">What AMV is connected to. Add more from Integrations.</div>'+
      '<div class="set-conn">'+_integrationsCatalogHTML({ connectedOnly: !_guest })+'</div>'+
      '<div class="set-conn-go"><button class="btn bp" data-stab="integrations">'+escH(T('Browse integrations'))+' \u2192</button></div>';
    const _cl=pane.querySelector('.set-conn');
    if(_cl && !_guest){
      _cl.querySelectorAll('.ax-legend, .int-seeall, .int-guest').forEach(x=>x.remove());
      _cl.querySelectorAll('.int-card').forEach(c=>{ if(!c.querySelector('.int-ok')) c.remove(); });
      _cl.querySelectorAll('.ss2').forEach(g=>{ if(!g.querySelector('.int-card')) g.remove(); });
      /* Empty is said only when the list was read and is empty (Build 16
         audit D16-08); loading or unreadable says that, and updates itself. */
      if(!_cl.querySelector('.int-card')){ _cl.innerHTML='<p class="set-empty" id="set-conn-none" role="status"></p>'; try{ $('set-conn-none').innerHTML=_connNoneHTML(); }catch(e){ $('set-conn-none').textContent=T('Nothing is connected yet.'); } }
      else {
        /* ONE LIST OF YOUR ACCOUNTS (Nov 10, owner: "connected accounts has to
           actually look clear - all the accounts you are connected to"). Each
           connection sat in a box of its own inside a category box, so three
           accounts read as three panels. They are one list now, a row each,
           with the category as a small label on the row. The rows are moved,
           not redrawn: each keeps its own Disconnect and Run. */
        const list=document.createElement('div'); list.className='int-list set-conn-list';
        _cl.querySelectorAll('.ss2').forEach(g=>{
          const cat=((g.querySelector('h3')||{}).textContent||'').trim();
          g.querySelectorAll('.int-card').forEach(c=>{
            const top=c.querySelector('.int-top');
            if(cat && top){ const k=document.createElement('span'); k.className='set-conn-cat'; k.textContent=cat; top.prepend(k); }
            list.appendChild(c);
          });
        });
        _cl.replaceChildren(list);
      }
    }
    _wireIntegrationCatalog(pane);
    _killTokenAutofill();
    /* Asked for here too. This pane only filtered what was already loaded, so
       on a device that had not opened Integrations first it said "Nothing is
       connected yet" about an account with apps connected. The load repaints
       this pane when the answer arrives (_connLoad). */
    try{ if(!_guest && typeof _connLoad==='function') setTimeout(()=>_connLoad(false), 0); }catch(e){}
    try{ if(typeof _rmcpLoad==='function') setTimeout(()=>{ _rmcpLoad(false).then(ch=>{ if(ch) _paintIntegrations(); }); }, 0); }catch(e){}
    if(!only){ _setAppendSection(pane, 'skills', null, 'Skills'); _setAppendSection(pane, 'api', null, 'API keys'); }
  } else if(sp==='skills'){
    /* The skill editor and plugins are one file, fetched the first time this
       is drawn (src/skills/skills.js). */
    pane.innerHTML='<h2 class="set-title">'+escH(T('Skills'))+'</h2><div class="skill-empty" role="status">'+escH(T('Loading…'))+'</div>';
    _skillsLoad().then(ok=>{
      if(!pane.isConnected) return;
      if(ok) window._renderSkillsPane(pane);
      else pane.innerHTML='<h2 class="set-title">'+escH(T('Skills'))+'</h2><div class="skill-empty">'+escH(T('Skills could not be loaded. Check your connection and open this again.'))+'</div>';
    });
  } else if(sp==='capabilities'){
    /* The three switches, under Privacy now - each one is about what AMV may
       use or keep. The grid of "everything AMV can do" that sat above them was
       a brochure inside Settings; it is gone, and nothing it described is. */
    const capToggle=(id,title,desc,on)=>'<div class="prv-pref"><div><div class="prv-pref-t">'+escH(title)+'</div><div class="prv-pref-s">'+escH(desc)+'</div></div><label class="sw"><input type="checkbox" id="'+id+'" '+(on?'checked':'')+'><span class="sw-sl"></span></label></div>';
    pane.innerHTML=
      '<h2 class="set-title">What AMV may use</h2>'+
      '<div class="ss2">'+
        capToggle('cap-websearch','Web search','Look things up online when it helps.', loadStr('amv_cap_websearch')!=='0')+
        capToggle('cap-memory','Memory','Remember useful facts about you across chats.', loadStr('amv_cap_memory')!=='0')+
        capToggle('cap-chats','Past chats','Look back through your earlier chats when you refer to them.', loadStr('amv_cap_chats')!=='0')+
        capToggle('cap-suggestions','Answer blocks','Tappable choices, cards and step lists inside answers.', loadStr('amv_cap_suggestions')!=='0')+
      '</div>';
    on($('cap-websearch'),'change',function(){ saveStr('amv_cap_websearch',this.checked?'1':'0'); toast(this.checked?'Web search on':'Web search off','info',2000); });
    on($('cap-memory'),'change',function(){ saveStr('amv_cap_memory',this.checked?'1':'0'); toast(this.checked?'Memory on':'Memory off','info',2000); });
    on($('cap-chats'),'change',function(){ saveStr('amv_cap_chats',this.checked?'1':'0'); toast(this.checked?'Past chats on':'Past chats off','info',2000); });
    on($('cap-suggestions'),'change',function(){ saveStr('amv_cap_suggestions',this.checked?'1':'0'); toast(this.checked?'Answer blocks on':'Answer blocks off','info',2000); });
  } else if(sp==='spending'){
    /* Rendered from 25-money-family-ui.js - see there for why these two panes
       exist at all (the logic shipped with no way for anyone to reach it). */
    _renderSpendingPane(pane);
  } else if(sp==='investing'){
    _renderInvestPane(pane);
  } else if(sp==='teamset'){
    _renderTeamSettingsPane(pane);
    /* Invite was a pane of 180 characters and no controls. It is a section of
       Team now, which is the only place anybody was going to look for it. */
    _setAppendSection(pane, 'invite');
    if(!only) _setAppendSection(pane, 'projects');
  } else if(sp==='family'){
    _renderFamilyPane(pane);
  } else if(sp==='api'){
    /* Rendered from api-keys.js, fetched the first time the pane is opened -
       developers are the only people who come here, so nobody else pays for
       its docs on every visit. */
    pane.innerHTML = '<h2 class="set-title">API keys</h2><div class="ss2"><div class="ak-load">'+escH(T('Loading\u2026'))+'</div></div>';
    _apiKeysLoad().then(ok => {
      if(!pane.isConnected) return;
      if(ok){ window._renderApiKeysPane(pane); return; }
      pane.querySelector('.ak-load').textContent = T('The API keys screen could not be loaded. Check your connection and try again.');
    });
  } else if(sp==='invite'){
    /* Rendered from 27-referrals.js. */
    _renderInvitePane(pane);
  } else if(sp==='about'){
    pane.innerHTML=
      '<h2 class="set-title">About AMV.AI</h2>'+
      '<div class="set-sub">Platform information and legal.</div>'+
      '<div class="ss2">'+
        '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">'+
          '<div class="logo-mark-lg ce-mark-sig" style="width:50px;height:50px;border-radius:var(--r-md);flex-shrink:0">'+amvMark(34)+'</div>'+
          /* Read from CHANGELOG, which is what What's New already shows. Written
             out, this said "Version 2.0 - 2025" while the release notes one
             screen away listed 2.4, and the year had been wrong since January.
             A version number in two places is two version numbers. */
          '<div><div style="font-size:var(--t-lg);font-weight:800;letter-spacing:-.4px">AMV<span style="color:var(--accent-txt)">.</span>AI</div><div style="font-size:var(--t-xs);color:var(--mu);margin-top:2px">Version '+escH(_latestVersion()||'2.0')+' &bull; '+new Date().getFullYear()+'</div></div>'+
        '</div>'+
        '<p style="font-size:var(--t-sm);color:var(--mu);line-height:1.65;margin-bottom:13px">Your AI workforce - it does the work, not just answers it. Chat, agents, builds, research and automation in one place.</p>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          '<button class="btn bs" style="font-size:var(--t-sm)" data-dact="openTerms">Terms of Service</button>'+
          '<button class="btn bs" style="font-size:var(--t-sm)" data-dact="openPrivacy">Privacy Policy</button>'+
          supportButton({label:'Contact Support',cls:'btn bs',subject:'AMV Support request'})+
        '</div>'+
      '</div>'+
      /* The third copy, and the one that was hardest to notice was stale: it
         listed six of the twelve bindings and printed Ctrl on a Mac. Rendered
         from _SHORTCUTS, so it cannot fall behind the keys that actually work. */
      '<div class="ss2"><h3>Keyboard Shortcuts</h3>'+
        '<div style="display:flex;flex-direction:column;gap:0">'+
          _shortcutRowsHTML()+
        '</div>'+
      '</div>'+
      (S.user?'<div class="ss2" style="border-color:rgba(255,95,87,.2)"><h3 style="color:var(--red-txt)">Sign Out</h3><p style="font-size:var(--t-sm);color:var(--mu);margin-bottom:12px">Your data remains saved and will be restored on next sign in.</p><button class="btn bd2" data-dact="signOut" style="font-size:var(--t-sm)">Sign out</button></div>':'');
  } else {
    pane.innerHTML='';
  }
}
function setFontSize(px){
  // The app uses fixed px sizes throughout, so a root font-size change alone
  // does nothing. Scale the whole interface proportionally with `zoom`
  // (text + spacing), which is what visibly changes the size for the user.
  const scale = px/14;                 // 14 = default
  _applyZoom(scale);
  saveStr('amv_fs', px);
  try{ if(S.tab==='settings' && S.settingsPane==='appearance') renderSetPane(); }catch(e){}
}

/* SWITCH OFF ONE PART (owner console; 80-switches.js on the server).
   The global pause stops everything; this stops one feature, engine,
   connector or kind of write, and says what is off, since when and why.
   Every flip is read back from the server's answer before the screen says
   it happened - the same rule the global pause was fixed to follow. */
async function _fdSwitches(base, tok){
  const host = document.querySelector('#fd-switches .fd-sw-body'); if(!host) return;
  const url = (p) => base.replace(/\/$/,'') + p;
  const hdr = { 'Authorization':'Bearer '+tok, 'Content-Type':'application/json' };
  let d;
  try{
    const r = await fetchDeadline(url('/v1/admin/switches'), { headers: hdr }, 15000);
    d = await r.json().catch(()=>({}));
    if(!r.ok){ host.className='fd-sw-body fd-empty'; host.textContent = r.status===403 ? 'Invalid admin token.' : 'Could not load the switches ('+r.status+').'; return; }
  }catch(e){ host.className='fd-sw-body fd-empty'; host.textContent='Could not reach the backend.'; return; }
  const off = d.off || {};
  const when = (t) => t ? new Date(t).toLocaleString() : '';
  const row = (name, label) => {
    const o = off[name];
    return '<div class="fd-sw-row'+(o?' off':'')+'"><div><b>'+escH(label)+'</b>'+(o?'<span class="fd-sw-why">Off since '+escH(when(o.at))+(o.why?' - '+escH(o.why):'')+'</span>':'')+'</div>'
      + '<button class="btn '+(o?'bp':'bs')+'" data-fd-sw="'+escH(name)+'" data-fd-sw-off="'+(o?'0':'1')+'">'+(o?'Turn back on':'Switch off')+'</button></div>';
  };
  const feats = Object.entries(d.features || {}).map(([k, label]) => row('feature:'+k, label)).join('');
  const others = Object.keys(off).filter(n => !n.startsWith('feature:')).map(n => row(n, n)).join('');
  host.className = 'fd-sw-body';
  host.innerHTML = feats + others
    + '<div class="fd-sw-add"><input class="fp-in" id="fd-sw-name" placeholder="model:amv-core, connector:gmail or write:gmail.send" aria-label="Switch to turn off" autocomplete="off">'
    + '<input class="fp-in" id="fd-sw-why" placeholder="Why (kept with it)" aria-label="Why" maxlength="200" autocomplete="off">'
    + '<button class="btn bs" data-fd-sw-new="1">Switch off</button></div>';
  const flip = async (name, turnOff, btn) => {
    const why = turnOff ? (String(($('fd-sw-why')||{}).value||'').trim()) : '';
    if(turnOff && !await showConfirmAsync('Switch off '+name+'?\n\nPeople using it are told it is paused; everything else keeps working.')) return;
    if(btn){ btn.disabled = true; btn.textContent = turnOff ? 'Switching off…' : 'Turning on…'; }
    try{
      const r = await fetchDeadline(url('/v1/admin/switch'), { method:'POST', headers: hdr, body: JSON.stringify({ name, off: turnOff, why }) }, 15000);
      const x = await r.json().catch(()=>({}));
      if(!r.ok || x.off !== turnOff){ toast((x.error || ('Nothing changed ('+r.status+').')) + ' ' + name + (turnOff ? ' is still ON.' : ' is still OFF.'), 'error', 9000); }
      else toast(turnOff ? name+' is off. It reaches every server within about a minute.' : name+' is back on.', 'success', 6000);
    }catch(e){ toast('Could not reach the backend, so nothing changed.', 'error', 8000); }
    _fdSwitches(base, tok);
  };
  host.querySelectorAll('[data-fd-sw]').forEach(b => on(b, 'click', () => flip(b.dataset.fdSw, b.dataset.fdSwOff === '1', b)));
  const add = host.querySelector('[data-fd-sw-new]');
  if(add) on(add, 'click', () => { const n = String(($('fd-sw-name')||{}).value||'').trim().toLowerCase(); if(!n){ toast('Name the switch first.', 'info', 4000); return; } flip(n, true, add); });
}

/* THE REFUND SECTION (the owner's policy, Nov 16: within 14 days of a charge
   with under 20% of the plan used, the whole charge back in one press, once a
   year; anything else is a request the owner decides). Everything it says is
   the server's answer - 68-refunds.js decides, this only reads it out. */
async function _billRefundFill(targetEl){
  const box = $('bill-refund'); if(!box) return;
  if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)) return;
  let s;
  try{ s = await AMV_API.refundState(); }catch(e){ return; }
  if(!box.isConnected || !s) return;
  if(s.ok === false){
    if(s.code === 'team_member'){ box.innerHTML = '<p class="bill-rf-w">' + escH(T('Your plan is paid for by your team. The team owner can ask for a refund.')) + '</p>'; box.hidden = false; }
    return;
  }
  const money = (n, c) => { try{ return new Intl.NumberFormat(undefined, { style:'currency', currency:c || 'USD' }).format(+n || 0); }catch(e){ return '$' + (+n || 0).toFixed(2); } };
  const day = (ms) => { try{ return new Date(ms).toLocaleDateString(undefined, { month:'short', day:'numeric' }); }catch(e){ return ''; } };
  const amt = money(s.charge && s.charge.amount, s.charge && s.charge.currency);
  const head = '<div class="bill-rf-t"><span class="bill-ar-n">' + escH(T('Refund')) + '</span></div>';
  const WHY = {
    over_14_days: T('The last charge was more than 14 days ago.'),
    used_20_percent: T('More than 20% of this period has been used.'),
    refunded_this_year: T('You already had an automatic refund in the last 12 months.'),
    nothing_paid: T('Nothing was paid for this period.'),
  };
  let body = '';
  if(s.refunded){
    body = '<p class="bill-rf-w">' + escH(T('Your last charge was refunded.')) + '</p>';
  } else if(s.request){
    body = '<p class="bill-rf-w">' + escH(T('Your refund request was sent on {0}. It will be answered here.').replace('{0}', day(s.request.at))) + '</p>';
  } else if(s.auto){
    body = '<p class="bill-rf-w">' + escH(T('You can get a full refund of {0} for your charge on {1}. Your plan ends as soon as it is refunded.')
              .replace('{0}', amt).replace('{1}', day(s.charge.paidAt))) + ' '
         + escH(T('{0} days left to ask.').replace('{0}', String(s.daysLeft))) + '</p>'
         + '<button class="btn bs bill-rf-b" type="button" id="bill-rf-go">' + escH(T('Refund {0}').replace('{0}', amt)) + '</button>';
  } else {
    const why = (s.why || []).map(w => WHY[w]).filter(Boolean)[0] || '';
    body = '<p class="bill-rf-w">' + escH((s.answered && s.answered.status === 'declined'
              ? T('Your last refund request was declined.') + ' ' : '') + why + ' '
              + T('You can still ask for a refund, and it will be looked at.')) + '</p>'
         + '<button class="btn bs bill-rf-b" type="button" id="bill-rf-ask">' + escH(T('Ask for a refund')) + '</button>'
         + '<div class="bill-rf-form" id="bill-rf-form" hidden>'
           + '<label class="bill-rf-l" for="bill-rf-why">' + escH(T('Why are you asking?')) + '</label>'
           + '<textarea class="inp" id="bill-rf-why" rows="3" maxlength="1000"></textarea>'
           + '<button class="btn bp" type="button" id="bill-rf-send">' + escH(T('Send request')) + '</button>'
         + '</div>';
  }
  box.innerHTML = head + body;
  box.hidden = false;
  on($('bill-rf-go'), 'click', () => {
    const b = $('bill-rf-go'); if(!b) return;
    const asked = (typeof confirmModal === 'function') && confirmModal(
      T('Refund {0}?').replace('{0}', amt),
      T('The whole charge goes back to your card, and your plan ends now and moves to Free. This cannot be undone.'),
      async () => {
        b.disabled = true; b.textContent = T('Refunding\u2026');
        try{
          const d = await AMV_API.refund({ mode:'auto' });
          toast(T('Refunded {0}. It reaches your card in 5-10 days.').replace('{0}', money(d.refund && d.refund.amount, d.refund && d.refund.currency)), 'success', 7000);
          try{ if(typeof syncEntitlement === 'function') await syncEntitlement(); }catch(e){ try{ console.error('AMV: could not refresh the plan after a refund', e); }catch(_){} }
          renderBillingView(targetEl);
        }catch(e){
          b.disabled = false; b.textContent = T('Refund {0}').replace('{0}', amt);
          toast(T('The refund did not go through: ') + ((e && e.message) || T('try again')), 'error', 7000);
        }
      }, { confirm: T('Refund and end my plan'), cancel: T('Keep my plan') });
    if(!asked) toast(T('Could not open the confirmation, so nothing was changed.'), 'error', 5000);
  });
  on($('bill-rf-ask'), 'click', () => { const f = $('bill-rf-form'); if(f){ f.hidden = false; try{ $('bill-rf-why').focus(); }catch(e){} } });
  on($('bill-rf-send'), 'click', async () => {
    const t = $('bill-rf-why'), b = $('bill-rf-send'); if(!t || !b) return;
    const reason = t.value.trim();
    if(reason.length < 3){ toast(T('Say in a few words why you are asking.'), 'error', 4000); t.focus(); return; }
    b.disabled = true;
    try{
      await AMV_API.refund({ mode:'request', reason });
      toast(T('Your refund request was sent.'), 'success', 5000);
      _billRefundFill(targetEl);
    }catch(e){
      b.disabled = false;
      toast(T('Could not send the request: ') + ((e && e.message) || T('try again')), 'error', 6000);
    }
  });
}
try{ window._billRefundFill = _billRefundFill; }catch(e){}

/* ══════ BILLING - moved here from 08-admin-fraud.js (Nov 25); the page keeps a
   stand-in that fetches this file. ══════ */
/* THIS USED TO INVENT THE INVOICES.

   The comment above it said "the subscription's real billing history". It was
   a loop: one row per month between the plan's start date and today, each for
   the plan's list price, each stamped Paid, each with a View button. No
   invoice number, no amount from a processor, no check that any payment
   happened.

   So a proration, a coupon, a refund, a failed charge, a plan change or a
   cancel-and-resubscribe all rendered as an unbroken run of full-price months
   marked Paid - on the screen somebody opens to work out what they have
   actually been billed, and the one they read before disputing a charge.

   There is a real source. When a backend is connected, `_loadInvoices` fetches
   the processor's own invoice list, with numbers, amounts, statuses and PDFs,
   and that is what renders. This function is only reached with NO backend
   connected - which is precisely the case where no processor exists and no
   money has moved, so a paid invoice history is not merely unverified, it is
   describing charges that cannot have happened.

   It says that instead. Nothing is lost: there was never any information
   here, only arithmetic on a price. */
function _invoiceTableHTML(plan, P, sinceDate){
  if(plan==='free') return '<div class="bill-inv-empty">No invoices yet. Your first payment will show up here.</div>';
  return '<div class="bill-inv-empty">'+escH(T('Invoices come from the payment processor, and this deployment is not '+
    'connected to one - so there is nothing to show and nothing has been charged. Connect a backend and every '+
    'real invoice appears here, with its number, amount and a PDF.'))+'</div>';
}
try{ window._invoiceTableHTML=_invoiceTableHTML; }catch(e){}


/* WHAT THIS LIST ACTUALLY IS, WHICH IS NOT WHAT IT SAID.

   `amv_txns` is written to localStorage and appears in neither `_SYNC_KEYS`
   nor `_SYNC_EXTRA`, so it never leaves the browser that made the purchase.
   The heading said "Every payment you've made on AMV". On a second device, in
   a private window, or after clearing site data, that same heading sat above a
   list containing none of them - and because the function returned '' when the
   list was empty, the section did not appear at all. Somebody who paid on a
   laptop and opened Billing on their phone to check a charge found no
   transactions section on the screen, with nothing saying why.

   Two changes. It says where the record comes from, so "I do not see my
   purchase" has an answer on the screen instead of being a support ticket. And
   an empty list on a connected account says so and points at the invoice list
   above, which IS the authoritative record of subscription payments, rather
   than vanishing. */
function _billingTxnsHTML(){
  const txns=(typeof _loadTxns==='function')?_loadTxns():[];
  const live=!!(window.AMV_API&&AMV_API.live);
  /* SHORTER, NOT GONE - AND DELETING IT WAS A MISTAKE WORTH RECORDING.

     I took this out as a section whose only content was an excuse for its own
     existence. It is not. It is what somebody sees ON THEIR PHONE AFTER PAYING
     ON A LAPTOP, and it used to be absent: they found no record of the money
     they had just spent and nothing telling them where to look. That is the
     defect this block was written for, and hiding it again brings it straight
     back.

     So it stays and says the same four things - the record is local, another
     device will not be here, Recent transactions above is the real one, bought items are
     in Purchases - in one sentence instead of sixty words. The complaint was
     that this page reads as a wall of text, and that is answered by saying it
     shorter, not by not saying it. */
  if(!txns.length){
    if(!live) return '';
    return '<div class="ss2 bill-txns"><h3>Payments recorded on this device</h3>'+
      '<p class="bill-txns-sub">Nothing in this browser yet. Paid on another device? '+
      'It will not be here - Recent transactions above is the full record, and anything bought is in Purchases.</p></div>';
  }
  const money=n=>'$'+(Number(n)||0).toFixed(2);
  return '<div class="ss2 bill-txns"><h3>Payments recorded on this device</h3>'+
    '<p class="bill-txns-sub">Kept in this browser, so a purchase made on another device will not be here. '+
    'Recent transactions above is the full record of your subscription payments. Only you can see this.</p>'+
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


/* The extra-usage balance this tab last read, per account (see below). */
let _billCreditLast=null;
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
  let P=PLANS[plan]||PLANS.free;
  let customSummary=null;
  if(plan==='custom'){
    const cfg=load('amv_custom_cfg')||{};
    const price=cfg.price||30;
    customSummary=_customPlanSummary(price);
    P={name:'Custom',price:price,allowance:'',blurb:'Your custom plan - '+customSummary.monthlyTokens.toLocaleString()+' tokens/mo of usage'};
  }
  const since=loadStr('amv_plan_since');
  const sinceDate=since?new Date(parseInt(since,10)):null;
  /* A RENEWAL DATE IS A FACT ABOUT A SUBSCRIPTION, NOT ARITHMETIC ON A DEVICE.

     This was `sinceDate + 30 days`: the day THIS browser happened to record a
     payment, plus a month. It is wrong on a second device (which has no
     `amv_plan_since` at all), wrong after any plan change, wrong by a day in
     half the months of the year, and - now that a plan can be bought by the
     year - wrong by eleven months for anybody who chose Yearly.

     `S.renewal` is the processor's own answer, put there by the entitlement
     sync, and it is null until the server has one. Null means the line says
     nothing, which is what this card already does everywhere else a date is
     not known. */
  const rn=(typeof S!=='undefined' && S.renewal && typeof S.renewal==='object') ? S.renewal : null;
  const nextDate=(rn && +rn.renewsAt) ? new Date(+rn.renewsAt) : null;
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

  /* YOUR USAGE, ITS OWN CARD (Nov 23). The owner: "billing - your plan, your
     usage, your payment, and then See plans". The figures the plan allows,
     how much of this window is used and when it resets, extra usage - and a
     way to the full Usage screen, which used to be embedded here whole and
     made this page 2,400 pixels long. */
  let _us = null; try{ _us = AMVUsage.status(); }catch(e){}
  const usagePct = _us ? Math.max(0, Math.min(100, +_us.pct || 0)) : null;
  let usageReset = ''; try{ usageReset = AMVUsage.resetLabel(); }catch(e){}
  const usageRows = plan==='free'
    ? _bfact(T('Messages'), escH(_msg5hLabel('free')) + ' messages every ' + USAGE_WINDOW_HOURS + ' hours, within a daily allowance')
    : ((plan!=='custom'
            /* The same figures as the plan cards: the window that binds a
               burst, and the month as an allowance - never the 100,000-a-month
               anti-abuse ceiling, which the token and cost allowance runs out
               long before. That allowance is what a month actually is, so it
               is not called secondary. */
            ? _bfact(T('Messages'), escH(_msg5hLabel(plan)) + ' messages every ' + USAGE_WINDOW_HOURS + ' hours')
              + (_planMsgNum(PLAN_TOP_WEEK, plan)
                  ? _bfact('Top engines', escH(T('{0} top-engine messages a week').replace('{0}', _topWeekLabel(plan))))
                  : '')
              + (P.allowance ? _bfact('Monthly allowance', escH(P.allowance) + ' tokens, renewing on your billing date - Usage shows what is left') : '')
            : (P.allowance?_bfact('Usage', escH(P.allowance)+' tokens a month'):'')))
      /* Extra usage: the balance is the server's, filled in once it answers,
         and the button opens the packs. */
      + _bfact(T('Extra usage'), '<span id="bill-credit">\u2026</span> <button type="button" class="bill-credit-add" data-dact="_creditOpen">'+escH(T('Add'))+'</button>')
      + (customSummary?_bfact('Monthly usage',customSummary.monthlyTokens.toLocaleString()+' tokens (credit-metered)'):'')
      + (customSummary?_bfact('Daily limit',customSummary.dailyCap.toLocaleString()+' tokens/day'):'');
  /* Where the server counts, its own meters are the usage - this month, the
     five-hour window, today and top engines, each with when it resets. */
  let srvOwned = false; try{ srvOwned = _usageServerOwned(); }catch(e){}
  const usageCard = '<div class="ss2 bill-use" id="set-sec-usage"><h3>' + escH(T('Usage')) + '</h3>'
    + (srvOwned ? '<div id="srv-usage" class="bill-srv"></div>' : '')
    + (!srvOwned && usagePct !== null
        ? '<div class="bill-meter" role="img" aria-label="' + escH(T('{0}% used this window').replace('{0}', usagePct)) + '">'
            + '<div class="bill-meter-bar"><span style="width:' + usagePct + '%"></span></div>'
            + '<div class="bill-meter-t">' + escH(T('{0}% used this window').replace('{0}', usagePct)) + (usageReset ? ' \u00b7 ' + escH(T('resets in {0}').replace('{0}', usageReset)) : '') + '</div>'
          + '</div>'
        : '')
    + '<dl class="bill-facts">' + usageRows + '</dl>'
    + '<button type="button" class="bill-link" data-stab="usage">' + escH(T('See your usage')) + '</button>'
  + '</div>';

  vc.innerHTML=
    '<div class="sv fi"><div class="vi vi-bill">'+
      /* ONE HEADING. It had an eyebrow, a title and a two-line paragraph - three
         levels of introduction for a page with one fact on it, above a stack of
         five bordered panels. The sentence about card security was the page's
         opening line; it is true, it is not what somebody came here to read,
         and it is still on the screen at the bottom where the rest of the
         payment-security detail lives. */
      '<h2 class="bill-h">Billing</h2>'+
      /* ONE CARD, NOT TWO THAT DISAGREE ABOUT NOTHING.

         Reported as looking horrible and unprofessional, and the first thing
         to find on it was that the same three facts were printed twice:
         "Current plan" said Pro, $15/mo, Active, and "Subscription details"
         underneath said Plan Pro, Price $15/month, Status Active. Two headed
         sections, two borders, two blocks of vertical space, for one fact.

         So there is one summary: what you are on and what it costs, said once
         and said large, with the dates and the email under it and the control
         that changes any of it beside them. Everything the second section
         carried that the first did not - the dates, the email, the usage
         figures on a custom plan - is still here. What is gone is the second
         copy of the first three rows and the heading over it.

         A DATE NOBODY HAS IS NOT A DASH. `amv_plan_since` is written by the
         browser that took the payment, so opening billing on a second device
         showed "Started -" and "Renews -" to a paying customer, which reads as
         a broken page rather than as a fact this device does not hold. It says
         what is true instead, and points at the one place that does know. */
      '<div class="ss2 bill-sum">'+
        /* The heading stays. Merging the two sections took it away with the
           second one, and a suite that pins the READING ORDER of this page -
           what you are on, what you have used, what you could move to, then
           the payment reassurance - lost its first anchor. It was right to:
           every other section here is announced, and the one that is not reads
           as a card that floated in. */
        /* The plan and what it costs, said once and said large, with the state
           of it on the line underneath. The heading that used to sit here said
           "Current plan" above a card whose first word was the plan - a label
           for something already labelled. */
        '<div class="bill-sum-top">'+
          '<div class="bill-sum-n">'+escH(P.name)+'</div>'+
          /* NOT "Free" TWICE. The name beside this already says Free, and the
             price rendered the same word again on the same line - the exact
             duplication this page was rebuilt to remove, reintroduced at one
             word. A free plan has no price to state, so it states none. */
          (plan==='free'?'':'<div class="bill-sum-p">$'+P.price+' <span>/ month</span></div>')+
          /* The way to another plan sits beside the one you are on, as it does
             in every billing screen people already know. */
        '</div>'+
        '<div class="bill-sum-sub">'+
          '<span class="bill-dot'+(plan==='free'?' free':'')+'"></span>'+
          (plan==='free'
            ? 'You are not paying for anything. Nothing is on file and nothing renews.'
            /* "renews" and "ends" are opposite facts and the date alone
               cannot tell them apart. Somebody who has switched auto-renew off
               is looking for exactly this line to confirm it. */
            : 'Active'+(nextDate?' \u00b7 '+(rn && rn.autoRenew===false?'ends ':'renews ')+escH(fmt(nextDate)):'')+
              ' \u00b7 '+escH(T(P.blurb||'')))+
        '</div>'+
        (plan!=='free'?
        /* Renewal moved up into the line under the plan, where somebody looks
           for it, so it is not repeated here. */
        '<dl class="bill-facts">'+
          _bfact(T('Billing email'), escH(email))+
          /* MESSAGES, BECAUSE THAT IS WHAT THE SERVER COUNTS.

             This row said "2.3M tokens a month" while Spending - the screen
             that now holds everything about money - sells the same plan in
             messages. Two screens disagreeing about what a plan gives you is
             the defect the pricing work was done to remove, left behind on the
             screen somebody opens when they are actually paying.

             The token allowance is still real and still the secondary cap, so
             it stays; it is just no longer the headline, and it is no longer
             the only thing here. */

          /* A ROW WHOSE VALUE IS AN APOLOGY IS NOT A ROW.

             These two printed "Not recorded on this device" and "Open Manage
             billing for the exact date" into a table of facts about somebody's
             subscription. Both are honest and both are the wrong shape: a
             definition list is a place for answers, and putting "we do not
             know" in one twice, in italics, is the single thing that made this
             screen read as unfinished rather than as a product somebody pays
             fifteen dollars a month for.

             So they appear when there is something to say and are absent when
             there is not. Nothing is hidden by this - the renewal date is on
             the status line above when it is known, and the processor's own
             portal is one button away and is the authority on both. */
          (sinceDate?_bfact('Started', escH(fmt(sinceDate))):'')+
        '</dl>'+
        /* AUTO-RENEW, ANSWERED AND CHANGEABLE IN ONE PLACE.

           A subscription renews by itself - that is what a subscription is -
           so the only question worth a control is whether this one stops at
           the end of the period already paid for. Stripe holds that as one
           field and the server writes it, reading back what the subscription
           became rather than what was asked of it.

           DRAWN ONLY WHEN IT CAN ACT. `manageable` is the server saying there
           is a subscription id to write to. Without one this is a switch wired
           to nothing, and a switch wired to nothing on the screen that holds
           somebody's money is worse than no switch - so the portal button
           below stays the answer and this says nothing.

           Turning it OFF is the end of something somebody is paying for, so it
           is confirmed. Turning it back ON costs nothing and is immediate. */
        ((rn && rn.manageable)
          ? '<div class="bill-ar' + (rn.autoRenew===false?' off':'') + '">'
            + '<div class="bill-ar-t">'
              + '<span class="bill-ar-n">' + escH(T('Auto-renew')) + '</span>'
              + '<span class="bill-ar-s">' + escH(rn.autoRenew===false ? T('Off') : T('On')) + '</span>'
            + '</div>'
            + '<p class="bill-ar-w">' + escH(rn.autoRenew===false
                ? (nextDate
                    ? T('Your plan stays fully active until') + ' ' + fmt(nextDate) + ', ' + T('then moves to Free. Nothing more will be charged.')
                    : T('Your plan stays active to the end of the period you have paid for. Nothing more will be charged.'))
                : (nextDate
                    ? T('You will be charged again on') + ' ' + fmt(nextDate) + '.'
                    : T('Your plan renews automatically at the end of each period.'))) + '</p>'
            + '<button class="btn ' + (rn.autoRenew===false?'bp':'bs') + ' bill-ar-b" type="button" id="bill-ar-go" data-on="' + (rn.autoRenew===false?'1':'0') + '">'
              + escH(rn.autoRenew===false ? T('Turn auto-renew back on') : T('Turn off auto-renew')) + '</button>'
          + '</div>'
          : '')+
        /* The billing portal is the only place a card can be changed or a
           subscription cancelled. The handler for this button already existed
           and had done nothing for as long as the button did not: a paying
           customer could not reach their own billing, which is a support ticket
           at best and a complaint to their bank at worst. */
        /* The sentence sits UNDER the button now. Beside it, it was a
           paragraph squeezed into whatever width was left over, setting at
           three words a line on a phone and reading as something jammed in. */
        /* The portal button used to sit here. It now lives under Payment
           method, where somebody looking for their card goes - asked for in
           that order, and it is the right one: this card answers "what am I
           on", not "how do I change my card". */
        '':
        /* SAID ONCE. The status line under the plan name already says exactly
           this sentence for a free account, and printing it again as a
           paragraph two lines below is the same fault this page was rebuilt
           for - the same fact, twice, taking two blocks of space. What a free
           account needs here is what Free allows - the figures the server
           enforces - with the way up beside it, in Upgrade plan. */
        '')+
      '</div>'+
      usageCard+
      /* WHERE USAGE AND SPENDING GO.

         In Settings this pane is followed by two appended sections - the
         retired Usage and Spending panes, merged in here. Appended means
         appended, so they landed after EVERYTHING, including "How we protect
         your payment" - which put a block of reassurance nobody is looking for
         between somebody and the two numbers they opened this screen to see.

         The reading order that makes sense is: what you are on, what you have
         used, what you could move to, and only then the payment-security
         reassurance. So the appended sections get a slot here rather than
         being dropped at the end, and the security block keeps its place at
         the bottom where it is available without being in the way. */
      /* WHAT IT DOES AND WHAT IT DOES NOT, under the plan it describes.
         A price with no capabilities beside it asks somebody to go and look up
         what they are paying for; this is the answer on the same screen. */
      /* IN THE ORDER EVERY BILLING SCREEN PEOPLE KNOW USES, BECAUSE IT IS THE ORDER PEOPLE LOOK.

         Plan (with the way to change it beside it), then what has been used,
         then how you pay, then what you have been charged, and leaving last.
         What a plan does and does not include, and the ladder of other plans,
         live on the plans page now - one tap away from "Change plan" - instead
         of being stacked here between somebody and their invoices. */
      /* (The usage slot moved below Cancellation - see the note there.) */
      /* PAYMENT METHOD - the fourth section, and the last thing anybody needs.

         The card itself is at the processor and AMV never held the number, so
         this cannot print a Visa row from its own records the way the reference
         screenshot does. What it can do is say which card is on file when the
         processor has told us, and put the one control that actually changes it
         directly underneath. Anything else here would be a picture of a card. */
      '<div class="ss2 bill-pm"><h3>'+escH(T('Payment'))+'</h3>'+
        '<div id="bill-pm-body">'+
          (plan==='free'
            ? '<p class="bill-pm-none">No card on file. You are on Free, so there is nothing to pay and nothing stored.</p>'
            : '<p class="bill-pm-none">'+escH(T('Your card is held by our payment processor. Open billing to see it, change it, or download a receipt.'))+'</p>')+
        '</div>'+
        (plan!=='free'?'<div class="bill-acts">'+
          '<button class="btn bp" id="portal-open-btn">'+escH(T('Manage billing'))+'</button>'+
          (plan==='custom'?'<button class="btn bs" id="bill-resize">Resize my plan</button>':'')+
        '</div>':'')+

      /* NOTHING HERE IS INVENTED. _invoiceTableHTML is the processor's list or
         an honest sentence saying there is none; it is not a table this file
         fills in. */
      /* Invoices and leaving are part of how you pay (Nov 23: "your plan,
         your usage, your payment") - inside the Payment card, not two more
         sections of their own. */
        '<div class="bill-tx"><h4 class="bill-sub">'+escH(T('Invoices'))+'</h4>'+
        '<div id="bill-invoices">'+(plan==='free'
          ? _invoiceTableHTML(plan,P,sinceDate)
          : (liveBackend?'<div class="bill-inv-loading">Loading your invoices\u2026</div>':_invoiceTableHTML(plan,P,sinceDate)))+'</div>'+
        '</div>'+
      /* REFUNDS: filled from the server's answer (_billRefundFill), which
         decides whether this charge can come back in one press. Hidden until
         it answers, and stays hidden when there is nothing to refund.
         In the Payment card, beside invoices and cancelling, where money going
         back belongs - and where arriving a moment late moves nothing above
         it. It sat under the plan, and its arrival pushed the whole Usage card
         down 170px a third of a second after the page had appeared (owner,
         Nov 24: "it shows something and then quickly changes"). */
      (plan!=='free'?'<div class="bill-rf" id="bill-refund" hidden></div>':'')+
      (plan!=='free'?
      /* Cancelling is one line at the foot of the page, not a panel of its own
         with a red-outlined button in it. A product that frames leaving as a
         section with a warning colour is a product that thinks about leaving
         more than the person does - and the promise on the pricing page is that
         it takes one click. It still says exactly what happens, and it still
         goes through the processor, which is the only thing that can really end
         a subscription. */
        '<div class="bill-leave">'+
        '<button class="bill-cancel-link" id="bill-cancel">'+escH(T('Cancel subscription'))+'</button>'+
        '<p class="bill-leave-s">'+escH(T('You keep {0} until the end of the period you have already paid for, and nothing you have made is deleted.').replace('{0}', () => P.name))+'</p>'+
        '<div class="seat-say" id="bill-cancel-say" role="status" aria-live="polite"></div>'+
        '</div>':'')+
      '</div>'+
      _billingTxnsHTML()+
      /* And then, at the foot: the plans. */
      '<button type="button" class="btn bp bill-plans" data-stab="plans">'+escH(T('See plans'))+'</button>'+
      /* FOUR EMOJI REASSURANCE CARDS, REMOVED FROM THE SETTINGS SCREEN.

         "PCI-DSS Level 1", "256-bit TLS" and two more, each with an emoji for
         an icon, took more vertical space than the subscription itself. That
         block is written for somebody DECIDING whether to hand over a card -
         it belongs where the card is asked for, and it is on the pricing and
         checkout surfaces, which is where it does its job.

         Here it is addressed to somebody who paid weeks ago and came to change
         a card or read an invoice. To them it is four paragraphs of a stranger
         insisting they are trustworthy, between them and the thing they came
         for. Nothing true was deleted: the facts are unchanged and still
         stated where they are load-bearing.

         One line stays, because one thing here IS worth saying at the moment
         somebody looks at their card: AMV never had the number. */
      /* USAGE LAST (Nov 10). It sat between the plan and Payment: four stat
         tiles, a chart and a device tally standing between somebody and the
         card, the invoice or the cancel button they opened billing for. The
         subscription now reads the way the ones people know read - plan,
         payment, invoices, cancel - and what has been used follows it. The one-line
         note about the card stays last. */

      '<p class="bill-sec-line">Card details are held by our payment processor, never by AMV. '+
        'We keep the last four digits so you can tell which card is on file.</p>'+
      (isAdmin()?(
      '<div class="ss2" style="border:1px dashed var(--bd);border-radius:var(--r-md);padding:14px 16px">'+
        '<h3 style="margin-top:0">Payment test mode <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(only you see this)</span></h3>'+
        '<p style="font-size:var(--t-sm);color:var(--mu);line-height:1.6;margin:0 0 10px">Simulate a completed checkout to verify the success flow end to end - plan gating, UI refresh, and confirmation - before your live payment keys are connected. This changes only your local plan; it never charges anything.</p>'+
        '<div style="display:flex;gap:7px;flex-wrap:wrap">'+
          ['pro','elite','ultra'].map(pl=>'<button class="btn" data-simpay="'+pl+'" style="font-size:var(--t-sm)">Simulate '+(PLANS[pl]?PLANS[pl].name:pl)+'</button>').join('')+
          '<button class="btn" data-simpay="free" style="font-size:var(--t-sm)">Reset to Free</button>'+
        '</div>'+
      '</div>'
      ):'')+
    '</div></div>';

  /* The billing portal is where a paying customer changes their card or
     cancels. It was opened AFTER awaiting the session call, which spends the
     click's user activation - so Safari and Firefox blocked it and the
     customer's only route to their own billing was a pop-up warning. Somebody
     who cannot cancel from inside the product asks their bank instead, and a
     chargeback costs far more than the subscription. Opened on the click now. */
  const openPortal=async ()=>{
    const pre=(typeof _preopenPay==='function')?_preopenPay():null;
    if(liveBackend){
      const cust=loadStr('amv_stripe_customer');
      try{ const u=await AMV_API.portal(cust||email); if(u){ _openExternalPay(u,null,'portal',pre); return; } }catch(e){}
    }
    if(portal){ _openExternalPay(portal,null,'portal',pre); return; }
    if(typeof _closePay==='function') _closePay(pre);
    toast('Billing portal activates once your backend is connected','info',4000);
  };
  const pb=$('portal-open-btn'); if(pb) on(pb,'click',openPortal);
  /* The meters' painter lives in usage.js, fetched on demand - so it is
     fetched here when Billing is opened first, rather than called bare and
     missing on every visit that has not opened Usage yet. */
  /* The meters paint from the last answer at once when usage.js is already
     here (it is after the first visit), and refresh in place - so the card
     does not appear in one shape and change to another (owner, Nov 24). */
  if($('srv-usage') && typeof window._paintServerUsage === 'function'){
    try{ window._paintServerUsage(); }catch(e){ try{ console.error('AMV: usage meters could not be drawn', e); }catch(_){} }
  }
  else if($('srv-usage')){ _usageLoad().then(ok => {
    if(!ok || typeof window._paintServerUsage !== 'function'){ const el = $('srv-usage'); if(el) el.innerHTML = '<div class="srv-off">' + escH(T('That could not be loaded. Check your connection and try again.')) + '</div>'; return; }
    try{ window._paintServerUsage(); }catch(e){ try{ console.error('AMV: usage meters could not be drawn', e); }catch(_){} }
  }); }
  /* AUTO-RENEW. The server writes the field at Stripe and answers with what
     the subscription became, so what lands back on the screen was read back
     rather than assumed. Nothing local is set on the way: a failed call leaves
     the screen saying exactly what it said before, which is the truth. */
  if($('bill-credit') && window.AMV_API && AMV_API.live){
    /* The last balance this tab read, shown at once and refreshed in place,
       instead of an ellipsis that becomes a sentence a moment later. */
    const credTxt=d=>'$'+(+d.balance||0).toFixed(2)+' '+T('balance, used only after your plan\u2019s allowance')
        +(d.mode==='ask'?' \u00b7 '+T('asks first'):d.mode==='stop'?' \u00b7 '+T('set never to be used'):'');
    if(_billCreditLast && _billCreditLast.who===email) $('bill-credit').textContent=credTxt(_billCreditLast.d);
    AMV_API._fetch('/v1/credit',{method:'GET',timeout:10000}).then(r=>r.json()).then(d=>{
      if(d&&d.ok) _billCreditLast={ who:email, d };
      const el=$('bill-credit'); if(el&&d&&d.ok) el.textContent=credTxt(d);
    }).catch(()=>{ const el=$('bill-credit'); if(el && !(_billCreditLast && _billCreditLast.who===email)) el.textContent=T('Could not load the balance.'); });
  } else if($('bill-credit')){
    $('bill-credit').textContent=T('Available once AMV\u2019s server is connected.');
    /* A button that can only fail is not offered. */
    const add=document.querySelector('.bill-credit-add'); if(add) add.remove();
  }
  /* The Refund section lives in settings-panes.js (fetched with Settings,
     prefetched when the page is idle) - only paying customers ever see it. */
  try{ _lazyLoad('settings-panes.js', () => typeof window._billRefundFill === 'function')
    .then(ok => { if(ok) window._billRefundFill(targetEl); })
    .catch(e => { try{ console.error('AMV: the refund section could not load', e); }catch(_){} }); }
  catch(e){ try{ console.error('AMV: the refund section could not load', e); }catch(_){} }
  on($('bill-ar-go'),'click',()=>{
    const b=$('bill-ar-go'); if(!b) return;
    const turningOn=b.dataset.on==='1';
    const apply=async()=>{
      const was=b.textContent;
      b.disabled=true; b.textContent=turningOn?T('Turning on\u2026'):T('Turning off\u2026');
      try{
        const d=await AMV_API.autoRenew(turningOn);
        try{ S.renewal=Object.assign({}, S.renewal||{}, d.renewal||{}, {manageable:true}); }catch(e){}
        renderBillingView(targetEl);
        toast(turningOn
          ? T('Auto-renew is back on.')
          : T('Auto-renew is off. Your plan runs to the end of the period you have paid for.'),'success',5000);
      }catch(e){
        b.disabled=false; b.textContent=was;
        /* A deployment with no processor connected is not a failed change -
           nothing was attempted. It says so in the words the rest of the
           payment surfaces use. */
        toast(e && e.code==='needs_service'
          ? T('Payments are not connected on this deployment yet, so auto-renew cannot be changed here.')
          : T('Could not change auto-renew: ')+((e&&e.message)||T('try again')),'error',5000);
      }
    };
    /* Turning it back on costs nothing and is immediate. Turning it OFF ends
       something somebody is paying for, so it is asked first - and the
       question states what they keep, because the fear at this button is
       losing access today. */
    if(turningOn) return apply();
    const until=nextDate?(' '+T('You keep everything until')+' '+fmt(nextDate)+'.'):'';
    const asked=(typeof confirmModal==='function') && confirmModal(
      T('Turn off auto-renew?'),
      T('Your plan will not renew and nothing more will be charged.')+until+' '+T('You can turn it back on any time before then.'),
      apply, { confirm: T('Turn it off'), cancel: T('Keep auto-renew') });
    /* If the question could not be asked, the change is not made. An unasked
       destructive action is the thing the confirm was for. */
    if(!asked) toast(T('Could not open the confirmation, so nothing was changed.'),'error',5000);
  });
  on($('bill-cancel'),'click',async()=>{
    const say=t=>{ const el=$('bill-cancel-say'); if(el) el.textContent=t||''; };
    if(liveBackend){
      /* The processor is the only thing that can actually stop the billing, so
         that is where this goes. Never a local flag pretending it worked. */
      say('Opening your billing to cancel\u2026');
      /* Same activation rule as Manage billing above. A cancel button the
         browser blocks is the shortest path to a chargeback. */
      const pre=(typeof _preopenPay==='function')?_preopenPay():null;
      try{
        const url=await AMV_API.portal(loadStr('amv_stripe_customer')||email);
        _openExternalPay(url,null,'portal',pre);
        say('Cancel it in the window that just opened. Nothing has changed yet.');
      }catch(e){
        if(typeof _closePay==='function') _closePay(pre);
        say('Could not open billing, so nothing was cancelled. Try again, or email support and we will do it for you.');
      }
      return;
    }
    /* No backend: there is no subscription to cancel, so switching locally is
       the whole truth rather than a pretence. */
    _switchPlan('free');
  });
  vc.querySelectorAll('[data-simpay]').forEach(b=>on(b,'click',()=>{
    const pl=b.dataset.simpay;
    if(pl==='free'){ _setPlan('free'); renderBillingView(); toast('Test: reset to Free plan','info'); }
    else handlePaymentSuccess(pl,{simulated:true});
  }));
  const rz=$('bill-resize'); if(rz) on(rz,'click',openCustomPlan);
  /* The `.inv-view` buttons this used to wire were part of the invented
     invoice table and are gone with it. A real invoice carries its own PDF
     link from the processor, rendered by `_loadInvoices`. */
  // load real invoice history when the backend is connected
  if(plan!=='free' && liveBackend){ _loadInvoices(); }
}
/* Fetch and render the user's invoice history into the billing view. */
async function _loadInvoices(){
  const el=$('bill-invoices'); if(!el) return;
  const base=apiBase()||''; const tok=(window.AMV_API&&AMV_API.token)||'';
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
        (safeUrl(v.pdf)?'<a class="bill-inv-dl" href="'+escH(safeUrl(v.pdf))+'" target="_blank" rel="noopener noreferrer">Download</a>':'')+
        '</div></div>';
    }).join('')+'</div>';
  }catch(e){ if(el) el.innerHTML='<div class="bill-inv-empty">Couldn\u2019t load invoices right now.</div>'; _logErr('loadInvoices',e); }
}
/* A real definition list rather than rows of spans, because that is what these
   are and because a screen reader then reads the label with its value instead
   of eight loose fragments. `v` is already escaped or already markup at every
   call site.

   It replaced `_drow`, which stood here and rendered the same facts as two
   spans in a div. That had exactly one caller - the subscription-details block
   that was merged away - so it left with it rather than staying as a second
   way to draw a row that nothing draws. */
function _bfact(k,v){ return '<div class="bill-fact"><dt>'+escH(k)+'</dt><dd>'+v+'</dd></div>'; }

/* ══════ THE PLAN COMPARISON AND THE CUSTOM PLAN BUILDER - moved here from
   08-admin-fraud.js (Nov 25); the page keeps stand-ins that fetch this file. ══════ */
function openPlanCompare(highlight){
  const r=$('ovr'); if(!r) return;
  const plans=['free','pro','elite','ultra','custom'];
  const isC=p=>p==='custom';
  const rows=[
    ['Price', p=>isC(p)?'From $10':(p==='free'?'$0':'$'+PLANS[p].price+'/mo')],
    /* MESSAGES BEFORE TOKENS, AND THE WINDOWS BEFORE THE TOTAL.

       "2.3M tokens a month" was the only usage row, and it is the figure
       somebody is least able to act on. The three rows below are the ones that
       decide what a day feels like, and all three are read from the tables the
       Worker enforces rather than typed in here. Tokens stay, last, because
       they are still the secondary guard and somebody comparing carefully will
       want them. */
    ['Messages every '+USAGE_WINDOW_HOURS+' hours (it resets)', p=>_msg5hLabel(isC(p)?'custom':p)],
    ['Top-engine messages a week', p=>{ const n=_planMsgNum(PLAN_TOP_WEEK,isC(p)?'custom':p); return n?n.toLocaleString():'-'; }],
    /* The month is the token allowance; the monthly MESSAGE ceiling is an
       anti-abuse number that allowance runs out long before, so it is not a
       row anybody should compare plans on. */
    ['Monthly allowance (tokens)', p=>isC(p)?'You choose':((PLANS[p].allowance||'')+' a month')],
    ['AMV Pulse (fast)', p=>'\u2713'],
    ['AMV Core (balanced)', p=>'\u2713'],
    ['AMV Forge (coding)', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=1?'\u2713':'-')],
    ['AMV Apex (flagship)', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=2?'\u2713':'-')],
    ['Autonomous agents & Crew', p=>p==='free'?'-':'\u2713'],
    ['Full-stack builder (frontend + backend + auth)', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=2?'\u2713':(p==='pro'?'Frontend':'-'))],
    ['One-click deploy to a live URL', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=2?'\u2713':'-')],
    ['Download full multi-file projects', p=>p==='free'?'-':'\u2713'],
    ['Deploy & host multiple live apps', p=>isC(p)?'-':(PLAN_RANK[p]>=3?'\u2713':'-')],
    ['Autonomous multi-step projects', p=>isC(p)?'\u2713':(PLAN_RANK[p]>=3?'\u2713':(PLAN_RANK[p]>=2?'Limited':'-'))],
    ['Context window (how much it holds)', p=>p==='free'?'Standard':(PLAN_RANK[p]>=3?'Whole codebase':(PLAN_RANK[p]>=2?'Extra-large':'Large'))],
    /* No "Image generation" row. It sat here claiming a tick on every tier -
       on the detailed comparison somebody opens precisely when they are trying
       to work out what the money buys - for a feature that was removed from
       the product. A comparison table is a promise in a grid. */
    /* Was "Limited / Up to 5 / Unlimited" for parallel agents, which nothing
       enforced at any tier. This is the throughput limit that is real, and it
       is read from the table the Worker checks against. */
    ['Requests a minute (how much runs at once)', p=>_rpmCell(p)],
    /* The number, not a word the server has never honoured. AUTO_MAX_BY_PLAN
       is the thing that decides, and it is what this row now reads. */
    ['Scheduled & background jobs', p=>String(_autoMaxForPlan(p))],
    ['Connect Gmail, Drive, Calendar, GitHub', p=>p==='free'?'-':'\u2713'],
    /* "Early access to new features" and "Priority speed / Fastest hardware"
       were rows here. Nothing in AMV releases a feature to one plan first,
       and every plan runs on the same engines and the same hardware - the
       difference is how much, which the rows above already say in numbers. */
    ['Team workspaces (roles, shared projects)', p=>isC(p)?'-':(PLAN_RANK[p]>=3?'\u2713':'-')],
    ['Support', p=>isC(p)?'Priority':(PLAN_RANK[p]>=3?'Dedicated':(PLAN_RANK[p]>=2?'Priority 24/7':(p==='pro'?'Priority':'Community')))],
    ['Hard cap (no overage)', p=>p==='free'?'-':'\u2713'],
  ];
  const colName=p=>isC(p)?'Custom':PLANS[p].name;
  const head='<th></th>'+plans.map(p=>'<th class="'+(p===highlight?'pc-hl':'')+'">'+colName(p)+(p===highlight?'<span class="pc-tag">Recommended</span>':'')+'</th>').join('');
  const body=rows.map(([label,fn])=>'<tr><td class="pc-row">'+label+'</td>'+plans.map(p=>'<td class="'+(p===highlight?'pc-hl':'')+'">'+fn(p)+'</td>').join('')+'</tr>').join('');
  const cta='<tr><td></td>'+plans.map(p=>'<td class="'+(p===highlight?'pc-hl':'')+'">'+(p==='free'?'':'<button class="btn '+(p===highlight?'bp':'')+' pc-go" data-pcgo="'+p+'" style="font-size:var(--t-xs);padding:6px 9px">'+(isC(p)?'Build':'Get')+'</button>')+'</td>').join('')+'</tr>';
  r.innerHTML='<div class="upg-ov" id="pc-bg"><div class="pc-modal">'+
    '<button class="dna-x" id="pc-x" style="position:absolute;top:16px;right:16px;z-index:2">\u2715</button>'+
    '<div class="pc-head"><h2>Compare plans</h2><p>Everything each plan includes - pick what fits how you work.</p></div>'+
    '<div class="pc-scroll"><table class="pc-table"><thead><tr>'+head+'</tr></thead><tbody>'+body+cta+'</tbody></table></div>'+
  '</div></div>';
  const close=()=>{ r.innerHTML=''; };
  onBackdrop($('pc-bg'),close); on($('pc-x'),'click',close);
  r.querySelectorAll('[data-pcgo]').forEach(btn=>on(btn,'click',()=>{ const k=btn.dataset.pcgo; close(); if(k==='custom'){ openCustomPlan(); } else if(typeof openUpgrade==='function'){ openUpgrade(k); } else { openCheckout(k); } }));
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
    r.innerHTML='<div class="upg-ov" id="cp-bg"><div class="cp-modal">'+
      '<button class="dna-x" id="cp-x" style="position:absolute;top:16px;right:16px">\u2715</button>'+
      '<div class="cp-head"><span class="eyebrow" style="color:var(--accent-txt)">Custom plan</span>'+
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
        '<div class="cp-incl-list" id="cp-incl-list">'+_cpInclFeatures(s.hasApex).map(f=>'<span>\u2713 '+escH(T(f))+'</span>').join('')+'</div></div>'+
      '<button class="btn bp cp-go" id="cp-buy">Get Custom - $'+price+'/mo</button>'+
      '<p class="cp-fine">Usage is capped at your plan size. The message window resets every '+USAGE_WINDOW_HOURS+' hours and the token allowance monthly; unused usage doesn\u2019t roll over. Cancel or resize anytime.</p>'+
    '</div></div>';
    const close=()=>{ r.innerHTML=''; };
    onBackdrop($('cp-bg'),close); on($('cp-x'),'click',close);
    const _cpLocal=()=>{ const el=$('cp-local'); if(el) el.textContent=(window.AMVCurrency&&AMVCurrency.isLocal())?('≈ '+AMVCurrency.fmt(price)+' /mo in your currency'):''; };
    _cpLocal();
    const sl=$('cp-slider');
    on(sl,'input',()=>{ price=parseInt(sl.value,10); const ps=_customPlanSummary(price);
      $('cp-price').textContent=price; _cpLocal();
      const g=r.querySelectorAll('.cp-stat-n');
      if(g.length>=4){ g[0].textContent=ps.monthlyTokens.toLocaleString(); g[1].textContent=ps.hasApex?ps.apexTokens.toLocaleString():('$'+CUSTOM_PLAN.APEX_MIN_PRICE+'+'); g[2].textContent='~'+ps.approxMessages.toLocaleString(); g[3].textContent=ps.dailyCap.toLocaleString(); }
      const gl=r.querySelectorAll('.cp-stat-l'); if(gl.length>=2) gl[1].textContent=ps.hasApex?'tokens on Apex':'unlocks top models';
      const incl=$('cp-incl-list'); if(incl) incl.innerHTML=_cpInclFeatures(ps.hasApex).map(f=>'<span>✓ '+escH(T(f))+'</span>').join('');
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
    /* NOT "Images, video & 3D". Image and video generation were removed from
       this product end to end, and a plan's feature list is the single worst
       place for a promise of something that does not exist - somebody reads it
       while deciding what to pay. AMV reads an image you upload; it does not
       make one. */
    'Reads your files and images \u00b7 interactive 3D',
    'Build & ship apps',
    /* NOT "Priority speed" either: there is no priority queue and no faster
       hardware for any plan, so it was a promise the server never keeps. */
    'Hard cap - no overage charges'
  ];
}
window.openCustomPlan=openCustomPlan;
window.openUpgradeModal=openUpgradeModal;
