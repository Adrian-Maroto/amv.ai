/* ═════════════════════════════════════════════════
   MISSION CONTROL'S SCREEN - published as crew-view.js (see build.mjs), and
   fetched beside the Crew catalogue the first time somebody opens Crew.

   Moved out of the page, unchanged, by following what the rest of the app
   calls (audit #40): everything here is reached only from the Crew screen
   itself, so it waits for the first time somebody opens it. What other parts
   of the app call without the screen open stays in
   src/app/10b-mission-control-view.js, beside a stand-in renderCrewView that
   this file's real one replaces when it loads. A classic script, like the
   page: it uses the page's own helpers and declares its functions globally.
   ═════════════════════════════════════════════════ */
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
    /* A Crew job whose work is scheduled on the server IS that server job:
       listing both showed one job twice, counted twice, with two different
       labels (Nov 22). Only the ones running in this browser are listed here. */
    auton: jobs.filter(j=>j.on && !(j.autoId && (typeof _AUTOS !== 'undefined' && Array.isArray(_AUTOS) ? _AUTOS : []).some(x => x && x.id === j.autoId))),
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
  return `<div class="mc-card fail"><div class="mc-card-top"><span class="mc-card-t">${escH(t.title||'Task')}</span><span class="mc-pill err">Needs you</span></div><div class="mc-card-sub">${escH(t.error||'This task could not complete.')}</div><div class="mc-card-act"><button class="btn mc-mini" data-dact="_mcRetry" data-darg="${escH(t.id)}">Retry</button></div></div>`;
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
      <button class="btn mc-mini ${auto?'ghost':'bp'}" data-dact="_schedToggleApproval" data-darg="${escH(t.id)}">${auto?'Make me approve first':'Make autonomous'}</button>
      <button class="btn mc-mini ghost" data-dact="_schedEdit" data-darg="${escH(t.id)}">Edit</button>
      <button class="btn mc-mini ghost" data-dact="_mcCancelSched" data-darg="${escH(t.id)}">Cancel</button>
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
/* Crews somebody else made, saved to this account before the marketplace
   was retired (Build 16 audit D16-05). Still theirs to run, said as what they
   are: who made it, and that Run puts its steps in chat - nothing about
   buying, and no promise of a swap of details the run does not make. */
