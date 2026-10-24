/* Shared test harness: serves the built app and boots it into a known state.
   Every e2e test uses this so a boot-sequence change breaks one file, not twenty. */
import * as playwright from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
export const APP = join(__dir, '..', '..', 'index.html');


/* WHICH CHROMIUM TO DRIVE.

   Playwright downloads a browser build pinned to its own version and refuses
   to launch anything else it did not put there. Some machines - CI images and
   sandboxes among them - ship a browser already and set
   PLAYWRIGHT_BROWSERS_PATH at it, and if the installed Playwright is even
   slightly newer than that image, it looks for a build number that is not
   present and every end-to-end suite dies at launch with no output at all.

   That is what it did: ninety-five suites failed identically, none of them
   printing a line, and it read like ninety-five regressions rather than one
   missing file.

   So: use the browser the machine provides when there is one, and otherwise
   let Playwright find its own. A no-op on a normal machine, and the difference
   between a working suite and no suite on a provisioned one. */
function providedChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base) return '';
  for (const p of [join(base, 'chromium'),
                   join(base, 'chromium', 'chrome-linux', 'chrome')]) {
    try { if (existsSync(p) && statSync(p).isFile()) return p; } catch (e) {}
  }
  return '';
}
/* WHICH ENGINE. Chromium unless AMV_BROWSER names another - the WebKit and
   Firefox lane (scripts/browser-lane.mjs, .github/workflows/browsers.yml)
   runs the same suites through Safari's and Firefox's engines. */
export const ENGINE = ['chromium', 'webkit', 'firefox'].includes(process.env.AMV_BROWSER) ? process.env.AMV_BROWSER : 'chromium';
export const BROWSER = playwright[ENGINE];
export const chromium = playwright.chromium;
/* The page's policy says upgrade-insecure-requests, which is right for a site
   served over https. Chromium and Firefox leave a loopback address alone;
   WebKit upgrades it, so every file the page fetches from this plain-http test
   server went to https on a port that does not speak it and failed with "Load
   failed". Only the test server is plain http, so only here, and only for
   WebKit, the one directive is dropped - the rest of the policy is unchanged. */
export function forEngine(html){
  if (ENGINE !== 'webkit') return html;
  return Buffer.from(String(html).replace(/upgrade-insecure-requests;?/, ''), 'utf8');
}
/* GOOGLE'S SIGN-IN SCRIPT IS UNREACHABLE IN EVERY SUITE, ON PURPOSE.

   Until LESSONS 604 every suite ran with that script refused - a crossorigin
   attribute made the browser reject it - so the whole gate was written
   against a page without Google's library, whether or not the machine had a
   network. Once the script really loaded, CI (which has one) ran a page no
   suite had ever run, and two suites saw it navigate mid-test. The gate is a
   statement about AMV, not about Google's servers that day, so the host does
   not resolve here, exactly as on a network that blocks it. A suite that
   needs the real library can launch without this rule. The fix itself is
   held by the-page-head-tells-the-truth. */
const NO_GOOGLE = ['--host-resolver-rules=MAP accounts.google.com ~NOTFOUND'];
/* Behind an HTTP proxy (a sandboxed machine) Chromium hands every host to the
   proxy and never resolves it itself, so the rule above would not apply. The
   proxy is given to Playwright explicitly instead, with Google on its bypass
   list: bypassed, the host is resolved here, and does not resolve. */
const viaProxy = (() => {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const bypass = String(process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s => s.trim()).filter(Boolean);
    return { server: u.protocol + '//' + u.host, ...(u.username ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : {}),
             bypass: [...bypass, 'accounts.google.com'].join(',') };
  } catch (e) { return null; }
})();
export const LAUNCH = (() => {
  if (ENGINE !== 'chromium') return {};
  const exe = providedChromium();
  return { ...(exe ? { executablePath: exe } : {}), args: NO_GOOGLE, ...(viaProxy ? { proxy: viaProxy } : {}) };
})();

/* SERVING THE PAGE AS A DEPLOYMENT THAT HAS NOT BEEN CONFIGURED YET.

   The backend address lives in a meta tag the build writes, and the app reads
   it ONCE and memoises it. A suite could not therefore switch it off from
   inside the page: clearing the per-device override in localStorage correctly
   falls back to whatever the build shipped with, which is the documented
   behaviour and not something to work around.

   Suites testing what a visitor sees when there is NO backend used to get that
   state for free, because the built page never had an address in it. Once one
   was baked in they were quietly testing the opposite thing. `apiBase` serves
   the page with the tag set to whatever the suite means - '' for a deployment
   nobody has connected yet - so the state is stated rather than inherited. */
