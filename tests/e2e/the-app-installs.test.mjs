/* THE PWA NEVER WORKED, AND ITS OWN COMMENT EXPLAINED WHY.

       PWA: register a web manifest + service worker at runtime ... Built
       entirely from Blobs so the single-file app needs no extra files on the
       server.

   A service worker script may not be a blob: URL. Every browser refuses it:

       Failed to register a ServiceWorker: The URL protocol of the script
       ('blob:https://...') is not supported.

   and the registration ended in `.catch(()=>{})`, so that refusal was
   swallowed on every page load since the feature was written. A blob manifest
   is not installable either, and `beforeinstallprompt` needs both halves - so
   it never fired, the install chip nobody ever saw never appeared, and nothing
   looked broken. Meanwhile the changelog said "Install AMV as an app on your
   phone or desktop (PWA)" and Help offered offline use.

   There is no version of a working PWA that lives inside one HTML file, so the
   build emits sw.js, manifest.webmanifest and the icons beside it.

   The most important case here is the last one. A cache-first worker over a
   single-file app means every returning visitor runs the PREVIOUS build - the
   deploy that fixes a broken checkout never reaches the person hitting it -
   and a bad cached page survives redeploying, which is the one bug you cannot
   fix by shipping again. */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

section('The files a PWA cannot do without are actually built');
{
  for (const f of ['sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']) {
    ok(existsSync(join(ROOT, f)), f + ' is emitted beside index.html', true);
  }
  const m = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok(m.start_url === '/' && m.display === 'standalone',
     'the manifest asks to be installed as an app', { start_url: m.start_url, display: m.display });
  ok(m.icons.some(i => /512/.test(i.sizes)) && m.icons.some(i => /192/.test(i.sizes)),
     'with both icon sizes an installer requires', m.icons.map(i => i.sizes));
  ok(m.icons.every(i => i.type === 'image/png'),
     'as PNGs, because some installers refuse an SVG', m.icons.map(i => i.type));

  /* Real PNGs, not text with a .png name - the failure that looks fine in a
     directory listing and is refused at install time. */
  const png = readFileSync(join(ROOT, 'icon-192.png'));
  ok(png.slice(0, 8).toString('hex') === '89504e470d0a1a0a', 'the icon is a real PNG', true);
  ok(png.readUInt32BE(16) === 192, 'of the size it claims', png.readUInt32BE(16));
}

section('Nothing is built out of a blob any more');
{
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = app.indexOf('function _initPWA');
  const fn = at < 0 ? '' : app.slice(at, at + 1600);
  ok(at >= 0, 'the PWA setup was found', at >= 0);
  ok(/register\(\s*['"]\/sw\.js['"]/.test(fn),
     'the service worker is registered from a real same-origin file', true);
  ok(!/createObjectURL/.test(fn),
     'and nothing is handed to the browser as a blob', true);
  ok(/manifest\.webmanifest/.test(fn), 'the manifest is a real file too', true);
}

section('A registration failure is reported, not swallowed');
{
  /* The reason this survived. `.catch(()=>{})` on a call that could never
     succeed is indistinguishable from one that always does. */
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = app.indexOf('function _initPWA');
  const fn = app.slice(at, at + 1600);
  const reg = fn.slice(fn.indexOf('register('), fn.indexOf('register(') + 220);
  ok(!/catch\s*\(\s*\)\s*=>\s*\{\s*\}/.test(reg) && !/catch\(\(\)=>\{\}\)/.test(reg),
     'the catch does something with the error', reg.slice(0, 120));
  ok(/_logErr/.test(reg), 'it reaches the error log', true);
}

section('The worker really registers in a real browser');
{
  /* The assertion that would have caught this on day one: not "is there code
     to register a service worker" but "does the browser accept it". */
  const L = await bootLive({ env: makeEnv(), outbound: makeOutbound(), port: 9173 });
  const r = await L.page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { skip: 'no serviceWorker here' };
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      return { ok: true, scope: reg.scope };
    } catch (e) { return { ok: false, err: String(e && e.message).slice(0, 200) }; }
  });
  ok(!r.skip, 'the browser supports service workers', r.skip || true);
  ok(r.ok === true, 'and accepts AMV’s', r.err || r.scope);

  /* The old way, side by side, so the reason is on the record rather than in a
     commit message. */
  const blob = await L.page.evaluate(async () => {
    const u = URL.createObjectURL(new Blob(["self.addEventListener('fetch',()=>{});"], { type: 'text/javascript' }));
    try { await navigator.serviceWorker.register(u); return { ok: true }; }
    catch (e) { return { ok: false, err: String(e && e.message).slice(0, 120) }; }
  });
  ok(blob.ok === false,
     'while the blob: URL it used to use is refused, as it always was', blob.err);
  await L.close();
}

section('It is NETWORK FIRST, so nobody is ever a version behind');
{
  /* The whole product is one HTML file. A cache-first worker over that means
     every returning visitor runs the previous build until they reload twice,
     so shipping a fix does not reach the person the fix is for - and a broken
     cached page cannot be fixed by deploying again, which is the worst
     property any bug can have. */
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const fetchBlock = sw.slice(sw.indexOf("addEventListener('fetch'"));
  const netFirst = fetchBlock.indexOf('await fetch(req)');
  const cacheFall = fetchBlock.indexOf('caches.match(req)');
  ok(netFirst >= 0 && cacheFall >= 0, 'both paths exist', { netFirst, cacheFall });
  ok(netFirst < cacheFall,
     'the network is tried BEFORE the cache, not after', { netFirst, cacheFall });
  ok(/catch/.test(fetchBlock.slice(netFirst, cacheFall)),
     'and the cache is reached only when the network fails, which is offline', true);
}

section('It never caches the API');
{
  /* A cached answer about somebody’s plan, balance or messages is worse than
     no answer at all. */
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  ok(/pathname\.startsWith\('\/v1\/'\)/.test(sw), 'API paths are skipped', true);
  ok(/pathname\.startsWith\('\/auth\/'\)/.test(sw), 'and so is auth', true);
  ok(/url\.origin !== self\.location\.origin/.test(sw),
     'and anything on another origin, which is where the backend lives', true);
  ok(/req\.method !== 'GET'/.test(sw), 'and nothing that is not a GET', true);
}

section('Old caches are retired, so a stale app cannot outlive a deploy');
{
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  ok(/caches\.keys\(\)/.test(sw) && /caches\.delete/.test(sw),
     'activate clears every cache that is not this build’s', true);
  /* And the name has to CHANGE between builds, or clearing it clears nothing. */
  const name = (sw.match(/const CACHE = '([^']+)'/) || [])[1] || '';
  ok(/^amv-[0-9a-z]+$/.test(name) && name !== 'amv-v1',
     'and the cache name is stamped from what was built', name);
}

if (report('the-app-installs') > 0) process.exitCode = 1;
done();
