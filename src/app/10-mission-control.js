/* ============================================================
   AMV CO-WORKER  - autonomous agent: standing jobs + approval inbox
   The differentiator: it watches your connected accounts and proposes
   actions (draft replies, summaries, bookings). You approve or reject
   each one with a click. Nothing is sent without your OK.
   ============================================================ */
function _cwJobs(){ return load('amv_cw_jobs') || _cwDefaultJobs() || []; }

/* ── THE EVERYDAY JOBS JOIN THE DEFINITIONS, NOT THE LIST ────────────────────

   The server sync rebuilds `amv_cw_jobs` from _cwDefaultJobs() on every run -
   deliberately, because the definitions are the source of truth for what a job
   IS and the server only says whether it is ON. Which means a job appended to
   somebody's saved list is silently deleted the next time that sync runs.

   So these are cached where the definitions are read from, and _cwDefaultJobs
   returns the built-in jobs FIRST and unchanged, with the everyday ones after.
   Nothing that was already there moves, changes id, or disappears. */
function _everydayDefs(){
  const d = load('amv_everyday_defs');
  return Array.isArray(d) ? d : [];
}
function _everydayCache(list){
  store('amv_everyday_defs', Array.isArray(list) ? list : []);
}
function _cwSaveJobs(j){ store('amv_cw_jobs', j); }
/* ── THE CATALOGUE IS FETCHED, NOT SHIPPED ──────────────────────────────────

   The built-in jobs and the country lists live in crew-data.js (~58KB
   compressed), fetched the first time Crew is opened rather than downloaded by
   every visitor. Until it has arrived, _cwDefaultJobs() answers null - never
   an empty list - so nothing can rebuild somebody's saved jobs from it and
   delete the built-in ones they had switched on. Every rebuild waits for
   _loadCrewData(). */
let _crewDataP = null;
function _cwCatalog(){ return (typeof window !== 'undefined' && window.AMV_CREW_DATA) || null; }
function _loadCrewData(){
  if(_cwCatalog()) return Promise.resolve(true);
  if(_crewDataP) return _crewDataP;
  _crewDataP = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'crew-data.js';
    s.onload = () => res(!!_cwCatalog());
    s.onerror = () => { _crewDataP = null; s.remove(); res(false); };
    document.head.appendChild(s);
  });
  return _crewDataP;
}
/* FETCHED BEFORE ANYBODY ASKS, ONCE THE PAGE HAS SETTLED.

   Out of the page so the first paint does not wait on it - and then fetched
   as soon as the browser is idle, so opening Crew draws the catalogue at
   once instead of flashing a loading line first. Somebody who has asked
   their phone to save data is left alone: Crew fetches it when they open it.
   A failed fetch here costs nothing; _loadCrewData tries again on open. */
function _crewPrefetch(){
  try{ if(navigator.connection && navigator.connection.saveData) return; }catch(e){}
  const go = () => { try{ _loadCrewData(); }catch(e){} };
  if(typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 8000 });
  else setTimeout(go, 3000);
}
function _cwDefaultJobs(){
  const c = _cwCatalog();
  if(!c) return null;
  return c.jobs.map(j => Object.assign({}, j)).concat(_everydayDefs());
}
function _cwMadeForList(){ const c = _cwCatalog(); return c ? c.madeFor : []; }
function _cwMadeMoreList(){ const c = _cwCatalog(); return c ? c.madeMore : []; }
/* ── WHAT A JOB NEEDS, AGAINST WHAT IS ACTUALLY CONNECTED ────────────────────

   Every preset already declared its requirements in `needs`, and nothing ever
   checked them. Turning on "Morning money summary" with no bank linked flipped
   a switch, showed an active card, and did nothing - forever, silently. With
   seventy jobs on the page that stops being an edge case and becomes the
   default experience, so the requirement is now read rather than displayed.

   Web research and web automation run server-side and need nothing from the
   user, which is why they are absent here. */
/* `cap` is the capability the check asks about, written out beside the check
   that asks it. The two were the same string already; saying it once means the
   connect screen can offer the providers that really grant it, read from the
   server's own provider list, instead of a second table here that would drift
   from this one the first time a provider was added. */
const CW_NEEDS_CHECK = {
  /* NOT "GMAIL". The capability is a MAILBOX, and the server grants it from
     Google or from Microsoft already - so naming one of them on the card was
     wrong even before AMV left the United States. It is worse now: somebody in
     Jakarta reading "connect Gmail" on a job that wants their Outlook work
     account is being told to go and get an account they may not have and do not
     need. `_cwNeedLabelFor` names the provider they have actually connected
     when there is one, and the capability itself when there is not. */
  'Email':           { label:'a mailbox',        cap:'mail.read',     has:()=>_cwConnHas('mail.read') },
  'Calendar':        { label:'a calendar',       cap:'calendar.read', has:()=>_cwConnHas('calendar.read') },
  'Drive':           { label:'your files',       cap:'drive.read',    has:()=>_cwConnHas('drive.read') },
  /* Read-only, and on the same Google connection - so a student who has linked
     Google for their mail already has this. A job needing it that runs with
     nothing connected would switch on and do nothing for ever, which is the
     failure this whole table exists to prevent. */
  /* Asked of the CONNECTION, not of the sign-in. _cwHasGoogle answers "is
     somebody signed in with Google", which is a different question and was
     being used to answer this one: a student who had only ever pressed Sign in
     with Google was told Classroom was available, switched the job on, and it
     ran every morning with no permission to read anything. */
  'Classroom':       { label:'your coursework',  cap:'school.read',   has:()=>_cwConnHas('school.read') },
  /* A PROFILE THAT NEVER LEAVES THIS DEVICE IS A REQUIREMENT LIKE ANY OTHER.

     Job hunt reads the roles, locations and salary floor from the Job Hunt
     profile, which is stored under `amv_jobhunt` - and `_SYNC_KEYS` carries
     convs, memory, workspaces, prompts and model, not that. So the server
     runner cannot see it, and a job whose only other need is web research was
     being classified as running with AMV closed while the data it works from
     sits in one browser.

     Declaring it makes three things true at once: the card asks for it when it
     is empty, says ready when it is filled, and stops claiming the job runs
     unattended - because not every need is web research any more. No `cap`,
     for the same reason the bank link has none: there is no grant to request,
     it is a screen the person fills in. */
  'Job hunt profile': { label:'your job hunt profile',
    has:()=>{ try{ return typeof AMVJobs !== 'undefined'
      && !AMVJobs.missingInfo({}, AMVJobs.cfg()).length; }catch(e){ return false; } } },
  /* Through the one accessor, so "is an account linked" has a single definition
     that the server refresh keeps current. Reading the key directly here meant
     this screen and the investing pane could disagree. */
  /* ONE DEFINITION, and it is `_cwConnHas`.

     This row used to ask `AMVFinance.linked()` itself while `_cwUnattendedReady`
     asked `_cwConnHas('bank.read')` - which looks in the connector grants, where
     a bank link has never lived, so it answered no for every account. The card
     said ready and the same job was classified as browser-only in the next
     function down. `_cwConnHas` routes `bank.read` to this accessor now, so
     both questions land on the record that actually holds the token.

     AND STILL NO `cap` ON THIS ROW. One was added here for uniformity and it
     broke the thing the comment above `_cwMissingNeeds` exists to protect:
     that function keys on `cap` to mean "a connector could supply this", so
     declaring one sent a bank job to `openCrewConnect`, a screen whose only
     honest answer for a bank is "there is nothing to connect". A bank is
     linked from the Spending pane through the aggregator's own hosted flow;
     there is no OAuth provider to offer for it and no button that screen could
     draw. `crew-jobs` caught it, which is the second half of the rule this
     repository already has written down: a comment saying "this is safe
     because X" is a test plan, so go and test X. */
  'Bank connection': { label:'a bank connection',
    has:()=>{ try{ return _cwConnHas('bank.read'); }catch(e){ return false; } } },
};
/* _cwHasGoogle STOOD HERE AND ANSWERED THE WRONG QUESTION FOR A LONG TIME.

   It meant "is Google linked", and screen after screen used it to decide
   whether AMV could READ somebody's account - which it never could answer,
   because a sign-in proves identity and grants access to nothing. That is how a
   row came to show Gmail as connected on an account that had granted no mail
   scope at all.

   Every one of those callers asks _cwConnHas(capability) now: the server's own
   list of grants, per capability, so a mailbox reads as connected exactly when
   the mailbox was granted. And the token machinery it was built on is gone -
   no Google credential reaches this browser any more, so there is nothing left
   here for it to look at.

   If you need "is this person signed in", that is S.user. If you need "may AMV
   do X", that is _cwConnHas('X'). They were one function for a while and that
   was the bug. */

/* ── WHERE A JOB CAN ACTUALLY RUN ────────────────────────────────────────────

   The unattended runner on the server can search the live web and write. It has
   no mailbox, no calendar and no browser session - those live in THIS tab,
   behind a Google token the server never sees.

   So a job needing only web research genuinely runs with AMV closed, and one
   needing Gmail genuinely does not. Both used to be the same switch, and that
   switch wrote a boolean nothing ever read: turning on a standing job created
   no scheduled work anywhere. A web-research job now creates a real automation
   on the server, and a job that needs this tab says so on its face rather than
   implying an inbox it will never reach. */
/* Jobs whose scheduled work is being created right now. Counted against the
   plan allowance so a fast hand cannot switch on more than it sells. */
const _cwPending = new Set();
function _cwRunsUnattended(j){
  const needs=String((j&&j.needs)||'').split(',').map(s=>s.trim()).filter(Boolean);
  return needs.length>0 && needs.every(n=>n==='Web research');
}
/* WHERE A JOB RUNS, SAID THE RIGHT WAY ROUND.

   Three states, not two. A job either runs on the server whatever you are
   doing, runs there as soon as the account it needs is connected, or genuinely
   needs this tab open.

   The middle one used to be phrased "Runs while AMV is open - connect the
   account to run it closed", and that is the wrong way round. It leads with
   the limitation and buries the capability, so forty-nine of a hundred and six
   jobs read as "this needs my laptop awake" when what is true is that they run
   without it the moment you connect an account. Only seven are genuinely
   open-only. Reported as exactly that: "there are so many that should say run
   when amv is closed but it says run when amv is open".

   Leading with what it does is not overpromising, because the condition is
   still in the sentence. Naming the account makes the condition actionable
   rather than a shrug. */
function _cwWhereState(j){
  if(_cwRunsUnattended(j)) return 'closed';
  if(typeof _cwUnattendedReady === 'function' && _cwUnattendedReady(j)) return 'closed';
  const needs = String((j && j.needs) || '').split(',').map(x => x.trim()).filter(Boolean);
  const mappable = needs.length && needs.every(n => n === 'Web research' || _CW_NEEDS_TO_USES[n]);
  return mappable ? 'pending' : 'open';
}
function _cwWhereLabel(j){
  const st = _cwWhereState(j);
  if(st === 'closed') return 'Runs with AMV closed';
  if(st === 'open')   return 'Runs while AMV is open';
  /* Name what is missing, so the sentence tells you what to do about it. */
  let missing = [];
  try{ missing = (typeof _cwNeedsMissing === 'function') ? _cwNeedsMissing(j) : []; }catch(_e){}
  const who = missing.length ? missing.slice(0, 2).join(' and ') : 'your account';
  return 'Runs with AMV closed - once ' + who + ' is connected';
}
try{ window._cwWhereState=_cwWhereState; window._cwWhereLabel=_cwWhereLabel; }catch(e){}
/* A REQUIREMENT NOBODY RECOGNISES IS NOT A REQUIREMENT THAT IS MET.

   This read `CW_NEEDS_CHECK[n]` and, when the name was not in the table,
   skipped it - so a need the table had never heard of contributed nothing to
   the missing list and the job reported itself ready. Five names were known:
   Email, Calendar, Drive, Classroom and a bank link. Every other service on
   earth was therefore "connected" by default.

   That matters more the moment the catalogue stops being about Gmail. AMV is
   used from Lagos and Jakarta and Sao Paulo, and the job somebody there wants
   needs WhatsApp, M-Pesa, UPI, Line, Vinted or Mercado Libre - none of which
   the table knew, all of which read as satisfied. The card would have said
   ready, the run would have found nothing, and the person would have been told
   afterwards that something they were never asked for was missing.

   So an unknown name fails CLOSED: it is listed as missing, by its own name,
   which is both the honest answer and the one that makes the catalogue safe to
   extend. Adding a service to the data can now only ever ask for too much,
   never too little. */
/* THE NAME OF THE THING THEY ACTUALLY HAVE.

   "A mailbox" is honest and a little cold. When somebody has already connected
   Outlook, the card can say Outlook - and when they have connected nothing, a
   capability is the only truthful thing to say, because AMV does not yet know
   which provider they will choose and must not pick one for them.

   Read off the server's own list of grants, so a deployment that registers a
   provider nobody here has heard of names it correctly with no change to this
   file. That is the property that makes the catalogue usable outside the
   handful of countries whose services somebody happened to hardcode. */
function _cwProviderNameFor(cap){
  try{
    const d = (typeof _connState !== 'undefined' && _connState) ? _connState.data : null;
    if(!d || !Array.isArray(d.items)) return '';
    const hit = d.items.find(it => it && it.unattended && !it.broken
      && Array.isArray(it.scopes) && it.scopes.indexOf(cap) >= 0);
    return (hit && (hit.providerName || hit.name || hit.provider)) ? String(hit.providerName || hit.name || hit.provider) : '';
  }catch(e){ return ''; }
}
try{ window._cwProviderNameFor=_cwProviderNameFor; }catch(e){}

/* WHAT THEY CONNECTED, NAMED BACK TO THEM.

   "All connected" is true and anonymous. Somebody who linked an Outlook
   account yesterday is better served by seeing the word Outlook, because that
   is how they know AMV means the thing they did rather than something it
   assumed. Where the server can name the provider, it is named; where it
   cannot - a bank link, a service with no provider row - the capability stands
   on its own, which is still the honest answer. */
function _cwReadyLine(j){
  const names = [];
  try{
    _cwNeedsList(j).forEach(n => {
      if(n === 'Web research' || n === 'Web automation') return;
      const c = CW_NEEDS_CHECK[n];
      const who = (c && c.cap) ? _cwProviderNameFor(c.cap) : '';
      const label = who || (c ? c.label : n);
      if(names.indexOf(label) < 0) names.push(label);
    });
  }catch(e){}
  if(!names.length) return 'All connected - ready to run';
  const list = names.length === 1 ? names[0]
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  return list + ' connected - ready to run';
}
try{ window._cwReadyLine=_cwReadyLine; }catch(e){}

function _cwNeedsList(j){
  return String((j&&j.needs)||'').split(',').map(s=>s.trim())
    .filter(Boolean).filter(n => n !== 'Nothing');
}
function _cwNeedsMissing(j){
  const out=[];
  _cwNeedsList(j).forEach(n=>{
    /* Web research needs no account and never did - it is a capability of the
       runner, not something anybody connects. */
    if(n === 'Web research' || n === 'Web automation') return;
    const c=CW_NEEDS_CHECK[n];
    const label = c ? c.label : n;
    const met = c ? c.has() : false;
    if(!met && out.indexOf(label)<0) out.push(label);
  });
  return out;
}
/* Does this job declare anything a person has to connect at all, and is every
   one of them already there? Both halves matter: a job needing nothing is not
   "ready because you connected things", it simply never needed you. */
function _cwNeedsAnything(j){
  return _cwNeedsList(j).some(n => n !== 'Web research' && n !== 'Web automation');
}
function _cwNeedsReady(j){
  return _cwNeedsAnything(j) && _cwNeedsMissing(j).length === 0;
}
/* THE OPTIONAL HALF, AND IT IS NOT ALLOWED NEAR THE OTHER ONE.

   `_cwBoostMissing` looks like `_cwNeedsMissing` and answers a different
   question, so the two lists are never concatenated anywhere. A boost that
   leaked into the missing list would make a working job read as blocked, refuse
   to say "ready to run", and send somebody off to connect a bank they may not
   be able to connect at all - the exact shape of the defect that made
   `_cwNeedsMissing` fail closed in the first place, arriving from the other
   direction. Named differently for that reason.

   The LABEL, not the raw name: the same table, so a boost is named the way a
   need is, and where the person has actually connected something the provider's
   own name is used. */
function _cwBoostList(j){
  return String((j && j.boost) || '').split(',').map(s => s.trim())
    .filter(Boolean).filter(n => n !== 'Nothing')
    .map(n => {
      const c = CW_NEEDS_CHECK[n];
      const who = (c && c.cap) ? _cwProviderNameFor(c.cap) : '';
      return who || (c ? c.label : n);
    })
    .filter((v, i, a) => a.indexOf(v) === i);
}
function _cwBoostMissing(j){
  const out = [];
  String((j && j.boost) || '').split(',').map(s => s.trim())
    .filter(Boolean).filter(n => n !== 'Nothing')
    .forEach(n => {
      const c = CW_NEEDS_CHECK[n];
      const label = c ? c.label : n;
      /* Unknown fails closed here too, but harmlessly: an unrecognised boost
         reads as absent, so the card says the job runs on what it can read,
         which is the truthful answer when nothing knows how to check it. */
      if(!(c ? c.has() : false) && out.indexOf(label) < 0) out.push(label);
    });
  return out;
}
try{ window._cwBoostList=_cwBoostList; window._cwBoostMissing=_cwBoostMissing; }catch(e){}
try{ window._cwNeedsList=_cwNeedsList; window._cwNeedsAnything=_cwNeedsAnything;
     window._cwNeedsReady=_cwNeedsReady; }catch(e){}
/* ── CONNECTING THE ONE ACCOUNT THIS JOB NEEDS ───────────────────────────────

   Asked for: turning a job on should take you to a screen that says "connect
   X to your AMV", then a dialog that asks for what the connection needs, and
   then it is connected. Simple.

   What happened instead was a toast - "Saved, but this cannot run until you
   connect Gmail" - and a Connect button that dropped you on the Connectors
   tab, in front of every provider AMV supports, with no mention of the job you
   had just switched on. Two screens away from the thing you asked for, and the
   reason you were there was on neither of them.

   ON NOT ASKING FOR A PASSWORD. The owner's words were "whatever password,
   email etc needed verification so people cant hack or do this trick to see
   other emails" - and the way to get that is the opposite of a password field.
   AMV must never ask for somebody's Google or Microsoft password: a product
   that renders a form asking for another company's credentials has taught its
   own users to fall for the next thing that looks like it. The sign-in happens
   at the provider, on the provider's own domain, and what comes back is a
   scoped grant held by the server against the signed-in AMV account. That is
   what makes "nobody can trick their way into somebody else's mail" true:
   there is no credential here to steal and no field to phish.

   The providers offered are the ones the SERVER says grant the capability this
   job needs, so a deployment that registers Microsoft gets Microsoft offered
   for mail without a line changing here. */
/* Only what a CONNECTOR can supply. A bank link is a missing requirement too
   and `_cwNeedsMissing` rightly reports it, but it is not an OAuth grant and
   there is no provider to offer for it - it is linked from the investing pane
   through its own flow. Returning it here would put a job in front of a screen
   whose only honest answer was "there is nothing to connect", which is worse
   than the sentence it already gets. */
