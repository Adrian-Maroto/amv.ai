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
    /* Into the slot the billing view leaves for them, so the pane reads
       plan -> usage -> what you could move to -> how payments are protected. */
    const slot=$('bill-usage-slot');
    if(!only) _setAppendSection(pane, 'usage', slot);
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
      '</div>'+
      ((window.AMV_API && AMV_API.live && AMV_API.hasSession) ? '<div id="sec-mfa" aria-live="polite"><div class="ss2"><h3>'+escH(T('Passkeys'))+'</h3><div class="set-sub">'+escH(T('Loading…'))+'</div></div></div>' : '')+
      _activeSessionsHTML();
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
    const isDark=!document.body.classList.contains('light');
    const curFs=parseInt(loadStr('amv_fs')||'14',10);
    const fsBtn=(px,label)=>'<button class="fs-opt'+(curFs===px?' on':'')+'" data-fs="'+px+'"><span class="fs-pv" style="font-size:'+(px+1)+'px">Aa</span><span class="fs-lbl">'+label+'</span></button>';
    pane.innerHTML=
      '<h2 class="set-title">Appearance</h2>'+
      '<div class="set-sub">Customize how AMV.AI looks and feels. Changes apply instantly across the whole app.</div>'+
      '<div class="ss2"><h3>Theme</h3>'+
        '<div class="br2"><div><div class="opt-name">Dark Mode</div><div class="opt-desc">Deep dark, easy on the eyes</div></div>'+
          '<label class="sw"><input type="checkbox" id="dark-sw" '+(isDark?'checked':'')+' ><span class="sw-sl"></span></label>'+
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
    on($('dark-sw'),'change',function(){ document.body.classList.toggle('light',!this.checked); saveStr('amv_theme',this.checked?'dark':'light'); });
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
        escH(T('Every screen - chat, Crew, Studio, Dev, Lab, the marketplace, settings - switches with it straight away. What you type, and the names of people and apps, stay exactly as they are.'))+'</p></div>'+
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
      '<div class="set-sub">AMV runs on your secure backend. The AI key lives <b>only on your server</b> - never in the browser - so usage, billing, and limits are always enforced and can never be bypassed.</div>'+
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
      if(!_cl.querySelector('.int-card')) _cl.innerHTML='<p class="set-empty">'+escH(T('Nothing is connected yet.'))+'</p>';
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
