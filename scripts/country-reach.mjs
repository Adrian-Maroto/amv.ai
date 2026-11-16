#!/usr/bin/env node
/* Writes `x` into data/countries/<CC>.json: for each entry, how many countries'
   files list the same Wikidata item - written only when it is 2 or more, so a
   country's own services (most of them) carry nothing extra.

   Why: the lists order a country's services by the Chrome UX Report bucket of
   visits from that country, and that report only says "among the top 1,000",
   "the top 5,000"... Inside a bucket, a service listed in ten countries
   (Facebook, MIT, The New York Times) is the world's; one listed only here is
   the country's own - and it is the country's own that most people there
   come to AMV for. So inside a bucket the page puts the country's own first
   (country-catalog.js, _ccByPop).

   Run after any change to the country files:  node scripts/country-reach.mjs
   The suite the-most-visited-services-there-come-first fails while any file
   disagrees with what this writes. `--check` only reports. */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'countries');
const check = process.argv.includes('--check');
const files = readdirSync(DIR).filter(f => /^[A-Z]{2}\.json$/.test(f)).sort();
const data = files.map(f => [f, readFileSync(join(DIR, f), 'utf8')]);
const reach = {};
for (const [, raw] of data) {
  const d = JSON.parse(raw), seen = new Set();
  for (const list of Object.values(d.kinds || {})) for (const e of list || []) {
    if (!e || !e.q || seen.has(e.q)) continue;
    seen.add(e.q); reach[e.q] = (reach[e.q] || 0) + 1;
  }
}
let changed = 0;
for (const [f, raw] of data) {
  const d = JSON.parse(raw);
  for (const list of Object.values(d.kinds || {})) for (const e of list || []) {
    const x = reach[e.q] || 1;
    if (x >= 2) e.x = x; else delete e.x;
  }
  /* The files are written compactly, one line, as the data scripts write them. */
  const out = JSON.stringify(d) + (raw.endsWith('\n') ? '\n' : '');
  if (out !== raw) { changed++; if (!check) writeFileSync(join(DIR, f), out); }
}
console.log((check ? 'would change ' : 'changed ') + changed + ' of ' + files.length + ' country files');
if (check && changed) process.exitCode = 1;
