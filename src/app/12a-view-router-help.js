/* === RENDER VIEW ROUTER === */
/* ONE OPENING, ONE ENTRANCE.

   Every view is a child of `#vc`, and `#vc > *` carries `viewEnter` - a fade
   and an 8px rise. That is right the first time a screen appears and wrong
   every time after, and several screens repaint two to four times in their
   first second on purpose: Crew paints from what is on disk, again when the
   server answers what it is running, again when the connector list lands.
   Handoff and Connectors do the same.

   MEASURED, AND THE FIRST ATTEMPT AT THIS MEASURED THE WRONG THING. It removed
   the `fi` class from `.sv`, which is a legacy entrance a later layer had
   already superseded - so it changed nothing, and it could not have covered
   Build, Lab or Chat in any case, because those write `.dev-shell`,
   `.lab-shell` and their own markup rather than `.sv`. The owner reported
   exactly those two still buffering and was right.

   With server answers stubbed to arrive instantly the repaints all land before
   the first frame and the browser coalesces them, which is why this looked
   fixed. Given a realistic 400ms, Crew replays the entrance TWICE, Handoff
   twice, Connectors twice. That is the flicker.

   So it is handled where it actually lives - on `#vc`'s own child, whatever
   that child is - and every view is covered by construction rather than by a
   list somebody has to extend. A repaint of the tab you are already on keeps
   its scroll and skips the entrance; a move to a different tab gets both. The
   observer runs as a microtask, before the frame is painted, so the animation
   is never started rather than cut off halfway. */
let _vcTab = '', _vcScroll = null;
/* The scrolled element is remembered by its first class rather than by a list
   of the containers each view happens to use - `.sv` on most, `.lab-shell` on
   Lab, `.dev-chat-pane` on Build. A list of those is a list that goes stale the
   next time somebody adds a surface. */
function _vcRemember(e){
  const el = e.target;
  if(!el || el === document || !el.classList || !el.classList.length) return;
  if(!(el.scrollTop > 0)) return;
  _vcScroll = { cls: el.classList[0], top: el.scrollTop };
}
/* A DEDUPE ON THE VIEW CONTAINER WAS TRIED HERE AND TAKEN BACK OUT.

   The idea was to drop a write to `innerHTML` that would produce what is
   already on screen. It measured as worth nothing: Crew's rebuild count went
   from four to three and Handoff's from two to one, and BOTH of those came
   from the coalescing below - the dedupe never fired on a write that mattered,
   because two renders 7ms apart are two different states, not the same one
   twice.

   It was not free, though. A renderer writes `innerHTML` and then attaches to
   the nodes it just made; skipping the write leaves the OLD nodes in place and
   the attach runs against them again. The gate found the consequences in three
   suites - controls that did nothing, downloads that produced no file - which
   is a worse outcome than the flicker it was aimed at, for no measured gain.

   Written down rather than silently dropped: the next person to notice
   repeated identical renders will reach for exactly this, and the reason it
   does not work is not visible from the idea. */

/* A DATA ARRIVAL IS NOT A REASON TO REDRAW IMMEDIATELY.

   Crew's two remaining rebuilds were two different requests landing 87ms
   apart, each redrawing the whole screen. Nobody can read a screen that is
   replaced twice in a tenth of a second, and the second one is the one that
   matters, so the first is pure churn. Trailing edge on purpose: the render
   runs once, after things have stopped arriving, with everything that arrived.

   Only the ASYNC callers use this. A render caused by somebody clicking
   something stays synchronous, because a control that responds on the next
   frame feels broken in a way this is meant to fix. */
/* `_vcInUse` WAS HERE AND IS GONE, WHICH IS THE BETTER ANSWER.

   It returned true when any field in the view held text, and the coalesced
   redraw used it to CANCEL itself rather than risk wiping a draft. That is the
   wrong trade on a screen where things arrive: a word left in the Crew command
   box meant nothing new ever appeared - an approval waiting on somebody was not
   shown until they cleared the box - and a screen that has quietly stopped
   updating is worse than one that flickers.

   The redraw now happens and the typing is carried across it by
   `_vcSnapshotInputs` / `_vcRestoreInputs` above: values, focus and the cursor
   position. Measured: the field is genuinely replaced and the half-typed
   command, the focus and the caret at offset 4 all survive. */


