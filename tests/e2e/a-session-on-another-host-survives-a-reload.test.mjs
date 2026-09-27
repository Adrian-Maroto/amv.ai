/* A SESSION ON ANOTHER HOST SURVIVES A RELOAD - MEASURED WITH A REAL SERVER.

   Production is two hosts: the page on amv.homes, the API on api.amv.homes.
   The session's long half is an HttpOnly cookie the API sets on its own host,
   and a browser keeps a cookie from a cross-origin response ONLY when the
   request asked it to (credentials: 'include'). Sign-in did not ask. So the
   cookie was dropped the moment it arrived, the page - told "the refresh token
   is in a cookie" - stopped keeping its own copy, and the owner was signed in
   until the first reload or expired token, after which every request said
   "Session expired" and Connect never worked without signing in again.

   Every existing suite missed it, and why is the lesson: they serve the API
   through Playwright's request interception, and a FAKED response has its
   cookies stored whatever the request's credentials mode. The browser rule
   that broke production never ran in a test. This suite puts the Worker behind
   a real HTTP server on a second origin, so the browser applies the real rule.

   localhost on two ports is cross-origin and same-site - the same relationship
   as amv.homes and api.amv.homes. */
import { createServer } from 'http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, makeOutbound, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?xhost=' + Date.now())).default;

/* The API: the Worker behind a real server, so cookies and CORS are the
   browser's own business rather than a test's. */
const apiServer = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = 'http://localhost:' + apiServer.address().port + req.url;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  let r;
  try {
    r = await worker.fetch(new Request(url, { method: req.method, headers,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : body }), env, { waitUntil() {}, passThroughOnException() {} });
  } catch (e) { res.writeHead(500); res.end(String(e && e.message)); return; }
  const out = {};
  r.headers.forEach((v, k) => { out[k] = v; });
  const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => apiServer.listen(0, r));
const API = 'http://localhost:' + apiServer.address().port;

const site = await serveArtifact(0, API);
const SITE = 'http://localhost:' + site.address().port;

const outbound = makeOutbound();
outbound.on(/resend|mail|sendgrid|postmark/i, () => ({ id: 'e1' }));
/* Slack's side of the trip: the code AMV brings back is exchanged here for a
   token, exactly the reply Slack gives a user-token grant. */
outbound.on(/slack\.com\/api\/oauth\.v2\.access/, () => ({ ok: true,
  authed_user: { id: 'U1', access_token: 'xoxp-test-token', token_type: 'user',
    scope: 'channels:read,channels:history,groups:read,groups:history,im:read,im:history,users:read,search:read' },
  team: { id: 'T1', name: 'Test' } }));
