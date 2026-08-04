/* Screenshot every surface, at every size, in both themes.

   The suite verifies what the product DOES. Nothing verified what it looks
   like, which for a product whose whole claim is that it does not read as a
   generic AI dashboard is the dimension with no coverage at all.

   Not a test - it asserts nothing. It produces images to look at, because some
   questions ("is the hierarchy right", "does this feel premium", "is that
   spacing an accident") cannot be expressed as an assertion and can be answered
   in a second by eye.

   Own port, so it can run while the gate has 9100. */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.SHOT_DIR || join(ROOT, '.shots');
const PORT = +(process.env.SHOT_PORT || 9400);

export const SIZES = {
  phone:   { width: 390,  height: 844 },
  tablet:  { width: 768,  height: 1024 },
  desktop: { width: 1440, height: 900 },
};

export async function shoot({ tabs, themes = ['dark'], sizes = ['phone', 'desktop'], prefix = '', prepare }) {
  mkdirSync(OUT, { recursive: true });
  /* Serve the real files by path. index.html links styles.css as well as
     inlining a critical subset, so a server that answers every request with the
     HTML leaves the page missing almost all of its CSS - and the screenshots
     then show layout faults that exist only in the harness. */
  const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
                  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = rel === '/' ? 'index.html' : rel.replace(/^\/+/, '');
    const abs = join(ROOT, file);
    if (!abs.startsWith(ROOT) || !existsSync(abs) || !file.match(/\.[a-z0-9]+$/i)) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(readFileSync(abs));
  });
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const made = [];

  for (const theme of themes) {
    for (const sizeName of sizes) {
      const page = await browser.newPage({ viewport: SIZES[sizeName] });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
      await page.waitForTimeout(700);
      await page.evaluate((t) => {
        localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
        saveStr('amv_theme', t);
        S.user = { name: 'Alex Rivera', email: 'alex@example.com', ini: 'AR' };
        goApp();
        document.getElementById('ck')?.remove();
      }, theme);
      await page.waitForTimeout(400);

      for (const tab of tabs) {
        try {
          await page.evaluate((t) => setTab(t), tab);
          await page.waitForTimeout(650);
          if (prepare) { try { await prepare(page, tab); } catch (e) {} }
          const name = `${prefix}${tab}-${sizeName}-${theme}.png`;
          await page.screenshot({ path: join(OUT, name), fullPage: false });
          made.push({ name, errors: errors.slice() });
        } catch (e) {
          made.push({ name: `${prefix}${tab}-${sizeName}-${theme}`, failed: e.message });
        }
      }
      await page.close();
    }
  }
  await browser.close();
  server.close();
  return { out: OUT, made };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tabs = (process.argv[2] || 'chat,images,video,crew,dev,lab,market,tasks,plans,settings').split(',');
  const sizes = (process.argv[3] || 'phone,desktop').split(',');
  const themes = (process.argv[4] || 'dark').split(',');
  const r = await shoot({ tabs, sizes, themes });
  console.log(r.out);
  r.made.forEach(m => console.log(m.failed ? `FAIL ${m.name}: ${m.failed}` : `  ${m.name}${m.errors.length ? '  [' + m.errors.length + ' page errors]' : ''}`));
}
