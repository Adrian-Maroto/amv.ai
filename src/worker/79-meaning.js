/* ══════════════════════════════════════════════════════════════════════════
   SEARCHING BY MEANING, AS WELL AS BY WORDS.

   A search over somebody's files and past chats is by words, on their device
   (project-search.js), with the other phrasings the engine already knows
   passed in the same call. Words still miss a passage that says the same
   thing in a different language, or in no shared word at all. This scores
   passages by what they mean, with a multilingual embedding model on the
   deployment's own Workers AI - when it has one.

   Stateless on purpose: the page sends the question and the passages it is
   choosing between, this answers with how close each one is, and nothing is
   kept - no index of anybody's files, no vectors, no copy. The page blends
   these scores with its word scores; it never replaces them, so a passage
   that matches the exact words is still found when this is off or fails.

   Off unless the deployment binds Workers AI as `AI` (wrangler.toml). The
   page asks /v1/public-config, and words alone answer when it is off. */
const MEANING_MODEL = '@cf/baai/bge-m3';
const MEANING_MAX = 240;          // passages scored in one request
const MEANING_TEXT = 1800;        // characters of a passage that are scored (a passage aims for 1600)
const MEANING_BATCH = 48;         // texts per call to the model
/* bge-m3 on Workers AI: $0.012 per million input tokens, a token about four
   characters - booked so a search is metered like everything else, even
   though a full one costs well under a tenth of a cent. */
const MEANING_USD_PER_CHAR = 0.012 / 1e6 / 4;

function _meaningOn(env){ return !!(env && env.AI && typeof env.AI.run === 'function'); }
function _cosine(a, b){
  let dot = 0, na = 0, nb = 0;
  for(let i = 0; i < a.length; i++){ dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function meaningRank(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const limited = await guardAction(env, 'meaning:' + user.email, 30, 3000, 'searches by meaning');
  if(limited) return limited;
  if(!_meaningOn(env)) return json({ error:'not_configured', message:'Searching by meaning is not switched on for this deployment; searching by words still works.' }, 503);
  const body = await request.json().catch(() => ({}));
  const query = String(body.query || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  const raw = Array.isArray(body.passages) ? body.passages : null;
  if(!query || !raw || !raw.length) return json({ error:'bad_request', message:'Send what to look for and the passages to choose between.' }, 400);
  if(raw.length > MEANING_MAX) return json({ error:'too_large', message:'At most ' + MEANING_MAX + ' passages can be compared at once.' }, 413);
  const passages = raw.map(p => String(p == null ? '' : p).slice(0, MEANING_TEXT));
  const chars = query.length + passages.reduce((n, p) => n + p.length, 0);
  const usd = chars * MEANING_USD_PER_CHAR;
  const book = {};
  const refused = await _spendGate(env, user, 'meaning', usd, book, { fallbackCeilingUSD: FREE_AUTO_CEILING_USD });
  if(refused) return refused;
  const subject = user.billingSubject || user.email;
  try{
    const texts = [query].concat(passages);
    const vecs = [];
    for(let i = 0; i < texts.length; i += MEANING_BATCH){
      const out = await env.AI.run(MEANING_MODEL, { text: texts.slice(i, i + MEANING_BATCH) });
      const got = out && Array.isArray(out.data) ? out.data : null;
      if(!got || got.length !== Math.min(MEANING_BATCH, texts.length - i)) throw new Error('model answered ' + (got ? got.length : 'nothing') + ' vectors');
      vecs.push(...got);
    }
    const q = vecs[0];
    const scores = vecs.slice(1).map(v => Math.round(_cosine(q, v) * 10000) / 10000);
    await _recordSpend(env, subject, usd, 'meaning', book.period, book);
    return json({ ok:true, scores, model:'bge-m3' });
  }catch(e){
    await _recordSpend(env, subject, 0, 'meaning', book.period, book).catch(() => {});
    audit(env, 'meaning_failed', { email: user.email, error: String((e && e.message) || e).slice(0, 120) });
    return json({ error:'meaning_failed', message:'Searching by meaning did not work just now; the search used words alone.' }, 502);
  }
}
