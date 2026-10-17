/* ============================================================
   APPROVAL + PREVIEW WORKSPACE  (Phase 1 of the Mission Control redesign)
   ------------------------------------------------------------
   Task -> Plan -> Agent execution -> PREVIEW -> APPROVAL -> Final action.
   AMV stops before any consequential external action unless Auto Approve
   is on. This module renders the "Needs your approval" cards and the full
   Preview workspace: the finished result, what happened while you were away,
   the Crew that did it, artifact handoffs, and a plain-language final-action
   summary with a specific Approve button.

   Everything renders from real data on the approval object and degrades
   honestly: sections with no data are hidden, never fabricated. No token
   cost, model cost, or price is ever shown on an approval or preview.
   ============================================================ */

/* Derive the specific final action from the approval's actionType. */
function _apvAction(a){
  const t=(a.actionType||'').toLowerCase();
  const n=a.recipients, dest=a.destination||'', when=a.scheduledAt||'';
  const map={
    send:    {btn:'Approve & send',     verb:'send',     line:'Approve to send this '+(a.resultType==='email'?'email':'message')+(n!=null?(' to '+n+' recipient'+(n===1?'':'s')):(dest?(' to '+dest):''))+'.'},
    publish: {btn:'Approve & publish',  verb:'publish',  line:'Approve to publish'+(dest?(' to '+dest):' this')+(when?(' on '+when):'')+'.'},
    schedule:{btn:'Approve & schedule', verb:'schedule', line:'Approve to schedule this'+(when?(' for '+when):'')+'.'},
    post:    {btn:'Approve & post',     verb:'post',     line:'Approve to post'+(dest?(' to '+dest):'')+(when?(' - scheduled for '+when):'')+'.'},
    submit:  {btn:'Approve & submit',   verb:'submit',   line:'Approve to submit this'+(dest?(' to '+dest):'')+'.'},
    update:  {btn:'Approve & update',   verb:'update',   line:'Approve to update'+(n!=null?(' '+n+' record'+(n===1?'':'s')):(dest?(' '+dest):' this data'))+'.'},
    deploy:  {btn:'Approve & deploy',   verb:'deploy',   line:'Approve to deploy'+(dest?(' to '+dest):'')+'.'}
  };
  return map[t]||{btn:'Approve', verb:'approve', line:'Approve to complete this action.'};
}

/* Human "x ago" / "in x" for timestamps (accepts ms epoch or a string). */
function _apvAgo(ts){
  if(typeof ts!=='number') return String(ts||'');
  const d=Date.now()-ts, abs=Math.abs(d), fut=d<0;
  const m=Math.round(abs/6e4), h=Math.round(abs/36e5), day=Math.round(abs/864e5);
  let s = m<1?'just now' : m<60?(m+' min') : h<24?(h+' hr') : (day+' day'+(day===1?'':'s'));
  if(s==='just now') return s;
  return fut ? ('in '+s) : (s+' ago');
}