function _cwMissingNeeds(j){
  const out=[];
  String((j&&j.needs)||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(n=>{
    const c=CW_NEEDS_CHECK[n];
    if(c && c.cap && !c.has() && !out.some(x=>x.cap===c.cap)) out.push({ need:n, label:c.label, cap:c.cap });
  });
  return out;
}
/* Providers the server says can grant this capability, and whether the
   deployment has an app registered with each. Empty is an answer: it means
   nobody has set this up, and the screen says that rather than showing a
   button that cannot work. */
function _cwProvidersFor(cap){
  try{
    const d=(typeof _connState!=='undefined'&&_connState)?_connState.data:null;
    return ((d&&d.providers)||[]).filter(p=>p&&Array.isArray(p.scopes)&&p.scopes.indexOf(cap)>=0);
  }catch(e){ return []; }
}
/* Which job asked. Saved rather than held in memory because connecting leaves
   this page entirely - the provider's sign-in is a full navigation - and the
   whole point is to come back and finish what was being turned on. */
function _cwConnWant(v){
  try{ if(v===undefined) return load('amv_cw_conn_want')||null;
       if(v===null) store('amv_cw_conn_want',null); else store('amv_cw_conn_want',v); }catch(e){}
  return null;
}
/* ══════════════════════════════════════════════════════════════════════════
   WHAT A JOB NEEDS, ON ONE SCREEN, WITH A WAY TO GET EACH OF IT.

   A job needs more than a mailbox. The money jobs need a bank or card; some
   need a specific app. What the product did with that was tell you the name of
   the thing that was missing and then, on Connect, drop you on the Connectors
   tab - which for a bank has nothing to connect at all, because a bank link is
   not an OAuth grant and lives in its own flow. So the most common case after
   "connect Gmail" ended on a screen whose honest answer was "not here".

   `_cwMissingNeeds` was right to exclude it. What was missing is this: a
   screen that lists EVERY requirement, ticks the ones already met, and gives
   each of the others a button that goes where that particular thing is
   actually connected.

   AND A WAY BACK. Every route out of here remembers the job, so finishing
   returns to it rather than leaving somebody on Spending wondering what they
   were doing. That was asked for in as many words.
   ══════════════════════════════════════════════════════════════════════════ */

/* Every need of a job, met or not, with the kind of thing each one IS - which
   is what decides where its button goes. Kept beside CW_NEEDS_CHECK rather
   than derived from labels, because a label is copy and this is routing. */
const CW_NEED_KIND = {
  'Email':           'oauth',
  'Calendar':        'oauth',
  'Drive':           'oauth',
  'Classroom':       'oauth',
  'Bank connection': 'bank',
  'Web research':    'always',
};
function _cwNeedKind(n){
  if(CW_NEED_KIND[n]) return CW_NEED_KIND[n];
  /* `App: Notion` - a specific connector, started by the bridge. Anything this
     table does not know is treated as one, because that is what an unknown
     requirement in this product is. */
  return 'app';
}
function _cwAppNameOf(n){ return String(n || '').replace(/^App:\s*/i, '').trim(); }
function _cwNeedMet(n){
  const kind = _cwNeedKind(n);
  if(kind === 'always') return true;
  const c = CW_NEEDS_CHECK[n];
  if(c && typeof c.has === 'function'){ try{ return !!c.has(); }catch(e){ return false; } }
  if(kind === 'app'){
    /* A connector counts as met when the bridge is actually holding it, not
       when it exists in the directory. "Installed somewhere" is not "running
       here", and a job that starts on the first is a job that does nothing. */
    try{
      const want = _cwAppNameOf(n).toLowerCase();
      const list = (typeof MCP !== 'undefined' && Array.isArray(MCP.servers)) ? MCP.servers : [];
      return list.some(x => String((x && (x.name || x.id)) || '').toLowerCase().indexOf(want) >= 0);
    }catch(e){ return false; }
  }
  return false;
}
/* TWO NAMES, BECAUSE THE LABEL WAS WRITTEN FOR THE MIDDLE OF A SENTENCE.

   CW_NEEDS_CHECK calls a bank "a bank connection", which is right inside
   "...until a bank connection is connected" and wrong as the heading of a
   row, where it rendered as "a bank connection" in bold with a lower-case
   article. A heading is a name. */
const CW_NEED_TITLE = {
  'Email':           'Email',
  'Calendar':        'Calendar',
  'Drive':           'Cloud files',
  'Classroom':       'Classroom',
  'Bank connection': 'Bank or card',
  'Web research':    'Web research',
};
function _cwNeedTitle(n){
  if(CW_NEED_TITLE[n]) return CW_NEED_TITLE[n];
  if(_cwNeedKind(n) === 'app') return _cwAppNameOf(n);
  return n;
}
function _cwNeedLabel(n){
  const c = CW_NEEDS_CHECK[n];
  if(c && c.label) return c.label;
  if(_cwNeedKind(n) === 'app') return _cwAppNameOf(n);
  return n;
}
function _cwNeedHow(n){
  const kind = _cwNeedKind(n);
  if(kind === 'always') return 'Built in - nothing to connect.';
  if(kind === 'bank') return 'Linked on Spending, at your bank\u2019s own sign-in. AMV reads balances and transactions and can never move money.';
  if(kind === 'app')  return 'A connector AMV starts on your computer through the bridge.';
  return 'A sign-in at the provider. AMV never sees your password - only a permission slip you can take back.';
}
function _cwNeedsPlan(j){
  return String((j && j.needs) || '').split(',').map(x => x.trim()).filter(Boolean)
    .map(n => ({ need:n, kind:_cwNeedKind(n), label:_cwNeedLabel(n),
                 title:_cwNeedTitle(n), how:_cwNeedHow(n), met:_cwNeedMet(n) }));
}
try{ window._cwNeedsPlan = _cwNeedsPlan; }catch(e){}

/* The job somebody is in the middle of setting up. Stored rather than held in
   memory because two of the three routes out of here leave the page entirely -
   a provider sign-in is a full navigation - and coming back to the job is the
   whole point. */
const CW_RESUME_TTL = 30 * 60000;
function _cwResumeJob(v){
  try{
    if(v === undefined){
      const r = load('amv_cw_resume');
      if(!r || !r.job) return '';
      /* STALE INTENT IS NO INTENT, the same rule `_cwConnWant` already
         follows. Somebody who pressed Connect, changed their mind and came
         back to Crew an hour later is not asking to be shown that job again -
         and a modal they did not ask for is worse than the trip they
         abandoned. */
      if(!r.at || Date.now() - r.at > CW_RESUME_TTL) return '';
      return String(r.job);
    }
    store('amv_cw_resume', v ? { job:String(v), at:Date.now() } : null);
  }catch(e){}
  return '';
}
/* COMING BACK IS THE POINT OF THE TRIP.

   Called when somebody arrives on Crew and again when a connection finishes -
   between them those are every way back from the three routes out of the
   requirements screen. The bank and app routes are tab changes, so returning
   to Crew IS pressing go back; the grant route is a full navigation and lands
   through the connection handler.

   It fires once and clears the note, so the screen does not reappear every
   time somebody visits Crew afterwards. Written because the first version of
   this shipped the function and nothing that called it - which is the exact
   shape `every-entry-point-has-a-door` exists to catch, and did. */
function cwResumeIfAny(){
  const id = _cwResumeJob();
  if(!id) return false;
  _cwResumeJob('');
  try{ cwNeeds(id); return true; }catch(e){ return false; }
}
try{ window.cwResumeIfAny = cwResumeIfAny; }catch(e){}

function cwNeeds(jobId){
  const j = (_cwAllJobs() || []).find(x => x.id === jobId);
  const r = $('ovr'); if(!j || !r) return;
  try{ if(typeof _connLoad === 'function') _connLoad(false); }catch(e){}
  const plan = _cwNeedsPlan(j);
  const left = plan.filter(p => !p.met);

  const row = (p) => {
    const act = p.met
      ? '<span class="cwn-ok" aria-label="Connected">\u2713 Connected</span>'
      : '<button class="btn bp cwn-go" data-cwn-kind="' + escH(p.kind) + '"'
        + ' data-cwn-need="' + escH(p.need) + '">Connect</button>';
    return '<div class="cwn-row' + (p.met ? ' met' : '') + '">'
      + '<div class="cwn-b"><div class="cwn-n">' + escH(p.title) + '</div>'
        + '<div class="cwn-h">' + escH(p.how) + '</div></div>'
      + '<div class="cwn-a">' + act + '</div>'
    + '</div>';
  };

  r.innerHTML =
    '<div class="ov cwc-ov" id="cwn-bg"><div class="cwc cwn" role="dialog" aria-modal="true" aria-labelledby="cwn-t">'
    + '<button class="cwp-x" id="cwn-x" aria-label="Close">\u2715</button>'
    + '<div class="cwc-inner">'
      + '<h1 class="cwc-t" id="cwn-t">' + escH(j.title) + '</h1>'
      + '<p class="cwc-lead">' + (left.length
          ? escH('This needs ' + left.map(p => p.label).join(' and ') + ' before it can run. '
                 + 'Connect ' + (left.length > 1 ? 'them' : 'it') + ' here and come straight back.')
          : escH('Everything this job needs is connected. It is ready to turn on.')) + '</p>'
      + '<div class="cwn-list">' + plan.map(row).join('') + '</div>'
      + '<div class="cwc-acts cwn-acts">'
        + '<button class="btn bs" id="cwn-back">\u2190 Back to the job</button>'
        + (left.length ? '' : '<button class="btn bp" id="cwn-on">'
            + (j.on ? 'Turn it off' : 'Turn it on') + '</button>')
      + '</div>'
    + '</div>'
  + '</div></div>';
  r.classList.add('on');

  const back = () => { try{ cwPeek(j.id); }catch(e){ try{ closeOvr(); }catch(_e){} } };
  onBackdrop($('cwn-bg'), () => { try{ closeOvr(); }catch(e){} });
  on($('cwn-x'), 'click', () => { try{ closeOvr(); }catch(e){} });
  on($('cwn-back'), 'click', back);
  on($('cwn-on'), 'click', () => { try{ closeOvr(); cwToggle(j.id); }catch(e){} });

  r.querySelectorAll('.cwn-go').forEach(b => on(b, 'click', () => {
    const kind = b.dataset.cwnKind, need = b.dataset.cwnNeed;
    /* Remembered BEFORE leaving, for every route - a provider sign-in is a
       full navigation and the tab changes are not much kinder. */
    _cwResumeJob(j.id);
    if(kind === 'oauth'){ try{ openCrewConnect(j.id); }catch(e){} return; }
    if(kind === 'bank'){
      /* Spending, because that is where the account card lives and where the
         link actually starts. Not Connectors, which is where this used to go
         and which has nothing to offer for a bank. */
      try{ closeOvr(); setTab('spend'); }catch(e){}
      try{ toast('Link your account under "Investing" here, then come back to the job.', 'info', 7000); }catch(e){}
      return;
    }
    /* An app: the directory, searched for the one it wants, so the thing they
       came for is the first thing on the screen. */
    try{ closeOvr(); setTab('integrations'); }catch(e){}
    try{ if(typeof cdirAll === 'function') cdirAll(_cwAppNameOf(need).toLowerCase()); }catch(e){}
  }));
}
try{ window.cwNeeds = cwNeeds; }catch(e){}

function openCrewConnect(jobId){
  const j=(_cwAllJobs()||[]).find(x=>x.id===jobId);
  const r=$('ovr'); if(!j||!r) return;
  try{ if(typeof _connLoad==='function') _connLoad(false); }catch(e){}
  const missing=_cwMissingNeeds(j);
  /* Nothing here to connect - either it is all connected already, or what is
     missing is not a connector. The Connectors page is the honest destination
     either way. Never a toggle: this is reached from a card whose job may
     already be on, and turning it off because somebody pressed Connect is the
     opposite of what they asked for. */
  if(!missing.length){ try{ S.tab='integrations'; setTab('integrations'); }catch(e){} return; }
  const m=missing[0];
  const provs=_cwProvidersFor(m.cap);
  const ready=provs.filter(p=>p.ready);
  const words=(typeof _connScopeWords==='function') ? _connScopeWords([m.cap]) : [m.cap];

  const buttons = ready.length
    /* One filled button. Two providers that both grant mail are two ways to do
       the same thing, and rendering both as the primary action asks somebody to
       choose between identical-looking buttons before they know there is no
       wrong answer. The first is offered; the rest are available. */
    ? ready.map((p,i)=>'<button class="btn '+(i?'bs':'bp')+' cwc-go" data-conn-prov="'+escH(p.id)+'">'
        +(i?'Use ':'Connect with ')+escH(p.name)+'</button>').join('')
    : '';
  const none = provs.length
    ? '<p class="cwc-none">No '+escH(m.label)+' app is registered on this deployment yet, so there is nothing to connect to. '
      + 'Until that is set up this job cannot run, and AMV will not pretend otherwise.</p>'
    : '<p class="cwc-none">This copy of AMV cannot hold an account key, so there is nothing to connect. '
      + 'The job is saved and will start the moment a connection is possible.</p>';

  r.innerHTML =
    '<div class="ov cwc-ov" id="cwc-bg"><div class="cwc" role="dialog" aria-modal="true" aria-labelledby="cwc-t">'+
      '<button class="cwp-x" id="cwc-x" aria-label="Close">\u2715</button>'+
      '<div class="cwc-inner">'+
        '<div class="cwc-mark" aria-hidden="true">'+
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+
          '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg></div>'+
        '<h1 class="cwc-t" id="cwc-t">Connect '+escH(m.label)+' to your AMV</h1>'+
        '<p class="cwc-lead">You are turning on <b>'+escH(j.title)+'</b>. To do it, AMV needs to '+
          escH(words.join(' and '))+'.</p>'+
        '<ul class="cwc-facts">'+
          '<li>You sign in at '+escH((ready[0]&&ready[0].name)||m.label)+', not here. '+
            '<b>AMV never sees your password</b> - it receives a permission slip and nothing else.</li>'+
          '<li>The permission covers only what you tick on the next screen, and it is held against '+
            'this AMV account alone.</li>'+
          '<li>You can take it back at any time, and every use is recorded with the name of the job '+
            'that used it.</li>'+
        '</ul>'+
        (buttons ? '<div class="cwc-acts">'+buttons+'</div>' : none)+
        '<button class="cwc-later" id="cwc-later">Not now</button>'+
      '</div>'+
    '</div></div>';
  r.classList.add('on');
  const close=()=>{ try{ closeOvr(); }catch(e){} };
  on($('cwc-x'),'click',close);
  on($('cwc-later'),'click',close);
  onBackdrop($('cwc-bg'),close);
  r.querySelectorAll('[data-conn-prov]').forEach(b=>on(b,'click',()=>{
    /* Remembered BEFORE leaving, because the next thing that happens is a
       navigation away from this page. */
    _cwConnWant({ job:j.id, cap:m.cap, at:Date.now() });
    close();
    try{ connAdd(b.dataset.connProv); }catch(e){}
  }));
}
try{ window.openCrewConnect=openCrewConnect; }catch(e){}
/* Called when a connection has just completed. Finishes the job that asked for
   it, and only that one - a connection somebody made from the Connectors page
   for its own sake must not silently switch a job on. */
async function cwConnectResume(){
  /* Back from connecting an account, Crew may never have been opened - and
     resuming a job needs its definition. */
  if(!(await _loadCrewData())) return;
  const want=_cwConnWant();
  _cwConnWant(null);
  if(!want||!want.job) return;
  /* Stale intent is no intent. An hour-old note about a job somebody may have
     forgotten they touched is not permission to start it. */
  if(!want.at || Date.now()-want.at > 30*60000) return;
  const j=(_cwJobs()||[]).find(x=>x.id===want.job)||(_cwAllJobs()||[]).find(x=>x.id===want.job);
  if(!j || j.on) return;
  if(_cwMissingNeeds(j).length) return;      // still not connected: nothing to resume
  try{ setTab('crew'); }catch(e){}
  try{ cwToggle(j.id); }catch(e){}
}
try{ window.cwConnectResume=cwConnectResume; }catch(e){}
/* The catalogue card's Connect button knows which job it is on, so it opens
   that job's connect screen. Called bare it still has to do something sensible,
   which is the Connectors page it always went to. */
/* THE CARD'S CONNECT BUTTON, POINTED SOMEWHERE THAT CAN ANSWER.

   It went straight to `openCrewConnect`, which handles exactly one kind of
   requirement: an OAuth grant. A job needing a bank has no such grant, so
   that function fell through to the Connectors tab - a screen with nothing on
   it for a bank - and the money jobs, which are the ones most likely to be
   missing something, were the ones it served worst.

   It opens the requirements screen instead, which lists every requirement
   this job has and sends each one where that particular thing is connected.
   For a job whose only gap is a mailbox that screen is one tap longer than
   before; for every other job it is the difference between working and not. */
function cwConnect(jobId){
  if(jobId){
    try{
      /* ONE MISSING THING THAT A GRANT CAN SUPPLY GOES STRAIGHT THERE.

         Sending every job through the requirements list would have added a tap
         to the commonest case in the product - a job whose only gap is a
         mailbox - and that one tap is the thing that was asked for by name:
         turning a job on should take you to a screen that says connect X. It
         still does.

         The list is for the cases that one screen cannot answer: more than one
         thing missing, or a single thing that is not an OAuth grant at all. A
         bank is the second, and it is what sent people to a page with nothing
         on it for them. */
      const j = (_cwAllJobs() || []).find(x => x.id === jobId);
      const missing = j ? _cwNeedsPlan(j).filter(p => !p.met) : [];
      /* A job named for a country's own mailbox (QQ Mail, Naver, WEB.DE)
         connects THAT mailbox, by app password - not Google's sign-in, which
         most people in those countries do not use. */
      if(j && j.connectHow && /^mail:/.test(j.connectHow) && missing.length === 1 && typeof openMailConnect === 'function'){
        if(typeof _intNeedsAccount === 'function' && _intNeedsAccount('your mailbox')) return;
        openMailConnect(j.connectHow.slice(5)); return;
      }
      if(missing.length === 1 && missing[0].kind === 'oauth'){ openCrewConnect(jobId); return; }
      cwNeeds(jobId); return;
    }catch(e){}
  }
  try{ S.tab='integrations'; setTab('integrations'); }catch(e){}
}
try{ window.cwConnect=cwConnect; }catch(e){}


/* ── A HUNDRED EXAMPLES, FROM A HUNDRED PLACES ────────────────────────────────

   Asked for directly: "where are the foreign countries one? there should be
   100 different ones in total including all of the different countries".

   The country work already existed and nobody could see it. The Worker carries
   everyday job packs for 105 countries - 525 jobs - and the only way to reach
   them was Integrations, then a row called "Everyday life where you live",
   then a modal, then a country picker. So the catalogue that is supposed to
   show what AMV can do showed a hundred and six jobs written as though
   everybody lived in the same place.

   These are not new jobs and they are not copy. Each one is a REAL job from
   the catalogue above, named for the country it runs in, and starting it
   starts that job with the country in the instruction - which is what makes
   the answer different in Lagos and in Osaka. The country list is lifted from
   the Worker's own EVERYDAY_BY_COUNTRY so the two cannot drift: if a country
   has a pack on the server, it has an example here.

   Ten kinds, because these are the ten that genuinely change with where you
   are - what the paperwork is called, what the shops are, what the weather
   does to your day. A job whose answer is the same everywhere would be
   padding, and padding is what this screen had too much of already. */
const CW_WORLD_COUNTRIES = [
  ['US',"United States",'🇺🇸'],
  ['CA',"Canada",'🇨🇦'],
  ['MX',"Mexico",'🇲🇽'],
  ['BR',"Brazil",'🇧🇷'],
  ['AR',"Argentina",'🇦🇷'],
  ['DE',"Germany",'🇩🇪'],
  ['GB',"United Kingdom",'🇬🇧'],
  ['FR',"France",'🇫🇷'],
  ['IT',"Italy",'🇮🇹'],
  ['RU',"Russia",'🇷🇺'],
  ['CN',"China",'🇨🇳'],
  ['IN',"India",'🇮🇳'],
  ['JP',"Japan",'🇯🇵'],
  ['KR',"South Korea",'🇰🇷'],
  ['ID',"Indonesia",'🇮🇩'],
  ['SA',"Saudi Arabia",'🇸🇦'],
  ['NG',"Nigeria",'🇳🇬'],
  ['ZA',"South Africa",'🇿🇦'],
  ['EG',"Egypt",'🇪🇬'],
  ['AU',"Australia",'🇦🇺'],
  ['AT',"Austria",'🇦🇹'],
  ['BE',"Belgium",'🇧🇪'],
  ['CZ',"Czechia",'🇨🇿'],
  ['DK',"Denmark",'🇩🇰'],
  ['FI',"Finland",'🇫🇮'],
  ['IE',"Ireland",'🇮🇪'],
  ['NL',"Netherlands",'🇳🇱'],
  ['NO',"Norway",'🇳🇴'],
  ['PL',"Poland",'🇵🇱'],
  ['PT',"Portugal",'🇵🇹'],
  ['ES',"Spain",'🇪🇸'],
  ['SE',"Sweden",'🇸🇪'],
  ['CH',"Switzerland",'🇨🇭'],
  ['TR',"T\u00fcrkiye",'🇹🇷'],
  ['UA',"Ukraine",'🇺🇦'],
  ['HK',"Hong Kong",'🇭🇰'],
  ['IL',"Israel",'🇮🇱'],
  ['MY',"Malaysia",'🇲🇾'],
  ['PH',"Philippines",'🇵🇭'],
  ['SG',"Singapore",'🇸🇬'],
  ['TW',"Taiwan",'🇹🇼'],
  ['TH',"Thailand",'🇹🇭'],
  ['AE',"United Arab Emirates",'🇦🇪'],
  ['VN',"Vietnam",'🇻🇳'],
  ['KE',"Kenya",'🇰🇪'],
  ['PK',"Pakistan",'🇵🇰'],
  ['BD',"Bangladesh",'🇧🇩'],
  ['LK',"Sri Lanka",'🇱🇰'],
  ['NP',"Nepal",'🇳🇵'],
  ['KZ',"Kazakhstan",'🇰🇿'],
  ['UZ',"Uzbekistan",'🇺🇿'],
  ['KH',"Cambodia",'🇰🇭'],
  ['MM',"Myanmar",'🇲🇲'],
  ['IQ',"Iraq",'🇮🇶'],
  ['JO',"Jordan",'🇯🇴'],
  ['QA',"Qatar",'🇶🇦'],
  ['KW',"Kuwait",'🇰🇼'],
  ['OM',"Oman",'🇴🇲'],
  ['BH',"Bahrain",'🇧🇭'],
  ['LB',"Lebanon",'🇱🇧'],
  ['AZ',"Azerbaijan",'🇦🇿'],
  ['GE',"Georgia",'🇬🇪'],
  ['AM',"Armenia",'🇦🇲'],
  ['MN',"Mongolia",'🇲🇳'],
  ['NZ',"New Zealand",'🇳🇿'],
  ['ET',"Ethiopia",'🇪🇹'],
  ['TZ',"Tanzania",'🇹🇿'],
  ['UG',"Uganda",'🇺🇬'],
  ['GH',"Ghana",'🇬🇭'],
  ['MA',"Morocco",'🇲🇦'],
  ['DZ',"Algeria",'🇩🇿'],
  ['TN',"Tunisia",'🇹🇳'],
  ['SN',"Senegal",'🇸🇳'],
  ['CI',"Cote d'Ivoire",'🇨🇮'],
  ['CM',"Cameroon",'🇨🇲'],
  ['ZM',"Zambia",'🇿🇲'],
  ['ZW',"Zimbabwe",'🇿🇼'],
  ['RW',"Rwanda",'🇷🇼'],
  ['MZ',"Mozambique",'🇲🇿'],
  ['AO',"Angola",'🇦🇴'],
  ['BW',"Botswana",'🇧🇼'],
  ['NA',"Namibia",'🇳🇦'],
  ['CO',"Colombia",'🇨🇴'],
  ['PE',"Peru",'🇵🇪'],
  ['CL',"Chile",'🇨🇱'],
  ['EC',"Ecuador",'🇪🇨'],
  ['BO',"Bolivia",'🇧🇴'],
  ['VE',"Venezuela",'🇻🇪'],
  ['GT',"Guatemala",'🇬🇹'],
  ['DO',"Dominican Republic",'🇩🇴'],
  ['CR',"Costa Rica",'🇨🇷'],
  ['PA',"Panama",'🇵🇦'],
  ['UY',"Uruguay",'🇺🇾'],
  ['PY',"Paraguay",'🇵🇾'],
  ['RO',"Romania",'🇷🇴'],
  ['GR',"Greece",'🇬🇷'],
  ['HU',"Hungary",'🇭🇺'],
  ['BG',"Bulgaria",'🇧🇬'],
  ['RS',"Serbia",'🇷🇸'],
  ['HR',"Croatia",'🇭🇷'],
  ['SK',"Slovakia",'🇸🇰'],
  ['SI',"Slovenia",'🇸🇮'],
  ['LT',"Lithuania",'🇱🇹'],
  ['LV',"Latvia",'🇱🇻'],
  ['EE',"Estonia",'🇪🇪']
];
/* THE SAME EVERYWHERE, AND THE PART THAT IS NOT ────────────────────────────

   The previous version of this took ten job templates and pasted a country
   name into each one, so Japan got "Papers and permits in Japan" and Nigeria
   got "Papers and permits in Nigeria". That is not localisation, it is a mail
   merge - the same job wearing a flag - and it was rightly called out: a
   universal tool has to have real things in common between countries AND real
   differences, not one shape repeated a hundred times.

   The real material already existed on the server and nothing showed it. The
   Worker carries ten EVERYDAY_UNIVERSAL jobs plus five genuinely local ones
   for each of 105 countries, and the local ones are actually local: 年末調整
   and ふるさと納税 in Japan, NIN and BVN and DisCo bills in Nigeria, Renta and
   cuota de autónomo and ITV in Spain, Kündigungsfristen and
   Nebenkostenabrechnung in Germany, CFDI and OXXO in Mexico.

   So the split is the honest one, and it is the answer to the question:

     WHAT IS THE SAME - the ten below. Everybody, everywhere, has bills with
     dates, subscriptions that renew themselves, parcels, warranties that
     expire and letters they have not answered. These ship with the page, so
     they are there with no connection and no account.

     WHAT IS DIFFERENT - the five for the country you pick, fetched from the
     server because 525 of them will not fit in a page somebody downloads.
     When the backend is not reachable the local half says so, rather than
     falling back to a template with a flag on it. */
const CW_EVERYDAY_UNIVERSAL = [
  { id:'ev_bills_due', icon:'📄', needs:'Email',
    title:'Bills due this week',
    desc:'Every bill sitting in your mail with a date on it, in one list, before the date rather than after it.' },
  { id:'ev_renewals', icon:'🪪', needs:'Email',
    title:'Renewals and expiry dates',
    desc:'Reads the renewal notices in your mail for passport, licence, insurance, visa, registration and tenancy - the things that cost a great deal of trouble when they lapse and give no warning when they do.' },
  { id:'ev_trials', icon:'⏳', needs:'Email',
    title:'Free trials about to charge',
    desc:'Finds the trial-ending emails in your mail and tells you before one becomes a payment, while there is still time to decide.' },
  { id:'ev_deliveries', icon:'📦', needs:'Email',
    title:'Parcels: what is coming and what is late',
    desc:'Reads your shipping confirmation emails so everything in transit is in one place - and specifically the ones that have stopped moving.' },
  { id:'ev_returns', icon:'↩️', needs:'Email',
    title:'Return and warranty windows closing',
    desc:'The last day you can send something back or claim on it, which is never mentioned again after the receipt.' },
  { id:'ev_official', icon:'🏛️', needs:'Email',
    title:'Official letters you have not answered',
    desc:'Anything from a tax office, council, ministry, court, bank or school that asked for something and has not had a reply.' },
  { id:'ev_utility_spike', icon:'⚡', needs:'Email',
    title:'Is my bill higher than usual?',
    desc:'Reads the utility bills in your mail and compares this month against the months before it, so a quiet price rise or a broken meter does not go unnoticed for a year.' },
  { id:'ev_trip', icon:'✈️', needs:'Email, Calendar',
    title:'My next trip, in one place',
    desc:'Flights, hotel, transfers, check-in windows and what expires before you go, assembled from the confirmations scattered across your mail.' },
  { id:'ev_school_week', icon:'🎒', needs:'Email, Calendar',
    title:'School and study week ahead',
    desc:'Deadlines, forms, payments and dates from school or university mail, before the week starts rather than the night before.' },
  { id:'ev_week_ahead', icon:'🗓️', needs:'Email, Calendar',
    title:'My week, before it starts',
    desc:'One message before the week begins: what is scheduled, what is due, what is waiting on you, and where the week is over-committed.' }
];

/* One shape for both halves, so a universal job and a local one are visibly
   the same kind of thing and go through the same card, peek and toggle. */
function _cwEverydayJob(raw, countryName, local){
  return {
    id: 'ev_' + (local ? (String(raw.country || '').toLowerCase() + '_') : '') + String(raw.id || ''),
    world: true, everyday: true, local: !!local,
    country: raw.country || '', countryName: countryName || '',
    cat: 'Home & life', icon: raw.icon || '\uD83D\uDCCB', on: false,
    title: String(raw.title || ''),
    desc: String(raw.desc || ''),
    /* NO DEFAULT MAILBOX. This read `raw.needs || 'Email'`, so an everyday
       job whose pack did not state its requirements demanded a mailbox -
       hundreds of them, in every country, asking for the most alarming grant
       AMV can ask for on the strength of a fallback nobody chose.

       Declaring nothing is the honest answer when the pack is silent: the
       instruction lives on the server and the runner derives what it needs
       from that instruction itself, so the server asks for access when the
       work actually opens something. A guess here could only ever be wrong in
       one of two directions, and asking for a mailbox that is never opened is
       the direction people notice and distrust. */
    needs: String(raw.needs || ''),
    /* The instruction lives on the server with the job. Switching one on sends
       the id, and the runner uses the real prompt - which is why this does not
       invent one here and does not need to carry 525 of them in the page. */
    everydayId: String(raw.id || ''),
  };
}
function _cwUniversalJobs(){
  return CW_EVERYDAY_UNIVERSAL.map(j => _cwEverydayJob(j, '', false));
}
/* The local five, from the server. Cached per country: choosing a country
   twice must not be two round trips, and switching back and forth is exactly
   what somebody comparing does. */
const _cwLocalCache = {};
let _cwLocalState = {};        // code -> 'loading' | 'ok' | 'offline'
/* ── EVERY JOB, FOR THE COUNTRY IT RUNS IN ───────────────────────────────────

   Asked for: 105+ of the most common jobs for EACH country, not the same list
   with a flag on it. The common jobs are common everywhere - finding work,
   bills, tax, the weekly shop, a passport running out - and what changes is
   where each one looks. So the country's facts (its tax office, its banks, its
   job sites, its supermarkets) come with the country's five from the server,
   every card that depends on one names it, and the run itself is told where
   the person is and to check anything official against that country's source.

   The five written for the country + the hundred below, each answering for it,
   is the 105. The box above them is the rest: none of this is the limit.

   Keys are the server's COUNTRY_FACTS keys. A job with no entry here is the
   same everywhere (a code review, a weekly report) and says nothing, rather
   than being dressed up as local. */
const _cwFacts = {};           // code -> facts object from /v1/everyday
const _cwInbox = {};           // code -> [{id,name,how}] mailboxes people there use, most-used first
const _cwBank = {};            // code -> true where a bank can be linked
const _cwMeta = {};            // code -> { classroom, bankElsewhere, work } from /v1/everyday
const CW_LOC = {
  job_hunt:['jobs'], salary_bench:['jobs','cur'], recruiter_triage:['jobs'], interview_pack:['jobs'],
  portfolio_fresh:['jobs'], employer_health:['news'], application_help:['uni','jobs'],
  opportunity_student:['uni'], morning_brief:['news'], morning_brief_student:['news','weather'],
  calendar_brief:['weather'], weather_day:['weather'], deal_watch:['shop'], target_buy:['shop'],
  price_protect:['shop'], coupons:['shop','groc'], store_deals:['shop','groc'], groceries:['groc'],
  local_basket:['groc'], fridge_recipes:['groc'], deliveries:['post'], ev_deliveries:['post'],
  ev_returns:['shop'], money_morning:['banks'], unusual_spend:['banks'], low_balance:['banks'],
  budget_trend:['banks','cur'], money_leaks:['banks','pay'], money_student:['banks','pay'],
  rate_watch:['banks'], bills_due:['banks','pay'], ev_bills_due:['banks','pay'],
  bill_negotiate:['telco'], ev_utility_spike:['telco'], tax_catch:['tax'], ev_official:['tax','gov'],
  regulation_watch:['gov'], life_admin:['id','gov'], life_admin_student:['id','gov'],
  doc_expiry:['id'], ev_renewals:['id','car'], car_admin:['car'], health_admin:['health'],
  appt_prep:['health'], appt_chase:['health'], family_health:['health'], move_watch:['prop'],
  travel_guardian:['rail'], ev_trip:['rail'], book_table:['food'], exam_prep:['exams'],
  deadline_radar:['exams'], school_admin:['exams'], ev_school_week:['exams'], school_week:['exams']
};
/* The names a person reads for each fact, in the order a page lists them. */
const CW_FACT_LABELS = [['jobs','Job sites'],['banks','Banks'],['pay','Everyday payments'],['tax','Tax'],
  ['gov','Government sign-in'],['id','ID and passports'],['shop','Shopping online'],['groc','Supermarkets'],
  ['food','Food delivery'],['rail','Trains'],['prop','Property'],['car','Vehicle admin'],['health','Health'],
  ['exams','Exams'],['uni','University applications'],['telco','Mobile networks'],['post','Post and parcels'],
  ['news','News'],['weather','Weather'],['cur','Currency']];
function _ccFactsHTML(cc){
  const f = _cwFacts[cc]; if(!f) return '';
  const rows = CW_FACT_LABELS.filter(([k]) => f[k]).map(([k, label]) =>
    `<div class="cw-facts-r"><dt>${escH(T(label))}</dt><dd>${escH(String(f[k]))}</dd></div>`).join('');
  return rows ? `<dl class="cw-facts">${rows}</dl>` : '';
}
/* ── MADE FOR THE COUNTRY: JOBS BUILT ON WHAT PEOPLE THERE USE ──────────────

   Asked for: in every country, the jobs people there would actually start -
   and a thousand of them, not a hundred with a flag on. The five written by
   hand for each country stay the top five. These come after them, and each is
   one of the everyday jobs that has a different right answer in every country
   - find work, the weekly shop, tax, a passport, the rent - written against
   that country's own services: InfoJobs and the SEPE in Spain, OCC and the
   SAT in Mexico. The names come from the country's facts on the server, which
   were written by hand and omit anything uncertain, so a country only gets
   the jobs it has real names for. About thirteen each, 1,300 across the 105.

   Every one runs unattended from the web - none needs an account connected -
   so switching one on really does start work tonight, in any country. Every
   one that depends on the person asks them first (which town, which exam),
   because a job that runs on nothing can only apologise or invent. */
function _cwNames(v, n){
  const parts = String(v || '').split(/\s*(?:,|·|\/| and | y | et | und )\s*/).map(x => x.trim()).filter(Boolean);
  const pick = parts.slice(0, n || 2);
  return pick.length < 2 ? pick.join('') : pick.slice(0, -1).join(', ') + ' and ' + pick[pick.length - 1];
}
function _cwShort(v){
  const m = /\(([^)]+)\)/.exec(String(v || ''));
  return m ? m[1] : String(v || '').replace(/^the\s+/i, '');
}
/* A fact's first name with any bracket dropped: "the State Department
   (passports) and your state DMV" -> "the State Department". */
