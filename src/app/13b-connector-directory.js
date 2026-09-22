/* ══════════════════════════════════════════════════════════════════════════
   THE CONNECTOR DIRECTORY.

   Asked for, most recently: search bar, then the connectors AMV has built by
   hand, then a door per topic with about a hundred behind each. Like a plugin
   store, and nothing else in between.

   WHAT THIS PAGE USED TO DO, because the change is a deletion and deletions
   need their reason written down. Twenty-six topic rows, each firing its own
   registry request as it painted, each answer replacing the whole section -
   so arriving here meant a hundred and thirty skeletons filling in over
   several seconds, the rate limit refusing some of the rows (which read as
   those topics being broken), and the search box being destroyed and rebuilt
   under anybody typing into it. The owner's words were "remove the things
   below the search bar entirely" and "the search bar is very laggy".

   The rows are gone. A topic is a heading and a way in, nothing is fetched
   until somebody picks one, and the page paints once with no network at all.

   Nine thousand of them are real and none of them are written down here. The
   Worker reads the official MCP registry - twenty thousand registered servers,
   9,451 of which ship a package AMV's own bridge can start - filters it to
   exactly those, and hands back a command that runs. Every tile on this screen
   is therefore a thing that connects; an entry AMV could not start is not
   shown, because the only promise a directory makes is that pressing Connect
   starts something.

   Why not a list in the page: a hand-written thousand would be a thousand
   guesses, each correct on the day it was typed and rotting from then on, and
   the first dead `npx -y @somebody/thing` is the moment somebody stops
   believing the rest of the screen. It would also cost about 150KB on a page
   with a weight ceiling, to ship a snapshot that is wrong by the next release.

   A CATEGORY IS A SEARCH, NOT A TAXONOMY. The registry publishes no
   categories, so inventing one per server would mean guessing nine thousand
   times. Each door runs a real query and its page shows what genuinely comes
   back, which is why a topic can be short and why an empty one says so rather
   than hiding.
   ══════════════════════════════════════════════════════════════════════════ */

/* The rows, in reading order. The query is what the row really asks the
   registry, and the two are kept side by side so nobody can rename a row into
   a claim its query does not support. */
const CDIR_CATS = [
  ['dev',      'Developer tools',        'developer'],
  ['data',     'Data & analytics',       'database'],
  ['comm',     'Communication',          'messaging'],
  ['prod',     'Productivity',           'productivity'],
  ['biz',      'Business & operations',  'crm'],
  ['cloud',    'Cloud & infrastructure', 'cloud'],
  ['finance',  'Finance',                'finance'],
  ['commerce', 'Commerce & payments',    'ecommerce'],
  ['edu',      'Education & research',   'research'],
  ['create',   'Creativity & design',    'design'],
  ['market',   'Marketing',              'marketing'],
  ['maps',     'Maps & location',        'maps'],
  ['travel',   'Travel',                 'travel'],
  ['health',   'Health',                 'health'],
  ['security', 'Security',               'security'],
  /* Each is a REAL query against the registry like the others - none of them
     is a heading with a hand-written list behind it - so a row here can come
     back short or empty, and that is the honest answer rather than a padded
     one. */
  ['files',    'Files & storage',        'storage'],
  ['email',    'Email',                  'email'],
  ['calendar', 'Calendar & scheduling',  'calendar'],
  ['support',  'Customer support',       'support'],
  ['auto',     'Automation',             'automation'],
  /* THE LAST TEN TAKE IT TO THIRTY, and the constraint on adding one is not
     taste. A category here is a word sent to the registry, so a heading is
     only allowed if that word finds things - "Project management" reads well
     and returns almost nothing, while "monitoring" is an ugly heading and
     returns plenty. Where the two disagreed the query won and the heading was
     written around it. */
  ['ai',       'AI & models',            'ai'],
  ['monitor',  'Monitoring & logs',      'monitoring'],
  ['media',    'Video & media',          'media'],
  ['music',    'Music & audio',          'music'],
  ['social',   'Social networks',        'social'],
  ['news',     'News & feeds',           'news'],
  ['legal',    'Legal & contracts',      'legal'],
  ['hr',       'People & HR',            'hr'],
  ['iot',      'Devices & IoT',          'iot'],
  ['testing',  'Testing & QA',           'testing'],
];
/* TOPICS THE HAND-BUILT SECTIONS ABOVE ALREADY COVER.

   The page listed "Developer" and then "Developer tools", and "Productivity"
   twice - one heading from AMV's own integrations and one from the registry,
   next to each other, asking somebody to work out the difference. There is
   none worth explaining: the curated section already carries a door that runs
   exactly this query.

   So the registry row is dropped where a curated section owns the topic. It
   is a list of QUERIES rather than titles, because the query is what would
   actually be duplicated - two headings running the same search is the defect,
   and two different headings that happen to read similarly is not. */
