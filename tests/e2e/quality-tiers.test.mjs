/* CHEAP WHERE IT DOES NOT SHOW, GOOD WHERE IT DOES.

   An agent run is a plan plus N steps plus a delivery. Every one of them used
   the engine the model dropdown was set to, so routine work - "pull the three
   numbers out", "write the next paragraph" - was billed at the price of the
   hardest thing the product can do, multiplied by the number of steps.

   Work is now routed by WHAT IT IS. The other half is that the cheap tier must
   not read as cheap: a smaller engine is mostly worse at noticing its own
   mistakes, which is fixable far below the cost of a bigger one. A specific
   instruction, one focused self-check on the same engine, and - only when the
   output structurally fails - one retry a tier up. The floor is set by
   validation, not by price. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;

section('Work is routed by what it is, not by what the dropdown says');
{
  const r = await page.evaluate(() => {
    saveStr('amv_plan', 'elite');
    S.model = 'smart';               // the user picked the most expensive engine
    return {
      route: qModel('route'), title: qModel('title'), translate: qModel('translate'),
      step: qModel('step'), draft: qModel('draft'),
      plan: qModel('plan'), final: qModel('final'), review: qModel('review'),
    };
  });
  ok(r.route === 'amv-pulse' && r.title === 'amv-pulse' && r.translate === 'amv-pulse',
     'machinery runs on the cheapest engine', r);
  ok(r.step === 'amv-core' && r.draft === 'amv-core',
     'a bounded piece of real work runs in the middle', r);
  ok(r.plan === 'amv-apex' && r.final === 'amv-apex' && r.review === 'amv-apex',
     'and planning and the final review get the best one', r);
}

section('"Best" never means an engine the account cannot use');
{
  /* Asking for an engine above the plan would fail the call rather than
     produce a cheaper answer, which is the worst of both. */
  const r = await page.evaluate(() => {
    saveStr('amv_plan', 'free');  const free = qModel('plan');
    saveStr('amv_plan', 'pro');   const pro = qModel('plan');
    saveStr('amv_plan', 'elite'); const elite = qModel('plan');
    return { free, pro, elite };
  });
  ok(r.free === 'amv-core', 'a free account tops out at the balanced engine', r.free);
  ok(r.pro === 'amv-forge', 'Pro reaches the deep one', r.pro);
  ok(r.elite === 'amv-apex', 'and Elite the best', r.elite);
}

section('The failures that make a product feel cheap are caught without a model');
{
  const r = await page.evaluate(() => ({
    empty: qBad(''),
    short: qBad('ok'),
    refusal: qBad('I am sorry, I cannot help with that request at all, truly.'),
    placeholder: qBad('Dear [insert name], thank you for your order of TODO: item.'),
    cut: qBad('A real paragraph of prose. '.repeat(9) + 'and then it just keeps going with no', { prose: true }),
    badJson: qBad('here you go, the data you asked for: {oops', { json: true }),
    missing: qBad('A perfectly fine sentence that is long enough to pass.', { mustInclude: ['SIGNOFF'] }),
    fine: qBad('A complete, specific answer that ends properly.', { prose: true }),
    fineJson: qBad('```json\n[{"a":1}]\n```', { json: true }),
  }));
  ok(r.empty === 'empty', 'nothing at all', r.empty);
  ok(/too short/.test(r.short), 'a stub', r.short);
  ok(/refusal/.test(r.refusal), 'a refusal dressed as an answer', r.refusal);
  ok(/placeholder/.test(r.placeholder), 'placeholder text left in', r.placeholder);
  ok(/mid-sentence/.test(r.cut), 'output that stops mid-sentence', r.cut);
  ok(/JSON/.test(r.badJson), 'JSON that is not JSON', r.badJson);
  ok(/missing/.test(r.missing), 'a required element that is absent', r.missing);
  ok(r.fine === null && r.fineJson === null, 'and good output passes', [r.fine, r.fineJson]);
}

section('A usable answer costs one call');
{
  /* The point of the tiering is lost if every call quietly becomes three. */
  const r = await page.evaluate(async () => {
    const calls = [];
    window.aiComplete = async (p, s, o) => { calls.push((o || {}).model); return 'A complete and specific answer that ends properly.'; };
    const out = await qRun('step', 'do the thing', 'sys');
    return { calls, text: out.text, escalated: out.escalated, model: out.model };
  });
  ok(r.calls.length === 1, 'no self-check unless asked for', r.calls);
  ok(r.calls[0] === 'amv-core', 'on the tier the task deserves', r.calls);
  ok(r.escalated === false, 'and nothing is escalated', r.escalated);
}

section('The self-check runs on the same engine, not a dearer one');
{
  const r = await page.evaluate(async () => {
    const calls = [];
    window.aiComplete = async (p, s, o) => {
      calls.push((o || {}).model);
      return calls.length === 1 ? 'A first draft that is complete and ends properly.'
                                : 'A better second version that is complete and ends properly.';
    };
    const out = await qRun('step', 'do the thing', 'sys', { refine: true, prose: true });
    return { calls, text: out.text };
  });
  ok(r.calls.length === 2, 'a draft and one repair pass', r.calls);
  ok(r.calls[0] === 'amv-core' && r.calls[1] === 'amv-core',
     'both on the cheap tier - two cheap calls, not one expensive one', r.calls);
  ok(/better second version/.test(r.text), 'and the improved version is what is kept', r.text);
}

