/* THERE ARE TWO AGENT LOOPS AND ONLY ONE OF THEM STOPPED.

   `stop-really-stops-the-agent` covers aiAgentLoop, the turn-taking behind the
   bridge, and its opening line names the standard: a stop flag checked before
   every round AND before every single tool call.

   `runAutonomous` is the other one - the Crew run that plans a goal into steps
   and executes them - and it checked the flag only at the TOP of each round.
   Everything after that check is a long wait followed by an action: an approval
   that waits on a person, a model call that takes seconds, and then a write to
   somebody's disk or a block of code executed.

   So Stop, pressed during the model call - which is exactly when somebody
   presses it, because it is the only part long enough to react to - was not
   honoured until the next iteration. By then the file was written and the code
   had run. Measured before the fix: `wroteAfterStop: ["secret.txt"]` and
   `ranAfterStop: ["js"]`, with _AUTO.running already false.

   Two more things fell out of writing this, both in the same function:

   · STOP DID NOT END A RUN THAT WAS WAITING ON SOMEBODY. stopAutonomous only
     lowers a flag, and a pending approval is a promise nothing resolves - so
     the status read "Stopping…" and the loop sat there for the life of the tab.

   · NOWHERE TO ASK IS NOT PERMISSION TO ACT. The approval card goes into
     #rr-approve, or the run feed. Start a run on Crew, walk to Chat, and both
     are gone - the card rendered nowhere, the button was never on the page,
     and the run waited for a click that could not happen. It is skipped now,
     which is the answer _AUTO.silent already gives for the same reason.

   Only the MODEL is stubbed - qRun and runCode are replaced through the window,
   which works because they are function declarations in a classic script.
   Everything from the stop check inward is shipped code, and the workspace is a
   real object this file hands in so a write can be seen. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({});
const { page, errors } = app;

/* Installs a fake model and returns what the run actually DID. */
const drive = (o) => page.evaluate(async (o) => {
  const wrote = [], ran = [];
  window._budgetGuard = () => ({ ok: true });
  window.runCode = async (code, lang) => { ran.push(lang); return { ok: true, stdout: 'ok' }; };
  window.qRun = async (task) => {
    if (task === 'plan') return { text: JSON.stringify(o.plan) };
    if (task === 'final') return { text: 'deliverable' };
    if (o.stepDelayMs) await new Promise(r => setTimeout(r, o.stepDelayMs));
    return { text: o.stepText };
  };
  const p = runAutonomous('goal', {
    workspace: { files: [], writeFile: async (path) => { wrote.push(path); return { toDisk: true }; } },
  });
  let runningAtStop = null;
  if (o.stopAfterMs != null) {
    await new Promise(r => setTimeout(r, o.stopAfterMs));
    stopAutonomous();
    runningAtStop = _AUTO.running;
  }
  await Promise.race([p, new Promise(r => setTimeout(r, o.waitMs || 4000))]);
  let finished = false;
  await Promise.race([p.then(() => { finished = true; }), new Promise(r => setTimeout(r, 300))]);
  return { wrote, ran, runningAtStop, finished };
}, o);

const ONE_STEP = [{ step: 'S1', action: 'do it', needs_approval: false }];

section('Stop during the model call prevents the write that follows it');
{
  const r = await drive({ plan: ONE_STEP, stepText: 'WRITE_FILE: secret.txt\nhello',
                          stepDelayMs: 900, stopAfterMs: 500 });
  ok(r.runningAtStop === false, 'the stop really was requested', r);
  ok(r.wrote.length === 0, 'nothing is written to disk after Stop', r);
  ok(r.finished === true, 'and the run ends rather than hanging', r);
}

section('Stop during the model call prevents the code that follows it');
{
  const r = await drive({ plan: ONE_STEP, stepText: '```js\nconsole.log(1)\n```',
                          stepDelayMs: 900, stopAfterMs: 500 });
  ok(r.ran.length === 0, 'no code is executed after Stop', r);
  ok(r.finished === true, 'and the run ends', r);
}

section('A run nobody stopped still does its work');
{
  /* The half that makes the two above worth anything. A stop check that also
     stops a run NOBODY stopped is not a fix, it is a broken feature. */
  const r = await drive({ plan: [
      { step: 'S1', action: 'write', needs_approval: false },
      { step: 'S2', action: 'compute', needs_approval: false }],
    stepText: 'WRITE_FILE: out.txt\nbody' });
  ok(r.wrote.indexOf('out.txt') >= 0, 'the file is still written', r);
  ok(r.finished === true, 'and the run completes', r);
}

section('Stop ends a run that is waiting on a person');
{
  const r = await page.evaluate(async () => {
    window._budgetGuard = () => ({ ok: true });
    window.qRun = async (task) => {
      if (task === 'plan') return { text: JSON.stringify([{ step: 'S1', action: 'send', needs_approval: true }]) };
      return { text: 'x' };
    };
    /* A place to ask, so this case is about the WAIT and not about the card
       having nowhere to go - that is the section below. */
    const host = document.createElement('div');
    host.id = 'rr-approve';
    document.body.appendChild(host);
    let finished = false;
    const p = runAutonomous('goal', {}).then(() => { finished = true; });
    await new Promise(r => setTimeout(r, 600));
    const asked = !!document.getElementById('appr-y');
    stopAutonomous();
    await Promise.race([p, new Promise(r => setTimeout(r, 2500))]);
    host.remove();
    return { asked, finished };
  });
  ok(r.asked === true, 'the approval really was on screen and unanswered', r);
  ok(r.finished === true, 'Stop ends the run instead of leaving it waiting for ever', r);
}

section('An approval with nowhere to appear is skipped, not granted');
{
  const r = await page.evaluate(async () => {
    const acted = [];
    window._budgetGuard = () => ({ ok: true });
    window.runCode = async (c, l) => { acted.push('ran'); return { ok: true, stdout: 'ok' }; };
    window.qRun = async (task) => {
      if (task === 'plan') return { text: JSON.stringify([{ step: 'S1', action: 'send', needs_approval: true }]) };
      if (task === 'final') return { text: 'deliverable' };
      acted.push('step');
      return { text: '```js\nconsole.log(1)\n```' };
    };
    /* Neither host exists - the run was started on Crew and the screen has
       since been replaced. */
    document.getElementById('rr-approve')?.remove();
    document.getElementById('auto-feed')?.remove();
    let finished = false;
    const p = runAutonomous('goal', {}).then(() => { finished = true; });
    await Promise.race([p, new Promise(r => setTimeout(r, 4000))]);
    return { acted, finished, hadHost: !!document.getElementById('rr-approve') };
  });
  ok(r.hadHost === false, 'there really was nowhere to show the card', r);
  ok(r.finished === true, 'the run does not hang waiting for a button nobody can press', r);
  ok(r.acted.indexOf('step') < 0,
     'and the step that asked permission did not run anyway', r);
  ok(r.acted.indexOf('ran') < 0, 'so nothing it would have executed ran', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
