/* ══════════════════════════════════════════════════════════════════════════
   SEARCHING A PROJECT'S FILES FOR THE PARTS A QUESTION NEEDS.

   Fetched the first time a project's files are larger than one message holds
   (_projectContextFor in 07b-projects.js), so a project that fits - most of
   them - never carries it. A classic script in the page's own scope.

   Before this, a project whose files came to more than PROJ_CTX_CHARS sent the
   newest files whole and left the rest out by name, so a question about the
   contract added first was answered without the contract. Now every file is
   cut into passages, each passage is scored against what was just asked, and
   the best of them - from any file - fill the same budget. Nothing is sent
   anywhere to do it: the files are on this device and so is the search.

   Ranking is BM25, the measure search engines were built on, over terms that
   work in every language AMV speaks:
     - letters and numbers of any script, NFKC-normalised and lower-cased,
       with accents dropped from Latin, Greek and Cyrillic letters only - an
       Indic vowel sign is a letter of the word, not decoration;
     - scripts written without spaces (Chinese, Japanese, Thai, Lao, Khmer,
       Burmese) and Korean, whose particles attach to the word, as character
       pairs, so a word is found without a dictionary of that language;
     - in spaced scripts, a long word also counts by its first five letters,
       so "invoices" finds "invoice" and "facturas" finds "factura".
   A table keeps its header line on every passage, or a row of numbers would
   arrive with nothing to say what the numbers are.

   It does not pretend: when nothing in the files matches what was asked, the
   result says so and the caller sends the beginning of each file instead,
   labelled as that.
   ══════════════════════════════════════════════════════════════════════════ */

const PS_PASSAGE = 1600;       // characters a passage aims for
const PS_K1 = 1.2, PS_B = 0.75;
/* Written without spaces between words (and Korean, see above). */
const PS_PAIRED = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/u;
const PS_PAIRED_RUNS = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]+|[^฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]+/gu;

function _psTerms(text){
  const s = String(text || '').normalize('NFKD')
    .replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu, '$1')
    .normalize('NFKC').toLowerCase();
  const out = [];
  for(const m of s.matchAll(/[\p{L}\p{N}\p{M}]+/gu)){
    const w = m[0];
    const runs = PS_PAIRED.test(w) ? w.match(PS_PAIRED_RUNS) : [w];
    for(const r of runs){
      if(PS_PAIRED.test(r)){
        if(r.length === 1) out.push(r);
        else for(let i = 0; i < r.length - 1; i++) out.push(r.slice(i, i + 2));
      } else if(r.length > 1 || /\p{N}/u.test(r)){
        out.push(r);
        if(r.length >= 6 && /^\p{L}+$/u.test(r)) out.push(r.slice(0, 5) + '~');
      }
    }
  }
  return out;
}

/* Lines packed into passages of about PS_PASSAGE characters, never splitting
   a line unless the line alone is longer than that. */
function _psPassages(text){
  const lines = String(text || '').split('\n');
  const head = lines[0] || '';
  const table = (head.match(/[,;\t|]/g) || []).length >= 2 && head.length <= 400;
  const out = []; let cur = '';
  const flush = () => { if(cur.trim()) out.push(cur); cur = ''; };
  for(let line of lines){
    while(line.length > PS_PASSAGE){ flush(); out.push(line.slice(0, PS_PASSAGE)); line = line.slice(PS_PASSAGE); }
    if(cur && cur.length + 1 + line.length > PS_PASSAGE) flush();
    cur = cur ? cur + '\n' + line : line;
  }
  flush();
  return table ? out.map((p, i) => i === 0 || p.startsWith(head) ? p : head + '\n' + p) : out;
}

/* One file's passages and their term counts, kept while the file is unchanged
   - the same project is asked about message after message. */
