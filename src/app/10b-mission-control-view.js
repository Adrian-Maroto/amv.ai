/* ============================================================
   MISSION CONTROL  (Phase 2) - the workforce overview.
   Aggregates the real state of everything AMV is doing: what needs
   approval, what's active, what's autonomous, what's scheduled, what
   finished, and what's blocked. Reads only real stores; empty groups
   collapse to a quiet line instead of fabricating activity.
   ============================================================ */
/* Per account. Raw localStorage skips _scopeKey, so "Pause all autonomous" was
   device-wide: one account pausing stopped another account's jobs, and the
   first account resuming silently restarted them. A safety control that one
   person can toggle for somebody else is not one. */
function _autonomyPaused(){ try{ return loadStr('amv_autonomy_paused')==='1'; }catch(e){ return false; } }
function _setAutonomyPaused(v){ try{ saveStr('amv_autonomy_paused', v?'1':'0'); }catch(e){} }
/* The emergency stop. _setAutonomyPaused only halts the schedule THIS browser
   walks; server-side jobs run on the worker's cron and keep going until the
   server is told. The call was fired and forgotten and the message went out
   regardless, so a failed request left somebody reading "nothing runs until you
   resume" while their autonomous jobs carried on doing things.

   A safety control is the last place to report an outcome it did not wait for,
   so this waits, and says plainly what is still running if it could not. */
async function _setAutonomyEverywhere(paused){
  _setAutonomyPaused(paused);              // local first: this half always works
  if(!(window.AMV_API && AMV_API.live && AMV_API.pauseAutonomy))
    return { ok:false, code:'needs_service' };
  try{ await AMV_API.pauseAutonomy(paused); return { ok:true }; }
  catch(e){ return { ok:false, code:'failed', error:(e&&e.message)||'' }; }
}
async function pauseAllAutonomous(){
  const res = await _setAutonomyEverywhere(true);
  renderCrewView();
  if(res.ok){ toast('All autonomous work paused - nothing runs until you resume.','info',3800); return; }
  toast(res.code === 'needs_service'
    ? 'Paused on this device. AMV is not connected to a backend, so there is no server-side work to stop.'
    : 'Paused on this device, but the server was NOT told'+(res.error?' ('+res.error+')':'')+
      ' - anything scheduled to run in the background is STILL RUNNING. Try again.',
    res.code === 'needs_service' ? 'info' : 'error', 8000);
}
async function resumeAllAutonomous(){
  const res = await _setAutonomyEverywhere(false);
  renderCrewView();
  if(res.ok){ toast('Autonomous work resumed.','success'); return; }
  toast(res.code === 'needs_service'
    ? 'Resumed on this device.'
    : 'Resumed on this device, but the server was NOT told'+(res.error?' ('+res.error+')':'')+
      ' - background work stays paused until it is. Try again.',
    res.code === 'needs_service' ? 'success' : 'error', 8000);
}
try{ window._setAutonomyEverywhere=_setAutonomyEverywhere; }catch(e){}
window.pauseAllAutonomous=pauseAllAutonomous; window.resumeAllAutonomous=resumeAllAutonomous;

function _mcState(){
  const appr=_cwApprovals();
  const jobs=_cwJobs();
  const sched=(typeof _loadSched==='function')?_loadSched():[];
  const bg=(typeof _bgQueue!=='undefined'&&_bgQueue.tasks)?_bgQueue.tasks:[];
  /* A finished RUN is not a finished JOB.

     Every run marked itself `done` and dropped into the Completed pile, so a
     job scheduled for 9am every day showed as "Completed" after its first
     morning - while it kept running every morning after that. The schedule and
     the run lived in two separate lists and nothing joined them, so nothing
     could tell the difference.

     A run carries the id of the job it belongs to now. If that job is still
     scheduled, the run is history for a job that is very much alive, and it
     belongs with the job rather than in Completed. Only work that has genuinely
     finished for good lands there. */
  const liveJobIds=new Set(sched.map(t=>t.id));
  const isRunOfLiveJob=t=>!!(t.schedId && liveJobIds.has(t.schedId));
  return {
    appr,
    active: bg.filter(t=>t.status==='running'||t.status==='queued'),
    failed: bg.filter(t=>t.status==='failed'),
    done: bg.filter(t=>t.status==='done' && !isRunOfLiveJob(t)),
    runsOfJobs: bg.filter(t=>t.status==='done' && isRunOfLiveJob(t)),
    auton: jobs.filter(j=>j.on),
    sched,
    /* THE JOBS THE SERVER IS ACTUALLY RUNNING.

       This section used to render `sched` alone - a list in this browser's
       localStorage, with the server's id stapled on afterwards. The cron does
       not read that list. It reads the account's own record, which is why a job
       kept running after the local entry was gone, and why a job set up on a
       phone was invisible on a laptop while quietly spending money on both.

       So the server's list is the truth here, and the local one is only for
       work that never made it to the server (no engine connected, plan cannot
       schedule) - which is real, still runs while AMV is open, and now says so
       instead of being displayed identically to background work. */
    server: (typeof _AUTOS !== 'undefined' && Array.isArray(_AUTOS)) ? _AUTOS : [],
    serverLoaded: (typeof window._autoLoadState === 'function') ? !!window._autoLoadState().loaded : false,
    serverError: (typeof window._autoLoadState === 'function') ? (window._autoLoadState().error || '') : ''
  };
}
/* Asked once per session, not once per render - renderCrewView runs on every
   toggle, and a refresh that triggers a render that triggers a refresh is a
   loop against the user's own backend. */
let _mcAskedServer = false;
/* Local entries that the server also knows about, so one job is one row. */
function _mcLocalOnly(st){
  const known = new Set((st.server||[]).map(x=>x.id));
  return (st.sched||[]).filter(t=>!(t.autoId && known.has(t.autoId)));
}
/* When a recurring job last produced something, so the card can say "ran this
   morning, runs again tomorrow" rather than implying it has never run. */
