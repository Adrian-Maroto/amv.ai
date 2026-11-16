/* EVERY NAME IN THE COUNTRY FACTS, CHECKED AGAINST A SOURCE (Nov 16, the
   owner: "all backed up by research - every section, every country").

   COUNTRY_FACTS (src/worker/65-country-capabilities.js) names, per country,
   the tax office, the banks, the job sites, the shops ... that Crew's job
   titles and runs use. It was written from well-known facts with no source per
   name. This looks every name up:

     1. Wikidata's search (wbsearchentities), then each candidate's claims
        (wbgetentities): country (P17) and official website (P856).
     2. VERIFIED, IN THE COUNTRY: a candidate whose country, country of origin
        or jurisdiction is this country - or the name is an entry of the
        country's own catalogue (data/countries, Wikidata), or an address in
        its Chrome UX Report list. Searched in English, in the country's
        language, and with the country's name.
        VERIFIED, VISITED THERE: a candidate whose official website is in this
        country's Chrome UX Report list (LinkedIn for job hunting in Spain).
     3. GENERIC: a phrase, not a name ("your state DMV", "your health
        insurer") - nothing to look up, and said so.
     4. UNRESOLVED: everything else - listed by name in docs/FACTS-CHECK.md,
        for a person to fix or to cite.

   Writes data/facts-sources.json ({CC: {field: [{n, q?, how, site?, r?}]}})
   and docs/FACTS-CHECK.md. Run by the facts-check workflow (Wikidata is
   reachable from there); node scripts/facts-check.mjs [CC ...]. */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'amv-data/1.0 (country research; https://github.com/)';
const API = 'https://www.wikidata.org/w/api.php';
const CRUX = 'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/country/';

const src = readFileSync(join(ROOT, 'src/worker/65-country-capabilities.js'), 'utf8');
const FACTS = (0, eval)('(' + src.match(/const COUNTRY_FACTS = (\{[\s\S]*?\n\});/)[1] + ')');
const only = process.argv.slice(2).map(s => s.toUpperCase());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return r;
    } catch (e) { await sleep(2000 * (i + 1)); }
  }
  return null;
}

/* The country's Chrome UX Report hosts, registrable domain -> best rank. */
const SECOND = new Set(['co', 'com', 'org', 'net', 'gov', 'gob', 'edu', 'ac', 'or', 'ne', 'go', 'gouv', 'nic']);
const reg = (h) => { const p = h.replace(/^www\./, '').split('.'); return (p.length >= 3 && p[p.length - 1].length === 2 && SECOND.has(p[p.length - 2])) ? p.slice(-3).join('.') : p.slice(-2).join('.'); };
async function crux(cc) {
  const now = new Date();
  for (let back = 0; back < 6; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const ym = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
    const r = await get(CRUX + cc.toLowerCase() + '/' + ym + '.csv.gz', 2);
    if (!r) continue;
    const text = gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
    const byReg = new Map();
    for (const line of text.split('\n')) {
      const c = line.lastIndexOf(','); if (c < 0) continue;
      const rank = +line.slice(c + 1); if (!rank) continue;
      let h; try { h = new URL(line.slice(0, c)).hostname.toLowerCase(); } catch (e) { continue; }
      const g = reg(h); if (!(byReg.get(g) <= rank)) byReg.set(g, rank);
    }
    return { ym, byReg };
  }
  return { ym: '', byReg: new Map() };
}

const GENERIC = /^(your |the local |local |any |others?$|where |each |a |an )|where they apply|or .* where|\bof your\b/i;
function items(v) {
  return String(v).replace(/\([^)]*\)?/g, ' ').split(/,|;|·| \/ |\s+and\s+/i)
    .map(s => s.replace(/^\s*(and|or)\s+/i, '').replace(/\s+/g, ' ').trim()).filter(s => s.length >= 2);
}
const clean = (s) => s.replace(/^the\s+/i, '').replace(/\s+/g, ' ').trim();