function _mcBoughtCrewsHTML(){
  let crews=[];
  try{ crews=(load('amv_saved_crews')||[]).filter(c=>c.fromMarket); }catch(e){}
  if(!crews.length) return '';
  return `<div class="mc-sec mc-bought owned-plugins" id="mc-bought">
    <div class="sec-head"><h3>${escH(T('Saved from others'))}</h3><span class="sec-sub">${escH(T('Crews somebody else made that you saved. Run one to start it in chat with its steps.'))}</span></div>
    <div class="mc-grid">${crews.slice(0,8).map(c=>`<div class="mc-card">
      <div class="mc-card-top"><span class="mc-card-t">${escH(c.title||'Crew')}</span><span class="mc-pill">${escH(T('Saved'))}</span></div>
      <div class="mc-card-sub">${(c.agents||[]).slice(0,4).map(a=>escH(a.role)).join(' → ')||(c.goal?escH(c.goal.slice(0,90)):'Multi-agent crew')}${c.seller?` · ${escH(T('made by {0}').replace('{0}',c.seller))}`:''}</div>
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
                data-dact="mcSetCeiling" data-darg="${escH(l.id)}">
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
    /* Nothing yet, and nothing wrong: no section. Crew is one box and the
       examples (Oct 26); an empty history is a box that says nothing. */
    if(!(st && st.error)) return '';
    return `<section id="mc-activity" class="mc-sec">
      <div class="sec-head"><h3>What AMV did on its own</h3><span class="sec-sub">Every unattended run, what it cost, and what happened to it.</span></div>
      <div class="mc-empty-row">This could not be loaded (${escH(st.error)}). It does not mean nothing ran. <button class="mc-sec-link" data-dact="mcReloadJobs">Try again</button></div>
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

/* A job the SERVER is running, shown with the controls that reach the server.

   Every button here posts to the same /auto/update the chat tools use, so the
   screen and the conversation are two doors onto one job rather than two
   records that drift apart. */
/* AGENTS - named workers that stay (77-agents.js on the server).

   An agent's jobs are ordinary running jobs: this section only names who does
   them, shows what each agent has spent this month against its own budget and
   what it produced last, and gives it work. Everything here is read from the
   server on the way in and after every change, so a card never shows an
   agent, a budget or a pause the server does not hold. */
let _mcAgentsD = null, _mcAgentsErr = '', _mcAgentsAsked = false;
function _mcAgentsLive(){ return !!(window.AMV_API && AMV_API.live && AMV_API.hasSession); }
async function _mcAgentsLoad(){
  _mcAgentsAsked = true;
  try{
    const r = await AMV_API._fetch('/v1/agents', { method:'GET', timeout:10000 });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
    _mcAgentsD = d; _mcAgentsErr = '';
  }catch(e){ _mcAgentsErr = (e && e.message) || T('the request failed'); }
  /* In place: only this section changed, and rebuilding the whole of Crew
     when one request lands is the flicker a-screen-that-refreshes-does-not-
     flicker exists to stop. */
  const box = document.getElementById('mc-agents');
  if(box) box.outerHTML = _mcAgentsHTML();
}
async function mcAgentsReload(){
  try{ if(typeof _autoRefresh === 'function') await _autoRefresh(); }catch(e){}
  await _mcAgentsLoad();
  if(S.tab === 'crew' || S.tab === 'extensions') renderCrewView();
}
function _mcAgentName(id){
  const a = _mcAgentsD && (_mcAgentsD.agents || []).find(x => x.id === id);
  return a ? a.name : '';
}
function _mcAgentCard(a){
  const spent = a.spentUSD == null ? T('spend could not be read') : '$' + (+a.spentUSD).toFixed(2);
  const money = a.budgetUSD > 0
    ? T('{0} of its {1} monthly budget').replace('{0}', spent).replace('{1}', '$' + (+a.budgetUSD).toFixed(2))
    : T('{0} this month · no budget of its own, your plan’s applies').replace('{0}', spent);
  const over = a.budgetUSD > 0 && a.spentUSD != null && a.spentUSD >= a.budgetUSD;
  const live = (a.jobs || []).filter(j => j.active);
  const jobs = (a.jobs || []).length
    ? '<ul class="mc-agent-jobs">' + a.jobs.slice(0, 4).map(j => '<li>' + escH(j.detail)
        + (j.lastError ? ' <span class="mc-agent-err">' + escH(j.lastError) + '</span>' : '') + '</li>').join('') + '</ul>'
    : '<p class="mc-agent-none">' + escH(T('No jobs yet. Give it one and it starts working on its own.')) + '</p>';
  const last = (a.results || [])[0];
  return '<article class="mc-agent' + (a.paused ? ' paused' : '') + '" aria-label="' + escH(a.name) + '">'
    + '<div class="mc-agent-h"><h4>' + escH(a.name) + '</h4><span class="mc-agent-state' + (a.paused ? '' : ' on') + '">'
    + escH(a.paused ? T('Paused') : live.length ? T('Working') : T('Idle')) + '</span></div>'
    + (a.role ? '<p class="mc-agent-role">' + escH(a.role) + '</p>' : '')
    + '<p class="mc-agent-money' + (over ? ' over' : '') + '">' + escH(money) + (over ? ' · ' + escH(T('budget reached, its jobs wait for next month')) : '') + '</p>'
    + _mcAgentScore(a)
    + jobs
    + _mcAgentSignIns(a)
    + (last ? '<div class="mc-agent-last"><span>' + escH(T('Latest result')) + ' · ' + escH(_dayLabel(last.at)) + '</span><p>' + escH(last.out.slice(0, 240)) + '</p></div>' : '')
    + '<div class="mc-agent-acts">'
    + '<button class="btn mc-mini bp" data-dact="mcAgentJob" data-darg="' + escH(a.id) + '"' + (a.paused ? ' disabled' : '') + '>' + escH(T('Give it a job')) + '</button>'
    + '<button class="btn mc-mini ghost" data-dact="mcAgentEdit" data-darg="' + escH(a.id) + '">' + escH(T('Edit')) + '</button>'
    + '<button class="btn mc-mini ghost" data-dact="mcAgentPause" data-darg="' + escH(a.id) + '|' + (a.paused ? 'resume' : 'pause') + '">' + escH(a.paused ? T('Resume') : T('Pause')) + '</button>'
    + '<button class="btn mc-mini ghost" data-dact="mcAgentDelete" data-darg="' + escH(a.id) + '">' + escH(T('Delete')) + '</button>'
    + '</div></article>';
}
/* HOW IT IS DOING (AGENT-007): counted by the server from what its runs
   produced - good, failed, off the form it promises - with cost per good
   result, and why it was paused when AMV paused it. */
function _mcAgentScore(a){
  const sc = a.score || null;
  const why = a.paused && a.pausedWhy ? '<p class="mc-agent-err" role="status">' + escH(T('AMV paused it: {0}. Resume it to try again.').replace('{0}', T(a.pausedWhy))) + '</p>' : '';
  if(!sc || !sc.runs) return why;
  const parts = [T('{0} runs in 30 days').replace('{0}', String(sc.runs)), T('{0} good').replace('{0}', String(sc.good))];
  if(sc.failed) parts.push(T('{0} failed').replace('{0}', String(sc.failed)));
  if(sc.offForm) parts.push(T('{0} off-form').replace('{0}', String(sc.offForm)));
  if(sc.costPerGoodUSD != null) parts.push(T('{0} per good result').replace('{0}', '$' + (+sc.costPerGoodUSD).toFixed(2)));
  return '<p class="mc-agent-score">' + escH(parts.join(' · ')) + '</p>' + why;
}
/* SAVED SIGN-INS (owner decision #46): which sites it holds a sign-in for,
   until when, and Forget - never the sign-in itself, which the server keeps
   sealed and never sends. */
function _mcAgentSignIns(a){
  const b = a.browser || {};
  if(!b.keep) return '';
  const held = a.signIns || [];
  /* The server could not tell what is stored: say so, and keep Forget on
     every site - the one action that is right whatever is there. */
  if(a.signInsUnknown){
    const rows = (b.sites || []).map(site => '<li><span>' + escH(site) + '</span> <span class="mc-agent-si-st">' + escH(T('could not be checked')) + '</span> '
      + '<button class="mc-sec-link" data-dact="mcAgentForgetSite" data-darg="' + escH(a.id + '|' + site) + '">' + escH(T('Forget')) + '</button></li>').join('');
    return '<div class="mc-agent-si"><span>' + escH(T('Sign-ins it may keep (read-only when you are away)')) + '</span><ul>' + rows + '</ul>'
      + '<p class="mc-agent-none">' + escH(T('AMV could not check this agent’s saved sign-ins just now. Forget still works; try again in a moment to see them.')) + '</p></div>';
  }
  const rows = (b.sites || []).map(site => {
    const h = held.find(x => x.site === site);
    return '<li><span>' + escH(site) + '</span> <span class="mc-agent-si-st">'
      + escH(h ? T('signed in until {0}').replace('{0}', new Date(h.expiresAt).toLocaleDateString()) : T('not signed in yet'))
      + '</span> ' + (h
        ? '<button class="mc-sec-link" data-dact="mcAgentForgetSite" data-darg="' + escH(a.id + '|' + site) + '">' + escH(T('Forget')) + '</button>'
        : '<button class="mc-sec-link" data-dact="mcAgentSignIn" data-darg="' + escH(a.id + '|' + site) + '">' + escH(T('Sign in for it')) + '</button>') + '</li>';
  }).join('');
  return '<div class="mc-agent-si"><span>' + escH(T('Sign-ins it may keep (read-only when you are away)')) + '</span><ul>' + rows + '</ul>'
    + (held.length ? '' : '<p class="mc-agent-none">' + escH(T('Run AMV’s browser as this agent and sign in to one of these sites to give it one.')) + '</p>') + '</div>';
}
/* A WATCHED run, as the agent: AMV's browser opens the site in the live view
   and hands the sign-in to the person - AMV never asks for the password. At
   the end the server keeps that site's sign-in for the agent, sealed. The
   person pressed this, which is the consent; nothing on the site is bought,
   sent or changed beyond signing in. */
async function mcAgentSignIn(arg){
  const s = String(arg || ''); const i = s.indexOf('|');
  const id = s.slice(0, i), site = s.slice(i + 1);
  const c = (typeof AMVConnectors !== 'undefined') && AMVConnectors.get('browser');
  if(!c || !c.actions || !c.actions.do){ toast(T('AMV’s browser is not available here, so nothing was opened.'), 'error', 6000); return; }
  try{
    const r = await c.actions.do.run({ url: 'https://' + site + '/', agent: id,
      goal: 'Open the sign-in page of this site and hand it to me to sign in myself. Do not type a password, buy, send or change anything. Stop once I am signed in.' });
    const kept = (r && r.agentKept) || [];
    toast(kept.length ? T('Signed in. It keeps the sign-in for {0} for 30 days.').replace('{0}', kept.join(', '))
                      : T('No sign-in was kept - the site did not end signed in. Nothing changed.'), kept.length ? 'success' : 'warn', 6000);
  }catch(e){ toast(T('That did not work: {0}. Nothing changed.').replace('{0}', (e && e.message) || ''), 'error', 6000); }
  await mcAgentsReload();
}
async function mcAgentForgetSite(arg){
  const s = String(arg || ''); const i = s.indexOf('|');
  const id = s.slice(0, i), site = s.slice(i + 1);
  try{
    const d = await _autoApi('/v1/agents/signins/forget', { id, site });
    /* Said as it is (Nov 1 audit AGENT-009): forgotten and confirmed gone,
       or unusable now with the stored copy still being deleted. */
    toast(d && d.removed === false
      ? T('It can no longer be used. The stored copy is being deleted and will be gone shortly.')
      : T('Forgotten. It no longer holds a sign-in for {0}.').replace('{0}', site), d && d.removed === false ? 'info' : 'success', 5000);
  }catch(e){ toast(T('That did not work: {0}. Nothing changed.').replace('{0}', (e && e.message) || ''), 'error', 6000); }
  await mcAgentsReload();
}
/* KEPT OUT OF THE WAY (owner decision #44): Crew stays one box. This section
   appears only once the person has kept an agent - from "Keep as an agent" on
   a job that works - and until then there is nothing here to read past. */
function _mcAgentsHTML(){
  if(!_mcAgentsLive()) return '';
  if(!_mcAgentsAsked) setTimeout(_mcAgentsLoad, 0);
  const d = _mcAgentsD;
  if(!d || !(d.agents || []).length) return '<section id="mc-agents" hidden></section>';
  const canAdd = d && d.allowed && (d.agents || []).length < d.max;
  const head = '<div class="sec-head"><h3>' + escH(T('Agents')) + '</h3><span class="sec-sub">'
    + escH(T('Named workers that keep going: each has its own instructions, its own monthly budget and its own jobs, and you can pause it at any time.'))
    + '</span>' + (canAdd ? '<button class="mc-sec-link" data-dact="mcAgentEdit" data-darg="">' + escH(T('New agent')) + '</button>' : '') + '</div>';
  let body;
  if(!d && _mcAgentsErr) body = '<div class="mc-empty-row">' + escH(T('Your agents could not be loaded ({0}). Their jobs have not stopped.').replace('{0}', _mcAgentsErr))
    + ' <button class="mc-sec-link" data-dact="mcAgentsReload">' + escH(T('Try again')) + '</button></div>';
  else if(!d) body = '<div class="mc-empty-row" role="status">' + escH(T('Loading your agents…')) + '</div>';
  else if(!d.allowed && !(d.agents || []).length) body = '<div class="mc-empty-row">' + escH(T('Agents work in the background, which is part of Pro.'))
    + ' <button class="mc-sec-link" data-dact="setTab" data-darg="plans">' + escH(T('See plans')) + '</button></div>';
  else if(!(d.agents || []).length) body = '<div class="mc-empty-row">' + escH(T('No agents yet. Make one for work you hand off again and again - a researcher who reads the news in your field every morning, an assistant who drafts the week’s replies.'))
    + ' <button class="mc-sec-link" data-dact="mcAgentEdit" data-darg="">' + escH(T('New agent')) + '</button></div>';
  else body = '<div class="mc-agents">' + d.agents.map(_mcAgentCard).join('') + '</div>';
  return '<section id="mc-agents" class="mc-sec">' + head + body + '</section>';
}
function _mcAgentDialog(title, inner, onSave){
  const r = $('ovr'); if(!r) return;
  r.innerHTML = '<div class="ov" id="ag-bg"><div class="ob" role="dialog" aria-modal="true" aria-labelledby="ag-t" style="max-width:560px">'
    + '<button class="oc" id="ag-x" aria-label="' + escH(T('Close')) + '">×</button>'
    + '<h2 id="ag-t">' + escH(title) + '</h2>' + inner
    + '<p class="ob-sub" id="ag-msg" role="alert"></p>'
    + '<div class="sec-row"><button class="btn bp" id="ag-save">' + escH(T('Save')) + '</button><button class="btn bs" id="ag-cancel">' + escH(T('Cancel')) + '</button></div>'
    + '</div></div>';
  r.classList.add('on');
  on($('ag-x'), 'click', closeOvr); on($('ag-cancel'), 'click', closeOvr);
  onBackdrop($('ag-bg'), closeOvr);
  on($('ag-save'), 'click', async () => {
    const b = $('ag-save'); b.disabled = true;
    try{ await onSave(); closeOvr(); }
    catch(e){ $('ag-msg').textContent = (e && e.message === 'not-connected') ? T('AMV is not connected to its engine, so nothing was saved.') : ((e && e.message) || T('That did not work. Nothing changed.')); b.disabled = false; }
  });
  const f = r.querySelector('input,textarea'); if(f) try{ f.focus(); }catch(e){}
}
function mcAgentEdit(id){
  const a = id && _mcAgentsD ? (_mcAgentsD.agents || []).find(x => x.id === id) : null;
  _mcAgentDialog(a ? T('Edit {0}').replace('{0}', a.name) : T('New agent'),
    '<label class="ob-sub" for="ag-name">' + escH(T('Name')) + '</label><input id="ag-name" class="fp-in" maxlength="60" value="' + escH(a ? a.name : '') + '">'
    + '<label class="ob-sub" for="ag-role">' + escH(T('Role, in a line')) + '</label><input id="ag-role" class="fp-in" maxlength="160" value="' + escH(a ? a.role : '') + '" placeholder="' + escH(T('e.g. Reads the news in my field and tells me what matters')) + '">'
    + '<label class="ob-sub" for="ag-instr">' + escH(T('How it should work')) + '</label><textarea id="ag-instr" class="fp-in" rows="6" maxlength="4000">' + escH(a ? a.instructions : '') + '</textarea>'
    + '<label class="ob-sub" for="ag-budget">' + escH(T('Monthly budget in dollars (0 = no budget of its own)')) + '</label><input id="ag-budget" class="fp-in" type="number" inputmode="decimal" min="0" max="10000" step="1" value="' + escH(String(a ? a.budgetUSD : 0)) + '">'
    + '<p class="ob-sub">' + escH(T('Its jobs stop for the month when the budget is reached. Your plan’s own limit always applies as well.')) + '</p>'
    + _mcAgentEngineFields(a)
    + _mcAgentContractFields(a)
    + _mcAgentSignInFields(a),
    async () => {
      const body = { name: $('ag-name').value, role: $('ag-role').value, instructions: $('ag-instr').value, budgetUSD: +$('ag-budget').value || 0 };
      if($('ag-engine')) body.engine = $('ag-engine').value;
      if($('ag-web')) body.web = !!$('ag-web').checked;
      if($('ag-form')){
        const kind = $('ag-form').value;
        const parts = String($('ag-parts').value || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
        if(kind && !parts.length) throw new Error(T('Name the parts every result must have, or choose any form.'));
        body.contract = kind ? { kind, required: parts } : null;
      }
      const keepBox = $('ag-keep');
      if(keepBox){
        body.browserKeep = !!keepBox.checked;
        body.browserSites = String($('ag-sites').value || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
      }
      /* The revision it was opened at, so a change made elsewhere since is
         refused rather than overwritten (AGENT-016). */
      await _autoApi('/v1/agents/save', Object.assign(a ? { id: a.id, rev: +a.rev || 0 } : {}, body));
      toast(a ? T('Saved.') : T('Agent created. Give it a job to start it working.'), 'success', 4000);
      await mcAgentsReload();
    });
}
/* The engine its jobs run on, and whether it may search the web. Only the
   engines the plan includes are offered; the server checks again. */
function _mcAgentEngineFields(a){
  const list = (_mcAgentsD && Array.isArray(_mcAgentsD.engines)) ? _mcAgentsD.engines : [];
  const cur = (a && a.engine) || '';
  const label = (k) => (typeof ENGINE_LABEL !== 'undefined' && ENGINE_LABEL[k]) || k;
  return '<label class="ob-sub" for="ag-engine">' + escH(T('Engine')) + '</label>'
    + '<select id="ag-engine" class="fp-in"><option value=""' + (cur ? '' : ' selected') + '>' + escH(T('The everyday engine')) + '</option>'
    + list.map(k => '<option value="' + escH(k) + '"' + (k === cur ? ' selected' : '') + '>' + escH(label(k)) + '</option>').join('') + '</select>'
    + '<p class="ob-sub">' + escH(T('A heavier engine costs more per run, and counts against its budget at that price.')) + '</p>'
    + '<label class="cr-mode-opt"><input type="checkbox" id="ag-web"' + (a && a.web === false ? '' : ' checked') + '><span><b>' + escH(T('May search the web')) + '</b></span></label>';
}
/* THE FORM OF ITS RESULTS (AGENT-017). Checked by the server after every
   run; an off-form result is repaired once, and otherwise nothing that
   builds on it is started. */
function _mcAgentContractFields(a){
  const c = (a && a.contract) || null;
  const kind = c ? c.kind : '';
  const opt = (v, t) => '<option value="' + v + '"' + (v === kind ? ' selected' : '') + '>' + escH(t) + '</option>';
  return '<label class="ob-sub" for="ag-form">' + escH(T('Form of every result')) + '</label>'
    + '<select id="ag-form" class="fp-in">' + opt('', T('Any form')) + opt('sections', T('Named sections')) + opt('json', T('A JSON object with named fields')) + '</select>'
    + '<label class="ob-sub" for="ag-parts">' + escH(T('Parts it must always have, one per line')) + '</label>'
    + '<textarea id="ag-parts" class="fp-in" rows="3" maxlength="800" placeholder="' + escH(T('e.g. Summary, Sources - or price:number for a JSON field')) + '">' + escH(c ? c.required.join('\n') : '') + '</textarea>'
    + '<p class="ob-sub">' + escH(T('AMV checks every result. One without these parts is put right once; if it still is not, it is marked, and no step that builds on it starts.')) + '</p>';
}
/* Offered only where it can work: AMV's hosted browser to read with and a
   key to seal under. Elsewhere one line says why, and an agent already set
   to keep sign-ins can still be switched off. */
function _mcAgentSignInFields(a){
  const b = (a && a.browser) || { keep: false, sites: [] };
  const ready = !!(_mcAgentsD && _mcAgentsD.signInsReady);
  if(!ready && !b.keep) return '<p class="ob-sub">' + escH(T('Saved sign-ins for an agent need AMV’s browser, which this deployment does not have yet.')) + '</p>';
  return '<fieldset class="cr-mode"><legend>' + escH(T('Saved sign-ins')) + '</legend>'
    + '<label class="cr-mode-opt"><input type="checkbox" id="ag-keep"' + (b.keep ? ' checked' : '') + '><span><b>' + escH(T('Keep my sign-in for these sites')) + '</b><span>'
    + escH(T('So it can read them while your devices are off. Read-only: it never submits, buys or sends. Never banks or payments. Each expires 30 days after you last signed in.')) + '</span></span></label>'
    + '<label class="ob-sub" for="ag-sites">' + escH(T('Sites, one per line (at most 10)')) + '</label>'
    + '<textarea id="ag-sites" class="fp-in" rows="3" maxlength="1200" placeholder="' + escH(T('e.g. tracker.example.com')) + '">' + escH((b.sites || []).join('\n')) + '</textarea></fieldset>';
}
function mcAgentJob(id){
  const a = _mcAgentsD && (_mcAgentsD.agents || []).find(x => x.id === id); if(!a) return;
  const every = [['daily', T('Every day')], ['weekly', T('Every week')], ['hourly', T('Every hour')]];
  _mcAgentDialog(T('A job for {0}').replace('{0}', a.name),
    '<label class="ob-sub" for="ag-job">' + escH(T('What should it do?')) + '</label><textarea id="ag-job" class="fp-in" rows="4" maxlength="2000"></textarea>'
    + '<label class="ob-sub" for="ag-every">' + escH(T('How often')) + '</label><select id="ag-every" class="fp-in">' + every.map(e => '<option value="' + e[0] + '">' + escH(e[1]) + '</option>').join('') + '</select>'
    + '<fieldset class="cr-mode"><legend>' + escH(T('When it has a result')) + '</legend>'
    + '<label class="cr-mode-opt"><input type="radio" name="ag-appr" value="require" checked><span><b>' + escH(T('Ask first')) + '</b><span>' + escH(T('Each result waits for your approval.')) + '</span></span></label>'
    + '<label class="cr-mode-opt"><input type="radio" name="ag-appr" value="auto"><span><b>' + escH(T('Autonomous')) + '</b><span>' + escH(T('Results are delivered for you.')) + '</span></span></label></fieldset>',
    async () => {
      const detail = $('ag-job').value.trim();
      if(!detail) throw new Error(T('Say what the job is.'));
      await _autoApi('/auto/create', { detail, repeat: $('ag-every').value, kind: 'task', notify: 'app', agent: a.id,
        approval: (document.querySelector('input[name="ag-appr"]:checked') || {}).value === 'auto' ? 'auto' : 'require' });
      toast(T('{0} has the job. It runs on AMV’s servers, whether or not this is open.').replace('{0}', a.name), 'success', 5000);
      await mcAgentsReload();
    });
}
async function mcAgentPause(arg){
  const [id, act] = String(arg || '').split('|');
  try{
    await _autoApi('/v1/agents/save', { id, paused: act === 'pause' });
    toast(act === 'pause' ? T('Paused. Its jobs will not run until you resume it.') : T('Resumed. Its jobs run at their next time.'), 'success', 4000);
  }catch(e){ toast(T('That did not work: {0}. Nothing changed.').replace('{0}', (e && e.message) || ''), 'error', 6000); }
  await mcAgentsReload();
}
async function mcAgentDelete(id){
  const a = _mcAgentsD && (_mcAgentsD.agents || []).find(x => x.id === id); if(!a) return;
  if(!(await showConfirmAsync(T('Delete {0}? Its jobs stop running. What it already did stays in your results.').replace('{0}', a.name)))) return;
  try{
    const d = await _autoApi('/v1/agents/delete', { id });
    toast(T('Deleted. {0} of its jobs stopped.').replace('{0}', String(d.stopped || 0))
      + (d.signIns === 'pending' ? ' ' + T('Its sign-ins can no longer be used; the stored copies are being deleted.') : ''), 'success', 5000);
  }catch(e){
    /* The agent WAS deleted; only its sign-ins are still on their way out.
       "Nothing changed" would be false. */
    if(e && e.code === 'signins_pending') toast(e.message, 'info', 8000);
    else toast(T('That did not work: {0}. Nothing changed.').replace('{0}', (e && e.message) || ''), 'error', 6000);
  }
  await mcAgentsReload();
}
/* "KEEP THIS AS AN AGENT?" on a job that works: the agent is made from the
   job (its name, the job as its role and instructions, a budget if wanted),
   and the job is handed to it - from its next run it works under the
   agent's instructions, budget and pause. */
function mcKeepAsAgent(jobId){
  /* The job's own words, carried on its button: the row was drawn from the
     server's list a moment ago, so this is what the server holds. */
  let detail = '';
  try{ const b = document.querySelector('[data-keep-job="' + CSS.escape(String(jobId)) + '"]'); detail = String((b && b.dataset.keepDetail) || '').trim(); }catch(e){}
  const guess = detail.split(/[.,;:\n]/)[0].split(/\s+/).slice(0, 4).join(' ');
  _mcAgentDialog(T('Keep this as an agent'),
    '<p class="ob-sub">' + escH(T('It gets a name, keeps doing this job, and you can give it more, pause it, or set it a monthly budget.')) + '</p>'
    + '<label class="ob-sub" for="ag-name">' + escH(T('Name')) + '</label><input id="ag-name" class="fp-in" maxlength="60" value="' + escH(guess) + '">'
    + '<label class="ob-sub" for="ag-budget">' + escH(T('Monthly budget in dollars (0 = no budget of its own)')) + '</label><input id="ag-budget" class="fp-in" type="number" inputmode="decimal" min="0" max="10000" step="1" value="0">',
    async () => {
      const made = await _autoApi('/v1/agents/save', { name: $('ag-name').value, role: detail.slice(0, 160), instructions: detail.slice(0, 4000), budgetUSD: +$('ag-budget').value || 0 });
      const id = made && made.agent && made.agent.id;
      if(!id) throw new Error(T('The agent could not be saved. Nothing changed - try again.'));
      await _autoApi('/auto/update', { action: 'agent', id: jobId, agent: id });
      toast(T('{0} has the job now. Find it under Crew.').replace('{0}', made.agent.name), 'success', 5000);
      await mcAgentsReload();
    });
}
/* A JOB'S OWN MONTHLY BUDGET (Oct 31 audit, item 68). The server enforces
   it before every run, like an agent's; this only asks for the number and
   says what was spent so far this month. */
function mcJobBudget(arg){
  const [jobId, cur] = String(arg || '').split('|');
  _mcAgentDialog(T('Monthly budget for this job'),
    '<p class="ob-sub">' + escH(T('This job stops for the month when it has spent this much. Your plan’s own limit always applies as well.')) + '</p>'
    + '<label class="ob-sub" for="ag-budget">' + escH(T('Monthly budget in dollars (0 = no budget of its own)')) + '</label><input id="ag-budget" class="fp-in" type="number" inputmode="decimal" min="0" max="10000" step="1" value="' + escH(String(+cur || 0)) + '">',
    async () => {
      const d = await _autoApi('/auto/update', { action: 'budget', id: jobId, budgetUSD: +$('ag-budget').value || 0 });
      toast(d.budgetUSD
        ? T('Budget set: ${0} a month. ${1} spent so far this month.').replace('{0}', d.budgetUSD.toFixed(2)).replace('{1}', (+d.spentUSD || 0).toFixed(2))
        : T('This job has no budget of its own now.'), 'success', 5000);
      if(typeof _autoRefresh === 'function') await _autoRefresh();
      renderCrewView();
    });
}
/* STEER THE NEXT RUN (Oct 31 audit, item 28): a note this job's next run
   reads and then never again - the job itself does not change. */
function mcJobSteer(arg){
  const jobId = String(arg || '');
  const job = (Array.isArray(_AUTOS) ? _AUTOS : []).find(x => x && x.id === jobId) || {};
  const pending = job.steer && +job.steer.at > +(job.lastSteerAt || 0) ? String(job.steer.text || '') : '';
  _mcAgentDialog(T('A note for the next run'),
    '<p class="ob-sub">' + escH(T('Its next run reads this, once. What the job does every time stays as it is.')) + '</p>'
    + '<label class="ob-sub" for="ag-steer">' + escH(T('Note (leave empty to remove it)')) + '</label><textarea id="ag-steer" class="fp-in" rows="3" maxlength="1000">' + escH(pending) + '</textarea>',
    async () => {
      const note = String(($('ag-steer') || {}).value || '').trim();
      await _autoApi('/auto/update', { action: 'steer', id: jobId, note });
      toast(note ? T('Saved. The next run will read it.') : T('Note removed.'), 'success', 4000);
      if(typeof _autoRefresh === 'function') await _autoRefresh();
      renderCrewView();
    });
}
try{ Object.assign(window, { mcJobBudget, mcJobSteer }); }catch(e){}
try{ Object.assign(window, { mcAgentsReload, mcAgentEdit, mcAgentJob, mcAgentPause, mcAgentDelete, mcKeepAsAgent, mcAgentForgetSite, mcAgentSignIn, _mcAgentName }); }catch(e){}

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
      <div class="mc-sched-goal">${escH((()=>{ try{ const j = _cwJobs().find(m => m && m.autoId === x.id); if(j && j.title) return j.title; }catch(e){} return String(x.detail||'Background job').slice(0,180); })())}</div>
      <div class="mc-sched-meta">${x.agent && _mcAgentName(x.agent) ? escH(T('Agent: {0}').replace('{0}', _mcAgentName(x.agent))) + ' · ' : ''}${escH(when)} · Runs on AMV's servers, whether or not this is open</div>
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
        /* ITS OWN BUDGET, WHERE IT STANDS (USAGE-004): spent and left this
           month, from the counter the run is held to; when it is used up the
           row says that is why the job is waiting. */
        const money = (+x.budgetUSD > 0 && x.spentUSD != null)
          ? `<span class="mc-sched-money${x.leftUSD <= 0 ? ' over' : ''}">${escH(x.leftUSD <= 0
              ? T('Budget of {0} used up this month - it waits for next month').replace('{0}', '$' + (+x.budgetUSD).toFixed(2))
              : T('{0} of {1} spent this month · {2} left').replace('{0}', '$' + (+x.spentUSD).toFixed(2)).replace('{1}', '$' + (+x.budgetUSD).toFixed(2)).replace('{2}', '$' + (+x.leftUSD).toFixed(2)))}</span>` : '';
        return `<span class="mc-sched-mode ${eff==='auto'?'auto':''}">${escH(say)}</span>`
             + (eff!==own?`<span class="mc-sched-held">held back from “${escH(own)}” by your account setting</span>`:'')
             + quiet + same + money;
      })()}</div>
    </div>
    <div class="mc-sched-acts">
      ${x.done ? '' : `<button class="btn mc-mini ghost" data-dact="mcServerJob" data-darg="${escH(x.id)}|${paused?'resume':'pause'}">${paused?'Resume':'Pause'}</button>`}
      ${x.done || !(x.when && x.when.source === 'hook') ? '' : `<button class="btn mc-mini ghost" data-dact="mcHookAddress" data-darg="${escH(x.id)}|show">${escH(T('Copy address'))}</button><button class="btn mc-mini ghost" data-dact="mcHookAddress" data-darg="${escH(x.id)}|renew">${escH(T('New address'))}</button><button class="btn mc-mini ghost" data-dact="mcHookSigning" data-darg="${escH(x.id)}|${escH((x.hook && x.hook.signed) || '')}">${escH(x.hook && x.hook.signed ? T('Signed') + ' · ' + T(_HOOK_SIGNERS[x.hook.signed]) : T('Require signing'))}</button>`}
      ${x.done || x.agent || x.step || paused || !(x.runs > 0) ? '' : `<button class="btn mc-mini ghost" data-dact="mcKeepAsAgent" data-darg="${escH(x.id)}" data-keep-job="${escH(x.id)}" data-keep-detail="${escH(String(x.detail||'').slice(0, 400))}">${escH(T('Keep as an agent'))}</button>`}
      ${x.done ? '' : `<button class="btn mc-mini ghost" data-dact="mcJobSteer" data-darg="${escH(x.id)}">${escH(x.steer && +x.steer.at > +(x.lastSteerAt || 0) ? T('Note for next run \u2713') : T('Note for next run'))}</button>`}
      ${x.done || x.agent ? '' : `<button class="btn mc-mini ghost" data-dact="mcJobBudget" data-darg="${escH(x.id)}|${escH(String(+x.budgetUSD > 0 ? +x.budgetUSD : 0))}">${escH(+x.budgetUSD > 0 ? T('Budget') + ' $' + (+x.budgetUSD).toFixed(2) : T('Monthly budget'))}</button>`}
      <button class="btn mc-mini ghost" data-dact="mcServerJob" data-darg="${escH(x.id)}|delete">Remove</button>
    </div>
  </div>`;
}
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
    /* What is KNOWN, and only that (Build 16 audit D16-03). Not connected:
       nothing was sent, so nothing changed - which says nothing about
       whether it was running. Refused by the server: unchanged. No answer,
       or the server failing: the change may or may not have landed, so the
       job is read back and shown as it really is. */
    const sure = e && e.message !== 'not-connected' && e.status >= 400 && e.status < 500;
    if(e && e.message === 'not-connected')
      toast('AMV is not connected to its engine, so nothing was changed.', 'error', 6500);
    else if(sure)
      toast('That did not work: ' + ((e && e.message) || 'the server refused it') + '. The job is unchanged.', 'error', 6500);
    else {
      toast('AMV could not confirm whether that took effect. Showing the job as it is now.', 'error', 6500);
      try{ if(typeof _autoRefresh === 'function') await _autoRefresh(); renderCrewView(); }catch(_){}
    }
  }
}
/* A JOB ANOTHER SERVICE STARTS: its address, asked for again or replaced.
   Fetched from the server each time rather than kept on the page - the
   address is the key to the job, and a copy left in the page's memory or
   storage is one more place it can be read from. */
