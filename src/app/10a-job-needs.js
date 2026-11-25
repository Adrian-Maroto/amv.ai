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
  /* Back to the job's own panel (Nov 22, the owner: "AMV opens a thing saying
     this job will do this and needs this; connect, and then click Run"). The
     panel now shows what was connected, ticked, and Run where Connect was -
     not a second, different screen to read before the same button. */
  try{ cwPeek(id); return true; }catch(e){ try{ cwNeeds(id); return true; }catch(_e){ return false; } }
}
try{ window.cwResumeIfAny = cwResumeIfAny; }catch(e){}

function cwNeeds(jobId){
  const j = _cwFindJob(jobId);
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
            + escH(j.on ? T('Turn it off') : T('Run')) + '</button>')
      + '</div>'
    + '</div>'
  + '</div></div>';
  r.classList.add('on');

  const back = () => { try{ cwPeek(j.id); }catch(e){ try{ closeOvr(); }catch(_e){} } };
  onBackdrop($('cwn-bg'), () => { try{ closeOvr(); }catch(e){} });
  on($('cwn-x'), 'click', () => { try{ closeOvr(); }catch(e){} });
  on($('cwn-back'), 'click', back);
  on($('cwn-on'), 'click', () => { try{ closeOvr(); cwToggle(j.id); }catch(e){} });

  r.querySelectorAll('.cwn-go').forEach(b => on(b, 'click', () => _cwConnectNeed(j, b.dataset.cwnNeed, b.dataset.cwnKind)));
}
/* Where connecting one thing a job needs starts - from this list, or straight
   from the job's own panel, which lists the same needs. */
function _cwConnectNeed(j, need, kind){
  kind = kind || _cwNeedKind(need);
  /* Remembered BEFORE leaving, for every route - a provider sign-in is a
     full navigation and the tab changes are not much kinder. */
  _cwResumeJob(j.id);
  if(kind === 'oauth'){ try{ openCrewConnect(j.id); }catch(e){} return; }
  if(kind === 'bank'){
    /* The bank link dialog: where the link actually starts. Not Connectors,
       which has nothing to offer for a bank. */
    try{ openBankLink(); }catch(e){}
    return;
  }
  /* An app: the directory, searched for the one it wants, so the thing they
     came for is the first thing on the screen. */
  try{ closeOvr(); setTab('integrations'); }catch(e){}
  try{ if(typeof cdirAll === 'function') cdirAll(_cwAppNameOf(need).toLowerCase()); }catch(e){}
}
try{ window.cwNeeds = cwNeeds; }catch(e){}

function openCrewConnect(jobId){
  const j=_cwFindJob(jobId);
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
  const j=(_cwJobs()||[]).find(x=>x.id===want.job)||_cwFindJob(want.job);
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
      const j = _cwFindJob(jobId);
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
    desc:'Reads the renewal notices in your mail for passport, license, insurance, visa, registration and tenancy - the things that cost a great deal of trouble when they lapse and give no warning when they do.' },
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
    ...(CW_CONNECTS[m.k] ? { boost: CW_CONNECTS[m.k] } : {}),
    title: m.t(f), desc: m.d(f, C), where: String(f[m.k]),
    asks: { q: m.ask[0], ph: m.ask[1] },
    /* The same closing rule as every other country job: a made-for job is
       no less able to invent a date, a price or a listing. */
    prompt: m.p(f, C) + ' The user is in ' + C + '. Only real, current information with sources; never invent listings, prices or dates.',
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
/* WHAT EACH COUNTRY JOB CONNECTS TO (Nov 23). The owner: "for these things
   like family it should be connect to your school account, your billing
   account ... everything has some sort of connection, either the web or this
   account". Every one of these jobs works from the web, and says so; the
   account that makes it about YOU is offered beside it - school fees with the
   school account and the school's emails, a bill check with the mailbox the
   bills arrive in, a deadline with the calendar. Optional (`boost`), never a
   requirement: a job that runs from the web is not told it is broken because
   a mailbox is not linked, and it keeps running with AMV closed. */
