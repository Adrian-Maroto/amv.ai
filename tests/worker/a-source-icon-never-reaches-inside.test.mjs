/* A SOURCE'S ICON IS FETCHED BY AMV - AND ONLY EVER FROM A PUBLIC SITE, AND ONLY AS AN IMAGE.

   /v1/site-icon takes a host that came from search results, which anybody who
   ranks for a query can shape. Every property that makes that safe is checked
   by what the route actually FETCHED and SERVED, not by what it returned:

     anything that is not a public hostname is refused before a single fetch -
     localhost, IP addresses, ports, internal names, URLs;
     a redirect into the inside of a network is not followed;
     what is served is decided by its bytes: an icon labelled text/plain is an
     icon, and an SVG or a page labelled image/png is not;
     it is never larger than the cap, and is served so that it can only ever
     be an image;
     a site is asked once, and a miss is remembered too. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'siteicon.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { };\n');
const W = await import(harness + '?t=' + Date.now());

const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9, 9, 9]);
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
const icon = (env, host) => W.default.fetch(new Request('https://api.amv.test/v1/site-icon?host=' + encodeURIComponent(host),
  { headers: { 'CF-Connecting-IP': '66.66.66.66' } }), env, ctx);

section('An icon is served as what its bytes are, from AMV, and only as an image');
{
  const env = mkEnv(); fetched = [];
  routes = { 'https://news.example.org/favicon.ico': img(ICO, 'text/plain') };
  const r = await icon(env, 'news.example.org');
  const body = new Uint8Array(await r.arrayBuffer());
  ok(r.status === 200 && r.headers.get('content-type') === 'image/x-icon', 'an icon labelled text/plain is served as the icon it is', [r.status, r.headers.get('content-type')]);
  ok(body.length === ICO.length && body[2] === 1, 'byte for byte', body.length);
  ok(r.headers.get('x-content-type-options') === 'nosniff' && /default-src 'none'/.test(r.headers.get('content-security-policy') || ''),
     'and served so that it can only ever be an image', [r.headers.get('x-content-type-options'), r.headers.get('content-security-policy')]);
  fetched = [];
  const again = await icon(env, 'news.example.org');
  ok(again.status === 200 && fetched.length === 0, 'the second person who sees it costs the site nothing: it came from the cache', fetched);
}

section('Nothing that is not a public hostname is fetched at all');
{
  const env = mkEnv();
  for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]', 'printer.local', 'db.internal',
                   'news.example.org:8443', 'https://news.example.org/', 'a..b.com', 'x', 'mail.corp', '10.0.0.7.nip.io', '192.168.1.1.sslip.io', '127.0.0.1.example.com']) {
    fetched = [];
    const r = await icon(env, h);
    ok(r.status === 404 && fetched.length === 0, '"' + h + '" is refused before any fetch', [r.status, fetched]);
  }
}

section('A redirect into a network’s inside is not followed');
{
  const env = mkEnv(); fetched = [];
  routes = {
    'https://sneaky.example.net/favicon.ico': () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } }),
    'https://sneaky.example.net/': () => new Response(null, { status: 302, headers: { Location: 'https://10.0.0.7/' } }),
  };
  const r = await icon(env, 'sneaky.example.net');
  ok(r.status === 404, 'no icon', r.status);
  ok(!fetched.some(u => /169\.254|10\.0\.0\.7/.test(u)), 'and neither internal address was ever requested', fetched);
}

section('An SVG, or a page in disguise, is never served from AMV’s origin');
{
  const env = mkEnv(); fetched = [];
  routes = {
    'https://svgsite.example.com/favicon.ico': img(SVG, 'image/svg+xml'),
    'https://svgsite.example.com/': () => new Response('<html><head><link rel="icon" href="/logo.svg"><link rel="icon" href="https://cdn.example.com/i.png"></head></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    'https://cdn.example.com/i.png': img(new TextEncoder().encode('<html>not an image</html>'), 'image/png'),
  };
  const r = await icon(env, 'svgsite.example.com');
  ok(r.status === 404, 'an SVG favicon and a page labelled image/png are both refused', r.status);
  ok(!fetched.includes('https://svgsite.example.com/logo.svg'), 'and the SVG the page named was not even fetched', fetched);
  fetched = [];
  const again = await icon(env, 'svgsite.example.com');
  ok(again.status === 404 && fetched.length === 0, 'the miss is remembered, so the site is not asked again by every viewer', fetched);
}

section('The icon a page names for itself is used when /favicon.ico is not one');
{
  const env = mkEnv(); fetched = [];
  routes = {
    'https://modern.example.com/': () => new Response('<html><head><link rel="apple-touch-icon" href="/t.png"><link rel="shortcut icon" href="/static/fav.png?v=2"></head></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    'https://modern.example.com/static/fav.png?v=2': img(PNG, 'image/png'),
  };
  const r = await icon(env, 'modern.example.com');
  ok(r.status === 200 && r.headers.get('content-type') === 'image/png', 'the linked PNG is served', [r.status, r.headers.get('content-type')]);
}

section('Nothing larger than the cap is kept or served');
{
  const env = mkEnv(); fetched = [];
  const big = new Uint8Array(200 * 1024); big.set(PNG);
  routes = { 'https://huge.example.com/favicon.ico': img(big, 'image/png') };
  const r = await icon(env, 'huge.example.com');
  ok(r.status === 404, 'a 200KB "icon" is refused', r.status);
}

if (report('a-source-icon-never-reaches-inside') > 0) process.exitCode = 1;
done();
