/* TASKS KNOW WHERE YOU ARE (Nov 10, owner: "update Tasks with so many more
   things; depending on where I am it shows the most popular tasks there").

   What is held: the ready-made tasks number well past the old twenty-five;
   a country's own section is built from the server's facts for it and names
   its real services, and pressing one writes a prompt that names them too;
   the search narrows every task, the country's included; and a search with
   nothing behind it offers to ask in chat, carrying the words across. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => {
  Object.defineProperty(window.AMV_API, 'live', { get: () => true, configurable: true });
  window.AMV_API.everyday = async (cc) => ({ facts: cc === 'ES'
    ? { tax: 'the Agencia Tributaria', pay: 'Bizum', jobs: 'InfoJobs, LinkedIn', rail: 'Renfe', post: 'Correos' }
    : { tax: 'the IRS', jobs: 'Indeed, LinkedIn' } });
  _cwSetCountry('ES');
  setTab('tasks');
});
await page.waitForTimeout(900);

section('Many more ready-made tasks, in the groups people read');
{
  const r = await page.evaluate(() => ({ n: document.querySelectorAll('.tasks-masonry .tk-row').length,
    groups: [...document.querySelectorAll('.tasks-masonry .tk-cat h3')].map(h => h.textContent.trim()) }));
  ok(r.n >= 80, 'eighty or more general tasks', r.n);
  ok(r.groups.includes('Study') && r.groups.includes('Money & home'), 'with Study and Money & home among the groups', r.groups);
  ok(r.groups[r.groups.length - 1] === 'Code', 'and code still last', r.groups);
}

section('The country’s own, named for its services');
{
  const r = await page.evaluate(() => ({ head: (document.querySelector('#tk-local h3') || {}).textContent || '',
    rows: [...document.querySelectorAll('#tk-local .tk-row')].map(b => b.textContent.replace(/\s+/g, ' ').trim()) }));
  ok(/Spain/.test(r.head), 'a section for Spain', r.head);
  ok(r.rows.length === 7, 'one row per task its facts support - and none for what Spain has no entry for', r.rows.length);
  ok(r.rows.some(t => /Agencia Tributaria/.test(t)) && r.rows.some(t => /Bizum/.test(t)), 'naming the Agencia Tributaria and Bizum', r.rows.slice(0, 3));
  await page.click('#tk-local .tk-row');
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({ tab: S.tab, val: (document.getElementById('mta') || {}).value || '' }));
  ok(v.tab === 'chat' && /Agencia Tributaria/.test(v.val), 'and pressing one writes a prompt that names it, in chat', v.val.slice(0, 80));
}

section('Another country, another section');
{
  const r = await page.evaluate(async () => { _cwSetCountry('US'); setTab('tasks'); await new Promise(x => setTimeout(x, 700));
    return [...document.querySelectorAll('#tk-local .tk-row')].map(b => b.textContent.replace(/\s+/g, ' ').trim()); });
  ok(r.length === 4 && r.some(t => /IRS/.test(t)) && !r.some(t => /Agencia|Bizum/.test(t)), 'the United States gets the IRS, not Spain’s list', r);
}

section('One of the sixty opens with its own prompt');
{
  await page.evaluate(() => document.querySelector('[data-darg="x-' + 'writing-tone' + '"]').click());
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => (document.getElementById('mta') || {}).value || '');
  ok(/Rewrite \[text\] in \[tone\]/.test(v), 'the prompt is there, with its blanks', v.slice(0, 60));
}

section('Search narrows everything, and nothing found goes to chat');
{
  await page.evaluate(() => setTab('tasks'));
  await page.waitForTimeout(700);
  await page.fill('#tk-find', 'interview');
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ shown: [...document.querySelectorAll('.tk-row:not([hidden])')].map(b => b.querySelector('.tk-t').textContent),
    n: document.getElementById('tk-find-n').textContent, emptyGroups: [...document.querySelectorAll('.tk-cat')].filter(c => !c.hidden && !c.querySelector('.tk-row:not([hidden])')).length }));
  ok(r.shown.length >= 1 && r.shown.every(t => /interview/i.test(t)), 'only matching tasks are left', r.shown);
  ok(/\d+/.test(r.n) && r.emptyGroups === 0, 'with a count, and no empty group left standing', r);
  await page.fill('#tk-find', 'renew my fishing licence');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !!document.getElementById('tk-none')), 'no match: an offer to ask in chat');
  await page.click('#tk-none-go');
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({ tab: S.tab, val: (document.getElementById('mta') || {}).value || '' }));
  ok(v.tab === 'chat' && v.val === 'renew my fishing licence', 'carrying the words across', v);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
