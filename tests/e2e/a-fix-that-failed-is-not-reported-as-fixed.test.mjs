/* "FIXED AND NOW PASSING", SAID OVER CODE THAT HAD JUST FAILED.  (AMV-AUD-010)

   `autoDebug` runs code, asks for a fix when it fails, and runs it again. It
   returns `{success, code, history, error?}`. Both of its callers - the Lab's
   Auto-debug button and the `fix_code` tool the chat model can call - decided
   whether it had worked by testing `res.ok !== false`.

   `autoDebug` has never returned an `ok`. So `undefined !== false` was true
   for every outcome there is: the budget running out, the fixing model
   erroring, a "fix" that came back identical, running out of attempts. The Lab
   showed "fixed & passing" and "The code runs cleanly now", and the chat tool
   handed the model the sentence "Fixed and now passing." - which the model
   then passed on to the person, about code that did not run.

   The audit found it with one synthetic budget denial. It is broader than
   that: EVERY failure path was reported as success, and the failure branches
   read `res.stderr`, `res.stdout`, `res.explanation` and `res.summary`, none
   of which exist, so even a correctly-routed failure could only have said
   "unknown".

   AND ONE PATH WHERE THE CODE IS A GUESS. When the loop stops on its
   iteration cap, `code` is the last PROPOSED fix, which never went back
   through `runCode`. Every other exit returns code that ran and failed. Lab
   puts `res.code` into the editor either way, so the difference has to be
   said: a patch nobody ran, presented as "the details above", is a guess that
   somebody ships believing it was tested.

   This drives both real callers with the runner and the fixer stubbed,
   because the defect is in what the callers conclude, not in the model. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* Program the runner: a list of run results in order, and what the fixer
   returns. Everything outside autoDebug's own logic is a stub. */
const arm = (runs, fixer, budgetOk) => page.evaluate(({ runs, fixer, budgetOk }) => {
  let n = 0;
  window.runCode = async () => {
    const r = runs[Math.min(n, runs.length - 1)]; n++;
    return Object.assign({ ok: false, stdout: '', stderr: '' }, r);
  };
  window.__ranCount = () => n;
  window._budgetGuard = () => (budgetOk === false ? { ok: false, reason: 'daily budget used up' } : { ok: true });
  window.qCode = async () => {
    if (fixer === 'throw') throw new Error('the fixing engine is unavailable');
    if (fixer === 'same') return { ok: true, code: 'console.log(1/0'};
    /* A DIFFERENT fix every call. The first version of this returned the
       literal text `console.log("attempt " + Math.random())` - Math.random
       inside the STRING, never evaluated - so every fix was identical, the
       loop correctly stopped on "identical", and the section meant to
       exhaust the attempts never reached the cap. The product told the truth
       about that; the stub was what was wrong. */
    window.__fixN = (window.__fixN || 0) + 1;
    return { ok: true, code: 'console.log(' + window.__fixN + ')' };
  };
  window._sectionModel = () => 'amv-core';
}, { runs, fixer, budgetOk });

/* The chat tool, which is the path that puts words in the model's mouth. */
const viaTool = () => page.evaluate(async () => {
  const r = await _amvRunTool('fix_code', { code: 'console.log(1/0', lang: 'js' }, () => {});
  return r.text;
});

/* The Lab button, read off the screen the way a person reads it. */
const viaLab = () => page.evaluate(async () => {
  setTab('lab');
  await new Promise(r => setTimeout(r, 200));
  const el = document.getElementById('lab-code');
  if (el) { el.value = 'console.log(1/0'; el.dispatchEvent(new Event('input', { bubbles: true })); }
  await _labDebug();
  await new Promise(r => setTimeout(r, 100));
  /* The exact nodes `_labStat` and `_labOut` write to, so a missing element
     fails loudly here rather than reading as an empty - and therefore
     "nothing claimed" - screen. */
  const statEl = document.getElementById('lab-out-stat');
  const outEl = document.getElementById('lab-out-body');
  return { found: !!(statEl && outEl),
           stat: statEl ? statEl.textContent : '', out: outEl ? outEl.textContent : '',
           editor: (document.getElementById('lab-code') || {}).value || '' };
});

