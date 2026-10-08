/* ── PROJECTS THAT ARE WHAT THEY SAY ──────────────────────────────────────────

   The Projects screen said "AMV remembers everything inside it" and "keeps the
   full context together". A project was a name, an icon and a tag on some
   chats; nothing about it reached a single request, so a chat inside one knew
   exactly what a chat outside it knew.

   A project now carries three things, and every chat tagged to it is sent all
   three:
     - INSTRUCTIONS, written by the person ("we are a dental clinic in Lyon;
       answers in French; cite the 2024 guidelines");
     - FILES, read by the same reader as a chat attachment, so a Word document
       or a workbook arrives as its text and not as an archive;
     - MEMORY learned inside the project, kept on the project and never mixed
       into the person's general memory, so a client's details stay with that
       client.
   Instructions and memory sync like the project itself. File TEXT is kept on
   this device: it can be large, and the sync record has a hard ceiling that a
   handful of documents would breach for everything else in it. The screen
   says so beside the files, rather than letting a phone open a project and
   find them missing without a word.

   Bounded on the way into the prompt: a project's files are sent up to a fixed
   size, newest first, and the rest are named as not included - the same rule
   chat attachments follow - so a large project costs a known amount per turn
   and never silently drops what it cannot fit. */

const PROJ_INSTR_MAX = 4000;
const PROJ_FILES_MAX = 20;
const PROJ_CTX_CHARS = 120000;   /* about 30k tokens: room for real documents, a known ceiling per turn */
const PROJ_MEM_MAX = 60;

/* ONE store for projects. They used to be written under two names: the state
   layer persisted `amv_workspaces` (and sync wrote there), while boot and
   sign-in read `amv_ws`. A project made or changed on another device landed in
   the first and was read from the second, so after a reload the older copy won
   and was pushed back over the newer one. Read both, merge by id, newest
   first; write one. */
function _loadWorkspaces(){
  const a = load('amv_workspaces'), b = load('amv_ws');
  const merged = _mergeById(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []);
  return merged.length ? merged : getDefaultWorkspaces();
}
function _saveWorkspaces(list){
  S.workspaces = (list || []).slice();      /* the proxy persists and schedules the sync push */
  try{ localStorage.removeItem(_scopeKey('amv_ws')); }catch(e){}
}
function _wsById(id){ return (S.workspaces || []).find(w => w && w.id === id) || null; }
function _wsTouch(ws){ ws.updated = Date.now(); _saveWorkspaces(S.workspaces); }

/* File text lives on this device, per account, per project. */
function _projFilesKey(id){ return 'amv_projfiles_' + id; }
function _projFiles(id){ try{ const l = load(_projFilesKey(id)); return Array.isArray(l) ? l : []; }catch(e){ return []; } }
/* store() reports a full device itself and does not throw, so whether the
   files were kept is read back rather than assumed. */
function _projSaveFiles(id, list){
  const want = (list || []).slice(0, PROJ_FILES_MAX);
  store(_projFilesKey(id), want);
  const back = load(_projFilesKey(id));
  return Array.isArray(back) && back.length === want.length;
}

function _curProject(){
  try{ const c = getCurConv(); return c && c.wsId ? _wsById(c.wsId) : null; }catch(e){ return null; }
}

/* What a chat inside a project is told. Empty outside one. */
function _projectContext(){
  const ws = _curProject();
  if(!ws) return '';
  let out = '\n\nPROJECT: ' + String(ws.name || 'Project').slice(0, 80)
    + '. This conversation belongs to it, and everything below applies to it.';
  const instr = String(ws.instructions || '').trim();
  if(instr) out += '\nProject instructions (from the person - follow them):\n' + instr.slice(0, PROJ_INSTR_MAX);
  const mem = (ws.memory || []).map(m => m && m.text).filter(Boolean);
  if(mem.length) out += '\nWhat AMV has learned within this project: ' + mem.slice(0, PROJ_MEM_MAX).join('; ');
  const files = _projFiles(ws.id);
  if(files.length){
    let room = PROJ_CTX_CHARS; const left = [];
    out += '\nProject files (the person’s own documents - quote and use them):';
    for(const f of files){
      const body = String(f.text || '');
      if(body.length <= room){ out += '\n=== ' + f.name + ' ===\n' + body; room -= body.length; }
      else left.push(f.name);
    }
    if(left.length) out += '\n(Not included, too large for one request alongside the rest: ' + left.join(', ') + '. Say so if the question needs them.)';
  }
  return out;
}

