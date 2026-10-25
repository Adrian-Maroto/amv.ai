/* A CITED SOURCE'S PICTURE IS FETCHED BY AMV - ONLY FROM A PUBLIC SITE, ONLY AS A PICTURE.

   /v1/source-preview takes a whole address from search results, which anybody
   who ranks for a query can shape, reads the picture the page names for its
   link previews (og:image), and serves that from AMV's own origin so the
   person's browser never visits the site. Checked by what the route actually
   FETCHED and SERVED:

     an address that is not https on a public hostname is refused before any
     fetch, and so is a picture the page names on one;
     a redirect into a network's inside is not followed;
     what is served is decided by its bytes - a JPEG labelled text/plain is a
     JPEG, and an SVG, an icon or a page labelled image/jpeg is not;
     only the head of a long page is read, and no picture larger than the cap
     is kept or served;
     a page is asked once, and a miss is remembered too. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'sourcepreview.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { };\n');
const W = await import(harness + '?t=' + Date.now());

const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 1, 2, 3, 4]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

/* The outside world, one handler per URL; every fetch is recorded. */
let fetched = [], routes = {};
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  fetched.push(u);
  const h = routes[u];
  if (!h) return new Response('nope', { status: 404 });
  return h(init || {});
};
const img = (bytes, type) => () => new Response(bytes, { status: 200, headers: { 'Content-Type': type } });

function mkEnv() {
  const m = new Map();
  return {
    AMV_KV: {
      async get(k, t) { if (!m.has(k)) return null; const v = m.get(k); return t === 'arrayBuffer' ? v : v; },
      async put(k, v) { m.set(k, v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v); },
      async delete(k) { m.delete(k); },
      async list() { return { keys: [], list_complete: true }; },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const preview = (env, url) => W.default.fetch(new Request('https://api.amv.test/v1/source-preview?url=' + encodeURIComponent(url),
  { headers: { 'CF-Connecting-IP': '66.66.66.66' } }), env, ctx);


const JPEG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 1, 2, 3]);
const html = (head) => () => new Response('<!doctype html><html><head>' + head + '</head><body>Hello</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });

section('The picture a page names is served as what its bytes are, from AMV, and only as a picture');
{
  const env = mkEnv(); fetched = [];
  routes = {
    'https://hotel.example.com/rooms/deluxe': html('<meta property="og:title" content="Deluxe"><meta property="og:image" content="/img/room.jpg?w=800&amp;h=450">'),
    'https://hotel.example.com/img/room.jpg?w=800&h=450': img(JPEG, 'text/plain'),
  };
  const r = await preview(env, 'https://hotel.example.com/rooms/deluxe#gallery');
  const body = new Uint8Array(await r.arrayBuffer());
  ok(r.status === 200 && r.headers.get('content-type') === 'image/jpeg', 'a relative og:image, labelled text/plain, is served as the JPEG it is', [r.status, r.headers.get('content-type'), fetched]);
  ok(body.length === JPEG.length && body[0] === 0xFF, 'byte for byte', body.length);
  ok(r.headers.get('x-content-type-options') === 'nosniff' && /default-src 'none'/.test(r.headers.get('content-security-policy') || ''),
     'and served so that it can only ever be an image', [r.headers.get('x-content-type-options'), r.headers.get('content-security-policy')]);
  fetched = [];
  const again = await preview(env, 'https://hotel.example.com/rooms/deluxe');
  ok(again.status === 200 && fetched.length === 0, 'the next person who sees it costs the site nothing: it came from the cache', fetched);
}

section('A twitter:image is used when there is no og:image');
{
  const env = mkEnv(); fetched = [];
  routes = {
    'https://shop.example.com/p/1': html('<meta name="twitter:image" content="https://cdn.example.com/p1.jpg">'),
    'https://cdn.example.com/p1.jpg': img(JPEG, 'image/jpeg'),
  };
  const r = await preview(env, 'https://shop.example.com/p/1');
  ok(r.status === 200, 'served', r.status);
}

section('Nothing that is not https on a public hostname is fetched at all');
{
  const env = mkEnv();
  for (const u of ['http://news.example.org/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.5/', 'https://169.254.169.254/latest/meta-data/',
                   'https://[::1]/', 'https://printer.local/x', 'https://db.internal/x', 'https://news.example.org:8443/a', 'https://user:pw@news.example.org/a',
                   'https://10.0.0.7.nip.io/', 'file:///etc/passwd', 'javascript:alert(1)', 'news.example.org/a', '', 'https://example.com/' + 'a'.repeat(2100)]) {
    fetched = [];
    const r = await preview(env, u);
    ok(r.status === 404 && fetched.length === 0, '"' + u.slice(0, 60) + '" is refused before any fetch', [r.status, fetched]);
  }
}

section('A picture the page names inside a network is never requested');
{
  const env = mkEnv(); fetched = [];
  routes = {
    'https://evil.example.com/a': html('<meta property="og:image" content="http://169.254.169.254/latest/meta-data/"><meta name="twitter:image" content="https://10.0.0.7/x.jpg">'),
  };
  const r = await preview(env, 'https://evil.example.com/a');
  ok(r.status === 404, 'no preview', r.status);
  ok(!fetched.some(u => /169\.254|10\.0\.0\.7/.test(u)), 'and neither internal address was ever requested', fetched);
}

section('A redirect into a network’s inside is not followed');
{
  const env = mkEnv(); fetched = [];
  routes = {
    'https://sneaky.example.net/a': () => new Response(null, { status: 302, headers: { Location: 'https://10.0.0.7/' } }),
    'https://sneaky2.example.net/a': html('<meta property="og:image" content="https://sneaky2.example.net/i.jpg">'),
    'https://sneaky2.example.net/i.jpg': () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } }),
  };
  const r1 = await preview(env, 'https://sneaky.example.net/a');
  const r2 = await preview(env, 'https://sneaky2.example.net/a');
  ok(r1.status === 404 && r2.status === 404, 'no preview either way', [r1.status, r2.status]);
  ok(!fetched.some(u => /169\.254|10\.0\.0\.7/.test(u)), 'and neither internal address was ever requested', fetched);
}