async function mcHookAddress(arg){
  const [id, action] = String(arg || '').split('|');
  if(!id) return;
  if(action === 'renew'){
    const yes = await showConfirmAsync(T('Make a new address for this job? The old one stops working at once, so give the new one to the service that sends to it.'));
    if(!yes) return;
  }
  let d;
  try{ d = await _autoApi('/auto/hook', { id, action: action === 'renew' ? 'renew' : 'show' }); }
  catch(e){ toast(T('The address could not be fetched. Try again.') + ' ' + ((e && e.message) || ''), 'error', 6000); return; }
  try{ await _copyText(d.url); toast(action === 'renew' ? T('New address copied. The old one no longer works.') : T('Address copied. Give it to the service that should start this job.'), 'success', 6000); }
  catch(e){ try{ window.prompt(T('Copy this address:'), d.url); }catch(x){} }
}
/* WHO MAY START IT: the address alone, or only requests signed with a secret
   (70-hooks.js). A secret AMV makes is shown here once and never again; one
   pasted from Stripe or Slack is sent once and never shown back. */
const _HOOK_SIGNERS = { amv:'AMV standard', github:'GitHub', stripe:'Stripe', slack:'Slack' };
function mcHookSigning(arg){
  const [id, now] = String(arg || '').split('|');
  const r = $('ovr'); if(!id || !r) return;
  const pick = (k) => {
    const paste = k === 'stripe' || k === 'slack' || k === 'github';
    $('hs-form').innerHTML = (paste ? '<label class="ob-sub" for="hs-secret">' + escH(k === 'github' ? T('Secret (leave empty and AMV makes one)')
        : k === 'stripe' ? T('Signing secret from Stripe (whsec_...)') : T('Signing Secret from your Slack app')) + '</label>'
        + '<input id="hs-secret" type="password" autocomplete="new-password" spellcheck="false" class="fp-in">' : '')
      + '<div class="sec-row"><button class="btn bp" id="hs-save">' + escH(T('Require signing')) + '</button></div>';
    on($('hs-save'), 'click', () => save(k));
  };
  const save = async (k) => {
    const sec = ($('hs-secret') || {}).value || '';
    let d;
    try{ d = await _autoApi('/auto/hook', k ? { id, action:'sign', kind:k, secret:sec } : { id, action:'unsign' }); }
    catch(e){ $('hs-msg').textContent = (e && e.message && e.message !== 'not-connected') ? e.message : T('That did not work. Nothing changed.'); return; }
    mcReloadJobs();
    /* Slack needs one more thing done on Slack's side, so the dialog says what
       rather than closing: the address goes in the app's Event Subscriptions,
       where Slack checks it at once (70-hooks.js answers that check). */
    if(k === 'slack' && d.url){
      $('hs-form').innerHTML = '<p class="ob-sub">' + escH(T('In your Slack app, open Event Subscriptions, turn it on and paste this address as the Request URL - Slack checks it straight away. Then subscribe to the message.channels bot event and reinstall the app. Messages people post in the channels the app is in will start this job; messages from bots never do.')) + '</p>'
        + '<div class="sec-row"><button class="btn bp" id="hs-addr">' + escH(T('Copy address')) + '</button></div>';
      on($('hs-addr'), 'click', () => { _copyText(d.url).then(() => toast(T('Copied'), 'success', 2500), () => {}); });
      return;
    }
    if(!d.secret){ closeOvr(); toast(k ? T('Signing is on. Unsigned requests are refused.') : T('Signing is off. The address alone starts this job.'), 'success', 6000); return; }
    $('hs-form').innerHTML = '<div class="sec-secret"><p class="ob-sub">' + escH(k === 'github' ? T('Paste this as the webhook’s Secret in GitHub. It is shown once.')
        : T('Sign each request with this secret, using the Standard Webhooks headers: webhook-id, webhook-timestamp, webhook-signature. It is shown once.'))
      + '</p><code>' + escH(d.secret) + '</code></div><div class="sec-row"><button class="btn bp" id="hs-copy">' + escH(T('Copy')) + '</button></div>';
    on($('hs-copy'), 'click', () => { _copyText(d.secret).then(() => toast(T('Copied'), 'success', 2500), () => {}); });
  };
  r.innerHTML = '<div class="ov" id="hs-bg"><div class="ob" role="dialog" aria-labelledby="hs-t" style="max-width:520px">'
    + '<button class="oc" id="hs-x" aria-label="' + escH(T('Close')) + '">×</button>'
    + '<h2 id="hs-t">' + escH(T('Who may start this job?')) + '</h2>'
    + '<p class="ob-sub">' + escH(T('Anyone with the address can start it. With signing on, only requests signed with a secret are accepted, so a leaked address is not enough.')) + '</p>'
    + '<p class="ob-sub"><b>' + escH(now ? T('Now: signed by') + ' ' + T(_HOOK_SIGNERS[now]) : T('Now: the address alone')) + '</b></p>'
    + '<div class="sec-row">' + Object.keys(_HOOK_SIGNERS).map(k => '<button class="btn bs" data-hs="' + k + '">' + escH(T(_HOOK_SIGNERS[k])) + '</button>').join('')
    + (now ? '<button class="btn bs" data-hs="">' + escH(T('Turn off')) + '</button>' : '') + '</div>'
    + '<div id="hs-form"></div><p class="ob-sub" id="hs-msg" role="alert"></p></div></div>';
  r.classList.add('on');
  r.querySelectorAll('[data-hs]').forEach(b => on(b, 'click', () => b.dataset.hs ? pick(b.dataset.hs) : save('')));
  on($('hs-x'), 'click', closeOvr);
  onBackdrop($('hs-bg'), closeOvr);
}
async function mcReloadJobs(){
  try{ if(typeof _autoRefresh === 'function') await _autoRefresh(); }catch(e){}
  renderCrewView();
}
try{ window.mcServerJob = mcServerJob; window.mcReloadJobs = mcReloadJobs; window.mcHookAddress = mcHookAddress; window.mcHookSigning = mcHookSigning; }catch(e){}