function _cwPlainAll(v){ return String(v || '').replace(/\s*\([^)]*\)/g, '').trim(); }
function _cwPlain(v){ return _cwNames(_cwPlainAll(v), 1); }
/* CW_MADE_FOR moved to crew-data.js with the rest of the catalogue - read it
   through _cwMadeForList(). */
function _cwMadeForJobs(cc){
  const f = _cwFacts[cc], row = _cwCountryRow(cc);
  if(!f || !row) return [];
  const C = row[1];
  return _cwMadeForList().filter(m => f[m.k]).map(m => ({
    id: 'cc_' + cc.toLowerCase() + '_' + m.id, made: true, country: cc, countryName: C,
    cat: m.cat, icon: m.icon, every: m.every, on: false, needs: 'Web research',
    title: m.t(f), desc: m.d(f, C), where: String(f[m.k]),
    asks: { q: m.ask[0], ph: m.ask[1] },
    prompt: m.p(f, C) + ' The user is in ' + C + '.',
  }));
}
/* ── A HUNDRED AND MORE FOR EVERY COUNTRY ─────────────────────────────────────

   Asked for: every country gets 100+ of the most common, most used jobs - the
   ones that bring people back - not the same hundred with a flag on. So on top
   of the one-per-area jobs above, each area has the other things people do
   there every week (a job hunt AND a salary check AND interview prep for the
   country's own sites), plus the jobs that need nothing but the country itself
   (public holidays, scams going around, strikes, recalls, new laws) - which
   are local because the run is told the country and checks the official
   source for it.

   Written as data: [fact key or '' for country-only, id, category, icon,
   how often, title, description, question, example, instruction]. In the
   strings {C} is the country, {v} the fact as written, {1}/{2}/{3} the first
   one, two or three names in it, {s} its short form. A row whose fact the
   country does not have is left out - never filled with a generic name. */
/* CW_MADE_MORE moved to crew-data.js with the rest of the catalogue - read it
   through _cwMadeMoreList(). */
/* A country's name inside a sentence: "in the Philippines", not "in
   Philippines". Only for names English writes with the article. */
const CW_THE = new Set(['United States', 'United Kingdom', 'Philippines', 'Netherlands', 'United Arab Emirates', 'Dominican Republic']);
function _cwThe(C){ return CW_THE.has(C) ? 'the ' + C : C; }
function _cwFill(str, f, k, C){
  const v = k ? String(f[k] || '') : '';
  return String(str || '').replace(/\{C\}/g, _cwThe(C)).replace(/\{v\}/g, v).replace(/\{1\}/g, _cwNames(v, 1))
    .replace(/\{2\}/g, _cwNames(v, 2)).replace(/\{3\}/g, _cwNames(v, 3)).replace(/\{s\}/g, _cwShort(v))
    .replace(/\{cur\}/g, String((f && f.cur) || ''))
    /* {f:key} / {f2:key} / {f3:key}: another of the country's facts, by name -
       its weather service, its networks. Only used where the fact exists (see
       _cwLocalTitle), so it never renders empty. */
    .replace(/\{f([123]?):(\w+)\}/g, (m, n, key) => _cwNames(String((f && f[key]) || ''), +n || 1));
}
/* NOTHING ON A COUNTRY'S PAGE IS CALLED SOMETHING IT COULD BE CALLED ANYWHERE.

   Asked for: "make sure every single thing is backed by research - nothing is
   generic". Measured first: on a country's page, 65 of every 105 titles named
   nothing of the country - "Tomorrow's weather where you live", "Inbox
   digest", "Is your phone contract still a good deal?". Each is now named for
   the country it runs in: the weather service, the networks, the portal, the
   currency, from the country's facts (written by hand on the server, with
   anything uncertain left out). Where the fact is missing for a country, the
   second form names the country instead, so a title is never left with a
   blank or a guess. [form when the fact exists, fact key, fallback form]. */
const CW_TITLE_LOCAL = {
  deliveryfees:['Cheapest way to order tonight on {f2:food}','food','Cheapest way to order tonight in {C}'],
  pass:['Is a pass on {f:rail} worth it for you?','rail','Is a rail pass in {C} worth it for you?'],
  travel:['Travel documents check before a trip from {C}','',''],
  value:['What your car is worth in {C}, in {cur}','',''],
  insurance:['Health cover renewal check in {C}','',''],
  housing:['Student housing near your university in {C}','',''],
  weekend:['The weekend forecast from {f:weather}','weather','The weekend forecast in {C}'],
  appts:['Government appointment slots on {f:gov}','gov','Government appointment slots in {C}'],
  benefits:['Benefits and support you may qualify for in {C}','',''],
  roaming:['Roaming costs on {f3:telco}','telco','Roaming costs from {C}'],
  broadband:['Home internet deals from {f3:telco}','telco','Home internet deals in {C}'],
  events:['What is on this weekend near you in {C}','',''],
  fuel:['Where fuel is cheapest near you in {C}','',''],
  fx:['{cur} exchange rate watch','',''],
  air:['Air quality and pollen where you live in {C}','',''],
  flights:['Cheap flights from your airport in {C}','',''],
  kids:['Things to do with kids this weekend in {C}','',''],
  free:['Free museum days and events in {C}','',''],
  jobfairs:['Job fairs and hiring days in {C}','',''],
  commute:['Roadworks and closures on your commute in {C}','',''],
  team:['Your team, this week, from {f2:news}','news','Your team, this week, as {C} reports it'],
  concerts:['Concert tickets in {C} for artists you like','',''],
  carinsurance:['Car insurance renewal check in {C}','',''],
  homeinsurance:['Home insurance check in {C}','',''],
  visa:['Entry rules for your next trip from {C}','',''],
  volunteer:['Volunteering near you in {C}','',''],
  secondhand:['Second-hand deals in {C} on what you want','',''],
  localtax:['Local taxes and municipal charges due in {C}','',''],
  parking:['Parking rules and zones where you live in {C}','',''],
  restaurants:['New restaurants worth trying near you in {C}','',''],
  phoneplan:['Is your contract on {f3:telco} still a good deal?','telco','Is your phone contract in {C} still a good deal?'],
  outages:['Power and water cuts in your area in {C}','',''],
  pharmacy:['Pharmacies open near you tonight in {C}','',''],
  bus:['Cheapest bus and coach tickets in {C}','',''],
  ride:['Ride-hailing prices in {C}, compared','',''],
  getaway:['Weekend getaways from your city in {C}','',''],
  hotels:['Hotel prices for your next trip, in {cur}','',''],
  clinics:['Clinics and doctors near you in {C}','',''],
  gym:['Gyms and classes near you in {C}','',''],
  cookinggas:['Cooking gas and home fuel prices in {C}','',''],
  flightshome:['Flights home to {C} for the holidays','',''],
  localnews:['News from your city in {C}, in five lines','',''],
  traffic:['Traffic on your route in {C} before you leave','',''],
  dailyweather:['Tomorrow’s weather from {f:weather}','weather','Tomorrow’s weather where you live in {C}'],
  crypto:['Crypto prices in {cur}','',''],
  schoolfees:['School fees, grants and supplies this term in {C}','',''],
  pets:['Vets and pet care near you in {C}','',''],
  hobby:['Clubs and classes for your hobby in {C}','',''],
  transit:['Public transport passes where you live in {C}','',''],
  rivals:['What your competitors in {C} did this week','',''],
  reviews:['New reviews of your business in {C}','',''],
  warnings:['Severe weather warnings from {f:weather}','weather','Severe weather warnings for your area in {C}'],
  homeprices:['Home prices in your city, from {f2:prop}','prop','Home prices in your city in {C}'],
  breaches:['Data breaches at services used in {C}','',''],
  prayer:['Prayer times and Ramadan dates in {C}','',''],
  loadshedding:['Power cuts and load-shedding in {C}','',''],
  bundles:['Cheapest data bundles on {f2:telco}','telco','Cheapest data bundles in {C}'],
  parallel:['The official and the parallel {cur} rate today','',''],
  fuelweek:['Fuel prices, set {cycle}','',''],
};
function _cwLocalTitle(id, f, C, dflt){
  const t = CW_TITLE_LOCAL[id];
  if(!t) return dflt;
  if(t[1] && !(f && f[t[1]])) return t[2];
  if(/\{cur\}/.test(t[0]) && !(f && f.cur)) return dflt;
  return t[0];
}
/* WHICH COUNTRIES A SIGNAL-GATED JOB IS FOR. Conservative lists - only
   countries the source plainly names, checked against it in October 2026.
   A list goes stale when the world changes, so each says what was true and
   when; re-check it before adding a country.
     MUSLIM    Pew Research Center: Muslim-majority populations.
     POWER     Scheduled power cuts during 2026, with published schedules or
               rotation groups: ZESCO (Zambia, eight-hour cuts from July),
               Pakistan's Power Division (April), ECG's load-management
               timetable (Ghana), EDL (Lebanon, about four hours of supply a
               day), Nigeria's grid shortfall (NERC's Band A compensation),
               Bangladesh (10-12 hours a day in rural areas, August), Iraq
               (summer) and Myanmar (Yangon's four-hours-on rotation).
               NOT South Africa - 476 days without load-shedding by September
               2026 - nor Zimbabwe, where ZESA ended routine cuts this year.
     PREPAID   GSMA Intelligence: 93% of connections in Sub-Saharan Africa
               are prepaid, over 90% in India, above 85% across South and
               Southeast Asia - every country here in those regions.
     PARALLEL  A street rate more than 10% from the official one in 2026:
               Venezuela (12-45% over the year) and Zimbabwe (ZiG, about 20%).
               NOT Argentina, Nigeria, Lebanon or Ethiopia, where the reforms
               of 2024-25 closed the gap to a few per cent.
     FUELWEEK  Pump prices set by the authority on a fixed published cycle
               (see CW_FUEL_CYCLE): weekly in Malaysia, the Philippines and
               Viet Nam; every two weeks in Pakistan, Ghana, Croatia and
               Slovenia; monthly in South Africa, the UAE, Kenya, Sri Lanka,
               Bangladesh (by formula since March 2024), Indonesia
               (Pertamina) and Jordan. NOT Chile, whose cycle changed in 2026. */
const CW_SIGNAL = {
  MUSLIM:   'SA AE QA KW OM BH EG MA DZ TN JO IQ LB PK BD ID MY TR AZ UZ KZ SN',
  POWER:    'ZM PK GH LB NG BD IQ MM',
  PREPAID:  'IN PK BD NG KE GH UG TZ ZM EG PH ID VN MM KH NP LK ET SN CI CM RW MZ AO BW NA ZW ZA',
  PARALLEL: 'VE ZW',
  FUELWEEK: 'MY PH PK ZA AE KE GH LK BD VN HR SI ID JO',
};
/* WHEN EACH FUELWEEK COUNTRY ANNOUNCES ITS PRICES, as the authority does it
   (checked October 2026), so the job names the day rather than "next week". */
const CW_FUEL_CYCLE = {
  MY:'every week', PH:'every Tuesday', PK:'twice a month, for the 1st and the 16th', ZA:'on the first Wednesday of the month',
  AE:'on the last day of every month', KE:'on the 14th of every month', GH:'twice a month, for the 1st and the 16th',
  LK:'at the end of every month', BD:'every month, by formula', VN:'every Thursday', HR:'every two weeks', SI:'every two weeks',
  ID:'on the 1st of every month', JO:'every month',
};
/* A country whose own hand-written jobs already cover one of these does not
   get it twice. */
const CW_SIGNAL_SAME = { prayer:/prayer|ramadan/i, loadshedding:/load.?shedding|power (?:and water )?cuts?/i, bundles:/bundle|airtime/i,
                         parallel:/parallel|d[oó]lar blue|black.market/i, fuelweek:/fuel price|petrol price|pump price/i };
function _cwRowFor(m, f, cc){
  if(!m[0]) return true;
  if(m[0].charAt(0) === '@'){
    if((CW_SIGNAL[m[0].slice(1)] || '').split(' ').indexOf(cc) < 0) return false;
    const same = CW_SIGNAL_SAME[m[1]];
    return !(same && (_cwLocalJobs(cc) || []).some(j => same.test(String(j.title || ''))));
  }
  return !!f[m[0]];
}
/* MONEY FROM FAMILY ABROAD, WHERE THAT IS WHAT IT IS. In the countries on the
   REMIT list (the World Bank's largest receivers, or 10% of GDP and more) the
   money mostly arrives rather than leaves, so the job compares the ways to
   RECEIVE it - the rate and fee the sender pays, and how it lands here: bank,
   mobile wallet or cash pickup. Elsewhere it stays the sender's comparison. */
function _cwRemitHere(isReceiver, C, f, job){
  if(!isReceiver) return job;
  const cur = String((f && f.cur) || '');
  return Object.assign(job, {
    title: 'Money from family abroad, for less',
    desc: 'Which transfer app, bank or agent gets the most ' + (cur || 'money') + ' to you here, after the fee and the exchange rate - and how fast it lands.',
    asks: { q: 'Where is it sent from, and how much usually?', ph: 'e.g. "from the US, about 300 dollars a month"' },
    prompt: 'Compare the main ways to receive the amount named from the country named into ' + _cwThe(C) + ': money-transfer apps, banks and agents, and how it can arrive (bank account, mobile wallet, cash pickup). For each: the fee the sender pays, the exchange rate against the mid-market rate, the amount that arrives in ' + (cur || 'local currency') + ', and how long it takes. Name the cheapest and the fastest, with links. Only current published rates. The user is in ' + C + '. Only real, current information with sources; never invent listings, prices or dates.',
  });
}
function _cwMadeMore(cc){
  const f = _cwFacts[cc], row = _cwCountryRow(cc);
  if(!f || !row) return [];
  const C = row[1], low = cc.toLowerCase();
  const key = m => (m[0] && m[0].charAt(0) !== '@') ? m[0] : '';
  const cyc = t => String(t).split('{cycle}').join(CW_FUEL_CYCLE[cc] || 'at its next review');
  const receives = (CW_POP_BOOST.find(b => b[0] === 'REMIT') || ['', ''])[1].split(' ').indexOf(cc) >= 0;
  return _cwMadeMoreList().filter(m => _cwRowFor(m, f, cc)).map(m => _cwRemitHere(m[1] === 'remit' && receives, C, f, {
    id: 'cc_' + low + '_' + m[1], made: true, country: cc, countryName: C,
    cat: m[2], icon: m[3], every: m[4] === 'monthly' ? 'weekly' : m[4], on: false, needs: 'Web research',
    title: cyc(_cwFill(_cwLocalTitle(m[1], f, C, m[5]), f, key(m), C)), desc: cyc(_cwFill(m[6], f, key(m), C)), where: key(m) ? String(f[key(m)]) : C,
    asks: m[7] ? { q: _cwFill(m[7], f, key(m), C), ph: m[8] } : null,
    prompt: cyc(_cwFill(m[9], f, key(m), C)) + ' The user is in ' + C + '. Only real, current information with sources; never invent listings, prices or dates.',
  }));
}

/* ── WHAT IS MOST USED WHERE YOU ARE: THE ORDER OF THE HUNDRED ──────────────

   Asked for: "the top 5 most popular and the other 100 below it also have to
   be the most popular" - for that country.

   The hundred used to be the catalogue in CATEGORY order, cut at a hundred:
   twenty work jobs, then sixty-four home jobs, and nothing else. Money, school,
   health and family never reached the page in any country, and every country
   got the same order. Now every candidate is scored for the country and the
   hundred are the highest scores, a category never more than a quarter of
   them.

   The score is, in order of authority:
   1. What people in this country actually switch on, once the server has
      counted enough of them (meta.ranked) - the same counts that reorder the
      top five. A real count always outranks research.
   2. Research about the country, from published data, as boosts to the jobs
      it makes matter more there. Each list is conservative - only countries
      the source plainly names - and cites it:
        REMIT  World Bank, personal remittances received in 2024: the ten
               largest by volume (India $138bn, Mexico, the Philippines,
               Pakistan, China, Egypt, Bangladesh, Guatemala, Nigeria - France
               is the tenth and is left out, as its inflow is cross-border
               wages, not family sending money home), or 10% of GDP and more
               (Lebanon 33%, Nepal 26%, Uzbekistan 14%, Georgia 12%, Senegal
               11%). Viet Nam, Morocco (7.8%), Jordan (8.3%), Sri Lanka
               (6.8%), Armenia (4.9%) and Kenya are below both.
        MOMO   Global Findex 2025: half of adults or more hold a mobile money
               account - Kenya 87%, Ghana 78%, Zambia 69%, Uganda 68%,
               Senegal 67%, Tanzania 62%, Rwanda 58%.
        INFL   PwC's IAS 29 list as at June 2026 (three-year cumulative
               inflation above 100%: Argentina, Türkiye, Venezuela, Lebanon)
               and the economies it is watching (Angola, Egypt, Myanmar,
               Nigeria).
        RAIL   Rail kilometres per person in 2023: Switzerland 2,487, Japan,
               Austria, France, Sweden, Germany, Denmark, the Netherlands and
               Britain; plus the four largest networks by passengers (China,
               India, Japan, Russia).
        CAR    OICA, vehicles in use per 1,000 people: the ten highest - New
               Zealand 869, the United States 860, Poland, Italy, Australia,
               Canada, France, Czechia, Portugal, Norway.
        EXAM   A single national exam that decides university entry - gaokao,
               suneung, JEE/NEET, the Common Test, YKS, Thanaweya Amma, JAMB
               and WASSCE, KCSE, UTBK, ENEM, PAES, Saber 11, the Panhellenics,
               UNT, A/Levels, EGE, NMT, Tawjihi, the Iraqi ministerial exams,
               the Algerian and Tunisian bac, the NSC and Ethiopia's national
               exam.
        GOLD   World Gold Council, consumer demand 2024: China and India by
               far, then the markets its tables report on their own -
               Türkiye, the Gulf, Egypt, Viet Nam, Thailand (seventh in bars
               and coins), Indonesia (23t of jewellery) and Pakistan (18t).
        HOUSE  OECD price-to-income index (2015 = 100), the ten highest in
               2024 - where homes have become hardest to afford: Portugal 149,
               Canada 137, the United States 131, the Netherlands 130,
               Switzerland 126, Czechia 124, Australia 122, New Zealand 120.
        FARM   ILO modelled estimates (World Bank), 2023: 40% of jobs or more
               in agriculture - Mozambique 70%, Uganda, Tanzania, Ethiopia,
               Nepal, Angola, Zambia, Rwanda, Zimbabwe, Myanmar, Côte
               d'Ivoire, India 44%, Cameroon 43%.
   3. A base weight per job for how often anybody, anywhere, needs it - the
      weekly shop and the tax deadline above a hobby club.
   A job written by hand for the country (the five in its pack) starts high,
   because somebody chose it for exactly that country. */
/* THE BASE WEIGHT IS PUBLISHED DATA, NOT A GUESS.

   GWI's survey of internet users (Q4 2025, reported by Statista, "main
   reasons for using the internet worldwide"): finding information 60.1%,
   keeping up with news and events 51.4%, researching products and brands
   43.2%, researching places, vacations and travel 36.9%, education and study
   35.8%, managing finances and savings 34.5%, researching health 34.2%. Each
   job is filed under the reason it serves and weighs that share (divided by
   six, to sit on the same scale as the country boosts below). Work, family
   and small-business jobs are not among GWI's measured reasons, so they take
   the lowest measured share rather than an invented one - and climb as soon
   as people in a country actually switch them on (the count, below, always
   outranks this). */
const CW_GWI = { info:60.1, news:51.4, products:43.2, travel:36.9, education:35.8, finance:34.5, health:34.2 };
const CW_GWI_FLOOR = 34.2;
const CW_KIND_REASON = {
  info:'tax refund deductions selfemployed localtax id travel gov appts benefits workrules newlaws consumer rentrights moving calendar prayer drivingtest pension childcare parental schoolterms bizlicence smbtax tenders recalls breaches localscams scams limits outages loadshedding disruption strikes commute traffic holidays events free',
  news:'news localnews evening industry elections team weather dailyweather warnings weekend air healthalerts',
  products:'groc offers staples rises meals swaps shop realdeal cheaper sales returns secondhand phones food deliveryfees newplaces restaurants telco phoneplan broadband bundles energy fuel fuelweek cookinggas pricerises discounts gold market crypto fx parallel carinsurance homeinsurance insurance concerts gym pets hobby ride bus transit',
  travel:'rail release pass flights hotels getaway flightshome roaming visa',
  education:'exams papers results uni studydeadlines grants housing abroad training schoolfees',
  finance:'banks save savings fees cards switch mortgage ccrates budget rates remit value homeprices prop rents drops',
  health:'health clinics pharmacy waits mind races checkups eldercare',
};
const CW_POP_BASE = (() => {
  const out = {};
  Object.keys(CW_KIND_REASON).forEach(r => CW_KIND_REASON[r].split(' ').forEach(k => { out[k] = Math.round(CW_GWI[r] / 6 * 10) / 10; }));
  return out;
})();
const CW_POP_BOOST = [
  ['REMIT', 'IN MX PH PK CN EG BD GT NG LB NP UZ GE SN', { remit:8, fx:3, limits:2 }],
  ['MOMO',  'KE GH ZM UG SN TZ RW', { limits:5, scams:4, remit:2 }],
  ['INFL',  'AR TR VE LB AO EG MM NG', { staples:4, rises:4, pricerises:4, fx:4, gold:2, budget:2 }],
  ['RAIL',  'CH JP AT FR SE DE DK NL GB CN IN RU', { rail:4, strikes:3, release:3, pass:3, transit:3 }],
  ['CAR',   'NZ US PL IT AU CA FR CZ PT NO', { car:3, fuel:3, carinsurance:3, traffic:2, drivingtest:2, fines:2 }],
  ['EXAM',  'CN KR IN JP VN TR EG NG GH KE PK BD ID BR CL CO GR KZ LK RU UA GE AZ JO IQ DZ TN ZA ET', { exams:4, papers:4, results:3, uni:2, studydeadlines:2 }],
  ['GOLD',  'IN CN TR AE SA EG PK VN TH ID', { gold:6 }],
  ['HOUSE', 'PT CA US NL CH CZ AU NZ', { prop:2, rents:3, homeprices:3, rentrights:2, mortgage:2 }],
  ['FARM',  'MZ UG TZ ET NP AO ZM RW ZW MM CI IN CM', { farm:7 }],
];
/* HOW STRONGLY, where the source gives a number for every country on the
   list: the boost is scaled from half (the lowest on the list) to full (the
   highest), so Kenya's 87% of adults on mobile money counts for more than
   Rwanda's 58%, and Portugal's 49-point rise in house prices against incomes
   for more than New Zealand's 20. Lists whose source only says "in" or "out"
   (remittances by volume, rail by network size, the national exams, the gold
   markets) apply evenly. */
const CW_POP_STRENGTH = {
  MOMO:  { KE:87, GH:78, ZM:69, UG:68, SN:67, TZ:62, RW:58 },                       // Findex 2025, % adults
  REMIT: { LB:33.3, NP:26.2, GT:19.1, UZ:14.4, GE:11.9, SN:11.4, PH:8.7, NG:8.4, PK:8, EG:7.6, BD:5, MX:3.6, IN:3.3, CN:0.2 }, // World Bank 2024, % of GDP
  FARM:  { MZ:69.5, UG:65.9, TZ:65.4, ET:62.4, NP:61.2, AO:56.2, ZM:55.4, RW:54.8, ZW:52.5, MM:45.2, CI:45.2, IN:43.5, CM:43.4 }, // ILO 2023, % jobs
  CAR:   { NZ:869, US:860, PL:761, IT:756, AU:737, CA:707, FR:704, CZ:658, PT:640, NO:635 }, // OICA, per 1,000
  HOUSE: { PT:48.8, CA:37.0, US:30.7, NL:30.4, CH:25.8, CZ:24.4, AU:21.8, NZ:19.6 },  // OECD 2024, rise since 2015
  INFL:  { AR:2, TR:2, VE:2, LB:2, AO:1, EG:1, MM:1, NG:1 },                        // IAS 29 list 2, watch list 1
};
/* The least a figure must reach for the list to put a job in a country's TOP
   FIVE (the hundred still takes the scaled boost). Money from abroad is under
   1% of China's economy: sixth in the world by volume, not a top-five job for
   somebody living there. */
