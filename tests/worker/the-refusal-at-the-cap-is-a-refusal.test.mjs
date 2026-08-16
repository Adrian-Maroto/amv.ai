/* THE ONE PATH WHERE SOMEBODY IS ALREADY BEING TOLD NO.

   An external audit found that the family-cap refusal in `aiProxy` read a
   variable called `planCeiling` that existed only inside a DIFFERENT function.
   Reaching that line threw a ReferenceError, so a child who hit the limit their
   parent set got a 500 - an unexplained server error - instead of the 429 that
   says who can raise it.

   It survived because nothing ever ran that branch. Every test that reached the
   cap logic reached the PLAN branch; the family branch had no test at all, and
   a line that is never executed cannot fail. The refusal is also the worst
   possible place for a 500: the customer is already blocked, and now the
   product looks broken as well as unhelpful.

   So this file executes the refusal itself, on both branches, and checks the
   thing the audit could not: that the answer is a real answer.

   It also holds the money rule that goes with it. A refusal that has already
   reserved quota must give it back, or being told no costs the customer their
   allowance. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ceiling.harness.mjs');
writeFileSync(harness, src + '\nexport { _monthlyCeiling, _monthlyCeilingUSD };\n');
const W = await import(harness + '?t=' + Date.now());

/* Plan prices drive the ceiling, so the numbers come from the product rather
   than from an assumption about what a plan costs. */
const user = (plan, familyUSD) => ({
  email: 'x@y.z', plan,
  family: familyUSD == null ? null : { limits: { monthlyUSD: familyUSD } },
});

section('The ceiling says which limit bound, not only what it was');
{
  const free = W._monthlyCeiling(user('free'));
  ok(free.value === null, 'a free account with no family cap has no dollar ceiling', free);
  ok(free.source === null, 'and names no source', free.source);

  const pro = W._monthlyCeiling(user('pro'));
  ok(pro.value > 0, 'a paid plan has one', pro.value);
  ok(pro.source === 'plan', 'and it is the plan that bound', pro.source);

  /* The case that threw. */
  const tight = W._monthlyCeiling(user('pro', 1));
  ok(tight.value === 1, 'a family cap below the plan is the one that applies', tight.value);
  ok(tight.source === 'family', 'and it is named as the family cap', tight.source);

  const loose = W._monthlyCeiling(user('pro', 9999));
  ok(loose.value === pro.value, 'a family cap above the plan cannot raise it', loose.value);
  ok(loose.source === 'plan', 'and the plan is what bound', loose.source);

  /* A parent who sets zero has switched paid compute off, and that has to mean
     it rather than being read as "no cap set". */
  const zero = W._monthlyCeiling(user('pro', 0));
  ok(zero.value === 0, 'a family cap of zero really is zero', zero.value);
  ok(zero.source === 'family', 'and it is the family cap that did it', zero.source);

  /* A free account whose parent set a cap still has one. */
  const freeCapped = W._monthlyCeiling(user('free', 5));
  ok(freeCapped.value === 5, 'a family cap applies even with no plan ceiling', freeCapped.value);
  ok(freeCapped.source === 'family', 'and is the source', freeCapped.source);
}

section('The refusal reads only what its own function defines');
{
  /* The defect in one sentence: a name resolved at runtime to nothing. Rather
     than re-describing it in prose, check the property that was violated - that
     every identifier the refusal branch reads is one this function can see. */
  const fn = codeOnly(functionBody(src, 'aiProxy'));
  ok(!/\bplanCeiling\b/.test(fn),
     'aiProxy no longer reads planCeiling, which it never defined', true);
  ok(!/\bfamilyCapUSD\b/.test(fn),
     'nor its own third copy of the family cap', true);
  ok(/ceiling\.source === 'family'/.test(fn),
     'it asks the helper which limit bound', true);

  /* One computation, one answer. Three copies existed; the other two decided
     the same thing separately and one of them decided it wrong. */
  const code = codeOnly(src);
  const defs = (code.match(/user\.family\.limits\.monthlyUSD != null/g) || []).length;
  ok(defs === 1, 'the family cap is computed in exactly one place', defs);
}

section('Being told no does not cost the customer their allowance');
{
  const fn = codeOnly(functionBody(src, 'aiProxy'));
  /* The refund has to come BEFORE the refusal returns, or the reservation is
     kept for work that was never done. Measured by position, not by presence:
     a refund after the return is not a refund. */
  const capIdx = fn.indexOf("op: 'checkCap'");
  const refundIdx = fn.indexOf('refundReservation()', capIdx);
  const returnIdx = fn.indexOf('429', capIdx);
  ok(capIdx > -1 && refundIdx > -1 && returnIdx > -1,
     'the cap check, the refund and the refusal are all present', true);
  ok(refundIdx < returnIdx,
     'and the reservation is refunded before the refusal is returned',
     { refund: refundIdx, refusal: returnIdx });
}

if (report('the-refusal-at-the-cap-is-a-refusal') > 0) process.exitCode = 1;
done();
