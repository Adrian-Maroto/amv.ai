/* THE MOST VISITED SERVICES THERE COME FIRST (Nov 16, the owner: "organize
   jobs, tasks, crew by popularity for every country - I need these things to
   get the most users").

   Held for every country's Crew jobs, Tasks and Integrations rows:
     · the services are in the order people in that country visit them - the
       Chrome UX Report bucket, never a lower bucket ahead of a higher one -
       and inside a bucket the country's own before the world's;
     · every service gets its first job or task before any gets a second;
     · what people in the country actually switch on goes ahead of what is
       only researched, the most switched on first;
     · the category chips are in the order their first job appears;
     · and the files hold the reach the order reads (scripts/country-reach.mjs). */
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

section('The country files hold how many countries list each service');
{
  let out = '', code = 0;
  try { out = execFileSync('node', [join(ROOT, 'scripts/country-reach.mjs'), '--check'], { encoding: 'utf8' }); }
  catch (e) { code = e.status || 1; out = String(e.stdout || ''); }
  ok(code === 0, 'every file agrees with scripts/country-reach.mjs - run it after a data change', out.trim());
}

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 900 }, user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;
await page.evaluate(() => { document.getElementById('ck')?.remove(); });
await page.waitForFunction(() => true);
await page.evaluate(() => setTab('integrations'));
await page.waitForFunction(() => typeof window.ccLoad === 'function', null, { timeout: 15000 });

section('In every country: most visited first, the better known first inside a bucket, one each before a second');
{
  const r = await page.evaluate(async () => {
    const bad = [];
    const codes = CW_WORLD_COUNTRIES.map(c => c[0]);
    let n = 0;
    for (const cc of codes) {
      const d = await ccLoad(cc); if (!d) continue; n++;
      /* Inside a bucket the better known goes first, leaning to the country's
         own (owner, Nov 25: M&T Bank led the United States, above Bank of
         America and Chase): Wikipedia editions over the square root of how
         many countries list it. */
      const R = e => (+e.r > 0 ? +e.r : 1e9), K = e => (+e.w || 0) / Math.sqrt(Math.max(1, +e.x || 1));
      const svc = ccServices(d).map(x => x.e);
      for (let i = 1; i < svc.length; i++) {
        const a = svc[i - 1], b = svc[i];
        if (R(a) > R(b)) { bad.push(cc + ': ' + a.n + ' (' + R(a) + ') before ' + b.n + ' (' + R(b) + ')'); break; }
        if (R(a) === R(b) && K(a) < K(b)) { bad.push(cc + ': ' + a.n + ' (' + K(a).toFixed(1) + ') before the better known ' + b.n + ' (' + K(b).toFixed(1) + ')'); break; }
      }
      /* A section's opening tasks (ccLeads) come before the service-by-service
         ones and are checked below; the order checked here is the rest. */
      for (const [name, list] of [['jobs', ccJobs(d)], ['tasks', ccTasks(d).filter(t => !t.lead)]]) {
        const seen = new Set(), firstPass = Math.min(list.length, new Set(list.map(j => j.e.q + '|' + j.kind)).size);
        for (let i = 0; i < firstPass; i++) { const k = list[i].e.q + '|' + list[i].kind;
          if (seen.has(k)) { bad.push(cc + ' ' + name + ': a second for ' + list[i].e.n + ' before every service had one'); break; } seen.add(k); }
        /* And the first pass follows the service order. */
        const order = new Map(ccServices(d).map((x, i) => [x.e.q + '|' + x.kind, i]));
        for (let i = 1; i < firstPass; i++) {
          if (order.get(list[i - 1].e.q + '|' + list[i - 1].kind) > order.get(list[i].e.q + '|' + list[i].kind)) {
            bad.push(cc + ' ' + name + ': ' + list[i].e.n + ' later than its service'); break; }
        }
      }
    }
    return { n, bad: bad.slice(0, 6) };
  });
  ok(r.n >= 100, 'checked ' + r.n + ' countries', r.n);
  ok(r.bad.length === 0, 'services, jobs and tasks in that order everywhere', r.bad);
}

