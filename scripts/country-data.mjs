#!/usr/bin/env node
/* COUNTRY DATA, FROM WIKIDATA (Nov 10).

   The owner's bar: Tasks, Crew and Integrations each carry 500+ entries for
   every country, every one of them a real, named service there - "backed by
   real data", not a template with the country's name pasted in.

   Source: Wikidata, the structured database behind Wikipedia. For each
   country and each kind of service (banks, universities, newspapers, telecom
   operators, airlines, retailers, government agencies, insurers, hospitals,
   rail operators, TV channels, utilities, airports, museums...) it asks for
   the organisations that are IN that country, HAVE an official website, and
   are NOT dissolved - ranked by how many Wikipedia language editions have an
   article on them (wikibase:sitelinks), which is a public, checkable measure
   of how prominent something is. Every entry keeps its Wikidata ID, so any
   one of them can be looked up and checked by anybody.

   Run where Wikidata is reachable (the country-data workflow does it):
     node scripts/country-data.mjs            all countries AMV lists
     node scripts/country-data.mjs ES US      just these
   Writes data/countries/<CC>.json and prints, first, what each class ID it
   asks about is called on Wikidata - so a wrong ID shows up in the log as the
   wrong word rather than as quietly wrong data. */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'countries');
const EP = 'https://query.wikidata.org/sparql';
const UA = 'AMV-country-data/1.0 (public-data builder; contact via the project repository)';

/* kind -> [Wikidata class, how many to keep, label]. The class is matched with
   P31/P279? (an instance of it, or of a direct subclass), which keeps each
   query inside Wikidata's time limit. */
export const KINDS = {
  bank:        ['Q22687',    40, 'bank'],
  insurer:     ['Q6881511',  25, 'insurance company'],
  university:  ['Q3918',     60, 'university'],
  college:     ['Q38723',    40, 'higher education institution'],
  newspaper:   ['Q11032',    40, 'newspaper'],
  newssite:    ['Q1153191',  25, 'online newspaper'],
  tv:          ['Q2001305',  25, 'television channel'],
  radio:       ['Q14350',    20, 'radio station'],
  telecom:     ['Q1941618',  20, 'mobile network operator'],
  isp:         ['Q1182203',  15, 'internet service provider'],
  airline:     ['Q46970',    20, 'airline'],
  airport:     ['Q1248784',  25, 'airport'],
  rail:        ['Q249556',   15, 'railway company'],
  bus:         ['Q740752',   15, 'transport company'],
  retail:      ['Q507619',   40, 'retail chain'],
  supermarket: ['Q18043413', 25, 'supermarket chain'],
  ecommerce:   ['Q484847',   25, 'e-commerce company'],
  restaurant:  ['Q18534542', 20, 'restaurant chain'],
  hotel:       ['Q5893268',  15, 'hotel chain'],
  agency:      ['Q327333',   60, 'government agency'],
  ministry:    ['Q192350',   30, 'ministry'],
  hospital:    ['Q16917',    40, 'hospital'],
  utility:     ['Q1326624',  15, 'electric utility'],
  carmaker:    ['Q786820',   15, 'automobile manufacturer'],
  museum:      ['Q33506',    30, 'museum'],
  library:     ['Q7075',     15, 'library'],
  sportsclub:  ['Q476028',   25, 'association football club'],
  employer:    ['Q891723',   40, 'public company'],
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function sparql(q, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(EP + '?format=json&query=' + encodeURIComponent(q), { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
    if (r.ok) return (await r.json()).results.bindings;
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1) * (i + 1)); continue; }
    throw new Error('wikidata ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  throw new Error('wikidata kept refusing');
}
const qid = (uri) => String(uri).split('/').pop();

async function main() {
  mkdirSync(OUT, { recursive: true });
  /* The countries AMV lists: the client's own list, so nothing here invents one. */
  const want = process.argv.slice(2).map(s => s.toUpperCase());
  const src = readFileSync(join(ROOT, 'src', 'worker', '65-country-capabilities.js'), 'utf8');
  const block = src.slice(src.indexOf('const COUNTRY_NAME = {'), src.indexOf('};', src.indexOf('const COUNTRY_NAME = {')));
  const listed = [...new Set([...block.matchAll(/\b([A-Z]{2}):\s*'/g)].map(m => m[1]))];
  const codes = want.length ? want : listed;

  /* What each class is called - the check that the IDs above mean what they say. */
  const cls = Object.values(KINDS).map(k => 'wd:' + k[0]).join(' ');
  const names = await sparql(`SELECT ?c ?l WHERE { VALUES ?c { ${cls} } ?c rdfs:label ?l FILTER(LANG(?l)="en") }`);
  const said = Object.fromEntries(names.map(b => [qid(b.c.value), b.l.value]));
  for (const [kind, [q, , meant]] of Object.entries(KINDS)) console.log('class', kind.padEnd(12), q.padEnd(10), 'is "' + (said[q] || '?') + '"', said[q] === meant ? '' : '  <-- expected "' + meant + '"');

  const iso = await sparql(`SELECT ?c ?code WHERE { ?c wdt:P297 ?code . FILTER NOT EXISTS { ?c wdt:P576 ?end } }`);
  const qOf = {}; for (const b of iso) if (!qOf[b.code.value]) qOf[b.code.value] = qid(b.c.value);

  for (const cc of codes) {
    const cq = qOf[cc];
    if (!cq) { console.log(cc, 'no Wikidata country'); continue; }
    const out = { cc, qid: cq, source: 'Wikidata (query.wikidata.org), ranked by Wikipedia sitelinks', generated: new Date().toISOString().slice(0, 10), kinds: {} };
    let total = 0;
    for (const [kind, [klass, keep]] of Object.entries(KINDS)) {
      const q = `SELECT ?i ?l ?site ?n WHERE {
        ?i wdt:P31/wdt:P279? wd:${klass} ; wdt:P17 wd:${cq} ; wdt:P856 ?site ; wikibase:sitelinks ?n .
        FILTER NOT EXISTS { ?i wdt:P576 ?gone } FILTER NOT EXISTS { ?i wdt:P582 ?ended }
        ?i rdfs:label ?l . FILTER(LANG(?l) = "en" || LANG(?l) = "mul")
      } ORDER BY DESC(?n) LIMIT ${keep * 3}`;
      let rows = [];
      try { rows = await sparql(q); } catch (e) { console.log(cc, kind, 'failed:', e.message); }
      const seen = new Set(), list = [];
      for (const b of rows) {
        const id = qid(b.i.value); if (seen.has(id)) continue; seen.add(id);
        let host = ''; try { host = new URL(b.site.value).hostname.replace(/^www\./, ''); } catch (e) { continue; }
        if (!host || list.some(x => x.s === host)) continue;
        list.push({ q: id, n: b.l.value, s: host, w: +b.n.value });
        if (list.length >= keep) break;
      }
      out.kinds[kind] = list; total += list.length;
      await sleep(350);
    }
    out.total = total;
    writeFileSync(join(OUT, cc + '.json'), JSON.stringify(out));
    console.log(cc, total, Object.entries(out.kinds).map(([k, v]) => k + ':' + v.length).join(' '));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