export async function serveApp(opts = {}) {
  if (!existsSync(APP)) {
    throw new Error('index.html not found - run `node build.mjs` first');
  }
  let html = readFileSync(APP);
  if (opts.apiBase !== undefined) {
    const pat = /(<meta name="amv-api-base" content=")[^"]*(">)/;
    const src = html.toString('utf8');
    if (!pat.test(src)) throw new Error('amv-api-base meta tag not found - cannot set it for this suite');
    html = Buffer.from(src.replace(pat, '$1' + String(opts.apiBase) + '$2'), 'utf8');
  }
  /* Real sibling files, with real content types.

     This answered EVERY path with index.html as text/html, which is fine until
     something the page loads is not the page. A service worker served as
     text/html is refused by the browser for its MIME type - so the app's own
     PWA registration failed here for a reason that exists only in this
     harness, and once that failure was reported rather than swallowed it
     became the first error every error test saw.

     Anything that is not a real file still falls back to index.html, because
     the app is a single page and every route inside it is index.html. */
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
                  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
                  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
                  '.webmanifest': 'application/manifest+json' };
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    const ext = rel.slice(rel.lastIndexOf('.'));
    if (rel && TYPES[ext] && !rel.includes('..')) {
      const abs = join(dirname(APP), rel);
      if (existsSync(abs)) {
        res.writeHead(200, { 'Content-Type': TYPES[ext] });
        res.end(readFileSync(abs));
        return;
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(forEngine(html));
  });
  /* THE OPERATING SYSTEM PICKS THE PORT, BECAUSE IT IS THE ONLY THING THAT
     KNOWS WHICH ARE FREE.

     This counted up from 9100. Inside one process that is fine. Across several
     it is a collision: two suites running at once both start at 9100, the
     second gets EADDRINUSE, and the failure is about the machine rather than
     the code - which is exactly the failure the gate used to spend a whole
     stage guarding against, and the reason the suites could only ever be run
     one at a time.

     `listen(0)` asks the kernel for a free port and it answers with one that
     is free right now. Nothing to reserve, nothing to collide with, and the
     gate no longer needs to check that a fixed port is unoccupied before it
     starts. */
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(0, res);
  });
  const port = server.address().port;
  return { url: `http://localhost:${port}`, server };
}

/* MEASURING A BOX AGAINST A WHOLE NUMBER NEEDS A TOLERANCE.

   getBoundingClientRect returns the box's position in layout units, not its
   declared size, so an element with `min-height:32px` sitting at a fractional y
   offset comes back as 31.998046875 - a five-hundred-and-twelfth of a pixel
   short of the number the stylesheet says. Six suites compared a rect dimension
   against an integer with a strict `<`, and every one of them fails on a control
   that is exactly the size it is supposed to be.

   It surfaced as a flake: `mobile-sweep` failed the full gate on a Crew button
   that measures 32px, and reproduced roughly one run in five standalone. Chased
   to the raw value rather than dismissed, because "flaky" is a conclusion and
   31.998046875 is evidence.

   Half a pixel of slack. A control at 31.4px still fails, which is what these
   checks are for; a control at 32px stops failing one time in five.

   THIS IS EXPORTED, not folded into bootApp, because not every suite gets its
   page from bootApp - every-dialog-can-be-reached builds its own with
   `browser.newPage({ deviceScaleFactor: 2 })`, which is exactly the setting that
   makes fractional layout values likeliest. Arming it there too was the second
   half of this fix, and forgetting it is how a one-caller fix looks - and a
   third caller turned up after that, `bootLive`, whose pages come from its own
   contexts.

   Takes a page OR a context; both expose addInitScript, and a context is the
   better target when it will make more than one page. Call it BEFORE navigating.
   The check that keeps this honest is in tests/e2e/every-page-can-measure-itself:
   it fails if any suite uses the comparators on a page that never got them. */
/* WAIT FOR THE THING, NOT FOR A NUMBER OF MILLISECONDS.

   Suites slept a fixed 350ms for a form to open and 1100ms for a signup to come
   back. Both are enough on an idle machine and neither is a guarantee: under the
   full gate, with four browsers and the Worker suites running alongside,
   the-seller-actually-gets-it went red with twelve assertions describing a
   product that was working perfectly.

   That is the worst kind of failure. It points at the feature instead of at the
   clock, and it only happens under load, which is exactly when nobody has time
   to look properly. A fixed sleep in a test is a guess about somebody else's
   machine.

   Installed as an init script so it survives a reload, and it THROWS on its
   ceiling rather than continuing quietly - a step that never completed should
   say so where it happened, not five assertions later. */
