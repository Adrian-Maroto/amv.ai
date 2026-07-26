/* ============================================================
   AMV CO-WORKER  - autonomous agent: standing jobs + approval inbox
   The differentiator: it watches your connected accounts and proposes
   actions (draft replies, summaries, bookings). You approve or reject
   each one with a click. Nothing is sent without your OK.
   ============================================================ */
function _cwJobs(){ return load('amv_cw_jobs') || _cwDefaultJobs(); }
function _cwSaveJobs(j){ store('amv_cw_jobs', j); }
function _cwDefaultJobs(){ return [
  { id:'job_hunt', icon:'\uD83D\uDCBC', title:'Job hunt - find, apply, report', desc:'AMV finds roles matched to your resume, tailors an application to each, then (your choice) shows you before applying or applies on its own. Email-apply jobs it submits; portal jobs it fills for one-tap submit. If a posting asks something you have not specified, it asks you first. Emails a morning report.', needs:'Email, Web research', on:false },
  { id:'morning_brief', icon:'\u2600\uFE0F', title:'Morning news & markets brief', desc:'Every morning at 7am, AMV researches overnight news and market movements, then emails you a concise brief on what happened and which stocks to watch today.', needs:'Email, Web research', on:false },
  { id:'inbox_digest', icon:'\uD83D\uDCEC', title:'Daily inbox digest', desc:'AMV summarizes your important emails each evening and drafts replies for the ones that need them - you just approve and send.', needs:'Email', on:false },
  { id:'competitor_watch', icon:'\uD83D\uDD0D', title:'Competitor & industry watch', desc:'Weekly, AMV tracks your competitors and industry news, then emails you a summary of anything that matters.', needs:'Email, Web research', on:false },
  { id:'weekly_report', icon:'\uD83D\uDCCA', title:'Weekly summary report', desc:'Every Friday, AMV compiles your week - tasks done, key metrics, what\u2019s pending - into a clean report and emails it to you or your team.', needs:'Email', on:false },
  { id:'content_calendar', icon:'\u270D\uFE0F', title:'Social content drafts', desc:'AMV drafts a week of social posts based on trends in your space and queues them for your approval.', needs:'Web research', on:false },
]; }
function _cwApprovals(){ return load('amv_cw_approvals') || []; }
function _cwSaveApprovals(a){ store('amv_cw_approvals', a); }

async function _crewSyncLive(){
  if(!(window.AMV_API && AMV_API.live)) return;
  try{
    const jobs=await AMV_API.jobs();
    const appr=await AMV_API.approvals();
    // map backend rows -> local shape
    if(jobs && jobs.length){ store('amv_cw_jobs', jobs.map(j=>({id:j.key,icon:(_cwDefaultJobs().find(d=>d.id===j.key)||{}).icon||'⚙️',title:j.title,desc:(_cwDefaultJobs().find(d=>d.id===j.key)||{}).desc||'',needs:j.needs,on:!!j.on_flag}))); }
    if(appr){ store('amv_cw_approvals', appr.map(a=>({id:a.id,icon:a.icon,title:a.title,preview:a.preview}))); }
    renderCrewView();
  }catch(e){}
}
/* ============================================================
   MISSION CONTROL  (Phase 2) - the workforce overview.
   Aggregates the real state of everything AMV is doing: what needs
   approval, what's active, what's autonomous, what's scheduled, what
   finished, and what's blocked. Reads only real stores; empty groups
   collapse to a quiet line instead of fabricating activity.
   ============================================================ */
function _autonomyPaused(){ try{ return localStorage.getItem('amv_autonomy_paused')==='1'; }catch(e){ return false; } }
function _setAutonomyPaused(v){ try{ localStorage.setItem('amv_autonomy_paused', v?'1':'0'); }catch(e){} }
function pauseAllAutonomous(){ _setAutonomyPaused(true); if(window.AMV_API && AMV_API.live && AMV_API.pauseAutonomy) AMV_API.pauseAutonomy(true).catch(()=>{}); toast('All autonomous work paused - nothing runs until you resume.','info',3800); renderCrewView(); }
function resumeAllAutonomous(){ _setAutonomyPaused(false); if(window.AMV_API && AMV_API.live && AMV_API.pauseAutonomy) AMV_API.pauseAutonomy(false).catch(()=>{}); toast('Autonomous work resumed.','success'); renderCrewView(); }
window.pauseAllAutonomous=pauseAllAutonomous; window.resumeAllAutonomous=resumeAllAutonomous;

