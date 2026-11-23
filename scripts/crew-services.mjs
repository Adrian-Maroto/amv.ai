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
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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

async function resolve(name, cc) {
  const q = `SELECT ?i ?site ?n ?iLabel ?inCountry WHERE {
    SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search "${esc(name)}"; mwapi:language "en"; mwapi:limit "8". ?i wikibase:apiOutputItem mwapi:item. }
    ?i wdt:P856 ?site ; wikibase:sitelinks ?n .
    FILTER NOT EXISTS { ?i wdt:P31 wd:Q5 } FILTER NOT EXISTS { ?i wdt:P576 ?gone }
    OPTIONAL { ?c wdt:P297 "${esc(cc)}" . ?i wdt:P17 ?c . BIND(true AS ?inCountry) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
  }`;
  const got = await sparql(q);
  const rows = [];
  for (const b of got) {
    let host = ''; try { const u = new URL(b.site.value); if (!/^https?:$/.test(u.protocol)) continue; host = u.hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) continue;
    rows.push({ q: qid(b.i.value), n: (b.iLabel && b.iLabel.value) || name, s: host, w: +b.n.value, here: !!b.inCountry });
  }
  /* In the country first, then the best covered. */
  rows.sort((a, b) => (b.here - a.here) || (b.w - a.w));
  return rows[0] || null;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const facts = countryFacts();
  const only = process.argv.slice(2).map(s => s.toUpperCase()).filter(c => facts[c]);
  const END = Date.now() + (+process.env.BUDGET_MIN || 100) * 60000;
  for (const cc of only.length ? only : Object.keys(facts)) {
    if (Date.now() > END) { console.log(cc, 'not asked: out of time'); continue; }
    const items = [], seen = new Set();
    for (const [f, v] of Object.entries(facts[cc])) {
      if (!FACT_TOPIC[f]) continue;
      for (const name of namesIn(v)) {
        const key = name.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
        const r = await resolve(name, cc);
        if (!r) { console.log(cc, f, JSON.stringify(name), 'NOT FOUND'); continue; }
        items.push({ f, name, q: r.q, n: r.n, s: r.s, here: r.here });
        await sleep(250);
      }
    }
    writeFileSync(join(OUT, cc + '.json'), JSON.stringify({ cc, generated: new Date().toISOString().slice(0, 10), items }));
    console.log(cc, items.length, 'resolved');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