/* WHAT SOMEBODY HAS TYPED, TAKEN BEFORE A REDRAW AND PUT BACK AFTER IT.

   These two are what let the coalesced redraw stop cancelling itself. The
   comment above described them before they existed: the call sites shipped and
   the definitions did not, so _reRenderSoon threw a ReferenceError before
   reaching the render - and every background repaint on Crew and Handoff was
   dead rather than merely cancelled. Worse than the fault it replaced, and
   silent, because the throw landed in a timer nobody was watching.

   Keyed by id, which is what these renderers give their fields anyway. A field
   with no id cannot be matched across a redraw and is left alone.

   Only an EMPTY field is refilled. A renderer that puts a real value in - a
   name that came back from the server, a corrected figure - has said something
   newer than the draft, and overwriting it with what was on screen a tenth of
   a second ago would be this function causing the exact loss it exists to
   prevent. */
function _vcSnapshotInputs(){
  const out = [];
  try{
    const vc = document.getElementById('vc'); if(!vc) return out;
    const active = document.activeElement;
    vc.querySelectorAll('input[id], textarea[id], select[id]').forEach(el=>{
      const focused = (el === active);
      const val = (typeof el.value === 'string') ? el.value : '';
      if(!focused && !val) return;
      const rec = { id: el.id, val, focused, start: null, end: null };
      /* selectionStart throws on the input types that do not support it
         (email, number, date) - reading it is the check. */
      try{ rec.start = el.selectionStart; rec.end = el.selectionEnd; }catch(e){}
      out.push(rec);
    });
  }catch(e){}
  return out;
}
function _vcRestoreInputs(keep){
  if(!keep || !keep.length) return;
  try{
    for(const rec of keep){
      const el = document.getElementById(rec.id);
      if(!el || typeof el.value !== 'string') continue;
      if(rec.val && !el.value) el.value = rec.val;
      if(!rec.focused) continue;
      try{ el.focus({ preventScroll:true }); }catch(e){ try{ el.focus(); }catch(e2){} }
      if(rec.start === null || rec.start === undefined) continue;
      try{ el.setSelectionRange(rec.start, rec.end); }catch(e){}
    }
  }catch(e){}
}
try{ window._vcSnapshotInputs=_vcSnapshotInputs;
     window._vcRestoreInputs=_vcRestoreInputs; }catch(e){}

let _rrTimer = null, _rrFn = null, _rrTab = '';
function _reRenderSoon(fn, tab){
  _rrFn = fn; _rrTab = tab || '';
  if(_rrTimer) return;
  _rrTimer = setTimeout(()=>{
    _rrTimer = null;
    const f = _rrFn, want = _rrTab; _rrFn = null; _rrTab = '';
    /* THE TAB IS CHECKED WHEN THIS FIRES, NOT WHEN IT WAS SCHEDULED.

       This is what made delaying these dangerous. Every caller asks "are they
       still on my screen?" before scheduling, which was the right question at
       the wrong moment: 120ms is long enough to leave, and the renderer then
       ran anyway and painted its own screen over the one somebody had moved
       to. A suite caught it by opening Handoff straight after Crew, typing
       into the form and sending - the form had been replaced by Crew, the
       send found nothing to send, and an unsent handoff vanished in silence.

       Asking again here is the whole guard: a redraw belongs to the screen it
       was scheduled for, and if that is not the screen in front of somebody it
       does not happen at all. The state it would have shown is stored either
       way and the next open is correct. */
    if(want && S.tab !== want) return;
    /* WHAT SOMEBODY TYPED IS CARRIED ACROSS THE REDRAW, NOT USED TO CANCEL IT.

       This used to return here when any field in the view held text, so a
       background arrival was dropped rather than risk wiping a draft. That is
       the wrong trade on a screen where things ARRIVE: leave a word in the Crew
       command box and nothing new ever appears - an approval waiting on you is
       not shown until you clear the box, and a screen that silently stops
       updating is worse than one that flickers.

       So the redraw happens and the typing survives it. Values, focus and the
       cursor position are taken before and put back after, keyed by id, which
       is what the renderers give these fields anyway. */
    const keep = _vcSnapshotInputs();
    try{ if(typeof f === 'function') f(); }catch(e){}
    _vcRestoreInputs(keep);
  }, 120);
}

