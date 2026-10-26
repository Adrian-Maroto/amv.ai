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
/* Mission Control's screen (crew-view.js), fetched once, beside the
   catalogue - see the stand-in renderCrewView in 10b. */
let _crewViewP = null;
function _loadCrewView(){
  if(window._crewViewHere) return Promise.resolve(true);
  if(_crewViewP) return _crewViewP;
  _crewViewP = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'crew-view.js';
    s.onload = () => res(!!window._crewViewHere);
    s.onerror = () => { _crewViewP = null; s.remove(); res(false); };
    document.head.appendChild(s);
  });
  return _crewViewP;
}
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
  /* And the country's own jobs with it, so opening Crew has nothing left to
     wait for. Sooner than it was (8s): somebody who opens Crew in the first
     few seconds should not meet "Loading your Crew". */
  /* And the screens split out of the page (audit #40) - Mission Control's and
     the code workspace's - for the same reason: opening one draws at once. */
  const go = () => { try{ _loadCrewData().then(ok => { if(ok){ try{ _cwLoadLocal(_cwCountryGuess()); }catch(e){} } }); _loadCrewView();
    _lazyLoad('code-view.js', () => typeof window._devDeploy === 'function');
    _lazyLoad('integrations-view.js', () => window._intViewHere === true);
    _lazyLoad('settings-panes.js', () => typeof window._renderSetPaneInner === 'function'); }catch(e){} };
  if(typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 2500 });
  else setTimeout(go, 1500);
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
  if(st === 'closed') return T('Runs with AMV closed');
  if(st === 'open')   return T('Runs while AMV is open');
  /* Name what is missing, so the sentence tells you what to do about it.
     Whole sentences with slots, one for one thing missing and one for two:
     "X and Y is connected" was English that was also wrong, and a sentence
     glued from English pieces is one no language pack can ever match. */
  let missing = [];
  try{ missing = (typeof _cwNeedsMissing === 'function') ? _cwNeedsMissing(j) : []; }catch(_e){}
  const a = T(missing[0] || 'your account'), b = missing[1] ? T(missing[1]) : '';
  return (b ? T('Runs with AMV closed - once {a} and {b} are connected') : T('Runs with AMV closed - once {a} is connected'))
    .replace('{a}', () => a).replace('{b}', () => b);
}
/* "Uses: Calendar, Email" names each thing in the reader's language; a mail
   job names the actual app ("Gmail"), which is a name and stays one. */
function _cwUsesLine(j, needs){
  const list = String(needs == null ? (j && j.needs) || '' : needs).split(',').map(x => x.trim()).filter(Boolean)
    .map(n => (n === 'Email' && j && j.mailName) ? j.mailName : T(n));
  return T('Uses:') + ' ' + (list.length ? list.join(', ') : '-');
}
try{ window._cwWhereState=_cwWhereState; window._cwWhereLabel=_cwWhereLabel; window._cwUsesLine=_cwUsesLine; }catch(e){}
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