function _mcState(){
  const appr=_cwApprovals();
  const jobs=_cwJobs();
  const sched=(typeof _loadSched==='function')?_loadSched():[];
  const bg=(typeof _bgQueue!=='undefined'&&_bgQueue.tasks)?_bgQueue.tasks:[];
  return {
    appr,
    active: bg.filter(t=>t.status==='running'||t.status==='queued'),
    failed: bg.filter(t=>t.status==='failed'),
    done: bg.filter(t=>t.status==='done'),
    auton: jobs.filter(j=>j.on),
    sched
  };
}
function _mcActiveCard(t){
  const running=t.status==='running';
  const bar = running
    ? (t.progress ? `<div class="mc-bar"><span style="width:${Math.max(6,Math.min(100,t.progress))}%"></span></div>` : `<div class="mc-bar indet"><span></span></div>`)
    : '';
  return `<div class="mc-card"><div class="mc-card-top"><span class="mc-card-t">${escH(t.title||t.type||'Task')}</span><span class="mc-pill ${running?'run':'wait'}">${running?'Running':'Queued'}</span></div>${bar}<div class="mc-card-sub">${running?'AMV is working on this now.':'Waiting to start.'}</div></div>`;
}
function _mcFailCard(t){
  return `<div class="mc-card fail"><div class="mc-card-top"><span class="mc-card-t">${escH(t.title||'Task')}</span><span class="mc-pill err">Needs you</span></div><div class="mc-card-sub">${escH(t.error||'This task could not complete.')}</div><div class="mc-card-act"><button class="btn mc-mini" data-dact="_mcRetry" data-darg="${t.id}">Retry</button></div></div>`;
}
function _mcRetry(id){
  const t=((typeof _bgQueue!=='undefined'&&_bgQueue.tasks)||[]).find(x=>x.id===id); if(!t){ renderCrewView(); return; }
  t.status='queued'; t.error=null; t.progress=0;
  if(typeof _bgRunNext==='function') _bgRunNext();
  toast('Retrying - running in the background','info'); renderCrewView();
}
window._mcRetry=_mcRetry;
function _mcAutonCard(j){
  return `<div class="mc-card"><div class="mc-card-top"><span class="mc-card-t">${escH(j.title)}</span><span class="mc-pill ok">On</span></div><div class="mc-card-sub">${escH(j.desc||'')}</div><div class="mc-card-act"><span class="mc-card-uses">Uses: ${escH(j.needs||'-')}</span><button class="btn mc-mini ghost" data-dact="cwToggle" data-darg="${j.id}">Turn off</button></div></div>`;
}
function _mcSchedRow(t){
  const when = t.sched?((typeof _schedHumanOf==='function')?_schedHumanOf(t.sched):''):((typeof _freqLabel==='function')?_freqLabel(t.freq):'');
  let next='';
  try{ if(t.next) next=new Date(t.next).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }catch(e){}
  const auto = t.approval==='auto';
  let waiting=0; try{ waiting=_cwApprovals().filter(a=>a.fromJob===t.id).length; }catch(e){}
  const mode = t.paused
    ? '<span class="mc-sched-mode paused">Paused</span>'
    : (auto ? '<span class="mc-sched-mode auto">Autonomous - sends automatically</span>'
            : '<span class="mc-sched-mode req">Ask first - you approve each one</span>');
  const waitChip = (!auto && waiting) ? `<span class="mc-sched-waiting">${waiting} waiting in Needs your approval</span>` : '';
  return `<div class="mc-sched-row">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(t.goal||'Scheduled job')}</div>
      <div class="mc-sched-meta">${escH(when)}${next?` · next ${escH(next)}`:''}${t.localOnly?' · runs while AMV is open':''}</div>
      <div class="mc-sched-mode-row">${mode}${waitChip}</div>
    </div>
    <div class="mc-sched-acts">
      <button class="btn mc-mini ${auto?'ghost':'bp'}" data-dact="_schedToggleApproval" data-darg="${t.id}">${auto?'Make me approve first':'Make autonomous'}</button>
      <button class="btn mc-mini ghost" data-dact="_schedEdit" data-darg="${t.id}">Edit</button>
      <button class="btn mc-mini ghost" data-dact="_mcCancelSched" data-darg="${t.id}">Cancel</button>
    </div>
  </div>`;
}
function _mcCancelSched(id){ try{ _saveSched(_loadSched().filter(t=>t.id!==id)); }catch(e){} toast('Scheduled task cancelled','info'); renderCrewView(); }
window._mcCancelSched=_mcCancelSched;
/* "From the marketplace" - crews the user bought, usable right here in Crew. */
function _mcBoughtCrewsHTML(){
  let crews=[];
  try{ crews=(load('amv_saved_crews')||[]).filter(c=>c.fromMarket); }catch(e){}
  if(!crews.length) return '';
  return `<div class="mc-sec mc-bought owned-plugins" id="mc-bought">
    <div class="sec-head"><h3>Marketplace plugins</h3><span class="sec-sub">Crews and workflows you bought, ready to run as your own. Click Run and AMV works it end to end - the seller’s details are swapped for yours automatically.</span></div>
    <div class="mc-grid">${crews.slice(0,8).map(c=>`<div class="mc-card">
      <div class="mc-card-top"><span class="mc-card-t">${escH(c.title||'Crew')}</span><span class="mc-pill ok">Owned</span></div>
      <div class="mc-card-sub">${(c.agents||[]).slice(0,4).map(a=>escH(a.role)).join(' → ')||(c.goal?escH(c.goal.slice(0,90)):'Multi-agent crew')}${c.seller?` · by ${escH(c.seller)}`:''}</div>
      <div class="mc-card-act"><button class="btn mc-mini" data-dact="_mcUseCrew" data-darg="${escH(c.id)}">Run this</button></div>
    </div>`).join('')}</div>
  </div>`;
}
function _mcUseCrew(id){
  let c=null; try{ c=(load('amv_saved_crews')||[]).find(x=>x.id===id); }catch(e){}
  if(!c){ toast('Crew not found','error'); return; }
  let goal;
  if(c.agents&&c.agents.length) goal='Run this crew for me:\n\n'+c.agents.map(a=>'• '+(a.role||'Agent')+': '+(a.task||'')).join('\n');
  else goal=c.goal||c.title||'';
  if(!goal.trim()){ toast('This crew has no instructions to run','error'); return; }
  if(typeof openCoworkWith==='function') openCoworkWith(goal);
  else { setTab('chat'); setTimeout(()=>{ const ta=$('mta'); if(ta){ ta.value=goal; ta.dispatchEvent(new Event('input')); ta.focus(); } },200); }
}
window._mcUseCrew=_mcUseCrew;
/* A standing job shown as a row in the unified Scheduled section. */
function _mcAutonSchedRow(j){
  return `<div class="mc-sched-row">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(j.title)}</div>
      <div class="mc-sched-meta">${escH(j.desc||'Runs in the background')} · Uses: ${escH(j.needs||'-')}</div>
      <div class="mc-sched-mode-row"><span class="mc-sched-mode auto">Autonomous - emails you results automatically</span></div>
    </div>
    <div class="mc-sched-acts"><button class="btn mc-mini ghost" data-dact="cwToggle" data-darg="${j.id}">Turn off</button></div>
  </div>`;
}
/* Run a typed command INLINE on Mission Control - never leaves Crew. Recognizes
   intent, and if a needed app isn't connected it says so right here; once
   connected it actually performs the task on the real account. */
/* Fast, offline-safe check for obviously-missing details before running.
   Returns a list of short questions ([] = good to go). */
