/* =====================================================================
   A PERMANENT INDEX OF WHAT IS IN YOUR FILES (Nov 8 audit RETR-020).

   Searching by meaning used to embed the passages it was handed at the
   moment of asking (79-meaning.js): fine for one project's files in one
   message, useless for "which of my files says X" across everything kept in
   the account. This keeps a vector for every passage of every text file in
   the library, in a Cloudflare Vectorize index bound as VECTORS:

     - written when a file is kept (68-cloud-library.js libPut), removed when
       it is deleted - the index never names a file the list does not have;
     - each passage carries its account (a hash of the address, never the
       address) and every query is filtered to the asking account, inside one
       of FIDX_BUCKETS namespaces chosen by that hash - and an answer is
       shown only for a file in the asker's own list, so a passage of anybody
       else's can never be one. (It was one namespace per account; an index
       holds 50,000 namespaces, which is 50,000 accounts - Nov 8 verified
       audit capacity note. Buckets keep each query small at any number of
       accounts, and the filter needs the metadata index named in GO-LIVE.md.)
     - only text is indexed; a picture, a PDF or an Office file kept as
       itself is not read here;
     - the embedding is paid for like any other use of the meaning model,
       against the account's own ceiling.

   Off - and saying so - until VECTORS and the meaning model are both bound
   (wrangler.toml, GO-LIVE.md). Searching by name keeps working either way.
   ===================================================================== */
const FIDX_CHUNK = 1400;          // characters per passage
const FIDX_MAX_CHUNKS = 64;       // passages per file (about 90,000 characters)
const FIDX_TOP = 8;

function _fileIndexOn(env){ return !!(env && env.VECTORS && typeof env.VECTORS.upsert === 'function' && typeof env.VECTORS.query === 'function' && _meaningOn(env)); }

/* A passage's id: 64 bytes at most is all the index takes (Nov 8 verified
   audit R19 - the account's namespace in the id made it 65 from the eleventh
   passage on, and every file that long was refused). The namespace already
   keeps accounts apart, so the id needs only the file and the passage - and
   a hash, so it says nothing about either. */
