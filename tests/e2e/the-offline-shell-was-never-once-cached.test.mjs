/* AMV SHIPPED A SERVICE WORKER THAT DID NOTHING.

   `sw.js` excludes anything that arrived with a credential attached - "a
   request the browser sent an Authorization header or a cookie with is a
   request whose answer is about one person". Correct, except that a top-level
   navigation's credentials mode is "include" by specification, always, for
   every page load. So the guard returned early on every navigation, and the
   fetch handler never ran for the one request the whole file exists to serve.

   Nothing was ever put in the cache. The network-first path, the
   `caches.match(SHELL)` fallback, the manifest, the install prompt - all of it
   was reachable only in theory. A returning visitor who lost their connection
   got the browser's disconnected page.

   This is measured, not read: a real Chromium, the real generated sw.js, a
   second visit so the worker is actually in control, and then the network
   turned off. Nothing here stubs the service worker, because a stub would have
   agreed with the code the whole time it was broken. */
import { chromium } from 'playwright';
import { serveApp, LAUNCH } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const { url, server } = await serveApp({ apiBase: '' });
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext();
const page = await ctx.newPage();

try {
  section('The worker installs and takes control');
  await page.goto(url, { waitUntil: 'load' });
  const state = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw-api';
    for (let i = 0; i < 150; i++) {
      if (navigator.serviceWorker.controller) return 'controlled';
      await new Promise(r => setTimeout(r, 100));
    }
    return (await navigator.serviceWorker.getRegistration()) ? 'registered-not-controlling' : 'not-registered';
  });
  ok(state === 'controlled', 'it registers and claims the page', state);

  section('And the second visit actually goes through it');
  /* The first navigation happens before the worker is controlling - that is
     what skipWaiting plus clients.claim means - so the shell is cached on the
     visit after the one that installed it. That is normal for a network-first
     worker and is exactly why this suite loads the page twice. */
  await page.goto(url, { waitUntil: 'load' });
  const cached = await page.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      const out = [];
      for (const k of await caches.keys()) {
        for (const r of await (await caches.open(k)).keys()) out.push(r.url);
      }
      if (out.length) return out;
      await new Promise(r => setTimeout(r, 100));
    }
    return [];
  });
  ok(cached.length > 0, 'something is in the cache at all - this was empty', cached);
  ok(cached.some(u => new URL(u).pathname === '/'),
     'and it is the shell, which is what the offline fallback looks for', cached);

  section('So an offline reload serves the app instead of the browser error');
  await ctx.setOffline(true);
  let offline = null;
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 15000 });
    offline = { status: res && res.status(), title: await page.title() };
  } catch (e) {
    offline = { failed: String(e.message).split('\n')[0] };
  }
  ok(!offline.failed, 'the navigation succeeds with no connection', offline.failed || offline);
  ok(offline.status === 200, 'served out of the cache', offline.status);
  ok(/AMV/i.test(offline.title || ''), 'and it is the real page, not a stub', offline.title);

  section('The app itself is usable from that cached copy');
  /* A shell that loads but cannot boot is not an offline app. The page is one
     file, so if it painted, the whole product is there. */
  /* Guarded: with the fix removed the navigation above fails, and evaluating
     into a page that never arrived throws "execution context was destroyed" -
     a crash where the suite should be naming which assertion failed. */
  const alive = offline.failed
    ? { boot: false, api: false, body: 0 }
    : await page.evaluate(() => ({
        boot: typeof window.goApp === 'function',
        api: typeof window.AMV_API === 'object',
        body: document.body.innerText.length,
      }));
  ok(alive.boot && alive.api, 'the application code ran', alive);
  ok(alive.body > 100, 'and the page has real content on it', alive.body);

  await ctx.setOffline(false);

  section('The rule it broke is still enforced where it belongs');
  /* The exemption is for navigations only. A subresource fetched with
     credentials is still none of the cache business. */
  const swSrc = await (await fetch(url + '/sw.js')).text();
  ok(/req\.mode !== 'navigate' && req\.credentials === 'include'/.test(swSrc),
     'a credentialed non-navigation is still skipped', (swSrc.match(/.*credentials === 'include'.*/) || [''])[0].trim());
  ok(/if \(req\.headers\.get\('Authorization'\)\) return;/.test(swSrc),
     'and an Authorization header is still an outright skip, navigation or not');
  ok(/if \(url\.search\)/.test(swSrc),
     'while the URLs that really do carry a credential are still excluded by their query string');
} finally {
  await browser.close();
  server.close();
}

report();
done();
