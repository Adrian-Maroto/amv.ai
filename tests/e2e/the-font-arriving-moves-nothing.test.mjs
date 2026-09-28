/* THE FONT ARRIVING MOVES NOTHING.

   The page is drawn at once in a fallback and the real fonts (Inter, Space
   Grotesk) swap in when they arrive. Every suite here ran with the font host
   unreachable, so the swap never happened in a test - and GitHub's runners,
   which CAN reach it, measured the Crew heading moving on every phone load.
   Three causes, all found by replaying the fonts late:

     · the metric-matched fallback named only Arial, Helvetica Neue and Roboto,
       none of which a Linux machine or a Chromebook has, so it failed and the
       page was drawn in a much wider font;
     · it was the REGULAR face used for every weight, so bold headings were six
       per cent too narrow and re-wrapped;
     · the h1/h2 rule named Space Grotesk without its fallback at all.

   So this replays the real font files, from fixtures, arriving 900ms late, and
   measures layout shift on the screens people open first, phone and desktop.
   Those three are fixed, and the page now also asks for display=optional, so
   a font that arrives late is not swapped in at all - see the last section. */
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FONTS = join(ROOT, 'tests', 'fixtures', 'fonts');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?fonts=' + Date.now())).default;
const env = makeEnv({});
const api = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, String(v));
  const r0 = new Request('http://localhost:' + api.address().port + req.url, { method: req.method, headers,
    body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks) });
  Object.defineProperty(r0, 'cf', { value: { country: 'ES' } });
  const r = await worker.fetch(r0, env, { waitUntil() {}, passThroughOnException() {} });
  const o = {}; r.headers.forEach((v, k) => { o[k] = v; }); res.writeHead(r.status, o); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => api.listen(0, r));
const site = await serveArtifact(0, 'http://localhost:' + api.address().port);
const SITE = 'http://localhost:' + site.address().port;
const browser = await chromium.launch(LAUNCH);
const errors = [];
const displays = new Set();

async function measure(hash, width) {
  const phone = width === 390;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, locale: 'en-US', hasTouch: phone, isMobile: phone });
  let served = 0;
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const u = route.request().url();
    await new Promise(r => setTimeout(r, 900));
    /* Served the way Google serves it: font-display is whatever the page's own
       URL asked for, so this measures the page's choice, not the fixture's. */
    const display = (/[?&]display=([a-z]+)/.exec(u) || [])[1] || 'auto';
    if (/googleapis/.test(u)) displays.add(display);
    if (/googleapis/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css',
      body: readFileSync(join(FONTS, 'fonts.css'), 'utf8').replace(/font-display:\s*[a-z]+;/g, 'font-display: ' + display + ';') });
    const m = /amv-fixture\/([A-Za-z]+\.woff2)$/.exec(u);
    if (!m) return route.fulfill({ status: 404, body: '' });
    served++;
    return route.fulfill({ status: 200, contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(join(FONTS, m[1])) });
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {}
    window.__cls = 0; window.__src = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__cls += e.value;
      window.__src.push((e.sources || []).map(x => { const n = x.node; const el = n && (n.nodeType === 3 ? n.parentElement : n);
        return (el && (el.id || el.className || el.tagName)) + ':' + (n && (n.textContent || '').trim().slice(0, 24)); }).join(' | ')); } })
      .observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(SITE + '/#/' + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.fonts].some(f => f.family === 'Space Grotesk' && f.status === 'loaded')
                                 && [...document.fonts].some(f => f.family === 'Inter' && f.status === 'loaded'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({ cls: window.__cls, src: window.__src.slice(0, 3),
    fonts: [...document.fonts].filter(f => f.status === 'loaded' && /Inter|Space Grotesk/.test(f.family)).length }));
  await ctx.close();
  return Object.assign(r, { served });
}

for (const [label, width] of [['phone', 390], ['desktop', 1280]]) {
  section('The fonts arrive late, on a ' + label);
  for (const hash of ['crew', 'chat', 'settings']) {
    const r = await measure(hash, width);
    ok(r.served > 0 && r.fonts >= 2, hash + ': the real fonts really arrived', r);
    ok(r.cls < 0.001, hash + ': and nothing on the page moved when they did', { cls: +r.cls.toFixed(5), src: r.src });
  }
}

section('The page asks for fonts that never swap in late');
{
  /* display=optional: the real font is used if it is there at once (every
     visit after the first, from cache) and otherwise the page keeps the
     metric-matched fallback for good. "swap" re-lays the text whenever the
     font lands - measured moving the Crew heading on GitHub's runners even
     with the fallback tuned, because two machines never draw fonts exactly
     alike. No swap is the only version that holds everywhere. */
  ok(displays.size === 1 && displays.has('optional'), 'the page asks for display=optional', [...displays]);
}

section('The fallback is ready on a machine with no Arial');
{
  /* Linux and ChromeOS have Arial's metric twins, not Arial. The fallback has
     to name them or it fails, and a failed fallback is the wide default font. */
  const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
  const faces = css.match(/@font-face\{[^}]*font-family:'(?:Inter|Space Grotesk) fallback'[^}]*\}/g) || [];
  ok(faces.length >= 4, 'a regular and a bold fallback face for each font', faces.length);
  ok(faces.every(f => /Liberation Sans/.test(f) && /Arimo/.test(f)), 'and every one names Arial’s Linux twins', faces.map(f => f.slice(0, 80)));
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await browser.close(); site.close(); api.close();
report();
done();
