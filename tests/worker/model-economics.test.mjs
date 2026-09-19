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
import { functionBody, codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'econ.harness.mjs');
writeFileSync(harness, src + '\nexport { ENGINES, RAW_TO_KEY, PLAN_RANK, _resolveEffort };\n');
const W = await import(harness + '?t=' + Date.now());

/* PUBLISHED RATES PER MILLION TOKENS - THE ORACLE, NOT A MIRROR.

   This table is deliberately a SECOND copy, written from the published price
   list rather than read from the worker, because a check that reads the number
   it is checking proves nothing. It is what catches a typo in the engine
   table, and it has now caught two real ones.

   The balanced engine sat here at 3/15 for as long as the worker did. That is
   the PREVIOUS generation's rate, and it was wrong in both places at once -
   which is exactly the failure mode a second copy is supposed to prevent and
   did not, because both were typed from the same memory rather than from the
   price list. Corrected from the published rates.

   Whoever changes an engine changes this too, from the price list and not from
   the other file. */
const RATE = {
  'claude-haiku-4-5-20251001': [1, 5],
  'claude-haiku-4-5':          [1, 5],
  'claude-sonnet-5':           [2, 10],
  'claude-sonnet-4-6':         [3, 15],
  'claude-opus-5':             [5, 25],
  'claude-fable-5':            [10, 50],
  'claude-fable-5-1':          [10, 50],
};

section('Every engine is priced at its real rate');
Object.entries(W.ENGINES).forEach(([key, eng]) => {
  const want = RATE[eng.model];
  ok(!!want, `${key} runs a model with a known published rate`, eng.model);
  /* GUARDED, BECAUSE THIS SUITE THREW AND TOOK THE RUN WITH IT.

     An engine whose model is not in the table above left `want` undefined and
     the next line read `want[0]`, which is a TypeError, not a failed
     assertion. The suite died there - so the engines after it were never
     checked, and the gate reported a crash rather than the one missing rate.
     A finding has to be a finding; only a crash can hide the next one. */
  if (!want) return;
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
  /* WHAT THE ALLOWANCE IS MEASURED AGAINST - STATED, NOT ASSUMED.

     This used to compare today's turns against 15/75, the overstatement that
     was corrected long ago. That was a true statement about one historical
     change and a meaningless baseline to keep forever, and it failed the
     moment the paid floor moved onto a dearer engine while nothing was wrong.
     Worse, it never ran: the suite threw a TypeError a few lines above, so the
     assertion was dead.

     What matters is whether a customer can spend what they were sold. That
     depends entirely on the BASIS, and picking the basis silently is how this
     went wrong in both directions inside one afternoon - first assumed
     generous and unchecked, then cut to an adversarial worst case that took a
     Pro day from 192 real turns to 40.

     So the basis is written down here as numbers anybody can argue with:
     turns are routed, most of them to the cheaper engines, and half the input
     is served from cache at a tenth of the rate. If that mix stops being true
     the arithmetic below stops passing, which is the point - it is a claim
     about how the product runs, not a formula that always agrees with itself.

     The worst case is NOT asserted to fit, deliberately. Somebody running the
     top engine for every turn with no cache hits does exhaust the dollar
     ceiling before the token cap, and that is the anti-abuse floor doing its
     job rather than a customer being short-changed. */
  const CACHED_INPUT_SHARE = 0.5;          // half the input is a cache read
  const CACHE_DISCOUNT = 0.1;              // served at a tenth of the rate
  const TOP_ENGINE_SHARE = 0.25;           // a quarter of turns on the dearest engine
  const rate = (e) => (10 / 11) * e.inCost * (CACHED_INPUT_SHARE * CACHE_DISCOUNT + (1 - CACHED_INPUT_SHARE))
                    + (1 / 11) * e.outCost;
  const core = W.ENGINES['amv-core'], pulse = W.ENGINES['amv-pulse'];
  const rest = 1 - TOP_ENGINE_SHARE;
  const blended = TOP_ENGINE_SHARE * rate(forge) + rest * 0.7 * rate(core) + rest * 0.3 * rate(pulse);
  const monthTokens = 2340000;             // Pro's published allowance
  const costOfFullAllowance = (monthTokens / 1e6) * blended;
  const reachable = Math.min(1, pro / costOfFullAllowance);
  /* NOT ASSERTED AT 100%, AND THE NUMBER IS PRINTED SO NOBODY HAS TO GUESS.

     At this mix the full allowance costs $8.43 of compute against $6.75
     protected, so a moderate user reaches about four fifths of what they were
     sold before the dollar ceiling arrives. That is a real gap and a much
     smaller one than the five-fold version found earlier, and closing it the
     rest of the way is not an engineering choice - it is the backstop
     multiplier, which is margin, which is the owner's to set.

     So what is pinned is the thing that must not silently rot: the great
     majority of a published allowance has to be spendable. If a future rate or
     engine change pushes this under three quarters, the advertised number has
     started misleading people again and this line says so. */
  ok(reachable >= 0.75,
     'the great majority of the published allowance is spendable before the backstop',
     (reachable * 100).toFixed(0) + '% reachable - $' + costOfFullAllowance.toFixed(2)
       + ' of compute vs $' + pro.toFixed(2) + ' protected');
  ok(turnsNow >= 20,
     'and a month still holds a real number of top-engine turns, not a token gesture',
     turnsNow + ' turns of 20k in / 2k out');
  /* THE PROPERTY, NOT THE SPELLING. This matched the literal text of the
     arithmetic while it lived inline in the chat handler. Moving it into one
     shared helper - which is what made the same ceiling bind image, video, SMS
     and the widget - broke the match while the 45% backstop it guards was
     untouched. A rule written against a spelling fails on a correct fix and
     passes on a regression that keeps the words (LESSONS #203). */
  const ceilFn2 = src.slice(src.indexOf('function _monthlyCeiling('), src.indexOf('function _monthlyCeiling(') + 900);
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
  /* THE PROPERTY, NOT THE SPELLING. This matched the literal line
     `if (eng.effort) upstreamBody.output_config = { effort: eng.effort }`
     and broke the moment effort became a plan-capped REQUEST routed through
     a resolver - while the thing it guards, that an engine which takes no
     effort is never sent one, was untouched. A rule written against a
     spelling fails on a correct change and passes on a regression that keeps
     the words (LESSONS #203).

     So the resolver is asked directly, for every engine and every plan. The
     end-to-end half - that the request really carries no output_config for
     such an engine - is asserted through the live route in
     worker/effort-cannot-outrun-the-plan. */
  const noEffortEngines = Object.entries(W.ENGINES).filter(([, e]) => !e.effort);
  ok(noEffortEngines.length >= 1,
     'at least one engine declares no effort, so this has a subject',
     noEffortEngines.map(([k]) => k));
  let leaked = [];
  for (const [k, e] of noEffortEngines) {
    for (const rank of Object.values(W.PLAN_RANK)) {
      for (const want of ['medium', 'high', undefined]) {
        if (W._resolveEffort(e, want, rank) !== null) leaked.push(k + '/' + rank + '/' + want);
      }
    }
  }
  ok(leaked.length === 0,
     'effort is only sent when the engine declares it', leaked.slice(0, 4));
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
  /* Anchored on the handler, not on the comment that used to introduce it.
     `src.indexOf('AMV-068')` found a marker that exists only in prose: delete
     the comment and indexOf returns -1, the 1800-character window becomes the
     last character of the file, and all four assertions below fail on code
     that never changed. Worse the other way - move the comment and the window
     silently covers unrelated code while still passing. */
  const guard = codeOnly(functionBody(src, 'aiProxy'));
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
