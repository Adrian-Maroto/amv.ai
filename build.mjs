/*
 * AMV build - assembles the single-file index.html from app.js + styles.css.
 *
 *   node build.mjs          # rebuild index.html
 *   node build.mjs check    # syntax-check app.js and the assembled JS only
 *
 * Performance: the main script is injected between the BUILD:JS markers as a
 * NON-render-blocking deferred script. The JS body is placed in a
 * <script type="text/plain"> (the browser does NOT parse/execute inert text),
 * then a tiny bootstrap turns it into a deferred Blob-URL <script>. This lets
 * the static landing HTML + CSS paint immediately (fast first paint) while the
 * ~790KB app parses in the background - without breaking the single-file app
 * (still one index.html, no external requests, global scope + strict mode
 * preserved, DOM fully available when the code runs).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { deflateSync as zlibDeflate } from 'zlib';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const cmd = args.find(a => !a.startsWith('--')) || 'build';
/* Minified by DEFAULT. index.html is the artifact users download - 2.3MB
   plain, 1.8MB minified, 690KB vs 516KB over the wire - and app.js is written
   unminified beside it either way, which is what check, preflight and grep
   read. So the readable copy is kept where it is actually used, and the copy
   that crosses the network is the small one. --no-minify opts out. */
const MINIFY = !args.includes('--no-minify');

// The app SOURCE is modular: src/app/NN-name.js files, concatenated in name
// order, form the single app bundle. app.js is the GENERATED concatenation of
// those modules - it stays committed so check.mjs / preflight / grep keep
// working unchanged. IMPORTANT: do NOT hand-edit app.js; edit the src/app/
// modules and rebuild (the build overwrites app.js from them).
const APP_SRC_DIR = 'src/app';
function assembleJS() {
  const files = readdirSync(APP_SRC_DIR).filter(f => /\.js$/.test(f)).sort();
  if (!files.length) throw new Error(`no source modules found in ${APP_SRC_DIR}/`);
  const src = files.map(f => readFileSync(`${APP_SRC_DIR}/${f}`, 'utf8')).join('');
  writeFileSync('app.js', src);   // regenerate the committed bundle from the modules
  return src;
}

// Optionally minify with terser. Kept opt-in (--minify) so the default build
// stays readable/debuggable; a production build can ship the smaller bundle.
// The minified code is always syntax-validated before use, and the build
// refuses to ship if terser errors.
async function minifyJS(code) {
  const { minify } = await import('terser');
  const result = await minify(code, {
    ecma: 2020,
    compress: { passes: 2, drop_debugger: true },
    mangle: { keep_fnames: false },
    format: { comments: false },
    // Keep top-level names reachable: the app relies on many globals being
    // referenced by name across the single script (and from the deferred blob).
    toplevel: false,
  });
  if (result.error) throw result.error;
  if (!result.code) throw new Error('terser produced no output');
  return result.code;
}

function validate(js) {
  writeFileSync('/tmp/_amv_check.js', js);
  execSync('node --check /tmp/_amv_check.js', { stdio: 'pipe' });
}

