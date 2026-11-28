/* TYPING IN CREW'S SEARCH NEVER FREEZES THE PAGE (Nov 28, Build 19 audit
   B19-P-01, NEW-15).

   The suggestions under the box copied the United States' 22,424 jobs into
   new objects on every keystroke, so the matcher's per-item word cache never
   hit: 420 ms of frozen page per letter at 4x CPU. Kept, the first query that
   matched few jobs still worked out every job's words at once (484 ms). Now
   the items live as long as the list, and their words are worked out in idle
   moments once Crew has drawn.

   A tripwire, not a target: 250 ms is several times what a letter costs now
   (0-100 ms at 4x), and under what it cost before. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 } });
const { page, errors } = app;
await page.waitForFunction(() => typeof window._ccReady === 'function', null, { timeout: 15000 });
await page.evaluate(async () => { await _ccReady(); _cwSetCountry('US'); setTab('crew'); });
await page.waitForFunction(() => ((window._ccCrewJobs || {}).US || []).length > 10000 && document.getElementById('cx-q'), null, { timeout: 30000 });
await page.waitForTimeout(2500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.evaluate(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask' }); });

section('The United States: 22,000 jobs, four letters, a 4x-slowed phone');
{
  const per = [];
  for (const w of ['b', 'ba', 'ban', 'bank', 'bank s']) {
    await page.evaluate(() => { window.__lt = []; });
    await page.evaluate((w) => { const i = document.getElementById('cx-q'); i.focus(); i.value = w; i.dispatchEvent(new Event('input', { bubbles: true })); }, w);
    await page.waitForTimeout(900);
    per.push(Math.round(Math.max(0, ...(await page.evaluate(() => window.__lt)))));
  }
  const n = await page.evaluate(() => _cjTaItems().length);
  ok(n > 10000, 'the suggestions search every job (' + n + ')', n);
  ok(per.slice(1).every(ms => ms < 250), 'no letter after the first freezes the page for 250 ms (longest each: ' + per.join(', ') + ' ms)', per);
  const sug = await page.evaluate(() => [...document.querySelectorAll('.ta-list .ta-opt .ta-l')].map(o => o.textContent));
  ok(sug.length > 0, 'and the suggestions are there', sug.slice(0, 3));
  ok(await page.evaluate(() => _cjTaItems() === _cjTaItems()), 'the same items each time, so each job\'s words are worked out once');
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