/* ---- the finished result, rendered as close to reality as the data allows ---- */
function _apvFrame(a){
  const r=a.result||{}, type=r.type||a.resultType||'doc';
  const par=txt=>String(txt||'').split(/\n\n+/).map(p=>'<p>'+escH(p).replace(/\n/g,'<br>')+'</p>').join('');
  if(type==='email'){
    return `<div class="pvw-frame email"><div class="pvw-mail">
      <div class="pvw-mail-hd">
        <div class="pvw-mail-row"><span class="pvw-mail-k">From</span><span>${escH(r.from||'you@amv.dev')}</span></div>
        <div class="pvw-mail-row"><span class="pvw-mail-k">To</span><span>${escH(r.to||a.destination||'')}</span></div>
        <div class="pvw-mail-row subj"><span class="pvw-mail-k">Subject</span><span>${escH(r.subject||a.title||'')}</span></div>
      </div>
      <div class="pvw-mail-body">${par(r.body||a.preview)}</div>
    </div></div>`;
  }
  if(type==='social'){
    const plat=(r.platform||'Post');
    return `<div class="pvw-frame social"><div class="pvw-post">
      <div class="pvw-post-hd"><span class="pvw-post-av">${escH((r.handle||'A').replace(/^@/,'')[0]||'A').toUpperCase()}</span>
        <div><div class="pvw-post-name">${escH(r.name||S.user?.name||'You')}</div><div class="pvw-post-h">${escH(r.handle||'')} · ${escH(plat)}</div></div></div>
      <div class="pvw-post-body">${par(r.text||a.preview)}</div>
      ${r.image?`<div class="pvw-post-img" style="background-image:url('${encodeURI(r.image)}')"></div>`:''}
    </div></div>`;
  }
  if(type==='website'){
    /* Carried on the element and hydrated once it is in the DOM, the same as
       the live cards in chat: this markup is built as a string, so there is no
       element to hand the page to yet. */
    const src=r.html?` data-amv-preview="${escH(r.html)}"`:'';
    const note=r.html?'':`<div class="pvw-web-note">Live preview appears here after the site is generated.</div>`;
    return `<div class="pvw-frame web"><div class="pvw-web-tabs"><button class="pvw-web-tab on" data-apvweb="desk">Desktop</button><button class="pvw-web-tab" data-apvweb="mob">Mobile</button><span class="pvw-web-url">${escH(r.url||a.destination||'')}</span></div>
      <div class="pvw-web-stage desk"><div class="pvw-web-frame">${r.html?`<iframe class="pvw-web-if" title="Website preview" sandbox="allow-scripts"${src}></iframe>`:note}</div></div></div>`;
  }
  if(type==='data'){
    const rows=(r.rows||[]);
    return `<div class="pvw-frame data"><div class="pvw-data-lead">${escH(r.summary||((rows.length||a.recipients||0)+' record'+((rows.length||a.recipients)===1?'':'s')+' will change'))}</div>
      <table class="pvw-data-tbl"><thead><tr><th>Field</th><th>Current</th><th>New</th></tr></thead>
      <tbody>${rows.slice(0,60).map(x=>`<tr><td>${escH(x.field||'')}</td><td class="old">${escH(x.old==null?'-':x.old)}</td><td class="new">${escH(x.new==null?'-':x.new)}</td></tr>`).join('')||`<tr><td colspan="3" class="pvw-empty-cell">Change details appear here.</td></tr>`}</tbody></table></div>`;
  }
  // report / doc / generic
  return `<div class="pvw-frame doc"><div class="pvw-doc">${r.title?`<h1>${escH(r.title)}</h1>`:''}<div class="pvw-doc-body">${par(r.body||a.preview)}</div></div></div>`;
}

/* ---- what happened while you were away: a readable work history ---- */
function _apvTimeline(a){
  const tl=a.timeline||[];
  if(!tl.length){
    const bits=[];
    if(a.startedAt) bits.push('Started '+_apvAgo(a.startedAt));
    if(a.readyAt) bits.push('Ready '+_apvAgo(a.readyAt));
    if(!bits.length) return '';
    return `<div class="pvw-sec"><div class="pvw-sec-h">Activity</div><div class="pvw-tl-min">${escH(bits.join(' · '))}</div></div>`;
  }
  return `<div class="pvw-sec"><div class="pvw-sec-h">What happened while you were away</div>
    <ol class="pvw-tl">${tl.map(e=>`<li class="pvw-tl-ev"><span class="pvw-tl-dot"></span>
      <div class="pvw-tl-b"><div class="pvw-tl-top"><span class="pvw-tl-agent">${escH(e.agent||'AMV')}</span><span class="pvw-tl-t">${escH(e.t||'')}</span></div>
      <div class="pvw-tl-txt">${escH(e.text||'')}</div></div></li>`).join('')}</ol></div>`;
}

