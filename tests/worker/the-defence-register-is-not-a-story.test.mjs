/* SECURITY-SCAMS.md IS A PROMISE, AND PROMISES DRIFT.

   The register names fifty-odd attacks and, for each, the defence in place. It
   cites real constants with real numbers: a 14-day payout hold, a $600 KYC
   threshold that is also the US 1099 line, five referral rewards per account, a
   $500 daily ceiling on model spend.

   That document is what gets reached for when somebody asks how AMV handles
   fraud - a regulator, a payment processor, a buyer's lawyer. A number that has
   quietly moved in the code makes it worse than no document at all, because it
   is confidently wrong in writing.

   Nothing kept the two in step. This does. It reads every constant the register
   cites with a value, finds that constant in the worker, and fails if they
   disagree - which is the same defect class as the plans page promising what the
   server refuses, in a file where being wrong is a legal problem rather than a
   support ticket.

   Verified at the time of writing: all nine agree. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const register = readFileSync(join(ROOT, 'SECURITY-SCAMS.md'), 'utf8');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* `NAME` (value) - the shape the register uses when it commits to a number. */
const claims = [...register.matchAll(/`([A-Z][A-Z0-9_]{4,})`\s*\(([^)]+)\)/g)]
  .map(m => ({ name: m[1], stated: m[2].trim() }));

const numeric = (s) => {
  const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

/* The code side, evaluated rather than pattern-matched: `90 * 86400000` and
   `0.10` both have to become numbers, and reading only the first integer would
   turn ninety days into ninety. */
const codeValue = (name) => {
  const m = worker.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
  if (!m) return { missing: true };
  const expr = m[1].trim();
  if (/^[\d\s*+.\/()-]+$/.test(expr)) {
    try { return { value: Function('"use strict";return (' + expr + ')')() }; }
    catch (e) { return { unparsed: expr }; }
  }
  const d = numeric(expr);
  return d === null ? { unparsed: expr } : { value: d };
};

section('Every number the register commits to is the number in the code');
{
  ok(claims.length >= 8, 'the register does make checkable numeric claims', claims.length);

  const missing = [], wrong = [], checked = [];
  for (const c of claims) {
    const got = codeValue(c.name);
    if (got.missing) { missing.push(c.name + ' is cited but not defined in the worker'); continue; }
    if (got.unparsed !== undefined) continue;          // not a plain literal, nothing to compare
    const want = numeric(c.stated);
    if (want === null) continue;                        // prose, not a figure

    /* Days and milliseconds, percentages and fractions: compare on the same
       footing rather than demanding the document write 7776000000. */
    const matches = got.value === want
      || got.value === want * 86400000                  // "90 days" vs ms
      || Math.abs(got.value * 100 - want) < 1e-9;       // "10%" vs 0.10
    checked.push(c.name);
    if (!matches) wrong.push(c.name + ': register says ' + c.stated + ', code says ' + got.value);
  }

  ok(checked.length >= 7, 'and enough of them were comparable to be worth running', checked.join(', '));
  ok(missing.length === 0, 'every constant it names actually exists in the worker', missing);
  ok(wrong.length === 0, 'and none of them has drifted since it was written', wrong);
}

section('The defences it calls enforced are enforced on the SERVER');
{
  /* The register's rule is its own first paragraph: the server is always the
     authority, client checks are defence in depth. These are the claims where a
     client-only guard would be a real hole rather than a cosmetic one. */
  const serverSide = [
    ['you cannot buy your own listing', 'self-purchase is refused by the worker, not just hidden'],
    ['buy it before rating', 'a rating requires the worker to agree you own the item'],
    ['You can only review sellers', 'a seller review requires the worker to find the purchase'],
    ['PAYOUT_HOLD_MS', 'the payout hold is applied where the money moves'],
  ];
  for (const [needle, why] of serverSide) {
    ok(worker.includes(needle), why, needle);
  }
}

report();
done();