section('A repair that breaks the work is thrown away');
{
  /* A small engine told to "improve" something will sometimes return
     something worse. Keeping that would make the feature a downgrade. */
  const r = await page.evaluate(async () => {
    let n = 0;
    window.aiComplete = async () => { n++; return n === 1 ? 'A good complete draft that ends properly.' : 'TODO: rewrite this'; };
    const out = await qRun('step', 'do the thing', 'sys', { refine: true, prose: true });
    return out.text;
  });
  ok(/good complete draft/.test(r), 'the draft survives a bad repair', r);
}

section('Money is spent only when the cheap answer does not stand up');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_plan', 'elite');
    const calls = [];
    window.aiComplete = async (p, s, o) => {
      calls.push((o || {}).model);
      return calls.length === 1 ? '' : 'A real answer, complete and specific, ending properly.';
    };
    const out = await qRun('step', 'do the thing', 'sys');
    return { calls, escalated: out.escalated, fault: out.firstFault, text: out.text };
  });
  ok(r.calls.length === 2, 'a failed cheap answer is retried', r.calls);
  ok(r.calls[1] === 'amv-apex', 'one tier up, on the best engine available', r.calls);
  ok(r.escalated === true, 'and it says it escalated', r.escalated);
  ok(r.fault === 'empty', 'naming what was wrong with the first attempt', r.fault);
}

section('Escalation stops after one step');
{
  /* A ladder with no top is how a cost control becomes a cost multiplier. */
  const r = await page.evaluate(async () => {
    const calls = [];
    window.aiComplete = async (p, s, o) => { calls.push((o || {}).model); return ''; };
    const out = await qRun('step', 'do the thing', 'sys');
    return { n: calls.length, fault: out.fault };
  });
  ok(r.n === 2, 'two attempts, never a runaway chain', r.n);
  ok(!!r.fault, 'and the caller is told it is still not right rather than left guessing', r.fault);
}

section('An engine that throws does not take the run down');
{
  const r = await page.evaluate(async () => {
    let n = 0;
    window.aiComplete = async () => { n++; if (n === 1) throw new Error('upstream down'); return 'A recovered answer, complete and specific.'; };
    const out = await qRun('step', 'do the thing', 'sys');
    return out.text;
  });
  ok(/recovered answer/.test(r), 'it retries rather than throwing', r);
}

section('Crew spends the money where the quality is decided');
{
  /* Read from the built bundle, because the property that matters is which tier
     each call in the real loop asks for - not whether a helper exists. */
  const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const loop = bundle.slice(bundle.indexOf('async function runAutonomous(goal'),
                            bundle.indexOf('async function runAutonomous(goal') + 9000);
  ok(/qRun\('plan'/.test(loop), 'planning asks for the plan tier', /qRun\('plan'/.test(loop));
  ok(/qRun\('step'/.test(loop), 'each step asks for the step tier', /qRun\('step'/.test(loop));
  ok(/qRun\('final'/.test(loop), 'and the deliverable for the final tier', /qRun\('final'/.test(loop));
  ok(!/aiComplete\(\s*'Step: '/.test(loop),
     'no step calls the model directly any more, which is what made every step cost the top rate', true);

  /* The step is the one that repeats, so it is the one that must self-check. */
  const stepAt = loop.indexOf("qRun('step'");
  ok(/refine:\s*true/.test(loop.slice(stepAt, stepAt + 800)),
     'the repeated step is the one that gets the self-check pass', true);
}

section('The independent check is actually independent');
{
  /* The verifier used to run with no engine specified, so it ran on whichever
     one produced the answer. Hiding the first answer stops anchoring, but an
     identical model on an identical question repeats its own systematic errors -
     and the user was shown "double-checked" for what was really one engine
     agreeing with itself. */
  const r = await page.evaluate(async () => {
    saveStr('amv_plan', 'elite');
    const used = [];
    window._aiBackendReady = () => true;
    window.aiComplete = async (p, s, o) => { used.push((o || {}).model); return 'ANSWER: 12.60'; };

    S.model = 'smart';                       // answered on the best engine
    await AMVVerify.recheck('what is 15% of 84');
    const whenBest = used.slice();

    used.length = 0;
    S.model = 'core';                        // answered on the middle engine
    await AMVVerify.recheck('what is 15% of 84');
    return { whenBest, whenCore: used.slice(), primaryBest: MODELS.smart.model };
  });
  ok(r.whenCore[0] !== 'amv-core', 'it does not re-ask the engine that just answered', r.whenCore);
  ok(r.whenBest[0] !== r.primaryBest,
     'and steps sideways when the answer already came from the best one', r.whenBest);
}

section('A worked answer is not flagged as a conflict for its own working');
{
  /* The primary reply has no ANSWER: line, so its conclusion is guessed as the
     last number - and "...let me know if you want the 20% figure" concludes
     with 20. A warning that cries wolf teaches people to ignore the real one. */
  const r = await page.evaluate(() => ({
    trailing: AMVVerify.agree(
      'A 15% tip on $84 is $12.60. Let me know if you want the 20% figure too.',
      'Working: 84 * 0.15 = 12.6\nANSWER: 12.60'),
    real: AMVVerify.agree(
      'The total comes to $91.40.',
      'Working: 84 * 1.15 = 96.6\nANSWER: 96.60'),
  }));
  ok(r.trailing.agree === true,
     'the figure the check reached is found in the answer, so it agrees', r.trailing);
  ok(r.real.agree === false, 'while a genuine difference is still a conflict', r.real);
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('quality-tiers') > 0) process.exitCode = 1;
done();
