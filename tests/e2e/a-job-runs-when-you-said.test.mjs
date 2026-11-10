/* A JOB RUNS WHEN YOU SAID (Nov 10, owner: "you click it, you see what it
   does, you set when you want it and you do it").

   The panel of a job the server runs on its own offers how often and at what
   time, in the person's time zone - and what was chosen is what the server is
   sent, exactly: cadence, hour, minute, weekday, zone. A picker whose choice
   never left the page would be the worst kind of control: one that looks
   like it worked. A job that runs in this browser shows no picker, because
   it cannot promise a time the tab might not be open at. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
await page.waitForTimeout(1200);

section('A server job: choose weekly, Tuesday, 07:30 - and that is what is sent');
{
  const r = await page.evaluate(async () => {
    const j = (_cwAllJobs() || []).find(x => _cwRunsUnattended(x) && !_cwNeedsMissing(x).length);
    if (!j) return { none: true };
    window.__sent = null;
    window._cwUnattendedReady = () => true;
    window._scheduleTask = async (t) => { window.__sent = t; return { id: 'srv-1' }; };
    window.showTextPromptAsync = async () => 'AI chip makers';   // the job's one question
    cwPeek(j.id); await new Promise(s => setTimeout(s, 300));
    const cad = document.getElementById('cwp-cad'), day = document.getElementById('cwp-day'), time = document.getElementById('cwp-time');
    if (!cad) return { noPicker: true, id: j.id };
    const dayHiddenAtFirst = day.hidden;
    cad.value = 'weekly'; cad.dispatchEvent(new Event('change', { bubbles: true }));
    const dayShown = !day.hidden;
    day.value = '2'; day.dispatchEvent(new Event('change', { bubbles: true }));
    time.value = '07:30'; time.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('cwp-go').click();
    for (let i = 0; i < 40 && !window.__sent; i++) await new Promise(s => setTimeout(s, 50));
    return { id: j.id, dayHiddenAtFirst, dayShown, sent: window.__sent && { repeat: window.__sent.repeat, sched: window.__sent.sched } };
  });
  ok(!r.none && !r.noPicker, 'a server job has the picker', r);
  ok(r.dayHiddenAtFirst && r.dayShown, 'the weekday appears only when weekly is chosen', r);
  const sc = r.sent && r.sent.sched;
  ok(r.sent && r.sent.repeat === 'weekly', 'the job is created weekly', r.sent);
  ok(sc && sc.cad === 'weekly' && sc.hour === 7 && sc.minute === 30 && JSON.stringify(sc.days) === '[2]', 'on Tuesday at 07:30, exactly', sc);
  ok(sc && typeof sc.tz === 'string' && sc.tz.length > 0, 'in the person’s time zone', sc && sc.tz);
}

section('A browser job gets the same choice, and its first run is at that time');
{
  /* Nov 10, owner: the money leak detector should run "once a day, once a
     month, whenever you want". A browser job runs at that time whenever AMV is
     open, and the panel says exactly that. */
  const r = await page.evaluate(async () => {
    closeOvr(); await new Promise(s => setTimeout(s, 100));
    window._cwUnattendedReady = () => false;   // the section above stood it in for a server job
    const j = (_cwAllJobs() || []).find(x => !_cwRunsUnattended(x) && (!x.every || ['daily','weekly','monthly'].includes(x.every)) && !(x.asks && x.asks.q) && x.id !== 'job_hunt');
    if (!j) return { none: true };
    cwPeek(j.id); await new Promise(s => setTimeout(s, 300));
    const cad = document.getElementById('cwp-cad'); if (!cad) return { picker: false };
    cad.value = 'monthly'; cad.dispatchEvent(new Event('change', { bubbles: true }));
    const time = document.getElementById('cwp-time'); time.value = '21:15'; time.dispatchEvent(new Event('change', { bubbles: true }));
    const where = [...document.querySelectorAll('.cwp-facts dd')][1].textContent;
    document.getElementById('cwp-go').click();
    await new Promise(s => setTimeout(s, 300));
    const row = (_loadSched() || []).find(t => t.id === 'cw_' + j.id);
    const at = row ? new Date(row.next) : null;
    return { picker: true, where, freq: row && row.freq, h: at && at.getHours(), m: at && at.getMinutes(), future: !!(row && row.next > Date.now()) };
  });
  ok(!r.none && r.picker, 'a browser job has the picker too', r);
  ok(/whenever AMV is open/.test(r.where || ''), 'and says it runs then whenever AMV is open', r.where);
  ok(r.freq === 'monthly' && r.h === 21 && r.m === 15 && r.future, 'turned on monthly at 21:15, its first run is set for 21:15', r);
}

section('What is missing is listed, and what is already connected is not');
{
  const r = await page.evaluate(async () => {
    closeOvr(); await new Promise(s => setTimeout(s, 100));
    const j = (_cwAllJobs() || []).find(x => _cwNeedsMissing(x).length);
    if (!j) return { none: true };
    cwPeek(j.id); await new Promise(s => setTimeout(s, 300));
    return { rows: document.querySelectorAll('.cwp-uses .cwp-u:not(.met) [data-cwp-connect].bp').length, missing: _cwNeedsMissing(j).length,
             btn: !!document.getElementById('cwp-need-go') };
  });
  ok(!r.none && r.rows === r.missing && r.btn, 'one filled Connect per missing thing', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
