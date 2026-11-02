/* ══════════════════════════════════════════════════════════════════════════
   YOUR FILES, IN YOUR ACCOUNT - NOT ONLY ON THE DEVICE THAT SENT THEM.

   The file library lived in one browser's IndexedDB. Upload a contract on the
   laptop, open AMV on the phone, and it was not there - which is the moment a
   library is for. This keeps the same files in the account, so every device
   signed in to it sees the same list.

   WHERE THE BYTES GO. Object storage (R2, bound as AMV_FILES), not KV: KV
   costs about thirty times as much per gigabyte, and a library is the one
   record in AMV that grows with how much somebody uses it. The list of files
   - names, sizes, dates - is a small record under the account (`lib`), so
   listing never touches the bytes.

   OFF UNTIL IT IS BOUND, AND SAYS SO. Without AMV_FILES every route answers
   `configured:false` and the app keeps files on the device as it always did,
   telling the person that is where they are. Nothing pretends to sync.

   BOUNDED BY PLAN, ON THE SERVER. The limits below are checked under the
   record's lock, so two uploads at once cannot both squeeze past the last
   megabyte. A file that would cross the limit is refused before a byte is
   stored.

   READ BACK BEFORE IT IS CALLED KEPT. The same rule as every other write: the
   object is looked up after it is written, and "kept" means it was found.

   ERASED WITH THE ACCOUNT. Deleting an account removes every object under it
   and the record (see authDeleteAccount), and a failure there is reported, not
   swallowed. Objects are keyed by a hash of the address, so the store never
   holds somebody's email in a key.
   ══════════════════════════════════════════════════════════════════════════ */
const LIB_KIND = 'lib';
const LIB_MB = 1024 * 1024;
/* Count and stored size (characters of text, or of base64 for a picture or
   PDF, which is what crosses the wire and what is stored). */
const LIB_LIMITS = {
  free:  { files: 100,   bytes: 200 * LIB_MB },
  pro:   { files: 2000,  bytes: 5 * 1024 * LIB_MB },
  elite: { files: 10000, bytes: 20 * 1024 * LIB_MB },
  ultra: { files: 25000, bytes: 50 * 1024 * LIB_MB },
};
/* One file, as the characters of its body (text, or base64). It was 30MB,
   which nothing could ever send: the router refused any body over its default
   megabyte first, so every file over about 750KB failed to reach the account
   with the router's sentence instead of this one (LESSONS 618). Now 12MB -
   more than any attachment the page sends (a PDF is held to 6MB, about 8MB
   as base64) - and the router lets exactly this much through. */
const LIB_FILE_MAX = 12 * LIB_MB;
/* 'office' is a Word, Excel or PowerPoint file itself, as base64 - kept when
   somebody saves an edited file, so another device can go on editing it rather
   than reading its words (docs/OWNER-DECISIONS.md #11). */
const LIB_KINDS = new Set(['text', 'img', 'pdf', 'office']);
const LIB_OFFICE_FORMATS = new Set(['docx', 'xlsx', 'pptx']);

/* A FOLDER is a path of up to three names, each up to forty characters -
   "Taxes/2026". Plain text only: a name that is not one is refused rather than
   cleaned into something the person did not type. '' is no folder. The page
   applies the same rule (_libFolderClean), and this is the one that holds. */
const LIB_FOLDER_DEPTH = 3, LIB_FOLDER_NAME = 40;
function _libFolder(v){
  const raw = String(v == null ? '' : v).trim();
  if(!raw) return '';
  const parts = raw.split('/').map(x => x.trim()).filter(Boolean);
  if(!parts.length || parts.length > LIB_FOLDER_DEPTH) return null;
  if(parts.some(x => x.length > LIB_FOLDER_NAME || x === '.' || x === '..' || /[\u0000-\u001f\u007f\\<>]/.test(x))) return null;
  return parts.join('/');
}

function libConfigured(env){
  return !!(env && env.AMV_FILES && typeof env.AMV_FILES.put === 'function' && typeof env.AMV_FILES.get === 'function');
}
function _libLimitsFor(plan){
  return LIB_LIMITS[plan] || (PLAN_RANK[plan] >= 3 ? LIB_LIMITS.ultra : PLAN_RANK[plan] >= 2 ? LIB_LIMITS.elite
       : PLAN_RANK[plan] >= 1 ? LIB_LIMITS.pro : LIB_LIMITS.free);
}
/* The object's folder: a hash of the address, never the address itself. */
async function _libPrefix(email){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('amv-lib:' + String(email || '').toLowerCase()));
  return 'lib/' + [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40) + '/';
}
function _libMeta(f){
  return { id: f.id, sig: f.sig, kind: f.kind, name: f.name, size: f.size || 0, format: f.format || '',
           summary: f.summary || '', mime: f.mime || '', chars: f.chars || 0, added: f.added || 0, used: f.used || 0, folder: f.folder || '' };
}
function _libUsage(rec){
  const files = (rec && Array.isArray(rec.files)) ? rec.files : [];
  /* What the object store holds (Nov 1 audit FILE-005): the body's UTF-8
     bytes, recorded at upload. A file kept before that has only its character
     count, which is the same for base64 and close for most text. */
  return { files: files.length, bytes: files.reduce((n, f) => n + (f.bytes || f.chars || 0), 0) };
}
const _libOff = () => json({ ok: true, configured: false, files: [],
  message: 'Files are kept on each device on this AMV. Keeping them in your account is not switched on yet.' });