const _psCache = new Map();
function _psIndex(f){
  const text = String(f.text || '');
  const key = String(f.id || f.name) + ':' + text.length + ':' + (f.added || 0);
  const hit = _psCache.get(key);
  if(hit) return hit;
  const ps = _psPassages(text).map((t, i) => {
    const tf = new Map(); let len = 0;
    for(const w of _psTerms(t)){ tf.set(w, (tf.get(w) || 0) + 1); len++; }
    return { i, text: t, tf, len };
  });
  const idx = { name: String(f.name || 'file'), nameTerms: new Set(_psTerms(f.name)), ps };
  if(_psCache.size > 60) _psCache.clear();
  _psCache.set(key, idx);
  return idx;
}

/* files: [{id, name, text}], asked: [{text, weight}] newest first, budget in
   characters. Returns the chosen passages in file order and document order,
   whether anything matched, and which files sent nothing. */
function amvProjectSearch(files, asked, budget){
  const idx = (files || []).map(_psIndex);
  const all = [];
  idx.forEach((d, fi) => d.ps.forEach(p => all.push({ fi, p })));
  const N = all.length || 1;
  const avg = all.reduce((n, x) => n + x.p.len, 0) / N || 1;
  const q = new Map();
  for(const a of asked || []) for(const w of _psTerms(a.text)) q.set(w, Math.max(q.get(w) || 0, a.weight || 1));
  const df = new Map();
  for(const w of q.keys()){ let n = 0; for(const x of all) if(x.p.tf.has(w)) n++; df.set(w, n); }
  const idf = (w) => Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
  for(const x of all){
    let s = 0;
    for(const [w, qw] of q){
      const tf = x.p.tf.get(w) || 0;
      if(tf) s += qw * idf(w) * tf * (PS_K1 + 1) / (tf + PS_K1 * (1 - PS_B + PS_B * x.p.len / avg));
      /* Asking about "the lease" finds lease.pdf's passages a little sooner. */
      if(idx[x.fi].nameTerms.has(w)) s += 0.3 * qw * idf(w);
    }
    x.score = s;
  }
  const matched = all.some(x => x.score > 0);
  let order;
  if(matched) order = all.filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  else {
    /* Nothing matched: the start of every file, a passage from each in turn. */
    order = [];
    const most = Math.max(0, ...idx.map(d => d.ps.length));
    for(let i = 0; i < most; i++) idx.forEach((d, fi) => { if(d.ps[i]) order.push({ fi, p: d.ps[i] }); });
  }
  let room = Math.max(0, budget | 0); const pick = [];
  for(const x of order){
    if(x.p.text.length > room) continue;
    pick.push(x); room -= x.p.text.length;
    if(room < 200) break;
  }
  pick.sort((a, b) => a.fi - b.fi || a.p.i - b.p.i);
  const sent = new Set(pick.map(x => x.fi));
  const found = {
    matched,
    passages: pick.map(x => ({ name: idx[x.fi].name, part: x.p.i + 1, parts: idx[x.fi].ps.length, text: x.p.text })),
    untouched: idx.filter((d, fi) => !sent.has(fi)).map(d => d.name),
  };
  found.said = _psSay(found);
  return found;
}

/* What the model is told, kept with the search so the page carries neither
   until a project needs them. Which kind of selection it is gets said, so an
   answer built on the start of each file never reads as one built on a match. */
function _psSay(found){
  if(!found.passages.length) return '';
  let out = '\nProject files (the person’s own documents - quote and use them). Together they are larger than one message holds, so AMV '
    + (found.matched ? 'searched them for this message and these are the passages that match it best'
                     : 'searched them for this message and nothing in them matched it, so these are the beginning of each file')
    + '. The rest of each file was not sent: if the answer needs a part that is not here, say which part, and never guess at what the files say.';
  for(const p of found.passages) out += '\n=== ' + p.name + ' - passage ' + p.part + ' of ' + p.parts + ' ===\n' + p.text;
  if(found.untouched.length) out += '\n(Nothing sent from: ' + found.untouched.join(', ') + '.)';
  return out;
}
try{ window.amvProjectSearch = amvProjectSearch; }catch(e){}
