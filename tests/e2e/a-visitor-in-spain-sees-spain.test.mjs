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
  await page.waitForFunction(() => { const g = document.getElementById('cw-foryou'); return g && !g.hasAttribute('aria-busy') && g.querySelectorAll('.cw-t10:not(.cw-t10-ph)').length >= 5; }, null, { timeout: 15000 }).catch(() => {});
  const r = await page.evaluate(() => ({
    lang: navigator.language,
    head: ((document.querySelector('#cw-foryou h3') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    titles: [...document.querySelectorAll('#cw-foryou .cw-t10-t')].map(e => e.textContent.trim()),
    made: [...document.querySelectorAll('#cw-made .cw-made-t')].map(e => e.textContent.trim()),
    dropdown: !!document.getElementById('cw-country'),
    more: !!document.querySelector('#cw-morec [data-dact="cwMoreCountries"]'),
    cls: window.__cls, src: window.__src.slice(0, 4),
  }));
  await ctx.close();
  return r;
};

section('From Spain, with an English (US) browser');
{
  const r = await visit('ES');
  ok(r.lang === 'en-US', 'the browser really says United States', r.lang);
  ok(/Top 5 for you in .*Spain/.test(r.head), 'the top of Crew is for Spain', r.head);
  ok(r.titles.length === 5 && r.titles.some(t => /InfoJobs/.test(t)) && r.titles.some(t => /Gmail/.test(t)),
     'and the five are Spain’s - Gmail, InfoJobs', r.titles);
  ok(r.made.some(t => /AEAT/.test(t)), 'with the AEAT among the ones under them', r.made.slice(0, 8));
  ok(r.titles.concat(r.made).some(t => /Renta/.test(t)) && r.made.some(t => /DNI|NIE/.test(t)), 'with the Renta and the DNI in the five or the row under them', r.made.slice(0, 6));
  ok(!r.dropdown, 'with no country dropdown', r.dropdown);
  ok(r.more, 'and every other country at the bottom', r.more);
  ok(r.cls < 0.001, 'and the five arrive without moving the page', { cls: +r.cls.toFixed(4), src: r.src });
}

section('From Spain, on a phone');
{
  const r = await visit('ES', 390);
  ok(/Spain/.test(r.head) && r.titles.length === 5, 'the five for Spain on a phone too', r.head);
  ok(r.cls < 0.001, 'and nothing moves there either', { cls: +r.cls.toFixed(4), src: r.src });
}

section('From the United States');
{
  const r = await visit('US');
  ok(/Top 5 for you in .*United States/.test(r.head), 'the top of Crew is for the United States', r.head);
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
