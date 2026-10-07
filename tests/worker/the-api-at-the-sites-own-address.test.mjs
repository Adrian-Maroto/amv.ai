/* THE API AT THE SITE'S OWN ADDRESS.

   Safari treats a cookie set by a host on another network address as third
   party and deletes it after seven days, so on an iPhone a weekly visitor was
   signed out every visit. The server therefore also answers at the site's own
   address under `/api`, where its cookies are first party.

   Two things must both hold, and each is checked by making the request:
   through the mount, every route answers as it does on its own host and the
   cookies are scoped to the mount; on its own host, nothing changed - including
   the routes that were already named `/api/...`. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'apimount.harness.mjs');
writeFileSync(harness, src + '\nexport { issueTokens, _siteUrl, _mountRequest };\n');
const W = await import(harness + '?t=' + Date.now());

const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 200 });

const SITE = 'https://amv.test';
const OWN = 'https://api.amv.test';
function mkEnv() {
  const m = new Map();
  return {
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    JWT_SECRET: 'mount-secret', ADMIN_TOKEN: 'a', APP_URL: SITE, ALLOWED_ORIGIN: SITE,
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const call = (env, url, init = {}) => W.default.fetch(new Request(url, { ...init,
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.8.' + (ip++), Origin: SITE, ...(init.headers || {}) } }), env, ctx);

section('Through the site’s own address, the routes answer');
{
  const env = mkEnv();
  const r = await call(env, SITE + '/api/v1/public-config');
  const d = await r.json().catch(() => null);
  ok(r.status === 200 && d && typeof d === 'object', 'public config answers at /api/v1/public-config', r.status);
  const jobs = await call(env, SITE + '/api/api/jobs');
  ok(jobs.status === 401, 'and a route already named /api/... answers under the mount too, asking for a session', jobs.status);
}

section('On its own host, nothing moved');
{
  const env = mkEnv();
  const r = await call(env, OWN + '/v1/public-config');
  ok(r.status === 200, 'public config still answers at its old address', r.status);
  const jobs = await call(env, OWN + '/api/jobs');
  ok(jobs.status === 401, '/api/jobs is still /api/jobs, not stripped to /jobs', jobs.status);
  const wrong = await call(env, OWN + '/api/v1/public-config');
  ok(wrong.status !== 200, 'and the prefix means nothing on a host that is not the site', wrong.status);
}

section('A renewal through the mount: the body arrives, the cookie is first party and scoped to it');
{
  const env = mkEnv();
  const pair = await W.issueTokens(env, 'mia@example.com', 'Mia');
  const r = await call(env, SITE + '/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: pair.refreshToken }) });
  const d = await r.json().catch(() => ({}));
  ok(r.status === 200 && d.token, 'the refresh token in the body was read, and renewed', r.status);
  const cookies = r.headers.getSetCookie();
  const rt = cookies.find(c => c.startsWith('amv_rt='));
  ok(rt && /;\s*Path=\/api\/auth(;|$)/.test(rt), 'the renewal cookie is scoped to /api/auth, where the browser will send it back', rt);
  ok(!cookies.some(c => /;\s*Path=\/auth(;|$)/.test(c)), 'and no cookie is left on a path the site does not route to the server', cookies);

  /* The browser sends it back on the next renewal, with nothing in the body. */
  const value = rt.split(';')[0];
  const again = await call(env, SITE + '/api/auth/refresh', { method: 'POST', body: '{}', headers: { Cookie: value } });
  ok(again.status === 200, 'and the cookie alone renews on the next visit', again.status);
}

