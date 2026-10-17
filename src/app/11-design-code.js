/* ============================================================
   AMV DESIGN  - visual canvas: generate & iterate UI / graphics
   ============================================================ */
/* ── AMV-D007, STEP 2: ONE DOOR INTO THE THREE BUILD SURFACES ─────────────

   Studio, Dev and Lab are three sidebar destinations that split the same job by
   how the thing is built rather than by what somebody wants. The merge into one
   Build surface happens in steps, and this is the seam: every route into any of
   the three now passes through one function.

   Nothing a person can see changes in this step, on purpose. The three tabs
   still exist, the sidebar still lists them, and each still renders exactly what
   it rendered before - the guard for that is
   tests/e2e/the-build-surfaces-keep-every-control, which knows all 279 controls
   and has to keep passing at every step.

   What it buys is that the next steps have one place to change instead of three,
   and that studio/dev/lab keep working as route names permanently rather than
   as a migration that has to be finished before the deep links stop resolving.
   setTab('dev') has callers in five other modules; none of them should ever need
   to know this became one screen. */
/* ── AMV-D007, STEP 3: ONE TOOLBAR, NOT TWO THAT DRIFTED ──────────────────

   Dev and Lab each carried their own toolbar, and they had drifted the way two
   copies of anything drift. The same job wore different icons: Dev put a
   PAPERCLIP on "add existing code" and Lab an upload tray on "upload code
   files". New session was the only glyph the two agreed on. Deploy existed in
   both and was written twice. The model picker, the same.

   One definition now, parameterised by mode. It deliberately emits the SAME ids
   each surface already wires - #dev-new, #lab-new and the rest - so not one
   event handler moves in this step. The ids collapse into shared ones only in
   step 6, when the surfaces genuinely become one and the wiring moves with
   them. Doing both at once would mean a markup change and a rewiring landing
   together, with no way to say which broke something.

   The guard is tests/e2e/the-build-surfaces-keep-every-control: 279 controls
   and 46 operable ids, all of which must survive. */
const _BUILD_ICO = {
  add:    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  fresh:  '<path d="M12 5v14M5 12h14"/>',
  save:   '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  deploy: '<path d="M13 2 3 14h8l-1 8 10-12h-8z"/>',
  run:    '<polygon points="5 3 19 12 5 21 5 3"/>',
  debug:  '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/>',
  agents: '<path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/>',
  tolab:  '<path d="M10 2h4M12 2v6.5L7 19a1 1 0 0 0 .9 1.5h8.2A1 1 0 0 0 17 19l-5-10.5"/>',
};
function _bico(k, size){
  const n = size || 15;
  return '<svg width="'+n+'" height="'+n+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="'+(n<15?2:1.8)+'" stroke-linecap="round" stroke-linejoin="round">'+(_BUILD_ICO[k]||'')+'</svg>';
}
/* An icon-only control needs BOTH a title and an aria-label: the title is the
   mouse's tooltip and the label is the only name a screen reader ever hears.
   Several of these carried one and not the other. */
function _bIcoBtn(id, label, icon, extra){
  return '<button class="dev-ico" id="'+id+'" title="'+escH(label)+'" aria-label="'+escH(label)+'"'
    + (extra||'') + '>'+_bico(icon)+'</button>';
}
/* STUDIO WAS THE ONLY BUILD SURFACE YOU COULD NOT CHOOSE AN ENGINE ON.

   Every Studio generation and every refine is sent with _sectionModel('design').
   That reads amv_secmodel_design, and until this bar existed NOTHING in the
   product ever wrote it - _sectionModelSelect was called for 'code' and for
   'debug' and for nothing else. So the design engine was pinned to its default
   forever, on the one surface of three where a person could not change it. The
   setting was wired at the read end and unreachable at the write end.

   "New session" was missing the same way. Studio is a SESSION_KINDS entry and
   _sessNew('studio') has always worked, but no caller ever passed 'studio' -
   so designs accumulated in one project with no way to start a clean one, while
   Dev and Lab each had the button.

   Both now sit where the other two surfaces already keep them. That is the
   AMV-D007 "one control, one place" win on this surface; merging the three
   render functions is not (they share exactly one line of code between them,
   every piece of shared chrome having already been extracted into the helpers
   above, so folding them together would produce one larger function with the
   same three branches).

   The markup class stays `dev-bar` for design mode rather than gaining a
   `studio-bar` twin. It is the standard build bar, badly named; a third class
   would mean copying its responsive rules a third time, which is the
   duplication this work exists to remove. */
function _buildBarHTML(mode, showHome, fresh){
  const isLab = mode === 'lab';
  const isDesign = mode === 'design';
  const badge = isLab ? 'Lab' : isDesign ? 'Studio' : 'Dev';
  const left = isLab
    ? '<select id="lab-lang" class="lab-lang-sel" aria-label="Language">'
        + '<option value="js">JavaScript</option><option value="python">Python</option>'
        + '<option value="html">HTML</option></select>'
        + _sectionModelSelect('debug','lab-model')
        + '<span class="lab-count" id="lab-count"></span>'
        + '<span class="sec-usage-note" id="lab-usage-note"></span>'
    : isDesign
    ? _sectionModelSelect('design','studio-model')
        + '<span class="sec-usage-note" id="studio-usage-note"></span>'
    : '<span class="sec-usage-note" id="dev-usage-note"></span>';

  /* The right-hand side, in one order for both surfaces: bring work in, start
     over, then the actions that operate on what is loaded. Dev's paperclip is
     gone - the tray is what Lab already used and what the same job should look
     like on both. */
  const right = isDesign
    ? _bIcoBtn('studio-new','Start a new Studio project','fresh')
    : isLab
    ? _bIcoBtn('lab-upload-top','Upload code files','add')
      + _bIcoBtn('lab-new','New session','fresh')
      + _bIcoBtn('lab-agents','Run agents on this code','agents')
      + '<button class="lab-run-btn" id="lab-run">'+_bico('run',13)+'Run</button>'
      + _bIcoBtn('lab-deploy','Publish this page to a live URL','deploy')
      + '<button class="lab-fix-btn" id="lab-debug">'+_bico('debug',13)+'Auto-Debug</button>'
    /* THE ATTACH BUTTON AND THE ENGINE PICKER MOVED TO THE COMPOSER.

       Both are decisions about the MESSAGE being sent, and both were sitting
       in the bar that describes the whole surface - so "which engine writes
       this" was two feet away from the box you type it in, and the paperclip
       was next to "New session". What is left here is what it says on the
       tin: what to do with the surface, not with this turn. Dev's file
       inputs moved with the button that opens them. */
    : _bIcoBtn('dev-tolab','Debug in Lab','tolab')
      + _bIcoBtn('dev-save','Save to your folder','save',' style="display:none"')
      + _bIcoBtn('dev-new','New session','fresh');

  /* THE WAY OUT SITS IN THE BAR, NOT ON A ROW OF ITS OWN.

     Measured on all three, blank and working. Dev and Lab each spent a whole
     header band on one button - "All builds", alone, above the toolbar - so a
     working Dev screen had THREE different header heights down one page: the
     back row at 76px, the DEV row at 128px, and the preview pane's own row at
     81px. Nothing lined up with anything.

     Studio was worse in the other direction. Its way out was
     `<button class="btn">← Studio home</button>`, first in a stack of EIGHT
     pills of identical weight - Add a design, Apply change, History, Download
     this, Export project - so the control that leaves the project looked
     exactly like the control that downloads it, and read as neither.

     One control now, in one place, with one label, on all three: first item in
     this bar, which is the top-left of the surface. `Build` rather than "All
     builds" or "Studio home" because that is the name of the place it goes
     and the name in the sidebar. */
  /* NOTHING TO START OVER FROM, SO NO BUTTON THAT STARTS OVER.

     The New-session control sat next to the mode switcher on a screen that IS a
     new session - pressing it cleared empty state and said "New Dev session".
     The owner called it pointless, and they are right; it was noticed here
     earlier and kept anyway, for a consistency that was not worth having.

     `fresh` rather than "blank" because they are not the same on Studio: the
     entry page shows while a project's designs are still held, and there the
     button really does start a new one. Hidden exactly when it can do nothing,
     which is a fact about the state rather than about the screen. */
  const cls = isLab ? 'lab-bar' : 'dev-bar';
  return '<div class="'+cls+' build-bar'+(fresh ? ' build-bar-fresh' : '')+'">'
    + '<div class="'+cls+'-l">'
      + _buildHomeBtnHTML(showHome)
      + '<span class="dev-badge">'+badge+'</span>'+left
    + '</div>'
    + '<div class="'+cls+'-r">'+right+'</div>'
  + '</div>';
}
try{ window._buildBarHTML = _buildBarHTML; }catch(e){}

