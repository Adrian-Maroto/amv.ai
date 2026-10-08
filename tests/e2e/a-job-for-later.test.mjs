/* A JOB FOR LATER: "ON FRIDAY AT 9, DO THIS".

   Crew's schedule had Once, Daily, Weekly and Monthly, and Once meant now.
   Here the Later choice is driven through the real panel, and what is checked
   is what the server is asked for - the instant, on this device's clock - and
   what the person is told, including when there is no server to wake up on
   Friday and so nothing honest to promise. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 }, hasTouch: true });
const { page, errors } = app;

await page.evaluate(() => {
  window._clarifyCheck = async () => ({ ok: true, questions: [] });
  window.__asked = []; window.__serverOk = true;
  window._mcScheduleServer = async (p) => { window.__asked.push(p); return window.__serverOk ? { ok: true, id: 'srv1' } : { ok: false, code: 'needs_service' }; };
  window.runAutonomous = () => { window.__ranNow = true; };
  window.__toasts = [];
  const real = window.toast;
  window.toast = (m, k, ms) => { window.__toasts.push((k || '') + ' | ' + m); return real(m, k, ms); };
});

const schedule = (goal, date, hour) => page.evaluate(async ([g, d, h]) => {
  window.__asked.length = 0; window.__toasts.length = 0; window.__ranNow = false;
  openCowork();
  await new Promise(r => setTimeout(r, 100));
  document.getElementById('cw-goal').value = g;
  document.querySelector('#cw-cad [data-cad="later"]').click();
  const shown = { date: getComputedStyle(document.getElementById('cw-date')).display, time: getComputedStyle(document.getElementById('cw-time')).display,
                  go: document.getElementById('cw-go').textContent, note: document.getElementById('cw-freq-note').textContent };
  const di = document.getElementById('cw-date-in'); di.value = d; di.dispatchEvent(new Event('change'));
  const hs = document.getElementById('cw-hour'); hs.value = String(h); hs.dispatchEvent(new Event('change'));
  document.getElementById('cw-go').click();
  await new Promise(r => setTimeout(r, 300));
  return { shown, asked: window.__asked.slice(), toasts: window.__toasts.slice(), ranNow: window.__ranNow,
           open: !!document.getElementById('cw-goal') };
}, [goal, date, hour]);

const ymd = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const inThreeDays = Date.now() + 3 * 86400e3;

section('Later asks for a day and a time, and schedules exactly that');
{
  const r = await schedule('Check whether the concert tickets are on sale', ymd(inThreeDays), 9);
  ok(r.shown.date !== 'none' && r.shown.time !== 'none', 'choosing Later shows the day and the time', r.shown);
  ok(/Schedule it/.test(r.shown.go), 'and the button says what it will do', r.shown.go);
  const p = r.asked[0] || {};
  const want = new Date(new Date(inThreeDays).getFullYear(), new Date(inThreeDays).getMonth(), new Date(inThreeDays).getDate(), 9, 0, 0, 0).getTime();
  ok(p.freq === 'once' && p.firstRunAt === want, 'the server is asked for one run at 9:00 on that day, on this clock', { freq: p.freq, firstRunAt: p.firstRunAt, want });
  ok(!r.ranNow, 'and nothing runs now');
  ok(r.toasts.some(t => /^success/.test(t) && /Scheduled for/.test(t) && /AMV’s servers/.test(t)), 'the person is told when, and where it runs', r.toasts);
  ok(!r.open, 'and the panel closes');
}

section('A time already gone is refused, and nothing is asked of the server');
{
  const r = await schedule('Too late', ymd(Date.now() - 86400e3), 9);
  ok(r.asked.length === 0 && r.toasts.some(t => /^error/.test(t) && /still to come/.test(t)), 'yesterday is refused', r.toasts);
}

section('Without a server, nothing is promised');
{
  await page.evaluate(() => { window.__serverOk = false; });
  const r = await schedule('Check the visa page', ymd(inThreeDays), 10);
  ok(r.toasts.some(t => /^error/.test(t) && /Nothing was scheduled/.test(t)), 'it says plainly that nothing was scheduled', r.toasts);
  ok(!r.toasts.some(t => /^success/.test(t)), 'and never says it was', r.toasts);
  ok(!r.ranNow, 'nor quietly runs it now instead');
  await page.evaluate(() => { window.__serverOk = true; const x = document.getElementById('ovr'); if (x) x.innerHTML = ''; });
}

section('A one-time job reads as one in Crew');
{
  const rows = await page.evaluate(() => ({
    soon: _mcServerSchedRow({ id: 'a', detail: 'Tickets', repeat: 'once', active: true, next: Date.now() + 3 * 86400e3, approval: 'auto' }),
    ran: _mcServerSchedRow({ id: 'b', detail: 'Tickets', repeat: 'once', active: false, done: true, doneAt: Date.now() - 3600e3, approval: 'auto' }),
    tool: _crewLine({ id: 'b', detail: 'Tickets', repeat: 'once', active: false, done: true }),
  }));
  ok(/Runs once/.test(rows.soon) && /Pause/.test(rows.soon), 'a coming one says when it runs, and can be paused', rows.soon.slice(0, 300));
  ok(/Ran once/.test(rows.ran) && !/Paused/.test(rows.ran), 'one that has run says so, and is not called paused');
  ok(!/>Resume</.test(rows.ran) && !/>Pause</.test(rows.ran), 'and offers no Resume that the server would refuse');
  ok(/FINISHED/.test(rows.tool), 'and the chat tool is told it is finished, not paused', rows.tool);
}

section('The chat tool needs a real date and time');
{
  const r = await page.evaluate(() => ({
    good: _crewOnceAt({ date: (() => { const d = new Date(Date.now() + 2 * 86400e3); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })(), time: '17:30' }),
    noDate: _crewOnceAt({ time: '17:30' }),
    past: _crewOnceAt({ date: '2020-01-01', time: '09:00' }),
    badTime: _crewOnceAt({ date: '2099-01-01', time: '25:00' }),
  }));
  ok(r.good > Date.now() && new Date(r.good).getHours() === 17 && new Date(r.good).getMinutes() === 30, 'a date and time become that instant on this clock', r.good);
  ok(r.noDate === 0 && r.past === 0 && r.badTime === 0, 'no date, a past date or an impossible time is refused, never guessed', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-job-for-later') > 0) process.exitCode = 1;
done();
