/* A COUNTRY SWITCH NEVER MIXES TWO COUNTRIES (Nov 28, Build 19 audit NEW-06,
   NEW-07, B19-R-02, B19-P-06).

   Three ways the previous country leaked into the next:
   - Tasks: an answer for the country somebody had just left stored its
     prompts before checking it was still wanted - and since Nov 28 task ids
     were the same in every country, so a Bangladesh task could open with
     "...in the United States";
   - Integrations: a slow file for the old country could still be drawn;
   - a service's button named it by Wikidata id alone, and the first country
     to draw it kept it, so the same organisation opened the old country's
     site.
   Each is driven here with the old country's answer arriving LAST. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.waitForFunction(() => typeof window._ccReady === 'function', null, { timeout: 15000 });
await page.evaluate(() => _ccReady());

section('Tasks: the old country\'s late answer changes nothing');
{
  const r = await page.evaluate(async () => {
    const real = window.ccLoad;
    /* Japan answers 1.5 s late; Bangladesh at once. Japan's file is not one
       the page read ahead of time, so its answer really is the late one. */
    const pre = !!(window.ccLoadedNow && window.ccLoadedNow('JP'));
    window.ccLoad = async (cc) => { if (String(cc).toUpperCase() === 'JP') await new Promise(x => setTimeout(x, 1500)); return real(cc); };
    try { _cwSetCountry('JP'); setTab('tasks'); await new Promise(x => setTimeout(x, 200));
          _cwSetCountry('BD'); renderTasksView(); await new Promise(x => setTimeout(x, 2600)); }
    finally { window.ccLoad = real; }
    const first = document.querySelector('#tk2-body .tk-row');
    const id = first && first.dataset.darg;
    first && first.click(); await new Promise(x => setTimeout(x, 400));
    return { h: (document.querySelector('.tk2-h h1') || {}).textContent || '', id, tab: S.tab,
             val: (document.getElementById('mta') || {}).value || '',
             pre, jpIds: Object.keys(_TASK_PROMPTS).filter(k => /^cl-JP-/.test(k)).length };
  });
  ok(/^cl-BD-/.test(r.id || ''), 'Bangladesh\'s rows carry Bangladesh\'s ids', r.id);
  ok(r.tab === 'chat' && /Bangladesh/.test(r.val) && !/Japan/.test(r.val), 'and the task opens with Bangladesh in it, not Japan', r.val.slice(0, 120));
  ok(!r.pre && r.jpIds === 0, 'Japan\'s late answer stored nothing', r);
}

section('Integrations: every button opens the site its own row shows');
{
  const r = await page.evaluate(async () => {
    _cwSetCountry('US'); setTab('integrations'); await new Promise(x => setTimeout(x, 2500));
    _cwSetCountry('GB'); renderIntegrationsView(); await new Promise(x => setTimeout(x, 2500));
    const rows = [...document.querySelectorAll('#int-catalog .cc-svc')].map(c => {
      const b = c.querySelector('[data-dact="ccUseService"]');
      return b ? { site: ((c.querySelector('.int-desc') || {}).textContent || '').split(/\s/)[0], key: b.dataset.darg } : null;
    }).filter(Boolean);
    const wrong = rows.filter(x => x.key.split('|')[1] !== x.site);
    return { n: rows.length, wrong: wrong.slice(0, 3) };
  });
  ok(r.n >= 20 && r.wrong.length === 0, 'after the United States then the United Kingdom, all ' + r.n + ' buttons name their own row\'s site', r.wrong);
}

section('The same organisation in two countries opens each country\'s site');
{
  const r = await page.evaluate(async () => {
    const us = await ccLoad('US'), gb = await ccLoad('GB');
    const find = (d, q) => Object.entries(d.kinds).flatMap(([kind, l]) => l.map(e => ({ kind, e }))).find(x => x.e.q === q);
    const a = find(us, 'Q11149'), b = find(gb, 'Q11149');
    if (!a || !b) return { missing: true };
    const ka = _ccRegisterService(a), kb = _ccRegisterService(b);
    ccUseService(kb); await new Promise(x => setTimeout(x, 400));
    return { us: a.e.s, gb: b.e.s, val: (document.getElementById('mta') || {}).value || '', ka, kb };
  });
  ok(!r.missing, 'The Independent is listed in both countries', r);
  ok(r.us !== r.gb && r.val.indexOf(r.gb) >= 0 && r.val.indexOf(r.us + ' ') < 0, 'Ask AMV on the British row asks for the British site', r);
  ok(/serves my country/.test(r.val) && /Do not buy, submit or send anything without asking me/.test(r.val), 'and the request says it checks the country and acts on nothing unasked', r.val.slice(0, 200));
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