const CW_FIVE_MIN = { REMIT: 3 };
function _cwBoostScale(name, cc){
  const t = CW_POP_STRENGTH[name]; if(!t || !(cc in t)) return 1;
  const vals = Object.values(t), lo = Math.min(...vals), hi = Math.max(...vals);
  return hi === lo ? 1 : 0.5 + 0.5 * (t[cc] - lo) / (hi - lo);
}
/* The job's kind, without its country: cc_jp_tax -> tax, top_jp_inbox -> inbox. */
function _cwKind(j){
  const id = String((j && j.id) || '');
  const m = /^(?:cc|top|ev)_[a-z]{2}_(.+)$/.exec(id);
  return m ? m[1] : id;
}
function _cwPopScore(j, cc){
  const kind = _cwKind(j);
  let n;
  /* Written by hand for this one country: at the top of the measured scale,
     because somebody chose it for exactly this country from its facts. */
  if(String(j.id || '').indexOf('ev_' + String(cc).toLowerCase() + '_') === 0) n = CW_GWI.info / 6;
  else if(Object.prototype.hasOwnProperty.call(CW_POP_BASE, kind)) n = CW_POP_BASE[kind];
  /* The jobs that are the same everywhere run on the person's own accounts
     (mail, calendar, bank): finding information in their own data - GWI's
     largest reason - where they need an account, the floor where they do not. */
  /* On a country's page, a job written for the country answers the same need
     with that country's own services, so the one-size version sits at the
     floor and climbs only when people there actually start it. */
  else n = CW_GWI_FLOOR / 6;
  /* A job that exists only where a published source says it matters (prayer
     times, load-shedding, prepaid bundles, the parallel rate, weekly fuel
     prices - see CW_SIGNAL) carries that source's weight on top. */
  if(CW_SIGNAL_SAME[kind]) n += 4;
  CW_POP_BOOST.forEach(([name, where, add]) => { if(where.split(' ').indexOf(cc) >= 0 && add[kind]) n += add[kind] * _cwBoostScale(name, cc); });
  /* A count beats research: up to +16 for what people here switch on most,
     weighted by its share of every start in the country - 30 of 40 is the
     country speaking, one of 40 is a single person. */
  try{
    const m = _cwMeta[cc];
    if(m && m.ranked && m.ranked.enough){
      const c = +m.ranked.counts[j.id] || 0, total = Math.max(1, +m.ranked.total || 0);
      if(c > 0) n += Math.min(16, 2 * Math.log2(1 + c) + 12 * Math.min(1, c / total));
    }
  }catch(e){}
  /* Where a bank cannot be linked, a job that needs one cannot run at all. */
  try{ if(/Bank connection/.test(String(j.needs || '')) && cc && !(Object.prototype.hasOwnProperty.call(_cwBank, cc) ? _cwBank[cc] : cc === 'US')) n -= 20; }catch(e){}
  return n;
}
try{ window._cwPopScore = _cwPopScore; window.CW_POP_BOOST = CW_POP_BOOST; window._cwKind = _cwKind; window.CW_GWI = CW_GWI; window.CW_POP_BASE = CW_POP_BASE; }catch(e){}

/* ── THE TOP FIVE, BUILT FROM WHAT PEOPLE THERE ACTUALLY CONNECT ─────────────

   Asked for: in the US the top five should say "connect Visa or Amex" and
   "check Gmail", and in China whatever China uses - not "pay bills in the US".
   So the five are built from the country's data, most valuable first:

     1. the inbox - named for the mailbox people there use most (Gmail in the
        US, QQ Mail in China, Naver in Korea, WEB.DE in Germany; see
        COUNTRY_MAIL on the server for the sources), with Connect going
        straight to that provider's sign-in;
     2. money - where a bank or card can be linked (the US), the card issuers
        people there hold; everywhere else, the bills that arrive in that same
        inbox, because nothing here pretends to link a bank that cannot be;
     3-5. the local services AMV uses without a sign-in: the job sites, the
        shops, the tax office.

   Every one is a real job that runs unattended once its one connection is
   made. The five written by hand for each country move to the row below. */
function _cwBaseJob(id){ try{ return (_cwDefaultJobs() || []).find(j => j.id === id) || {}; }catch(e){ return {}; } }
/* THE TOP TEN: ONE FOR EACH PART OF LIFE, BUILT FROM THE COUNTRY'S DATA.

   Asked for: not only mail and money - every main thing: the bank, the mail,
   the calendar, school and assignments, work, the weekly shop, shopping,
   government, getting around, home. Each row is the country's own version,
   and each is backed by research on what people there actually use (see the
   sources beside COUNTRY_MAIL, COUNTRY_CLASSROOM, BANK_ELSEWHERE, WORK_APPS
   and COUNTRY_FACTS on the server):

     Mail      the mailbox people there use most, connected directly
     Bank      the bank itself, linked read-only, where a bank can be linked;
               elsewhere the bills in that inbox, and the card says plainly
               that linking the bank is not available there yet
     Calendar  Google Calendar or Outlook, whichever goes with that mailbox
     School    Google Classroom where schools run on it; the national exam
               everywhere else
     Work      the country's own job sites
     Groceries, Shopping, Government, Travel, Home - the local services by name

   A section with no real local answer is left out rather than filled with a
   generic one, and the list tops up from the next section down. */
const CW_SECTION_ORDER = ['mail','bank','calendar','school','work','groceries','shopping','government','travel','home','phone','news'];
function _cwTopTen(cc){
  const f = _cwFacts[cc], row = _cwCountryRow(cc);
  if(!f || !row || !Object.keys(f).length) return [];
  const C = row[1], box = _cwInbox[cc] || [], m1 = box[0], meta = _cwMeta[cc] || {};
  const boxNames = _cwNames(box.map(b => b.name).join(', '), 2);
  const low = cc.toLowerCase(), by = {};
  const made = _cwMadeForJobs(cc);
  const take = (k, sec) => { const j = made.find(x => x.id === 'cc_' + low + '_' + k); return j ? Object.assign({}, j, { top:true, section:sec }) : null; };
  if(m1){
    const b = _cwBaseJob('inbox_digest');
    by.mail = { id:'top_' + low + '_inbox', top:true, section:'Mail', country:cc, countryName:C, cat:'Inbox & calendar', icon:'📬',
      on:false, needs:'Email', connectHow:m1.how, mailName:m1.name, every:'daily',
      title:'Your ' + m1.name + ' inbox, sorted every evening',
      desc:'Connect ' + boxNames + ' and each evening AMV lists the emails that actually need you, with a reply drafted for each. Nothing is sent without you.',
      prompt:(b.prompt || '') + ' The user is in ' + C + '.' };
  }
  if(_cwBank[cc]){
    const b = _cwBaseJob('unusual_spend');
    const banks = _cwNames([f.cards, f.banks].filter(Boolean).join(', '), 4);
    by.bank = { id:'top_' + low + '_cards', top:true, section:'Bank', country:cc, countryName:C, cat:'Money', icon:'🏦',
      on:false, needs:'Bank connection', every:'daily',
      title:'Your ' + _cwNames(f.cards || f.banks, 2) + ' accounts, watched daily',
      desc:'Link ' + banks + ' or any bank directly, read-only - balances, bills and anything unusual, straight from the bank, not from emails. AMV can never move money.',
      prompt:(b.prompt || '') + ' The user is in ' + C + '.' };
  } else if(m1){
    const b = _cwBaseJob('bills_due');
    const pays = _cwNames([f.banks, f.pay].filter(Boolean).join(', '), 3);
    by.bank = { id:'top_' + low + '_bills', top:true, section:'Bank', country:cc, countryName:C, cat:'Money', icon:'🧾',
      on:false, needs:'Email', connectHow:m1.how, mailName:m1.name, every:'daily',
      title:'Bills and payments, from your ' + m1.name,
      desc:'Linking ' + (pays || 'a bank') + ' directly is not available in ' + C + ' yet' + (meta.bankElsewhere ? ' (it needs ' + meta.bankElsewhere + ')' : '') + ', so AMV reads the bills and statements that arrive in ' + m1.name + ' instead.',
      prompt:(b.prompt || '') + ' The user is in ' + C + '.' };
  }
  if(m1 && (m1.how === 'g' || m1.how === 'ms')){
    const b = _cwBaseJob('calendar_brief');
    const cal = m1.how === 'g' ? 'Google Calendar' : 'Outlook Calendar';
    by.calendar = { id:'top_' + low + '_calendar', top:true, section:'Calendar', country:cc, countryName:C, cat:'Inbox & calendar', icon:'📅',
      on:false, needs:'Calendar', every:'daily',
      title:'Tomorrow, from your ' + cal,
      desc:'Every evening: what is on tomorrow, what clashes, and what to prepare - read from ' + cal + ', never changed.',
      prompt:(b.prompt || '') + ' The user is in ' + C + '.' };
  }
  if(meta.classroom){
    const b = _cwBaseJob('school_auto');
    by.school = { id:'top_' + low + '_school', top:true, section:'School', country:cc, countryName:C, cat:'Learning', icon:'🎒',
      on:false, needs:'Classroom', every:'daily',
      title:'Assignments due, from Google Classroom',
      desc:'Every day: what is due, what is late and what to start first, read from Google Classroom. AMV cannot hand anything in.',
      prompt:(b.prompt || '') + ' The user is in ' + C + '.' };
  } else {
    by.school = take('exams', 'School');
  }
  by.work = take('jobs', 'Work');
  if(by.work && meta.work) by.work.desc += ' People here work in ' + meta.work + '.';
  by.groceries = take('groc', 'Groceries');
  by.shopping = take('shop', 'Shopping');
  by.government = take('tax', 'Government') || take('gov', 'Government');
  by.travel = take('rail', 'Travel') || take('car', 'Travel');
  by.home = take('prop', 'Home') || take('health', 'Health');
  by.phone = take('telco', 'Phone');
  by.news = take('news', 'News');
  /* The inbox and the money come first everywhere - they are the two jobs
     that work on what is yours. The rest follow the research for the country
     (CW_POP_BOOST): the train where people live on trains, the weekly shop
     where prices move fastest, the exam where one exam decides university. */
  const SEC_BOOST = { travel:{ RAIL:5 }, groceries:{ INFL:4 }, school:{ EXAM:2 }, home:{ HOUSE:2 }, shopping:{}, government:{}, work:{}, calendar:{} };
  const signals = CW_POP_BOOST.filter(([, where]) => where.split(' ').indexOf(cc) >= 0).map(b => b[0]);
  const keys = CW_SECTION_ORDER.filter(k => by[k]);
  const head = keys.filter(k => k === 'mail' || k === 'bank');
  const rest = keys.filter(k => k !== 'mail' && k !== 'bank')
    .map((k, i) => [k, (CW_SECTION_ORDER.length - CW_SECTION_ORDER.indexOf(k)) + signals.reduce((n, sig) => n + ((SEC_BOOST[k] || {})[sig] || 0), 0), i])
    .sort((a, b) => (b[1] - a[1]) || (a[2] - b[2])).map(x => x[0]);
  const sectionRows = head.concat(rest).map(k => by[k]);
  /* THE TOP FIVE IS THE COUNTRY'S OWN, NOT A TEMPLATE WITH NAMES IN IT.

     Measured: 28 countries had exactly the same five (inbox, bills, calendar,
     exam, job hunt) and 105 countries had 21 line-ups between them, because
     the five were the section template above with the local names filled in.
     The jobs that are most specifically a country's - its hand-written ones
     and the ones the research gates on it (prayer times, power cuts, the fuel
     price day, money sent home, M-Pesa limits) - never reached the five.

     Now: the mailbox people use there first (the one connection most jobs
     run on), then a bank only where one can really be linked, then the
     highest-scoring of everything local (_cwPopScore: the published base, the
     country's research and, once there are enough, what people there switch
     on) - at most one per part of life, at most two of the hand-written ones,
     and at least one of them. Calendar, the generic bills and the job hunt
     follow in the rest of the ten. */
  /* A country's hand-written jobs all arrive as "Home & life", which would
     let five of them pass as five different things. Each is labelled by what
     it is about instead - the label on the row says so too. */
  const PACK_SEC = { '\uD83E\uDDFE':'Tax', '\uD83D\uDE97':'Car', '\uD83C\uDFE0':'Home', '\u26A1':'Bills', '\uD83D\uDCA1':'Bills',
    '\uD83C\uDFE5':'Health', '\uD83C\uDF93':'School', '\uD83C\uDF92':'School', '\uD83E\uDEAA':'Documents', '\uD83D\uDCB3':'Money',
    '\uD83C\uDFE6':'Money', '\uD83D\uDCB0':'Money', '\uD83D\uDCF1':'Phone', '\uD83D\uDD0C':'Bills', '\uD83D\uDCC5':'Calendar' };
  const five = [];
  const used = new Set(), secs = new Set();
  const secOf = j => { const v = String(j.section || j.cat || ''); return v === 'Learning' ? 'School' : v === 'Government' ? 'Tax' : v; };
  const put = j => { if(!j || used.has(j.id)) return false; five.push(j); used.add(j.id); secs.add(secOf(j)); return true; };
  if(by.mail) put(by.mail);
  if(by.bank && _cwBank[cc]) put(by.bank);
  const packIds = new Set();
  const pool = [];
  try{ (_cwLocalJobs(cc) || []).forEach(j => { packIds.add(j.id); pool.push(Object.assign({}, j, { top:true, section: PACK_SEC[j.icon] || C, country:cc, countryName:C })); }); }catch(e){}
  const KIND_SEC = { staples:'Groceries', rises:'Groceries', pricerises:'Groceries', papers:'School', exams:'School', results:'School', rail:'Travel', fuelweek:'Car', prayer:'Faith', loadshedding:'Power', parallel:'Money', remit:'Money', limits:'Money', gold:'Money', bundles:'Phone' };
  try{ (_cwMadeMore(cc) || []).forEach(j => pool.push(Object.assign({}, j, { top:true, section: KIND_SEC[_cwKind(j)] || (j.cat === 'Learning' ? 'School' : j.cat) }))); }catch(e){}
  ['school','travel','groceries','home','government','shopping','phone','news'].forEach(k => { if(by[k]) pool.push(by[k]); });
  /* Only what has evidence for THIS country competes for the five: its own
     hand-written jobs, the jobs a published signal puts here (prayer times,
     power cuts, the fuel-price day, prepaid bundles, the parallel rate), and
     the main job of each research list the country is on - the train fares
     where people live on trains, not the strikes; money from family abroad
     where it is a tenth of the economy. A job everybody everywhere could
     want (work rules, traffic) is in the hundred, not the five. */
  const lists = CW_POP_BOOST.filter(([, where]) => where.split(' ').indexOf(cc) >= 0);
  const primary = new Set(lists.filter(([name]) => !(name in CW_FIVE_MIN) || ((CW_POP_STRENGTH[name] || {})[cc] || 0) >= CW_FIVE_MIN[name])
    .map(([, , add]) => { const ks = Object.keys(add), mx = Math.max(...ks.map(k => add[k])); return ks.find(k => add[k] === mx); }));
  if(lists.some(b => b[0] === 'EXAM')) primary.add('papers');
  const counted = j => !!(meta.ranked && meta.ranked.enough && +meta.ranked.counts[j.id] > 0);
  const evidenced = j => counted(j) || packIds.has(j.id) || !!CW_SIGNAL_SAME[_cwKind(j)] || primary.has(_cwKind(j))
    || (j.section && ['School','Travel','Groceries','Home'].includes(j.section) && (
         (j.section === 'Travel' && primary.has('rail')) || (j.section === 'School' && lists.some(b => b[0] === 'EXAM'))
      || (j.section === 'Groceries' && lists.some(b => b[0] === 'INFL')) || (j.section === 'Home' && lists.some(b => b[0] === 'HOUSE'))));
  const scored = pool.filter((j, i, a) => j && a.findIndex(x => x && x.id === j.id) === i && evidenced(j))
    .map((j, i) => [j, _cwPopScore(j, cc), i]).sort((a, b) => (b[1] - a[1]) || (a[2] - b[2])).map(x => x[0]);
  const packIn = () => five.filter(j => packIds.has(j.id)).length;
  for(const j of scored){
    if(five.length >= 5) break;
    if(secs.has(secOf(j))) continue;
    if(packIds.has(j.id) && packIn() >= 2) continue;
    put(j);
  }
  if(!packIn()){
    const best = scored.find(j => packIds.has(j.id));
    if(best){ if(five.length >= 5){ const out = five.pop(); used.delete(out.id); } put(best); }
  }
  /* Still short: the country's own sections (its job sites, its weekly shop,
     its exam) in the research order above, one per part of life, then up to
     one more of its hand-written jobs. Never four pieces of paperwork. */
  const generic = j => j === by.calendar || (j === by.bank && !_cwBank[cc]);
  for(const j of sectionRows){ if(five.length >= 5) break; if(generic(j) || secs.has(secOf(j))) continue; put(j); }
  for(const j of scored){ if(five.length >= 5) break; if(packIds.has(j.id) && packIn() >= 3) continue; put(j); }
  for(const j of sectionRows){ if(five.length >= 5) break; if(!generic(j)) put(j); }
  for(const j of sectionRows){ if(five.length >= 5) break; put(j); }
  const rows = five.concat(sectionRows.filter(j => !used.has(j.id) && !secs.has(secOf(j)))).slice(0, 10);
  /* ORDERED BY WHAT PEOPLE HERE SWITCH ON, once enough of them have. Until
     then the order is the research's, and the heading says which it is. A
     stable sort: rows nobody has started yet keep the research order among
     themselves, under the ones people have. */
  const rk = meta.ranked;
  if(rk && rk.enough){
    const n = id => +rk.counts[id] || 0;
    rows.forEach((r, i) => { r._rank = i; });
    rows.sort((a, b) => (n(b.id) - n(a.id)) || (a._rank - b._rank));
  }
  return rows;
}
function _cwRankedHere(cc){ const m = _cwMeta[cc]; return !!(m && m.ranked && m.ranked.enough); }
/* The top five, for anything that still asks for five: the first five of ten. */
function _cwTopFive(cc){ return _cwTopTen(cc).slice(0, 5); }
function _cwTopRowHTML(j, i){
  const allowed = (() => { try{ return _planAllowsCrew(); }catch(e){ return false; } })();
  const saved = (() => { try{ return (_cwJobs() || []).find(x => x.id === j.id) || null; }catch(e){ return null; } })();
  const on = !!(saved && saved.on);
  const miss = (() => { try{ return _cwNeedsMissing(j); }catch(e){ return []; } })();
  const act = !allowed
    ? `<button class="cw-t10-see" data-dact="cwPeek" data-darg="${escH(j.id)}">${escH(T('See it'))} →</button>`
    : (miss.length && !on)
      ? `<button class="btn bp cw-t10-conn" data-dact="cwConnect" data-darg="${escH(j.id)}">${escH(T('Connect'))}</button>`
      : `<button class="cw-toggle ${on ? 'on' : ''}" data-dact="cwToggle" data-darg="${escH(j.id)}" aria-label="Turn ${escH(j.title)} ${on ? 'off' : 'on'}"><span class="cw-knob"></span></button>`;
  return `<li class="cw-t10${on ? ' on' : ''}">
    <span class="cw-t10-n" aria-hidden="true">${i + 1}</span>
    <span class="cw-t10-ic" aria-hidden="true">${_safeIcon(j.icon)}</span>
    <button class="cw-t10-body" data-dact="cwPeek" data-darg="${escH(j.id)}">
      <span class="cw-t10-sec">${escH(T(j.section || ''))}</span>
      <span class="cw-t10-t">${escH(j.title)}</span>
      <span class="cw-t10-d">${escH(j.desc)}</span>
    </button>
    <span class="cw-t10-act">${act}</span>
  </li>`;
}
/* A row of cards, not a grid: it arrives with the country and must not push
   anything down when it does, so it is one fixed height whatever the count. */
function _cwMadeForHTML(){
  if(_cwHerePending()){
    return `<section class="cw-made" id="cw-made" aria-busy="true"><div class="sec-head"><h3>${escH(T('Made for where you are'))}</h3>
      <span class="sec-sub">${escH(T('Built on the services people there actually use.'))}</span></div>
      <div class="cw-made-row" data-hscroll>${'<div class="cw-made-ph" aria-hidden="true"></div>'.repeat(4)}</div></section>`;
  }
  const cc = _cwCountryGuess(), row = _cwCountryRow(cc);
  const st = row ? (_cwLocalState[cc] || 'loading') : 'none';
  if(!row || st === 'offline') return '<section class="cw-made" id="cw-made" hidden></section>';
  /* The ranked ten past the five shown above lead this row, so asking for five
     at the top did not quietly delete numbers six to ten. */
  const ten = st === 'ok' ? _cwTopTen(cc) : [];
  const inTop = new Set(ten.map(j => j.id));
  const jobs = st === 'ok'
    ? ten.slice(5).concat(inTop.size ? _cwLocalJobs(cc).filter(j => !inTop.has(j.id)) : []).concat(_cwMadeForJobs(cc).filter(j => !inTop.has(j.id)))
    : [];
  if(st === 'ok' && !jobs.length) return '<section class="cw-made" id="cw-made" hidden></section>';
  const card = _cwMadeCard;
  return `<section class="cw-made" id="cw-made"${st === 'ok' ? '' : ' aria-busy="true"'}>
    <div class="sec-head"><h3>${escH(T('Made for'))} <span class="cw-flag" aria-hidden="true">${row[2]}</span> <span class="cw-made-cn">${escH(row[1])}</span>${st === 'ok' ? ` <span class="cw-made-n">${jobs.length}</span>` : ''}</h3>
      <span class="sec-sub">${escH(T('Built on the services people there actually use.'))}</span></div>
    <div class="cw-made-row" data-hscroll role="list">${st === 'ok' ? jobs.map(j => `<div role="listitem" class="cw-made-it">${card(j)}</div>`).join('')
                                                     : '<div class="cw-made-ph" aria-hidden="true"></div>'.repeat(4)}</div>
  </section>`;
}
function _cwMadeCard(j){
  const saved = {}; try{ (_cwJobs() || []).forEach(j => { saved[j.id] = j; }); }catch(e){}
  const allowed = (() => { try{ return _planAllowsCrew(); }catch(e){ return false; } })();
  const card = j => {
    const on = !!(saved[j.id] && saved[j.id].on);
    return `<div class="cw-made-card${on ? ' on' : ''}">
      <button class="cw-made-body" data-dact="cwPeek" data-darg="${escH(j.id)}">
        <span class="cw-made-top"><span class="cw-made-ic" aria-hidden="true">${_safeIcon(j.icon)}</span><span class="cw-made-t">${escH(j.title)}</span></span>
        <span class="cw-made-d">${escH(j.desc)}</span>
      </button>
      <div class="cw-made-foot"><span class="cw-made-run">${escH(T('Runs with AMV closed'))}</span>
        ${allowed
          ? `<button class="cw-toggle ${on ? 'on' : ''}" data-dact="cwToggle" data-darg="${escH(j.id)}" aria-label="Turn ${escH(j.title)} ${on ? 'off' : 'on'}"><span class="cw-knob"></span></button>`
          : `<button class="cw-made-see" data-dact="cwPeek" data-darg="${escH(j.id)}">${escH(T('See it'))} \u2192</button>`}</div>
    </div>`;
  };
  return card(j);
}
function _cwMadeForRepaint(){
  try{ const el = document.getElementById('cw-made'); if(el) el.outerHTML = _cwMadeForHTML(); }catch(e){}
}
try{ window._cwMadeForJobs = _cwMadeForJobs; window._cwMadeForList = _cwMadeForList; window._loadCrewData = _loadCrewData; }catch(e){}
/* What a catalogue job looks up where you are: its fixed facts (CW_LOC), plus
   the mailboxes people there use when it reads mail, plus the cards that can
   be linked when it reads a bank. */
function _cwLocKeys(j){
  if(!j) return [];
  const needs = String(j.needs || '');
  const keys = (CW_LOC[j.id] || []).slice();
  if(/\bEmail\b/.test(needs) && keys.indexOf('inbox') < 0) keys.unshift('inbox');
  if(/Bank connection/.test(needs) && keys.indexOf('cards') < 0) keys.unshift('cards');
  return keys;
}
function _cwLocText(id, cc){
  const row = _cwCountryRow(cc); if(!row) return '';
  const f = _cwFacts[cc];
  const j = _cwLocJob(id);
  const keys = j ? _cwLocKeys(j) : (CW_LOC[id] || []);
  const fact = k => {
    if(k === 'inbox') return (_cwInbox[cc] || []).slice(0, 3).map(b => b.name).join(', ');
    if(k === 'cards'){
      if(!f) return '';
      /* Said, not skipped: a bank job where no bank can be linked is a job
         that cannot run, and the card is where somebody decides. */
      return _cwBank[cc] ? String(f.cards || f.banks || '') : 'bank linking is not available here yet';
    }
    return String((f && f[k]) || '');
  };
  const hits = f ? keys.map(fact).filter(Boolean) : [];
  /* Said the same way whether the facts arrived or not, so a card never
     changes height when they do - only the words after the colon change. */
  return hits.length ? T('In') + ' ' + row[1] + ': ' + hits.join(' · ')
                     : T('Answers for') + ' ' + row[1];
}
const _cwLocJobs = {};
function _cwLocJob(id){ return _cwLocJobs[id] || null; }
function _cwLocLine(j){
  if(!j || j.local || j.top || j.made || !_cwLocKeys(j).length) return '';
  _cwLocJobs[j.id] = j;
  /* While AMV is still hearing where somebody is, the line holds its place
     empty: naming the browser's guess and then another country is the flash
     this page was fixed not to have. */
  const text = _cwHerePending() ? '' : _cwLocText(j.id, _cwCountryGuess());
  return `<span class="cw-job-loc" data-loc="${escH(j.id)}">${escH(text)}</span>`;
}
/* Fills the lines in place once the country or its facts arrive - the cards
   are not rebuilt, so nothing on the page moves and nothing open closes. */
