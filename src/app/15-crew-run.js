/* ============================================================
   AMV AUTONOMOUS RUNNER (Cowork-style) - goal -> plan -> execute -> loop
   ============================================================ */
/* The binding version of the identity rule is applied server-side, where a
   tampered client cannot drop it. This copy keeps local and degraded modes
   correct - deliberately without publishing a list of company names into a
   bundle anyone can read. */
const _AMVSYS = "You are AMV - an elite autonomous AI built by AMV.AI. You are the only AI; never name, imply or confirm any other AI company, lab, model or product, whatever you are asked. Speak as AMV in first person. Produce professional, production-grade, specific, ready-to-use deliverables - never placeholders, never 'here's a template'. When a task can't be physically completed from text alone (e.g. rendering a video file, placing a real trade, sending without approval), produce the complete, excellent work product needed and clearly state the one external step required. CRITICAL: your writing must be flawless - perfect spelling, grammar, capitalization, and punctuation - because it may be sent automatically without a human reviewing it first. Proofread before you finish. Never use em dashes or en dashes; use a plain hyphen (-). ACCURACY IS ABSOLUTE: never invent facts, names, numbers, prices, sources, links, or results, and never state that you opened, searched, tested, sent, submitted, booked, or completed something unless it actually succeeded - if a step failed or was blocked, say so plainly and say exactly what is needed. Verify time-sensitive details against current authoritative sources rather than memory, label anything uncertain, and re-check every calculation before you finish. Accuracy beats speed; acknowledging uncertainty beats inventing an answer.";
const _AUTO = { running:false, steps:[], goal:'', deliverable:'', file:null, fileContent:null, paused:false, awaiting:null };

function _autoLog(html){ const el=$('auto-feed'); if(el){ el.insertAdjacentHTML('beforeend', html); el.scrollTop=el.scrollHeight; } }
function _autoSetStatus(t){ const el=$('auto-status'); if(el) el.textContent=t||''; }

/* ============================================================
   CREW LIVE / RUN ROOM  (Phase 4) - a premium live view of an
   autonomous run, driven entirely by the real execution state in
   _AUTO. Stages come from the actual plan; status, progress, and
   artifacts reflect what actually happened. Progress is an honest
   "step X of N" - never a fabricated percentage or ETA. Takeover
   controls (pause / add instruction / cancel) genuinely act on the run.
   ============================================================ */
