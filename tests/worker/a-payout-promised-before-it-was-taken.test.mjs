/* THE PAYOUT WAS PROMISED BEFORE THE MONEY WAS TAKEN.

   A withdrawal wrote the `withdraw:` record - the thing an operator reads to
   decide what AMV owes - and debited the seller's balance afterwards. Between
   those two writes the same money was both promised and still spendable.

   Nothing closes that gap anywhere else. What is available to withdraw is
   balance minus unmatured holds; `_payoutsInFlight` exists, and is only ever
   read as an input to the risk score. So a debit that did not happen left the
   full amount withdrawable with an approved payout already standing against it.
   The seller asks again, a second record is written, and the operator working
   the queue sends the money twice.

   It does not take an exception. A Worker can be cut off between two storage
   writes for reasons that have nothing to do with this code.

   The other order is not automatically better - debiting first and failing
   before the record is written destroys the seller's money, which the comment
   above the payout queue calls the worst defect the product ever had. So the
   debit carries a marker naming the payout it is for. Between the two writes
   the money is neither spendable nor promised, which is the only state that
   cannot be double-spent, and the marker is what lets the next attempt tell
   "this payout is real" from "this money never went anywhere". */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'payoutorder.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, _wallet, _saveWallet, _availableOf, marketWithdraw, _reconcileStrandedPayouts,' +
  ' issueTokens, MARKET_MIN_WITHDRAW, PAYOUT_HOLD_MS };\n');
const W = await import(harness + '?t=' + Date.now());

section('The debit happens before anything promises the money');
{
  const body = codeOnly(functionBody(src, 'marketWithdraw'));
  const debit = body.indexOf('ww.balance = +((+ww.balance || 0) - amount)');
  const record = body.indexOf('withdraw:${wid}');
  ok(debit > 0 && record > 0, 'both writes were found', { debit, record });
  ok(debit < record,
     'the balance goes down first, so the same money is never both promised and spendable',
     { debit, record });
  ok(/pendingOut/.test(body.slice(debit, record)),
     'and the debit names the payout it is for, so it can be undone if the record never lands', true);

  /* The self-heal is only worth anything if something calls it. Asserted here
     because the behaviour test below can call it directly and pass while the
     withdrawal never does - which would leave the one state nothing else
     covers, a request cut off mid-flight, uncorrected for ever. */
  const call = body.indexOf('_reconcileStrandedPayouts');
  ok(call > 0 && call < debit,
     'and a withdrawal returns any stranded money BEFORE deciding what is available', { call, debit });
}

