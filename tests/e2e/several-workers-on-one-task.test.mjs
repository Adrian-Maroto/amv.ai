/* SEVERAL WORKERS ON ONE TASK, AND THEIR LIMITS HOLD.

   The delegate tool hands independent parts of a task to workers of their
   own and brings the results back to be combined. What is asserted is what
   each worker was really asked and how many ran at once (the engine call,
   aiComplete, is recorded), not what a status line says:

     each worker gets its own brief and nothing else;
     never more than three at a time, never more than six in all;
     a part can wait for others and is handed their results; an order that
     cannot be run (a missing part, a loop) is refused before anything runs,
     and a part whose input failed does not run, saying which;
     a part may search the web only if it asks to and the person allows it;
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
await page.evaluate(() => { window.__realAi = window.aiComplete; });

const run = (tasks, opts) => page.evaluate(async ({ tasks, opts }) => {
  window.__calls = []; let live = 0, peak = 0;
  window.aiComplete = async (prompt, sys, o) => {
    live++; peak = Math.max(peak, live);
    const call = { prompt, sys, signal: !!(o && o.signal), web: (o && o.webSearch) || 0, start: window.__seq = (window.__seq || 0) + 1 };
    window.__calls.push(call);
    await new Promise(r => setTimeout(r, 60));
    call.end = window.__seq = window.__seq + 1;
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
  const seven = await run(T5.concat([{ title: 'F', brief: 'x' }, { title: 'G', brief: 'y' }]));
  ok(seven.calls.length === 0 && /at most 6/.test(seven.text), 'seven parts are refused, not truncated quietly', seven.text);
  const big = await run([{ title: 'A', brief: 'x'.repeat(7000) }, { title: 'B', brief: 'y' }]);
  ok(big.calls.length === 0 && /longer than 6000/.test(big.text), 'an oversized brief is refused', big.text);
}

section('A part can wait for others and build on what they found');
{
  const r = await run([
    { title: 'Research A', brief: 'Find the facts about option A.' },
    { title: 'Research B', brief: 'Find the facts about option B.' },
    { title: 'Compare', brief: 'Compare A and B and pick one.', after: ['Research A', 'research b'] },
  ]);
  const byBrief = (b) => r.calls.find(c => c.prompt.startsWith(b));
  const a = byBrief('Find the facts about option A'), b = byBrief('Find the facts about option B'), c = byBrief('Compare A and B');
  ok(a && b && c && r.calls.length === 3, 'all three ran', r.calls.length);
  ok(c.start > a.end && c.start > b.end, 'the comparison started only after both research parts had finished', [a.end, b.end, c.start]);
  ok(a.start < b.end && b.start < a.end, 'and the two research parts ran at the same time', [a.start, a.end, b.start, b.end]);
  ok(/Results from the parts this one builds on/.test(c.prompt) && /### Research A\nanswer to: Find the facts about option A/.test(c.prompt)
     && /### Research B\nanswer to: Find the facts about option B/.test(c.prompt), 'it was handed what they found, by name', c.prompt.slice(0, 400));
  ok(!/Results from the parts/.test(a.prompt) && /build on/.test(c.sys) && !/build on/.test(a.sys), 'and only the part that waits is told about it', a.prompt.slice(0, 80));
  ok(/after Research A, research b/.test(r.render), 'the person sees which part waited for which', r.render.slice(0, 300));
}

section('An order that cannot be run is refused before anything runs');
{
  const bad = {
    'a part that is not there': [{ title: 'A', brief: 'a' }, { title: 'B', brief: 'b', after: ['Z'] }],
    'a part that waits for itself': [{ title: 'A', brief: 'a' }, { title: 'B', brief: 'b', after: ['B'] }],
    'a loop': [{ title: 'A', brief: 'a', after: ['C'] }, { title: 'B', brief: 'b', after: ['A'] }, { title: 'C', brief: 'c', after: ['B'] }],
    'two parts with one name': [{ title: 'A', brief: 'a' }, { title: 'a', brief: 'b' }],
  };
  for (const [why, tasks] of Object.entries(bad)) {
    const r = await run(tasks);
    ok(r.calls.length === 0 && /^Not delegated: /.test(r.text), why + ': refused, and nothing was paid for', r.text);
  }
  const loop = await run(bad['a loop']);
  ok(/loop/.test(loop.text) && /"A"/.test(loop.text) && /"C"/.test(loop.text), 'a loop is named as one, with the parts in it', loop.text);
}

section('A part whose input failed does not run, and says which');
{
  const r = await run([
    { title: 'Research A', brief: 'Find A.' },
    { title: 'Research B', brief: 'Find B.' },
    { title: 'Compare', brief: 'Compare them.', after: ['Research A', 'Research B'] },
    { title: 'Summary', brief: 'Summarise the comparison.', after: ['Compare'] },
    { title: 'Side note', brief: 'Something else.', after: ['Research A'] },
  ], { fail: 'Find B' });
  ok(!r.calls.some(c => /Compare them|Summarise/.test(c.prompt)), 'nothing downstream of the failure was run (or paid for)', r.calls.map(c => c.prompt.slice(0, 20)));
  ok(/Compare \(DID NOT FINISH\)\nDid not run: it needed "Research B"/.test(r.text), 'the part that waited says what it was waiting for', r.text);
  ok(/Summary \(DID NOT FINISH\)\nDid not run: it needed "Compare"/.test(r.text), 'and so does the part after that', r.text.slice(-500));
  ok(r.calls.some(c => /Something else/.test(c.prompt)), 'a part that did not need the failed one still ran', r.calls.length);
  ok(/did not come back: Research B, Compare, Summary/.test(r.text), 'and the main answer is told every part that is missing', r.text.slice(-250));
}

section('A part searches the web only if it asks to, and only if the person allows it');
{
  const tasks = [{ title: 'Prices', brief: 'Today\'s prices of A.', search: true }, { title: 'Opinion', brief: 'Which feels better to use.' }];
  let r = await run(tasks);
  const p = r.calls.find(c => c.prompt.startsWith('Today')), o = r.calls.find(c => c.prompt.startsWith('Which'));
  ok(p.web === 3 && /may search the web/.test(p.sys), 'the part that asked may search, a few times', [p.web, p.sys.slice(0, 120)]);
  ok(o.web === 0 && /no tools/.test(o.sys), 'the part that did not ask may not', [o.web]);
  await page.evaluate(() => saveStr('amv_cap_websearch', '0'));
  r = await run(tasks);
  const p2 = r.calls.find(c => c.prompt.startsWith('Today'));
  ok(/no tools/.test(p2.sys) && !/may search/.test(p2.sys), 'with web search switched off, it is told it cannot', p2.sys.slice(0, 120));
  const body = await page.evaluate(async () => {
    const real = window.fetchDeadline, realBase = window._aiBase; let seen = null, reached = 0, why = '';
    window._aiBase = () => 'https://engine.test/v1/messages';
    window.fetchDeadline = async (u, init) => { reached++; seen = JSON.parse(init.body); throw new Error('stop here'); };
    try { await window.__realAi('q', 's', { webSearch: 3 }); } catch (e) { why = e.message; }
    const off = seen; saveStr('amv_cap_websearch', '1'); seen = null;
    try { await window.__realAi('q', 's', { webSearch: 3 }); } catch (e) {}
    window.fetchDeadline = real; window._aiBase = realBase;
    return { reached, why, off: off ? (off.tools || 'none') : null, on: seen && seen.tools };
  });
  ok(body.reached === 2, 'both engine calls really reached the network step', body);
  ok(body.off === 'none', 'and the engine call carries no search tool when it is off', body.off);
  ok(body.on && body.on[0].name === 'web_search' && body.on[0].max_uses === 3, 'and carries one, bounded, when it is on', body.on);
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
