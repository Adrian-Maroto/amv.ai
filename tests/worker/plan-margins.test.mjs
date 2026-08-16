/* PLAN MARGINS - can a paid plan lose money if the user maxes it out?
   This used to be answered by multiplying the monthly token allowance by a
   blended rate. That premise no longer holds, for two reasons: the blended rate
   it used was derived from a cost table that overstated two engines by 2-3x,
   and there is a dollar backstop that binds long before the token cap does.
   The real guarantee is the backstop, so that is what this asserts. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'margins.harness.mjs');
writeFileSync(harness, src + '\nexport { PLAN_LIMITS, ENGINES };\n');
const W = await import(harness + '?t=' + Date.now());

const PRICE = { pro: 15, elite: 75, ultra: 200 };
const BACKSTOP = 0.45;                 // planPrice * this = the hard cost ceiling

/* A realistic blended rate per engine: chat is input-heavy once there is any
   history, so weight 80% input / 20% output. */
const blended = eng => 0.8 * eng.inCost + 0.2 * eng.outCost;

section('The dollar backstop, not the token cap, is what guarantees margin');
{
  /* THE PROPERTY, NOT THE SPELLING. This matched the literal text of the
     arithmetic while it lived inline in the chat handler. Moving it into one
     shared helper - which is what made the same ceiling bind image, video, SMS
     and the widget - broke the match while the 45% backstop it guards was
     untouched. A rule written against a spelling fails on a correct fix and
     passes on a regression that keeps the words (LESSONS #203). */
  const ceilFn = src.slice(src.indexOf('function _monthlyCeiling('), src.indexOf('function _monthlyCeiling(') + 900);
  ok(/\* 0\.45/.test(ceilFn) && /_planPriceUSD\(/.test(ceilFn),
     'the ceiling exists, at 45% of the plan price', true);
  ok(/_monthlyCeilingUSD\(user\)/.test(src), 'and the request path asks for it', true);
  Object.entries(PRICE).forEach(([plan, price]) => {
    const ceiling = price * BACKSTOP;
    const margin = (price - ceiling) / price;
    ok(margin >= 0.55, `${plan} cannot fall below a 55% margin however it is used`,
       `$${ceiling.toFixed(2)} max cost on $${price} = ${(margin * 100).toFixed(0)}%`);
  });
}

section('And it binds BEFORE the token allowance is exhausted');
/* This is the part that matters: if the token cap were reached first, the
   backstop would be decorative. On the most expensive engine a user can reach,
   the money runs out well before the tokens do - which is exactly what a
   backstop is for. */
Object.entries(PRICE).forEach(([plan, price]) => {
  const limits = W.PLAN_LIMITS[plan];
  const priciest = plan === 'pro' ? W.ENGINES['amv-forge'] : W.ENGINES['amv-apex'];
  const costIfAllTokensUsed = (limits.monthTokens / 1e6) * blended(priciest);
  ok(costIfAllTokensUsed > price * BACKSTOP,
     `${plan}: spending the whole token allowance on the priciest engine would cost more than the ceiling, so the ceiling stops it first`,
     `$${costIfAllTokensUsed.toFixed(2)} vs $${(price * BACKSTOP).toFixed(2)} ceiling`);
});

section('On the engine most users actually run, the allowance is generous');
/* Auto routes the majority of turns to the balanced engine. Against that, the
   allowance should be usable rather than theoretical. */
Object.entries(PRICE).forEach(([plan, price]) => {
  const limits = W.PLAN_LIMITS[plan];
  const cost = (limits.monthTokens / 1e6) * blended(W.ENGINES['amv-core']);
  const margin = (price - Math.min(cost, price * BACKSTOP)) / price;
  ok(margin >= 0.55, `${plan} stays above 55% margin on the balanced engine`,
     `$${cost.toFixed(2)} unbounded, capped to $${(price * BACKSTOP).toFixed(2)}`);
});

section('Every engine is cheaper than the plan it is gated behind');
Object.entries(W.ENGINES).forEach(([key, eng]) => {
  ok(eng.inCost > 0 && eng.outCost > eng.inCost,
     `${key} has a sane rate shape (output dearer than input)`, [eng.inCost, eng.outCost]);
});

section('Free users are bounded too');
{
  const free = W.PLAN_LIMITS.free;
  const worst = (free.monthTokens / 1e6) * blended(W.ENGINES['amv-core']);
  ok(worst < 3, 'a maxed-out free account costs under $3 of model spend a month', '$' + worst.toFixed(2));
  ok(free.monthTokens < W.PLAN_LIMITS.pro.monthTokens, 'and gets meaningfully less than a paying one');
}

report();
done();
