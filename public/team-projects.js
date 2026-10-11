/* SHARED PROJECTS - a team edits one project together.

   Fetched the first time it is needed (_teamProjLoad in 07b-projects.js): when
   a project page opens for somebody in a team, or the team page is drawn. A
   classic script, so it lands on window and uses the page's own helpers.

   THE MODEL. The server holds the project (teamProjectSave in the Worker): its
   name, instructions and text files, a revision number, and the instructions
   each save replaced. Each member's AMV keeps a MIRROR - an ordinary project
   with `team: { id, rev, synced }` on it - so chats in it read instructions
   and files exactly as they read any project's, with no network on the way.

     - Opening the project fetches the latest and brings the mirror up to date.
     - A change made here (instructions saved, a file added or removed) is
       noticed by comparing the mirror with what was last synced, and sent
       with the revision it was made from.
     - If a colleague saved in between, the server refuses it and says what is
       there now. Both versions are shown and the person chooses: keep theirs,
       or save mine over it - knowingly. Nothing is overwritten unseen.

   What AMV learns in a project's chats stays each person's own; the assistant
   settings (starters, engine) are per person too. Only what the team agreed
   to share - instructions and files - is shared. */
const TP_FILES_MAX = 20, TP_INSTR_MAX = 4000;

async function _tpCall(path, body){
  let r;
  try{ r = await AMV_API._fetch(path, { method:'POST', body: JSON.stringify(body || {}) }); }
  catch(e){ return { ok:false, offline:true, error: T('AMV could not reach the server. Your changes are kept here and will be sent when you are back online.') }; }
  const d = await r.json().catch(() => ({}));
  return Object.assign({ status: r.status }, d, { ok: r.ok && !!d.ok });
}

/* A fingerprint of the files, so "changed since last synced" is a comparison,
   not a guess. */
