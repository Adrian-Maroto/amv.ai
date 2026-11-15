/* A VISITOR IN SPAIN SEES SPAIN, WHATEVER LANGUAGE THEIR BROWSER SPEAKS.

   The owner's example: "I'm in the US... the top 5 are US based. Let's say I'm
   in Spain - the top 5 should be Spain focused." Crew used to read the country
   from the browser's language, so an English (US) browser in Madrid got the
   United States. Measured end to end with the real Worker behind a real
   server, told the request comes from Spain, and a browser set to en-US. */
import { createServer } from 'http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?spain=' + Date.now())).default;
const env = makeEnv({});
let FROM = 'ES';
const api = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
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
const visit = async (from, width = 1280) => {
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
  await page.goto(SITE + '/#/crew', { waitUntil: 'load' });
  /* Nov 15: Crew is one list for the country, led by the country's own jobs -
     the ones written for it, the most used there first. */
  await page.waitForFunction(() => { const h = (document.getElementById('cx-jobs-h') || {}).textContent || '';
    return /Jobs for (?!you)/.test(h) && document.querySelectorAll('#cj-grid .cj-card').length >= 5; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#cj-grid .cj-card-t')].map(e => e.textContent.trim());
    return {
      lang: navigator.language,
      head: ((document.getElementById('cx-jobs-h') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      titles: t.slice(0, 5),
      made: t.slice(0, 24),
      dropdown: !!document.getElementById('cw-country'),
      more: !!document.querySelector('[data-dact="cjDirectory"]') && !!document.querySelector('[data-dact="cjCountry"]'),
      cls: window.__cls, src: window.__src.slice(0, 4),
    };
  });
  await ctx.close();
  return r;
};

section('From Spain, with an English (US) browser');
{
  const r = await visit('ES');
  ok(r.lang === 'en-US', 'the browser really says United States', r.lang);
  ok(/Spain/.test(r.head), 'the list is for Spain', r.head);
  ok(r.titles.length === 5 && r.titles.some(t => /InfoJobs/.test(t)) && r.titles.some(t => /Gmail/.test(t)),
     'and the first five are Spain’s - Gmail, InfoJobs', r.titles);
  ok(r.made.some(t => /AEAT/.test(t)), 'with the AEAT among the first on the page', r.made.slice(0, 8));
  ok(r.titles.concat(r.made).some(t => /Renta/.test(t)) && r.made.some(t => /DNI|NIE/.test(t)), 'with the Renta and the DNI among the first on the page', r.made.slice(0, 6));
  ok(!r.dropdown, 'with no country dropdown', r.dropdown);
  ok(r.more, 'with the country switch and every other country’s jobs one press away', r.more);
  ok(r.cls < 0.001, 'and the list arrives without moving the page', { cls: +r.cls.toFixed(4), src: r.src });
}

section('From Spain, on a phone');
{
  const r = await visit('ES', 390);
  ok(/Spain/.test(r.head) && r.titles.length === 5, 'Spain’s list on a phone too', r.head);
  ok(r.cls < 0.001, 'and nothing moves there either', { cls: +r.cls.toFixed(4), src: r.src });
}

section('From the United States');
{
  const r = await visit('US');
  ok(/United States/.test(r.head), 'the list is for the United States', r.head);
  ok(!r.titles.concat(r.made).some(t => /Renta|DNI|InfoJobs|AEAT/.test(t)), 'with none of Spain’s', r.titles);
  ok(r.titles.some(t => /Gmail/.test(t)) && r.titles.some(t => /Chase|American Express/.test(t)) && r.made.some(t => /IRS/.test(t)),
     'but the United States’ own - Gmail, the Chase and Amex accounts, and the IRS under them', [r.titles, r.made.slice(0, 6)]);
}

section('When the network does not say, the browser’s guess still stands');
{
  const r = await visit('XX');
  ok(/United States/.test(r.head), 'an unknown country falls back to the language guess, not to nothing', r.head);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await browser.close(); site.close(); api.close();
report();
done();
