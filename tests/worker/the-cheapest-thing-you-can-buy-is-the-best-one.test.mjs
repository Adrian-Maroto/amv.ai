/* THE PAID FLOOR RUNS THE TOP ENGINE, AND FOUR THINGS HAVE TO AGREE FOR THAT
   TO BE TRUE RATHER THAN CLAIMED.

   The decision is a product one: the least somebody can spend to become a
   customer buys the best widely released model, and the tiers above buy more
   of it rather than a better one. Free stays on a cheaper engine, because free
   is the tier with the most accounts and no revenue, and a model that loses
   money on every request there is the decision that ends companies.

   What makes it real is agreement between four separate places, and this
   repository's recurring defect is exactly two of them drifting:

     - the engine table, which says what each rung runs and what it bills;
     - the plan floor on each rung, which is what makes it a PAID floor;
     - the map from a raw model string to a rung, which is stale by default -
       when the ladder moved, the top engine's own model string still pointed
       at the rung below it, so a picker asking for the best model would have
       been served the one under it with nothing failing anywhere;
     - and the rates, which the margin backstop spends against, so a wrong one
       cuts a paying customer off early or late without any error at all.

   None of those fail loudly. Each is a number or a string that is simply the
   wrong one. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ladder.harness.mjs');
writeFileSync(harness, src + `
export { ENGINES, RAW_TO_KEY, PLAN_RANK, engineModel };
`);
const W = await import(harness + '?t=' + Date.now());

const { ENGINES, RAW_TO_KEY, PLAN_RANK } = W;
const rung = (k) => ENGINES[k];

section('The cheapest paid rung runs the same family as the top one');
{
  const paid = Object.entries(ENGINES).filter(([, e]) => PLAN_RANK[e.minPlan] > 0);
  ok(paid.length >= 2, 'there is more than one paid rung', paid.map(([k]) => k));

  paid.sort((a, b) => PLAN_RANK[a[1].minPlan] - PLAN_RANK[b[1].minPlan]);
  const floor = paid[0][1];
  const top = paid[paid.length - 1][1];

  ok(floor.minPlan === 'pro', 'the paid floor is the first plan somebody can buy', floor.minPlan);
  /* The claim is not "the same model" - the rung above is its successor. It is
     that nothing cheaper is better and nothing better is cheaper, which on
     published rates means the floor bills what the top bills. */
  ok(floor.inCost === top.inCost && floor.outCost === top.outCost,
     'and it bills the same per token as the top rung, so paying more buys MORE of the best, not a better one',
     { floor: [floor.inCost, floor.outCost], top: [top.inCost, top.outCost] });
  ok(floor.model !== top.model,
     'while still being a distinct engine, so the rung above is worth having', [floor.model, top.model]);
  ok(floor.effort === 'high', 'the paid floor thinks at the top effort its plan allows', floor.effort);
}

section('Free is not run on the most expensive engine');
{
  /* The decision that was explicitly weighed and explicitly not taken. */
  const free = Object.entries(ENGINES).filter(([, e]) => e.minPlan === 'free');
  ok(free.length >= 1, 'there are free rungs', free.map(([k]) => k));
  const dearestPaid = Math.max(...Object.values(ENGINES).map(e => e.inCost));
  for (const [key, e] of free) {
    ok(e.inCost < dearestPaid,
       `[${key}] a free request costs less per token than the dearest paid engine`,
       { free: e.inCost, dearest: dearestPaid });
  }
}

section('Every rung is reachable by its own model string');
{
  /* THE ONE THAT WAS ACTUALLY WRONG. The map kept pointing at the rungs these
     strings used to mean. Nothing throws when it is stale: the request is
     served, by the wrong engine, at the wrong price. */
  for (const [key, e] of Object.entries(ENGINES)) {
    ok(RAW_TO_KEY[e.model] === key,
       `[${key}] its own model string resolves back to it, not to a neighbour`,
       { model: e.model, resolvesTo: RAW_TO_KEY[e.model] });
  }
}

