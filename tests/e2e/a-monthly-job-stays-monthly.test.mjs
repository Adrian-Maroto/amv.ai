/* A MONTHLY JOB STAYS MONTHLY, AND A DATE THAT DOES NOT EXIST IS REFUSED
   (Build 16 audit AG-07, Nov 20).

   "Every month on the 15th" with no time said was made a weekly job, and
   changing a daily job to monthly threw its schedule away. 30 February was
   quietly 2 March. Here the real chat tool runs with the server stubbed, and
   what it sends is what is checked. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => {
  window.__calls = [];
  window._autoApi = async (p, b) => { window.__calls.push({ p, b }); return p === '/auto/list'
    ? { items: [{ id: 'job1', detail: 'Research', repeat: 'daily', active: true, sched: { cad: 'daily', hour: 7, minute: 45 } }] }
    : { item: Object.assign({ id: 'job1' }, b) }; };
});
const tool = (name, input) => page.evaluate(async ({ name, input }) => { window.__calls = []; const r = await _crewTool(name, input); return { text: r.text, calls: window.__calls }; }, { name, input });

section('Created monthly without a time');
{
  const r = await tool('crew_add', { detail: 'Monthly research', repeat: 'monthly', day_of_month: 15 });
  const sent = (r.calls.find(c => c.p === '/auto/create') || {}).b || {};
  ok(sent.sched && sent.sched.cad === 'monthly' && sent.sched.dom === 15, 'it is sent as a monthly schedule on the 15th', sent);
  ok(sent.sched && sent.sched.hour === 9 && sent.sched.minute === 0 && /09:00/.test(r.text), 'at 09:00, and the answer says that time was chosen', r.text);
  const bad = await tool('crew_add', { detail: 'x', repeat: 'monthly', day_of_month: 32 });
  ok(!bad.calls.some(c => c.p === '/auto/create') && /1 to 31/.test(bad.text), 'a day that is not a day of the month creates nothing', bad);
}

section('Changed to monthly without a time');
{
  const r = await tool('crew_update', { id: 'job1', repeat: 'monthly', day_of_month: 15 });
  const sent = (r.calls.find(c => c.p === '/auto/update') || {}).b || {};
  ok(sent.sched && sent.sched.cad === 'monthly' && sent.sched.dom === 15, 'the update carries a monthly schedule', sent);
  ok(sent.sched && sent.sched.hour === 7 && sent.sched.minute === 45 && /07:45/.test(r.text), 'at the time it already had, said out loud', r.text);
}

section('A date that does not exist');
{
  const r = await page.evaluate(() => {
    const y = new Date().getFullYear() + 1;
    return { feb30: _crewOnceAt({ date: y + '-02-30', time: '09:00' }), month13: _crewOnceAt({ date: y + '-13-01', time: '09:00' }),
      feb29: _crewOnceAt({ date: (y % 4 ? y : y + 1) + '-02-29', time: '09:00' }), good: _crewOnceAt({ date: y + '-03-02', time: '09:00' }) };
  });
  ok(r.feb30 === 0 && r.month13 === 0, '30 February and a thirteenth month are refused, not moved', r);
  ok(r.feb29 === 0, '29 February outside a leap year too', r);
  ok(r.good > 0, 'while a real date still works', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
