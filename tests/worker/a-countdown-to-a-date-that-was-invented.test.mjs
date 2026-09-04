/* "YOUR USAGE RESETS IN 59 MINUTES", SAID TO SOMEBODY WHOSE ALLOWANCE COMES
   BACK NEXT MONTH.

   The chat read `err.resetAt || (Date.now() + 3600000)`. Two of the four
   monthly refusals sent no `resetAt` at all - the account spend ceiling and
   the family ceiling, both of which say "It resets next month" in their own
   text - so the client filled the gap with an hour, threw the server's
   sentence away to make room for the countdown, and an hour later fired a
   green toast reading "Your usage has reset - you're good to go", re-enabled
   the composer, and had the next send refused again.

   The one refusal that DID send a reset time sent the wrong one. It computed
   `Date.UTC(y, m + 1, 1)` - the first of the calendar month - while the
   counter that refused is keyed on `_periodKeyOf`, which for a paying account
   is their BILLING ANNIVERSARY. Somebody who renews on the 20th and runs out
   on the 5th was told the 1st: fifteen days early, on the screen where they
   decide whether to pay.

   One helper answers it now, derived from the same function that decides the
   period key, so the date somebody is told and the window they are measured
   over cannot drift apart. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'quotareset.harness.mjs');
writeFileSync(harness, src +
  '\nexport { _periodResetAtFor, _periodResetAtOf, _periodStartISO, _periodKeyFor };\n');
const W = await import(harness + '?t=' + Date.now());

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const at = (y, m, d) => Date.UTC(y, m - 1, d);

section('A free account is measured on the calendar, so it resets on the 1st');
{
  const r = W._periodResetAtFor(0, 'free', null, at(2026, 3, 14));
  ok(iso(r) === '2026-04-01', 'the first of the next month', iso(r));
  /* Even one WITH a renewal date, if the plan is not paid for - a lapsed
     subscriber keeps the anniversary on their record and is back on the
     calendar window, so the date has to follow the window, not the record. */
  const r2 = W._periodResetAtFor(at(2025, 11, 20), 'free', null, at(2026, 3, 14));
  ok(iso(r2) === '2026-04-01', 'and a stale anniversary on a free plan does not move it', iso(r2));
}

section('A paying account resets on its billing anniversary, not on the 1st');
/* The whole point. This is the case that was fifteen days wrong. */
{
  const anchor = at(2025, 11, 20);                     // renews on the 20th
  const r = W._periodResetAtFor(anchor, 'pro', null, at(2026, 3, 5));
  ok(iso(r) === '2026-03-20', 'the next 20th, which is when the charge lands', iso(r));
  ok(iso(r) !== '2026-04-01', 'and not the calendar first');

  /* Later in the same period: still the same period, so still the same reset. */
  const r2 = W._periodResetAtFor(anchor, 'pro', null, at(2026, 3, 19));
  ok(iso(r2) === '2026-03-20', 'the day before it, unchanged', iso(r2));

  /* On the anniversary itself the new period has begun, so the answer moves. */
  const r3 = W._periodResetAtFor(anchor, 'pro', null, at(2026, 3, 20));
  ok(iso(r3) === '2026-04-20', 'and on the day itself it is the month after', iso(r3));
}

section('It always lands after now, never in the past');
/* A reset time already behind us is what the client treats as "expired", so
   one computed wrong unlocks the composer immediately. */
{
  const anchor = at(2025, 11, 20);
  for (const d of [1, 5, 19, 20, 21, 28]) {
    const now = at(2026, 3, d);
    const r = W._periodResetAtFor(anchor, 'pro', null, now);
    ok(r > now, 'day ' + d + ' resets in the future (' + iso(r) + ')', { now: iso(now), reset: iso(r) });
  }
}

section('The 31st is the 30th in September and the 28th in February');
/* Same clamping the charge uses. A date the processor cannot bill on is a date
   nobody should be promised either. */
{
  const anchor = at(2025, 1, 31);
  const sep = W._periodResetAtFor(anchor, 'pro', null, at(2026, 8, 31));
  ok(iso(sep) === '2026-09-30', 'September has thirty days', iso(sep));
  const feb = W._periodResetAtFor(anchor, 'pro', null, at(2026, 1, 31));
  ok(iso(feb) === '2026-02-28', 'and February 2026 has twenty-eight', iso(feb));
  const febLeap = W._periodResetAtFor(anchor, 'pro', null, at(2028, 1, 31));
  ok(iso(febLeap) === '2028-02-29', 'and twenty-nine in a leap year', iso(febLeap));
}

section('It agrees with the window it is the end of');
/* The two must not drift: the reset a person is told is the start of the very
   next period the key would name. Checked rather than assumed, because they
   were computed in different places and disagreed. */
{
  const anchor = at(2025, 11, 20);
  for (const d of [3, 15, 19, 21, 27]) {
    const now = at(2026, 3, d);
    const start = W._periodStartISO(anchor, now);
    const reset = W._periodResetAtFor(anchor, 'pro', null, now);
    const nextStart = W._periodStartISO(anchor, reset);
    ok(nextStart === iso(reset),
       'the reset for day ' + d + ' is exactly the next period start', { start, reset: iso(reset), nextStart });
  }
}

section('Every monthly refusal now carries one');
/* Source-level, because these are four sites in three handlers and the point
   is that NONE of them is left without it. */
{
  const monthly = [...src.matchAll(/code:\s*'(quota_month|family_cap)'([^}]*)\}/g)];
  ok(monthly.length >= 4, 'all four monthly refusals are still here', monthly.length);
  const missing = monthly.filter(m => !/resetAt/.test(m[0]));
  ok(missing.length === 0, 'and every one of them sends a resetAt',
     missing.map(m => m[0].slice(0, 70)));
}

section('And none of them computes the date by hand any more');
{
  /* The expression survives in exactly one place - the free-account branch of
     the helper, which is where it is correct. What must not exist is a second
     copy inside a refusal handler, which is what made the two disagree. */
  const hand = [...src.matchAll(/getUTCMonth\(\)\s*\+\s*1,\s*1\)/g)];
  ok(hand.length === 1, 'it is computed in one place, not at each refusal', hand.length);
  const helper = src.slice(src.indexOf('function _periodResetAtFor'),
                           src.indexOf('function _periodKeyFor'));
  ok(/getUTCMonth\(\)\s*\+\s*1,\s*1\)/.test(helper),
     'and that place is the helper, where the calendar month is the right answer');
  ok(/_periodResetAtOf\(user\)/.test(src), 'the shared helper is what they call');
}

report();
done();
