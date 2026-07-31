/* UNIVERSAL AGENT - FAILURE PATHS. The interesting question is not what the
   agent does when everything works, it is what it does when step 3 of 6
   throws. The plan is sequential and the later steps are the ones that send,
   post, buy and contact people, so running them on the result of a step that
   failed is how an autonomous agent does real damage. These assertions cover
   stopping, saying so, not hanging, and not letting a UI bug look like the
   agent failing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const { page, errors } = app;

section('A failed step stops the run - later steps are not attempted');
const halt = await page.evaluate(async () => {
  const U = window.AMVUniversal, C = window.AMVConnectors;
  let sentCount = 0;
  C.register({ id: 'flaky', name: 'Flaky', auth: 'none', actions: {
    lookup: { desc: 'Look something up', run: async () => { throw new Error('the lookup service is down'); } },
    send:   { desc: 'Send it', risk: 'high', run: async () => { sentCount++; return { sent: true }; } },
    read:   { desc: 'Read something', run: async () => ({ ok: true }) }
  } });
  const steps = U.resolve([
    { title: 'Find the address', tool: 'flaky.read', args: {} },
    { title: 'Look up the details', tool: 'flaky.lookup', args: {} },
    { title: 'Send the message', tool: 'flaky.send', args: {}, needs_approval: false },
    { title: 'Send another', tool: 'flaky.send', args: {}, needs_approval: false }
  ], { autonomous: true });
  const seen = [];
  const res = await U.execute(steps, { autonomous: true, approved: true, onEvent: e => seen.push(e.type + ':' + e.i) });
  return { statuses: res.map(r => r.status), sentCount, seen,
           summary: U.summarize(steps, res) };
});
ok(halt.statuses[0] === 'done', 'the step before the failure really ran', halt.statuses);
ok(halt.statuses[1] === 'error', 'the failing step is recorded as an error');
ok(halt.statuses[2] === 'skipped' && halt.statuses[3] === 'skipped',
   'every later step is reported as not attempted', halt.statuses);
ok(halt.sentCount === 0, 'nothing was sent on the back of a step that failed', halt.sentCount);
ok(halt.summary.errors === 1 && halt.summary.skipped === 2, 'the summary counts both', halt.summary);
ok(halt.summary.failedAt === 1, 'and it says exactly where it stopped', halt.summary.failedAt);
ok(/lookup service is down/.test(halt.summary.failedWhy || ''), 'with the real reason', halt.summary.failedWhy);

section('A blocked step is different: the run carries on');
const parked = await page.evaluate(async () => {
  const U = window.AMVUniversal, C = window.AMVConnectors;
  let ran = 0;
  C.register({ id: 'needy', name: 'Needy', auth: 'bearer', tokenKey: 'amv_needy_absent', actions: {
    thing: { desc: 'Needs an account', method: 'GET', url: 'https://api.needy.test/x' } } });
  C.register({ id: 'fine', name: 'Fine', auth: 'none', actions: {
    thing: { desc: 'Works', run: async () => { ran++; return { ok: true }; } } } });
  const steps = U.resolve([
    { title: 'Needs a connection', tool: 'needy.thing', args: {} },
    { title: 'Independent work', tool: 'fine.thing', args: {} }
  ], { autonomous: true });
  const res = await U.execute(steps, { autonomous: true, approved: true });
  return { statuses: res.map(r => r.status), ran, needs: U.summarize(steps, res).needs.length };
});
ok(parked.statuses[0] === 'blocked', 'a missing connection parks the step');
ok(parked.statuses[1] === 'done' && parked.ran === 1,
   'and the next step still runs - one missing account says nothing about the others', parked.statuses);
ok(parked.needs === 1, 'the blocker is surfaced as something the user can provide');

section('No step can hang the whole plan');
const slow = await page.evaluate(async () => {
  const U = window.AMVUniversal, C = window.AMVConnectors;
  C.register({ id: 'hang', name: 'Hang', auth: 'none', actions: {
    forever: { desc: 'Never returns', run: () => new Promise(() => {}) } } });
  const steps = U.resolve([{ title: 'Waits forever', tool: 'hang.forever', args: {} }], { autonomous: true });
  const t0 = Date.now();
  const res = await U.execute(steps, { autonomous: true, approved: true, stepTimeoutMs: 300 });
  return { ms: Date.now() - t0, status: res[0].status, err: res[0].error };
});
ok(slow.ms < 3000, 'a step that never returns is cut off', slow.ms + 'ms');
ok(slow.status === 'error', 'it counts as a failure, not as something the user can fix', slow.status);
ok(/longer than/.test(slow.err || ''), 'and the message says it timed out', slow.err);

section('The run can be stopped');
const stop = await page.evaluate(async () => {
  const U = window.AMVUniversal, C = window.AMVConnectors;
  let ran = 0;
  C.register({ id: 'counter', name: 'Counter', auth: 'none', actions: {
    tick: { desc: 'Counts', run: async () => { ran++; return { ran }; } } } });
  const steps = U.resolve(
    [1, 2, 3].map(n => ({ title: 'Step ' + n, tool: 'counter.tick', args: {} })), { autonomous: true });
  const ctrl = new AbortController();
  ctrl.abort();
  const res = await U.execute(steps, { autonomous: true, approved: true, signal: ctrl.signal });
  return { ran, statuses: res.map(r => r.status), why: res[0].blocker && res[0].blocker.need };
});
ok(stop.ran === 0, 'an already-cancelled run does no work', stop.ran);
ok(stop.statuses.every(s => s === 'skipped'), 'every step reports as not attempted', stop.statuses);
ok(/stopped/i.test(stop.why || ''), 'and says the user stopped it, not that it failed', stop.why);

section('A bug in the progress display cannot fail the run');
const uiBug = await page.evaluate(async () => {
  const U = window.AMVUniversal, C = window.AMVConnectors;
  C.register({ id: 'plain', name: 'Plain', auth: 'none', actions: {
    go: { desc: 'Works fine', run: async () => ({ ok: true }) } } });
  const steps = U.resolve([{ title: 'Do it', tool: 'plain.go', args: {} }], { autonomous: true });
  try {
    const res = await U.execute(steps, { autonomous: true, approved: true,
      onEvent: () => { throw new Error('rendering blew up'); } });
    return { threw: false, status: res[0].status };
  } catch (e) { return { threw: true, msg: e.message }; }
});
ok(uiBug.threw === false, 'the run survives a callback that throws', uiBug.msg);
ok(uiBug.status === 'done', 'and the real work still completed', uiBug.status);

section('When planning itself fails, it says so');
const planFail = await page.evaluate(async () => {
  const U = window.AMVUniversal;
  const realReady = window._aiBackendReady, realComplete = window.aiComplete;
  window._aiBackendReady = () => true;
  window.aiComplete = async () => { throw new Error('The server did not respond in time. Please try again.'); };
  const p = await U.plan('do something involved');
  window._aiBackendReady = realReady; window.aiComplete = realComplete;
  return { planError: p.planError, steps: p.steps.length, degraded: p.degraded };
});
ok(/did not respond in time/.test(planFail.planError || ''),
   'the planning failure is reported instead of swallowed', planFail.planError);
ok(planFail.steps === 1, 'a single honest fallback step is still produced', planFail.steps);
ok(planFail.degraded !== true, 'and it is not mislabelled as "no engine connected"', planFail.degraded);

section('The live view shows failures instead of an empty score line');
const view = await page.evaluate(async () => {
  const C = window.AMVConnectors;
  C.register({ id: 'bad', name: 'Bad', auth: 'none', actions: {
    go: { desc: 'Always fails', run: async () => { throw new Error('it broke'); } } } });
  const host = document.createElement('div'); host.id = 'uni-live'; document.body.appendChild(host);
  const realPlan = window.AMVUniversal.plan;
  window.AMVUniversal.plan = async () => ({ steps: [
    { title: 'First', tool: 'bad.go', args: {} },
    { title: 'Second', tool: 'bad.go', args: {} }
  ] });
  await uniRun('anything', { autonomous: true, approved: true });
  window.AMVUniversal.plan = realPlan;
  const txt = host.textContent;
  const out = { failedCard: !!host.querySelector('.uni-failed'), txt,
                skippedRow: !!host.querySelector('.uni-step.skipped'),
                errorRow: !!host.querySelector('.uni-step.error') };
  host.remove();
  return out;
});
ok(view.errorRow === true, 'the failed step is marked failed in the list');
ok(view.skippedRow === true, 'the untried step is visibly different from a failed one');
ok(view.failedCard === true, 'a card explains what stopped the run');
ok(/it broke/.test(view.txt), 'showing the real error text', view.txt.slice(0, 160));
ok(/1 failed/.test(view.txt), 'and the score line counts the failure', view.txt.slice(0, 160));

section('A running agent is stoppable from the screen');
const stopUi = await page.evaluate(async () => {
  const C = window.AMVConnectors;
  let ran = 0;
  C.register({ id: 'slowish', name: 'Slowish', auth: 'none', actions: {
    go: { desc: 'Takes a moment', run: () => new Promise(r => setTimeout(() => { ran++; r({ ok: true }); }, 120)) } } });
  const host = document.createElement('div'); host.id = 'uni-live'; document.body.appendChild(host);
  const realPlan = window.AMVUniversal.plan;
  window.AMVUniversal.plan = async () => ({ steps: [1,2,3,4,5].map(n => ({ title: 'Step ' + n, tool: 'slowish.go', args: {} })) });
  const p = uniRun('anything', { autonomous: true, approved: true });
  await new Promise(r => setTimeout(r, 60));
  const btn = document.getElementById('uni-stop');
  const had = !!btn;
  if (btn) btn.click();
  const said = btn ? btn.textContent : '';
  const r = await p;
  window.AMVUniversal.plan = realPlan;
  const gone = !document.getElementById('uni-stop');
  host.remove();
  return { had, said, ran, skipped: r.summary.skipped, gone };
});
ok(stopUi.had === true, 'a Stop control is on screen while the agent is working');
ok(/stopping/i.test(stopUi.said || ''), 'it says it stops after the current step, not instantly', stopUi.said);
ok(stopUi.ran < 5, 'pressing it really cuts the run short', stopUi.ran + ' of 5 steps ran');
ok(stopUi.skipped > 0, 'and the steps it did not reach are reported as not attempted', stopUi.skipped);
ok(stopUi.gone === true, 'the Stop control goes away once the run is over');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
