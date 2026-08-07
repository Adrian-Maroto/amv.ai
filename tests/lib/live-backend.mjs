/* THE REAL WORKER, BEHIND A REAL BROWSER.

   Every other e2e file stubs the network. That is the right thing for testing
   one screen's behaviour, and it is exactly why three separate shipping
   defects survived a suite of eighty files: a stub answers what the test
   expects, so it can only ever confirm what somebody already thought to check.
   The API base living in one person's localStorage, the Google client id doing
   the same, and the captcha site key having no route to the browser at all
   were all invisible to every stub in the repository, because a stub does not
   care whether the app knows where its backend is.

   So this runs amv-backend.js itself - the same file wrangler deploys - and
   points a real Chromium at it through page.route. Requests go out of the page
   as real cross-origin fetches with real CORS, real Authorization headers, and
   real JSON, and come back from the real handlers over an in-memory KV.

   What it does NOT fake: routing, auth, token issuing and verification, rate
   limits, entitlements, webhooks, the quota counters. What it still has to
   fake is anything genuinely outside the system - Stripe's API, the model
   endpoint, an email provider - and each of those is a named, inspectable stub
   so a test can say what the outside world did and assert on what AMV then
   believed. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chromium } from 'playwright';
import { createServer } from 'http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* A workers.dev host, because index.html's CSP allows connect-src to
   https://*.workers.dev and nothing else would reach the page's own rules.
   Testing against an origin the shipped CSP forbids would prove nothing about
   the shipped artifact. */
export const BACKEND = 'https://amv-e2e.workers.dev';

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
                '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

/* An in-memory KV with the surface the worker actually uses. TTLs are ignored:
   no test here runs long enough for one to matter, and pretending to honour
   them would be a second implementation to get wrong. */
export function makeKV() {
  const m = new Map();
  return {
    _map: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix, limit } = {}) {
      let keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
      if (limit) keys = keys.slice(0, limit);
      return { keys, list_complete: true };
    },
  };
}

/* Everything the deployment is configured with. A test overrides exactly the
   secrets its case is about, so "what happens with no email provider" and
   "what happens with one" are two lines apart. */
export function makeEnv(extra = {}) {
  return Object.assign({
    AMV_KV: makeKV(),
    JWT_SECRET: 'test-jwt-secret-not-a-real-one',
    APP_URL: 'http://localhost',
    ADMIN_TOKEN: 'test-admin-token',
  }, extra);
}

/* Outbound calls the worker makes to the world: Stripe, the model endpoint, an
   email provider. Recorded and answered here so a test can state what the
   outside did and then assert on what AMV concluded from it. */
export function makeOutbound() {
  const calls = [];
  const handlers = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url && url.url ? url.url : url);
    calls.push({ url: u, method: (opts.method || 'GET'), body: String(opts.body || '') });
    for (const h of handlers) {
      if (h.match.test(u)) return h.reply(u, opts);
    }
    /* Loud rather than a silent empty 200. An unanticipated outbound call is
       either a route this harness has not been taught, or the worker reaching
       somewhere it should not - both worth seeing. */
    return new Response(JSON.stringify({ error: 'no stub for ' + u }), { status: 599 });
  };
  return {
    calls,
    /* on(/stripe\.com/, () => ({...})) - the reply may be a plain object
       (wrapped as 200 JSON) or a Response.

       Handlers are tried in REGISTRATION order and the first match wins, so a
       file reads top to bottom: the specific route first, a catch-all last.
       This used to try them newest-first, which silently made a catch-all
       registered at the bottom shadow every specific handler above it - the
       checkout stub returned the catch-all's empty body and the failure looked
       like the Worker mishandling Stripe. */
    on(match, reply) {
      handlers.push({ match, reply: async (u, opts) => {
        const r = await reply(u, opts);
        return r instanceof Response ? r : new Response(JSON.stringify(r), {
          status: 200, headers: { 'Content-Type': 'application/json' } });
      } });
      return this;
    },
    sentTo(re) { return calls.filter(c => re.test(c.url)); },
    restore() { globalThis.fetch = real; },
  };
}

