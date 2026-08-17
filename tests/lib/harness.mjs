/* Shared test harness: serves the built app and boots it into a known state.
   Every e2e test uses this so a boot-sequence change breaks one file, not twenty. */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
export const APP = join(__dir, '..', '..', 'index.html');

let _port = 9100;

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
  const port = _port++;
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
  await new Promise(r => server.listen(port, r));
  return { url: `http://localhost:${port}`, server };
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

  await page.goto(url, { waitUntil: 'load' });
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