section('Each section opens with what people most often want to do there, named with the country’s top services');
{
  const r = await page.evaluate(async () => {
    const us = await ccLoad('US'), es = await ccLoad('ES');
    const usTasks = ccTasks(us), esTasks = ccTasks(es);
    const firstLeadAt = usTasks.findIndex(t => !t.lead);
    const money = usTasks.filter(t => _cjCat({ ccKind: t.kind }) === 'Money').slice(0, 3).map(t => t.title);
    const save = usTasks.find(t => t.lead && t.title === 'Compare savings rates');
    const esSave = esTasks.find(t => t.lead && /savings rates/.test(t.prompt));
    const usBanks = ccServices(us).filter(x => x.kind === 'bank').slice(0, 6).map(x => x.e.n);
    return { firstLeadAt, money, savePrompt: save && save.prompt, esPrompt: esSave && esSave.prompt, usBanks,
      leadsOnly: usTasks.slice(0, firstLeadAt).every(t => t.lead), n: firstLeadAt };
  });
  ok(r.leadsOnly && r.n >= 40, 'the everyday tasks lead the list, before any service-by-service task', r.n);
  ok(r.money[0] === 'Compare savings rates', 'Money opens with comparing savings rates, not one bank’s account', r.money);
  ok(r.usBanks.indexOf('Bank of America') >= 0 && r.usBanks.indexOf('Bank of America') < r.usBanks.indexOf('M&T Bank'),
     'Bank of America ranks above M&T Bank in the United States', r.usBanks);
  ok(/Bank of America/.test(r.savePrompt || '') && !/M&T/.test(r.savePrompt || ''), 'and the task names the country’s top banks', r.savePrompt);
  ok(r.esPrompt && r.esPrompt !== r.savePrompt && !/Bank of America/.test(r.esPrompt), 'Spain’s names Spain’s banks', r.esPrompt);
}

section('What people there switch on goes first, the most switched on first');
{
  await page.evaluate(() => { _cwSetCountry('ES'); setTab('crew'); });
  await page.waitForFunction(() => ((window._ccCrewJobs || {}).ES || []).length > 1000, null, { timeout: 20000 });
  const r = await page.evaluate(() => {
    const cat = window._ccCrewJobs.ES;
    const a = cat[cat.length - 1], b = cat[cat.length - 2];     // the two the research put last
    const m = _cwMeta.ES || (_cwMeta.ES = {});
    const was = m.ranked;
    m.ranked = { enough: true, total: 40, need: 25, counts: { [a.id]: 3, [b.id]: 9 } };
    const list = _cjList();
    const ia = list.findIndex(j => j.id === a.id), ib = list.findIndex(j => j.id === b.id);
    const firstPlain = list.findIndex(j => /^ccj-/.test(j.id) && j.id !== a.id && j.id !== b.id);
    m.ranked = was;
    return { ia, ib, firstPlain };
  });
  ok(r.ib >= 0 && r.ia > r.ib, 'the job switched on 9 times before the one switched on 3 times', r);
  ok(r.ia < r.firstPlain, 'and both ahead of every catalogue job nobody has switched on yet', r);
}

section('The category chips follow the list');
{
  const r = await page.evaluate(() => {
    const list = _cjList();
    const chips = [...document.querySelectorAll('#cj-cats .cj-chip')].map(c => c.dataset.darg).filter(c => c && c !== 'all');
    const first = {}; list.forEach((j, i) => { const c = _cjCat(j); if (!(c in first)) first[c] = i; });
    const sorted = chips.slice().sort((x, y) => first[x] - first[y]);
    return { chips, ok: JSON.stringify(chips) === JSON.stringify(sorted) };
  });
  ok(r.chips.length > 3 && r.ok, 'each chip in the order its first job appears', r.chips);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