async function search(name, lang = 'en') {
  const u = API + '?action=wbsearchentities&format=json&type=item&limit=10&language=' + lang + '&uselang=' + lang + '&strictlanguage=false&search=' + encodeURIComponent(name);
  const r = await get(u); if (!r) return [];
  const j = await r.json().catch(() => null);
  return ((j && j.search) || []).map(x => x.id);
}
async function claims(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const u = API + '?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=' + ids.slice(i, i + 50).join('|');
    const r = await get(u); if (!r) continue;
    const j = await r.json().catch(() => null);
    for (const [id, e] of Object.entries((j && j.entities) || {})) {
      const c = e.claims || {};
      const val = (p) => (c[p] || []).map(s => s.mainsnak && s.mainsnak.datavalue && s.mainsnak.datavalue.value).filter(Boolean);
      /* Where it is: its country (P17), its country of origin (P495), or the
         jurisdiction it applies to (P1001 - a tax authority, a national exam). */
      out[id] = { label: (e.labels && e.labels.en && e.labels.en.value) || '',
                  country: [...val('P17'), ...val('P495'), ...val('P1001')].map(v => v && v.id).filter(Boolean), site: val('P856').map(String) };
    }
  }
  return out;
}

/* The language a country's own names are written in, for the second search. */
const LANG = { AR:'es', MX:'es', ES:'es', CO:'es', CL:'es', PE:'es', VE:'es', EC:'es', BO:'es', PY:'es', UY:'es', CR:'es', PA:'es', GT:'es', DO:'es', HN:'es', SV:'es', NI:'es', CU:'es',
  BR:'pt', PT:'pt', AO:'pt', MZ:'pt', FR:'fr', BE:'fr', CI:'fr', SN:'fr', CM:'fr', MA:'fr', DZ:'fr', TN:'fr', DE:'de', AT:'de', CH:'de', IT:'it', NL:'nl',
  PL:'pl', CZ:'cs', SK:'sk', HU:'hu', RO:'ro', BG:'bg', GR:'el', RS:'sr', HR:'hr', SI:'sl', LT:'lt', LV:'lv', EE:'et', FI:'fi', SE:'sv', NO:'nb', DK:'da',
  RU:'ru', UA:'uk', BY:'ru', KZ:'ru', UZ:'uz', AZ:'az', GE:'ka', AM:'hy', TR:'tr', IL:'he', SA:'ar', AE:'ar', EG:'ar', JO:'ar', IQ:'ar', LB:'ar', KW:'ar', QA:'ar',
  IR:'fa', PK:'ur', BD:'bn', IN:'hi', NP:'ne', LK:'si', TH:'th', VN:'vi', ID:'id', MY:'ms', PH:'tl', CN:'zh', TW:'zh', HK:'zh', JP:'ja', KR:'ko', MM:'my', KH:'km',
  ET:'am', KE:'sw', TZ:'sw', UG:'en', RW:'rw', ZM:'en', ZW:'en', GH:'en', NG:'en', ZA:'en' };
const nameOf = (cc) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) || ''; } catch (e) { return ''; } };
const normN = (x) => String(x).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const catalogueOf = (cc) => { try { return Object.values(JSON.parse(readFileSync(join(ROOT, 'data/countries', cc + '.json'), 'utf8')).kinds || {}).flat(); } catch (e) { return []; } };
const qidOf = (cc) => { try { return JSON.parse(readFileSync(join(ROOT, 'data/countries', cc + '.json'), 'utf8')).qid || ''; } catch (e) { return ''; } };
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } };

