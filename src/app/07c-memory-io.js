/* ══════════════════════════════════════════════════════════════════════
   MEMORY THAT CAN LEAVE AND ARRIVE.

   Memories went out only inside the whole-account export, and nothing could
   bring any in - so somebody moving from another assistant started from
   nothing, and somebody moving devices without an account had to retype
   them. Now the Memory screen exports its own file and imports one, or text
   pasted from anywhere: an AMV export, a JSON list, or the plain list another
   assistant shows on its own memory screen, one fact per line.

   Nothing is added sight unseen. Every memory is replayed into every future
   request, so an import is shown as a list with a box for each, and only the
   ticked ones go in. The same refusals as typing one by hand apply: anything
   that looks like a password, key or card number is left out and counted, and
   anything AMV already knows is left out as a duplicate.
   ══════════════════════════════════════════════════════════════════════ */
const MEM_IMPORT_MAX_TEXT = 200000;   // characters read from a file or a paste
const MEM_ITEM_MAX = 500;             // one memory, as long as AMV keeps
const MEM_TOTAL_MAX = 200;            // the cap the extractor already keeps to

/* A file or a paste, read into candidate facts. */
function _memParse(text){
  const raw = String(text || '').slice(0, MEM_IMPORT_MAX_TEXT).trim();
  if(!raw) return [];
  let items = null;
  if(/^[\[{]/.test(raw)){
    try{
      const o = JSON.parse(raw);
      const pick = (arr) => arr.map(x => typeof x === 'string' ? x : (x && typeof x.text === 'string' ? x.text : (x && typeof x.content === 'string' ? x.content : ''))) ;
      if(Array.isArray(o)) items = pick(o);
      else if(o && Array.isArray(o.items)) items = pick(o.items);          // AMV's own memory file
      else if(o && Array.isArray(o.memories)) items = pick(o.memories);    // the whole-account export
      else if(o && Array.isArray(o.memory)) items = pick(o.memory);
    }catch(e){ items = null; }
  }
  if(!items){
    /* Plain text: one fact a line, with the list furniture other screens add
       (bullets, numbers, checkboxes) taken off and headings skipped. */
    items = raw.split(/\r?\n/)
      .map(l => l.replace(/^\s*(?:[-*•·◦▪]|\d+[.)]|\[[ xX]\])\s*/, '').trim())
      .filter(l => l && !/^#{1,6}\s/.test(l) && !/^(memories|saved memories|what i know about you)\s*:?$/i.test(l));
  }
  const seen = new Set();
  return items.map(s => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 3)
    .map(s => s.length > MEM_ITEM_MAX ? s.slice(0, MEM_ITEM_MAX - 1) + '…' : s)
    .filter(s => { const k = s.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; });
}

/* What would happen if these were added: which are new, and how many were
   left out and why. */
function _memImportPlan(cands){
  const known = new Set((S.memory || []).map(m => String(m.text || '').toLowerCase().trim()));
  const out = { add: [], dup: 0, secret: 0, over: 0 };
  const room = Math.max(0, MEM_TOTAL_MAX - (S.memory || []).length);
  for(const c of cands){
    if(_memLooksSecret(c)){ out.secret++; continue; }
    if(_memDuplicate(c, known)){ out.dup++; continue; }
    if(out.add.length >= room){ out.over++; continue; }
    out.add.push(c);
    known.add(c.toLowerCase());
  }
  return out;
}

function _memImportCommit(texts){
  const now = Date.now();
  const fresh = texts.map((t, i) => ({ id: 'm' + now + '_' + i + Math.random().toString(36).slice(2, 5), text: t, added: now, imported: true }));
  S.memory = [...fresh, ...(S.memory || [])].slice(0, MEM_TOTAL_MAX);
  return fresh.length;
}

function _memExport(){
  if(!(S.memory || []).length){ toast('There are no memories to export yet.', 'info', 3500); return false; }
  const pkg = { format: 'amv-memories', exported: new Date().toISOString(),
                items: S.memory.map(m => ({ text: m.text, added: m.added || 0 })) };
  _saveBlob(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }), 'amv-memories.json');
  return true;
}

/* The import panel, inside the Memory screen: paste or choose a file, then
   the list to tick through. */
