/* EVERY NAME IN THE COUNTRY FACTS, CHECKED AGAINST A SOURCE (Nov 16, the
   owner: "all backed up by research - every section, every country").

   COUNTRY_FACTS (src/worker/65-country-capabilities.js) names, per country,
   the tax office, the banks, the job sites, the shops ... that Crew's job
   titles and runs use. It was written from well-known facts with no source per
   name. This looks every name up:

     1. Wikidata's search (wbsearchentities), then each candidate's claims
        (wbgetentities): country (P17) and official website (P856).
     2. VERIFIED, IN THE COUNTRY: a candidate whose country is this country.
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

async function search(name) {
  const u = API + '?action=wbsearchentities&format=json&type=item&limit=6&language=en&uselang=en&strictlanguage=false&search=' + encodeURIComponent(name);
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
      out[id] = { label: (e.labels && e.labels.en && e.labels.en.value) || '', country: val('P17').map(v => v.id), site: val('P856').map(String) };
    }
  }
  return out;
}

const qidOf = (cc) => { try { return JSON.parse(readFileSync(join(ROOT, 'data/countries', cc + '.json'), 'utf8')).qid || ''; } catch (e) { return ''; } };
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } };

const prev = existsSync(join(ROOT, 'data/facts-sources.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/facts-sources.json'), 'utf8')) : {};
const result = only.length ? prev : {};
const tally = {};
for (const [cc, f] of Object.entries(FACTS)) {
  if (only.length && !only.includes(cc)) continue;
  const q = qidOf(cc), cr = await crux(cc);
  result[cc] = {};
  const t = tally[cc] = { verified: 0, generic: 0, unresolved: [] };
  for (const [field, v] of Object.entries(f)) {
    if (field === 'cur') continue;
    result[cc][field] = [];
    for (const raw of items(v)) {
      const n = clean(raw);
      if (GENERIC.test(raw) || GENERIC.test(n)) { result[cc][field].push({ n, how: 'generic' }); t.generic++; continue; }
      const ids = await search(n); await sleep(120);
      const cl = ids.length ? await claims(ids) : {};
      let best = null;
      for (const id of ids) {
        const e = cl[id]; if (!e) continue;
        const sites = e.site.map(hostOf).filter(Boolean);
        const r = Math.min(...sites.map(h => cr.byReg.get(reg(h)) || Infinity));
        if (q && e.country.includes(q)) { best = { n, q: id, how: 'in-country', site: sites[0] || '', r: isFinite(r) ? r : undefined }; break; }
        if (isFinite(r) && !best) best = { n, q: id, how: 'visited', site: sites.find(h => cr.byReg.get(reg(h)) === r), r };
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
  return { cc, v: c('in-country') + c('visited'), g: c('generic'), u: all.filter(x => x.how === 'unresolved').map(x => x.n), n: all.length };
});
const sum = (k) => rows.reduce((a, r) => a + (Array.isArray(r[k]) ? r[k].length : r[k]), 0);
const md = ['# Country facts, checked against Wikidata and the Chrome UX Report', '',
  'Generated by `scripts/facts-check.mjs` (the `facts-check` workflow) on ' + new Date().toISOString().slice(0, 10) + '. Every name in',
  '`COUNTRY_FACTS` (src/worker/65-country-capabilities.js) is looked up: **verified** when a Wikidata entry',
  'found for it is in that country, or its official website is in that country’s Chrome UX Report list;',
  '**generic** when it is a phrase, not a name; **unresolved** otherwise. Sources per name: `data/facts-sources.json`.', '',
  '**' + sum('v') + ' verified, ' + sum('g') + ' generic, ' + sum('u') + ' unresolved, of ' + sum('n') + ' names in ' + rows.length + ' countries.**', '',
  '| Country | Verified | Generic | Unresolved | Unresolved names |', '|---|---|---|---|---|',
  ...rows.map(r => '| ' + r.cc + ' | ' + r.v + ' | ' + r.g + ' | ' + r.u.length + ' | ' + r.u.join('; ').replace(/\|/g, '/') + ' |'), ''];
writeFileSync(join(ROOT, 'docs/FACTS-CHECK.md'), md.join('\n'));
console.log('done:', sum('v'), 'verified,', sum('g'), 'generic,', sum('u'), 'unresolved');