/* ── AMV-D007, STEP 4: ONE PLACE TO START, CHOSEN BY OUTCOME ──────────────

   Three sidebar destinations split this work by how the thing gets built. A
   person who wants a landing page can get one from Studio as a design or from
   Dev as a running app, and nothing on either screen tells them which they
   want. That is the finding.

   So the entry screen asks the question the person actually has - what do you
   want to end up with - and picks the surface from the answer. Design it, build
   it, or work on code you already have.

   Explicitly, with three visible choices, and NOT by reading the composer and
   guessing. Intent classification here would need a model call, which means it
   could not work without a key, and "type anything and we will figure out which
   tool" is precisely the kind of thing that works in a demo and strands
   somebody on the wrong surface in real use. The choice is one click and it is
   never wrong.

   Each mode keeps its own composer and its own starting points, with the same
   ids they already had, so no wiring moves. What is new is that all three are
   reachable from wherever you are, instead of requiring you to have guessed
   right in the sidebar. */
/* ── AMV-D007, STEP 5: ONE VIEWPORT SWITCHER ─────────────────────────────
   Studio could check a design at tablet and phone width. Dev could not - so
   somebody building a responsive landing page in Dev had no way to see it
   narrow, while the same job in Studio did. Same product, same question, and
   the answer depended on which of the two surfaces you happened to be on.

   One component and one handler, used by both. It takes the frame it drives as
   an argument rather than reaching for a fixed id, because that is the only
   difference between the two uses. */
const _BUILD_VIEWPORTS = [['desktop','\uD83D\uDDA5\uFE0F','Desktop'],['tablet','\uD83D\uDCF1','Tablet'],['phone','\uD83D\uDCF2','Phone']];
function _vpSwitchHTML(id){
  return '<div class="studio-vp" id="'+id+'" role="group" aria-label="Preview width">'
    + _BUILD_VIEWPORTS.map(([vp,ic,label],i) =>
        '<button class="studio-vp-b'+(i===0?' on':'')+'" data-vp="'+vp+'"'
        + ' title="'+label+'" aria-label="Preview at '+label.toLowerCase()+' width">'+ic+'</button>').join('')
  + '</div>';
}
/* ONE BAR ABOVE EVERY RESULT (AMV-D007 step 5).

   Three surfaces show you a result and three bars sat above it, built three
   ways. Measured rather than remembered:

     Dev     tabs Preview|Code, then viewport, download, deploy, open external.
             Status on the right.
     Lab     the word "Output" and a status. Nothing else.
     Studio  three fake window dots and a title, then viewport. Its code toggle
             was a BUTTON IN THE SIDE PANEL and its status was down there too,
             in a different pane from the stage both describe.

   What is shared is the BAR, not the tabs. Dev has Preview|Code because Dev
   writes the code and must show you both; Lab's code is already on screen in
   the editor beside the output, so giving Lab that tab would hand it a control
   that shows it what it is already looking at. A left slot that takes either
   tabs or a title, a right slot that takes actions and a status, and each
   surface fills what it actually has.

   Two things move as a result, and both are visible to a person: Studio's code
   toggle joins the bar as a tab where Dev keeps its, and Studio's status moves
   next to the stage it is describing. Both keep their ids, so the step-1
   inventory proves the control still exists and still reaches the same
   function rather than being told a new one appeared. */
function _resultBarHTML(o){
  o = o || {};
  const left = (o.tabs && o.tabs.length)
    ? '<div class="rb-tabs" role="tablist">' + o.tabs.map((t, i) =>
        '<button class="rb-tab' + (i === 0 ? ' on' : '') + '" id="' + t.id + '"'
        + ' data-rb="' + t.key + '" type="button" role="tab"'
        + ' aria-selected="' + (i === 0 ? 'true' : 'false') + '">' + escH(t.label) + '</button>').join('')
      + '</div>'
    : '<span class="rb-title"' + (o.titleId ? ' id="' + o.titleId + '"' : '') + '>' + escH(o.title || '') + '</span>';
  /* aria-live so a status that appears while somebody is reading the result is
     announced rather than only drawn. */
  const status = '<span class="rb-status"' + (o.statusId ? ' id="' + o.statusId + '"' : '')
    + ' role="status" aria-live="polite"></span>';
  return '<div class="rb"' + (o.id ? ' id="' + o.id + '"' : '') + '>' + left
    + '<div class="rb-acts">' + status + (o.actions || '') + '</div></div>';
}
/* The tab behaviour, once. `onPick` gets the key and does the surface-specific
   part; selection state and aria are handled here so they cannot drift apart -
   Dev's old toggle set a class and never touched aria at all. */
function _wireResultTabs(barId, onPick){
  const root = document.getElementById(barId); if(!root) return;
  const tabs = [...root.querySelectorAll('[data-rb]')];
  tabs.forEach(b => on(b, 'click', () => {
    tabs.forEach(x => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); });
    b.classList.add('on'); b.setAttribute('aria-selected', 'true');
    try{ onPick(b.dataset.rb); }catch(e){}
  }));
}
try{ window._resultBarHTML=_resultBarHTML; window._wireResultTabs=_wireResultTabs; }catch(e){}