function _memImportOpen(){
  const host = $('mem-imp'); if(!host) return;
  host.hidden = false;
  host.innerHTML =
    '<div class="memio-h">Import memories</div>'+
    '<p class="memio-p">Paste the list from another assistant’s memory screen - one fact per line - or choose an AMV memory file. You will see every one before anything is added.</p>'+
    '<label class="sr-only" for="mem-imp-txt">Memories to import</label>'+
    '<textarea id="mem-imp-txt" class="memio-txt" rows="6" placeholder="I live in Madrid\nI prefer short answers\nI’m studying for the MIR"></textarea>'+
    '<input type="file" id="mem-imp-file" accept=".json,.txt,.md,application/json,text/plain,text/markdown" hidden>'+
    '<div class="memio-acts">'+
      '<button class="btn bp" id="mem-imp-review" type="button">Review</button>'+
      '<button class="btn bs" id="mem-imp-pick" type="button">Choose a file</button>'+
      '<button class="btn bs" id="mem-imp-cancel" type="button">Cancel</button>'+
    '</div>'+
    '<div id="mem-imp-list"></div>';
  const txt = $('mem-imp-txt');
  on($('mem-imp-cancel'), 'click', () => { host.hidden = true; host.innerHTML = ''; });
  on($('mem-imp-pick'), 'click', () => $('mem-imp-file').click());
  on($('mem-imp-file'), 'change', async (e) => {
    const f = e.target.files && e.target.files[0]; if(!f) return;
    if(f.size > MEM_IMPORT_MAX_TEXT * 4){ toast('That file is too large to be a list of memories.', 'error', 5000); return; }
    try{ txt.value = (await f.text()).slice(0, MEM_IMPORT_MAX_TEXT); _memImportReview(txt.value); }
    catch(err){ toast('AMV could not read that file.', 'error', 4000); }
  });
  on($('mem-imp-review'), 'click', () => _memImportReview(txt.value));
  try{ txt.focus(); }catch(e){}
}
function _memImportReview(text){
  const list = $('mem-imp-list'); if(!list) return;
  const cands = _memParse(text);
  if(!cands.length){
    list.innerHTML = '<p class="memio-say" role="status">Nothing to import - paste one fact per line, or choose an AMV memory file.</p>';
    return;
  }
  const plan = _memImportPlan(cands);
  const skipped = [
    plan.dup ? plan.dup + ' already known' : '',
    plan.secret ? plan.secret + ' left out because ' + (plan.secret === 1 ? 'it looks' : 'they look') + ' like a password, key or card number' : '',
    plan.over ? plan.over + ' over the ' + MEM_TOTAL_MAX + '-memory limit' : '',
  ].filter(Boolean).join(' · ');
  if(!plan.add.length){
    list.innerHTML = '<p class="memio-say" role="status">Nothing new to add' + (skipped ? ': ' + escH(skipped) : '') + '.</p>';
    return;
  }
  list.innerHTML =
    '<p class="memio-say" role="status">' + plan.add.length + ' to add' + (skipped ? ' · ' + escH(skipped) : '') + '. Untick any you do not want.</p>'+
    '<div class="memio-list">' + plan.add.map((t, i) =>
      '<label class="memio-row"><input type="checkbox" data-memimp="' + i + '" checked><span>' + escH(t) + '</span></label>').join('') + '</div>'+
    '<div class="memio-acts"><button class="btn bp" id="mem-imp-add" type="button">Add ' + plan.add.length + ' memor' + (plan.add.length === 1 ? 'y' : 'ies') + '</button></div>';
  const btn = $('mem-imp-add');
  const count = () => list.querySelectorAll('[data-memimp]:checked').length;
  list.querySelectorAll('[data-memimp]').forEach(b => on(b, 'change', () => {
    const n = count(); btn.textContent = 'Add ' + n + ' memor' + (n === 1 ? 'y' : 'ies'); btn.disabled = !n;
  }));
  on(btn, 'click', () => {
    const chosen = [...list.querySelectorAll('[data-memimp]:checked')].map(b => plan.add[+b.dataset.memimp]).filter(Boolean);
    if(!chosen.length) return;
    const n = _memImportCommit(chosen);
    toast('Added ' + n + ' memor' + (n === 1 ? 'y' : 'ies') + '.', 'success', 3500);
    renderMemoryView();
  });
}
try{ window._memParse = _memParse; window._memImportPlan = _memImportPlan; window._memExport = _memExport;
     window._memImportOpen = _memImportOpen; window._memImportReview = _memImportReview; }catch(e){}
