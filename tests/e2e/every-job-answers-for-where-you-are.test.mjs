/* EVERY JOB ANSWERS FOR WHERE YOU ARE, AND CONNECTORS SHOWS WHAT IS USED THERE.

   Asked for: in each country, 105+ of the most common jobs - the five written
   for that country plus the hundred below it, each one naming where it looks
   there - and, on Connectors, the things people in that country use, so they
   can connect them. Measured with the real Worker behind a real server, told
   the request comes from Spain, in a browser set to en-US.

   Three things only a browser can say:
     · the cards name Spain's own services (InfoJobs, Mercadona, the AEAT), not
       a flag on a generic list;
     · those words arrive without moving anything - the line holds its place;
     · Connectors offers Connect only for what really connects there. A Spanish
       bank gets Notify me, never a button that looks like it links money. */
import { createServer } from 'http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?where=' + Date.now())).default;
const env = makeEnv({});
let FROM = 'ES';
const created = [];
const api = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  if (req.url.startsWith('/auto/create')) { try { created.push(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) {} }
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, String(v));
  const r0 = new Request('http://localhost:' + api.address().port + req.url, { method: req.method, headers,
    body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks) });
  Object.defineProperty(r0, 'cf', { value: { country: FROM } });
  const r = await worker.fetch(r0, env, { waitUntil() {}, passThroughOnException() {} });
  const o = {}; r.headers.forEach((v, k) => { o[k] = v; }); res.writeHead(r.status, o); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => api.listen(0, r));
const site = await serveArtifact(0, 'http://localhost:' + api.address().port);
const SITE = 'http://localhost:' + site.address().port;
const browser = await chromium.launch(LAUNCH);
const errors = [];
async function open(from, hash, width = 1280) {
  FROM = from;
  const phone = width === 390;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 1000 }, locale: 'en-US', hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {}
    window.__cls = 0; window.__src = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__cls += e.value;
      window.__src.push((e.sources || []).map(x => x.node && (x.node.id || x.node.className)).join(' ').slice(0, 80)); } }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(SITE + '/#/' + hash, { waitUntil: 'load' });
  return { ctx, page };
}
/* Connectors belongs to an account, so the visitor signs up for real - through
   the Worker, the way the page does - and then opens it. */
let seq = 0;
async function openConnectors(from, width = 1280) {
  const { ctx, page } = await open(from, '', width);
  const email = 'where' + (++seq) + '@example.com';
  /* On Pro for real, the way a verified payment leaves it. Setting the plan in
     the page alone loses a race under load: the server's entitlement check
     answers "free" for a new account and puts the page back, which is that
     check doing its job. */
  await env.AMV_KV.put('ent:' + email, JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  const r = await page.evaluate(async (email) => {
    try { const d = await AMV_API.signup(email, 'Where', 'A-real-Passw0rd!'); loginUser((d && d.user) || { name: 'Where', email, ini: 'W' }); return 'ok'; }
    catch (e) { return String(e && e.message); }
  }, email);
  if (r !== 'ok') errors.push('sign-up failed: ' + r);
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__cls = 0; window.__src = []; setTab('integrations'); });
  return { ctx, page };
}
/* Every card's line, across the whole catalogue. All shows the first few of
   each category and See all the rest, so the lines are read category by
   category - the way somebody pressing the chips would see them - and the
   screen is put back on All. The switching is this test's doing, not the
   page's, so the layout-shift tally is put back as it was too. */
const lines = (page) => page.evaluate(async () => {
  const read = () => [...document.querySelectorAll('.cw-job-loc')].map(e => ({ id: e.dataset.loc, t: e.textContent.trim(), h: e.getBoundingClientRect().height }));
  const cls = window.__cls, src = (window.__src || []).slice();
  const seen = new Map(read().map(x => [x.id, x]));
  const cats = [...document.querySelectorAll('.cw-chip')].map(c => c.dataset.darg).filter(c => c && c !== 'all');
  for (const c of cats) { cwCat(c); read().forEach(x => { if (!seen.has(x.id)) seen.set(x.id, x); }); }
  if (cats.length) cwCat('all');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))));
  window.__cls = cls; window.__src = src;
  return [...seen.values()];
});