const prev = existsSync(join(ROOT, 'data/facts-sources.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/facts-sources.json'), 'utf8')) : {};
const result = only.length ? prev : {};
const tally = {};
for (const [cc, f] of Object.entries(FACTS)) {
  if (only.length && !only.includes(cc)) continue;
  const q = qidOf(cc), cr = await crux(cc), cat = catalogueOf(cc);
  result[cc] = {};
  const t = tally[cc] = { verified: 0, generic: 0, unresolved: [] };
  for (const [field, v] of Object.entries(f)) {
    if (field === 'cur') continue;
    result[cc][field] = [];
    for (const raw of items(v)) {
      const n = clean(raw);
      if (GENERIC.test(raw) || GENERIC.test(n)) { result[cc][field].push({ n, how: 'generic' }); t.generic++; continue; }
      let best = null;
      /* A name that is an address (Amazon.com.br): the address itself. */
      const dom = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(n) ? n.toLowerCase() : '';
      if (dom && cr.byReg.get(reg(dom))) best = { n, how: 'visited', site: dom, r: cr.byReg.get(reg(dom)) };
      /* In the country's own catalogue (Wikidata, already checked there). */
      if (!best) {
        const k = normN(n), e = cat.find(x => normN(x.n) === k || (k.length >= 4 && normN(x.n).startsWith(k + ' ')));
        if (e) best = { n, q: e.q, how: 'catalogue', site: e.s, r: e.r };
      }
      /* Wikidata: in English, in the country's language, and with the
         country's name, so "Chase" finds the bank and not the verb. */
      const tries = [[n, 'en'], [n, LANG[cc] || 'en'], [n + ' ' + nameOf(cc), 'en']];
      for (const [term, lang] of tries) {
        if (best) break;
        const ids = await search(term, lang); await sleep(100);
        const cl = ids.length ? await claims(ids) : {};
        for (const id of ids) {
          const e = cl[id]; if (!e) continue;
          const sites = e.site.map(hostOf).filter(Boolean);
          const r = Math.min(...sites.map(h => cr.byReg.get(reg(h)) || Infinity));
          if (q && e.country.includes(q)) { best = { n, q: id, how: 'in-country', site: sites[0] || '', r: isFinite(r) ? r : undefined }; break; }
          if (isFinite(r) && !best) best = { n, q: id, how: 'visited', site: sites.find(h => cr.byReg.get(reg(h)) === r), r };
        }
      }
      if (best) { result[cc][field].push(best); t.verified++; }
      else { result[cc][field].push({ n, how: 'unresolved' }); t.unresolved.push(field + ': ' + n); }
    }
  }
  console.log(cc, cr.ym, 'verified', t.verified, 'generic', t.generic, 'unresolved', t.unresolved.length);
}

writeFileSync(join(ROOT, 'data/facts-sources.json'), JSON.stringify(result, null, 1) + '\n');
const rows = Object.entries(result).map(([cc, fs]) => {
  const all = Object.values(fs).flat();
  const c = (h) => all.filter(x => x.how === h).length;
  return { cc, v: c('in-country') + c('visited') + c('catalogue'), g: c('generic'), u: all.filter(x => x.how === 'unresolved').map(x => x.n), n: all.length };
});
const sum = (k) => rows.reduce((a, r) => a + (Array.isArray(r[k]) ? r[k].length : r[k]), 0);
const md = ['# Country facts, checked against Wikidata and the Chrome UX Report', '',
  'Generated by `scripts/facts-check.mjs` (the `facts-check` workflow) on ' + new Date().toISOString().slice(0, 10) + '. Every name in',
  '`COUNTRY_FACTS` (src/worker/65-country-capabilities.js) is looked up: **verified** when a Wikidata entry',
  'found for it is in that country (country, origin or jurisdiction), it is an entry of the country’s own',
  'catalogue (data/countries), or its official website is in that country’s Chrome UX Report list;',
  '**generic** when it is a phrase, not a name; **unresolved** otherwise. Sources per name: `data/facts-sources.json`.', '',
  '**' + sum('v') + ' verified, ' + sum('g') + ' generic, ' + sum('u') + ' unresolved, of ' + sum('n') + ' names in ' + rows.length + ' countries.**', '',
  '| Country | Verified | Generic | Unresolved | Unresolved names |', '|---|---|---|---|---|',
  ...rows.map(r => '| ' + r.cc + ' | ' + r.v + ' | ' + r.g + ' | ' + r.u.length + ' | ' + r.u.join('; ').replace(/\|/g, '/') + ' |'), ''];
writeFileSync(join(ROOT, 'docs/FACTS-CHECK.md'), md.join('\n'));
console.log('done:', sum('v'), 'verified,', sum('g'), 'generic,', sum('u'), 'unresolved');
