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
/* SAVED SIGN-INS (owner decision #46): which sites it holds a sign-in for,
   until when, and Forget - never the sign-in itself, which the server keeps
   sealed and never sends. */
function _mcAgentSignIns(a){
  const b = a.browser || {};
  if(!b.keep) return '';
  const held = a.signIns || [];
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
    await _autoApi('/v1/agents/signins/forget', { id, site });
    toast(T('Forgotten. It no longer holds a sign-in for {0}.').replace('{0}', site), 'success', 4000);
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
    + _mcAgentSignInFields(a),
    async () => {
      const body = { name: $('ag-name').value, role: $('ag-role').value, instructions: $('ag-instr').value, budgetUSD: +$('ag-budget').value || 0 };
      const keepBox = $('ag-keep');
      if(keepBox){
        body.browserKeep = !!keepBox.checked;
        body.browserSites = String($('ag-sites').value || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
      }
      await _autoApi('/v1/agents/save', Object.assign(a ? { id: a.id } : {}, body));
      toast(a ? T('Saved.') : T('Agent created. Give it a job to start it working.'), 'success', 4000);
      await mcAgentsReload();
    });
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
    toast(T('Deleted. {0} of its jobs stopped.').replace('{0}', String(d.stopped || 0)), 'success', 4000);
  }catch(e){ toast(T('That did not work: {0}. Nothing changed.').replace('{0}', (e && e.message) || ''), 'error', 6000); }
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
      <div class="mc-sched-goal">${escH(String(x.detail||'Background job').slice(0,180))}</div>
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
        return `<span class="mc-sched-mode ${eff==='auto'?'auto':''}">${escH(say)}</span>`
             + (eff!==own?`<span class="mc-sched-held">held back from “${escH(own)}” by your account setting</span>`:'')
             + quiet + same;
      })()}</div>
    </div>
    <div class="mc-sched-acts">
      ${x.done ? '' : `<button class="btn mc-mini ghost" data-dact="mcServerJob" data-darg="${escH(x.id)}|${paused?'resume':'pause'}">${paused?'Resume':'Pause'}</button>`}
      ${x.done || !(x.when && x.when.source === 'hook') ? '' : `<button class="btn mc-mini ghost" data-dact="mcHookAddress" data-darg="${escH(x.id)}|show">${escH(T('Copy address'))}</button><button class="btn mc-mini ghost" data-dact="mcHookAddress" data-darg="${escH(x.id)}|renew">${escH(T('New address'))}</button><button class="btn mc-mini ghost" data-dact="mcHookSigning" data-darg="${escH(x.id)}|${escH((x.hook && x.hook.signed) || '')}">${escH(x.hook && x.hook.signed ? T('Signed') + ' · ' + T(_HOOK_SIGNERS[x.hook.signed]) : T('Require signing'))}</button>`}
      ${x.done || x.agent || x.step || paused || !(x.runs > 0) ? '' : `<button class="btn mc-mini ghost" data-dact="mcKeepAsAgent" data-darg="${escH(x.id)}" data-keep-job="${escH(x.id)}" data-keep-detail="${escH(String(x.detail||'').slice(0, 400))}">${escH(T('Keep as an agent'))}</button>`}
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
    toast((e && e.message === 'not-connected')
      ? 'AMV is not connected to its engine, so that job could not be changed. It is still running.'
      : 'That did not work: ' + ((e && e.message) || 'the server refused it') + '. The job is unchanged.',
      'error', 6500);
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
      <div class="mc-sched-mode-row"><span class="mc-sched-mode auto">Autonomous - emails you results automatically</span></div>
    </div>
    <div class="mc-sched-acts"><button class="btn mc-mini ghost" data-dact="cwToggle" data-darg="${j.id}">Turn off</button></div>
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
  vc.innerHTML = `<div class="sv fi"><div class="crew-page mc-page cw-simple">
    <header class="cw-simple-head">
      <h2>${escH(T('Crew'))}</h2>
      <div class="cw-simple-head-r">${_cwWhereBtnHTML()}${paused
        ? `<button class="mc-pause paused" data-dact="resumeAllAutonomous">▶ ${escH(T('Resume autonomy'))}</button>`
        : running ? `<button class="mc-pause" data-dact="pauseAllAutonomous">⏸ ${escH(T('Pause all autonomous'))}</button>` : ''}</div>
    </header>
    <p class="vsub cw-simple-sub">${escH(T('Say what you want done. AMV checks what it needs - an account to connect, a time to run - asks you for it, then does it, even with AMV closed.'))}</p>
    ${(()=>{ const n=_crewJobAllowance();
      /* The number, before they hit it. A limit discovered by bumping into it
         reads as a fault; the same limit stated up front reads as a plan. */
      return n?`<div class="mc-allow">${running} of ${n} background job${n===1?'':'s'} in use <span>\u00b7 your plan runs ${n}</span></div>`:''; })()}
    <div class="mc-cmd mc-cmd-lg">
      <div class="mc-cmd-inner">
        <svg class="mc-cmd-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>
        <textarea id="mc-cmd-input" class="mc-cmd-input" rows="1" aria-label="${escH(T('Tell AMV what to do'))}" enterkeyhint="go" placeholder="${escH(T('e.g. every morning at 8, summarize my unread email'))}" autocomplete="off"></textarea>
        <button class="mc-cmd-go" id="mc-cmd-go">${escH(T('Run'))}</button>
      </div>
      <div class="mc-cmd-chips">${[
        'Email me a summary of my unread emails',
        'Research the top AI news today and write me a brief',
        'Draft a reply to my latest email',
        'Plan my week from my calendar'
      ].map(c=>`<button class="mc-cmd-chip" data-mccmd="${escH(c)}">${escH(c)}</button>`).join('')}</div>
      <div id="mc-cmd-result" class="mc-cmd-result"></div>
    </div>
    <div id="crew-live" class="crew-live">${_crewResultsHTML()}</div>
    ${paused?`<div class="mc-paused-banner"><b>Autonomous work is paused.</b> Scheduled and standing jobs won’t run until you resume. Anything already waiting still needs your approval.</div>`:''}

    ${appr.length?`<section id="mc-appr" class="mc-sec">
      <div class="sec-head"><h3>Needs your approval <span class="cw-badge">${appr.length}</span></h3><span class="sec-sub">Nothing here sends until you approve it.</span></div>
      ${appr.map(apprCard).join('')}
    </section>`:''}

    ${st.failed.length?`<section id="mc-fail" class="mc-sec">
      <div class="sec-head"><h3>Action required <span class="cw-badge err">${st.failed.length}</span></h3><span class="sec-sub">Blocked or failed - these need you.</span></div>
      <div class="mc-grid">${st.failed.map(_mcFailCard).join('')}</div>
    </section>`:''}

    ${st.active.length?`<section id="mc-active" class="mc-sec">
      <div class="sec-head"><h3>Active work</h3><span class="sec-sub">AMV is on these right now.</span></div>
      <div class="mc-grid">${st.active.map(_mcActiveCard).join('')}</div>
    </section>`:''}

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
    <details id="mc-settings" class="mc-sec cw-settings">
      <summary class="sec-head"><h3>${escH(T('Settings for background work'))}</h3><span class="sec-sub">${escH(T('How far AMV may go on its own, what it always follows, and when it stays quiet. Set once.'))}</span></summary>
      ${_mcOfferHTML()}
      ${_mcCeilingHTML()}
      ${_mcStandingHTML()}
      ${_mcQuietRowHTML()}
      ${_mcNeverRowHTML()}
    </details>
    <section class="mc-sec" id="crew-games-sec" hidden><div class="sec-head"><h3>Games you are running</h3><span class="sec-sub">A game is a link anybody can open - no account needed.</span></div><div id="crew-games"></div></section>
    ${_mcBoughtCrewsHTML()}

    <div class="crew-jobs-sec mc-start">
      <div class="sec-head"><h3>${escH(T('Examples'))}</h3><span class="sec-sub">${escH(T('For where you live - change the country at the top. Pick one, or say your own in the box.'))}</span></div>
      ${_cwNotHereHTML('above')}
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
/* Here once: the loader in the page reads this before fetching again. */
try{ window._crewViewHere = true; }catch(e){}
