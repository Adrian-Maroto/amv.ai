#!/usr/bin/env node
/* EVERY SERVICE CREW NAMES, FOUND SO INTEGRATIONS CAN LIST IT (Nov 23).

   The owner: "integrations ... backed up by Crew jobs as well, because you
   might need something for Crew, some integration, and I want it to also be
   included in integrations". Crew's jobs for a country name its services
   from COUNTRY_FACTS (src/worker/65-country-capabilities.js) - its banks,
   payment apps, job sites, shops, groceries, food delivery, rail, property
   sites, phone companies, post, news, health and government services. Those
   are names; this finds each one's Wikidata item and official website,
   preferring one in that country, so the build can list it under its topic
   for that country.

   Each name is searched with the query service's entity search
   (wikibase:mwapi EntitySearch) and the candidate with an official website
   that is in the country (P17) is taken, else the best-covered one whose
   label is the name. A name that resolves to nothing is logged and skipped.

   Run where Wikidata is reachable (the crew-services workflow does it):
     node scripts/crew-services.mjs [CC ...]
   Writes data/crew-services/<CC>.json: { cc, generated, items: [{ f, name, q, n, s }] } */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'crew-services');
const EP = 'https://query.wikidata.org/sparql';
const UA = 'AMV-crew-services/1.0 (public-data builder; contact via the project repository)';

/* The facts that name services people use, and the Integrations topic each
   belongs under. Currency, exams and the like are not services. */
export const FACT_TOPIC = { banks: 'money', cards: 'money', pay: 'money', jobs: 'jobs', shop: 'shop', groc: 'shop', food: 'food',
  rail: 'travel', prop: 'home', telco: 'home', post: 'home', news: 'news', health: 'health', gov: 'gov', tax: 'gov', id: 'gov', car: 'gov', uni: 'school' };

export function countryFacts(root = ROOT) {
  const w = readFileSync(join(root, 'src', 'worker', '65-country-capabilities.js'), 'utf8');
  const m = w.match(/const COUNTRY_FACTS = (\{[\s\S]*?\n\});/);
  return m ? (0, eval)('(' + m[1] + ')') : {};
}
/* The service names in one fact: "Chase, Bank of America and Citi" -> three.
   Phrases that are not a service ("your insurer", "bank transfers") go. */
export function namesIn(v) {
  if (typeof v !== 'string') return [];
  return v.replace(/\(([^)]*)\)/g, ', $1').split(/,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+|;\s*/)
    .map(s => s.replace(/^(the|your)\s+/i, '').replace(/\s+(where|when|if)\b.*$/i, '').trim())
    .filter(s => s.length >= 2 && s.length <= 60 && !/\b(your|transfers?|board|exams?|local|regional|state|provincial|municipal|nearest|any|own)\b/i.test(s) && !/^[a-z]/.test(s));
}

/* WHICH LOOKED-UP MATCHES ARE BELIEVED (Nov 23).

   A name is looked up by searching for it, and a search always answers with
   something: the first run matched Kenya's tax authority (KRA) to Krakow,
   Pakistan's (FBR) to Fortnite Battle Royale, New Zealand's Spark to Apache
   Spark and the UAE's ICP to a band. Half of the 2,331 answers were not in
   the country at all. So a match is kept only when:
   - the item is IN the country (P17 there), and its site is not another
     country's domain (Halyk Bank of Kazakhstan came back with a Georgian
     bank's site); or
   - it is NOT in the country but its label IS the name, its site is not
     another country's domain, the site is one of AMV's checked worldwide
     services (data/global) AND people in that country visit it (Chrome UX
     Report, data/global-reach.json) - so a text browser called Links is never
     Croatia's shop, Hermes the parcel firm is never Hermes the fashion house,
     and Banco Galicia is never the government of Galicia.
   Everything else is not found, and says so. */
/* A brand's .com that is ONE country's shop, so it is never another
   country's: walmart.com and costco.com sell in the US only (Costa Rica's
   Walmart is walmart.co.cr, Canada's Costco costco.ca), amazon.com is the US
   store, and jumbo.com is the Dutch supermarket, not Cencosud's Jumbo in
   Argentina, Chile or the Dominican Republic. */