/* `finance` joins them: there is a hand-built Bank & money section now, with
   AMV's own bank link in it and a door running exactly this query. */
const CDIR_COVERED = ['developer', 'productivity', 'messaging', 'email', 'finance'];
/* The default `want` for a load nobody sized. Nothing asks for a handful any
   more - the rows that did are gone - so this is a floor rather than a
   layout, and it is small because the only caller that would hit it is one
   that forgot to say. */
const CDIR_ROW_N = 5;
/* ABOUT A HUNDRED BEHIND EACH DOOR, IN TWO ROUND TRIPS RATHER THAN ONE BIG ONE.

   "See all xyz connectors ... with like 100 each."

   The server answers at most fifty (`MCPREG_MAX`), and that ceiling is not a
   number to raise for a copy decision: one request there can cause six reads
   of somebody else's registry and the route needs no account, which is the
   combination worth hammering. So the page asks twice - fifty, then fifty
   more as soon as the first lands - and `Load more` carries on from there.
   Two requests from one person browsing is nothing; a fifty-to-a-hundred
   change in what a stranger can pull per request is not. */
const CDIR_PAGE_N = 50;
const CDIR_PAGE_TARGET = 100;

/* query -> { state, servers, cursor, err }. One entry per query rather than per
   row, so a row and the full page behind it share the fetch instead of asking
   the same question twice. */
const _cdir = {};
/* Which page is showing: '' is the overview, anything else is the full
   directory for that query. Held rather than derived because the back control
   has to have somewhere to go back TO. */
let _cdirOpen = null;           // { q, title } or null
let _cdirFind = '';

/* Asked rather than read, because the view that needs to know lives in another
   module and a top-level `let` in this bundle is a script binding, not a
   property of window - reading `window._cdirOpen` from there would be
   `undefined` with no error either way, which the gate has a whole stage for. */
function _cdirOpenNow(){ return !!_cdirOpen; }
/* Leaving the tab closes the page. Without this, opening Finance, going to
   Chat and coming back to Connectors landed on Finance again - a screen
   somebody left a quarter of an hour ago, presented as where they are now. */
function _cdirReset(){ _cdirOpen = null; }
function _cdirKey(q){ return String(q || '').toLowerCase(); }
function _cdirGet(q){ return _cdir[_cdirKey(q)] || { state:'idle', servers:[], cursor:'', err:'' }; }

/* WHAT HAS ALREADY BEEN ASKED, AND UNDER WHAT CONDITIONS.

   Measured in the first-session suite before this existed: opening Connectors
   made FORTY-FIVE requests to /v1/connectors. Fifteen rows each ask on render;
   each answer repaints the whole view; each repaint schedules fifteen more
   asks, and the ones whose state had not yet settled went out again. It is the
   same shape as the runaway `_cwLocalTried` fixed in Crew - a render that asks,
   an answer that re-renders, and nothing recording that the question was
   already put.

   The key is the SITUATION rather than a flat "asked", because the one thing
   that would make asking again sensible - a backend becoming reachable - is
   what it records. `want` is in it too: a row asked for ten and the full page
   asks for thirty-six, and that is a different question about the same word. */
const _cdirTried = {};
function _cdirCtx(){ return (window.AMV_API && AMV_API.live) ? '1' : '0'; }

/* ── THIRTY ROWS ASKING AT ONCE IS HOW ROWS COME BACK BROKEN ────────────────

   Two of them reported "This could not be loaded" on a screen where the rest
   were fine, which reads as those categories being broken. They were not. The
   route is rate limited per IP - deliberately, because it needs no account and
   one request there causes up to six reads of somebody else's server - and
   thirty simultaneous asks from one browser is exactly the shape that limit
   exists to refuse. The product was tripping its own guard.

   It got worse with every category added, which is why it appeared at twenty
   and would have been unmissable at thirty.

   Four at a time. The rest queue and go out as slots free, so the page fills
   progressively instead of arriving all at once and being turned away. */
