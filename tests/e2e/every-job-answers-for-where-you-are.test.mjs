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
/* WHERE A JOB LOOKS, IN ITS PANEL (Nov 15). The line used to sit on every card
   ("In Spain: InfoJobs · SEPE") and the owner asked for the cards to be plain,
   so it moved to the job's panel - where somebody is deciding - and the server
   still adds the country's starting points to every run. Read job by job. */
const panelLoc = (page, ids) => page.evaluate(async (ids) => {
  const out = {};
  for (const id of ids) {
    cwPeek(id); await new Promise(r => setTimeout(r, 120));
    out[id] = ((document.querySelector('#ovr .cwp-loc') || {}).textContent || '').trim();
    closeOvr();
  }
  return out;
}, ids);
const LOC_IDS = ['job_hunt', 'tax_catch', 'groceries', 'salary_bench', 'morning_brief'];

section('Crew, from Spain: a job says where it looks in Spain');
{
  const { ctx, page } = await open('ES', 'crew');
  await page.waitForFunction(() => typeof _cwFacts !== 'undefined' && _cwFacts.ES && /InfoJobs/.test(_cwLocText('job_hunt', 'ES')), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const L = await panelLoc(page, LOC_IDS);
  ok(/InfoJobs/.test(L.job_hunt), 'the job hunt looks on InfoJobs and the SEPE', L.job_hunt);
  ok(/Agencia Tributaria/.test(L.tax_catch), 'the tax job uses the Agencia Tributaria', L.tax_catch);
  ok(Object.values(L).filter(Boolean).length >= 4, 'and the others name Spain’s own services too', L);
  ok(!Object.values(L).some(t => /\bIRS\b|Walmart|Indeed\.com/.test(t)), 'none of them the browser’s United States', L);
  const plain = await page.evaluate(() => document.querySelectorAll('#cj-grid .cw-job-loc').length);
  ok(plain === 0, 'and the cards themselves stay plain - the line is in the panel', plain);
  const own = await page.evaluate(() => (_cwLocalJobs('ES') || []).map(j => j.id).filter(id => { cwPeek(id); const has = !!document.querySelector('#ovr .cwp-loc'); closeOvr(); return has; }));
  ok(own.length === 0, 'the jobs written for Spain need no line - they are Spain’s already', own);
  const cls = await page.evaluate(() => ({ v: window.__cls, s: window.__src.slice(0, 4) }));
  ok(cls.v < 0.001, 'and Spain’s jobs arrive without moving the page', { cls: +cls.v.toFixed(4), src: cls.s });
  const run = await page.evaluate(() => typeof _cwCountryGuess === 'function' ? _cwCountryGuess() : '');
  ok(run === 'ES', 'and a job switched on here is created for Spain', run);
  await ctx.close();
}

section('Crew, from Spain, on a phone');
{
  const { ctx, page } = await open('ES', 'crew', 390);
  await page.waitForFunction(() => typeof _cwFacts !== 'undefined' && _cwFacts.ES && /InfoJobs/.test(_cwLocText('job_hunt', 'ES')), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const L = await panelLoc(page, ['job_hunt']);
  ok(/InfoJobs/.test(L.job_hunt), 'the same line on a phone', L.job_hunt);
  const cls = await page.evaluate(() => ({ v: window.__cls, s: window.__src.slice(0, 4) }));
  ok(cls.v < 0.001, 'and nothing moves there either', { cls: +cls.v.toFixed(4), src: cls.s });
  const wide = await page.evaluate(async () => { cwPeek('job_hunt'); await new Promise(r => setTimeout(r, 150)); const w = document.documentElement.scrollWidth - innerWidth; closeOvr(); return w; });
  ok(wide <= 0, 'and no line pushes the page sideways', wide);
  await ctx.close();
}

section('Crew, from Spain: Spain’s own jobs lead the list');
{
  const { ctx, page } = await open('ES', 'crew');
  await page.waitForFunction(() => typeof _cjList === 'function' && (_cwMadeForJobs('ES') || []).length > 0 && (_cwLocalJobs('ES') || []).length > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const list = _cjList();
    /* Since Nov 23 the everyday fifty lead every country's list (the owner:
       "make them things people can do every day"), so the country's own
       work starts after them - still on the first screens of a list of
       thousands. */
    const titles = list.slice(0, 120).map(j => j.title);
    return { head: (document.getElementById('cx-jobs-h') || {}).textContent || '', titles,
             made: (_cwMadeForJobs('ES') || []).length, firstIds: list.slice(0, 12).map(j => j.id),
             uni: _cwUniversalJobs().map(j => j.id), cls: window.__cls, src: (window.__src || []).slice(0, 6) };
  });
  ok(/Spain/.test(r.head), 'headed for Spain', r.head);
  ok(r.made >= 12, 'with a dozen or more of Spain’s own jobs', r.made);
  ok(r.titles.some(t => /Renta/.test(t)) && r.titles.some(t => /DNI|NIE/.test(t)),
     'Spain’s own work - the Renta and the DNI, written for Spain, near the top', r.titles.slice(0, 12));
  ok(r.titles.some(t => /AEAT|Mercadona/.test(t)), 'and the AEAT and Mercadona among them', r.titles.filter(t => /AEAT|Mercadona/.test(t)).slice(0, 3));
  ok(!r.firstIds.some(id => r.uni.includes(id)), 'nothing that is the same everywhere ahead of them', r.firstIds);
  ok(r.cls < 0.001, 'and the list arrives without moving the page', { cls: +r.cls.toFixed(4), src: r.src });
  const id = await page.evaluate(() => { const b = document.querySelector('#cj-grid .cj-card-b'); return b && b.dataset.darg; });
  await page.click('#cj-grid .cj-card-b');
  await page.waitForFunction(() => /Renta|Mercadona|AEAT|Hacienda|Santander|BBVA|Caixa|Spain/.test((document.getElementById('ovr') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const peek = await page.evaluate(() => (document.getElementById('ovr') || {}).textContent || '');
  ok(/Renta|Mercadona|AEAT|Hacienda|Santander|BBVA|Caixa|Spain/.test(peek), 'pressing a card opens what it does, in Spain’s terms', { id, t: peek.slice(0, 120) });
  await ctx.close();
}

section('Switching one on creates real work for Spain');
{
  const { ctx, page } = await openConnectors('ES');
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
  await page.waitForFunction(() => typeof _cjList === 'function' && _cjList().some(j => j.id === 'cc_es_jobs'), null, { timeout: 15000 }).catch(() => {});
  /* Found the way somebody would: searched for. */
  await page.evaluate(() => { const j = _cjList().find(x => x.id === 'cc_es_jobs'); const q = document.getElementById('cx-q'); q.value = j.title; q.dispatchEvent(new Event('input', { bubbles: true })); });
  const sel = '#cj-grid .cw-toggle[data-darg="cc_es_jobs"]';
  await page.waitForSelector(sel, { timeout: 15000 }).catch(() => {});
  const id = await page.evaluate((sel) => { const b = document.querySelector(sel); return b ? b.dataset.darg : ''; }, sel);
  ok(id === 'cc_es_jobs', 'Spain’s job hunt has a switch', id);
  const before = created.length;
  await page.click(sel);
  const box = await page.waitForSelector('#ovr input:not([type=time]), #ovr textarea', { timeout: 5000 }).catch(() => null);
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

section('Crew, from the United States: the same jobs, for the United States');
{
  const { ctx, page } = await open('US', 'crew');
  await page.waitForFunction(() => typeof _cwFacts !== 'undefined' && _cwFacts.US && /IRS/.test(_cwLocText('tax_catch', 'US')), null, { timeout: 15000 }).catch(() => {});
  const L = await panelLoc(page, ['job_hunt', 'tax_catch']);
  ok(L.job_hunt && !/InfoJobs/.test(L.job_hunt), 'the job hunt is the United States’ one', L.job_hunt);
  ok(/IRS/.test(L.tax_catch), 'and the tax job uses the IRS', L.tax_catch);
  await ctx.close();
}

section('Another country: Mexico’s jobs, chosen from the top');
{
  const { ctx, page } = await open('ES', 'crew');
  await page.waitForSelector('#cw-where[data-dact="cjCountry"]', { timeout: 15000 });
  await page.click('#cw-where');
  await page.waitForSelector('#ccp-list', { timeout: 10000 });
  await page.fill('#ccp-q', 'mexico');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Mexico/.test((document.getElementById('cx-jobs-h') || {}).textContent || '') && (_cwMadeForJobs('MX') || []).length > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ h: document.getElementById('cx-jobs-h').textContent,
    titles: _cjList().map(j => j.title), loc: _cwLocText('tax_catch', 'MX') }));
  ok(/Mexico/.test(r.h), 'the list is headed for Mexico', r.h);
  ok(/SAT/.test(r.loc), 'its tax job looks at Mexico’s tax office', r.loc);
  ok(r.titles.length >= 100 && r.titles.some(t => /SAT/.test(t)) && !r.titles.some(t => /InfoJobs|Mercadona/.test(t)), 'and Mexico’s own jobs, none of Spain’s', r.titles.filter(t => /SAT/.test(t)).slice(0, 3));
  await page.click('#cj-grid .cj-card-b');
  await page.waitForFunction(() => ((document.getElementById('ovr') || {}).textContent || '').length > 40, null, { timeout: 5000 }).catch(() => {});
  ok(((await page.evaluate(() => (document.getElementById('ovr') || {}).textContent || '')).length > 40), 'which open from there too');
  await ctx.close();
}

section('Integrations, from Spain: Spain’s services are used, never falsely connected');
{
  /* "Services in Spain" was a card and a dialog of its own, removed at the
     owner's word (Nov 15) - Spain's services now sit in the topics they
     belong to. What still has to hold: a service AMV cannot connect is used
     in AMV's own browser and says so, and nothing offers to link a bank it
     cannot link. */
  const { ctx, page } = await openConnectors('ES');
  await page.waitForFunction(() => document.querySelector('#app .cc-svc'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const d = await page.evaluate(() => ({
    text: document.getElementById('vc').textContent.replace(/\s+/g, ' '),
    svc: [...document.querySelectorAll('#app .cc-svc')].map(c => ({ n: (c.querySelector('.int-name') || {}).textContent, b: (c.querySelector('.int-act') || {}).textContent.trim(), k: c.dataset.cc, act: (c.querySelector('.int-act button') || {}).dataset?.dact })),
    cls: window.__cls, src: (window.__src || []).slice(0, 4),
  }));
  ok(!/Services in Spain|Popular in Spain/.test(d.text), 'no "Services in" or "Popular in" Spain block', '');
  ok(d.svc.length >= 20, 'Spain’s own services are in the topics', d.svc.length);
  ok(d.svc.filter(x => x.k !== 'bank').every(x => x.b === 'Use'), 'each one is Use - opened in AMV’s browser - never a Connect it cannot keep', d.svc.filter(x => x.k !== 'bank' && x.b !== 'Use').slice(0, 3));
  /* A bank is never opened in AMV's browser: Link opens the read-only bank
     connection, which says itself whether linking works in Spain. */
  const banks = d.svc.filter(x => x.k === 'bank');
  ok(banks.length > 0 && banks.every(x => x.b === 'Link' && x.act === 'openBankLink'), 'and a Spanish bank says Link, the read-only connection - never Use, never Connect', banks.slice(0, 3));
  ok(d.cls < 0.001, 'and learning the country moved nothing on the page', { cls: +d.cls.toFixed(4), src: d.src });
  await ctx.close();
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await browser.close(); site.close(); api.close();
report();
done();
