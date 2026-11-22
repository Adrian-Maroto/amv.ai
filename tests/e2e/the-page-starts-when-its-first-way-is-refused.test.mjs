/* THE PAGE STARTS FROM ITS CODE FILE, AND SAYS SO WHEN IT CANNOT (Nov 22).

   The app's code is a file of its own beside the page, named by its content
   and pinned by Subresource Integrity, so a repeat visit reuses it instead of
   compiling 1.5 MB again. That moves one failure somewhere new: the page can
   now arrive while its code does not - a dropped request, a host that has
   pruned an old build (and, rewriting every unknown path to the page, answers
   with HTML), a proxy that altered one byte. Each of those used to be a page
   that looked finished and did nothing. Here each is caused on purpose: the
   page must start under its own policy when the file arrives, and must show
   the reload notice - in the visitor's language - when it does not. */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BROWSER, LAUNCH } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const page0 = readFileSync(join(ROOT, 'index.html'), 'utf8');
const codeName = (page0.match(/<script src="\/(app\.[a-f0-9]{12}\.js)"[^>]*data-amv-app/) || [])[1];
ok(!!codeName && existsSync(join(ROOT, codeName)), 'the page names a code file that is published', codeName);

let mode = 'ok';
const srv = createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (p === '/' + codeName && mode === 'missing') {
    /* What the host does for a file it does not have: the page itself. */
    r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(page0);
  }
  if (p === '/' + codeName && mode === 'altered') {
    const b = Buffer.from(readFileSync(f)); b[b.length - 2] = b[b.length - 2] === 0x3b ? 0x20 : 0x3b;
    r.writeHead(200, { 'Content-Type': 'text/javascript' }); return r.end(b);
  }
  if (!f.startsWith(ROOT) || !existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await BROWSER.launch(LAUNCH);

async function boot(m, locale) {
  mode = m;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: locale || 'en-US', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.route(u => !String(u).startsWith(url), r => r.abort());
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', e => window.__violations.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
  });
  await page.goto(url, { waitUntil: 'load' });
  let started = false, notice = null;
  for (let i = 0; i < 60 && !started && !notice; i++) {
    started = await page.evaluate(() => typeof setTab === 'function' && typeof openAuth === 'function');
    notice = await page.evaluate(() => { const n = document.getElementById('amv-load-failed'); return n ? { text: n.textContent, lang: n.lang, button: !!n.querySelector('button'), w: n.getBoundingClientRect().width } : null; });
    if (!started && !notice) await page.waitForTimeout(100);
  }
  let reloaded = false;
  if (notice) {
    mode = 'ok';
    await page.click('#amv-load-failed button');
    for (let i = 0; i < 60 && !reloaded; i++) { await page.waitForTimeout(100); reloaded = await page.evaluate(() => typeof setTab === 'function').catch(() => false); }
  }
  const v = await page.evaluate(() => window.__violations.filter(x => /script/.test(x))).catch(() => []);
  await ctx.close();
  return { started, notice, reloaded, v };
}

section('The code file arrives: the app starts under its own policy');
{
  const r = await boot('ok');
  ok(r.started, 'the app starts');
  ok(!r.notice, 'and no failure notice is shown');
  ok(r.v.length === 0, 'with no script refused by the page’s policy', r.v);
}

section('The host answers with the page instead of the code (a pruned build)');
{
  const r = await boot('missing');
  ok(!r.started, 'the wrong bytes never run');
  ok(!!r.notice && /could not finish loading/.test(r.notice.text), 'the page says it could not finish loading', r.notice);
  ok(r.notice && r.notice.button && r.notice.w <= 390, 'with a Reload button, inside a phone screen', r.notice);
  ok(r.reloaded, 'and Reload, once the file is back, starts the app');
}

section('One byte of the code altered on the way');
{
  const r = await boot('altered');
  ok(!r.started, 'the altered code is refused by its integrity value and never runs');
  ok(!!r.notice, 'and the visitor is told, not left on a page that does nothing', r.notice);
}

section('The notice speaks the visitor’s language');
{
  const r = await boot('missing', 'es-ES');
  ok(!!r.notice && r.notice.lang === 'es' && /Volver a cargar/.test(r.notice.text) && !/could not/.test(r.notice.text),
     'a Spanish browser reads it in Spanish', r.notice);
}

await browser.close(); srv.close();
if (report('the-page-starts-when-its-first-way-is-refused') > 0) process.exitCode = 1;
done();
