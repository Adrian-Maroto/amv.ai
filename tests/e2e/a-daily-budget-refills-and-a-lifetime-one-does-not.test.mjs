/* "AT MOST N A DAY" IS A DIFFERENT PROMISE FROM "THE FIRST RUN ONLY".

   Both land on the same `max_runs` in the policy engine, so the engine cannot
   tell them apart - the difference is entirely in what gets handed to it as
   `runs_used`. A lifetime budget counts every automatic run this job has ever
   had. A daily budget counts only the ones spent today, and starts again at
   midnight in the user's own timezone.

   That is one function, `_schedRunsUsed`, and getting it wrong fails in the
   two worst directions available: a daily cap that never refills quietly turns
   into "the first N runs, ever" (the job stops on its own and nobody is told),
   and a lifetime cap that DOES refill turns "the first run only" back into the
   fiction it already was once.

   So this suite drives the real `_runDueAuto` across a day boundary, in both
   directions, rather than testing the counter on its own. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* Seed one due job and drive `_runDueAuto` `times` times.

   `_runDueAuto` advances `next` past `now` on every pass, deliberately, so a
   past-due job cannot re-fire on every page load. To get a second attempt the
   record has to come due again - which is what happens in life over hours, and
   is done here by putting `next` back in the past between passes. Everything
   else about the record, the counters included, carries forward exactly as the
   scheduler left it.

   `runAutonomous` and `_recurMakeApproval` stand in as counters: the question
   is which branch was taken, not what the branch then did. */
const drive = (scope, seed, times) => page.evaluate(([sc, sd, n]) => {
  const past = () => Date.now() - 60_000;
  window.__ran = 0; window.__asked = 0;
  window.runAutonomous = async () => { window.__ran++; };
  window._recurMakeApproval = async () => { window.__asked++; };
  window._aiBackendReady = () => true;
  saveStr('amv_autonomy_paused', '0');

  const job = Object.assign({
    id: 'j1', goal: 'apply to the new listings', sched: { cad: 'daily', hour: 9 },
    next: past(), created: past(), lastRun: null, approval: 'auto', scope: sc,
  }, sd || {});
  store('amv_autosched', [job]);

  const step = async (left, marks) => {
    if(!left) return marks;
    const before = window.__ran;
    await _runDueAuto();
    /* Which branch this individual pass took, so the suite can assert on the
       SHAPE of the sequence (three ran then one asked) and not only on totals -
       a cap that let the last run through and blocked the first would have the
       same totals. */
    marks.push(window.__ran > before ? 'ran' : 'asked');
    const list = load('amv_autosched') || [];
    if(list[0]){ list[0].next = past(); store('amv_autosched', list); }
    return step(left - 1, marks);
  };

  return step(n, []).then(marks => {
    const after = (load('amv_autosched') || [])[0] || {};
    return { marks, ran: window.__ran, asked: window.__asked,
             autoRuns: after.autoRuns || 0, autoToday: after.autoToday || 0,
             autoDay: after.autoDay || null };
  });
}, [scope, seed || {}, times]);

/* The user's local day, the same way the scheduler computes it. Written out
   rather than imported so a change to `_schedDayKey` has to agree with an
   independent statement of what "today" means, instead of agreeing with
   itself. */