function _rrInit(plan){
  _AUTO._art=[];
  const el=document.getElementById('rr-stages'); if(!el) return;
  el.innerHTML=(plan||[]).map((s,i)=>`<div class="rr-stage waiting" id="rr-st-${i}"><span class="rr-st-ix">${i+1}</span><div class="rr-st-b"><div class="rr-st-t">${escH(s.step||('Step '+(i+1)))}</div><div class="rr-st-meta">${s.needs_approval?'<span class="rr-st-tag">Needs approval</span>':'Waiting'}</div></div><span class="rr-st-ic"></span></div>`).join('');
  _rrArtifacts(); _rrProg();
}
function _rrActive(i){
  const el=document.getElementById('rr-st-'+i);
  if(el){ el.className='rr-stage active'; const m=el.querySelector('.rr-st-meta'); if(m) m.textContent='AMV is working on this…'; try{ el.scrollIntoView({block:'nearest'}); }catch(e){} }
  _rrProg();
}
function _rrBlocked(i){
  const el=document.getElementById('rr-st-'+i);
  if(el){ el.className='rr-stage blocked'; const m=el.querySelector('.rr-st-meta'); if(m) m.textContent='Waiting for your approval'; }
}
function _rrDone(i, badge){
  const el=document.getElementById('rr-st-'+i);
  if(el){ el.className='rr-stage done'; const m=el.querySelector('.rr-st-meta'); if(m) m.textContent=(badge||'Done').replace(/^[✓✕]\s*/,''); }
  if(badge){ const w=/wrote\s+(\S+)/.exec(badge); if(w) _rrAddArtifact(w[1]); }
  _rrProg();
}
function _rrAddArtifact(name){ _AUTO._art=_AUTO._art||[]; if(name && _AUTO._art.indexOf(name)<0){ _AUTO._art.push(name); _rrArtifacts(); } }
function _rrArtifacts(){
  const el=document.getElementById('rr-artifacts'); if(!el) return;
  const a=_AUTO._art||[];
  el.innerHTML=a.length?('<div class="rr-art-h">Artifacts created</div><div class="rr-art-row">'+a.map(n=>`<span class="rr-art">${escH(n)}</span>`).join('')+'</div>'):'';
}
function _rrProg(){
  const plan=_AUTO.steps||[];
  const done=document.querySelectorAll('.rr-stage.done').length;
  const active=document.querySelector('.rr-stage.active')?1:0;
  const bar=document.getElementById('rr-bar'); if(bar) bar.style.width=(plan.length?Math.round(done/plan.length*100):0)+'%';
  const lbl=document.getElementById('rr-prog-lbl');
  if(lbl) lbl.textContent=plan.length?('Step '+Math.min(done+active||1, plan.length)+' of '+plan.length):'';
}
function _rrComplete(){
  document.querySelectorAll('.rr-stage.active').forEach(e=>{ e.className='rr-stage done'; });
  const bar=document.getElementById('rr-bar'); if(bar) bar.style.width='100%';
  const lbl=document.getElementById('rr-prog-lbl'); const plan=_AUTO.steps||[]; if(lbl&&plan.length) lbl.textContent='All '+plan.length+' steps done';
}
function _rrTogglePause(){
  _AUTO.paused=!_AUTO.paused;
  const b=document.getElementById('rr-pause');
  if(b) b.textContent=_AUTO.paused?'▶ Resume':'⏸ Pause';
  const dot=document.getElementById('rr-dot'); if(dot) dot.classList.toggle('paused',_AUTO.paused);
  if(typeof _autoSetStatus==='function') _autoSetStatus(_AUTO.paused?'Paused - will stop after this step':'Working…');
}
function _rrAddInstruction(){
  const t=prompt('Add an instruction for AMV - it will use this on the next step:');
  if(t && t.trim()){ _AUTO.inject=t.trim(); if(typeof toast==='function') toast('Noted - AMV will use this on the next step','info',3500); }
}
window._rrTogglePause=_rrTogglePause; window._rrAddInstruction=_rrAddInstruction;

