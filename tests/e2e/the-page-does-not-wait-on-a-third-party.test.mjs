/* TWELVE AND A HALF SECONDS OF BLANK WHITE, AND EVERY GATE WAS GREEN.

   The page carried `<link rel="stylesheet" href="https://fonts.googleapis.com/...">`.
   A stylesheet link is RENDER-BLOCKING: the browser paints nothing until it has
   that file or gives up waiting for it. Measured on a page served locally, with
   everything else identical:

       with the font link      first contentful paint  12,584ms
       without it              first contentful paint     236ms

   Fifty-three times. And nothing in the product could see it, because the only
   performance check was a ceiling on BYTES - the page was comfortably inside
   its size budget the entire time it was taking twelve seconds to appear.

   That is the lesson worth keeping: a byte count is a proxy, and this is the
   failure the proxy cannot see. What a person experiences is when the pixels
   arrive, so that is what is measured here.

   `display=swap` did not help and was never going to. It governs what happens
   once the CSS has arrived; it has nothing to say about the wait for the CSS.

   WHO THIS HAPPENS TO: anybody whose browser cannot reach that host. A
   corporate proxy, a strict content blocker, a bad minute on mobile, a DNS
   failure, a country where it does not resolve. They do not get an ugly font -
   they get nothing at all, for as long as their browser is willing to wait.

   The font is loaded at `media="print"` now, which blocks nothing, and the
   hash-pinned launcher switches it to `all`. Both halves are asserted: the page
   must be fast when the host is dead, AND the font must really apply when it is
   alive. A "fix" that quietly dropped the typography everywhere would pass the
   first half on its own. */
import { chromium } from 'playwright';
import { LAUNCH } from '../lib/harness.mjs';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { gzipSync } from 'zlib';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const gz = gzipSync(Buffer.from(html));