const CW_CONNECTS = {
  schoolterms:'Classroom, Calendar', schoolfees:'Classroom, Email', kids:'Calendar', childcare:'Email', checkups:'Calendar',
  parental:'Email', eldercare:'Calendar',
  papers:'Classroom, Calendar', results:'Classroom, Email', grants:'Email', housing:'Email', drivingtest:'Calendar',
  abroad:'Email', training:'Calendar', studydeadlines:'Classroom, Calendar', exams:'Classroom, Calendar', uni:'Classroom, Email',
  fees:'Email, Bank connection', budget:'Email, Bank connection', refund:'Email, Bank connection', deductions:'Email, Bank connection',
  savings:'Bank connection', cards:'Email, Bank connection', ccrates:'Bank connection', pension:'Email', mortgage:'Email, Bank connection',
  switch:'Bank connection', limits:'Bank connection', remit:'Bank connection', banks:'Bank connection',
  returns:'Email', energy:'Email', broadband:'Email', phoneplan:'Email', carinsurance:'Email', homeinsurance:'Email',
  localtax:'Email, Calendar', pricerises:'Email', bundles:'Email', transit:'Email', roaming:'Email', benefits:'Email',
  tax:'Email, Calendar', telco:'Email', selfemployed:'Email, Calendar', value:'Email',
  salary:'Email', interview:'Calendar', cv:'Email', hiring:'Email', internships:'Email', govjobs:'Email', freelance:'Email',
  jobfairs:'Calendar', jobs:'Email',
  appts:'Calendar', travel:'Email', visa:'Email', flights:'Calendar', getaway:'Calendar', hotels:'Calendar', flightshome:'Calendar',
  events:'Calendar', concerts:'Calendar', weekend:'Calendar', free:'Calendar', holidays:'Calendar', calendar:'Calendar',
  commute:'Calendar', traffic:'Calendar', delays:'Calendar', disruption:'Calendar', strikes:'Calendar', rail:'Calendar',
  rents:'Email', rentrights:'Email', moving:'Email, Calendar', fines:'Email', wedding:'Calendar', id:'Email, Calendar',
  car:'Email', prop:'Email', gov:'Email, Calendar', health:'Calendar',
  waits:'Calendar', insurance:'Email', clinics:'Calendar', gym:'Calendar', races:'Calendar', mind:'Calendar',
  tenders:'Email', bizlicence:'Email, Calendar', smbtax:'Email, Calendar', bizgrants:'Email', firsthire:'Email',
};
try{ window.CW_CONNECTS = CW_CONNECTS; }catch(e){}
function _cwMadeMore(cc){
  const f = _cwFacts[cc], row = _cwCountryRow(cc);
  if(!f || !row) return [];
  const C = row[1], low = cc.toLowerCase();
  const key = m => (m[0] && m[0].charAt(0) !== '@') ? m[0] : '';
  const cyc = t => String(t).split('{cycle}').join(CW_FUEL_CYCLE[cc] || 'at its next review');
  const receives = (CW_POP_BOOST.find(b => b[0] === 'REMIT') || ['', ''])[1].split(' ').indexOf(cc) >= 0;
  return _cwMadeMoreList().filter(m => _cwRowFor(m, f, cc)).map(m => _cwRemitHere(m[1] === 'remit' && receives, C, f, {
    id: 'cc_' + low + '_' + m[1], made: true, country: cc, countryName: C,
    cat: m[2], icon: m[3], every: m[4] === 'monthly' ? 'weekly' : m[4], ...(_cwEveningTpl(m[6]) ? { hour: 18 } : {}), on: false, needs: 'Web research',
    ...(CW_CONNECTS[m[1]] ? { boost: CW_CONNECTS[m[1]] } : {}),
    title: cyc(_cwFill(_cwLocalTitle(m[1], f, C, m[5]), f, key(m), C)), desc: cyc(_cwFill(m[6], f, key(m), C)), where: key(m) ? String(f[key(m)]) : C,
    asks: m[7] ? { q: _cwFill(m[7], f, key(m), C), ph: m[8] } : null,
    prompt: cyc(_cwFill(m[9], f, key(m), C)) + ' The user is in ' + C + '. Only real, current information with sources; never invent listings, prices or dates.',
  }));
}

