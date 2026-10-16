/* YOUR FILES - the library screen. Fetched the first time somebody opens it
   (_libScreenLoad in 05c-file-library.js), the way memory-io.js and the sell
   form are. A classic script, so it shares the page's helpers and state:
   _libAll, _libDb, _libCloudState and the rest stay in the page, because
   keeping a file happens on every send and must not wait for this. */
async function _libCloudRefresh(){
  if(!_libCloudOn()){ _libCloudState = { configured: null, files: null, error: '' }; return _libCloudState; }
  try{
    const d = await AMV_API.libraryList();
    _libCloudState = d && d.configured
      ? { configured: true, files: Array.isArray(d.files) ? d.files : [], used: d.used, limit: d.limit, error: '' }
      : { configured: false, files: null, error: '' };
  }catch(e){ _libCloudState = { configured: _libCloudState.configured, files: null, error: T('Your files in your account could not be checked just now.') }; }
  return _libCloudState;
}
/* A file only in the account, fetched and kept here too so it opens offline
   next time. */
async function _libCloudFetch(meta){
  const d = await AMV_API.libraryGet(meta.id);
  const keep = Object.assign({}, meta); delete keep.remote;   /* a copy HERE is not the account's row */
  const f = Object.assign(keep, { id: 'lf' + Date.now() + Math.random().toString(36).slice(2, 7),
    data: meta.kind === 'text' ? d.body : undefined, b64: meta.kind !== 'text' ? d.body : undefined, used: Date.now() });
  try{ const db = await _libDb(); if(db) await _libTx(db, 'readwrite', st => { st.put(f); }); }catch(e){}
  return f;
}

/* The library itself. With no `pick`, choosing a file attaches it to the
   message being written; a project passes its own `pick` and `only:'text'`. */
