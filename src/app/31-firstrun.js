/* ============================================================
   AMV-099  THE FIRST SCREEN.

   A new account lands on an empty chat box. Everything that makes AMV
   different from a chat window - work that runs while you are away, agents
   that do the task rather than describe it, builds that actually run - is
   invisible from there. So AMV gets judged as a chatbot by people who never
   saw the rest of it, and the judgement is fair, because a chat box is all
   they were shown.

   The intrusive first-run modal was removed from this product on purpose, and
   this does not bring it back. It is one card, on the home screen, that a new
   account sees once. It states what AMV can do that a chat box cannot, and
   each line is a real starting point rather than a description - tapping one
   fills the composer with a prompt that produces the thing being described.

   Rules:
     - Shown to a NEW account only, and never after it has been used or
       dismissed. Nothing that reappears is a welcome.
     - It disappears the moment there is a conversation. Someone who has
       already started does not need to be told where to start.
     - Every line does the thing it claims. None of them open a tour.
   ============================================================ */

const FIRSTRUN_KEY = 'amv_firstrun_done';
function _firstRunDone(){ try{ return loadStr(FIRSTRUN_KEY)==='1'; }catch(e){ return true; } }
function _firstRunFinish(){ try{ saveStr(FIRSTRUN_KEY,'1'); }catch(e){} }
try{ window._firstRunDone=_firstRunDone; window._firstRunFinish=_firstRunFinish; }catch(e){}

/* Each entry is a real prompt, chosen so the answer demonstrates the capability
   rather than talking about it. */
const _FIRSTRUN_STARTS = [
  { t:'Have it work while you are away',
    d:'Set something up once and AMV runs it on its own, with the answer waiting when you come back.',
    p:'Keep me up to date on what is changing in my industry. Ask me which industry first, then give me a short brief I could read over coffee.' },
  { t:'Give it a job, not a question',
    d:'Multi-step work AMV plans and carries out, showing you exactly what it did.',
    p:'Research the three best options for something I need to buy, compare them on price and quality, and tell me which you would pick and why. Ask me what I am buying first.' },
  { t:'Have it build and run something',
    d:'Real software, written and running in a live sandbox, not a code sample.',
    p:'Build me a small working web app I can actually use, run it, and show me the result. Ask me what it should do first.' },
];

/* WHAT DO YOU WANT AMV FOR? (scale audit #48)

   Three starts suit nobody in particular. One question, answered with a tap,
   and the starts become two that show AMV doing real work in that part of
   the person's life - each still a prompt that produces the thing it names.
   The answer is kept on this device only; nothing about it is sent. */
const FIRSTRUN_GOAL_KEY = 'amv_goal';
const _FIRSTRUN_GOALS = {
  everyday: { t:'Everyday life', starts: [
    { t:'Plan a week of dinners', p:'Plan a week of dinners for my household on a budget, with one shopping list. Ask me how many people and anything we do not eat first.' },
    { t:'Write a message for me', p:'Help me write a polite, firm message about a problem I need sorted out. Ask me who it is to and what happened first.' } ] },
  work: { t:'Work', starts: [
    { t:'Brief me every morning', p:'Every weekday morning, brief me on what changed in my industry, in five lines. Ask me which industry first.' },
    { t:'Turn notes into a summary', p:'Turn my notes into a one-page summary with decisions and action items, each with an owner. Ask me to paste the notes first.' } ] },
  school: { t:'School', starts: [
    { t:'Explain it, then quiz me', p:'Explain a topic I am studying in plain words, then quiz me with five questions and mark my answers. Ask me the topic first.' },
    { t:'Make me a study plan', p:'Make me a day-by-day study plan for my next exam. Ask me the subject, the exam date and how much time I have each day first.' } ] },
  coding: { t:'Coding', starts: [
    { t:'Build and run an app', p:'Build me a small working web app, run it, and show me the result. Ask me what it should do first.' },
    { t:'Find the bugs in my code', p:'Review my code for bugs, explain each one, and give me the fixed version. Ask me to paste the code first.' } ] },
  research: { t:'Research', starts: [
    { t:'Research with sources', p:'Research a question for me and answer with sources I can check. Ask me the question first.' },
    { t:'Compare and pick for me', p:'Compare the three best options for something I want to buy, on price and quality, and tell me which you would pick and why. Ask me what it is first.' } ] },
  business: { t:'Business', starts: [
    { t:'A one-page business plan', p:'Write a one-page business plan for my idea: the customer, the price, the first ten sales. Ask me about the idea first.' },
    { t:'An email that gets replies', p:'Draft a short email to a potential customer and three follow-ups. Ask me what I sell and who to first.' } ] },
};
function _firstRunGoal(){ try{ const g = loadStr(FIRSTRUN_GOAL_KEY); return _FIRSTRUN_GOALS[g] ? g : ''; }catch(e){ return ''; } }
function _firstRunStarts(){
  const g = _firstRunGoal();
  return g ? _FIRSTRUN_GOALS[g].starts.map(s => ({ t: T(s.t), d: T(s.p), p: T(s.p) })) : _FIRSTRUN_STARTS;
}