/* `frameFinder` is a function, not an element: Dev replaces its iframe every
   time it renders a result, so an element captured at wiring time would be
   stale by the first build. Studio keeps one frame and does not care. */
function _wireVpSwitch(id, frameFinder){
  const root = document.getElementById(id); if(!root) return;
  root.querySelectorAll('.studio-vp-b').forEach(b => on(b, 'click', () => {
    root.querySelectorAll('.studio-vp-b').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const f = frameFinder(); if(!f) return;
    const vp = b.dataset.vp;
    /* THE FLEX BASIS THAT ATE THE WIDTH.

       Setting width alone did nothing on Studio, and had never worked: the
       inline style was applied correctly - phone really did set width:390px -
       and the frame stayed 890px, because `.studio-frame` carries `flex:1`.
       That is `flex-basis:0` with `flex-grow:1`, and in a flex row the basis
       decides the main size, so `width` is simply not consulted. The buttons
       highlighted, the transition ran on nothing, and the preview never moved.

       Verified as pre-existing by rebuilding the previous commit and watching
       the same thing happen there, rather than assuming I had caused it.

       So the item has to stop growing before a width means anything. Desktop
       puts `flex:1` back, because there the frame SHOULD fill the pane. */
    const fixed = vp !== 'desktop';
    f.style.flex   = fixed ? '0 0 auto' : '1';
    f.style.width  = vp === 'phone' ? '390px' : vp === 'tablet' ? '768px' : '100%';
    f.style.maxWidth = fixed ? '100%' : '';
    f.style.margin = vp === 'desktop' ? '0' : '0 auto';
  }));
}
try{ window._vpSwitchHTML=_vpSwitchHTML; window._wireVpSwitch=_wireVpSwitch; }catch(e){}

const _BUILD_MODE_TABS = [
  ['studio', 'Design it',   'Landing pages, screens, posters - on a live canvas'],
  ['dev',    'Build an app','Real software, written and running in a sandbox'],
  ['lab',    'Work on code','Run, debug, review or refactor code you already have'],
];
/* THREE DESCRIPTIONS COMPETING, WHEN ONLY ONE IS THE CURRENT ANSWER.

   Each option carried its own hint inside its own box, so the row was three
   titles and three sentences - about sixty words to make one choice, and three
   blocks of equal weight, which is most of what made this screen read as
   blocky. Constrained to the composer's measure the row could not even hold
   them: it wrapped 2 + 1 and left an orphan.

   The hint moves out and below, for the SELECTED option only. The row becomes
   three short segments that fit on one line, and the guidance is still there -
   one sentence, about the thing you have actually picked. The full text stays
   on each button's `title`, so hovering an option you have not chosen still
   tells you what it is. */
function _buildModeSwitchHTML(active){
  const cur = _BUILD_MODE_TABS.find(([tab]) => tab === active);
  return '<div class="build-modes" role="tablist" aria-label="What do you want to end up with?">'
    + _BUILD_MODE_TABS.map(([tab, label, hint]) =>
        '<button class="build-mode' + (tab === active ? ' on' : '') + '"'
        + ' role="tab" aria-selected="' + (tab === active ? 'true' : 'false') + '"'
        + ' data-bmode="' + tab + '" title="' + escH(hint) + '">'
        + '<span class="build-mode-t">' + escH(label) + '</span>'
      + '</button>').join('')
  + '</div>'
  + (cur ? '<p class="build-mode-note">' + escH(cur[2]) + '</p>' : '');
}
/* THE BUILDS YOU ALREADY MADE, ON THE PAGE WHERE YOU LOOK FOR THEM.

   Sessions have been saved per kind since Build existed, and the only place
   they were listed was the sidebar history, mixed in with chats and sorted by
   time - so finding last night's project meant recognising its auto-generated
   title among the day's conversations. On the surface that made them, they did
   not appear at all.

   One list for all three modes rather than one per mode: "past builds" is how
   somebody thinks about them, and _sessResume already navigates to whichever
   tab a session belongs to, so opening a design from the Dev home lands in
   Studio without this needing to know that. The badge says which is which.

   Empty means nothing rather than an empty box - a first visit should be the
   hero and a composer, not a heading over nothing. */
/* DRAGGING THE EDGE OF THE PREVIEW.

   The split was flex:1 against flex:1.5 - a fixed 40/60 that suited neither
   somebody reading a long answer nor somebody watching a wide layout render.
   The pane sizes are now a percentage the person sets, and it is remembered.

   Stored as a DEVICE setting rather than an account one: how wide a pane
   should be is a fact about the screen in front of you, and the same person on
   a laptop and a phone wants different answers. LESSONS 335 is the version of
   this that was got wrong the other way round.

   Below 760px the panes stack and only one is shown at a time, so there is
   nothing to divide - the divider hides itself there rather than becoming a
   control that moves something invisible.

   Pointer events rather than mouse: one code path covers a trackpad, a touch
   screen and a pen, and setPointerCapture keeps the drag alive when the cursor
   outruns the divider, which is most drags. */
