/* SEVERAL WORKERS ON ONE TASK, AND THEIR LIMITS HOLD.

   The delegate tool hands independent parts of a task to workers of their
   own and brings the results back to be combined. What is asserted is what
   each worker was really asked and how many ran at once (the engine call,
   aiComplete, is recorded), not what a status line says:

     each worker gets its own brief and nothing else;
     never more than three at a time, never more than five in all;
     a worker that fails is named as failed, the others still arrive, and the
     main answer is told not to write the missing part itself;
     Stop stops them; and the tool reaches the model at all. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const run = (tasks, opts) => page.evaluate(async ({ tasks, opts }) => {
  window.__calls = []; let live = 0, peak = 0;
  window.aiComplete = async (prompt, sys, o) => {
    live++; peak = Math.max(peak, live);
    window.__calls.push({ prompt, sys, signal: !!(o && o.signal) });
    await new Promise(r => setTimeout(r, 60));
    live--;
    if (opts && opts.fail && prompt.includes(opts.fail)) throw new Error('engine unavailable');
    return 'answer to: ' + prompt.slice(0, 30);
  };
  const r = await _amvRunTool('delegate', { tasks }, () => {});
  return { text: r.text, render: r.render || '', calls: window.__calls, peak };
}, { tasks, opts: opts || null });

const T5 = ['Laptop A', 'Laptop B', 'Laptop C', 'Laptop D', 'Laptop E'].map(n => ({ title: n, brief: 'Assess ' + n + ' for battery and weight.' }));

section('Each part goes to a worker of its own, and every result comes back');
{
  const r = await run(T5);
  ok(r.calls.length === 5, 'five parts, five workers', r.calls.length);
  ok(r.calls.every((c, i) => c.prompt === T5[i].brief), 'each worker was given exactly its own brief', r.calls.map(c => c.prompt.slice(0, 20)));
  ok(r.calls.every(c => /one of several AMV workers/.test(c.sys) && /no tools/.test(c.sys)), 'and told it is one part, with no tools', r.calls[0] && r.calls[0].sys.slice(0, 80));
  ok(T5.every((t, i) => r.text.includes('Worker ' + (i + 1) + ' - ' + t.title)), 'every result is labelled with its part', r.text.slice(0, 200));
  ok(r.peak <= 3 && r.peak >= 2, 'never more than three at once, and really more than one', r.peak);
  ok(/5 workers/.test(r.render) && (r.render.match(/dlg-i/g) || []).length === 5, 'the person sees the five parts', r.render.slice(0, 120));
}

section('A worker that fails is named, and nobody fills its part in silently');
{
  const r = await run(T5.slice(0, 3), { fail: 'Laptop B' });
  ok(/Laptop B \(DID NOT FINISH\)/.test(r.text) && /Failed: engine unavailable/.test(r.text), 'the failed part says so', r.text.slice(0, 300));
  ok(/did not come back: Laptop B/.test(r.text) && /do not write those parts yourself/.test(r.text), 'and the main answer is told not to invent it', r.text.slice(-200));
  ok(/answer to: Assess Laptop A/.test(r.text) && /answer to: Assess Laptop C/.test(r.text), 'the others still arrive', true);
}

section('Its limits hold');
{
  const one = await run(T5.slice(0, 1));
  ok(one.calls.length === 0 && /at least two/.test(one.text), 'one part is not delegated', one.text);
  const six = await run(T5.concat([{ title: 'F', brief: 'x' }]));
  ok(six.calls.length === 0 && /at most 5/.test(six.text), 'six parts are refused, not truncated quietly', six.text);
  const big = await run([{ title: 'A', brief: 'x'.repeat(7000) }, { title: 'B', brief: 'y' }]);
  ok(big.calls.length === 0 && /longer than 6000/.test(big.text), 'an oversized brief is refused', big.text);
}

section('Stop stops the workers');
{
  const r = await page.evaluate(async () => {
    const ctrl = new AbortController(); _activeStreamCtrl = ctrl;
    let started = 0;
    window.aiComplete = async (p, s, o) => { started++; if (started === 2) ctrl.abort('user-stop'); await new Promise(r => setTimeout(r, 30)); if (o.signal && o.signal.aborted) throw new Error('aborted'); return 'ok'; };
    const tasks = ['1', '2', '3', '4', '5'].map(n => ({ title: 'P' + n, brief: 'part ' + n }));
    const out = await _amvRunTool('delegate', { tasks }, () => {});
    _activeStreamCtrl = null;
    return { started, text: out.text };
  });
  ok(r.started <= 3, 'no new worker starts after Stop', r.started);
  ok(/Stopped/.test(r.text), 'and the result says they were stopped', r.text.slice(0, 200));
}

section('The model can actually call it');
{
  const tools = await page.evaluate(() => _toolsFor('chat').map(t => t.name));
  ok(tools.includes('delegate'), 'chat offers it', tools.length);
  const server = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  const allow = server.slice(server.indexOf('const AMV_CLIENT_TOOLS'), server.indexOf(']);', server.indexOf('const AMV_CLIENT_TOOLS')));
  ok(/'delegate'/.test(allow), 'and the server lets it through to the model', allow.length);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('several-workers-on-one-task') > 0) process.exitCode = 1;
done();