/* ---- the Crew: restrained identity (initials + role + status dot) ---- */
function _apvCrew(a){
  const crew=a.crew||[];
  if(!crew.length) return '';
  const ini=n=>String(n||'A').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return `<div class="pvw-sec"><div class="pvw-sec-h">Crew</div>
    <div class="pvw-crew">${crew.map((c,i)=>`<div class="pvw-agent">
      <span class="pvw-agent-mk m${i%5}">${escH(ini(c.name||c.role))}</span>
      <div class="pvw-agent-b"><div class="pvw-agent-role">${escH(c.role||c.name||'Agent')}</div>
        <div class="pvw-agent-resp">${escH(c.resp||'')}</div></div>
      <span class="pvw-agent-st ${c.status==='done'?'done':c.status==='blocked'?'blocked':'active'}">${escH(c.status==='done'?'Done':c.status==='blocked'?'Blocked':c.status||'Working')}</span>
    </div>`).join('')}</div></div>`;
}

/* ---- artifact handoffs: click an artifact to inspect it ---- */
function _apvArtifacts(a){
  const arts=a.artifacts||[];
  if(!arts.length) return '';
  return `<div class="pvw-sec"><div class="pvw-sec-h">Work handed between agents</div>
    <div class="pvw-hand">${arts.map((x,i)=>`<div class="pvw-hand-row">
      <span class="pvw-hand-a">${escH(x.from||'')}</span>
      <button class="pvw-hand-art" data-apvart="${i}" title="Inspect">${escH(x.name||'artifact')}</button>
      <span class="pvw-hand-arrow">→</span><span class="pvw-hand-a">${escH(x.to||'')}</span>
    </div>`).join('')}</div></div>`;
}

/* Skeleton shown while a preview's data / iframe is genuinely loading. */
function _apvSkeleton(){
  return `<div class="pvw-body"><main class="pvw-stage"><div class="pvw-skel-frame">
      <div class="skel skel-l"></div><div class="skel skel-l"></div><div class="skel skel-l w70"></div>
      <div class="skel skel-block"></div><div class="skel skel-l"></div><div class="skel skel-l w80"></div></div></main>
    <aside class="pvw-side"><div class="skel skel-card"></div><div class="skel skel-card"></div></aside></div>`;
}

