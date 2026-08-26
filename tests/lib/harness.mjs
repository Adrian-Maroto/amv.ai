/* Shared test harness: serves the built app and boots it into a known state.
   Every e2e test uses this so a boot-sequence change breaks one file, not twenty. */
import { chromium } from 'playwright';
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
export const LAUNCH = (() => {
  const exe = providedChromium();
  return exe ? { executablePath: exe } : {};
})();

export async function serveApp() {
  if (!existsSync(APP)) {
    throw new Error('index.html not found - run `node build.mjs` first');
  }
  const html = readFileSync(APP);
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
    res.end(html);
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

export async function armGeom(pageOrContext) {
  await armWait(pageOrContext);
  await pageOrContext.addInitScript(() => {
    const EPS = 0.5;
    window.__under = (v, n) => v < n - EPS;   // meaningfully smaller than n
    window.__over  = (v, n) => v > n + EPS;   // meaningfully larger than n
  });
}

/* Boot the app: signed in, on a tab, cookie banner dismissed.
   Pass { user: null } to test the signed-out state. */
export async function bootApp(opts = {}) {
  const { url, server } = await serveApp();
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({
    viewport: opts.viewport || { width: 1280, height: 860 }
  });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await armGeom(page);

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

    /* Pretend the AMV engine is connected.
       NOTE: AMV_API.live is a GETTER derived from .base - you cannot just
       assign `AMV_API.live = true`, and replacing window.AMV_API does nothing
       because the code closes over the original const. Set base + token. */
    async connect() {
      await page.evaluate(() => {
        AMV_API.base = 'https://api.test';
        AMV_API.token = 'test-token';
      });
    },

    /* Route every fetch to a handler defined in-page. */
    async stubFetch(fn) {
      await page.evaluate(`window.__stub = ${fn.toString()}; window.fetch = async (u, o) => window.__stub(String(u), o);`);
    }
  };
}
