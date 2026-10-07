/* MOVING THE SERVER SIGNS NOBODY OUT.

   The server moved from its own host (api.amv.homes) to the site's own address
   (amv.homes/api), so Safari stops expiring its cookies weekly. Every person
   already signed in holds a renewal cookie that belongs to the OLD host, which
   the new address cannot read - so without a carry-over, the move would sign
   everyone out at once.

   This plays it out in a real browser: sign in while the page talks to the old
   host, switch the page to the new address, reload - and the person must still
   be signed in, with a first-party cookie, without typing anything. Then the
   guard: a page whose tokens name a host that is NOT under the site's own name
   never sends anything there. */
import { createServer, request as httpRequest } from 'http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, makeOutbound, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?move=' + Date.now())).default;

let env, files, SITE, OLD, apiBase;
const oldHits = [];
const toWorker = async (origin, req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  let r;
  try {
    r = await worker.fetch(new Request(origin + req.url, { method: req.method, headers,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks) }), env, { waitUntil() {}, passThroughOnException() {} });
  } catch (e) { res.writeHead(500); res.end(String(e && e.message)); return; }
  const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
};

/* The server on its old, separate host. */
const old = createServer((req, res) => { oldHits.push(req.method + ' ' + req.url); return toWorker(OLD, req, res); });
await new Promise(r => old.listen(0, r));
OLD = 'http://api.localhost:' + old.address().port;

/* The site, with the server mounted under /api - the way Cloudflare presents it. */
const front = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return toWorker(SITE, req, res);
  const p = httpRequest({ host: '127.0.0.1', port: files.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => {
    if (!/text\/html/.test(r.headers['content-type'] || '')) { res.writeHead(r.statusCode, r.headers); r.pipe(res); return; }
    const bufs = []; r.on('data', b => bufs.push(b)); r.on('end', () => {
      /* The page as the build ships it, pointed at whichever address is current,
         with the old host still permitted - as production keeps it. */
      const html = Buffer.concat(bufs).toString()
        .replace(/<meta name="amv-api-base" content="[^"]*">/, `<meta name="amv-api-base" content="${apiBase}">`)
        .replace("connect-src 'self'", "connect-src 'self' " + OLD);
      const h = { ...r.headers }; delete h['content-length'];
      res.writeHead(r.statusCode, h); res.end(html);
    });
  });
  p.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(p);
});
await new Promise(r => front.listen(0, r));
SITE = 'http://localhost:' + front.address().port;
files = await serveArtifact(0, '');

const mails = [];
const outbound = makeOutbound();
outbound.on(/resend/, (u, o) => { mails.push(JSON.parse(o.body)); return { id: 'e' + mails.length }; });
outbound.on(/./, () => ({ ok: true }));
env = makeEnv({ APP_URL: SITE, ALLOWED_ORIGIN: SITE, EMAIL_API_KEY: 'k', RESET_EMAIL_FROM: 'AMV <hello@amv.test>' });
const codeIn = () => (/(\d{6})/.exec((mails.at(-1) || {}).subject || '') || [])[1];

const browser = await chromium.launch(LAUNCH);
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const until = async (fn, ms = 20000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await page.evaluate(fn).catch(() => false)) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const boot = async () => {
  await until(() => typeof S !== 'undefined' && !!window.AMV_API && !!window._BUNDLE_READY, 30000);
  await page.evaluate(() => { try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {} document.getElementById('cookie-consent-banner')?.remove(); });
};
const fill = (sel, v) => page.evaluate(([s, v]) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]);
const signedIn = () => !!(AMV_API.token && S.user && S.user.email);

