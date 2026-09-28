/* THE TOP FIVE IS WHAT PEOPLE THERE CONNECT.

   Asked for: "my top 5 should be USA based - not just 'pay bills in US', it
   should say connect Visa or Amex and pay bills, check Gmail versus whatever
   China uses." So the five are built from the country's data: the mailbox
   people there use most (Gmail, QQ Mail, WEB.DE), the cards that can be
   linked where a bank can be (the US), and the local sites AMV uses without a
   sign-in. And the hundred below drop what cannot work there - a bank job in
   China goes to the back and says why.

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
  const r = await page.evaluate(async (email) => {
    try { const d = await AMV_API.signup(email, 'Where', 'A-real-Passw0rd!'); loginUser((d && d.user) || { name: 'Where', email, ini: 'W' }); return 'ok'; }
    catch (e) { return String(e && e.message); }
  }, email);
  if (r !== 'ok') errors.push('sign-up failed: ' + r);
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__cls = 0; window.__src = []; setTab('integrations'); });
  return { ctx, page };
}
const five = async (page) => {
  await page.waitForFunction(() => { const g = document.getElementById('cw-foryou'); return g && !g.hasAttribute('aria-busy') && g.querySelectorAll('.cw-job').length === 5; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    titles: [...document.querySelectorAll('#cw-foryou .cw-job-t')].map(e => e.textContent.trim()),
    uses: [...document.querySelectorAll('#cw-foryou .cw-job-need')].map(e => e.firstChild.textContent.trim()),
    heights: [...document.querySelectorAll('#cw-foryou .cw-top5-item .cw-job')].map(e => Math.round(e.getBoundingClientRect().height)),
    cls: window.__cls,
  }));
};

section('In the United States: Gmail, the cards people hold, the IRS');
{
  const { ctx, page } = await open('US', 'crew');
  const r = await five(page);
  ok(/Gmail/.test(r.titles[0]), 'first: the Gmail inbox', r.titles[0]);
  ok(r.titles.some(t => /Chase/.test(t) && /American Express/.test(t)), 'then the Chase and Amex cards - a bank really can be linked here', r.titles);
  ok(r.titles.some(t => /LinkedIn|Indeed/.test(t)) && r.titles.some(t => /IRS/.test(t)), 'and LinkedIn and the IRS, not somebody else’s', r.titles);
  ok(r.uses[0] === 'Uses: Gmail', 'the card says Gmail, not "Email"', r.uses[0]);
  ok(new Set(r.heights).size === 1, 'five cards of one height', r.heights);
  ok(r.cls < 0.001, 'arriving without moving the page', +r.cls.toFixed(4));
  await ctx.close();
}

section('In China: QQ Mail, bills from QQ Mail, BOSS Zhipin, Taobao');
{
  const { ctx, page } = await open('CN', 'crew', 390);
  const r = await five(page);
  ok(/QQ Mail/.test(r.titles[0]), 'first: the QQ Mail inbox - not Gmail', r.titles[0]);
  ok(!r.titles.some(t => /Gmail|Chase|Amex|American Express|IRS/.test(t)), 'nothing from the United States', r.titles);
  ok(r.titles.some(t => /Bills/.test(t) && /QQ Mail/.test(t)), 'money from the bills that arrive in QQ Mail - no bank link pretended', r.titles);
  ok(r.titles.some(t => /BOSS Zhipin|51job/.test(t)) && r.titles.some(t => /Taobao|JD/.test(t)), 'and China’s job sites and shops', r.titles);
  ok(r.cls < 0.001, 'on a phone, without moving the page', +r.cls.toFixed(4));
  const bank = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#cw-jobs-body .cw-job')].slice(0, 20);
    const bankFirst20 = cards.filter(c => /Bank connection/.test((c.querySelector('.cw-job-need') || {}).textContent || '')).length;
    return { bankFirst20 };
  });
  /* Searched for, it is still there - and says why it cannot run here. */
  await page.evaluate(() => cwFind('Unusual transaction'));
  await page.waitForTimeout(300);
  bank.line = await page.evaluate(() => (document.querySelector('.cw-job-loc[data-loc="unusual_spend"]') || {}).textContent || '');
  ok(bank.bankFirst20 === 0, 'the list below does not open on jobs that need a bank China cannot link', bank.bankFirst20);
  ok(/bank linking is not available here yet/.test(bank.line), 'and a bank job says so on its card', bank.line);
  await ctx.close();
}

section('In Germany: WEB.DE first, ELSTER for tax');
{
  const { ctx, page } = await open('DE', 'crew');
  const r = await five(page);
  ok(/WEB\.DE/.test(r.titles[0]), 'first: the WEB.DE inbox', r.titles[0]);
  ok(r.titles.some(t => /ELSTER/.test(t)) && r.titles.some(t => /StepStone/.test(t)), 'ELSTER and StepStone', r.titles);
  await ctx.close();
}

section('Connect on China’s inbox card opens QQ Mail, not a Google sign-in');
{
  const { ctx, page } = await openConnectors('CN');
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
  await page.waitForFunction(() => document.querySelector('#cw-foryou [data-dact="cwConnect"][data-darg="top_cn_inbox"]'), null, { timeout: 15000 }).catch(() => {});
  const has = await page.evaluate(() => !!document.querySelector('#cw-foryou [data-dact="cwConnect"][data-darg="top_cn_inbox"]'));
  ok(has, 'the QQ Mail card has a Connect button', has);
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
