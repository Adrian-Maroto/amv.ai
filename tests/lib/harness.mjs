/* Shared test harness: serves the built app and boots it into a known state.
   Every e2e test uses this so a boot-sequence change breaks one file, not twenty. */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
export const APP = join(__dir, '..', '..', 'index.html');

let _port = 9100;

export async function serveApp() {
  if (!existsSync(APP)) {
    throw new Error('index.html not found — run `node build.mjs` first');
  }
  const html = readFileSync(APP);
  const port = _port++;
  const server = createServer((req, res) => {
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
  const browser = await chromium.launch();
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
       NOTE: AMV_API.live is a GETTER derived from .base — you cannot just
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
