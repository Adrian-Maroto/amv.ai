/* SIGN IN WITH A PASSKEY, AND A SECOND STEP FOR THE PASSWORD.

   The whole thing as somebody does it, in a real browser against the real
   Worker behind a real HTTP server, with Chromium's own virtual authenticator
   standing in for the phone's fingerprint reader - so navigator.credentials,
   the origin the browser signs for, and the bytes it sends are the browser's,
   not the test's:

     sign up (a 15-character password) -> Settings: add a passkey, proving it
     with the password -> sign out -> "Sign in with a passkey" -> signed in,
     no password -> turn on an authenticator app, recovery codes shown once ->
     a NEW device: the password asks for the app's code, and the code signs in.

   And the screen holds at phone width. */
import { createServer } from 'http';
import { createHmac } from 'crypto';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH, armGeom } from '../lib/harness.mjs';
import { makeEnv, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?pk=' + Date.now())).default;

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
const env = makeEnv({ APP_URL: SITE, ALLOWED_ORIGIN: SITE, CONNECT_KEY: 'k'.repeat(44) });

const EMAIL = 'nadia@example.com', PW = 'a quiet lake at dawn';
const browser = await chromium.launch(LAUNCH);
const errors = [];
async function device(viewport){
  const context = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  await armGeom(context);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  /* The phone's fingerprint reader: a platform authenticator that keeps
     passkeys and always verifies the person. */
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  await page.goto(SITE, { waitUntil: 'load' });
  return { context, page, cdp, authenticatorId };
}
const until = async (page, fn, ms = 20000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await page.evaluate(fn).catch(() => false)) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const boot = async (page) => {
  await until(page, () => typeof S !== 'undefined' && !!window.AMV_API && !!window._BUNDLE_READY, 30000);
  await page.evaluate(() => { try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {} document.getElementById('cookie-consent-banner')?.remove(); });
};
/* Each waits for its element first: on a loaded machine a prompt can arrive
   a moment after the button that opens it, and acting at once read as
   "Cannot set properties of null" with no hint which step. A prompt that
   never comes still fails - after 20 seconds, naming the selector. */
const present = async (page, sel) => {
  let there = false;
  for (const t = Date.now(); !there && Date.now() - t < 20000; ) {
    there = await page.evaluate((s) => !!document.querySelector(s), sel).catch(() => false);
    if (!there) await new Promise(r => setTimeout(r, 100));
  }
  if (!there)
    throw new Error(sel + ' never appeared. On screen: ' + String(await page.evaluate(() => (document.querySelector('#set-pane, .set-pane, #ovr') || document.body).innerText).catch(() => '')).slice(0, 300));
};
const fill = async (page, sel, v) => { await present(page, sel); return page.evaluate(([s, v]) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]); };
const click = async (page, sel) => { await present(page, sel); return page.evaluate((s) => document.querySelector(s).click(), sel); };
const totp = (secret, ahead = 0) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const key = [];
  for (const ch of secret.replace(/\s/g, '')) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { key.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  /* A code is spent once used, so turning it on and signing in take two steps. */
  const step = Math.floor(Date.now() / 30000) + ahead;
  const msg = Buffer.alloc(8); msg.writeUInt32BE(Math.floor(step / 2 ** 32), 0); msg.writeUInt32BE(step >>> 0, 4);
  const h = createHmac('sha1', Buffer.from(key)).update(msg).digest(); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
};
const signedIn = (page) => until(page, () => !!(window.AMV_API && AMV_API.token && S.user && S.user.email));
const openSecurity = async (page) => {
  await page.evaluate(() => { setTab('settings'); S.settingsPane = 'account'; renderSetPane(); });
  return until(page, () => !!document.querySelector('#sec-mfa .ss2 h3') && !/Loading/.test(document.getElementById('sec-mfa').textContent));
};

const A = await device();
await boot(A.page);

section('Sign up: a passkey first; a password one tap away, and it says how long');
{
  await A.page.evaluate(() => openAuth('signup'));
  await until(A.page, () => !!document.getElementById('a-pass'));
  const first = await A.page.evaluate(() => ({ pk: !!document.getElementById('pk-signup') && document.getElementById('pk-signup').classList.contains('bp'),
    pwHidden: document.getElementById('a-pw-wrap').hidden, submitHidden: document.getElementById('auth-submit').hidden }));
  ok(first.pk && first.pwHidden && first.submitHidden, 'the main button makes a passkey; the password field waits (owner decision #43)', first);
  await click(A.page, '#a-use-pw');
  const shown = await A.page.evaluate(() => !document.getElementById('a-pw-wrap').hidden && !document.getElementById('auth-submit').hidden);
  ok(shown, '"Use a password instead" brings the password field and its button', shown);
  const ph = await A.page.$eval('#a-pass', e => e.placeholder);
  ok(/\b15\b/.test(ph), 'the form says how long: 15 with nothing else guarding the account', ph);
  await fill(A.page, '#a-name', 'Nadia'); await fill(A.page, '#a-email', EMAIL); await fill(A.page, '#a-pass', PW);
  await click(A.page, '#auth-submit');
  ok(await signedIn(A.page), 'a 20-character phrase makes the account', true);
}

