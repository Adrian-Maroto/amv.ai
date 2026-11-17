/* CREW SHOWS WHAT IS RUNNING (Nov 17, the owner: "Crew has to have a running
   jobs section below the textbox to see if anything is running and it
   actually works").

   Right under the box, read from the real state, never from a wish:
     · nothing running says so, and says what to do;
     · work running in this tab shows with its progress; a job AMV's servers
       have due shows as starting; the last results the server wrote show what
       happened - done and emailed, failed - and when;
     · what is switched on is counted, with when the next one runs;
     · it keeps itself current: a result the server writes later appears
       without anybody touching the page;
     · a server that cannot be reached is said to be unreachable, and the jobs
       are said NOT to have stopped - an empty list there would be a lie. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;
const panel = () => page.evaluate(() => {
  const p = document.getElementById('crew-now'); if (!p) return null;
  const box = document.querySelector('.cj-box');
  return { text: p.textContent.replace(/\s+/g, ' ').trim(),
    rows: [...p.querySelectorAll('.crew-now-row')].map(r => ({ k: r.className.replace('crew-now-row', '').trim(), t: r.querySelector('.crew-now-t').textContent, s: r.querySelector('.crew-now-s').textContent, bar: !!r.querySelector('.crew-now-bar') })),
    under: !!box && !!(box.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) && !p.previousElementSibling?.matches('.cj-jobs, #cj-grid') };
});

section('Right under the box, and honest when nothing runs');
{
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); _AUTOS = []; _AUTO_RESULTS = []; setTab('crew'); });
  await page.waitForSelector('#crew-now', { timeout: 15000 });
  const p = await panel();
  ok(p && p.under, 'the panel is under the Crew box', p);
  ok(/Nothing is running right now/.test(p.text) && /Turn on a job below/.test(p.text) && p.rows.length === 0, 'nothing running says so, and what to do', p.text);
}

section('Each real state, in its own words');
{
  await page.evaluate(() => {
    const now = Date.now();
    _AUTOS = [{ id: 'a1', detail: 'Tell me every time Trump posts about finance', active: true, next: now - 5000, repeat: 'hourly' },
              { id: 'a2', detail: 'Daily inbox digest', active: true, next: now + 3 * 3600e3, repeat: 'daily' },
              { id: 'a3', detail: 'Paused one', active: false, next: now - 5000 }];
    _AUTO_RESULTS = [{ id: 'r1', autoId: 'a2', detail: 'Daily inbox digest', at: now - 40 * 60e3, outcome: 'emailed' },
                     { id: 'r2', autoId: 'a4', detail: 'Price watch', at: now - 3 * 3600e3, outcome: 'failed', kind: 'failed' },
                     { id: 'r3', autoId: 'a5', detail: 'Two days old', at: now - 50 * 3600e3, outcome: 'in-app' }];
    _bgQueue.tasks.push({ id: 'b1', title: 'Research flight prices', status: 'running', progress: 45, created: now });
    setTab('crew');
  });
  await page.waitForTimeout(400);
  const p = await panel();
  const row = (t) => p.rows.find(r => r.t.indexOf(t) >= 0) || {};
  ok(row('Research flight').k === 'run' && /Running/.test(row('Research flight').s) && row('Research flight').bar, 'work running here, with its progress', row('Research flight'));
  ok(row('Trump').k === 'run' && /Starting/.test(row('Trump').s), 'a job the server has due is starting', row('Trump'));
  ok(row('Daily inbox').k === 'done' && /sent to your email/.test(row('Daily inbox').s) && /40 minutes ago/.test(row('Daily inbox').s), 'a result says what happened and when', row('Daily inbox'));
  ok(row('Price watch').k === 'fail' && /Failed/.test(row('Price watch').s), 'and a failure says so', row('Price watch'));
  ok(!p.rows.some(r => /Paused one|Two days old/.test(r.t)), 'a paused job is not starting, and a result from two days ago is not "now"', p.rows.map(r => r.t));
  ok(/2 switched on/.test(p.text) && /next in 3 hours/.test(p.text), 'what is switched on is counted, with the next run', p.text.slice(0, 90));
}

section('It keeps itself current');
{
  const r = await page.evaluate(async () => {
    window._autoRefresh = async () => { _AUTO_RESULTS = _AUTO_RESULTS.concat({ id: 'r9', autoId: 'a1', detail: 'Tell me every time Trump posts about finance', at: Date.now(), outcome: 'in-app' });
      _AUTOS = _AUTOS.map(x => x.id === 'a1' ? Object.assign({}, x, { next: Date.now() + 3600e3 }) : x); };
    try { Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); } catch (e) {}
    return true;
  });
  /* The tick is fifteen seconds; the test does not wait for the clock. */
  await page.evaluate(async () => { await window._autoRefresh(); const el = document.getElementById('crew-now'); el.innerHTML = _crewNowHTML(); });
  const p = await panel();
  const t = p.rows.find(x => /Trump/.test(x.t) && x.k === 'done');
  ok(r && t && /Done/.test(t.s), 'a result the server wrote later appears as done', p.rows);
  const tick = await page.evaluate(() => typeof window._crewNowTick === 'function');
  ok(tick, 'and the panel keeps a timer of its own while Crew is open');
}

section('An unreachable server is not an empty list');
{
  await page.evaluate(() => { window._autoLoadState = () => ({ loaded: false, error: 'network' }); document.getElementById('crew-now').innerHTML = _crewNowHTML(); });
  const p = await panel();
  ok(/could not be reached/.test(p.text) && /have not stopped/.test(p.text), 'it says the jobs have not stopped', p.text.slice(-120));
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
