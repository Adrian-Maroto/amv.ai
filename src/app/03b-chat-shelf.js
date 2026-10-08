/* ── ARCHIVE AND TRASH ───────────────────────────────────────────────────────

   Archive takes a chat out of Recents without losing anything. Delete moves it
   to Trash, which keeps it for 30 days. Both can be undone from the Archived &
   Trash screen, and Trash can be emptied for good. The storage side - why a
   chat is marked rather than removed, and why the marked ones never sit in
   S.convs - is explained at _CONV_SHELF. */

function _shelveConv(id, how){
  const c = (S.convs || []).find(x => x && x.id === id);
  if(!c) return;
  if(c.temp){
    /* A temporary chat was never saved, so there is nothing to keep. */
    _dropLive(id);
    return;
  }
  const now = Date.now();
  c[how] = now; c.updated = now;
  _CONV_SHELF = [c].concat(_CONV_SHELF.filter(x => x && x.id !== id));
  _dropLive(id);
  toast(how === 'archived'
    ? T('Archived. It is under Archived & Trash at the bottom of your chats.')
    : T('Moved to Trash. It is kept for 30 days - restore it from Archived & Trash.'), 'success', 5000);
}
/* Out of the live list, keeping one chat open and telling sync about it -
   reassigning S.convs is what schedules the push. */
function _dropLive(id){
  let live = (S.convs || []).filter(c => c && c.id !== id);
  if(!live.length) live = [newConvObj()];
  S.convs = live;
  if(S.cur === id || !live.some(c => c.id === S.cur)) S.cur = live[0].id;
  _autoSave(); renderHist();
  if(S.tab === 'chat'){ try{ renderChatMsgs(); }catch(e){} }
}
function archiveConv(id){ _shelveConv(id, 'archived'); }

function restoreConv(id){
  const c = _CONV_SHELF.find(x => x && x.id === id);
  if(!c || c.gone) return;
  delete c.archived; delete c.trashed;
  c.updated = Date.now();
  _CONV_SHELF = _CONV_SHELF.filter(x => x && x.id !== id);
  S.convs = [c].concat((S.convs || []).filter(x => x && x.id !== id));
  _autoSave(); renderHist();
  toast(T('Restored to your chats.'), 'success', 3500);
  _renderChatShelf();
}
/* For good: the content is dropped here and on every device that syncs, and a
   content-free marker is kept so a device that was offline learns of it. */
async function purgeConv(id){
  const c = _CONV_SHELF.find(x => x && x.id === id);
  if(!c || c.gone) return;
  const yes = await showConfirmAsync(T('Delete this chat for good? This cannot be undone.'));
  if(!yes) return;
  _CONV_SHELF = _CONV_SHELF.map(x => x && x.id === id ? _convTomb(x) : x);
  _shelfChanged();
}
async function emptyTrash(){
  const n = _CONV_SHELF.filter(x => x && x.trashed && !x.gone).length;
  if(!n) return;
  const yes = await showConfirmAsync(T('Delete the') + ' ' + n + ' ' + (n === 1 ? T('chat in Trash for good?') : T('chats in Trash for good?')) + ' ' + T('This cannot be undone.'));
  if(!yes) return;
  _CONV_SHELF = _CONV_SHELF.map(x => x && x.trashed && !x.gone ? _convTomb(x) : x);
  _shelfChanged();
}
/* The shelf is not a state key, so a change to it alone has to save and
   schedule the push itself. */
function _shelfChanged(){
  _autoSave();
  try{ if(typeof AMVSync !== 'undefined') AMVSync.push(); }catch(e){}
  renderHist();
  _renderChatShelf();
}

function _shelfCounts(){
  let archived = 0, trashed = 0;
  for(const c of _CONV_SHELF){ if(!c || c.gone) continue; if(c.trashed) trashed++; else if(c.archived) archived++; }
  return { archived, trashed };
}

function openChatShelf(){
  const r = $('ovr'); if(!r) return;
  r.innerHTML = '<div class="ov" id="shelf-bg"><div class="ob shelf-ob" role="dialog" aria-modal="true" aria-labelledby="shelf-h">'
    + '<button class="oc" data-dact="closeOvr" aria-label="' + escH(T('Close')) + '">×</button>'
    + '<h2 id="shelf-h">' + escH(T('Archived & Trash')) + '</h2>'
    + '<div id="shelf-body"></div></div></div>';
  _renderChatShelf();
}
function _renderChatShelf(){
  const body = $('shelf-body'); if(!body) return;
  const day = ts => { try{ return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }); }catch(e){ return ''; } };
  const row = (c, kind) => {
    const left = kind === 'trash' ? Math.max(0, Math.ceil((c.trashed + _SHELF_TRASH_MS - Date.now()) / 864e5)) : 0;
    return '<div class="shelf-row">'
      + '<div class="shelf-t"><div class="shelf-name">' + escH(c.title || T('New Conversation')) + '</div>'
      + '<div class="shelf-meta">' + escH(kind === 'trash'
          ? T('Deleted') + ' ' + day(c.trashed) + ' · ' + left + ' ' + (left === 1 ? T('day left') : T('days left'))
          : T('Archived') + ' ' + day(c.archived)) + '</div></div>'
      + '<div class="shelf-acts">'
      + '<button type="button" class="btn mc-mini" data-dact="restoreConv" data-darg="' + escH(c.id) + '">' + escH(T('Restore')) + '</button>'
      + (kind === 'trash' ? '<button type="button" class="btn mc-mini ghost" data-dact="purgeConv" data-darg="' + escH(c.id) + '">' + escH(T('Delete for good')) + '</button>' : '')
      + '</div></div>';
  };
  const arch = _CONV_SHELF.filter(c => c && !c.gone && c.archived && !c.trashed);
  const trash = _CONV_SHELF.filter(c => c && !c.gone && c.trashed);
  body.innerHTML =
    '<h3 class="shelf-h3">' + escH(T('Archived')) + '</h3>'
    + (arch.length ? arch.map(c => row(c, 'arch')).join('') : '<p class="shelf-empty">' + escH(T('Nothing archived. Archive a chat from its menu to tidy Recents without losing it.')) + '</p>')
    + '<h3 class="shelf-h3">' + escH(T('Trash')) + (trash.length ? ' <button type="button" class="btn mc-mini ghost shelf-empty-btn" data-dact="emptyTrash">' + escH(T('Empty Trash')) + '</button>' : '') + '</h3>'
    + (trash.length ? trash.map(c => row(c, 'trash')).join('') : '<p class="shelf-empty">' + escH(T('Trash is empty. Deleted chats wait here for 30 days.')) + '</p>');
}
try{ Object.assign(window, { archiveConv, restoreConv, purgeConv, emptyTrash, openChatShelf }); }catch(e){}