/* Open the full-page Preview workspace for an approval. */
function apvPreview(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ toast('That item is no longer waiting','info'); return; }
  const r=$('ovr'); if(!r) return;
  const act=_apvAction(a);
  // Shell + skeleton first (real progressive render; iframe results keep the skeleton until load).
  r.innerHTML=`<div class="ov pvw-ov" id="pvw-bg"><div class="pvw" role="dialog" aria-modal="true" aria-label="Preview and approve">
    <header class="pvw-top">
      <button class="pvw-back" data-dact="apvClose" aria-label="Back">← <span>Back</span></button>
      <div class="pvw-top-mid"><span class="pvw-top-ic">${a.icon||'✉️'}</span><span class="pvw-top-t">${escH(a.title)}</span>${a.project?`<span class="pvw-chip">${escH(a.project)}</span>`:''}</div>
      <div class="pvw-top-r">${a.timeline&&a.timeline.length?`<button class="pvw-quiet" data-apvhist="1">View history</button>`:''}<span class="pvw-mode ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Auto-approve off'}</span></div>
    </header>
    <div id="pvw-mount">${_apvSkeleton()}</div>
    <footer class="pvw-foot">
      <div class="pvw-foot-line"><span class="pvw-foot-ic">●</span>${escH(act.line)}</div>
      <div class="pvw-foot-act">
        <button class="btn pvw-revise" data-dact="apvRevise" data-darg="${a.id}">Ask AMV to revise</button>
        <button class="btn pvw-edit" data-dact="apvEdit" data-darg="${a.id}">Edit</button>
        <button class="btn pvw-reject" data-dact="apvReject" data-darg="${a.id}">Reject</button>
        <button class="btn pvw-approve" data-dact="apvApprove" data-darg="${a.id}">${escH(act.btn)}</button>
      </div>
      <button class="pvw-more" data-apvmore="1" aria-label="More actions">⋯</button>
    </footer>
  </div></div>`;
  onBackdrop($('pvw-bg'),apvClose);
  setTimeout(()=>{ try{ document.querySelector('.pvw-back').focus(); }catch(e){} },30);
  const hist=r.querySelector('[data-apvhist]'); if(hist) on(hist,'click',()=>{ const s=r.querySelector('.pvw-side'); if(s) s.scrollIntoView({behavior:'smooth'}); });
  const more=r.querySelector('[data-apvmore]'); if(more) on(more,'click',()=>r.querySelector('.pvw-foot-act')?.classList.toggle('open'));
  // Progressive render: paint the skeleton, then mount the real content next frame.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const m=$('pvw-mount'); if(!m) return;
    m.innerHTML=`<div class="pvw-body">
      <main class="pvw-stage">
        <div class="pvw-stage-h"><span>Final result</span><span class="pvw-stage-sub">This is exactly what will ${escH(act.verb)}.</span></div>
        ${_apvFrame(a)}
      </main>
      <aside class="pvw-side">
        <div class="pvw-final">
          <div class="pvw-final-h">Before you approve</div>
          <div class="pvw-final-line">${escH(act.line)}</div>
          ${a.warning?`<div class="pvw-final-warn">${escH(a.warning)}</div>`:''}
          <div class="pvw-final-meta">
            ${a.crewName?`<span class="pvw-fm"><span>Crew</span>${escH(a.crewName)}</span>`:''}
            ${a.destination?`<span class="pvw-fm"><span>Destination</span>${escH(a.destination)}</span>`:''}
            ${a.scheduledAt?`<span class="pvw-fm"><span>When</span>${escH(a.scheduledAt)}</span>`:''}
            ${a.account?`<span class="pvw-fm"><span>Account</span>${escH(a.account)}</span>`:''}
          </div>
        </div>
        ${_apvTimeline(a)}
        ${_apvCrew(a)}
        ${_apvArtifacts(a)}
      </aside>
    </div>`;
    // website preview: reveal iframe only once it has genuinely loaded
    const ifr=m.querySelector('.pvw-web-if');
    if(ifr){ ifr.style.opacity='0'; ifr.addEventListener('load',()=>{ ifr.style.transition='opacity .2s'; ifr.style.opacity='1'; }); }
    m.querySelectorAll('[data-apvweb]').forEach(b=>on(b,'click',()=>{ m.querySelectorAll('[data-apvweb]').forEach(x=>x.classList.remove('on')); b.classList.add('on'); const st=m.querySelector('.pvw-web-stage'); if(st){ st.classList.toggle('mob',b.dataset.apvweb==='mob'); st.classList.toggle('desk',b.dataset.apvweb==='desk'); } }));
    m.querySelectorAll('[data-apvart]').forEach(b=>on(b,'click',()=>{ const art=(a.artifacts||[])[+b.dataset.apvart]; if(art) _apvInspectArtifact(art); }));
  }));
}
function apvClose(){ const x=$('ovr'); if(x) x.innerHTML=''; }
function _apvInspectArtifact(art){
  toast((art.name||'Artifact')+(art.note?(' - '+art.note):': intermediate work handed between agents'),'info',4200);
}
/* Approve straight from a card (no preview) with a confirm on the consequence. */
async function apvQuickApprove(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ renderCrewView(); return; }
  const act=_apvAction(a);
  if(!await showConfirmAsync(act.line)) return;
  await _apvDoApprove(a);
}
async function apvApprove(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ apvClose(); return; }
  apvClose();
  await _apvDoApprove(a);
}
const _APV_PAST={send:'Sent',publish:'Published',schedule:'Scheduled',post:'Posted',submit:'Submitted',update:'Updated',deploy:'Deployed',approve:'Done'};
/* Approving is what actually SENDS the thing. This fired the request, forgot
   it, removed the item from the queue, and said "Sent" - so a failed call meant
   nothing went out, the draft was gone, and the person believed their email had
   been sent. With no engine connected nothing was even attempted, and it still
   said "Sent". An email that was never sent, reported as sent, is the kind of
   mistake somebody loses a client over.

   It now waits, and on failure the approval STAYS in the queue, because the one
   thing worse than not sending is not sending and losing the draft too. */
