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
   reachable from there); node scripts/facts-check.mjs [CC ...] [--wider | --report]. */
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
const only = process.argv.slice(2).filter(a => !a.startsWith('--')).map(s => s.toUpperCase());
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
/* A description, not a name: Latin words with no capital anywhere ("bank
   transfers", "state board exams", "automobile tax"). It names no entity to
   look up, so it is generic, like "your state DMV". Never a single word, and never in a field of company names, where brands
   are often written in lower case (foundit, telebirr, monobank, ueno). */
const COMPANY = new Set(['banks', 'cards', 'pay', 'jobs', 'shop', 'groc', 'food', 'prop', 'telco', 'news', 'post', 'rail']);
const DESCRIPTION = (n, field) => !COMPANY.has(field) && /\s/.test(n.trim()) && /^[\p{Script=Latin}\s.'’-]+$/u.test(n) && !/\p{Lu}/u.test(n);
const isGeneric = (raw, n, field) => GENERIC.test(raw) || GENERIC.test(n) || DESCRIPTION(n, field);
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
    const u = API + '?action=wbgetentities&format=json&props=claims|labels|aliases&languages=' + (claims.langs || 'en') + '&ids=' + ids.slice(i, i + 50).join('|');
    const r = await get(u); if (!r) continue;
    const j = await r.json().catch(() => null);
    for (const [id, e] of Object.entries((j && j.entities) || {})) {
      const c = e.claims || {};
      const val = (p) => (c[p] || []).map(s => s.mainsnak && s.mainsnak.datavalue && s.mainsnak.datavalue.value).filter(Boolean);
      /* Where it is: its country (P17), its country of origin (P495), or the
         jurisdiction it applies to (P1001 - a tax authority, a national exam). */
      const names = [...Object.values(e.labels || {}).map(l => l.value), ...Object.values(e.aliases || {}).flat().map(a => a.value)];
      out[id] = { label: (e.labels && e.labels.en && e.labels.en.value) || names[0] || '', names,
                  country: [...val('P17'), ...val('P495'), ...val('P1001')].map(v => v && v.id).filter(Boolean), site: val('P856').map(String),
                  /* Linked entities whose own country says where this is:
                     headquarters (P159), location (P131), parent (P749),
                     operator (P137), owner (P127). Read by the wider pass. */
                  linked: [...val('P159'), ...val('P131'), ...val('P749'), ...val('P137'), ...val('P127')].map(v => v && v.id).filter(Boolean) };
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

/* --wider: only the names still unresolved, with two more ways in - an
   entity linked to the candidate (its headquarters, location, parent,
   operator or owner) placed in the country, and the articles the country's
   own-language Wikipedia finds for the name, as more candidates. */
const WIDER = process.argv.includes('--wider');
async function wikiCandidates(name, lang) {
  const u = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=5&srsearch=' + encodeURIComponent(name);
  const r = await get(u); if (!r) return [];
  const j = await r.json().catch(() => null);
  const titles = ((j && j.query && j.query.search) || []).map(x => x.title);
  if (!titles.length) return [];
  const u2 = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&ppprop=wikibase_item&titles=' + encodeURIComponent(titles.join('|'));
  const r2 = await get(u2); if (!r2) return [];
  const j2 = await r2.json().catch(() => null);
  return Object.values((j2 && j2.query && j2.query.pages) || {}).map(p => p.pageprops && p.pageprops.wikibase_item).filter(Boolean);
}
/* The wider pass takes candidates from a fuzzy search, so a candidate counts
   only when one of its own names (label or alias, in English or the country's
   language) shares a significant word with the name being checked - SPEI is
   not verified by finding Banco de Mexico. */
const words = (x) => normN(x).split(' ').filter(w => w.length >= 3 || /[^\x00-\x7f]/.test(w));
/* A shared word was not enough (run 4: Parivahan found Pune's bus company,
   "Freedom" found Freedom House). Every significant word of the name must be
   in one of the candidate's names, with at most two words more. */
/* A one-word name is where a loose match goes wrong ("STK" found a football
   club, "Health NZ" the ministry): it needs the same name, or the same name
   and one ordinary company word. */
const ORG = new Set(['bank', 'banco', 'group', 'grupo', 'ltd', 'limited', 'plc', 'inc', 'company', 'supermarket', 'supermarkets',
  'supermercados', 'supermercado', 'stores', 'store', 'telecom', 'mobile', 'post', 'holding', 'holdings']);
const sameName = (n, e) => { const a = words(n); if (!a.length) return false;
  return (e.names || [e.label]).some(x => { const b = words(x); if (normN(x) === normN(n)) return true;
    if (!a.every(w => b.includes(w))) return false;
    const extra = b.filter(w => !a.includes(w));
    return a.length === 1 ? extra.length === 1 && ORG.has(extra[0]) : extra.length <= 2; }); };
/* And only what the wider pass can stand behind: an organization with a
   website of its own, not the country itself, placed in the country (or
   through its owner) - not merely visited from it, which is how Ireland's
   "Passport Office" became the UK's. */
const widerOk = (r, q) => r && r.q !== q && r.how !== 'visited' && !!r.site && sameName(r.n, { label: r.as || '' });
async function wider(n, cc, q, cr) {
  const lang = LANG[cc] || 'en';
  claims.langs = lang === 'en' ? 'en' : 'en|' + lang;
  const ids = [...new Set([...(await search(n, 'en')), ...(await search(n, lang)), ...(await wikiCandidates(n, lang)), ...(lang !== 'en' ? await wikiCandidates(n, 'en') : [])])].slice(0, 25);
  if (!ids.length) return null;
  const cl = await claims(ids);
  const links = [...new Set(Object.values(cl).flatMap(e => e.linked))];
  claims.langs = 'en';
  const lc = links.length ? await claims(links) : {};
  for (const id of ids) {
    const e = cl[id]; if (!e || !sameName(n, e)) continue;
    const sites = e.site.map(hostOf).filter(Boolean);
    const r = Math.min(...sites.map(h => cr.byReg.get(reg(h)) || Infinity));
    const as = e.label || (e.names || [])[0] || '';
    if (id === q || !sites.length) continue;
    if (e.country.includes(q)) return { n, q: id, as, how: 'in-country', site: sites[0] || '', r: isFinite(r) ? r : undefined };
    const via = e.linked.find(l => lc[l] && lc[l].country.includes(q));
    if (via) return { n, q: id, as, how: 'linked', via, site: sites[0] || '' };
  }
  return null;
}

/* --report: no lookups - apply the generic rule to the stored result and write
   the report again (a rule changed; nothing needs looking up). */
const REPORT_ONLY = process.argv.includes('--report');
const prev = existsSync(join(ROOT, 'data/facts-sources.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/facts-sources.json'), 'utf8')) : {};
const result = (only.length || REPORT_ONLY || WIDER) ? prev : {};
if (WIDER) {
  let found = 0, tried = 0;
  for (const [cc, fs] of Object.entries(result)) {
    if (only.length && !only.includes(cc)) continue;
    const open = Object.values(fs).flat().filter(x => x.how === 'unresolved'); if (!open.length) continue;
    const q = qidOf(cc), cr = await crux(cc);
    for (const x of open) { tried++; const b = await wider(x.n, cc, q, cr); await sleep(100); if (b) { Object.assign(x, b); found++; } }
    console.log(cc, 'wider:', open.filter(x => x.how !== 'unresolved').length, 'of', open.length);
  }
  console.log('wider pass:', found, 'of', tried, 'found');
}
if (REPORT_ONLY) for (const [cc, fs] of Object.entries(result)) for (const [field, l] of Object.entries(fs))
  for (let i = 0; i < l.length; i++) { const x = l[i];
    if (x.how === 'unresolved' && isGeneric(x.n, x.n, field)) x.how = 'generic';
    /* A wider-pass result (it records the entity's name, `as`) that the
       current rule would not accept goes back to unresolved. */
    if (x.as !== undefined && !widerOk(x, qidOf(cc))) l[i] = { n: x.n, how: 'unresolved' }; }
const tally = {};
for (const [cc, f] of Object.entries((REPORT_ONLY || WIDER) ? {} : FACTS)) {
  if (only.length && !only.includes(cc)) continue;
  const q = qidOf(cc), cr = await crux(cc), cat = catalogueOf(cc);
  result[cc] = {};
  const t = tally[cc] = { verified: 0, generic: 0, unresolved: [] };
  for (const [field, v] of Object.entries(f)) {
    if (field === 'cur') continue;
    result[cc][field] = [];
    for (const raw of items(v)) {
      const n = clean(raw);
      if (isGeneric(raw, n, field)) { result[cc][field].push({ n, how: 'generic' }); t.generic++; continue; }
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
      /* A name cited by hand (how: "cited", read from facts-candidates.json
         match by match) keeps its citation through any later run that finds
         nothing automatic: a re-run must never quietly undo research. */
      if (!best) best = ((prev[cc] && prev[cc][field]) || []).find(x => x.how === 'cited' && x.n === n) || null;
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
  return { cc, v: c('in-country') + c('visited') + c('catalogue') + c('linked') + c('cited'), g: c('generic'), u: all.filter(x => x.how === 'unresolved').map(x => x.n), n: all.length };
});
const sum = (k) => rows.reduce((a, r) => a + (Array.isArray(r[k]) ? r[k].length : r[k]), 0);
const md = ['# Country facts, checked against Wikidata and the Chrome UX Report', '',
  'Generated by `scripts/facts-check.mjs` (the `facts-check` workflow) on ' + new Date().toISOString().slice(0, 10) + '. Every name in',
  '`COUNTRY_FACTS` (src/worker/65-country-capabilities.js) is looked up: **verified** when a Wikidata entry',
  'found for it is in that country (country, origin or jurisdiction), it is an entry of the country’s own',
  'catalogue (data/countries), or its official website is in that country’s Chrome UX Report list,',
  'or it was cited by hand (`how: cited`): the Wikidata entry that is plainly that thing in that country, or its own',
  'website (data/facts-sites.json) found in that country’s Chrome UX Report list;',
  '**generic** when it is a phrase, not a name; **unresolved** otherwise. Sources per name: `data/facts-sources.json`.', '',
  '**' + sum('v') + ' verified, ' + sum('g') + ' generic, ' + sum('u') + ' unresolved, of ' + sum('n') + ' names in ' + rows.length + ' countries.**', '',
  '| Country | Verified | Generic | Unresolved | Unresolved names |', '|---|---|---|---|---|',
  ...rows.map(r => '| ' + r.cc + ' | ' + r.v + ' | ' + r.g + ' | ' + r.u.length + ' | ' + r.u.join('; ').replace(/\|/g, '/') + ' |'), ''];
writeFileSync(join(ROOT, 'docs/FACTS-CHECK.md'), md.join('\n'));
console.log('done:', sum('v'), 'verified,', sum('g'), 'generic,', sum('u'), 'unresolved');
