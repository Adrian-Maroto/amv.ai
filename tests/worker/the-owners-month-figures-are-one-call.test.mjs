/* THE OWNER'S MONTH FIGURES ARE ONE CALL A TURN (Nov 1 audit USAGE-001).

   Cost, cost by feature, outcomes, caching saved and how fast answers start
   were one counter object call each - up to seven per chat turn, on top of
   the calls that guard money. They are fields of one object per shard per
   month now (`_econAdd`). Driven through the REAL counter class:
     - several fields land in one call, and add up across calls;
     - `_tallyGet` reads them back, together with anything written the old
       way this month, so no figure drops when the deploy lands mid-month;
     - with no object that knows the op, the same numbers are written one at
       a time - nothing is lost. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'econ.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _econAdd, _tallyAdd, _tallyGet, monthKey };\n');
const W = await import(harness + '?t=' + Date.now());

function realNamespace() {
  const objs = new Map(); let calls = 0;
  const get = (n) => {
    if (!objs.has(n)) {
      const store = new Map();
      const state = { storage: { async get(k) { return store.get(k); }, async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); }, async deleteAll() { store.clear(); }, async setAlarm() {}, async deleteAlarm() {} } };
      objs.set(n, new W.AMVCounter(state, {}));
    }
    return objs.get(n);
  };
  return { ns: { idFromName: n => n, get: (n) => ({ async fetch(u, init) { calls++; return get(n).fetch(new Request('https://do/c', init)); } }) }, calls: () => calls };
}

const mk = W.monthKey();
section('Several figures, one call, added up');
{
  const R = realNamespace();
  const env = { AMV_COUNTER: R.ns, AMV_KV: { async get() { return null; }, async put() {}, async delete() {} } };
  const before = R.calls();
  await W._econAdd(env, 'ana@x.com', [[`costtotal:${mk}`, 0.25], [`featcost:chat:${mk}`, 0.25], [`ttfbn:${mk}`, 1]]);
  ok(R.calls() - before === 1, 'three figures were one call', R.calls() - before);
  await W._econAdd(env, 'ana@x.com', [[`costtotal:${mk}`, 0.5], [`featcost:chat:${mk}`, 0.5], [`ttfbn:${mk}`, 1]]);
  await W._econAdd(env, 'ben@x.com', [[`costtotal:${mk}`, 1]]);
  ok(Math.abs(await W._tallyGet(env, `costtotal:${mk}`) - 1.75) < 1e-9, 'read back, summed across people and shards', await W._tallyGet(env, `costtotal:${mk}`));
  ok(Math.abs(await W._tallyGet(env, `featcost:chat:${mk}`) - 0.75) < 1e-9 && await W._tallyGet(env, `ttfbn:${mk}`) === 2, 'each field on its own', true);
  /* Written the old way earlier this month: still counted. */
  await W._tallyAdd(env, `costtotal:${mk}`, 'cy@x.com', 2, 86400000);
  ok(Math.abs(await W._tallyGet(env, `costtotal:${mk}`) - 3.75) < 1e-9, 'with what was written one at a time before the change', await W._tallyGet(env, `costtotal:${mk}`));
  await W._econAdd(env, 'ana@x.com', [[`costtotal:${mk}`, 0], [`featcost:chat:${mk}`, NaN]]);
  ok(Math.abs(await W._tallyGet(env, `costtotal:${mk}`) - 3.75) < 1e-9, 'nothing is added for a zero or a number that is not one', true);
}

section('With no object that knows the op, nothing is lost');
{
  const vals = new Map(); let calls = 0;
  const env = { AMV_KV: { async get() { return null; }, async put() {}, async delete() {} }, AMV_COUNTER: { idFromName: n => n, get: (n) => ({ async fetch(u, init) {
    calls++; const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
    if (b.op === 'incr') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ value: cur + b.amount })); }
    return new Response(JSON.stringify({ value: cur }));
  } }) } };
  await W._econAdd(env, 'ana@x.com', [[`costtotal:${mk}`, 0.4], [`featcost:chat:${mk}`, 0.4]]);
  ok(calls === 3, 'it asks once, then writes each one the old way', calls);
  ok(Math.abs(await W._tallyGet(env, `costtotal:${mk}`) - 0.4) < 1e-9, 'and the figure is there', await W._tallyGet(env, `costtotal:${mk}`));
}

if (report('the-owners-month-figures-are-one-call') > 0) process.exitCode = 1;
done();