/* THE EVERYDAY FIFTY (Nov 23): crew-data.js `popular`, the jobs people run
   every day - in every country, in the research order written beside the
   data (docs/RESEARCH.md). The country's name goes in where the text has
   one, and its own sites (AMV's server facts) are handed to the run when
   known - never invented when not. Without a country the text stays
   general rather than saying "in your country". */
function _cwPopularJobs(cc){
  const list = _cwPopularList(); if(!list.length) return [];
  const row = cc ? _cwCountryRow(cc) : null, C = row ? row[1] : '';
  const f = (cc && _cwFacts[cc]) || {};
  const plain = (s) => String(s || '').replace(/ (?:in|for|at the stores people in) \{C\}/g, '').replace(/\{C\}/g, '').replace(/\s{2,}/g, ' ').trim();
  /* Where a service is blocked nationwide (the same list as country-
     catalog.js CC_BLOCKED), its job is not offered there: TikTok and
     Reddit in mainland China, TikTok in India (banned June 2020). */
  const blocked = { CN: ['yt_posts', 'ig_posts', 'tiktok_posts', 'x_posts', 'linkedin_company', 'reddit_hot'], IN: ['tiktok_posts'], RU: ['ig_posts', 'x_posts', 'linkedin_company'] }[cc] || [];
  return list.filter(m => blocked.indexOf(m[1]) < 0).map(m => {
    const k = m[0] && f[m[0]] ? m[0] : '';
    const fill = (s) => C ? _cwFill(s, f, k, C) : plain(s);
    const hour = +m[11];
    return {
      id: (cc ? 'cc_' + cc.toLowerCase() + '_p_' : 'p_') + m[1], popular: true, country: cc || '', countryName: C,
      cat: m[2], icon: m[3], every: m[4], ...(m[4] !== 'hourly' && Number.isInteger(hour) ? { hour } : {}), on: false,
      needs: m[10] || 'Web research',
      title: fill(m[5]), desc: fill(m[6]),
      asks: m[7] ? { q: fill(m[7]), ph: m[8] } : null,
      prompt: fill(m[9]) + (k ? ' Start with the sources people there use: ' + String(f[k]) + '.' : '')
        + (C ? ' The user is in ' + C + '.' : '') + ' Only real, current information with sources; never invent listings, prices or dates.',
    };
  });
}
try{ window._cwPopularJobs = _cwPopularJobs; }catch(e){}
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
  return hits.length ? _cwSayPlace('In {country}:', row[1]) + ' ' + hits.join(' · ')
                     : _cwSayPlace('Answers for {country}', row[1]);
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
  /* THE LAST ANSWER FIRST, THE FRESH ONE BEHIND IT.

     Every open of Crew waited on this request and then redrew the country's
     sections when it landed - the "lag at the beginning" the owner reported.
     The answer is remembered on this device, so the screen is drawn whole at
     once from it, the request still goes out, and the screen is touched again
     only if what came back is different. */
  let shown = '';
  try{
    const memo = load('amv_cw_local');
    if(memo && memo.cc === cc && memo.d && Date.now() - (+memo.at || 0) < 7 * 86400000){
      _cwApplyLocal(cc, memo.d); shown = JSON.stringify(memo.d);
    }
  }catch(e){ shown = ''; }
  if(!shown) _cwLocalState[cc] = 'loading';
  try{
    const d = await AMV_API.everyday(cc);
    /* The real endpoint always returns the country list. Anything without it
       did not come from the catalogue, so it is not an answer about what
       exists - it is an absence of one. */
    if(!d || !Array.isArray(d.countries)) throw new Error('no catalog');
    const same = !!shown && JSON.stringify(d) === shown;
    _cwApplyLocal(cc, d);
    try{ store('amv_cw_local', { cc, at: Date.now(), d }); }catch(e){}
    if(same) return;
  }catch(e){
    /* One reason left, now that the catalogue is public: the server could not
       be reached. Not cached as an empty list, so a connection coming back can
       still fill this in - an empty list would be a claim that the country has
       nothing, which is a different and false statement. A remembered answer
       already on screen stays: it is what the server said last time. */
    if(shown) return;
    _cwLocalState[cc] = 'offline';
  }
  _cwLocalRepaint(cc);
}
/* One country's answer, put where every Crew section reads it. */
function _cwApplyLocal(cc, d){
    if(!d || !Array.isArray(d.countries)) throw new Error('no catalog');
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
}
function _cwLocalRepaint(cc){
  /* A country's own jobs arrived: Crew's list takes them in place (the old
     country block and country page this used to redraw are gone, Nov 16). */
  try{
    if(S.tab !== 'crew') return;
    if(document.getElementById('cj-grid') && window._cjRepaint) window._cjRepaint(); else _cwRepaintSoon();
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
                              .concat(_cwBrowse && _cwBrowse !== cc ? (_cwMadeForJobs(_cwBrowse) || []).concat(_cwMadeMore(_cwBrowse) || []).filter(j => !have.has(j.id)) : [])
                              /* The country catalogue's jobs (country-catalog.js),
                                 once its file has arrived - real named services. */
                              .concat(((window._ccCrewJobs || {})[cc] || []).filter(j => !have.has(j.id))); }
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
/* THE CATEGORIES CREW AND TASKS ARE ORGANIZED BY (Nov 15) - one set, so a
   bank is under Money on both screens. */
const CJ_CATS = ['Money', 'Inbox & calendar', 'Work & career', 'Shopping', 'Travel', 'Government & paperwork',
                 'Health', 'Learning', 'News', 'Going out', 'Home & life', 'Family & kids', 'Growing a business', 'Making things'];
/* The country catalogue's kinds, in the categories a person looks under. */
const CJ_KIND_CAT = {
  bank:'Money', insurer:'Money', utility:'Home & life', telecom:'Home & life', isp:'Home & life', carmaker:'Home & life',
  university:'Learning', college:'Learning', school:'Learning', library:'Learning', research:'Learning', publisher:'Learning',
  newspaper:'News', newssite:'News', tv:'News', radio:'News',
  airline:'Travel', airport:'Travel', rail:'Travel', bus:'Travel', hotel:'Travel',
  retail:'Shopping', supermarket:'Shopping', ecommerce:'Shopping', restaurant:'Shopping', mall:'Shopping',
  agency:'Government & paperwork', ministry:'Government & paperwork', embassy:'Government & paperwork', union:'Government & paperwork',
  hospital:'Health', pharma:'Health',
  employer:'Work & career', jobsite:'Work & career', company:'Work & career', software:'Work & career', nonprofit:'Work & career',
  museum:'Going out', theatre:'Going out', stadium:'Going out', sportsclub:'Going out', park:'Going out', zoo:'Going out', festival:'Going out', brewery:'Going out',
};
/* The older category names, folded into the same set. */
const CJ_OLD_CAT = { 'Watching the world':'News' };
function _cjCat(j){
  if(j && j.ccKind && CJ_KIND_CAT[j.ccKind]) return CJ_KIND_CAT[j.ccKind];
  const c = (j && j.cat) || '';
  return CJ_OLD_CAT[c] || (CJ_CATS.indexOf(c) >= 0 ? c : 'Home & life');
}
try{ window._cjCat = _cjCat; }catch(e){}
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
/* WHOSE CHOICE IT IS, READ AGAIN WHEN THAT CHANGES (Nov 22).

   The choice was read once, when the script started. Whoever was known then
   decided which saved choice was read - so a page that started before the
   account was (returning from a Google sign-in, a session still being
   restored) read the guest's empty slot, guessed from the network, and
   showed another country than the one picked. And a country picked before
   signing in was filed under the guest and lost at sign-in. Now the choice
   is read for whoever is signed in at the moment it is asked for; a guest's
   pick is carried into the account that signs in when that account has none
   of its own. */
let _cwCountryWho = (()=>{ try{ return _scopeKey(''); }catch(e){ return ''; } })();
function _cwCountrySync(){
  let who = ''; try{ who = _scopeKey(''); }catch(e){ return; }
  if(who === _cwCountryWho) return;
  _cwCountryWho = who;
  let v = ''; try{ v = loadStr('amv_cw_country') || ''; }catch(e){}
  if(!v && who !== 'u:guest|'){
    try{ const g = localStorage.getItem('u:guest|amv_cw_country') || ''; if(g && g !== '-'){ v = g; saveStr('amv_cw_country', g); } }catch(e){}
  }
  if(v !== _cwCountry){ _cwCountry = v; _cwShowcaseCache = null; }
}
function _cwCountryGuess(){
  _cwCountrySync();
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
    if(S.tab === 'crew' && document.getElementById('cj-grid') && window._cjRepaint){ window._cjRepaint(); return; }
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
/* A COUNTRY IS NAMED IN THE READER'S LANGUAGE. "Not in United States?" was
   English twice over in Spanish: the sentence and the name. The browser
   already knows every region's name in every language it ships
   (Intl.DisplayNames), so the name comes from there and the sentence is one
   whole template with a {country} slot - prepositions and word order are the
   language's own. English keeps "the United States", as it always read. */
function _cwPlaceName(name){
  const code = _lang();
  if(code === 'en' || code === 'auto') return name;
  try{
    const row = CW_WORLD_COUNTRIES.find(c => c[1] === name);
    const n = row && new Intl.DisplayNames([code], { type:'region' }).of(row[0]);
    if(n && n !== row[0]) return n;
  }catch(e){}
  return name;
}
function _cwSayPlace(tpl, name, english){
  const code = _lang(), en = code === 'en' || code === 'auto';
  return T(tpl).replace('{country}', () => en ? (english == null ? name : english) : _cwPlaceName(name));
}
try{ window._cwPlaceName=_cwPlaceName; window._cwSayPlace=_cwSayPlace; }catch(e){}
function _cwForYouRepaint(){
  _cwGuessDrawn = _cwCountryGuess();
  if(S.tab !== 'crew') return;
  try{ _cwLoadLocal(_cwGuessDrawn); }catch(e){}
  if(document.getElementById('cj-grid') && window._cjRepaint) window._cjRepaint(); else _cwRepaintSoon();
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
/* The pick, saved. Clearing the showcase is not optional: it is cached for
   the country it was ranked for, and without this the hundred under the new
   country's name would have been the old country's hundred. */
function _cwSetCountry(cc){
  _cwCountrySync();
  _cwCountry = String(cc || '').toUpperCase();
  try{ saveStr('amv_cw_country', _cwCountry); }catch(e){}
  _cwShowcaseCache = null;
  try{ _cwLoadLocal(_cwCountry); }catch(e){}
}
try{
     window._cwAskWhere = _cwAskWhere; }catch(e){}

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
    ? `<div class="int-more cw-cat-more"><button class="int-seemore" data-dact="cwCatAll" data-darg="${escH(c)}" aria-label="${escH(_seeAllLabel(false, n, c))}">${escH(T('See all {0}').replace('{0}', n))}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div>`
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