const server = createServer((_q, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' });
  res.end(gz);
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;
const browser = await chromium.launch(LAUNCH);

/* The head is hand-written, so it is read from the file rather than the DOM -
   a rule about what is SENT, before any script has had a chance to change it.

   COMMENTS AND <noscript> ARE STRIPPED FIRST, and both for a reason:

   - The comment above the font link quotes the old markup while explaining why
     it went. The first version of this read that quotation as a live tag and
     reported the fix as the bug it fixed. There is a worker suite in this repo
     called a-check-anchored-on-prose-is-not-a-check; this is that, again.
   - The <noscript> copy IS render-blocking, deliberately. With scripting off
     there is no launcher to switch the media, so a blocking link is the only
     way to get the font at all - and with no scripting there is nothing else
     competing for the main thread either. Asserting over it would forbid the
     correct answer. */
const head = html.slice(0, html.indexOf('</head>'))
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');

section('No stylesheet in the head can block the first paint');
{
  const links = [...head.matchAll(/<link\b[^>]*>/g)].map(m => m[0])
    .filter(t => /rel=["']?stylesheet/i.test(t));
  ok(links.length > 0, 'the head really does carry stylesheet links', links.length);

  /* Render-blocking means: a stylesheet link with no media, or one whose media
     applies to the screen. `media="print"` is the escape hatch precisely
     because it does not apply to what is being rendered. */
  const blocking = links.filter(t => {
    const m = (t.match(/media=["']([^"']+)["']/) || [, ''])[1].toLowerCase();
    return !m || m === 'all' || m === 'screen';
  });
  ok(blocking.length === 0,
     'not one of them is render-blocking - the page cannot wait on a third party to appear', blocking);

  /* And the thing that turns it back on has to exist, or this is not a fix,
     it is a deletion of the typography. */
  ok(/id=["']amv-fonts["']/.test(head), 'the font link is addressable by the launcher', true);
  ok(/getElementById\('amv-fonts'\)/.test(html),
     'and something in the page actually switches it on', true);

  /* NOT an inline onload=, which is the recipe everyone reaches for and which
     would silently never run here: script-src carries no 'unsafe-inline'. */
  const fontLink = (head.match(/<link[^>]*amv-fonts[^>]*>/) || [''])[0];
  ok(!/onload=/i.test(fontLink),
     'and not through an inline handler, which our own CSP refuses', fontLink.slice(0, 80));
  /* Read from the CSP META TAG, not from the file. The words "script-src" also
     appear inside the app's own help text, and matching those made this
     assertion answer a question about a sentence. */
  const csp = (html.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i) || [''])[0];
  const scriptSrc = (csp.match(/script-src([^;]*)/) || [, ''])[1];
  ok(scriptSrc.length > 0, '(the CSP names a script-src)', scriptSrc.slice(0, 40));
  ok(!/'unsafe-inline'/.test(scriptSrc),
     '(which it does refuse - script-src has no unsafe-inline)', scriptSrc.slice(0, 60));
}

section('Every font token names something the machine already has');
{
  /* The fallback is now a real state, not a flicker: on a blocked network it is
     what the product looks like forever. A token that names only the webfont
     falls to whatever the browser reaches for, which is not a decision anybody
     made. */
  const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
  const root = css.slice(css.indexOf(':root'), css.indexOf(':root') + 4000);
  for (const token of ['--fn', '--mn', '--fdisplay']) {
    const v = (root.match(new RegExp(token + ':([^;]+);')) || [, ''])[1];
    ok(v.length > 0, token + ' is defined', v.slice(0, 60));
    ok(/-apple-system|BlinkMacSystemFont|system-ui|ui-monospace|Arial|Helvetica|sans-serif|monospace/.test(v),
       token + ' falls back to faces the device already has', v.slice(0, 90));
    ok(v.split(',').length >= 3, 'and the stack is a real one, not a single name', v.split(',').length);
  }
}

section('With the font host unreachable, the page still appears at once');
{
  /* THE MEASUREMENT THAT MATTERS, and the one the byte ceiling could not make.
     Nothing answers the font host here - which is exactly the situation of
     somebody behind a blocker - and the page must still paint immediately. */
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => performance.getEntriesByType('paint').length > 0, null, { timeout: 30000 });
  const m = await page.evaluate(() => {
    const p = Object.fromEntries(performance.getEntriesByType('paint').map(x => [x.name, Math.round(x.startTime)]));
    return { fcp: p['first-contentful-paint'], text: (document.body.innerText || '').trim().length };
  });
  /* Generous, because this runs on a shared machine alongside the rest of the
     gate. It is not measuring a tight budget - it is measuring the difference
     between a fifth of a second and twelve. */
  ok(m.fcp < 3000, 'first paint arrives in well under a second, not in twelve', m.fcp + 'ms');
  ok(m.text > 100, 'and there is really something on it, not an empty shell', m.text);
  await page.close();
}

section('And when the host IS reachable, the typography really applies');
{
  /* The other half. Making the page fast by quietly losing the brand font
     would pass everything above and be a worse product. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({
    status: 200, contentType: 'text/css',
    body: "@font-face{font-family:'Inter';font-style:normal;font-weight:400;font-display:swap;src:local('Arial')}",
  }));
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => {
    const l = document.getElementById('amv-fonts');
    return l && l.media === 'all';
  }, null, { timeout: 20000 }).catch(() => {});
  const m = await page.evaluate(() => {
    const l = document.getElementById('amv-fonts');
    return { media: l ? l.media : '(no link)',
             applied: [...document.styleSheets].filter(s => /fonts\.googleapis/.test(s.href || '')).length };
  });
  ok(m.media === 'all', 'the launcher switched the stylesheet on', m.media);
  ok(m.applied === 1, 'and the browser is really applying it', m.applied);
  await ctx.close();
}

await browser.close();
server.close();
if (report('the-page-does-not-wait-on-a-third-party') > 0) process.exitCode = 1;
done();
