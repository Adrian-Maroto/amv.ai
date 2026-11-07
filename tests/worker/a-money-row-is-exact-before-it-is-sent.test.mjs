/* A MONEY ROW IS EXACT BEFORE IT IS SENT (Nov 3 audit DATA-017).

   The ledger is NUMERIC in Postgres; the amount the Worker sends is a
   decimal string it makes itself, so no float is ever rounded by the
   database. A non-finite or absurd amount, a currency that is not three
   letters, or seller money that is not whole cents is refused before
   anything is sent. Property-checked over many amounts. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'money.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _pgMoneyAmount };\n');
const W = await import(harness + '?t=' + Date.now());
const refused = (row) => { try { W._pgMoneyAmount(row); return false; } catch (e) { return true; } };

section('Refused before it is sent');
{
  ok(refused({ amount: NaN }) && refused({ amount: Infinity }) && refused({ amount: 2e9 }), 'not a number, infinite, or past any real payment');
  ok(refused({ amount: 5, currency: 'US' }) && refused({ amount: 5, currency: 'usd$' }), 'a currency that is not three letters');
  ok(refused({ table: 'seller', amount: 12.345 }), 'seller money that is not whole cents');
}

section('Exact, over many amounts');
{
  let bad = [];
  for (let i = 0; i < 5000; i++) {
    const cents = Math.floor(Math.random() * 10000000) - 5000000 || 1;
    const a = cents / 100;
    const s = W._pgMoneyAmount({ table: 'seller', amount: a, currency: 'usd' });
    if (s.amount !== (cents < 0 ? '-' : '') + String(Math.floor(Math.abs(cents) / 100)) + '.' + String(Math.abs(cents) % 100).padStart(2, '0') || s.currency !== 'USD') bad.push([a, s.amount]);
    const c = W._pgMoneyAmount({ amount: a * 2.2, currency: 'USD' });
    if (Math.abs(Number(c.amount) - a * 2.2) > 5e-7) bad.push([a * 2.2, c.amount]);
  }
  ok(bad.length === 0, 'every whole-cent amount is sent as exactly its cents, and a metered credit amount to six places', bad.slice(0, 3));
}

section('Seller money is whole units of its own currency (Nov 7 audit DATA-033)');
{
  ok(W._pgMoneyAmount({ table: 'seller', amount: 1500, currency: 'JPY' }).amount === '1500', 'whole yen, written without decimals');
  ok(refused({ table: 'seller', amount: 1500.5, currency: 'JPY' }), 'half a yen is refused');
  ok(W._pgMoneyAmount({ table: 'seller', amount: 12.345, currency: 'KWD' }).amount === '12.345', 'a dinar keeps three decimals');
  ok(refused({ table: 'seller', amount: 12.345, currency: 'USD' }), 'dollars still need whole cents');
}

if (report('a-money-row-is-exact-before-it-is-sent') > 0) process.exitCode = 1;
done();
