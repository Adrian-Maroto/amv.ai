/* SIGNED IN THROUGH THE SITE'S OWN ADDRESS.

   Safari deletes, after seven days, a cookie set by a server on another
   network address - so an iPhone that opened AMV once a week was signed out
   every visit. The server now also answers at the site's own address under
   `/api`, which makes its cookies first party.

   This drives a real browser through that arrangement exactly as the site's
   host would present it: one origin, the page at `/`, the server at `/api`.
   The journey is the one people take, and the cookies are read back from the
   browser itself, not inferred. */
import { createServer, request as httpRequest } from 'http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, makeOutbound, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?mount=' + Date.now())).default;

let env, files;
const front = createServer(async (req, res) => {
  if (!req.url.startsWith('/api/') && req.url !== '/api') {
    /* Everything else is the static host. */
    const p = httpRequest({ host: '127.0.0.1', port: files.address().port, path: req.url, method: req.method, headers: req.headers },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(p); return;
  }
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  let r;
  try {
    r = await worker.fetch(new Request(SITE + req.url, { method: req.method, headers,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks) }), env, { waitUntil() {}, passThroughOnException() {} });
  } catch (e) { res.writeHead(500); res.end(String(e && e.message)); return; }
  const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => front.listen(0, r));
const SITE = 'http://localhost:' + front.address().port;
files = await serveArtifact(0, SITE + '/api');

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

await page.goto(SITE, { waitUntil: 'load' }); await boot();

section('The page talks to the server at its own address');
ok(await page.evaluate(() => AMV_API.base) === SITE + '/api', 'the API base is the site plus /api', await page.evaluate(() => AMV_API.base));

section('Sign up with the emailed code');
{
  await page.evaluate(() => openAuth('signup'));
  await until(() => !!document.getElementById('a-name'));
  await fill('#a-name', 'Mount'); await fill('#a-email', 'mount@example.com'); await fill('#a-pass', 'A-real-Passw0rd!');
  await page.evaluate(() => document.getElementById('auth-submit').click());
  ok(await until(() => !!document.getElementById('cv-code')), 'the code step opens');
  await fill('#cv-code', codeIn());
  const fin = await until(() => !!(AMV_API.token && S.user && S.user.email) && !document.getElementById('cv-code'));
  ok(fin, 'and the code signs the new account in', fin || await page.evaluate(() => ({ tok: !!AMV_API.token, user: S.user, cv: !!document.getElementById('cv-code'), err: (document.querySelector('.fp-modal') || {}).textContent })));
}

section('The cookies are the site’s own, scoped to the server’s path');
{
  const jar = await context.cookies(SITE + '/api/auth/refresh');
  const rt = jar.find(c => c.name === 'amv_rt'), dev = jar.find(c => c.name === 'amv_dev');
  ok(rt && rt.path === '/api/auth' && rt.httpOnly, 'the renewal cookie is HttpOnly at /api/auth', rt);
  ok(dev && dev.path === '/api/auth', 'and so is the proof of this device', dev);
  const page_ = await context.cookies(SITE + '/');
  ok(!page_.some(c => c.name === 'amv_rt' || c.name === 'amv_dev'), 'neither is sent to the page itself');
}

section('A reload keeps you signed in, by the cookie alone');
{
  /* Nothing in storage can do it: the renewal must come from the cookie. */
  await page.evaluate(() => { try { AMV_API.refreshTok = ''; } catch (e) {} });
  await page.reload({ waitUntil: 'load' }); await boot();
  ok(await until(signedIn, 15000), 'still signed in after a reload');
  ok(!(await page.evaluate(() => !!document.getElementById('auth-bg'))), 'and nothing asks to sign in again');
}

section('Sign out and back in: this browser is known, so no code');
{
  await page.evaluate(() => signOut());
  await until(() => !(S.user && S.user.email));
  const before = mails.length;
  await page.evaluate(() => openAuth('login'));
  await until(() => !!document.getElementById('a-email'));
  await fill('#a-email', 'mount@example.com'); await fill('#a-pass', 'A-real-Passw0rd!');
  await page.evaluate(() => document.getElementById('auth-submit').click());
  await until(() => !!document.getElementById('cv-code') || !!(AMV_API.token && S.user && S.user.email));
  ok(await page.evaluate(signedIn) && !(await page.evaluate(() => !!document.getElementById('cv-code'))), 'signed straight back in', mails.length - before);
  ok(mails.length === before, 'and no code was emailed');
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await browser.close(); front.close(); files.close(); outbound.restore();
if (report('signed-in-through-the-sites-own-address') > 0) process.exitCode = 1;
done();
