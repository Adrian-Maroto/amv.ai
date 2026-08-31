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
    + '<span class="dvc-n">' + n + ' file' + (n === 1 ? '' : 's') + ' '
      + (staged ? 'to change' : 'changed') + '</span>'
    + '<span class="dvc-add" aria-label="' + add + ' lines added">+' + add + '</span>'
    + '<span class="dvc-del" aria-label="' + del + ' lines removed">-' + del + '</span>'
    + (staged
        ? '<span class="dvc-acts">'
            + '<button class="dvc-reject" type="button" data-dvc-discard="' + escH(entry.chgId) + '">Discard</button>'
            + '<button class="dvc-apply" type="button" data-dvc-apply="' + escH(entry.chgId) + '">Apply</button>'
          + '</span>'
        : t ? '<button class="dvc-undo" type="button" data-dvc-undo="' + escH(entry.chgId) + '">'
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
        + (r.kind === 'edited' ? '' : '<span class="dvc-kind">' + r.kind + '</span>')
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
    + (note ? '<div class="dvc-note">' + note + '</div>' : '')
    + '</div>';
}
try{ window._devChangeCardHTML=_devChangeCardHTML; }catch(e){}

/* Undo and redo are the same operation pointed at a different snapshot, so
   they are one function - two would be two places for the refresh afterwards
   to be forgotten in, and the refresh is what makes the change visible. */
function _devToggleTurn(id){
  const t = _DEVCHG.turns[id]; if(!t) return;
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
    await _devAfterWrite(Object.keys(t.after), stat);
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
