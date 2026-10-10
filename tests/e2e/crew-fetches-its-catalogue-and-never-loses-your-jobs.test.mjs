/* CREW FETCHES ITS CATALOGUE - AND A FAILED FETCH NEVER COSTS YOU A JOB.

   The built-in jobs moved out of the page into crew-data.js, so the first
   paint does not wait on ~57KB of job definitions; the app fetches it once
   the browser is idle, so Crew still opens drawn. That opened one way to lose
   something real: the sync rebuilds the saved job list from the catalogue,
   so a rebuild from a catalogue that never arrived would store a list without
   the built-in jobs - and delete every one somebody had on.

   Checked in a real browser:
   - the page itself does not carry the catalogue;
   - it is fetched after the first paint, not before;
   - before it arrives, the catalogue answers "not loaded", not "empty", and
     the saved list is still read as saved;
   - with the file blocked, Crew says it could not load and offers Try again,
     and the saved jobs are exactly as they were - including after the server
     sync and the account-connect resume run;
   - unblocked, Try again draws the full catalogue. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* The service worker would serve crew-data.js from its own cache, out of
   reach of the page's routing, so it is kept out of this run. */
const app = await bootApp({ tab: 'chat', blockServiceWorkers: true, user: { name: 'Kim', email: 'kim@example.com', ini: 'K' } });
const { page, errors } = app;
let block = false;
await page.route(/crew-data\.js/, (route) => block ? route.abort() : route.continue());

const SAVED = [{ id: 'morning_brief', title: 'Morning news & markets brief', on: true, autoId: 'a_1' },
               { id: 'inbox_digest', title: 'Daily inbox digest', on: true, autoId: 'a_2' }];

section('The page does not carry the catalogue, and fetches it after it has painted');
{
  const html = await page.evaluate(async () => (await fetch(location.href)).text());
  ok(!/window\.AMV_CREW_DATA\s*=/.test(html), 'index.html has no catalogue in it');
  await page.waitForFunction(() => !!window.AMV_CREW_DATA, null, { timeout: 15000 });
  const t = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const res = performance.getEntriesByType('resource').find(e => /crew-data\.js/.test(e.name));
    return { fcp: fcp ? fcp.startTime : null, start: res ? res.startTime : null };
  });
  ok(t.fcp !== null && t.start !== null && t.start > t.fcp, 'the fetch starts after the first paint', t);
}

section('Not there yet: "not loaded", and the saved list is still the saved list');
{
  /* As it is on a device where the fetch has not finished, or failed. */
  const r = await page.evaluate((saved) => {
    delete window.AMV_CREW_DATA; _crewDataP = null;
    document.querySelectorAll('script[src$="crew-data.js"]').forEach(s => s.remove());
    localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
    document.getElementById('cookie-consent-banner')?.remove();
    store('amv_cw_jobs', saved);
    return { defs: _cwDefaultJobs(), jobs: _cwJobs().map(j => j.id + ':' + j.on) };
  }, SAVED);
  ok(r.defs === null, 'the catalogue says it is not loaded, rather than empty', r.defs);
  ok(r.jobs.join(',') === 'morning_brief:true,inbox_digest:true', 'and the saved jobs read exactly as saved', r.jobs);
}

section('Blocked: Crew says so, offers Try again, and nothing saved is lost');
{
  block = true;
  await page.evaluate(() => { setTab('crew'); });
  await page.waitForSelector('#cw-load-retry', { timeout: 10000 });
  const text = await page.evaluate(() => document.querySelector('.cw-loading').textContent);
  ok(/could not load/i.test(text), 'it says Crew could not load', text);
  const r = await page.evaluate(async () => {
    /* The two other paths that rebuild from the catalogue. */
    try { await cwConnectResume(); } catch (e) {}
    /* The server sync, with the server answering - the path that rebuilds
       the stored list from the catalogue on every run. */
    Object.defineProperty(AMV_API, 'live', { get: () => true, configurable: true });
    let asked = 0;
    AMV_API.jobs = async () => { asked++; return [{ key: 'morning_brief', on_flag: true }]; };
    AMV_API.approvals = async () => null;
    try { await _crewSyncLive(); } catch (e) {}
    const defsAll = _cwDefaultJobs();
    return { defsAll, asked, saved: load('amv_cw_jobs').map(j => j.id + ':' + j.on + ':' + j.autoId) };
  });
  ok(r.asked === 1, 'the sync really ran and the server answered', r.asked);
  ok(r.defsAll === null, 'the catalogue is still not loaded', r.defsAll);
  ok(r.saved.join(',') === 'morning_brief:true:a_1,inbox_digest:true:a_2', 'and the saved jobs are untouched, handles and all', r.saved);
}

section('Unblocked: Try again draws the whole catalogue');
{
  block = false;
  await page.click('#cw-load-retry');
  await page.waitForFunction(() => !document.querySelector('.cw-loading'), null, { timeout: 10000 });
  const r = await page.evaluate(() => ({ n: (_cwDefaultJobs() || []).length, cards: document.querySelectorAll('#vc [data-dact], #vc .cw-card, #vc .cwj').length }));
  ok(r.n >= 100, 'the catalogue has arrived, with every built-in job', r.n);
  ok(r.cards > 0, 'and the Crew screen is drawn', r.cards);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('crew-fetches-its-catalogue-and-never-loses-your-jobs') > 0) process.exitCode = 1;
done();
