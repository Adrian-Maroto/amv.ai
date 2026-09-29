/* THE TIME YOU SAY IS THE TIME IT RUNS.

   The server now keeps a job's schedule as a time on the person's clock (see
   eight-oclock-is-eight-oclock-every-day). This is the page's half: every
   door that creates a job has to SEND that time, the days and the zone.

   Before, neither door did. The Crew box sent only "daily" or "weekly", so
   "every weekday at 7:30pm" reached the server as once a week at whatever time
   it was created, and chat's crew_add tool had no way to say a time at all.
   The minutes were also dropped by the parser - 7:30pm became 7pm - and
   "overnight", "weekdays" and "the 15th" meant nothing to it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'crew' });
const { page, errors } = app;
await app.connect();
await page.evaluate(() => { AMV_API.hasSession = true; });

section('The Crew box hears the time, to the minute, and the days');
{
  const r = await page.evaluate(() => {
    const p = (t) => { const w = _parseWhen(t); return w.sched ? Object.assign({}, w.sched, { label: w.label }) : { freq: w.freq, label: w.label }; };
    return {
      daily: p('send me the news every day at 8am'),
      weekday: p('every weekday at 7:30pm check the planning portal'),
      monthly: p('on the 15th of every month at 9 remind me about rent'),
      overnight: p('every night overnight back up my notes'),
      tenmin: p('every 10 minutes check the price'),
      weekend: p('every weekend at 10:15 find something to do'),
    };
  });
  ok(r.daily.cad === 'daily' && r.daily.hour === 8 && r.daily.minute === 0, '"every day at 8am" is 08:00', r.daily);
  ok(r.weekday.cad === 'weekly' && r.weekday.days.join() === '1,2,3,4,5' && r.weekday.hour === 19 && r.weekday.minute === 30,
     '"every weekday at 7:30pm" is Monday to Friday at 19:30 - the minutes kept', r.weekday);
  ok(/Every weekday at 7:30 PM/.test(r.weekday.label), 'and reads back that way', r.weekday.label);
  ok(r.monthly.cad === 'monthly' && r.monthly.dom === 15 && r.monthly.hour === 9, '"the 15th of every month at 9" is the 15th at 09:00', r.monthly);
  ok(r.overnight.cad === 'daily' && r.overnight.hour === 3, '"overnight" means the small hours, not 9 in the morning', r.overnight);
  ok(r.tenmin.freq === '10min', '"every 10 minutes" is every 10 minutes', r.tenmin);
  ok(r.weekend.cad === 'weekly' && r.weekend.days.join() === '0,6' && r.weekend.minute === 15, '"every weekend at 10:15" is Saturday and Sunday at 10:15', r.weekend);
}

section('And sends it to the server that runs it overnight');
{
  const body = await page.evaluate(async () => {
    let sent = null;
    const real = AMV_API._fetch;
    AMV_API._fetch = async (path, o) => { sent = { path, body: JSON.parse(o.body) }; return new Response(JSON.stringify({ item: { id: 'a1' } }), { status: 200 }); };
    const w = _parseWhen('every weekday at 7:30pm check the planning portal');
    await _mcScheduleServer({ goal: 'check the planning portal', sched: w.sched, approval: 'require' });
    AMV_API._fetch = real;
    return sent;
  });
  ok(body && body.path === '/auto/create', 'to the scheduler the cron runs', body && body.path);
  ok(body && body.body.sched && body.body.sched.days.join() === '1,2,3,4,5' && body.body.sched.hour === 19 && body.body.sched.minute === 30,
     'with the days and the time, not just "weekly"', body && body.body.sched);
  ok(body && typeof body.body.tz === 'string' && body.body.tz.length > 0, 'and the zone their device is in', body && body.body.tz);
}

section('Chat can set the time too, and says when it first runs');
{
  const r = await page.evaluate(async () => {
    const calls = [];
    window.fetchDeadline = async (url, o) => {
      const b = JSON.parse(o.body); calls.push({ url, body: b });
      return new Response(JSON.stringify({ item: { id: 'a2', repeat: b.repeat, approval: b.approval, sched: Object.assign({ tz: b.tz }, b.sched || {}), next: Date.now() + 3600e3 } }), { status: 200 });
    };
    const add = await _crewTool('crew_add', { detail: 'Summarise the overnight news', repeat: 'daily', time: '08:00', approval: 'auto' });
    const wk = await _crewTool('crew_add', { detail: 'Plan the week', repeat: 'weekly', time: '18:30', days: ['sun'] });
    const mo = await _crewTool('crew_add', { detail: 'Rent reminder', repeat: 'monthly', time: '09:00', day_of_month: 31 });
    return { calls, add: add.text, wk: wk.text };
  });
  const [d, w, m] = r.calls.filter(c => /\/auto\/create$/.test(c.url)).map(c => c.body);
  ok(d && d.sched && d.sched.cad === 'daily' && d.sched.hour === 8 && d.sched.minute === 0 && d.tz, 'a daily job at 08:00, with the zone', d);
  ok(w && w.sched && w.sched.cad === 'weekly' && w.sched.days.join() === '0' && w.sched.hour === 18 && w.sched.minute === 30, 'a Sunday job at 18:30', w && w.sched);
  ok(m && m.sched && m.sched.cad === 'monthly' && m.sched.dom === 31 && m.repeat === 'weekly', 'a monthly job on the 31st, registered with a repeat the server knows', m);
  ok(/every day at 8:00 AM/.test(r.add) && /computer off and AMV closed/.test(r.add) && /First run:/.test(r.add),
     'and it tells them the time, that it runs with everything closed, and when the first run is', r.add);
}

section('A running job shows the time it runs, not only how often');
{
  const html = await page.evaluate(() => _mcServerSchedRow({ id: 'a3', detail: 'News digest', repeat: 'daily', active: true, approval: 'auto',
    sched: { cad: 'daily', hour: 8, minute: 0, tz: 'Europe/Madrid' }, next: Date.now() + 3600e3 }));
  ok(/Runs every day at 8:00 AM/.test(html) && /Runs on AMV's servers, whether or not this is open/.test(html),
     'the row says "every day at 8:00 AM" and that it runs with this closed', html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
}

ok(errors.length === 0, 'and nothing threw on the way', errors);

await app.close();
if (report('the-time-you-say-is-the-time-it-runs') > 0) process.exitCode = 1;
done();
