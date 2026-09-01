/* ══════════════════════════════════════════════════════════════════════
   A BUILD TURN ENDS WITH A CHANGELIST, NOT A SENTENCE.

   Dev finished a turn by appending "**Files changed:** a.js, b.css" to the
   end of a paragraph. That tells you which files were touched and nothing
   else: not how much of each one moved, not whether a file was created or
   rewritten, and above all not how to put it back. A build tool whose only
   answer to "that was wrong" is "ask it again and hope" is a tool people
   stop trusting with a project they care about.

   So a turn now ends with the same thing a review ends with: a count, a
   per-file line balance, and a way to undo the whole turn at once.

   Every number here is measured. `_diffStat` runs a real diff; nothing on
   the card is estimated from file size or from how many blocks the model
   wrote, because a wrong number on a changelist is worse than no number -
   it is the number people use to decide whether to read the diff.
   ══════════════════════════════════════════════════════════════════════ */

/* THE EDIT DISTANCE IS ALL THIS NEEDS, WHICH MAKES IT CHEAP.

   Myers' greedy algorithm walks D - the number of inserted plus deleted
   lines - until the two files meet. The split between them falls straight
   out of the lengths and needs no backtrack: with `a` insertions and `d`
   deletions, D = a + d and (after - before) = a - d, so each is one
   subtraction away. That is why this returns at the moment the paths meet
   rather than reconstructing the script it never has to draw.

   Common prefix and suffix come off first, which is what makes a one-line
   change to a two-thousand-line file cost almost nothing.

   The bound exists so a pathological pair cannot hang the page. Past it the
   answer given is the trivial diff - every old line out, every new line in -
   which is a true description of two files with nothing in common, and two
   files that far apart are a rewrite rather than an edit. */
