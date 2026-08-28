/* THE GATE MEASURED BYTES AND SHIPPED A TWELVE-SECOND BLANK PAGE.

   There was one performance check in this product: a ceiling on the gzipped
   size of index.html. The page sat comfortably inside it the entire time it
   was taking 12,584ms to paint, because the thing making it slow - a
   render-blocking stylesheet on a third-party host - weighed nothing.

   A byte count is a proxy. This measures the thing the proxy stands for: when
   the pixels arrive, and how long the main thread is too busy to answer a tap.

   THE NUMBERS AND WHERE THEY COME FROM. Deliberately loose, because this runs
   on a shared machine alongside the rest of the gate and a flaky budget is a
   budget people delete. They are not tuned to today's measurement - they are
   set where a REGRESSION is unambiguous:

     first paint, font host dead   < 3000ms   (measures 212ms; was 12,584ms)
     total blocking, 4x CPU        < 2000ms   (measures ~554ms)

   Both are several times current, so ordinary variance cannot fail them and a
   real regression cannot pass. If either starts failing, something structural
   changed and it is worth stopping for.

   WHAT THIS DOES NOT CLAIM. The 554ms of blocking is V8 compiling the bundle,
   not the app's own boot work - profiled at 4x CPU, every boot function
   together comes to about 50ms. It cannot be fixed by deferring initialisers.
   It is fixed by shipping less JavaScript, which means splitting the bundle,
   which is the owner's call and is deferred with reasons in BUNDLE-SPLIT.md.
   So this budget is not a target to beat; it is a tripwire, so the number
   cannot drift while nobody is looking. */
import { chromium } from 'playwright';
import { LAUNCH } from '../lib/harness.mjs';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { gzipSync } from 'zlib';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FCP_MAX = 3000;
const TBT_MAX = 2000;

const gz = gzipSync(readFileSync(join(ROOT, 'index.html')));
const server = createServer((_q, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' });
  res.end(gz);
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;
const browser = await chromium.launch(LAUNCH);

section('The page paints even when every third party is unreachable');
{
  /* Not just the fonts. Anything the head reaches for is something that can be
     down, blocked, or slow, and none of it may hold up the first paint. */
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const blockedHosts = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net',
                        'cdnjs.cloudflare.com', 'challenges.cloudflare.com',
                        'www.googletagmanager.com', 'plausible.io', 'js.stripe.com'];
  for (const h of blockedHosts) await page.route(`https://${h}/**`, r => r.abort());

  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => performance.getEntriesByType('paint').length > 0, null, { timeout: 30000 });
  const m = await page.evaluate(() => {
    const p = Object.fromEntries(performance.getEntriesByType('paint').map(x => [x.name, Math.round(x.startTime)]));
    return { fcp: p['first-contentful-paint'], text: (document.body.innerText || '').trim().length };
  });
  ok(m.fcp < FCP_MAX, `first paint under ${FCP_MAX}ms with every third party dead`, m.fcp + 'ms');
  /* And it painted something real. A blank page paints instantly. */
  ok(m.text > 100, 'and there is real content on it, not an empty shell', m.text + ' chars');
  await page.close();
}

section('The main thread is free enough to answer a tap');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  const cdp = await page.context().newCDPSession(page);
  /* A mid-range phone, roughly. Measuring on the runner's own CPU would report
     zero blocking and guard nothing. */
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__long = [];
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); })
        .observe({ type: 'longtask', buffered: true });
    } catch (e) {}
  });
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3000);
  const m = await page.evaluate(() => {
    const long = window.__long || [];
    /* Total Blocking Time: everything a long task spends past the 50ms that is
       considered unavoidable. It is the standard measure of "the page is up but
       will not answer me". */
    return { tasks: long.length, worst: long.length ? Math.max(...long) : 0,
             tbt: long.reduce((a, d) => a + Math.max(0, d - 50), 0),
             observed: typeof window.__long !== 'undefined' };
  });
  ok(m.observed, 'long tasks were being watched for', m.observed);
  ok(m.tbt < TBT_MAX, `total blocking time under ${TBT_MAX}ms on a 4x slower CPU`, m.tbt + 'ms');
  await page.close();
}

section('And the head asks for nothing that can hold up rendering');
{
  /* The rule, not the measurement. The measurement above can only fail once
     something is already slow; this fails the moment a render-blocking
     third-party resource is ADDED, which is the change that caused it. */
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');

  const blockingLinks = [...head.matchAll(/<link\b[^>]*>/g)].map(m => m[0])
    .filter(t => /rel=["']?stylesheet/i.test(t))
    .filter(t => {
      const m = (t.match(/media=["']([^"']+)["']/) || [, ''])[1].toLowerCase();
      return !m || m === 'all' || m === 'screen';
    });
  ok(blockingLinks.length === 0, 'no render-blocking stylesheet in the head', blockingLinks);

  /* A synchronous external script in the head is the other way to do it. */
  const headScripts = [...head.matchAll(/<script\b[^>]*>/g)].map(m => m[0])
    .filter(t => /\bsrc=/.test(t) && !/\b(defer|async|type=["']module)/.test(t));
  ok(headScripts.length === 0, 'and no blocking external script either', headScripts);
}

await browser.close();
server.close();
if (report('the-page-arrives-fast-enough-to-use') > 0) process.exitCode = 1;
done();