section('Crew, from Spain: the hundred below the five name Spain’s own services');
{
  const { ctx, page } = await open('ES', 'crew');
  await page.waitForFunction(() => { const e = document.querySelector('.cw-job-loc[data-loc="job_hunt"]'); return e && /InfoJobs/.test(e.textContent); }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const L = await lines(page);
  const byId = Object.fromEntries(L.map(x => [x.id, x.t]));
  ok(L.length >= 30, 'dozens of cards say where they look in Spain', L.length);
  ok(/^In Spain: .*InfoJobs/.test(byId.job_hunt || ''), 'the job hunt looks on InfoJobs and the SEPE', byId.job_hunt);
  const shop = L.find(x => /Mercadona/.test(x.t));
  ok(!!shop, 'the shopping jobs compare Mercadona and the rest', L.map(x => x.id).join(','));
  ok(/Agencia Tributaria/.test(byId.tax_catch || ''), 'the tax job uses the Agencia Tributaria', byId.tax_catch);
  ok(L.every(x => /Spain/.test(x.t)), 'every line is for Spain - none for the browser’s United States', L.filter(x => !/Spain/.test(x.t)).slice(0, 3));
  ok(L.every(x => x.h > 10 && x.h < 24), 'each is one line, however long the list of names', L.filter(x => !(x.h > 10 && x.h < 24)).slice(0, 3));
  const five = await page.evaluate(() => document.querySelectorAll('#cw-foryou .cw-job-loc').length);
  ok(five === 0, 'the five written for Spain need no line - they are Spain’s already', five);
  const cls = await page.evaluate(() => ({ v: window.__cls, s: window.__src.slice(0, 4) }));
  ok(cls.v < 0.001, 'and the Spanish names arrive without moving the page', { cls: +cls.v.toFixed(4), src: cls.s });
  const run = await page.evaluate(() => typeof _cwCountryGuess === 'function' ? _cwCountryGuess() : '');
  ok(run === 'ES', 'and a job switched on here is created for Spain', run);
  await ctx.close();
}

section('Crew, from Spain, on a phone');
{
  const { ctx, page } = await open('ES', 'crew', 390);
  await page.waitForFunction(() => { const e = document.querySelector('.cw-job-loc[data-loc="job_hunt"]'); return e && /InfoJobs/.test(e.textContent); }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const L = await lines(page);
  ok(L.length >= 30 && L.every(x => /Spain/.test(x.t)), 'the same lines on a phone', L.length);
  const cls = await page.evaluate(() => ({ v: window.__cls, s: window.__src.slice(0, 4) }));
  ok(cls.v < 0.001, 'and nothing moves there either', { cls: +cls.v.toFixed(4), src: cls.s });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(wide <= 0, 'and no line pushes the page sideways', wide);
  await ctx.close();
}

section('Crew, from Spain: a row of jobs made for Spain');
{
  const { ctx, page } = await open('ES', 'crew');
  await page.waitForFunction(() => document.querySelectorAll('#cw-made .cw-made-card').length > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    head: document.querySelector('#cw-made h3').textContent.replace(/\s+/g, ' ').trim(),
    titles: [...document.querySelectorAll('#cw-made .cw-made-t')].map(e => e.textContent.trim()),
    heights: [...document.querySelectorAll('#cw-made .cw-made-it')].map(e => Math.round(e.getBoundingClientRect().height)),
    clipped: [...document.querySelectorAll('#cw-made .cw-made-d')].filter(e => e.scrollHeight > e.clientHeight + 30).length,
    cls: window.__cls, src: (window.__src || []).slice(0, 6),
  }));
  ok(/Made for .*Spain/.test(r.head), 'a row made for Spain sits under the top five', r.head);
  ok(r.titles.length >= 12, 'with a dozen or more of Spain’s own jobs', r.titles.length);
  ok(r.titles.some(t => /Renta/.test(t)) && r.titles.some(t => /DNI|NIE/.test(t)),
     'Spain’s own work - the Renta and the DNI, written for Spain', r.titles.slice(0, 7));
  ok(!r.titles.some(t => /InfoJobs|AEAT|Mercadona/.test(t)), 'and nothing already in the top ten is repeated', r.titles);
  ok(new Set(r.heights).size === 1, 'every card the same height, so the row is one fixed height', [...new Set(r.heights)]);
  ok(r.cls < 0.001, 'and the row arrives without moving the page', { cls: +r.cls.toFixed(4), src: r.src });
  await page.click('#cw-made .cw-made-body');
  await page.waitForFunction(() => /Renta|Mercadona|AEAT|Hacienda/.test((document.getElementById('ovr') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const peek = await page.evaluate(() => (document.getElementById('ovr') || {}).textContent || '');
  ok(/Renta|Mercadona|AEAT|Hacienda/.test(peek), 'pressing a card opens what it does, in Spain’s terms', peek.slice(0, 120));
  await ctx.close();
}

section('Switching one on creates real work for Spain');
{
  const { ctx, page } = await openConnectors('ES');
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
  await page.waitForFunction(() => document.querySelector('.cw-toggle[data-darg="cc_es_jobs"]'), null, { timeout: 15000 }).catch(() => {});
  const id = await page.evaluate(() => { const b = document.querySelector('#cw-foryou .cw-toggle[data-darg="cc_es_jobs"]'); return b ? b.dataset.darg : ''; });
  ok(id === 'cc_es_jobs', 'Spain’s job hunt has a switch in the top five', id);
  const before = created.length;
  await page.click('#cw-foryou .cw-toggle[data-darg="cc_es_jobs"]');
  const box = await page.waitForSelector('#ovr input, #ovr textarea', { timeout: 5000 }).catch(() => null);
  ok(!!box, 'it asks what work, before it runs on nothing');
  if (box) { await box.fill('junior accountant in Valencia, full-time'); await page.click('#ovr button.bp'); }
  for (let i = 0; i < 40 && created.length === before; i++) await page.waitForTimeout(150);
  const c = created[created.length - 1] || {};
  ok(created.length > before, 'and the server is asked to create it', created.length - before);
  ok(/InfoJobs/.test(c.detail || '') && /Spain/.test(c.detail || ''), 'with Spain’s own job sites in the instruction', String(c.detail || '').slice(0, 140));
  ok(/junior accountant in Valencia/.test(c.detail || ''), 'and what they said they want', String(c.detail || '').slice(-120));
  ok(c.country === 'ES' && c.srcId === 'cc_es_jobs', 'for Spain, counted as this job', { country: c.country, srcId: c.srcId });
  await ctx.close();
}

section('Crew, from the United States: the same cards, for the United States');
{
  const { ctx, page } = await open('US', 'crew');
  await page.waitForFunction(() => { const e = document.querySelector('.cw-job-loc[data-loc="job_hunt"]'); return e && /^In United States/.test(e.textContent); }, null, { timeout: 15000 }).catch(() => {});
  const L = await lines(page);
  const byId = Object.fromEntries(L.map(x => [x.id, x.t]));
  ok(/^In United States/.test(byId.job_hunt || '') && !/InfoJobs/.test(byId.job_hunt || ''), 'the job hunt is the United States’ one', byId.job_hunt);
  ok(/IRS/.test(byId.tax_catch || ''), 'and the tax job uses the IRS', byId.tax_catch);
  await ctx.close();
}

section('Other countries: Mexico’s facts, from the bottom of Crew');
{
  const { ctx, page } = await open('ES', 'crew');
  await page.waitForSelector('#cw-morec [data-dact="cwMoreCountries"]', { timeout: 15000 });
  await page.click('#cw-morec [data-dact="cwMoreCountries"]');
  await page.click('#cw-morec [data-darg="MX"]');
  await page.waitForFunction(() => document.querySelector('#cw-browse .cw-facts'), null, { timeout: 10000 }).catch(() => {});
  const r = await page.evaluate(() => ({
    h: ((document.querySelector('#cw-browse .cw-facts-h') || {}).textContent || '').trim(),
    facts: [...document.querySelectorAll('#cw-browse .cw-facts-r')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
  }));
  ok(/Mexico/.test(r.h), 'Mexico says where AMV looks there', r.h);
  ok(r.facts.length >= 8 && r.facts.some(t => /SAT/.test(t)), 'with Mexico’s tax office and the rest', r.facts.slice(0, 4));
  const mx = await page.evaluate(() => [...document.querySelectorAll('#cw-browse .cw-made-t')].map(e => e.textContent.trim()));
  ok(mx.length >= 10 && mx.some(t => /SAT/.test(t)) && !mx.some(t => /InfoJobs|Mercadona/.test(t)), 'and Mexico’s own jobs, none of Spain’s', mx.slice(0, 5));
  await page.click('#cw-browse .cw-made-body');
  await page.waitForFunction(() => /Mexico|SAT/.test((document.getElementById('ovr') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  ok(/Mexico|SAT/.test(await page.evaluate(() => (document.getElementById('ovr') || {}).textContent || '')), 'which open from there too');
  await ctx.close();
}

section('Connectors, from Spain: popular in Spain, honestly');
{
  const { ctx, page } = await openConnectors('ES');
  await page.waitForSelector('#int-local', { timeout: 15000 });
  await page.waitForFunction(() => /Spain/.test((document.getElementById('int-local-t') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const head = await page.evaluate(() => document.getElementById('int-local-t').textContent);
  ok(/Popular in Spain/.test(head), 'the card near the top says Spain', head);
  const cls = await page.evaluate(() => ({ v: window.__cls, s: window.__src.slice(0, 4) }));
  ok(cls.v < 0.001, 'and learning the country moved nothing on the page', { cls: +cls.v.toFixed(4), src: cls.s });
  await page.click('#int-local');
  await page.waitForFunction(() => document.querySelector('#lc-body .int-card'), null, { timeout: 10000 }).catch(() => {});
  const d = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#lc-body .ss2')].map(s => ({
      h: s.querySelector('h3').textContent,
      rows: [...s.querySelectorAll('.int-card')].map(c => ({ n: c.querySelector('.int-name').textContent, t: c.textContent.replace(/\s+/g, ' '), b: (c.querySelector('.int-act') || {}).textContent.trim() })),
    }));
    return { title: document.getElementById('lc-h').textContent, secs };
  });
  const find = (re) => d.secs.flatMap(s => s.rows.map(r => Object.assign({ sec: s.h }, r))).find(r => re.test(r.t));
  ok(/Popular in Spain/.test(d.title), 'the dialog is for Spain', d.title);
  const connectSec = d.secs.find(s => /^Connect in Spain/.test(s.h));
  ok(connectSec && connectSec.rows.length >= 1 && connectSec.rows.every(r => r.b === 'Connect'), 'Spain’s own mailboxes, each with a real Connect', connectSec);
  const jobs = find(/InfoJobs/);
  ok(jobs && /no sign-in/.test(jobs.sec) && jobs.b === 'See the jobs', 'InfoJobs is used without a sign-in, and leads to the jobs that use it', jobs);
  const bank = find(/Santander/);
  ok(bank && bank.b === 'Notify me' && /Not available in Spain/.test(bank.t), 'Spain’s banks get Notify me and a reason - never a Connect', bank);
  ok(!d.secs.some(s => s.rows.some(r => /Link in Spending/.test(r.b))), 'and nothing offers to link a Spanish bank', d.secs.map(s => s.h));
  await page.click('#lc-body [data-lc-find="job"]');
  await page.waitForFunction(() => document.getElementById('cw-find') && document.getElementById('cw-find').value === 'job', null, { timeout: 8000 }).catch(() => {});
  const crew = await page.evaluate(() => ({ v: (document.getElementById('cw-find') || {}).value, n: document.querySelectorAll('#cw-jobs-body .cw-job').length }));
  ok(crew.v === 'job' && crew.n >= 3, 'See the jobs opens Crew already searched, with jobs in it', crew);
  await ctx.close();
}

section('Connectors, from the United States: the bank really links there');
{
  const { ctx, page } = await openConnectors('US');
  await page.waitForSelector('#int-local', { timeout: 15000 });
  await page.click('#int-local');
  await page.waitForFunction(() => document.querySelector('#lc-body .int-card'), null, { timeout: 10000 }).catch(() => {});
  const r = await page.evaluate(() => [...document.querySelectorAll('#lc-body .int-card')].map(c => c.textContent.replace(/\s+/g, ' ')));
  ok(r.some(t => /Your bank/.test(t) && /Link in Spending/.test(t)), 'the bank row goes to the real link in Spending', r.filter(t => /bank/i.test(t)));
  ok(!r.some(t => /Bank sign-in in/.test(t)), 'and is not on a waiting list there', r.length);
  ok(r.some(t => /Google Calendar/.test(t)) && r.some(t => /Google Classroom/.test(t)),
     'with the calendar and the school system people there use, as in Crew’s top ten', r.filter(t => /Google/.test(t)).map(t => t.slice(0, 40)));
  await page.selectOption('#lc-c', 'BR');
  await page.waitForFunction(() => /Brazil/.test((document.getElementById('lc-h') || {}).textContent || '') && document.querySelector('#lc-body .int-card'), null, { timeout: 10000 }).catch(() => {});
  const br = await page.evaluate(() => document.getElementById('lc-body').textContent.replace(/\s+/g, ' '));
  ok(/Bank sign-in in Brazil/.test(br) && /Open Finance Brasil/.test(br), 'Brazil: no bank link yet, and what it would take', br.slice(br.indexOf('Bank sign-in'), br.indexOf('Bank sign-in') + 200));
  await page.selectOption('#lc-c', 'JP');
  await page.waitForFunction(() => /Japan/.test((document.getElementById('lc-h') || {}).textContent || '') && document.querySelector('#lc-body .int-card'), null, { timeout: 10000 }).catch(() => {});
  const jp = await page.evaluate(() => ({ h: document.getElementById('lc-h').textContent, t: document.getElementById('lc-body').textContent }));
  ok(/Japan/.test(jp.h) && /Bank sign-in in Japan/.test(jp.t), 'choosing another country shows that country, honestly', jp.h);
  await ctx.close();
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await browser.close(); site.close(); api.close();
report();
done();
