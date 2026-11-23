/* EVERY TOPIC LISTS THE SERVICES USED WORLDWIDE (Nov 23).

   The owner: "integrations should have a minimum of 200 per section - email,
   calendar, all these sections - for all countries, backed on research and
   popularity." A country's file holds what is filed under that country; the
   services every country uses are filed under none. global-services.json,
   built from data/global (Wikidata, ranked by Wikipedia sitelinks), fills
   each topic after the country's own.

   Held here: the build leaves out what the catalogue refuses (password
   managers, other AI products) and what it already lists; the page drops an
   entry that is not a plain name and a bare host; each topic counts them in
   its one See the remaining; a worldwide money service is never opened in
   AMV's browser; search finds them; and a failed fetch is tried again.
   The real counts per topic are printed, not claimed. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildGlobalServices, sameAsApp } from '../../scripts/global-services.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;

section('The build leaves out what the catalogue refuses');
{
  const dir = mkdtempSync(join(tmpdir(), 'amv-global-'));
  mkdirSync(join(dir, 'src', 'app'), { recursive: true });
  mkdirSync(join(dir, 'data', 'global'), { recursive: true });
  cpSync(join(ROOT, 'src', 'app', '13c-app-catalog.js'), join(dir, 'src', 'app', '13c-app-catalog.js'));
  const items = [
    { q: 'Q1', n: 'Tuta', s: 'tuta.com', w: 40, c: 'webmail' },
    { q: 'Q2', n: 'Gmail', s: 'gmail.com', w: 120, c: 'webmail' },
    { q: 'Q3', n: 'Microsoft Outlook', s: 'outlook.office.com', w: 60, c: 'email client' },
    { q: 'Q4', n: 'Some Vault', s: 'vault.example.com', w: 30, c: 'password manager' },
    { q: 'Q5', n: 'A Chat Model', s: 'chatgpt.com', w: 90, c: 'webmail' },
    { q: 'Q6', n: 'Bad <b>', s: 'bad.example.com', w: 20, c: 'webmail' },
    { q: 'Q7', n: 'Mozilla Thunderbird', s: 'thunderbird.net', w: 65, c: 'email client' },
  ];
  writeFileSync(join(dir, 'data', 'global', 'email.json'), JSON.stringify({ topic: 'email', generated: '2026-11-23', items }));
  writeFileSync(join(dir, 'data', 'global', 'files.json'), JSON.stringify({ topic: 'files', generated: '2026-11-23', items: [{ q: 'Q7', n: 'Mozilla Thunderbird', s: 'thunderbird.net', w: 65, c: 'document management system' }, { q: 'Q8', n: 'Seafile', s: 'seafile.com', w: 12, c: 'document management system' }] }));
  const d = { topics: buildGlobalServices(dir).topics };
  const names = (t) => (d.topics[t] || []).map(x => x[1]);
  ok(JSON.stringify(names('email')) === JSON.stringify(['Mozilla Thunderbird', 'Tuta']), 'email keeps what is new, most-covered first', names('email'));
  ok(!names('email').includes('Gmail') && !names('email').includes('Microsoft Outlook'), 'an app already listed is not listed again (Gmail; Microsoft Outlook is "Outlook and Hotmail")');
  ok(!names('email').includes('Some Vault'), 'a password manager is left out');
  ok(!names('email').includes('A Chat Model'), 'another AI product is left out, by its site');
  ok(!names('email').includes('Bad <b>'), 'a name that is not plain is left out');
  /* Found by each topic's own class, it is listed in each (a CRM is Business
     and Support), once per topic. */
  ok(JSON.stringify(names('files')) === JSON.stringify(['Mozilla Thunderbird', 'Seafile']), 'a service each topic finds by its own class is listed in each', names('files'));
  ok(names('email').filter(n => n === 'Mozilla Thunderbird').length === 1, 'and once within a topic');
  ok(sameAsApp('Outlook.com', [['outlook', 'and', 'hotmail']]) && !sameAsApp('Proton Mail', [['mail', 'worldwide']]), 'matching an app is by its own words, not by a shared generic one');
}

section('The real lists, counted');
const real = JSON.parse(readFileSync(join(ROOT, 'global-services.json'), 'utf8'));
const counts = Object.fromEntries(Object.entries(real.topics).map(([t, l]) => [t, l.length]));
console.log('  worldwide services per topic:', JSON.stringify(counts));
ok(Object.keys(counts).length >= 25, 'most topics have worldwide services', Object.keys(counts).length);
ok(JSON.stringify(real) === JSON.stringify(JSON.parse(readFileSync(join(ROOT, 'public', 'global-services.json'), 'utf8'))), 'the published copy is the built one');
const AI = /(^|\.)(openai\.com|chatgpt\.com|anthropic\.com|claude\.ai|perplexity\.ai|midjourney\.com)$/;
ok(!real.entries.some(x => AI.test(x[2])), 'no other AI product in the real lists');
ok(Object.values(real.topics).flat().every(i => Number.isInteger(i) && i >= 0 && i < real.entries.length), 'each topic points into the one table');
ok(real.reach && real.reach.g.length === real.entries.length, 'and the visits are one per entry');