const DEV_SPLIT_KEY = 'amv_dev_split';
const DEV_SPLIT_DEFAULT = 60;    // matches the flex:1 / flex:1.5 it replaces
const DEV_SPLIT_MIN = 22, DEV_SPLIT_MAX = 82;
function _splitClamp(v){
  const n = Math.round(Number(v));
  if(!isFinite(n)) return DEV_SPLIT_DEFAULT;
  return Math.min(DEV_SPLIT_MAX, Math.max(DEV_SPLIT_MIN, n));
}
function _splitGet(){
  let v = DEV_SPLIT_DEFAULT;
  try{ const raw = loadStr(DEV_SPLIT_KEY); if(raw) v = parseFloat(raw); }catch(e){}
  return _splitClamp(v);
}
function _splitApply(shellId, pct){
  const shell = $(shellId); if(!shell) return;
  shell.style.setProperty('--dev-split', _splitClamp(pct) + '%');
  const bar = shell.querySelector('[role="separator"]');
  if(bar) bar.setAttribute('aria-valuenow', String(_splitClamp(pct)));
}
function _splitSave(pct){ try{ saveStr(DEV_SPLIT_KEY, String(_splitClamp(pct))); }catch(e){} }
function _wireSplit(barId, shellId){
  const bar = $(barId), shell = $(shellId);
  if(!bar || !shell) return;
  bar.setAttribute('aria-valuemin', String(DEV_SPLIT_MIN));
  bar.setAttribute('aria-valuemax', String(DEV_SPLIT_MAX));
  _splitApply(shellId, _splitGet());

  /* The preview is the RIGHT pane, so its share is measured from the right
     edge - dragging left makes it bigger, which is the direction somebody
     expects when they grab the divider and pull. */
  const pctFor = (clientX) => {
    const r = shell.getBoundingClientRect();
    if(!r.width) return _splitGet();
    return _splitClamp(((r.right - clientX) / r.width) * 100);
  };
  let dragging = false;
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    bar.classList.add('on');
    try{ bar.setPointerCapture(e.pointerId); }catch(_){}
    e.preventDefault();          // or the drag selects the text either side
  });
  bar.addEventListener('pointermove', (e) => {
    if(!dragging) return;
    _splitApply(shellId, pctFor(e.clientX));
  });
  const end = (e) => {
    if(!dragging) return;
    dragging = false;
    bar.classList.remove('on');
    try{ bar.releasePointerCapture(e.pointerId); }catch(_){}
    /* Written once at the end rather than on every move: a drag is one
       decision, not two hundred. */
    const cur = getComputedStyle(shell).getPropertyValue('--dev-split');
    _splitSave(parseFloat(cur));
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);

  /* A divider that only responds to dragging is one that somebody who cannot
     drag cannot use at all. */
  bar.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 2;
    let v = _splitGet(), handled = true;
    if(e.key === 'ArrowLeft') v += step;          // left = more preview
    else if(e.key === 'ArrowRight') v -= step;
    else if(e.key === 'Home') v = DEV_SPLIT_MAX;
    else if(e.key === 'End') v = DEV_SPLIT_MIN;
    else if(e.key === 'Enter' || e.key === ' ') v = DEV_SPLIT_DEFAULT;
    else handled = false;
    if(!handled) return;
    e.preventDefault();
    _splitApply(shellId, v); _splitSave(v);
  });
  bar.addEventListener('dblclick', () => {
    _splitApply(shellId, DEV_SPLIT_DEFAULT); _splitSave(DEV_SPLIT_DEFAULT);
  });
}
try{ window._wireSplit=_wireSplit; window._splitGet=_splitGet; window.DEV_SPLIT_KEY=DEV_SPLIT_KEY;
     window.DEV_SPLIT_DEFAULT=DEV_SPLIT_DEFAULT; window.DEV_SPLIT_MIN=DEV_SPLIT_MIN;
     window.DEV_SPLIT_MAX=DEV_SPLIT_MAX; }catch(e){}

const BUILD_RECENTS_MAX = 8;
/* ONE SECTION'S OWN WORK, AT THE BOTTOM OF THAT SECTION.

   This used to list all three kinds together, badged, on the argument that
   "past builds" is how somebody thinks of them. The owner uses it and does not:
   they asked for each section to show only its own, which is the reading that
   matches the rest of the screen - you came to Build to design something, and a
   list of half-finished code sessions under the design composer is somebody
   else's errand.

   With one kind per list the badge said the same word on every row, so it is
   gone, and the heading carries the name instead: three headings, one per
   section, rather than one generic heading and a column of repeated labels. */
const BUILD_RECENTS_H = { studio:'Your designs', dev:'Your apps', lab:'Your code' };
function _buildRecentsHTML(kind){
  let rows = [];
  try{
    rows = (Array.isArray(_SESSIONS) ? _SESSIONS : [])
      .filter(s => s && SESSION_KINDS[s.kind] && (!kind || s.kind === kind))
      .slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .slice(0, BUILD_RECENTS_MAX);
  }catch(e){ rows = []; }
  /* Nothing rather than an empty heading: a first visit should be the thing you
     came to do, not a title over a blank space. */
  if(!rows.length) return '';
  return '<section class="bld-recents"><h3 class="bld-recents-h">'
      + escH(BUILD_RECENTS_H[kind] || 'Pick up where you left off') + '</h3>'
    + '<div class="bld-recents-list">'
    + rows.map(s =>
        '<button class="bld-recent" data-bsess="' + escH(s.id) + '">'
        + '<span class="bld-recent-t">' + escH(s.title || 'Untitled') + '</span>'
        + '<span class="bld-recent-w">' + escH(_agoLabel(s.updated)) + '</span>'
      + '</button>').join('')
    + '</div></section>';
}
/* Relative rather than a date: "3 minutes ago" is what somebody needs to tell
   two of their own projects apart, and a timestamp is not. */