export async function armWait(pageOrContext) {
  await pageOrContext.addInitScript(() => {
    window.__amvWaitFor = async (cond, ms, label) => {
      const stop = Date.now() + (ms || 10000);
      for (;;) {
        try { const v = cond(); if (v) return v; } catch (e) {}
        if (Date.now() >= stop) throw new Error('timed out waiting for ' + (label || cond.toString().slice(0, 80)));
        await new Promise(r => setTimeout(r, 40));
      }
    };
    /* The two this exists for, named, so a suite does not restate the condition
       and get it subtly different each time. */
    window.__amvAuthOpen = (ms) => window.__amvWaitFor(
      () => document.getElementById('auth-submit') && document.querySelector('#a-email'),
      ms || 10000, 'the auth form to open');
    window.__amvSignedIn = (email, ms) => window.__amvWaitFor(
      () => (typeof S !== 'undefined') && S.user && S.user.email &&
            (!email || S.user.email === String(email).toLowerCase()),
      ms || 20000, 'the signup for ' + (email || 'somebody') + ' to complete');
  });
}

/* ANSWERING AMV'S OWN CONFIRMATION, BECAUSE IT NO LONGER USES THE BROWSER'S.

   Destructive actions used to ask with window.confirm, so a suite drove them by
   assigning `window.confirm = () => true`. They ask in AMV's own dialog now -
   the browser box could not show a second line, could not be styled, and its
   guard proceeded when confirm was unavailable - and a stub on window.confirm
   answers a question nobody is asking any more, so the flow simply waits.

   `__answerConfirm(true|false)` stands in for that stub. It watches the overlay
   and presses Continue or Cancel as soon as a dialog appears, which is stronger
   than the stub was: it drives the real control the real person presses instead
   of a function the product has stopped calling.

   It also records the question in `window.__lastConfirm`, keeping the shape the
   suites already assert against - "it asks first" is still the property, and
   now it is checked against what the dialog actually said, title and body. */
export async function armConfirm(pageOrContext) {
  await pageOrContext.addInitScript(() => {
    window.__answerConfirm = (yes) => {
      try { if (window.__amvConfirmObs) window.__amvConfirmObs.disconnect(); } catch (e) {}
      window.__amvConfirmAnswer = yes !== false;
      window.__lastConfirm = '';
      const ovr = document.getElementById('ovr');
      if (!ovr) return false;
      const press = () => {
        const t = document.getElementById('cfm-t');
        if (!t) return;
        const sub = document.querySelector('#ovr .ob-sub');
        window.__lastConfirm = (t.textContent || '') + (sub ? ' ' + sub.textContent : '');
        const b = document.getElementById(window.__amvConfirmAnswer ? 'cfm-yes' : 'cfm-no');
        if (b) b.click();
      };
      window.__amvConfirmObs = new MutationObserver(press);
      window.__amvConfirmObs.observe(ovr, { childList: true, subtree: true });
      press();          // in case it is already open
      return true;
    };
  });
}

export async function armGeom(pageOrContext) {
  await armWait(pageOrContext);
  await armConfirm(pageOrContext);
  await pageOrContext.addInitScript(() => {
    const EPS = 0.5;
    window.__under = (v, n) => v < n - EPS;   // meaningfully smaller than n
    window.__over  = (v, n) => v > n + EPS;   // meaningfully larger than n
  });
}

/* Boot the app: signed in, on a tab, cookie banner dismissed.
   Pass { user: null } to test the signed-out state. */
/* THE HARNESS STATES THE DEPLOYMENT, RATHER THAN INHERITING ONE.

   Every suite in this directory was written against a build with no backend
   address in it, because for the whole life of the project there wasn't one.
   Roughly a dozen of them switch the backend off with `AMV_API.base = ''` and
   assert on what a visitor sees when nothing is connected. That write goes to
   the per-device OVERRIDE, and an empty override correctly falls back to the
   address the build shipped with - so the day a real one was baked in, every
   one of those turned into a live deployment wearing a dead one's assertions.
   Three were caught by going red. The rest are worse: `saved-is-not-sent` went
   green while making real requests to the production Worker from a test.

   So the default here is an EMPTY address - the state all of this was written
   for, stated rather than assumed - and a suite that wants a configured
   deployment asks for one with `bootApp({ apiBase: 'https://...' })`. That is
   the same rule the last four lessons in LESSONS.md are about: build the
   fixture, never borrow it from whatever the deployment happens to be today.

   `a-configured-deployment-is-a-different-product` is the suite that opts in,
   so the configured path is covered on purpose instead of by accident. */
