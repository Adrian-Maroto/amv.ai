/* THE OWNER CONSOLE IS NOT IN EVERY VISITOR'S PAGE.

   The Command Center, its fraud review and its user list were about 9.6KB
   gzipped that every visitor downloaded and only the owner reads. They are
   admin.js now, fetched when the console is opened. Checked: nothing of it is
   in the page; opening it as the owner fetches it and draws the console; a
   failed fetch says so and offers to try again rather than leaving a blank
   screen. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', blockServiceWorkers: true, user: { name: 'Op', email: 'amarotovaleria@gmail.com', ini: 'O' } });
const { page, errors } = app;
await page.evaluate(() => { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); document.getElementById('cookie-consent-banner')?.remove(); });

section('Nothing of the console ships with the page');
{
  const r = await page.evaluate(() => ({ render: typeof window.renderAdminView, stats: typeof window._admFetchStats, token: typeof window._adminToken }));
  ok(r.render === 'undefined' && r.stats === 'undefined', 'the console’s code is absent until it is wanted', r);
  ok(r.token === 'function', 'while the admin token holder other screens use is still there', r);
}

section('A failed fetch says so, and Try again works');
{
  await page.route('**/admin.js', r => r.abort());
  await page.evaluate(() => { S.user = { name: 'Op', email: (window.OWNER_EMAIL || 'amarotovaleria@gmail.com'), ini: 'O' }; setTab('admin'); });
  await page.waitForSelector('[data-dact="_openAdmin"]', { timeout: 8000 });
  const t = await page.evaluate(() => document.getElementById('vc').textContent);
  ok(/could not be loaded/.test(t), 'the screen names the failure', t.slice(0, 120));
  await page.unroute('**/admin.js');
  await page.click('[data-dact="_openAdmin"]');
  await page.waitForFunction(() => typeof window.renderAdminView === 'function' && !!document.getElementById('adm-body'), null, { timeout: 8000 });
  ok(true, 'and Try again fetches it and draws the console');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('the-owner-console-is-fetched-when-opened') > 0) process.exitCode = 1;
done();
