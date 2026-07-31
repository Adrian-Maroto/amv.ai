/* ============================================================
   AMV-073: THE NEXT STEP.

   A new user types one thing, gets a good answer, and leaves - never learning
   that AMV can do the work rather than describe it. Crew, Dev, Job Hunt and
   background automations are invisible from an empty chat box, so the product
   gets judged as a chatbot by people who never saw the rest of it. That is an
   activation problem, and activation multiplies everything downstream.

   The fix is not a tour or a checklist. It is one earned line after a good
   answer, offering the thing only AMV can do next - and it really does it. A
   research answer offers to have that ready every morning, and accepting
   creates a genuine background automation. Code offers to open in Dev.

   Rules that keep it a feature rather than nagging:
     - Only after a COMPLETE answer. Never on an error, a cut-off reply, or
       while streaming.
     - At most one, and never the same kind twice in a conversation.
     - Only on a confident match. No match means no suggestion - silence is
       the default, not a generic fallback.
     - Dismissible for good, and it stays dismissed.
     - Every action performs real work. Nothing here is a prompt that only
       looks like a feature.
   ============================================================ */

const _NEXT_DISMISS_KEY = 'amv_nextstep_off';
function _nextStepOff(){ try{ return loadStr(_NEXT_DISMISS_KEY)==='1'; }catch(e){ return false; } }

/* Which next step, if any, this exchange has earned. Returns null far more
   often than not, and that is the point. */
function _nextStepFor(userText, answerText){
  const u = String(userText||'').toLowerCase();
  const a = String(answerText||'');
  if(a.length < 400) return null;                 // a one-liner has not earned a follow-up

  // Code that exists, rather than a conversation about code.
  const fence = a.match(/```(\w+)?/g);
  if(fence && fence.length >= 2 && a.length > 800){
    return { kind:'dev', label:'Open this in Dev',
      why:'Dev keeps the files, runs them, and lets you keep building on them.' };
  }
  // Something the user will want again tomorrow.
  if(/\b(latest|news|today|this week|current|update me|what.s happening|market|prices?)\b/.test(u)
     && !/\bonce\b/.test(u)){
    return { kind:'daily', label:'Have this ready every morning',
      why:'AMV will run it in the background and have the answer waiting, even with AMV closed.' };
  }
  // A job hunt is a standing task, not a single question.
  if(/\b(job|jobs|resume|cv|cover letter|apply|application|internship|hiring)\b/.test(u)){
    return { kind:'jobs', label:'Set up Job Hunt',
      why:'AMV finds roles that fit and fills the applications in, ready for you to review.' };
  }
  // A goal with several moving parts is work, not a question.
  /* A multi-part signal plus enough substance to be a task rather than a
     question. The floor is deliberately modest - "research X then compare Y for
     each of them" is real work at 79 characters. */
  if(/\b(plan|organi[sz]e|research and|then|step \d|multiple|each of|for every)\b/.test(u)
     && u.length > 60){
    return { kind:'crew', label:'Hand this to Crew',
      why:'Crew works through it step by step and shows you exactly what it did.' };
  }
  return null;
}

/* Perform it. Each branch does real work - none of these open a modal that
   only describes the feature. */
async function _nextStepRun(kind, userText){
  try{
    if(kind==='dev'){ setTab('dev'); return; }
    if(kind==='jobs'){ if(typeof openJobHunt==='function') openJobHunt(); else setTab('crew'); return; }
    if(kind==='crew'){
      setTab('crew');
      // Carry the goal across so they do not retype it.
      setTimeout(()=>{ const box=document.getElementById('mc-cmd-input'); if(box){ box.value=userText; box.focus(); } }, 300);
      return;
    }
    if(kind==='daily'){
      if(typeof _scheduleTask!=='function'){ toast('Automations need the AMV engine connected.','info',5000); return; }
      /* Deliberately NOT notify:'app'. The offer says the answer will be
         waiting "even with AMV closed" - which is only true if it reaches them
         somewhere they look while AMV is closed. _scheduleTask asks for email
         when the deployment can send it and falls back honestly when it
         cannot, adjusting what it tells the user either way. */
      const item = await _scheduleTask({
        detail: userText, repeat: 'daily', kind: 'research', approval: 'auto'
      });
      // _scheduleTask already reports success or the precise reason it could not.
      if(item) setTab('tasks');
    }
  }catch(e){ try{ toast('Could not do that: '+(e.message||'unknown'),'error',4000); }catch(_){} }
}
try{ window._nextStepFor=_nextStepFor; window._nextStepRun=_nextStepRun; window._nextStepOff=_nextStepOff; }catch(e){}

/* Render it under the newest answer. Called from the chat renderer. */
function _nextStepHTML(msgs){
  try{
    if(_nextStepOff()) return '';
    if(!Array.isArray(msgs) || msgs.length < 2) return '';
    const last = msgs[msgs.length-1];
    /* `_stopped` is the user pressing Stop, and it was missing from this list:
       a half-written file is exactly the cut-off reply the rule above promises
       to exclude, and "Open this in Dev" on it would carry the truncation into
       a project. */
    if(!last || last.r!=='a' || last.streaming || last._error || last._interrupted || last._stopped) return '';
    if(!last.c || typeof last.c!=='string') return '';
    const lastUser = [...msgs].reverse().find(m=>m.r==='u');
    if(!lastUser) return '';
    const step = _nextStepFor(lastUser.d || lastUser.c, last.c);
    if(!step) return '';
    // Once per kind per conversation - a repeated offer is nagging.
    const conv = (typeof getCurConv==='function' && getCurConv()) || {};
    if(conv._nextShown && conv._nextShown.indexOf(step.kind)>=0) return '';
    return '<div class="next-step" data-next-kind="'+escH(step.kind)+'">'+
      '<div class="next-step-b"><b>'+escH(step.label)+'</b><span>'+escH(step.why)+'</span></div>'+
      '<button class="next-step-go" type="button" data-next-go="'+escH(step.kind)+'">Do it</button>'+
      '<button class="next-step-x" type="button" data-next-off="1" aria-label="Do not suggest next steps">&#215;</button>'+
    '</div>';
  }catch(e){ return ''; }
}
try{ window._nextStepHTML=_nextStepHTML; }catch(e){}