section('And no string resolves to a rung that would be a downgrade');
{
  /* Previous-generation ids are kept because a cached client build still sends
     them. They must not land on a rung BELOW the one they used to name, or a
     stale browser quietly gets less than it asks for.

     MEASURED BY PLAN, NOT BY PRICE - and the first version of this got that
     wrong. It ranked capability by cost, which only orders models inside one
     generation: the balanced engine's current model is both newer than the
     4-6 it replaced AND cheaper, so a correct resolution looked like a
     downgrade to a check comparing rates. Price falls over time; the tier a
     model was sold at does not. So what is asserted is the rung: a string that
     named a paid tier still lands on a paid tier, and one that named the free
     balanced tier still lands there or above. */
  const known = { 'claude-opus-5': 'pro', 'claude-opus-4-8': 'pro',
                  'claude-opus-4-7': 'pro', 'claude-sonnet-4-6': 'free' };
  for (const [model, wasSoldAt] of Object.entries(known)) {
    const to = RAW_TO_KEY[model];
    ok(!!to && !!ENGINES[to], `${model} still resolves somewhere real`, to);
    ok(PLAN_RANK[ENGINES[to].minPlan] >= PLAN_RANK[wasSoldAt],
       `${model} lands on a rung no lower than the tier it was sold at`,
       { lands: to, nowAt: ENGINES[to].minPlan, wasSoldAt });
  }
  /* And the free-tier string specifically must not have been quietly promoted
     onto a paid rung either, which would lock a cached free client out. */
  ok(ENGINES[RAW_TO_KEY['claude-sonnet-4-6']].minPlan === 'free',
     'a free-tier id stays reachable without a plan', RAW_TO_KEY['claude-sonnet-4-6']);
  ok(RAW_TO_KEY['auto'] && ENGINES[RAW_TO_KEY['auto']],
     'and an unrouted call still has a real default', RAW_TO_KEY['auto']);
}

section('Nothing on the ladder sends a shape the engines refuse');
{
  /* The top family rejects a fixed thinking budget, disabled thinking, forced
     tool choice and every sampling parameter - each with a 400 on a live
     request. Moving a rung onto it is exactly when one of those would start
     firing, and the failure would be a paying customer's request, not a test. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [what, re] of Object.entries({
    'a fixed thinking budget': /budget_tokens/,
    'thinking turned off': /thinking[^;]{0,40}disabled/,
    'a forced tool choice': /tool_choice/,
    'a sampling temperature': /\btemperature\b/,
    'top_p or top_k': /\btop_[pk]\b/,
  })) {
    ok(!re.test(code), `the worker never sends ${what}`, what);
  }
  ok(/thinking\s*=\s*\{\s*type:\s*'adaptive'\s*\}/.test(code),
     'and thinking is requested in the one form they all accept', true);
}

section('Every rate is a published one, not a remembered one');
{
  /* Not a guess at what the rates SHOULD be - that would be this test
     inventing the same class of error. What is checkable here is that the
     figures are internally coherent: output costs five times input across the
     whole ladder on every published rate, and a rung that bills more per token
     is never also the cheaper plan. */
  for (const [key, e] of Object.entries(ENGINES)) {
    ok(e.outCost === e.inCost * 5,
       `[${key}] output bills five times input, as every published rate on this ladder does`,
       { in: e.inCost, out: e.outCost });
    ok(e.inCost > 0 && e.outCost > 0, `[${key}] has a real rate, so the backstop can spend against it`, e);
  }
  const rows = Object.values(ENGINES);
  for (const a of rows) for (const b of rows) {
    if (a.inCost > b.inCost) {
      ok(PLAN_RANK[a.minPlan] >= PLAN_RANK[b.minPlan],
         'a dearer engine is never on a cheaper plan than a cheaper engine',
         { dearer: a.model + '@' + a.minPlan, cheaper: b.model + '@' + b.minPlan });
    }
  }
}

if (report('the-cheapest-thing-you-can-buy-is-the-best-one') > 0) process.exitCode = 1;
done();