const ONE_COUNTRY_SITE = { 'walmart.com': 'US', 'costco.com': 'US', 'amazon.com': 'US', 'jumbo.com': 'NL' };
/* Sites the second lookup matched by name that are a different thing - each
   read, each named: sas.com is the software company (not Armenia's SAS
   supermarkets), inaturalist.org runs the Seek nature app (not Seek the job
   site), bondinho.com.br is Sugarloaf Mountain's cable car (not Pão de Açúcar
   the grocer), elster-elbe.de is a local site (not ELSTER, Germany's tax
   portal), ams.com is a chip maker (not Austria's AMS job service),
   maccabi.org is a sports union (not the Maccabi health fund),
   ooredoosubscription.online is not Ooredoo's own site, erstebank.me is
   Erste's bank in Montenegro (not Austria's), and an archive copy is not a
   service. */
const NOT_THE_SERVICE = new Set(['sas.com', 'web.archive.org', 'inaturalist.org', 'bondinho.com.br', 'elster-elbe.de', 'ams.com', 'maccabi.org', 'ooredoosubscription.online', 'erstebank.me']);
const _GENERIC_TLD = new Set(['io', 'co', 'tv', 'me', 'eu', 'fm', 'gg', 'ly', 'to', 'cc']);
export function foreignSite(cc, site) {
  const tld = String(site || '').split('.').pop();
  if (tld.length !== 2 || _GENERIC_TLD.has(tld)) return false;
  return tld !== (cc === 'GB' ? 'uk' : cc.toLowerCase());
}
const _SUFFIX = /\b(the|group|plc|ltd|limited|inc|ag|kg|sa|s a|nv|bv|ab|asa|as|oy|oyj|gmbh|spa|corporation|corp|company|co|holdings?)\b/g;
export const plainName = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').replace(_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
/* THE MATCH HAS TO BE THE THING NAMED. A sponsor's name is on stadiums,
   arenas and teams, and a search for it finds those first: Optus came back
   as Perth Stadium, Scotiabank and Rogers as arenas, Nubank as Allianz
   Parque, Movistar as a cycling team, Maccabi (the health fund) as a
   football club. So the label must share a real word with the name, or the
   name must be the site's own domain (CommBank, commbank.com.au), and
   nothing that is a venue, a team or an award is a service. */
const _VENUE = /\b(arena|stadium|stadion|parque|park|field|boxen|f ?c|s ?c|k ?c|b ?c|h ?c|club|team|games|awards?|cup|league|open|handball|basketball|football|volleyball|festival|tournament)\b/;
const _VENUE_END = /\b(centre|center|dome|hall)$/;
const _GOV_SITE = /(^|\.)(gov|gob|gouv|gv|go|gub|govt|government|admin|bund)\.|\.gov$|\.gouv\.|\.gob\.|\.gub\.uy$/;
const _COMMON = new Set(['bank', 'banco', 'banca', 'national', 'post', 'posts', 'group', 'the', 'and', 'of', 'de', 'la', 'el', 'do', 'da', 'news', 'online', 'mobile', 'telecom', 'service', 'services', 'department', 'office', 'state', 'new', 'first', 'general', 'central']);
/* What may follow a one-word name in its label: "Yonhap News Agency",
   "Raiffeisen Bank International", "Korek Telecom" - not "Boubyan Takaful"
   (an insurer) or "Pekao Financial Services" (a subsidiary). */
const _REST = new Set(['news', 'agency', 'bank', 'banking', 'banka', 'group', 'grupe', 'grupo', 'gruppe', 'international', 'telecom', 'telecommunications',
  'market', 'express', 'logistics', 'uab', 'plc', 'ltd', 'sa', 'ag', 'company', 'corporation', 'holding', 'holdings', 'mobile', 'post', 'railway', 'railways',
  'communications', 'telekom', 'banka', 'bankas', 'pank', 'banco', 'store', 'stores', 'supermarket', 'supermarkets']);
