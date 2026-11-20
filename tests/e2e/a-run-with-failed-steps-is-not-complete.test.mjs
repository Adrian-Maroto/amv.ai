/* A RUN WITH FAILED OR REFUSED STEPS IS NOT COMPLETE (Build 16 audit AG-11,
   Nov 20).

   The plan-and-steps runner (runAutonomous) ended "Complete", and Crew showed
   the task done at 100%, whatever its steps came to: two refused, two whose
   code failed, a deliverable that could not be put together - each still
   "Complete", with "All steps done". Only the model, the code runner and the
   approval are stubbed here; the outcome is the shipped loop's. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({});
const { page, errors } = app;

const drive = (o) => page.evaluate(async (o) => {
  window._budgetGuard = () => ({ ok: true });
  window.runCode = async () => ({ ok: !o.codeFails, stdout: 'ok', stderr: 'boom' });
  window._autoApprove = async () => !o.deny;
  window.qRun = async (task) => {
    if (task === 'plan') return { text: JSON.stringify(o.plan) };
    if (task === 'final') { if (o.finalFails) throw new Error('engine unavailable'); return { text: 'The finished deliverable, ready to use.' }; }
    return { text: o.stepText };
  };
  window.qAccurate = window.qRun;
  const before = _bgQueue.tasks.length;
  await Promise.race([runAutonomous('goal', {}), new Promise(r => setTimeout(r, 5000))]);
  const t = _bgQueue.tasks[_bgQueue.tasks.length - 1];
  const lbl = document.getElementById('rr-prog-lbl');
  return { added: _bgQueue.tasks.length > before, status: t && t.status, progress: t && t.progress, error: t && t.error,
    label: lbl ? lbl.textContent : '', status2: (document.getElementById('auto-status') || {}).textContent || '' };
}, o);
const plan2 = (approve) => [{ step: 'One', action: 'Do one', needs_approval: approve }, { step: 'Two', action: 'Do two', needs_approval: approve }];

section('Every step refused');
{
  const r = await drive({ plan: plan2(true), deny: true, stepText: 'written' });
  ok(r.status === 'failed' && r.progress === 0, 'the task is not done, and not at 100%', r);
  ok(/0 of 2/.test(r.error) && /not approved/.test(r.error), 'and it says what happened', r.error);
  ok(!/All 2 steps done/.test(r.label), 'the run room does not say every step was done', r.label);
}

section('Every step’s code failed');
{
  const r = await drive({ plan: plan2(false), codeFails: true, stepText: '```js\nthrow 1\n```' });
  ok(r.status === 'failed' && /0 of 2/.test(r.error), 'failed code is a failed step', r);
}

section('The deliverable could not be put together');
{
  const r = await drive({ plan: plan2(false), finalFails: true, stepText: 'written' });
  ok(r.status === 'failed' && /could not be put together/.test(r.error), 'a run with no deliverable is not complete', r);
}

section('Everything done');
{
  const r = await drive({ plan: plan2(false), stepText: 'written' });
  ok(r.status === 'done' && r.progress === 100, 'a run whose every step was done is done', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