async function _fidxId(ns, fileId, i){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ns + ':' + String(fileId)));
  return [...new Uint8Array(d)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('') + ':' + i;
}
const FIDX_BUCKETS = 4096;
const _fidxBucket = (space) => 'b' + (parseInt(String(space).slice(1, 9), 16) % FIDX_BUCKETS);
async function _fidxSpace(email){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('amv-fidx:' + String(email || '').toLowerCase()));
  return 'a' + [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
/* Passages on paragraph boundaries where it can, never longer than a chunk. */
function _fidxChunks(text){
  const out = [];
  const paras = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  let cur = '';
  for (const p0 of paras) {
    let p = p0.trim(); if (!p) continue;
    while (p.length > FIDX_CHUNK) { if (cur) { out.push(cur); cur = ''; } out.push(p.slice(0, FIDX_CHUNK)); p = p.slice(FIDX_CHUNK); }
    if ((cur + '\n\n' + p).length > FIDX_CHUNK) { if (cur) out.push(cur); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
    if (out.length >= FIDX_MAX_CHUNKS) break;
  }
  if (cur && out.length < FIDX_MAX_CHUNKS) out.push(cur);
  return out.slice(0, FIDX_MAX_CHUNKS);
}
async function _fidxEmbed(env, texts){
  const vecs = [];
  for (let i = 0; i < texts.length; i += MEANING_BATCH) {
    const out = await env.AI.run(MEANING_MODEL, { text: texts.slice(i, i + MEANING_BATCH) });
    const got = out && Array.isArray(out.data) ? out.data : null;
    if (!got || got.length !== Math.min(MEANING_BATCH, texts.length - i)) throw new Error('the model answered ' + (got ? got.length : 'nothing') + ' vectors');
    vecs.push(...got);
  }
  return vecs;
}
/* Indexes one kept text file. Answers how many passages it holds now (0 when
   off or not text). A failure is said, and the file is still kept - it is
   simply not searchable by meaning until it is kept again. */
async function _fileIndexAdd(env, user, file, body){
  if (!_fileIndexOn(env) || !file || file.kind !== 'text') return 0;
  const chunks = _fidxChunks(body);
  if (!chunks.length) return 0;
  const usd = chunks.reduce((n, c) => n + c.length, 0) * MEANING_USD_PER_CHAR;
  const book = {};
  const refused = await _spendGate(env, user, 'meaning', usd, book, { fallbackCeilingUSD: FREE_AUTO_CEILING_USD });
  if (refused) return 0;
  const subject = user.billingSubject || user.email;
  try {
    const vecs = await _fidxEmbed(env, chunks);
    const ns = await _fidxSpace(user.email);
    const rows = [];
    for (let i = 0; i < vecs.length; i++) rows.push({ id: await _fidxId(ns, file.id, i), values: vecs[i], namespace: _fidxBucket(ns),
      metadata: { a: ns, f: String(file.id), i, n: String(file.name || '').slice(0, 200), t: chunks[i] } });
    await env.VECTORS.upsert(rows);
    await _recordSpend(env, subject, usd, 'meaning', book.period, book);
    return chunks.length;
  } catch (e) {
    await _recordSpend(env, subject, 0, 'meaning', book.period, book).catch(() => {});
    audit(env, 'file_index_failed', { email: user.email, error: String((e && e.message) || e).slice(0, 120) });
    return 0;
  }
}
/* Takes a deleted file's passages out. Every id it ever had is named, so
   nothing of it stays searchable. */
/* NEEDS ONLY THE INDEX (Nov 8 verified audit R07): removing passages does
   not need the meaning model, so it is not skipped when the model is off -
   it used to answer "removed" there without asking the index anything. With
   passages to remove and no index to remove them from, the answer is false:
   not done, and kept to be tried again. */
async function _fileIndexRemove(env, email, files){
  const owed = (files || []).some(f => +f.vec > 0);
  if (!owed) return true;
  if (!(env && env.VECTORS && typeof env.VECTORS.deleteByIds === 'function')) { audit(env, 'file_index_remove_unbound', { email }); return false; }
  const ns = await _fidxSpace(email);
  const ids = [];
  for (const f of files || []) for (let i = 0; i < Math.min(FIDX_MAX_CHUNKS, +f.vec || 0); i++) ids.push(await _fidxId(ns, f.id, i));
  if (!ids.length) return true;
  try { for (let i = 0; i < ids.length; i += 100) await env.VECTORS.deleteByIds(ids.slice(i, i + 100)); return true; }
  catch (e) { audit(env, 'file_index_remove_failed', { email, n: ids.length }); return false; }
}

/* POST /v1/library/search { query } -> { results: [{ id, name, passage, score }] } */
async function libSearch(request, env){
  if (!libConfigured(env)) return _libOff();
  const { user, res } = await _libUser(request, env, false); if (res) return res;
  if (!_fileIndexOn(env)) return json({ error: 'not_configured', message: 'Searching inside your files is not switched on for this deployment; searching by name still works.' }, 503);
  let b = {}; try { b = await request.json(); } catch (e) {}
  const query = String(b.query || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (query.length < 2) return json({ error: 'bad_request', message: 'Say what to look for.' }, 400);
  const usd = query.length * MEANING_USD_PER_CHAR;
  const book = {};
  const refused = await _spendGate(env, user, 'meaning', usd, book, { fallbackCeilingUSD: FREE_AUTO_CEILING_USD });
  if (refused) return refused;
  const subject = user.billingSubject || user.email;
  try {
    const [qv] = await _fidxEmbed(env, [query]);
    const ns = await _fidxSpace(user.email);
    const got = await env.VECTORS.query(qv, { topK: FIDX_TOP * 2, namespace: _fidxBucket(ns), filter: { a: ns }, returnMetadata: 'all' });
    await _recordSpend(env, subject, usd, 'meaning', book.period, book);
    /* Only files the list still has - an index entry for a file being
       deleted, or gone, is not an answer. */
    const rec = await _libRec(env, user.email);
    const live = new Map((rec.files || []).filter(f => !f.pending && !f.deleting).map(f => [String(f.id), f]));
    const seen = new Set(), results = [];
    for (const mt of ((got && got.matches) || [])) {
      const md = (mt && mt.metadata) || {};
      if (md.a !== ns) continue;                      // never another account's, whatever the index answered
      const f = live.get(String(md.f || ''));
      if (!f || seen.has(f.id + ':' + md.i)) continue;
      seen.add(f.id + ':' + md.i);
      results.push({ id: f.id, name: f.name, passage: String(md.t || '').slice(0, 600), score: Math.round((+mt.score || 0) * 1000) / 1000 });
      if (results.length >= FIDX_TOP) break;
    }
    return json({ ok: true, results });
  } catch (e) {
    await _recordSpend(env, subject, 0, 'meaning', book.period, book).catch(() => {});
    audit(env, 'file_search_failed', { email: user.email, error: String((e && e.message) || e).slice(0, 120) });
    return json({ error: 'search_failed', message: 'Searching inside your files did not work just now. Searching by name still works.' }, 502);
  }
}