/* FORGETTING WHERE YOU WERE, ON PURPOSE.

   `_vcScroll` exists so a repaint does not lose somebody's place, which is
   right for a repaint and wrong for a NEW PAGE inside the same tab. The
   connector directory is the case: See more replaces thirty rows with one
   category, the tab has not changed, so the observer below restored the scroll
   position of the page that is no longer there - and the category opened 622
   pixels into itself. Setting scrollTop to 0 did not help, because the
   observer runs after it and puts it back.

   So the position is FORGOTTEN rather than fought with. Exported because the
   screen that knows it has opened something new lives in another module, and
   `_vcScroll` is a top-level binding in one bundle - a script binding, never a
   property of window, which the gate has a whole stage about. */
function _vcForgetScroll(){ _vcScroll = null; }
try{ window._vcForgetScroll = _vcForgetScroll; }catch(e){}

function _vcSettleObserve(){
  const vc = document.getElementById('vc');
  if(!vc || vc._vcObs) return;
  vc.addEventListener('scroll', _vcRemember, true);
  const obs = new MutationObserver(()=>{
    /* Which tab we are on is recorded whether or not this view has anything to
       restore - chat has no scroller of its own - because the alternative was
       returning early and leaving `_vcTab` naming the tab before last. */
    const same = _vcTab === S.tab;
    if(!same){ _vcTab = S.tab; _vcScroll = null; }
    const root = vc.firstElementChild;
    if(!root) return;
    if(!same) return;
    root.classList.add('vc-repaint');
    if(_vcScroll){
      const el = root.classList.contains(_vcScroll.cls)
        ? root : root.querySelector('.' + _vcScroll.cls);
      if(el) el.scrollTop = _vcScroll.top;
    }
  });
  obs.observe(vc, { childList:true });
  vc._vcObs = obs;
}
function renderView(){
  const vc=$('vc'); if(!vc) return;
  if(S.tab!=='settings') _settingsLayerClose();
  switch(S.tab){
    case 'dashboard': renderDashboard(); break;
    case 'chat': renderChatView(); break;
    case 'prompts': renderPromptsView(); break;
    case 'workspaces': goSettings('projects'); return;
    case 'memory': renderMemoryView(); break;
    case 'team': renderTeamView(); break;
    case 'usage': renderUsageView(); break;
    case 'billing': renderBillingView(); break;
    /* Its own tab, so it is a PAGE: it gets the whole view, the back control
       goes somewhere real, and nothing from the screen you came from is left
       around it competing for the decision. */
    case 'upgrade': renderUpgradeView(); break;
    /* Pricing is not a place of its own any more - a plan's price and a
       plan's limits are the same decision, and splitting them is what let a
       Pricing page disagree with the thing enforcing it. Both live on
       Spending. The old address still resolves, so a bookmark or a link from
       an older build lands somewhere sensible rather than on a 404. */
    /* Two screens again, on purpose: Upgrade (every "See plans" and "Upgrade"
       button, `plans`) is the plans and nothing else; the Spending rail entry
       (`spend`) is the money AMV may spend for you. */
    case 'spend': renderSpendView(); break;
    case 'plans': renderPlansView(); break;
    case 'settings': renderSettingsView(); break;
    case 'help': renderHelpView(); break;
    /* Apps & Extensions was removed (asked for): it listed desktop and store
       apps that do not exist yet. An old link to it opens Integrations, where
       connecting things really happens. */
    case 'apps': S.tab='integrations'; renderIntegrationsView(); break;
    case 'tasks': renderTasksView(); break;
    case 'integrations': renderIntegrationsView(); break;
    /* RENDER FROM WHAT IS HERE, THEN ASK THE SERVER.

       Crew job state is WRITTEN to the server on every toggle - AMV_API.toggleJob
       fires from cwToggle and _cwToggleReal. It was READ back by exactly one
       function, _crewSyncLive, and nothing called it. So switching a job on from
       a phone and opening Crew on a laptop showed the laptop's own stale
       picture: the server had the truth, the endpoint existed, the write half
       ran on every toggle, and the read half was never reached.

       Not awaited, deliberately. The local list renders immediately and the
       server's answer updates it when it arrives - blocking the screen on a
       network round trip to show something already on disk would be a slower
       product for a fresher one nobody was waiting for. */
    case 'extensions': renderCrewView(); _crewSyncLive(); break;
    case 'crew': renderCrewView(); _crewSyncLive();
      /* A job may have sent somebody off to connect something. Arriving back
         on Crew is what "go back" means for the two routes that are tab
         changes, so the requirements screen reopens here - once, and only
         for an intent that is still fresh. */
      try{ setTimeout(() => { try{ if(typeof cwResumeIfAny === 'function') cwResumeIfAny(); }catch(e){} }, 400); }catch(e){}
      break;
    /* One door for all three (AMV-D007 step 2). The renderers behind it are
       unchanged; this is only where they are reached from. */
    /* One entry in the sidebar, three sections inside it. The old tab names
       stay so a deep link, a saved session or an older handoff naming
       `studio` still lands on Build in that section rather than a 404. */
    case 'build':
    case 'studio':
    case 'dev':
    case 'lab': renderBuildView(); break;
    /* Same shape, same fix: AMV_API.listHandoff appeared once in the whole
       client, inside _handoffSyncLive, which nothing called. A handoff sent to
       you was invisible until you happened to be on the device that sent it. */
    case 'handoff': renderHandoffView(); _handoffSyncLive(); break;
    case 'market': renderMarketView(); break;
    /* Its own section, because it was a row inside Integrations and that is
       the reason nobody knew any of this existed. */
    case 'admin': _openAdmin(); break;
    case 'notfound': render404View(); break;
    default: render404View();
  }
}