function _firstRunHTML(){
  try{
    if(_firstRunDone()) return '';
    // Someone already talking to AMV does not need to be told where to start.
    if(typeof getMsgs==='function' && (getMsgs()||[]).length) return '';
    if(typeof S!=='undefined' && Array.isArray(S.convs)
       && S.convs.some(c => (c.msgs||[]).length)) return '';

    /* HOW MUCH OF THE FIRST SCREEN THIS IS ALLOWED TO TAKE (AMV-D022).

       Measured before changing anything: the card was 310px on a 1440x900
       desktop (34% of the viewport), 310px on a 1366x768 laptop (40%) and
       371px on a 390x844 phone (44%). The composer stayed reachable without
       scrolling at all three - that half of the finding did not reproduce -
       but a third to a half of somebody's first screen was instruction.

       Each item is a real starting point and every one of them still is, so
       none were removed. What went is the layout: three stacked blocks with a
       title AND a paragraph became three pills carrying the title only, and
       the "Or just ask it anything" footer went with them - the composer sits
       directly below with a cursor in it, which says that better.

       The paragraph is not deleted, it moves. Each pill carries it as its
       accessible name and as its hover title, so a screen reader still hears
       what the line does before choosing it, and nothing is explained only by
       a tooltip - the visible title already stands on its own. */
    return '<div class="fr-card" data-i18n role="region" aria-label="What AMV can do">'+
      '<div class="fr-top">'+
        '<div class="fr-h">AMV does the work, not just the talking</div>'+
        '<button class="fr-x" type="button" data-fr-skip="1" aria-label="Dismiss">&#215;</button>'+
      '</div>'+
      '<div class="fr-goal" role="group" aria-label="'+escH(T('What do you want AMV to help with most?'))+'">'+
        '<span class="fr-goal-q">'+escH(T('What do you want AMV to help with most?'))+'</span>'+
        Object.keys(_FIRSTRUN_GOALS).map(k=>
          '<button class="fr-goal-c'+(k===_firstRunGoal()?' on':'')+'" type="button" data-fr-goal="'+k+'" aria-pressed="'+(k===_firstRunGoal())+'">'+escH(T(_FIRSTRUN_GOALS[k].t))+'</button>').join('')+
      '</div>'+
      '<div class="fr-list">'+
        _firstRunStarts().map((s,i)=>
          '<button class="fr-item" type="button" data-fr-go="'+i+'"'+
            ' title="'+escH(s.d)+'" aria-label="'+escH(s.t+'. '+s.d)+'">'+
            '<span class="fr-t">'+escH(s.t)+'</span>'+
          '</button>').join('')+
      '</div>'+
    '</div>';
  }catch(e){ return ''; }
}

function _wireFirstRun(root){
  const el = root || document;
  el.querySelectorAll('[data-fr-go]').forEach(b=>b.addEventListener('click',()=>{
    const s = _firstRunStarts()[+b.dataset.frGo]; if(!s) return;
    /* Retired the moment it is used. It has done its job, and a welcome that
       comes back is not a welcome. */
    _firstRunFinish();
    try{
      const ta = document.getElementById('mta');
      if(ta){
        ta.value = s.p;
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      }
      const card = b.closest('.fr-card'); if(card) card.remove();
    }catch(e){}
  }));
  /* Choosing what it is for redraws the card in place with that goal's
     starts; it is remembered here, so the card is the same if they come back
     to it before starting. */
  el.querySelectorAll('[data-fr-goal]').forEach(b=>b.addEventListener('click',()=>{
    try{ saveStr(FIRSTRUN_GOAL_KEY, b.dataset.frGoal); }catch(e){}
    const card = b.closest('.fr-card'); if(!card) return;
    const tmp = document.createElement('div'); tmp.innerHTML = _firstRunHTML();
    const fresh = tmp.firstElementChild; if(!fresh) return;
    card.replaceWith(fresh); _wireFirstRun(fresh.parentNode);
    const first = fresh.querySelector('[data-fr-go]'); if(first) first.focus();
  }));
  el.querySelectorAll('[data-fr-skip]').forEach(b=>b.addEventListener('click',()=>{
    _firstRunFinish();
    const card = b.closest('.fr-card'); if(card) card.remove();
  }));
}
try{ window._firstRunHTML=_firstRunHTML; window._wireFirstRun=_wireFirstRun; }catch(e){}
