/* AN OBJECTIVE IS MEASURED, AND A BREACH IS SAID (Nov 1 audit REL-010).

   docs/SLO.md's objectives were partly "not yet measured". They are computed
   now from the month's own counts - answers delivered whole, background runs
   that produced their result, how fast answers started - with the share of
   each error budget spent; an objective over budget is told to the owner
   once a day, naming the runbook section that exists for it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'slo.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _sloReport, runSloCheck, _outcomeAdd, _tallyAdd, monthKey, ENGINES, _ttfbBucket, _ttfbPercentiles };\n');
const W = await import(harness + '?t=' + Date.now());

const calls = { n: 0 };
const mkEnv = () => { const kv = new Map(), vals = new Map(); const told = [];
  return { told, ALERT_WEBHOOK: 'https://hooks.example/owner',
    AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } },
    AMV_COUNTER: { idFromName: n => n, get: (n) => ({ async fetch(_u, init) { calls.n++; const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      /* The month's figures are fields of one object per shard, as the real counter keeps them. */
      if (b.op === 'tallyMany') { const f = vals.get(n + '#tm') || {}; for (const [k, v] of Object.entries(b.fields || {})) f[k] = (f[k] || 0) + v; vals.set(n + '#tm', f); return new Response(JSON.stringify({ ok: true, many: true })); }
      if (b.op === 'tallyFields') return new Response(JSON.stringify({ fields: vals.get(n + '#tm') || {} }));
      return new Response(JSON.stringify({ value: cur })); } }) } }; };
const sent = [];
globalThis.fetch = async (u, init) => { sent.push(String(init && init.body || '')); return new Response('{}'); };
const mk = W.monthKey();

section('Measured from what happened');
{
  const env = mkEnv();
  for (let i = 0; i < 200; i++) await W._outcomeAdd(env, 'chat', 'u' + i, true);
  for (let i = 0; i < 99; i++) await W._outcomeAdd(env, 'background', 'u' + i, true);
  await W._outcomeAdd(env, 'background', 'x', false);
  for (let i = 0; i < 40; i++) await W._tallyAdd(env, `ttfb:amv-core:p1000:${mk}`, 'u' + i, 1);
  const r = await W._sloReport(env, mk);
  const by = Object.fromEntries(r.map(o => [o.id, o]));
  ok(by.chat_delivered.actualPct === 100 && by.chat_delivered.status === 'ok', 'every answer delivered: inside its objective', by.chat_delivered);
  ok(by.background_runs.actualPct === 99 && by.background_runs.budgetUsedPct === 100 && by.background_runs.status === 'broken', 'one failed run in a hundred spends the whole 1% budget', by.background_runs);
  ok(by.chat_starts_fast.actualPct === 100 && by.chat_starts_fast.runs === 40, 'and how fast answers start, from the buckets', by.chat_starts_fast);
}

section('How long the slowest answers waited, not only the average (Nov 3 audit REL-010)');
{
  ok(W._ttfbBucket(120) === 'p500' && W._ttfbBucket(4999) === 'p5000' && W._ttfbBucket(7000) === 'p10000' && W._ttfbBucket(29999) === 'p30000' && W._ttfbBucket(45000) === 'slow',
     'a wait lands in the bucket it is under, and five seconds is no longer the last line');
  const env = mkEnv();
  for (let i = 0; i < 90; i++) await W._tallyAdd(env, `ttfb:amv-core:p500:${mk}`, 'a' + i, 1);
  for (let i = 0; i < 6; i++) await W._tallyAdd(env, `ttfb:amv-core:p2500:${mk}`, 'b' + i, 1);
  for (let i = 0; i < 3; i++) await W._tallyAdd(env, `ttfb:amv-core:p10000:${mk}`, 'c' + i, 1);
  await W._tallyAdd(env, `ttfb:amv-core:slow:${mk}`, 'd', 1);
  const f = (await W._sloReport(env, mk)).find(o => o.id === 'chat_starts_fast');
  ok(f.runs === 100 && f.p50 === 'under 500' && f.p95 === 'under 2500' && f.p99 === 'under 10000', 'p50, p95 and p99 come from the histogram', f);
  ok(f.actualPct === 96, 'and the four answers over five seconds are what spend the budget', f.actualPct);
  ok(W._ttfbPercentiles({}).p99 === null, 'with nothing counted there is no percentile, not a zero');
}

section('A broken objective is told to the owner once a day, with its runbook');
{
  const env = mkEnv();
  for (let i = 0; i < 50; i++) await W._outcomeAdd(env, 'chat', 'u' + i, i > 4);
  sent.length = 0;
  const a = await W.runSloCheck(env);
  ok(a.told === 1 && sent.some(b => /Objective broken: A chat answer is delivered whole/.test(b) && /An objective is broken/.test(b)), 'said, naming the runbook', sent);
  const b = await W.runSloCheck(env);
  ok(b.told === 0, 'and not again the same day', b);
  const runbook = readFileSync(join(ROOT, 'docs', 'INCIDENT-RUNBOOK.md'), 'utf8');
  ok(/## An objective is broken/.test(runbook), 'the runbook section it names exists', true);
  const few = mkEnv(); await W._outcomeAdd(few, 'chat', 'u', false);
  ok((await W.runSloCheck(few)).told === 0, 'too few answers to judge is not called a breach', true);
}

section('The hourly check is a handful of calls, not a thousand');
{
  /* Read figure by figure it was 33 object calls a figure and about forty
     figures - over a thousand calls in one cron run, which took the runtime
     down (Nov 2). The month's fields come back one call per shard. */
  const env = mkEnv();
  calls.n = 0;
  await W.runSloCheck(env);
  ok(calls.n > 0 && calls.n <= 40, 'one cron check reads the month in a bounded number of calls', calls.n);
}

if (report('an-objective-is-measured-and-its-breach-said') > 0) process.exitCode = 1;
done();
