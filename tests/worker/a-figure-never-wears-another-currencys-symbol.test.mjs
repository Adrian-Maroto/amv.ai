/* SOMEBODY IN FRANKFURT READ THEIR PENSION IN DOLLARS.

   The unattended investing check-in printed a literal '$' in front of every
   number and appended the currency code once, at the end of the first line. So
   the email said:

     Total: $12,345.00 EUR          <- a sentence that contradicts itself
     Up $1,234.00 (2.3%)            <- wrong symbol, and no currency at all
     Pension: $9,000.00 (+$120.00)  <- the same, on every account

   Their pension, reported while they were asleep, in a currency that is not
   theirs. And the page had it right the whole time - `_invMoney` formats the
   same numbers through Intl with the real currency - so two renderings of one
   set of figures disagreed, and the wrong one was the one that left the
   building.

   What this suite holds is the rule, not the instance: no figure AMV writes
   carries a symbol belonging to a currency it is not in, and no figure is left
   without one. The code rather than a symbol, because '$' is seven countries
   and '¥' is two. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ccy.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { _investText, _investMoney };
`);
const W = await import(harness + '?t=' + Date.now());

const check = (cur) => W._investText({
  ok: true, currency: cur, total: 12345.6, first: false,
  direction: 'up', changeUSD: 1234, changePct: 2.3,
  byAccount: [{ name: 'Pension', balance: 9000, change: 120 },
              { name: 'ISA', balance: 3345.6, isNew: true }],
});
/* Every currency symbol somebody could be shown by mistake. '$' first, because
   that is the one that actually shipped. */
const SYMBOLS = ['$', '€', '£', '¥', '₹', '₩', '₽', '₦'];

section('The check-in that goes out carries no symbol at all');
{
  for(const cur of ['EUR', 'GBP', 'JPY', 'INR', 'USD']){
    const t = check(cur);
    const wrong = SYMBOLS.filter(sym => t.includes(sym));
    ok(wrong.length === 0,
       'a ' + cur + ' check-in contains no currency symbol, so none can be the wrong one',
       wrong);
  }
}

section('And every figure says which currency it is');
{
  const t = check('EUR');
  /* ADJACENCY, NOT A COUNT. The first version of this counted figures and
     counted currency codes and compared the totals - and a mutation that left
     exactly one line bare survived it, because the totals still matched. The
     bug being guarded against IS one bare line: a code on the first figure and
     nothing on the rest reads, to somebody skimming, as no currency at all.

     So every figure is checked for a code immediately in front of it, and the
     percentage is excluded by requiring two decimal places with a separator or
     a group - "2.3%" is not a sum of money. */
  const FIG = /(?:[A-Z]{3} )?-?\d{1,3}(?:,\d{3})*\.\d{2}/g;
  const all = t.match(FIG) || [];
  const bare = all.filter(x => !/^[A-Z]{3} /.test(x));
  ok(all.length >= 4, 'the message really does carry several figures', all.length);
  ok(bare.length === 0,
     'and not one of them stands without its currency immediately in front of it',
     bare);
}

section('The server and the page agree about the same numbers');
{
  /* The defect was not that either side was unreadable. It was that they
     disagreed, and only one of them was in front of somebody who could notice. */
  const app = readFileSync(join(ROOT, 'src', 'app', '22-finance.js'), 'utf8');
  ok(/_invMoney\s*\(\s*[^)]*\bcurrency\b/.test(app) || /_invMoney\([^)]*,\s*d\.currency\)/.test(app),
     'the page formats with the currency the server sent', true);
  ok(!/return\s*'\$'\s*\+\s*v\.toFixed\(2\);\s*\}\s*\n\s*function _invResultHTML/.test(app),
     'and its only bare dollar is the fallback for a thrown formatter', true);
  const srv = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  const body = srv.slice(srv.indexOf('function _investText'), srv.indexOf('function _investText') + 2000);
  ok(!body.includes("'$'"), 'and the server writes no dollar sign of its own', true);
}

section('A currency with no decimal part does not get two');
{
  ok(W._investMoney(1234567, 'JPY') === 'JPY 1,234,567',
     'yen has no minor unit, and inventing one invents a figure',
     W._investMoney(1234567, 'JPY'));
  ok(W._investMoney(1234567, 'KRW') === 'KRW 1,234,567', 'nor does the won',
     W._investMoney(1234567, 'KRW'));
  ok(W._investMoney(1234.5, 'EUR') === 'EUR 1,234.50',
     'while a currency that has one keeps it', W._investMoney(1234.5, 'EUR'));
}

section('A negative amount is negative, not a negative currency');
{
  ok(W._investMoney(-40, 'GBP') === 'GBP -40.00',
     'the sign belongs to the number', W._investMoney(-40, 'GBP'));
}

section('An unknown currency is still said, never guessed');
{
  const t = W._investMoney(10, 'ZZZ');
  ok(t.startsWith('ZZZ '), 'the code is passed through rather than replaced with a default', t);
  ok(W._investMoney(10, '') === 'USD 10.00',
     'and only a MISSING currency falls back, which is the one case where nothing was said',
     W._investMoney(10, ''));
}

section('A check-in that could not read anything still shows no figures');
{
  /* The oldest rule in this function and the most important: a made-up number
     about somebody's retirement is the worst thing this product could send. */
  const t = W._investText({ ok: false, error: 'Your bank did not answer.' });
  ok(/no figures are shown/i.test(t), 'it says so plainly', t.slice(0, 200));
  ok(!/\d[\d,]*\.\d{2}/.test(t), 'and there is not a figure in it', t.slice(0, 200));
}

if (report('a-figure-never-wears-another-currencys-symbol') > 0) process.exitCode = 1;
done();
