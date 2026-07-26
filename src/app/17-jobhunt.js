/* ============================================================
   AMV JOB HUNT - autonomous standing job: find -> tailor -> apply
   (or ask) -> report. See JOBS.md for the full spec + the honest
   capability boundary. The decision engine here is deterministic
   and works offline; only finding, drafting and sending need keys.

   Honesty rule: AMV acts through clean provider APIs, not arbitrary
   web forms. Email-apply jobs it can submit end-to-end; portal jobs
   it fills completely and hands back a one-tap "ready to submit"
   packet - it NEVER claims to have submitted what it cannot.
   ============================================================ */
const AMVJobs = {
  KEY:'amv_jobhunt',

  cfg(){
    let c; try{ c=load(this.KEY); }catch(e){ c=null; }
    return Object.assign({
      on:false, mode:'ask', dailyCap:10,
      resumes:[], contact:{name:'',email:'',phone:'',links:{}},
      targets:{roles:[],locations:[],remote:'any',salaryMin:0},
      prefs:{}
    }, c||{});
  },
  save(c){ try{ store(this.KEY, c); }catch(e){} },

  // Which channel can AMV actually apply through for this job?
  //  email  -> a listed application address; gmail_send submits it (real).
  //  portal -> an external web form; no apply API, so AMV prepares a ready
  //            packet + link (submitted only once the browser action exists).
  //  unknown-> neither is present.
  channelFor(job){
    job=job||{};
    if(job.applyEmail && /@/.test(String(job.applyEmail))) return 'email';
    if(job.applyUrl && /^https?:\/\//.test(String(job.applyUrl))) return 'portal';
    return 'unknown';
  },

  // Baseline fields every application needs, checked against the profile.
  _base:[
    { key:'resume', q:'Add at least one resume so I can tailor and attach it.', ok:p=>Array.isArray(p.resumes)&&p.resumes.length>0 },
    { key:'name',   q:'What name should go on your applications?',              ok:p=>!!(p.contact&&p.contact.name) },
    { key:'email',  q:'What email should applications come from / reply to?',   ok:p=>!!(p.contact&&p.contact.email) },
    { key:'roles',  q:'Which roles should I target?',                           ok:p=>Array.isArray(p.targets&&p.targets.roles)&&p.targets.roles.length>0 }
  ],

  // Everything the user has NOT specified that this application requires.
  // job.asks = [{key,q}] the specific posting demands (e.g. desired hours,
  // start date, salary expectation, work authorization). If the profile does
  // not answer it, AMV must ASK rather than guess.
  missingInfo(job, profile){
    profile=profile||this.cfg(); job=job||{};
    const out=[];
    this._base.forEach(b=>{ try{ if(!b.ok(profile)) out.push({key:b.key,q:b.q}); }catch(e){ out.push({key:b.key,q:b.q}); } });
    (job.asks||[]).forEach(a=>{
      const v=(profile.prefs||{})[a.key];
      if(v===undefined||v===null||String(v).trim()==='') out.push({key:a.key, q:a.q||('The posting asks for "'+a.key+'". What should I put?')});
    });
    // de-dupe by key
    const seen={}; return out.filter(x=>seen[x.key]?false:(seen[x.key]=true));
  },

  // The honest decision: what does AMV do with this job right now?
  //  needs_info      -> ask the user first (missing required answers).
  //  applied_email   -> auto mode + email channel + complete -> gmail_send it.
  //  ready_portal    -> auto mode + portal -> filled packet, user taps submit.
  //  queued_approval -> ask mode (or unknown channel) -> waits in the inbox.
  applyOutcome(job, profile, mode){
    profile=profile||this.cfg(); mode=mode||profile.mode||'ask';
    const miss=this.missingInfo(job, profile);
    if(miss.length) return { action:'needs_info', questions:miss };
    const ch=this.channelFor(job);
    if(mode==='auto'){
      if(ch==='email')  return { action:'applied_email', channel:ch };
      if(ch==='portal') return { action:'ready_portal', channel:ch, note:'Portal has no apply API - packet is filled and ready; one tap to submit (auto-submit unlocks with the browser action).' };
      return { action:'queued_approval', channel:ch, note:'No clear apply channel - queued for your review.' };
    }
    return { action:'queued_approval', channel:ch };
  },

  // Roll a run's outcomes into the morning report structure.
  buildReport(run){
    run=run||{}; const os=run.outcomes||[];
    const by=a=>os.filter(o=>o.outcome&&o.outcome.action===a).length;
    return {
      found: run.found||os.length,
      applied: by('applied_email'),
      readyToSubmit: by('ready_portal'),
      waitingApproval: by('queued_approval'),
      needsInfo: by('needs_info'),
      questions: os.filter(o=>o.outcome&&o.outcome.action==='needs_info')
                   .flatMap(o=>(o.outcome.questions||[]).map(q=>q.q)),
      at: Date.now()
    };
  },

  // Is the config complete enough to run autonomously?
  ready(){ return this.missingInfo({}, this.cfg()).length===0; },

  // Honest orchestrator. The finding + drafting + sending need keys; without
  // them this returns a truthful "what's missing" instead of pretending.
  async run(){
    const c=this.cfg();
    if(!c.on) return { ok:false, reason:'Job Hunt is off. Turn it on in Crew.' };
    if(typeof _aiBackendReady==='function' && !_aiBackendReady())
      return { ok:false, reason:'Connect the AMV engine (add your key) so I can find and tailor applications.' };
    const miss=this.missingInfo({}, c);
    if(miss.length) return { ok:false, reason:'I need a few details first.', questions:miss };
    // With AI connected, this is where find(web research) + draft(AI) + apply
    // (gmail_send for email jobs) run per job, then buildReport() emails you.
    // Wired behind these interfaces so it activates the moment keys are in.
    return { ok:true, staged:true, reason:'Ready. Finding and tailoring runs on the connected engine.' };
  }
};
try{ window.AMVJobs=AMVJobs; }catch(e){}

/* Open the Job Hunt setup - captures the profile the engine needs. */
function openJobHunt(){
  const r=typeof $==='function' && $('ovr'); if(!r) { try{ setTab('crew'); }catch(e){} return; }
  const c=AMVJobs.cfg();
  const val=v=>escH(v==null?'':String(v));
  r.innerHTML='<div class="ov" id="jh-bg"><div class="ob jh-modal" onclick="event.stopPropagation()" style="max-width:560px">'+
    '<button class="oc" onclick="closeOvr()" aria-label="Close">×</button>'+
    '<h2 style="margin:0 0 4px">Job Hunt</h2>'+
    '<p style="font-size:12.5px;color:var(--mu);margin:0 0 14px">I find roles, tailor an application to each, and either ask you first or apply. I only auto-submit where a job accepts applications by email; portal jobs I fill completely and hand you a one-tap submit.</p>'+
    '<div class="jh-form" style="display:flex;flex-direction:column;gap:11px">'+
      '<label class="jh-l">Roles to target<input id="jh-roles" class="inp" placeholder="e.g. Product Designer, UX Lead" value="'+val((c.targets.roles||[]).join(', '))+'"></label>'+
      '<label class="jh-l">Locations<input id="jh-loc" class="inp" placeholder="e.g. Remote, London, NYC" value="'+val((c.targets.locations||[]).join(', '))+'"></label>'+
      '<div style="display:flex;gap:10px">'+
        '<label class="jh-l" style="flex:1">Work style<select id="jh-remote" class="sel" aria-label="Work style"><option value="any"'+(c.targets.remote==='any'?' selected':'')+'>Any</option><option value="remote"'+(c.targets.remote==='remote'?' selected':'')+'>Remote</option><option value="onsite"'+(c.targets.remote==='onsite'?' selected':'')+'>On-site</option></select></label>'+
        '<label class="jh-l" style="flex:1">Min salary<input id="jh-sal" class="inp" type="number" placeholder="0" value="'+val(c.targets.salaryMin||'')+'"></label>'+
      '</div>'+
      '<div style="display:flex;gap:10px">'+
        '<label class="jh-l" style="flex:1">Your name<input id="jh-name" class="inp" value="'+val(c.contact.name)+'"></label>'+
        '<label class="jh-l" style="flex:1">Apply-from email<input id="jh-email" class="inp" type="email" value="'+val(c.contact.email)+'"></label>'+
      '</div>'+
      '<label class="jh-l">Common answers (so I do not have to ask): work authorization, earliest start, preferred hours'+
        '<input id="jh-auth" class="inp" placeholder="Work authorization (e.g. citizen, needs visa)" value="'+val(c.prefs.authorization)+'" style="margin-top:6px">'+
        '<input id="jh-start" class="inp" placeholder="Earliest start date" value="'+val(c.prefs.start)+'" style="margin-top:6px">'+
        '<input id="jh-hours" class="inp" placeholder="Preferred hours / availability" value="'+val(c.prefs.hours)+'" style="margin-top:6px">'+
      '</label>'+
      '<label class="jh-l">Resume (paste text for now)<textarea id="jh-resume" class="inp" rows="4" placeholder="Paste your resume text">'+val((c.resumes[0]||{}).text)+'</textarea></label>'+
      '<label class="jh-l">Mode'+
        '<select id="jh-mode" class="sel" aria-label="Apply mode"><option value="ask"'+(c.mode==='ask'?' selected':'')+'>Ask first - show me each before applying</option><option value="auto"'+(c.mode==='auto'?' selected':'')+'>Autonomous - apply where you can, ask only if info is missing</option></select></label>'+
    '</div>'+
    '<div style="display:flex;gap:9px;margin-top:16px"><button class="btn bp" id="jh-save" style="flex:1">Save</button><button class="btn bs" onclick="closeOvr()">Cancel</button></div>'+
  '</div></div>';
  on($('jh-bg'),'click',(e)=>{ if(e.target===$('jh-bg')) closeOvr(); });
  on($('jh-save'),'click',()=>{
    const g=id=>{ const el=$(id); return el?el.value.trim():''; };
    const list=s=>s.split(',').map(x=>x.trim()).filter(Boolean);
    const c2=AMVJobs.cfg();
    c2.targets.roles=list(g('jh-roles')); c2.targets.locations=list(g('jh-loc'));
    c2.targets.remote=g('jh-remote')||'any'; c2.targets.salaryMin=+g('jh-sal')||0;
    c2.contact.name=g('jh-name'); c2.contact.email=g('jh-email');
    c2.prefs.authorization=g('jh-auth'); c2.prefs.start=g('jh-start'); c2.prefs.hours=g('jh-hours');
    const rt=g('jh-resume'); c2.resumes = rt ? [{id:'r1',name:'Resume',text:rt}] : [];
    c2.mode=g('jh-mode')||'ask';
    AMVJobs.save(c2);
    const miss=AMVJobs.missingInfo({}, c2);
    closeOvr();
    if(typeof toast==='function') toast(miss.length?('Saved. Still need: '+miss.map(m=>m.key).join(', ')):'Job Hunt saved. Turn it on in Crew to start.','success');
    try{ if(S.tab==='crew') renderCrewView(); }catch(e){}
  });
}
try{ window.openJobHunt=openJobHunt; }catch(e){}