const _cdirQ = [];
let _cdirRunning = 0;
const CDIR_PARALLEL = 4;
function _cdirPump(){
  while(_cdirRunning < CDIR_PARALLEL && _cdirQ.length){
    const job = _cdirQ.shift();
    _cdirRunning++;
    job().catch(() => {}).then(() => { _cdirRunning--; _cdirPump(); });
  }
}

/* A REFUSAL IS NOT A VERDICT ON THE CATEGORY.

   `state:'error'` was final - nothing retried it, so a row refused once by the
   rate limit stayed broken for the whole visit unless somebody found the Try
   again link. A transient refusal and a category that genuinely has nothing
   are different facts, and only one of them should be permanent.

   One automatic retry, after a pause, and only once: a second failure is
   reported rather than hidden behind a loop that never settles. */
const _cdirRetried = {};

async function _cdirLoad(q, want){
  const k = _cdirKey(q);
  const cur = _cdir[k] || { state:'idle', servers:[], cursor:'', err:'' };
  if(cur.state === 'loading') return;
  /* Already has enough for what is being asked for. A row wants ten and the
     full page wants thirty-six, so "enough" depends on the caller. */
  if(cur.state === 'done' && cur.servers.length >= (want || CDIR_ROW_N)) return;
  if(cur.state === 'error' || cur.state === 'off') return;
  const tk = k + '|' + (want || CDIR_ROW_N) + '|' + _cdirCtx();
  if(_cdirTried[tk]) return;
  _cdirTried[tk] = 1;
  return new Promise((resolve) => {
    _cdirQ.push(() => _cdirFetch(q, want, tk).then(resolve, resolve));
    _cdirPump();
  });
}

async function _cdirFetch(q, want, tk){
  const k = _cdirKey(q);
  const cur = _cdir[k] || { state:'idle', servers:[], cursor:'', err:'' };
  if(!(window.AMV_API && AMV_API.live && AMV_API.connectors)){
    _cdir[k] = { state:'off', servers:[], cursor:'', err:'' }; _cdirPaint(); return;
  }
  _cdir[k] = { ...cur, state:'loading' };
  try{
    const d = await AMV_API.connectors(q, cur.cursor || '', want || CDIR_ROW_N);
    const got = Array.isArray(d && d.servers) ? d.servers : [];
    const seen = new Set(cur.servers.map(s => s.id));
    _cdir[k] = { state:'done',
                 servers: cur.servers.concat(got.filter(s => s && !seen.has(s.id))),
                 cursor: (d && d.cursor) || '', err:'' };
  }catch(e){
    /* Named. An unreachable directory and an empty one are different facts,
       and showing the second when the first is true tells somebody this
       product connects to nothing. */
    _cdir[k] = { state:'error', servers:cur.servers, cursor:cur.cursor,
                 err:String((e && e.message) || '').slice(0, 140) };
    /* Once. A rate limit clears in seconds and a dead registry does not, so
       one retry separates them without turning a real outage into a loop. */
    if(!_cdirRetried[tk]){
      _cdirRetried[tk] = 1;
      setTimeout(() => {
        const st = _cdir[k];
        if(!st || st.state !== 'error') return;
        _cdir[k] = { ...st, state:'idle' };
        delete _cdirTried[tk];
        _cdirLoad(q, want);
      }, 1200);
    }
  }
  _cdirPaint();
}
/* ONE REPAINT FOR HOWEVER MANY ANSWERS ARRIVE TOGETHER.

   Fifteen rows answering within a few hundred milliseconds of each other used
   to be fifteen full re-renders of the page, and the page is what schedules the
   asking - so each repaint was also a fresh round of questions. Coalesced into
   one frame: the answers that have landed are drawn together and the ones still
   in flight redraw on the next tick. */