/* A standing job shown as a row in the unified Scheduled section. */
function _mcAutonSchedRow(j){
  return `<div class="mc-sched-row">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(j.title)}</div>
      <div class="mc-sched-meta">${escH(j.desc||T('Runs in the background'))} · ${escH(_cwUsesLine(j, j.needs||''))}</div>
      <div class="mc-sched-mode-row"><span class="mc-sched-mode">${escH(T('Runs while AMV is open'))}</span></div>
    </div>
    <div class="mc-sched-acts"><button class="btn mc-mini ghost" data-dact="cwToggle" data-darg="${escH(j.id)}">${escH(T('Turn off'))}</button></div>
  </div>`;
}
/* A rotation rewraps the example. One listener for the page, finding the box
   each time, because the view is redrawn and a listener per draw would pile up. */
function _mcDoneCard(t){
  const snip=t.result?String(t.result).replace(/\s+/g,' ').trim():'';
  return `<div class="mc-card done"><div class="mc-card-top"><span class="mc-card-t">${escH(t.title||'Task')}</span><span class="mc-pill ok">Done</span></div>${snip?`<div class="mc-card-sub">${escH(snip.slice(0,140))}${snip.length>140?'…':''}</div>`:''}</div>`;
}
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
function _mcQuietLabel(h){ return String(h).padStart(2,'0') + ':00'; }
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

/* ══════════════════════════════════════════════════════════════════════════
   CREW'S JOBS, ONE LIST (Nov 15).

   The owner: "it should be tell AMV what to do and then a text box and run,
   simple"; "remove made for <country>"; "the text boxes plus 'runs with AMV
   closed', 'needs a mailbox', 'in the United States Gmail etc it sends you
   blah' all looks horrible and unprofessional - make every block clean";
   "Crew lags".

   The page had grown seven lists - a top five, a made-for row, a hundred
   examples by category, a most-started list, the country catalogue under
   them, a country page and a page of countries - each with its own heading
   and its own sentence. It is one list now: every job for the chosen country
   (the jobs that work everywhere, the country's own, and the catalogue built
   from its real services), one search, one row of categories, and cards that
   say what the job is and when it runs, nothing else. What a job needs is in
   its panel, where somebody is deciding.

   And it does not lag: the list is cut and drawn into one element - a search
   or a category never redraws the page - and only the first rows are drawn,
   more as somebody asks for them.
   ══════════════════════════════════════════════════════════════════════════ */
let _cjQ = '', _cjC = 'all', _cjN = 24;
let _cjCache = null, _cjCacheKey = '';
/* Every job for the country being shown, best first: anything switched on,
   then the country's own (written for it), then the jobs that work on a
   connected account anywhere, strongest first, then the catalogue of the
   country's real services in the order the data ranks them. */
/* INBOX & CALENDAR, FOR THE COUNTRY (Nov 17, the owner: "inbox and calendar
   is not updated for countries"). It held the same eleven jobs everywhere,
   because no kind in a country's catalogue is a mailbox or a date. Two are
   real and known per country: the national mailboxes Integrations already
   connects (AMV_MAIL_CC - Naver Mail in Korea, WEB.DE in Germany), ordered by
   how much their sites are visited from there (app-reach, Chrome UX Report);
   and the country's public holidays. */
