#!/usr/bin/env node
/* Writes docs/COUNTRY-DATA.md: for every country file, how many services it
   holds and how many tasks and Crew jobs the page builds from them - counted
   with the page's own tables, so the document cannot say more than the screen. */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src/country/country-catalog.js'), 'utf8');
const ctx = {};
new Function('ctx', src.slice(src.indexOf('const CC_KINDS'), src.indexOf('/* One country')) + ';ctx.T=CC_TASKS;ctx.C=CC_CREW;ctx.K=CC_KINDS')(ctx);
const cap = readFileSync(join(ROOT, 'src/worker/65-country-capabilities.js'), 'utf8');
const blk = cap.slice(cap.indexOf('const COUNTRY_NAME = {'), cap.indexOf('};', cap.indexOf('const COUNTRY_NAME = {')));
const names = Object.fromEntries([...blk.matchAll(/\b([A-Z]{2}):\s*'([^']+)'/g)].map(m => [m[1], m[2]]));
const rows = []; let made = '';
/* The directory of every job ("See all jobs") counts a job about a service
   alone once, however many countries list the service, and a job about the
   service IN a country (template marked 'c') once per country - so its total
   is not the sum of the countries' own lists. Counted the same way here. */
const seenDir = new Set(); let distinct = 0;
for (const f of readdirSync(join(ROOT, 'data/countries')).filter(f => /^[A-Z]{2}\.json$/.test(f)).sort()) {
  const d = JSON.parse(readFileSync(join(ROOT, 'data/countries', f), 'utf8'));
  let tasks = 0, jobs = 0, n = 0;
  for (const [k, v] of Object.entries(d.kinds)) { if (!ctx.K[k]) continue; n += v.length; tasks += v.length * (ctx.T[k] || []).length; jobs += v.length * (ctx.C[k] || []).length;
    const tpl = ctx.C[k] || [], sc = tpl.filter(t => t[3] === 'c').length;
    for (const e of v){ distinct += sc; if(!seenDir.has(k + '|' + e.q)){ seenDir.add(k + '|' + e.q); distinct += tpl.length - sc; } } }
  rows.push({ cc: d.cc, name: names[d.cc] || d.cc, n, tasks, jobs, kinds: Object.keys(d.kinds).length });
  if (d.generated > made) made = d.generated;
}
rows.sort((a, b) => b.n - a.n);
const count = (f) => rows.filter(f).length, sum = (k) => rows.reduce((a, r) => a + r[k], 0);
const out = [
  '# Country data: what each country really has', '',
  'Written by `node scripts/country-report.mjs` from `data/countries/` (data of ' + made + ').',
  'A service is an organisation Wikidata files under that country, with an official',
  'website, not closed, ranked by how many Wikipedia editions cover it. Tasks and Crew',
  'jobs are what the page builds from those services, counted with the page\'s own',
  'tables. Nothing is padded: a country with few entries on Wikidata shows few.', '',
  `- Countries: **${rows.length}**. Services: **${sum('n')}**. Tasks: **${sum('tasks')}**. Crew jobs, added up country by country: **${sum('jobs')}**.`,
  `- Distinct Crew jobs across all countries - what "See all jobs" holds, a service listed in several countries counted once: **${distinct}**.`,
  `- 500 or more services (Integrations): **${count(r => r.n >= 500)}** countries. 200 or more: **${count(r => r.n >= 200)}**. Under 200: **${count(r => r.n < 200)}**.`,
  `- 500 or more tasks: **${count(r => r.tasks >= 500)}** countries. 500 or more Crew jobs: **${count(r => r.jobs >= 500)}** countries.`, '',
  '| Country | Services | Tasks | Crew jobs | Kinds |', '|---|---:|---:|---:|---:|',
  ...rows.map(r => `| ${r.name} (${r.cc}) | ${r.n} | ${r.tasks} | ${r.jobs} | ${r.kinds} |`), '',
];
writeFileSync(join(ROOT, 'docs/COUNTRY-DATA.md'), out.join('\n'));
console.log(out.slice(8, 12).join('\n'));
