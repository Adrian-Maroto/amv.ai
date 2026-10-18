/* ── YOUR FILES ─────────────────────────────────────────────────────────────

   Everything a person has sent AMV in a chat, kept on this device so it can be
   attached again without finding it on disk a second time - to a new chat, or
   to a project.

   It lives in IndexedDB, not localStorage, and that is the decision that
   matters. localStorage is a few megabytes shared with every chat this account
   has; a library of pictures and PDFs kept there would fill it, and the first
   thing to fail would be saving conversations. IndexedDB has its own, far
   larger allowance. One database per account, so erasing an account's data is
   one deleteDatabase, and nothing of one person's is listed for the next.

   What is kept is what AMV already read - the extracted text of a document,
   the bytes of a picture or PDF - so attaching from here sends exactly what was
   sent the first time. Temporary chats add nothing. Bounded by count and size;
   the least recently used go first. */
const LIB_MAX_FILES = 200;
const LIB_MAX_CHARS = 150 * 1024 * 1024;     /* stored characters across all files */

function _libWho(){ try{ return (S.user && S.user.email) ? String(S.user.email).toLowerCase() : ''; }catch(e){ return ''; } }
function _libDbName(who){ return 'amv_files:' + who; }

/* Opens this account's library, or answers null: no account, or a browser
   that will not give AMV a database (some private windows). */