function _mcLastRunOf(st, jobId){
  const runs=(st.runsOfJobs||[]).filter(t=>t.schedId===jobId);
  if(!runs.length) return null;
  return runs.reduce((a,b)=>((b.created||0)>(a.created||0)?b:a));
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
function _mcSchedRow(t, st){
  const when = t.sched?((typeof _schedHumanOf==='function')?_schedHumanOf(t.sched):''):((typeof _freqLabel==='function')?_freqLabel(t.freq):'');
  let next='';
  try{ if(t.next) next=new Date(t.next).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }catch(e){}
  /* "Ran this morning, runs again tomorrow" is the sentence that tells somebody
     the job is alive. Its absence is why a running job read as a finished one. */
  let ran='';
  try{
    const last=st?_mcLastRunOf(st,t.id):null;
    const at=(last&&last.created)||t.lastRun;
    if(at) ran=new Date(at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }catch(e){}
  const auto = t.approval==='auto';
  let waiting=0; try{ waiting=_cwApprovals().filter(a=>a.fromJob===t.id).length; }catch(e){}
  const mode = t.paused
    ? '<span class="mc-sched-mode paused">Paused</span>'
    : (auto ? '<span class="mc-sched-mode auto">Autonomous - sends automatically</span>'
            : '<span class="mc-sched-mode req">Ask first - you approve each one</span>');
  const waitChip = (!auto && waiting) ? `<span class="mc-sched-waiting">${waiting} waiting in Needs your approval</span>` : '';
  /* A job the quiet-hours window pushed back says so on its own row. Otherwise
     the only evidence is a "next" time that moved, which reads like the
     schedule being wrong rather than like the setting working. */
  const heldChip = (t.heldUntil && t.heldUntil > Date.now())
    ? '<span class="mc-sched-quiet">Held until your quiet hours end</span>' : '';
  return `<div class="mc-sched-row">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(t.goal||'Scheduled job')}</div>
      <div class="mc-sched-meta">${escH(when)}${ran?` · last ran ${escH(ran)}`:''}${next?` · next ${escH(next)}`:''}${t.localOnly?' · runs while AMV is open':''}</div>
      <div class="mc-sched-mode-row">${mode}${waitChip}${heldChip}</div>
    </div>
    <div class="mc-sched-acts">
      <button class="btn mc-mini ${auto?'ghost':'bp'}" data-dact="_schedToggleApproval" data-darg="${t.id}">${auto?'Make me approve first':'Make autonomous'}</button>
      <button class="btn mc-mini ghost" data-dact="_schedEdit" data-darg="${t.id}">Edit</button>
      <button class="btn mc-mini ghost" data-dact="_mcCancelSched" data-darg="${t.id}">Cancel</button>
    </div>
  </div>`;
}
/* CHECKED, then said. The save was wrapped in an empty catch and the message
   went out regardless, so a write that failed - storage full, storage disabled,
   a private window - told somebody a job was cancelled while it stayed on the
   schedule and kept running. This one is local, which is exactly why it is
   worth getting right: there is no server to correct it later. */
async function _mcCancelSched(id){
  let gone = false;
  /* The server's copy first - see _schedServer. */
  const t0 = _loadSched().find(t=>t.id===id);
  if(t0 && typeof _schedServer === 'function' && !await _schedServer(t0, 'delete')){
    toast('AMV\u2019s server could not be reached, so the job was not cancelled - it still runs there. Try again in a moment.', 'error', 7000);
    renderCrewView(); return;
  }
  try{
    _saveSched(_loadSched().filter(t=>t.id!==id));
    gone = !_loadSched().some(t=>t.id===id);
  }catch(e){ gone = false; }
  toast(gone ? 'Scheduled task cancelled'
             : 'That could not be cancelled - it is still on the schedule. Try again.',
        gone ? 'info' : 'error', gone ? 3000 : 7000);
  renderCrewView();
}
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

/* HOW the crew works, as opposed to WHAT it works on.

   Every job on this screen says what to do. None of them says how much care to
   take, what to prefer, or what to leave out - and those are account-wide
   preferences, not per-job ones. Somebody who wants "always check two sources"
   should say it once and have it hold for the job they set up next month.

   The server appends this to the system prompt of every unattended run, so
   editing it here genuinely changes the next result. It is not a note kept for
   the user's own reference, and the screen must not imply that it is.

   Two things it deliberately is not. It is not permission: the limits an
   unattended run operates under sit above this text on the server and cannot be
   edited from a textarea. And it is not unbounded - it rides along on every
   single run, so it is capped, and the box says so rather than truncating in
   silence. */
const MC_STANDING_MAX = 1200;

/* HOW FAR ANY BACKGROUND JOB MAY GO WITHOUT ASKING.

   Each job carries its own level, and this is the ceiling over all of them -
   the setting somebody makes once when they decide "nothing sends on its own",
   rather than a decision they have to remember correctly for every job they
   ever create. The server applies it at the moment of spending and sending, so
   a job set higher is held back rather than rewritten, and raising this later
   gives every job back exactly what it was configured to do.

   Written as three plain statements about what happens tonight, because that is
   the question being answered. "Approve before action" is a category name;
   "AMV does the work, then waits for you before anything goes out" is the
   thing somebody is actually choosing. */
const MC_LEVELS = [
  { id:'suggest', label:'Suggest only',
    say:'AMV tells you a job is due and what it would do. It does not run it, so it spends nothing.' },
  { id:'require', label:'Ask me first',
    say:'AMV does the work, then waits for you. Nothing is sent, posted or acted on until you approve it.' },
  { id:'auto',    label:'Let it run',
    say:'AMV does the work and delivers it on its own. Still no sending, buying or posting - an unattended run can only produce text.' },
];
function _mcCeilingHTML(){
  const cur = (typeof window._autoCeilingLevel==='function' ? window._autoCeilingLevel() : 'auto') || 'auto';
  const held = (typeof _AUTOS!=='undefined' && Array.isArray(_AUTOS))
    ? _AUTOS.filter(x=>['suggest','require','auto'].indexOf(String(x.approval||'require'))
                     > ['suggest','require','auto'].indexOf(cur)).length : 0;
  return `<section id="mc-ceiling" class="mc-sec mc-ceiling">
    <div class="sec-head">
      <h3>How far AMV may go on its own</h3>
      <span class="sec-sub">The most any background job may do without you, now and for anything you add later. A job set further than this is held back rather than changed.</span>
    </div>
    <div class="mc-lv" role="radiogroup" aria-label="How far AMV may go on its own">
      ${MC_LEVELS.map(l=>`
        <button class="mc-lv-opt${cur===l.id?' on':''}" role="radio" aria-checked="${cur===l.id?'true':'false'}"
                tabindex="${cur===l.id?'0':'-1'}"
                data-dact="mcSetCeiling" data-darg="${l.id}">
          <span class="mc-lv-dot" aria-hidden="true"></span>
          <span class="mc-lv-b">
            <span class="mc-lv-t">${escH(l.label)}</span>
            <span class="mc-lv-s">${escH(l.say)}</span>
          </span>
        </button>`).join('')}
    </div>
    ${held?`<div class="mc-lv-held">${held===1?'1 of your jobs is':held+' of your jobs are'} set further than this and ${held===1?'is':'are'} being held back. ${held===1?'It keeps':'They keep'} its setting - raise this and ${held===1?'it goes':'they go'} back to normal.</div>`:''}
  </section>`;
}
async function mcSetCeiling(level){
  if(!['suggest','require','auto'].includes(level)) return;
  try{
    if(typeof window._autoCeiling !== 'function') throw new Error('not-connected');
    const d = await window._autoCeiling(level);
    renderCrewView();
    const n = typeof d.restrains === 'number' ? d.restrains : 0;
    const said = (MC_LEVELS.find(l=>l.id===level)||{}).say || '';
    if(typeof toast==='function')
      toast(said + (n ? ' ' + n + ' of your jobs ' + (n===1?'is':'are') + ' set further than this and will be held back.' : ''),
            'success', 6500);
  }catch(e){
    /* The setting is a safety promise, so a failure to save it must never look
       like a save. Somebody who believes they have switched off autonomous
       sending and has not is worse off than somebody who never tried. */
    if(typeof toast==='function')
      toast((e && e.message === 'not-connected')
        ? 'AMV is not connected to its engine, so that could not be saved. Your jobs are UNCHANGED.'
        : 'That did not save: ' + ((e && e.message) || 'the server refused it') + '. Your jobs are UNCHANGED.',
        'error', 7000);
    renderCrewView();
  }
}
try{ window.mcSetCeiling = mcSetCeiling; }catch(e){}
/* ARROW KEYS, BECAUSE THESE SAY THEY ARE RADIO BUTTONS.

   role="radio" inside role="radiogroup" is a promise about behaviour, not a
   label: a screen reader announces "1 of 3" and the person reaches for the
   arrow keys. Three buttons that all sit in the tab order and ignore arrows
   announce themselves as one thing and behave as another, which is worse than
   plain buttons would have been.

   So: one stop in the tab order (the selected option), arrows and Home/End move
   between them, and moving SELECTS - which is what a radio group does, and what
   makes it usable without a mouse at all. Delegated, so it survives the
   re-render that follows every change. */
try{
  document.addEventListener('keydown', (e)=>{
    const opt = e.target && e.target.closest && e.target.closest('.mc-lv-opt');
    if(!opt) return;
    const keys = ['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'];
    if(keys.indexOf(e.key) < 0) return;
    const opts = [...document.querySelectorAll('.mc-lv-opt')];
    const i = opts.indexOf(opt);
    if(i < 0) return;
    e.preventDefault();
    let n = i;
    if(e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % opts.length;
    else if(e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + opts.length) % opts.length;
    else if(e.key === 'Home') n = 0;
    else if(e.key === 'End') n = opts.length - 1;
    const next = opts[n];
    if(!next || next === opt) return;
    /* Focus first so the person hears where they are even if the save is
       slow, then select - the render that follows keeps focus because the
       newly-selected option is the one carrying tabindex 0. */
    try{ next.focus(); }catch(_){}
    const lvl = next.dataset && next.dataset.darg;
    if(lvl) mcSetCeiling(lvl);
  });
}catch(e){}

function _mcStandingHTML(){
  const cur = (typeof window._autoStandingText==='function' ? window._autoStandingText() : '') || '';
  return `<section id="mc-standing" class="mc-sec mc-standing">
    <div class="sec-head">
      <h3>How the crew should work</h3>
      <span class="sec-sub">Applies to every background job you have now and every one you add later. AMV reads this before each run.</span>
    </div>
    <textarea id="mc-standing-box" class="mc-standing-box" rows="3" maxlength="${MC_STANDING_MAX}"
      placeholder="e.g. Think carefully before answering, check at least two sources, and keep it under five bullets. Skip anything I have already seen this week."
      aria-describedby="mc-standing-note">${escH(cur)}</textarea>
    <div class="mc-standing-foot">
      <span id="mc-standing-note" class="mc-standing-note">This changes how the work is done, not what AMV is allowed to do. Background runs still never send, buy, or post anything without your approval.</span>
      <span class="mc-standing-right">
        <span id="mc-standing-count" class="mc-standing-count">${cur.length}/${MC_STANDING_MAX}</span>
        <button class="btn mc-mini" id="mc-standing-save" data-dact="mcSaveStanding">Save</button>
      </span>
    </div>
  </section>`;
}
/* ── WHAT AMV ACTUALLY DID WHILE NOBODY WAS WATCHING ─────────────────────────

   Background work is the one part of this product that happens with the person
   absent, which makes it the one part they have no way to check. Everything
   else they can see happening. This is the record of everything else.

   Three things it has to show that a list of finished results does not:

   - Runs that FAILED. A job that has produced nothing for a week is either
     failing every night or has genuinely had nothing to say, and those call for
     opposite responses. Failures used to set a field on the job and appear
     nowhere.
   - The level each run EXECUTED at, recorded at the time. Reading it off the
     job's current setting would be reading the one thing most likely to have
     changed since.
   - What each run COST. Unattended spending that nobody can itemise is the
     thing that makes people turn a feature off entirely.

   Read from the results the server already returns, so there is no second
   record to drift from the first. */
const MC_ACT_SHOWN = 12;
const _MC_OUTCOME = {
  emailed:   ['sent',      'Emailed to you'],
  'in-app':  ['done',      'Waiting in AMV'],
  waiting:   ['wait',      'Waiting for your approval'],
  suggested: ['idle',      'Not run - suggest only'],
  failed:    ['err',       'Did not complete'],
  /* Its own state, not a failure. A run stopped because it has not been given
     a permission has done nothing wrong, and showing it in red beside real
     breakages teaches people to ignore the red. */
  needs_access: ['need',   'Needs your permission'],
};
/* WHAT TODAY'S RUN IS WAITING FOR, ON TODAY'S RUN.

   The server sends the missing permissions as data rather than only as prose,
   so each one can be listed against the run that wanted it and can name the
   place it is fixed. That matters because the same job asks for different
   things on different days - a single line saying "needs access" on a job that
   runs every night tells somebody nothing about which night or what for. */
/* WHAT A JOB WILL NEED, SHOWN BEFORE IT GETS THERE.

   The one below says what a run that already stopped was missing, which is
   right and is too late to be the only place it is said. The server resolves
   the same question for every job on the list, so the gap is visible while
   somebody is still sitting in front of it. Rendered on the job row itself;
   this lives here because the two belong together and drift apart otherwise. */
function _mcWillNeed(item){
  const list = Array.isArray(item && item.willNeed) ? item.willNeed : [];
  if(!list.length) return '';
  return `<span class="mc-willneed" title="${escH(list.map(n=>String(n.needs||'')).join(' · '))}">
    Needs ${list.map(n=>escH(String(n.id||n.needs||''))).join(', ')} before this can run
  </span>`;
}

function _mcNeeds(r){
  const list = Array.isArray(r && r.needs) ? r.needs : [];
  if(!list.length) return '';
  return `<span class="mc-need">
    <span class="mc-need-h">Important - to finish this run AMV needs:</span>
    <span class="mc-need-l">${list.map(n=>`<span class="mc-need-i">
      <b>${escH(String(n.needs||''))}</b>
      <em>so it can ${escH(String(n.label||''))}${n.where?` · add it in ${escH(String(n.where))}`:''}</em>
    </span>`).join('')}</span>
  </span>`;
}

function _mcAgo(ts){
  const d = Number(ts)||0; if(!d) return '';
  const m = Math.round((Date.now()-d)/60000);
  if(m < 1) return 'just now';
  if(m < 60) return m + ' min ago';
  if(m < 60*24) return Math.round(m/60) + 'h ago';
  const days = Math.round(m/1440);
  return days === 1 ? 'yesterday' : days + ' days ago';
}
function _mcMoney(n){
  const v = Number(n)||0;
  if(v <= 0) return 'nothing';
  if(v < 0.01) return 'under a cent';
  return '$' + v.toFixed(2);
}
/* ── A LETTER YOU CAN ACTUALLY SEND ────────────────────────────────────────
   The end of option (a), and the reason it is worth anything.

   A run can find a subscription, work out that its receipts come from a
   mailbox somebody reads, and write the cancellation - and if that letter only
   exists inside a paragraph of prose, the person has to retype it. That is the
   difference between a feature and a mention of one.

   IT IS HANDED OVER, NOT SENT. The owner's decision: the person's own mail
   client now, their own mailbox later, never AMV's domain. AMV sending to
   strangers from its own domain fails twice over - it makes the product a
   sending relay, so one abuse wave burns the reputation that carries every
   password reset and receipt; and a merchant cannot verify that a robot
   address is the account holder, so it is exactly the cancellation they are
   entitled to ignore. Coming from the person's own address is not a lesser
   version of this. It is the version that works.

   Only ever drafts the server marked deliverable - a letter to an unattended
   mailbox is not offered at all, because offering it is offering an action
   that does not exist. */
function _mcMailto(d){
  const q = 'subject=' + encodeURIComponent(String(d.subject || ''))
          + '&body=' + encodeURIComponent(String(d.body || ''));
  return 'mailto:' + encodeURIComponent(String(d.to || '')).replace(/%40/g, '@') + '?' + q;
}
/* The plain-text form, for the copy that goes into a client this browser
   cannot open. Headers included, because a body with no recipient is half a
   letter and the address is the part that must not be retyped from memory. */
function _mcDraftText(d){
  return 'To: ' + String(d.to || '') + '\nSubject: ' + String(d.subject || '') + '\n\n' + String(d.body || '');
}
function _mcDraftsHTML(r){
  const ds = (r && Array.isArray(r.drafts)) ? r.drafts : [];
  if(!ds.length) return '';
  return `<span class="mc-draft">
    <span class="mc-draft-h">${escH(ds.length === 1 ? 'A cancellation is ready to send' : ds.length + ' cancellations are ready to send')}</span>
    ${ds.map((d, i) => `<span class="mc-draft-row">
      <span class="mc-draft-t">${escH(String(d.merchant || 'Subscription'))} · to ${escH(String(d.to || ''))}</span>
      <a class="btn mc-mini bp mc-draft-go" href="${escH(_mcMailto(d))}">Open in your mail app</a>
      <button class="btn mc-mini ghost mc-draft-go" data-dact="mcCopyDraft" data-darg="${escH(String(r.id))}|${i}">Copy it</button>
    </span>`).join('')}
    <span class="mc-draft-note">AMV cannot send these itself. Opening one puts it in your own mail app, from your own address - which is the version a provider will act on, and the only one you can check in your Sent folder.</span>
  </span>`;
}
/* Copy is a real action with a real failure mode - a browser that refuses the
   clipboard, a page without focus - and saying "Copied" on a clipboard that is
   still empty is the small version of saying "Sent" on a send that never
   happened. */
async function mcCopyDraft(arg){
  const [id, ix] = String(arg || '').split('|');
  const all = (typeof _AUTO_RESULTS !== 'undefined' && Array.isArray(_AUTO_RESULTS)) ? _AUTO_RESULTS : [];
  const r = all.find(x => String(x.id) === String(id));
  const d = r && Array.isArray(r.drafts) ? r.drafts[Number(ix)] : null;
  if(!d){ toast('That draft is no longer here - run the job again for a fresh one.', 'error', 5000); return; }
  try{
    await navigator.clipboard.writeText(_mcDraftText(d));
    toast('Copied, with the address and subject - paste it into your mail app.', 'success', 4000);
  }catch(e){
    toast('Your browser would not let AMV use the clipboard, so nothing was copied. Open it in your mail app instead.', 'error', 6000);
  }
}
try{ window.mcCopyDraft = mcCopyDraft; }catch(e){}

function _mcActivityHTML(){
  const all = (typeof _AUTO_RESULTS!=='undefined' && Array.isArray(_AUTO_RESULTS)) ? _AUTO_RESULTS : [];
  const rows = all.slice().sort((a,b)=>(b.at||0)-(a.at||0)).slice(0, MC_ACT_SHOWN);
  const spent = all.reduce((t,r)=>t + (Number(r.costUSD)||0), 0);

  if(!rows.length){
    /* An empty timeline and a timeline that could not be loaded are different
       facts, and only one of them means "nothing has happened". */
    const st = (typeof window._autoLoadState==='function') ? window._autoLoadState() : { loaded:true, error:'' };
    return `<section id="mc-activity" class="mc-sec">
      <div class="sec-head"><h3>What AMV did on its own</h3><span class="sec-sub">Every unattended run, what it cost, and what happened to it.</span></div>
      <div class="mc-empty-row">${st && st.error
        ? 'This could not be loaded (' + escH(st.error) + '). It does not mean nothing ran. <button class="mc-sec-link" data-dact="mcReloadJobs">Try again</button>'
        : 'Nothing has run on its own yet. Once a background job runs, every one of its runs is listed here - including the ones that failed.'}</div>
    </section>`;
  }

  return `<section id="mc-activity" class="mc-sec">
    <div class="sec-head">
      <h3>What AMV did on its own</h3>
      <span class="sec-sub">Every unattended run, what it cost, and what happened to it. Nothing here was sent, bought or posted - background work can only produce text.</span>
    </div>
    <div class="mc-act">${rows.map(r=>{
      const o = _MC_OUTCOME[String(r.outcome||'')] || (r.kind==='failed' ? _MC_OUTCOME.failed : ['done','Completed']);
      return `<div class="mc-act-row ${o[0]}">
        <span class="mc-act-when">${escH(_mcAgo(r.at))}</span>
        <span class="mc-act-b">
          <span class="mc-act-t">${escH(String(r.detail||'Background job').slice(0,120))}</span>
          <span class="mc-act-m">
            <span class="mc-act-st">${escH(o[1])}</span>
            <span class="mc-act-sep">·</span>${escH(_mcMoney(r.costUSD))}
            ${r.approval?`<span class="mc-act-sep">·</span>ran as “${escH((MC_LEVELS.find(l=>l.id===r.approval)||{}).label || r.approval)}”`:''}
          </span>
          ${_mcNeeds(r)}
          ${_mcDraftsHTML(r)}
        </span>
      </div>`;
    }).join('')}</div>
    <div class="mc-act-foot">
      ${all.length > rows.length ? 'Showing the last ' + rows.length + ' of ' + all.length + ' runs. ' : ''}
      Total spent on background work in this record: <b>${escH(_mcMoney(spent))}</b>.
    </div>
  </section>`;
}

async function mcSaveStanding(){
  const box = $('mc-standing-box'), btn = $('mc-standing-save');
  if(!box) return;
  const text = box.value.trim();
  if(btn){ btn.disabled = true; btn.textContent = 'Saving...'; }
  try{
    if(typeof window._autoStanding !== 'function') throw new Error('not-connected');
    const d = await window._autoStanding(text);
    /* Say how far it reaches, because "saved" alone leaves them wondering
       whether the jobs already running picked it up. They did. */
    const n = typeof d.appliesTo === 'number' ? d.appliesTo : 0;
    if(typeof toast==='function'){
      toast(!text
        ? 'Cleared. Background jobs go back to running the standard way.'
        : (n ? 'Saved. Your next run of all ' + n + ' background job' + (n>1?'s':'') + ' follows this.'
             : 'Saved. Every background job you add will follow this.'),
        'success', 5000);
    }
    if(btn){ btn.textContent = 'Saved'; setTimeout(()=>{ if(btn) btn.textContent='Save'; }, 1800); }
  }catch(e){
    /* Never leave the box looking saved when it is not - this is the one
       failure that silently makes the whole feature a lie. */
    if(typeof toast==='function'){
      toast(e && e.message === 'not-connected'
        ? 'Connect the AMV engine in Settings before setting standing instructions.'
        : 'Could not save that: ' + ((e && e.message) || 'the server did not accept it'),
        'error', 6000);
    }
    if(btn) btn.textContent = 'Save';
  }finally{ if(btn) btn.disabled = false; }
}
try{ window.mcSaveStanding = mcSaveStanding; }catch(e){}
/* Delegated, so it survives every re-render of the Crew screen rather than
   being re-bound (or forgotten) each time the section is rebuilt. */
try{
  document.addEventListener('input', (e)=>{
    const t = e.target;
    if(!t || t.id !== 'mc-standing-box') return;
    const c = document.getElementById('mc-standing-count');
    if(c) c.textContent = t.value.length + '/' + MC_STANDING_MAX;
  });
}catch(e){}

/* ── WHAT THIS JOB ACTUALLY PRODUCES ─────────────────────────────────────────

   The catalogue is the reason anybody pays for Crew, and a card in a grid can
   only say what a job is ABOUT. "Study coach that knows what you keep getting
   wrong" is a nice sentence and it is also what every AI product on the
   internet says about itself. Nobody buys a subscription off a sentence.

   So a card opens, and shows three things a sentence cannot:

   - A specimen of what lands in front of them. Labelled as a specimen, in so
     many words, because the one thing worse than a vague promise is a made-up
     result that reads like theirs.
   - The EXACT instruction the unattended runner is given. Nothing else in this
     product is as convincing as showing the machinery, and it costs nothing to
     show: it is not a secret, it is the thing they are buying.
   - Where it runs and what it needs, honestly - including "this one needs your
     mailbox and cannot run with AMV closed", which loses a sale occasionally
     and prevents every refund that starts with "it never did anything".

   A free visitor gets all of it. They are the person deciding whether this is
   worth money, and showing them a paywall instead of the product is how you
   lose somebody who would have paid. */
/* The same card, for somebody who has not paid: it opens, it shows everything,
   and where the switch would be it says what unlocks it. A dead toggle that
   silently does nothing would teach them the product is broken, which is a
   worse outcome than not selling to them. */
/* ONE CARD, REACHABLE FROM OUTSIDE THE RENDER.

   This was a closure inside renderCrewView, which is fine until something
   OTHER than that function needs to draw a job - and the ranking at the top of
   the catalogue repaints on its own when the server answers, long after the
   render has returned. A second copy of a card is a second thing to keep in
   step with `cw-job`, `cwPeek` and `cwToggle`, and the copy is always the one
   that goes stale. */
/* THE EXAMPLE WAS ALWAYS THERE AND NOBODY SAW IT.

   Asked for: "add many more visual things to crew so people are intrigued by
   the examples of what they can do."

   Every good card in this catalogue already carries a `sample` - the real
   output that job produces, written line by line, specific down to the
   numbers. It was behind a link saying "See an example", which is a link
   somebody clicks after they are already interested. So a page whose entire
   job is to make you interested was a list of DESCRIPTIONS - a hundred
   paragraphs of what a thing is - when it could have been a list of RESULTS.

   "6 needed you today. 58 did not." does more work than any description of an
   inbox digest, and it was one line away from the surface the whole time.

   The first line only, and never more: it is a hook, and a card that unfolds
   into five lines of output is a card nobody can scan past. The rest is still
   one press away, where somebody who is now interested will actually read it. */
function _cwSampleLine(j){
  try{
    const s = j && j.sample;
    if(!Array.isArray(s) || !s.length) return '';
    const first = String(s[0] || '').trim();
    if(!first) return '';
    return '<span class="cw-job-out"><span class="cw-job-out-k">It sends you</span>'
         + '<span class="cw-job-out-l">' + escH(first) + '</span></span>';
  }catch(e){ return ''; }
}
try{ window._cwSampleLine=_cwSampleLine; }catch(e){}

function _cwJobCard(j){
  /* What this job declares it needs, against what is actually connected.
     Switching a job on used to flip a flag and nothing else, so a job needing
     a bank or a mailbox that was never linked sat there looking active and
     quietly did nothing forever. The card says which it is. */
  const miss=_cwNeedsMissing(j);
  /* EVERY ONE OF THEM, AND THE GOOD NEWS TOO.

     Two changes and they are the same change: say the whole truth about what
     this job is waiting for. Before, a job needing three things named whatever
     the table recognised and said nothing about the rest, and a job needing
     nothing more said nothing at all - so "I have already connected that" and
     "this needs something you have not got" looked identical on the card,
     which is a blank space either way.

     A person who has done the work should be told they have done it. That is
     the whole difference between a catalogue you browse nervously and one you
     press. */
  const note=miss.length
    ? `<div class="cw-job-miss">${j.on?'Cannot run yet':'Needs'} ${miss.length} thing${miss.length===1?'':'s'}: ${escH(miss.join(', '))}. <button class="cw-job-fix" data-dact="cwConnect" data-darg="${escH(j.id)}">Connect</button></div>`
    : (_cwNeedsReady(j)
        ? `<div class="cw-job-ready"><span class="cw-ready-dot"></span>${escH(_cwReadyLine(j))}</div>`
        : '');
  /* The body is a real button, so the card opens with a keyboard and reads
     as something you can press. It was a div: the only interactive thing on
     a card was the toggle, which meant the only way to find out what a job
     did was to switch it on. */
  return `<div class="cw-job ${j.on?'on':''}${miss.length?' blocked':''}">
    <div class="cw-job-ic" aria-hidden="true">${_safeIcon(j.icon)}</div>
    <button class="cw-job-body" data-dact="cwPeek" data-darg="${j.id}">
      <span class="cw-job-t">${escH(j.title)}</span>
      <span class="cw-job-d">${escH(j.desc)}</span>
      ${_cwSampleLine(j)}
      ${_cwLocLine(j)}
      <span class="cw-job-need">${escH(_cwUsesLine(j))}
        <span class="cw-job-where ${_cwWhereState(j)}">${escH(_cwWhereLabel(j))}</span>
      </span>
      <span class="cw-job-see">${Array.isArray(j.sample)&&j.sample.length?'See the whole thing \u2192':'See what it does \u2192'}</span>
    </button>
    ${note}
    <button class="cw-toggle ${j.on?'on':''}" data-dact="cwToggle" data-darg="${j.id}" aria-label="Turn ${escH(j.title)} ${j.on?'off':'on'}"><span class="cw-knob"></span></button>
  </div>`;
}
/* Which of the two a catalogue card should be is a fact about the account, not
   about the caller, so it is decided here rather than at each call site. */
function _cwAnyCard(j){ return _planAllowsCrew() ? _cwJobCard(j) : _cwLockedCard(j); }
function _cwLockedCard(j){
  return `<div class="cw-job locked">
    <div class="cw-job-ic" aria-hidden="true">${_safeIcon(j.icon)}</div>
    <button class="cw-job-body" data-dact="cwPeek" data-darg="${j.id}">
      <span class="cw-job-t">${escH(j.title)}</span>
      <span class="cw-job-d">${escH(j.desc)}</span>
      ${_cwSampleLine(j)}
      ${_cwLocLine(j)}
      <span class="cw-job-need">${escH(_cwUsesLine(j))}
        <span class="cw-job-where ${_cwWhereState(j)}">${escH(_cwWhereLabel(j))}</span>
      </span>
      <span class="cw-job-see">${Array.isArray(j.sample)&&j.sample.length?'See the whole thing →':'See what it does →'}</span>
    </button>
  </div>`;
}

/* THE PAGE YOU READ TO DECIDE, AND WHY IT WAS HARD TO READ.

   Measured on Money leak detector at 1280x900: 271 words, and the button that
   turns the job on was 71px below the bottom of the panel. So the one screen
   whose whole purpose is "do I want this running" opened without its answer
   visible, under a raw 90-word instruction, two warning boxes and two
   explanatory footnotes.

   Asked for: simple, very easy to read, and a clear description.

   Four changes and nothing is deleted.

     - The description leads, at reading size, on its own.
     - The facts that used to be scattered - how often, where it runs, what it
       uses, what it still needs - are one short list, in one place, in the
       same order every time.
     - The exact instruction is still the exact instruction and is still one
       click away. It is behind a disclosure because somebody deciding whether
       they want a thing is not yet reading its source, and it was the single
       biggest block of text on the page.
     - The decision sits in a footer that does not scroll away. That is the
       actual fix: the rest is legibility, this is the difference between a
       screen that works and one that does not. */
/* THE ICON ON A CREW CARD COMES FROM THE SERVER, SO IT GOES THROUGH _safeIcon.

   The everyday catalogue is fetched - `AMV_API.everyday(cc)` - and
   _cwEverydayJob carries `raw.icon` straight through from that response. It was
   then interpolated into innerHTML with no escaping at all, on three surfaces:
   the job card, the peek panel, and the approvals card, whose icon comes off a
   stored record instead.

   _safeIcon is the helper the marketplace already uses for exactly this, for
   exactly this reason: an emoji or short label is escaped, and markup passes
   only if it is one of AMV's own SVGs. Nothing about the rendered icon changes.

   The strict CSP means an injected tag could not have RUN anything, which is
   why this is a hole in the discipline rather than a live exploit - and the
   discipline is the point. Reasoning about which strings are safe is the thing
   escH exists to stop anybody having to do, and "the server sends it" stops
   being reassuring the moment a catalogue takes a submission or somebody
   points AMV at a different backend, which Settings lets them do. */
function cwPeek(id){
  const j = (_cwAllJobs()||[]).find(x=>x.id===id); if(!j) return;
  const r = $('ovr'); if(!r) return;
  const miss = _cwNeedsMissing(j);
  const bg = _cwRunsUnattended(j);
  const allowed = _planAllowsCrew();
  const every = j.every ? (_CREW_EVERY_UI[j.every] || j.every) : 'every day';
  const P = (typeof PLANS!=='undefined' && PLANS[CREW_REQUIRED_PLAN]) || { name:'Pro', price:15 };

  /* One row per fact, and the row that is a PROBLEM is marked as one rather
     than given a box of its own further down the page. Two warning panels for
     two facts about the same job was most of what made this feel heavy. */
  const fact = (label, value, cls) =>
    `<div class="cwp-fact${cls?' '+cls:''}"><dt>${escH(label)}</dt><dd>${value}</dd></div>`;
  const facts =
      fact('How often', escH('Runs ' + every))
    + fact('Where it runs', bg
        ? 'On AMV\u2019s servers, whether or not this window is open'
        : 'In this browser, while AMV is open \u2014 it needs something that lives here')
    + (j.needs ? fact('What it uses', escH(j.needs)) : '')
    /* SAID BEFORE THEY SWITCH IT ON, not afterwards in the answer.

       A boost is not a requirement and must not read like one, so it gets a
       row of its own with no warning class and no Connect button - the job
       runs either way. It says what changes, because "better with a bank
       connection" on its own invites the reader to guess, and what actually
       changes here is whether a figure is a receipt or a real debit. */
    + (_cwBoostList(j).length
        ? fact('Better with', escH(_cwBoostList(j).join(', '))
            + (_cwBoostMissing(j).length
                ? '<span class="cwp-boostwhy"> — not connected, so this runs on what it can read</span>'
                : '<span class="cwp-boostwhy"> — connected, so the figures are real charges</span>'))
        : '')
    /* The requirement is not a FACT about the job, it is the thing standing
       between somebody and using it - so it is not a row in a definition list
       any more. It is a block with a button, below. */
    /* The wording is the wording it had. This row replaced a section of its
       own, and the sentence explaining WHY it asks went with the section on
       the first pass - which is the half that stops the question feeling like
       an interrogation when it arrives. It is a fact about the job and it
       belongs in the facts. */
    + (j.asks && j.asks.q
        ? fact('It will ask you for', '<b>'+escH(j.asks.q)+'</b>'
            + (j.asks.ph?'<span class="cwp-fact-ph">'+escH(j.asks.ph)+'</span>':'')
            + '<span class="cwp-fact-ph">This job works from what you tell it, so AMV asks once when you '
            + 'switch it on rather than running on nothing.</span>')
        : '');

  r.innerHTML = `<div class="ov" id="cwp-bg"><div class="cwp" role="dialog" aria-modal="true" aria-labelledby="cwp-t">
    <button class="cwp-x" id="cwp-close" aria-label="Close">\u2715</button>
    <div class="cwp-scroll">
      <div class="cwp-head">
        <span class="cwp-ic" aria-hidden="true">${_safeIcon(j.icon)}</span>
        <h2 class="cwp-t" id="cwp-t">${escH(j.title)}</h2>
      </div>
      <p class="cwp-desc">${escH(j.desc)}</p>

      ${Array.isArray(j.sample)&&j.sample.length?`<div class="cwp-sec">
        <div class="cwp-sec-h">What you get</div>
        <div class="cwp-sample" aria-label="Example of what this job produces">
          ${j.sample.map(l=>`<div class="cwp-line">${escH(l)}</div>`).join('')}
        </div>
        <div class="cwp-note">An example of the shape and the level of detail. Your version is built from your own information, so the specifics will be yours, not these.</div>
      </div>`:''}

      ${miss.length ? `<div class="cwp-need">
        <div class="cwp-need-t">Before this can run</div>
        <p class="cwp-need-p">AMV needs ${escH(miss.join(' and '))} before this can do anything, and
          it will not pretend otherwise. It takes a minute, and you come straight back here.</p>
        <button class="btn bp" id="cwp-need-go">See what it needs \u2192</button>
      </div>` : ''}

      <dl class="cwp-facts">${facts}</dl>

      ${j.prompt?`<details class="cwp-more">
        <summary>The exact instruction AMV follows</summary>
        <pre class="cwp-prompt">${escH(j.prompt)}</pre>
        <div class="cwp-note">This is the real instruction, not a summary of it. You can change it after you turn the job on.</div>
      </details>`:''}
    </div>

    <div class="cwp-act">
      ${allowed
        ? `<button class="btn bs" id="cwp-cancel">Close</button>
           ${miss.length && !j.on
              /* A filled "Turn it on" over an unmet requirement promises
                 something that cannot happen. The action that CAN happen is
                 the one that gets the weight; turning it on anyway is still
                 offered, because saving it now and connecting later is a
                 reasonable thing to want. */
              ? `<button class="btn bs" id="cwp-go">Turn on anyway</button>
                 <button class="btn bp" id="cwp-need-go2">Connect what it needs \u2192</button>`
              : `<button class="btn bp" id="cwp-go">${j.on?'Turn it off':'Turn it on'}</button>`}`
        : `<div class="cwp-buy">
             <div class="cwp-buy-t">Included with ${escH(P.name)} \u00b7 $${P.price}/month</div>
             <div class="cwp-buy-s">${escH(P.name)} runs ${CREW_JOBS_BY_PLAN.pro} jobs like this in the background at once.</div>
             <div class="cwp-buy-b">
               <button class="btn bs" id="cwp-cancel">Close</button>
               <button class="btn bp" id="cwp-plans">See plans \u2192</button>
             </div>
           </div>`}
    </div>
  </div></div>`;
  r.classList.add('on');

  /* Guarded by target===currentTarget rather than stopPropagation on the panel:
     a panel that stops propagation kills the delegated click handler for every
     button inside it. */
  onBackdrop($('cwp-bg'),closeOvr);
  on($('cwp-close'),'click',closeOvr);
  on($('cwp-cancel'),'click',closeOvr);
  on($('cwp-plans'),'click',()=>{ closeOvr(); setTab('spend'); });
  const toNeeds = () => { try{ cwNeeds(j.id); }catch(e){} };
  on($('cwp-need-go'),'click',toNeeds);
  on($('cwp-need-go2'),'click',toNeeds);
  on($('cwp-go'),'click',()=>{ closeOvr(); try{ cwToggle(j.id); }catch(e){} });
}
try{ window.cwPeek = cwPeek; }catch(e){}

/* A job the SERVER is running, shown with the controls that reach the server.

   Every button here posts to the same /auto/update the chat tools use, so the
   screen and the conversation are two doors onto one job rather than two
   records that drift apart. */
function _mcServerSchedRow(x){
  /* The time it runs on their clock when it has one - "every day at 8:00 AM",
     "every weekday at 7:30 PM" - rather than only how often. */
  const every = (x.sched && typeof _schedHumanOf === 'function')
    ? _schedHumanOf(x.sched).replace(/^Every/, 'every') : (_CREW_EVERY_UI[String(x.repeat||'')] || 'on a schedule');
  const paused = x.active === false && !x.done;
  const auto = x.approval === 'auto';
  /* A one-time job reads as one: when it runs, then that it ran - never as
     "Paused", which is what an inactive job looked like before. */
  /* A step of a task says which step it is, and a step that never ran says
     so - "Ran once · finished" about a step that was cancelled would be the
     row lying about the one thing somebody opened it to check. */
  const stepOf = x.step ? T('Step {0} of {1}').replace('{0}', x.step.n).replace('{1}', x.step.of) + ' · ' : '';
  const when = stepOf + (x.done && /^did not run/.test(String(x.lastError||'')) ? T('Did not run') + ' - ' + String(x.lastError).replace(/^did not run - /, '')
    : x.waiting ? (Array.isArray(x.after) && x.after.length > 1
        ? T('Waits for {0} steps to finish').replace('{0}', x.after.length) + ' \u00b7 ' + T('{0} done').replace('{0}', Object.keys(x.got || {}).length)
        : T('Waits for the step before it to finish'))
    : (x.when && x.active !== false) ? (/^not watching/.test(String(x.lastError || '')) ? T('Not watching') + ' - ' + String(x.lastError).replace(/^not watching - /, '')
        : T('Watching for {0}').replace('{0}', _whenSay(x.when)) + (x.lastCheckAt ? ' \u00b7 ' + T('last checked {0}').replace('{0}', _agoLabel(x.lastCheckAt)) : ''))
    : x.done ? ('Ran once' + (x.doneAt ? ', ' + _dayLabel(x.doneAt) : '') + ' · finished')
    : x.repeat === 'once' ? ('Runs once' + (x.next ? ', ' + _onceWhen(x.next) + ' (' + _mcWhen(x.next) + ')' : ''))
    : paused ? 'Paused' : ('Runs ' + every + (x.next ? ' · next ' + _mcWhen(x.next) : '')));
  return `<div class="mc-sched-row${paused?' paused':''}">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(String(x.detail||'Background job').slice(0,180))}</div>
      <div class="mc-sched-meta">${escH(when)} · Runs on AMV's servers, whether or not this is open</div>
      <div class="mc-sched-mode-row">${(()=>{
        /* What this job will ACTUALLY do tonight - its own level capped by the
           account ceiling. Showing the job's own setting here would have it
           reading "Autonomous" under a ceiling that stops it, which is the one
           sentence on this screen that must never be wrong. */
        const own = String(x.approval||'require');
        const cap = (typeof window._autoCeilingLevel==='function' ? window._autoCeilingLevel() : 'auto') || 'auto';
        const rank = l => ['suggest','require','auto'].indexOf(l);
        const eff = rank(own) <= rank(cap) ? own : cap;
        const say = { suggest:'Suggest only - it will not run until you ask',
                      require:'Ask first - each result waits for your approval',
                      auto:'Autonomous - results are delivered for you' }[eff];
        /* Two different sentences that both begin "held". The gold one is the
           account ceiling holding a job BELOW the level it was set to, which
           is permanent until somebody raises the ceiling. The quiet one is
           tonight's window pushing this run back a few hours. A row can
           honestly show both at once. */
        const quiet = (x.heldUntil && x.heldUntil > Date.now())
          ? `<span class="mc-sched-quiet">Held until your quiet hours end</span>` : '';
        /* A THIRD SENTENCE, AND THE REASON IT HAS TO BE HERE.

           This job is running and is deliberately not emailing, because the
           person accepted "email me only when it changes". Without a line
           saying so, a job that has quietly stopped working looks exactly like
           a job that is working and has nothing new to say - and the whole
           bargain was that they lose nothing by not looking. */
        const same = x.quietSince
          ? `<span class="mc-sched-same">Same answer since ${escH(_dayLabel(x.quietSince))} · in AMV, not your inbox</span>` : '';
        return `<span class="mc-sched-mode ${eff==='auto'?'auto':''}">${escH(say)}</span>`
             + (eff!==own?`<span class="mc-sched-held">held back from “${escH(own)}” by your account setting</span>`:'')
             + quiet + same;
      })()}</div>
    </div>
    <div class="mc-sched-acts">
      ${x.done ? '' : `<button class="btn mc-mini ghost" data-dact="mcServerJob" data-darg="${escH(x.id)}|${paused?'resume':'pause'}">${paused?'Resume':'Pause'}</button>`}
      <button class="btn mc-mini ghost" data-dact="mcServerJob" data-darg="${escH(x.id)}|delete">Remove</button>
    </div>
  </div>`;
}
/* A past date in the person's own locale, for the lines that name a day rather
   than a countdown. `_mcWhen` answers "how long until", which reads as nonsense
   for something that already happened.

   ONE definition, used from the Integrations job rows too. The first draft had
   a byte-identical `_asrvDay` over there and the gate refused it, correctly:
   the two rows say the same sentence about the same field, and two copies of
   the formatting is how one of them ends up saying it differently. */
function _dayLabel(ts){
  const d = Number(ts) || 0;
  if(!d) return '';
  try { return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric' }); }
  catch(e){ return new Date(d).toISOString().slice(0, 10); }
}
/* Frequencies in the words a person uses, shared with the chat tools. */
const _CREW_EVERY_UI = { '10min':'every 10 minutes', '30min':'every 30 minutes',
                         hourly:'every hour', daily:'every day', weekly:'every week', once:'once' };
function _onceWhen(ts){
  try{ return new Date(Number(ts)).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
  catch(e){ return ''; }
}
function _mcWhen(ts){
  const d = Number(ts)||0; if(!d) return '';
  const mins = Math.round((d - Date.now())/60000);
  if(mins <= 0) return 'due now';
  if(mins < 60) return 'in ' + mins + ' min';
  if(mins < 60*24) return 'in ' + Math.round(mins/60) + 'h';
  return 'in ' + Math.round(mins/1440) + 'd';
}
/* Pause, resume or remove a real server job from the screen. Removing asks
   first, because it takes the job and its history and cannot be undone. */
async function mcServerJob(arg){
  const [id, action] = String(arg||'').split('|');
  if(!id || !action) return;
  if(action === 'delete'){
    const yes = await showConfirmAsync('Remove this background job? It stops running and its history goes with it. Pausing keeps both.');
    if(!yes) return;
  }
  try{
    await _autoApi('/auto/update', { id, action });
    if(typeof _autoRefresh === 'function') await _autoRefresh();
    renderCrewView();
    toast(action === 'delete' ? 'Removed. It will not run again.'
        : action === 'pause' ? 'Paused. It stays here and will not run until you resume it.'
        : 'Resumed. Its next run is one interval from now.', 'success', 4000);
  }catch(e){
    /* Never redraw as though it worked - the job is still running, and saying
       otherwise is how somebody stops watching something that is still
       spending. */
    toast((e && e.message === 'not-connected')
      ? 'AMV is not connected to its engine, so that job could not be changed. It is still running.'
      : 'That did not work: ' + ((e && e.message) || 'the server refused it') + '. The job is unchanged.',
      'error', 6500);
  }
}
async function mcReloadJobs(){
  try{ if(typeof _autoRefresh === 'function') await _autoRefresh(); }catch(e){}
  renderCrewView();
}
try{ window.mcServerJob = mcServerJob; window.mcReloadJobs = mcReloadJobs; }catch(e){}

/* A standing job shown as a row in the unified Scheduled section. */
function _mcAutonSchedRow(j){
  return `<div class="mc-sched-row">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(j.title)}</div>
      <div class="mc-sched-meta">${escH(j.desc||T('Runs in the background'))} · ${escH(_cwUsesLine(j, j.needs||''))}</div>
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
/* Register a scheduled job on the SERVER, which is the only thing that makes it
   run while AMV is closed. The local schedule is walked by _runDueAuto in this
   browser, so a job that never reached the server runs only when the app
   happens to be open - which is not what "Running jobs" or "Autonomous" mean.
   It used to be fired and forgotten, and the success message went out either
   way. Returns what actually happened so the caller can say it. */
/* The interval the SERVER understands. Its scheduler works in repeat buckets,
   not in the client's cadence objects, and anything outside the set is refused
   with "invalid repeat interval". A monthly cadence has no server bucket, so it
   is registered weekly rather than not at all - the job still runs unattended,
   and the local schedule keeps the exact day. */
/* The person's own time zone, as their device reports it. */
function _myTimeZone(){
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){ return ''; }
}
try{ window._myTimeZone=_myTimeZone; }catch(e){}
function _mcRepeatFor(payload){
  const cad = (payload.sched && payload.sched.cad) || payload.freq || 'daily';
  const map = { '10min':'10min', '30min':'30min', hourly:'hourly', daily:'daily',
                weekly:'weekly', monthly:'weekly', once:'once' };
  return map[String(cad).toLowerCase()] || 'daily';
}
async function _mcScheduleServer(payload){
  if(!(window.AMV_API && AMV_API.live && typeof AMV_API._fetch==='function'))
    return { ok:false, code:'needs_service' };
  try{
    /* /auto/create, which is the scheduler the cron actually runs. This used to
       post to /api/schedule/create - a route the worker has never had - so every
       job created from Crew was registered nowhere and ran only while AMV was
       open. Nothing said so, because the call was fired and forgotten.

       There is no reason to build a second scheduler beside this one: it already
       has the plan gating, the monthly budget, the job limit and the pause flag,
       and the cron already walks it. */
    const r = await AMV_API._fetch('/auto/create',{ method:'POST', body:JSON.stringify({
      detail: payload.goal, repeat: _mcRepeatFor(payload),
      /* The time they asked for, on their own clock - so the SERVER runs it
         at 8, overnight, with this tab and this computer closed. Before this
         only the repeat went, and the server ran it every 24 hours from
         whenever it was created. */
      sched: payload.sched ? { cad: payload.sched.cad, hour: payload.sched.hour, minute: payload.sched.minute || 0,
                               days: payload.sched.days, dom: payload.sched.dom } : undefined,
      tz: _myTimeZone(),
      /* The instant a one-time job runs, computed here from the day and hour
         on this device's own clock. */
      firstRunAt: payload.firstRunAt || undefined,
      kind: payload.kind || 'task', approval: payload.approval === 'auto' ? 'auto' : 'require',
      /* Which catalogue entry this came from, so a most-used list can be built
         from what people actually run rather than from a guess. Counts only,
         nothing that identifies anybody - see crewPopular in the worker.
         Absent when somebody typed the job themselves, which is fine: the
         ranking is of catalogue entries. */
      srcId: payload.srcId || '',
      /* The country the page is showing, so the unattended run answers for
         the place somebody chose - the cron has no network to ask later. */
      country: (typeof _cwCountryGuess === 'function' ? _cwCountryGuess() : '') || '',
      notify: payload.notify || 'app' }) });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || d.error) return { ok:false, code:d.code||'failed', error:d.error||'' };
    return { ok:true, id:(d.item&&d.item.id)||'' };
  }catch(e){ return { ok:false, code:'failed', error:(e&&e.message)||'' }; }
}
/* One sentence for where a just-created job will actually run. */
function _mcWhereItRuns(res){
  if(res.ok) return '';
  if(res.code === 'needs_service')
    return ' It runs only while AMV is open, because the AMV engine is not connected yet.';
  /* A plan limit is not a failure - it is the answer, and it has somewhere to go. */
  /* job_limit belongs here too: it is what a PAYING account gets at its
     automation cap, and it was falling through to "could NOT be registered". */
  if(res.code === 'plan_required' || res.code === 'plan_limit' || res.code === 'job_limit')
    return ' ' + (res.error || 'Running work in the background is part of a paid plan.') +
           ' For now it runs only while AMV is open.';
  return ' It could NOT be registered to run in the background' + (res.error ? ' (' + res.error + ')' : '')
    + ', so for now it runs only while AMV is open.';
}
try{ window._mcScheduleServer=_mcScheduleServer; window._mcWhereItRuns=_mcWhereItRuns; }catch(e){}

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
  on($('mc-ask-schedule'),'click',async()=>{
    const mode=(document.querySelector('input[name="mcmode"]:checked')||{}).value||'require';
    const btn=$('mc-ask-schedule');
    /* REVIEW IT BEFORE SAYING IT IS RUNNING.

       Asked for: "make sure before it says added automatically it reviews it
       and requests for any access it needs and then when it has everything it
       needs say like running or the green flag to show it's actually running."

       A standing job is the most expensive thing here to get wrong. It runs
       every morning, it spends budget every morning, and if it was never able
       to do the thing it reports a failure every morning - or worse, quietly
       does nothing while the card says it is running. One planning call at the
       moment somebody commits to it is cheap against that, and it answers both
       questions at once: whether this can be done at all, and what it needs
       before it can. */
    if(btn){ btn.disabled=true; btn.textContent='Checking what this needs…'; }
    const review = await _mcReview(instruction, mode);
    if(review.impossible){ _mcCannot(box, review, instruction); return; }
    if(review.needs.length){ _mcNeedsFirst(box, instruction, when, mode, review); return; }
    _mcSchedule(box, instruction, when, mode, review);
  });
}
/* WHAT DOES THIS REQUEST ACTUALLY NEED, AND CAN IT BE DONE AT ALL.

   One pass, because they are the same question asked of the same plan: the
   planner binds each step to a real action, and resolve() says what is
   stopping each one. A step with no blocker can run; a blocker names the
   connection it is waiting for, in words somebody can act on.

   `checked:false` is the honest answer when there is no engine to plan with.
   It is NOT the same as "nothing needed", and conflating them is how a job
   gets a green flag it did not earn: every step of a degraded plan is
   unbound, so treating that as a requirement would block every job on a
   deployment with no key, and treating it as satisfied would promise one that
   cannot be kept. So it says it could not check. */
async function _mcReview(instruction, mode){
  const out = { impossible:false, why:'', instead:[], needs:[], checked:false, degraded:false };
  try{
    if(typeof AMVUniversal === 'undefined') return out;
    const p = await AMVUniversal.plan(instruction);
    if(p && p.impossible)
      return Object.assign(out, { impossible:true, why:p.why, instead:p.instead||[], checked:true });
    if(p && p.blocked)
      return Object.assign(out, { impossible:true, why:p.why, instead:[], checked:true });
    if(p && p.degraded){ out.degraded = true; return out; }
    const resolved = AMVUniversal.resolve(p.steps || [], { autonomous: mode === 'auto' });
    out.checked = true;
    const seen = Object.create(null);
    resolved.forEach(st => {
      const b = st.blocker; if(!b) return;
      const k = (b.code || '') + '|' + (b.need || '');
      if(seen[k]) return; seen[k] = 1;
      out.needs.push({ code:b.code||'', need:b.need||'', how:b.how||'', connector:st.connectorName||'' });
    });
  }catch(e){ try{ _logErr('crew.review', e); }catch(_e){} }
  return out;
}
try{ window._mcReview=_mcReview; }catch(e){}

/* THE ACCESS REQUEST, BEFORE THE JOB EXISTS.

   Nothing is created here. The job is not in the list, the server has not been
   told, and no card says running - because none of that is true yet. What is
   offered is the connection each blocked step is waiting for, and a way to add
   it anyway with the waiting stated rather than hidden. */
function _mcNeedsFirst(box, instruction, when, mode, review){
  if(!box) return;
  box.innerHTML = '<div class="mc-cmd-msg needs">' +
    '<div class="mc-needs-h">Before this can run, it needs ' + review.needs.length +
      ' thing' + (review.needs.length === 1 ? '' : 's') + '</div>' +
    '<div class="mc-needs-sub">Nothing has been added yet. Connect these and it starts for real.</div>' +
    '<ul class="mc-needs-list">' + review.needs.map(n =>
      '<li><b>' + escH(n.connector || n.need) + '</b><span>' + escH(n.how || n.need) + '</span></li>').join('') + '</ul>' +
    '<div class="mc-cmd-actions">' +
      '<button class="btn mc-mini bp" data-dact="_mcGoConnect">Connect ' +
        escH(review.needs[0].connector || 'what it needs') + '</button>' +
      '<button class="btn mc-mini ghost" id="mc-needs-anyway">Add it anyway - it waits</button>' +
      '<button class="btn mc-mini ghost" id="mc-needs-cancel">Cancel</button>' +
    '</div>' +
  '</div>';
  on($('mc-needs-cancel'),'click',()=>{ box.innerHTML=''; });
  on($('mc-needs-anyway'),'click',()=>_mcSchedule(box, instruction, when, mode, review));
}
try{ window._mcNeedsFirst=_mcNeedsFirst; }catch(e){}

/* Create the job, and say which of the two things just happened. */
async function _mcSchedule(box, instruction, when, mode, review){
  const item={id:'a'+Date.now(), goal:instruction, approval:mode, created:Date.now(), lastRun:null};
  if(when.sched){ item.sched=when.sched; item.next=_schedNext(when.sched,Date.now()); }
  else { item.freq=when.freq||'daily'; item.next=_freqNext(item.freq,Date.now()); }
  const list=_loadSched(); list.push(item); _saveSched(list);
  if(box) box.innerHTML='<div class="mc-cmd-msg run"><span class="rr-dot"></span> Registering it…</div>';
  const res = await _mcScheduleServer({ goal:instruction, sched:item.sched, freq:item.freq, approval:mode });
  /* The server's id for this job, kept so a later edit can target it. Without
     it an edit has nothing to name and can only report that it failed. */
  if(res.id){ const l2=_loadSched(); const me=l2.find(x=>x.id===item.id); if(me){ me.autoId=res.id; _saveSched(l2); } }
  const waiting = review && review.needs && review.needs.length;
  /* THE GREEN FLAG IS A CLAIM, so it is only made when all three things are
     true: the server took the job, the review found nothing missing, and the
     review actually ran. Any one of them false and the sentence says what is
     still outstanding instead. */
  const green = res.ok && review && review.checked && !waiting;
  const head = green
    ? 'Running - ' + when.label
    : waiting
      ? 'Added, waiting on ' + escH(review.needs.map(n => n.connector || n.need).slice(0, 2).join(' and '))
      : 'Added - ' + when.label;
  if(box) box.innerHTML = '<div class="mc-cmd-msg ' + (green ? 'done' : 'warn') + '">' +
    '<div class="mc-cmd-done-h">' + (green ? '● ' : '') + escH(head) + '</div>' +
    '<div>' + (mode === 'auto' ? 'Autonomous - it completes and sends each time.'
                               : 'Ask first - each run waits for your approval.') +
    (green ? '' : escH(_mcWhereItRuns(res))) +
    (!green && review && !review.checked && !waiting
      ? ' AMV could not check what this needs before adding it, so it may stop on its first run and tell you what is missing.' : '') +
    '</div></div>';
  toast(head, green ? 'success' : 'info', green ? 4200 : 7000);
  renderCrewView();
}
try{ window._mcSchedule=_mcSchedule; }catch(e){}
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
/* SAYING NO WITHOUT BEING USELESS ABOUT IT.

   Two things this must not be. It must not read as a refusal - AMV is not
   declining, there is nothing there to decline with - and it must not end the
   conversation, because somebody who asked for a lift to the airport still
   wants the taxi booked and the calendar entry. So the sentence names the part
   that cannot be done, and the list underneath is what AMV would actually do,
   each one runnable from where they are standing. */
function _mcCannot(box, v, instruction){
  if(!box) return;
  /* Each alternative is a card with what AMV does, what is left for the
     person, and a Do this that runs it - the same cards a failed run ends on
     (_uniInsteadHTML), so there is one way of saying "instead". */
  box.innerHTML = '<div class="mc-cmd-msg cannot">' +
    '<div class="mc-cannot-h">This part I genuinely cannot do</div>' +
    '<div class="mc-cannot-why">' + escH(v && v.why ? v.why : 'AMV has nothing that can do this.') + '</div>' +
    (typeof _uniInsteadHTML === 'function' ? _uniInsteadHTML(v && v.instead) : '') +
  '</div>';
}
try{ window._mcCannot=_mcCannot; }catch(e){}

/* THE CREW BOX TAKES A PARAGRAPH, NOT A LINE.

   It was a one-line <input>: a request pasted in with line breaks lost them,
   and anything longer than the box's width ran off its edge where it could not
   be read back before pressing Run. It is a textarea now that grows with what
   is in it - to a height, and then it scrolls - so what somebody typed is what
   they can see. Every place that puts text into it calls this too, because
   setting .value from code does not fire `input`. */
/* Where the browser can size a field to its content itself (field-sizing,
   layer A286), it does, and this reads nothing: measuring the box straight
   after Crew is drawn forced the whole page through layout twice before it
   could paint - 192ms of the 306ms that opening Crew blocked for at 4x CPU. */
const _MC_FIELD_SIZING = (()=>{ try{ return !!(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content')); }catch(e){ return false; } })();
function _mcCmdFit(el){
  if(!el || el.tagName !== 'TEXTAREA' || _MC_FIELD_SIZING) return;
  el.style.height = 'auto';
  const edge = el.offsetHeight - el.clientHeight;
  /* Empty, it is sized to its example: on a phone the example wraps to two
     lines, and a one-line box showed half of the second one. */
  if(!el.value && el.placeholder){
    el.value = el.placeholder;
    const h = el.scrollHeight;
    el.value = '';
    el.style.height = Math.min(h + edge, 240) + 'px';
    return;
  }
  el.style.height = Math.min(el.scrollHeight + edge, 240) + 'px';
}
/* A rotation rewraps the example. One listener for the page, finding the box
   each time, because the view is redrawn and a listener per draw would pile up. */
try{ window.addEventListener('resize', () => { try{ _mcCmdFit(document.getElementById('mc-cmd-input')); }catch(e){} }, { passive:true }); }catch(e){}
try{ window._mcCmdFit=_mcCmdFit; }catch(e){}

/* Is this sentence a request to connect an account, and to what? Only the
   plain shapes - "connect my X", "link X", "sign in to X", "add my X account" -
   and only a short name, so a job that merely mentions connecting ("connect to
   my inbox every morning and summarise it") still goes to the planner. */
function _mcConnectIntent(s){
  const t = String(s || '').trim().replace(/[.!?]+$/, '');
  const m = t.match(/^(?:please\s+|can you\s+|could you\s+|i want to\s+|help me\s+)?(?:connect|link|hook up|sign (?:me )?in(?:to|\s+to)?|log (?:me )?in(?:to|\s+to)?)\s+(?:to\s+|up\s+|with\s+)?(.+)$/i)
         || t.match(/^(?:please\s+)?add\s+(my\s+.+|.+\s+account)$/i);
  if(!m) return '';
  const name = m[1].trim();
  if(!name || name.length > 60 || name.split(/\s+/).length > 6) return '';
  if(/\b(every|each|daily|weekly|monthly|when|whenever|then|and (?:tell|send|summari[sz]e|check|email))\b/i.test(name)) return '';
  return name;
}
try{ window._mcConnectIntent=_mcConnectIntent; }catch(e){}

async function mcRunCommand(instruction, opts){
  opts=opts||{};
  const box=document.getElementById('mc-cmd-result'); if(!box) return;
  instruction=(instruction||'').trim(); if(!instruction){ const i=document.getElementById('mc-cmd-input'); i&&i.focus(); return; }
  /* SAY IT BEFORE PRETENDING TO START.

     Crew is browsable without an account now, which is the point of it - but
     browsing is not running. Everything past this line asks a model to read
     the request and then binds real steps to real connectors, and none of that
     can happen for somebody AMV has never met. Without this the box printed
     "Reading your request..." and then failed somewhere underneath, which is
     the worst of both: it looked like it was working and it never was.

     So the refusal is the first thing, it is specific about why, and it hands
     over the way forward instead of leaving somebody staring at a dead box. */
  if(!(typeof S!=='undefined' && S.user && S.user.email)){
    box.innerHTML='<div class="mc-cmd-msg">Running this takes an account - it happens on AMV’s servers, on a '
      +'schedule, and there has to be somewhere to send the result. Everything on this page is yours to read '
      +'without one. <button class="mc-sec-link" data-auth="signup">Create a free account</button></div>';
    return;
  }
  /* CAN THIS BE DONE AT ALL - ASKED BEFORE ANYTHING PRETENDS TO START.

     Before this, "log into random accounts every day" reached _parseWhen,
     was recognised as recurring, and was offered as something to add to
     Running jobs. It would have been added, and then reported every morning
     that it could not do the thing nobody could ever have done. The worst
     version of a bug: it looks like the product working.

     The floor is instant and needs no engine, so it goes first and costs
     nothing. The general version - can any combination of what exists finish
     this - lives in the planner, which is the only thing holding the whole
     catalog; it runs a moment later, inside uniRun, and before anything is
     scheduled. */
  /* "CONNECT MY ..." IN THIS BOX GETS THE SAME ANSWER IT GETS IN CHAT.

     Chat has a connect tool; this box never did. The Crew's own tool list
     named it, but that list belongs to a runner nothing calls, so "connect my
     Revolut" typed here went to the job planner - which planned a job - and
     the claim that the Crew could connect anything was true only of chat.
     One resolver, one card, one set of buttons: the same function chat's tool
     runs, drawn where the person asked. Before the feasibility floor, because
     "log in to my bank" is a request to connect, not a job to refuse. */
  const _cx = _mcConnectIntent(instruction);
  if(_cx && typeof connectAccountTool === 'function'){
    box.innerHTML='<div class="mc-cmd-msg run"><span class="rr-dot"></span> Looking for a way to connect '+escH(_cx)+'…</div>';
    try{
      const r = await connectAccountTool({ service:_cx });
      box.innerHTML = r.render || '<div class="mc-cmd-msg">'+escH(r.text || '')+'</div>';
    }catch(e){
      box.innerHTML='<div class="mc-cmd-msg warn">'+escH(String((e&&e.message)||'That could not be looked up just now.'))+'</div>';
    }
    return;
  }
  if(typeof _feasFloor === 'function'){
    const edge = _feasFloor(instruction);
    if(edge){ _mcCannot(box, edge, instruction); return; }
  }
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

/* Which plan runs autonomous work, matching what the server enforces. Reading
   the same rule in both places is the point - a gate that only exists in the
   browser is not a gate, and one that only exists on the server is a dead end
   the user hits with no explanation. */
const CREW_REQUIRED_PLAN='pro';
const CREW_JOBS_BY_PLAN={free:0,pro:5,elite:25,ultra:100};
/* ── QUIET HOURS, THE CONTROL ──────────────────────────────────────────────
   The server has enforced these since the tick learned about them, and the
   bound was unreachable: nothing in the product could set one. That is the
   `scope` defect read from the other end - a rule the code obeys and nobody
   can write - and it is why this row exists rather than a settings page nobody
   opens.

   Two hours and the zone this browser is in. The zone is not a preference and
   is not asked for: it is read from the machine, because somebody choosing
   "11pm" means eleven at night where they are, and asking them to also name a
   timezone is asking them to do arithmetic to express something they already
   said. It travels with the window so the server can read the hour on THEIR
   clock, which is what stops the window drifting an hour when the clocks
   change. */
const _MC_QUIET_HOURS = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
function _mcQuietTz(){
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }catch(e){ return 'UTC'; }
}
function _mcQuiet(){
  try{ const q = load('amv_auto_quiet'); return (q && Number.isInteger(q.from)) ? q : null; }catch(e){ return null; }
}
function _mcQuietLabel(h){ return String(h).padStart(2,'0') + ':00'; }

/* ── QUIET HOURS, THE SECOND ENFORCER ──────────────────────────────────────
   The cron holds server-side jobs. It cannot hold the ones that only exist in
   this browser: work scheduled before a backend was connected, or by an
   account whose plan cannot schedule server-side, runs from `_runDueAuto` in
   16-palette-sched while the tab is open. That tick is the OTHER place an
   unattended run begins, and it did not know the window existed - so somebody
   who ticked "don't run jobs overnight" and left a laptop open still got the
   3am run. A bound that holds on one of the two paths is not a bound.

   Deliberately NOT routed through the policy engine's `in_quiet_hours`, even
   though that branch exists. Quiet hours decide WHEN the tick looks at a job,
   before any rule is read - a scheduling fact, not a permission one. Making it
   both would give one promise two enforcement points that drift, which is the
   thing this file already learned the hard way about approval cards.

   The answers must match the server's exactly, so the shape below is the same
   shape as `_quietNow` / `_quietEndsAt` in the worker, and a suite drives both
   over the same table rather than trusting that they look alike. */
function _mcQuietHourAt(tz, atMs){
  try{
    const h = new Intl.DateTimeFormat('en-GB', {
      timeZone: String(tz || 'UTC').slice(0, 64),
      hour: 'numeric', hour12: false,
    }).format(new Date(atMs));
    const n = parseInt(h, 10);
    return Number.isInteger(n) ? (n % 24) : null;
  }catch(e){ return null; }
}
/* Fails OPEN, like the server: an unreadable window does not silence. A job
   that stops running and says nothing is harder to notice than one run at an
   awkward hour, so the fallback goes towards the mistake somebody can see. */
function _mcQuietNow(atMs, q){
  const w = (q === undefined) ? _mcQuiet() : q;
  if(!w) return false;
  const from = Number(w.from), to = Number(w.to);
  if(!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if(from < 0 || from > 23 || to < 0 || to > 23) return false;
  if(from === to) return false;
  const h = _mcQuietHourAt(w.tz, atMs);
  if(h === null) return false;
  return from < to ? (h >= from && h < to) : (h >= from || h < to);
}
/* Walked hour by hour rather than computed, so a clock change inside the
   window is answered by the calendar instead of by offset arithmetic. */
function _mcQuietEndsAt(atMs, q){
  const w = (q === undefined) ? _mcQuiet() : q;
  for(let i = 1; i <= 24; i++){
    const t = atMs + i * 3600000;
    if(!_mcQuietNow(t, w)) return t;
  }
  return atMs + 3600000;
}
function _mcQuietRowHTML(){
  const q = _mcQuiet();
  const opts = (sel) => _MC_QUIET_HOURS.map(h =>
    `<option value="${h}"${h===sel?' selected':''}>${_mcQuietLabel(h)}</option>`).join('');
  return `<div class="mc-quiet">
    <label class="mc-quiet-on">
      <input type="checkbox" id="mc-quiet-on" ${q?'checked':''} data-dact="mcQuietToggle">
      <span>Don’t run jobs overnight</span>
    </label>
    <div class="mc-quiet-when" ${q?'':'hidden'}>
      <span class="mc-quiet-k">From</span>
      <select id="mc-quiet-from" aria-label="Quiet hours start" data-dact="mcQuietChange">${opts(q?q.from:23)}</select>
      <span class="mc-quiet-k">to</span>
      <select id="mc-quiet-to" aria-label="Quiet hours end" data-dact="mcQuietChange">${opts(q?q.to:7)}</select>
      <span class="mc-quiet-note">your time · jobs due in this window run when it ends</span>
    </div>
  </div>`;
}
/* Saved to the server, because the browser is asleep at the hour this is for.
   Stored locally too so the row draws right away on the next load rather than
   waiting for a round trip to know what it already knows. */
async function _mcQuietSave(q){
  try{ store('amv_auto_quiet', q); }catch(e){}
  /* Through `_autoApi`, the one door onto this route - which is also the only
     spelling of it that exists. The first version of this posted to
     `/v1/auto/update` through `AMV_API._fetch`; the router answers
     `/auto/update`, so every save would have failed against a real backend
     while the row went on showing the window it had stored locally. Exactly
     the defect this control was written to fix, one layer up. */
  if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)){
    toast('Saved on this device. It only holds jobs overnight once AMV is connected to a backend - that is where they run.','info',6000);
    return;
  }
  try{
    await _autoApi('/auto/update', { action:'quiet', quiet: q });
    toast(q ? ('Jobs will wait between ' + _mcQuietLabel(q.from) + ' and ' + _mcQuietLabel(q.to) + '.')
            : 'Jobs can run at any hour again.', 'success', 4000);
  }catch(e){
    /* The one thing that must not happen quietly: the row showing a window the
       server never received. */
    toast('That did NOT save - your jobs can still run overnight. ' + ((e&&e.message)||''), 'error', 7000);
  }
}
function mcQuietToggle(){
  const on = !!(document.getElementById('mc-quiet-on')||{}).checked;
  _mcQuietSave(on ? { from:23, to:7, tz:_mcQuietTz() } : null).then(()=>renderCrewView());
}
function mcQuietChange(){
  const f = +(document.getElementById('mc-quiet-from')||{}).value;
  const t = +(document.getElementById('mc-quiet-to')||{}).value;
  if(!Number.isInteger(f) || !Number.isInteger(t)) return;
  if(f === t){
    toast('A window that starts and ends at the same hour is not a window - untick it to turn quiet hours off.','info',5000);
    return;
  }
  _mcQuietSave({ from:f, to:t, tz:_mcQuietTz() });
}
try{ window.mcQuietToggle = mcQuietToggle; window.mcQuietChange = mcQuietChange; }catch(e){}

/* ── THE OFFER ─────────────────────────────────────────────────────────────
   The only thing on this screen AMV proposes rather than waits to be told, so
   it has to earn its place every time it appears.

   Both answers are buttons of equal weight. A "yes" styled as the obvious
   choice and a "no" styled as a link is not an offer, it is a funnel - and
   this one can propose LESS autonomy as easily as more, which is the reason it
   is defensible at all.

   It disappears the moment it is answered, either way, and the server never
   raises it again for that job. */
function _mcOfferHTML(){
  const o = (typeof window._autoOffer === 'function') ? window._autoOffer() : null;
  if(!o || !o.say) return '';
  return `<section class="mc-offer mc-offer-${escH(String(o.kind || 'auto'))}">
    <div class="mc-offer-b">
      <div class="mc-offer-t">${escH({
        pause:   'This job keeps producing something you do not use',
        quiet:   'This job keeps saying the same thing',
        inapp:   'You keep telling AMV this was not worth an email',
        stop:    'You keep telling AMV this was not worth making',
        unquiet: 'AMV held this back and you wanted it',
        auto:    'You have said yes to this every time',
      }[String(o.kind || 'auto')] || 'You have said yes to this every time')}</div>
      <div class="mc-offer-s">${escH(String(o.say))}</div>
    </div>
    <div class="mc-offer-acts">
      <button class="btn mc-offer-go" data-dact="mcOfferAnswer" data-darg="yes">${escH(String(o.accept || 'Yes'))}</button>
      <button class="btn ghost mc-offer-go" data-dact="mcOfferAnswer" data-darg="no">${escH(String(o.decline || 'No'))}</button>
    </div>
  </section>`;
}
async function mcOfferAnswer(arg){
  const o = (typeof window._autoOffer === 'function') ? window._autoOffer() : null;
  if(!o) return;
  const accept = String(arg) === 'yes';
  /* Cleared before the request, so a second press cannot answer twice - and
     restored if the request fails, because an offer that vanished without
     being recorded is one the person will never be asked about again. */
  try{ window._autoOfferClear(); }catch(e){}
  renderCrewView();
  try{
    const d = await _autoApi('/auto/update', { action:'offer', job:o.job, accept });
    if(!accept) toast('AMV will not ask about that one again.','info',4000);
    else if(d.applied === 'auto') toast('Done - this job delivers without asking now. You can change it back on its row.','success',6000);
    else if(d.applied === 'pause') toast('Paused. It stops running and stops costing anything; resume it on its row whenever you want.','success',6000);
    else toast('Nothing changed - that offer was no longer valid for this job.','info',5000);
    try{ await _autoRefresh(); }catch(e){}
    renderCrewView();
  }catch(e){
    toast('That did NOT go through' + ((e&&e.message)?' ('+e.message+')':'') + ', so nothing has changed. It will be offered again.','error',7000);
    try{ await _autoRefresh(); }catch(_){}
    renderCrewView();
  }
}
try{ window.mcOfferAnswer = mcOfferAnswer; }catch(e){}

/* ── THE NEVER LIST, THE CONTROL ───────────────────────────────────────────
   Beside quiet hours because they answer the same question from two sides:
   WHEN may AMV act without me, and WHO may it never approach. Both are things
   somebody says once and expects to hold for ever.

   A plain list, one per line, rather than a builder with add and remove
   buttons. Somebody writing this is thinking of three or four names and wants
   to type them; a row-at-a-time widget turns four seconds of typing into
   twelve taps, and on a phone that is the difference between writing it down
   and meaning to.

   What it does is stated exactly on the control, because overstating it would
   be the whole defect: AMV cannot send to anybody but the account holder, so
   this governs what it OFFERS - the cancellation letters it writes with an
   address already filled in. */
const MC_NEVER_MAX = 40;
function _mcNever(){
  try{ const v = load('amv_auto_never'); return Array.isArray(v) ? v : []; }catch(e){ return []; }
}
function _mcNeverRowHTML(){
  const list = _mcNever();
  return `<div class="mc-never">
    <label class="mc-never-h" for="mc-never-box">Never write to</label>
    <textarea id="mc-never-box" class="mc-never-box" rows="3" spellcheck="false"
      aria-describedby="mc-never-note"
      placeholder="mybank.com&#10;boss@work.com">${escH(list.join('\n'))}</textarea>
    <div class="mc-never-foot">
      <span id="mc-never-note" class="mc-never-note">One per line. An address, or a domain for everyone there. AMV never emails anyone but you - this stops it <b>offering</b> to write to them, which is the one place an address it read out of your mail would end up in front of you.</span>
      <button class="btn mc-mini" data-dact="mcNeverSave">Save</button>
    </div>
  </div>`;
}
async function mcNeverSave(){
  const box = document.getElementById('mc-never-box');
  if(!box) return;
  const list = String(box.value || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean).slice(0, MC_NEVER_MAX);
  if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)){
    toast('Saved on this device. It only holds once AMV is connected to a backend - that is where the jobs run.','info',6000);
    try{ store('amv_auto_never', list); }catch(e){}
    return;
  }
  try{
    const d = await _autoApi('/auto/update', { action:'never', never: list });
    try{ store('amv_auto_never', d.never || []); }catch(e){}
    toast(list.length
      ? 'Saved. AMV will not offer to write to ' + (list.length === 1 ? list[0] : list.length + ' of them') + '.'
      : 'Cleared. AMV can offer to write to anyone again.', 'success', 4000);
    renderCrewView();
  }catch(e){
    /* The server refuses the WHOLE list when one entry is unreadable, and says
       which - so the person fixes that line rather than hunting for it. Saying
       "saved" here would leave them believing a rule holds that was refused. */
    toast('NOT saved' + ((e && e.message) ? ' - ' + e.message : '.')
        + ' Nothing has changed, so anything you had before is still in force.', 'error', 9000);
  }
}
try{ window.mcNeverSave = mcNeverSave; }catch(e){}

function _planAllowsCrew(){
  const plan=loadStr('amv_plan')||'free';
  const need=PLAN_RANK[CREW_REQUIRED_PLAN]||1;
  if(plan==='team') return true;
  if(plan==='custom') return (typeof _customRank==='function'?_customRank():0)>=need;
  return (PLAN_RANK[plan]||0)>=need;
}
function _crewJobAllowance(){
  const plan=loadStr('amv_plan')||'free';
  if(plan==='team'||plan==='custom') return null;   // depends on seats or price
  return CREW_JOBS_BY_PLAN[plan]||0;
}
try{ window._planAllowsCrew=_planAllowsCrew; }catch(e){}

function renderCrewView(){
  const vc=$('vc'); if(!vc) return;
  /* THE CATALOGUE FIRST. Fetched the first time Crew opens (see
     _loadCrewData); until then the screen shows its frame and says it is
     loading, and draws itself once the catalogue arrives - or says plainly
     that it could not, with a way to try again. */
  if(!_cwCatalog()){
    vc.innerHTML='<div class="sv fi crew-view"><div class="vi"><div class="cw-loading" role="status" aria-live="polite">'+escH(T('Loading your Crew\u2026'))+'</div></div></div>';
    _loadCrewData().then(ok=>{
      if(S.tab!=='crew' && S.tab!=='extensions') return;
      if(ok){ renderCrewView(); return; }
      const box=vc.querySelector('.cw-loading'); if(!box) return;
      box.innerHTML=escH(T('Crew could not load. Check your connection and try again.'))+' <button class="btn bs" type="button" id="cw-load-retry">'+escH(T('Try again'))+'</button>';
      on($('cw-load-retry'),'click',()=>renderCrewView());
    });
    return;
  }
  /* The two country pages (see cwMoreCountries). Same for every plan: what is
     done where you live is the question before paying as much as after, and
     the cards themselves say what a plan unlocks. */
  if(_cwPageNow()==='countries'){ vc.innerHTML=_cwCountriesPageHTML(); _cwWireCountries(vc); return; }
  if(_cwPageNow()==='country'){ vc.innerHTML=_cwCountryPageHTML(); _cwWireCmd(vc); try{ _cwLocFill(); }catch(e){} return; }
  /* Say the one thing that is true and nothing else. No risk warnings, no
     half-working tool - what this does, which plan runs it, and the button. */
  /* WHAT SOMEBODY WHO HAS NOT PAID SEES.

     This used to be the whole screen for them: three paragraphs and a price.
     That is a description of a product shown to the one person whose entire
     decision is whether the product is worth money - and the catalogue sitting
     behind it, ninety real jobs with the exact instructions they run, is far
     more persuasive than any sentence anybody could write about it.

     So they get the catalogue. Every job, browsable, openable, with the
     specimen output and the real instruction. The toggles do not work for them
     and say so instead of failing silently, and every card leads to the price.
     Nothing here is a teaser version of a job that does not exist. */
  if(!_planAllowsCrew()){
    const P=(typeof PLANS!=='undefined'&&PLANS[CREW_REQUIRED_PLAN])||{name:'Pro',price:15};
    const jobs=_cwJobs();
    const bgJobs=jobs.filter(j=>_cwRunsUnattended(j)).length;
    vc.innerHTML=`<div class="sv fi crew-view"><div class="vi">
      <div class="cw-where-bar">${_cwWhereBtnHTML()}</div>
      <span class="eyebrow">Crew \u00b7 Autonomous work</span>
      <h2>AMV working while you are not</h2>
      ${/* TWO SENTENCES, NOT TWO PARAGRAPHS.

            Everything the long version said was true and none of it was the
            first thing anybody needs. Crew answers one question - what runs
            while you are not here - and a screen that takes four sentences to
            get there has already lost the person it was written for. The
            detail about grants and passwords has not gone; it is on
            Connectors, where somebody is actually deciding whether to hand
            one over. */ ''}
      <p class="vsub">It runs on AMV\u2019s servers on a schedule you set, so the work happens with this window
        closed and your laptop shut. You get the finished thing, not a reminder to go and do it.</p>
      <p class="vsub cw-open-note">Say what you want below. The examples are there if you want ideas.</p>

      ${/* THE BOX IS THE PRODUCT, AND IT WAS ONLY ON THE PAID SCREEN.

            "have the text box remember where you can type something it
            recognizes it and does it i still want that" - said twice, because
            it was there and could not be seen: the command box lived on the
            unlocked Crew view only. Anybody on Free, which is everybody
            before they pay, got a catalogue and no way to say a sentence.

            It is the first thing on the screen now, and it is the SAME box -
            same input id, same run path, so what somebody types here is
            treated exactly as it would be on the paid screen. */ ''}
      <div class="mc-cmd mc-cmd-lg cw-cmd-lead">
        <div class="mc-cmd-label">Tell AMV what to do
          <span>- say it in your own words and it works out the rest</span></div>
        <div class="mc-cmd-inner">
          <svg class="mc-cmd-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>
          <textarea id="mc-cmd-input" class="mc-cmd-input" rows="1" autocomplete="off"
                 aria-label="Tell AMV what to do" enterkeyhint="go"
                 placeholder="e.g. summarize my last meetings"></textarea>
          <button class="mc-cmd-go" id="mc-cmd-go">Run</button>
        </div>
        <div class="mc-cmd-chips">${[
          'Summarize my last meetings',
          'What did I agree to this week?',
          'Find the cheapest supermarket near me',
          'What paperwork do I need to renew?'
        ].map(c=>`<button class="mc-cmd-chip" data-mccmd="${escH(c)}">${escH(c)}</button>`).join('')}</div>
        <div id="mc-cmd-result" class="mc-cmd-result"></div>
      </div>
      ${/* THE STATS BAND IS GONE.

            It said "104 examples, not a limit / 49 run with AMV closed /
            5 jobs at once on Pro / Included with Pro - $15/month", and the
            owner asked for it to come out. It was three numbers and a price
            standing between somebody and the thing that would actually
            convince them, which is the catalogue underneath. The plan and
            the price are on the Plans screen, where somebody who wants them
            goes looking. */ ''}
    </div>
    <div class="crew-jobs-sec cw-locked">
      ${/* THE ORDER IS THE ARGUMENT.

            Crew is autonomous work, so the screen goes: what it is, the box
            where you say what you want, where you live, and then a hundred
            examples if you want ideas. The one-off errands - the ones that
            open a chat rather than run on a schedule - are real and useful
            and are NOT what Crew is, so they sit at the bottom where somebody
            who wants one will still find them, instead of being the first
            thing between you and the point.

            Same reason "most used" moved down: it ranks what other people
            run, which is interesting once you know what this is and noise
            before. */ ''}
      ${_cwNotHereHTML('above')}
      ${_cwForYouHTML()}
      ${_cwMadeForHTML()}
      <div class="cw-filters">
        ${_cwFindBoxHTML(_cwAllJobs().filter(j=>_cwMatches(j,_cwFind)).length)}
      </div>
      ${_cwCatChips(_cwShowcase())}
      <div id="cw-jobs-body">${_cwJobsBody(_cwShowcase(), _cwLockedCard)}</div>
      ${_cwMostStartedHTML()}
      ${_cwErrandsHTML()}
      <section class="cw-morec" id="cw-morec">
        <button class="cw-morec-btn" data-dact="cwMoreCountries">${escH(T('See more countries'))}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      </section>
      ${/* ONE LINE, NOT A BAND.

            The stats band came out because it was three numbers and a price
            standing in front of the catalogue. Taking it out left no route to
            the plan at all from this screen, which is the opposite mistake:
            somebody who reads a hundred jobs and decides they want it should
            not have to guess where to go. Every card already opens onto the
            price; this is for the person who has finished browsing and is
            looking for the way forward, and it is a sentence rather than a
            sales panel. */ ''}
      <div class="cw-plan-foot">
        <span>Crew runs on ${escH(P.name)} and above - AMV keeps working when you close it.</span>
        <button class="mc-sec-link" data-stab="plans">See plans \u2192</button>
      </div>
    </div></div>`;
    _cwWireCmd(vc);
    return;
  }
  const jobs=_cwJobs(); const appr=_cwApprovals();
  const jobCard=_cwJobCard;
  /* WHAT THE CARD COULD NOT SAY BEFORE YOU PRESSED THE BUTTON.

     It showed a title, a line about what was requested, and four buttons. Two
     things a person needs in order to decide were missing, and both of them
     are the difference between a considered click and a reflex:

       - WHETHER IT CAN BE TAKEN BACK. "Send" and "Save a draft" looked
         identical. A sent email cannot be recalled and the card said nothing
         about that at the one moment it mattered.
       - WHEN THE PERMISSION LAPSES. An item written a fortnight ago is not the
         same decision as one written this morning, and nothing on the screen
         distinguished them.

     Both come from the item the server wrote, not from a guess made here: the
     server sets `expiresAt` and `reversible` when the work is enqueued, and it
     refuses an expired approval regardless of what this screen drew. This is
     defence in depth and an explanation, in that order. */
  const _apvLapse=a=>{
    const exp=Number(a.expiresAt)||(Number(a.readyAt)?Number(a.readyAt)+7*86400000:0);
    if(!exp) return { expired:true, text:'AMV cannot tell how old this is' };
    const left=exp-Date.now();
    if(left<=0) return { expired:true, text:'Expired - run the job again for a fresh one' };
    const d=Math.floor(left/86400000), h=Math.floor(left/3600000);
    return { expired:false,
      text: d>=1 ? ('Expires in '+d+' day'+(d===1?'':'s'))
          : h>=1 ? ('Expires in '+h+' hour'+(h===1?'':'s'))
          : 'Expires within the hour' };
  };
  const apprCard=a=>{
    const act=_apvAction(a);
    const lapse=_apvLapse(a);
    /* Absent means unknown, and unknown is not "safe". An older item carries no
       `reversible` field, so it is described by what the action does rather
       than reassured about. */
    const oneWay = a.reversible === false || (a.reversible === undefined && act.verb === 'send');
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
        <span class="apv-ic">${_safeIcon(a.icon||'\u2709\uFE0F')}</span>
        <div class="apv-card-hd">
          <div class="apv-title">${escH(a.title)}</div>
          <div class="apv-req">${escH(a.requesting||act.line)}</div>
        </div>
        <span class="apv-status ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Needs approval'}</span>
      </div>
      ${a.fromJob?`<div class="apv-fromjob">↻ From your running job${a.jobSchedule?` · ${escH(a.jobSchedule)}`:''}. It keeps running - you'll get a new one to review each time. The job stays in <b>Running jobs</b>.</div>`:''}
      ${meta.length?`<div class="apv-meta">${meta.map(m=>`<span class="apv-mi"><span class="apv-mk">${escH(m[0])}</span>${escH(m[1])}</span>`).join('')}</div>`:''}
      ${a.warning?`<div class="apv-warn">${escH(a.warning)}</div>`:''}
      <div class="apv-terms">
        <span class="apv-term ${oneWay?'oneway':'undoable'}">${oneWay?'Cannot be undone once sent':'You can undo this'}</span>
        <span class="apv-term ${lapse.expired?'lapsed':''}">${escH(lapse.text)}</span>
      </div>
      <div class="apv-act">
        <button class="btn apv-preview" data-dact="apvPreview" data-darg="${a.id}">Preview</button>
        <button class="btn apv-ghost" data-dact="apvEdit" data-darg="${a.id}">Edit</button>
        <button class="btn apv-ghost apv-reject" data-dact="apvReject" data-darg="${a.id}">Reject</button>
        <button class="btn apv-approve" data-dact="apvQuickApprove" data-darg="${a.id}">${escH(act.btn)}</button>
      </div>
    </div>`;
  };
  const st=_mcState();
  /* Ask the server what it is running, the first time this screen is opened in
     a session. The list is rendered from whatever is already known so the page
     appears instantly, and the refresh redraws it a moment later - which is the
     difference between a screen that is briefly out of date and one that is
     permanently wrong about jobs on another device. */
  if(!st.serverLoaded && !_mcAskedServer){
    _mcAskedServer = true;
    try{ if(typeof _autoRefresh === 'function') _autoRefresh().then(_cwRedrawIfChanged); }catch(e){}
    /* And what is connected, because that decides whether a job needing a
       mailbox says "runs with AMV closed" or "connect the account to run it
       closed". Without this the screen answers that question from an empty
       list and always gives the pessimistic answer. */
    try{ if(typeof _connLoad === 'function') _connLoad(false).then(_cwRedrawIfChanged); }catch(e){}
  }
  const paused=_autonomyPaused();
  const tiles=[
    ['appr','Needs approval',st.appr.length,'wait'],
    ['fail','Action required',st.failed.length,'err'],
    ['active','Active work',st.active.length,'active'],
    ['sched','Running jobs',st.server.length+_mcLocalOnly(st).length+st.auton.length,'info'],
    ['done','Completed',st.done.length,'muted']
  ];

  vc.innerHTML = `<div class="sv fi"><div class="crew-page mc-page">
    <header class="mc-head">
      <div class="mc-head-l">
        <div class="eyebrow">Crew · Autonomous work</div>
        <h2>Mission Control</h2>
        <p class="vsub">Crew is AMV working on its own. Tell it an outcome and it plans the steps, does the work across your connected apps, and stops for your approval before anything is sent. This page is where you watch it all - what needs you, what’s running, and what’s scheduled.</p>
        <p class="cw-open-note-in">The jobs below are <b>examples</b>, not the menu. Describe what you want in your
          own words and Crew takes it - the catalogue is here to show you the shape of a job, not the list of them.</p>
      </div>
      <div class="mc-head-r">
        ${_cwWhereBtnHTML()}
        ${(() => {
          /* A SAFETY CONTROL FOR WORK THAT IS NOT HAPPENING.

             "Pause all autonomous" was the loudest thing in this header and it
             was always there - including on an account with nothing running,
             which is every account on its first visit. The first control
             somebody meets on the Crew screen was an emergency brake for a
             machine that had not been started, and it plants the idea that
             something here needs stopping before they have turned anything on.

             When work IS running, pause is exactly right and stays. When
             nothing is, the useful thing to offer is the way in. Paused counts
             as active state on purpose: if somebody has paused autonomy they
             must always be able to resume it, whether or not a job is listed. */
          const running = st.server.length + _mcLocalOnly(st).length + st.auton.length;
          if (paused) {
            return `<button class="mc-pause paused" data-dact="resumeAllAutonomous">▶ Resume autonomy</button>`;
          }
          if (running > 0) {
            return `<button class="mc-pause" data-dact="pauseAllAutonomous">⏸ Pause all autonomous</button>`;
          }
          return `<button class="mc-browse" data-dact="openCowork">Create an automation</button>`;
        })()}
      </div>
    </header>
    ${(()=>{ const n=_crewJobAllowance(); const used=st.server.length+_mcLocalOnly(st).length+st.auton.length;
      /* The number, before they hit it. A limit discovered by bumping into it
         reads as a fault; the same limit stated up front reads as a plan. */
      return n?`<div class="mc-allow">${used} of ${n} background job${n===1?'':'s'} in use <span>\u00b7 your plan runs ${n}</span></div>`:''; })()}
    <div class="mc-cmd mc-cmd-lg">
      <div class="mc-cmd-label">Tell AMV what to do <span>- it recognizes what you mean and does it, right here</span></div>
      <div class="mc-cmd-inner">
        <svg class="mc-cmd-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>
        <textarea id="mc-cmd-input" class="mc-cmd-input" rows="1" aria-label="Tell AMV what to do" enterkeyhint="go" placeholder="e.g. “email me a summary of my unread emails” or “research the top AI news and write a brief”" autocomplete="off"></textarea>
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
    ${_mcOfferHTML()}
    ${_mcQuietRowHTML()}
    ${_mcNeverRowHTML()}
    <div class="mc-tiles">${tiles.map(t=>`<button class="mc-tile mc-${t[3]}${t[2]?'':' zero'}" data-mcjump="mc-${t[0]}"><span class="mc-tile-n">${t[2]}</span><span class="mc-tile-l">${t[1]}</span></button>`).join('')}</div>

    ${_mcCeilingHTML()}
    ${_mcStandingHTML()}

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
      ${(()=>{
        const local = _mcLocalOnly(st);
        const rows = st.server.map(_mcServerSchedRow).join('')
                   + st.auton.map(_mcAutonSchedRow).join('')
                   + local.slice(0,8).map(t=>_mcSchedRow(t,st)).join('');
        if(rows) return `<div class="mc-sched">${rows}</div>`
          + (local.length?`<div class="mc-sched-note">The ${local.length===1?'job':local.length+' jobs'} above without "runs on AMV's servers" could not be registered to run in the background, so ${local.length===1?'it runs':'they run'} only while AMV is open.</div>`:'');
        /* A failed read is not an empty list. Saying "no running jobs" to
           somebody whose jobs are running, because the request failed, invites
           them to set everything up a second time. */
        if(st.serverError)
          return `<div class="mc-empty-row">Your running jobs could not be loaded (${escH(st.serverError)}). They have NOT stopped - this screen just cannot show them right now. <button class="mc-sec-link" data-dact="mcReloadJobs">Try again</button></div>`;
        return `<div class="mc-empty-row">No running jobs yet. Start a task above and choose how often it should repeat - it will show up here. You can also just tell AMV in chat: "every morning, summarize my unread email".</div>`;
      })()}
    </section>

    ${_mcActivityHTML()}

    ${st.done.length?`<section id="mc-done" class="mc-sec">
      <div class="sec-head"><h3>Recently completed</h3></div>
      <div class="mc-grid">${st.done.slice(-6).reverse().map(_mcDoneCard).join('')}</div>
    </section>`:''}

    <div class="crew-split-even">
      <section class="crew-do">
        <div class="sec-head"><h3>Run something now</h3><span class="sec-sub">AMV opens a workspace, asks what it needs, and actually does it.</span></div>
        <div class="cw-quick">
          ${[['\uD83D\uDDFA\uFE0F','Plan a trip','trip','openTripPlanner()'],
             ['\uD83D\uDCE7','Check email','gmail','crewRun(\'gmail\',\'Check email\')'],
             ['\uD83D\uDCC5','Plan my week','week','crewRun(\'week\',\'Plan my week\')'],
             ['\u2728','Autonomous task','auto','openCowork()']]
            .map(q=>`<button class="cw-quick-card" data-dact="_cwQuick" data-darg="${escH(q[2])}"><span class="cw-quick-ic" aria-hidden="true">${q[0]}</span><span>${escH(q[1])}</span></button>`).join('')}
        </div>
        <div id="crew-live" class="crew-live">${_crewResultsHTML()}</div>
      </section>
      <section>
        <div class="sec-head"><h3>Games you are running</h3><span class="sec-sub">A game is a link anybody can open - no account needed. You see who has answered; nobody sees the answers until you reveal them.</span></div>
        <div id="crew-games"></div>
      </section>
      <section>
        <div class="sec-head"><h3>Recurring work</h3><span class="sec-sub">Pick one to set it on a schedule - or describe your own. Many can run at once.</span></div>
        <div class="tpl-grid">
          ${[
            ['\uD83C\uDFAC','YouTube video','Produce a complete, production-ready YouTube video package about this week\'s stock market: a punchy title, a 0-3s hook, a full word-for-word voiceover script with timestamps, a scene-by-scene shot list, B-roll suggestions, on-screen text, an SEO description, 15 tags, and a thumbnail concept. I review before publishing.'],
            ['\uD83D\uDCF8','Instagram post','Produce a ready-to-post Instagram package about the latest in my field: a scroll-stopping caption with line breaks, 20-30 ranked hashtags, a carousel outline, a detailed image/visual concept, and the best post time. I approve before posting.'],
            ['\uD83D\uDC26','Social posts','Write 3 ready-to-publish posts for X and 2 for LinkedIn on what\'s trending in my industry today - each with the full copy, hooks, and hashtags. I approve before anything is published.'],
            ['\uD83D\uDCC8','Market brief','Every morning, produce a tight briefing of overnight market moves: major indices, notable movers, and the 3 headlines that matter to me, each with a one-line why-it-matters.'],
            /* Was "give a buy/hold view and prepare a $1 XRP order on Robinhood for
               one-tap approval". AMV has no Robinhood connector and cannot place an
               order anywhere, and a buy/hold view is the financial advice every
               money job here refuses to give - a template that promises both is a
               fake feature twice over. What it really does, said plainly. */
            ['\uD83D\uDCB0','Watchlist check-in','Each Monday, check the stocks and coins on my watchlist on the live web: last week\u2019s move for each with the actual figure, the news behind it with a link, and any earnings or unlock dates coming up. Information only - never tell me what to buy, sell or hold.'],
            ['\uD83C\uDFE6','Bank check-in','Every morning, check my linked bank account and report the balance, recent transactions, anything unusual, and my spend-vs-last-week. Prepare it as a clean daily report.'],
            ['\uD83D\uDCF0','News digest','Daily, gather the top developments in AI and produce a sharp 5-bullet briefing, each bullet with a link-worthy summary and why it matters.'],
            ['\u2709\uFE0F','Inbox triage','Each morning, read new emails, rank them by urgency with reasons, and draft a ready-to-send reply for each. I click send before anything goes out.']
          ].map(t=>`<button class="tpl-card" data-dact="openCoworkWith" data-darg="${escH(t[2])}"><span class="tpl-ic" aria-hidden="true">${t[0]}</span><span class="tpl-t">${escH(t[1])}</span></button>`).join('')}
        </div>
      </section>
    </div>
    ${_mcBoughtCrewsHTML()}
    ${/* NOTHING COMES AFTER THE CATALOGUE.

           Asked for, and right: the list of what Crew can do is what somebody
           came to this page to read, and it used to have three more sections
           and a marketplace panel stacked under it - so browsing to the bottom
           of a hundred jobs delivered you into "Recurring work", which is a
           second list of the same kind of thing. What is happening NOW goes
           above (it is state, and state is news), what Crew CAN do goes last
           and ends the page. */ ''}
    <div class="crew-jobs-sec mc-start">
      <div class="sec-head"><h3>Start new work</h3><span class="sec-sub">Turn on a standing job - AMV runs it automatically and emails you results.</span></div>
      ${_cwNotHereHTML('above')}
      ${/* Same order as the locked view, for the same reason: the standing
            work first, the one-offs last. */ ''}
      ${_cwForYouHTML()}
      ${_cwMadeForHTML()}
      <div class="cw-filters">
        ${_cwFindBoxHTML(_cwAllJobs().filter(j=>_cwMatches(j,_cwFind)).length)}
      </div>
      ${_cwCatChips(_cwShowcase())}
      <div id="cw-jobs-body">${_cwJobsBody(_cwShowcase(), jobCard)}</div>
      ${_cwMostStartedHTML()}
      ${_cwErrandsHTML()}
      <section class="cw-morec" id="cw-morec">
        <button class="cw-morec-btn" data-dact="cwMoreCountries">${escH(T('See more countries'))}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      </section>
    </div>

  </div></div>`;
  try{ vc.querySelectorAll('[data-mcjump]').forEach(function(b){ on(b,'click',function(){ var el=document.getElementById(b.dataset.mcjump); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }); }); }catch(e){}
  _cwWireCmd(vc);
  /* Filled after the view exists, never before: the panel renders into an
     element this function has only just written. */
  try{ if(typeof renderGames==='function') renderGames(); }catch(e){}
}
/* WIRED FROM BOTH VIEWS.

   This lived inline at the end of the unlocked render, so the command box and
   the example search only worked for somebody who was already paying. The box
   is now the first thing on the locked view too, and a box that does nothing
   when you press Enter is worse than no box - so the wiring is a function and
   both views call it. */
function _cwWireCmd(vc){
  if(!vc) return;
  // Command bar: type any goal - the real agent recognizes intent and does it.
  try{
    var _mcRun=function(){ var el=$('mc-cmd-input'); var v=el?el.value.trim():''; if(!v){ el&&el.focus(); return; } mcRunCommand(v); };
    on($('mc-cmd-go'),'click',_mcRun);
    /* Enter runs it, as it always did; Shift+Enter is a new line, the way
       the chat box works, because the box now takes a paragraph. An Enter
       that finishes composing a character (Chinese, Japanese, Korean input)
       is the input method's, not a Run. */
    var _ci=$('mc-cmd-input'); if(_ci){
      on(_ci,'keydown',function(e){ if(e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229){ e.preventDefault(); _mcRun(); } });
      on(_ci,'input',function(){ _mcCmdFit(_ci); });
      /* In the next frame, not now: measuring here forced the whole freshly
         drawn Crew page to be laid out inside the click that opened it (130ms
         at a phone's speed), and the frame then laid it out again. */
      try{ requestAnimationFrame(function(){ _mcCmdFit(_ci); }); }catch(e){ _mcCmdFit(_ci); }
    }
    vc.querySelectorAll('[data-mccmd]').forEach(function(c){ on(c,'click',function(){ var el=$('mc-cmd-input'); if(el){ el.value=c.dataset.mccmd; _mcCmdFit(el); el.focus(); } }); });
  }catch(e){}
  /* The search re-renders on a pause rather than on every keystroke: this
     rebuilds a hundred cards, and doing that per character makes typing feel
     like wading. */
  try{
    var _fi=$('cw-find');
    if(_fi){
      var _t=null;
      on(_fi,'input',function(){ var v=this.value; clearTimeout(_t); _t=setTimeout(function(){ cwFind(v); },220); });
      on(_fi,'keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); clearTimeout(_t); cwFind(this.value); } });
    }
  }catch(e){}
}
try{ window._cwWireCmd=_cwWireCmd; }catch(e){}

function cwToggle(id){
  const jobs=_cwJobs(); let j=jobs.find(x=>x.id===id);
  /* A world example is not in the saved list until somebody switches it on.
     It is a real job with a country in its instruction, so switching it on
     adds it and then follows exactly the same path as any other job - the
     allowance check, the setup questions, the scheduling. */
  if(!j){
    const w=(()=>{ try{ return (_cwAllJobs()||[]).find(x=>x.id===id); }catch(e){ return null; } })();
    if(!w) return;
    j={...w}; jobs.push(j); _cwSaveJobs(jobs);
  }
  // Job Hunt needs a profile before it can do anything - open setup on first
  // enable if the required details are missing, instead of silently turning on.
  if(id==='job_hunt' && !j.on && typeof AMVJobs!=='undefined' && AMVJobs.missingInfo({}, AMVJobs.cfg()).length){
    if(typeof openJobHunt==='function'){ openJobHunt(); return; }
  }
  /* The header says "X of N background jobs in use" and the plans page sells N.
     Nothing enforced it, so all seventy could be switched on under a plan that
     runs five - and the spend ceiling, not the plan, would have decided which
     ones actually ran. Refuse at the point of the promise, naming the number. */
  if(!j.on){
    const allow=_crewJobAllowance();
    /* Jobs still being created count too. Setting one up is a round trip, and
       without counting the ones in flight a fast hand switches on six while all
       six still read the same "none are on yet". */
    const used=jobs.filter(x=>x.on).length + _cwPending.size;
    if(allow && used>=allow){
      toast('Your plan runs '+allow+' background job'+(allow===1?'':'s')+' at once. Turn one off, or upgrade to run more.','info',7000);
      return;
    }
  }
  /* A job that CAN run unattended now creates real scheduled work on the server
     rather than setting a boolean. Switching one on used to write a flag into a
     record nothing in the cron has ever read, so every standing job on this
     screen was a switch attached to nothing. */
  if(_cwUnattendedReady(j)) return _cwToggleReal(jobs, j);

  /* Everything else needs this tab, because the mailbox and calendar tokens
     live here and the server never sees them. So it goes on the LOCAL schedule,
     which really does run these while AMV is open. Without this the switch was
     decorative for the other fifty jobs too - a card reading "runs while AMV is
     open" while nothing anywhere was scheduled. */
  _cwSyncLocalSched(j, !j.on);

  j.on=!j.on; _cwSaveJobs(jobs);
  // keep the engine's own on-flag in sync so AMVJobs.run() reflects the toggle
  if(id==='job_hunt' && typeof AMVJobs!=='undefined'){ try{ const c=AMVJobs.cfg(); c.on=j.on; AMVJobs.save(c); }catch(e){} }
  /* Swallowed on purpose, and only here: the schedule this switch really drives
     is the local one, already written above. `/api/jobs` is the copy your OTHER
     devices read, so a refusal means they show a stale switch - worth recording,
     not worth talking over the message below. */
  if(window.AMV_API && AMV_API.live){ AMV_API.toggleJob(id,j.on).catch(e=>_jobSyncFailed(j,e)); }
  /* Turning it on is kept - the intent is real and it starts the moment the
     account is linked. What is not kept is the impression that it is running.
     A job that needs a mailbox nobody connected will produce nothing, and being
     told that now beats discovering it from an empty inbox in a fortnight. */
  const miss=j.on?_cwNeedsMissing(j):[];
  if(miss.length){
    /* The toast this replaces was true and was the end of the road: it named
       what was missing and left somebody on a screen with no way to supply it
       except a Connect button two screens from the job they had just switched
       on. The intent is still kept - the job stays on and starts the moment the
       account is linked - and now the next step is in front of them.

       Deliberately after the save, not instead of it. Somebody who closes this
       screen has still turned the job on, and the card says what it is waiting
       for. */
    /* The screen only when there is something on it to press. A requirement no
       connector can satisfy still gets the sentence, because the sentence is
       true and a screen offering nothing is not an improvement on it. */
    if(_cwMissingNeeds(j).length){ try{ openCrewConnect(j.id); }catch(e){} }
    else toast('Saved, but "'+j.title+'" cannot run until you connect '+miss.join(' and ')+'.','info',7000);
  } else if(j.on){
    toast('On: '+j.title+' - it runs while AMV is open.','info',5000);
  } else {
    toast('Off: '+j.title,'info');
  }
  renderCrewView();
}

/* A switch that moved here but not on the server. Recorded rather than shown,
   because on this device the job really is in the state the card says - it is
   the other devices that will be wrong until the next sync. An empty catch made
   that indistinguishable from a clean save. */
function _jobSyncFailed(j, e){
  try{ AEGIS.log('job_toggle_unsynced',{ id:(j&&j.id)||'', on:!!(j&&j.on),
       why:String((e&&e.message)||'').slice(0,120) }); }catch(_){}
}

/* A job needing this tab's accounts, put on (or taken off) the local schedule
   that `_runDueAuto` actually walks. Ask-first by default: these reach a real
   mailbox, and work that touches somebody's contacts should be seen before it
   goes anywhere. */
function _cwSyncLocalSched(j, turningOn){
  try{
    if(typeof _loadSched!=='function' || typeof _saveSched!=='function') return;
    const key='cw_'+j.id;
    let list=_loadSched().filter(t=>t.id!==key);
    if(turningOn){
      const freq=j.every||'daily';
      list.push({ id:key, goal:(j.prompt||j.desc||j.title), freq,
                  next:(typeof _freqNext==='function'?_freqNext(freq,Date.now()):Date.now()+864e5),
                  created:Date.now(), lastRun:null, localOnly:true, approval:'require',
                  fromCrewJob:j.id });
    }
    _saveSched(list);
  }catch(e){}
}

/* Turning a background job on and off for real. The switch only moves once the
   server has agreed, so a failure leaves the screen showing what is actually
   true rather than an on-looking card with nothing behind it. */
/* WHAT A JOB NEEDS, IN THE WORDS THE SERVER USES.

   `needs` is written for a person to read on a card ("Email, Web research").
   The runner needs a capability key it can check a grant against. Mapping them
   here keeps the cards in plain English and the wire precise, rather than
   making one of the two worse to save a lookup.

   Web research is absent on purpose: it needs no account, and listing it would
   make every job on the screen look like it wants a connection. */
const _CW_NEEDS_TO_USES = {
  'Email': 'mail.read',
  'Calendar': 'calendar.read',
  /* THE SCHOOL JOB DECLARED A NEED NOTHING COULD MAP.

     school_auto says needs:'Classroom' and its instruction is written around
     real coursework, but this table had no row for it - so _cwUsesFor returned
     an empty list, the job never asked for school.read, and the server never
     fetched anything. The job would switch on, run every morning, and plan a
     week from nothing while its own prompt told the model to name any class it
     could not read.

     A `needs` string with no row here is not a smaller job, it is a job whose
     whole input is missing, and nothing said so at any layer. */
  'Classroom': 'school.read',
  /* FIVE JOBS ASKED FOR THIS AND GOT NOTHING FOR YEARS.

     Morning money summary, Unusual transaction alerts, Low balance warning,
     Budget pace and Credit watch all say needs:'Bank connection', and their
     instructions are written around real balances and real transactions. With
     no row here `_cwUsesFor` returned an empty list, so `uses` never reached
     the server, the runner never opened anything, and each of them ran on its
     instruction alone. They did not lie about it - every one of those prompts
     says never to state a balance it cannot read - but a job that says "use
     real transactions only" and is handed none is a job that cannot work.

     The comment above used to say a bank link was "a need AMV has no
     capability for at all". That was true when it was written and stopped
     being true the moment the runner got `bank.read`. */
  'Bank connection': 'bank.read',
};
function _cwUsesFor(j){
  return String((j && j.needs) || '').split(',').map(x => x.trim())
    .map(n => _CW_NEEDS_TO_USES[n]).filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}
/* WHAT WOULD MAKE THE ANSWER BETTER, WHICH IS NOT WHAT MAKES IT POSSIBLE.

   A job declares `boost` for a source that improves its answer and is not
   required to produce one. There is exactly one today and it is the honest
   description of the money leak detector: it works from receipts, which is
   what it shipped on and the only thing available in most of the world, and it
   is plainly better from a statement, because a receipt is what a merchant
   said and a debit is what left the account.

   Kept out of `needs` because everything in `needs` is reported as MISSING
   when it is absent - so listing the bank there would have told everybody
   outside the aggregator's countries that a working job was broken, and would
   have stopped it running with AMV closed. Kept out of `_cwUsesFor` for the
   same reason at the other end. */
function _cwBoostsFor(j){
  return String((j && j.boost) || '').split(',').map(x => x.trim())
    .map(n => _CW_NEEDS_TO_USES[n]).filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

/* IS THERE A LIVE CONNECTION THAT WOULD LET THIS RUN UNATTENDED?

   Read from the connections the server reported, not from a local flag. An
   `unattended` connection is one the provider gave a long-lived token for; a
   `broken` one is a grant that has been revoked at the provider and would fail
   on the next run, which is worse than not having it, because the card would
   promise background work that silently produces nothing. */
function _cwConnHas(cap){
  /* A BANK LINK IS NOT A SCOPED GRANT, AND ASKING THE GRANTS ABOUT IT ANSWERS
     NO EVERY TIME.

     `bank.read` lives in a `fin` record holding an aggregator token, not in the
     connector list with a `scopes` array - so the loop below could only ever
     return false for it. The first version of this work left that alone, and
     the five bank jobs went ready, declared `uses:['bank.read']`, and were then
     classified as running in the BROWSER, because "can the server do this"
     answered no about the one capability the server holds outside the connector
     table. Correct at both ends and not joined in the middle, again.

     Routed to the same accessor `CW_NEEDS_CHECK['Bank connection']` uses, so
     one question has one answer on every screen. */
  if(cap === 'bank.read'){
    try{ return typeof AMVFinance !== 'undefined' && !!AMVFinance.linked(); }catch(e){ return false; }
  }
  /* A mailbox connected with an app password - QQ Mail, Naver, WEB.DE - is
     read by the server's unattended runs too (see _mailboxUse), so it answers
     "is there a mailbox" as surely as a Google grant does. */
  if(cap === 'mail.read'){
    try{ if(typeof _mailConnectedAccount === 'function' && _mailConnectedAccount()) return true; }catch(e){}
  }
  try{
    const d = (typeof _connState !== 'undefined' && _connState) ? _connState.data : null;
    if(!d || !Array.isArray(d.items)) return false;
    return d.items.some(it => it && it.unattended && !it.broken
      && Array.isArray(it.scopes) && it.scopes.indexOf(cap) >= 0);
  }catch(e){ return false; }
}

/* WHERE THIS JOB CAN ACTUALLY RUN, NOW THAT THE SERVER CAN HOLD AN ACCOUNT.

   _cwRunsUnattended answers the old question: does this need nothing but web
   research. That was the whole story while provider tokens lived in the browser
   and the server had no way to reach a mailbox.

   It is no longer the whole story, and leaving it as the only test would have
   made everything above inert: a job needing Email would still have gone to the
   local schedule, so `uses` would never have reached the server and the runner
   would never have opened the mailbox it can now open. Correct at both ends and
   not joined in the middle - the same failure, one level further down.

   A need with no row in `_CW_NEEDS_TO_USES` still runs foreground, because
   nothing here can change that. A bank link used to be the example; it is one
   no longer, since the runner holds `bank.read` now. `boost` is deliberately
   not consulted: a source that only improves the answer must never decide
   whether the job can run with AMV closed. */
function _cwUnattendedReady(j){
  if(_cwRunsUnattended(j)) return true;
  const needs = String((j && j.needs) || '').split(',').map(x => x.trim()).filter(Boolean);
  const mappable = needs.every(n => n === 'Web research' || _CW_NEEDS_TO_USES[n]);
  if(!mappable) return false;
  const uses = _cwUsesFor(j);
  return uses.length > 0 && uses.every(_cwConnHas);
}

async function _cwToggleReal(jobs, j){
  const turningOn=!j.on;
  if(turningOn){
    if(typeof _scheduleTask!=='function'){ toast('Connect the AMV engine in Settings so jobs can run in the background.','error',6000); return; }
    if(_cwPending.has(j.id)) return;         // already being set up

    /* ASK FOR WHAT THE JOB ACTUALLY NEEDS, BEFORE IT RUNS ON NOTHING.

       A quarter of the catalogue tells the runner to work from something the
       person supposedly said - their watch list, their deadlines, their route
       and dates. The unattended runner receives exactly two things: the rules,
       and this job's own text. It has never had access to a list, a profile or
       a memory. So those jobs ran every morning against nothing and could only
       apologise or invent, and inventing is worse.

       That is the same failure this whole session has been about: a feature
       that is fully working from every angle except the one that matters. The
       answer goes into the job's detail, which IS what the runner is given, so
       what the person types is what the model reads.

       Cancelling means no job. A job created with the question skipped is
       precisely the broken one. */
    let extra = '';
    if(j.asks && j.asks.q){
      /* Said BEFORE they type it, not after. Refusing a pasted password is
         correct and is still a worse moment than never inviting one. */
      const said = await showTextPromptAsync(
        j.asks.q + '\n\n' + (j.asks.ph||'') +
        '\n\nDo not put passwords, card numbers or security codes here. AMV does not store them, '+
        'and this is kept on the server and read on every run. Connect an account in Integrations instead.',
        j.answer || '');
      if(said === null) return;                 // they backed out; nothing is created
      extra = String(said||'').trim();
      /* Before j.answer is written, not after. _scheduleTask refuses this too,
         but it refuses further down the line - and the line between here and
         there runs through localStorage. Saving a password to the device and
         then declining to send it is not a refusal, it is a second copy. */
      if(typeof refuseSecrets === 'function' && !refuseSecrets(extra, 'crew_ask')) return;
      if(!extra){
        toast('"'+j.title+'" needs that to work - without it, it would run every day on nothing. Nothing was set up.','info',7000);
        return;
      }
      j.answer = extra.slice(0, 1500);
    }

    toast('Setting up "'+j.title+'"…','info',2500);
    let item=null;
    _cwPending.add(j.id);
    try{
      const detail = (j.prompt||j.desc||j.title)
        + (extra ? '\n\nWhat the user has told you, which is the only information you have about them - use it and do not invent anything beyond it:\n' + j.answer : '');
      item=await _scheduleTask({ detail, repeat:(j.every||'daily'),
                                 /* Most jobs end by writing text, and 'research'
                                    is that. A job that declares its own kind
                                    ends by DOING something instead - a game job
                                    mints a real link - so the catalogue entry
                                    decides rather than this line. */
                                 kind:(j.kind||'research'), notify:'app', approval:'auto',
                                 /* So the unattended run may open the account
                                    this job says it needs. The server filters
                                    this against its own allow-list and still
                                    checks the connection carries the scope. */
                                 uses: _cwUsesFor(j),
                                 /* And what it would be better with. Refused
                                    exactly like `uses` server-side; the only
                                    difference is that a missing one is a note
                                    about the evidence rather than a stopped
                                    job. */
                                 boosts: _cwBoostsFor(j),
                                 /* Which catalogue job this is, so the most-used
                                    list is built from what people actually turn
                                    on rather than from a guess. */
                                 srcId: j.id,
                                 /* A job written for a country runs for that
                                    country, even when somebody in Spain
                                    switches on Mexico's. */
                                 country: j.country || '' });
    }catch(e){ item=null; }
    finally{ _cwPending.delete(j.id); }
    /* _scheduleTask reports the reason itself - a plan limit sends them to the
       plans page. Adding a second message here would just talk over it. */
    if(!item) return;
    j.on=true; j.autoId=item.id;
  } else {
    if(j.autoId && typeof _autoAction==='function'){
      const done=await _autoAction(j.autoId,'delete');
      /* Still scheduled on the server, so the switch must stay on. */
      if(!done){ toast('Could not stop "'+j.title+'" - it is still running.','error',6000); return; }
    }
    j.on=false; j.autoId=null;
  }
  _cwSaveJobs(jobs);
  /* Same as above: the real work was already created or deleted on the server
     by _scheduleTask / _autoAction, and refused to move the switch if that
     failed. This call only mirrors the flag across devices. */
  if(window.AMV_API && AMV_API.live){ AMV_API.toggleJob(j.id,j.on).catch(e=>_jobSyncFailed(j,e)); }
  toast(j.on?('On: '+j.title+' - it runs even with AMV closed. Results land in Tasks.')
            :('Off: '+j.title),'info',j.on?6000:3000);
  try{ if(typeof _autoRefresh==='function') _autoRefresh(); }catch(e){}
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
/* cwApprove used to live here. It removed the item from the local list and
   toasted "Approved - sent" without calling the server at all - cwReject
   beside it does call AMV_API.actApproval - so had anything wired it, it would
   have told somebody their draft went out when nothing had been sent. It was
   superseded by apvApprove in the approval panel below and referenced by
   nothing, which made the lie dormant rather than harmless. One approval path,
   and it is the one that talks to the server. */
function cwReject(id){
  const all=_cwApprovals(); const removed=all.find(x=>x.id===id); const idx=all.findIndex(x=>x.id===id);
  if(window.AMV_API && AMV_API.live){ AMV_API.actApproval(id,'reject').catch(()=>{}); }
  _cwSaveApprovals(all.filter(x=>x.id!==id)); renderCrewView();
  if(removed){ toastAction('Removed - it won’t be sent.','Return',()=>{ const list=_cwApprovals(); if(!list.some(x=>x.id===removed.id)){ list.splice(Math.min(idx,list.length),0,removed); _cwSaveApprovals(list); if(window.AMV_API && AMV_API.live){ AMV_API.actApproval(id,'restore').catch(()=>{}); } toast('Brought back','success'); renderCrewView(); } }); }
  else toast('Removed','info');
}

window.cwToggle=cwToggle;window.cwDemo=cwDemo;window.cwReject=cwReject;


