/* THE MODAL PROMISED TWO BOUNDS AND THE CODE ENFORCED NEITHER.

   Auto Approve lets somebody say "run this on its own - for the first run only,
   until 12 March", and writes that choice onto the schedule record as
   `scope: {run:'once'|'every', until:'YYYY-MM-DD'}`. The permission text says
   it back to them in those words.

   `scope` was written at creation, copied into the sync payload, and read by
   nothing. A job set to auto-approve ONCE, UNTIL A DATE, auto-approved every
   run for ever. The promise lived in the copy and not in the code.

   Then the first pass of the policy wiring read `t.until` - a field the record
   does not have, because the date is at `t.scope.until`. An undefined date is
   a falsy date, so the expiry check passed silently and always allowed. Three
   layers of the same mistake, which is why this suite drives the real
   scheduler rather than the policy engine on its own: the engine's own tests
   were green throughout all three.

   What is asserted here is the behaviour somebody actually bought: the bound
   they set is the bound they get. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* One due job, with whatever scope the case needs. `_runDueAuto` is then
   driven for real - it is the function the boot timer calls - and what is
   observed is which of its two branches ran.

   `runAutonomous` and `_recurMakeApproval` are replaced by counters. That is
   the seam: this suite is about the DECISION, and letting either of them run
   for real would mean a model call and a draft in somebody's approval list. */
const run = (scope, opts) => page.evaluate(([sc, o]) => {
  const past = Date.now() - 60_000;
  window.__ran = 0; window.__asked = 0;
  window.runAutonomous = async () => { window.__ran++; };
  window._recurMakeApproval = async () => { window.__asked++; };

  const job = { id: 'j1', goal: 'send the weekly note', sched: { cad: 'daily', hour: 9 },
                next: past, created: past, lastRun: null,
                approval: 'auto', scope: sc, autoRuns: (o && o.autoRuns) || 0 };
  store('amv_autosched', [job]);
  saveStr('amv_autonomy_paused', (o && o.paused) ? '1' : '0');

  /* The engine can only run when the backend is connected, and this suite has
     no backend - so that gate is satisfied here rather than left to decide the
     result for the wrong reason. */
  window._aiBackendReady = () => true;

  return _runDueAuto().then(() => {
    const after = (load('amv_autosched') || [])[0] || {};
    return { ran: window.__ran, asked: window.__asked, autoRuns: after.autoRuns || 0 };
  });
}, [scope, opts || {}]);

section('"Every run" still means every run');
{
  const r = await run({ run: 'every', until: null });
  ok(r.ran === 1 && r.asked === 0,
     'a job set to auto-approve every run does run on its own', r);
}

section('"The first run only" means once, and this was the fiction');
{
  const first = await run({ run: 'once', until: null }, { autoRuns: 0 });
  ok(first.ran === 1 && first.asked === 0, 'the first run goes ahead', first);
  ok(first.autoRuns === 1, 'and it is counted', first);

  const second = await run({ run: 'once', until: null }, { autoRuns: 1 });
  ok(second.ran === 0 && second.asked === 1,
     'the second run asks instead of acting - the bound the modal promised', second);

  const later = await run({ run: 'once', until: null }, { autoRuns: 9 });
  ok(later.ran === 0 && later.asked === 1, 'and it stays asked for ever after', later);
}

section('An end date ends it');
{
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const nextYear  = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

  const expired = await run({ run: 'every', until: yesterday });
  ok(expired.ran === 0 && expired.asked === 1,
     'past the date it asks rather than acting', expired);

  const live = await run({ run: 'every', until: nextYear });
  ok(live.ran === 1 && live.asked === 0, 'before the date it still runs', live);

  /* The date is inclusive - somebody choosing today means today, not "already
     over". Off by one here silently shortens everybody's permission by a day. */
  const today = new Date().toISOString().slice(0, 10);
  const onTheDay = await run({ run: 'every', until: today });
  ok(onTheDay.ran === 1, 'and the last day is included, not cut off', onTheDay);
}

section('A run that fails still spends its budget');
{
  /* Counted before the run, deliberately. Otherwise a job that throws every
     time keeps earning fresh automatic attempts, which is the opposite of
     "the first run only". */
  const r = await page.evaluate(() => {
    const past = Date.now() - 60_000;
    window.__asked = 0;
    window.runAutonomous = async () => { throw new Error('the model was down'); };
    window._recurMakeApproval = async () => { window.__asked++; };
    window._aiBackendReady = () => true;
    store('amv_autosched', [{ id: 'j2', goal: 'g', sched: { cad: 'daily', hour: 9 },
      next: past, created: past, lastRun: null, approval: 'auto',
      scope: { run: 'once', until: null }, autoRuns: 0 }]);
    saveStr('amv_autonomy_paused', '0');
    return _runDueAuto().then(() => ({ autoRuns: ((load('amv_autosched') || [])[0] || {}).autoRuns || 0 }));
  });
  ok(r.autoRuns === 1, 'a failed automatic run is still one of the runs allowed', r);
}

section('The pause still wins over any scope');
{
  const r = await run({ run: 'every', until: null }, { paused: true });
  ok(r.ran === 0 && r.asked === 0,
     'a paused user gets neither a run nor a draft', r);
}

section('And a job that never asked for autonomy never gets it');
{
  const r = await page.evaluate(() => {
    const past = Date.now() - 60_000;
    window.__ran = 0; window.__asked = 0;
    window.runAutonomous = async () => { window.__ran++; };
    window._recurMakeApproval = async () => { window.__asked++; };
    window._aiBackendReady = () => true;
    store('amv_autosched', [{ id: 'j3', goal: 'g', sched: { cad: 'daily', hour: 9 },
      next: past, created: past, lastRun: null, approval: 'require', scope: null }]);
    saveStr('amv_autonomy_paused', '0');
    return _runDueAuto().then(() => ({ ran: window.__ran, asked: window.__asked }));
  });
  ok(r.ran === 0 && r.asked === 1, 'require-approval prepares a draft, as it always did', r);
}

ok(errors.length === 0, 'no console errors', errors);
await app.close();
if (report('auto-approve-honours-the-bounds-it-promised') > 0) process.exitCode = 1;
done();