/* The page, with a small file of our own and one bad entry. */
const FIX = { source: 'test', generated: '2026-11-23',
  entries: [['Q901', 'Mailbox Uno', 'uno-mail.example.org'], ['Q902', 'Mailbox Dos', 'dos-mail.example.org'], ['Q903', 'Bad <img src=x onerror=alert(1)>', 'bad.example.org'], ['Q904', 'Mailbox Tres', 'https://tres.example.org'], ['Q911', 'Neo Bank Test', 'neobank.example.org']],
  topics: { email: [0, 1, 2, 3], money: [4] },
  reach: { month: '2026-10', g: '00000' } };
/* Visits from the visitor's country: Dos is in the top 5,000 there, Uno is not measured. */
const HERE = { month: '2026-10', codes: '02000' };
const app = await bootApp({ tab: 'chat', blockServiceWorkers: true });
const { page } = app;
let served = 0, failFirst = true;
await page.route('**/global-services.json', r => {
  served++;
  if (failFirst) { failFirst = false; return r.fulfill({ status: 503, body: '' }); }
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIX) });
});
await page.route('**/countries/*.json', r => r.fulfill({ status: 404, body: '' }));
await page.route('**/global-reach/*.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HERE) }));
await page.evaluate(() => { _cwSetCountry('XK'); });

section('A failed fetch is tried again');
{
  await page.evaluate(async () => { setTab('integrations'); await new Promise(x => setTimeout(x, 1500)); });
  const first = await page.evaluate(() => document.querySelectorAll('#int-catalog .cc-svc[data-cc="global"]').length);
  ok(first === 0, 'nothing is drawn from a failed fetch', first);
  await page.evaluate(async () => { setTab('chat'); setTab('integrations'); });
  await page.waitForFunction(() => document.querySelector('#int-catalog .cc-svc[data-cc="global"]'), null, { timeout: 15000 }).catch(() => {});
  ok(served >= 2, 'and the next visit asks again', served);
}

section('In its topic, after the apps');
{
  await page.evaluate(async () => { const b = document.querySelector('#int-catalog [data-topic="email"] [data-app-more][aria-expanded="false"]'); if (b) b.click(); await new Promise(x => setTimeout(x, 600)); });
  const r = await page.evaluate(() => {
    const sec = document.querySelector('#int-catalog [data-topic="email"]');
    const cards = [...sec.querySelectorAll('.int-card')];
    const g = cards.filter(c => c.dataset.cc === 'global');
    return { names: g.map(c => c.querySelector('.int-name').textContent), lastApp: cards.findIndex(c => c.dataset.cc === 'global') > cards.filter(c => !c.classList.contains('cc-svc')).length - 1,
      html: document.getElementById('vc').innerHTML, btn: g[0] ? g[0].querySelector('.int-act').textContent.trim() : '' };
  });
  ok(JSON.stringify(r.names) === JSON.stringify(['Mailbox Dos', 'Mailbox Uno']), 'the two good entries, the one visited from the visitor\u2019s country first', r.names);
  ok(r.lastApp, 'after the topic’s own apps');
  ok(!/onerror|tres\.example/.test(r.html), 'the entry that is not a plain name or a bare host never reaches the page');
  ok(r.btn === 'Use', 'and each says Use', r.btn);
  await page.evaluate(() => document.querySelector('#int-catalog [data-topic="email"] .cc-svc[data-cc="global"] .cc-use').click());
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({ tab: S.tab, val: (document.getElementById('mta') || {}).value || '' }));
  ok(v.tab === 'chat' && /dos-mail\.example\.org/.test(v.val) && /sign in myself/.test(v.val), 'Use opens a chat naming the site; the person signs in', v.val.slice(0, 90));
}

section('A worldwide money service never opens in AMV’s browser');
{
  await page.evaluate(async () => { setTab('integrations'); await new Promise(x => setTimeout(x, 900)); const b = document.querySelector('#int-catalog [data-topic="money"] [data-app-more][aria-expanded="false"]'); if (b) b.click(); await new Promise(x => setTimeout(x, 600)); });
  const r = await page.evaluate(() => {
    const c = document.querySelector('#int-catalog [data-topic="money"] .cc-svc[data-cc="global"]');
    const a = c && c.querySelector('.int-act a');
    const before = S.tab; ccUseService('Q911'); const after = S.tab;
    return { href: a ? a.getAttribute('href') : '', target: a ? a.target : '', rel: a ? a.rel : '', dact: c ? !!c.querySelector('[data-dact="ccUseService"]') : true, before, after };
  });
  ok(r.href === 'https://neobank.example.org/' && r.target === '_blank' && /noopener/.test(r.rel), 'it opens in the person’s own browser', r);
  ok(!r.dact && r.after === r.before, 'and nothing sends it to AMV’s browser, even called directly', r);
}

section('Search finds them');
{
  /* Through the search box, as a person would. */
  await page.evaluate(async () => { setTab('integrations'); await new Promise(x => setTimeout(x, 800)); });
  await page.fill('#cdir-find', 'mailbox dos');
  await page.press('#cdir-find', 'Enter');
  await page.waitForFunction(() => /Mailbox Dos/.test((document.getElementById('cdir-cc') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
  const t = await page.evaluate(() => (document.getElementById('cdir-cc') || {}).textContent || '');
  ok(/Mailbox Dos/.test(t) && !/Mailbox Uno/.test(t), 'a search for a worldwide service finds it, and only it', t.slice(0, 120));
}

await app.close();
report(); done();
