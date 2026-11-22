/* THE PAGE STARTS WHEN ITS FIRST WAY IS REFUSED (Nov 22).

   The app's code ships inert in the page and is started as a Blob script, so
   it never holds up the first paint. Where a browser or an extension refuses
   Blob scripts, the launcher runs it inline instead - and the page's policy
   allows that inline script only by the hash of the exact bundle. Nothing
   tested that path: cutting the launcher's framing (so the hash could never
   match) passed every suite. Here the Blob is refused and the page must still
   start, under its own policy, with no violation reported. */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BROWSER, LAUNCH } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await BROWSER.launch(LAUNCH);

async function boot(refuseBlob) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route(u => !String(u).startsWith(url), r => r.abort());
  await page.addInitScript((refuse) => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', e => window.__violations.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
    if (refuse) {
      const real = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (b) => { if (b && /javascript/.test(b.type || '')) throw new Error('blob scripts refused here'); return real(b); };
    }
  }, refuseBlob);
  await page.goto(url, { waitUntil: 'load' });
  let started = false;
  for (let i = 0; i < 100 && !started; i++) { started = await page.evaluate(() => typeof setTab === 'function' && typeof openAuth === 'function'); if (!started) await page.waitForTimeout(100); }
  const v = await page.evaluate(() => window.__violations.filter(x => /script/.test(x)));
  await ctx.close();
  return { started, v };
}

section('The usual way: started as a Blob script');
{
  const r = await boot(false);
  ok(r.started, 'the app starts');
  ok(r.v.length === 0, 'with no script refused by the page’s policy', r.v);
}

section('Blob scripts refused: started inline, allowed by the bundle’s hash');
{
  const r = await boot(true);
  ok(r.started, 'the app still starts');
  ok(r.v.length === 0, 'and the policy refused nothing - the inline copy is exactly the bundle it pins', r.v);
}

await browser.close(); srv.close();
if (report('the-page-starts-when-its-first-way-is-refused') > 0) process.exitCode = 1;
done();