let _libDbP = null, _libDbWho = '';
function _libDb(){
  const who = _libWho();
  if(!who || typeof indexedDB === 'undefined') return Promise.resolve(null);
  if(_libDbP && _libDbWho === who) return _libDbP;
  _libForget();
  _libDbWho = who;
  _libDbP = new Promise(res => {
    let req;
    try{ req = indexedDB.open(_libDbName(who), 1); }catch(e){ res(null); return; }
    req.onupgradeneeded = () => { try{ req.result.createObjectStore('files', { keyPath: 'id' }); }catch(e){} };
    /* Let go whenever anything - an erase, another tab - needs the database
       gone; holding on would leave that delete waiting forever. */
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => { try{ db.close(); }catch(e){} if(_libDbWho === who) _libForget(); }; res(db); };
    req.onerror = () => res(null);
    req.onblocked = () => res(null);
  }).then(db => { if(!db) _libDbP = null; return db; });
  return _libDbP;
}
function _libTx(db, mode, fn){
  return new Promise((res, rej) => {
    let out;
    const tx = db.transaction('files', mode);
    tx.oncomplete = () => res(out);
    tx.onerror = () => rej(tx.error || new Error('library write failed'));
    tx.onabort = () => rej(tx.error || new Error('library write aborted'));
    out = fn(tx.objectStore('files'));
  });
}
async function _libAll(){
  const db = await _libDb(); if(!db) return null;
  return new Promise(res => {
    try{
      const r = db.transaction('files', 'readonly').objectStore('files').getAll();
      r.onsuccess = () => res((r.result || []).sort((a, b) => (b.used || 0) - (a.used || 0)));
      r.onerror = () => res(null);
    }catch(e){ res(null); }
  });
}
function _libBody(a){ return String(a.kind === 'text' ? (a.data || '') : (a.b64 || '')); }
/* Same file sent twice is one entry: name, kind and content, not the moment. */
function _libSig(a){
  const b = _libBody(a);
  let h = 2166136261;
  const step = Math.max(1, Math.floor(b.length / 4096));
  for(let i = 0; i < b.length; i += step){ h ^= b.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return [a.kind, a.name, b.length, h.toString(36)].join('|');
}

/* Keep what was just sent. A combined attachment keeps each file separately,
   because that is how somebody will look for it again. */
async function _libKeep(att){
  if(!att || att.kind === 'refused') return false;
  try{ if(typeof _isTempChat === 'function' && _isTempChat()) return false; }catch(e){}
  const parts = Array.isArray(att.parts) && att.parts.length ? att.parts : [att];
  const db = await _libDb(); if(!db) return false;
  const all = await _libAll() || [];
  const bySig = new Map(all.map(f => [f.sig, f]));
  const now = Date.now();
  const put = [];
  for(const a of parts){
    if(!a || !a.name || !_libBody(a)) continue;
    const sig = _libSig(a), old = bySig.get(sig);
    put.push(old ? Object.assign({}, old, { used: now })
      : { id: 'lf' + now + Math.random().toString(36).slice(2, 7), sig, kind: a.kind, name: String(a.name).slice(0, 240),
          size: a.size || 0, format: a.format || '', summary: a.summary || '', mime: a.mime || '',
          data: a.kind === 'text' ? a.data : undefined, b64: a.kind !== 'text' ? a.b64 : undefined,
          chars: _libBody(a).length, added: now, used: now });
  }
  if(!put.length) return false;
  /* The new ones go to the account as well, in the background - the chat
     never waits on it. A failure leaves the file on this device, which is
     what the library then says. */
  put.filter(p => !bySig.has(p.sig)).forEach(p => { _libCloudPut(p).catch(() => {}); });
  /* Over the bounds, the files used longest ago leave first. */
  const ids = new Set(put.map(p => p.id));
  const keep = put.concat(all.filter(f => !ids.has(f.id)));
  const drop = [];
  let chars = 0;
  keep.forEach((f, i) => { chars += f.chars || 0; if(i >= LIB_MAX_FILES || (chars > LIB_MAX_CHARS && i > 0)) drop.push(f.id); });
  try{
    await _libTx(db, 'readwrite', st => { put.forEach(p => st.put(p)); drop.forEach(id => st.delete(id)); });
    return true;
  }catch(e){ console.warn('[AMV] file library: could not keep the file', e); return false; }
}
async function _libRemove(ids){
  const db = await _libDb(); if(!db) return false;
  try{ await _libTx(db, 'readwrite', st => { [].concat(ids).forEach(id => st.delete(id)); }); return true; }
  catch(e){ console.warn('[AMV] file library: delete failed', e); return false; }
}
/* For erasing a device: the whole database goes, not its rows. */
function _libErase(who){
  who = String(who || '').toLowerCase(); if(!who || typeof indexedDB === 'undefined') return;
  if(_libDbWho === who) _libForget();
  try{ indexedDB.deleteDatabase(_libDbName(who)); }catch(e){}
}
/* The browser sign-ins of one account, erased from this device. Named the way
   web-live.js names them, so this works whether or not that file was loaded. */
async function _webJarErase(who){
  if(!who || typeof indexedDB === 'undefined' || !(window.crypto && crypto.subtle)) return;
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('amv-webjar:' + who));
  const acct = [...new Uint8Array(h)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  const req = indexedDB.open('amv-webjar', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onsuccess = () => {
    const db = req.result;
    try{
      const st = db.transaction('kv', 'readwrite').objectStore('kv');
      st.delete('key:' + acct); st.delete('sites:' + acct);
      const cur = st.openCursor();
      cur.onsuccess = () => { const c = cur.result; if(!c) return; if(String(c.key).indexOf('jar:' + acct + ':') === 0) c.delete(); c.continue(); };
      st.transaction.oncomplete = () => db.close();
    }catch(e){ db.close(); }
  };
}
/* Signing out closes the door; the files stay in that account's database. */
function _libForget(){
  const p = _libDbP; _libDbP = null; _libDbWho = '';
  if(p) p.then(db => { try{ db && db.close(); }catch(e){} });
}

/* ── THE SAME FILES IN THE ACCOUNT ─────────────────────────────────────────
   Kept on the server when the deployment has file storage switched on, so
   another device signed in to the same account sees them. Each answer is
   believed only as far as it goes: `configured:false` means this AMV keeps
   files per device, and a failed request means "could not check", never
   "you have none". */
let _libCloudState = { configured: null, files: null, error: '' };
function _libCloudOn(){ try{ return !!(window.AMV_API && AMV_API.live && AMV_API.token && _libWho()); }catch(e){ return false; } }
async function _libCloudPut(f){
  if(!_libCloudOn() || _libCloudState.configured === false) return null;
  const body = _libBody(f); if(!body) return null;
  return await AMV_API.libraryPut({ sig: f.sig, kind: f.kind, name: f.name, size: f.size || 0, format: f.format || '',
    summary: f.summary || '', mime: f.mime || '', folder: f.folder || '', body });
}
/* A library entry back into the shape the chat sends. */
function _libAsAtt(f){
  return f.kind === 'text'
    ? { kind: 'text', name: f.name, size: f.size, data: f.data, format: f.format || undefined, summary: f.summary || undefined }
    : { kind: f.kind, name: f.name, size: f.size, b64: f.b64, mime: f.mime };
}

/* ── The paperclip: upload, or pick from what is already here ──────────── */
function _attachMenu(anchor){
  document.querySelectorAll('.ctxm').forEach(x => x.remove());
  const menu = document.createElement('div');
  menu.className = 'ctxm'; menu.setAttribute('role', 'menu');
  menu.innerHTML = '<button type="button" class="ctxi" role="menuitem" data-att="upload">' + escH(T('Upload from this device')) + '</button>'
    + '<button type="button" class="ctxi" role="menuitem" data-att="library">' + escH(T('Your files')) + '</button>';
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px';
  const above = r.top - menu.offsetHeight - 6;
  menu.style.top = (above > 8 ? above : Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)) + 'px';
  const close = () => { menu.remove(); document.removeEventListener('click', away); document.removeEventListener('keydown', esc, true); };
  const away = e => { if(!menu.contains(e.target)) close(); };
  const esc = e => { if(e.key === 'Escape'){ close(); try{ anchor.focus(); }catch(_){} } };
  menu.querySelector('[data-att="upload"]').addEventListener('click', () => { close(); const fi = $('fi'); if(fi) fi.click(); });
  menu.querySelector('[data-att="library"]').addEventListener('click', () => { close(); openFileLibrary(); });
  document.addEventListener('keydown', esc, true);
  setTimeout(() => document.addEventListener('click', away), 30);
  try{ menu.querySelector('.ctxi').focus(); }catch(e){}
}

/* The library screen lives in library.js, fetched the first time it is
   opened - most visits never open it, and the page ships to every one. */
let _libScreenP = null;
function _libScreenLoad(){
  if(typeof window._libOpenNow === 'function') return Promise.resolve(true);
  if(!_libScreenP) _libScreenP = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'library.js';
    sc.onload = () => res(typeof window._libOpenNow === 'function');
    sc.onerror = () => { _libScreenP = null; sc.remove(); res(false); };
    document.head.appendChild(sc);
  }).then(ok => { if(!ok) toast(T('That could not be loaded. Check your connection and try again.'), 'error', 6000); return ok; });
  return _libScreenP;
}
function openFileLibrary(opts){ _libScreenLoad().then(ok => { if(ok) window._libOpenNow(opts); }); }
try{ Object.assign(window, { openFileLibrary }); }catch(e){}