let _cdirPaintT = 0;
function _cdirPaint(){
  if(_cdirPaintT) return;
  _cdirPaintT = setTimeout(() => {
    _cdirPaintT = 0;
    try{
      if(S.tab !== 'integrations') return;
      /* ONLY THE DIRECTORY, NOT THE WHOLE PAGE.

         This called renderIntegrationsView, which rebuilds everything on the
         screen - the connected accounts, the machine panel, the whole native
         catalogue - and it ran once per wave of category answers. Measured:
         EIGHT full rebuilds of the page while the directory fills.

         That is the lag, and it is also why Connected accounts appeared to
         change its text every second: it was being torn down and written
         again eight times, relative timestamps and all, for news that had
         nothing to do with it.

         The directory knows which part of the page is its own. Swapping that
         one node leaves everything else alone - including anything somebody
         was in the middle of reading or typing into. */
      const cur = document.querySelector('.cdir');
      if(cur && typeof connectorDirectoryHTML === 'function'){
        const box = document.createElement('div');
        box.innerHTML = connectorDirectoryHTML();
        const next = box.firstElementChild;
        /* NO RE-WIRING HERE ANY MORE. The search box used to live inside this
           node, so a swap destroyed its listeners and they had to be put back.
           It lives outside now - which is the whole point - and calling
           `_cdirWireFind` from here would attach a SECOND Enter handler to the
           surviving input on every repaint, so one press would run the search
           twice, then three times, then four. */
        if(next){ cur.replaceWith(next); return; }
      }
      if(typeof renderIntegrationsView === 'function') renderIntegrationsView();
    }catch(e){}
  }, 60);
}
/* The one listener inside the directory that is not delegated - Enter in the
   search box. Re-attached after a swap, because the node it was on is gone. */
