/* UNIT ECONOMICS — the dashboard reported one blended AI cost figure, which
   cannot answer any of the questions that decide whether this business works:
   is each tier profitable, which accounts cost more than they pay, and where
   is the money actually going. Those are the numbers you steer on. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'econ2.harness.mjs');
writeFileSync(harness, src + '\nexport { adminStats, setEntitlement, counter, monthKey, DB };\n');
const W = await import(harness + '?t=' + Date.now());

function makeEnv() {
  const kv = new Map();
  return { _kv: kv, ADMIN_TOKEN: 'admin-secret', JWT_SECRET: 'test-secret-abcdefghijklmnop',
    AMV_KV: { get: async k => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }) } };
}
const spend = (env, email, amount) => W.counter(env, `cost:${email}:${W.monthKey()}`, { op: 'incr', amount });
const dash = env => W.adminStats(new Request('https://w/v1/admin/stats',
  { headers: { Authorization: 'Bearer admin-secret' } }), env);

/* A small but realistic book: profitable tiers, one runaway account, and free
   users who cost money. */
async function seed(env) {
  await W.setEntitlement(env, 'pro1@x.com', 'pro');      await spend(env, 'pro1@x.com', 2.00);
  await W.setEntitlement(env, 'pro2@x.com', 'pro');      await spend(env, 'pro2@x.com', 3.50);
  await W.setEntitlement(env, 'ultra1@x.com', 'ultra');  await spend(env, 'ultra1@x.com', 260.00);  // costs more than it pays
  await W.setEntitlement(env, 'elite1@x.com', 'elite');  await spend(env, 'elite1@x.com', 10.00);
  await W.setEntitlement(env, 'free1@x.com', 'free');    await spend(env, 'free1@x.com', 0.80);
  await W.setEntitlement(env, 'free2@x.com', 'free');    await spend(env, 'free2@x.com', 0.40);
}

section('Every tier reports its own revenue, cost and margin');
{
  const env = makeEnv(); await seed(env);
  const d = await (await dash(env)).json();
  const byPlan = Object.fromEntries(d.margin.byPlan.map(p => [p.plan, p]));

  ok(byPlan.pro.users === 2, 'the Pro cohort is counted', byPlan.pro.users);
  ok(byPlan.pro.revenue === 30, 'with its real revenue', byPlan.pro.revenue);
  ok(byPlan.pro.cost === 5.5, 'and its real AI cost', byPlan.pro.cost);
  ok(byPlan.pro.grossMargin === 24.5, 'so the margin is arithmetic, not a guess', byPlan.pro.grossMargin);
  ok(byPlan.pro.grossMarginPct === 81.7, 'reported as a percentage too', byPlan.pro.grossMarginPct);
  ok(byPlan.pro.costPerUser === 2.75, 'and per user, which is the number that scales', byPlan.pro.costPerUser);
}

section('A tier losing money is visible as losing money');
{
  const env = makeEnv(); await seed(env);
  const d = await (await dash(env)).json();
  const ultra = d.margin.byPlan.find(p => p.plan === 'ultra');
  ok(ultra.grossMargin < 0, 'the Ultra cohort shows a negative margin', ultra.grossMargin);
  ok(ultra.grossMarginPct < 0, 'and a negative percentage rather than being hidden', ultra.grossMarginPct);
}

section('A free cohort reports no margin percentage, not a fake one');
{
  const env = makeEnv(); await seed(env);
  const d = await (await dash(env)).json();
  const free = d.margin.byPlan.find(p => p.plan === 'free');
  ok(free.revenue === 0, 'free users bring no revenue', free.revenue);
  ok(free.grossMarginPct === null, 'so the percentage is null, not a meaningless -100%', free.grossMarginPct);
  ok(d.margin.freeUserCost === 1.2, 'but their cost is reported - that is the price of the funnel', d.margin.freeUserCost);
}

section('Accounts costing more than they pay are named');
{
  const env = makeEnv(); await seed(env);
  const d = await (await dash(env)).json();
  const bad = d.margin.unprofitableAccounts;
  ok(bad.length === 1, 'exactly the one runaway account', bad.map(u => u.email));
  ok(bad[0].email === 'ultra1@x.com', 'identified by address, so it can be acted on', bad[0].email);
  ok(bad[0].lossUSD === 60, 'with what it is actually losing', bad[0].lossUSD);
  ok(!bad.some(u => u.plan === 'free'), 'free users are not listed - they are not "unprofitable", they are the funnel');
}

section('Overall margin is reported, not left to be worked out');
{
  const env = makeEnv(); await seed(env);
  const d = await (await dash(env)).json();
  ok(d.margin.grossMargin === +(d.revenue.estMRR - d.margin.estMonthlyCost).toFixed(2),
     'gross margin is MRR minus cost', d.margin.grossMargin);
  ok(typeof d.margin.grossMarginPct === 'number', 'as a percentage too', d.margin.grossMarginPct);
  ok(d.margin.costPerPayingUser > 0, 'and the cost of serving one paying user', d.margin.costPerPayingUser);
}

section('Where the money goes, and what caching is worth');
{
  const env = makeEnv(); await seed(env);
  const mk = W.monthKey();
  await W.counter(env, `featcost:chat:${mk}`, { op: 'incr', amount: 40 });
  await W.counter(env, `featcost:image:${mk}`, { op: 'incr', amount: 220 });
  await W.counter(env, `cachesave:${mk}`, { op: 'incr', amount: 63.5 });
  const d = await (await dash(env)).json();
  ok(d.margin.featureCost.image === 220, 'spend is split by feature', d.margin.featureCost);
  ok(d.margin.featureCost.image > d.margin.featureCost.chat,
     'so "images are eating the margin while chat is fine" is visible at a glance');
  ok(!('video' in d.margin.featureCost), 'features with no spend are omitted rather than shown as zero');
  ok(d.margin.cacheSavedUSD === 63.5, 'and caching reports what it saved, which is otherwise invisible money',
     d.margin.cacheSavedUSD);
}

section('The counters are actually written by the meter');
{
  ok(/featcost:\$\{feature \|\| 'chat'\}/.test(src), 'every metered call attributes its cost to a feature');
  ok(/cachesave:\$\{mk\}/.test(src), 'and records what the cache saved');
  ok(/eng\.inCost \* 0\.90/.test(src), 'the saving is the 90% a cache read did not cost', true);
  const meter = src.slice(src.indexOf('async function meterStream'));
  ok(/catch \(e\) \{ \/\* reporting must never break metering \*\/ \}/.test(meter),
     'and a reporting failure can never break the billing it reports on');
}

section('It is on the screen, not just in the response');
{
  const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
  ok(/Unit economics by tier/.test(client), 'the tier table is rendered');
  ok(/Accounts costing more than they pay/.test(client), 'so is the unprofitable-account list');
  ok(/Where the money goes/.test(client), 'and the feature split');
  ok(/cacheSavedUSD/.test(client), 'with what caching saved');
  ok(/adm-neg/.test(client), 'a negative margin is styled as negative, not as a plain number');
}

report();
done();