function _cwLocFill(){
  try{
    if(_cwHerePending()) return;
    const cc = _cwCountryGuess();
    document.querySelectorAll('.cw-job-loc[data-loc]').forEach(el => {
      const t = _cwLocText(el.getAttribute('data-loc'), cc);
      if(el.textContent !== t) el.textContent = t;
    });
  }catch(e){}
}
/* WHAT WAS ALREADY ASKED, AND UNDER WHAT CONDITIONS.

   A failed lookup leaves no cache entry, and the failure path re-renders. So
   the render asked, the answer failed, the failure re-rendered, and the render
   asked again: about thirty-seven requests a second, forever, from every
   browser whose first attempt happened to miss. Measured rather than guessed -
   146 requests in four seconds - and it is a denial of service on AMV's own
   servers, written by AMV, triggered by one bad minute of network.

   The key is the SITUATION rather than a flat "already tried", because the one
   thing that would make asking again sensible - a backend becoming reachable -
   is the thing it records. When that changes the key changes and the question
   is asked once more. Nothing else re-asks, so a country that answered "cannot
   reach the server" says so and stays quiet.

   Signing in used to be part of this key, because the catalogue used to need
   an account. It is public now, so signing in changes nothing about the answer
   and has no business invalidating it. */
const _cwLocalTried = {};
function _cwLocalCtx(){
  const api = window.AMV_API;
  return api && api.live ? '1' : '0';
}
function _cwLocalJobs(code){
  const cc = String(code || '').toUpperCase();
  if(!cc) return [];
  return _cwLocalCache[cc] || [];
}
async function _cwLoadLocal(code){
  const cc = String(code || '').toUpperCase();
  if(!cc || _cwLocalCache[cc] || _cwLocalState[cc] === 'loading') return;
  const ctx = _cwLocalCtx();
  if(_cwLocalTried[cc] === ctx) return;
  _cwLocalTried[cc] = ctx;
  /* Asked only when there is something to ask. With no backend the call cannot
     answer - and calling anyway produced the worst possible outcome: an empty
     list that the screen then reported as "nothing specific to Spain is written
     yet", which is FALSE. Spain has five, and the copy was stating the opposite
     because it could not tell "the server says none" from "there was no
     server".

     No account is needed any more. The catalogue is public, so a visitor who
     has never signed up sees what AMV does where they live - which is the
     question they are actually asking. */
  if(!(window.AMV_API && AMV_API.live)){ _cwLocalState[cc] = 'offline'; return; }
  _cwLocalState[cc] = 'loading';
  try{
    const d = await AMV_API.everyday(cc);
    /* The real endpoint always returns the country list. Anything without it
       did not come from the catalogue, so it is not an answer about what
       exists - it is an absence of one. */
    if(!d || !Array.isArray(d.countries)) throw new Error('no catalogue');
    const name = (d && d.name) || cc;
    const local = Array.isArray(d.local) ? d.local : [];
    _cwFacts[cc] = (d.facts && typeof d.facts === 'object' && !Array.isArray(d.facts)) ? d.facts : {};
    _cwInbox[cc] = Array.isArray(d.inbox) ? d.inbox.filter(m => m && m.id && m.name && m.how) : [];
    _cwBank[cc] = !!d.bank;
    const rk = (d.ranked && typeof d.ranked === 'object') ? d.ranked : {};
    _cwMeta[cc] = { classroom: !!d.classroom, bankElsewhere: String(d.bankElsewhere || ''), work: String(d.work || ''),
      ranked: { enough: !!rk.enough, total: +rk.total || 0, need: +rk.need || 25,
                counts: (rk.counts && typeof rk.counts === 'object' && !Array.isArray(rk.counts)) ? rk.counts : {} } };
    _cwLocalCache[cc] = local.map(j => _cwEverydayJob(Object.assign({ country: cc }, j), name, true));
    _cwLocalState[cc] = 'ok';
  }catch(e){
    /* One reason left, now that the catalogue is public: the server could not
       be reached. Not cached as an empty list, so a connection coming back can
       still fill this in - an empty list would be a claim that the country has
       nothing, which is a different and false statement. */
    _cwLocalState[cc] = 'offline';
  }
  /* THE COUNTRY BLOCK REPAINTS ITSELF. Replacing the whole Crew view because
     one country's jobs arrived is what "crew still buffers" is describing: the
     screen is thrown away and rebuilt, losing scroll and anything open, to
     update one section that has its own id. Measured before this: three full
     rebuilds per open. The fallback is still a full render, for the case where
     the block is not on the page - a search, or a category other than all. */
  try{
    if(S.tab === 'crew'){
      let done = false;
      if(cc === _cwCountryGuess()){ const el = document.getElementById('cw-foryou'); if(el){ el.outerHTML = _cwForYouHTML(); done = true; } }
      /* The country's own page is waiting on exactly this answer, and every
         part of it below the box is a placeholder until it lands - so it is
         drawn again whole, with nothing on it that could have moved. */
      if(_cwPageNow() === 'country' && cc === _cwCountryGuess()){
        const el = document.getElementById('cw-cp-list');
        if(el){ _cwShowcaseCache = null; el.innerHTML = _cwCpListHTML(cc); done = true;
                const fx = document.getElementById('cw-cp-facts'); if(fx) fx.innerHTML = _cwCpFactsHTML(cc);
                const fy = document.getElementById('cw-foryou'); if(fy) fy.outerHTML = _cwForYouHTML(); _cwLocFill(); return; }
      }
      if(!done) _cwRepaintSoon();
      if(cc === _cwCountryGuess()){ _cwLocFill(); _cwMadeForRepaint(); _cwReRank(); }
    }
  }catch(e){ try{ if(S.tab === 'crew') _cwRepaintSoon(); }catch(e2){} }
}
try{ window._cwUniversalJobs=_cwUniversalJobs; window._cwLocalJobs=_cwLocalJobs;
     window._cwLoadLocal=_cwLoadLocal; window.CW_EVERYDAY_UNIVERSAL=CW_EVERYDAY_UNIVERSAL; }catch(e){}
try{ window.CW_WORLD_COUNTRIES = CW_WORLD_COUNTRIES; }catch(e){}

/* THE POOL, AND THE HUNDRED THAT GET SHOWN.

   The catalogue used to render every job it had. Asked to stop: "i don't want
   all, just show 100 random examples around the world in the boxes below
   crew". Which is the right instinct - two hundred cards is a wall, and a wall
   reads as less capable than a shelf, not more.

   So the pool is everything AMV can actually run (the built-in jobs plus one
   real job per country) and the SHOWCASE is a hundred of them. World examples
   come first in the sample, because they are the half nobody could see before
   and the half that answers "does this work where I live".

   A world example is a real job with a country named in its instruction, so
   switching one on switches on that job - it is not a card that does nothing. */
function _cwAllJobs(){
  try{ const cc = _cwCountryGuess();
       const have = new Set((_cwJobs() || []).map(j => j.id));
       return (_cwJobs() || []).concat(_cwUniversalJobs() || [])
                              .concat(_cwLocalJobs(cc) || [])
                              .concat((_cwTopTen(cc) || []).filter(j => !have.has(j.id)))
                              .concat((_cwMadeForJobs(cc) || []).filter(j => !have.has(j.id)))
                              .concat((_cwMadeMore(cc) || []).filter(j => !have.has(j.id)))
                              /* And the country being browsed at the bottom, so
                                 its cards open and switch on like any other. */
                              .concat(_cwBrowse && _cwBrowse !== cc ? (_cwMadeForJobs(_cwBrowse) || []).concat(_cwMadeMore(_cwBrowse) || []).filter(j => !have.has(j.id)) : []); }
  catch(e){ return _cwJobs() || []; }
}
/* THE BEST ONES FIRST, AND FEWER OF THEM.

   "for crew only have the best example not like these shitty examples make
   them clear also that they work autonomously when the browser is closed and
   used like email instagram, accounts given bank account etcetera."

   That is a ranking, and the catalogue had none - it showed a sample, so the
   first thing on the screen was as likely to be "the day ahead in Vietnam" as
   anything that touches your mailbox. Fifty of a hundred and six jobs are pure
   web lookups; the other fifty-six go into a real account. The lookups are not
   bad, they are just the weakest thing here, and they were being shown first
   as often as not.

   So the order is: what it USES, then whether it runs without you. A job that
   reads your mail or watches your bank and does it while the browser is shut
   is the thing worth seeing first, and a lookup you could do yourself in a tab
   is the thing worth seeing last.

   Sixty rather than a hundred, for the same reason the hundred replaced two
   hundred: this is a shelf, not an inventory. */
/* A hundred, because that is what somebody browsing for ideas asked to see -
   "if you want inspiration then you see 100 different examples". The RANKING
   is what fixed the "shitty examples" complaint, not the cutting: the
   strongest are still first, there are simply more of them behind. */
const CW_SHOWCASE_N = 100;
/* An account need is one CW_NEEDS_CHECK knows how to test for - which is the
   same list the product uses to decide whether a job can actually run, so this
   cannot drift from what "needs an account" means everywhere else. */
function _cwUsesAccount(j){
  try{
    const known = Object.keys(CW_NEEDS_CHECK || {});
    return String((j && j.needs) || '').split(',').map(x => x.trim())
      .some(n => known.indexOf(n) >= 0);
  }catch(e){ return false; }
}
function _cwStrength(j){
  let n = 0;
  if(_cwUsesAccount(j)) n += 2;                       // it works on something of yours
  if(_cwWhereState(j) !== 'open') n += 1;             // and it does it while you are away
  /* Where a bank cannot be linked, a job that needs one cannot run at all, so
     it goes to the back of the list instead of the front - somebody in Spain
     must not open Crew to five things they cannot switch on. */
  try{
    if(/Bank connection/.test(String(j.needs || ''))){
      const cc = _cwCountryGuess();
      const can = Object.prototype.hasOwnProperty.call(_cwBank, cc) ? _cwBank[cc] : cc === 'US';
      if(cc && !can) n -= 10;
    }
  }catch(e){}
  /* And what people in this country have actually started, once it has been
     counted - a lift of up to three, so a job people really use can climb
     past one that merely sounds good, without a single start overturning
     everything. */
  try{
    const m = _cwMeta[_cwCountryGuess()];
    if(m && m.ranked && m.ranked.enough){
      const c = +m.ranked.counts[j.id] || 0;
      if(c > 0) n += Math.min(3, Math.log2(1 + c));
    }
  }catch(e){}
  return n;
}
let _cwShowcaseCache = null;
/* The ranking depends on the country (a bank job ranks last where no bank can
   be linked), and the first draw happens before the server has said where
   somebody is. So the ranking remembers which country it was made for, and is
   made again when that changes - in place, and only while the list is below
   the screen, so nothing somebody is looking at moves. */
let _cwRankedFor = '';
function _cwRankKey(){
  const cc = _cwCountryGuess();
  return cc + ':' + (Object.prototype.hasOwnProperty.call(_cwBank, cc) ? (_cwBank[cc] ? 1 : 0) : '?')
    + ':' + (_cwRankedHere(cc) ? 'n' : '-') + ':' + (_cwFacts[cc] ? 'f' : '-');
}
function _cwReRank(){
  try{
    if(!_cwShowcaseCache || _cwRankKey() === _cwRankedFor) return;
    const body = document.getElementById('cw-jobs-body');
    if(!body || S.tab !== 'crew' || _cwFind || _cwCat !== 'all') return;
    /* The chips are counted from the same list, so they are redrawn with it -
       left alone they kept the counts from before the country was known and
       had no chip for a category only the country's own jobs fill. They sit
       just above the list, so it is THEIR position that decides whether
       anything somebody can see would move. */
    const chips = body.parentNode && body.parentNode.querySelector('.cw-chips');
    if((chips || body).getBoundingClientRect().top < window.innerHeight) return;
    _cwShowcaseCache = null;
    const list = _cwShowcase();
    if(chips) chips.outerHTML = _cwCatChips(list);
    body.innerHTML = _cwJobsBody(list, _planAllowsCrew() ? _cwJobCard : _cwLockedCard);
    _cwLocFill();
  }catch(e){}
}
function _cwShowcase(){
  if(_cwShowcaseCache) return _cwShowcaseCache;
  _cwRankedFor = _cwRankKey();
  /* The jobs that are the same in every country used to live only inside the
     country panel, so removing that panel would have removed them from the
     product. They are ordinary catalogue jobs and they belong in the list with
     everything else. */
  const home = (()=>{ try{ return (_cwJobs() || []).concat(_cwUniversalJobs() || []); }
                      catch(e){ return _cwJobs() || []; } })();
  const on   = home.filter(j => j && j.on);
  const rest = home.filter(j => !(j && j.on));
  /* Sorted by strength, stable within a band so the order does not churn. */
  const ranked = rest.map((j, i) => [j, _cwStrength(j), i])
    .sort((a, b) => (b[1] - a[1]) || (a[2] - b[2]))
    .map(x => x[0]);
  /* THE COUNTRY'S OWN JOBS COME FIRST. Once the country's facts are here,
     the list is led by the jobs written for it (_cwMadeMore - a hundred or
     more for every country), ranked the same way, alongside the same hundred
     jobs that are the same everywhere that the list showed before the country
     was known - they are the ones that run on connected accounts, so adding a
     country's own must never push them off. Nothing already at the top of the
     page (the top ten, the made-for row) is repeated here.

     This is the whole POOL. "All" shows the first few of each category and a
     See all that opens the category; see _cwJobsBody. */
  const cc = _cwCountryGuess();
  const shown = new Set();
  try{ (_cwTopTen(cc) || []).forEach(j => shown.add(j.id)); }catch(e){}
  try{ (_cwMadeForJobs(cc) || []).forEach(j => shown.add(j.id)); }catch(e){}
  /* The country's own, most used there first (_cwPopScore - counted where
     there are counts, researched where there are not). */
  const local = (() => { try{ return (_cwMadeMore(cc) || []).filter(j => !shown.has(j.id)); }catch(e){ return []; } })()
    .map((j, i) => [j, _cwPopScore(j, cc), i]).sort((a, b) => (b[1] - a[1]) || (a[2] - b[2])).map(x => x[0]);
  const cap = on.length + local.length + CW_SHOWCASE_N;
  const out = [];
  const seen = new Set();
  const push = (j) => { if(j && !seen.has(j.id) && out.length < cap){ seen.add(j.id); out.push(j); } };
  /* Anything already switched on is always shown - a job you are running must
     never fall off the screen that manages it. */
  on.forEach(push);
  /* One of the country's own, then one that runs on connected accounts, and
     so on - so the first cards of every category are both kinds, not a page
     of one before the other. */
  const everywhere = ranked.slice(0, Math.max(0, CW_SHOWCASE_N - on.length));
  /* Alternated WITHIN each category, which is how the list is read - across
     the whole list, one category could still open on four of one kind. */
  const byCat = (list) => list.reduce((m, j) => { (m[j.cat] = m[j.cat] || []).push(j); return m; }, {});
  const L = byCat(local), E = byCat(everywhere);
  [...new Set([...local, ...everywhere].map(j => j.cat))].forEach(c => {
    const a = L[c] || [], b = E[c] || [];
    for(let i = 0; i < Math.max(a.length, b.length); i++){ push(a[i]); push(b[i]); }
  });
  _cwShowcaseCache = out;
  return out;
}
try{ window._cwAllJobs=_cwAllJobs; window._cwShowcase=_cwShowcase;
     window.CW_SHOWCASE_N=CW_SHOWCASE_N; window._cwUsesAccount=_cwUsesAccount; }catch(e){}

/* ── BROWSING SEVENTY JOBS ────────────────────────────────────────────────────
   A flat grid of seventy cards is a wall, and a wall reads as less capable than
   a shelf, not more. Grouped under headings with a filter, the same list reads
   as range. Order is deliberate: the categories people feel most keenly first. */
const CW_CATS = ['Money','Work & career','Growing a business','Making things','Inbox & calendar',
                 'Watching the world','Home & life','Family & kids','Learning','Health'];
let _cwCat = 'all';
function cwCat(c){ _cwCat = c || 'all'; renderCrewView(); }
/* How many of each category All shows before See all. */
const CW_CAT_PREVIEW = 10;
/* See all is pressed at the foot of a category, and the category view is far
   shorter than All - so without this it opens scrolled past its own heading. */
function cwCatAll(c){
  cwCat(c);
  /* Again on the next frame: a repaint arriving in the same moment (a
     connection or a country's data landing) would otherwise leave the
     category opened part-way down. */
  const top = () => { try{ const h = document.querySelector('.cw-chips') || document.getElementById('cw-jobs-body');
                           if(h) h.scrollIntoView({ block:'start' }); }catch(e){} };
  top();
  try{ requestAnimationFrame(top); }catch(e){}
  try{ const on = document.querySelector('.cw-chip.on'); if(on) on.focus({ preventScroll:true }); }catch(e){}
}
try{ window.cwCat=cwCat; window.cwCatAll=cwCatAll; }catch(e){}

/* SEARCHING THE EXAMPLES, AND WHAT HAPPENS WHEN THERE IS NO MATCH.

   Asked for: "make sure you can also search examples for crew like google etc
   discord etc like ones that already show and if it doesnt show say 'prompt it
   yourself' and it shows the textbox".

   The second half is the important half. A search that finds nothing usually
   says "no results", which on this screen would be a lie by omission - Crew
   is not limited to the examples, so "not in the list" is not "cannot be
   done". An empty search points at the box and offers to run the words
   already typed, which is the true answer and also the shortest path to it.

   Matched across title, description, category and the accounts a job uses, so
   "google", "discord" and "gmail" find things by what they touch rather than
   only by what they are called. */
let _cwFind = '';
function cwFind(v){
  _cwFind = String(v || '').trim();
  renderCrewView();
  /* Re-render replaces the input, so put the words and the cursor back. */
  try{
    const el = document.getElementById('cw-find');
    if(el){ el.value = _cwFind; el.focus();
            el.setSelectionRange(el.value.length, el.value.length); }
  }catch(e){}
}
try{ window.cwFind=cwFind; }catch(e){}
function _cwMatches(j, q){
  if(!q) return true;
  const hay = [j.title, j.desc, j.cat, j.needs, j.countryName].filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.indexOf(w) >= 0);
}
function _cwFindBoxHTML(n){
  return `<div class="cw-find-wrap">
    <label class="cw-find-l" for="cw-find">Search these examples</label>
    <input id="cw-find" class="cw-find" type="search" autocomplete="off"
           value="${escH(_cwFind)}" placeholder="e.g. google, discord, invoices, school, Japan">
    ${_cwFind ? `<span class="cw-find-n">${n} match${n===1?'':'es'}</span>` : ''}
  </div>`;
}
function _cwNoMatchHTML(){
  const q = _cwFind;
  return `<div class="cw-nomatch">
    <div class="cw-nomatch-t">No example here says &ldquo;${escH(q)}&rdquo; - which does not mean AMV cannot do it.</div>
    <div class="cw-nomatch-d">The examples are a shelf, not the shop. Prompt it yourself: describe what you want in
      your own words and Crew works out which accounts and sites it needs.</div>
    <button class="btn bp cw-nomatch-go" data-dact="cwPromptSelf" data-darg="${escH(q)}">Prompt it yourself \u2192</button>
  </div>`;
}
/* Puts what they searched for into the box that actually takes it, rather than
   making them retype it somewhere else. */
function cwPromptSelf(q){
  try{
    const el = document.getElementById('mc-cmd-input');
    if(el){
      el.value = String(q || '');
      _mcCmdFit(el);
      el.scrollIntoView({ block:'center', behavior:'smooth' });
      el.focus();
      return;
    }
  }catch(e){}
  try{ setTab('chat'); }catch(e){}
}
try{ window.cwPromptSelf=cwPromptSelf; }catch(e){}

/* PICK WHERE YOU LIVE, AND SEE WHAT RUNS THERE.

   Asked for: "have something where you can select your country and see what
   you can do autonomously cus mainly crew is autonomous work".

   The previous attempt scattered one example per country through the grid,
   which demonstrated range and answered nobody - a person does not want to
   learn that AMV does something in Peru, they want the ten things it does
   where they live. This is that: one control, then the ten, with the
   paperwork, the shops and the deadlines named the way they are named there.

   Remembered, because somebody's country does not change between visits, and
   guessed from the browser the first time so the common case needs no
   choosing at all. */
let _cwCountry = (()=>{ try{ return loadStr('amv_cw_country') || ''; }catch(e){ return ''; } })();
/* EVERYWHERE HAS TO BE A CHOICE, NOT THE ABSENCE OF ONE.

   An empty value meant "nobody has picked yet", which is why the browser's
   guess filled it in - and the guess is the right default on a first visit.
   But once the control offers "Everywhere" as an option, picking it stored the
   same empty value, so the guess ran again and the page came back showing the
   United States. Somebody who deliberately chose to see the whole catalogue
   got a country they never asked for and no way to refuse it.

   `-` is the stored form of "everywhere, on purpose". Never guessed, never a
   country code, and distinguishable from the first-visit blank. */
function cwCountry(code){
  _cwCountry = String(code || '-');
  try{ saveStr('amv_cw_country', _cwCountry); }catch(e){}
  /* Ranked for the country it was made for - a new country is a new list. */
  _cwShowcaseCache = null;
  renderCrewView();
}
/* WHERE SOMEBODY IS, FROM THE NETWORK.

   The country used to come from the browser's language alone, so somebody in
   Madrid with an English (US) browser was shown the United States. The edge
   knows which country a request comes from (/v1/where) - country level only,
   no permission prompt, no coordinates - and that answer now comes before the
   language guess. Held for the tab, so it is asked once per visit. */
let _cwHere = (()=>{ try{ return sessionStorage.getItem('amv_cw_here') || ''; }catch(e){ return ''; } })();
let _cwHereAsked = false, _cwHereDone = false;
/* Still waiting to hear where somebody is. While it is, the top five hold
   their place rather than showing the browser's guess for a moment - a visitor
   in Spain must not glimpse the United States first. */
function _cwHerePending(){
  if(_cwHere || _cwHereDone || (_cwCountry && _cwCountry !== '-')) return false;
  return !!(window.AMV_API && AMV_API.live && typeof AMV_API.where === 'function');
}
/* ASKED ONCE PER VISIT, AS SOON AS AMV LOADS - not when Crew is first opened.
   "When they first load AMV I want to have their location so AMV is
   specialised where they are." The answer is the network's country (no
   prompt, no coordinates), and it is wanted everywhere the country is read:
   Crew, the local connectors on Integrations, the instruction every job runs
   with. So the boot asks (see 12-handoff.js) and Crew only waits on it.

   A slow answer used to be thrown away: after a second and a half the guess
   from the browser stood, and the real answer, arriving at two seconds, was
   dropped on the floor. It is kept now, and if it names a different country
   from the guess on screen - and nobody has chosen one - the parts that name
   the country are drawn again. */
let _cwWhereP = null;
function _cwWhereFetch(){
  if(_cwWhereP) return _cwWhereP;
  if(!(window.AMV_API && AMV_API.live && typeof AMV_API.where === 'function')) return (_cwWhereP = Promise.resolve(''));
  _cwWhereP = Promise.resolve().then(() => AMV_API.where()).then(d => {
    const cc = String((d && d.country) || '').toUpperCase();
    if(cc && CW_WORLD_COUNTRIES.some(c => c[0] === cc)){
      _cwHere = cc;
      try{ sessionStorage.setItem('amv_cw_here', cc); }catch(e){}
      return cc;
    }
    return '';
  }, () => '');
  return _cwWhereP;
}
function _cwChosen(){ return !!(_cwCountry && _cwCountry !== '-'); }
async function _cwAskWhere(){
  if(_cwHereAsked || _cwHere) return;
  _cwHereAsked = true;
  if(!(window.AMV_API && AMV_API.live && typeof AMV_API.where === 'function')){ _cwHereDone = true; return; }
  _cwWhereFetch().then(cc => {
    /* The late answer: only when the timer below already gave up on it. */
    if(!cc || !_cwHereDone || _cwChosen()) return;
    if(S.tab === 'crew' && cc !== _cwGuessDrawn){ _cwShowcaseCache = null; _cwForYouRepaint(); }
  });
  /* Waited for a moment, not for ever: a slow or unreachable server must not
     leave the five as placeholders. */
  await Promise.race([_cwWhereFetch(), new Promise(res => setTimeout(res, 1500))]);
  _cwHereDone = true;
  if(S.tab === 'crew' && !_cwChosen()) _cwForYouRepaint();
}
/* Which country the top of Crew was last drawn for, so a late answer that
   agrees with it does not redraw anything. */
let _cwGuessDrawn = '';
function _cwCountryGuess(){
  /* A country somebody chose ("This is my country") wins over any guess. The
     old "Everywhere" choice (`-`) has no control any more, so it reads as no
     choice at all rather than as "show nowhere". */
  if(_cwCountry && _cwCountry !== '-') return _cwCountry;
  if(_cwHere) return _cwHere;
  try{
    if(typeof _everydayGuess === 'function'){
      const g = String(_everydayGuess() || '').toUpperCase();
      if(CW_WORLD_COUNTRIES.some(c => c[0] === g)) return g;
    }
  }catch(e){}
  return '';
}
function _cwCatChips(jobs){
  const count=c=>jobs.filter(j=>j.cat===c).length;
  const chip=(k,label,n)=>`<button class="cw-chip${_cwCat===k?' on':''}" data-dact="cwCat" data-darg="${escH(k)}">${escH(label)}<span class="cw-chip-n">${n}</span></button>`;
  return `<div class="cw-chips" role="group" aria-label="Filter jobs by category">`
    + chip('all','All',jobs.length)
    /* The count is a filter aid, not a capability claim. Said once, here,
       because a lone number beside a catalogue reads as a ceiling - and the
       owner's point was exactly that: it makes AMV look like it can do 93
       things when the text box takes anything you can describe. */
    + CW_CATS.filter(c=>count(c)).map(c=>chip(c,c,count(c))).join('')
    + `</div>`;
}

/* ── WHAT PEOPLE ACTUALLY START ───────────────────────────────────────────────
   The owner asked for a top ten "based on actual data", and the whole value of
   that sentence is in the last two words. A hand-picked order dressed as a
   ranking is the exact thing this product is not allowed to ship, so this reads
   one number per job from the server and nothing else: how many times each job
   in the catalogue has been turned into scheduled work. No account is named, no
   instruction is stored, nothing about what any run produced.

   Below the server's floor it says there is not enough yet and shows no order
   at all. Six starts sorted into a "top ten" is three coincidences presented as
   a trend, and the first person to read it would be misled by their own data. */
