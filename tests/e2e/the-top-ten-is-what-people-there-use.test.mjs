/* THE TOP TEN IS WHAT PEOPLE THERE USE - FOR EVERY PART OF LIFE.

   Asked for: not only mail and money - a top ten across every main thing (the
   bank, the mail, the calendar, school and assignments, work, the weekly shop,
   shopping, government, getting around, home), each the country's own, backed
   by research on what people there use. And the bank has to be the bank:
   linked directly where a bank can be linked, not read out of emails - and
   where it cannot be, the row says so rather than pretending.

   Measured with the real Worker behind a real server, told where the request
   comes from, in a browser set to en-US. */
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
const ten = async (page) => {
  await page.waitForFunction(() => { const g = document.getElementById('cw-foryou'); return g && !g.hasAttribute('aria-busy') && g.querySelectorAll('.cw-t10:not(.cw-t10-ph)').length >= 5; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#cw-foryou .cw-t10')];
    return {
      head: ((document.querySelector('#cw-foryou h3') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      sec: rows.map(r => (r.querySelector('.cw-t10-sec') || {}).textContent || ''),
      t: rows.map(r => (r.querySelector('.cw-t10-t') || {}).textContent || ''),
      d: rows.map(r => (r.querySelector('.cw-t10-d') || {}).textContent || ''),
      heights: [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().height)))],
      cls: window.__cls,
    };
  });
};
const row = (r, sec) => { const i = r.sec.findIndex(s => s.toLowerCase() === sec); return i < 0 ? null : { t: r.t[i], d: r.d[i], i }; };

section('In the United States: every part of life, the American way');
{
  const { ctx, page } = await open('US', 'crew');
  const r = await ten(page);
  ok(/Top 10 for you in .*United States/.test(r.head) && r.t.length === 10, 'ten, for the United States', r.head);
  ok(['mail','bank','calendar','school','work','groceries','shopping','government','travel','home'].every(s => row(r, s)),
     'one for each part of life - mail, bank, calendar, school, work, groceries, shopping, government, travel, home', r.sec);
  ok(/Gmail/.test(row(r, 'mail').t), 'mail: Gmail', row(r, 'mail').t);
  ok(/Chase/.test(row(r, 'bank').t) && /directly/.test(row(r, 'bank').d) && !/email/i.test(row(r, 'bank').t),
     'bank: the Chase and Amex accounts themselves, linked directly - not read out of emails', row(r, 'bank'));
  ok(/Google Calendar/.test(row(r, 'calendar').t), 'calendar: Google Calendar', row(r, 'calendar').t);
  ok(/Google Classroom/.test(row(r, 'school').t), 'school: assignments from Google Classroom', row(r, 'school').t);
  ok(/LinkedIn|Indeed/.test(row(r, 'work').t), 'work: LinkedIn and Indeed', row(r, 'work').t);
  ok(/Walmart|Kroger|Costco/.test(row(r, 'groceries').t), 'groceries: Walmart, Kroger, Costco', row(r, 'groceries').t);
  ok(/IRS/.test(row(r, 'government').t) && /Amtrak/.test(row(r, 'travel').t) && /Zillow/.test(row(r, 'home').t), 'the IRS, Amtrak, Zillow', [row(r, 'government').t, row(r, 'travel').t, row(r, 'home').t]);
  ok(r.heights.length === 1, 'every row one height', r.heights);
  ok(r.cls < 0.001, 'arriving without moving the page', +r.cls.toFixed(4));
  await ctx.close();
}

section('In China: nothing American, and the bank row says the truth');
{
  const { ctx, page } = await open('CN', 'crew', 390);
  const r = await ten(page);
  ok(r.t.length === 10, 'ten for China', r.t.length);
  ok(!r.t.some(t => /Gmail|Chase|Amex|American Express|IRS|Google/.test(t)), 'nothing from the United States, and no Google', r.t);
  ok(/QQ Mail/.test(row(r, 'mail').t), 'mail: QQ Mail', row(r, 'mail').t);
  ok(/not available in China yet/.test(row(r, 'bank').d), 'bank: says plainly that linking a bank is not available in China yet', row(r, 'bank').d);
  ok(/gaokao/i.test(row(r, 'school').t), 'school: the gaokao', row(r, 'school').t);
  ok(/BOSS Zhipin|51job/.test(row(r, 'work').t) && /Taobao|JD/.test(row(r, 'shopping').t) && /12306/.test(row(r, 'travel').t),
     'work, shopping and travel: BOSS Zhipin, Taobao, 12306', [row(r, 'work').t, row(r, 'shopping').t, row(r, 'travel').t]);
  ok(r.cls < 0.001, 'on a phone, without moving the page', +r.cls.toFixed(4));
  const bank = await page.evaluate(() => [...document.querySelectorAll('#cw-jobs-body .cw-job')].slice(0, 20)
    .filter(c => /Bank connection/.test((c.querySelector('.cw-job-need') || {}).textContent || '')).length);
  ok(bank === 0, 'and the list below does not open on bank jobs China cannot link', bank);
  await ctx.close();
}