async function _apvDoApprove(a){
  const act=_apvAction(a);
  const past=_APV_PAST[act.verb]||'Done';
  if(!(window.AMV_API && AMV_API.live)){
    toast('Nothing was '+String(past).toLowerCase()+' - AMV is not connected to a backend, so it has nowhere to send this. '+
          'It is still waiting for you.','error',7000);
    renderCrewView();
    return { ok:false, code:'needs_service' };
  }
  let d;
  try{
    d = await AMV_API.actApproval(a.id,'approve');
  }catch(e){
    toast('That was NOT '+String(past).toLowerCase()+(e&&e.message?' ('+e.message+')':'')+
          '. It is still in your approvals - try again.','error',7000);
    renderCrewView();
    return { ok:false, code:'failed', error:(e&&e.message)||'' };
  }
  /* THE SERVER HAD NOTHING TO SEND, WHICH IS NOT A SEND.

     `crewApprovalAct` answers `{found:false, delivered:null}` for any approval
     it does not hold - and it holds only the ones its own cron enqueued. Every
     card `_recurMakeApproval` builds lives in this browser's storage and has
     never been near the server, so `found:false` is the NORMAL answer for a
     job that only runs while AMV is open.

     `delivered` is null there, not false, so the check below sailed past it and
     the code fell through to `toast('Sent')` - after deleting the draft. The
     person was told their email had gone out, the draft was gone, and nothing
     had been sent to anybody. That is the exact failure the comment above this
     function describes as the one somebody loses a client over; it was fixed
     for a failed request and a missing provider, and this third way of getting
     there was left open.

     Only for a SEND. A review-only card genuinely is resolved by being read,
     and the server having no copy of it changes nothing about that. */
  if(d && d.found === false && a.actionType === 'send'){
    toast('That was NOT sent. This draft was made by a job that only runs on this device, so your '
        + 'backend has no copy of it and had nothing to send. It is still in your approvals - open it '
        + 'to copy the text, or set the job up again now that AMV is connected so it runs on the server.',
      'error', 10000);
    renderCrewView();
    return { ok:false, code:'not_on_server', delivered:false };
  }
  _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
  /* Somebody else is already delivering this one - a double press, a retry, a
     second tab. The server now refuses to send it twice, so this request made
     no send and must not claim one. "Already going out" is the true sentence
     and it is a reassurance, not an error: the work IS on its way. */
  if(d && d.duplicate){
    toast('Already going out - this was approved a moment ago, and AMV will not send it twice.','info',6000);
    renderCrewView();
    return { ok:true, duplicate:true, delivered:null };
  }
  /* "Sent" only when the server actually sent it. An item that was approved but
     has no email provider behind it is APPROVED, which is a different word. */
  if(d && d.delivered === false){
    toast('Approved, but not emailed - no email provider is connected to this deployment, so nothing left AMV.','info',7000);
  } else {
    toast(past,'success');
  }
  renderCrewView();
  return { ok:true, delivered: d ? d.delivered : null };
}
function apvReject(id){ apvClose(); cwReject(id); }
/* The body text of an approval, wherever it lives for that result type. */
function _apvBodyField(a){
  const r=a.result||{}; const type=r.type||a.resultType||'doc';
  if(type==='social') return r.text||a.preview||'';
  return r.body||a.preview||'';
}
/* Write an edited body back into the right field for the result type. */
function _apvSetBody(a,val){
  a.result=a.result||{}; const type=a.result.type||a.resultType||'doc';
  if(type==='social') a.result.text=val; else a.result.body=val;
  a.preview=val;
}
/* Full editor: change the message, who it goes to, and when - then save,
   send, or delete. Edits persist to the approval store (and the backend when
   connected), so what you approve is exactly what you edited. */