const dayKey = (offsetDays) => page.evaluate((off) => {
  const d = new Date(Date.now() + off * 86_400_000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}, offsetDays);

section('A daily cap spends down and then asks');
{
  const r = await drive({ run: 'capped', cap: 3, until: null }, {}, 5);
  ok(r.marks.join(',') === 'ran,ran,ran,asked,asked',
     'three automatic runs, then it asks - in that order', r);
  ok(r.autoToday === 3, "and today's counter stops at the cap", r);
}

section('A cap of one is a cap of one');
{
  const r = await drive({ run: 'capped', cap: 1, until: null }, {}, 3);
  ok(r.marks.join(',') === 'ran,asked,asked', 'the smallest budget still holds', r);
}

section('Tomorrow it refills - this is the whole point of "a day"');
{
  /* The counters left behind by a day that spent its whole budget. Approached
     from the other side of midnight: yesterday's spend is not today's. */
  const yesterday = await dayKey(-1);
  const r = await drive({ run: 'capped', cap: 2, until: null },
                        { autoDay: yesterday, autoToday: 2, autoRuns: 2 }, 3);
  ok(r.marks.join(',') === 'ran,ran,asked',
     'a fresh day gets the full budget back, and then holds it again', r);
  ok(r.autoDay === await dayKey(0) && r.autoToday === 2,
     "the day key rolled forward and today's count started from zero", r);
  ok(r.autoRuns === 4, 'the lifetime count kept counting through the rollover', r);
}

section('"The first run only" does NOT refill');
{
  const yesterday = await dayKey(-1);
  const r = await drive({ run: 'once', until: null },
                        { autoDay: yesterday, autoToday: 1, autoRuns: 1 }, 2);
  ok(r.marks.join(',') === 'asked,asked',
     'a new day buys nothing back for a lifetime bound', r);
  ok(r.autoRuns === 1, 'and nothing more was spent', r);
}

section('A cap that is not a number costs one run, not every run');
{
  /* The fallback direction matters more than the fallback value: a corrupted
     record, a hand-edited export, an older record from before the field
     existed. Falling back to "unlimited" would hand somebody unbounded
     automatic action on the strength of a typo. */
  for(const bad of [0, -4, null, 'lots', undefined]){
    const r = await drive({ run: 'capped', cap: bad, until: null }, {}, 2);
    ok(r.marks.join(',') === 'ran,asked',
       'cap ' + JSON.stringify(bad) + ' falls back to one run, then asks', r);
  }
}

section('A cap above the maximum is clamped to the maximum');
{
  /* The input says max 50; the record is client-side and can say anything. */
  const r = await drive({ run: 'capped', cap: 9999, until: null },
                        { autoDay: null, autoToday: 0, autoRuns: 0 }, 1);
  ok(r.marks.join(',') === 'ran', 'a large cap still runs', r);

  const spent = await dayKey(0);
  const at = await drive({ run: 'capped', cap: 9999, until: null },
                         { autoDay: spent, autoToday: 50, autoRuns: 50 }, 1);
  ok(at.marks.join(',') === 'asked', 'but it stops at fifty, not at 9999', at);
}

section('An end date still ends a capped job');
{
  /* Two bounds at once. The budget being unspent must not rescue a permission
     that has expired - they are AND, not OR. */
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const r = await drive({ run: 'capped', cap: 5, until: yesterday }, {}, 1);
  ok(r.marks.join(',') === 'asked',
     'budget left over does not outlive the end date', r);
}

section('And the pause still wins over a budget that has room');
{
  const r = await page.evaluate(() => {
    const past = Date.now() - 60_000;
    window.__ran = 0; window.__asked = 0;
    window.runAutonomous = async () => { window.__ran++; };
    window._recurMakeApproval = async () => { window.__asked++; };
    window._aiBackendReady = () => true;
    store('amv_autosched', [{ id: 'jp', goal: 'g', sched: { cad: 'daily', hour: 9 },
      next: past, created: past, lastRun: null, approval: 'auto',
      scope: { run: 'capped', cap: 5, until: null } }]);
    saveStr('amv_autonomy_paused', '1');
    return _runDueAuto().then(() => ({ ran: window.__ran, asked: window.__asked }));
  });
  ok(r.ran === 0 && r.asked === 0, 'a paused user gets neither a run nor a draft', r);
}

ok(errors.length === 0, 'no console errors', errors);
await app.close();
if (report('a-daily-budget-refills-and-a-lifetime-one-does-not') > 0) process.exitCode = 1;
done();