/* The Pricing page's renderer (renderPlansView) lived here. Pricing stopped
   being a place when Spending took its route - `plans` renders Spending - and
   the function sat with no caller, shipped to every visitor. Its parts below
   are still used by Spending and the upgrade screen. */
/* HOW THE LIMIT BEHAVES, SAID BEFORE SOMEBODY MEETS IT.

   Every number on the cards above is a ceiling, and a ceiling with no shape is
   read as a cliff: people assume a monthly pot that runs out on the 22nd,
   because that is how most of this market works and because nobody tells them
   otherwise until the refusal.

   Three shapes, and all three are enforced server-side on every request rather
   than described here:

     the five-hour window, which is the one somebody meets, and which comes
     back the same day rather than next month;

     the weekly window on the top engines, which is the number actually holding
     the price up and is therefore the number most worth being honest about;

     and the monthly total, which is sized so that a person cannot reach it -
     Pro is about seven messages a minute, eight hours a day, every day.

   Written as three plain statements with the real figures in them. A page that
   explains its own limits sells the plan; a page that hides them sells one
   month. */
function _planAllowsApex(p){
  if(p==='custom') return true;
  const t=PLAN_TIERS[p==='team'?'pro':p]; return !!(t && t.models.indexOf('smart')>=0);
}
function _usageShapeBand(){
  const plan=(typeof loadStr==='function' && loadStr('amv_plan')) || 'free';
  const shown=(plan==='free')?'pro':plan;
  const pname=PLANS[shown]?PLANS[shown].name:'Pro';
  const perMin=Math.max(1, Math.round(_planMsgNum(PLAN_MONTH_MESSAGES, shown)/(30*8*60)));
  const item=(t,d)=>'<div class="ushape-i"><div class="ushape-t">'+t+'</div>'+
                    '<div class="ushape-d">'+d+'</div></div>';
  return '<section class="ushape" aria-label="How your limit works">'+
    '<div class="ushape-h">How the limit actually works</div>'+
    '<div class="ushape-g">'+
      item(escH(T('It comes back every {0} hours').replace('{0}', USAGE_WINDOW_HOURS)),
           escH(T('Not one monthly cliff. On {plan} that is {0} messages per window, and the window rolls - a hard afternoon does not cost you the evening.')
             .replace('{plan}', pname).replace('{0}', _msg5hLabel(shown))))+
      item(escH(T('The top engines have their own weekly number')),
           /* Pro has Forge and not Apex, so it is told about the one it has. */
           escH(T(_planAllowsApex(shown)
               ? 'Forge and Apex are the expensive ones, so they are counted separately: {0} a week on {plan}. Everything else keeps running at full speed when that runs out, rather than the account stopping.'
               : 'Forge is the expensive one, so it is counted separately: {0} a week on {plan}. Everything else keeps running at full speed when that runs out, rather than the account stopping.')
             .replace('{plan}', pname).replace('{0}', _topWeekLabel(shown))))+
      item(escH(T('The monthly total is not meant to be reachable')),
           /* Worked out from the plan's own number - "one every nine seconds"
              was Pro's figure, printed for every plan. */
           escH(T('{0} messages a month is about {1} a minute, eight hours a day, every day. It exists as an anti-abuse ceiling - not as the thing you ration.')
             .replace('{1}', perMin.toLocaleString()).replace('{0}', _msgMonthLabel(shown))))+
    '</div>'+
    '<p class="ushape-f">Every one of these is checked on the server before a request runs, '+
      'and where you stand is always under Settings, Plan &amp; billing.</p>'+
  '</section>';
}
try{ window._usageShapeBand=_usageShapeBand; }catch(e){}