let _cwPop = { state:'idle', data:null, err:'' };
async function _cwLoadPopular(){
  /* 'error' is terminal until somebody presses Try again. Without that a
     failing endpoint would be re-requested on every repaint of a screen
     that repaints on every toggle. */
  if(_cwPop.state==='loading' || _cwPop.state==='done' || _cwPop.state==='error') return;
  if(!(window.AMV_API && AMV_API.live && AMV_API.crewPopular)){
    _cwPop = { state:'off', data:null, err:'' }; _cwPopPaint(); return;
  }
  _cwPop.state='loading';
  try{
    const d = await AMV_API.crewPopular();
    _cwPop = { state:'done', data:(d&&typeof d==='object')?d:null, err:'' };
  }catch(e){
    /* Named, not swallowed. A ranking that quietly vanishes looks like a
       feature that was never built, and the owner would be right to ask. */
    _cwPop = { state:'error', data:null, err:String((e&&e.message)||'').slice(0,120) };
  }
  _cwPopPaint();
}
/* A BACKGROUND REDRAW DOES NOT GET TO WIPE A RESULT SOMEBODY ASKED FOR.

   Coalescing the async redraws onto a trailing edge moved them LATER, and
   later is long enough for somebody to have typed a command and be reading its
   answer. The whole Crew view is rebuilt by these, so the answer went with it -
   caught by a suite that asks a question as a signed-out visitor and then finds
   the box it was answered in has been replaced by a fresh screen.

   The rule is already written a few hundred lines down for the same reason and
   in almost the same words: the stored state is updated either way, so nothing
   is lost by not redrawing, and the next open is correct. This says the same
   thing about the command box. */
/* THE TWO LOADS THIS VIEW STARTS ON EVERY RENDER, AND WHY THEY KEPT IT BUSY.

   Opening Crew rebuilt the whole screen three times. The first is the view
   arriving and is correct. The other two were these: renderCrewView kicks off
   `_autoRefresh` and `_connLoad` and each of them, on resolving, called
   renderCrewView again - directly, unconditionally, whatever came back. On a
   700ms backend that is the screen being thrown away at roughly 330ms and again
   at 1000ms, which is exactly what "crew still buffers" describes.

   Almost every one of those redraws showed the same screen again. These are
   polls: the automations and the connected accounts are usually what they were
   a moment ago, and rebuilding the view to display what is already on it costs
   the scroll position, anything open, and a visible flash.

   So the answer arrives, and the screen is redrawn only if the answer is
   DIFFERENT from the one it is already showing. `_connLoad` additionally paints
   its own panel through `_connPaint`, so the full redraw here was never what
   updated the connections list - it was only what updated the job cards that
   mention an account, and those only change when the accounts do. */
let _cwSeen = '';
function _cwRedrawIfChanged(){
  let sig = '';
  /* NOTHING AND AN EMPTY LIST LOOK THE SAME ON THE SCREEN.

     Without this the first open still redrew twice, because `_AUTOS` went from
     undefined to [] and a raw comparison calls that a change. It is not one to
     anybody looking at the page: no automations and an empty list of
     automations render identically. Normalising empties is what makes the
     comparison about what is DISPLAYED rather than about the shape of a
     variable - measured, it is the difference between three rebuilds on open
     and two. */
  const _same = (v) => {
    if(v === null || v === undefined) return null;
    if(Array.isArray(v)) return v.length ? v : null;
    if(typeof v === 'object'){ for(const k in v) return v; return null; }
    return v;
  };
  try{
    sig = JSON.stringify([
      _same((typeof _AUTOS !== 'undefined') ? _AUTOS : null),
      _same((typeof _AUTO_RESULTS !== 'undefined') ? _AUTO_RESULTS : null),
      _same((typeof _connState !== 'undefined' && _connState) ? _connState.data : null)
    ]);
  }catch(e){
    /* Unserialisable means unknowable, and an unknowable answer must not be
       treated as "nothing changed" - that would drop a real update. */
    _cwSeen = ''; _cwRepaintSoon(); return;
  }
  if(sig === _cwSeen) return;
  _cwSeen = sig;
  /* THE CATALOGUE REPAINTS ITSELF, WHICH IS ALL THAT ACTUALLY CHANGED.

     What these loads affect on this screen is the job cards - a card says an
     account is needed, and it must stop saying that once the account is
     connected. That is the whole reason the full redraw was here, and removing
     it outright made the screen quieter and the cards wrong, which is the
     defect this codebase already has a lesson about: a stale "not connected"
     looks exactly like the product working.

     So the cards are rebuilt and nothing else is. Measured on a 700ms backend:
     three full rebuilds of the view on open became two, and what used to be a
     third rebuild is now one block redrawing in place. The fallback is a full
     render for the states where that block is not on the page. */
  try{
    const body = document.getElementById('cw-jobs-body');
    if(body && S.tab === 'crew'){
      body.innerHTML = _cwJobsBody(_cwShowcase(), _planAllowsCrew() ? _cwJobCard : _cwLockedCard);
      return;
    }
  }catch(e){}
  _cwRepaintSoon();
}

function _cwRepaintSoon(){
  _reRenderSoon(function(){
    try{
      const r = document.getElementById('mc-cmd-result');
      if(r && (r.textContent || '').trim()) return;
    }catch(e){}
    renderCrewView();
  }, S.tab === 'extensions' ? 'extensions' : 'crew');
}

function _cwPopPaint(){
  try{ const el=document.getElementById('cw-pop-body'); if(el) el.innerHTML=_cwPopBodyHTML(); }catch(e){}
  try{ const el=document.getElementById('cw-popc-body'); if(el) el.innerHTML=_cwCountedTop() ? _cwPopBodyHTML() : ''; }catch(e){}
}
function cwPopReload(){ _cwPop={ state:'idle', data:null, err:'' }; _cwPopPaint(); _cwLoadPopular(); }
try{ window.cwPopReload=cwPopReload; }catch(e){}

/* ── THE FIVE AT THE TOP, AND WHERE THEIR ORDER COMES FROM ───────────────────

   Asked for: introduce Crew, then the top five most popular in the world - the
   ones that would make somebody pay - and everything else below that.

   There are two possible answers to "most popular" and only one of them is
   honest at any given moment. When enough jobs have been started across AMV
   the server has a real count, and that count is the order. Below the server's
   floor there is no ranking, and the old behaviour - an empty box with a
   progress bar reading 6/25 - answered the question by refusing to, which is
   truthful and useless to the person who opened this page to find out what
   Crew is for.

   So the fallback is five AMV chose, SAID to be five AMV chose. It is never
   dressed as a count: the heading changes, the sub-line changes, and the
   figures only appear when there are figures. The five are the ones that work
   on something of yours and keep working while the window is shut - which is
   the same thing `_cwStrength` ranks by, and the same thing somebody is
   deciding about when they decide whether to pay.

   Everything below still lists the whole catalogue, so nothing here is the
   menu; it is the front of the shelf. */
const CW_START_HERE = ['money_leaks','inbox_digest','price_protect','unusual_spend','job_hunt'];

function _cwStartHereJobs(){
  const byId={}; (_cwJobs()||[]).forEach(j=>{ if(j&&j.id) byId[j.id]=j; });
  const picked = CW_START_HERE.map(id=>byId[id]).filter(Boolean);
  /* A curated id that the catalogue no longer carries must not silently
     shorten this block to four. Anything missing is topped up from the same
     ranking the catalogue itself uses. */
  if(picked.length < 5){
    const seen=new Set(picked.map(j=>j.id));
    (_cwJobs()||[]).slice()
      .sort((a,b)=>_cwStrength(b)-_cwStrength(a))
      .forEach(j=>{ if(picked.length<5 && j && !seen.has(j.id)){ seen.add(j.id); picked.push(j); } });
  }
  return picked.slice(0,5);
}
/* ── TOP FIVE FOR YOU, WHERE YOU ARE ─────────────────────────────────────────

   Asked for: the first thing under the box is the five things for YOU, and
   because AMV knows the country, they are that country's own - Spain's five
   in Spain, the United States' five there. They are the country packs the
   server already carries (five genuine local jobs for each of 105 countries,
   written for that country rather than translated), which used to sit behind
   a dropdown further down the page. No dropdown now: the country comes from
   where somebody is, and "Not in Spain?" at the top and "See more countries"
   at the bottom are the two ways to look elsewhere.

   While the country's five are on their way the cards hold their place, so
   the section does not arrive and then grow. With no country - or a server
   that cannot be reached - it is AMV's own five, as before, and says why. */
function _cwCountryRow(cc){ return cc ? CW_WORLD_COUNTRIES.find(c => c[0] === cc) || null : null; }
function _cwForYouHTML(){
  try{ setTimeout(_cwAskWhere, 0); }catch(e){}
  if(_cwHerePending()){
    return `<section class="cw-pop cw-foryou" id="cw-foryou" aria-busy="true">
      <div class="sec-head"><h3>${escH(T('Top 5 for you'))}</h3><span class="sec-sub">${escH(T('Picked for where you are, under the names things have there.'))}</span></div>
      <ol class="cw-top10 cw-top5l" aria-hidden="true">${'<li class="cw-t10 cw-t10-ph"></li>'.repeat(5)}</ol>
    </section>`;
  }
  const cc = _cwCountryGuess(), row = _cwCountryRow(cc);
  _cwGuessDrawn = cc;
  if(!row) return _cwPopularHTML();
  try{ _cwLoadLocal(cc); }catch(e){}
  const [, name, flag] = row;
  const st = _cwLocalState[cc] || 'loading';
  /* FIVE, AS ASKED: "the top 5 in that country plus 100+ used options". The
     ranked ten is still built - six to ten lead the hundred below instead of
     disappearing (see _cwTopShown). */
  const built = st === 'ok' ? _cwTopFive(cc) : [];
  if(built.length >= 5){
    return `<section class="cw-pop cw-foryou" id="cw-foryou">
      ${_cwForYouHead(name, flag, built.length, true)}
      <ol class="cw-top10 cw-top5l">${built.map(_cwTopRowHTML).join('')}</ol>
    </section>`;
  }
  let jobs = _cwLocalJobs(cc).slice(0, 5), note = '';
  if(st === 'loading' && !jobs.length){
    return `<section class="cw-pop cw-foryou" id="cw-foryou" aria-busy="true">
      ${_cwForYouHead(name, flag, 5, true)}
      <ol class="cw-top10 cw-top5l" aria-hidden="true">${'<li class="cw-t10 cw-t10-ph"></li>'.repeat(5)}</ol>
    </section>`;
  }
  if(st === 'offline') note = `<p class="cw-foryou-note">${escH(T('The jobs written for'))} ${escH(name)} ${escH(T('are on AMV’s servers, which cannot be reached right now - so these are AMV’s own five for anywhere.'))}</p>`;
  if(jobs.length < 5){
    const seen = new Set(jobs.map(j => j.id));
    _cwStartHereJobs().forEach(j => { if(jobs.length < 5 && j && !seen.has(j.id)){ seen.add(j.id); jobs.push(j); } });
  }
  return `<section class="cw-pop cw-foryou" id="cw-foryou">
    ${_cwForYouHead(name, flag)}${note}
    <div class="cw-top5">${jobs.map(j => `<div class="cw-top5-item">${_cwAnyCard(j)}</div>`).join('')}</div>
  </section>`;
}
function _cwForYouHead(name, flag, n, ranked){
  /* Says how many it shows - five either way: the country's ranked list, or
     AMV's own five on the fallback (no country data, or no server to ask). */
  const k = n || 5;
  const head = k === 5 ? 'Top 5 for you in' : 'Top ' + k + ' for you in';
  /* Which order this is, said rather than implied: counted once enough people
     in the country have started jobs, researched until then. */
  const counted = !!ranked && _cwRankedHere(_cwCountryGuess());
  const sub = counted ? 'Ordered by what people in ' + _cwThe(name) + ' switch on most.'
                      : 'Picked for where you are, under the names things have there.';
  return `<div class="sec-head"><h3>${escH(T(head))} <span class="cw-flag" aria-hidden="true">${flag}</span> ${escH(name)}</h3>
    <span class="sec-sub">${escH(counted ? sub : T(sub))}
      <button class="cw-link" data-dact="cwMoreCountries">${escH(T('Not in'))} ${escH(_cwThe(name))}?</button></span></div>`;
}
/* THE COUNTED FIVE, WHEN THERE IS A COUNT. "Top 5 for you" took the top of
   the page, so the ranking of what people actually start across AMV sits
   under the catalogue - and only once the server has counted enough to rank.
   Before then it adds nothing: the five for you are already on screen. */
function _cwMostStartedHTML(){
  /* With no country the top of the page already is this block - not twice. */
  if(!_cwCountryRow(_cwCountryGuess())) return '';
  try{ setTimeout(_cwLoadPopular, 0); }catch(e){}
  /* Its own ids: with no country, "Top 5 for you" falls back to the uncounted
     block, which already owns cw-pop, and two elements must not share one. */
  return `<section class="cw-pop cw-pop-counted" id="cw-popc">
    <div id="cw-popc-body" class="cw-pop-body">${_cwCountedTop() ? _cwPopBodyHTML() : ''}</div>
  </section>`;
}
function _cwForYouRepaint(){
  _cwGuessDrawn = _cwCountryGuess();
  _cwWhereRepaint();
  try{
    const el = document.getElementById('cw-foryou') || document.getElementById('cw-pop');
    if(el) el.outerHTML = _cwForYouHTML(); else _cwRepaintSoon();
  }catch(e){ try{ _cwRepaintSoon(); }catch(_){} }
  _cwLocFill();
  _cwMadeForRepaint();
  _cwReRank();
}

/* ── WHERE YOU ARE: TWO PAGES OF THEIR OWN ───────────────────────────────────

   Asked for: "put 'Not in the US?' on the top right and then it sends you to
   the page selecting countries. Then when you select you go to a new page and
   you see the top 5 in that country plus 100+ used options. And always on the
   top of the page put: if not on here type it in the text box (only showing
   100). And make sure when you select your country it stays - it doesn't go
   back to the original if you leave the tab. Same if you change it again."

   What it replaced did the opposite of the last sentence. "Not in Spain?"
   opened a panel at the very bottom of a long page, and choosing a country
   there only BROWSED it - keeping it took a second button, "This is my
   country". So somebody chose Japan, went to chat, came back, and was in Spain
   again: exactly what was reported.

   Now choosing IS keeping. The choice is saved on the device
   (`amv_cw_country`), so every tab, every later visit and every job's
   instruction is for that country until somebody chooses another, and the
   network's guess never overrides it. The two pages live in S.crewPage and in
   the back stack (_navHere), so the arrow, the browser's Back and a phone's
   Back all walk out the way they came in. Leaving Crew for another tab
   returns it to its main page next time - the country stays, the page does
   not. */
let _cwBrowse = '';
function _cwPageNow(){ try{ return (S && S.crewPage) || ''; }catch(e){ return ''; } }
function _cwToTop(){
  try{ if(typeof _cdirToTop === 'function'){ _cdirToTop(); return; } }catch(e){}
  try{ window.scrollTo(0, 0); }catch(e){}
}
function _cwGo(page){
  const from = (() => { try{ return _navHere(); }catch(e){ return null; } })();
  S.crewPage = page || '';
  _cwCpCat = 'all';
  if(S.tab !== 'crew'){ try{ setTab('crew'); }catch(e){} }
  else {
    try{ _navRecord(from, _navHere()); }catch(e){}
    renderCrewView();
  }
  _cwToTop();
}
/* The pick, saved. Clearing the showcase is not optional: it is cached for
   the country it was ranked for, and without this the hundred under the new
   country's name would have been the old country's hundred. */
function _cwSetCountry(cc){
  _cwCountry = String(cc || '').toUpperCase();
  try{ saveStr('amv_cw_country', _cwCountry); }catch(e){}
  _cwShowcaseCache = null;
  try{ _cwLoadLocal(_cwCountry); }catch(e){}
}
function cwMoreCountries(){ _cwGo('countries'); }
function cwBackMain(){ _cwGo(''); }
function cwBrowse(cc){
  const code = String(cc || '').toUpperCase();
  if(!_cwCountryRow(code)) return;
  _cwBrowse = code;
  _cwSetCountry(code);
  _cwGo('country');
}
/* The top-right control on the main page. While the network has not yet said
   where somebody is, it holds its place empty rather than naming a guess that
   is about to change. */
function _cwWhereBtnHTML(){
  if(_cwHerePending()) return `<span class="cw-where cw-where-ph" id="cw-where" aria-hidden="true"> </span>`;
  const row = _cwCountryRow(_cwCountryGuess());
  return row
    ? `<button class="cw-where" id="cw-where" data-dact="cwMoreCountries"><span class="cw-flag" aria-hidden="true">${row[2]}</span> ${escH(T('Not in'))} ${escH(_cwThe(row[1]))}?</button>`
    : `<button class="cw-where" id="cw-where" data-dact="cwMoreCountries">${escH(T('Choose your country'))}</button>`;
}
function _cwWhereRepaint(){
  try{ const el = document.getElementById('cw-where'); if(el) el.outerHTML = _cwWhereBtnHTML(); }catch(e){}
}
/* The line that says the list is not the limit - on the country page, where it
   is exactly a hundred, it says so. */
function _cwNotHereHTML(where, n){
  return `<div class="cw-nothere" role="note">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>
    <div><b>${escH(T('Not on here? Type it in the text box'))} ${where === 'below' ? escH(T('below')) : escH(T('above'))}.</b>
      ${n ? escH(T('Only')) + ' ' + n + ' ' + escH(T('jobs are shown here - the most used ones, not everything AMV can do.'))
          : escH(T('These are examples, not everything AMV can do.'))}</div>
  </div>`;
}

function _cwCountriesPageHTML(){
  /* "Selected" only for a country somebody chose; a guess is labelled as
     what it is - where the network says they are. */
  const cur = _cwChosen() ? _cwCountryGuess() : '', here = _cwHere || (cur ? '' : _cwCountryGuess());
  const btn = ([cc, name, flag]) => `<button class="cw-cpick${cc === cur ? ' on' : ''}" role="listitem" data-dact="cwBrowse" data-darg="${escH(cc)}" data-cname="${escH(String(name).toLowerCase())}"${cc === cur ? ' aria-current="true"' : ''}>
      <span class="cw-cpick-f" aria-hidden="true">${flag}</span><span class="cw-cpick-n">${escH(name)}</span>
      ${cc === cur ? `<span class="cw-cpick-b">${escH(T('Selected'))}</span>` : cc === here ? `<span class="cw-cpick-b cw-cpick-here">${escH(T('Where you are'))}</span>` : ''}</button>`;
  const all = CW_WORLD_COUNTRIES.slice().sort((a, b) => a[1].localeCompare(b[1]));
  return `<div class="sv fi crew-view cw-cpage"><div class="vi cw-cp-vi">
    <div class="cw-cp-top"><button class="cdir-back cw-back" data-dact="cwBackMain">← ${escH(T('Back to Crew'))}</button></div>
    <span class="eyebrow">${escH(T('Crew · Your country'))}</span>
    <h2>${escH(T('Where are you?'))}</h2>
    <p class="vsub">${escH(T('Crew shows the jobs people there use most, under the names things have there - their banks, their tax office, their job sites. AMV remembers what you choose.'))}</p>
    <div class="cw-cp-find"><input id="cw-cfind" class="cw-find" type="search" autocomplete="off" aria-label="${escH(T('Search countries'))}"
      placeholder="${escH(T('Search'))} ${all.length} ${escH(T('countries'))}"></div>
    <div class="cw-cp-grid" id="cw-cp-grid" role="list">${all.map(btn).join('')}</div>
    <p class="cw-cp-none" id="cw-cp-none" hidden>${escH(T('No country by that name in this list. AMV still works there - go back and type what you want in the box.'))}</p>
  </div></div>`;
}
function _cwWireCountries(vc){
  try{
    const f = vc.querySelector('#cw-cfind'), grid = vc.querySelector('#cw-cp-grid'), none = vc.querySelector('#cw-cp-none');
    if(!f || !grid) return;
    on(f, 'input', function(){
      const q = this.value.trim().toLowerCase();
      let n = 0;
      grid.querySelectorAll('.cw-cpick').forEach(b => { const hit = !q || b.dataset.cname.indexOf(q) >= 0; b.hidden = !hit; if(hit) n++; });
      if(none) none.hidden = n > 0;
    });
    on(f, 'keydown', function(e){
      if(e.key !== 'Enter') return;
      const first = grid.querySelector('.cw-cpick:not([hidden])');
      if(first){ e.preventDefault(); cwBrowse(first.dataset.darg); }
    });
  }catch(e){}
}

/* THE COUNTRY'S PAGE: its five, then exactly a hundred more.

   The hundred is the ranked ten past five, then the jobs written for the
   country, then the catalogue as ranked for it (_cwShowcase - the country's
   own jobs alternated with the ones that run on connected accounts). Never
   one of the five again, never two of anything, and never more than a
   hundred - the banner at the top says "only 100", so it has to be true. */
const CW_COUNTRY_N = 100;
let _cwCpCat = 'all';
/* THE JOBS THAT RUN ON YOUR OWN ACCOUNTS, NAMED FOR WHAT PEOPLE THERE USE.
   "Inbox digest" is the same job in every country; which inbox it reads is
   not - QQ Mail in China, Naver in Korea, WEB.DE in Germany (COUNTRY_MAIL on
   the server, with its sources). So on a country's page the title says so.
   A copy, so the job itself - and what it runs - is untouched. */
function _cwAccountTitle(j, cc){
  if(!j || /^(cc|top|ev)_[a-z]{2}_/.test(String(j.id || '')) && !/^ev_ev_/.test(String(j.id || ''))) return j;
  const needs = String(j.needs || ''), box = _cwInbox[cc] || [], f = _cwFacts[cc] || {};
  let tag = '';
  /* The jobs that run on the web rather than an account still run for this
     country (the run is told where the person is), so the title says where:
     its own news outlets where the facts name them, otherwise the country.
     "Did anything change today?" watches what the person names, wherever it
     is, so it stays as it is. */
  const C = (_cwCountryRow(cc) || [])[1] || '';
  const WHERE = { competitor_watch:1, content_calendar:1, opportunity_radar:1, job_hunt:1 };
  if(j.id === 'morning_brief' && (f.news || C)){
    return Object.assign({}, j, { title: j.title + (f.news ? ' \u00b7 ' + _cwNames(f.news, 2) : ' for ' + _cwThe(C)) });
  }
  if(WHERE[j.id] && C && !(j.id === 'job_hunt' && f.jobs) && String(j.title || '').indexOf(C) < 0){
    return Object.assign({}, j, { title: j.title + (j.id === 'content_calendar' ? ' for ' : ' in ') + _cwThe(C) });
  }
  if(j.id === 'job_hunt' && f.jobs) tag = _cwNames(f.jobs, 2);
  else if(/\bEmail\b/.test(needs) && box[0]) tag = box[0].name;
  else if(/\bCalendar\b/.test(needs) && box[0]) tag = box[0].how === 'ms' ? 'Outlook Calendar' : 'Google Calendar';
  else if(/Bank connection/.test(needs) && (f.cards || f.banks)) tag = _cwNames(f.cards || f.banks, 2);
  if(!tag || String(j.title || '').indexOf(tag) >= 0) return j;
  return Object.assign({}, j, { title: j.title + ' \u00b7 ' + tag });
}
function _cwCountryHundred(cc){
  const ten = (() => { try{ return _cwTopTen(cc) || []; }catch(e){ return []; } })();
  const seen = new Set(ten.slice(0, 5).map(j => j.id)), pool = [];
  const add = j => { if(j && j.id && !seen.has(j.id)){ seen.add(j.id); pool.push(j); } };
  ten.slice(5).forEach(add);
  try{ (_cwLocalJobs(cc) || []).forEach(add); }catch(e){}
  try{ (_cwMadeForJobs(cc) || []).forEach(add); }catch(e){}
  try{ (_cwMadeMore(cc) || []).forEach(add); }catch(e){}
  try{ (_cwJobs() || []).concat(_cwUniversalJobs() || []).forEach(add); }catch(e){}
  /* Highest score first; a stable sort, so equal scores keep the order the
     catalogue wrote them in. No category takes more than a quarter, so the
     page is the country's life and not twenty kinds of grocery list. */
  const ranked = pool.map((j, i) => [j, _cwPopScore(j, cc), i]).sort((a, b) => (b[1] - a[1]) || (a[2] - b[2])).map(x => x[0]);
  const cap = Math.ceil(CW_COUNTRY_N / 4), per = {}, out = [], spill = [];
  ranked.forEach(j => {
    if(out.length >= CW_COUNTRY_N) return;
    const c = j.cat || 'More';
    if((per[c] || 0) >= cap){ spill.push(j); return; }
    per[c] = (per[c] || 0) + 1; out.push(j);
  });
  for(let i = 0; out.length < CW_COUNTRY_N && i < spill.length; i++) out.push(spill[i]);
  return out.map(j => _cwAccountTitle(j, cc));
}
function _cwCpListHTML(cc){
  const row = _cwCountryRow(cc), name = row ? row[1] : '';
  const st = _cwLocalState[cc] || 'loading';
  if(st === 'loading'){
    return `<div class="sec-head"><h3>${escH(T('The 100 most used in'))} ${escH(name)}</h3></div>
      <div class="cw-jobs-grid cw-cat-grid" aria-busy="true">${'<div class="cw-made-ph" aria-hidden="true"></div>'.repeat(6)}</div>`;
  }
  const list = _cwCountryHundred(cc);
  const cats = CW_CATS.filter(c => list.some(j => j.cat === c));
  const other = list.filter(j => CW_CATS.indexOf(j.cat) < 0);
  const chip = (k, label, n) => `<button class="cw-chip${_cwCpCat === k ? ' on' : ''}" data-dact="cwCpCat" data-darg="${escH(k)}" aria-pressed="${_cwCpCat === k}">${escH(T(label))}<span class="cw-chip-n">${n}</span></button>`;
  const group = (label, js) => js.length ? `<div class="cw-cat"><div class="cw-cat-h">${escH(T(label))}<span class="cw-cat-n">${js.length}</span></div>
      <div class="cw-jobs-grid cw-cat-grid">${js.map(_cwAnyCard).join('')}</div></div>` : '';
  const body = _cwCpCat === 'all'
    ? cats.map(c => group(c, list.filter(j => j.cat === c))).join('') + group('More', other)
    : group(_cwCpCat, list.filter(j => (CW_CATS.indexOf(_cwCpCat) >= 0 ? j.cat === _cwCpCat : CW_CATS.indexOf(j.cat) < 0)));
  const note = st === 'offline'
    ? `<p class="cw-foryou-note">${escH(T('The jobs written for'))} ${escH(name)} ${escH(T('are on AMV’s servers, which cannot be reached right now - so these are the ones that run anywhere.'))}</p>`
    /* Said, not padded: a country whose hand-written pack is empty gets the
       everyday jobs, each told the country, under a sentence saying so -
       never a generated stand-in dressed as written for it. */
    : !(_cwLocalJobs(cc) || []).length
      ? `<p class="cw-foryou-note">${escH(T('Nothing is written only for'))} ${escH(name)} ${escH(T('yet - the jobs below are the everyday ones, and each runs there and answers for'))} ${escH(name)}.</p>` : '';
  return `<div class="sec-head"><h3>${escH(T('The'))} ${list.length} ${escH(T('most used in'))} ${escH(name)}</h3>
      <span class="sec-sub">${escH(T('After the five above. Every one answers for'))} ${escH(name)} ${escH(T('- its sites, prices and rules - and runs with AMV closed where it says so.'))}</span></div>
    ${note}
    <div class="cw-chips" role="group" aria-label="${escH(T('Filter jobs by category'))}">${chip('all', 'All', list.length)}${cats.map(c => chip(c, c, list.filter(j => j.cat === c).length)).join('')}${other.length ? chip('More', 'More', other.length) : ''}</div>
    <div id="cw-cp-body">${body}</div>`;
}
function cwCpCat(c){
  _cwCpCat = c || 'all';
  try{
    const el = document.getElementById('cw-cp-list');
    if(el){ el.innerHTML = _cwCpListHTML(_cwCountryGuess()); _cwLocFill(); }
    else renderCrewView();
    const h = document.querySelector('#cw-cp-list .cw-chips'); if(h && h.getBoundingClientRect().top < 0) h.scrollIntoView({ block:'start' });
  }catch(e){}
}
function _cwCmdBoxHTML(name){
  return `<div class="mc-cmd mc-cmd-lg cw-cmd-lead">
      <div class="mc-cmd-label">${escH(T('Tell AMV what to do'))} <span>- ${escH(T('in your own words, for'))} ${escH(name)}</span></div>
      <div class="mc-cmd-inner">
        <svg class="mc-cmd-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>
        <textarea id="mc-cmd-input" class="mc-cmd-input" rows="1" autocomplete="off" aria-label="${escH(T('Tell AMV what to do'))}" enterkeyhint="go"
               placeholder="${escH(T('e.g. renew my residence permit'))}"></textarea>
        <button class="mc-cmd-go" id="mc-cmd-go">${escH(T('Run'))}</button>
      </div>
      <div id="mc-cmd-result" class="mc-cmd-result"></div>
    </div>`;
}
/* Where AMV looks in the country - its tax office, banks, job sites - once
   the country's facts are here; nothing until then. */