/* One door for the four routes: signed in, not an API key, rate-limited. */
async function _libUser(request, env, write){
  const user = await requireUser(request, env);
  if (!user) return { res: json({ error: 'unauthorized' }, 401) };
  const k = _refuseApiKey(user, 'reach your files'); if (k) return { res: k };
  const blocked = write
    ? await guardAction(env, 'lib:w:' + user.email, 30, 2000, 'changes to your files')
    : await guardAction(env, 'lib:r:' + user.email, 120, 10000, 'reading your files');
  if (blocked) return { res: blocked };
  return { user };
}

/* GET /v1/library -> { configured, files, used, limit } */
async function libList(request, env){
  if (!libConfigured(env)) return _libOff();
  const { user, res } = await _libUser(request, env, false); if (res) return res;
  const rec = (await DB.get(env, LIB_KIND, user.email)) || { files: [] };
  const files = (rec.files || []).filter(f => !f.pending).slice().sort((a, b) => (b.used || 0) - (a.used || 0)).map(_libMeta);
  return json({ ok: true, configured: true, files, used: _libUsage(rec), limit: _libLimitsFor(user.plan) });
}

/* A FILE IS WHAT IT SAYS IT IS, OR IT IS NOT KEPT (Oct 31 audit, item 52).
   Not an antivirus - that is an outside service the owner would choose - but
   the checks that need none: the first bytes must be the kind the upload
   claims (a PDF starts %PDF-, a Word/Excel/PowerPoint file is a zip, an image
   is one of the image formats a browser shows), a program is never kept
   whatever it is called, and an Office file carrying macros (a program
   inside it) is refused. Only the start of a file is decoded, and for Office
   only the end, where a zip lists what is in it - so a large file costs no
   more to check than a small one. */