/* Memory learned in a project chat goes to the project. */
function _projAddMemory(ws, facts){
  const known = new Set((ws.memory || []).map(m => String(m.text || '').toLowerCase().trim()));
  const fresh = facts.filter(f => typeof f === 'string' && f.trim() && !_memDuplicate(f, known)).slice(0, 5);
  if(!fresh.length) return 0;
  ws.memory = fresh.map(f => ({ id: 'pm' + Date.now() + Math.random().toString(36).slice(2, 5), text: f.trim().slice(0, 300), added: Date.now(), auto: true }))
    .concat(ws.memory || []).slice(0, PROJ_MEM_MAX);
  _wsTouch(ws);
  return fresh.length;
}

function newChatInProject(id){
  const ws = _wsById(id); if(!ws) return;
  _leaveTempChats(null);
  const c = newConvObj((ws.name || T('Project')) + ' · ' + T('New chat'));
  c.wsId = id;
  S.convs = [c].concat(S.convs || []);
  S.cur = c.id;
  _autoSave(); closeOvr(); setTab('chat'); renderHist();
}

/* ── The project page ───────────────────────────────────────────────────── */
function openProjectPanel(id){
  const ws = _wsById(id); if(!ws) return;
  const r = $('ovr'); if(!r) return;
  r.innerHTML = '<div class="ov" id="pj-bg"><div class="ob pj-ob" role="dialog" aria-modal="true" aria-labelledby="pj-h">'
    + '<button class="oc" data-dact="closeOvr" aria-label="' + escH(T('Close')) + '">×</button>'
    + '<h2 id="pj-h">' + _safeIcon(ws.icon) + ' ' + escH(ws.name || T('Project')) + '</h2>'
    + '<p class="ob-sub">' + escH(T('Every chat in this project is given its instructions, its files and what AMV has learned in it.')) + '</p>'
    + '<button type="button" class="btn bp pj-new" data-dact="newChatInProject" data-darg="' + escH(ws.id) + '">' + escH(T('New chat in this project')) + '</button>'
    + '<div id="pj-body"></div></div></div>';
  _renderProjectPanel(id);
}
function _renderProjectPanel(id){
  const ws = _wsById(id), body = $('pj-body'); if(!ws || !body) return;
  const files = _projFiles(id);
  const chats = (S.convs || []).filter(c => c && c.wsId === id);
  const used = files.reduce((n, f) => n + String(f.text || '').length, 0);
  body.innerHTML =
    '<h3 class="shelf-h3"><label for="pj-instr">' + escH(T('Instructions')) + '</label></h3>'
    + '<textarea id="pj-instr" class="pj-instr" rows="4" maxlength="' + PROJ_INSTR_MAX + '" placeholder="'
      + escH(T('How AMV should work in this project - who it is for, tone, what to always or never do.')) + '">'
      + escH(ws.instructions || '') + '</textarea>'
    + '<div class="pj-row"><button type="button" class="btn mc-mini" id="pj-save">' + escH(T('Save instructions')) + '</button><span class="pj-note" id="pj-saved" role="status"></span></div>'
    + '<h3 class="shelf-h3">' + escH(T('Files')) + ' <button type="button" class="btn mc-mini ghost" id="pj-add">' + escH(T('Add files')) + '</button></h3>'
    + '<input type="file" id="pj-file" multiple hidden>'
    + '<p class="pj-note">' + escH(T('Kept on this device. Chats here can read them; other devices see the project without them.'))
      + (files.length ? ' ' + (used < 1000 ? used.toLocaleString() : Math.round(used / 1000) + 'k') + ' / ' + Math.round(PROJ_CTX_CHARS / 1000) + 'k ' + escH(T('characters sent with each message.')) : '') + '</p>'
    + (files.length ? files.map(f => '<div class="shelf-row"><div class="shelf-t"><div class="shelf-name">' + escH(f.name) + '</div>'
        + '<div class="shelf-meta">' + escH(f.summary || (Math.round(String(f.text || '').length / 1000) + 'k ' + T('characters'))) + '</div></div>'
        + '<div class="shelf-acts"><button type="button" class="btn mc-mini ghost" data-pj-rm="' + escH(f.id) + '">' + escH(T('Remove')) + '</button></div></div>').join('')
      : '<p class="shelf-empty">' + escH(T('No files yet. Add documents, spreadsheets, decks or notes this project should always know.')) + '</p>')
    + '<h3 class="shelf-h3">' + escH(T('Learned in this project')) + '</h3>'
    + ((ws.memory || []).length ? (ws.memory || []).map(m => '<div class="shelf-row"><div class="shelf-t"><div class="shelf-name pj-mem">' + escH(m.text) + '</div></div>'
        + '<div class="shelf-acts"><button type="button" class="btn mc-mini ghost" data-pj-forget="' + escH(m.id) + '">' + escH(T('Forget')) + '</button></div></div>').join('')
      : '<p class="shelf-empty">' + escH(T('Nothing yet. What AMV learns in these chats stays here, apart from your general memory.')) + '</p>')
    + '<h3 class="shelf-h3">' + escH(T('Chats')) + '</h3>'
    + (chats.length ? chats.slice(0, 12).map(c => '<div class="shelf-row"><div class="shelf-t"><div class="shelf-name">' + escH(c.title || T('New Conversation')) + '</div></div>'
        + '<div class="shelf-acts"><button type="button" class="btn mc-mini" data-dact="loadConv" data-darg="' + escH(c.id) + '">' + escH(T('Open')) + '</button></div></div>').join('')
      : '<p class="shelf-empty">' + escH(T('No chats yet.')) + '</p>');

  on($('pj-save'), 'click', () => {
    ws.instructions = String(($('pj-instr') || {}).value || '').slice(0, PROJ_INSTR_MAX);
    _wsTouch(ws);
    const s = $('pj-saved'); if(s) s.textContent = T('Saved. The next message in this project follows it.');
  });
  on($('pj-add'), 'click', () => { const i = $('pj-file'); if(i) i.click(); });
  on($('pj-file'), 'change', async function(){
    const picked = Array.from(this.files || []); this.value = '';
    let list = _projFiles(id);
    for(const f of picked){
      if(list.length >= PROJ_FILES_MAX){ toast(T('A project holds up to') + ' ' + PROJ_FILES_MAX + ' ' + T('files.'), 'error', 6000); break; }
      const r = await amvReadFile(f);
      if(r.kind === 'refused'){ toast(r.reason, 'error', 9000); continue; }
      if(r.kind !== 'text'){ toast('“' + f.name + '” ' + T('is a picture or PDF. Project files are read as text - attach those in a chat instead.'), 'error', 9000); continue; }
      list = [{ id: 'pf' + Date.now() + Math.random().toString(36).slice(2, 5), name: f.name, format: r.format || '', summary: r.summary || '', text: r.data, added: Date.now() }]
        .concat(list.filter(x => x.name !== f.name));
    }
    if(!_projSaveFiles(id, list)) toast(T('This device is out of space for project files. Remove one and try again.'), 'error', 9000);
    _renderProjectPanel(id);
  });
  body.querySelectorAll('[data-pj-rm]').forEach(b => on(b, 'click', () => {
    _projSaveFiles(id, _projFiles(id).filter(f => f.id !== b.dataset.pjRm)); _renderProjectPanel(id);
  }));
  body.querySelectorAll('[data-pj-forget]').forEach(b => on(b, 'click', () => {
    ws.memory = (ws.memory || []).filter(m => m.id !== b.dataset.pjForget); _wsTouch(ws); _renderProjectPanel(id);
  }));
}

/* A line at the top of a project chat, so it is never a mystery why AMV knows
   what it knows here. */
function _projectBannerHTML(){
  const ws = _curProject();
  if(!ws) return '';
  const n = _projFiles(ws.id).length;
  return '<div class="temp-row"><div class="temp-banner pj-banner" role="note"><b>' + _safeIcon(ws.icon) + ' ' + escH(ws.name || T('Project')) + '</b> · '
    + escH(T('uses this project’s instructions')) + (n ? ', ' + n + ' ' + escH(n === 1 ? T('file') : T('files')) : '') + ' '
    + escH(T('and memory.')) + ' <button type="button" class="pj-manage" data-dact="openProjectPanel" data-darg="' + escH(ws.id) + '">' + escH(T('Manage')) + '</button></div></div>';
}
try{ Object.assign(window, { openProjectPanel, newChatInProject }); }catch(e){}