function _cwCpFactsHTML(cc){
  const row = _cwCountryRow(cc);
  if(!row || _cwLocalState[cc] !== 'ok') return '';
  const f = _ccFactsHTML(cc);
  return f ? `<div class="sec-head"><h3>${escH(T('Where AMV looks in'))} ${escH(row[1])}</h3></div>${f}` : '';
}
function _cwCountryPageHTML(){
  const cc = _cwCountryGuess(), row = _cwCountryRow(cc);
  if(!row) return _cwCountriesPageHTML();
  const [, name, flag] = row;
  try{ _cwLoadLocal(cc); }catch(e){}
  const st = _cwLocalState[cc] || 'loading';
  return `<div class="sv fi crew-view cw-cpage"><div class="vi cw-cp-vi">
    <div class="cw-cp-top"><button class="cdir-back cw-back" data-dact="cwBackMain">← ${escH(T('Back to Crew'))}</button>
      <button class="cw-where" data-dact="cwMoreCountries">${escH(T('Change country'))}</button></div>
    <span class="eyebrow">${escH(T('Crew in'))} <span aria-hidden="true">${flag}</span> ${escH(name)}</span>
    <h2>${escH(T('What people in'))} ${escH(name)} ${escH(T('have AMV do'))}</h2>
    ${_cwNotHereHTML('below', CW_COUNTRY_N)}
    ${_cwCmdBoxHTML(name)}
    <div class="crew-jobs-sec">
      ${_cwForYouHTML()}
      <section class="cw-cp-list" id="cw-cp-list">${_cwCpListHTML(cc)}</section>
      <section class="cw-cp-facts" id="cw-cp-facts">${_cwCpFactsHTML(cc)}</section>
    </div>
  </div></div>`;
}
try{ window.cwMoreCountries = cwMoreCountries; window.cwBrowse = cwBrowse; window.cwBackMain = cwBackMain; window.cwCpCat = cwCpCat;
     window._cwCountryHundred = _cwCountryHundred; window.CW_COUNTRY_N = CW_COUNTRY_N; window._cwForYouHTML = _cwForYouHTML;
     window._cwAskWhere = _cwAskWhere; }catch(e){}

function _cwCountedTop(){
  const st=_cwPop;
  if(st.state!=='done' || !st.data || !st.data.enough) return null;
  const byId={}; (_cwJobs()||[]).forEach(j=>{ if(j&&j.id) byId[j.id]=j; });
  const rows=(Array.isArray(st.data.top)?st.data.top:[])
    .map(x=>({ n:Math.max(0,(x&&x.n)|0), job:byId[(x&&x.id)||''] }))
    .filter(x=>x.job && x.n>0)
    .slice(0,5);
  /* However many RESOLVE, not five or nothing. The server has already said
     the sample is big enough; if only three of the counted ids are still in
     the catalogue then three is what was counted, and topping them up to five
     from AMV's own picks would put chosen entries under a heading that says
     counted. Five is the ceiling here, never the quota. */
  return rows.length ? rows : null;
}

function _cwPopularHTML(){
  /* Kicked off from the render that first puts the container on the page, so
     the request is made once per load rather than once per repaint. */
  try{ setTimeout(_cwLoadPopular, 0); }catch(e){}
  return `<section class="cw-pop" id="cw-pop">
    <div id="cw-pop-body" class="cw-pop-body">${_cwPopBodyHTML()}</div>
  </section>`;
}

function _cwPopBodyHTML(){
  const counted=_cwCountedTop();
  if(counted){
    const total=Math.max(0,(_cwPop.data&&_cwPop.data.total)|0);
    return `<div class="sec-head"><h3>${escH(T('The five most started across AMV'))}</h3>
        <span class="sec-sub">${escH(T('Counted on AMV\u2019s servers from'))} ${total} ${escH(T(total===1?'job started worldwide. Counts only - no names, and nothing about what any job did.':'jobs started worldwide. Counts only - no names, and nothing about what any job did.'))}</span></div>
      <div class="cw-top5">${counted.map((x,i)=>`<div class="cw-top5-item">
        <span class="cw-top5-rank" aria-hidden="true">${i+1}</span>
        <span class="cw-top5-n">${x.n} ${escH(T(x.n===1?'start':'starts'))}</span>
        ${_cwAnyCard(x.job)}
      </div>`).join('')}</div>`;
  }
  /* Every remaining state shows the same five and says, in its own words, why
     they are not a count. A note where the jobs should be is the version of
     this screen the owner asked to be rid of. */
  const st=_cwPop;
  const why = st.state==='off'
      ? T('This copy of AMV is not connected to a server, so there is no worldwide count to read. These five are AMV\u2019s own pick.')
    : st.state==='error'
      ? T('The worldwide count could not be read right now, so these five are AMV\u2019s own pick.')
    : st.state==='done'
      ? T('Not enough jobs have been started across AMV yet for a ranking to mean anything, so these five are AMV\u2019s own pick - the real order takes over here the moment there is one.')
      : T('These five are AMV\u2019s own pick while the worldwide count is read.');
  const retry = st.state==='error'
    ? ` <button class="mc-sec-link" data-dact="cwPopReload">${escH(T('Try again'))}</button>` : '';
  /* HOW FAR OFF THE REAL ORDER IS, WHEN THE SERVER SAYS.

     This used to be the whole of this block - a progress bar reading 6 / 25
     where the jobs should have been. As the only content it was useless to
     somebody who came here to see what Crew does; as a footnote under five
     real cards it is the honest part it always was, and it is the difference
     between "AMV picked these" and "AMV picked these, for now". */
  const d = st.state==='done' ? (st.data||{}) : null;
  const prog = (d && !d.enough) ? (()=>{
    const have=Math.max(0, d.total|0), need=Math.max(1,(d.need|0)||25);
    const pct=Math.min(100, Math.round((have/need)*100));
    return `<div class="cw-pop-prog-row">
      <span class="cw-pop-prog" role="img" aria-label="${escH(have+' of '+need+' starts needed before a worldwide ranking is shown')}">
        <span class="cw-pop-prog-bar"><span style="width:${pct}%"></span></span>
        <span class="cw-pop-prog-n">${have} / ${need}</span>
      </span>
      <span class="cw-pop-prog-l">${escH(T('starts counted across AMV so far'))}</span>
    </div>`;
  })() : '';
  return `<div class="sec-head"><h3>${escH(T('Start with these five'))}</h3>
      <span class="sec-sub">${escH(why)}${retry}</span></div>
    <div class="cw-top5">${_cwStartHereJobs().map(j=>`<div class="cw-top5-item">${_cwAnyCard(j)}</div>`).join('')}</div>
    ${prog}`;
}

function _cwJobsBody(jobs, jobCard){
  /* The country's own work heads the list whenever a country is chosen and
     nothing narrower is being asked for. A search or a category is a narrower
     question and answering it with an unrelated group on top would be the old
     fault the other way round. */
  /* The country's own five are the top of the page now (Top 5 for you), so
     they are not repeated as a group here. */
  const cgroup = '';
  if(_cwFind){
    /* SEARCHES THE WHOLE POOL, NOT THE HUNDRED ON SCREEN.

       The showcase is a sample, and searching only the sample would mean a job
       AMV can really run is unfindable because it did not come up this visit -
       which is the one thing showing a sample must not cost. So the grid shows
       a hundred and the search reaches all of them. */
    const all = (() => { try{ return _cwAllJobs() || jobs; }catch(e){ return jobs; } })();
    const hits = all.filter(j => _cwMatches(j, _cwFind));
    return hits.length
      ? `<div class="cw-jobs-grid cw-cat-grid">${hits.map(jobCard).join('')}</div>`
      : _cwNoMatchHTML();
  }
  if(_cwCat!=='all'){
    const sel=jobs.filter(j=>j.cat===_cwCat);
    return `<div class="cw-jobs-grid cw-cat-grid">${sel.map(jobCard).join('')}</div>`;
  }
  /* Anything without a known category still has to appear - a job that exists
     but renders nowhere is the failure this whole screen keeps having. */
  /* A SHELF, NOT A WALL. With a country known the pool is two hundred and
     more, and two hundred cards is a wall - the owner's word, from when the
     list was cut to a hundred. So All shows the first few of every category
     (anything switched on always, so a running job never hides) and a See all
     that opens the category, where every one of them is. Search reaches the
     rest from here as well. */
  const known=CW_CATS.filter(c=>jobs.some(j=>j.cat===c));
  const rest=jobs.filter(j=>CW_CATS.indexOf(j.cat)<0);
  const preview=(list)=>{ let n=0; return list.filter(j=>j.on || n++ < CW_CAT_PREVIEW); };
  const seeAll=(c,n,shown)=>n>shown
    ? `<div class="int-more cw-cat-more"><button class="int-seemore" data-dact="cwCatAll" data-darg="${escH(c)}" aria-label="${escH('See all '+n+' in '+c)}">See all ${n}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div>`
    : '';
  return cgroup + known.map(c=>{
      const all=jobs.filter(j=>j.cat===c), shown=preview(all);
      return `<div class="cw-cat">
      <div class="cw-cat-h">${escH(c)}<span class="cw-cat-n">${all.length}</span></div>
      <div class="cw-jobs-grid cw-cat-grid">${shown.map(jobCard).join('')}</div>${seeAll(c,all.length,shown.length)}
    </div>`; }).join('')
    + (rest.length?`<div class="cw-cat">
      <div class="cw-cat-h">More<span class="cw-cat-n">${rest.length}</span></div>
      <div class="cw-jobs-grid cw-cat-grid">${rest.map(jobCard).join('')}</div>
    </div>`:'');
}

/* ── THE ONE-OFF ERRANDS, AND WHY THEY ARE NOT JOBS ──────────────────────────

   Half the owner's list does not repeat. Nobody wants the fastest route to the
   airport every Tuesday - they want it once, now, for a flight at six.

   Those could have been cards on this screen that ran through crewRun, and
   that would have been the wrong place to put them: crewRun's generic path
   calls the model with no web tool at all. A "cheapest route" answered from
   memory is a confident, plausible, out-of-date answer, which is worse than no
   feature. Chat has the live web search. So these open a chat with the request
   already written, one blank left for the detail only the person has, and they
   press send when they have filled it in.

   Nothing is auto-sent. The composer is filled and focused, the same as the
   starter chips do, so the request they send is one they have actually read. */
const CW_ERRANDS = [
  ['route', '🗺️', 'Fastest route somewhere',
   'Find me the fastest realistic route from [WHERE I AM] to [WHERE I AM GOING], leaving at [WHEN]. '+
   'Check current conditions on the live web, not a typical journey time: traffic, engineering works, cancellations and anything closed. '+
   'Give me the route, the door-to-door time, and the time I actually have to leave. '+
   'If there is a genuinely better alternative - a different mode, a different departure time - say so and say why. '+
   'Tell me how confident you are and what could still go wrong.'],
  ['scamcheck', '🛡️', 'Is this a scam?',
   'I am about to pay for this and I want to know if it is a scam. Here is everything I have:\n\n[PASTE THE LISTING, MESSAGE, LINK, SELLER NAME OR OFFER HERE]\n\n'+
   'Check it against how this kind of fraud actually works right now. Look up the seller, the site, the payment method and the price against what this really costs. '+
   'Tell me the specific things that are wrong with it, the things that are genuinely fine, and what an honest version of this would look like. '+
   'If it is a known scam pattern, name the pattern. If you cannot tell, say you cannot tell rather than reassuring me. '+
   'Then tell me the safest way to buy this thing, and what to do if I have already paid.'],
  ['papers', '📄', 'Work out which papers I need',
   'I need to work out exactly what paperwork this requires: [WHAT I AM APPLYING FOR - e.g. a visa, a residency renewal, a passport, a license] '+
   'for [WHO, NATIONALITY, WHERE THEY ARE NOW, AND WHERE THEY ARE APPLYING].\n\n'+
   'Go to the official government source and use that, not a summary on somebody else’s site. Give me: '+
   'every document required and what it must show, the exact forms with their real names and numbers, the fees, the order things must be done in, '+
   'how long each step takes, and what is most commonly refused or sent back. '+
   'Link the official page for each. Say clearly where the rules are unclear or recently changed. '+
   'You are not a lawyer and this is not legal advice - say so, and tell me when this is a case where I genuinely need one.'],
  ['booking', '🍽️', 'Get a table or an appointment ready',
   'I want to book [WHAT - a restaurant, a doctor, a garage, a haircut] in [WHERE], for [WHEN AND HOW MANY PEOPLE].\n\n'+
   'Find the real options that actually fit, check whether they take bookings online or by phone, and check what is actually available for that time. '+
   'Then prepare the booking so it takes me two minutes: the place, the number or the direct booking link, what to ask for, and anything I need to have ready. '+
   'Do not book, call, email or confirm anything on my behalf - hand me a call I can make or a link I can press. '+
   'If nothing is available at that time, say so and give me the nearest thing that is.'],
  ['pricecheck', '🔎', 'Am I paying too much for this?',
   'I am about to pay [AMOUNT] for [THE THING]. Tell me whether that is a fair price right now.\n\n'+
   'Check what it actually sells for today across real sellers, whether this is a normal price or an inflated one with a discount stuck on it, '+
   'and whether it is about to be cheaper - a known sale, a new model, a seasonal pattern. '+
   'Tell me the cheapest legitimate place to get it and what the catch is with each. '+
   'If it is a fair price, say so plainly instead of manufacturing a reason to wait.'],
];
function cwErrand(key){
  const e = CW_ERRANDS.find(x => x[0] === key);
  if(!e) return;
  try{ if(typeof newChat === 'function') newChat(); else setTab('chat'); }catch(_){ setTab('chat'); }
  setTimeout(()=>{
    const ta = $('mta');
    if(!ta){ toast('Open a chat and paste your question there.','info',4000); return; }
    ta.value = e[3];
    try{ ta.dispatchEvent(new Event('input')); }catch(_){}
    ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,220)+'px';
    ta.focus();
    /* The bracketed blank is the only part they have to write. Putting the
       caret on it beats asking somebody to hunt for it in eight lines. */
    try{
      const at = e[3].indexOf('[');
      if(at >= 0) ta.setSelectionRange(at, e[3].indexOf(']', at) + 1);
    }catch(_){}
    try{ if(typeof announce==='function') announce('Chat opened with your request ready. Fill in the highlighted part, then send.'); }catch(_){}
  }, 220);
}
try{ window.cwErrand=cwErrand; }catch(e){}

function _cwErrandsHTML(){
  return `<section class="cw-errands">
    <div class="sec-head"><h3>${escH(T('Things that do not repeat'))}</h3><span class="sec-sub">${escH(T('The jobs below run on a schedule. These are one-offs - AMV opens a chat with the request written out, you fill in the one blank, and it looks it up live.'))}</span></div>
    <div class="cw-errand-grid">${CW_ERRANDS.map(e=>`<button class="cw-errand" data-dact="cwErrand" data-darg="${escH(e[0])}">
      <span class="cw-errand-ic" aria-hidden="true">${e[1]}</span>
      <span class="cw-errand-t">${escH(T(e[2]))}</span>
    </button>`).join('')}</div>
  </section>`;
}

function _cwApprovals(){ return load('amv_cw_approvals') || []; }
function _cwSaveApprovals(a){ store('amv_cw_approvals', a); }

async function _crewSyncLive(){
  if(!(window.AMV_API && AMV_API.live)) return;
  /* What the catalogue looked like before the poll, so the redraw below can
     ask whether anything actually arrived. */
  const _cwSyncBefore = JSON.stringify([load('amv_cw_jobs') || [], load('amv_cw_approvals') || []]);
  try{
    const jobs=await AMV_API.jobs();
    const appr=await AMV_API.approvals();
    /* MERGED into the catalogue, not substituted for it.

       The server holds a row only for jobs that have ever been switched on.
       Replacing the list with those rows therefore threw away every job the
       user had not touched - the catalogue collapsed from seventy-odd to the
       handful they had used, on the next sync. It also dropped every field the
       mapping did not mention: the category (so the grouping fell apart), the
       instruction (so switching one on would have scheduled its TITLE), and the
       id of the automation it created (so switching it off could no longer stop
       it).

       The definitions are the source of truth for what a job IS. The server is
       the source of truth for whether it is ON. */
    /* Never rebuilt from a catalogue that has not arrived: that would store
       a list without the built-in jobs, deleting every one somebody had on. */
    if(Array.isArray(jobs) && await _loadCrewData()){
      const onByKey = {};
      jobs.forEach(j => { if(j && j.key) onByKey[j.key] = !!j.on_flag; });
      const byId = {};
      _cwJobs().forEach(j => { byId[j.id] = j; });
      store('amv_cw_jobs', _cwDefaultJobs().map(def => {
        const cur = byId[def.id] || {};
        return Object.assign({}, def, {
          on: (def.id in onByKey) ? onByKey[def.id] : !!cur.on,
          /* Local only - it is the handle on the scheduled work this device
             created, and the server's job row does not carry it. */
          autoId: cur.autoId || null,
        });
      }));
    }
    if(appr){ store('amv_cw_approvals', appr.map(a=>({id:a.id,icon:a.icon,title:a.title,preview:a.preview}))); }
    /* ONLY IF THEY ARE STILL LOOKING AT IT.

       This is fired when the tab opens and answers whenever the network
       answers. Somebody who moved on in the meantime would have the screen they
       are now reading replaced by the one they left - the stored state above is
       still updated, which is the point, so the next time they open Crew it is
       correct without anything being redrawn under them. */
    /* Only when something CHANGED. This polls and usually gets back exactly
       the catalogue that is already stored, and redrawing the whole screen to
       display what is already on it is the complaint this round is about. */
    const _after = JSON.stringify([load('amv_cw_jobs') || [], load('amv_cw_approvals') || []]);
    if((S.tab === 'crew' || S.tab === 'extensions') && _after !== _cwSyncBefore) _cwRepaintSoon();
  }catch(e){}
}
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
      <span class="cw-job-need">Uses: ${escH(j.mailName ? String(j.needs).replace(/\bEmail\b/, j.mailName) : j.needs)}
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
      <span class="cw-job-need">Uses: ${escH(j.mailName ? String(j.needs).replace(/\bEmail\b/, j.mailName) : j.needs)}
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
  const when = x.done ? ('Ran once' + (x.doneAt ? ', ' + _dayLabel(x.doneAt) : '') + ' · finished')
    : x.repeat === 'once' ? ('Runs once' + (x.next ? ', ' + _onceWhen(x.next) + ' (' + _mcWhen(x.next) + ')' : ''))
    : paused ? 'Paused' : ('Runs ' + every + (x.next ? ' · next ' + _mcWhen(x.next) : ''));
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
      <div class="mc-sched-meta">${escH(j.desc||'Runs in the background')} · Uses: ${escH(j.needs||'-')}</div>
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


/* ============================================================
   APPROVAL + PREVIEW WORKSPACE  (Phase 1 of the Mission Control redesign)
   ------------------------------------------------------------
   Task -> Plan -> Agent execution -> PREVIEW -> APPROVAL -> Final action.
   AMV stops before any consequential external action unless Auto Approve
   is on. This module renders the "Needs your approval" cards and the full
   Preview workspace: the finished result, what happened while you were away,
   the Crew that did it, artifact handoffs, and a plain-language final-action
   summary with a specific Approve button.

   Everything renders from real data on the approval object and degrades
   honestly: sections with no data are hidden, never fabricated. No token
   cost, model cost, or price is ever shown on an approval or preview.
   ============================================================ */

/* Derive the specific final action from the approval's actionType. */
function _apvAction(a){
  const t=(a.actionType||'').toLowerCase();
  const n=a.recipients, dest=a.destination||'', when=a.scheduledAt||'';
  const map={
    send:    {btn:'Approve & send',     verb:'send',     line:'Approve to send this '+(a.resultType==='email'?'email':'message')+(n!=null?(' to '+n+' recipient'+(n===1?'':'s')):(dest?(' to '+dest):''))+'.'},
    publish: {btn:'Approve & publish',  verb:'publish',  line:'Approve to publish'+(dest?(' to '+dest):' this')+(when?(' on '+when):'')+'.'},
    schedule:{btn:'Approve & schedule', verb:'schedule', line:'Approve to schedule this'+(when?(' for '+when):'')+'.'},
    post:    {btn:'Approve & post',     verb:'post',     line:'Approve to post'+(dest?(' to '+dest):'')+(when?(' - scheduled for '+when):'')+'.'},
    submit:  {btn:'Approve & submit',   verb:'submit',   line:'Approve to submit this'+(dest?(' to '+dest):'')+'.'},
    update:  {btn:'Approve & update',   verb:'update',   line:'Approve to update'+(n!=null?(' '+n+' record'+(n===1?'':'s')):(dest?(' '+dest):' this data'))+'.'},
    deploy:  {btn:'Approve & deploy',   verb:'deploy',   line:'Approve to deploy'+(dest?(' to '+dest):'')+'.'}
  };
  return map[t]||{btn:'Approve', verb:'approve', line:'Approve to complete this action.'};
}

/* Human "x ago" / "in x" for timestamps (accepts ms epoch or a string). */
function _apvAgo(ts){
  if(typeof ts!=='number') return String(ts||'');
  const d=Date.now()-ts, abs=Math.abs(d), fut=d<0;
  const m=Math.round(abs/6e4), h=Math.round(abs/36e5), day=Math.round(abs/864e5);
  let s = m<1?'just now' : m<60?(m+' min') : h<24?(h+' hr') : (day+' day'+(day===1?'':'s'));
  if(s==='just now') return s;
  return fut ? ('in '+s) : (s+' ago');
}