/* === HELP CENTER === */
/* A real 404 for unknown routes - instead of silently showing chat, tell the
   user the page wasn't found and give them a clear way back. */
function render404View(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi nf-wrap">'+
      '<div class="nf-code">404</div>'+
      '<h2 class="nf-title">Page not found</h2>'+
      '<p class="nf-sub">The page you\u2019re looking for doesn\u2019t exist or may have moved.</p>'+
      '<div class="nf-actions">'+
        '<button class="btn bp" data-stab="chat">Go to chat</button>'+
        '<button class="btn bs" data-stab="dashboard">Home</button>'+
      '</div>'+
    '</div></div>';
}
try{ window.render404View=render404View; }catch(e){}

/* THE ONLY WAY IN WAS TO ALREADY KNOW THE WORD (AMV-D056).

   Twenty questions in one flat accordion under a search box. Search is a good
   second route and a poor first one: somebody who does not yet know what AMV
   calls a thing cannot search for it, and scanning twenty rows to find out is
   the work the page exists to save.

   The questions are unchanged. They are grouped now, each group is a filter
   chip, and search still runs across every answer regardless of the chip - so
   the two routes do not fight. A group with nothing left after a search hides
   its heading too, which is the bug this kind of filtering usually ships with. */
const FAQ_CATS=[
  ['start','Getting started'],
  ['chat','Chat and results'],
  ['create','Design and 3D'],
  ['build','Building apps'],
  ['auto','Automations and approvals'],
  ['connect','Connections, teamwork and marketplace'],
  ['billing','Plans and billing'],
  ['privacy','Memory, data and privacy']
];

