/* THE COUNTRY CATALOGUE NAMES REAL SERVICES (Nov 10, owner: "integrations +
   crew + tasks have to be backed up with data with specific things for every
   single country possible - 500+ across every section").

   What is held, with a country file stubbed in the shape scripts/
   country-data.mjs writes: Tasks, Crew and Integrations each draw a section
   built from it; every row names an entry from the file and nothing else;
   the counts on screen are the counts of rows; the catalogue arrives as its
   own file, not in the page; "Use in chat" opens a chat naming the site; and
   a country with no file shows no section rather than an empty one. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const KINDS = { bank: 'Banco', university: 'Universidad', newspaper: 'Diario', airline: 'Aerolínea', supermarket: 'Mercado', employer: 'Empresa' };
const file = { cc: 'ES', qid: 'Q29', source: 'Wikidata', generated: '2026-11-10', kinds: {}, total: 0 };
for (const [k, w] of Object.entries(KINDS)) {
  file.kinds[k] = Array.from({ length: 12 }, (_, i) => ({ q: 'Q9' + k.length + '0' + i, n: w + ' Prueba ' + (i + 1), s: 'https://' + k + (i + 1) + '.example.es', w: 50 - i }));
  file.total += 12;
}
const names = new Set(Object.values(file.kinds).flat().map(e => e.n));

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
let fetched = [];
await page.route('**/countries/*.json', r => {
  const cc = r.request().url().match(/countries\/([A-Z]{2})\.json/)[1]; fetched.push(cc);
  return cc === 'ES' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(file) }) : r.fulfill({ status: 404, body: '' });
});
await page.evaluate(() => {
  Object.defineProperty(window.AMV_API, 'live', { get: () => true, configurable: true });
  window.AMV_API.everyday = async () => ({ facts: {} });
  _cwSetCountry('ES');
});

section('Not in the page: its own file, fetched when needed');
{
  const r = await page.evaluate(() => ({ inPage: [...document.scripts].some(s => /CC_TASKS\s*=/.test(s.textContent || '')) }));
  ok(!r.inPage, 'the catalogue’s code is not inlined into index.html');
}

section('Tasks: a row per task per named entry');
{
  await page.evaluate(() => setTab('tasks'));
  await page.waitForFunction(() => document.querySelectorAll('.cc-list .tk-row, .cc-list [data-dact="launchTask"]').length > 0, null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tk-local [data-darg^="cc-"]')];
    return { n: rows.length, head: (document.querySelector('.cc-head b') || {}).textContent, expect: window.ccTasks ? null : -1,
      txt: rows.map(b => b.textContent.replace(/\s+/g, ' ').trim()) };
  });
  const exp = await page.evaluate(f => window.ccTasks(f).length, file);
  ok(r.n === exp && exp >= file.total * 3, 'every task the file supports is a row, three or more per entry', { rows: r.n, exp });
  ok(String(r.head) === String(r.n), 'the count on screen is the count of rows', r.head);
  ok(r.txt.every(t => [...names].some(n => t.includes(n))), 'and every row names an entry from the file', r.txt.slice(0, 2));
  await page.evaluate(() => document.querySelector('#tk-local [data-darg^="cc-bank-"]').click());
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({ tab: S.tab, val: (document.getElementById('mta') || {}).value || '' }));
  ok(v.tab === 'chat' && /Banco Prueba/.test(v.val) && /bank\d+\.example\.es/.test(v.val), 'pressing one writes a prompt naming the bank and its site', v.val.slice(0, 90));
}

section('Integrations: every entry, through AMV’s browser');
{
  await page.evaluate(() => setTab('integrations'));
  await page.waitForFunction(() => { const h = document.getElementById('cc-int'); return h && !h.hidden; }, null, { timeout: 15000 });
  const r = await page.evaluate(() => ({ n: document.querySelectorAll('#cc-int .cc-svc').length, shown: [...document.querySelectorAll('#cc-int .cc-svc')].filter(x => x.offsetParent).length,
    head: (document.querySelector('#cc-int .sec-sub b') || {}).textContent }));
  ok(r.n === file.total && String(r.head) === String(r.n), 'one row per entry, counted truly', r);
  ok(r.shown === 30, 'thirty first, the rest behind Show all', r.shown);
  await page.click('#cc-int-all');
  ok(await page.evaluate(() => [...document.querySelectorAll('#cc-int .cc-svc')].filter(x => x.offsetParent).length) === file.total, 'Show all shows every one');
  await page.click('#cc-int [data-cc-kind="airline"]');
  const f = await page.evaluate(() => [...document.querySelectorAll('#cc-int .cc-svc')].filter(x => x.offsetParent).map(x => x.dataset.cc));
  ok(f.length === 12 && f.every(k => k === 'airline'), 'a kind filter leaves only that kind', f.length);
  await page.evaluate(() => document.querySelector('#cc-int .cc-svc[data-cc="airline"] .cc-use').click());
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({ tab: S.tab, val: (document.getElementById('mta') || {}).value || '' }));
  ok(v.tab === 'chat' && /AMV’s browser/.test(v.val) && /Aerolínea Prueba 1\b/.test(v.val) && /sign in myself/.test(v.val), '"Use in chat" opens a chat naming the site, the person signs in', v.val.slice(0, 100));
}

section('Crew: the jobs, as ordinary Crew jobs');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForFunction(() => { const h = document.getElementById('cc-crew'); return h && !h.hidden; }, null, { timeout: 20000 });
  const r = await page.evaluate(() => ({ n: document.querySelectorAll('#cc-crew .cc-job').length, head: (document.querySelector('#cc-crew .sec-sub b') || {}).textContent,
    known: [...document.querySelectorAll('#cc-crew .cc-job')].slice(0, 5).every(b => _cwAllJobs().some(j => j.id === b.dataset.darg)) }));
  ok(r.n >= file.total && String(r.head) === String(r.n), 'at least one job per entry, counted truly', r);
  ok(r.known, 'each one is a job Crew knows, so it opens and switches on like the rest');
}

section('A country with no file shows nothing, not an empty section');
{
  await page.evaluate(async () => { _cwSetCountry('XK'); setTab('integrations'); await new Promise(x => setTimeout(x, 900)); });
  ok(await page.evaluate(() => { const h = document.getElementById('cc-int'); return !h || h.hidden; }), 'no section when there is no data');
  ok(fetched.includes('XK'), 'though it was asked for', fetched);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