/* ---- the finished result, rendered as close to reality as the data allows ---- */
function _apvFrame(a){
  const r=a.result||{}, type=r.type||a.resultType||'doc';
  const par=txt=>String(txt||'').split(/\n\n+/).map(p=>'<p>'+escH(p).replace(/\n/g,'<br>')+'</p>').join('');
  if(type==='email'){
    return `<div class="pvw-frame email"><div class="pvw-mail">
      <div class="pvw-mail-hd">
        <div class="pvw-mail-row"><span class="pvw-mail-k">From</span><span>${escH(r.from||'you@amv.dev')}</span></div>
        <div class="pvw-mail-row"><span class="pvw-mail-k">To</span><span>${escH(r.to||a.destination||'')}</span></div>
        <div class="pvw-mail-row subj"><span class="pvw-mail-k">Subject</span><span>${escH(r.subject||a.title||'')}</span></div>
      </div>
      <div class="pvw-mail-body">${par(r.body||a.preview)}</div>
    </div></div>`;
  }
  if(type==='social'){
    const plat=(r.platform||'Post');
    return `<div class="pvw-frame social"><div class="pvw-post">
      <div class="pvw-post-hd"><span class="pvw-post-av">${escH((r.handle||'A').replace(/^@/,'')[0]||'A').toUpperCase()}</span>
        <div><div class="pvw-post-name">${escH(r.name||S.user?.name||'You')}</div><div class="pvw-post-h">${escH(r.handle||'')} · ${escH(plat)}</div></div></div>
      <div class="pvw-post-body">${par(r.text||a.preview)}</div>
      ${r.image?`<div class="pvw-post-img" style="background-image:url('${encodeURI(r.image)}')"></div>`:''}
    </div></div>`;
  }
  if(type==='website'){
    /* Carried on the element and hydrated once it is in the DOM, the same as
       the live cards in chat: this markup is built as a string, so there is no
       element to hand the page to yet. */
    const src=r.html?` data-amv-preview="${escH(r.html)}"`:'';
    const note=r.html?'':`<div class="pvw-web-note">Live preview appears here after the site is generated.</div>`;
    return `<div class="pvw-frame web"><div class="pvw-web-tabs"><button class="pvw-web-tab on" data-apvweb="desk">Desktop</button><button class="pvw-web-tab" data-apvweb="mob">Mobile</button><span class="pvw-web-url">${escH(r.url||a.destination||'')}</span></div>
      <div class="pvw-web-stage desk"><div class="pvw-web-frame">${r.html?`<iframe class="pvw-web-if" title="Website preview" sandbox="allow-scripts"${src}></iframe>`:note}</div></div></div>`;
  }
  if(type==='data'){
    const rows=(r.rows||[]);
    return `<div class="pvw-frame data"><div class="pvw-data-lead">${escH(r.summary||((rows.length||a.recipients||0)+' record'+((rows.length||a.recipients)===1?'':'s')+' will change'))}</div>
      <table class="pvw-data-tbl"><thead><tr><th>Field</th><th>Current</th><th>New</th></tr></thead>
      <tbody>${rows.slice(0,60).map(x=>`<tr><td>${escH(x.field||'')}</td><td class="old">${escH(x.old==null?'-':x.old)}</td><td class="new">${escH(x.new==null?'-':x.new)}</td></tr>`).join('')||`<tr><td colspan="3" class="pvw-empty-cell">Change details appear here.</td></tr>`}</tbody></table></div>`;
  }
  // report / doc / generic
  return `<div class="pvw-frame doc"><div class="pvw-doc">${r.title?`<h1>${escH(r.title)}</h1>`:''}<div class="pvw-doc-body">${par(r.body||a.preview)}</div></div></div>`;
}

/* ---- what happened while you were away: a readable work history ---- */
function _apvTimeline(a){
  const tl=a.timeline||[];
  if(!tl.length){
    const bits=[];
    if(a.startedAt) bits.push('Started '+_apvAgo(a.startedAt));
    if(a.readyAt) bits.push('Ready '+_apvAgo(a.readyAt));
    if(!bits.length) return '';
    return `<div class="pvw-sec"><div class="pvw-sec-h">Activity</div><div class="pvw-tl-min">${escH(bits.join(' · '))}</div></div>`;
  }
  return `<div class="pvw-sec"><div class="pvw-sec-h">What happened while you were away</div>
    <ol class="pvw-tl">${tl.map(e=>`<li class="pvw-tl-ev"><span class="pvw-tl-dot"></span>
      <div class="pvw-tl-b"><div class="pvw-tl-top"><span class="pvw-tl-agent">${escH(e.agent||'AMV')}</span><span class="pvw-tl-t">${escH(e.t||'')}</span></div>
      <div class="pvw-tl-txt">${escH(e.text||'')}</div></div></li>`).join('')}</ol></div>`;
}

/* ---- the Crew: restrained identity (initials + role + status dot) ---- */
function _apvCrew(a){
  const crew=a.crew||[];
  if(!crew.length) return '';
  const ini=n=>String(n||'A').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return `<div class="pvw-sec"><div class="pvw-sec-h">Crew</div>
    <div class="pvw-crew">${crew.map((c,i)=>`<div class="pvw-agent">
      <span class="pvw-agent-mk m${i%5}">${escH(ini(c.name||c.role))}</span>
      <div class="pvw-agent-b"><div class="pvw-agent-role">${escH(c.role||c.name||'Agent')}</div>
        <div class="pvw-agent-resp">${escH(c.resp||'')}</div></div>
      <span class="pvw-agent-st ${c.status==='done'?'done':c.status==='blocked'?'blocked':'active'}">${escH(c.status==='done'?'Done':c.status==='blocked'?'Blocked':c.status||'Working')}</span>
    </div>`).join('')}</div></div>`;
}

/* ---- artifact handoffs: click an artifact to inspect it ---- */
function _apvArtifacts(a){
  const arts=a.artifacts||[];
  if(!arts.length) return '';
  return `<div class="pvw-sec"><div class="pvw-sec-h">Work handed between agents</div>
    <div class="pvw-hand">${arts.map((x,i)=>`<div class="pvw-hand-row">
      <span class="pvw-hand-a">${escH(x.from||'')}</span>
      <button class="pvw-hand-art" data-apvart="${i}" title="Inspect">${escH(x.name||'artifact')}</button>
      <span class="pvw-hand-arrow">→</span><span class="pvw-hand-a">${escH(x.to||'')}</span>
    </div>`).join('')}</div></div>`;
}

/* Skeleton shown while a preview's data / iframe is genuinely loading. */
function _apvSkeleton(){
  return `<div class="pvw-body"><main class="pvw-stage"><div class="pvw-skel-frame">
      <div class="skel skel-l"></div><div class="skel skel-l"></div><div class="skel skel-l w70"></div>
      <div class="skel skel-block"></div><div class="skel skel-l"></div><div class="skel skel-l w80"></div></div></main>
    <aside class="pvw-side"><div class="skel skel-card"></div><div class="skel skel-card"></div></aside></div>`;
}

/* Open the full-page Preview workspace for an approval. */
function apvPreview(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ toast('That item is no longer waiting','info'); return; }
  const r=$('ovr'); if(!r) return;
  const act=_apvAction(a);
  // Shell + skeleton first (real progressive render; iframe results keep the skeleton until load).
  r.innerHTML=`<div class="ov pvw-ov" id="pvw-bg"><div class="pvw" role="dialog" aria-modal="true" aria-label="Preview and approve">
    <header class="pvw-top">
      <button class="pvw-back" data-dact="apvClose" aria-label="Back">← <span>Back</span></button>
      <div class="pvw-top-mid"><span class="pvw-top-ic">${a.icon||'✉️'}</span><span class="pvw-top-t">${escH(a.title)}</span>${a.project?`<span class="pvw-chip">${escH(a.project)}</span>`:''}</div>
      <div class="pvw-top-r">${a.timeline&&a.timeline.length?`<button class="pvw-quiet" data-apvhist="1">View history</button>`:''}<span class="pvw-mode ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Auto-approve off'}</span></div>
    </header>
    <div id="pvw-mount">${_apvSkeleton()}</div>
    <footer class="pvw-foot">
      <div class="pvw-foot-line"><span class="pvw-foot-ic">●</span>${escH(act.line)}</div>
      <div class="pvw-foot-act">
        <button class="btn pvw-revise" data-dact="apvRevise" data-darg="${a.id}">Ask AMV to revise</button>
        <button class="btn pvw-edit" data-dact="apvEdit" data-darg="${a.id}">Edit</button>
        <button class="btn pvw-reject" data-dact="apvReject" data-darg="${a.id}">Reject</button>
        <button class="btn pvw-approve" data-dact="apvApprove" data-darg="${a.id}">${escH(act.btn)}</button>
      </div>
      <button class="pvw-more" data-apvmore="1" aria-label="More actions">⋯</button>
    </footer>
  </div></div>`;
  onBackdrop($('pvw-bg'),apvClose);
  setTimeout(()=>{ try{ document.querySelector('.pvw-back').focus(); }catch(e){} },30);
  const hist=r.querySelector('[data-apvhist]'); if(hist) on(hist,'click',()=>{ const s=r.querySelector('.pvw-side'); if(s) s.scrollIntoView({behavior:'smooth'}); });
  const more=r.querySelector('[data-apvmore]'); if(more) on(more,'click',()=>r.querySelector('.pvw-foot-act')?.classList.toggle('open'));
  // Progressive render: paint the skeleton, then mount the real content next frame.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const m=$('pvw-mount'); if(!m) return;
    m.innerHTML=`<div class="pvw-body">
      <main class="pvw-stage">
        <div class="pvw-stage-h"><span>Final result</span><span class="pvw-stage-sub">This is exactly what will ${escH(act.verb)}.</span></div>
        ${_apvFrame(a)}
      </main>
      <aside class="pvw-side">
        <div class="pvw-final">
          <div class="pvw-final-h">Before you approve</div>
          <div class="pvw-final-line">${escH(act.line)}</div>
          ${a.warning?`<div class="pvw-final-warn">${escH(a.warning)}</div>`:''}
          <div class="pvw-final-meta">
            ${a.crewName?`<span class="pvw-fm"><span>Crew</span>${escH(a.crewName)}</span>`:''}
            ${a.destination?`<span class="pvw-fm"><span>Destination</span>${escH(a.destination)}</span>`:''}
            ${a.scheduledAt?`<span class="pvw-fm"><span>When</span>${escH(a.scheduledAt)}</span>`:''}
            ${a.account?`<span class="pvw-fm"><span>Account</span>${escH(a.account)}</span>`:''}
          </div>
        </div>
        ${_apvTimeline(a)}
        ${_apvCrew(a)}
        ${_apvArtifacts(a)}
      </aside>
    </div>`;
    // website preview: reveal iframe only once it has genuinely loaded
    const ifr=m.querySelector('.pvw-web-if');
    if(ifr){ ifr.style.opacity='0'; ifr.addEventListener('load',()=>{ ifr.style.transition='opacity .2s'; ifr.style.opacity='1'; }); }
    m.querySelectorAll('[data-apvweb]').forEach(b=>on(b,'click',()=>{ m.querySelectorAll('[data-apvweb]').forEach(x=>x.classList.remove('on')); b.classList.add('on'); const st=m.querySelector('.pvw-web-stage'); if(st){ st.classList.toggle('mob',b.dataset.apvweb==='mob'); st.classList.toggle('desk',b.dataset.apvweb==='desk'); } }));
    m.querySelectorAll('[data-apvart]').forEach(b=>on(b,'click',()=>{ const art=(a.artifacts||[])[+b.dataset.apvart]; if(art) _apvInspectArtifact(art); }));
  }));
}
function apvClose(){ const x=$('ovr'); if(x) x.innerHTML=''; }
function _apvInspectArtifact(art){
  toast((art.name||'Artifact')+(art.note?(' - '+art.note):': intermediate work handed between agents'),'info',4200);
}
/* Approve straight from a card (no preview) with a confirm on the consequence. */
async function apvQuickApprove(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ renderCrewView(); return; }
  const act=_apvAction(a);
  if(!await showConfirmAsync(act.line)) return;
  await _apvDoApprove(a);
}
async function apvApprove(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ apvClose(); return; }
  apvClose();
  await _apvDoApprove(a);
}
const _APV_PAST={send:'Sent',publish:'Published',schedule:'Scheduled',post:'Posted',submit:'Submitted',update:'Updated',deploy:'Deployed',approve:'Done'};
/* Approving is what actually SENDS the thing. This fired the request, forgot
   it, removed the item from the queue, and said "Sent" - so a failed call meant
   nothing went out, the draft was gone, and the person believed their email had
   been sent. With no engine connected nothing was even attempted, and it still
   said "Sent". An email that was never sent, reported as sent, is the kind of
   mistake somebody loses a client over.

   It now waits, and on failure the approval STAYS in the queue, because the one
   thing worse than not sending is not sending and losing the draft too. */
async function _apvDoApprove(a){
  const act=_apvAction(a);
  const past=_APV_PAST[act.verb]||'Done';
  if(!(window.AMV_API && AMV_API.live)){
    toast('Nothing was '+String(past).toLowerCase()+' - AMV is not connected to a backend, so it has nowhere to send this. '+
          'It is still waiting for you.','error',7000);
    renderCrewView();
    return { ok:false, code:'needs_service' };
  }
  let d;
  try{
    d = await AMV_API.actApproval(a.id,'approve');
  }catch(e){
    toast('That was NOT '+String(past).toLowerCase()+(e&&e.message?' ('+e.message+')':'')+
          '. It is still in your approvals - try again.','error',7000);
    renderCrewView();
    return { ok:false, code:'failed', error:(e&&e.message)||'' };
  }
  /* THE SERVER HAD NOTHING TO SEND, WHICH IS NOT A SEND.

     `crewApprovalAct` answers `{found:false, delivered:null}` for any approval
     it does not hold - and it holds only the ones its own cron enqueued. Every
     card `_recurMakeApproval` builds lives in this browser's storage and has
     never been near the server, so `found:false` is the NORMAL answer for a
     job that only runs while AMV is open.

     `delivered` is null there, not false, so the check below sailed past it and
     the code fell through to `toast('Sent')` - after deleting the draft. The
     person was told their email had gone out, the draft was gone, and nothing
     had been sent to anybody. That is the exact failure the comment above this
     function describes as the one somebody loses a client over; it was fixed
     for a failed request and a missing provider, and this third way of getting
     there was left open.

     Only for a SEND. A review-only card genuinely is resolved by being read,
     and the server having no copy of it changes nothing about that. */
  if(d && d.found === false && a.actionType === 'send'){
    toast('That was NOT sent. This draft was made by a job that only runs on this device, so your '
        + 'backend has no copy of it and had nothing to send. It is still in your approvals - open it '
        + 'to copy the text, or set the job up again now that AMV is connected so it runs on the server.',
      'error', 10000);
    renderCrewView();
    return { ok:false, code:'not_on_server', delivered:false };
  }
  _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
  /* Somebody else is already delivering this one - a double press, a retry, a
     second tab. The server now refuses to send it twice, so this request made
     no send and must not claim one. "Already going out" is the true sentence
     and it is a reassurance, not an error: the work IS on its way. */
  if(d && d.duplicate){
    toast('Already going out - this was approved a moment ago, and AMV will not send it twice.','info',6000);
    renderCrewView();
    return { ok:true, duplicate:true, delivered:null };
  }
  /* "Sent" only when the server actually sent it. An item that was approved but
     has no email provider behind it is APPROVED, which is a different word. */
  if(d && d.delivered === false){
    toast('Approved, but not emailed - no email provider is connected to this deployment, so nothing left AMV.','info',7000);
  } else {
    toast(past,'success');
  }
  renderCrewView();
  return { ok:true, delivered: d ? d.delivered : null };
}
function apvReject(id){ apvClose(); cwReject(id); }
/* The body text of an approval, wherever it lives for that result type. */
function _apvBodyField(a){
  const r=a.result||{}; const type=r.type||a.resultType||'doc';
  if(type==='social') return r.text||a.preview||'';
  return r.body||a.preview||'';
}
/* Write an edited body back into the right field for the result type. */
function _apvSetBody(a,val){
  a.result=a.result||{}; const type=a.result.type||a.resultType||'doc';
  if(type==='social') a.result.text=val; else a.result.body=val;
  a.preview=val;
}
/* Full editor: change the message, who it goes to, and when - then save,
   send, or delete. Edits persist to the approval store (and the backend when
   connected), so what you approve is exactly what you edited. */
function apvEdit(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ toast('That item is no longer waiting','info'); return; }
  const r=$('ovr'); if(!r) return;
  const type=(a.result&&a.result.type)||a.resultType||'doc';
  const isEmail=type==='email';
  const to=(a.result&&a.result.to)||a.destination||'';
  const subject=(a.result&&a.result.subject)||a.title||'';
  const body=_apvBodyField(a);
  const when=a.scheduledAt||'';
  const recips=(a.recipients!=null)?a.recipients:'';
  r.innerHTML=`<div class="ov ape-ov" id="ape-bg"><div class="ape" role="dialog" aria-modal="true" aria-label="Edit before sending">
    <header class="ape-top">
      <button class="pvw-back ape-back" data-dact="apvClose" aria-label="Back">← <span>Back</span></button>
      <div class="ape-top-t">Edit before it sends</div>
      <span class="pvw-mode ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Needs approval'}</span>
    </header>
    <div class="ape-body">
      <label class="ape-f"><span>Title</span><input id="ape-title" type="text" value="${escH(a.title||'')}"></label>
      <label class="ape-f"><span>${isEmail?'To':'To / where it goes'}</span><input id="ape-to" type="text" value="${escH(to)}" placeholder="${isEmail?'who this email goes to':'who or where this goes'}"></label>
      <label class="ape-f"><span>Number of people</span><input id="ape-recips" type="number" min="0" value="${escH(String(recips))}" placeholder="how many recipients"></label>
      ${isEmail?`<label class="ape-f"><span>Subject</span><input id="ape-subject" type="text" value="${escH(subject)}"></label>`:''}
      <label class="ape-f"><span>Message</span><textarea id="ape-body" rows="10">${escH(body)}</textarea></label>
      <label class="ape-f"><span>When to send</span><input id="ape-when" type="text" value="${escH(when)}" placeholder='e.g. “now” or “Tomorrow 9:00 AM”'></label>
    </div>
    <footer class="ape-foot">
      <button class="btn ape-del" data-dact="_apvEditDelete" data-darg="${a.id}">Delete</button>
      <div class="ape-foot-r">
        <button class="btn ape-save" data-dact="_apvEditSave" data-darg="${a.id}">Save changes</button>
        <button class="btn pvw-approve" data-dact="_apvEditSend" data-darg="${a.id}">Save &amp; send</button>
      </div>
    </footer>
  </div></div>`;
  onBackdrop($('ape-bg'),apvClose);
  setTimeout(()=>{ try{ $('ape-title').focus(); }catch(e){} },30);
}
/* Turn a plain-English "when" into a normalized schedule. Understands "now",
   "every hour", "every day at 9", "every morning", "every Monday 9am",
   "weekly", "monthly", or a one-off phrase kept as-is. */
function _parseWhen(raw){
  const s=(raw||'').trim().toLowerCase();
  if(!s || /^(now|asap|immediately|right away)$/.test(s)) return {kind:'now', label:''};
  /* The time, to the minute. "7:30pm" used to become 7pm - the minutes were
     matched and dropped - and "overnight" had no meaning at all. */
  const timeFrom=(txt)=>{
    const m=txt.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || txt.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/) || txt.match(/\b(\d{1,2}):(\d{2})\b/);
    if(m){ let h=parseInt(m[1],10); const mi=m[2]?parseInt(m[2],10):0; const ap=(m[3]||'').toLowerCase();
      if(ap==='pm'&&h<12)h+=12; if(ap==='am'&&h===12)h=0; if(h>=0&&h<=23&&mi>=0&&mi<=59) return {hour:h, minute:mi}; }
    if(/\bovernight\b/.test(txt)) return {hour:3, minute:0};
    if(/\bmorning\b/.test(txt)) return {hour:9, minute:0};
    if(/\b(noon|midday)\b/.test(txt)) return {hour:12, minute:0};
    if(/\bafternoon\b/.test(txt)) return {hour:15, minute:0};
    if(/\b(evening|tonight)\b/.test(txt)) return {hour:19, minute:0};
    if(/\bnight\b/.test(txt)) return {hour:21, minute:0};
    return {hour:9, minute:0};
  };
  const DOW={sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,thursday:4,thu:4,thurs:4,friday:5,fri:5,saturday:6,sat:6};
  const recurring=/\b(every|each|daily|weekly|hourly|monthly|weekdays|weekends|nightly|overnight)\b/.test(s);
  if(recurring){
    if(/\bevery\s+10\s*min/.test(s)) return {kind:'recurring', freq:'10min', label:'Every 10 minutes'};
    if(/\bevery\s+30\s*min|every half(?:\s|-)hour/.test(s)) return {kind:'recurring', freq:'30min', label:'Every 30 minutes'};
    if(/\bhour/.test(s)) return {kind:'recurring', freq:'hourly', label:'Every hour'};
    const t=timeFrom(s);
    let days=[]; for(const k in DOW){ if(new RegExp('\\b'+k+'s?\\b').test(s)) days.push(DOW[k]); }
    if(/\bweekdays?\b/.test(s)) days=days.concat([1,2,3,4,5]);
    if(/\bweekends?\b/.test(s)) days=days.concat([0,6]);
    days=[...new Set(days)].sort((a,b)=>a-b);
    if(days.length){ const sc={cad:'weekly',days,hour:t.hour,minute:t.minute}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    if(/\bweek/.test(s)){ const sc={cad:'weekly',days:[1],hour:t.hour,minute:t.minute}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    if(/\bmonth/.test(s)){
      /* "on the 15th", "the 1st of every month" - the first one by default. */
      const dm=s.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
      const dom=dm?Math.min(31,Math.max(1,parseInt(dm[1],10))):1;
      const sc={cad:'monthly',dom,hour:t.hour,minute:t.minute}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)};
    }
    const sc={cad:'daily',hour:t.hour,minute:t.minute}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)};
  }
  return {kind:'once', label:raw.trim()};
}
/* Read the form back into the approval object and persist it. Returns the
   updated approval (or null if it vanished). */
function _apvCollectEdit(id){
  const list=_cwApprovals(); const a=list.find(x=>x.id===id); if(!a) return null;
  const g=k=>{ const el=$(k); return el?el.value:undefined; };
  const title=g('ape-title'); if(title!=null) a.title=title.trim()||a.title;
  const to=g('ape-to');
  if(to!=null){ a.destination=to.trim(); a.result=a.result||{}; if((a.result.type||a.resultType||'doc')==='email') a.result.to=to.trim(); }
  const rc=g('ape-recips');
  if(rc!=null){ const n=parseInt(rc,10); a.recipients = (rc.trim()==='' || isNaN(n)) ? null : n; }
  const subj=g('ape-subject');
  if(subj!=null){ a.result=a.result||{}; a.result.subject=subj.trim(); }
  const body=g('ape-body'); if(body!=null) _apvSetBody(a,body);
  const when=g('ape-when');
  if(when!=null){
    const p=_parseWhen(when);
    a.scheduledAt = p.label || '';
    a._recur = (p.kind==='recurring') ? (p.sched?{sched:p.sched}:(p.freq?{freq:p.freq}:null)) : null;
    if(p.kind==='recurring') a.actionType='schedule';
    else if(p.kind==='once' && a.scheduledAt) a.actionType=a.actionType||'schedule';
  }
  // Emails always go FROM the signed-in account - never a placeholder.
  if((a.result&&a.result.type)==='email'){ a.result.from=(S.user&&S.user.email)||a.result.from||''; a.account=a.result.from; }
  _cwSaveApprovals(list);
  // Persist the edit to the backend when connected, so the real send uses it.
  if(window.AMV_API && AMV_API.live && typeof AMV_API._fetch==='function'){
    try{ AMV_API._fetch('/api/approvals/edit',{method:'POST',body:JSON.stringify({id:a.id,patch:{title:a.title,destination:a.destination,recipients:a.recipients,scheduledAt:a.scheduledAt,recurrence:a._recur,from:a.account,result:a.result}})}).catch(()=>{}); }catch(e){}
  }
  return a;
}
/* If the edit set a recurring "when", register it as scheduled work so it shows
   in Scheduled and actually recurs (backend when connected). Returns true if it
   became a schedule. */
/* Always returns a result OBJECT, never a bare boolean - three callers read
   this, and one of them was checking it for truthiness. Once it became async a
   bare promise would have been truthy every time, so every caller would have
   claimed the job was scheduled. `code:'none'` means there was nothing
   recurring to register at all. */
async function _apvRegisterRecur(a){
  if(!a._recur) return { ok:false, code:'none' };
  const list=_loadSched();
  const isEmail=(a.result&&a.result.type)==='email';
  const desc=isEmail?('Send email “'+(a.result.subject||a.title||'')+'” to '+(a.destination||a.result.to||'recipients')):('Do: '+(a.title||'task'));
  const item={id:'a'+Date.now(), goal:desc, approval:a.autoApprove?'auto':'require', created:Date.now(), lastRun:null};
  if(a._recur.sched){ item.sched=a._recur.sched; item.next=_schedNext(a._recur.sched,Date.now()); }
  else { item.freq=a._recur.freq||'daily'; item.next=_freqNext(item.freq,Date.now()); }
  list.push(item); _saveSched(list);
  /* Registered on the server, and the caller is told whether that worked -
     a recurring job that only exists in this browser runs when AMV is open and
     not otherwise, which is the opposite of what scheduling one means. */
  const res = await _mcScheduleServer({ goal:desc, sched:item.sched, freq:item.freq, approval:item.approval,
    payload:isEmail?{type:'email',result:a.result,to:a.destination,from:a.account}:null });
  if(res.id){ const l2=_loadSched(); const me=l2.find(x=>x.id===item.id); if(me){ me.autoId=res.id; _saveSched(l2); } }
  return res;
}
async function _apvEditSave(id){
  const a=_apvCollectEdit(id); if(!a){ apvClose(); return; } apvClose();
  if(a._recur){
    const res = await _apvRegisterRecur(a);
    _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
    toast('Scheduled - '+(a.scheduledAt||'recurring')+_mcWhereItRuns(res),
          res.ok?'success':'info', res.ok?3500:7000);
  }
  else toast('Changes saved','success');
  if(S.tab==='crew') renderCrewView();
}
async function _apvEditSend(id){
  const a=_apvCollectEdit(id); if(!a){ apvClose(); return; } apvClose();
  if(a._recur){
    const res = await _apvRegisterRecur(a);
    _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
    toast('Scheduled - '+(a.scheduledAt||'recurring')+_mcWhereItRuns(res),
          res.ok?'success':'info', res.ok?3500:7000);
    if(S.tab==='crew') renderCrewView();
    return;
  }
  await _apvDoApprove(a);
}
async function _apvEditDelete(id){ if(!await showConfirmAsync('Delete this draft?\n\nIt will not be sent, and it is not kept anywhere.')) return; apvClose(); cwReject(id); }
window._apvEditSave=_apvEditSave; window._apvEditSend=_apvEditSend; window._apvEditDelete=_apvEditDelete;
function apvRevise(id){
  const item=_cwApprovals().find(x=>x.id===id); apvClose();
  setTab('chat');
  setTimeout(()=>{ const ta=$('mta'); if(ta&&item){ ta.value='Revise this before it goes out - tell me what you changed and why:\n\n'+(item.result?.body||item.preview||item.title); ta.dispatchEvent(new Event('input')); ta.focus(); } },140);
}
window.apvPreview=apvPreview; window.apvClose=apvClose; window.apvApprove=apvApprove;
window.apvQuickApprove=apvQuickApprove; window.apvReject=apvReject; window.apvEdit=apvEdit; window.apvRevise=apvRevise;