function _tpHash(s){ let h = 5381; s = String(s || ''); for(let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function _tpFilesSig(files){ return (files || []).map(f => f.id + ':' + f.name + ':' + String(f.text || '').length + ':' + _tpHash(f.text)).join('|'); }
function _tpDirty(ws){
  const s = ws.team && ws.team.synced; if(!s) return false;
  return String(ws.instructions || '') !== String(s.instructions || '') || _tpFilesSig(_projFiles(ws.id)) !== s.files;
}
function _tpWho(email){ const me = (S.user && S.user.email || '').toLowerCase(); return email && email.toLowerCase() === me ? T('you') : String(email || '').split('@')[0] || T('a teammate'); }
function _tpWhen(ts){ try{ return ts ? new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : ''; }catch(e){ return ''; } }

/* Make the mirror what the server says, and remember that as synced. */
function _tpAdopt(ws, p){
  ws.name = p.name || ws.name;
  if(p.icon) ws.icon = p.icon;
  ws.instructions = String(p.instructions || '');
  const files = (p.files || []).slice(0, TP_FILES_MAX).map(f => ({ id: f.id, name: f.name, text: f.text, added: f.at || Date.now(), by: f.by }));
  _projSaveFiles(ws.id, files);
  ws.team = { id: p.id, rev: p.rev, by: p.updatedBy, at: p.updated, createdBy: p.createdBy, history: (p.history || []).slice(0, 20),
              synced: { instructions: ws.instructions, files: _tpFilesSig(files) } };
  _wsTouch(ws);
}
function _tpPayload(ws){
  return { instructions: String(ws.instructions || '').slice(0, TP_INSTR_MAX),
           files: _projFiles(ws.id).slice(0, TP_FILES_MAX).map(f => ({ id: f.id, name: f.name, text: String(f.text || ''), by: f.by, at: f.added })) };
}

/* Send what changed here. Returns a state for the panel to show. */
async function _tpPush(ws, force){
  if(!ws.team || (!force && !_tpDirty(ws))) return { state:'synced' };
  const body = Object.assign({ id: ws.team.id, baseRev: ws.team.rev }, _tpPayload(ws));
  const d = await _tpCall('/team/project/save', body);
  if(d.ok){ _tpAdopt(ws, d.project); return { state:'saved' }; }
  if(d.code === 'conflict' && d.project) return { state:'conflict', theirs: d.project };
  if(d.code === 'gone' || d.status === 404) return _tpOrphan(ws, d);
  return { state:'error', error: d.error || T('Your change could not be sent. It is kept here - try again.') };
}
/* Fetch the latest. Local changes nobody has sent yet are sent first, so a
   pull can never quietly replace them. */
async function _tpPull(ws){
  if(!ws.team) return { state:'none' };
  if(_tpDirty(ws)) return _tpPush(ws);
  const d = await _tpCall('/team/project/get', { id: ws.team.id });
  if(d.ok){ if(d.project.rev !== ws.team.rev) _tpAdopt(ws, d.project); return { state:'synced' }; }
  if(d.code === 'gone' || d.status === 404) return _tpOrphan(ws, d);
  return { state:'error', error: d.error || T('The latest version could not be fetched.') };
}
/* The project was removed from the team, or this person left it. Their copy
   stays, as a personal project, and they are told which. */
function _tpOrphan(ws, d){
  delete ws.team; _wsTouch(ws);
  return { state:'orphan', error: d && d.code === 'gone'
    ? T('This project was removed from the team. Your copy stays here as a personal project.')
    : T('You are no longer in the team that shared this project. Your copy stays here as a personal project.') };
}

/* The team section of a project's page. */
async function _tpPanel(ws, el, pre){
  if(!el) return;
  const live = !!(window.AMVTeam && AMVTeam.enabled());
  if(!ws.team){
    if(!live || ws.third){ el.innerHTML = ''; return; }
    el.innerHTML = '<div class="tp-box"><div class="tp-h">' + escH(T('Edit it together')) + '</div>'
      + '<p class="pj-note">' + escH(T('Share this project with your team. Everyone can then edit its instructions and files, and every chat in it - theirs and yours - uses the latest version. What AMV learns in your chats stays yours.')) + '</p>'
      + '<button type="button" class="btn mc-mini" id="tp-share">' + escH(T('Share with my team for editing')) + '</button><span class="pj-note" id="tp-said" role="status" aria-live="polite"></span></div>';
    on($('tp-share'), 'click', async () => {
      const b = $('tp-share'); if(b) b.disabled = true;
      const p = _tpPayload(ws);
      const d = await _tpCall('/team/project/create', { name: ws.name, icon: ws.icon, instructions: p.instructions, files: p.files });
      if(d.ok){ _tpAdopt(ws, d.project); toast(T('Shared. Your team can now edit this project with you.'), 'success', 5000); _tpPanel(ws, el); }
      else { const s = $('tp-said'); if(s) s.textContent = d.error || T('It could not be shared.'); if(b) b.disabled = false; }
    });
    return;
  }
  el.innerHTML = '<div class="tp-box"><div class="tp-h">' + escH(T('Shared with your team')) + '</div><p class="pj-note" role="status">' + escH(T('Checking for changes…')) + '</p></div>';
  const r = pre || await _tpPull(ws);
  if(r.state === 'orphan'){ el.innerHTML = '<div class="tp-box"><p class="pj-note">' + escH(r.error) + '</p></div>'; return; }
  /* Pulling may have changed the instructions and files on this page. */
  if(!pre && r.state !== 'error' && r.state !== 'conflict'){ const ta = $('pj-instr'); if(ta && ta.value !== ws.instructions && document.activeElement !== ta) { _renderProjectPanel(ws.id); return; } }
  if(r.state === 'conflict') return _tpConflict(ws, el, r.theirs);
  const t = ws.team;
  el.innerHTML = '<div class="tp-box"><div class="tp-h">' + escH(T('Shared with your team')) + '</div>'
    + '<p class="pj-note">' + escH(T('Version') + ' ' + t.rev + ' · ' + T('last changed by') + ' ' + _tpWho(t.by) + ', ' + _tpWhen(t.at) + '. '
        + T('Changes to instructions and files go to everyone; what AMV learns in your chats stays yours.')) + '</p>'
    + (r.state === 'error' ? '<p class="pj-note tp-err" role="alert">' + escH(r.error) + ' <button type="button" class="skill-link" id="tp-retry">' + escH(T('Try again')) + '</button></p>' : '')
    + (r.state === 'saved' ? '<p class="pj-note" role="status">' + escH(T('Saved for the whole team.')) + '</p>' : '')
    + ((t.history || []).length ? '<details class="tp-hist"><summary>' + escH(T('Earlier instructions')) + ' (' + t.history.length + ')</summary>'
        + t.history.map((h, i) => '<div class="skill-hist"><div class="skill-hist-h">' + escH(T('Version') + ' ' + h.rev + ' · ' + _tpWho(h.by) + ' · ' + _tpWhen(h.at))
          + ' <button type="button" class="skill-link" data-tp-restore="' + i + '">' + escH(T('Restore')) + '</button></div><pre class="skill-hist-t">' + escH(h.instructions || '') + '</pre></div>').join('') + '</details>' : '')
    + '<button type="button" class="skill-link pl-del" id="tp-remove">' + escH(T('Stop sharing')) + '</button></div>';
  on($('tp-retry'), 'click', () => _tpPanel(ws, el));
  el.querySelectorAll('[data-tp-restore]').forEach(b => on(b, 'click', async () => {
    const h = (ws.team.history || [])[+b.dataset.tpRestore]; if(!h) return;
    ws.instructions = String(h.instructions || ''); _wsTouch(ws);
    const res = await _tpPush(ws);
    _renderProjectPanel(ws.id);
    if(res.state === 'saved') toast(T('Restored as a new version, for the whole team.'), 'success', 4000);
  }));
  on($('tp-remove'), 'click', async () => {
    const yes = await _askDestructive(T('Stop sharing this project?'), T('It is removed from the team for everyone - only whoever shared it or a team admin can do this. Your copy stays here as a personal project.'), T('Stop sharing'));
    if(!yes){ openProjectPanel(ws.id); return; }
    const d = await _tpCall('/team/project/delete', { id: ws.team.id });
    if(d.ok || d.code === 'gone'){ delete ws.team; _wsTouch(ws); toast(T('No longer shared. It is your personal project again.'), 'success', 5000); }
    else toast(d.error || T('It could not be removed.'), 'error', 7000);
    openProjectPanel(ws.id);
  });
}

/* Somebody else saved first. Both versions, side by side, and a choice. */
function _tpConflict(ws, el, theirs){
  const mine = String(ws.instructions || ''), their = String(theirs.instructions || '');
  const filesDiffer = _tpFilesSig(_projFiles(ws.id)) !== _tpFilesSig((theirs.files || []).map(f => ({ id: f.id, name: f.name, text: f.text })));
  el.innerHTML = '<div class="tp-box tp-conflict" role="alert"><div class="tp-h">' + escH(_tpWho(theirs.updatedBy) + ' ' + T('saved a newer version while you were editing')) + '</div>'
    + '<p class="pj-note">' + escH(T('Nothing has been overwritten. Choose which version the team keeps.')) + '</p>'
    + (mine !== their ? '<div class="tp-cols"><div><div class="tp-col-h">' + escH(T('Theirs')) + '</div><pre class="skill-hist-t">' + escH(their) + '</pre></div>'
        + '<div><div class="tp-col-h">' + escH(T('Yours')) + '</div><pre class="skill-hist-t">' + escH(mine) + '</pre></div></div>' : '')
    + (filesDiffer ? '<p class="pj-note">' + escH(T('The files differ too: theirs has') + ' ' + (theirs.files || []).length + ', ' + T('yours has') + ' ' + _projFiles(ws.id).length + '.') + '</p>' : '')
    + '<div class="pl-btns"><button type="button" class="btn bs" id="tp-theirs">' + escH(T('Keep theirs')) + '</button>'
    + '<button type="button" class="btn bp" id="tp-mine">' + escH(T('Save mine over it')) + '</button></div></div>';
  on($('tp-theirs'), 'click', () => { _tpAdopt(ws, theirs); _renderProjectPanel(ws.id); });
  on($('tp-mine'), 'click', async () => {
    ws.team.rev = theirs.rev;   /* knowingly, from the version just shown */
    const res = await _tpPush(ws, true);
    if(res.state === 'conflict') return _tpConflict(ws, el, res.theirs);
    _renderProjectPanel(ws.id);
  });
}

/* The team page: the team's shared projects, each one press from opening. */
async function _tpTeamList(el){
  if(!el) return;
  const d = await _tpCall('/team/project/list', {});
  if(!d.ok){ el.innerHTML = '<p class="pj-note">' + escH(d.error || T('Shared projects could not be loaded.')) + '</p>'; return; }
  const list = d.projects || [];
  el.innerHTML = list.length
    ? '<div class="team-shared-list">' + list.map(p => '<div class="team-shared-row"><span class="tsr-ic">' + _safeIcon(p.icon || '📁') + '</span>'
        + '<div class="tsr-main"><b>' + escH(p.name) + '</b><span>' + escH(T('Version') + ' ' + p.rev + ' · ' + T('changed by') + ' ' + _tpWho(p.updatedBy) + ', ' + _tpWhen(p.updated)) + '</span></div>'
        + '<button class="btn bs tsr-use" data-tp-open="' + escH(p.id) + '" style="font-size:var(--t-xs)">' + escH(T('Open')) + '</button></div>').join('') + '</div>'
    : '<p class="pj-note">' + escH(T('No shared projects yet. Open any project and choose “Share with my team for editing”.')) + '</p>';
  el.querySelectorAll('[data-tp-open]').forEach(b => on(b, 'click', () => _tpOpen(b.dataset.tpOpen, list.find(p => p.id === b.dataset.tpOpen))));
}
/* Open a shared project: this person's mirror of it, made on first open. */
function _tpOpen(id, summary){
  let ws = (S.workspaces || []).find(w => w && w.team && w.team.id === id);
  if(!ws){
    ws = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: (summary && summary.name) || T('Shared project'),
      icon: (summary && summary.icon) || '📁', instructions: '', memory: [], convs: [], created: Date.now(), updated: Date.now(),
      team: { id, rev: 0, synced: { instructions: '', files: '' } } };
    S.workspaces = [ws].concat(S.workspaces || []);
    _saveWorkspaces(S.workspaces);
  }
  openProjectPanel(ws.id);
}
try{ Object.assign(window, { _tpPanel, _tpTeamList, _tpOpen, _tpPush, _tpPull }); }catch(e){}
