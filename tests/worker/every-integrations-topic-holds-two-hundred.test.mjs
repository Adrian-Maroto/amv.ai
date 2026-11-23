/* EVERY INTEGRATIONS TOPIC HOLDS TWO HUNDRED, IN EVERY COUNTRY (Nov 23).

   The owner: "integrations need that amount for all sections all countries,
   backed on popularity". What every country sees in a topic is at least its
   apps (AMV_APP_CATS) and the services used worldwide (global-services.json);
   a country's own services come on top. So the floor that holds in EVERY
   country - one with no file of its own included - is apps + worldwide, and
   that is what is counted here, per topic, from the files that ship. */
import { readFileSync } from 'node:fs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const src = readFileSync(ROOT + 'src/app/13c-app-catalog.js', 'utf8');
const cats = (0, eval)(src.match(/const AMV_APP_CATS = (\[[\s\S]*?\n\]);/)[1]);
const g = JSON.parse(readFileSync(ROOT + 'global-services.json', 'utf8'));

section('Apps plus the services used worldwide, per topic');
const counts = cats.map(c => [c.id, c.apps.length + (g.topics[c.id] || []).length]);
console.log('  ' + counts.map(([t, n]) => t + ' ' + n).join(', '));
for (const [t, n] of counts) ok(n >= 200, t + ' holds 200 or more in every country', n);

section('And the order is measured');
ok(!!(g.reach && g.reach.month && Array.isArray(g.reach.hosts) && g.reach.hosts.length > 1000), 'visits (Chrome UX Report) order them, with the month stated', g.reach && g.reach.month);
report(); done();