function _cdirWireFind(){
  try{
    const f = $('cdir-find');
    if(!f) return;
    on(f, 'keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); cdirSearch(); } });
    /* WHAT WAS TYPED, NOT WHAT WAS LAST SUBMITTED.

       `_cdirFind` used to be written only by `cdirSearch`, and the input's
       value is rendered from it - so any re-render put back the last SEARCHED
       term and threw away whatever was half-typed. The box now lives outside
       the node the directory repaints, which is the real fix, but this screen
       is re-rendered for other reasons too (a connection added, the bridge
       connecting, a language switch) and losing somebody's half-typed query
       to any of them is the same defect wearing a different hat. */
    on(f, 'input', () => { try{ _cdirFind = String(f.value || ''); }catch(_e){} });
  }catch(e){}
}
try{ window._cdirWireFind = _cdirWireFind; }catch(e){}

/* ── A CONNECTOR AS A TILE ──────────────────────────────────────────────────
   Deliberately not a card with a border and a button row. The owner's word for
   the old screen was blocky, and the thing that makes a directory read as a
   directory rather than a stack of panels is that the entries are quiet and
   the page is the object. */
/* THE LOGO, AND WHY THE FALLBACK IS ONE LISTENER ON THE DOCUMENT.

   The mark is rendered first and the picture sits over it, so an entry with
   no avatar shows the letter. The first version relied on a failed <img>
   painting nothing, which is wrong: Chrome draws its broken-image glyph on
   any img that has a size, so every non-GitHub entry got a torn-page icon
   over its mark - worse than the mark alone, and it was visible in the very
   first screenshot.

   An `onerror=` attribute is refused by this page's CSP. A listener per tile
   would have to be re-wired on every repaint, of which this screen has many.
   So there is ONE listener, on the document, in the CAPTURE phase - error
   events do not bubble but they do capture - and it hides whatever failed.
   It is attached once and survives every repaint, because the thing it is
   attached to is never re-rendered.

   `loading="lazy"` because thirty rows is a hundred and fifty tiles and only
   a few are on screen. `decoding="async"` so a slow decode never holds up the
   row it is in. */
let _cdirLogoWired = false;
function _cdirWireLogoFallback(){
  if(_cdirLogoWired) return;
  _cdirLogoWired = true;
  try{
    document.addEventListener('error', (e) => {
      const t = e && e.target;
      if(t && t.classList && t.classList.contains('cdir-logo')) t.style.display = 'none';
    }, true);
  }catch(e){}
}
function _cdirLogoHTML(s){
  _cdirWireLogoFallback();
  const base = (window.AMV_API && AMV_API.base) ? String(AMV_API.base).replace(/\/+$/, '') : '';
  if(!base) return '';
  /* THROUGH safeMediaSrc, LIKE EVERY OTHER src IN THIS BUNDLE.

     The address is built here from AMV's own base and an encoded id, so it is
     not attacker-controlled - and that is exactly the reasoning that gets a
     rule like this quietly eroded. `links-cannot-execute` does not ask whether
     a particular author was careful; it asks whether anything reaches an
     attribute without passing the allowlist, because the next line somebody
     adds beside this one will be copied from it. `AMV_API.base` is also not a
     constant: it is read from storage, which is the part that makes this worth
     more than a comment. */
  const src = safeMediaSrc(base + '/v1/connector-logo?id=' + encodeURIComponent(s.id));
  if(!src) return '';
  return '<img class="cdir-logo" alt="" aria-hidden="true" loading="lazy" decoding="async"'
    + ' src="' + escH(src) + '">';
}

function _cdirTile(s){
  const need = (s.env || []).filter(e => e && e.required);
  const mark = (s.name || '?').trim().charAt(0).toUpperCase() || '?';
  return '<button class="cdir-tile" data-dact="cdirOpen" data-darg="' + escH(s.id) + '">'
    + '<span class="cdir-ic" aria-hidden="true">' + escH(mark) + _cdirLogoHTML(s) + '</span>'
    + '<span class="cdir-body">'
      + '<span class="cdir-name">' + escH(s.name) + '</span>'
      + '<span class="cdir-desc">' + escH(s.desc || 'No description was published for this one.') + '</span>'
      + (need.length
          ? '<span class="cdir-need">Needs ' + escH(need.map(e => e.name).slice(0, 2).join(', ')) + '</span>'
          : '')
    + '</span>'
  + '</button>';
}

/* ── THE SEARCH BOX, AND WHY IT IS NOT IN THIS SECTION ANY MORE ─────────────

   "The search bar is very laggy so make sure that works."

   It was not lag. The input was rendered INSIDE `.cdir`, and `_cdirPaint`
   replaces that whole node every time a wave of registry answers lands - so
   the element somebody was typing into was destroyed and rebuilt underneath
   them, repeatedly, for the first several seconds of the page. Its `value`
   came from `_cdirFind`, which is only written when a search is SUBMITTED, so
   each rebuild reset the box to the last searched term and dropped whatever
   had been typed since. The caret went to the end of whatever was left.

   That is not a slow search box, it is a search box fighting the person using
   it, and no amount of debouncing would have touched it. Two changes, and the
   first is the one that matters:

     1. IT LIVES OUTSIDE `.cdir` NOW, at the top of the page, which is also
        where it was asked to be. Nothing the directory repaints can reach it.
     2. `_cdirFind` tracks every keystroke, so a repaint of the WHOLE page -
        which other things can still cause - restores what was typed rather
        than the last thing submitted.

   Rendered by the view rather than by this function, because a node this one
   does not own is a node it cannot accidentally replace. */
function cdirSearchBarHTML(){
  return '<div class="cdir-find-wrap">'
    + '<input id="cdir-find" class="cw-find" type="search" autocomplete="off" value="' + escH(_cdirFind) + '"'
      + ' placeholder="' + escH(T('Search every connector - slack, postgres, stripe, figma…')) + '">'
    + '<button class="btn bs cdir-find-go" data-dact="cdirSearch">' + escH(T('Search')) + '</button>'
  + '</div>';
}

function connectorDirectoryHTML(){
  if(_cdirOpen) return _cdirFullHTML();
  /* ── A DOOR PER TOPIC, AND NOT TWENTY-SIX LIVE ROWS ───────────────────────

     "Remove the things below the search bar entirely. None of the thing that
     it says now."

     What was there: twenty-six sections, each firing its own registry request
     on paint, each answer replacing the whole node, so the page arrived as
     a hundred and thirty skeletons that filled in over several seconds while
     the search box was destroyed and rebuilt under whoever was typing into
     it. It also read as a wall - two hundred tiles before anybody had decided
     anything - and the rate limit refused some of the rows outright, which
     looked like those topics being broken.

     What is there now: the topic, and the way in. Nothing is fetched until
     somebody picks one, so the page paints once, immediately, with no network
     at all - and the See all page behind each door holds far more than a
     scrolling row ever did.

     THE CURATED SECTIONS KEEP THEIR OWN DOORS. `CDIR_COVERED` still drops a
     topic AMV has hand-built rows for, because those sections already end in
     a See all running the same query - two doors to one search is the defect
     this list exists to prevent. */
  const doors = CDIR_CATS.filter(c => CDIR_COVERED.indexOf(c[2]) < 0);
  return '<section class="cdir">'
    + '<div class="sec-head"><h3>' + escH(T('Everything else, by topic')) + '</h3>'
      + '<span class="sec-sub">' + escH(T('Thousands more, read live from the open registry. Each one runs on the computer you connect, and AMV drives it.')) + '</span></div>'
    + '<div class="cdir-topics">'
      + doors.map(c => '<button class="cdir-topic" data-dact="cdirAll" data-darg="' + escH(c[2]) + '">'
          + '<span class="cdir-topic-t">' + escH(c[1]) + '</span>'
          + '<span class="cdir-topic-a" aria-hidden="true">' + escH(T('See all')) + ' →</span>'
        + '</button>').join('')
    + '</div>'
  + '</section>';
}

function _cdirFullHTML(){
  const q = _cdirOpen.q;
  const st = _cdirGet(q);
  /* FIFTY, THEN FIFTY MORE. The second ask fires once the first has landed
     and only while the registry still has a cursor to carry on from - so a
     topic with thirty entries makes one request and says that is everything,
     rather than asking again for a page it has already been told does not
     exist. See CDIR_PAGE_TARGET for why this is two trips and not one. */
  const _second = () => {
    const s = _cdirGet(q);
    if(s.state === 'done' && s.cursor && s.servers.length < CDIR_PAGE_TARGET)
      _cdirLoad(q, CDIR_PAGE_TARGET);
  };
  try{
    setTimeout(() => {
      /* Chained, not called in the same tick: `_cdirLoad` queues behind a
         parallelism gate, so reading the state straight after it would read
         the state before the answer. It also returns early - already loading,
         already enough, already asked - and in those cases the `then` runs
         immediately and `_second` correctly does nothing, because the repaint
         that follows the real answer brings us back through here. */
      Promise.resolve(_cdirLoad(q, CDIR_PAGE_N)).then(_second, () => {});
    }, 0);
  }catch(e){}
  let body;
  if(st.state === 'off')
    body = '<p class="cdir-note">' + escH(T('The directory is read from AMV’s servers, and this copy is not connected to one.')) + '</p>';
  else if(st.state === 'error' && !st.servers.length)
    body = '<p class="cdir-note">' + escH(T('The directory could not be reached')) + (st.err ? ' (' + escH(st.err) + ')' : '')
         + '. <button class="mc-sec-link" data-dact="cdirRetry" data-darg="' + escH(q) + '">' + escH(T('Try again')) + '</button></p>';
  /* `idle` COUNTS AS LOADING, AND LEAVING IT OUT WAS A REAL DEFECT.

     A question that has not been asked yet has no answer, and the branch below
     says "nothing in the directory matches that" - so a topic page rendered
     before its first request had gone out told somebody the registry has
     nothing for Email, a moment before filling with email connectors.

     It was unreachable while the overview carried rows: by the time anybody
     pressed See more, the row had already fetched and the state was `done`.
     Removing the rows made the topic page the first thing that asks, so
     `idle` became the state it opens in, and the wrong sentence became the
     first thing on the screen. The row renderer that was deleted had this
     right - `st.state === 'idle' || (st.state === 'loading' && ...)` - and
     the full page never did.

     Found by a suite watching for that sentence while a topic page opened. */
  else if(!st.servers.length && (st.state === 'loading' || st.state === 'idle'))
    body = '<div class="cdir-grid" aria-busy="true">'
         + new Array(9).fill('<span class="cdir-skel skl"></span>').join('') + '</div>';
  else if(!st.servers.length)
    body = '<p class="cdir-note">' + escH(T('Nothing in the directory matches that. The registry is searched by name and description, so a shorter word usually finds more.')) + '</p>';
  else
    body = '<div class="cdir-grid cdir-grid-full">' + st.servers.map(_cdirTile).join('') + '</div>'
      + (st.cursor
          ? '<div class="cdir-more-row"><button class="btn bs" data-dact="cdirMore" data-darg="' + escH(q) + '">'
            + (st.state === 'loading' ? escH(T('Loading…')) : escH(T('Load more')))
            + '</button></div>'
          : '<p class="cdir-end">' + escH(T('That is everything the registry has for this.')) + '</p>');

  return '<section class="cdir cdir-full">'
    + '<button class="cdir-back" data-dact="cdirBack">← ' + escH(T('All categories')) + '</button>'
    + '<div class="sec-head"><h3>' + escH(_cdirOpen.title) + '</h3>'
      + '<span class="sec-sub">' + escH(T('Every one of these runs on your own computer through the bridge, and AMV drives it.')) + '</span></div>'
    + body
  + '</section>';
}

/* ── WHAT HAPPENS WHEN SOMEBODY PICKS ONE ───────────────────────────────────

   The detail panel, and it is where the honesty of this screen is decided. It
   names the exact command that will run, the machine it will run on, and every
   environment variable the publisher declared - because a connector is a
   PROGRAM SOMEBODY ELSE WROTE and AMV is about to start it on this person's
   computer. Consent for that has to be informed or it is not consent.

   Adding it does not run it: it goes into the connector list beside the
   bridge, where starting it is a separate, visible act. */
function cdirOpen(id){
  let s = null;
  for(const k in _cdir){ const f = (_cdir[k].servers || []).find(x => x.id === id); if(f){ s = f; break; } }
  const r = $('ovr'); if(!s || !r) return;
  const cmd = (s.command + ' ' + (s.args || []).join(' ')).trim();
  const bridged = !!(typeof BRIDGE !== 'undefined' && BRIDGE.connected);
  const env = s.env || [];
  const fact = (k, v, cls) => '<div class="cwp-fact' + (cls ? ' ' + cls : '') + '"><dt>' + escH(k) + '</dt><dd>' + v + '</dd></div>';
  r.innerHTML =
    '<div class="ov" id="cdir-bg"><div class="cwp" role="dialog" aria-modal="true" aria-labelledby="cdir-t">'+
      '<button class="cwp-x" id="cdir-x" aria-label="Close">✕</button>'+
      '<div class="cwp-scroll">'+
        '<div class="cwp-head"><span class="cwp-ic cdir-ic-lg" aria-hidden="true">'+escH((s.name||'?').charAt(0).toUpperCase())+_cdirLogoHTML(s)+'</span>'+
          '<h2 class="cwp-t" id="cdir-t">'+escH(s.name)+'</h2></div>'+
        '<p class="cwp-desc">'+escH(s.desc || 'No description was published for this one.')+'</p>'+
        '<dl class="cwp-facts">'+
          fact('Published as', '<code class="cdir-code">'+escH(s.id)+(s.version?' · '+escH(s.version):'')+'</code>')+
          fact('AMV will run', '<code class="cdir-code">'+escH(cmd)+'</code>')+
          fact('Where', bridged
            ? 'On the computer you have connected, through the bridge.'
            : '<span class="bill-unknown">Nowhere yet - a connector is a program, so it needs a computer connected above.</span>',
            bridged ? '' : 'warn')+
          (env.length
            ? fact('It asks for', env.map(e =>
                '<span class="cdir-env"><b>'+escH(e.name)+'</b>'+(e.required?' <span class="cdir-req">required</span>':'')+
                (e.desc?'<span class="cdir-env-d">'+escH(e.desc)+'</span>':'')+'</span>').join(''))
            : fact('It asks for', 'Nothing. It needs no credential to start.'))+
        '</dl>'+
        /* ONE LINE. The paragraph that was here said four true things and was
           asked about with "what is this?", which is what a wall of warning
           gets: it is read as boilerplate and skipped, so it protected nobody.

           Everything it spelled out is already ON this panel as facts - what
           AMV will run, where it runs, what it asks for - stated once each,
           where somebody looking for them will find them. What is left is the
           single thing those facts do not say: AMV did not write this.

           The real control was never this text. It is the per-call consent in
           chat, which cannot be skipped by not reading. */
        '<p class="cdir-warn">' + escH(T('AMV didn’t write this one. It runs on your connected computer with the access shown above.')) + '</p>'+
      '</div>'+
      '<div class="cwp-act">'+
        '<button class="btn bs" id="cdir-cancel">Close</button>'+
        '<button class="btn bp" id="cdir-add">Add this connector</button>'+
      '</div>'+
    '</div></div>';
  r.classList.add('on');
  onBackdrop($('cdir-bg'), closeOvr);
  on($('cdir-x'), 'click', closeOvr);
  on($('cdir-cancel'), 'click', closeOvr);
  on($('cdir-add'), 'click', () => {
    /* The existing add path, with its own name, duplicate and credential
       rules. Nothing here reimplements them: a second copy of the rule that
       refuses a token in an argument is a second copy that can disagree. */
    try{
      const short = (s.id.split('/').pop() || s.name || 'connector');
      _mcpAdd(short, s.command, s.args || [], null);
      closeOvr();
      toast('Added. Start it from Connectors, and put any credential in its environment box - it stays in this tab.', 'success', 7000);
      renderIntegrationsView();
    }catch(e){
      toast(String((e && e.message) || 'That could not be added.'), 'error', 7000);
    }
  });
}
function cdirAll(q){
  const row = CDIR_CATS.find(c => c[2] === q);
  _cdirOpen = { q, title: row ? row[1] : ('Connectors matching “' + q + '”') };
  renderIntegrationsView();
  _cdirToTop();
}
/* OPENING A PAGE PUTS YOU AT THE TOP OF IT, and coming back does too.

   See more is pressed from the BOTTOM of a row, a long way down a screen with
   thirty of them, and the page that replaced it inherited that scroll
   position - so the thing somebody just asked to see opened somewhere in its
   own middle. Going back had the same problem in reverse.

   Both containers and the window, because which one scrolls depends on the
   width: the view scrolls inside `.sv` on a desktop and the document itself
   scrolls on a phone, and setting only one of them fixes only one of those. */
function _cdirToTop(){
  /* FIRST, forget where the previous page was. The view keeps a remembered
     scroll position per tab and a mutation observer puts it back on every
     repaint - which is right for a repaint and wrong here, because this is a
     different page inside the same tab. Without this the two fight and the
     observer wins, which is exactly what it looked like. */
  try{ if(typeof _vcForgetScroll === 'function') _vcForgetScroll(); }catch(e){}
  const top = () => {
    try{ const sv = document.querySelector('#vc .sv'); if(sv) sv.scrollTop = 0; }catch(e){}
    try{ const vc = $('vc'); if(vc) vc.scrollTop = 0; }catch(e){}
    try{ window.scrollTo(0, 0); }catch(e){}
  };
  top();
}
function cdirBack(){ _cdirOpen = null; renderIntegrationsView(); _cdirToTop(); }
function cdirRetry(q){
  const k = _cdirKey(q);
  _cdir[k] = { state:'idle', servers:[], cursor:'', err:'' };
  /* Try again has to mean try again: every record of having asked this is
     cleared, or the button would repaint a screen and ask nothing. */
  Object.keys(_cdirTried).forEach(t => { if(t.indexOf(k + '|') === 0) delete _cdirTried[t]; });
  /* Including the record of having already auto-retried, or a row refused
     twice could never be retried a third time by hand. */
  Object.keys(_cdirRetried).forEach(t => { if(t.indexOf(k + '|') === 0) delete _cdirRetried[t]; });
  _cdirPaint();
}
function cdirMore(q){ _cdirLoad(q, CDIR_PAGE_N); _cdirPaint(); }
function cdirSearch(){
  const el = $('cdir-find');
  const q = el ? String(el.value || '').trim() : '';
  _cdirFind = q;
  if(!q){ _cdirOpen = null; renderIntegrationsView(); return; }
  cdirAll(q);
}
try{ window._cdirOpenNow=_cdirOpenNow; window._cdirReset=_cdirReset; window.cdirOpen=cdirOpen; window.cdirAll=cdirAll; window.cdirBack=cdirBack;
     window.cdirRetry=cdirRetry; window.cdirMore=cdirMore; window.cdirSearch=cdirSearch;
     window.connectorDirectoryHTML=connectorDirectoryHTML; window.cdirSearchBarHTML=cdirSearchBarHTML;
     window.CDIR_CATS=CDIR_CATS; window.CDIR_COVERED=CDIR_COVERED; }catch(e){}