/* Serve the built artifact with a chosen backend address in the meta tag, so a
   case can be a first-time visitor with nothing in storage - which is the only
   session that resembles a customer's. */
async function serveArtifact(port, apiBase) {
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
        `<meta name="amv-api-base" content="${apiBase}">`));
    }
    res.writeHead(200, { 'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(body);
  });
  await new Promise(r => server.listen(port, r));
  return server;
}

/* Boot a browser whose backend IS the worker module.

   Returns the env so a test can read what really landed in storage - the
   entitlement record, the audit trail, the account - rather than inferring it
   from what a screen says. Asserting on both sides is the point: the defects
   this exists to catch are precisely the ones where the screen and the server
   disagree. */
export async function bootLive(opts = {}) {
  const port = opts.port || 9160;
  const env = opts.env || makeEnv();
  const outbound = opts.outbound || makeOutbound();
  const apiBase = opts.apiBase === undefined ? BACKEND : opts.apiBase;

  const worker = (await import(join(ROOT, 'amv-backend.js') + '?live=' + Date.now())).default;
  const server = await serveArtifact(port, apiBase);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const served = [];
  const pending = [];

  await context.route(BACKEND + '/**', async (route) => {
    const req = route.request();
    const url = req.url();
    let body = null;
    try { body = req.postData(); } catch (e) {}
    const wreq = new Request(url, {
      method: req.method(),
      headers: req.headers(),
      body: (req.method() === 'GET' || req.method() === 'HEAD') ? undefined : body,
    });
    let res;
    try {
      res = await worker.fetch(wreq, env, { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); },
                                            passThroughOnException() {} });
    } catch (e) {
      served.push({ url, status: 500, threw: String(e && e.message) });
      await route.fulfill({ status: 500, contentType: 'application/json',
                            body: JSON.stringify({ error: 'worker threw: ' + String(e && e.message) }) });
      return;
    }
    const text = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    served.push({ url, status: res.status, path: new URL(url).pathname });
    await route.fulfill({ status: res.status, headers, body: text });
  });

  await page.goto(`http://localhost:${port}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  /* The cookie banner covers the sign-up button on a narrow viewport, and
     every case here is about somebody getting to that button. */
  await page.evaluate(() => {
    try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {}
  });

  return {
    page, context, browser, env, outbound, served, errors, worker, port,
    /* Requests the page really made to the backend, so a case can assert that
       something was ASKED as well as that the screen changed. */
    hit(re) { return served.filter(s => re.test(s.path || s.url)); },
    /* Anything the worker deferred with ctx.waitUntil - audit writes, counters.
       Awaiting them is how a test reads state the request did not block on. */
    async settle() { await Promise.all(pending.splice(0)); await page.waitForTimeout(60); },
    /* A SECOND device for the same person: a new context, so nothing at all is
       shared with the first except the server. The place a locally-granted
       plan stops being a plan. */
    async otherDevice() {
      const c2 = await browser.newContext();
      await c2.route(BACKEND + '/**', async (route) => {
        const req = route.request();
        let b = null; try { b = req.postData(); } catch (e) {}
        const wr = new Request(req.url(), { method: req.method(), headers: req.headers(),
          body: (req.method() === 'GET' || req.method() === 'HEAD') ? undefined : b });
        const rs = await worker.fetch(wr, env, { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); },
                                                 passThroughOnException() {} });
        const t = await rs.text();
        const h = {}; rs.headers.forEach((v, k) => { h[k] = v; });
        await route.fulfill({ status: rs.status, headers: h, body: t });
      });
      const p2 = await c2.newPage();
      await p2.goto(`http://localhost:${port}`, { waitUntil: 'load' });
      await p2.waitForTimeout(600);
      await p2.evaluate(() => {
        try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {}
      });
      return { page: p2, context: c2 };
    },
    async close() {
      try { outbound.restore(); } catch (e) {}
      try { await browser.close(); } catch (e) {}
      try { server.close(); } catch (e) {}
    },
  };
}