function apvEdit(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ toast('That item is no longer waiting','info'); return; }
  const r=$('ovr'); if(!r) return;
  const type=(a.result&&a.result.type)||a.resultType||'doc';
  const isEmail=type==='email';
  const to=(a.result&&a.result.to)||a.destination||'';
  const subject=(a.result&&a.result.subject)||a.title||'';
  const body=_apvBodyField(a);
  const when=a.scheduledAt||'';
  const recips=(a.recipients!=null)?a.recipients:'';
  r.innerHTML=`<div class="ov ape-ov" id="ape-bg"><div class="ape" role="dialog" aria-modal="true" aria-label="Edit before sending">
    <header class="ape-top">
      <button class="pvw-back ape-back" data-dact="apvClose" aria-label="Back">← <span>Back</span></button>
      <div class="ape-top-t">Edit before it sends</div>
      <span class="pvw-mode ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Needs approval'}</span>
    </header>
    <div class="ape-body">
      <label class="ape-f"><span>Title</span><input id="ape-title" type="text" value="${escH(a.title||'')}"></label>
      <label class="ape-f"><span>${isEmail?'To':'To / where it goes'}</span><input id="ape-to" type="text" value="${escH(to)}" placeholder="${isEmail?'who this email goes to':'who or where this goes'}"></label>
      <label class="ape-f"><span>Number of people</span><input id="ape-recips" type="number" min="0" value="${escH(String(recips))}" placeholder="how many recipients"></label>
      ${isEmail?`<label class="ape-f"><span>Subject</span><input id="ape-subject" type="text" value="${escH(subject)}"></label>`:''}
      <label class="ape-f"><span>Message</span><textarea id="ape-body" rows="10">${escH(body)}</textarea></label>
      <label class="ape-f"><span>When to send</span><input id="ape-when" type="text" value="${escH(when)}" placeholder='e.g. “now” or “Tomorrow 9:00 AM”'></label>
    </div>
    <footer class="ape-foot">
      <button class="btn ape-del" data-dact="_apvEditDelete" data-darg="${a.id}">Delete</button>
      <div class="ape-foot-r">
        <button class="btn ape-save" data-dact="_apvEditSave" data-darg="${a.id}">Save changes</button>
        <button class="btn pvw-approve" data-dact="_apvEditSend" data-darg="${a.id}">Save &amp; send</button>
      </div>
    </footer>
  </div></div>`;
  onBackdrop($('ape-bg'),apvClose);
  setTimeout(()=>{ try{ $('ape-title').focus(); }catch(e){} },30);
}
/* Turn a plain-English "when" into a normalized schedule. Understands "now",
   "every hour", "every day at 9", "every morning", "every Monday 9am",
   "weekly", "monthly", or a one-off phrase kept as-is. */