let FAIL = null;
function mkEnv() {
  const m = new Map(), vals = new Map(), claims = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', APP_URL: 'https://amv.test',
    _map: m, _vals: vals,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { if (FAIL && k.includes(FAIL)) throw new Error('storage refused ' + k); m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(x) || 0;
        if (b.op === 'claim') {
          const held = claims.get(x);
          if (held && held > Date.now()) return new Response(JSON.stringify({ claimed: false }));
          claims.set(x, Date.now() + Math.max(1000, Number(b.ttlMs) || 30000));
          return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { claims.delete(x); return new Response(JSON.stringify({ released: true })); }
        if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}

const SELLER = 'seller@test.com';
async function seed(env, balance) {
  await env.AMV_KV.put(`acct:${SELLER}`, JSON.stringify({ email: SELLER, name: 'S' }));
  await W.DB.put(env, 'consent', SELLER, { birthYear: 1990, termsVersion: '1' });
  await W._saveWallet(env, SELLER, { balance, lifetime: balance, holds: [], payouts: [], paidOut: 0 });
  return (await W.issueTokens(env, SELLER, 'S')).token;
}
const withdraw = async (env, tok, dest = 'paypal@test.com') =>
  W.marketWithdraw(new Request('https://api/v1/market/withdraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok, 'CF-Connecting-IP': '5.5.5.5' },
    body: JSON.stringify({ destination: dest }),
  }), env);
const payouts = (env) => [...env._map.keys()].filter(k => k.startsWith('withdraw:'))
  .map(k => JSON.parse(env._map.get(k)));

section('An ordinary withdrawal still works exactly as it did');
{
  const env = mkEnv();
  const tok = await seed(env, 100);
  const r = await withdraw(env, tok);
  const body = await r.json().catch(() => ({}));
  ok(r.status === 200, 'the seller can withdraw', { status: r.status, body });
  const recs = payouts(env);
  ok(recs.length === 1 && recs[0].amount === 100, 'one payout record for the full cleared balance', recs.map(x => x.amount));
  const w = await W._wallet(env, SELLER);
  ok(w.balance === 0, 'and the balance went with it', w.balance);
  ok(!(w.pendingOut || []).length, 'with no marker left behind', w.pendingOut);
}

section('A withdrawal that cannot write its record gives the money back');
{
  const env = mkEnv();
  const tok = await seed(env, 100);
  FAIL = 'withdraw:';
  let threw = null, r = null;
  try { r = await withdraw(env, tok); } catch (e) { threw = e; }
  FAIL = null;

  ok(!!threw || (r && r.status >= 500), 'the withdrawal fails rather than half-happening',
     threw ? String(threw.message).slice(0, 40) : r && r.status);
  ok(payouts(env).length === 0, 'no payout record exists', payouts(env).length);
  const w = await W._wallet(env, SELLER);
  ok(w.balance === 100,
     'and the money is back in the balance, not stranded between two writes', w.balance);
  ok(!(w.pendingOut || []).length, 'and the marker is cleared', w.pendingOut);
}

section('Money debited for a payout that was never written comes back');
{
  /* The narrow state the rollback above cannot cover: the request simply
     stopped - a Worker cut off between the two writes - so no catch ran. The
     wallet is left debited with a marker and nothing to show for it. */
  const env = mkEnv();
  const tok = await seed(env, 100);
  await W._saveWallet(env, SELLER, { balance: 40, lifetime: 100, holds: [], payouts: [], paidOut: 0,
                                     pendingOut: [{ id: 'wd_ghost', amount: 60, at: Date.now() }] });

  const returned = await W._reconcileStrandedPayouts(env, SELLER);
  ok(returned === 60, 'the stranded amount is identified', returned);
  const w = await W._wallet(env, SELLER);
  ok(w.balance === 100, 'and put back', w.balance);
  ok(!(w.pendingOut || []).length, 'and the marker cleared', w.pendingOut);
}

section('But money whose payout IS real is not handed back a second time');
{
  /* The same marker with the record actually present. Refunding here would
     credit a seller for money AMV is about to send them - the double payment
     this whole change exists to prevent, arriving from the other side. */
  const env = mkEnv();
  await seed(env, 100);
  await env.AMV_KV.put('withdraw:wd_real', JSON.stringify({ id: 'wd_real', seller: SELLER, amount: 60, status: 'approved' }));
  await W._saveWallet(env, SELLER, { balance: 40, lifetime: 100, holds: [], payouts: [], paidOut: 0,
                                     pendingOut: [{ id: 'wd_real', amount: 60, at: Date.now() }] });

  const returned = await W._reconcileStrandedPayouts(env, SELLER);
  ok(returned === 0, 'nothing is returned', returned);
  const w = await W._wallet(env, SELLER);
  ok(w.balance === 40, 'the balance is untouched - that payout is real', w.balance);
  ok(!(w.pendingOut || []).length, 'and the marker is retired as settled business', w.pendingOut);
}

section('So the same money can never be promised twice');
{
  /* THE ORIGINAL FAILURE, EXACTLY.

     Make the WALLET write fail. Under the old order the payout record had
     already been written, so this left an approved payout standing against a
     balance that was never debited - and since nothing subtracts a payout in
     flight from what is available, the next attempt happily wrote a second
     record. Two approved payouts, one balance, and an operator working the
     queue sends the money twice.

     Under the new order the debit IS the first write, so a failure here
     promises nothing at all. */
  const env = mkEnv();
  const tok = await seed(env, 100);
  FAIL = 'wallet:' + SELLER;
  try { await withdraw(env, tok); } catch (e) {}
  FAIL = null;
  ok(payouts(env).length === 0,
     'a withdrawal that could not move the balance promised nothing', payouts(env).length);

  const r = await withdraw(env, tok);
  ok(r.status === 200, 'the retry succeeds', r.status);
  const recs = payouts(env);
  const total = recs.reduce((n, x) => n + x.amount, 0);
  ok(recs.length === 1, 'and there is ONE payout record, not two', recs.length);
  ok(total === 100, 'promising exactly the $100 that existed', total);
  const w = await W._wallet(env, SELLER);
  ok(w.balance === 0, 'with the balance emptied once', w.balance);
}

if (report('a-payout-promised-before-it-was-taken') > 0) process.exitCode = 1;
done();
