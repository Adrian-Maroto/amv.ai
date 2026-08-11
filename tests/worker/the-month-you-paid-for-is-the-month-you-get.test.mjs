/* AN ALLOWANCE IS MEASURED OVER THE MONTH SOMEBODY BOUGHT.

   Every per-customer allowance in the Worker was keyed by the CALENDAR month:
   `usg:someone@x.com:2026-08`. Subscriptions do not bill on the calendar. They
   bill on the day somebody subscribed, and the two only line up for people who
   happened to sign up on the 1st.

   What that cost, concretely. Somebody subscribes on 28 August and pays $15.
   They spend four days against August's bucket. On 1 September they get a
   completely fresh one - still inside their FIRST paid month, three weeks
   before they are charged again. They receive close to two months of compute
   for one payment, and it repeats for as long as they stay. The customer who
   subscribed on the 1st gets exactly one month for the same $15.

   Nothing about it looks wrong from any single screen. Every charge is
   correct. Every counter is correct. The window they are counted over is the
   wrong one, and the error is silent, systematic, and always in the direction
   that costs the operator.

   `renewedAt` already moved on every successful payment - the renewal sweep
   set it - so the anchor existed and nothing read it.

   Free accounts keep the calendar month, deliberately: they have no billing
   date, so there is no anniversary to anchor to.

   The dates below are computed rather than typed, so this file does not start
   failing in a particular month for reasons that have nothing to do with the
   rule it is protecting. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody, codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'period.harness.mjs');
writeFileSync(harness, src +
  '\nexport { _periodStartISO, _periodKeyFor, _periodKeyOf, monthKey, PLAN_LIMITS, _planPriceUSD };\n');
const W = await import(harness + '?t=' + Date.now());

const utc = (y, m, d) => Date.UTC(y, m - 1, d);

section('The window starts on the day they were last charged');
{
  /* Anchored 28 August. On 30 August they are in the window that opened on the
     28th; on 2 September they are STILL in it, because their next charge is
     the 28th. That second case is the whole bug: it used to be a new month. */
  const anchor = utc(2026, 8, 28);
  ok(W._periodStartISO(anchor, utc(2026, 8, 30)) === '2026-08-28',
     'two days in, the window opened on the 28th', W._periodStartISO(anchor, utc(2026, 8, 30)));
  ok(W._periodStartISO(anchor, utc(2026, 9, 2)) === '2026-08-28',
     'and five days in - across the 1st - it is the SAME window',
     W._periodStartISO(anchor, utc(2026, 9, 2)));
  ok(W._periodStartISO(anchor, utc(2026, 9, 28)) === '2026-09-28',
     'it rolls on the day they are charged again, not before',
     W._periodStartISO(anchor, utc(2026, 9, 28)));
  ok(W._periodStartISO(anchor, utc(2026, 9, 27)) === '2026-08-28',
     'and not one day early', W._periodStartISO(anchor, utc(2026, 9, 27)));
}

section('Somebody who subscribed on the 1st is unaffected');
{
  const anchor = utc(2026, 6, 1);
  ok(W._periodStartISO(anchor, utc(2026, 8, 1)) === '2026-08-01',
     'their window still opens on the 1st', W._periodStartISO(anchor, utc(2026, 8, 1)));
  ok(W._periodStartISO(anchor, utc(2026, 8, 31)) === '2026-08-01',
     'and runs to the end of the month, exactly as before', W._periodStartISO(anchor, utc(2026, 8, 31)));
}

section('A month that has no 31st does not lose anybody a window');
{
  /* Anchored on the 31st. September has 30 days and February has 28, and a
     processor charges on the last day instead. The window has to agree with
     the charge or somebody gets a month with no boundary in it at all. */
  const anchor = utc(2026, 1, 31);
  ok(W._periodStartISO(anchor, utc(2026, 9, 30)) === '2026-09-30',
     'September rolls on the 30th', W._periodStartISO(anchor, utc(2026, 9, 30)));
  ok(W._periodStartISO(anchor, utc(2026, 9, 29)) === '2026-08-31',
     'and the day before is still August’s window', W._periodStartISO(anchor, utc(2026, 9, 29)));
  ok(W._periodStartISO(anchor, utc(2027, 2, 28)) === '2027-02-28',
     'February rolls on the 28th', W._periodStartISO(anchor, utc(2027, 2, 28)));
  ok(W._periodStartISO(anchor, utc(2028, 2, 29)) === '2028-02-29',
     'and on the 29th in a leap year', W._periodStartISO(anchor, utc(2028, 2, 29)));
}