function _diffStat(before, after){
  const A = before ? String(before).split('\n') : [];
  const B = after  ? String(after).split('\n')  : [];
  let s = 0;
  while(s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while(e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a = A.slice(s, A.length - e), b = B.slice(s, B.length - e);
  const N = a.length, M = b.length;
  if(!N) return { add:M, del:0 };
  if(!M) return { add:0, del:N };
  const MAXD = Math.min(N + M, 2000);
  const off = MAXD + 1;
  const V = new Int32Array(2 * MAXD + 3);
  for(let D = 0; D <= MAXD; D++){
    for(let k = -D; k <= D; k += 2){
      let x;
      if(k === -D || (k !== D && V[off + k - 1] < V[off + k + 1])) x = V[off + k + 1];
      else x = V[off + k - 1] + 1;
      let y = x - k;
      while(x < N && y < M && a[x] === b[y]){ x++; y++; }
      V[off + k] = x;
      if(x >= N && y >= M){
        const delta = M - N;
        return { add:(D + delta) / 2, del:(D - delta) / 2 };
      }
    }
  }
  return { add:M, del:N };
}
try{ window._diffStat = _diffStat; }catch(e){}

/* The project as plain text, keyed by path. Strings are immutable in JS, so
   this is a map of references rather than a copy of the code - taking one
   before every turn costs nothing worth measuring. */
function _devSnapshot(){
  const o = {};
  try{ for(const p of Object.keys(_DEV.project)) o[p] = _DEV.project[p].content; }catch(e){}
  return o;
}
/* Put a snapshot back, exactly: files the turn created are removed rather
   than emptied, which is the difference between undo and "undo, mostly". */
function _devRestore(snap){
  try{
    for(const p of Object.keys(_DEV.project)) if(!(p in snap)) delete _DEV.project[p];
    for(const p of Object.keys(snap)){
      const lang = (typeof _devLangFor === 'function') ? _devLangFor(p) : 'txt';
      _DEV.project[p] = { content:snap[p], lang, ts:Date.now() };
    }
    if(!_DEV.project[_DEV.activePath]) _DEV.activePath = Object.keys(_DEV.project).sort()[0] || '';
  }catch(e){}
}
/* What moved between two snapshots. A file whose content is byte-identical
   is not listed at all: a model that rewrites a file with no change has not
   changed it, and saying otherwise pads the count people are trusting. */
function _devChangeSet(before, after){
  const rows = [];
  const paths = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for(const p of [...paths].sort()){
    const b = before ? before[p] : undefined;
    const a = after ? after[p] : undefined;
    if(b === a) continue;
    const st = _diffStat(b == null ? '' : b, a == null ? '' : a);
    if(!st.add && !st.del) continue;
    rows.push({ path:p, kind:(b == null ? 'added' : a == null ? 'removed' : 'edited'),
                add:st.add, del:st.del });
  }
  return rows;
}
try{ window._devSnapshot=_devSnapshot; window._devRestore=_devRestore; window._devChangeSet=_devChangeSet; }catch(e){}

/* The turns this session can put back. Keyed by an id the card carries, so
   the log entry and the snapshots cannot drift apart the way a positional
   index would when the log is filtered. */
const _DEVCHG = { turns:{}, seq:0 };
function _devRecordTurn(before, after){
  const id = 'chg' + (++_DEVCHG.seq);
  _DEVCHG.turns[id] = { before, after, undone:false, staged:false };
  return id;
}
/* A turn that has been WRITTEN NOWHERE yet. `writes` is kept beside the
   snapshots because applying has to put the files back through the same
   door every other write uses, rather than pouring a snapshot over the
   project and hoping the two stayed equivalent. */
function _devStageTurn(before, proposed, writes){
  const id = 'chg' + (++_DEVCHG.seq);
  _DEVCHG.turns[id] = { before, after:proposed, writes:writes || [],
                        undone:false, staged:true, discarded:false };
  return id;
}
try{ window._DEVCHG=_DEVCHG; window._devRecordTurn=_devRecordTurn; window._devStageTurn=_devStageTurn; }catch(e){}

/* A small extension chip. The colour says which language at a glance and
   comes from the palette AMV already uses, so the card does not introduce a
   parallel set of brand colours for six file types. */
const _DEV_FILE_TONE = { js:'gold', ts:'gold', jsx:'gold', tsx:'gold', mjs:'gold',
                         html:'red', css:'accent', scss:'accent',
                         json:'mu', md:'mu', py:'grn', txt:'mu' };
function _devFileChipHTML(path){
  const ext = (String(path).split('.').pop() || '').toLowerCase().slice(0, 4);
  const tone = _DEV_FILE_TONE[ext] || 'mu';
  return '<span class="dvc-ext dvc-tone-' + tone + '" aria-hidden="true">' + escH(ext || '?') + '</span>';
}

/* THE CARD.

   Added and removed are separate elements rather than one "+471 -0" string
   so a screen reader says "471 added, 0 removed" instead of reading
   punctuation, and so the two can be coloured without a span-in-a-string.

   A row is a button: the file it names is the file you want open, and
   having to go and find it in the tree afterwards is the small friction
   that stops people checking the diff at all. */
function _devChangeCardHTML(entry){
  const rows = entry.changes || [];
  if(!rows.length) return '';
  const add = rows.reduce((n, r) => n + r.add, 0);
  const del = rows.reduce((n, r) => n + r.del, 0);
  const t = _DEVCHG.turns[entry.chgId];
  const undone = !!(t && t.undone);
  const staged = !!(t && t.staged && !t.discarded);
  const discarded = !!(t && t.discarded);
  const n = rows.length;
  const head = '<div class="dvc-head">'
    /* The wording changes with the state, because "3 files changed" above a
       set of changes that have not happened yet is a lie the whole feature
       rests on not telling. */
    + '<span class="dvc-n" data-i18n>' + n + ' file' + (n === 1 ? '' : 's') + ' '
      + (staged ? 'to change' : 'changed') + '</span>'
    + '<span class="dvc-add" aria-label="' + add + ' lines added">+' + add + '</span>'
    + '<span class="dvc-del" aria-label="' + del + ' lines removed">-' + del + '</span>'
    + (staged
        ? '<span class="dvc-acts">'
            /* THE PRODUCT'S OWN BUTTONS, not a pair forked for this card.
               `.bp` puts near-black text on the accent, which is both the
               house style and the more readable of the two - the hand-rolled
               version used white and measured 4.1:1 in the dark theme where
               the shared one measures 4.83. Reusing it is the design-system
               rule and it happens to be the accessible answer as well. */
            + '<button class="btn bs dvc-reject" type="button" data-i18n data-dvc-discard="' + escH(entry.chgId) + '">Discard</button>'
            + '<button class="btn bp dvc-apply" type="button" data-i18n data-dvc-apply="' + escH(entry.chgId) + '">Apply</button>'
          + '</span>'
        : t ? '<button class="dvc-undo" type="button" data-i18n data-dvc-undo="' + escH(entry.chgId) + '">'
            + (undone ? 'Redo' : 'Undo')
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + (undone ? '<polyline points="15 14 20 9 15 4"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'
                      : '<polyline points="9 14 4 9 9 4"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>')
            + '</svg></button>'
         : '')
    + '</div>';
  /* A ROW HAS TO DO SOMETHING, AND WHAT THAT IS DEPENDS ON THE STATE.

     On an applied turn the file exists, so the row opens it. On a staged one
     the file does not exist yet - a row that opened it would open nothing for
     an added file, and the OLD text for an edited one, which is the worst of
     the three answers. So a staged row shows what the file WOULD say, inline
     and marked as proposed, which is also the thing somebody needs in order
     to answer the question the card is asking them. */
  const body = rows.map(r => {
    const act = staged
      ? ' data-dvc-peek="' + escH(r.path) + '" data-dvc-turn="' + escH(entry.chgId) + '" aria-expanded="false"'
      : ' data-dvc-open="' + escH(r.path) + '"' + (r.kind === 'removed' ? ' disabled aria-disabled="true"' : '');
    return '<div class="dvc-item">'
      + '<button class="dvc-row" type="button"' + act + '>'
        + _devFileChipHTML(r.path)
        + '<span class="dvc-path">' + escH(r.path) + '</span>'
        + (r.kind === 'edited' ? '' : '<span class="dvc-kind" data-i18n>' + r.kind + '</span>')
        + '<span class="dvc-add" aria-label="' + r.add + ' added">+' + r.add + '</span>'
        + '<span class="dvc-del" aria-label="' + r.del + ' removed">-' + r.del + '</span>'
      + '</button></div>';
  }).join('');
  const note = discarded ? 'Discarded. Nothing was written.'
    : staged ? 'Nothing has been written yet. Apply to make these changes, or open a file to read it first.'
    : undone ? 'These changes are rolled back. The files are as they were before this turn.'
    : '';
  return '<div class="dvc' + (undone ? ' dvc-undone' : '') + (staged ? ' dvc-staged' : '')
      + (discarded ? ' dvc-discarded' : '') + '">' + head
    + '<div class="dvc-rows">' + body + '</div>'
    + (note ? '<div class="dvc-note" data-i18n>' + note + '</div>' : '')
    + '</div>';
}
try{ window._devChangeCardHTML=_devChangeCardHTML; }catch(e){}

/* Undo and redo are the same operation pointed at a different snapshot, so
   they are one function - two would be two places for the refresh afterwards
   to be forgotten in, and the refresh is what makes the change visible. */
async function _devToggleTurn(id){
  const t = _DEVCHG.turns[id]; if(!t) return;
  /* A turn that happened on somebody's computer is put back on their
     computer. Same card, same button, different disk. */
  if(t.machine) return await _agentToggleTurn(t, id);
  /* RE-CAPTURED BEFORE ROLLING BACK, so hand edits made after the turn are
     not thrown away by Redo. The snapshot taken at the end of the turn is
     what the turn produced; what is in the project NOW is what the person
     has since made of it, and that is the thing Redo should bring back. */
  if(!t.undone) t.after = _devSnapshot();
  _devRestore(t.undone ? t.after : t.before);
  t.undone = !t.undone;
  try{ _devRenderLog(); }catch(e){}
  try{ _devRenderTree(); }catch(e){}
  try{ _devShowActive(); }catch(e){}
  try{ _devPaintPreview(); }catch(e){}
  try{ toast(t.undone ? 'Rolled back to before that change.' : 'Change restored.', 'info', 3000); }catch(e){}
}
try{ window._devToggleTurn=_devToggleTurn; }catch(e){}

/* Wiring, called by the log renderer after it writes the markup. Kept here
   beside the markup it belongs to rather than in the renderer, so a change
   to one is a change to one file. */
function _devWireChangeCards(root){
  if(!root) return;
  root.querySelectorAll('[data-dvc-undo]').forEach(b =>
    on(b, 'click', () => _devToggleTurn(b.dataset.dvcUndo)));
  root.querySelectorAll('[data-dvc-apply]').forEach(b =>
    on(b, 'click', () => _devApplyStaged(b.dataset.dvcApply)));
  root.querySelectorAll('[data-dvc-discard]').forEach(b =>
    on(b, 'click', () => _devDiscardStaged(b.dataset.dvcDiscard)));
  root.querySelectorAll('[data-dvc-peek]').forEach(b =>
    on(b, 'click', () => {
      const item = b.parentNode; if(!item) return;
      const openNow = item.querySelector('.dvc-peek');
      if(openNow){ openNow.remove(); b.setAttribute('aria-expanded','false'); return; }
      const t = _DEVCHG.turns[b.dataset.dvcTurn];
      const text = t && t.after ? t.after[b.dataset.dvcPeek] : undefined;
      const pre = document.createElement('pre');
      pre.className = 'dvc-peek';
      /* textContent, not innerHTML: this is somebody's file, and it is very
         often HTML. */
      pre.textContent = text == null ? '(this file would be removed)' : text;
      item.appendChild(pre);
      b.setAttribute('aria-expanded','true');
    }));
  root.querySelectorAll('[data-dvc-open]').forEach(b =>
    on(b, 'click', () => {
      const p = b.dataset.dvcOpen;
      if(!_DEV.project[p]) return;
      _DEV.activePath = p;
      try{ _devRenderTree(); }catch(e){}
      try{ _devShowActive(); }catch(e){}
      /* The code pane is where the file is, so switching to it is the rest
         of the click rather than a second thing to go and do. */
      try{
        const tab = document.getElementById('dev-tab-code');
        if(tab && !tab.classList.contains('on')) tab.click();
      }catch(e){}
    }));
}
try{ window._devWireChangeCards=_devWireChangeCards; }catch(e){}

/* ══════════════════════════════════════════════════════════════════════
   THE COMPOSER: WHAT WILL HAPPEN, WHO WILL DO IT, HOW HARD.

   Dev's composer was a box and a send arrow, with the engine picker up in
   the toolbar and the attach button beside it - two controls about THIS
   message living in the bar that describes the whole surface. The three
   decisions somebody actually makes when they press send are what to
   attach, whether the change lands straight away, and which engine at what
   effort; they belong together, under the box, where the decision is.
   ══════════════════════════════════════════════════════════════════════ */

/* WHETHER A CHANGE LANDS BY ITSELF. Real, not a label: in "ask" the writes
   are held and the card offers Apply, and nothing on disk or in the project
   moves until somebody says so. */
function _devApplyMode(){
  try{ const v = loadStr('amv_dev_apply'); if(v === 'auto' || v === 'ask') return v; }catch(e){}
  /* Ask is the default because the surface writes whole files. Somebody who
     wants it to just go can say so once and never see this again. */
  return 'ask';
}
function _devSetApplyMode(v){
  const m = (v === 'auto') ? 'auto' : 'ask';
  try{ saveStr('amv_dev_apply', m); }catch(e){}
  return m;
}

/* HOW HARD THE ENGINE THINKS, WHICH IS WHAT THE TURN COSTS.

   The server owns this decision and clamps whatever arrives to what the plan
   may have; this only asks. The ladder is deliberately the two settings AMV
   already sends upstream - a third, lower rung would be useful and is absent
   until the value is verified rather than guessed, because an effort the
   model does not accept is a failed request on somebody's real turn. */
const _DEV_EFFORTS = [['medium', 'Balanced'], ['high', 'High']];
function _devEffort(){
  try{ const v = loadStr('amv_dev_effort'); if(v && _DEV_EFFORTS.some(e => e[0] === v)) return v; }catch(e){}
  return '';   // empty means "whatever the engine runs at", which is the honest default
}
function _devSetEffort(v){
  const ok = _DEV_EFFORTS.some(e => e[0] === v) ? v : '';
  try{ saveStr('amv_dev_effort', ok); }catch(e){}
  return ok;
}
/* Raising effort is an Elite thing, and the picker says so up front rather
   than letting somebody choose it and quietly getting something else. The
   server clamps regardless - this is the courtesy, not the enforcement. */
function _devCanRaiseEffort(){
  try{ const p = loadStr('amv_plan') || 'free'; return p === 'elite' || p === 'ultra' || p === 'custom'; }catch(e){ return false; }
}
try{ window._devApplyMode=_devApplyMode; window._devSetApplyMode=_devSetApplyMode;
     window._devEffort=_devEffort; window._devSetEffort=_devSetEffort;
     window._devCanRaiseEffort=_devCanRaiseEffort; }catch(e){}

function _devComposerBarHTML(){
  const mode = _devApplyMode();
  const eff = _devEffort();
  const canRaise = _devCanRaiseEffort();
  const effOpts = '<option value=""' + (eff ? '' : ' selected') + '>Effort: engine default</option>'
    + _DEV_EFFORTS.map(([v, label]) => {
        /* High is the only step that costs more, so it is the only one a
           plan can withhold. Balanced is always selectable because asking
           for less can only reduce the bill. */
        const locked = (v === 'high' && !canRaise);
        return '<option value="' + v + '"' + (v === eff ? ' selected' : '') + (locked ? ' disabled' : '') + '>'
          + 'Effort: ' + label + (locked ? ' · Elite' : '') + '</option>';
      }).join('');
  return '<div class="dvi-bar">'
    + '<div class="dvi-l">'
      + '<div class="dev-addwrap">'
        + '<button class="dvi-plus" id="dev-add" type="button" aria-label="Add files or a folder" aria-haspopup="true" aria-expanded="false" title="Add files or a folder">'
          + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
        + '</button>'
        + '<div class="dev-add-menu" id="dev-add-menu" style="display:none">'
          + '<button data-add="files" type="button"><b>Files</b><span>One or a few files</span></button>'
          + '<button data-add="folder" type="button"><b>Folder</b><span>A whole project</span></button>'
          + '<button data-add="connect" type="button"><b>Connect folder</b><span>Also save edits back &middot; Chrome/Edge</span></button>'
        + '</div>'
      + '</div>'
      + '<select id="dev-apply-mode" class="dvi-sel" aria-label="What happens to the changes">'
        + '<option value="ask"' + (mode === 'ask' ? ' selected' : '') + '>Ask before changes</option>'
        + '<option value="auto"' + (mode === 'auto' ? ' selected' : '') + '>Apply automatically</option>'
      + '</select>'
    + '</div>'
    + '<div class="dvi-r">'
      + '<span class="dvi-busy" id="dev-busy" role="status" aria-live="polite" hidden>'
        + '<span class="dvi-spin" aria-hidden="true"></span><span class="dvi-busy-t"></span></span>'
      + _sectionModelSelect('code', 'dev-model')
      + '<select id="dev-effort" class="dvi-sel" aria-label="How hard the engine thinks">' + effOpts + '</select>'
      + '<button class="dev-send" id="dev-send" type="button" title="Build (Enter)" aria-label="Build">'
        + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
      + '</button>'
      /* Hidden until a turn is running, and it REPLACES Send rather than
         sitting beside it: a Send button that does nothing while AMV works is
         a control lying about being available. */
      + _agentStopBtnHTML()
    + '</div>'
  + '</div>';
}
try{ window._devComposerBarHTML=_devComposerBarHTML; }catch(e){}

/* The busy state, said in words rather than only spun at. A spinner alone
   tells somebody something is happening and not what, which on a turn that
   can run for a minute is the difference between waiting and reloading. */
function _devBusy(on, label){
  const el = document.getElementById('dev-busy'); if(!el) return;
  el.hidden = !on;
  const t = el.querySelector('.dvi-busy-t');
  if(t) t.textContent = on ? (label || 'Building') : '';
  const send = document.getElementById('dev-send');
  if(send) send.disabled = !!on;
}
try{ window._devBusy=_devBusy; }catch(e){}

/* APPLYING IS THE ORDINARY WRITE, NOT A SPECIAL ONE.

   The staged writes go through `_devSetFile` exactly as an automatic turn's
   do, and the same after-write step runs - preview, entry script, and the
   save to a connected folder. Pouring the snapshot straight into the project
   would look equivalent and would quietly skip all three. */
async function _devApplyStaged(id){
  const t = _DEVCHG.turns[id];
  if(!t || !t.staged || t.discarded) return;
  for(const w of (t.writes || [])) _devSetFile(w.path, w.body);
  if(t.writes && t.writes.length) _DEV.activePath = t.writes[0].path;
  t.staged = false;
  /* Re-measured against what actually landed rather than trusting the
     proposal: the two should agree, and if they ever do not, the card should
     say what is on disk. */
  t.after = _devSnapshot();
  try{ _devRenderLog(); }catch(e){}
  try{ _devRenderTree(); }catch(e){}
  try{ _devShowActive(); }catch(e){}
  try{
    const stat = document.getElementById('dev-prev-s');
    const outcome = await _devAfterWrite(Object.keys(t.after), stat);
    /* The approved path gets the same verification line the automatic one
       does, and gets it from the same place - the work that just ran. */
    const entry = _DEV.log.find(m => m.chgId === id);
    if(entry){ entry.verify = _devVerify((t.writes || []).map(w => w.path), outcome); _devRenderLog(); }
  }catch(e){}
  try{ toast('Applied. Undo is on the card if it is not what you wanted.','success',3500); }catch(e){}
}
function _devDiscardStaged(id){
  const t = _DEVCHG.turns[id];
  if(!t || !t.staged) return;
  t.discarded = true; t.staged = false;
  try{ _devRenderLog(); }catch(e){}
  try{ toast('Discarded. Nothing was written.','info',3000); }catch(e){}
}
try{ window._devApplyStaged=_devApplyStaged; window._devDiscardStaged=_devDiscardStaged; }catch(e){}

/* ══════════════════════════════════════════════════════════════════════
   WHAT WAS ACTUALLY CHECKED, AND WHAT WAS NOT.

   "Done" is the word that costs the most when it is wrong. A build turn
   that says nothing about how far it got invites somebody to ship a page
   nobody has opened; a build turn that says "verified" invites it harder.

   So the line above the changelist reports only things that really
   happened this turn - the preview really assembled, the entry script
   really ran and this is what it said - and then names the step nobody
   has done. Nothing here re-derives confidence from the fact that the
   model sounded sure.

   NO SYNTAX CHECK, AND THE REASON IS WORTH KEEPING. Parsing the changed
   JavaScript would be the obvious thing to add, and the page cannot do
   it: `new Function` and `eval` are exactly what AMV's own policy
   forbids, which is the point of the policy. The one parser available
   without eval is JSON's, so JSON is the one thing genuinely checked
   here - and it earns its place, because a config file the model got
   subtly wrong fails much later and much more confusingly than it
   should. Claiming a JavaScript check that is not running would be
   worse than the silence it replaced. */
function _devVerify(changed, outcome){
  outcome = outcome || {};
  const checks = [];
  const paths = changed || [];

  const jsons = paths.filter(p => /\.json$/i.test(p));
  if(jsons.length){
    const broken = [];
    for(const p of jsons){
      const f = _DEV.project[p]; if(!f) continue;
      try{ JSON.parse(f.content); }catch(e){ broken.push(p); }
    }
    checks.push(broken.length
      ? { ok:false, text:'JSON did not parse: ' + broken.join(', ') }
      : { ok:true, text:(jsons.length === 1 ? 'The JSON file parses.' : 'All ' + jsons.length + ' JSON files parse.') });
  }

  if(outcome.previewed) checks.push({ ok:true, text:'The project was assembled into one page and rendered in the preview.' });
  if(outcome.run){
    checks.push(outcome.run.ok
      ? { ok:true, text:'The entry script ran without error.' }
      : { ok:false, text:'The entry script errored: ' + String(outcome.run.stderr || '').split('\n')[0].slice(0, 140) });
  }
  if(outcome.saved) checks.push({ ok:true, text:'The changed files were written to your connected folder.' });

  /* Always said, and said last. Rendering is not using: a page can draw
     perfectly and have a button that does nothing, and this surface has no
     way to know that. */
  const remaining = outcome.previewed
    ? 'Nobody has clicked through it. Open the preview and use it to be sure it behaves.'
    : 'Nothing was run this turn, so nothing here has been checked by running it.';
  return { checks, remaining };
}
function _devVerifyHTML(entry){
  const v = entry && entry.verify; if(!v) return '';
  const rows = (v.checks || []).map(c =>
    '<li class="dvv-i ' + (c.ok ? 'dvv-ok' : 'dvv-no') + '">'
      + '<span class="dvv-m" aria-hidden="true">' + (c.ok ? '✓' : '✗') + '</span>'
      + '<span>' + escH(c.text) + '</span></li>').join('');
  return '<div class="dvv"><div class="dvv-h">Verification</div>'
    + (rows ? '<ul class="dvv-l">' + rows + '</ul>' : '')
    + '<div class="dvv-rem">' + escH(v.remaining) + '</div></div>';
}
try{ window._devVerify=_devVerify; window._devVerifyHTML=_devVerifyHTML; }catch(e){}

/* ══════════════════════════════════════════════════════════════════════
   CODE PASTED INTO THE BOX IS CODE, NOT AN INSTRUCTION.

   Paste four hundred lines of somebody else's file into the composer and
   the old behaviour sent it to the model as a prompt: it cost a turn, it
   came back paraphrased, and the file you actually wanted to work on was
   never in the project. The thing you meant was "here, take this".

   It is OFFERED, not done. A long paste can genuinely be a spec, a stack
   trace, or a pile of copy - and silently turning one of those into a
   source file would be the same mistake in the other direction. So this
   spots it, says what it thinks, and waits.
   ══════════════════════════════════════════════════════════════════════ */

/* Signals, not one regex. Any single line of prose can contain a brace; what
   code has is several of these at once, over many lines. */
function _looksLikeCode(text){
  const t = String(text || '');
  if(t.length < 200) return false;
  const lines = t.split('\n');
  if(lines.length < 6) return false;
  let hits = 0;
  if(/^\s*(?:<!doctype html|<html)/i.test(t)) hits += 3;
  if(/<\/[a-z][\w-]*>/i.test(t)) hits += 2;
  if(/\b(?:function|const|let|var|=>|class|return)\b/.test(t)) hits += 2;
  if(/^\s*(?:def |class |import |from )\w/m.test(t)) hits += 2;
  if(/[{};]\s*$/m.test(t)) hits += 1;
  if(/^\s*[.#@][\w-]+\s*\{/m.test(t)) hits += 2;
  /* Indentation is the giveaway that survives every language. */
  if(lines.filter(l => /^\s{2,}\S/.test(l)).length >= 3) hits += 1;
  /* SEVERAL LINES ENDING THE WAY STATEMENTS END. Added because the first
     version of this missed ordinary JavaScript: a short function with two
     indented lines scored three of the four it needed, so somebody pasting
     exactly the thing this feature is for got nothing. Prose does not end
     three lines in a row with a semicolon or a brace. */
  if(lines.filter(l => /[;{}]\s*$/.test(l)).length >= 3) hits += 1;
  if(/\b(?:export|import|require|module\.exports|console\.log|print\()/.test(t)) hits += 1;
  return hits >= 4;
}
/* A name somebody will recognise, from what the code plainly is. They get to
   change it - this only saves the typing. */
function _guessFileName(text){
  const t = String(text || '');
  if(/^\s*(?:<!doctype html|<html)/i.test(t)) return 'index.html';
  if(/^\s*(?:def |class |import |from )\w/m.test(t) && !/[{};]\s*$/m.test(t)) return 'main.py';
  if(/^\s*[.#@][\w-]+\s*\{/m.test(t) && !/\b(?:function|=>|const)\b/.test(t)) return 'styles.css';
  try{ JSON.parse(t); return 'data.json'; }catch(e){}
  if(/<\/[a-z][\w-]*>/i.test(t)) return 'index.html';
  return 'app.js';
}
try{ window._looksLikeCode=_looksLikeCode; window._guessFileName=_guessFileName; }catch(e){}

/* The offer, under the composer. One line, one button, and a way to say no
   that leaves the text exactly where it was. */
function _devOfferPaste(text){
  const host = document.getElementById('dev-paste-offer'); if(!host) return;
  if(!_looksLikeCode(text)){ host.innerHTML = ''; host.hidden = true; return; }
  const name = _guessFileName(text);
  const lines = String(text).split('\n').length;
  host.hidden = false;
  host.innerHTML = '<span class="dvp-t">That looks like ' + lines + ' lines of code.</span>'
    + '<button class="dvp-add" type="button" id="dev-paste-add">Add as ' + escH(name) + '</button>'
    + '<button class="dvp-no" type="button" id="dev-paste-no">Send as a message</button>';
  on(document.getElementById('dev-paste-no'), 'click', () => { host.innerHTML = ''; host.hidden = true; });
  on(document.getElementById('dev-paste-add'), 'click', async () => {
    const ta = document.getElementById('dev-msg');
    const body = ta ? ta.value : '';
    let path = name;
    try{
      if(typeof showTextPromptAsync === 'function'){
        const asked = await showTextPromptAsync('Save this as which file?', name);
        if(asked === null || asked === undefined) return;   // they changed their mind
        if(String(asked).trim()) path = String(asked).trim();
      }
    }catch(e){}
    _devSetFile(path, body);
    _DEV.activePath = path;
    if(ta){ ta.value = ''; ta.style.height = 'auto'; }
    host.innerHTML = ''; host.hidden = true;
    try{ _devRenderTree(); }catch(e){}
    try{ _devShowActive(); }catch(e){}
    try{ _devPaintPreview(); }catch(e){}
    try{ toast('Added ' + path + '. The preview shows it now.', 'success', 3500); }catch(e){}
  });
}
try{ window._devOfferPaste=_devOfferPaste; }catch(e){}

/* ══════════════════════════════════════════════════════════════════════
   PUSHING TO GITHUB, WITH THE DIFF IN FRONT OF YOU FIRST.

   The loop a build surface has to close is: it wrote the code, now put it
   somewhere real. Downloading a zip is not that.

   Every rule here exists because the other choice is worse:

   The token never touches this browser. It is held server-side and the
   push happens there; nothing in this file has ever seen it. A repo-scoped
   credential in localStorage is one injected script away from being
   somebody else's, and AMV's old GitHub tools kept one exactly there - or
   would have, if the key they read had ever been written.

   Nothing goes to a default branch. The push creates a NEW branch off the
   base and the pull request asks for it to land. The server has no
   argument that could name an existing branch, so this is not a promise
   in a comment.

   And the confirmation shows what will actually be sent - every path, and
   how many lines each one is - before anything leaves. "Push to GitHub"
   with no list is a button people press once and then stop trusting.
   ══════════════════════════════════════════════════════════════════════ */

/* A branch name somebody will recognise a week later. */
function _ghBranchName(){
  const base = (typeof _devProjectName === 'function' && _devProjectName()) || 'build';
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return 'amv/' + base + '-' + p(d.getMonth() + 1) + p(d.getDate()) + '-'
    + p(d.getHours()) + p(d.getMinutes());
}

/* Is GitHub connected, and with the permission this needs? The two are
   different problems with different fixes, so they are answered separately
   rather than collapsed into "not connected". */
async function _ghConnection(){
  if(!(window.AMV_API && AMV_API.live)) return { ok:false, why:'engine' };
  let list = null;
  try{ list = await AMV_API.connectList(); }catch(e){ return { ok:false, why:'engine' }; }
  /* `items` and `scopes`, which is what /v1/connect/list actually returns. The
     first version of this read `connections` and `caps` - names that exist
     nowhere - so it found nothing and reported "not connected" to everybody,
     forever. Correct at both ends and not joined in the middle is the most
     common defect in this codebase and this was another one. */
  const items = (list && list.items) || [];
  const gh = items.filter(c => c && c.provider === 'github');
  if(!gh.length){
    /* Nothing connected has two causes with two different fixes, and only one
       of them is the person's to make. If this deployment has no GitHub
       credentials, telling them to go and connect it sends them to a button
       that cannot work. */
    const provs = (list && list.providers) || [];
    const p = provs.find(x => x && x.id === 'github');
    if(list && list.configured === false) return { ok:false, why:'unconfigured' };
    if(p && p.ready === false) return { ok:false, why:'unconfigured' };
    return { ok:false, why:'none' };
  }
  const can = gh.some(c => (c.scopes || []).indexOf('code.write') >= 0);
  return can ? { ok:true } : { ok:false, why:'scope' };
}

function _ghNotReadyMessage(why){
  if(why === 'engine') return 'AMV is not connected to its engine yet, so it cannot reach your GitHub account.';
  if(why === 'scope')  return 'Your GitHub account is connected, but not for writing code. Reconnect it under Settings, Integrations and tick the permission that lets AMV push.';
  if(why === 'unconfigured') return 'GitHub is not switched on for this deployment yet, so there is nothing for you to connect to. This one is on the operator, not on you.';
  return 'Connect GitHub under Settings, Integrations first. AMV holds the token on the server, never in this browser.';
}

/* THE MODAL IS BUILT HERE RATHER THAN THROUGH `confirmModal`, AND THE REASON
   MATTERS. `confirmModal` escapes its body - correctly, because everywhere
   else it is handed a sentence - so a file list passed to it renders as a
   run-together string of literal markup. The confirmation for a push has to
   BE the list; a sentence with a number in it is the thing this is replacing.

   Same overlay element, same backdrop and close behaviour, so it inherits the
   focus and dismissal the rest of the product already has. */
function _ghModal(title, innerHTML, wire){
  const ovr = $('ovr'); if(!ovr) return null;
  ovr.innerHTML = '<div class="ov" id="ghp-bg"><div class="ob ghp-ob" role="dialog" aria-modal="true" aria-labelledby="ghp-t">'
    + '<button class="oc" id="ghp-x" aria-label="Close">&#215;</button>'
    + '<h2 id="ghp-t">' + escH(title) + '</h2>'
    + innerHTML
    + '</div></div>';
  ovr.classList.add('on');
  const root = ovr;
  /* Guarded on the backdrop itself, never by stopping propagation inside the
     card - which is what kills every delegated button in the dialog. */
  try{ onBackdrop($('ghp-bg'), closeOvr); }catch(e){}
  on($('ghp-x'), 'click', closeOvr);
  try{ wire && wire(root); }catch(e){}
  return root;
}

/* Which repository. A list somebody scans, not a box they have to type an
   exact "owner/name" into from memory. Resolves null if they close it, so the
   caller can tell "cancelled" from "chose". */
function _devPickRepo(repos){
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if(settled) return; settled = true; resolve(v); };
    const rows = repos.map((r, i) =>
      '<button class="ghr" type="button" data-ghr="' + i + '">'
      + '<span class="ghr-n">' + escH(r.full) + '</span>'
      + (r.private ? '<span class="ghr-p">private</span>' : '')
      + '<span class="ghr-b">' + escH(r.branch) + '</span></button>').join('');
    _ghModal('Push to which repository?',
      '<p class="ob-sub">Only repositories you can write to are listed.</p>'
      + '<div class="ghr-l">' + rows + '</div>',
      (root) => {
        root.querySelectorAll('[data-ghr]').forEach(b => on(b, 'click', () => {
          const chosen = repos[Number(b.dataset.ghr)];
          try{ closeOvr(); }catch(e){}
          finish(chosen);
        }));
        on($('ghp-x'), 'click', () => finish(null));
        try{ onBackdrop($('ghp-bg'), () => finish(null)); }catch(e){}
      });
  });
}
try{ window._devPickRepo=_devPickRepo; }catch(e){}

/* The whole flow, in the order somebody thinks about it: can we, where to,
   is this really what you meant, then do it. */
/* A BUTTON THAT STARTS A NETWORK CALL HAS TO SAY SO BEFORE IT FINISHES.

   With no backend configured, _ghConnection() answers from memory - one
   synchronous check of AMV_API.live - and this control always produced a toast
   inside a frame. The moment a real backend address was baked into the page it
   started AWAITING /v1/connect/list instead, and the button went silent for the
   length of a round trip. Nothing was broken; there was simply no evidence for
   the person that their click had landed, on a control whose job is to put
   their code in somebody's repository. On a slow connection that is seconds of
   nothing, and the reasonable thing to do with a button that appears dead is
   press it again.

   So it goes busy the instant it is clicked and stays busy for the part with no
   other evidence: the connection check and the repository read. It clears when
   the confirmation modal opens, because from there the modal is the feedback -
   and while it is busy a second click is refused, which is what somebody does
   to a button that looks dead.

   Found by the control sweep noticing a click that changed nothing on screen.
   The sweep was right, and it was right about the product rather than about
   itself. */
function _devGhBusy(on){
  const btn = (typeof $ === 'function') ? $('dev-github') : null;
  if(!btn) return;
  try{
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    btn.disabled = !!on;
    btn.classList.toggle('is-busy', !!on);
    btn.title = on ? 'Checking your GitHub connection\u2026' : 'Push this project to GitHub';
  }catch(e){ /* a missing button is not a reason to skip the push */ }
}

async function _devPushToGitHub(){
  const paths = (typeof _devProjectFiles === 'function') ? _devProjectFiles() : [];
  if(!paths.length){ toast('Build something first, then AMV can push it.', 'info', 4000); return; }

  const btn = (typeof $ === 'function') ? $('dev-github') : null;
  if(btn && btn.getAttribute('aria-busy') === 'true') return;   // already working
  _devGhBusy(true);
  try{
    await _devPushToGitHubInner(paths);
  } finally {
    _devGhBusy(false);
  }
}

async function _devPushToGitHubInner(paths){
  const conn = await _ghConnection();
  if(!conn.ok){ toast(_ghNotReadyMessage(conn.why), 'info', 7000); return; }

  let repos = [];
  try{ repos = await _connActRun('github.repos'); }
  catch(e){ toast(e.message || 'Could not read your repositories.', 'error', 6000); return; }
  if(!repos || !repos.length){
    toast('No repository on your account can be pushed to. AMV only lists the ones you can write to.', 'info', 6000);
    return;
  }

  const repo = await _devPickRepo(repos);
  if(!repo) return;

  const files = paths.map(p => ({ path:p, content:_DEV.project[p].content }));
  const total = files.reduce((n, f) => n + f.content.split('\n').length, 0);
  const branch = _ghBranchName();

  /* THE CONFIRMATION IS THE LIST, not a sentence with a number in it. Every
     path, every line count, and the branch it will land on - which is the one
     thing somebody has to be able to check before it is somebody else's
     repository. */
  const rows = files.map(f =>
    '<li class="ghp-f"><span class="ghp-p">' + escH(f.path) + '</span>'
    + '<span class="ghp-n">' + f.content.split('\n').length + ' lines</span></li>').join('');
  _ghModal('Push ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' to ' + repo.full + '?',
    '<p class="ob-sub">AMV creates a NEW branch. Your default branch is not touched, '
      + 'and nothing is merged - a pull request is how you decide that.</p>'
    + '<div class="ghp-meta"><b>' + escH(repo.full) + '</b>'
    + '<span>branch <code>' + escH(branch) + '</code> off <code>' + escH(repo.branch) + '</code></span></div>'
    + '<ul class="ghp-l">' + rows + '</ul>'
    + '<p class="ghp-sum">' + files.length + ' file' + (files.length === 1 ? '' : 's')
    + ', ' + total + ' lines in total.</p>'
    + '<div class="ghp-acts">'
      + '<button class="btn bs" id="ghp-no" type="button">Cancel</button>'
      + '<button class="btn bp" id="ghp-go" type="button">Push</button>'
    + '</div>',
    () => {
      on($('ghp-no'), 'click', closeOvr);
      on($('ghp-go'), 'click', async () => {
        closeOvr();
        await _devDoPush(repo, branch, files);
      });
    });
}
try{ window._devPushToGitHub=_devPushToGitHub; }catch(e){}

/* The push itself, after somebody has seen exactly what it will send. */
async function _devDoPush(repo, branch, files){
  const stat = document.getElementById('dev-prev-s');
  if(stat) stat.textContent = 'pushing\u2026';
  try{
    const r = await _connActRun('github.push', {
      repo: repo.full, base: repo.branch, branch,
      message: 'Build from AMV: ' + files.length + ' file' + (files.length === 1 ? '' : 's'),
      files,
    });
    if(stat) stat.textContent = 'pushed';
    _DEV.log.push({ role:'ai',
      text:'Pushed ' + r.files + ' files to **' + r.repo + '** on branch `' + r.branch + '` ('
        + r.commit + '). Nothing was merged - open a pull request when you want it to land.',
      gh:{ repo:r.repo, branch:r.branch, base:repo.branch, url:r.url } });
    _devRenderLog();
  }catch(e){
    if(stat) stat.textContent = '';
    /* Named, because "that failed" sends somebody to look in the wrong place.
       A branch collision is the one they can fix by trying again. */
    const m = /branch_exists/.test(e.message || '')
      ? 'That branch already exists on GitHub. Try again in a moment - AMV names the branch by the minute.'
      : (e.message || 'The push did not go through. Nothing was changed.');
    _DEV.log.push({ role:'ai', text:'', _snag:m });
    _devRenderLog();
  }
}
try{ window._devDoPush=_devDoPush; }catch(e){}

/* Opening the pull request, offered on the card the push leaves behind rather
   than done automatically: pushing a branch and opening a PR are two
   decisions, and the second one puts the change in front of other people. */
async function _devOpenPR(gh){
  if(!gh) return;
  const stat = document.getElementById('dev-prev-s');
  try{
    const r = await _connActRun('github.pr', {
      repo: gh.repo, head: gh.branch, base: gh.base,
      title: 'Build from AMV',
      body: 'Opened from AMV. ' + gh.branch + ' onto ' + gh.base + '.',
    });
    if(stat) stat.textContent = 'pull request open';
    _DEV.log.push({ role:'ai', text:'Opened pull request #' + r.number + ': ' + r.url });
    _devRenderLog();
  }catch(e){
    _DEV.log.push({ role:'ai', text:'', _snag:(e.message || 'The pull request could not be opened.') });
    _devRenderLog();
  }
}
try{ window._devOpenPR=_devOpenPR; }catch(e){}
