/* MODEL ECONOMICS - the catalog is where AMV's unit economics live, and two of
   its four rows were wrong. Forge was priced at 15/75 and Apex at 20/100
   against real rates of 5/25 and 10/50. No customer was ever overcharged, but
   the margin backstop spends against these numbers: a plan allows
   planPrice * 0.45 of model cost per month, so a 3x overstatement cut a paying
   user off after burning a third of the allowance their money covers.
   The catalog also decides thinking and effort, which on the current model
   generation is the difference between a complete answer and one truncated
   mid-sentence. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'econ.harness.mjs');
writeFileSync(harness, src + '\nexport { ENGINES, RAW_TO_KEY, PLAN_RANK };\n');
const W = await import(harness + '?t=' + Date.now());

/* Published rates per million tokens, as of this change. */
const RATE = {
  'claude-haiku-4-5-20251001': [1, 5],
  'claude-sonnet-5':           [3, 15],
  'claude-opus-5':             [5, 25],
  'claude-fable-5':            [10, 50],
};

section('Every engine is priced at its real rate');
Object.entries(W.ENGINES).forEach(([key, eng]) => {
  const want = RATE[eng.model];
  ok(!!want, `${key} runs a model with a known published rate`, eng.model);
  ok(eng.inCost === want[0], `${key} input cost is right`, eng.inCost + ' vs ' + want[0]);
  ok(eng.outCost === want[1], `${key} output cost is right`, eng.outCost + ' vs ' + want[1]);
});

section('The margin backstop now buys the usage the plan actually pays for');
{
  // The backstop is planPrice * 0.45 of model cost per month.
  const pro = 15 * 0.45;
  const forge = W.ENGINES['amv-forge'];
  // A representative turn: 20k cached-miss input, 2k output.
  const perTurn = (20000 / 1e6) * forge.inCost + (2000 / 1e6) * forge.outCost;
  const turnsNow = Math.floor(pro / perTurn);
  const perTurnOld = (20000 / 1e6) * 15 + (2000 / 1e6) * 75;
  const turnsBefore = Math.floor(pro / perTurnOld);
  ok(turnsNow > turnsBefore * 2,
     'a Pro user gets more than twice the deep-engine turns for the same protected margin',
     turnsBefore + ' -> ' + turnsNow + ' turns');
  /* THE PROPERTY, NOT THE SPELLING. This matched the literal text of the
     arithmetic while it lived inline in the chat handler. Moving it into one
     shared helper - which is what made the same ceiling bind image, video, SMS
     and the widget - broke the match while the 45% backstop it guards was
     untouched. A rule written against a spelling fails on a correct fix and
     passes on a regression that keeps the words (LESSONS #203). */
  const ceilFn2 = src.slice(src.indexOf('function _monthlyCeilingUSD'), src.indexOf('function _monthlyCeilingUSD') + 900);
  ok(/\* 0\.45/.test(ceilFn2), 'and the 55% margin floor itself is unchanged', true);
}

section('Thinking is configured explicitly, never left to the default');
/* On the current generation, omitting `thinking` ENABLES it, and max_tokens
   caps thinking plus the answer together. Inheriting an output cap sized for
   text alone truncates replies. */
{
  ok(/upstreamBody\.thinking = \{ type: 'adaptive' \}/.test(src),
     'the request states its thinking mode rather than inheriting a default');
  const thinkers = Object.entries(W.ENGINES).filter(([, e]) => e.thinking);
  ok(thinkers.length >= 3, 'the current-generation engines have it on', thinkers.map(([k]) => k));
  thinkers.forEach(([k, e]) => {
    ok(e.maxOut >= 16000, `${k} has output headroom for thinking AND the answer`, e.maxOut);
  });
  ok(!/type: 'disabled'/.test(src),
     'thinking is not disabled anywhere - with it off a tool call can be written as plain text and silently never run');
}