const _SLD = new Set(['com', 'co', 'gov', 'gob', 'org', 'net', 'ac', 'edu', 'go', 'or', 'ne', 'gv', 'gouv', 'bank', 'nic', 'gub']);
const _SITE_TAIL = /^(|group|bank|banka|pank|app|online|global|hq|official|tv|news|pay|mobile|grupo|gruppe|eg|ag|de|es|fr|uk|us|in)$/;
function siteLabel(site) {
  const p = String(site || '').toLowerCase().split('.'); p.pop();
  if (p.length > 1 && _SLD.has(p[p.length - 1])) p.pop();
  return (p[p.length - 1] || '').replace(/-/g, '');
}
/* The site's own name is the service's: commbank.com.au for CommBank, but
   never amstetten.at for AMS or ingolstadt.de for ING. */
function siteIs(word, site) {
  const sl = siteLabel(site), c = word.replace(/ /g, '');
  return c.length >= 2 && (sl === c || (sl.startsWith(c) && _SITE_TAIL.test(sl.slice(c.length))));
}
/* A town that shares the name is not the company: Orange (France's phone
   company) is not ville-orange.fr, Mizuho and Yamato are not their cities'
   sites, Reforma (the paper) is not Reforma Municipality, and Hang Seng and
   Nikkei are not their stock indexes. */
const _PLACE_SITE = /(^|\.)(city|ville|comune|gemeinde|municipio|mairie|town|destination[a-z]*)[.-]|\.lg\.jp$|^destination|spork[uü]l[uü]b[uü]|sports?club|footballclub/;
const _NOT_A_SERVICE = /\b(municipality|municipio|province|county|district|prefecture|index|indexes|series|port of)\b|\b\d{2,4}$/;
/* "Receita Federal do Brasil", "National Tax Service of South Korea": the
   country's own name may follow, in its usual languages. */
const _OF = new Set(['of', 'do', 'da', 'de', 'du', 'del', 'the', 'republic']);
function countryWords(cc) {
  const out = new Set();
  if (!cc) return out;
  for (const l of ['en', 'es', 'pt', 'fr', 'de', 'it', localLang(cc)]) { try { plainName(new Intl.DisplayNames([l], { type: 'region' }).of(cc)).split(' ').forEach(w => w && out.add(w)); } catch (e) {} }
  return out;
}
export function nameFits(name, label, site, cc) {
  const here = countryWords(cc);
  /* ...and a domain ending, for labels like "bayt.com" or "Takealot.com". */
  const restOk = (rest) => rest.split(' ').every(w => _REST.has(w) || _OF.has(w) || here.has(w) || /^(com|net|org|info|me|[a-z]{2})$/.test(w));
  const a = plainName(name), b = plainName(label);
  if (!a || !b || /^q\d+$/.test(b) || _VENUE.test(b)) return false;
  if (_PLACE_SITE.test(String(site || '').toLowerCase()) || (_NOT_A_SERVICE.test(b) && !_NOT_A_SERVICE.test(a))) return false;
  const tail = b.match(_VENUE_END); if (tail && !a.includes(tail[1])) return false;
  /* A team's site is not the company's (movistarteam.com). */
  if (/(team|stadium|arena)[.-]|(team|stadium|arena)$/.test(siteLabel(site))) return false;
  if (a === b) return true;
  /* A label that EXTENDS the name with words of its own, where the site says
     the same words, is a different arm: "Vodafone Automotive" on
     automotive.vodafone.com, "NHS Wales" on nhs.wales, "Tuổi Trẻ Cười" (the
     humour title) on cuoi.tuoitre.vn - while "Kotak Mahindra Bank" on
     kotak.bank.in is the bank. */
  if (b.startsWith(a + ' ')) {
    const rest = b.slice(a.length + 1);
    if (restOk(rest)) return true;
    const host = String(site || '').toLowerCase();
    if (rest.split(' ').some(w => w.length >= 3 && !_REST.has(w) && host.includes(w))) return false;
  }
  if (!a.includes(' ')) return siteIs(a, site);
  if (siteIs(a, site)) return true;
  const words = (x) => x.split(' ').filter(w => w.length >= 3 && !_COMMON.has(w));
  const wa = words(a), wb = new Set(words(b));
  return wa.length > 0 && wa.every(w => wb.has(w)) && wa.some(w => siteLabel(site).includes(w));
}
/* visited(cc, host) -> true when the Chrome UX Report lists the host among
   the sites visited from that country. */