section('An SVG, an icon, or a page in disguise is never served from AMV’s origin');
{
  const env = mkEnv(); fetched = [];
  routes = {
    'https://a.example.com/x': html('<meta property="og:image" content="/logo.svg">'),
    'https://b.example.com/x': html('<meta property="og:image" content="/b.jpg">'),
    'https://b.example.com/b.jpg': img(SVG, 'image/jpeg'),
    'https://c.example.com/x': html('<meta property="og:image" content="/c.jpg">'),
    'https://c.example.com/c.jpg': img(new TextEncoder().encode('<html>not a picture</html>'), 'image/jpeg'),
    'https://d.example.com/x': html('<meta property="og:image" content="/favicon.ico">'),
    'https://d.example.com/favicon.ico': img(ICO, 'image/x-icon'),
  };
  for (const h of ['a', 'b', 'c', 'd']) {
    const r = await preview(env, 'https://' + h + '.example.com/x');
    ok(r.status === 404, h + ': refused', r.status);
  }
  ok(!fetched.includes('https://a.example.com/logo.svg'), 'and an SVG the page named was not even fetched', fetched);
  fetched = [];
  const again = await preview(env, 'https://c.example.com/x');
  ok(again.status === 404 && fetched.length === 0, 'the miss is remembered, so the page is not asked again by every viewer', fetched);
}

section('Only the head of a long page is read, and nothing larger than the cap is kept');
{
  const env = mkEnv(); fetched = [];
  const long = '<!doctype html><html><head><meta property="og:image" content="/big.jpg"><meta property="og:image" content="/never.jpg"></head><body>' + 'x'.repeat(2 * 1024 * 1024) + '</body></html>';
  routes = {
    'https://long.example.com/a': () => new Response(long, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    'https://long.example.com/big.jpg': () => { const b = new Uint8Array(400 * 1024); b.set(JPEG); return new Response(b, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }); },
    'https://ok.example.com/a': () => new Response(long.replace('/big.jpg', '/ok.jpg'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
    'https://ok.example.com/ok.jpg': img(JPEG, 'image/jpeg'),
  };
  const big = await preview(env, 'https://long.example.com/a');
  ok(big.status === 404, 'a 400KB picture is refused', big.status);
  const fine = await preview(env, 'https://ok.example.com/a');
  ok(fine.status === 200, 'and a 2MB page still yields the picture in its head - only the head was needed', fine.status);
}

if (report('a-source-picture-is-fetched-by-amv') > 0) process.exitCode = 1;
done();