section('Settings: a passkey is added, proved with the password');
{
  ok(await openSecurity(A.page), 'the Security section loads (fetched on demand)', true);
  await click(A.page, '#sec-pk-add');
  await until(A.page, () => !!document.getElementById('sec-pw'));
  ok(await A.page.$eval('.sec-proof', e => /confirm it is you/.test(e.textContent)), 'it asks for proof before anything changes', true);
  await fill(A.page, '#sec-pw', PW);
  await click(A.page, '#sec-proof-go');
  const added = await until(A.page, () => /Passkey added/.test((document.getElementById('sec-msg') || {}).textContent || ''), 8000);
  ok(added, 'the fingerprint reader makes one, and AMV says so', true);
  const creds = (await A.cdp.send('WebAuthn.getCredentials', { authenticatorId: A.authenticatorId })).credentials;
  ok(creds.length === 1 && creds[0].isResidentCredential, 'the device really holds a passkey for this site', creds.length);
  ok(await A.page.$$eval('#sec-mfa [data-sec-rm]', b => b.length) === 1, 'and the list shows it, with Remove', true);
}

section('Signed out, the passkey alone signs back in');
{
  await A.page.evaluate(() => signOut());
  await until(A.page, () => !(window.AMV_API && AMV_API.token));
  await A.page.evaluate(() => openAuth('login'));
  await until(A.page, () => !!document.getElementById('pk-btn'));
  await click(A.page, '#pk-btn');
  ok(await signedIn(A.page), 'no password, no emailed code', true);
  ok(await A.page.evaluate(() => S.user.email) === EMAIL, 'and it is the right account', true);
}

let secret = '', codes = [];
section('An authenticator app, with recovery codes shown once');
{
  await openSecurity(A.page);
  await click(A.page, '#sec-totp-on');
  await until(A.page, () => !!document.getElementById('sec-pw'));
  await fill(A.page, '#sec-pw', PW); await click(A.page, '#sec-proof-go');
  await until(A.page, () => !!document.querySelector('.sec-secret code'));
  secret = await A.page.$eval('.sec-secret code', e => e.textContent.replace(/\s/g, ''));
  ok(/^[A-Z2-7]{32}$/.test(secret), 'the key to type into the app is shown', secret.length);
  ok(await A.page.$('#sec-key-open') !== null, 'and a button that opens it in the app on a phone', true);
  const qr = await A.page.$eval('.sec-setup .sec-qr', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, label: e.getAttribute('aria-label') }; }).catch(() => null);
  ok(qr && qr.w >= 200 && Math.abs(qr.w - qr.h) < 1 && /QR/.test(qr.label), 'and a QR code the app scans, large and square', qr);
  await fill(A.page, '#sec-first', totp(secret, 0)); await click(A.page, '#sec-first-go');
  await until(A.page, () => !!document.querySelector('.sec-code-list'));
  codes = (await A.page.$eval('.sec-code-list', e => e.textContent)).trim().split('\n');
  ok(codes.length === 10 && codes.every(c => /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)), 'ten recovery codes', codes.length);
}

section('A new device: the password asks for the code, and the code signs in');
const B = await device();
{
  await boot(B.page);
  await B.page.evaluate(() => openAuth('login'));
  await until(B.page, () => !!document.getElementById('a-email'));
  await fill(B.page, '#a-email', EMAIL); await fill(B.page, '#a-pass', PW);
  await click(B.page, '#auth-submit');
  ok(await until(B.page, () => !!document.getElementById('mf-code')), 'the right password is not enough: it asks for the app’s code', true);
  ok(!(await B.page.evaluate(() => !!(AMV_API.token && S.user))), 'and nothing is signed in yet', true);
  await fill(B.page, '#mf-code', '000000'); await click(B.page, '#mf-go');
  ok(await until(B.page, () => /did not work/.test((document.getElementById('mf-msg') || {}).textContent || '')), 'a wrong code says so', true);
  await new Promise(r => setTimeout(r, 300));
  await fill(B.page, '#mf-code', totp(secret, 1));
  ok(await signedIn(B.page), 'the code from the app signs in', true);
}

section('Sign up with a passkey alone: no password, signed straight in, and back in with it');
{
  const C = await device({ width: 390, height: 844 });
  await boot(C.page);
  await C.page.evaluate(() => openAuth('signup'));
  await until(C.page, () => !!document.getElementById('pk-signup'));
  await fill(C.page, '#a-name', 'Tomas'); await fill(C.page, '#a-email', 'tomas@example.com');
  await click(C.page, '#pk-signup');
  ok(await signedIn(C.page), 'one tap and the device\u2019s fingerprint make the account and sign in', true);
  const creds = (await C.cdp.send('WebAuthn.getCredentials', { authenticatorId: C.authenticatorId })).credentials;
  ok(creds.length === 1 && creds[0].isResidentCredential, 'the phone really holds the passkey', creds.length);
  await C.page.evaluate(() => signOut());
  await until(C.page, () => !(S.user && S.user.email));
  await C.page.evaluate(() => openAuth('login'));
  await until(C.page, () => !!document.getElementById('pk-btn'));
  await click(C.page, '#pk-btn');
  ok(await signedIn(C.page), 'and the passkey signs back in - no password ever existed', true);
  await C.context.close();
}

section('At phone width, the Security section fits');
{
  await A.page.setViewportSize({ width: 390, height: 844 });
  await openSecurity(A.page);
  const r = await A.page.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1,
    small: [...document.querySelectorAll('#sec-mfa button')].filter(b => b.getBoundingClientRect().height && __under(b.getBoundingClientRect().height, 44)).length }));
  ok(!r.over && r.small === 0, 'nothing runs off the side, and every button is a full-size target', r);
}

const real = errors.filter(e => !/WebAuthn|NotAllowedError/.test(e));
ok(real.length === 0, 'no page errors', errors);
await browser.close(); apiServer.close(); site.close();
if (report('sign-in-with-a-passkey') > 0) process.exitCode = 1;
done();