section('Effort is opt-in per engine, because sending it to the wrong one is a 400');
{
  ok(/if \(eng\.effort\)\s+upstreamBody\.output_config = \{ effort: eng\.effort \}/.test(src),
     'effort is only sent when the engine declares it');
  ok(!W.ENGINES['amv-pulse'].effort,
     'the cheapest engine does not get an effort it would reject');
  ok(W.ENGINES['amv-forge'].effort === 'high' && W.ENGINES['amv-core'].effort === 'medium',
     'and the deep engine thinks harder than the balanced one',
     [W.ENGINES['amv-core'].effort, W.ENGINES['amv-forge'].effort]);
}

section('A rejected optional parameter cannot take AI down for everyone');
/* thinking, effort and cache markers are tuning. If a model stopped accepting
   one, a naked 400 would break every chat in the product at once. */
{
  ok(/upstream\.status === 400/.test(src), 'a 400 is inspected rather than passed straight through');
  ok(/thinking\|output_config\|effort\|cache_control/.test(src),
     'and only a complaint about an OPTIONAL parameter triggers the retry');
  const guard = src.slice(src.indexOf('AMV-068'), src.indexOf('AMV-068') + 1800);
  ok(/const plain = \{/.test(guard), 'the retry strips the tuning and keeps the request');
  ok(/messages: \(body\.messages \|\| \[\]\)/.test(guard), 'sending the messages without cache markers');
  ok(/upstream_param_fallback/.test(guard), 'the fallback is audited, so it is not silent');
  ok(/alertOnce\(env, 'model_param_reject'/.test(guard),
     'and the owner is alerted that tuning is off, rather than finding out from the bill');
}

section('Old model ids a cached browser might still send still resolve');
{
  ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5', 'auto', 'core', 'smart'].forEach(id => {
    const key = W.RAW_TO_KEY[id];
    ok(!!key && !!W.ENGINES[key], `"${id}" maps to a real engine`, key);
  });
  ok(W.RAW_TO_KEY['claude-sonnet-4-6'] === 'amv-core', 'a stale Core id still means Core');
  ok(W.RAW_TO_KEY['claude-opus-4-8'] === 'amv-forge', 'and a stale Forge id still means Forge');
}

section('The client agrees with the server about price - per ENGINE, by name');
{
  /* The browser used to name the underlying models, which made this comparison
     a string match on model ids. It no longer does: AMV names engines, and what
     each engine runs on is a server decision. So the agreement is checked where
     it actually matters - the rate the usage view charges per engine has to be
     the rate the server pays for that engine, or the cost shown to the user is
     fiction. */
  const clientPrices = {};
  for (const m of client.matchAll(/'(amv-[a-z]+)':\s*\{ in: ([\d.]+),\s*out: ([\d.]+) \}/g)) {
    clientPrices[m[1]] = { in: +m[2], out: +m[3] };
  }
  ok(Object.keys(clientPrices).length === Object.keys(W.ENGINES).length,
     'every engine the server can run is priced in the client', Object.keys(clientPrices));
  for (const [key, eng] of Object.entries(W.ENGINES)) {
    const p = clientPrices[key] || {};
    ok(p.in === eng.inCost && p.out === eng.outCost,
       key + ': the usage view charges exactly what the server pays',
       JSON.stringify(p) + ' vs ' + eng.inCost + '/' + eng.outCost);
  }
  ok(!/claude-/.test(client),
     'and the browser bundle names no underlying model at all - AMV ships engines, not a wrapper');
}

section('Nothing routes to a model that is not in the catalog');
{
  const ids = new Set(Object.values(W.ENGINES).map(e => e.model));
  const hardcoded = [...src.matchAll(/model: '(claude-[a-z0-9.-]+)'/g)].map(m => m[1]);
  const strays = hardcoded.filter(m => !ids.has(m));
  ok(strays.length === 0, 'every hardcoded model in the worker is one the catalog prices', strays);
}

report();
done();