async function runAutonomous(goal, opts){
  opts=opts||{};
  _AUTO.running=true; _AUTO.goal=goal; _AUTO.steps=[]; _AUTO.deliverable=''; _AUTO.paused=false;
  _AUTO.file=opts.file||null; _AUTO.fileContent=opts.fileContent||null; _AUTO.workspace=opts.workspace||null; _AUTO.silent=!!opts.silent;
  const maxSteps=opts.maxSteps||12;

  // Pre-flight budget guard: don't start a multi-step run with no quota headroom.
  const _bg=_budgetGuard(5000);
  if(!_bg.ok){
    _autoLog('<div class="auto-ev"><b>Not enough usage</b><div>'+escH(_bg.reason)+'</div></div>');
    _autoSetStatus(''); _AUTO.running=false;
    if(!_AUTO.silent && typeof toast==='function') toast(_bg.reason,'info',6000);
    return;
  }

  // Make this run visible in Mission Control: it shows under "Active work"
  // while it runs and moves to "Recently completed" when done - so a task you
  // start is never invisible.
  let _mcVisTask=null;
  try{ _mcVisTask={id:'bg'+Date.now(),type:'autonomous',title:(goal||'Autonomous task').replace(/\s+/g,' ').trim().slice(0,90),status:'running',created:Date.now(),progress:0,schedId:(opts&&opts.schedId)||null}; _bgQueue.tasks.push(_mcVisTask); if(S.tab==='crew'){ try{ renderCrewView(); }catch(e){} } }catch(e){}

  _autoLog('<div class="auto-ev plan"><b>Goal</b><div>'+escH(goal)+'</div></div>');
  _autoSetStatus('Planning…');

  // 1) PLAN
  let plan;
  try{
    // give the planner the actual file content so it plans around what's really there
    let fileNote='';
    if(_AUTO.fileContent){ fileNote='\n\nThe user provided files. Plan using their ACTUAL contents below (do not ask for them again):\n'+String(_AUTO.fileContent).slice(0,10000); }
    else if(_AUTO.file){ fileNote='\nThe user attached a file: '+_AUTO.file.name+'.'; }
    /* The plan decides the quality of everything after it, so this is where the
       good engine earns its cost - and where a malformed answer used to collapse
       the whole run into a single generic step without saying so. */
    const planRes=await qRun('plan',
      _AMVSYS+' Break this goal into an ordered list of concrete steps you will execute yourself. Each step is one action. Return ONLY a JSON array of objects: [{"step":"short title","action":"what you will do","needs_approval":true|false}]. Mark needs_approval true ONLY for steps that send/share/delete/publish something externally.'+fileNote+'\n\nGOAL: '+goal,
      'Output strictly valid JSON, no prose, no code fences.', { json:true });
    plan=JSON.parse(String(planRes.text).replace(/^```json?|```$/g,'').trim());
  }catch(e){
    plan=[{step:'Complete the task',action:goal,needs_approval:false}];
  }
  _AUTO.steps=plan;
  _autoLog('<div class="auto-ev plan"><b>Plan - '+plan.length+' steps</b><ol>'+plan.map(s=>'<li>'+escH(s.step)+'</li>').join('')+'</ol></div>');
  try{ _rrInit(plan); }catch(e){}

  // 2) EXECUTE each step, feeding results forward
  let context='';
  for(let i=0;i<plan.length && i<maxSteps;i++){
    if(!_AUTO.running){ _autoLog('<div class="auto-ev stop">Stopped by user.</div>'); break; }
    while(_AUTO.paused && _AUTO.running){ await new Promise(r=>setTimeout(r,300)); }
    if(!_AUTO.running){ _autoLog('<div class="auto-ev stop">Stopped by user.</div>'); break; }
    if(_AUTO.inject){ context+='\n\n[User instruction]: '+_AUTO.inject; _autoLog('<div class="auto-ev plan"><b>Your instruction</b><div>'+escH(_AUTO.inject)+'</div></div>'); _AUTO.inject=null; }
    // mid-run budget guard: stop cleanly if the window runs out partway through
    const _mg=_budgetGuard(4000);
    if(!_mg.ok){ _autoLog('<div class="auto-ev"><b>Paused - out of usage</b><div>'+escH(_mg.reason)+' Finished '+i+' of '+plan.length+' steps.</div></div>'); _autoSetStatus(''); break; }
    const s=plan[i];
    // approval gate
    if(s.needs_approval){
      try{ _rrBlocked(i); }catch(e){}
      const ok=await _autoApprove(s.step, s.action);
      if(!ok){ _autoLog('<div class="auto-ev skip">Skipped (not approved): '+escH(s.step)+'</div>'); continue; }
    }
    _autoSetStatus('Step '+(i+1)+'/'+plan.length+': '+s.step);
    try{ _rrActive(i); }catch(e){}
    _autoLog('<div class="auto-ev run" id="ev'+i+'"><span class="spin"></span> <b>'+escH(s.step)+'</b></div>');

    // Decide: does this step need code execution or a file write?
    let result='';
    try{
      const wsNote=_AUTO.workspace?'\n\nYou have a WORKSPACE of real files. To create or edit a file, reply with ONLY a fenced block that starts with a line "WRITE_FILE: <path>" then the full file contents. Use this to actually produce deliverables on disk.':'';
      /* One bounded piece of work, so it runs on the cheap tier with a
         self-check rather than on whichever engine the model dropdown says.
         A run is a plan plus N of these plus a delivery; billing every one at
         the price of the hardest thing AMV can do is what makes an agent
         expensive out of all proportion to what it did. */
      /* A step whose answer is a NUMBER goes through the accuracy ladder rather
         than the ordinary one: computed where it can be computed, agreed with
         itself where it cannot, and escalated only when the samples disagree.
         Arithmetic is where a wrong answer is most visible, and it is the one
         kind of wrong that costs nothing to eliminate. */
      const stepPrompt='Step: '+s.action+'\n\nIf this step is best done by running code (computation, data parsing, transformation), reply with ONLY a fenced code block (js or python). Otherwise reply with the completed written result for this step.'+wsNote+' Context so far:\n'+(context.slice(-3000)||'(none)')+(_AUTO.fileContent?('\n\nWorkspace / file contents:\n'+String(_AUTO.fileContent).slice(0,12000)):'');
      const stepSys=_AMVSYS+' Execute this one step and produce the actual, finished output for it - production quality.';
      const numeric=(typeof AMVVerify!=='undefined' && AMVVerify.shouldVerify)
        ? !!AMVVerify.shouldVerify(s.action, '') : /\b(calculat|comput|total|sum|average|percent|convert|how much|how many)\b/i.test(String(s.action||''));
      const stepRes = numeric
        ? await qAccurate('step', stepPrompt, stepSys, { prose:true, samples:2 })
        : await qRun('step', stepPrompt, stepSys, { refine:true, prose:true });
      const decide=stepRes.text;
      // file write?
      const fileWrite=decide.match(/WRITE_FILE:\s*([^\n`]+)\n([\s\S]*?)(?:```|$)/);
      if(_AUTO.workspace && fileWrite){
        const path=fileWrite[1].trim().replace(/^`+|`+$/g,'');
        const body=fileWrite[2].replace(/```$/,'').trimEnd();
        const w=await _AUTO.workspace.writeFile(path, body);
        result='Wrote file '+path+(w.toDisk?' (saved to disk)':' (ready to download)');
        _autoStepDone(i, s.step, '✓ wrote '+path, '<div class="auto-out">'+escH(body.slice(0,400))+(body.length>400?'…':'')+'</div>');
        context+='\n\n['+s.step+']\n'+result; continue;
      }
      const code=extractCode(decide,'js')||extractCode(decide,'python');
      if(code){
        const lang=/def |import |print\(/.test(code)?'python':'js';
        const run=await runCode(code, lang);
        result='Ran '+lang+' → '+(run.ok?(run.stdout||run.result||'ok'):'error: '+run.stderr);
        _autoStepDone(i, s.step, (run.ok?'✓':'✕')+' executed code', '<pre>'+escH((run.stdout||run.result||run.stderr||'').slice(0,600))+'</pre>');
      } else {
        result=decide;
        _autoStepDone(i, s.step, '✓ done', '<div class="auto-out">'+(typeof md==='function'?md(decide.slice(0,800)):escH(decide.slice(0,800)))+'</div>');
      }
    }catch(err){
      result='(step failed: '+err.message+')';
      _autoStepDone(i, s.step, '✕ '+err.message, '');
      if(/key/i.test(err.message)){ _autoSetStatus('Needs API key'); break; }
    }
    context+='\n\n['+s.step+']\n'+result;
  }

  // 3) SYNTHESIZE deliverable
  if(_AUTO.running){
    _autoSetStatus('Compiling deliverable…');
    try{
      /* The last thing the user actually reads. This one gets the best engine
         the account can reach, and is checked before it is shown. */
      const delivRes=await qRun('final',
        'Goal: '+goal+'\n\nWork log:\n'+context.slice(-8000)+'\n\nProduce the final, polished deliverable the user asked for. Markdown.',
        _AMVSYS+' Output only the finished, polished deliverable - ready to use as-is.',
        { prose:true, minLen:80 });
      const deliv=delivRes.text;
      _AUTO.deliverable=deliv;
      _autoLog('<div class="auto-ev done"><b>✓ Done</b></div>');
      try{ _rrComplete(); }catch(e){}
      const dv=$('auto-deliverable'); if(dv){
        const ws=_AUTO.workspace;
        const written=ws?ws.files.filter(f=>f.dirty||f.output||f.handle&&f._touched):[];
        const outCount=ws?ws.files.filter(f=>f.output||f.dirty).length:0;
        const wsLine=ws&&ws.files.some(f=>f.output||f.dirty||f.handle)
          ? '<div class="auto-ws-summary">'+(ws.dirHandle?'✓ Files written back to your connected folder.':'')+(outCount?' <button class="btn bs" id="auto-dl">⬇ Download '+outCount+' output'+(outCount>1?'s':'')+'</button>':'')+'</div>'
          : '';
        dv.style.display='block'; dv.innerHTML='<div class="auto-deliv-h">Deliverable</div><div class="auto-deliv-body">'+(typeof md==='function'?md(deliv):escH(deliv))+'</div>'+wsLine+'<div class="auto-deliv-act"><button class="btn" id="auto-save">Save to a chat</button><button class="btn" id="auto-new">New task</button></div>';
        on($('auto-save'),'click',()=>{ try{ S.cur=null; setMsgs([{r:'u',c:goal},{r:'a',c:deliv,model:S.model,ts:Date.now()}]); setTab('chat'); toast('Saved','success'); }catch(e){} });
        on($('auto-new'),'click',openCowork);
        on($('auto-dl'),'click',()=>{ const n=ws.downloadOutputs(); toast(n?('Downloading '+n+' file'+(n>1?'s':'')):'No new files','info'); });
      }
    }catch(e){ _autoLog('<div class="auto-ev stop">Could not compile: '+escH(e.message)+'</div>'); }
  }
  _autoSetStatus(_AUTO.running?'Complete':'Stopped');
  _AUTO.running=false;
  try{ if(_mcVisTask){ _mcVisTask.status='done'; _mcVisTask.progress=100; _mcVisTask.result=_AUTO.deliverable||''; if(S.tab==='crew'){ try{ renderCrewView(); }catch(e){} } } }catch(e){}
}
function _autoStepDone(i,title,badge,detail){
  try{ _rrDone(i, badge); }catch(e){}
  const ev=$('ev'+i); if(!ev) return;
  ev.classList.remove('run'); ev.classList.add('ev-done');
  ev.innerHTML='<b>'+escH(title)+'</b> <span class="auto-badge">'+escH(badge)+'</span>'+(detail||'');
}
function _autoApprove(step, action){
  // A silent/background run has no UI to approve in - never send/share
  // without explicit approval, so skip any step that needs it.
  if(_AUTO.silent) return Promise.resolve(false);
  return new Promise(resolve=>{
    const host=document.getElementById('rr-approve');
    const html='<div class="rr-appr" id="appr"><div class="rr-appr-h"><span class="rr-appr-ic">\u23F8</span><div><div class="rr-appr-t">Approval needed before AMV continues</div><div class="rr-appr-s">'+escH(step)+'</div></div></div><div class="rr-appr-d">'+escH(action)+'</div><div class="rr-appr-btns auto-appr-btns"><button class="btn bp" id="appr-y">Approve &amp; continue</button><button class="btn" id="appr-n">Skip this step</button></div></div>';
    if(host){ host.innerHTML=html; try{ host.scrollIntoView({block:'center'}); }catch(e){} } else { _autoLog(html); }
    on($('appr-y'),'click',()=>{ const a=$('appr'); if(a){const b=a.querySelector('.auto-appr-btns'); if(b) b.innerHTML='<span class="tp-sched">\u2713 Approved</span>';} setTimeout(()=>{ if(host) host.innerHTML=''; },700); resolve(true); });
    on($('appr-n'),'click',()=>{ const a=$('appr'); if(a){const b=a.querySelector('.auto-appr-btns'); if(b) b.innerHTML='<span class="auto-skip-l">Skipped</span>';} setTimeout(()=>{ if(host) host.innerHTML=''; },700); resolve(false); });
  });
}
function stopAutonomous(){ _AUTO.running=false; _autoSetStatus('Stopping…'); }

/* ---- Cowork-style entry panel ---- */
/* ── First-run onboarding / activation ───────────────────────────
   One clean welcome, one question, four tappable paths. Tapping a path
   routes straight into a real first action via the chat intent router,
   so the user reaches a success in their first session. Non-nagging:
   shows once, dismissible, remembers completion. This is the moment a
   broad product becomes an obvious one. */
function _startOnboarding(){
  const r=$('ovr'); if(!r) return;
  const name=(S.user&&S.user.name)?String(S.user.name).split(' ')[0]:'there';
  const paths=[
    { k:'write',  title:'Write something',    sub:'Essay, email, post, plan',            ic:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', demo:'Write a punchy 200-word intro for my project' },
    { k:'image',  title:'Create an image',     sub:'Any style, from a sentence',          ic:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>', demo:'Create an image of a calm mountain lake at sunrise' },
    { k:'build',  title:'Build an app',         sub:'Describe it, AMV codes it',           ic:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>', demo:'Build a simple to-do list app I can use' },
    { k:'auto',   title:'Automate something',   sub:'Run it on a schedule',                ic:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', demo:'Every morning, summarize the top tech news for me' },
  ];
  r.innerHTML='<div class="ov" id="onb-bg"><div class="ob onb sig-aura" onclick="event.stopPropagation()">'+
    '<button class="oc" onclick="_finishOnboarding()" aria-label="Skip">\u00d7</button>'+
    '<div class="onb-mark ce-mark-sig">'+((typeof amvMark==='function')?amvMark(40):'')+'</div>'+
    '<div class="onb-head"><span class="onb-eyebrow">Welcome to AMV</span>'+
      '<h2 class="onb-title">Hi '+escH(name)+' - what should we make first?</h2>'+
      '<p class="onb-sub">AMV doesn\u2019t just answer - it does the work. Pick one to watch it happen. You can ask for any of this in chat anytime.</p></div>'+
    '<div class="onb-grid stagger-in">'+paths.map(p=>'<button class="onb-card" data-onb="'+p.k+'">'+
      '<span class="onb-card-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+p.ic+'</svg></span>'+
      '<span class="onb-card-t">'+p.title+'</span><span class="onb-card-s">'+p.sub+'</span></button>').join('')+'</div>'+
    '<button class="onb-skip" onclick="_finishOnboarding()">I\u2019ll explore on my own</button>'+
  '</div></div>';
  on($('onb-bg'),'click',_finishOnboarding);
  r.querySelectorAll('[data-onb]').forEach(b=>on(b,'click',()=>{
    const p=paths.find(x=>x.k===b.dataset.onb); _finishOnboarding();
    if(!p) return;
    setTab('chat');
    // drop the demo prompt into the composer so the user sees exactly what to type,
    // then send it through the real intent router - a genuine first result.
    setTimeout(()=>{ try{ const ta=$('mta'); if(ta){ ta.value=p.demo; ta.dispatchEvent(new Event('input')); } if(typeof sendMsg==='function') sendMsg(); }catch(e){} }, 220);
  }));
}
function _finishOnboarding(){ try{ saveStr('amv_onboarded','1'); }catch(e){} try{ closeOvr(); }catch(e){} }
try{ window._startOnboarding=_startOnboarding; window._finishOnboarding=_finishOnboarding; }catch(e){}

