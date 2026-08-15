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
      // Both lanes run in the same daily batch: reviewCount are prepared for
      // you to approve, autoCount are applied automatically. Either can be 0.
      reviewCount:10, autoCount:0,
      runAt:'09:00',            // local time the daily batch runs
      trackResults:true,        // check for replies/interviews each morning
      resumes:[], contact:{name:'',email:'',phone:'',links:{}},
      targets:{roles:[],locations:[],remote:'any',salaryMin:0},
      prefs:{}, applied:[]      // history: every application, with its lane
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

  /* Split a day's matches into the two lanes the user asked for: some
     prepared for review, some applied automatically. Auto is only ever used
     where AMV can genuinely submit AND nothing is missing - anything else
     falls back to the review lane rather than silently doing nothing. */
  planBatch(jobs, profile){
    profile = profile || this.cfg();
    const wantAuto = Math.max(0, +profile.autoCount || 0);
    const wantReview = Math.max(0, +profile.reviewCount || 0);
    const out = { auto:[], review:[], needsInfo:[] };
    (jobs || []).forEach(job => {
      const miss = this.missingInfo(job, profile);
      if(miss.length){ out.needsInfo.push({ job, questions:miss }); return; }
      const ch = this.channelFor(job);
      const canAuto = (ch === 'email') || (ch === 'portal' && this.webAgentReady());
      if(canAuto && out.auto.length < wantAuto){ out.auto.push({ job, channel:ch, lane:'auto' }); return; }
      if(out.review.length < wantReview){ out.review.push({ job, channel:ch, lane:'review' }); }
    });
    return out;
  },

  /* Can AMV submit on a site with no API? True once web automation is live. */
  webAgentReady(){
    try{ return !!(typeof AMVConnectors !== 'undefined' && AMVConnectors.live('browser')); }
    catch(e){ return false; }
  },

  /* Record what actually happened, so the morning report is history, not a guess. */
  record(entries){
    const c = this.cfg();
    c.applied = (entries || []).concat(c.applied || []).slice(0, 500);
    this.save(c);
    return c.applied;
  },

  /* The morning email/report: everywhere it applied, split by lane, what is
     waiting on you, and any results that came back. */
  dailyReport(batch, results){
    batch = batch || { auto:[], review:[], needsInfo:[] };
    const title = j => (j && (j.title || j.role)) || 'Role';
    const co = j => (j && (j.company || j.employer)) || '';
    return {
      at: Date.now(),
      appliedAutonomously: batch.auto.map(x => ({ title:title(x.job), company:co(x.job), channel:x.channel, url:x.job && x.job.applyUrl })),
      awaitingYourReview: batch.review.map(x => ({ title:title(x.job), company:co(x.job), channel:x.channel, url:x.job && x.job.applyUrl })),
      needsInfo: batch.needsInfo.map(x => ({ title:title(x.job), questions:(x.questions || []).map(q => q.q) })),
      results: (results || []).map(r => ({ title:r.title || '', company:r.company || '', kind:r.kind || 'reply', detail:r.detail || '' })),
      counts: {
        applied: batch.auto.length, toReview: batch.review.length,
        needsInfo: batch.needsInfo.length, results: (results || []).length
      }
    };
  },

  /* Scan connected email for replies to applications AMV sent. Real signal
     only: it matches against what was actually applied to. */
  async checkResults(){
    if(!this.cfg().trackResults) return [];
    if(typeof AMVConnectors === 'undefined' || !AMVConnectors.live('google')) return [];
    let mail = [];
    try{ mail = await AMVConnectors.run('google.gmail_list_unread', {}); }catch(e){ return []; }
    const applied = this.cfg().applied || [];
    const hit = /(interview|application|position|role|schedule a|we would like|unfortunately|offer)/i;
    return (mail || []).filter(m => hit.test(String(m.subject || ''))).map(m => {
      const match = applied.find(a => m.subject && a.company && String(m.subject).toLowerCase().includes(String(a.company).toLowerCase()));
      const s = String(m.subject || '');
      return {
        title: match ? match.title : s.slice(0, 60), company: match ? match.company : (m.from || ''),
        kind: /interview|schedule a|we would like/i.test(s) ? 'interview'
            : /unfortunately|not moving forward/i.test(s) ? 'rejection' : 'reply',
        detail: s.slice(0, 120)
      };
    });
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
    /* THE HONEST ANSWER, WHICH THIS USED TO GET WRONG.

       This returned {ok:true, staged:true, reason:'Ready.'} having done
       nothing at all - no search, no draft, no send - and nothing anywhere
       calls run(), planBatch() or dailyReport() either. So the decision engine
       below is complete and correct and has never once been executed, while the
       card in Crew promised to find roles, apply, and email a morning report,
       and the setup modal collected somebody's resume and work authorisation to
       do it with.

       ok:true on a no-op is the worst available answer, because every caller
       treats it as "it ran". Until finding, drafting and sending are actually
       wired end to end, this says so. The profile is not wasted - it is what
       the scheduled research job uses to prepare applications for review. */
    return { ok:false, code:'not_wired',
      reason:'Applying on its own is not switched on yet. What runs today is the research half: '
        + 'AMV finds roles matching your profile and prepares each application for you to review. '
        + 'Nothing is submitted without you.' };
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
    '<p style="font-size:12.5px;color:var(--mu);margin:0 0 14px">I find roles that match your profile and prepare a tailored application for each one, ready for you to review and send. Submitting on my own is not switched on yet - nothing goes to an employer without you.</p>'+
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
        '<select id="jh-mode" class="sel" aria-label="Apply mode"><option value="ask"'+(c.mode==='ask'?' selected':'')+'>Show me each one before it is sent</option><option value="auto"'+(c.mode==='auto'?' selected':'')+'>Prepare as many as possible for one-tap sending</option></select>'+
      '<span style="font-size:11.5px;color:var(--mu);display:block;margin-top:5px">Either way, nothing reaches an employer until you send it.</span></label>'+
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

/* ═══════════════════════════════════════════════════════════════════════
   JOB BOARDS, BY COUNTRY.

   The job hunt knew American boards. Somebody in Munich, Seoul, Warsaw or
   Mumbai does not use them, so the feature was decoration for most of the
   world. This is the catalogue, grouped by country, with the one thing a
   person actually needs to know about each: whether AMV can finish the
   application or only prepare it.

   That distinction is shown rather than buried, because it is the difference
   between "it applied for me overnight" and "there are twelve applications
   waiting for me to tap send", and finding that out the hard way is how
   somebody misses a deadline.
   ═══════════════════════════════════════════════════════════════════════ */
let _JOBB = null;

async function _jobBoardsLoad(){
  if(_JOBB) return _JOBB;
  try{ _JOBB = await AMV_API.jobBoards(); }catch(e){ _JOBB = null; }
  return _JOBB;
}

async function openJobBoards(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ov" id="jb-bg"><div class="ml-modal"><div class="ml-head">'+
    '<div><div class="eyebrow">Job hunt</div><h2>Job boards</h2></div>'+
    '<button class="tp-x" id="jb-x" aria-label="Close">✕</button></div>'+
    '<div id="jb-body"><p class="mu">Loading…</p></div></div></div>';
  on($('jb-bg'),'click',(e)=>{ if(e.target===e.currentTarget) r.innerHTML=''; });
  on($('jb-x'),'click',()=>{ r.innerHTML=''; });

  const cat=await _jobBoardsLoad();
  const b=$('jb-body'); if(!b) return;
  if(!cat||!cat.boards){ b.innerHTML='<div class="ml-err">Could not load the boards. Try again in a moment.</div>'; return; }

  const byC={};
  for(const x of cat.boards){ (byC[x.country]=byC[x.country]||[]).push(x); }
  const codes=Object.keys(byC).sort();
  /* Three words, because this is the whole point of the list. */
  const badge=(x)=> x.autoApply
    ? '<span class="jb-can">AMV can apply</span>'
    : '<span class="jb-prep">AMV prepares it</span>';

  b.innerHTML=
    '<p class="mu ml-intro">'+escH(String(cat.boards.length))+' boards across '+escH(String(cat.countries))+' countries. '+
      'Where a posting publishes an address, AMV writes and sends the application from your own mailbox. '+
      'Where the board only takes applications through its own form, AMV fills everything in and you tap send - '+
      'those sites do not allow anything else, and AMV will not pretend otherwise.</p>'+
    '<div class="jb-list">'+codes.map(c=>{
      const list=byC[c];
      return '<div class="jb-c"><div class="jb-c-h">'+escH(list[0].flag+' '+c)+'</div>'+
        list.map(x=>'<div class="jb-row">'+
          '<a class="jb-n" href="'+escH(x.url)+'" target="_blank" rel="noopener noreferrer">'+escH(x.name)+'</a>'+
          badge(x)+
          (x.note?'<div class="jb-note">'+escH(x.note)+'</div>':'')+
        '</div>').join('')+'</div>';
    }).join('')+'</div>'+
    '<div class="ml-foot"><span class="mu" style="font-size:var(--t-xs)">Up to '+escH(String(cat.dailyCap))+
      ' applications a day, so your own address is never treated as bulk mail.</span></div>';
}
window.openJobBoards = openJobBoards;
