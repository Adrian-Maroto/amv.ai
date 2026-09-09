/* THE NUMBER PEOPLE ACT ON.

   "You are paying 84 a month" is the sentence that sends somebody to cancel
   something, so it has to be right. Handing a model the list and letting it
   total that list is where this goes wrong quietly: it adds a yearly plan in
   as though it were monthly, and it adds pounds to dollars and puts one symbol
   on the answer.

   Every assertion here is a specific wrong number somebody could otherwise be
   told about their own money, and each one has a factor attached - twelve for
   a misread cadence, eight per cent for a four-week month, and for a mixed
   currency total there is no factor at all because the answer is not wrong by
   an amount, it is simply not a number. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'subtotals.harness.mjs');
writeFileSync(harness, src + `
export { _subTotals, _SUB_PER_MONTH };
`);
const W = await import(harness + '?t=' + Date.now());

const row = (amount, currency, cadence) => ({ merchant: 'M', amount, currency, cadence, at: 0, evidence: '' });
/* Never undefined. A regression that buckets everything under one currency
   makes `cur(t,'GBP')` absent, and reading `.monthly` off it throws - so the
   suite died with a stack trace instead of saying which currency vanished.
   It still fails either way; only one of the two says what broke. */
const cur = (t, c) => t.byCurrency.find(x => x.currency === c) || { currency: c, monthly: null, yearly: null, count: 0 };

section('Currencies are never added together');
{
  const t = W._subTotals([row(10, 'GBP', 'monthly'), row(20, 'USD', 'monthly'), row(5, 'GBP', 'monthly')]);
  ok(t.byCurrency.length === 2, 'two currencies stay two rows', t.byCurrency);
  ok(cur(t, 'GBP').monthly === 15, 'pounds add to pounds', cur(t, 'GBP'));
  ok(cur(t, 'USD').monthly === 20, 'and dollars to dollars', cur(t, 'USD'));
  /* There is deliberately no combined figure to assert on. A total across
     currencies is not a number that is slightly wrong; it is not a number. */
  ok(t.byCurrency.every(c => typeof c.monthly === 'number'), 'and each is its own answer', t.byCurrency);
}

section('A yearly plan is a twelfth of a month, not a month');
{
  const t = W._subTotals([row(120, 'GBP', 'yearly')]);
  ok(cur(t, 'GBP').monthly === 10, '120 a year is 10 a month', cur(t, 'GBP'));
  ok(cur(t, 'GBP').yearly === 120, 'and 120 a year, not 1440', cur(t, 'GBP'));
}

section('A month is 52/12 weeks, not four');
{
  /* Four weeks to a month is out by eight per cent - a whole month of a weekly
     subscription over a year - and it is wrong in the comfortable direction,
     which is how it survives being looked at. */
  const t = W._subTotals([row(3, 'GBP', 'weekly')]);
  ok(Math.abs(cur(t, 'GBP').monthly - 13) < 0.01, '3 a week is 13 a month', cur(t, 'GBP'));
  ok(cur(t, 'GBP').monthly !== 12, 'and specifically not 12, which four-week months would give', cur(t, 'GBP'));
  ok(Math.abs(cur(t, 'GBP').yearly - 156) < 0.01, '3 a week is 156 a year', cur(t, 'GBP'));
}

section('A quarterly plan is a third of a month');
{
  const t = W._subTotals([row(30, 'EUR', 'quarterly')]);
  ok(Math.abs(cur(t, 'EUR').monthly - 10) < 0.01, '30 a quarter is 10 a month', cur(t, 'EUR'));
}

section('What cannot be added is left out AND counted');
{
  const t = W._subTotals([
    row(10, 'GBP', 'monthly'),
    row(9.99, 'GBP', null),      /* an amount, but nothing said how often */
    row(null, null, 'monthly'),  /* recurs, but no amount could be read */
  ]);
  ok(cur(t, 'GBP').monthly === 10,
     'only the one that could be priced is in the total - assuming monthly would say 19.99', cur(t, 'GBP'));
  ok(t.noCadence === 1, 'the unstated cadence is counted, not folded in', t);
  ok(t.noAmount === 1, 'and so is the unreadable amount', t);
  ok(t.priced === 1, 'so the answer can say what it is based on', t);
}

section('Money with no currency is not money');
{
  /* A figure with no currency cannot go into a per-currency total without
     somebody choosing a currency for it, and choosing is inventing. */
  const t = W._subTotals([row(10, null, 'monthly'), row(5, '', 'monthly')]);
  ok(t.byCurrency.length === 0, 'it does not land in some default currency', t.byCurrency);
  ok(t.noAmount === 2, 'it is counted as unpriced', t);
}

section('Rounding happens once, at the end');
{
  /* Three charges of 0.005 rounded per row are 0.00 each and 0.00 in total.
     Summed first they are 0.02. Rounding early does not remove error, it
     accumulates it - and on a long list it drifts in one direction. */
  const t = W._subTotals([row(0.005, 'USD', 'monthly'), row(0.005, 'USD', 'monthly'),
                          row(0.005, 'USD', 'monthly'), row(0.005, 'USD', 'monthly')]);
  ok(cur(t, 'USD').monthly === 0.02, 'four half-cents are two cents, not nothing', cur(t, 'USD'));
}

section('The biggest is first, because that is the one to look at');
{
  const t = W._subTotals([row(5, 'GBP', 'monthly'), row(50, 'USD', 'monthly'), row(20, 'EUR', 'monthly')]);
  ok(t.byCurrency[0].currency === 'USD' && t.byCurrency[2].currency === 'GBP',
     'ordered by what it costs, not by when it was found', t.byCurrency.map(c => c.currency));
}

section('And nothing is nothing');
{
  ok(W._subTotals([]).byCurrency.length === 0, 'empty', true);
  ok(W._subTotals(null).byCurrency.length === 0, 'null', true);
  ok(W._subTotals([null, undefined]).byCurrency.length === 0, 'a list of nothings', true);
  const t = W._subTotals([]);
  ok(t.priced === 0 && t.noAmount === 0 && t.noCadence === 0, 'with honest zero counts', t);
}

if (report('what-it-adds-up-to') > 0) process.exitCode = 1;
done();
