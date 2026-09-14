/* ══════════════════════════════════════════════════════════════════════════
   THE CONNECTOR DIRECTORY.

   Asked for: far more things AMV can connect to, from everywhere, ten of each
   category on the screen and a full page of a thousand behind a See more.

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
   times. Each row runs a real query and shows what genuinely comes back, which
   is why a row can be short and why an empty one says so rather than hiding.
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
];
const CDIR_ROW_N = 10;          // per row on the overview, as asked for
const CDIR_PAGE_N = 36;         // per page on the full directory

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

async function _cdirLoad(q, want){
  const k = _cdirKey(q);
  const cur = _cdir[k] || { state:'idle', servers:[], cursor:'', err:'' };
  if(cur.state === 'loading') return;
  /* Already has enough for what is being asked for. A row wants ten and the
     full page wants thirty-six, so "enough" depends on the caller. */
  if(cur.state === 'done' && cur.servers.length >= (want || CDIR_ROW_N)) return;
  if(cur.state === 'error' || cur.state === 'off') return;
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
  }
  _cdirPaint();
}
function _cdirPaint(){
  try{ if(S.tab === 'integrations' && typeof renderIntegrationsView === 'function') renderIntegrationsView(); }catch(e){}
}

/* ── A CONNECTOR AS A TILE ──────────────────────────────────────────────────
   Deliberately not a card with a border and a button row. The owner's word for
   the old screen was blocky, and the thing that makes a directory read as a
   directory rather than a stack of panels is that the entries are quiet and
   the page is the object. */
function _cdirTile(s){
  const need = (s.env || []).filter(e => e && e.required);
  const mark = (s.name || '?').trim().charAt(0).toUpperCase() || '?';
  return '<button class="cdir-tile" data-dact="cdirOpen" data-darg="' + escH(s.id) + '">'
    + '<span class="cdir-ic" aria-hidden="true">' + escH(mark) + '</span>'
    + '<span class="cdir-body">'
      + '<span class="cdir-name">' + escH(s.name) + '</span>'
      + '<span class="cdir-desc">' + escH(s.desc || 'No description was published for this one.') + '</span>'
      + (need.length
          ? '<span class="cdir-need">Needs ' + escH(need.map(e => e.name).slice(0, 2).join(', ')) + '</span>'
          : '')
    + '</span>'
  + '</button>';
}

function _cdirRowHTML(cat){
  const [key, title, q] = cat;
  const st = _cdirGet(q);
  try{ setTimeout(() => _cdirLoad(q, CDIR_ROW_N), 0); }catch(e){}
  let body;
  if(st.state === 'off')
    body = '<p class="cdir-note">' + escH(T('The directory is read from AMV’s servers, and this copy is not connected to one.')) + '</p>';
  else if(st.state === 'error')
    body = '<p class="cdir-note">' + escH(T('This could not be loaded')) + (st.err ? ' (' + escH(st.err) + ')' : '')
         + '. <button class="mc-sec-link" data-dact="cdirRetry" data-darg="' + escH(q) + '">' + escH(T('Try again')) + '</button></p>';
  else if(st.state === 'idle' || (st.state === 'loading' && !st.servers.length))
    body = '<div class="cdir-grid" aria-busy="true">'
         + new Array(4).fill('<span class="cdir-skel skl"></span>').join('') + '</div>';
  else if(!st.servers.length)
    body = '<p class="cdir-note">' + escH(T('Nothing in the directory matches this yet.')) + '</p>';
  else
    body = '<div class="cdir-grid">' + st.servers.slice(0, CDIR_ROW_N).map(_cdirTile).join('') + '</div>';

  return '<section class="cdir-row" data-cdir-row="' + escH(key) + '">'
    + '<div class="cdir-row-h">'
      + '<h3>' + escH(title) + '</h3>'
      + '<button class="cdir-more" data-dact="cdirAll" data-darg="' + escH(q) + '">'
        + escH(T('See all')) + ' →</button>'
    + '</div>'
    + body
  + '</section>';
}

/* The overview: every row, ten each. */
function connectorDirectoryHTML(){
  if(_cdirOpen) return _cdirFullHTML();
  return '<section class="cdir">'
    + '<div class="sec-head"><h3>' + escH(T('Everything AMV can connect to')) + '</h3>'
      + '<span class="sec-sub">' + escH(T('Read live from the open connector registry and filtered to the ones AMV can actually start on your computer - so everything here runs. Ten of each below; search or open a category for the rest.')) + '</span></div>'
    + '<div class="cdir-find-wrap">'
      + '<input id="cdir-find" class="cw-find" type="search" autocomplete="off" value="' + escH(_cdirFind) + '"'
        + ' placeholder="' + escH(T('Search every connector - slack, postgres, stripe, figma…')) + '">'
      + '<button class="btn bs cdir-find-go" data-dact="cdirSearch">' + escH(T('Search')) + '</button>'
    + '</div>'
    + CDIR_CATS.map(_cdirRowHTML).join('')
  + '</section>';
}

function _cdirFullHTML(){
  const q = _cdirOpen.q;
  const st = _cdirGet(q);
  try{ setTimeout(() => _cdirLoad(q, CDIR_PAGE_N), 0); }catch(e){}
  let body;
  if(st.state === 'off')
    body = '<p class="cdir-note">' + escH(T('The directory is read from AMV’s servers, and this copy is not connected to one.')) + '</p>';
  else if(st.state === 'error' && !st.servers.length)
    body = '<p class="cdir-note">' + escH(T('The directory could not be reached')) + (st.err ? ' (' + escH(st.err) + ')' : '')
         + '. <button class="mc-sec-link" data-dact="cdirRetry" data-darg="' + escH(q) + '">' + escH(T('Try again')) + '</button></p>';
  else if(!st.servers.length && st.state === 'loading')
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
        '<div class="cwp-head"><span class="cwp-ic cdir-ic-lg" aria-hidden="true">'+escH((s.name||'?').charAt(0).toUpperCase())+'</span>'+
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
        '<p class="cdir-warn"><b>This is somebody else’s program.</b> AMV did not write it and does not vouch for it. '+
          'It will run on your computer with your files and your network, and anything you put in its environment box '+
          'is handed to it. Read what it is before you start it - the name above is the real package.</p>'+
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
  try{ const sv = document.querySelector('#vc .sv'); if(sv) sv.scrollTop = 0; }catch(e){}
}
function cdirBack(){ _cdirOpen = null; renderIntegrationsView(); }
function cdirRetry(q){ _cdir[_cdirKey(q)] = { state:'idle', servers:[], cursor:'', err:'' }; _cdirPaint(); }
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
     window.connectorDirectoryHTML=connectorDirectoryHTML; window.CDIR_CATS=CDIR_CATS; }catch(e){}
