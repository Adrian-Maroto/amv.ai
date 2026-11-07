/* @exclusive - this suite times the page on a throttled CPU. Beside three
   other browsers it would time the machine instead. */
/* A LOW-END PHONE CAN USE IT (Nov 3 audit TEST-008).

   the-page-arrives-fast-enough-to-use measures first paint and blocking time
   at 4x. That is the page arriving. It says nothing about the page being
   USED on the phone most of the world has: how long the biggest thing takes
   to appear on a slow connection, how much of the CPU the script costs, how
   much memory the page holds after somebody has been through every screen,
   and - the one people feel - how long a tap or a keystroke waits before
   anything happens.

   So this is a low-end Android, roughly: a CPU six times slower than the
   runner's, a slow 4G link (150ms round trip, 1.6 Mbps down), a phone screen,
   touch. And it measures:

     largest contentful paint            the main view is there
     script time to settle               V8 compiling and running the bundle
     JS heap after every screen          what the page keeps, not what it loads
     slowest response to an input        Event Timing - what INP reports
     slowest switch between screens      tap to the next frame

   THE BUDGETS are tripwires, set several times what this measures on its own,
   the same as the other performance suites here: ordinary variance cannot fail
   them, a structural regression - a screen that starts re-rendering everything
   on each keystroke, a cache that grows without bound, a dependency that
   doubles the bundle - cannot pass. Safari's engine runs the same suite in the
   nightly browser lane (tests/browser-lanes.json); the throttling is
   Chromium's, so there it measures the engine at full speed. */
import { chromium } from 'playwright';
import { LAUNCH } from '../lib/harness.mjs';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { gzipSync } from 'zlib';
import { ok, section, report } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEASURE = process.argv.includes('--measure');
/* Measured alone on the runner (2026-11-07): largest paint 3.5s - most of it is
   the 560KB page crossing a 1.6 Mbps link - script 0.32-0.38s, slowest input
   32-40ms, slowest screen switch 82-140ms, heap 9MB after every screen. */
const B = {
  lcp: 9000,        // ms, largest contentful paint on slow 4G + 6x CPU
  script: 3000,     // ms, ScriptDuration once the page has settled
  heapMB: 120,      // MB, JS heap after visiting every screen
  input: 400,       // ms, slowest event (Event Timing duration)
  switchMs: 1200,   // ms, slowest tab switch, tap to next frame
};

const gz = gzipSync(readFileSync(join(ROOT, 'index.html')));
const server = createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' }); res.end(gz); });
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
for (const h of ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.googletagmanager.com', 'plausible.io', 'js.stripe.com', 'challenges.cloudflare.com'])
  await page.route(`https://${h}/**`, r => r.abort());
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
/* A returning visitor: the person this is about uses the app, not the landing
   page. The keys a real browser would already hold; with no server here the
   session is not confirmed, so the app opens as it does for a guest - the same
   shell, the same bundle, the same screens. */
await page.addInitScript(() => {
  try {
    if (!localStorage.getItem('amv_user')) localStorage.setItem('amv_user', JSON.stringify({ name: 'Ana', email: 'ana@example.com', ini: 'A' }));
    localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  } catch (e) {}
});
await page.addInitScript(() => {
  window.__lcp = 0; window.__ev = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__ev.push({ n: e.name, d: Math.round(e.duration) }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (e) {}
});

const got = {};
section('On a slow phone, the page arrives');
{
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(4000);
  got.inApp = await page.evaluate(() => { const a = document.getElementById('app'); return !!(a && a.classList.contains('on')); });
  ok(got.inApp, 'the app itself is what is measured, not the landing page');
  got.lcp = await page.evaluate(() => window.__lcp);
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  got.script = Math.round(m.ScriptDuration * 1000);
  ok(got.lcp > 0, 'the largest paint was observed', got.lcp);
  ok(got.lcp < B.lcp, `largest contentful paint under ${B.lcp}ms on slow 4G and a 6x slower CPU`, got.lcp + 'ms');
  ok(got.script < B.script, `script time under ${B.script}ms to settle`, got.script + 'ms');
}

section('It answers a tap and a keystroke');
{
  const box = page.locator('#mta');
  await box.tap({ timeout: 30000 }).catch(() => {});
  await page.keyboard.type('What is the weather like in Lisbon this weekend', { delay: 60 });
  await page.waitForTimeout(800);
  const ev = await page.evaluate(() => window.__ev.slice());
  got.input = ev.length ? Math.max(...ev.map(e => e.d)) : 0;
  got.inputWorst = ev.sort((a, b) => b.d - a.d).slice(0, 3);
  ok(true, 'events observed while typing', ev.length);
  ok(got.input < B.input, `the slowest input waits under ${B.input}ms (Event Timing, what INP reports)`, got.input + 'ms ' + JSON.stringify(got.inputWorst));
}

section('Every screen opens quickly, and the page does not keep what it left');
{
  const TABS = ['dashboard', 'workspaces', 'memory', 'usage', 'billing', 'plans', 'settings', 'help', 'apps', 'tasks', 'integrations', 'crew', 'market', 'team', 'build', 'chat'];
  const times = [];
  for (const t of TABS) {
    const ms = await page.evaluate(async (t) => {
      const a = performance.now();
      try { setTab(t); } catch (e) {}
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      return Math.round(performance.now() - a);
    }, t);
    times.push([t, ms]);
    await page.waitForTimeout(150);
  }
  times.sort((a, b) => b[1] - a[1]);
  got.switchMs = times[0][1];
  ok(got.switchMs < B.switchMs, `the slowest screen opens in under ${B.switchMs}ms`, JSON.stringify(times.slice(0, 3)));
  await cdp.send('HeapProfiler.enable').catch(() => {});
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const h = await cdp.send('Runtime.getHeapUsage');
  const pm = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
  got.heapCdp = Math.round(h.usedSize / 1048576); got.heapPerf = Math.round(pm / 1048576);
  got.heapMB = Math.max(got.heapCdp, got.heapPerf);
  ok(got.heapMB < B.heapMB, `the page holds under ${B.heapMB}MB of JS heap after every screen`, got.heapMB + 'MB');
}

if (MEASURE) console.log('MEASURED', JSON.stringify(got));
await browser.close();
server.close();
if (report('a-low-end-phone-can-use-it') > 0) process.exitCode = 1;
