/* SETTINGS ARRIVES WHEN ITS PANES DO.

   What each Settings pane draws left the page for settings-panes.js (code
   splitting: about 14KB gzipped nobody downloads before their first message).
   It is prefetched once the page is idle, so normally Settings opens at once.
   This is the other case, which nobody would see until it happened:
   - opened before the file has arrived, the pane says it is loading;
   - if the file cannot be fetched, it says so, with a way to try again;
   - trying again once it can be fetched draws the pane that was asked for. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

let block = true;
const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat', blockServiceWorkers: true,
  beforeLoad: (page) => page.route('**/settings-panes.js', (r) => block ? r.abort('connectionreset') : r.continue()) });
const { page, errors } = app;

section('Not in the page: the panes are a file of their own');
ok(await page.evaluate(() => typeof window._renderSetPaneInner !== 'function'), 'the panes are not part of the page itself');

section('Opened while the file cannot arrive: said, with a way to try again');
{
  await page.evaluate(() => goSettings('appearance'));
  await page.waitForSelector('#set-pane [data-set-retry]', { timeout: 15000 });
  const t = await page.textContent('#set-pane');
  ok(/could not be loaded/i.test(t) && /Try again/.test(t), 'it says it could not be loaded and offers to try again', t.trim().slice(0, 120));
}

section('Trying again once it can arrive draws the pane that was asked for');
{
  block = false;
  await page.click('#set-pane [data-set-retry]');
  await page.waitForFunction(() => typeof window._renderSetPaneInner === 'function' && !document.querySelector('#set-pane [data-set-loading]'), null, { timeout: 15000 });
  const t = await page.textContent('#set-pane');
  ok(/Appearance|Theme|Text size/i.test(t), 'the Appearance pane is drawn', t.trim().slice(0, 160));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
