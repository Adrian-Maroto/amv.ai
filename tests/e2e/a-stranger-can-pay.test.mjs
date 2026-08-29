/* NOBODY EXCEPT THE OWNER COULD USE THE PRODUCT, LET ALONE PAY FOR IT.

   AMV_API.base was:

       get base(){ return loadStr('amv_api_base') || ''; }

   localStorage and nothing else. The owner pastes their Worker URL once in
   Settings, their own browser goes fully live, and every screen works. That is
   exactly why this survived: on the only machine anyone tested, there was no
   problem.

   For everybody else - the first real visitor to the live site - `base` was
   empty. AMV_API.live was false. So sign-up wrote a local-only account, chat
   had no engine, and every payment path checked `liveBackend` and correctly
   refused. The app degraded honestly to its demo, permanently, for the entire
   internet. No stranger could get a real answer out of it, and no stranger
   could give AMV a pound.

   Nothing in the suite could have caught it: every test boots the app and
   configures a backend, which is the owner's situation, not a visitor's.

   The address ships in the artifact now, in a meta tag written by hand or by
   `AMV_API_BASE=... node build.mjs`. These cases are all about the FRESH
   visitor - no localStorage, nothing typed. */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chromium } from 'playwright';
import { LAUNCH } from '../lib/harness.mjs';
import { createServer } from 'http';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* PORT 0 ASKS THE KERNEL FOR A FREE ONE.
   A fixed port is a suite that fails when anything else already holds it -
   another run, a leftover process, or simply the same gate started twice.
   That is not a product failure but it reads exactly like one, and a gate
   that goes red for reasons of its own is a gate people stop believing. */
let PORT = 0;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
                '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

/* Serve index.html with whatever backend address the case needs, without
   touching the file on disk. */
let META = '';
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = rel === '/' ? 'index.html' : rel.replace(/^\/+/, '');
  const abs = join(ROOT, file);
  if (!abs.startsWith(ROOT) || !/\.[a-z0-9]+$/i.test(file)) { res.writeHead(404); res.end(); return; }
  let body;
  try { body = readFileSync(abs); } catch (e) { res.writeHead(404); res.end(); return; }
  if (file === 'index.html') {
    body = Buffer.from(String(body).replace(
      /<meta name="amv-api-base" content="[^"]*">/,
      `<meta name="amv-api-base" content="${META}">`));
  }
  res.writeHead(200, { 'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
  res.end(body);
});
await new Promise(r => server.listen(0, r));
PORT = server.address().port;
const browser = await chromium.launch(LAUNCH);

/* A visitor who has never been here: empty storage, nothing configured. */
async function freshVisitor() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    stored: (() => { try { return localStorage.getItem('amv_api_base'); } catch (e) { return null; } })(),
    base: AMV_API.base,
    live: !!AMV_API.live,
  }));
  await ctx.close();
  return r;
}

section('With a backend baked in, a first-time visitor is already live');
{
  META = 'https://amv-backend.example.workers.dev';
  const r = await freshVisitor();
  ok(r.stored === null, 'they have typed nothing and stored nothing', r.stored);
  ok(r.base === META, 'and the app still knows where its backend is', r.base);
  ok(r.live === true,
     'so the engine, real accounts and checkout are all available to them', r.live);
}

section('With none baked in, it is honest rather than broken');
{
  /* The old behaviour, which must remain the behaviour when nothing is set -
     the demo is a legitimate state, it just must not be everybody's state. */
  META = '';
  const r = await freshVisitor();
  ok(r.base === '', 'no address is invented', r.base);
  ok(r.live === false, 'and the app reports itself as not live', r.live);
}

section('A typed address still wins, so one device can point elsewhere');
{
  META = 'https://amv-backend.example.workers.dev';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const shipped = AMV_API.base;
    AMV_API.base = 'https://staging.example.workers.dev';
    const overridden = AMV_API.base;
    saveStr('amv_api_base', '');
    return { shipped, overridden, cleared: AMV_API.base };
  });
  await ctx.close();
  ok(r.shipped === META, 'it starts on what shipped', r.shipped);
  ok(r.overridden === 'https://staging.example.workers.dev',
     'Settings still overrides it', r.overridden);
  ok(r.cleared === META, 'and clearing it falls back to what shipped', r.cleared);
}

section('An insecure address is refused, not silently used');
{
  /* The access token is bound to the origin that issued it, so a plain-http
     default would have its Authorization header stripped and fail in a way
     nobody could diagnose. Better to be not-live than mysteriously broken. */
  META = 'http://not-secure.example.com';
  const r = await freshVisitor();
  ok(r.base === '', 'an http address is not adopted', r.base);
  ok(r.live === false, 'and the app says it is not live', r.live);
}