section('Signed in while the page talks to the old host');
apiBase = OLD;
await page.goto(SITE, { waitUntil: 'load' }); await boot();
{
  ok(await page.evaluate(() => AMV_API.base) === OLD, 'the page is on the old address', await page.evaluate(() => AMV_API.base));
  await page.evaluate(() => openAuth('signup'));
  await until(() => !!document.getElementById('a-name'));
  await fill('#a-name', 'Moved'); await fill('#a-email', 'moved@example.com'); await fill('#a-pass', 'A-real-Passw0rd!');
  await page.evaluate(() => document.getElementById('auth-submit').click());
  ok(await until(() => !!document.getElementById('cv-code')), 'the code step opens');
  await fill('#cv-code', codeIn());
  ok(await until(() => !!(AMV_API.token && S.user && S.user.email) && !document.getElementById('cv-code')), 'and the account is signed in');
  const jar = await context.cookies(OLD + '/auth/refresh');
  ok(jar.some(c => c.name === 'amv_rt'), 'the renewal cookie belongs to the old host', jar.map(c => c.name + '@' + c.domain));
}

section('The page moves to the site’s own address: still signed in');
{
  apiBase = SITE + '/api';
  const before = mails.length;
  await page.reload({ waitUntil: 'load' }); await boot();
  ok(await page.evaluate(() => AMV_API.base) === SITE + '/api', 'the page now talks to /api on its own address');
  const moved = await until(signedIn, 15000);
  ok(moved, 'still signed in after the move, without typing anything', moved || { hits: oldHits.slice(-6), bound: await page.evaluate(() => ({ from: loadStr('amv_api_token_origin'), to: _originOf(AMV_API.base), loc: location.origin, user: S.user, keys: Object.keys(localStorage).filter(k => /token_origin/.test(k)) })), ck: await page.evaluate(() => localStorage.getItem('amv_refresh_cookie')) });
  ok(!(await page.evaluate(() => !!document.getElementById('auth-bg') || !!document.getElementById('cv-code'))), 'and nothing asked to sign in or for a code');
  ok(mails.length === before, 'no code was emailed');
  const mine = await context.cookies(SITE + '/api/auth/refresh');
  ok(mine.some(c => c.name === 'amv_rt' && c.path === '/api/auth'), 'a first-party renewal cookie now exists at /api/auth', mine.map(c => c.name + c.path));
  ok(await page.evaluate(() => localStorage.getItem('amv_api_token_origin')) === SITE, 'and the tokens are bound to the new address');
}

section('From then on the old host is not needed');
{
  const hits = oldHits.length;
  await page.reload({ waitUntil: 'load' }); await boot();
  ok(await until(signedIn, 15000), 'a second reload is signed in by the new cookie');
  ok(oldHits.length === hits, 'without asking the old host again', oldHits.slice(hits));
}

section('A token that names some other host is never sent there');
{
  /* Only a host under the site's own name may be asked. 127.0.0.1 is the old
     server's machine, but not a name under the site - so it must get nothing. */
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(SITE, { waitUntil: 'load' });
  await p2.evaluate((foreign) => {
    localStorage.setItem('amv_api_token_origin', foreign);
    localStorage.setItem('amv_refresh_cookie', '1');
    localStorage.setItem('amv_user', JSON.stringify({ name: 'X', email: 'x@example.com' }));
  }, 'http://127.0.0.1:' + old.address().port);
  const hits = oldHits.length;
  await p2.reload({ waitUntil: 'load' });
  await p2.waitForFunction(() => !!window.AMV_API && !!window._BUNDLE_READY, null, { timeout: 30000 });
  /* A renewal is attempted, as any page with a session to restore would. */
  const tried = await p2.evaluate(async () => { const ok = await AMV_API._doRefresh(); return { ok, bound: localStorage.getItem('amv_api_token_origin') }; });
  ok(tried.ok === false, 'the renewal fails - there is nothing to carry', tried);
  ok(oldHits.length === hits, 'the other host received nothing', oldHits.slice(hits));
  await ctx2.close();
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await browser.close(); front.close(); old.close(); files.close(); outbound.restore();
if (report('moving-the-server-signs-nobody-out') > 0) process.exitCode = 1;
done();
