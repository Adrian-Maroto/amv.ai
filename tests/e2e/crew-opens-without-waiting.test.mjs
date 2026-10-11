/* CREW OPENS WITHOUT WAITING.

   Reported as "a lag in Crew in the beginning". The catalogue was already
   fetched ahead of time, but the country's own jobs were not: every open asked
   the server for them and redrew the country sections when the answer landed.

   Now (1) the country's jobs are fetched with the catalogue, before anybody
   opens Crew, and (2) the last answer is remembered on the device, so a later
   visit draws Crew whole at once and only touches it again if the server says
   something different. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ANSWER = { name: 'Spain', countries: ['ES', 'US'], local: [
  { id: 'es-infojobs', title: 'New InfoJobs offers for my search', prompt: 'Check InfoJobs for new offers', cat: 'work' },
] };

const stub = (page, delay) => page.evaluate(([v, ms]) => {
  AMV_API.base = 'https://stub.amv.dev'; AMV_API.token = 'test-token';
  window.__asked = 0;
  AMV_API.everyday = async () => { window.__asked++; await new Promise(r => setTimeout(r, ms)); return JSON.parse(JSON.stringify(v)); };
  const quiet = async () => ({ items: [] });
  AMV_API.listAuto = quiet; AMV_API.listHandoff = quiet;
  AMV_API.crewPopular = async () => ({ enough: false, total: 0, need: 25 });
}, [ANSWER, delay]);

section('The country’s jobs are fetched before Crew is opened');
{
  const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
  const { page, errors } = app;
  await stub(page, 300);
  /* What the idle-time prefetch does, run now rather than waited for. */
  await page.evaluate(async () => { await _loadCrewData(); await _cwLoadLocal(_cwCountryGuess()); });
  const r = await page.evaluate(async () => {
    const before = window.__asked;
    setTab('crew');
    await new Promise(r => setTimeout(r, 600));
    return { before, after: window.__asked, local: _cwLocalJobs(_cwCountryGuess()).length, memo: !!load('amv_cw_local') };
  });
  ok(r.before === 1 && r.local === 1, 'the jobs were already there', r);
  ok(r.after === r.before, 'and opening Crew did not wait on another request for them', r);
  ok(r.memo, 'the answer is remembered on this device', r);
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
  /* The next visit: same device, same storage. */
  section('The next visit draws from what it remembered, even with a slow server');
  await page.evaluate(() => { for (const k of Object.keys(_cwLocalCache)) delete _cwLocalCache[k];
                              for (const k of Object.keys(_cwLocalTried)) delete _cwLocalTried[k];
                              for (const k of Object.keys(_cwLocalState)) delete _cwLocalState[k]; });
  await stub(page, 3000);
  const n = await page.evaluate(async () => {
    window.__paints = 0;
    new MutationObserver(() => { window.__paints++; }).observe(document.getElementById('vc'), { childList: true, subtree: true });
    const cc = _cwCountryGuess();
    const p = _cwLoadLocal(cc);
    const instant = _cwLocalJobs(cc).length;
    const p0 = window.__paints;
    await p;
    return { instant, asked: window.__asked, repaintsAfterSameAnswer: window.__paints - p0 };
  });
  ok(n.instant === 1, 'the jobs are there at once, before the server has answered', n);
  ok(n.asked === 1, 'the server is still asked, so the list stays current', n);
  ok(n.repaintsAfterSameAnswer === 0, 'and when it says the same thing, nothing on screen is redrawn', n);
  await app.close();
}

if (report('crew-opens-without-waiting') > 0) process.exitCode = 1;
done();
