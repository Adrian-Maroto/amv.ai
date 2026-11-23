/* EVERY SERVICE CREW NAMES IS IN INTEGRATIONS, IN ITS COUNTRY (Nov 23).

   The owner: "integrations ... backed up by Crew jobs as well, because you
   might need something for Crew, some integration, and I want it to also be
   included in integrations". Crew's jobs for a country name its services
   from COUNTRY_FACTS; data/crew-services/<CC>.json (scripts/crew-services.mjs)
   holds what a Wikidata lookup found for each.

   The first lookup took a search's first answer and half of them were wrong
   (KRA as Krakow, FBR as Fortnite, Optus as a stadium). So this holds three
   things, from the files the build ships:
   - nothing reaches Integrations that the checks do not believe
     (trustedMatch: the service itself, in the country or visited from it);
   - everything they do believe is in that country's Integrations;
   - how much of what Crew names a person can find there, as a floor that
     only rises - measured, not claimed. What is not found yet is listed by
     scripts/crew-services-report.mjs in docs/CREW-SERVICES.md. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { buildGlobalServices } from '../../scripts/global-services.mjs';
import { countryFacts, trustedMatch, visitsFrom, nameFits } from '../../scripts/crew-services.mjs';
import { crewCoverage } from '../../scripts/crew-services-report.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const dir = ROOT + 'data/crew-services/';
const files = existsSync(dir) ? readdirSync(dir).filter(f => /^[A-Z]{2}\.json$/.test(f)) : [];
const built = buildGlobalServices(ROOT);
const visited = visitsFrom(ROOT);

section('The lookup covers every country Crew has facts for');
ok(files.length >= Object.keys(countryFacts(ROOT)).length - 2, 'every country Crew has facts for has been looked up', files.length);

section('Nothing reaches Integrations that the checks do not believe');
{
  const shipped = [], wrong = [];
  for (const f of files) {
    const cc = f.slice(0, 2), d = JSON.parse(readFileSync(dir + f, 'utf8'));
    /* By site AND name: two services can share one site (gov.br). */
    const byKey = new Map((d.items || []).map(e => [e.s + '|' + e.name, e]));
    for (const r of (JSON.parse(built.countries[cc] || '{"crew":[]}').crew || [])) {
      shipped.push(r); const e = byKey.get(r[2] + '|' + r[1]);
      if (!e || !trustedMatch(cc, e, visited)) wrong.push(cc + ' ' + r[1] + ' (' + r[2] + ')');
    }
  }
  ok(shipped.length > 500, 'the believed matches are listed', shipped.length);
  ok(wrong.length === 0, 'and every one listed passed the checks', wrong.slice(0, 5));
}

section('The checks refuse the wrong answers the first lookup gave');
{
  const no = (cc, e) => !trustedMatch(cc, e, visited);
  ok(no('KE', { f: 'tax', name: 'KRA', n: 'Kraków', s: 'krakow.pl', here: false }), 'Kenya’s KRA is not Kraków');
  ok(no('PK', { f: 'tax', name: 'FBR', n: 'Fortnite Battle Royale', s: 'fortnite.com', here: false }), 'Pakistan’s FBR is not Fortnite');
  ok(no('AU', { f: 'telco', name: 'Optus', n: 'Perth Stadium', s: 'optusstadium.com.au', here: true }), 'Optus is not a stadium named after it');
  ok(no('FR', { f: 'telco', name: 'Orange', n: 'Orange', s: 'ville-orange.fr', here: true }), 'Orange is not the town of Orange');
  ok(no('AR', { f: 'groc', name: 'Jumbo', n: 'Jumbo', s: 'jumbo.com', here: false }), 'Argentina’s Jumbo is not the Dutch jumbo.com');
  ok(no('KZ', { f: 'banks', name: 'Halyk', n: 'Halyk Bank of Kazakhstan', s: 'procreditbank.ge', here: true }), 'and a Kazakh bank is never on a Georgian domain');
  ok(no('IT', { f: 'telco', name: 'Vodafone', n: 'Vodafone Automotive', s: 'automotive.vodafone.com', here: true }), 'Italy’s Vodafone is not Vodafone Automotive');
  ok(no('GB', { f: 'health', name: 'NHS', n: 'NHS Wales', s: 'nhs.wales', here: true }), 'England’s NHS is not NHS Wales');
  ok(no('AU', { f: 'jobs', name: 'Seek', n: 'Seek', s: 'inaturalist.org', here: false }), 'Seek the job site is not the Seek nature app');
  ok(!no('ZA', { f: 'shop', name: 'Takealot', n: 'Takealot.com', s: 'takealot.com', here: true }), 'while Takealot.com is Takealot');
  ok(!no('AU', { f: 'banks', name: 'CommBank', n: 'Commonwealth Bank', s: 'commbank.com.au', here: true }), 'while CommBank on commbank.com.au is believed');
  ok(nameFits('Yonhap', 'Yonhap News Agency', 'yna.co.kr', 'KR'), 'and so is Yonhap as Yonhap News Agency');
}

section('How much of what Crew names a person can find in Integrations');
{
  const c = crewCoverage(ROOT, built);
  console.log(`  ${c.found} of ${c.named} services Crew names are findable in their country’s Integrations (${(100 * c.found / c.named).toFixed(1)}%)`);
  /* A floor, raised as lookups land - never lowered to make a run pass. */
  ok(c.found / c.named >= 0.73, 'at least the measured share is findable', (100 * c.found / c.named).toFixed(1) + '%');
}
report(); done();
