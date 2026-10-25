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
function _mcGoConnect(){ try{ S.settingsPane='integrations'; setTab('settings'); }catch(e){} }

/* Which plan runs autonomous work, matching what the server enforces. Reading
   the same rule in both places is the point - a gate that only exists in the
   browser is not a gate, and one that only exists on the server is a dead end
   the user hits with no explanation. */
const CREW_REQUIRED_PLAN='pro';
const CREW_JOBS_BY_PLAN={free:0,pro:5,elite:25,ultra:100};
function _mcQuiet(){
  try{ const q = load('amv_auto_quiet'); return (q && Number.isInteger(q.from)) ? q : null; }catch(e){ return null; }
}

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

/* ── THE SCREEN ITSELF ARRIVES WITH THE CATALOGUE ─────────────────────────
   Mission Control's screen - its cards, its settings rows, its activity and
   the handlers behind them - is in src/crew/mission-control.js, which the
   build ships inside crew-data.js: it is only ever drawn after the catalogue
   has arrived anyway, so it costs no extra request and nothing in the page
   every visitor downloads (audit #40). What stays here is what other parts
   of the app call without the screen open: scheduling, the command box,
   the job switches.

   This renderCrewView is the stand-in. The file declares the real one, which
   replaces it the moment it loads; every caller already calls the name, so
   every caller gets the real one from then on. */
function renderCrewView(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML='<div class="sv fi crew-view"><div class="vi"><div class="cw-loading" role="status" aria-live="polite">'+escH(T('Loading your Crew\u2026'))+'</div></div></div>';
  const mine=renderCrewView;
  _loadCrewData().then(ok=>{
    if(S.tab!=='crew' && S.tab!=='extensions') return;
    if(ok && window.renderCrewView !== mine){ window.renderCrewView(); return; }
    const box=vc.querySelector('.cw-loading'); if(!box) return;
    box.innerHTML=escH(T('Crew could not load. Check your connection and try again.'))+' <button class="btn bs" type="button" id="cw-load-retry">'+escH(T('Try again'))+'</button>';
    on($('cw-load-retry'),'click',()=>renderCrewView());
  });
}
