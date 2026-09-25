/* THE CACHE HOLDS ONLY WHAT IS PUBLIC, AND ONLY AMV'S IS RETIRED.
   (AMV-AUD-026, AMV-AUD-024)

   The service worker stored any same-origin GET that did not look personal:
   no Authorization header, and not credentials:'include'. But the browser's
   DEFAULT credentials mode is 'same-origin', which sends cookies without
   saying so - so a cookie-authenticated answer about one person, at any path
   nobody had thought to exclude, went into Cache Storage and outlived signing
   out. It now stores a LIST: the page, under one key, and the files the build
   publishes. Everything else passes through.

   And activating a new build deleted every cache on the origin that was not
   its own - somebody else's offline data, wherever AMV shares an origin. It
   now retires only caches under AMV's own prefix.

   A real Chromium, the real generated sw.js, a page it controls. This test
   server answers any unknown path with 200 - which is exactly the "cacheable
   basic response" the finding needed, so nothing about it is staged. */
import { chromium } from 'playwright';
import { serveApp, LAUNCH } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const { url, server } = await serveApp({ apiBase: '' });
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext();
const page = await ctx.newPage();

const controlled = () => page.evaluate(async () => {
  for (let i = 0; i < 150; i++) {
    if (navigator.serviceWorker.controller) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
});
const cached = () => page.evaluate(async () => {
  const out = {};
  for (const k of await caches.keys()) {
    const c = await caches.open(k);
    out[k] = (await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search);
  }
  return out;
});

try {
  await page.goto(url, { waitUntil: 'load' });
  ok(await controlled(), 'the worker takes control of the page', true);
  /* A second load so the worker, now in control, handles the navigation. */
  await page.goto(url + '/', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  section('Requests the worker knows nothing about are not stored');
  await page.evaluate(async () => {
    document.cookie = 'amv_session=someone-in-particular; path=/';
    /* The default credentials mode - the case the old rule missed. */
    await fetch('/data/my-account.json').then(r => r.text());
    await fetch('/api/jobs').then(r => r.text());
    await fetch('/api/jobs', { credentials: 'same-origin' }).then(r => r.text());
    await fetch('/something/else').then(r => r.text());
  });
  await page.waitForTimeout(400);
  const after = await cached();
  const all = [].concat(...Object.values(after));
  ok(!all.some(p => /my-account|\/api\/|something/.test(p)),
     'no answer from a path off the list is in the cache - this was the finding', after);

  section('What IS stored is the page, once, and the published files');
  await page.goto(url + '/settings/billing', { waitUntil: 'load' });
  await page.evaluate(async () => { await fetch('/manifest.webmanifest').then(r => r.text()); });
  await page.waitForTimeout(400);
  const now = await cached();
  const keys = [].concat(...Object.values(now));
  const allowed = new Set(['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/amv-bridge.mjs']);
  ok(keys.includes('/'), 'the page is stored, under the shell key', now);
  ok(keys.includes('/manifest.webmanifest'), 'a published file is stored', now);
  ok(keys.every(k => allowed.has(k)),
     'and nothing else - a navigation to another route is not a second copy of the page', now);

  section('A navigation that is not a page does not replace the page');
  /* Opening the manifest directly is a navigation, and it answers 200 with JSON.
     Stored under the shell key, it would become what every offline visit gets. */
  await page.goto(url + '/manifest.webmanifest', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  /* Read straight away, from the manifest's own document: going back to '/'
     first would store the real page again and hide what happened - which is
     how the first version of this section passed with the check removed. */
  const shellType = await page.evaluate(async () => {
    const hit = await caches.match('/');
    return hit ? (hit.headers.get('Content-Type') || '') : 'nothing stored';
  });
  ok(/text\/html/.test(shellType), 'the stored shell is still the page', shellType);
  await page.goto(url + '/', { waitUntil: 'load' });

  section('Offline, the page still opens');
  await ctx.setOffline(true);
  await page.goto(url + '/some/route', { waitUntil: 'load' }).catch(() => {});
  const alive = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
  ok(alive > 100, 'a route never visited is answered from the stored page', alive);
  /* AMV-AUD-025: a failed request with a query string used to be answered
     with the page, whatever it was - so a script or stylesheet asked for as
     `?v=2` came back as HTML and failed confusingly. Only a navigation gets
     the page now; anything else fails as what it is. */
  /* Refused at the network for real. Offline emulation let the worker's own
     request for the manifest through with a 200, so the first version of this
     check passed with the fix removed - it never saw a failed request at all. */
  await ctx.route(/\?v=/, (route) => route.abort('internetdisconnected'));
  const q = await page.evaluate(async () => {
    const one = async (u) => {
      try { const r = await fetch(u); return (r.headers.get('Content-Type') || '') + ' ' + r.status; }
      catch (e) { return 'network-error'; }
    };
    return { asset: await one('/manifest.webmanifest?v=2'), other: await one('/runtime.js?v=synthetic') };
  });
  ok(!/text\/html/.test(q.asset) && !/text\/html/.test(q.other),
     'offline, a non-page request with a query string is not handed the page', q);
  ok(q.asset === 'network-error', 'it fails as the request it was - so the network really was refused', q.asset);
  await ctx.unroute(/\?v=/);
  await ctx.setOffline(false);

  section('A stored copy is written inside the event, and a failed write is caught');
  /* AMV-AUD-029. Read from the source, because whether the browser stops a
     worker mid-write is its scheduling, not something a test can arrange; the
     BEHAVIOUR that depends on it - the page is stored and served offline - is
     measured above. */
  const swText = await (await fetch(url + '/sw.js')).text();
  ok(/e\.waitUntil\(caches\.open\(CACHE\)[\s\S]{0,120}\.put\([\s\S]{0,80}\.catch\(/.test(swText),
     'the cache write is handed to waitUntil, with a catch', (swText.match(/.*waitUntil\(caches.*/) || [''])[0].trim());

  section('Activating a build retires AMV’s old caches, and nobody else’s');
  /* A fresh profile whose caches exist BEFORE the worker first installs:
     another application's, and an AMV build from before. Re-registering in the
     first profile does not work - the live registration is reused and activate
     never runs again, which is how the first draft of this section failed. */
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    window.__seeded = (async () => {
      await (await caches.open('another-app-offline-data')).put('/theirs', new Response('keep me'));
      await (await caches.open('amv-oldbuild1')).put('/', new Response('an AMV build from before'));
    })();
  });
  const p2 = await ctx2.newPage();
  await p2.goto(url, { waitUntil: 'load' });
  const r = await p2.evaluate(async () => {
    await window.__seeded;
    for (let i = 0; i < 150; i++) {
      if (navigator.serviceWorker.controller) break;
      await new Promise(res => setTimeout(res, 100));
    }
    await new Promise(res => setTimeout(res, 300));
    return await caches.keys();
  });
  ok(r.includes('another-app-offline-data'), 'another application’s cache on the same origin survives', r);
  ok(!r.includes('amv-oldbuild1'), 'an old AMV cache is retired', r);
  await ctx2.close();
} finally {
  await browser.close();
  server.close();
}
report();
done();
