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
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _sloReport, runSloCheck, _outcomeAdd, _tallyAdd, monthKey, ENGINES };\n');
const W = await import(harness + '?t=' + Date.now());

const mkEnv = () => { const kv = new Map(), vals = new Map(); const told = [];
  return { told, ALERT_WEBHOOK: 'https://hooks.example/owner',
    AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } },
    AMV_COUNTER: { idFromName: n => n, get: (n) => ({ async fetch(_u, init) { const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
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

if (report('an-objective-is-measured-and-its-breach-said') > 0) process.exitCode = 1;
done();