outbound.on(/slack\.com\/api\//, () => ({ ok: true }));
const env = makeEnv({ APP_URL: SITE, ALLOWED_ORIGIN: SITE, CONNECT_KEY: 'k'.repeat(40),
  SLACK_CLIENT_ID: 'slack-client', SLACK_CLIENT_SECRET: 'slack-secret' });

const browser = await chromium.launch(LAUNCH);
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(SITE, { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.evaluate(() => { try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {} });

const until = async (label, fn, ms = 20000) => {
  const stop = Date.now() + ms;
  while (Date.now() < stop) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('timed out waiting for ' + label);
};

section('Signing up on the page, against an API on another host');
{
  await page.evaluate(() => openAuth('signup'));
  await until('the signup form', () => page.evaluate(() => !!document.querySelector('#a-name')));
  await page.evaluate(() => {
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Kim'); type('#a-email', 'kim@example.com'); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click();
  });
  await until('the account', () => page.evaluate(() => !!(S.user && S.user.email === 'kim@example.com' && AMV_API.token)));
  const s = await page.evaluate(() => ({ cookieMode: AMV_API.cookieAuth, told: localStorage.getItem('amv_cookie_session') }));
  ok(s.cookieMode === true, 'the server said the session is in a cookie', s);
  const jar = await context.cookies();
  ok(jar.some(c => c.name === 'amv_rt' && c.httpOnly), 'and the browser really kept that cookie, on the API’s host', jar.map(c => c.name));
}

section('After a reload the session is back, and the connections list loads');
{
  await page.reload({ waitUntil: 'load' });
  await until('the session to be restored', () => page.evaluate(() => !!(window.AMV_API && AMV_API.token && !AMV_API._restoring)), 15000).catch(() => {});
  const r = await page.evaluate(async () => {
    const out = { token: !!AMV_API.token };
    try { const d = await AMV_API.connectList(); out.list = !!(d && d.ok); out.configured = d && d.configured; }
    catch (e) { out.err = String(e && e.message); }
    return out;
  });
  ok(r.token, 'a reload restores the session from the cookie', r);
  ok(r.list === true && !r.err, 'and Connect’s list loads - no "Session expired"', r);
}

section('A short-lived pass that runs out mid-visit is renewed, not reported');
{
  /* The owner's other way in: signed in for longer than the access token
     lives, no reload. The next request is refused, and the cookie has to
     renew it quietly rather than the screen saying "Session expired". */
  const r = await page.evaluate(async () => {
    AMV_API.token = 'an.expired.token';
    try { const d = await AMV_API.connectList(); return { list: !!(d && d.ok), renewed: AMV_API.token !== 'an.expired.token' }; }
    catch (e) { return { err: String(e && e.message) }; }
  });
  ok(r.list === true && r.renewed && !r.err, 'an expired pass is renewed from the cookie and the list still loads', r);
}

/* THE WHOLE TRIP, THE WAY THE OWNER TAKES IT. Signed in, on Integrations, press
   Connect on Slack, choose what it may do, go to Slack, approve, come back. The
   provider's page is the one thing not real: it approves at once and sends the
   browser back with a code, as Slack does. Leaving the page drops everything
   held in memory, so the return is a cold boot that has only the cookie. */
let state = '';
await context.route('https://slack.com/**', (route) => {
  const u = new URL(route.request().url());
  state = u.searchParams.get('state') || '';
  const back = new URL(u.searchParams.get('redirect_uri') || (SITE + '/'));
  back.searchParams.set('code', 'slack-code');
  back.searchParams.set('state', state);
  return route.fulfill({ status: 302, headers: { location: back.toString() } });
});

section('Connect, from the Integrations page, goes to the provider');
{
  await page.evaluate(() => setTab('integrations'));
  await until('the Slack row', () => page.evaluate(() =>
    [...document.querySelectorAll('.int-card')].some(c => /Slack/.test(c.textContent) && c.querySelector('[data-int-conn]'))));
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.int-card')].find(c => /Slack/.test(c.textContent) && c.querySelector('[data-int-conn]'));
    card.querySelector('[data-int-conn]').click();
  });
  await until('the choice of what Slack may do', () => page.evaluate(() => !!document.getElementById('conn-go')));
  const [nav] = await Promise.all([
    page.waitForURL(u => u.searchParams.has('code') || u.origin === SITE && !u.search, { timeout: 20000 }).then(() => true).catch(() => false),
    page.click('#conn-go'),
  ]);
  ok(/^c_/.test(state), 'the browser went to Slack carrying the state the server issued', state);
  ok(nav, 'and came back to AMV', page.url());
}

section('Back from the provider: connected, with no second sign-in');
{
  await until('the connection to be finished', () => page.evaluate(() => {
    const d = (typeof _connState !== 'undefined' && _connState.data) || {};
    return (d.items || []).some(i => i.provider === 'slack');
  }), 20000).catch(() => {});
  const r = await page.evaluate(() => ({
    tab: S.tab,
    items: (((typeof _connState !== 'undefined' && _connState.data) || {}).items || []).map(i => i.provider),
    toasts: [...document.querySelectorAll('.toast, [role=status], [role=alert]')].map(t => t.textContent).join(' | '),
    pending: localStorage.getItem('amv_pending_connect'),
    search: location.search,
  }));
  ok(r.items.includes('slack'), 'Slack is connected on the server', r);
  ok(!/expired|sign in again|could not be reached|did not complete/i.test(r.toasts), 'and nothing on screen says the session was lost', r.toasts);
  ok(r.tab === 'integrations', 'the page lands back on Integrations, where Connect was pressed', r.tab);
  ok(!r.pending && r.search === '', 'the code is spent and out of the address bar', r);
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('.int-card')].some(c => /Slack/.test(c.textContent) && c.querySelector('.int-ok')));
  ok(shown, 'the Slack row on Integrations says Connected', shown);
}

section('Settings says it too');
{
  await page.evaluate(() => { S.settingsPane = 'integrations'; setTab('settings'); });
  await until('Settings to show Slack', () => page.evaluate(() =>
    [...document.querySelectorAll('.set-conn .int-card')].some(c => /Slack/.test(c.textContent) && c.querySelector('.int-ok'))), 10000).catch(() => {});
  const r = await page.evaluate(() => ({
    slack: [...document.querySelectorAll('.set-conn .int-card')].some(c => /Slack/.test(c.textContent) && c.querySelector('.int-ok')),
    text: (document.querySelector('.set-conn') || {}).textContent || '',
  }));
  ok(r.slack, 'Settings → Connectors lists Slack as connected', r.text.slice(0, 200));
}

section('And after one more reload it is still connected, still signed in');
{
  await page.reload({ waitUntil: 'load' });
  await until('the session', () => page.evaluate(() => !!(window.AMV_API && AMV_API.token && !AMV_API._restoring)), 15000).catch(() => {});
  const r = await page.evaluate(async () => {
    try { const d = await AMV_API.connectList(); return { items: (d.items || []).map(i => i.provider) }; }
    catch (e) { return { err: String(e && e.message) }; }
  });
  ok(!r.err && r.items.includes('slack'), 'the connection and the session both survive', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await browser.close();
site.close(); apiServer.close();
report();
done();