section('A fix that really ran cleanly is reported as fixed');
{
  /* The honest pass, first - a guard that reports everything as failing is not
     a fix for one that reported everything as passing. */
  await arm([{ ok: false, stderr: 'SyntaxError: missing )' }, { ok: true, stdout: 'Infinity' }], 'new', true);
  const t = await viaTool();
  ok(/fixed and verified/i.test(t), 'the tool says it was fixed', t.slice(0, 80));
  ok(/ran cleanly/i.test(t), 'and that the corrected version was run', t.slice(0, 120));
}

section('Running out of budget is not a fix');
{
  await arm([{ ok: false, stderr: 'SyntaxError: missing )' }], 'new', false);
  const t = await viaTool();
  ok(!/fixed and/i.test(t) && !/now passing/i.test(t),
     'the tool does NOT say it was fixed - this was the audit’s own reproduction', t.slice(0, 120));
  ok(/could not fix/i.test(t), 'it says it could not', t.slice(0, 80));
  ok(/budget/i.test(t), 'and says why', t.slice(0, 160));
  ok(/do not say it works/i.test(t),
     'and tells the model not to pass on a success that did not happen', t.slice(0, 200));
}

section('A fixer that errors is not a fix');
{
  await arm([{ ok: false, stderr: 'TypeError: x is undefined' }], 'throw', true);
  const t = await viaTool();
  ok(/could not fix/i.test(t) && !/now passing/i.test(t), 'reported as a failure', t.slice(0, 120));
  ok(/fixing engine is unavailable/.test(t), 'naming the real error, not "unknown"', t.slice(0, 200));
}

section('Running out of attempts is not a fix, and the last patch is flagged as never run');
{
  /* Every run fails, so the loop exits on its cap with a patch it never ran. */
  await arm([{ ok: false, stderr: 'ReferenceError: y is not defined' }], 'new', true);
  const t = await viaTool();
  ok(/could not fix/i.test(t) && !/now passing/i.test(t), 'reported as a failure', t.slice(0, 120));
  ok(/ReferenceError: y is not defined/.test(t),
     'with the real last error - the old branch read a field that does not exist and said "unknown"', t.slice(0, 260));
  ok(/never run/i.test(t),
     'and the model is told the last attempted fix was never run, so it cannot be offered as working', t.slice(0, 400));
}

section('The Lab says the same thing the tool does');
{
  /* The second caller. It printed "fixed & passing" in the status line and
     "The code runs cleanly now" in the body, over every failure. */
  await arm([{ ok: false, stderr: 'ReferenceError: y is not defined' }], 'new', true);
  const r = await viaLab();
  ok(r.found, 'the Lab status and output are really on the screen being read', String(r.found));
  ok(!/fixed & passing/i.test(r.stat), 'the status line does not claim a pass', r.stat);
  ok(/still failing/i.test(r.stat), 'it says it is still failing', r.stat);
  ok(!/runs cleanly now/i.test(r.out), 'and the body does not say it runs cleanly', r.out.slice(0, 160));
  ok(/ReferenceError: y is not defined/.test(r.out), 'it shows the real last error', r.out.slice(0, 300));
  ok(/NOT been run/i.test(r.out),
     'and says the code now in the editor is an attempted fix nobody ran', r.out.slice(0, 400));
}

section('A Lab pass is still a pass');
{
  await arm([{ ok: false, stderr: 'SyntaxError: missing )' }, { ok: true, stdout: 'Infinity' }], 'new', true);
  const r = await viaLab();
  ok(/fixed & passing/i.test(r.stat), 'the status line says it passed', r.stat);
  ok(/Infinity/.test(r.out), 'and shows what the passing run actually printed', r.out.slice(0, 200));
  ok(!/NOT been run/i.test(r.out), 'with no unverified warning, because it was run', r.out.slice(0, 200));
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