export async function bootApp(opts = {}) {
  const { url, server } = await serveApp(
    { apiBase: opts.apiBase === undefined ? '' : opts.apiBase });
  const browser = await BROWSER.launch(LAUNCH);
  /* `hasTouch` is off unless a suite asks. It is not cosmetic: it decides
     whether `@media(hover:none)` applies, and this stylesheet uses that query
     to set the minimum height of controls on a phone. Without it the tap-target
     suite measured the DESKTOP size of every control while claiming to measure
     a thumb - which is how three rules sat at 40px, under the 44 this product
     settled on, with a green gate the whole time. */
  const page = await browser.newPage({
    viewport: opts.viewport || { width: 1280, height: 860 },
    hasTouch: !!opts.hasTouch,
    isMobile: !!opts.hasTouch,
    /* A suite that has to intercept the page's own files asks for this: a
       request the service worker answers from its cache never reaches
       page.route, so a "the fetch failed" case would silently be served. */
    ...(opts.blockServiceWorkers ? { serviceWorkers: 'block' } : {}),
  });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await armGeom(page);

  /* WHO THE OPERATOR IS, STATED HERE TOO. The page no longer has a personal
     address compiled in - a deployment names its operator, and a signed-in
     session from the server says so. A suite that needs the owner's screens
     signs in as OWNER_EMAIL, which is this test address. */
  const ownerEmail = opts.ownerEmail === undefined ? 'owner@amv.test' : opts.ownerEmail;
  if (ownerEmail) await page.addInitScript((e) => { window.__AMV_OWNER_EMAIL__ = e; }, ownerEmail);

  /* opts.unreachable: hosts this visitor's network blocks, aborted before the
     page loads. A suite about a blocked third party states the block rather
     than relying on the test machine having no internet - which was true of
     Google's sign-in script only because a crossorigin attribute made every
     browser refuse it (LESSONS 604). */
  for (const host of (opts.unreachable || [])) {
    await page.route((u) => u.hostname === host, (r) => r.abort('connectionreset'));
  }

  /* opts.query lets a suite arrive at a URL the app is really sent to from
     outside - a provider's OAuth return being the one that matters, because the
     handler for it runs once at boot and cannot be reached any other way. */
  await page.goto(url + (opts.query || ''), { waitUntil: 'load' });
  await page.waitForTimeout(600);

  await page.evaluate((o) => {
    localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
    if (o.user !== null) {
      S.user = o.user || { name: 'Test', email: 'test@amv.dev', ini: 'T' };
    }
    goApp();
    if (o.tab) setTab(o.tab);
    document.getElementById('ck')?.remove();
  }, { user: opts.user === null ? null : (opts.user || undefined), tab: opts.tab || 'chat' });

  await page.waitForTimeout(250);

  return {
    page, browser, errors,
    async close() { await browser.close(); server.close(); },

    /* A HOST THE SHIPPED POLICY ACTUALLY PERMITS.

       This was https://api.test, which connect-src forbids - measured, not
       assumed: a fetch there raises a connect-src violation and comes back
       "Failed to fetch" before leaving the browser.

       For almost every suite that made no difference, because the base is set
       to make AMV_API.live true and the network is stubbed or never touched.
       One suite's app code really did call /v1/everyday and have it refused,
       silently, with nothing asserting on it either way.

       The hazard is the next one. A suite that sets this base and then relies
       on a real request would test nothing at all and report a pass, which is
       the failure LESSONS 328 is about. *.workers.dev is inside connect-src -
       the live-backend harness already picked a host on it for exactly this
       reason - so the trap is gone rather than documented.

       Pretend the AMV engine is connected.
       NOTE: AMV_API.live is a GETTER derived from .base - you cannot just
       assign `AMV_API.live = true`, and replacing window.AMV_API does nothing
       because the code closes over the original const. Set base + token. */
    async connect() {
      await page.evaluate(() => {
        AMV_API.base = 'https://amv-stub.workers.dev';
        AMV_API.token = 'test-token';
      });
    },

    /* Route every fetch to a handler defined in-page. */
    async stubFetch(fn) {
      await page.evaluate(`window.__stub = ${fn.toString()}; window.fetch = async (u, o) => window.__stub(String(u), o);`);
    }
  };
}