async function rebuild() {
  let html = readFileSync('index.html', 'utf8');
  const source = assembleJS();
  const css = readFileSync('styles.css', 'utf8');

  // 1) validate the source JS before doing anything - never ship a broken build
  validate(source);

  // Optionally minify. The minified code must still parse; validate it too.
  let app = source;
  if (MINIFY) {
    app = await minifyJS(source);
    validate(app);
    console.log(`Minified: ${(source.length/1024).toFixed(0)}KB -> ${(app.length/1024).toFixed(0)}KB`);
  }

  // 2) CSS between markers
  const cssPat = /(<!-- BUILD:CSS:START -->\s*<style>)([\s\S]*?)(<\/style>\s*<!-- BUILD:CSS:END -->)/;
  if (!cssPat.test(html)) throw new Error('CSS build markers not found');
  // NOTE: use a replacer FUNCTION (not a string) so `$` sequences in the CSS
  // are inserted literally and never interpreted as replacement patterns.
  html = html.replace(cssPat, (m, a, _b, c) => a + '\n' + css + '\n' + c);

  // 3) JS between markers - deferred, non-render-blocking pattern.
  //    The app code goes in an inert <script type="text/plain"> and a tiny
  //    launcher converts it to a deferred Blob script so it never blocks paint.
  //    Defensive: escape any literal </script that would otherwise terminate the
  //    text/plain block early; the launcher restores it before execution. This
  //    keeps the build correct even if future code embeds a literal script tag.
  const SCRIPT_SENTINEL = '<\\/scr_AMV_ipt';
  const appSafe = app.replace(/<\/script/gi, SCRIPT_SENTINEL);
  const launcher =
    "(function(){var c=document.getElementById('amv-app-code');if(!c)return;" +
    "var code=c.textContent.split('<\\\\/scr_AMV_ipt').join('</script');" +
    "function inlineRun(){var e=document.createElement('script');e.textContent=code;document.body.appendChild(e);}" +
    "try{var s=document.createElement('script');" +
    "s.src=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));" +
    "s.defer=true;s.onerror=inlineRun;document.body.appendChild(s);}" +
    "catch(e){inlineRun();}})();";

  const jsPat = /(<!-- BUILD:JS:START -->)[\s\S]*?(<!-- BUILD:JS:END -->)/;
  if (!jsPat.test(html)) throw new Error('JS build markers not found');
  const jsBlock =
    '<!-- BUILD:JS:START -->\n' +
    '<script id="amv-app-code" type="text/plain">\n' + appSafe + '\n</script>\n' +
    '<script>' + launcher + '</script>\n' +
    '<!-- BUILD:JS:END -->';
  // Replacer FUNCTION so `$` / `$'` / `$&` sequences inside the app code are
  // inserted verbatim (a replacement STRING would corrupt them).
  html = html.replace(jsPat, () => jsBlock);

  /* THE BACKEND ADDRESS THE SHIPPED ARTIFACT TALKS TO.

     Without this the app reads amv_api_base from localStorage and finds
     nothing, so every visitor who is not the owner gets the local demo: no
     engine, no server account, and no way to pay. Pass it at build time -

         AMV_API_BASE=https://amv-backend.you.workers.dev node build.mjs

     - or write it straight into the meta tag in index.html. An https origin
     only, because the token is bound to the origin that issued it and the app
     refuses to attach it to anything else. */
  const apiBase = (process.env.AMV_API_BASE || '').trim().replace(/\/+$/, '');
  if (apiBase) {
    if (!/^https:\/\/[^\s"'<>]+$/.test(apiBase)) {
      throw new Error('AMV_API_BASE must be an https:// URL - got: ' + apiBase);
    }
    const metaPat = /<meta name="amv-api-base" content="[^"]*"><!-- BUILD:APIBASE -->/;
    if (!metaPat.test(html)) throw new Error('amv-api-base meta marker not found');
    html = html.replace(metaPat,
      () => '<meta name="amv-api-base" content="' + apiBase + '"><!-- BUILD:APIBASE -->');
    console.log('Backend baked in: ' + apiBase);
  }

  // 4) validate the assembled code BEFORE writing - a broken build must never
  //    overwrite a working index.html. Extract the emitted code, un-escape the
  //    sentinel, and syntax-check it. Only write if it passes.
  const m = html.match(/<script id="amv-app-code" type="text\/plain">\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('assembled app code block not found - aborting write');
  validate(m[1].split(SCRIPT_SENTINEL).join('</script'));

  // Sanity: the embedded code must exactly equal what we intended to embed
  // (the source, or its minified form) - guards against replacement corruption.
  if (m[1].split(SCRIPT_SENTINEL).join('</script') !== app) {
    throw new Error('assembled code does not match intended bundle - aborting write');
  }

  writeFileSync('index.html', html);
  writePWA(html);
  console.log(`Built index.html - deferred non-blocking script${MINIFY ? ', minified' : ''}, validated OK.`);
}

/* THE TWO FILES A PWA CANNOT DO WITHOUT.

   AMV ships as a single file and the PWA used to be built out of Blobs to keep
   it that way - which is why it never worked once: a service worker script may
   not be a blob: URL, browsers refuse the registration outright, and the
   refusal was swallowed. There is no version of a working PWA that lives
   inside one HTML file, so these are emitted beside it.

   Both are tiny, static and rebuilt every time, so they cannot drift from the
   page they belong to. */
function writePWA(html) {
  /* The cache name carries a fingerprint of what was actually built. A fixed
     name means an old cache is never cleaned and a visitor can be served last
     month's app for ever; a changing one retires itself on the next activate. */
  let stamp = 0;
  for (let i = 0; i < html.length; i++) stamp = (stamp * 31 + html.charCodeAt(i)) >>> 0;
  const CACHE = 'amv-' + stamp.toString(36);

  const sw = `/* AMV service worker - generated by build.mjs, do not edit. */
const CACHE = '${CACHE}';
const SHELL = '/';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  /* Retire every cache that is not this build's. Without this the old ones sit
     there for ever and a visitor can be served an app that no longer exists. */
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* Never the API. A cached answer about somebody's plan, balance or messages
     is worse than no answer, and a cached POST-shaped GET is a wrong one. */
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/auth/')) return;

  /* NETWORK FIRST, cache as the fallback.

     The opposite - cache first - is what most offline shells do and it is
     wrong for a single-file app: every returning visitor runs the previous
     build, so the deploy that fixes a broken checkout does not reach the
     person hitting it, and a bad cached page survives redeploying. This way
     offline still works and nobody is ever a version behind. */
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match(SHELL);
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
`;
  writeFileSync('sw.js', sw);

  const manifest = {
    name: 'AMV.AI',
    short_name: 'AMV',
    description: 'The AI workforce that does the work, not just answers it.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#232429',
    theme_color: '#4478e8',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync('manifest.webmanifest', JSON.stringify(manifest, null, 2));

  /* Real PNGs, because installability wants a raster icon and an SVG is
     refused by some installers. Written only if absent so a designed icon is
     never overwritten by this placeholder. */
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
    if (!existsSync(file)) writeFileSync(file, solidPng(size));
  }
}

/* A minimal valid PNG: one solid colour, no dependencies. Enough to satisfy an
   installer, and obviously a placeholder to a human. */
function solidPng(size) {
  const crcTable = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(
    Array.from({ length: size }, () => Buffer.from([0x44, 0x78, 0xe8])))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = zlibDeflate(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (cmd === 'check') {
  validate(assembleJS());
  console.log('app.js syntax OK');
} else {
  rebuild().catch(err => { console.error('BUILD FAILED:', err.message); process.exit(1); });
}