section('And the public settings a visitor needs arrive from the backend');
{
  /* The Google client id lived in the owner's localStorage, so "Continue with
     Google" - the first button on the sign-up sheet - was dead for everybody
     else. The Worker has always had it; the browser was never told. */
  META = 'https://amv-backend.example.workers.dev';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const r = await page.evaluate(async () => {
    const before = loadStr('amv_gauth') || '';
    const realFetch = window.fetchDeadline;
    let asked = '';
    window.fetchDeadline = async (u) => {
      asked = String(u);
      return { ok: true, status: 200, json: async () => ({
        ok: true, googleClientId: '123-abc.apps.googleusercontent.com',
        turnstileSiteKey: '0x4AAAsite', supportEmail: 'help@amv.test' }) };
    };
    /* Cleared because boot already ran once in this context. */
    _publicConfigDone = false;
    await _loadPublicConfig();
    window.fetchDeadline = realFetch;
    return { before, asked,
             google: loadStr('amv_gauth') || '',
             captcha: loadStr('amv_turnstile_site') || '',
             support: loadStr('amv_support_email') || '' };
  });
  await ctx.close();
  ok(r.before === '', 'the visitor started with no Google id', r.before);
  ok(/\/v1\/public-config$/.test(r.asked), 'the backend is asked for it', r.asked);
  ok(r.google === '123-abc.apps.googleusercontent.com',
     'and Continue with Google now has an id to use', r.google);
  ok(r.captcha === '0x4AAAsite', 'the captcha site key too', r.captcha);
  ok(r.support === 'help@amv.test', 'and the support address', r.support);
}

section('A value the owner set locally is never overwritten');
{
  META = 'https://amv-backend.example.workers.dev';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const r = await page.evaluate(async () => {
    saveStr('amv_gauth', 'my-own-staging-project.apps.googleusercontent.com');
    const realFetch = window.fetchDeadline;
    window.fetchDeadline = async () => ({ ok: true, status: 200, json: async () => ({
      ok: true, googleClientId: 'the-production-one' }) });
    _publicConfigDone = false;
    await _loadPublicConfig();
    window.fetchDeadline = realFetch;
    return loadStr('amv_gauth') || '';
  });
  await ctx.close();
  ok(r === 'my-own-staging-project.apps.googleusercontent.com',
     'a deliberate local choice survives the fetch', r);
}

section('The captcha box can actually appear, which decides whether anyone can sign up');
{
  /* Turnstile is two halves. TURNSTILE_SECRET verifies a token; the SITE KEY
     renders the widget that produces one. The site key had no route to the
     browser at all - `window.__AMV_TURNSTILE_SITE_KEY__` was set by no build
     step and no script - so the box hid itself on every page load.

     That was invisible while the secret was unset. The moment an operator set
     it, which GO-LIVE listed under "optional, add anytime", the Worker started
     demanding a token that no visitor's browser could produce: every sign-up
     and every sign-in on the entire site, refused, with a message about a
     checkbox that was not on the screen.

     So this drives the real sign-up sheet rather than checking a variable. */
  META = 'https://amv-backend.example.workers.dev';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const r = await page.evaluate(async () => {
    openAuth('signup');
    const box = () => document.getElementById('a-turnstile');
    const hiddenBefore = box() ? box().style.display : 'no-box';

    const realFetch = window.fetchDeadline;
    window.fetchDeadline = async () => ({ ok: true, status: 200, json: async () => ({
      ok: true, turnstileSiteKey: '0x4AAAAAAAsiteKey' }) });
    _publicConfigDone = false;
    await _loadPublicConfig();
    window.fetchDeadline = realFetch;

    return {
      hiddenBefore,
      stored: loadStr('amv_turnstile_site') || '',
      display: box() ? box().style.display : 'no-box',
      sitekey: box() ? (box().getAttribute('data-sitekey') || '') : '',
    };
  });
  await ctx.close();
  ok(r.hiddenBefore === 'none',
     'with no key the box hides itself rather than showing an empty frame', r.hiddenBefore);
  ok(r.stored === '0x4AAAAAAAsiteKey',
     'the site key reaches the browser from the backend', r.stored);
  ok(r.display !== 'none' && r.display !== 'no-box',
     'the captcha box is now shown on the open sign-up sheet', r.display);
  ok(r.sitekey === '0x4AAAAAAAsiteKey',
     'carrying the key the widget needs, so a token can be produced', r.sitekey);
}

section('With no backend there is nothing to ask, and it does not try');
{
  META = '';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const r = await page.evaluate(async () => {
    let asked = false;
    const realFetch = window.fetchDeadline;
    window.fetchDeadline = async () => { asked = true; return { ok: false, status: 404, json: async () => ({}) }; };
    _publicConfigDone = false;
    await _loadPublicConfig();
    window.fetchDeadline = realFetch;
    return asked;
  });
  await ctx.close();
  ok(r === false, 'no request is made when there is nowhere to send it', r);
}

section('The build writes the address in');
{
  const b = readFileSync(join(ROOT, 'build.mjs'), 'utf8');
  ok(/AMV_API_BASE/.test(b), 'build.mjs reads AMV_API_BASE', true);
  ok(/must be an https:\/\/ URL/.test(b),
     'and refuses anything that is not https', true);
}

section('Preflight says so when the artifact ships with no backend');
{
  /* Without this the mistake is invisible: the owner deploys, opens the site
     on the machine where they once pasted the URL, and everything works. */
  const p = readFileSync(join(ROOT, 'preflight.mjs'), 'utf8');
  ok(/amv-api-base/.test(p), 'preflight looks at the meta tag', true);
  ok(/every visitor gets the local demo/.test(p),
     'and says what an empty one means', true);
}

await browser.close();
server.close();
if (report('a-stranger-can-pay') > 0) process.exitCode = 1;
done();
