/* THE MOST VISITED SERVICES THERE COME FIRST (Nov 16, the owner: "organize
   jobs, tasks, crew by popularity for every country - I need these things to
   get the most users").

   Held for every country's Crew jobs, Tasks and Integrations rows:
     · the services are in the order people in that country visit them - the
       Chrome UX Report bucket, never a lower bucket ahead of a higher one -
       and inside a bucket the country's own before the world's;
     · after a section's opening tasks, each job or task by what it is for
       (an everyday one before a brief about a company, a complaint last),
       and the same one across services in visit order (Nov 27);
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

section('In every country: most visited first, the better known first inside a bucket, the useful before the rest');
{
  const r = await page.evaluate(async () => {
    const bad = [];
    const codes = CW_WORLD_COUNTRIES.map(c => c[0]);
    let n = 0;
    for (const cc of codes) {
      const d = await ccLoad(cc); if (!d) continue; n++;
      /* Inside a bucket the better known goes first, leaning to the country's
         own (owner, Nov 25: M&T Bank led the United States, above Bank of
         America and Chase): Wikipedia editions over the fourth root of how
         many countries list it. */
      const R = e => (+e.r > 0 ? +e.r : 1e9), K = e => (+e.w || 0) / Math.pow(Math.max(1, +e.x || 1), 0.25);
      const svc = ccServices(d).map(x => x.e);
      for (let i = 1; i < svc.length; i++) {
        const a = svc[i - 1], b = svc[i];
        if (R(a) > R(b)) { bad.push(cc + ': ' + a.n + ' (' + R(a) + ') before ' + b.n + ' (' + R(b) + ')'); break; }
        if (R(a) === R(b) && K(a) < K(b)) { bad.push(cc + ': ' + a.n + ' (' + K(a).toFixed(1) + ') before the better known ' + b.n + ' (' + K(b).toFixed(1) + ')'); break; }
      }
      /* WHAT EACH IS FOR, THEN HOW VISITED (Nov 27, the owner: "the first
         ones should be improve my CV, write a cover letter, find jobs at
         LinkedIn ... any stupid job goes all the way at the bottom"). After a
         section's opening tasks (checked below), in every section: no brief
         about a company and no complaint comes before an everyday task of
         that section, and the same task across services keeps the visit
         order - one at a time, never a less visited service first. */
      const cat = (x) => _cjCat({ ccKind: x.kind });
      for (const [name, list, tier] of [['jobs', ccJobs(d), (x) => _ccCrewTier(x.kind, CC_CREW[x.kind][x.i][0], x.i)],
                                        ['tasks', ccTasks(d).filter(t => !t.lead), (x) => _ccTaskTier(x.kind, x.tpl)]]) {
        const by = {};
        for (const x of list) (by[cat(x)] = by[cat(x)] || []).push(x);
        for (const [c, l] of Object.entries(by)) {
          const t = l.map(tier);
          const lastDo = t.lastIndexOf(1), firstLow = t.findIndex(v => v >= 3);
          /* Tier 1 from a service the section is FOR and that is visited
             there; a foreign or side service's are allowed below. */
          const own = (x) => !_ccSide(x) && !_ccAbroad(x.e, cc) && !(x.kind === 'jobsite' && !(+x.e.r > 0 && +x.e.r <= 5000));
          const lastOwnDo = l.reduce((m, x, i) => (t[i] === 1 && own(x)) ? i : m, -1);
          if (firstLow >= 0 && lastOwnDo > firstLow) { bad.push(cc + ' ' + name + ' ' + c + ': "' + l[firstLow].title + '" before "' + l[lastOwnDo].title + '"'); break; }
          const comp = t.findIndex(v => v === 4);
          if (comp >= 0 && t.slice(comp).some(v => v < 4)) { bad.push(cc + ' ' + name + ' ' + c + ': "' + l[comp].title + '" is not last'); break; }
        }
        /* The same task across services: in visit order. */
        const order = new Map(ccServices(d).map((x, i) => [x.e.q + '|' + x.kind, i])), last = {};
        for (const x of list) {
          if (_ccSide(x) || _ccAbroad(x.e, cc) || x.kind === 'jobsite') continue;
          const k = x.kind + '|' + (x.tpl || x.i), o = order.get(x.e.q + '|' + x.kind);
          if (last[k] != null && last[k] > o) { bad.push(cc + ' ' + name + ': ' + x.title + ' after a less visited service'); break; }
          last[k] = o;
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