function _agoLabel(ts){
  const t = +ts || 0; if(!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if(s < 60) return 'just now';
  const m = Math.round(s / 60); if(m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.round(m / 60); if(h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24); if(d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
  try{ return new Date(t).toLocaleDateString(undefined, { month:'short', day:'numeric' }); }catch(e){ return ''; }
}
function _wireBuildRecents(root){
  (root || document).querySelectorAll('[data-bsess]').forEach(b =>
    on(b, 'click', () => { try{ _sessResume(b.dataset.bsess); }catch(e){} }));
}
/* Leaving the build you are in, without ending it. The work stays saved and
   listed; this is the way back to the page that lists it, which is what makes
   "open another one" possible at all. Studio has had this as `atHome` since it
   was built - Dev never did, so the only way out of a project was to start a
   new one, which is a different thing entirely. */
function _buildHomeBtnHTML(show){
  if(!show) return '';
  return '<button class="bld-home" id="bld-home" title="Back to Build">'
    + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>'
    + 'Build</button>';
}
try{ window._buildRecentsHTML=_buildRecentsHTML; window._wireBuildRecents=_wireBuildRecents; window._agoLabel=_agoLabel; }catch(e){}

/* The header is the shared .pghd from AMV-D070 rather than a fourth bespoke
   one - that duplication is what AMV-D013 is about, and this is the surface
   that would otherwise have added to it.

   THE SUB-LINE IS GONE, AND IT WAS SAYING THE SAME THING TWICE.

   Since A172 moved the per-option hints out of the three buttons, the note
   under the switcher is the sentence that describes the mode you are on. The
   sub-line above the switcher described the same mode, in more words, one line
   earlier - so every entry explained itself twice with the choice sandwiched
   in between, and did it at three different lengths: three sentences on
   Studio, one on Dev, one and a half on Lab.

   A178 had already hidden it on a phone, where 106px of chrome before the
   choice was the difference between seeing the composer and not. Removing it
   outright is the same judgement applied at every width, and it leaves the
   head reading in one direction: what do you want, pick one, here is what that
   one does. The one fact the sub-line carried that the note does not - that
   Lab takes files of any size - moved into the drop zone, which is where
   somebody is standing when they need to know it. */
function _buildEntryHeadHTML(active, title){
  return '<header class="pghd build-head"><div class="pghd-l">'
      + '<span class="eyebrow">Build</span>'
      + '<h2>' + escH(title) + '</h2>'
    + '</div></header>'
    + _buildModeSwitchHTML(active);
}
/* One handler for the three, wired once per render. Switching mode is just
   setTab, so every existing route, deep link and session behaviour applies
   unchanged - this adds a way to get there, it does not add a second way of
   getting there that has to be kept in step. */
function _wireBuildModes(root){
  (root || document).querySelectorAll('[data-bmode]').forEach(b =>
    on(b, 'click', () => { try{ setBuildMode(BUILD_SURFACES[b.dataset.bmode] || b.dataset.bmode); }catch(e){} }));
}
try{ window._buildModeSwitchHTML = _buildModeSwitchHTML; window._wireBuildModes = _wireBuildModes; }catch(e){}

/* ONE TAB, THREE SECTIONS INSIDE IT.

   The sidebar used to carry Studio, Dev and Lab as three entries that all
   opened the same surface, which is three names for one place - and asked
   somebody to know the difference between them before they had seen any of
   it. It is one "Build" entry now, and the three are sections you pick once
   you are inside, which is where the difference is visible.

   The old tab names still work. A deep link, a saved session or an old
   handoff naming `studio` lands on Build in the design section rather than
   404-ing, so nothing that used to point somewhere stops pointing there. */
const BUILD_SURFACES = { studio: 'design', dev: 'code', lab: 'lab' };
const BUILD_MODE_TAB = { design: 'studio', code: 'dev', lab: 'lab' };
function _buildMode(){
  if(S.tab === 'build') return S.buildMode || 'code';
  return BUILD_SURFACES[S.tab] || S.buildMode || 'code';
}
/* Picking a section stays ON Build rather than navigating to one of the old
   tabs - otherwise the sidebar would stop showing Build as the place you are,
   which is the whole point of there being one entry. */
function setBuildMode(mode){
  const m = BUILD_MODE_TAB[mode] ? mode : (BUILD_SURFACES[mode] || 'code');
  try{ S.buildMode = m; }catch(e){}
  if(S.tab !== 'build'){ setTab('build'); return; }
  try{ renderBuildView(); }catch(e){}
  try{ _sessTouch(BUILD_MODE_TAB[m] || 'dev'); }catch(e){}
}
try{ window.setBuildMode = setBuildMode; window.BUILD_MODE_TAB = BUILD_MODE_TAB; }catch(e){}
function renderBuildView(){
  /* Arriving by an old tab name selects that section and settles on Build, so
     the sidebar shows where you are and a second click on a section does not
     bounce you back out to a tab that is no longer in the nav. */
  try{
    if(S.tab !== 'build' && BUILD_SURFACES[S.tab]){ S.buildMode = BUILD_SURFACES[S.tab]; S.tab = 'build'; }
  }catch(e){}
  const mode = _buildMode();
  /* Dispatch only. Each of these is the renderer it always was, and they are
     deliberately not touched in this step - a refactor and a redesign in one
     commit is how you lose the ability to say which one broke something. */
  if(mode === 'design') return renderDesignView();
  if(mode === 'lab') return renderLabView();
  return renderCodeView();
}
try{ window.renderBuildView = renderBuildView; window._buildMode = _buildMode; }catch(e){}

function renderDesignView(){
  const vc=$('vc'); if(!vc) return;
  /* THE DESIGNS YOU ALREADY MADE ARE STILL THERE. SHOW THEM.

     The canvas was only ever reached from _studioCreate - the moment a design
     is generated. Every other way of arriving rendered the hero, so a session
     restored with finished designs in it opened on "What should we make?" with
     the work sitting in _STUDIO.artifacts, invisible. Sessions save artifacts
     and their html on purpose, so this was throwing away something the product
     had deliberately kept.

     Same shape as the Code preview: the machinery existed, and nothing called
     it from the place a person actually arrives.

     atHome is what keeps "Studio home" meaningful. That button re-renders this
     view, so without an explicit intent the canvas would reopen immediately
     and there would be no way back to start something new. */
  /* IF IT WAS WORTH SAVING, IT IS WORTH SHOWING.

     Reported: opening a design from Recents goes back to the homepage. It did,
     and the cause was two predicates disagreeing about what a session is.

     `_sessHasContent` saves a Studio session as soon as an artifact has html OR
     A BRIEF - which is right, because somebody who described a poster and had
     the generation fail has still done work worth keeping. This branch then
     required `a.html` before it would open the canvas. So a design saved at the
     moment it was described, or one whose generation errored, resumed straight
     past its own canvas onto the hero, and the work was invisible even though
     it was listed in Recents and loaded into memory.

     It opens for an artifact that EXISTS now, and the preview says plainly when
     there is nothing rendered yet rather than the whole screen pretending the
     session was never opened. Saving and showing use the same test. */
  try{
    if(!_STUDIO.atHome){
      /* `_STUDIO.openWip` says a design with no result YET is deliberately
         open - set by _sessResume, cleared only by going home. A design being
         RESUMED opens even when nothing has been generated for it; a design
         merely sitting in memory while somebody navigates to Studio does not,
         because that screen is the starting point and should stay one.

         It is not a one-shot. The first version spent it on the first render,
         so switching to Build and back closed a design that had never been
         generated - and "it closed itself when I looked away" is a worse bug
         than the one being fixed. What ends it is the thing that means it: the
         person asking for the list. */
      const wip = !!_STUDIO.openWip;
      const a=_studioActive()
           || _STUDIO.artifacts.find(x=>x.html)
           || (wip ? _STUDIO.artifacts.find(x=>x && (x.brief || x.name)) : null);
      if(a && (a.html || wip)){
        _STUDIO.activeId=a.id;
        _studioShowCanvas(a.brief||a.name||'');
        _studioRenderPreview(a.html||'');
        if(!a.html) _studioStatus('Nothing was generated for this one yet - say what you want and AMV designs it.');
        _studioRenderArtifacts();
        return;
      }
    }
  }catch(e){}
  const starts=[
    ['\uD83D\uDDA5\uFE0F','Landing page','A hero, features and a call-to-action'],
    ['\uD83D\uDCF1','App screen','A clean mobile or web UI mockup'],
    ['\uD83C\uDFA8','Poster / graphic','Social post, banner or flyer'],
    ['\uD83E\uDDE9','Component','A single button, card or form']
  ];
  vc.innerHTML = `<div class="sv fi bld-sv"><div class="dsn-wrap">
    ${_buildEntryHeadHTML('studio','What should we make?')}
    ${_buildBarHTML('design', false, !((_STUDIO.artifacts||[]).length))}

    <section class="dsn-hero">
      <div class="dsn-input-wrap">
        <textarea id="dsn-prompt" rows="1" placeholder="A site for my small business - what we offer, opening hours, how to find us&hellip;"></textarea>
        <button class="dsn-go" data-dact="designGo" aria-label="Generate design">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>
      <div class="dsn-hint">Press generate, or pick a starting point below · every design stays editable, so keep chatting and AMV reshapes it</div>
      <div style="margin-top:22px;display:flex;align-items:center;justify-content:flex-start;gap:10px;flex-wrap:wrap">
        <button class="dna-btn" data-dact="openDNA"><span class="dna-dot"></span>Design DNA</button>
        <span class="dna-active-chip">${_DNA.colors.length} colors · ${escH(_DNA.themeFamily)} · ${escH(_DNA.theme)}</span>
      </div>
      <p class="dsn-dna-explain">Your reusable style guide - set it once and everything AMV designs follows it. Optional.</p>
      <div style="margin-top:12px;display:flex;height:22px;width:min(420px,80%);border-radius:var(--r-sm);overflow:hidden;border:1px solid var(--hair)">${_DNA.colors.map(c2=>`<span style="flex:1;background:${c2.hex}"></span>`).join('')}</div>
    </section>

    <section class="dsn-starts">
      ${starts.map(([ic,t,d],n)=>`<button class="dsn-tile${n===0?' feat':''}" data-dact="designStart" data-darg="${escH(t)}">
        <span class="dsn-tile-ic">${ic}</span>
        <span class="dsn-tile-body"><span class="dsn-tile-t">${t}</span><span class="dsn-tile-d">${escH(d)}</span></span>
      </button>`).join('')}
    </section>

    ${/* THE MARKETING BLOCK CAME OFF THIS SCREEN.

           "It's a conversation, not a form" and a glowing orb, 201px tall plus
           its margin, at the bottom of a tool's starting page. It was the
           single largest thing here after the starting points and it told
           somebody who had already opened Studio why Studio is good.

           It is the reason this entry could not sit where the other two do.
           Measured at 1280x900: the column was 1328px in an 842px viewport, so
           it pinned itself to the top and scrolled while Build and Lab were
           centred - which is the jump the owner reported as "design shifts up
           too high". Without it the column is 767px and all three behave the
           same way.

           The fact it carried is still on the screen, one line under the
           composer where somebody is actually deciding what to type. */ ''}
    ${_ownedMarketHTML('studio')}
    ${_buildRecentsHTML('studio')}
  </div></div>`;
  _wireBuildModes(vc);
  _wireBuildRecents(vc);
  /* The two controls Studio never had. Both do exactly what their Dev and Lab
     twins do, against the section this surface actually sends. */
  on($('studio-model'),'change',function(){
    _setSectionModel('design', this.value);
    toast('Design model set to '+MODELS[this.value].label,'info',2500);
  });
  on($('studio-new'),'click',()=>{
    /* SAVE BEFORE CLEARING. This called `_sessNew` - which only unbinds - and
       then emptied the working state, so everything since the last debounced
       autosave was gone: press New a moment after a change and that change is
       not in Recents and not on screen either. Lab's equivalent has flushed
       first since it was written; this one never did.

       `_sessLeave` is flush-then-unbind, and the reset uses the declared
       defaults rather than a hand-written list of fields, which is how the
       two that were added later - atHome and openWip - stay covered. */
    try{ _sessLeave('studio'); }catch(e){}
    try{ _resetToolState('studio'); }catch(e){}
    renderDesignView();
    toast('New Studio project','info',2000);
  });
  // auto-grow the hero textarea
  const ta=$('dsn-prompt');
  if(ta){ _dsnFit(ta); on(ta,'input',()=>_dsnFit(ta)); }
}
/* SIZED TO WHAT IT SHOWS, INCLUDING THE EXAMPLE.

   The box grew with what was typed and otherwise sat at a fixed minimum, which
   was set by measuring the example text at one width: two lines, so 80px. At
   390 the example is three lines and at 320 it is four, so the third was cut
   through the middle - and so was the fix before this one, for the same reason.
   A height written down for one phone is wrong on the next. Empty, the box is
   measured against its own placeholder, which is the text actually on screen. */
function _dsnFit(ta){
  if(!ta) return;
  ta.style.height='auto';
  /* scrollHeight leaves out the border and the box is border-box, so without
     this the last line is short by the border's width - 2px, enough to shave
     the descenders. */
  const edge=ta.offsetHeight-ta.clientHeight;
  if(ta.value){ ta.style.height=Math.min(ta.scrollHeight+edge,220)+'px'; return; }
  ta.value=ta.placeholder;
  const h=ta.scrollHeight;
  ta.value='';
  ta.style.height=Math.min(h+edge,220)+'px';
}
/* A rotation or a resized window rewraps the example; one listener for the
   page, finding the box each time, because the view is re-rendered and a
   listener per render would pile up. */
try{ window.addEventListener('resize',()=>{ const t=$('dsn-prompt'); if(t) _dsnFit(t); },{passive:true}); }catch(e){}

function designGo(){ const t=$('dsn-prompt'); const v=t?t.value.trim():''; if(!v){ toast('Describe what to design first','error'); return; } _studioCreate(v); }
function designStart(kind){ _studioCreate('A '+String(kind).toLowerCase()); }

/* ===== STUDIO - standalone multi-artifact design canvas (never touches chat) =====
   A Studio PROJECT holds many designs (pages, screens, slides). Each artifact
   has its own version history you can revert. Export one or the whole project
   to a real folder (File System Access) or as downloads. Real design-tool
   parity + AMV's Design DNA on top. */
const _STUDIO = { html:'', prompt:'', history:[],
  artifacts:[],        // [{id,name,type,html,history:[{brief,html,ts}]}]
  activeId:'',
  /* Somebody pressed "Studio home" and wants the hero, not the canvas they
     just left. Without it, re-rendering the view would reopen the canvas and
     that button would do nothing. */
  atHome:false,
  /* "A design with no result yet is deliberately open." Set by _sessResume,
     cleared by buildHome and by Studio home - never by a render. */
  openWip:false };
function _studioActive(){ return _STUDIO.artifacts.find(a=>a.id===_STUDIO.activeId)||null; }
function _studioNewArtifact(name, type, brief){
  const id='art_'+Date.now().toString(36)+Math.random().toString(36).slice(2,4);
  const a={ id, name:name||('Design '+(_STUDIO.artifacts.length+1)), type:type||'page', html:'', brief:brief||'', history:[] };
  _STUDIO.artifacts.push(a); _STUDIO.activeId=id;
  // Land in Recents IMMEDIATELY. This used to wait for the AI to return HTML,
  // so if generation errored - or you navigated away mid-design - the Studio
  // session was never saved and never appeared in Recents.
  try{ _sessTouch('studio'); }catch(e){}
  return a;
}
function _studioSetHTML(html, brief){
  const a=_studioActive(); if(!a) return;
  a.html=html; if(brief) a.brief=brief;
  try{ _sessTouch('studio'); }catch(e){}
  a.history.push({brief:brief||'', html, ts:Date.now()});
  if(a.history.length>30) a.history=a.history.slice(-30);
  _STUDIO.html=html; // keep legacy field in sync
}
async function _studioCreate(brief){
  _STUDIO.prompt=brief;
  // detect the kind of deliverable
  const type=/\b(slide|deck|presentation|pitch)\b/i.test(brief)?'slides':/\b(component|button|card|form|widget)\b/i.test(brief)?'component':/\b(poster|graphic|banner|flyer|social)\b/i.test(brief)?'graphic':'page';
  const name=brief.slice(0,40)+(brief.length>40?'…':'');
  _studioNewArtifact(name, type, brief);
  _studioShowCanvas(brief);
  const typeGuide = type==='slides'
    ? 'Build a self-contained HTML slide deck: each slide is a full-viewport section (100vh) with keyboard arrow navigation between slides, a subtle slide counter, and a cohesive template applied across all slides. 6-10 slides with real, convincing content.'
    : type==='component' ? 'Build a polished, self-contained component demo - the component centered on a tasteful backdrop, with real states (hover/active) and a couple of variants shown.'
    : type==='graphic' ? 'Build a single high-impact graphic/poster as a self-contained HTML page sized like a social/print asset, with striking type and composition.'
    : 'Build a complete, multi-section responsive web page - every section finished with real convincing copy, no placeholders.';
  const sys='You are AMV Design - the most talented design AI ever built. Your output must look like a $50k agency deliverable that wins design awards: a distinctive concept (never a template), confident typography with real hierarchy, a cohesive intentional palette, generous deliberate whitespace, editorial layout, tasteful micro-interactions, pixel-perfect alignment. '+typeGuide+' Output a COMPLETE self-contained HTML document (inline <style>, no external assets except Google Fonts) - fully responsive, production-quality. The DESIGN DNA below is the sole source of truth for style. Return ONLY the HTML in a single ```html code block.'+_userStyle();
  try{
    _studioStatus('Designing…');
    const resp=await aiComplete(dnaPromptBlock()+'\n\nDesign this, obeying the DESIGN DNA exactly. Make it breathtaking - award-tier, finished:\n'+brief, sys, {max_tokens:16000, model:_sectionModel('design')});
    const html=extractCode(resp,'html')||extractCode(resp)||resp;
    _studioSetHTML(html, brief);
    _studioRenderPreview(html); _studioRenderArtifacts();
    _studioStatus('');
  }catch(err){ _studioStatus(_errText(err)); }
}
async function _studioRefine(){
  const inp=$('studio-refine'); const msg=inp?inp.value.trim():''; if(!msg) return;
  const a=_studioActive(); if(!a){ toast('Create a design first','error'); return; }
  if(inp) inp.value='';
  _studioStatus('Refining…');
  const sys='You are AMV Design, an expert design AI. Apply the user\u2019s change request to the existing HTML exactly and completely - do what they asked, even if it changes the style. Keep everything they did NOT ask to change intact. Maintain high visual quality and the DESIGN DNA where it doesn\u2019t conflict with their request. Return the COMPLETE updated HTML in one ```html block only, nothing else.'+_userStyle();
  try{
    const resp=await aiComplete(dnaPromptBlock()+'\n\nCurrent design HTML:\n```html\n'+a.html+'\n```\n\nChange request: '+msg+'\n\nReturn the full updated HTML, staying true to the DESIGN DNA.', sys, {max_tokens:16000, model:_sectionModel('design')});
    const html=extractCode(resp,'html')||extractCode(resp)||resp;
    _studioSetHTML(html, msg);
    _studioRenderPreview(html); _studioRenderArtifacts(); _studioStatus('');
  }catch(err){ _studioStatus(_errText(err)); }
}
function _studioShowCanvas(brief){
  const vc=$('vc'); if(!vc) return;
  _STUDIO.atHome=false;   /* opening a design is leaving home */
  vc.innerHTML = `<div class="studio-canvas">
    <div class="studio-side">
      <div class="dev-bar build-bar studio-bar">
        <div class="dev-bar-l">${_buildHomeBtnHTML(true)}<span class="dev-badge">Studio</span></div>
      </div>
      <div class="studio-arts-h">Designs in this project</div>
      <div class="studio-arts" id="studio-arts"></div>
      <button class="btn bs studio-add" id="studio-add">+ Add a design</button>
      <div class="studio-refine-wrap">
        <textarea id="studio-refine" placeholder="Refine it… e.g. 'make it darker', 'add a pricing section'" rows="3"></textarea>
        <button class="btn bp" id="studio-refine-go">Apply change</button>
      </div>
      <div class="studio-actions">
        <button class="btn" id="studio-history">History</button>
      </div>
      <div class="studio-actions">
        <button class="btn" id="studio-download">Download this</button>
        <button class="btn" id="studio-export">Export project</button>
      </div>
    </div>
    <div class="studio-stage">
      ${_resultBarHTML({ id:'studio-rb', statusId:'studio-status',
        tabs:[{id:'studio-frame-t',key:'preview',label:'Preview'},
              {id:'studio-code',key:'code',label:'Code'}],
        /* The engine picker is here as well as on Studio home because refines
           are sent with _sectionModel('design') too, and the canvas is where
           refining happens. Dev and Lab need only one because their shell never
           leaves the screen; Studio replaces the whole view with the canvas.
           Two mount points, one setting, one helper - not two settings. */
        actions: _sectionModelSelect('design','studio-model-c') + _vpSwitchHTML('studio-vp') })}
      <div class="studio-stage-inner" id="studio-stage-inner"><iframe id="studio-frame" class="studio-frame" sandbox="allow-scripts"></iframe></div>
      <div class="studio-code-body" id="studio-code-body" style="display:none"><pre class="studio-code-pre"><code id="studio-code-text"></code></pre></div>
    </div>
  </div>`;
  /* The mobile pane toggle is mounted by setTab, and at that moment Studio is
     still showing its hero - the canvas only exists after a design has been
     created, which happens on a model call some seconds later. So the toggle
     found no `.studio-canvas` and silently did nothing. Mounted here, where the
     canvas actually comes into being. Dev and Lab do not have this problem
     because their shells exist from the first render. */
  try{ if(typeof _mountMobilePaneToggle==='function') _mountMobilePaneToggle('studio'); }catch(e){}
  on($('studio-model-c'),'change',function(){
    _setSectionModel('design', this.value);
    toast('Design model set to '+MODELS[this.value].label,'info',2500);
  });
  /* LEAVE, NOT JUST SAVE - the correction Dev and Lab already had.

     `_sessFlush` writes the project to Recents and LEAVES IT BOUND as the
     active session, and nothing cleared the working state. So the next design
     opened with the previous one's artifacts still loaded and `activeId` still
     pointing at it, and saving then wrote over the project you had just left.
     Measured before this: after pressing back, artifacts 1 and activeId 'a1'. */
  on($('bld-home'),'click',()=>{
    try{ _sessLeave('studio'); }catch(e){}
    try{ _resetToolState('studio'); }catch(e){}
    _STUDIO.atHome=true; _STUDIO.openWip=false;
    setBuildMode('design');
  });
  on($('studio-refine-go'),'click',_studioRefine);
  on($('studio-add'),'click',_studioAddPrompt);
  on($('studio-history'),'click',_studioHistory);
  /* THE BUTTON THAT DID NOTHING BEHIND A POPUP BLOCKER (AMV-D007 step 5).

     This opened a new window and wrote the markup into it. With popups blocked
     - the default in several browsers, and common on phones - window.open
     returns null, the `if(w)` skipped everything, and the button did absolutely
     nothing: no window, no toast, no error, nothing on screen. Measured both
     ways rather than assumed: popups allowed opened one tab, popups blocked
     opened none and reported nothing.

     It is also the same job Dev does with a Code tab, done a completely
     different way. So it shows the code in the surface now, where nothing can
     swallow it and where it matches the other Build surface. The button keeps
     its id and becomes a toggle. */
  /* Was a button in the side panel that renamed itself between "View code" and
     "View preview" - a toggle whose label describes where you are going while
     the tab beside it describes where you are. Two tabs say it once. */
  _wireResultTabs('studio-rb', (key)=>{
    const body=$('studio-code-body'), stage=$('studio-stage-inner');
    if(!body||!stage) return;
    const wantCode = key === 'code';
    const a=_studioActive();
    if(wantCode && !a){
      toast('Create a design first, then you can read its code.','info',3500);
      const back=$('studio-frame-t'); if(back){ back.click(); }
      return;
    }
    body.style.display = wantCode ? 'block' : 'none';
    stage.style.display = wantCode ? 'none' : '';
    if(wantCode){ const code=$('studio-code-text'); if(code) code.textContent = (a && a.html) || ''; }
  });
  on($('studio-download'),'click',()=>{ const a=_studioActive(); if(!a) return; _studioDownload(a); });
  on($('studio-export'),'click',_studioExportProject);
  // viewport toggles
  _wireVpSwitch('studio-vp', ()=>$('studio-frame'));
  _studioRenderArtifacts();
}
function _studioDownload(a){
  amvDownload((a.name||'design').replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.html', a.html, 'text/html');
}
// artifacts strip - switch between designs in the project
function _studioRenderArtifacts(){
  const el=$('studio-arts'); if(!el) return;
  const typeIc={page:'🖥️',slides:'🎞️',component:'🧩',graphic:'🎨'};
  el.innerHTML=_STUDIO.artifacts.map(a=>'<div class="studio-art'+(a.id===_STUDIO.activeId?' on':'')+'" data-art="'+a.id+'"><span class="studio-art-ic">'+(typeIc[a.type]||'🖥️')+'</span><span class="studio-art-n">'+escH(a.name||'Design')+'</span></div>').join('');
  el.querySelectorAll('[data-art]').forEach(x=>on(x,'click',()=>{ _STUDIO.activeId=x.dataset.art; const a=_studioActive(); if(a){ _studioRenderPreview(a.html); const t=$('studio-frame-t'); if(t)t.textContent=a.name; } _studioRenderArtifacts(); }));
}
function _studioAddPrompt(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ov" id="sa-bg"><div class="ob" style="max-width:440px"><button class="oc" data-dact="closeOvr" aria-label="Close">×</button>'+
    '<h2 style="margin-bottom:6px">Add a design</h2><p class="ob-sub" style="margin-bottom:12px">Describe another page, screen, slide deck, or graphic. It joins this project so your whole set stays consistent.</p>'+
    '<textarea id="sa-brief" rows="3" placeholder="e.g. \'an about page matching this style\' or \'a pitch deck of 6 slides\'" style="width:100%;font-size:var(--t-base)"></textarea>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn bs" data-dact="closeOvr">Cancel</button><button class="btn bp" id="sa-go">Design it</button></div></div></div>';
  onBackdrop($('sa-bg'),closeOvr);
  const go=()=>{ const v=$('sa-brief')?.value.trim(); if(!v){ toast('Describe the design','error'); return; } closeOvr(); _studioCreate(v); };
  on($('sa-go'),'click',go);
  setTimeout(()=>$('sa-brief')?.focus(),50);
}
// version history with revert
function _studioHistory(){
  const a=_studioActive(); if(!a||!a.history.length){ toast('No history yet','info'); return; }
  const r=$('ovr'); if(!r) return;
  const rows=a.history.slice().reverse().map((h,i)=>{ const realIdx=a.history.length-1-i; return '<div class="studio-hrow"><div class="studio-hrow-b"><div class="studio-hrow-t">'+(i===0?'Current':('Version '+(realIdx+1)))+'</div><div class="studio-hrow-d">'+escH(h.brief||'(initial)')+' · '+_timeAgo(h.ts||Date.now())+'</div></div>'+(i===0?'':'<button class="btn bs" data-revert="'+realIdx+'">Revert</button>')+'</div>'; }).join('');
  r.innerHTML='<div class="ov" id="sh-bg"><div class="ob" style="max-width:460px"><button class="oc" data-dact="closeOvr" aria-label="Close">×</button><h2 style="margin-bottom:12px">Version history</h2><div class="studio-hlist">'+rows+'</div></div></div>';
  onBackdrop($('sh-bg'),closeOvr);
  r.querySelectorAll('[data-revert]').forEach(b=>on(b,'click',()=>{ const idx=+b.dataset.revert; const h=a.history[idx]; if(h){ a.html=h.html; a.history.push({brief:'reverted to v'+(idx+1),html:h.html,ts:Date.now()}); _STUDIO.html=h.html; _studioRenderPreview(h.html); closeOvr(); toast('Reverted','success'); } }));
}
// export the whole project - folder write-back or downloads
async function _studioExportProject(){
  if(!_STUDIO.artifacts.length){ toast('Nothing to export yet','info'); return; }
  const nameFor=a=>(a.name||'design').replace(/[^a-z0-9]+/gi,'-').toLowerCase().replace(/^-|-$/g,'')||'design';
  if(AMVWorkspace.supported() && window.isSecureContext){
    try{
      await AMVWorkspace.connectFolder();
      let n=0; const seen={};
      for(const a of _STUDIO.artifacts){ let fn=nameFor(a); if(seen[fn]) fn=fn+'-'+(++seen[fn]); else seen[fn]=1; await AMVWorkspace.writeFile(fn+'.html', a.html); n++; }
      toast('Exported '+n+' designs to your folder','success',4000); return;
    }catch(e){ if(e.message==='cancelled') return; /* fall through to downloads */ }
  }
  let n=0; const seen={};
  for(const a of _STUDIO.artifacts){ let fn=nameFor(a); if(seen[fn]) fn=fn+'-'+(++seen[fn]); else seen[fn]=1; _studioDownload({name:fn,html:a.html}); n++; }
  toast('Downloading '+n+' designs','info');
}
window._studioExportProject=_studioExportProject;
/* The canvas frame is persistent rather than rebuilt, so it is reloaded
   through the preview document instead of having srcdoc set - which is what
   stopped every design's own script from running. */
function _studioRenderPreview(html){ const f=$('studio-frame'); if(f) _previewSend(f, html); }
function _studioStatus(t){ const s=$('studio-status'); if(s) s.textContent=t||''; }

window.designStart=designStart;window.designGo=designGo;

