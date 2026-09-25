/* THE FALLBACK LAUNCHER IS ALLOWED TO RUN.  (AMV-AUD-027)

   The app's code ships as a data block, and a small launcher runs it - from a
   Blob URL normally, and as an inline script if that fails (a browser, an
   extension or a policy that refuses blob: scripts). The page's security
   policy allows that inline script by the hash of its exact text.

   The build hashed the bundle. The launcher ran the data block's text, which
   the build frames with a newline before and after - so the one time the
   fallback was needed, the browser refused it for not matching its own hash,
   and the app never started. Nothing had ever made the fallback run.

   This makes it run: Blob URLs for scripts are broken before the page loads,
   so the launcher has to take the inline path under the page's real policy. */
import { chromium } from 'playwright';
import { serveApp, LAUNCH } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const { url, server } = await serveApp({ apiBase: '' });
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

try {
  await ctx.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violations.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || '').slice(0, 40));
    });
    /* A script from a Blob URL is what the launcher tries first; make it fail
       the way a refusing browser would, so the inline fallback is the only way
       left. */
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      if (b && b.type === 'application/javascript') throw new Error('blob scripts refused here');
      return real(b);
    };
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  section('With Blob scripts refused, the app still starts');
  const r = await page.evaluate(() => ({
    booted: typeof goApp === 'function' && typeof md === 'function',
    violations: window.__violations.filter(v => /script-src/.test(v)),
  }));
  ok(r.violations.length === 0, 'the inline fallback is not refused by the page’s own policy - this was the finding', r.violations);
  ok(r.booted, 'and the application code ran', r);
} finally {
  await browser.close();
  server.close();
}
report();
done();
