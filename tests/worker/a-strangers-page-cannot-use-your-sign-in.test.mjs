/* A STRANGER'S PAGE CANNOT USE YOUR SIGN-IN.

   Scale audit, Oct 26, owner yes. AMV's renewal and trusted-device cookies
   are SameSite=None, so a browser attaches them to a request ANY page makes;
   CORS stops that page reading the answer, not the request doing its work.
   Through the real router, with a real sign-up's cookie:
     - from AMV's own page the cookie renews the sign-in, as always;
     - from another site's page the cookie is ignored: no renewal, no
       sign-out, and the person's sign-in still works afterwards;
     - a browser that sends only Sec-Fetch-Site is judged by it;
     - something that is not a browser (no Origin, no Sec-Fetch-Site) is
       unaffected - a forged request needs a browser;
     - with no origin configured, nothing changes. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'stranger-page.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8'));
const worker = (await import(harness + '?t=' + Date.now())).default;
globalThis.fetch = async () => new Response('{}', { status: 200 });

const SITE = 'https://amv.test', API = 'https://api.amv.test', EVIL = 'https://evil.example';
const mkEnv = (extra) => { const m = new Map(); return Object.assign({
  JWT_SECRET: 'x'.repeat(48), ALLOWED_ORIGIN: SITE, APP_URL: SITE,
  AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
}, extra || {}); };
const post = (env, path, { headers = {}, body = {} } = {}) => worker.fetch(new Request(API + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), env, { waitUntil() {} });
const cookieOf = (res, name) => {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('Set-Cookie') || ''];
  const c = all.find(x => x.startsWith(name + '=')); return c ? c.split(';')[0] : '';
};

const env = mkEnv();
const su = await post(env, '/auth/signup', { headers: { Origin: SITE }, body: { name: 'Ana', email: 'ana@example.com', password: 'A-real-Passw0rd!' } });
const sud = await su.json();
const rt = cookieOf(su, 'amv_rt');

section('The fixture is real');
{
  ok(su.status === 200 && !!sud.token, 'sign-up from AMV\'s page succeeded', { status: su.status, d: sud });
  ok(/^amv_rt=.+/.test(rt), 'and set the renewal cookie', rt.slice(0, 20));
}

section('From another site\'s page, the cookie does nothing');
{
  const r = await post(env, '/auth/refresh', { headers: { Origin: EVIL, Cookie: rt } });
  ok(r.status === 400 || r.status === 401, 'a renewal from a stranger\'s page is refused - it arrived with no cookie', r.status);
  const o = await post(env, '/auth/logout', { headers: { Origin: EVIL, Cookie: rt } });
  ok(o.status < 500, 'a sign-out from a stranger\'s page answers without error', o.status);
  const after = await post(env, '/auth/refresh', { headers: { Origin: SITE, Cookie: rt } });
  ok(after.status === 200 && !!(await after.json()).token, 'and the person\'s sign-in still renews from AMV\'s own page - nothing was signed out', after.status);
}

section('A browser that sends only Sec-Fetch-Site is judged by it');
{
  const env2 = mkEnv();
  const s2 = await post(env2, '/auth/signup', { headers: { Origin: SITE }, body: { name: 'Ben', email: 'ben@example.com', password: 'A-real-Passw0rd!' } });
  const c2 = cookieOf(s2, 'amv_rt');
  const cross = await post(env2, '/auth/refresh', { headers: { 'Sec-Fetch-Site': 'cross-site', Cookie: c2 } });
  ok(cross.status === 400 || cross.status === 401, 'cross-site: refused', cross.status);
  const same = await post(env2, '/auth/refresh', { headers: { 'Sec-Fetch-Site': 'same-site', Cookie: c2 } });
  ok(same.status === 200, 'same-site (the site and its api. host): renews', same.status);
}

section('Not a browser: unaffected');
{
  const env3 = mkEnv();
  const s3 = await post(env3, '/auth/signup', { headers: { Origin: SITE }, body: { name: 'Cy', email: 'cy@example.com', password: 'A-real-Passw0rd!' } });
  const r = await post(env3, '/auth/refresh', { headers: { Cookie: cookieOf(s3, 'amv_rt') } });
  ok(r.status === 200, 'a request with the cookie and neither browser header renews', r.status);
}

section('No origin configured: nothing changes');
{
  const env4 = mkEnv({ ALLOWED_ORIGIN: '', APP_URL: '' });
  const s4 = await post(env4, '/auth/signup', { body: { name: 'Di', email: 'di@example.com', password: 'A-real-Passw0rd!' } });
  const d4 = await s4.json();
  const r = await post(env4, '/auth/refresh', { headers: { Origin: EVIL }, body: { refreshToken: d4.refreshToken } });
  ok(r.status === 200, 'the body token still renews, as it always did in that mode', r.status);
}

if (report('a-strangers-page-cannot-use-your-sign-in') > 0) process.exitCode = 1;
done();