function _b64Bytes(s){ try { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch (e) { return null; } }
function _libContentRefusal(kind, body){
  if (kind === 'text') return '';
  const clean = body.replace(/\s+/g, '');
  const head = _b64Bytes(clean.slice(0, 64));
  if (!head || head.length < 4) return 'not_what_it_says';
  const at = (i, ...v) => v.every((x, k) => head[i + k] === x);
  const str = (i, t) => [...t].every((c, k) => head[i + k] === c.charCodeAt(0));
  /* A program, whatever it is called. */
  if (str(0, 'MZ') || at(0, 0x7f, 0x45, 0x4c, 0x46) || at(0, 0xfe, 0xed, 0xfa) || at(0, 0xcf, 0xfa, 0xed, 0xfe) || at(0, 0xca, 0xfe, 0xba, 0xbe) || str(0, '#!'))
    return 'program';
  if (kind === 'pdf') return str(0, '%PDF-') ? '' : 'not_what_it_says';
  if (kind === 'img') {
    const image = at(0, 0x89, 0x50, 0x4e, 0x47) || at(0, 0xff, 0xd8, 0xff) || str(0, 'GIF8') || (str(0, 'RIFF') && str(8, 'WEBP'))
      || str(4, 'ftyp') || str(0, 'BM');
    return image ? '' : 'not_what_it_says';
  }
  if (kind === 'office') {
    if (!at(0, 0x50, 0x4b, 0x03, 0x04)) return 'not_what_it_says';
    /* The zip's own list of parts is at its end. */
    const tailChars = Math.min(clean.length - (clean.length % 4), 262144);
    const tail = _b64Bytes(clean.slice(clean.length - tailChars));
    if (!tail) return 'not_what_it_says';
    const text = new TextDecoder('latin1').decode(tail);
    if (/vbaProject\.bin|vbaData\.xml/i.test(text)) return 'macros';
    return '';
  }
  return '';
}

/* POST /v1/library/put { sig, kind, name, size, format, summary, mime, body } */
async function libPut(request, env){
  if (!libConfigured(env)) return _libOff();
  const { user, res } = await _libUser(request, env, true); if (res) return res;
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad_request', message: 'That was not a file AMV could read.' }, 400); }
  const kind = String((b && b.kind) || '');
  const body = typeof (b && b.body) === 'string' ? b.body : '';
  const name = String((b && b.name) || '').trim().slice(0, 240);
  const sig = String((b && b.sig) || '').slice(0, 200);
  if (!LIB_KINDS.has(kind) || !name || !sig || !body)
    return json({ error: 'bad_request', message: 'That was not a file AMV could keep.' }, 400);
  if (kind === 'office' && !LIB_OFFICE_FORMATS.has(String(b.format || '')))
    return json({ error: 'bad_request', message: 'That was not a Word, Excel or PowerPoint file.' }, 400);
  if (kind !== 'text' && !/^[A-Za-z0-9+/=\s]+$/.test(body.slice(0, 4096)))
    return json({ error: 'bad_request', message: 'That was not a file AMV could keep.' }, 400);
  if (body.length > LIB_FILE_MAX)
    return json({ error: 'too_large', message: 'That file is too large to keep in your account (' + Math.round(LIB_FILE_MAX / LIB_MB) + ' MB at most). It is still kept on this device.' }, 413);
  const refused = _libContentRefusal(kind, body);
  if (refused) {
    audit(env, 'library_refused', { by: user.email, kind, why: refused });
    return json({ error: 'refused_' + refused, message: refused === 'macros'
      ? 'That Office file contains macros - programs inside it - so it was not kept in your account. It is still on this device.'
      : refused === 'program'
        ? 'That is a program, and programs are not kept in your account. It is still on this device.'
        : 'That file is not what it says it is, so it was not kept in your account. It is still on this device.' }, 422);
  }

  const folder = _libFolder(b.folder);
  if (folder === null) return json({ error: 'bad_folder', message: 'A folder is up to three names, like Taxes/2026, each up to 40 characters.' }, 400);
  const limit = _libLimitsFor(user.plan);
  const prefix = await _libPrefix(user.email);
  const now = Date.now();
  const id = 'lf' + now.toString(36) + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const meta = { id, sig, kind, name, size: Math.max(0, +b.size || 0), format: String(b.format || '').slice(0, 40),
                 summary: String(b.summary || '').slice(0, 300), mime: String(b.mime || '').slice(0, 100),
                 chars: body.length, bytes: new TextEncoder().encode(body).length, added: now, used: now, folder };

  /* The same file sent twice is one entry. Decided under the lock, with the
     limit, so two tabs uploading at once cannot both pass the last check. */
  let decided; const abandoned = [];
  try {
    decided = await _withKind(env, LIB_KIND, user.email, (rec) => {
      /* An upload that never finished (a Worker stopped mid-way) is cleared
         after ten minutes, so it cannot hold a place in the limit for ever. */
      const all = Array.isArray(rec.files) ? rec.files : [];
      /* Its bytes may have reached the store before the Worker stopped: they
         are deleted below, not left behind unseen and uncounted (Nov 1 audit FILE-004). */
      for (const f of all) if (f.pending && now - (f.added || 0) >= 600000) abandoned.push(f.id);
      rec.files = all.filter(f => !f.pending || now - (f.added || 0) < 600000);
      const same = rec.files.find(f => f.sig === sig && !f.pending);
      if (same) { same.used = now; return { dup: _libMeta(same) }; }
      const u = _libUsage(rec);
      if (u.files + 1 > limit.files || u.bytes + meta.bytes > limit.bytes) return { full: u };
      rec.files.push(Object.assign({ pending: true }, meta));
      return { add: true };
    }, { files: [] });
  } catch (e) {
    return json({ error: 'busy', message: 'Your files are being changed somewhere else. Try again in a moment.' }, 503);
  }
  for (const gone of abandoned) { try { await env.AMV_FILES.delete(prefix + gone); } catch (e) {} }
  if (decided && decided.dup) return json({ ok: true, file: decided.dup, verified: true, existed: true });
  if (decided && decided.full)
    return json({ error: 'library_full', used: decided.full, limit,
      message: 'Your files in your account are full for your plan. Delete some, or keep this one on this device only.' }, 409);

  /* The bytes, then the read-back, then the entry stops being pending. If any
     of it fails the entry is taken out again, so the list never names a file
     that is not there. */
  const drop = async () => {
    try { await _withKind(env, LIB_KIND, user.email, (rec) => { rec.files = (rec.files || []).filter(f => f.id !== id); }, { files: [] }); } catch (e) {}
    try { await env.AMV_FILES.delete(prefix + id); } catch (e) {}
  };
  try {
    await env.AMV_FILES.put(prefix + id, body, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    const head = await env.AMV_FILES.head(prefix + id);
    if (!head || +head.size < new TextEncoder().encode(body).length) throw new Error('not_stored');
    await _withKind(env, LIB_KIND, user.email, (rec) => {
      const f = (rec.files || []).find(x => x.id === id); if (f) delete f.pending;
    }, { files: [] });
  } catch (e) {
    await drop();
    audit(env, 'library_put_failed', { by: user.email, error: String((e && e.message) || e).slice(0, 120) });
    return json({ error: 'not_kept', message: 'That file could not be kept in your account. It is still on this device.' }, 502);
  }
  return json({ ok: true, file: _libMeta(meta), verified: true });
}

/* GET /v1/library/get?id= -> { file, body } */
async function libGet(request, env){
  if (!libConfigured(env)) return _libOff();
  const { user, res } = await _libUser(request, env, false); if (res) return res;
  const id = new URL(request.url).searchParams.get('id') || '';
  const rec = (await DB.get(env, LIB_KIND, user.email)) || { files: [] };
  const f = (rec.files || []).find(x => x.id === id && !x.pending);
  if (!f) return json({ error: 'not_found', message: 'That file is not in your account any more.' }, 404);
  const obj = await env.AMV_FILES.get((await _libPrefix(user.email)) + id);
  if (!obj) {
    audit(env, 'library_object_missing', { by: user.email, id });
    return json({ error: 'not_found', message: 'That file is listed but could not be found. Delete it and add it again.' }, 404);
  }
  return json({ ok: true, file: _libMeta(f), body: await obj.text() });
}

/* POST /v1/library/delete { ids: [] } */
async function libDelete(request, env){
  if (!libConfigured(env)) return _libOff();
  const { user, res } = await _libUser(request, env, true); if (res) return res;
  let b = {}; try { b = await request.json(); } catch (e) {}
  const ids = new Set((Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 1000));
  if (!ids.size) return json({ error: 'bad_request', message: 'Say which files to delete.' }, 400);
  const prefix = await _libPrefix(user.email);
  try {
    await _withKind(env, LIB_KIND, user.email, (rec) => { rec.files = (rec.files || []).filter(f => !ids.has(f.id)); }, { files: [] });
  } catch (e) {
    return json({ error: 'busy', message: 'Your files are being changed somewhere else. Nothing was deleted - try again in a moment.' }, 503);
  }
  /* The list no longer names them, so they are gone for the person. The bytes
     going is what is checked: one that survives is reported, not hidden. */
  const keys = [...ids].map(id => prefix + id);
  let left = 0;
  try {
    await env.AMV_FILES.delete(keys);
    for (const k of keys) if (await env.AMV_FILES.head(k)) left++;
  } catch (e) { left = keys.length; }
  if (left) {
    audit(env, 'library_delete_incomplete', { by: user.email, left });
    return json({ error: 'delete_incomplete', deleted: ids.size - left, message: 'Some of those files could not be removed from storage. Try again.' }, 502);
  }
  return json({ ok: true, deleted: ids.size });
}

/* POST /v1/library/move { ids: [], folder } - into a folder, or out of all of
   them with ''. Read back: "moved" counts the files that are in it now. */
async function libMove(request, env){
  if (!libConfigured(env)) return _libOff();
  const { user, res } = await _libUser(request, env, true); if (res) return res;
  let b = {}; try { b = await request.json(); } catch (e) {}
  const ids = new Set((Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 1000));
  if (!ids.size) return json({ error: 'bad_request', message: 'Say which files to move.' }, 400);
  const folder = _libFolder(b.folder);
  if (folder === null) return json({ error: 'bad_folder', message: 'A folder is up to three names, like Taxes/2026, each up to 40 characters.' }, 400);
  try {
    await _withKind(env, LIB_KIND, user.email, (rec) => {
      for (const f of (rec.files || [])) if (ids.has(f.id) && !f.pending) f.folder = folder;
    }, { files: [] });
  } catch (e) {
    return json({ error: 'busy', message: 'Your files are being changed somewhere else. Nothing was moved - try again in a moment.' }, 503);
  }
  const after = (await DB.get(env, LIB_KIND, user.email)) || { files: [] };
  const moved = (after.files || []).filter(f => ids.has(f.id) && (f.folder || '') === folder).length;
  if (!moved) return json({ error: 'not_found', message: 'Those files are not in your account any more.' }, 404);
  return json({ ok: true, moved, folder, verified: moved === ids.size });
}

/* Everything under one account, for erasure. Throws on failure - the caller
   reports it rather than answering "deleted". */
async function _libEraseAll(env, email){
  if (!libConfigured(env)) return 0;
  const prefix = await _libPrefix(email);
  let n = 0, cursor;
  for (let i = 0; i < 1000; i++) {
    const page = await env.AMV_FILES.list({ prefix, cursor, limit: 1000 });
    const keys = (page.objects || []).map(o => o.key);
    if (keys.length) { await env.AMV_FILES.delete(keys); n += keys.length; }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  const after = await env.AMV_FILES.list({ prefix, limit: 1 });
  if ((after.objects || []).length) throw new Error('library objects survived');
  return n;
}