function _parseWhen(raw){
  const s=(raw||'').trim().toLowerCase();
  if(!s || /^(now|asap|immediately|right away)$/.test(s)) return {kind:'now', label:''};
  /* The time, to the minute. "7:30pm" used to become 7pm - the minutes were
     matched and dropped - and "overnight" had no meaning at all. */
  const timeFrom=(txt)=>{
    const m=txt.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || txt.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/) || txt.match(/\b(\d{1,2}):(\d{2})\b/);
    if(m){ let h=parseInt(m[1],10); const mi=m[2]?parseInt(m[2],10):0; const ap=(m[3]||'').toLowerCase();
      if(ap==='pm'&&h<12)h+=12; if(ap==='am'&&h===12)h=0; if(h>=0&&h<=23&&mi>=0&&mi<=59) return {hour:h, minute:mi}; }
    if(/\bovernight\b/.test(txt)) return {hour:3, minute:0};
    if(/\bmorning\b/.test(txt)) return {hour:9, minute:0};
    if(/\b(noon|midday)\b/.test(txt)) return {hour:12, minute:0};
    if(/\bafternoon\b/.test(txt)) return {hour:15, minute:0};
    if(/\b(evening|tonight)\b/.test(txt)) return {hour:19, minute:0};
    if(/\bnight\b/.test(txt)) return {hour:21, minute:0};
    return {hour:9, minute:0};
  };
  const DOW={sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,thursday:4,thu:4,thurs:4,friday:5,fri:5,saturday:6,sat:6};
  const recurring=/\b(every|each|daily|weekly|hourly|monthly|weekdays|weekends|nightly|overnight)\b/.test(s);
  if(recurring){
    if(/\bevery\s+10\s*min/.test(s)) return {kind:'recurring', freq:'10min', label:'Every 10 minutes'};
    if(/\bevery\s+30\s*min|every half(?:\s|-)hour/.test(s)) return {kind:'recurring', freq:'30min', label:'Every 30 minutes'};
    if(/\bhour/.test(s)) return {kind:'recurring', freq:'hourly', label:'Every hour'};
    const t=timeFrom(s);
    let days=[]; for(const k in DOW){ if(new RegExp('\\b'+k+'s?\\b').test(s)) days.push(DOW[k]); }
    if(/\bweekdays?\b/.test(s)) days=days.concat([1,2,3,4,5]);
    if(/\bweekends?\b/.test(s)) days=days.concat([0,6]);
    days=[...new Set(days)].sort((a,b)=>a-b);
    if(days.length){ const sc={cad:'weekly',days,hour:t.hour,minute:t.minute}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    if(/\bweek/.test(s)){ const sc={cad:'weekly',days:[1],hour:t.hour,minute:t.minute}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    if(/\bmonth/.test(s)){
      /* "on the 15th", "the 1st of every month" - the first one by default. */
      const dm=s.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
      const dom=dm?Math.min(31,Math.max(1,parseInt(dm[1],10))):1;
      const sc={cad:'monthly',dom,hour:t.hour,minute:t.minute}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)};
    }
    const sc={cad:'daily',hour:t.hour,minute:t.minute}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)};
  }
  return {kind:'once', label:raw.trim()};
}
/* Read the form back into the approval object and persist it. Returns the
   updated approval (or null if it vanished). */
function _apvCollectEdit(id){
  const list=_cwApprovals(); const a=list.find(x=>x.id===id); if(!a) return null;
  const g=k=>{ const el=$(k); return el?el.value:undefined; };
  const title=g('ape-title'); if(title!=null) a.title=title.trim()||a.title;
  const to=g('ape-to');
  if(to!=null){ a.destination=to.trim(); a.result=a.result||{}; if((a.result.type||a.resultType||'doc')==='email') a.result.to=to.trim(); }
  const rc=g('ape-recips');
  if(rc!=null){ const n=parseInt(rc,10); a.recipients = (rc.trim()==='' || isNaN(n)) ? null : n; }
  const subj=g('ape-subject');
  if(subj!=null){ a.result=a.result||{}; a.result.subject=subj.trim(); }
  const body=g('ape-body'); if(body!=null) _apvSetBody(a,body);
  const when=g('ape-when');
  if(when!=null){
    const p=_parseWhen(when);
    a.scheduledAt = p.label || '';
    a._recur = (p.kind==='recurring') ? (p.sched?{sched:p.sched}:(p.freq?{freq:p.freq}:null)) : null;
    if(p.kind==='recurring') a.actionType='schedule';
    else if(p.kind==='once' && a.scheduledAt) a.actionType=a.actionType||'schedule';
  }
  // Emails always go FROM the signed-in account - never a placeholder.
  if((a.result&&a.result.type)==='email'){ a.result.from=(S.user&&S.user.email)||a.result.from||''; a.account=a.result.from; }
  _cwSaveApprovals(list);
  // Persist the edit to the backend when connected, so the real send uses it.
  if(window.AMV_API && AMV_API.live && typeof AMV_API._fetch==='function'){
    try{ AMV_API._fetch('/api/approvals/edit',{method:'POST',body:JSON.stringify({id:a.id,patch:{title:a.title,destination:a.destination,recipients:a.recipients,scheduledAt:a.scheduledAt,recurrence:a._recur,from:a.account,result:a.result}})}).catch(()=>{}); }catch(e){}
  }
  return a;
}
/* If the edit set a recurring "when", register it as scheduled work so it shows
   in Scheduled and actually recurs (backend when connected). Returns true if it
   became a schedule. */
