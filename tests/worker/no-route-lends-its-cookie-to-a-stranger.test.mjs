/* NO ROUTE LENDS ITS COOKIE TO A STRANGER'S PAGE (Nov 3 audit SEC-009).

   AMV has two kinds of route: session routes, answered to AMV's own site
   with credentials, and open routes (API keys, the website widget, public
   reads), answered to any page and never with credentials. The split is
   tested on representative routes in a-locked-api-still-answers-the-widget-
   and-keys. This sweeps ALL of them, because the route that breaks it is the
   one nobody thought to pick.

   Every route the router names is called from a stranger's page, both as a
   request with no credentials and as one carrying an API-key-shaped bearer.
   For each answer:
     - one readable by any page (`Access-Control-Allow-Origin: *`) carries no
       Set-Cookie and does not allow credentials - a browser refuses that
       combination anyway, but a header that asks for it is a mistake waiting
       for a browser bug;
     - credentials are never allowed to the stranger's origin itself;
     - and the refresh cookie is never set in answer to a stranger at all. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const harness = join(__dir, '.build', 'corssweep.' + process.pid + '.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const SITE = 'https://amv.example', STRANGER = 'https://attacker-blog.example';
globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
const quiet = console.log, quietE = console.error, quietW = console.warn;
function mkEnv(extra) {
  const m = new Map();
  return { ...(extra || {}), JWT_SECRET: 'j'.repeat(40), APP_URL: SITE, AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', ADMIN_TOKEN: 'a'.repeat(40),
    AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };

const routes = [...new Set([...src.matchAll(/case\s+'(\/[^']*)'\s*:/g)].map(m => m[1]))].filter(p => !/[:*]/.test(p));

const MODES = [['ALLOWED_ORIGIN unset (the default)', {}], ['locked to the site (production)', { ALLOWED_ORIGIN: SITE }]];
for (const [label, extra] of MODES) {
section('Every route, asked by a stranger’s page - ' + label);
const bad = [];
let asked = 0, open = 0;
console.log = console.error = console.warn = () => {};
for (const path of routes) {
  for (const method of ['GET', 'POST', 'OPTIONS']) {
    for (const auth of [null, 'amv_sk_' + 'x'.repeat(40)]) {
      let r;
      try {
        r = await W.default.fetch(new Request('https://api.amv.example' + path, { method,
          headers: { 'Content-Type': 'application/json', Origin: STRANGER, 'CF-Connecting-IP': '30.0.' + (asked >> 8 & 255) + '.' + (asked & 255),
            ...(method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } : {}),
            ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
          body: method === 'POST' ? '{}' : undefined }), mkEnv(extra), ctx);
      } catch (e) { continue; }
      asked++;
      const acao = r.headers.get('Access-Control-Allow-Origin'), acac = r.headers.get('Access-Control-Allow-Credentials');
      const cookie = r.headers.get('Set-Cookie');
      if (acao === '*') open++;
      if (acao === '*' && (cookie || acac === 'true')) bad.push(`${method} ${path}${auth ? ' (key)' : ''}: open to any page AND ${cookie ? 'sets a cookie' : 'allows credentials'}`);
      if (acao === STRANGER && acac === 'true') bad.push(`${method} ${path}${auth ? ' (key)' : ''}: credentials allowed to the stranger’s origin`);
      if (cookie && /amv_rt|refresh/i.test(cookie)) bad.push(`${method} ${path}${auth ? ' (key)' : ''}: sets the sign-in cookie in answer to a stranger`);
    }
  }
}
console.log = quiet; console.error = quietE; console.warn = quietW;
ok(routes.length > 150, 'the router’s routes were found', routes.length);
ok(asked > routes.length * 4, 'and each was asked several ways', asked);
ok(open > 20, 'some answers really are open to any page, so the open half was exercised', open);
ok(bad.length === 0, 'no answer readable by a stranger carries a cookie or allows credentials', bad.slice(0, 15));
}

section('The sweep notices');
{
  const env = mkEnv({ ALLOWED_ORIGIN: SITE });
  const r = await W.default.fetch(new Request('https://api.amv.example/v1/messages', { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' } }), env, ctx);
  ok(r.headers.get('Access-Control-Allow-Origin') === SITE && r.headers.get('Access-Control-Allow-Credentials') === 'true',
    'AMV’s own site is still answered with credentials, so the rule above is not passing by refusing everybody');
}

report();
done();