section('In Brazil: the bank row names what linking would take there');
{
  const { ctx, page } = await open('BR', 'crew');
  const r = await ten(page);
  ok(/Open Finance Brasil/.test(row(r, 'bank').d), 'bank: not available yet - it needs Open Finance Brasil', row(r, 'bank').d);
  ok(/ENEM/.test(row(r, 'school').t) && /Receita Federal/.test(row(r, 'government').t), 'the ENEM and the Receita Federal', [row(r, 'school').t, row(r, 'government').t]);
  await ctx.close();
}

section('In Germany: WEB.DE first, the Abitur, ELSTER, Deutsche Bahn');
{
  const { ctx, page } = await open('DE', 'crew');
  const r = await ten(page);
  ok(/WEB\.DE/.test(row(r, 'mail').t) && /Abitur/.test(row(r, 'school').t) && /ELSTER/.test(row(r, 'government').t) && /Deutsche Bahn/.test(row(r, 'travel').t),
     'WEB.DE, the Abitur, ELSTER, Deutsche Bahn', [row(r, 'mail').t, row(r, 'school').t, row(r, 'government').t, row(r, 'travel').t]);
  await ctx.close();
}

section('Once enough people in a country have started jobs, their order wins');
{
  /* Seeded the way the server writes it: counts by job id, under the country,
     with nothing about who. Spain has 40 starts - past the floor - and people
     there start the weekly shop most, then the homes search. The United
     States has none, so it keeps the research order. */
  await env.AMV_KV.put('stats:jobuse', JSON.stringify({ counts: {}, total: 40,
    byCountry: { ES: { counts: { cc_es_groc: 22, cc_es_prop: 12, top_es_inbox: 6 }, total: 40 } } }));
  const { ctx, page } = await open('ES', 'crew');
  const r = await ten(page);
  const sub = await page.evaluate(() => ((document.querySelector('#cw-foryou .sec-sub') || {}).textContent || '').replace(/\s+/g, ' '));
  ok(r.sec[0] === 'Groceries' && r.sec[1] === 'Home' && r.sec[2] === 'Mail', 'Spain: groceries, then homes, then mail - the order people there chose', r.sec.slice(0, 4));
  ok(/Ordered by what people in Spain switch on most/.test(sub), 'and the heading says the order is counted, not chosen', sub);
  ok(r.cls < 0.001, 'with the counted order there from the first draw - nothing reshuffles', +r.cls.toFixed(4));
  await ctx.close();
  const us = await open('US', 'crew');
  const u = await ten(us.page);
  const usub = await us.page.evaluate(() => ((document.querySelector('#cw-foryou .sec-sub') || {}).textContent || ''));
  ok(u.sec[0] === 'Mail' && u.sec[1] === 'Bank' && !/Ordered by/.test(usub), 'the United States, with no counts yet, keeps the research order and does not claim otherwise', u.sec.slice(0, 3));
  await us.ctx.close();
  await env.AMV_KV.delete('stats:jobuse');
}

section('Connect on China’s mail row opens QQ Mail, not a Google sign-in');
{
  const { ctx, page } = await openConnectors('CN');
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
  await page.waitForFunction(() => document.querySelector('#cw-foryou [data-dact="cwConnect"][data-darg="top_cn_inbox"]'), null, { timeout: 15000 }).catch(() => {});
  const has = await page.evaluate(() => !!document.querySelector('#cw-foryou [data-dact="cwConnect"][data-darg="top_cn_inbox"]'));
  ok(has, 'the QQ Mail row has a Connect button', has);
  if (has) await page.click('#cw-foryou [data-dact="cwConnect"][data-darg="top_cn_inbox"]');
  await page.waitForFunction(() => /QQ/.test((document.getElementById('ovr') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const dlg = await page.evaluate(() => (document.getElementById('ovr') || {}).textContent.replace(/\s+/g, ' ').slice(0, 400));
  ok(/QQ/.test(dlg) && !/Continue with Google|Sign in with Google/.test(dlg), 'the QQ Mail setup opens, with its own instructions', dlg.slice(0, 160));
  await ctx.close();
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await browser.close(); site.close(); api.close();
report();
done();