/* Always returns a result OBJECT, never a bare boolean - three callers read
   this, and one of them was checking it for truthiness. Once it became async a
   bare promise would have been truthy every time, so every caller would have
   claimed the job was scheduled. `code:'none'` means there was nothing
   recurring to register at all. */
async function _apvRegisterRecur(a){
  if(!a._recur) return { ok:false, code:'none' };
  const list=_loadSched();
  const isEmail=(a.result&&a.result.type)==='email';
  const desc=isEmail?('Send email “'+(a.result.subject||a.title||'')+'” to '+(a.destination||a.result.to||'recipients')):('Do: '+(a.title||'task'));
  const item={id:'a'+Date.now(), goal:desc, approval:a.autoApprove?'auto':'require', created:Date.now(), lastRun:null};
  if(a._recur.sched){ item.sched=a._recur.sched; item.next=_schedNext(a._recur.sched,Date.now()); }
  else { item.freq=a._recur.freq||'daily'; item.next=_freqNext(item.freq,Date.now()); }
  list.push(item); _saveSched(list);
  /* Registered on the server, and the caller is told whether that worked -
     a recurring job that only exists in this browser runs when AMV is open and
     not otherwise, which is the opposite of what scheduling one means. */
  const res = await _mcScheduleServer({ goal:desc, sched:item.sched, freq:item.freq, approval:item.approval,
    payload:isEmail?{type:'email',result:a.result,to:a.destination,from:a.account}:null });
  if(res.id){ const l2=_loadSched(); const me=l2.find(x=>x.id===item.id); if(me){ me.autoId=res.id; _saveSched(l2); } }
  return res;
}
async function _apvEditSave(id){
  const a=_apvCollectEdit(id); if(!a){ apvClose(); return; } apvClose();
  if(a._recur){
    const res = await _apvRegisterRecur(a);
    _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
    toast('Scheduled - '+(a.scheduledAt||'recurring')+_mcWhereItRuns(res),
          res.ok?'success':'info', res.ok?3500:7000);
  }
  else toast('Changes saved','success');
  if(S.tab==='crew') renderCrewView();
}
async function _apvEditSend(id){
  const a=_apvCollectEdit(id); if(!a){ apvClose(); return; } apvClose();
  if(a._recur){
    const res = await _apvRegisterRecur(a);
    _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
    toast('Scheduled - '+(a.scheduledAt||'recurring')+_mcWhereItRuns(res),
          res.ok?'success':'info', res.ok?3500:7000);
    if(S.tab==='crew') renderCrewView();
    return;
  }
  await _apvDoApprove(a);
}
async function _apvEditDelete(id){ if(!await showConfirmAsync('Delete this draft?\n\nIt will not be sent, and it is not kept anywhere.')) return; apvClose(); cwReject(id); }
window._apvEditSave=_apvEditSave; window._apvEditSend=_apvEditSend; window._apvEditDelete=_apvEditDelete;
function apvRevise(id){
  const item=_cwApprovals().find(x=>x.id===id); apvClose();
  setTab('chat');
  setTimeout(()=>{ const ta=$('mta'); if(ta&&item){ ta.value='Revise this before it goes out - tell me what you changed and why:\n\n'+(item.result?.body||item.preview||item.title); ta.dispatchEvent(new Event('input')); ta.focus(); } },140);
}
window.apvPreview=apvPreview; window.apvClose=apvClose; window.apvApprove=apvApprove;
window.apvQuickApprove=apvQuickApprove; window.apvReject=apvReject; window.apvEdit=apvEdit; window.apvRevise=apvRevise;


