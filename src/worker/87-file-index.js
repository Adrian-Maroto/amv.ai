/* =====================================================================
   A PERMANENT INDEX OF WHAT IS IN YOUR FILES (Nov 8 audit RETR-020).

   Searching by meaning used to embed the passages it was handed at the
   moment of asking (79-meaning.js): fine for one project's files in one
   message, useless for "which of my files says X" across everything kept in
   the account. This keeps a vector for every passage of every text file in
   the library, in a Cloudflare Vectorize index bound as VECTORS:

     - written when a file is kept (68-cloud-library.js libPut), removed when
       it is deleted - the index never names a file the list does not have;
     - one NAMESPACE per account (a hash of the address, never the address),
       so a query can only ever reach the asking account's own passages - the
       permission is the namespace, not a filter somebody could forget;
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
    await env.VECTORS.upsert(vecs.map((values, i) => ({ id: ns + ':' + file.id + ':' + i, values, namespace: ns,
      metadata: { f: String(file.id), i, n: String(file.name || '').slice(0, 200), t: chunks[i] } })));
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
async function _fileIndexRemove(env, email, files){
  if (!_fileIndexOn(env) || typeof env.VECTORS.deleteByIds !== 'function') return true;
  const ns = await _fidxSpace(email);
  const ids = [];
  for (const f of files || []) for (let i = 0; i < Math.min(FIDX_MAX_CHUNKS, +f.vec || 0); i++) ids.push(ns + ':' + f.id + ':' + i);
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
    const got = await env.VECTORS.query(qv, { topK: FIDX_TOP * 2, namespace: ns, returnMetadata: 'all' });
    await _recordSpend(env, subject, usd, 'meaning', book.period, book);
    /* Only files the list still has - an index entry for a file being
       deleted, or gone, is not an answer. */
    const rec = (await DB.get(env, LIB_KIND, user.email)) || { files: [] };
    const live = new Map((rec.files || []).filter(f => !f.pending && !f.deleting).map(f => [String(f.id), f]));
    const seen = new Set(), results = [];
    for (const mt of ((got && got.matches) || [])) {
      const md = (mt && mt.metadata) || {};
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
