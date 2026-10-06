/* A DAY OF SIGNING IN - THE WHOLE JOURNEY, AGAINST A REAL SERVER ON ITS OWN HOST.

   Each piece of sign-in has its own suite: the code (a-code-is-the-other-half-
   of-the-key), renewal (a-renewal-is-not-a-theft), device trust, the ended
   session. Those prove the parts. The owner meets them in sequence, in one
   browser, across reloads - and two of the faults they reported lived only in
   the joins ("asked for a code on a device that isn't new", "every refresh logs
   me out"). So this walks the day as they do:

     sign up with the emailed code -> reload -> sign out -> sign back in
     (trusted: no code) -> sign out everywhere -> sign in (a code, saying why)

   The Worker runs behind a real HTTP server on a second origin, so cookies,
   credentials and CORS are the browser's own rules, not a test's. */
import { createServer } from 'http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, makeOutbound, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?day=' + Date.now())).default;

const apiServer = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = 'http://localhost:' + apiServer.address().port + req.url;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  let r;
  try {
    r = await worker.fetch(new Request(url, { method: req.method, headers,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : body }), env, { waitUntil() {}, passThroughOnException() {} });
  } catch (e) { res.writeHead(500); res.end(String(e && e.message)); return; }
  const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
  const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => apiServer.listen(0, r));
const API = 'http://localhost:' + apiServer.address().port;
const site = await serveArtifact(0, API);
const SITE = 'http://localhost:' + site.address().port;

/* The email provider: every message kept, so the code is read the way a
   person reads it - out of the mail that went to the address. */
const mails = [];
const outbound = makeOutbound();
outbound.on(/resend/, (u, o) => { mails.push(JSON.parse(o.body)); return { id: 'e' + mails.length }; });
outbound.on(/./, () => ({ ok: true }));
const env = makeEnv({ APP_URL: SITE, ALLOWED_ORIGIN: SITE, EMAIL_API_KEY: 'k', RESET_EMAIL_FROM: 'AMV <hello@amv.test>' });
const codeIn = () => (/(\d{6})/.exec((mails.at(-1) || {}).subject || '') || [])[1];

const browser = await chromium.launch(LAUNCH);
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const until = async (fn, ms = 20000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await page.evaluate(fn).catch(() => false)) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const boot = async () => {
  await until(() => typeof S !== 'undefined' && !!window.AMV_API && !!window._BUNDLE_READY, 30000);
  await page.evaluate(() => { try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {} document.getElementById('cookie-consent-banner')?.remove(); });
};
const fill = (sel, v) => page.evaluate(([s, v]) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]);
const signIn = async () => {
  await page.evaluate(() => openAuth('login'));
  await until(() => !!document.getElementById('a-email'));
  await fill('#a-email', 'day@example.com'); await fill('#a-pass', 'A-real-Passw0rd!');
  await page.evaluate(() => document.getElementById('auth-submit').click());
  await until(() => !!document.getElementById('cv-code') || !!(window.AMV_API && AMV_API.token && S.user && S.user.email));
  return page.evaluate(() => ({ asked: !!document.getElementById('cv-code'),
    why: ((document.querySelector('.fp-modal .fp-sub') || {}).textContent || '') }));
};
const enterCode = async () => {
  await fill('#cv-code', codeIn());
  return until(() => !!(AMV_API.token && S.user && S.user.email && !document.getElementById('cv-code')));
};

await page.goto(SITE, { waitUntil: 'load' }); await boot();

section('Sign up: the emailed code finishes it');
{
  await page.evaluate(() => openAuth('signup'));
  await until(() => !!document.getElementById('a-name'));
  await fill('#a-name', 'Day'); await fill('#a-email', 'day@example.com'); await fill('#a-pass', 'A-real-Passw0rd!');
  await page.evaluate(() => document.getElementById('auth-submit').click());
  ok(await until(() => !!document.getElementById('cv-code')), 'the code step opens');
  ok(await enterCode(), 'and the code from the email signs the new account in');
}

section('A reload keeps you signed in');
{
  await page.reload({ waitUntil: 'load' }); await boot();
  ok(await until(() => !!(AMV_API.token && S.user && S.user.email), 15000), 'still signed in after a reload');
  ok(!(await page.evaluate(() => !!document.getElementById('auth-bg'))), 'and nothing asks to sign in again');
}

section('Sign out, then back in on the same browser: no code');
{
  await page.evaluate(() => signOut());
  await until(() => !(S.user && S.user.email));
  const before = mails.length;
  const r = await signIn();
  ok(!r.asked, 'this browser confirmed itself earlier, so it is not asked again', r);
  ok(mails.length === before, 'and no code was emailed', mails.length - before);
}

section('After "sign out everywhere", a code - and the reason, not "new device"');
{
  await page.waitForTimeout(1100);   // the revocation epoch is per second
  const out = await page.evaluate(async () => { try { return await AMV_API.logout(true); } catch (e) { return String(e); } });
  ok(out === true, 'every session on the account is ended', out);
  await page.evaluate(() => signOut());
  await until(() => !(S.user && S.user.email));
  const r = await signIn();
  ok(r.asked && /signed out on every device/i.test(r.why), 'the code is asked for, and the screen says why', r.why);
  ok(!/new to your account/i.test(r.why), 'never "this device is new" on a device that is not', r.why);
  ok(await enterCode(), 'and the code signs back in');
}

section('Trusted again: the next sign-in on this browser needs no code');
{
  await page.evaluate(() => signOut());
  await until(() => !(S.user && S.user.email));
  const r = await signIn();
  ok(!r.asked, 'confirmed once more, so not asked again', r);
}

section('A browser that dropped its cookies is still recognised');
{
  /* Safari expires cookies set by a server on another address after seven
     days; this is that, all at once. The page keeps its own copy of the proof,
     so the device is still itself. */
  await page.evaluate(() => signOut());
  await until(() => !(S.user && S.user.email));
  await context.clearCookies();
  const r = await signIn();
  ok(!r.asked, 'no code: the page\u2019s own copy proves the device', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await browser.close(); site.close(); apiServer.close(); outbound.restore();
if (report('a-day-of-signing-in') > 0) process.exitCode = 1;
done();