section('The same renewal on the server’s own host keeps the old path');
{
  const env = mkEnv();
  const pair = await W.issueTokens(env, 'old@example.com', 'Old');
  const r = await call(env, OWN + '/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: pair.refreshToken }) });
  const rt = r.headers.getSetCookie().find(c => c.startsWith('amv_rt='));
  ok(r.status === 200 && rt && /;\s*Path=\/auth(;|$)/.test(rt), 'Path=/auth, exactly as before', rt);
}

section('Links the server writes to itself carry the mount');
{
  /* A published site's address is built from the request it answers. Under
     the mount it must lead back through /api, or the link opens the site's
     own 404 instead of the published page. */
  const env = mkEnv();
  ok(W._siteUrl(new Request(OWN + '/sites/publish'), 'demo') === OWN + '/s/demo', 'on its own host, /s/<name> as before');
  const inner = W._mountRequest(new Request(SITE + '/api/sites/publish'), env);
  ok(inner && new URL(inner.url).pathname === '/sites/publish', 'the router sees the path it always saw', inner && inner.url);
  ok(W._siteUrl(inner, 'demo') === SITE + '/api/s/demo', 'and the share link carries /api', W._siteUrl(inner, 'demo'));
  ok(W._mountRequest(new Request(SITE + '/apiary'), env) === null, 'a path that merely starts with the letters is not the mount');
  ok(W._mountRequest(new Request('https://evil.test/api/auth/refresh'), env) === null, 'and no other host can claim it');
}

section('Every link the server hands out leads to a page that exists');
{
  /* Found in the audit after the move: shared-chat links, the emailed reset
     link and the reset page itself pointed at the static host, which has no
     such pages and answers 404. Each is read back through the mount here. */
  const env = mkEnv();
  const pair = await W.issueTokens(env, 'links@example.com', 'L');
  const sh = await call(env, SITE + '/api/v1/share/create', { method: 'POST', headers: { Authorization: 'Bearer ' + pair.token },
    body: JSON.stringify({ title: 'T', msgs: [{ r: 'u', c: 'q' }, { r: 'a', c: 'a' }] }) });
  const sd = await sh.json().catch(() => ({}));
  ok(sd.url && sd.url.startsWith(SITE + '/api/c/'), 'a shared chat links through /api, where the server serves it', sd.url);
  if (sd.url) {
    const page = await call(env, sd.url);
    ok(page.status === 200, 'and that link opens the page', page.status);
  }

  /* Where the reset page's form really goes: its fetch target, resolved
     against the page's own address the way the browser will. */
  const target = async (pageUrl) => {
    const html = await (await call(env, pageUrl)).text();
    const m = /fetch\('([^']+)'/.exec(html);
    return m ? new URL(m[1], pageUrl).href : '';
  };
  ok(await target(SITE + '/api/reset?token=abc') === SITE + '/api/auth/reset/confirm', 'the reset page sends its form back through /api');
  ok(await target(OWN + '/reset?token=abc') === OWN + '/auth/reset/confirm', 'and on the server\u2019s own host, where it always did');

  const sent = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (/resend/.test(String(u))) sent.push(JSON.parse(o.body)); return new Response('{"id":"m"}', { status: 200 }); };
  const menv = { ...mkEnv(), EMAIL_API_KEY: 'k', RESET_EMAIL_FROM: 'AMV <hello@amv.test>' };
  await W.issueTokens(menv, 'reset@example.com', 'R');
  await menv.AMV_KV.put('user:reset@example.com', JSON.stringify({ email: 'reset@example.com', name: 'R' }));
  await call(menv, SITE + '/api/auth/reset', { method: 'POST', body: JSON.stringify({ email: 'reset@example.com' }) });
  globalThis.fetch = before;
  const mail = JSON.stringify(sent.at(-1) || {});
  ok(mail.includes(SITE + '/api/reset?token='), 'the emailed reset link goes through /api', mail.slice(0, 200));

  const js = await (await call(env, SITE + '/api/widget.js?k=abc')).text();
  ok(js.includes(SITE + '/#embed=1'), 'the chat widget embeds the app itself, not the server', (js.match(/https?:[^'"]*#embed[^'"]*/) || [''])[0]);
}

globalThis.fetch = realFetch;
if (report('the-api-at-the-sites-own-address') > 0) process.exitCode = 1;
done();
