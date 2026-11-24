/* A CONNECTOR'S LOGO IS ONLY EVER AN IMAGE.

   /v1/connector-logo is public: it takes an id from the connector directory,
   fetches the GitHub picture of whoever published it and serves it from AMV's
   own address. It had no suite. It trusted the Content-Type the far end sent
   and served the result without the two headers its siblings send, so the
   only thing keeping a page off AMV's address was GitHub's honesty.

   Checked by what the route FETCHED and SERVED:
     an id that is not io.github.<user>/... fetches nothing;
     what is served is decided by its bytes - a page labelled image/png is
     refused, a PNG is served as one;
     it is served so it can only ever be an image (nosniff, a sandboxing CSP),
     from the cache as well as the first time. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'clogo.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { };\n');
const W = await import(harness + '?t=' + Date.now());

const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9, 9, 9]);
const PAGE = new TextEncoder().encode('<html><script>alert(1)</script></html>');

let fetched = [], routes = {};
globalThis.fetch = async (url) => {
  const u = String(url && url.url ? url.url : url);
  fetched.push(u);
  const h = routes[u];
  return h ? h() : new Response('nope', { status: 404 });
};
const img = (bytes, type) => () => new Response(bytes, { status: 200, headers: { 'Content-Type': type } });

function mkEnv() {
  const m = new Map();
  return {
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v); },
      async delete(k) { m.delete(k); },
      async list() { return { keys: [], list_complete: true }; },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const logo = (env, id) => W.default.fetch(new Request('https://api.amv.test/v1/connector-logo?id=' + encodeURIComponent(id),
  { headers: { 'CF-Connecting-IP': '66.66.66.67' } }), env, ctx);
const AVATAR = (u) => 'https://github.com/' + u + '.png?size=128';
const imageOnly = (r) => r.headers.get('x-content-type-options') === 'nosniff'
  && /default-src 'none'/.test(r.headers.get('content-security-policy') || '');

section('A real picture is served as one, and only as an image');
{
  const env = mkEnv(); fetched = [];
  routes = { [AVATAR('octo')]: img(PNG, 'image/png') };
  const r = await logo(env, 'io.github.octo/weather');
  ok(r.status === 200 && r.headers.get('content-type') === 'image/png', 'a PNG is served as a PNG', [r.status, r.headers.get('content-type')]);
  ok(imageOnly(r), 'served so it can only ever be an image', [r.headers.get('x-content-type-options'), r.headers.get('content-security-policy')]);
  fetched = [];
  const again = await logo(env, 'io.github.octo/weather');
  ok(again.status === 200 && fetched.length === 0, 'the second time comes from the cache', fetched);
  ok(imageOnly(again), 'and the cached copy is served the same way', [again.headers.get('x-content-type-options')]);
}

section('A page labelled as a picture is not served');
{
  const env = mkEnv(); fetched = [];
  routes = { [AVATAR('mallory')]: img(PAGE, 'image/png') };
  const r = await logo(env, 'io.github.mallory/tool');
  ok(r.status === 404, 'its bytes decide, not its label', r.status);
}

section('An id that is not a GitHub publisher fetches nothing');
{
  const env = mkEnv();
  for (const id of ['com.example/tool', 'io.github./x', 'io.github.a..b/x', 'https://evil.test/x.png', '../../etc']) {
    fetched = [];
    const r = await logo(env, id);
    ok(r.status === 404 && fetched.length === 0, 'refused without a fetch: ' + id, [r.status, fetched]);
  }
}

report();
done();