section('A window is never skipped and never repeats');
{
  /* Walked day by day for two years from every anchor day there is. Each day
     belongs to exactly one window, windows only move forwards, and one starts
     every month - no month without a reset, and no month with two. */
  let problems = [];
  for (const day of [1, 5, 15, 28, 29, 30, 31]) {
    const anchor = utc(2026, 1, day);
    let prev = '', starts = new Set();
    for (let t = utc(2026, 1, day); t < utc(2028, 1, 1); t += 86400000) {
      const k = W._periodStartISO(anchor, t);
      if (prev && k < prev) problems.push(`anchor ${day}: went backwards ${prev} -> ${k}`);
      if (k !== prev) starts.add(k);
      prev = k;
    }
    const months = new Set([...starts].map(s => s.slice(0, 7)));
    if (months.size !== starts.size) problems.push(`anchor ${day}: two windows in one month`);
    if (starts.size < 23 || starts.size > 25) problems.push(`anchor ${day}: ${starts.size} windows in two years`);
  }
  ok(problems.length === 0, 'every day belongs to exactly one window, and they only move forwards', problems);
}

section('A free account keeps the calendar month');
{
  ok(W._periodKeyFor(utc(2026, 8, 28), 'free', null) === W.monthKey(),
     'no billing date, no anniversary - the 1st is as good a boundary as any',
     W._periodKeyFor(utc(2026, 8, 28), 'free', null));
  ok(W._periodKeyFor(0, 'pro', null) === W.monthKey(),
     'and a paid plan with no anchor yet falls back rather than inventing one',
     W._periodKeyFor(0, 'pro', null));
}

section('A paid account is anchored, whatever the plan is called');
{
  const paid = Object.keys(W.PLAN_LIMITS).filter(p => W._planPriceUSD(p) > 0);
  ok(paid.length >= 3, 'the paid plans were read from the source', paid);
  for (const plan of paid) {
    const k = W._periodKeyFor(utc(2026, 8, 28), plan, null);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(k) && k !== W.monthKey(),
       plan + ' is measured over its billing period', { plan, k });
  }
}

section('Every allowance counter uses it - reads and writes alike');
{
  /* The failure that would be worse than the original bug: the enforcement
     moves to the new window and a READ is left on the calendar month, so the
     screen shows zero used against a limit that is refusing. They have to be
     the same key or they disagree. */
  const code = codeOnly(src);
  const stragglers = code.split('\n')
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /`(usg|cost|vid):/.test(l) && /monthKey\(\)/.test(l))
    /* _recordSpend takes the window as an argument and falls back for callers
       with nothing better - the fallback is the free case, not a straggler. */
    .filter(({ l }) => !/period \|\| monthKey\(\)/.test(l))
    .map(({ l, n }) => n + ': ' + l.trim().slice(0, 70));
  ok(stragglers.length === 0,
     'no allowance key is still keyed by the calendar month', stragglers);

  /* And the platform-wide totals are NOT moved: those are the owner's
     reporting, where a month means a month. */
  ok(/costtotal:\$\{monthKey\(\)\}/.test(code), 'the platform total stays on the calendar', true);
  ok(/featcost:\$\{what \|\| 'other'\}:\$\{monthKey\(\)\}/.test(code),
     'and so does the per-feature cost', true);
}

section('The person’s own spending limit stays on the calendar, on purpose');
{
  /* This one is not sold by the month. It is the cap somebody sets on what AMV
     may spend for them, and the screen where they set it says it resets on the
     1st. Moving it would make their own control mean something they did not
     choose. */
  const code = codeOnly(src);
  ok(/spendmo:\$\{email\}:\$\{monthKey\(\)\}/.test(code) || /spendmo:\$\{user\.email\}:\$\{monthKey\(\)\}/.test(code),
     'the self-set spending cap is still a calendar month', true);
  ok(/resets on the 1st/.test(src), 'which is what the product tells them', true);
}

section('A team member is measured over the TEAM’s period');
{
  /* A seat draws on the team's plan and the team's counters, so it has to draw
     on the team's window too - otherwise the seat opens a second allowance on
     a different clock from the one being paid for. */
  const sub = codeOnly(functionBody(src, '_billingSubjectOf'));
  ok(/renewedAt/.test(sub), 'the billing subject carries the anniversary', true);
  ok(/out\.renewedAt = \+team\.renewedAt/.test(sub),
     'and a seated member takes the team’s, not their own', true);
  const req = codeOnly(functionBody(src, 'requireUser'));
  ok(/billingRenewedAt = sub\.renewedAt/.test(req),
     'which is what reaches every check downstream', true);
}

if (report('the-month-you-paid-for-is-the-month-you-get') > 0) process.exitCode = 1;
done();