/* The questions themselves live in help-faqs.js, fetched when Help opens. */
let _faqsP = null;
function _faqsLoad(){
  if(Array.isArray(window._FAQS)) return Promise.resolve(true);
  if(!_faqsP) _faqsP = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'help-faqs.js';
    sc.onload = () => res(Array.isArray(window._FAQS));
    sc.onerror = () => { _faqsP = null; sc.remove(); res(false); };
    document.head.appendChild(sc);
  });
  return _faqsP;
}
function renderHelpView(){
  const vc=$('vc'); if(!vc) return;
  /* The questions arrive from help-faqs.js the first time; everything else on
     this screen is drawn at once, and the questions fill in when they land. */
  const _faqsHere=Array.isArray(window._FAQS);
  if(!_faqsHere) _faqsLoad().then(ok=>{
    if(S.tab!=='help') return;
    if(ok){ renderHelpView(); return; }
    const n=document.getElementById('faq-loading');
    if(n) n.textContent=T('The questions could not be loaded. Check your connection and try again.');
  });
  const FAQS=_faqsHere?window._FAQS:[];
  const chips='<div class="hc-chips" role="group" aria-label="Filter help by topic">'+
    '<button class="hc-chip on" data-hcc="all">All</button>'+
    FAQ_CATS.map(c=>'<button class="hc-chip" data-hcc="'+c[0]+'">'+escH(c[1])+'</button>').join('')+
  '</div>';
  const groups=FAQ_CATS.map(c=>{
    const items=FAQS.map((f,i)=>[f,i]).filter(x=>x[0].c===c[0]);
    if(!items.length) return '';
    return '<section class="hc-group" data-hcg="'+c[0]+'">'+
      '<h3 class="hc-group-h">'+escH(c[1])+'</h3>'+
      items.map(x=>
        '<div class="faq-item" id="fi-'+x[1]+'" data-hcg="'+c[0]+'">'+
          '<div class="faq-q" data-fi="'+x[1]+'"><span>'+x[0].q+'</span><span class="faq-arr">+</span></div>'+
          '<div class="faq-a">'+x[0].a+'</div>'+
        '</div>').join('')+
    '</section>';
  }).join('');
  vc.innerHTML=
    '<div class="sv fi"><div class="vi vi-help">'+
      '<span class="eyebrow">Help</span>'+
      '<h2>Help Center</h2>'+
      '<p class="vsub">Pick a topic, or search if you already know the word for it.</p>'+
      '<div class="ss2">'+
        '<input type="search" id="faq-search" placeholder="Search help…" aria-label="Search help" style="font-size:var(--t-lg);margin-bottom:13px">'+
        chips+
        '<div id="faq-list">'+(_faqsHere?groups:'<p class="vsub" id="faq-loading" role="status">'+escH(T('Loading…'))+'</p>')+'</div>'+
        '<p id="faq-none" class="hc-none" hidden>No answer matches that. Try a different word, or ask AMV below - it can answer from the product itself.</p>'+
      '</div>'+
      _appsCardHTML()+
      '<div class="ss2"><h3>Share feedback</h3>'+
        '<p style="font-size:var(--t-sm);color:var(--mu);margin-bottom:12px;line-height:1.55">Found a bug or have an idea? Tell us - real feedback shapes what we build next.</p>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          '<button class="btn bp" style="font-size:var(--t-sm)" data-dact="openFeedback" data-darg="bug">Report a bug</button>'+
          '<button class="btn bs" style="font-size:var(--t-sm)" data-dact="openFeedback" data-darg="idea">Suggest a feature</button>'+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>Still need help?</h3>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          supportButton({label:'Email Support',cls:'btn bp',subject:'AMV Support request'})+
          '<button class="btn bs" style="font-size:var(--t-sm)" data-dact="askAmv" data-darg="">Ask AMV directly</button>'+
        '</div>'+
        (_supportEmail()?'<p style="font-size:var(--t-sm);color:var(--mu);margin-top:10px">Or email us directly at <b style="color:var(--tx)">'+escH(_supportEmail())+'</b> - we reply within 24 hours.</p>':'')+
      '</div>'+
    '</div></div>';
  _appsCardWire();
  vc.querySelectorAll('.faq-q').forEach(q=>{
    q.addEventListener('click',()=>{
      document.getElementById('fi-'+q.dataset.fi)?.classList.toggle('open');
    });
  });

  /* One function decides what is visible, from the two inputs, every time.
     Two independent handlers each hiding rows is how a chip and a search box
     end up disagreeing about the same row. */
  let cat='all';
  function apply(){
    const s=(($('faq-search')||{}).value||'').toLowerCase().trim();
    let shown=0;
    vc.querySelectorAll('.faq-item').forEach(item=>{
      const f=FAQS[+item.querySelector('.faq-q').dataset.fi];
      const okCat = cat==='all' || f.c===cat;
      const okTxt = !s || f.q.toLowerCase().includes(s) || f.a.toLowerCase().includes(s);
      const on = okCat && okTxt;
      item.hidden = !on;
      if(on) shown++;
    });
    /* A heading over nothing reads as a group with no answers in it. */
    vc.querySelectorAll('.hc-group').forEach(g=>{
      g.hidden = !g.querySelector('.faq-item:not([hidden])');
    });
    const none=$('faq-none'); if(none) none.hidden = shown>0;
  }
  vc.querySelectorAll('[data-hcc]').forEach(b=>b.addEventListener('click',()=>{
    cat=b.dataset.hcc;
    vc.querySelectorAll('[data-hcc]').forEach(x=>x.classList.toggle('on',x===b));
    apply();
  }));
  on($('faq-search'),'input',apply);
}