export function trustedMatch(cc, e, visited) {
  if (!e || typeof e.s !== 'string' || NOT_THE_SERVICE.has(e.s)) return false;
  if (foreignSite(cc, e.s)) return false;
  if (!nameFits(e.name, e.n, e.s, cc)) return false;
  if (e.here) return true;
  if (ONE_COUNTRY_SITE[e.s] && ONE_COUNTRY_SITE[e.s] !== cc) return false;
  return !!plainName(e.name) && plainName(e.name) === plainName(e.n) && !!visited.worldwide(e.s) && !!visited(cc, e.s);
}
export function visitsFrom(root = ROOT) {
  let R = null; try { R = JSON.parse(readFileSync(join(root, 'data', 'global-reach.json'), 'utf8')); } catch (e) {}
  const at = new Map(((R && R.hosts) || []).map((h, i) => [h, i]));
  const world = new Set();
  try { for (const f of readdirSync(join(root, 'data', 'global')).filter(f => /^[a-z]+\.json$/.test(f)))
    for (const e of JSON.parse(readFileSync(join(root, 'data', 'global', f), 'utf8')).items || []) world.add(e.s); } catch (e) {}
  const fn = (cc, host) => { const c = R && R.c && R.c[cc]; const i = at.get(host); return !!(c && i !== undefined && c[i] && c[i] !== '0'); };
  fn.worldwide = (host) => world.has(host);
  return fn;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function sparql(q, tries = 3) {
  for (let i = 0; i < tries; i++) {
    let r; try { r = await fetch(EP + '?format=json&query=' + encodeURIComponent(q), { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(60000) }); } catch (e) { await sleep(2000 * (i + 1)); continue; }
    if (r.ok) return (await r.json()).results.bindings;
    if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1) * (i + 1)); continue; }
    return [];
  }
  return [];
}
const esc = (s) => String(s).replace(/["\\]/g, '');
const qid = (u) => String(u).split('/').pop();

/* The country's usual language, for a second search in it: Sreality is
   found searching in Czech, not in English. */
function localLang(cc) { try { const l = new Intl.Locale('und-' + cc).maximize().language; return /^[a-z]{2,3}$/.test(l) ? l : 'en'; } catch (e) { return 'en'; } }
async function candidates(name, cc, lang) {
  const q = `SELECT ?i ?site ?n ?iLabel ?inCountry WHERE {
    SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search "${esc(name)}"; mwapi:language "${esc(lang)}"; mwapi:limit "15". ?i wikibase:apiOutputItem mwapi:item. }
    ?i wdt:P856 ?site ; wikibase:sitelinks ?n .
    FILTER NOT EXISTS { ?i wdt:P31 wd:Q5 } FILTER NOT EXISTS { ?i wdt:P576 ?gone }
    OPTIONAL { ?c wdt:P297 "${esc(cc)}" . { ?i wdt:P17 ?c } UNION { ?i wdt:P159/wdt:P17 ?c } BIND(true AS ?inCountry) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${esc(lang)},en,mul". }
  }`;
  const rows = [];
  for (const b of await sparql(q)) {
    let host = ''; try { const u = new URL(b.site.value); if (!/^https?:$/.test(u.protocol)) continue; host = u.hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) continue;
    rows.push({ q: qid(b.i.value), n: (b.iLabel && b.iLabel.value) || name, s: host, w: +b.n.value, here: !!b.inCountry });
  }
  return rows;
}
/* The best candidate that IS the service (nameFits, not another country's
   domain): in the country first, then the best covered. A search's first
   answer is not taken just for being first - that is how KRA became Krakow.
   null when none fits: the name is reported missing, not guessed. */
/* A Wikipedia search for the name AND the country - "KRA Kenya" finds the
   Kenya Revenue Authority, "Sreality Czech Republic" finds Sreality - in
   English and the country's language. Used only when the name search found
   nothing that passes; its answers pass the same checks. */
async function wikiCandidates(name, cc, lang) {
  let place = cc; try { place = new Intl.DisplayNames([lang], { type: 'region' }).of(cc) || cc; } catch (e) {}
  const q = `SELECT ?i ?site ?n ?iLabel ?inCountry WHERE {
    SERVICE wikibase:mwapi { bd:serviceParam wikibase:api "Generator"; wikibase:endpoint "${esc(lang)}.wikipedia.org"; mwapi:generator "search"; mwapi:gsrsearch "${esc(name + ' ' + place)}"; mwapi:gsrlimit "6". ?i wikibase:apiOutputItem mwapi:item. }
    ?i wdt:P856 ?site ; wikibase:sitelinks ?n .
    FILTER NOT EXISTS { ?i wdt:P31 wd:Q5 } FILTER NOT EXISTS { ?i wdt:P576 ?gone }
    OPTIONAL { ?c wdt:P297 "${esc(cc)}" . { ?i wdt:P17 ?c } UNION { ?i wdt:P159/wdt:P17 ?c } BIND(true AS ?inCountry) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${esc(lang)},en,mul". }
  }`;
  const rows = [];
  for (const b of await sparql(q)) {
    let host = ''; try { const u = new URL(b.site.value); if (!/^https?:$/.test(u.protocol)) continue; host = u.hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) continue;
    rows.push({ q: qid(b.i.value), n: (b.iLabel && b.iLabel.value) || name, s: host, w: +b.n.value, here: !!b.inCountry });
  }
  return rows;
}
async function resolve(name, cc) {
  const lang = localLang(cc);
  const pick = (rows) => { const fit = rows.filter(r => !foreignSite(cc, r.s) && !NOT_THE_SERVICE.has(r.s) && nameFits(name, r.n, r.s, cc));
    fit.sort((a, b) => (b.here - a.here) || (b.w - a.w)); return fit[0] || null; };
  const rows = await candidates(name, cc, 'en');
  if (lang !== 'en') { await sleep(250); rows.push(...await candidates(name, cc, lang)); }
  const first = pick(rows); if (first) return first;
  await sleep(250);
  const wiki = await wikiCandidates(name, cc, 'en');
  if (lang !== 'en') { await sleep(250); try { wiki.push(...await wikiCandidates(name, cc, lang)); } catch (e) {} }
  /* Only what is in the country: a full-text search finds articles that
     merely mention the name, so an outside answer is not taken from it. */
  return pick(wiki.filter(r => r.here));
}

/* `--again`: keep every match already believed and look up only the rest. */
async function main() {
  mkdirSync(OUT, { recursive: true });
  const facts = countryFacts();
  const again = process.argv.includes('--again');
  const only = process.argv.slice(2).filter(a => !a.startsWith('--')).map(s => s.toUpperCase()).filter(c => facts[c]);
  const visited = visitsFrom();
  const END = Date.now() + (+process.env.BUDGET_MIN || 100) * 60000;
  for (const cc of only.length ? only : Object.keys(facts)) {
    if (Date.now() > END) { console.log(cc, 'not asked: out of time'); continue; }
    let before = null; try { before = JSON.parse(readFileSync(join(OUT, cc + '.json'), 'utf8')); } catch (e) {}
    const kept = again && before ? (before.items || []).filter(e => trustedMatch(cc, e, visited)) : [];
    const have = new Set(kept.map(e => e.name.toLowerCase()));
    const items = kept.slice(), missing = [], seen = new Set();
    for (const [f, v] of Object.entries(facts[cc])) {
      if (!FACT_TOPIC[f]) continue;
      for (const name of namesIn(v)) {
        const key = name.toLowerCase(); if (seen.has(key) || have.has(key)) continue; seen.add(key);
        const r = await resolve(name, cc);
        await sleep(250);
        if (!r) { console.log(cc, f, JSON.stringify(name), 'NOT FOUND'); missing.push(f + ': ' + name); continue; }
        items.push({ f, name, q: r.q, n: r.n, s: r.s, here: r.here });
      }
    }
    writeFileSync(join(OUT, cc + '.json'), JSON.stringify({ cc, generated: new Date().toISOString().slice(0, 10), items, missing }));
    console.log(cc, items.length, 'resolved,', missing.length, 'not found');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
