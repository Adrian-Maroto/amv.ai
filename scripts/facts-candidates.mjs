/* WHAT WIKIDATA OFFERS FOR EACH NAME NOTHING TIED TO ITS COUNTRY YET.

   facts-check.mjs verifies a name automatically only when a rule can stand
   behind the match - and the wider, looser pass taught that a third of loose
   matches are the wrong entity (LESSONS 652). What is left (629 names) is for
   citing by hand. This does the fetching for that, and nothing else: for each
   unresolved name in data/facts-sources.json it searches Wikidata in English,
   in the country's language, and with the country's name, and records the
   first candidates with what a reader needs to judge them - label,
   description, what it is (P31), its country (P17/P495/P1001), its website
   (P856).

   It decides nothing. data/facts-candidates.json is read match by match by a
   person (or the session doing the citing), and only a match that is plainly
   the named thing in the named country is written into facts-sources.json,
   as how: "cited", with the entity. Run by the facts-check workflow when
   data/facts-request.txt says "# candidates" - Wikidata is reachable there,
   not from the build sandbox. */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://www.wikidata.org/w/api.php';
const UA = 'amv-data/1.0 (country research; https://github.com/)';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getJSON(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { await sleep(2000 * (i + 1)); }
  }
  return null;
}
const LANG = { AR:'es', MX:'es', ES:'es', CO:'es', CL:'es', PE:'es', VE:'es', EC:'es', BO:'es', PY:'es', UY:'es', CR:'es', PA:'es', GT:'es', DO:'es', HN:'es', SV:'es', NI:'es', CU:'es',
  BR:'pt', PT:'pt', AO:'pt', MZ:'pt', FR:'fr', BE:'fr', CI:'fr', SN:'fr', CM:'fr', MA:'fr', DZ:'fr', TN:'fr', DE:'de', AT:'de', CH:'de', IT:'it', NL:'nl',
  PL:'pl', CZ:'cs', SK:'sk', HU:'hu', RO:'ro', BG:'bg', GR:'el', RS:'sr', HR:'hr', SI:'sl', LT:'lt', LV:'lv', EE:'et', FI:'fi', SE:'sv', NO:'nb', DK:'da',
  RU:'ru', UA:'uk', BY:'ru', KZ:'ru', UZ:'uz', AZ:'az', GE:'ka', AM:'hy', TR:'tr', IL:'he', SA:'ar', AE:'ar', EG:'ar', JO:'ar', IQ:'ar', LB:'ar', KW:'ar', QA:'ar',
  IR:'fa', PK:'ur', BD:'bn', IN:'hi', NP:'ne', LK:'si', TH:'th', VN:'vi', ID:'id', MY:'ms', PH:'tl', CN:'zh', TW:'zh', HK:'zh', JP:'ja', KR:'ko', MM:'my', KH:'km',
  ET:'am', KE:'sw', TZ:'sw', RW:'rw' };
const nameOf = (cc) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) || ''; } catch (e) { return ''; } };

async function search(q, lang) {
  const j = await getJSON(API + '?action=wbsearchentities&format=json&type=item&limit=5&language=' + lang + '&uselang=' + lang + '&strictlanguage=false&search=' + encodeURIComponent(q));
  return ((j && j.search) || []).map(x => x.id);
}
async function entities(ids, langs) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await getJSON(API + '?action=wbgetentities&format=json&props=claims|labels|descriptions&languages=' + langs + '&ids=' + ids.slice(i, i + 50).join('|'));
    Object.assign(out, (j && j.entities) || {});
  }
  return out;
}
const pick = (o, langs) => { for (const l of langs) if (o && o[l]) return o[l].value; const v = o && Object.values(o)[0]; return v ? v.value : ''; };
const ids = (c, p) => ((c && c[p]) || []).map(s => s.mainsnak && s.mainsnak.datavalue && s.mainsnak.datavalue.value).filter(Boolean).map(v => v.id || v);

const sources = JSON.parse(readFileSync(join(ROOT, 'data/facts-sources.json'), 'utf8'));
const only = process.argv.slice(2).filter(a => /^[A-Z]{2}$/i.test(a)).map(s => s.toUpperCase());
const out = { fetched: new Date().toISOString().slice(0, 10), source: 'Wikidata search (wbsearchentities) and entities (wbgetentities)', names: {} };
let n = 0;
for (const [cc, fields] of Object.entries(sources)) {
  if (only.length && !only.includes(cc)) continue;
  if (!fields || typeof fields !== 'object') continue;
  const lang = LANG[cc] || 'en', langs = lang === 'en' ? ['en'] : ['en', lang];
  for (const [field, list] of Object.entries(fields)) {
    for (const x of list) {
      if (x.how !== 'unresolved') continue;
      const found = [...new Set([...(await search(x.n, 'en')), ...(lang !== 'en' ? await search(x.n, lang) : []), ...(await search(x.n + ' ' + nameOf(cc), 'en'))])].slice(0, 8);
      const ents = found.length ? await entities(found, langs.join('|')) : {};
      /* What it is and where, in words: one more lookup for the labels of the
         types and countries the candidates name. */
      const refs = [...new Set(Object.values(ents).flatMap(e => [...ids(e.claims, 'P31'), ...ids(e.claims, 'P17'), ...ids(e.claims, 'P495'), ...ids(e.claims, 'P1001')]))];
      const lab = refs.length ? await entities(refs, 'en') : {};
      const word = (q) => pick(lab[q] && lab[q].labels, ['en']) || q;
      (out.names[cc] = out.names[cc] || []).push({ field, n: x.n, c: found.map(q => {
        const e = ents[q]; if (!e) return null;
        return { q, label: pick(e.labels, langs), desc: pick(e.descriptions, langs),
                 is: ids(e.claims, 'P31').slice(0, 3).map(word), where: [...new Set([...ids(e.claims, 'P17'), ...ids(e.claims, 'P495'), ...ids(e.claims, 'P1001')])].slice(0, 3).map(word),
                 site: ids(e.claims, 'P856').slice(0, 1).map(String)[0] || '' };
      }).filter(Boolean) });
      if (++n % 25 === 0) console.log(n, 'names');
    }
  }
}
writeFileSync(join(ROOT, 'data/facts-candidates.json'), JSON.stringify(out) + '\n');
console.log('done:', n, 'names');