function _clarifyHeuristic(goal){
  const g=' '+String(goal||'').toLowerCase().trim()+' ';
  const words=g.trim().split(/\s+/).filter(Boolean);
  const qs=[];
  const hasEmail=/[\w.+-]+@[\w-]+\.[\w.-]+/.test(goal);
  const hasTo=/\bto\s+[a-z0-9@"']/i.test(goal) || /\bme\b|\bmy\b|\bmyself\b/i.test(g);
  const sendy=/\b(send|email|e-mail|message|text|dm|reply|respond|reach out|notify)\b/.test(g);
  const posty=/\b(post|publish|tweet|share|upload)\b/.test(g);
  const platform=/\b(twitter|\bx\b|linkedin|instagram|insta|facebook|fb|slack|youtube|tiktok|reddit|blog|website|discord)\b/.test(g);
  if(sendy && !hasEmail && !hasTo) qs.push('Who should this go to - a name or email address?');
  if(posty && !platform) qs.push('Where should this be posted (for example LinkedIn, X, or Instagram)?');
  if(words.length<4 && !sendy && !posty) qs.push('Can you add a little more detail about what you want AMV to produce?');
  return qs;
}
/* Scan a goal and decide whether AMV has enough to proceed. Uses the heuristic
   always, and the real model when the engine is connected - so it behaves like
   an assistant that asks before guessing. Returns {ok, questions}. */
async function _clarifyCheck(goal){
  let qs=_clarifyHeuristic(goal);
  if(!qs.length && typeof _aiBackendReady==='function' && _aiBackendReady()){
    try{
      const sys='You decide whether an autonomous task has enough detail to do it WELL without guessing at things the user would care about (who it goes to, exact content, destination, timing). Reply with ONLY JSON: {"ready":true} to proceed, or {"ready":false,"questions":["..."]} with at most 2 short, specific questions. Do not ask about things you can reasonably decide yourself.';
      const raw=await aiComplete('TASK: '+goal, sys, {max_tokens:220, json:true});
      const j=JSON.parse(String(raw).replace(/```json|```/g,'').trim());
      if(j && j.ready===false && Array.isArray(j.questions) && j.questions.length) qs=j.questions.slice(0,2).map(q=>String(q).slice(0,160));
    }catch(e){}
  }
  return { ok: qs.length===0, questions: qs };
}
/* Turn a recurring command into a running job, asking how it should run. */
function _mcAskRecurring(box, instruction, when){
  box.innerHTML='<div class="mc-cmd-msg ask">'+
    '<div class="mc-ask-h">This looks like recurring work - '+escH(when.label)+'.</div>'+
    '<div class="mc-ask-sub">Each run creates fresh content. How should AMV handle it?</div>'+
    '<div class="mc-ask-modes">'+
      '<label class="mc-ask-mode"><input type="radio" name="mcmode" value="require" checked><span><b>Ask first</b> - AMV prepares it and drops a draft in Needs your approval each time. Nothing sends until you approve.</span></label>'+
      '<label class="mc-ask-mode"><input type="radio" name="mcmode" value="auto"><span><b>Autonomous</b> - AMV completes and sends it automatically each time. It will not appear in Needs your approval.</span></label>'+
    '</div>'+
    '<div class="mc-cmd-actions"><button class="btn mc-mini bp" id="mc-ask-schedule">Add to Running jobs</button><button class="btn mc-mini ghost" id="mc-ask-cancel">Cancel</button></div>'+
  '</div>';
  on($('mc-ask-cancel'),'click',()=>{ box.innerHTML=''; });
  on($('mc-ask-schedule'),'click',()=>{
    const mode=(document.querySelector('input[name="mcmode"]:checked')||{}).value||'require';
    const item={id:'a'+Date.now(), goal:instruction, approval:mode, created:Date.now(), lastRun:null};
    if(when.sched){ item.sched=when.sched; item.next=_schedNext(when.sched,Date.now()); }
    else { item.freq=when.freq||'daily'; item.next=_freqNext(item.freq,Date.now()); }
    const list=_loadSched(); list.push(item); _saveSched(list);
    if(window.AMV_API && AMV_API.live && typeof AMV_API._fetch==='function'){ try{ AMV_API._fetch('/api/schedule/create',{method:'POST',body:JSON.stringify({goal:instruction,sched:item.sched,freq:item.freq,approval:mode})}).catch(()=>{}); }catch(e){} }
    toast('Added to Running jobs - '+when.label+(mode==='auto'?' · Autonomous':' · Ask first'),'success',4200);
    renderCrewView();
  });
}
/* Show clarifying questions in the command bar and re-run once answered. */
function _mcAskDetails(box, instruction, questions){
  box.innerHTML='<div class="mc-cmd-msg ask">'+
    '<div class="mc-ask-h">A couple of quick details so I get this right:</div>'+
    '<ul class="mc-ask-qs">'+questions.map(q=>'<li>'+escH(q)+'</li>').join('')+'</ul>'+
    '<textarea id="mc-ask-input" class="mc-ask-input" rows="2" placeholder="Answer here, then Continue"></textarea>'+
    '<div class="mc-cmd-actions"><button class="btn mc-mini bp" id="mc-ask-go">Continue</button><button class="btn mc-mini ghost" id="mc-ask-skip">Skip, do your best</button></div>'+
  '</div>';
  const go=()=>{ const a=($('mc-ask-input')||{}).value||''; const combined=instruction+(a.trim()?('\n\nDetails: '+a.trim()):''); mcRunCommand(combined,{clarified:true}); };
  on($('mc-ask-go'),'click',go);
  on($('mc-ask-skip'),'click',()=>mcRunCommand(instruction,{clarified:true}));
  setTimeout(()=>{ try{ $('mc-ask-input').focus(); }catch(e){} },30);
}
async function mcRunCommand(instruction, opts){
  opts=opts||{};
  const box=document.getElementById('mc-cmd-result'); if(!box) return;
  instruction=(instruction||'').trim(); if(!instruction){ const i=document.getElementById('mc-cmd-input'); i&&i.focus(); return; }
  // Recurring? Make it a running job and ask how it should run (autonomous vs
  // approval). This comes first: scheduling doesn't need the app connected yet -
  // the job runs when it's due, once the integration is linked.
  if(!opts.clarified && typeof _parseWhen==='function'){
    const when=_parseWhen(instruction);
    if(when && when.kind==='recurring'){ _mcAskRecurring(box, instruction, when); return; }
  }
  // Scan for missing details and ask BEFORE anything else (like a real
  // assistant): understand the request first, then check what it needs.
  if(!opts.clarified){
    box.innerHTML='<div class="mc-cmd-msg run"><span class="rr-dot"></span> Reading your request…</div>';
    const c=await _clarifyCheck(instruction);
    if(!c.ok){ _mcAskDetails(box, instruction, c.questions); return; }
  }
  // UNIVERSAL AGENT: plan this request against every connector that exists
  // right now (not a fixed command list), bind each step to a REAL action, and
  // run it with everything visible. Steps that cannot run say exactly what is
  // missing and resume when it is provided. Falls through to the older path
  // only if the universal core is unavailable.
  if(typeof AMVUniversal!=='undefined' && typeof uniRun==='function'){
    box.innerHTML='<div class="mc-cmd-msg run"><span class="rr-dot"></span> Planning against your connected services…</div><div id="uni-live"></div>';
    try{
      const r=await uniRun(instruction, {autonomous:!!opts.autonomous});
      if(r && !r.blocked) return;
      if(r && r.blocked) return;
    }catch(e){ /* fall through to the legacy path */ }
  }
  const analysis=(typeof analyzeTaskIntent==='function')?analyzeTaskIntent(instruction):{matched:false,ready:false};
  // Needs an integration that isn't connected → explain here, stay in Crew.
  if(analysis.matched && !analysis.ready){
    const msg=(typeof taskRequirementMessage==='function')?taskRequirementMessage(analysis):'This task needs an app that isn’t connected yet.';
    box.innerHTML='<div class="mc-cmd-msg warn"><div>'+escH(msg.replace(/\*\*/g,''))+'</div><div class="mc-cmd-actions"><button class="btn mc-mini" data-dact="_mcGoConnect">Open Connectors</button></div></div>';
    return;
  }
  box.innerHTML='<div class="mc-cmd-msg run"><span class="rr-dot"></span> Working on it…</div>';
  try{
    if(typeof runAgentTask!=='function') throw new Error('agent-unavailable');
    const {steps,results}=await runAgentTask(instruction,{onStep:(s)=>{ const m=box.querySelector('.mc-cmd-msg'); if(m) m.innerHTML='<span class="rr-dot"></span> Running: '+escH(String(s.tool||'').replace(/_/g,' '))+'…'; }});
    let html;
    if(!steps.length){ html='<div>I couldn’t find a safe automatic action for that. Try being more specific, or use <b>Autonomous task</b> below to plan a multi-step job.</div>'; }
    else { html='<div class="mc-cmd-done-h">✓ Done - here’s what I did:</div><ul class="mc-cmd-steps">'+results.map((r,i)=>{ const label=(steps[i]&&steps[i].why)||r.tool; if(r.skipped) return '<li>⏭ Skipped: '+escH(label)+'</li>'; return '<li>'+(r.ok?'✓':'⚠')+' '+escH(label)+(r.ok?'':' - '+escH(r.error||'failed'))+'</li>'; }).join('')+'</ul>'; }
    box.innerHTML='<div class="mc-cmd-msg done">'+html+'</div>';
  }catch(e){
    const m=String(e&&e.message||'');
    if(/No integrations connected/i.test(m) || m==='agent-unavailable'){
      box.innerHTML='<div class="mc-cmd-msg warn"><div>To actually do this, connect an app (Google, Slack, or GitHub) in <b>Settings → Connectors</b>. The moment it’s connected, AMV performs the task for real - right here.</div><div class="mc-cmd-actions"><button class="btn mc-mini" data-dact="_mcGoConnect">Open Connectors</button></div></div>';
    } else {
      box.innerHTML='<div class="mc-cmd-msg warn"><div>'+escH(m||'Could not run that task.')+'</div></div>';
    }
  }
}
window.mcRunCommand=mcRunCommand;
function _mcGoConnect(){ try{ S.settingsPane='integrations'; setTab('settings'); }catch(e){} }
window._mcGoConnect=_mcGoConnect;
function _mcDoneCard(t){
  const snip=t.result?String(t.result).replace(/\s+/g,' ').trim():'';
  return `<div class="mc-card done"><div class="mc-card-top"><span class="mc-card-t">${escH(t.title||'Task')}</span><span class="mc-pill ok">Done</span></div>${snip?`<div class="mc-card-sub">${escH(snip.slice(0,140))}${snip.length>140?'…':''}</div>`:''}</div>`;
}

function renderCrewView(){
  const vc=$('vc'); if(!vc) return;
  const jobs=_cwJobs(); const appr=_cwApprovals();
  const jobCard=j=>`<div class="cw-job ${j.on?'on':''}">
      <div class="cw-job-ic">${j.icon}</div>
      <div style="flex:1;min-width:0">
        <div class="cw-job-t">${escH(j.title)}</div>
        <div class="cw-job-d">${escH(j.desc)}</div>
        <div class="cw-job-need">Uses: ${escH(j.needs)}</div>
      </div>
      <button class="cw-toggle ${j.on?'on':''}" data-dact="cwToggle" data-darg="${j.id}" aria-label="toggle"><span class="cw-knob"></span></button>
    </div>`;
  const apprCard=a=>{
    const act=_apvAction(a);
    const meta=[
      a.project?['Project',a.project]:null,
      a.crewName?['Crew',a.crewName]:null,
      a.destination?['To',a.destination]:null,
      (a.recipients!=null)?['Recipients',String(a.recipients)]:null,
      a.scheduledAt?['Scheduled',a.scheduledAt]:null,
      a.readyAt?['Ready',_apvAgo(a.readyAt)]:null
    ].filter(Boolean);
    return `<div class="apv-card">
      <div class="apv-card-top">
        <span class="apv-ic">${a.icon||'\u2709\uFE0F'}</span>
        <div class="apv-card-hd">
          <div class="apv-title">${escH(a.title)}</div>
          <div class="apv-req">${escH(a.requesting||act.line)}</div>
        </div>
        <span class="apv-status ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Needs approval'}</span>
      </div>
      ${a.fromJob?`<div class="apv-fromjob">↻ From your running job${a.jobSchedule?` · ${escH(a.jobSchedule)}`:''}. It keeps running - you'll get a new one to review each time. The job stays in <b>Running jobs</b>.</div>`:''}
      ${meta.length?`<div class="apv-meta">${meta.map(m=>`<span class="apv-mi"><span class="apv-mk">${escH(m[0])}</span>${escH(m[1])}</span>`).join('')}</div>`:''}
      ${a.warning?`<div class="apv-warn">${escH(a.warning)}</div>`:''}
      <div class="apv-act">
        <button class="btn apv-preview" data-dact="apvPreview" data-darg="${a.id}">Preview</button>
        <button class="btn apv-ghost" data-dact="apvEdit" data-darg="${a.id}">Edit</button>
        <button class="btn apv-ghost apv-reject" data-dact="apvReject" data-darg="${a.id}">Reject</button>
        <button class="btn apv-approve" data-dact="apvQuickApprove" data-darg="${a.id}">${escH(act.btn)}</button>
      </div>
    </div>`;
  };
  const st=_mcState();
  const paused=_autonomyPaused();
  const tiles=[
    ['appr','Needs approval',st.appr.length,'wait'],
    ['fail','Action required',st.failed.length,'err'],
    ['active','Active work',st.active.length,'active'],
    ['sched','Running jobs',st.sched.length+st.auton.length,'info'],
    ['done','Completed',st.done.length,'muted']
  ];

  vc.innerHTML = `<div class="sv fi"><div class="crew-page mc-page">
    <header class="mc-head">
      <div class="mc-head-l">
        <div class="eyebrow">Crew · Autonomous work</div>
        <h2>Mission Control</h2>
        <p class="vsub">Crew is AMV working on its own. Tell it an outcome and it plans the steps, does the work across your connected apps, and stops for your approval before anything is sent. This page is where you watch it all - what needs you, what’s running, and what’s scheduled.</p>
      </div>
      <div class="mc-head-r">
        <button class="mc-pause ${paused?'paused':''}" data-dact="${paused?'resumeAllAutonomous':'pauseAllAutonomous'}">${paused?'▶ Resume autonomy':'⏸ Pause all autonomous'}</button>
      </div>
    </header>
    <div class="mc-cmd mc-cmd-lg">
      <div class="mc-cmd-label">Tell AMV what to do <span>- it recognizes what you mean and does it, right here</span></div>
      <div class="mc-cmd-inner">
        <svg class="mc-cmd-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>
        <input id="mc-cmd-input" class="mc-cmd-input" type="text" placeholder="e.g. “email me a summary of my unread emails” or “research the top AI news and write a brief”" autocomplete="off">
        <button class="mc-cmd-go" id="mc-cmd-go">Run</button>
      </div>
      <div class="mc-cmd-chips">${[
        'Email me a summary of my unread emails',
        'Research the top AI news today and write me a brief',
        'Draft a reply to my latest email',
        'Plan my week from my calendar'
      ].map(c=>`<button class="mc-cmd-chip" data-mccmd="${escH(c)}">${escH(c)}</button>`).join('')}</div>
      <div id="mc-cmd-result" class="mc-cmd-result"></div>
    </div>
    ${paused?`<div class="mc-paused-banner"><b>Autonomous work is paused.</b> Scheduled and standing jobs won’t run until you resume. Anything already waiting still needs your approval.</div>`:''}
    <div class="mc-tiles">${tiles.map(t=>`<button class="mc-tile mc-${t[3]}${t[2]?'':' zero'}" data-mcjump="mc-${t[0]}"><span class="mc-tile-n">${t[2]}</span><span class="mc-tile-l">${t[1]}</span></button>`).join('')}</div>

    <section id="mc-appr" class="mc-sec">
      <div class="sec-head"><h3>Needs your approval ${appr.length?`<span class="cw-badge">${appr.length}</span>`:''}</h3><span class="sec-sub">One-off drafts waiting for you. Nothing here sends until you approve it. A running job that is set to "ask first" also drops a fresh draft here each time it runs.</span></div>
      ${appr.length ? appr.map(apprCard).join('') :
        `<div class="mc-empty"><span class="mc-empty-ic">✓</span><div>You are all caught up. When AMV drafts something that would send or change anything, it waits right here for your review - you can read it, edit every detail, then send or delete it.</div><button class="mc-empty-cta" data-dact="cwDemo">Show me an example</button></div>`}
    </section>

    ${st.failed.length?`<section id="mc-fail" class="mc-sec">
      <div class="sec-head"><h3>Action required <span class="cw-badge err">${st.failed.length}</span></h3><span class="sec-sub">Blocked or failed - these need you.</span></div>
      <div class="mc-grid">${st.failed.map(_mcFailCard).join('')}</div>
    </section>`:''}

    ${st.active.length?`<section id="mc-active" class="mc-sec">
      <div class="sec-head"><h3>Active work</h3><span class="sec-sub">AMV is on these right now.</span></div>
      <div class="mc-grid">${st.active.map(_mcActiveCard).join('')}</div>
    </section>`:''}

    <section id="mc-sched" class="mc-sec">
      <div class="sec-head"><h3>Running jobs</h3><span class="sec-sub">Recurring work AMV runs on a schedule. Each run creates fresh content (a new email, a new summary). For each one you choose: <b>Autonomous</b> sends it for you automatically, or <b>Ask first</b> drops a draft in "Needs your approval" every time so you review before it sends.</span><button class="mc-sec-link" data-dact="openSchedManager">Manage</button></div>
      ${(st.sched.length||st.auton.length)?`<div class="mc-sched">${st.auton.map(_mcAutonSchedRow).join('')}${st.sched.slice(0,8).map(_mcSchedRow).join('')}</div>`:`<div class="mc-empty-row">No running jobs yet. Start a task above and choose how often it should repeat - it will show up here.</div>`}
    </section>

    ${st.done.length?`<section id="mc-done" class="mc-sec">
      <div class="sec-head"><h3>Recently completed</h3></div>
      <div class="mc-grid">${st.done.slice(-6).reverse().map(_mcDoneCard).join('')}</div>
    </section>`:''}

    <div class="crew-jobs-sec mc-start">
      <div class="sec-head"><h3>Start new work</h3><span class="sec-sub">Turn on a standing job - AMV runs it automatically and emails you results.</span></div>
      <div class="cw-jobs-grid">${jobs.map(jobCard).join('')}</div>
    </div>

    <div class="crew-split-even">
      <section class="crew-do">
        <div class="sec-head"><h3>Run something now</h3><span class="sec-sub">AMV opens a workspace, asks what it needs, and actually does it.</span></div>
        <div class="cw-quick">
          ${[['\uD83D\uDDFA\uFE0F','Plan a trip','trip','openTripPlanner()'],
             ['\uD83D\uDCE7','Check Gmail','gmail','crewRun(\'gmail\',\'Check Gmail\')'],
             ['\uD83D\uDCC5','Plan my week','week','crewRun(\'week\',\'Plan my week\')'],
             ['\u2728','Autonomous task','auto','openCowork()']]
            .map(q=>`<button class="cw-quick-card" onclick="${q[3]}"><span class="cw-quick-ic">${q[0]}</span><span>${q[1]}</span></button>`).join('')}
        </div>
        <div id="crew-live" class="crew-live">${_crewResultsHTML()}</div>
      </section>
      <section>
        <div class="sec-head"><h3>Recurring work</h3><span class="sec-sub">Pick one to set it on a schedule - or describe your own. Many can run at once.</span></div>
        <div class="tpl-grid">
          ${[
            ['\uD83C\uDFAC','YouTube video','Produce a complete, production-ready YouTube video package about this week\'s stock market: a punchy title, a 0-3s hook, a full word-for-word voiceover script with timestamps, a scene-by-scene shot list, B-roll suggestions, on-screen text, an SEO description, 15 tags, and a thumbnail concept. I review before publishing.'],
            ['\uD83D\uDCF8','Instagram post','Produce a ready-to-post Instagram package about the latest in my field: a scroll-stopping caption with line breaks, 20-30 ranked hashtags, a carousel outline, a detailed image/visual concept, and the best post time. I approve before posting.'],
            ['\uD83D\uDC26','Social posts','Write 3 ready-to-publish posts for X and 2 for LinkedIn on what\'s trending in my industry today - each with the full copy, hooks, and hashtags. I approve before anything is published.'],
            ['\uD83D\uDCC8','Market brief','Every morning, produce a tight briefing of overnight market moves: major indices, notable movers, and the 3 headlines that matter to me, each with a one-line why-it-matters.'],
            ['\uD83D\uDCB0','Investing check-in','Each Monday, review my watchlist, give a clear buy/hold view with reasoning, and prepare a $1 XRP buy order on Robinhood. Present the exact order for my one-tap approval before placing it.'],
            ['\uD83C\uDFE6','Bank check-in','Every morning, check my linked bank account and report the balance, recent transactions, anything unusual, and my spend-vs-last-week. Prepare it as a clean daily report.'],
            ['\uD83D\uDCF0','News digest','Daily, gather the top developments in AI and produce a sharp 5-bullet briefing, each bullet with a link-worthy summary and why it matters.'],
            ['\u2709\uFE0F','Inbox triage','Each morning, read new emails, rank them by urgency with reasons, and draft a ready-to-send reply for each. I click send before anything goes out.']
          ].map(t=>`<button class="tpl-card" onclick="openCoworkWith(${JSON.stringify(t[2]).replace(/"/g,'&quot;')})"><span class="tpl-ic">${t[0]}</span><span class="tpl-t">${t[1]}</span></button>`).join('')}
        </div>
      </section>
    </div>
    ${_mcBoughtCrewsHTML()}
  </div></div>`;
  try{ vc.querySelectorAll('[data-mcjump]').forEach(function(b){ on(b,'click',function(){ var el=document.getElementById(b.dataset.mcjump); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }); }); }catch(e){}
  // Command bar: type any goal → the real agent recognizes intent and does it.
  try{
    var _mcRun=function(){ var el=$('mc-cmd-input'); var v=el?el.value.trim():''; if(!v){ el&&el.focus(); return; } mcRunCommand(v); };
    on($('mc-cmd-go'),'click',_mcRun);
    var _ci=$('mc-cmd-input'); if(_ci) on(_ci,'keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); _mcRun(); } });
    vc.querySelectorAll('[data-mccmd]').forEach(function(c){ on(c,'click',function(){ var el=$('mc-cmd-input'); if(el){ el.value=c.dataset.mccmd; el.focus(); } }); });
  }catch(e){}
}
function _crewQueueHTML(){
  try{
    var q=(typeof _bgQueue!=='undefined'&&_bgQueue.tasks)?_bgQueue.tasks:[];
    if(!q.length) return '<div class="cw-empty">No background tasks running.</div>';
    var sc=s=>s==='done'?'#4ade80':s==='running'?'#5590ff':s==='failed'?'#ff4d4d':'#e0b341';
    var si=s=>s==='done'?'✓':s==='running'?'⟳':s==='failed'?'✕':'⏳';
    return q.slice().reverse().map(function(t){return '<div class="cw-qrow"><span style="color:'+sc(t.status)+'">'+si(t.status)+'</span><span style="flex:1">'+escH(t.title||t.type||'Task')+'</span><span style="font-size:11px;color:var(--mu)">'+(t.status||'')+'</span></div>';}).join('');
  }catch(e){ return '<div class="cw-empty">No background tasks running.</div>'; }
}
function cwToggle(id){
  const jobs=_cwJobs(); const j=jobs.find(x=>x.id===id); if(!j) return;
  // Job Hunt needs a profile before it can do anything - open setup on first
  // enable if the required details are missing, instead of silently turning on.
  if(id==='job_hunt' && !j.on && typeof AMVJobs!=='undefined' && AMVJobs.missingInfo({}, AMVJobs.cfg()).length){
    if(typeof openJobHunt==='function'){ openJobHunt(); return; }
  }
  j.on=!j.on; _cwSaveJobs(jobs);
  // keep the engine's own on-flag in sync so AMVJobs.run() reflects the toggle
  if(id==='job_hunt' && typeof AMVJobs!=='undefined'){ try{ const c=AMVJobs.cfg(); c.on=j.on; AMVJobs.save(c); }catch(e){} }
  if(window.AMV_API && AMV_API.live){ AMV_API.toggleJob(id,j.on).catch(()=>{}); }
  toast(j.on?('On: '+j.title):('Off: '+j.title), j.on?'info':'info');
  renderCrewView();
}
function cwDemo(){
  const appr=_cwApprovals();
  const now=Date.now(), me=(S.user&&S.user.name)||'You', first=me.split(' ')[0];
  appr.unshift({
    id:'a'+now, icon:'\uD83D\uDCE7',
    title:'Weekly customer update - September',
    project:'Growth', crewName:'Content Crew',
    actionType:'send', resultType:'email', recipients:42,
    destination:'42 customers (newsletter list)', account:'you@amv.dev',
    requesting:'Send the finished monthly update to your customer list.',
    autoApprove:false,
    startedAt:now-26*6e4, readyAt:now-3*6e4,
    warning:'Goes to 42 recipients. Double-check the subject line before approving.',
    result:{ type:'email', from:'you@amv.dev', to:'42 customers (undisclosed recipients)',
      subject:'What we shipped this month + what\u2019s next',
      body:'Hi there,\n\nThis month we shipped three things you asked for: faster exports, a redesigned dashboard, and one-click sharing. Exports now finish in seconds, the dashboard puts your key numbers first, and sharing a report is now a single click.\n\nNext month we\u2019re focused on team workspaces - shared projects, roles, and a single bill. If you want early access, just reply to this email.\n\nThank you for building with us.\n\n- '+first },
    timeline:[
      {t:'9:02 AM', agent:'Planner', text:'Broke the update into research, draft, and review.'},
      {t:'9:06 AM', agent:'Researcher', text:'Pulled this month\u2019s shipped features and the top 3 customer requests.'},
      {t:'9:11 AM', agent:'Copywriter', text:'Wrote the subject line, intro, and the three highlights.'},
      {t:'9:15 AM', agent:'Reviewer', text:'Tightened the copy and flagged the subject line for your eyes.'},
      {t:'9:17 AM', agent:'AMV', text:'Ready for your approval.'}
    ],
    crew:[
      {role:'Planner', resp:'Structured the work', status:'done'},
      {role:'Researcher', resp:'Gathered the month\u2019s highlights', status:'done'},
      {role:'Copywriter', resp:'Wrote the email', status:'done'},
      {role:'Reviewer', resp:'Checked tone and accuracy', status:'done'}
    ],
    artifacts:[
      {name:'highlights.md', from:'Researcher', to:'Copywriter', note:'the month\u2019s shipped features'},
      {name:'draft-v1', from:'Copywriter', to:'Reviewer', note:'first email draft'},
      {name:'final-email', from:'Reviewer', to:'AMV', note:'approved-for-review copy'}
    ]
  });
  _cwSaveApprovals(appr); renderCrewView();
  toast('Example draft added - press Preview to see the full workspace','info',4000);
}
function cwApprove(id){ const a=_cwApprovals().filter(x=>x.id!==id); _cwSaveApprovals(a); toast('Approved - sent','info'); renderCrewView(); }
function cwReject(id){
  const all=_cwApprovals(); const removed=all.find(x=>x.id===id); const idx=all.findIndex(x=>x.id===id);
  if(window.AMV_API && AMV_API.live){ AMV_API.actApproval(id,'reject').catch(()=>{}); }
  _cwSaveApprovals(all.filter(x=>x.id!==id)); renderCrewView();
  if(removed){ toastAction('Removed - it won’t be sent.','Return',()=>{ const list=_cwApprovals(); if(!list.some(x=>x.id===removed.id)){ list.splice(Math.min(idx,list.length),0,removed); _cwSaveApprovals(list); if(window.AMV_API && AMV_API.live){ AMV_API.actApproval(id,'restore').catch(()=>{}); } toast('Brought back','success'); renderCrewView(); } }); }
  else toast('Removed','info');
}
function cwEdit(id){ const item=_cwApprovals().find(x=>x.id===id); cwReject(id); setTab('chat'); setTimeout(()=>{ const ta=$('mta'); if(ta&&item){ ta.value='Help me revise this draft:\n\n'+item.preview; ta.focus(); } },120); }
window.cwToggle=cwToggle;window.cwDemo=cwDemo;window.cwApprove=cwApprove;window.cwReject=cwReject;window.cwEdit=cwEdit;
function cwTry(prompt){
  // Take a "try saying" example, drop the user into chat with it ready to send.
  try{
    setTab('chat');
    setTimeout(()=>{ const ta=$('mta'); if(ta){ ta.value=prompt; ta.dispatchEvent(new Event('input')); ta.focus(); } toast('Press send and AMV will set this up for you','info',3500); }, 120);
  }catch(e){}
}
window.cwTry=cwTry;

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
    const src=r.html?` srcdoc="${escH(r.html)}"`:'';
    const note=r.html?'':`<div class="pvw-web-note">Live preview appears here after the site is generated.</div>`;
    return `<div class="pvw-frame web"><div class="pvw-web-tabs"><button class="pvw-web-tab on" data-apvweb="desk">Desktop</button><button class="pvw-web-tab" data-apvweb="mob">Mobile</button><span class="pvw-web-url">${escH(r.url||a.destination||'')}</span></div>
      <div class="pvw-web-stage desk"><div class="pvw-web-frame">${r.html?`<iframe class="pvw-web-if" title="Website preview"${src}></iframe>`:note}</div></div></div>`;
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
  r.innerHTML=`<div class="ov pvw-ov" id="pvw-bg"><div class="pvw" role="dialog" aria-label="Preview and approve">
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
  on($('pvw-bg'),'click',(e)=>{ if(e.target===e.currentTarget) apvClose(); });
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
function apvQuickApprove(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ renderCrewView(); return; }
  const act=_apvAction(a);
  if(!confirm(act.line)) return;
  _apvDoApprove(a);
}
function apvApprove(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ apvClose(); return; }
  _apvDoApprove(a); apvClose();
}
const _APV_PAST={send:'Sent',publish:'Published',schedule:'Scheduled',post:'Posted',submit:'Submitted',update:'Updated',deploy:'Deployed',approve:'Done'};
function _apvDoApprove(a){
  if(window.AMV_API && AMV_API.live){ AMV_API.actApproval(a.id,'approve').catch(()=>{}); }
  _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
  const act=_apvAction(a);
  toast(_APV_PAST[act.verb]||'Done','success');
  renderCrewView();
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
  r.innerHTML=`<div class="ov ape-ov" id="ape-bg"><div class="ape" role="dialog" aria-label="Edit before sending">
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
  on($('ape-bg'),'click',(e)=>{ if(e.target===e.currentTarget) apvClose(); });
  setTimeout(()=>{ try{ $('ape-title').focus(); }catch(e){} },30);
}
/* Turn a plain-English "when" into a normalized schedule. Understands "now",
   "every hour", "every day at 9", "every morning", "every Monday 9am",
   "weekly", "monthly", or a one-off phrase kept as-is. */
function _parseWhen(raw){
  const s=(raw||'').trim().toLowerCase();
  if(!s || /^(now|asap|immediately|right away)$/.test(s)) return {kind:'now', label:''};
  const hourFrom=(txt)=>{
    const m=txt.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || txt.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
    if(m){ let h=parseInt(m[1],10); const ap=(m[3]||'').toLowerCase(); if(ap==='pm'&&h<12)h+=12; if(ap==='am'&&h===12)h=0; if(h>=0&&h<=23) return h; }
    if(/\bmorning\b/.test(txt)) return 9;
    if(/\b(noon|midday)\b/.test(txt)) return 12;
    if(/\bafternoon\b/.test(txt)) return 15;
    if(/\b(evening|tonight)\b/.test(txt)) return 19;
    if(/\bnight\b/.test(txt)) return 21;
    return 9;
  };
  const DOW={sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,thursday:4,thu:4,thurs:4,friday:5,fri:5,saturday:6,sat:6};
  const recurring=/\b(every|each|daily|weekly|hourly|monthly)\b/.test(s);
  if(recurring){
    if(/\bhour/.test(s)) return {kind:'recurring', freq:'hourly', label:'Every hour'};
    let days=[]; for(const k in DOW){ if(new RegExp('\\b'+k+'\\b').test(s)) days.push(DOW[k]); }
    days=[...new Set(days)];
    const hour=hourFrom(s);
    if(days.length){ const sc={cad:'weekly',days,hour}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    if(/\bweek/.test(s)){ const sc={cad:'weekly',days:[1],hour}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    if(/\bmonth/.test(s)){ const sc={cad:'monthly',dom:1,hour}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    const sc={cad:'daily',hour}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)};
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
function _apvRegisterRecur(a){
  if(!a._recur) return false;
  const list=_loadSched();
  const isEmail=(a.result&&a.result.type)==='email';
  const desc=isEmail?('Send email “'+(a.result.subject||a.title||'')+'” to '+(a.destination||a.result.to||'recipients')):('Do: '+(a.title||'task'));
  const item={id:'a'+Date.now(), goal:desc, approval:a.autoApprove?'auto':'require', created:Date.now(), lastRun:null};
  if(a._recur.sched){ item.sched=a._recur.sched; item.next=_schedNext(a._recur.sched,Date.now()); }
  else { item.freq=a._recur.freq||'daily'; item.next=_freqNext(item.freq,Date.now()); }
  list.push(item); _saveSched(list);
  if(window.AMV_API && AMV_API.live && typeof AMV_API._fetch==='function'){ try{ AMV_API._fetch('/api/schedule/create',{method:'POST',body:JSON.stringify({goal:desc,sched:item.sched,freq:item.freq,approval:item.approval,payload:isEmail?{type:'email',result:a.result,to:a.destination,from:a.account}:null})}).catch(()=>{}); }catch(e){} }
  return true;
}
function _apvEditSave(id){
  const a=_apvCollectEdit(id); if(!a){ apvClose(); return; } apvClose();
  if(a._recur && _apvRegisterRecur(a)){ _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id)); toast('Scheduled - '+(a.scheduledAt||'recurring'),'success'); }
  else toast('Changes saved','success');
  if(S.tab==='crew') renderCrewView();
}
function _apvEditSend(id){
  const a=_apvCollectEdit(id); if(!a){ apvClose(); return; } apvClose();
  if(a._recur && _apvRegisterRecur(a)){ _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id)); toast('Scheduled - '+(a.scheduledAt||'recurring'),'success'); if(S.tab==='crew') renderCrewView(); return; }
  _apvDoApprove(a);
}
function _apvEditDelete(id){ if(!confirm('Delete this - it won’t be sent?')) return; apvClose(); cwReject(id); }
window._apvEditSave=_apvEditSave; window._apvEditSend=_apvEditSend; window._apvEditDelete=_apvEditDelete;
function apvRevise(id){
  const item=_cwApprovals().find(x=>x.id===id); apvClose();
  setTab('chat');
  setTimeout(()=>{ const ta=$('mta'); if(ta&&item){ ta.value='Revise this before it goes out - tell me what you changed and why:\n\n'+(item.result?.body||item.preview||item.title); ta.dispatchEvent(new Event('input')); ta.focus(); } },140);
}
window.apvPreview=apvPreview; window.apvClose=apvClose; window.apvApprove=apvApprove;
window.apvQuickApprove=apvQuickApprove; window.apvReject=apvReject; window.apvEdit=apvEdit; window.apvRevise=apvRevise;