let _libOpts = {};
function _libOpenNow(opts){
  _libOpts = opts || {};
  const r = $('ovr'); if(!r) return;
  r.innerHTML = '<div class="ov" id="lib-bg"><div class="ob shelf-ob lib-ob" role="dialog" aria-modal="true" aria-labelledby="lib-h">'
    + '<button class="oc" data-dact="closeOvr" aria-label="' + escH(T('Close')) + '">×</button>'
    + '<h2 id="lib-h">' + escH(T('Your files')) + '</h2>'
    + '<p class="ob-sub">' + escH(T('Everything you have sent AMV in a chat, kept so you can use it again. Temporary chats add nothing here.')) + '</p>'
    + '<input type="search" id="lib-q" class="lib-q" placeholder="' + escH(T('Search your files')) + '" aria-label="' + escH(T('Search your files')) + '">'
    + '<div id="lib-body" aria-live="polite"><p class="shelf-empty">' + escH(T('Loading…')) + '</p></div></div></div>';
  on($('lib-q'), 'input', () => _renderFileLibrary());
  _renderFileLibrary();
}
let _libRenderSeq = 0;
async function _renderFileLibrary(){
  const seq = ++_libRenderSeq;
  const [local, cloud] = await Promise.all([_libAll(), _libCloudRefresh()]);
  const body = $('lib-body'); if(!body || seq !== _libRenderSeq) return;
  /* One list: this device's files, then the account's that are not here yet.
     Matched by content signature, so the same file is one row. */
  const cloudBySig = new Map(((cloud && cloud.files) || []).map(f => [f.sig, f]));
  const localSigs = new Set((local || []).map(f => f.sig));
  const remote = ((cloud && cloud.files) || []).filter(f => !localSigs.has(f.sig)).map(f => Object.assign({ remote: true }, f));
  const all = local === null && !remote.length ? null : (local || []).concat(remote);
  const deviceOnly = (local || []).filter(f => !cloudBySig.has(f.sig));
  if(all === null){
    body.innerHTML = '<p class="shelf-empty">' + escH(_libWho() ? T('This browser is not letting AMV keep files on this device (a private window can do that). Uploading from your device still works.') : T('Sign in to keep your files.')) + '</p>';
    return;
  }
  const q = String(($('lib-q') || {}).value || '').trim().toLowerCase();
  const only = _libOpts.only;
  const list = all.filter(f => (!only || f.kind === only) && (!q || String(f.name).toLowerCase().includes(q)));
  const day = ts => { try{ return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }); }catch(e){ return ''; } };
  const label = f => [f.format && _FR_LABEL[f.format] ? T(_FR_LABEL[f.format]) : (f.kind === 'img' ? T('Picture') : f.kind === 'pdf' ? 'PDF' : T('Text')),
    f.summary || '', f.size ? fmtSize(f.size) : '', T('Used') + ' ' + day(f.used),
    cloud && cloud.configured ? (f.remote ? T('In your account') : cloudBySig.has(f.sig) ? '' : T('This device only')) : ''].filter(Boolean).join(' · ');
  body.innerHTML = (list.length
    ? list.map(f => '<div class="shelf-row"><div class="shelf-t"><div class="shelf-name">' + escH(f.name) + '</div>'
        + '<div class="shelf-meta">' + escH(label(f)) + '</div></div>'
        + '<div class="shelf-acts"><button type="button" class="btn mc-mini" data-lib-use="' + escH(f.id) + '">' + escH(_libOpts.pick ? T('Add') : T('Attach')) + '</button>'
        + '<button type="button" class="btn mc-mini ghost" data-lib-rm="' + escH(f.id) + '" aria-label="' + escH(T('Delete') + ' ' + f.name) + '">' + escH(T('Delete')) + '</button></div></div>').join('')
    : '<p class="shelf-empty">' + escH(q ? T('No file matches that.')
        : only === 'text' ? T('No documents yet. Files you send in a chat appear here.')
        : T('Nothing yet. Files you send in a chat appear here, ready to use again.')) + '</p>')
    + (all.length && !q ? '<div class="lib-foot"><span class="pj-note">' + all.length + ' ' + escH(all.length === 1 ? T('file') : T('files')) + ' · '
        + escH(cloud && cloud.configured ? T('kept in your account, on every device you sign in on') : T('kept on this device only')) + '</span>'
        + (cloud && cloud.configured && deviceOnly.length
            ? '<button type="button" class="btn mc-mini" id="lib-up">' + escH(T('Keep {0} in your account too').replace('{0}', deviceOnly.length)) + '</button>' : '')
        + '<button type="button" class="btn mc-mini ghost" id="lib-clear">' + escH(T('Delete all')) + '</button></div>' : '')
    + (cloud && cloud.error ? '<p class="pj-note" role="status">' + escH(cloud.error) + '</p>' : '');
  body.querySelectorAll('[data-lib-use]').forEach(b => on(b, 'click', async () => {
    let f = all.find(x => x.id === b.dataset.libUse); if(!f) return;
    if(f.remote){
      b.disabled = true;
      try{ f = await _libCloudFetch(f); }
      catch(e){ b.disabled = false; toast(String((e && e.message) || T('That file could not be opened.')), 'error', 6000); return; }
    }
    if(_libOpts.pick){ _libOpts.pick(f); return; }
    S.att = _libAsAtt(f);
    closeOvr();
    try{ if(S.tab !== 'chat') setTab('chat'); }catch(e){}
    showAttChip();
    try{ const ta = $('mta'); if(ta) ta.focus(); }catch(e){}
  }));
  body.querySelectorAll('[data-lib-rm]').forEach(b => on(b, 'click', async () => {
    const f = all.find(x => x.id === b.dataset.libRm); if(!f) return;
    /* Deleted everywhere it is: this device and the account. */
    const inCloud = f.remote ? f : cloudBySig.get(f.sig);
    let okAll = true;
    if(!f.remote && !await _libRemove(f.id)) okAll = false;
    if(inCloud){ try{ await AMV_API.libraryDelete([inCloud.id]); }catch(e){ okAll = false; } }
    if(!okAll) toast(T('That file could not be deleted. Try again.'), 'error', 6000);
    _renderFileLibrary();
  }));
  on($('lib-up'), 'click', async () => {
    const btn = $('lib-up'); if(btn) btn.disabled = true;
    let kept = 0, failed = 0, stop = '';
    for(const f of deviceOnly){
      try{ await _libCloudPut(f); kept++; }
      catch(e){ failed++; if(e && (e.status === 409 || e.status === 413 || e.status === 429)){ stop = e.message; break; } }
    }
    toast(stop || (failed ? T('{0} kept in your account, {1} could not be. They are still on this device.').replace('{0}', kept).replace('{1}', failed)
                          : T('{0} kept in your account.').replace('{0}', kept)), failed || stop ? 'error' : 'success', 6000);
    _renderFileLibrary();
  });
  /* The question replaces the library on screen, so the library comes back
     whichever way it is answered. */
  on($('lib-clear'), 'click', async () => {
    const opts = _libOpts;
    const everywhere = !!(cloud && cloud.configured);
    const yes = await _askDestructive(T('Delete every file?'),
      everywhere ? T('This removes all of your files from this device and from your account. Chats that already used them keep what was said.')
                 : T('This removes all of your files from this device. Chats that already used them keep what was said.'), T('Delete all'));
    if(yes){
      let okAll = await _libRemove((local || []).map(f => f.id));
      const ids = ((cloud && cloud.files) || []).map(f => f.id);
      if(everywhere && ids.length){ try{ await AMV_API.libraryDelete(ids); }catch(e){ okAll = false; } }
      if(!okAll) toast(T('Your files could not be deleted. Try again.'), 'error', 6000);
    }
    openFileLibrary(opts);
  });
}
try{ Object.assign(window, { _libOpenNow }); }catch(e){}
