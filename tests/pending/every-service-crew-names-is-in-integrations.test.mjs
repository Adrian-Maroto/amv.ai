/* EVERY SERVICE CREW NAMES IS IN INTEGRATIONS, IN ITS COUNTRY (Nov 23).

   The owner: "integrations ... backed up by Crew jobs as well, because you
   might need something for Crew, some integration, and I want it to also be
   included in integrations". Crew's jobs for a country name its services
   from COUNTRY_FACTS; data/crew-services/<CC>.json (scripts/crew-services.mjs)
   holds each one's site. Here, from the files the build ships: every one of
   them is in that country's Integrations - as an app, a service of the
   country's own file, a worldwide service, or a row of its own.

   PARKED in tests/pending (not run by tests/run.mjs) until the crew-services
   workflow has looked up every country - it stops at 110 minutes and commits
   what it finished, so the data arrives over several runs. It moves back to
   tests/worker in the same change that brings the last country's file, and
   until then the claim is NOT made: Integrations is not yet said anywhere to
   hold every service Crew names. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { buildGlobalServices, sameAsApp, appNames } from '../../scripts/global-services.mjs';
import { countryFacts, namesIn, FACT_TOPIC } from '../../scripts/crew-services.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const dir = ROOT + 'data/crew-services/';
const files = existsSync(dir) ? readdirSync(dir).filter(f => /^[A-Z]{2}\.json$/.test(f)) : [];
const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9À-￿]+/g, ' ').trim().split(' ').filter(Boolean);
const apps = appNames(ROOT).flatMap(c => c.names.map(words));
const built = buildGlobalServices(ROOT);
const g = JSON.parse(built.services);
const globalHosts = new Set(g.entries.map(e => e[2]));

section('The services Crew names, per country, all in Integrations');
let named = 0, resolved = 0, listed = 0;
const gaps = [];
for (const f of files) {
  const cc = f.slice(0, 2);
  const d = JSON.parse(readFileSync(dir + f, 'utf8'));
  let cf = null; try { cf = JSON.parse(readFileSync(ROOT + 'data/countries/' + cc + '.json', 'utf8')); } catch (e) {}
  const countryHosts = new Set(cf ? Object.values(cf.kinds || {}).flat().map(e => e.s) : []);
  const crewHosts = new Set((JSON.parse(built.countries[cc] || '{"crew":[]}').crew || []).map(r => r[2]));
  for (const e of d.items || []) {
    resolved++;
    const here = countryHosts.has(e.s) || globalHosts.has(e.s) || crewHosts.has(e.s) || sameAsApp(e.name, apps);
    if (here) listed++; else gaps.push(cc + ' ' + e.f + ': ' + e.name + ' (' + e.s + ')');
  }
}
const facts = countryFacts(ROOT);
for (const cc of Object.keys(facts)) for (const [k, v] of Object.entries(facts[cc])) if (FACT_TOPIC[k]) named += namesIn(v).length;
console.log(`  ${named} services named by Crew in ${Object.keys(facts).length} countries; ${resolved} found on Wikidata; ${listed} of those in Integrations`);
ok(files.length >= 100, 'every country Crew has facts for has been looked up', files.length);
ok(gaps.length === 0, 'every service found is in that country’s Integrations', gaps.slice(0, 8));
ok(resolved >= named * 0.6, 'and most of what Crew names was found (the rest is listed in each file under missing)', { named, resolved });
report(); done();