const _CJ_MAIL_JOBS = [
  ['digest', '\uD83D\uDCEC', '{0} inbox digest', 'Each evening, the emails in my {0} inbox that actually need me - summarized, with what to do about each.', 'daily', 18],
  ['alerts', '\uD83D\uDEA8', 'Important {0} email alerts', 'Tell me the moment something in my {0} inbox genuinely needs me - not a digest, an alert.', 'hourly'],
];
const _cjInboxCalMade = {}, _cjInboxCalById = {};
try{ window._cjInboxCalById = _cjInboxCalById; }catch(e){}
function _cjInboxCal(cc){
  if(!cc) return [];
  const mk = cc + '|' + (typeof _lang === 'function' ? _lang() : '') + '|' + (typeof window._appReachKey === 'function' && window._appReachKey({ name: 'Gmail' }, cc) != null ? 1 : 0);
  if(_cjInboxCalMade[mk]) return _cjInboxCalMade[mk];
  const out = [];
  try{
    const mail = [];
    _appCats().forEach(c => (c.apps || []).forEach(a => { const m = /^mail:(.+)$/.exec(a.how || ''); if(m && AMV_MAIL_CC[m[1]] === cc) mail.push({ a, id: m[1], k: (typeof window._appReachKey === 'function' ? window._appReachKey(a, cc) : null) }); }));
    mail.sort((x, y) => (x.k == null ? 99 : x.k) - (y.k == null ? 99 : y.k));
    mail.forEach(({ a, id }) => _CJ_MAIL_JOBS.forEach(([k, icon, title, desc, every, hour]) => {
      const name = String(a.name).replace(/\s*\(.*\)\s*$/, '');
      out.push({ id: 'cal_' + cc + '_' + id + '_' + k, cat: 'Inbox & calendar', icon, title: T(title).replace('{0}', name), desc: T(desc).replace('{0}', name), prompt: T(desc).replace('{0}', name), every, ...(hour != null ? { hour } : {}), needs: 'Email', on: false, ccMail: id });
    }));
  }catch(e){}
  const place = (() => { try{ const row = CW_WORLD_COUNTRIES.find(c => c[0] === cc); return row ? _cwPlaceName(row[1]) : cc; }catch(e){ return cc; } })();
  out.push({ id: 'cal_' + cc + '_holidays', cat: 'Inbox & calendar', icon: '\uD83D\uDDD3\uFE0F', title: T('Public holidays in {0}').replace('{0}', place),
    desc: T('Before each public holiday in {0}, tell me the date and what is closed, and put it on my calendar.').replace('{0}', place),
    prompt: T('Before each public holiday in {0}, tell me the date and what is closed, and put it on my calendar.').replace('{0}', place), every: 'weekly', needs: 'Calendar, Web research', on: false });
  out.forEach(j => { _cjInboxCalById[j.id] = j; });
  return (_cjInboxCalMade[mk] = out);
}
function _cjList(noOnFirst){
  if(noOnFirst) return _cjRanked();
  const cc = _cwCountryGuess();
  const cat = ((window._ccCrewJobs || {})[cc] || []);
  const len = (f) => { try{ return (f(cc) || []).length; }catch(e){ return 0; } };
  const rk = (() => { try{ const m = _cwMeta[cc]; return (m && m.ranked && m.ranked.enough) ? m.ranked : null; }catch(e){ return null; } })();
  const key = [cc, cat.length, rk ? rk.total : 0, len(_cwTopTen), len(_cwMadeForJobs), len(_cwLocalJobs), len(_cwMadeMore),
               (_cwJobs() || []).filter(j => j.on).map(j => j.id).join(',')].join('|');
  const ckey = key + (_cjRankOnly ? '|rank' : '');
  if(!_cjRankOnly && _cjCache && _cjCacheKey === ckey) return _cjCache;
  if(_cjRankOnly && _cjRankCache && _cjRankKey === ckey) return _cjRankCache;
  const seen = new Set(), out = [];
  const push = (j) => { if(j && j.id && !seen.has(j.id)){ seen.add(j.id); out.push(j); } };
  const safe = (f) => { try{ return f() || []; }catch(e){ return []; } };
  const home = safe(() => (_cwJobs() || []).concat(_cwUniversalJobs() || []));
  if(!_cjRankOnly) home.filter(j => j.on).forEach(push);
  safe(() => _cwTopTen(cc)).forEach(push);
  safe(() => _cwMadeForJobs(cc)).forEach(push);
  safe(() => _cwLocalJobs(cc)).forEach(push);
  /* The country's catalogue jobs people there have actually switched on, the
     most started first - counted by the server per country (meta.ranked),
     the same counts that order the top ten. Ahead of everything only
     researched, because a count is what people chose. */
  if(rk) cat.map(j => [j, +rk.counts[j.id] || 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).forEach(x => push(x[0]));
  /* The country's own, most used there first (_cwPopScore - counted where
     there are counts, researched where there are not). */
  safe(() => _cwMadeMore(cc)).map((j, i) => [j, (() => { try{ return _cwPopScore(j, cc); }catch(e){ return 0; } })(), i])
    .sort((a, b) => (b[1] - a[1]) || (a[2] - b[2])).forEach(x => push(x[0]));
  /* After everything written for the country: they have a chip of their own,
     and leading with them pushed the country's own jobs down the list. A
     country whose own jobs already watch its holidays keeps that one. */
  const ownHol = out.some(j => /^cc_[a-z]{2}_holidays$/.test(j.id || ''));
  safe(() => _cjInboxCal(cc)).filter(j => !(ownHol && /_holidays$/.test(j.id))).forEach(push);
  home.map((j, i) => [j, _cwStrength(j), i]).sort((a, b) => (b[1] - a[1]) || (a[2] - b[2])).forEach(x => push(x[0]));
  /* The everyday fifty (Nov 23) are Popular's own list; here they are in All
     so a search finds them, after the country's own work - which leads All
     on purpose (the-top-ten-is-what-people-there-use). */
  safe(() => _cwPopularJobs(cc)).forEach(push);
  cat.forEach(push);
  if(_cjRankOnly){ _cjRankCache = out; _cjRankKey = ckey; } else { _cjCache = out; _cjCacheKey = ckey; }
  return out;
}
/* POPULAR: THE COUNTRY'S FIFTY, BY THE SAME MEASURE THE LIST IS IN (Nov 17).
   What people there switch on (server counts), then the research the list is
   ordered by (GWI reasons, the country's own figures - docs/RESEARCH.md) - the
   same ranking as All, without the jobs somebody has on lifted to the top,
   because that is their list, not what is popular. */
let _cjRankOnly = false, _cjRankCache = null, _cjRankKey = '';
function _cjRanked(){ _cjRankOnly = true; try{ return _cjList(); } finally { _cjRankOnly = false; } }
const CJ_POPULAR_N = 50;
/* Popular IS the everyday fifty (Nov 23, the owner: "things people can do
   every day ... others are lame"). Where the catalogue has fewer, the ranked
   list fills the rest - recurring jobs only, never a one-off explainer. */
const CJ_ONE_OFF = /rights|rules|explained|new laws|elections|moving to|first employee|parental leave|check-ups|entitled|hiring your first|visa|entry rules|tenant|rent\b|parking/i;
function _cjPopular(){
  const out = [], seen = new Set();
  const add = (j) => { if(j && j.id && !seen.has(j.id) && out.length < CJ_POPULAR_N){ seen.add(j.id); out.push(j); } };
  try{ (_cwPopularJobs(_cwCountryGuess()) || []).forEach(add); }catch(e){}
  _cjRanked().filter(j => j && ['hourly', 'daily', 'weekly'].indexOf(String(j.every || 'daily')) >= 0 && !CJ_ONE_OFF.test(String(j.title || ''))).forEach(add);
  return out;
}
function _cjMatch(j, words){
  if(!words.length) return true;
  const hay = (j._cjHay || (j._cjHay = [j.title, j.desc, j.cat, _cjCat(j), j.needs, j.site].filter(Boolean).join(' ').toLowerCase()));
  return words.every(w => hay.indexOf(w) >= 0);
}
function _cjFiltered(){
  const words = _cjQ.toLowerCase().split(/\s+/).filter(Boolean);
  /* A search from Popular searches every job, so typing never hides a job
     because of which chip happened to be on. */
  if(_cjC === 'popular' && !words.length) return _cjPopular();
  return _cjList().filter(j => (_cjC === 'all' || _cjC === 'popular' || _cjCat(j) === _cjC) && _cjMatch(j, words));
}
/* A card: icon, title, one line of what it does, when it runs. */
/* How often, and the time only once one is set: a job that is not on yet has
   no time but the one its panel would suggest. */
function _cjEvery(j){
  try{ const sc = _cwJobWhen(j); return (j.on || _cwPickedWhen[j.id]) ? _cjWhenLabel(sc) : _cjWhenLabel({ cad: sc.cad, days: sc.days && sc.days.length === 5 ? sc.days : null }); }catch(e){ return ''; }
}
/* A job's words in the screen's language as they are drawn, not English
   swapped out a moment later by the page's translator - which a slower
   browser (WebKit, nightly) showed long enough to see. A catalogue job's
   words are names from the country's own data and are left as they are. */
function _cjSay(j, s){ return (j && j.ccKind) ? s : T(s); }
function _cjCard(j){
  const allowed = _planAllowsCrew();
  const when = _cjEvery(j);
  /* On, but missing the account it reads, is not running - and a card that
     said "On" would be claiming work that is not happening. Its panel names
     what to connect. */
  const wait = j.on && (() => { try{ return _cwNeedsMissing(j).length > 0; }catch(e){ return false; } })();
  return `<div class="cj-card${j.on ? ' on' : ''}${wait ? ' blocked' : ''}">
    <button class="cj-card-b" data-dact="cwPeek" data-darg="${escH(j.id)}">
      <span class="cj-card-ic" aria-hidden="true">${_lineIcon(j.cat)}</span>
      <span class="cj-card-t"${j.ccKind ? ' data-no-i18n' : ''}>${escH(_cjSay(j, j.title))}</span>
      <span class="cj-card-d"${j.ccKind ? ' data-no-i18n' : ''}>${escH(_cjSay(j, j.desc || ''))}</span>
      <span class="cj-card-w">${wait ? `<span class="cj-wait">${escH(T('Waiting to be connected'))}</span>` : j.on ? `<span class="cj-on">${escH(T('On'))}</span>` : ''}${escH(when)}</span>
    </button>
    ${allowed ? `<button class="cw-toggle cj-tg ${j.on ? 'on' : ''}" data-dact="cwToggle" data-darg="${escH(j.id)}" aria-label="${escH((j.on ? T('Turn off') : T('Turn on')) + ': ' + _cjSay(j, j.title))}"><span class="cw-knob"></span></button>` : ''}
  </div>`;
}
function _cjGridHTML(){
  const list = _cjFiltered();
  if(!list.length){
    return `<div class="cj-empty">${escH(T('No job here matches that.'))} <button class="cj-link" data-dact="cjAsk">${escH(T('Type it in the box above instead'))}</button></div>`;
  }
  const shown = list.slice(0, _cjN);
  /* Popular says what it is ranked by (Build 16 audit D16-07). */
  /* Popular says what it is ranked by (Build 16 audit D16-07). Since Nov 23
     it is the researched everyday fifty (crew-data.js popular), so that is
     what it says; a search from it is a search of every job. */
  const note = (_cjC === 'popular' && !_cjQ) ? T('Everyday jobs, in order of how many people use each kind of service (GWI, Pew Research Center and the Reuters Institute, 2023-2025).') : '';
  return (note ? `<p class="cc-measure">${escH(note)}</p>` : '') + `<div class="cj-grid">${shown.map(_cjCard).join('')}</div>`
    + (list.length > shown.length ? `<div class="cj-more-w"><button class="btn bs cj-more" data-dact="cjMore">${escH(T('Show more'))} <span class="cj-n">${(list.length - shown.length).toLocaleString()}</span></button></div>` : '');
}
/* THE CHIPS WAIT FOR THE COUNTRY'S LIST (Nov 22). Before a country's
   catalogue arrives the list is a small built-in one, so the chips read "All
   126, Money 20" and a moment later "All 23,052, Money 745", with five more
   chips pushing in - the owner's "it shows something then instantly
   changes". Until the country's own list has been tried, the row holds its
   place with quiet blanks of the same height; the jobs below do not change. */
const _cjTried = {}, _cjAsked = {};
/* Whoever draws the blanks asks for the list too, and draws again when it
   is in: the country can become known after Crew opened (the server's
   answer to "where is this?"), and a redraw for a new country is not the
   first render that used to ask. */
function _cjEnsure(cc){
  if(_cjAsked[cc]) return; _cjAsked[cc] = true;
  const fin = () => { _cjTried[cc] = true; try{ if(_cwCountryGuess() === cc && document.getElementById('cj-grid')) _cjRepaint(); }catch(e){} };
  try{ _ccReady().then(ok => ok ? ccCrewLoad(cc) : null).then(fin, fin); }catch(e){ fin(); }
}
function _cjChipsHTML(){
  try{
    const cc = _cwCountryGuess();
    if(cc && !(window._ccCrewJobs || {})[cc] && !_cjTried[cc]){
      _cjEnsure(cc);
      return '<span class="cj-chip-wait" aria-hidden="true"></span>'.repeat(7);
    }
  }catch(e){}
  const all = _cjList();
  const n = {}; all.forEach(j => { const c = _cjCat(j); n[c] = (n[c] || 0) + 1; });
  /* No counts on the chips: "All 23,102" told nobody anything they could
     act on, and the owner asked for no big totals. */
  const chip = (k, label) => `<button class="cj-chip${_cjC === k ? ' on' : ''}" data-dact="cjCat" data-darg="${escH(k)}" aria-pressed="${_cjC === k}">${escH(label)}</button>`;
  return chip('all', T('All')) + chip('popular', T('Popular'))
    + _cjCatsByFirst(all, _cjCat).filter(c => n[c]).map(c => chip(c, T(c))).join('');
}
/* The categories in the order their first job appears in the list - the list
   is most used first, so the categories are too. */
function _cjCatsByFirst(list, catOf){
  const at = {}; list.forEach((j, i) => { const c = catOf(j); if(!(c in at)) at[c] = i; });
  return CJ_CATS.slice().sort((a, b) => ((a in at ? at[a] : 1e9) - (b in at ? at[b] : 1e9)) || (CJ_CATS.indexOf(a) - CJ_CATS.indexOf(b)));
}
try{ window._cjCatsByFirst = _cjCatsByFirst; }catch(e){}
/* Only the grid, the chips and the count change - the page stays put. */
function _cjPaint(){
  const g = document.getElementById('cj-grid'); if(g) g.innerHTML = _cjGridHTML();
  const c = document.getElementById('cj-cats'); if(c) c.innerHTML = _cjChipsHTML();

}
/* What changes when the server answers, a country's own jobs arrive or the
   country becomes known: the heading, the country button and the jobs - drawn
   in place, so the page never rebuilds under somebody reading it. */
function _cjRepaint(){
  _cjCache = null; _cjRankCache = null;
  try{ const h = document.getElementById('cx-jobs-h'); if(h) h.textContent = _cwJobsForHead(); }catch(e){}
  try{ const b = document.getElementById('cw-where'); if(b && b.classList.contains('cj-country')) b.outerHTML = _cjCountryBtnHTML(); }catch(e){}
  try{ const n = document.getElementById('cj-note'); if(n){ const t = _cjNoteText(); n.textContent = t; n.hidden = !t; } }catch(e){}
  _cjPaint();
}
try{ window._cjRepaint = _cjRepaint; }catch(e){}
function cjCat(c){ _cjC = c || 'all'; _cjN = 24; _cjPaint(); }
function cjMore(){ _cjN += 48; _cjPaint(); }
function cjAsk(){
  const el = document.getElementById('mc-cmd-input'); if(!el) return;
  if(_cjQ && !el.value) el.value = _cjQ;
  try{ el.scrollIntoView({ block:'center', behavior:'smooth' }); }catch(e){}
  el.focus();
}
/* The country: the shared picker (country-catalog.js), with Use my location. */
/* The old country pages were the fallback when the catalogue could not
   load; they are gone (Nov 16), and a press that cannot open the picker says
   why instead of doing nothing. */
function cjCountry(){
  const fail = () => { try{ toast(T('The country list could not be loaded. Check your connection and try again.'), 'error', 5000); }catch(e){} };
  _ccReady().then(ok => { if(ok && window.ccPickCountry) window.ccPickCountry(() => { _cjQ = ''; _cjC = 'all'; _cjN = 24; renderCrewView(); }); else fail(); }).catch(fail);
}
try{ window.cjCat = cjCat; window.cjMore = cjMore; window.cjAsk = cjAsk; window.cjCountry = cjCountry; }catch(e){}
function _cjCountryBtnHTML(){
  const row = _cwCountryRow(_cwCountryGuess());
  return `<button class="cj-country" id="cw-where" data-dact="cjCountry" aria-label="${escH(T('Change country'))}">${row ? `<span aria-hidden="true">${row[2]}</span> ${escH(T(row[1]))}` : escH(T('Choose your country'))}
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`;
}
/* Said when it is true: the country's own jobs live on AMV's servers, and a
   list that silently lacks them reads exactly like a country with none. */
function _cjNoteText(){
  try{
    const cc = _cwCountryGuess(), row = _cwCountryRow(cc);
    if(!row || _cwLocalState[cc] !== 'offline' || !(window.AMV_API && AMV_API.live)) return '';
    return _cwSayPlace('The jobs written for {country} are on AMV’s servers, which cannot be reached right now - everything else is below.', row[1]);
  }catch(e){ return ''; }
}
/* The jobs section, the same on both screens. */
function _cjJobsHTML(){
  const note = _cjNoteText();
  return `<section class="cj-jobs" id="cj-jobs" aria-labelledby="cx-jobs-h">
    <div class="cj-jobs-top">
      <h2 id="cx-jobs-h">${escH(_cwJobsForHead())}</h2>

      <div class="cj-tools">${_cjCountryBtnHTML()}<button class="cj-all" data-dact="cjDirectory">${escH(T('Browse more examples'))}</button></div>
    </div>
    <p class="cj-examples">${escH(T('Examples to start from - not every job AMV can do. Type anything in the box above and press Run.'))}</p>
    <div class="cj-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="cx-q" type="search" autocomplete="off" value="${escH(_cjQ)}" placeholder="${escH(T('Search jobs'))}" aria-label="${escH(T('Search jobs'))}"></div>
    <p class="cj-note" id="cj-note" role="status"${note ? '' : ' hidden'}>${escH(note)}</p>
    <div class="cj-cats" id="cj-cats" data-hscroll role="group" aria-label="${escH(T('Categories'))}">${_cjChipsHTML()}</div>
    <div id="cj-grid">${_cjGridHTML()}</div>
  </section>`;
}
/* The box at the top, the same on both screens: a heading, the field, Run. */
/* THE BOX (Nov 16, the owner: "too narrow and chunky - it needs to look
   futuristic, easy to use, and promise results"). One wide, slim command bar
   under a heading and one line that says what you get; Run carries an arrow,
   and on a phone it is the arrow alone so the field keeps its width. The line
   promises only what is true of every job: it runs on the schedule you give
   and the result comes back to you. */
/* A phone gets the short example, so the box stays one slim line. */
function _cjNarrow(){ try{ return window.matchMedia('(max-width:560px)').matches; }catch(e){ return false; } }
/* RUNNING NOW, RIGHT UNDER THE BOX (Nov 17, the owner: "Crew has to have a
   running jobs section below the textbox to see if anything is running and
   it actually works").

   Read from what is real, never drawn from a wish: work running in this tab
   (the background queue, with its progress); jobs AMV's servers have due -
   the scheduler runs every minute, so a due job is starting, and says so; the
   last results the server wrote in the past day, with what happened (done,
   sent to your email, waiting for your approval, failed, needs a
   connection); and what is switched on, with when the next one runs. It
   refreshes itself while something is due or running, so a job pressed Run
   on is seen starting and then finishing. The detail - approving, pausing,
   the whole list - stays in the sections below. */
function _crewAgo(ts, future){
  try{
    const l = (typeof _lang === 'function' && _lang() !== 'auto') ? _lang() : undefined;
    const f = new Intl.RelativeTimeFormat(l, { numeric: 'auto' });
    const m = Math.round((Number(ts) - Date.now()) / 60000);
    if(Math.abs(m) < 1) return future ? T('now') : T('just now');
    if(Math.abs(m) < 60) return f.format(m, 'minute');
    if(Math.abs(m) < 1440) return f.format(Math.round(m / 60), 'hour');
    return f.format(Math.round(m / 1440), 'day');
  }catch(e){ return ''; }
}
function _crewNowHTML(){
  const st = _mcState(), now = Date.now();
  const res = (typeof _AUTO_RESULTS !== 'undefined' && Array.isArray(_AUTO_RESULTS)) ? _AUTO_RESULTS : [];
  const live = (x) => x.active !== false && !x.done;
  const goal = (x) => String((x && (x.detail || x.title)) || T('Background job')).slice(0, 140);
  const rows = [];
  st.active.forEach(t => rows.push({ k: t.status === 'running' ? 'run' : 'wait', t: t.title || t.type || T('Task'),
    s: t.status === 'running' ? T('Running') : T('Queued'), p: t.status === 'running' ? (+t.progress || 0) : null }));
  st.server.filter(x => live(x) && !x.waiting && x.next && x.next <= now + 60e3)
    .forEach(x => rows.push({ k: 'run', t: goal(x), s: T('Starting - AMV’s servers pick it up within a minute'), p: 0 }));
  const OUT = { emailed: ['done', 'Done · sent to your email'], 'in-app': ['done', 'Done'], waiting: ['wait', 'Ready for your approval'],
    failed: ['fail', 'Failed'], needs_access: ['fail', 'Needs a connection'], suggested: ['done', 'Suggestion ready'] };
  res.filter(r => r && +r.at > now - 864e5).sort((a, b) => b.at - a.at).slice(0, 3).forEach(r => {
    const o = OUT[r.outcome] || (r.kind === 'failed' ? OUT.failed : OUT['in-app']);
    rows.push({ k: o[0], t: r.detail || goal(st.server.find(x => x.id === r.autoId)), s: T(o[1]) + ' · ' + _crewAgo(r.at) });
  });
  /* EVERY JOB THAT IS SWITCHED ON, WITH WHEN IT RUNS (Nov 22). The owner:
     "they see it at their Crew as running - every day, or every morning at
     7". This panel listed only what was executing this minute, so a job
     switched on a moment ago read "Nothing is running right now" with the
     job behind a See all. Each scheduled job is now a row of its own: the
     Crew job's own title where it came from one, how often and at what time,
     and when it next runs. What is executing or just finished stays above. */
  const shownIds = new Set(st.server.filter(x => live(x) && !x.waiting && x.next && x.next <= now + 60e3).map(x => x.id));
  const mine = (() => { try{ return _cwJobs(); }catch(e){ return []; } })();
  const schedOf = (x) => {
    const j = mine.find(m => m && m.autoId === x.id);
    let sc = null; try{ sc = j ? _cwJobWhen(j) : null; }catch(e){}
    if(!sc && x.sched && typeof x.sched === 'object') sc = x.sched;
    if(!sc && x.repeat) sc = { cad: x.repeat };
    return { title: (j && j.title) || goal(x), when: sc ? _cjWhenLabel(sc) : '' };
  };
  st.server.filter(x => live(x) && !shownIds.has(x.id)).sort((a, b) => (a.next || 9e15) - (b.next || 9e15)).slice(0, 8).forEach(x => {
    const w = schedOf(x);
    const nx = x.next && x.next > now ? T('next {0}').replace('{0}', _crewAgo(x.next, true)) : '';
    rows.push({ k: x.waiting ? 'wait' : 'on', t: w.title, s: [w.when, x.waiting ? T('Ready for your approval') : nx].filter(Boolean).join(' \u00b7 ') });
  });
  const on = st.server.filter(live).length + st.auton.length;
  const nextJob = st.server.filter(x => live(x) && !x.waiting && x.next > now + 60e3).sort((a, b) => a.next - b.next)[0];
  const serverOk = !!(window.AMV_API && AMV_API.live);
  const note = !serverOk ? ''
    : st.serverError ? T('AMV’s servers could not be reached just now. Your jobs have not stopped.')
    : !st.serverLoaded ? T('Checking AMV’s servers…') : '';
  const busy = rows.some(r => r.k === 'run');
  const row = (r) => `<li class="crew-now-row ${r.k}">
      <span class="crew-now-dot" aria-hidden="true"></span>
      <span class="crew-now-b"><span class="crew-now-t">${escH(String(r.t))}</span><span class="crew-now-s">${escH(r.s)}</span>
        ${r.p != null ? `<span class="crew-now-bar${r.p ? '' : ' indet'}" aria-hidden="true"><span style="width:${Math.max(6, Math.min(100, r.p || 30))}%"></span></span>` : ''}</span></li>`;
  return `<div class="crew-now-head">
      <h2 id="crew-now-h">${busy ? '<span class="crew-now-live" aria-hidden="true"></span>' : ''}${escH(T('Running now'))}</h2>
      ${on ? `<span class="crew-now-sum">${escH(T('{0} switched on').replace('{0}', on.toLocaleString()))}${nextJob ? ' \u00b7 ' + escH(T('next {0}').replace('{0}', _crewAgo(nextJob.next, true))) : ''}</span>` : ''}
      ${document.getElementById('mc-sched') || on ? `<button class="cj-link crew-now-all" type="button" data-dact="crewNowAll">${escH(T('See all'))}</button>` : ''}
    </div>
    ${rows.length ? `<ul class="crew-now-list">${rows.map(row).join('')}</ul>`
      : `<p class="crew-now-empty">${escH(T('Nothing is running right now.'))} ${escH(on ? (nextJob ? T('The next job runs {0}.').replace('{0}', _crewAgo(nextJob.next, true)) : '') : T('Turn on a job below, or tell AMV what to do above.'))}</p>`}
    ${note ? `<p class="crew-now-note">${escH(note)}</p>` : ''}`;
}
function crewNowAll(){
  const el = document.getElementById('mc-sched');
  if(el){ try{ el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }catch(e){ el.scrollIntoView(); } }
  else try{ openSchedManager(); }catch(e){}
}
/* Kept current while Crew is on screen: every 15 seconds while something is
   due or running, every minute otherwise - one read of the server's list, and
   only this panel redrawn, only when what it says changed. */
let _crewNowT = 0, _crewNowN = 0;
function _crewNowTick(){
  clearTimeout(_crewNowT);
  _crewNowT = setTimeout(async () => {
    const el = document.getElementById('crew-now');
    if(!el || S.tab !== 'crew'){ _crewNowT = 0; return; }
    const busy = !!el.querySelector('.crew-now-row.run, .crew-now-row.wait');
    if(busy || ++_crewNowN % 4 === 0){ try{ if(typeof _autoRefresh === 'function' && window.AMV_API && AMV_API.live) await _autoRefresh(); }catch(e){} }
    const html = _crewNowHTML(); if(el.isConnected && el.innerHTML !== html) el.innerHTML = html;
    _crewNowTick();
  }, 15000);
}
try{ window.crewNowAll = crewNowAll; window._crewNowHTML = _crewNowHTML; window._crewNowTick = _crewNowTick; }catch(e){}
/* THE BOX IS A CONVERSATION (Nov 17, the owner: "make it like a chatbot - I
   search twitter, it opens and says 'say more'. I say 'tell me every time
   Trump tweets about something finance'. AMV asks 'by email or in AMV?', I
   answer, and AMV does it").

   What is typed opens a conversation, and AMV asks only what it needs: more,
   when the request is too short to act on; how to tell you, every time; when,
   only if the request did not say ("every time" is a watch that looks every
   hour - _parseWhen). Then it sets the job up on AMV's servers - the same
   scheduler, plan gating and budget as everything else (_mcScheduleServer) -
   and says so, and the job appears under Running now. A job that only tells
   you something runs on its own; one that would send or change anything asks
   you first, each time. Somebody signed out, a "connect my ..." and a request
   AMV cannot do at all keep their answers under the box (mcRunCommand). */
let _cv = null;
const _CV_READONLY = /^(please\s+)?(tell|notify|alert|let me know|remind|watch|track|check|find|look|summari[sz]e|monitor|keep (an )?eye|show|send me|email me|message me|ping me|list|research|compare|follow)\b/i;
function crewConverse(text){
  text = String(text || '').trim(); if(!text) return;
  const signedIn = typeof S !== 'undefined' && S.user && S.user.email;
  const cx = (typeof _mcConnectIntent === 'function') ? _mcConnectIntent(text) : null;
  const edge = (typeof _feasFloor === 'function') ? _feasFloor(text) : null;
  if(!signedIn || cx || edge || !(typeof _planAllowsCrew === 'function' && _planAllowsCrew())){ mcRunCommand(text); return; }
  const inp = document.getElementById('mc-cmd-input'); if(inp){ inp.value = ''; try{ _mcCmdFit(inp); }catch(e){} }
  _cv = { msgs: [], step: '', first: text, goal: '', notify: '', when: null };
  _cvOpen();
  _cvSay('you', text);
  const words = text.split(/\s+/).filter(Boolean).length;
  if(words < 4){
    _cv.step = 'more';
    _cvSay('amv', T('Say more - what should AMV do with “{0}”? For example: “tell me every time somebody posts about something”.').replace('{0}', text));
    return;
  }
  _cv.goal = text; _cvAskHow();
}
function _cvAskHow(){
  const edge = (typeof _feasFloor === 'function') ? _feasFloor(_cv.goal) : null;
  if(edge){ _cv.step = 'more'; _cvSay('amv', T('AMV cannot do that one: {0} Say it another way?').replace('{0}', String(edge.why || ''))); return; }
  _cv.step = 'how';
  _cvSay('amv', T('How should AMV tell you - by email or in AMV?'), [['email', T('By email')], ['app', T('In AMV')]]);
}
function _cvAskWhen(){
  const w = (typeof _parseWhen === 'function') ? _parseWhen(_cv.goal) : null;
  if(w && w.kind === 'recurring'){ _cv.when = w; _cvGo(); return; }
  _cv.step = 'when';
  _cvSay('amv', T('When should AMV do it?'), [['now', T('Now, once')], ['morning', T('Every morning')], ['hour', T('Every hour')]]);
}
function _cvAnswer(v){
  v = String(v || '').trim(); if(!v || !_cv) return;
  if(_cv.step === 'more'){
    _cvSay('you', v);
    const low = v.toLowerCase(), first = _cv.first.toLowerCase();
    _cv.goal = (low.indexOf(first) >= 0 || _cv.first.split(/\s+/).length >= 4) ? v : v + ' (' + _cv.first + ')';
    _cvAskHow(); return;
  }
  if(_cv.step === 'how'){
    const k = /^email$|mail|correo|e-?mail/i.test(v) ? 'email' : /^app$|amv|app|here|aqu[ií]/i.test(v) ? 'app' : '';
    _cvSay('you', k === 'email' ? T('By email') : k === 'app' ? T('In AMV') : v);
    if(!k){ _cvSay('amv', T('By email, or in AMV?'), [['email', T('By email')], ['app', T('In AMV')]]); return; }
    _cv.notify = k; _cvAskWhen(); return;
  }
  if(_cv.step === 'when'){
    const pick = { now: 'now', morning: 'every morning at 8', hour: 'every hour' }[v];
    _cvSay('you', pick === 'now' ? T('Now, once') : pick === 'every morning at 8' ? T('Every morning') : pick === 'every hour' ? T('Every hour') : v);
    const w = (typeof _parseWhen === 'function') ? _parseWhen(pick || v) : null;
    if(pick === 'now' || (w && (w.kind === 'now' || w.kind === 'once'))){ _cv.when = { kind: 'once', freq: 'once', label: T('Now, once'), now: true }; _cvGo(); return; }
    if(w && w.kind === 'recurring'){ _cv.when = w; _cvGo(); return; }
    _cvSay('amv', T('Pick one, or say it your way - “every Monday at 8”.'), [['now', T('Now, once')], ['morning', T('Every morning')], ['hour', T('Every hour')]]);
    return;
  }
}
async function _cvGo(){
  _cv.step = 'going';
  const auto = _CV_READONLY.test(_cv.goal);
  _cvSay('amv', T('Setting it up…'), null, true);
  const w = _cv.when || {};
  const res = await _mcScheduleServer({ goal: _cv.goal, sched: w.sched, freq: w.freq, approval: auto ? 'auto' : 'require',
    notify: _cv.notify === 'email' ? 'email' : 'app', firstRunAt: w.now ? Date.now() : undefined });
  if(!_cv) return;
  _cvUnsay();
  if(!res.ok){
    _cv.step = 'more';
    _cvSay('amv', (typeof _mcWhereItRuns === 'function' && _mcWhereItRuns(res)) || res.error || T('That could not be set up just now. Try again in a moment.'));
    return;
  }
  _cv.step = 'done';
  /* What the server stored, not what was asked: with no way to send email it
     keeps the job and tells them in AMV, and saying "by email" would be a lie. */
  const told = res.notify || (_cv.notify === 'email' ? 'email' : 'app');
  const how = told === 'email' ? T('by email') : T('here in AMV');
  const fell = _cv.notify === 'email' && told !== 'email';
  const when = w.now ? T('It starts within a minute') : (w.label || '');
  _cvSay('amv', T('Done - it is running. {0}, and AMV tells you {1}. You can see it under Running now.').replace('{0}', when).replace('{1}', how)
    + (fell ? ' ' + T('Email cannot be sent from AMV right now, so it tells you here instead.') : '')
    + (auto ? '' : ' ' + T('It asks you before it sends or changes anything.')), [['close', T('See it running')]]);
  try{ if(typeof _autoRefresh === 'function') _autoRefresh().then(() => { const el = document.getElementById('crew-now'); if(el) el.innerHTML = _crewNowHTML(); }); }catch(e){}
}
function _cvOpen(){
  const r = document.getElementById('ovr'); if(!r) return;
  r.innerHTML = `<div class="ov cv-bg" id="cv-bg"><div class="cv" role="dialog" aria-modal="true" aria-labelledby="cv-h">
    <header class="cv-head"><h2 id="cv-h">${escH(T('Tell AMV what to do'))}</h2><button class="cv-x" id="cv-x" type="button" aria-label="${escH(T('Close'))}">✕</button></header>
    <div class="cv-log" id="cv-log" role="log" aria-live="polite"></div>
    <form class="cv-form" id="cv-form"><textarea id="cv-in" class="cv-in" rows="1" autocomplete="off" enterkeyhint="send" aria-label="${escH(T('Your answer'))}" placeholder="${escH(T('Type your answer…'))}"></textarea>
      <button class="cj-run cv-send" type="submit" aria-label="${escH(T('Send'))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
  </div></div>`;
  r.classList.add('on');
  const close = () => { _cv = null; try{ closeOvr(); }catch(e){} };
  onBackdrop(document.getElementById('cv-bg'), close);
  on(document.getElementById('cv-x'), 'click', close);
  const inp = document.getElementById('cv-in');
  on(document.getElementById('cv-form'), 'submit', (e) => { e.preventDefault(); const v = inp.value; inp.value = ''; _cvAnswer(v); inp.focus(); });
  on(inp, 'keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); document.getElementById('cv-form').requestSubmit(); } });
  on(document.getElementById('cv-log'), 'click', (e) => {
    const b = e.target.closest && e.target.closest('[data-cv]'); if(!b) return;
    if(b.dataset.cv === 'close'){ close(); const el = document.getElementById('crew-now'); if(el) try{ el.scrollIntoView({ block: 'center' }); }catch(_){} return; }
    _cvAnswer(b.dataset.cv);
  });
  setTimeout(() => { try{ inp.focus(); }catch(e){} }, 30);
}
function _cvSay(who, text, chips, busy){
  if(!_cv) return;
  const log = document.getElementById('cv-log'); if(!log) return;
  log.querySelectorAll('.cv-chips').forEach(c => c.remove());
  const m = document.createElement('div');
  m.className = 'cv-msg ' + (who === 'you' ? 'you' : 'amv') + (busy ? ' busy' : '');
  m.innerHTML = '<p class="cv-bubble">' + (busy ? '<span class="rr-dot"></span> ' : '') + escH(text) + '</p>'
    + (chips && chips.length ? '<div class="cv-chips">' + chips.map(c => '<button class="cv-chip" type="button" data-cv="' + escH(c[0]) + '">' + escH(c[1]) + '</button>').join('') + '</div>' : '');
  log.appendChild(m);
  log.scrollTop = log.scrollHeight;
}
function _cvUnsay(){ const b = document.querySelector('#cv-log .cv-msg.busy'); if(b) b.remove(); }
try{ window.crewConverse = crewConverse; window._cvAnswer = _cvAnswer; }catch(e){}
function _cjAskHTML(extra){
  return `<section class="cj-ask mc-cmd cj-hero" aria-labelledby="cx-ask-h">
    <div class="cj-ask-top">
      <div class="cj-ask-hd"><h1 id="cx-ask-h">${escH(T('Tell AMV what to do'))}</h1>
        <p class="cj-promise">${escH(T('AMV does it on your schedule and brings you the result.'))}</p></div>
      ${extra || ''}
    </div>
    <div class="cj-box">
      <span class="cj-box-ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="2.6"/></svg></span>
      <textarea id="mc-cmd-input" class="mc-cmd-input cj-input" rows="1" autocomplete="off" aria-label="${escH(T('Tell AMV what to do'))}" enterkeyhint="go"
        placeholder="${escH(_cjNarrow() ? T('e.g. summarize my email at 8') : T('e.g. every morning at 8, summarize my unread email'))}"></textarea>
      <button class="mc-cmd-go cj-run" id="mc-cmd-go" aria-label="${escH(T('Run'))}"><span class="cj-run-t">${escH(T('Run'))}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
    </div>
    <div id="mc-cmd-result" class="mc-cmd-result"></div>
  </section>`;
}
function _cjWire(vc){
  const q = document.getElementById('cx-q');
  if(q){
    let t = 0;
    /* The matching jobs under the box as you type; picking one opens it. */
    amvTypeahead(q, { items: () => _cjList().map(j => ({ label: j.title, sub: j.desc || '', id: j.id })),
      onPick: (it) => { try{ q.blur(); }catch(e){} cwPeek(it.id); } });
    on(q, 'input', function(){ const v = this.value; clearTimeout(t); t = setTimeout(() => { _cjQ = v.trim(); _cjN = 24; const g = document.getElementById('cj-grid'); if(g) g.innerHTML = _cjGridHTML(); }, 120); });
    on(q, 'keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); clearTimeout(t); _cjQ = this.value.trim(); _cjN = 24; const g = document.getElementById('cj-grid'); if(g) g.innerHTML = _cjGridHTML(); } });
  }
  /* The catalogue of the country's real services arrives after the page: its
     jobs join the list in place. */
  try{ _cwLoadLocal(_cwCountryGuess()); }catch(e){}
  /* Drawn again only when the list really changed - the second visit to Crew
     already drew the kept list on arrival. */
  const had = ((window._ccCrewJobs || {})[_cwCountryGuess()]);
  const cc0 = _cwCountryGuess();
  const tried = () => { const waited = cc0 && !_cjTried[cc0]; if(cc0) _cjTried[cc0] = true; return waited; };
  _ccReady().then(ok => ok ? ccCrewLoad(cc0) : null)
    .then(l => { const waited = tried(); if(((l && l !== had) || waited) && document.getElementById('cj-grid')) _cjRepaint(); })
    .catch(() => { if(tried() && document.getElementById('cj-grid')) _cjRepaint(); });
}

/* SEE ALL JOBS (Nov 15). The owner: "an option to see all jobs - a directory
   of every job from all countries, and you search what you want. I'd rather
   people use the main text box, but the directory is so people can see
   everything."

   Every country's catalogue, fetched when the directory opens (a few at a
   time, the count rising as they land) and searched in memory. Only the rows
   on screen are drawn. A job found here opens the same panel and switches on
   the same way as one on the main list. */
let _cjdQ = '', _cjdCc = '', _cjdN = 60, _cjdAll = [], _cjdLoading = false, _cjdCodes = [];
/* The rows on screen, made when drawn and kept by id so the job's panel
   (cwPeek -> _cwFindJob) and its switch find the same object. Only what has
   been shown is here - the directory itself is never built (ccDirFind). */
window._cjdMade = window._cjdMade || {};
function _cjdRows(){
  const words = _cjdQ.toLowerCase().split(/\s+/).filter(Boolean);
  /* The jobs that work everywhere belong to no country, so a country filter
     leaves them out. */
  const own = _cjdCc ? [] : _cjdAll.filter(j => _cjMatch(j, words));
  const codes = _cjdCc ? [_cjdCc] : _cjdCodes;
  const want = Math.max(0, _cjdN - own.length);
  const r = (window.ccDirFind && codes.length) ? window.ccDirFind(codes, words, want) : { n: 0, rows: [] };
  const rows = own.slice(0, _cjdN).concat(r.rows);
  for(const j of r.rows) window._cjdMade[j.id] = j;
  return { n: own.length + r.n, rows };
}
function _cjdPaint(){
  const box = document.getElementById('cxd-list'); if(!box) return;
  const { n: total, rows: shown } = _cjdRows();
  const n = document.getElementById('cxd-n');
  if(n) n.textContent = total.toLocaleString() + ' ' + T('jobs') + (_cjdLoading ? ' · ' + T('loading more countries…') : '');
  box.innerHTML = shown.length
    ? shown.map(j => { const c = _cwCountryRow(j.country);
        return `<button class="cxd-row" data-dact="cwPeek" data-darg="${escH(j.id)}">
          <span class="cj-card-ic" aria-hidden="true">${_lineIcon(j.cat)}</span>
          <span class="cxd-b"><span class="cxd-t" data-no-i18n>${escH(j.title)}</span>
            <span class="cxd-s">${c ? `<span aria-hidden="true">${c[2]}</span> ${escH(T(c[1]))} · ` : ''}${escH(T(_cjCat(j)))} · ${escH(_cjEvery(j))}</span></span></button>`; }).join('')
      + (total > shown.length ? `<div class="cj-more-w"><button class="btn bs" id="cxd-more">${escH(T('Show more'))} <span class="cj-n">${(total - shown.length).toLocaleString()}</span></button></div>` : '')
    : `<div class="cj-empty">${_cjdLoading ? escH(T('Loading…')) : escH(T('No job matches that.'))}</div>`;
  on(document.getElementById('cxd-more'), 'click', () => { _cjdN += 120; _cjdPaint(); });
}
async function _cjdLoad(){
  if(_cjdLoading) return;
  _cjdLoading = true;
  const here = _cwCountryGuess();
  /* The reader's own country first: a job listed in several countries is
     counted once, in the first of them. */
  _cjdCodes = [here].concat((CW_WORLD_COUNTRIES || []).map(c => c[0]).filter(c => c !== here)).filter(Boolean);
  /* The jobs that work everywhere first, so the directory is never empty. A
     country's job somebody has switched on is in their saved list too; it is
     counted with its country, not twice. */
  if(!_cjdAll.length){ try{ const have = new Set(); for(const j of (_cwJobs() || []).concat(_cwUniversalJobs() || [])){ if(j && !have.has(j.id) && !/^ccj-/.test(j.id)){ have.add(j.id); _cjdAll.push(j); } } }catch(e){} }
  let i = 0, last = 0;
  const codes = _cjdCodes.slice();
  const next = async () => {
    while(i < codes.length){
      const cc = codes[i++];
      try{ await window.ccDirLoad(cc); }catch(e){}
      if(Date.now() - last > 400){ last = Date.now(); _cjdPaint(); }
    }
  };
  await Promise.all([next(), next(), next(), next(), next(), next()]);
  _cjdLoading = false;
  _cjdPaint();
}
function cjDirectory(){
  const r = $('ovr'); if(!r) return;
  const opts = (CW_WORLD_COUNTRIES || []).slice().sort((a, b) => T(a[1]).localeCompare(T(b[1])))
    .map(c => `<option value="${c[0]}"${c[0] === _cjdCc ? ' selected' : ''}>${c[2]} ${escH(T(c[1]))}</option>`).join('');
  r.innerHTML = `<div class="ov" id="cxd-bg"><div class="cxd" role="dialog" aria-modal="true" aria-labelledby="cxd-h">
    <header class="cxd-h"><div><h2 id="cxd-h">${escH(T('All jobs'))}</h2><span class="cj-count" id="cxd-n"></span></div>
      <button class="cwp-x" id="cxd-x" aria-label="${escH(T('Close'))}">✕</button></header>
    <div class="cxd-tools">
      <div class="cj-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="cxd-q" type="search" autocomplete="off" value="${escH(_cjdQ)}" placeholder="${escH(T('Search every job in every country'))}" aria-label="${escH(T('Search every job in every country'))}"></div>
      <select class="inp" id="cxd-cc" aria-label="${escH(T('Country'))}"><option value="">${escH(T('All countries'))}</option>${opts}</select>
    </div>
    <div class="cxd-list" id="cxd-list"></div>
  </div></div>`;
  r.classList.add('on');
  onBackdrop($('cxd-bg'), closeOvr);
  on($('cxd-x'), 'click', closeOvr);
  let t = 0;
  on($('cxd-q'), 'input', function(){ const v = this.value; clearTimeout(t); t = setTimeout(() => { _cjdQ = v.trim(); _cjdN = 60; _cjdPaint(); }, 150); });
  on($('cxd-cc'), 'change', function(){ _cjdCc = this.value; _cjdN = 60; _cjdPaint(); });
  _cjdPaint();
  try{ $('cxd-q').focus(); }catch(e){}
  _ccReady().then(ok => { if(ok) _cjdLoad(); }).catch(() => {});
}
try{ window.cjDirectory = cjDirectory; }catch(e){}

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
    vc.innerHTML=`<div class="sv fi"><div class="cj cw-locked">
      ${_cjAskHTML()}
      ${_cjJobsHTML()}
      <div class="cj-plan">
        <span>${escH(T('Crew runs on {0} and above, with AMV closed.').replace('{0}', P.name))}</span>
        <button class="cj-link" data-stab="plans">${escH(T('See plans'))} \u2192</button>
      </div>
    </div></div>`;
    _cwWireCmd(vc); _cjWire(vc);
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
        <button class="btn apv-preview" data-dact="apvPreview" data-darg="${escH(a.id)}">Preview</button>
        <button class="btn apv-ghost" data-dact="apvEdit" data-darg="${escH(a.id)}">Edit</button>
        <button class="btn apv-ghost apv-reject" data-dact="apvReject" data-darg="${escH(a.id)}">Reject</button>
        <button class="btn apv-approve" data-dact="apvQuickApprove" data-darg="${escH(a.id)}">${escH(act.btn)}</button>
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
  const running = st.server.length + _mcLocalOnly(st).length + st.auton.length;

  /* ONE BOX, THEN WHAT NEEDS YOU, THEN EXAMPLES - LAST (the owner, Oct 26: "simple.
     You type in the textbox something and AMV does it. It scans and then says
     what it needs. Below that, examples for all different countries").

     The box is the same one the free screen has, on the same run path: it
     reviews what was asked, says what it needs (an account to connect, a
     time), asks for it, and does it. Under it, only what is happening and
     needs the person - approvals, problems, running jobs - and only when
     there is any. Then the examples for the country chosen at the top. The
     settings for background work sit folded above the examples; they are set
     once and rarely. The examples are the last thing on the page - an
     earlier fault was work stacked under the catalogue, out of sight. */
  const allow=_crewJobAllowance();
  const tools=`<div class="cj-ask-tools cw-simple-head-r">${allow?`<span class="cj-allow">${escH(T('{0} of {1} jobs on').replace('{0}', running).replace('{1}', allow))}</span>`:''}${paused
        ? `<button class="cj-icon-btn mc-pause paused" data-dact="resumeAllAutonomous">${escH(T('Resume all'))}</button>`
        : running ? `<button class="cj-icon-btn mc-pause" data-dact="pauseAllAutonomous">${escH(T('Pause all'))}</button>` : ''}<button class="cj-icon-btn" type="button" data-dact="openCrewSettings" aria-label="${escH(T('Crew settings'))}" title="${escH(T('Crew settings'))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></div>`;
  vc.innerHTML = `<div class="sv fi"><div class="cj crew-page mc-page">
    ${_cjAskHTML(tools)}
    <section id="crew-now" class="crew-now" aria-labelledby="crew-now-h" aria-live="polite">${_crewNowHTML()}</section>
    <div id="crew-live" class="crew-live">${_crewResultsHTML()}</div>
    ${/* AMV asking you something stays on the page - it is a question, not a
          setting, so it did not go into the settings dialog with the rest. */ ''}
    ${_mcOfferHTML()}
    ${paused?`<div class="mc-paused-banner"><b>Autonomous work is paused.</b> Scheduled and standing jobs won’t run until you resume. Anything already waiting still needs your approval.</div>`:''}

    ${appr.length?`<section id="mc-appr" class="mc-sec">
      <div class="sec-head"><h3>Needs your approval <span class="cw-badge">${appr.length}</span></h3><span class="sec-sub">Nothing here sends until you approve it.</span></div>
      ${appr.map(apprCard).join('')}
    </section>`:''}

    ${st.failed.length?`<section id="mc-fail" class="mc-sec">
      <div class="sec-head"><h3>Action required <span class="cw-badge err">${st.failed.length}</span></h3><span class="sec-sub">Blocked or failed - these need you.</span></div>
      <div class="mc-grid">${st.failed.map(_mcFailCard).join('')}</div>
    </section>`:''}

    ${/* Active work is in Running now, under the box (Nov 17) - with its
          progress - so it is not drawn a second time here. */ ''}

    ${(running || st.serverError)?`<section id="mc-sched" class="mc-sec">
      <div class="sec-head"><h3>Running jobs</h3><button class="mc-sec-link" data-dact="openSchedManager">Manage</button></div>
      ${(()=>{
        const local = _mcLocalOnly(st);
        const rows = st.server.map(_mcServerSchedRow).join('')
                   + st.auton.map(_mcAutonSchedRow).join('')
                   + local.slice(0,8).map(t=>_mcSchedRow(t,st)).join('');
        if(rows) return `<div class="mc-sched">${rows}</div>`
          + (local.length?`<div class="mc-sched-note">The ${local.length===1?'job':local.length+' jobs'} above without "runs on AMV's servers" could not be registered to run in the background, so ${local.length===1?'it runs':'they run'} only while AMV is open.</div>`:'');
        /* A failed read is not an empty list: the jobs have not stopped. */
        return `<div class="mc-empty-row">Your running jobs could not be loaded (${escH(st.serverError)}). They have NOT stopped - this screen just cannot show them right now. <button class="mc-sec-link" data-dact="mcReloadJobs">Try again</button></div>`;
      })()}
    </section>`:''}

    ${_mcAgentsHTML()}

    ${st.done.length?`<section id="mc-done" class="mc-sec">
      <div class="sec-head"><h3>Recently completed</h3></div>
      <div class="mc-grid">${st.done.slice(-6).reverse().map(_mcDoneCard).join('')}</div>
    </section>`:''}
    ${_mcActivityHTML()}
    <section class="mc-sec" id="crew-games-sec" hidden><div class="sec-head"><h3>Games you are running</h3><span class="sec-sub">A game is a link anybody can open - no account needed.</span></div><div id="crew-games"></div></section>
    ${_mcBoughtCrewsHTML()}
    ${/* THE ORDER THE OWNER ASKED FOR (Nov 10): the box, what is running now,
          then every job for where you are. The settings for background work
          are a button in the header (openCrewSettings) - set once, rarely
          changed, and a section of their own pushed the jobs down the page.
          The catalogue stays the last thing on the page. */ ''}
    ${_cjJobsHTML()}
  </div></div>`;
  _cwWireCmd(vc); _cjWire(vc);
  _crewNowTick();
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
    var _mcRun=function(){ var el=$('mc-cmd-input'); var v=el?el.value.trim():''; if(!v){ el&&el.focus(); return; } crewConverse(v); };
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
/* Here once: the loader in the page reads this before fetching again. */
try{ window._crewViewHere = true; }catch(e){}


/* CREW SETTINGS, ONE BUTTON AWAY (Nov 10).

   How far AMV may go on its own, the spending ceiling for background work,
   standing instructions, quiet hours and the commands it must never run.
   They are real controls with real effects, so they are kept - but they are
   set once, and as a section on Crew they stood between the box and the jobs.
   They open here, as one dialog, from the gear in Crew's header. Every
   control in them is a delegated data-dact, so they work exactly as they did;
   after each change the dialog is redrawn from the same functions so what it
   shows is what was saved. */
function openCrewSettings(){
  const r = $('ovr'); if(!r) return;
  const body = () => _mcCeilingHTML() + _mcStandingHTML() + _mcQuietRowHTML() + _mcNeverRowHTML();
  r.innerHTML = '<div class="ov" id="crs-bg"><div class="crs" role="dialog" aria-modal="true" aria-labelledby="crs-t">'
    + '<div class="crs-h"><div><h2 id="crs-t">' + escH(T('Crew settings')) + '</h2>'
    + '<p>' + escH(T('How far AMV may go on its own, what it always follows, and when it stays quiet.')) + '</p></div>'
    + '<button class="cwp-x" id="crs-x" aria-label="' + escH(T('Close')) + '">\u2715</button></div>'
    + '<div class="crs-b" id="mc-settings">' + body() + '</div></div></div>';
  r.classList.add('on');
  onBackdrop($('crs-bg'), closeOvr);
  on($('crs-x'), 'click', closeOvr);
  const b = $('mc-settings');
  let t = 0;
  const redraw = () => { clearTimeout(t); t = setTimeout(() => { const x = $('mc-settings'); if(x && !x.contains(document.activeElement && document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : null)) x.innerHTML = body(); }, 200); };
  on(b, 'change', redraw);
  on(b, 'click', function(e){ if(e.target && e.target.closest && e.target.closest('button')) redraw(); });
  try{ const f = b.querySelector('button, input, select, textarea'); if(f) f.focus(); }catch(e){}
}
try{ window.openCrewSettings = openCrewSettings; }catch(e){}

/* "Jobs for Spain" when the country is known, "Jobs for you" while it is not. */
function _cwJobsForHead(){
  const row = _cwCountryRow(_cwCountryGuess());
  return row ? _cwSayPlace('Jobs for {country}', row[1], _cwThe(row[1])) : T('Jobs for you');
}
