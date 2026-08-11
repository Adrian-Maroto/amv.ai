/* THE SELLER CANNOT OUTRUN THE CHARGEBACK.

   A card dispute arrives weeks after the charge. AMV already handles that
   correctly on the books: `_reverseSale` takes the item back from the buyer,
   debits the seller their share, and lets the balance go NEGATIVE so nobody
   profits by being quick.

   It only works if the money is still here.

   Withdrawal paid out the entire balance the moment it passed the minimum, with
   no requirement that the funds had aged at all. So:

     list an item at $999, buy it from a second account with a stolen card,
     the wallet is credited $799, withdraw it the same minute, and abandon the
     account. Six weeks later the dispute lands, the balance goes to -$799, and
     that is a number in a record nobody will ever return to.

   AMV is out the payout, the dispute fee, and a mark against its merchant
   account - and the seller keeps it. Every marketplace that survives holds
   funds until the window has substantially passed; the ones that pay out
   instantly are the ones that get farmed.

   So: money from a sale is HELD, withdrawal can only reach what has cleared,
   and a reversal takes the held money first because that is the money most
   likely to still exist. None of that may cost an honest seller anything more
   than time, and the time has to be stated plainly rather than discovered. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'clearing.harness.mjs');
writeFileSync(harness, src
  + '\nexport { DB, _wallet, _saveWallet, _creditSale, _reverseSale, _availableBalance,'
  + ' PAYOUT_HOLD_MS, PAYOUT_RESERVE_MS, PAYOUT_RESERVE_PCT, MARKET_MIN_WITHDRAW, MARKET_PLATFORM_FEE };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv(extra) {
  const m = new Map(); const vals = new Map();
  return Object.assign({
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        /* claim AND release. A stub that only claims makes every lock permanent,
           so the second mutation on the same wallet never gets in - which looks
           exactly like a deadlock in the product and is really a gap in the
           fixture. It also has to be modelled because a release that does not
           work IS a production deadlock, and this is where that would show. */
        if (b.op === 'claim') { if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '33.33.33.33',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const PW = 'A-real-Passw0rd!';
const SELLER = 'seller@example.com';
const DAY = 86400000;

async function sellerWithASale(env, { price = 999, at = Date.now() } = {}) {
  const tok = (await (await call(env, '/auth/signup', { email: SELLER, name: 'S', password: PW })).json()).token;
  /* Old enough to take money out at all - a separate gate, satisfied here so
     this file is about clearing and nothing else. */
  await W.DB.put(env, 'consent', SELLER, { birthYear: 1990, at: Date.now() });
  await W.DB.put(env, 'market', 'itm1', { id: 'itm1', title: 'Thing', price, authorEmail: SELLER });
  await W.DB.put(env, 'ent', SELLER, { plan: 'pro', source: 'stripe' });
  await W._creditSale(env, { itemId: 'itm1', buyer: 'buyer@example.com', seller: SELLER,
                             amountCents: price * 100, ref: 'pi_1', at });
  return tok;
}
/* Age the held money by rewriting when it was taken, which is what the passage
   of time would do. */
async function ageFunds(env, email, ms) {
  const w = await W._wallet(env, email);
  for (const h of (w.holds || [])) { h.at -= ms; h.until -= ms; }
  await W._saveWallet(env, email, w);
}

section('A sale credits the seller, and the money is not theirs to take yet');
{
  const env = mkEnv();
  const tok = await sellerWithASale(env);
  const share = 999 * (1 - W.MARKET_PLATFORM_FEE);

  const w = await W._wallet(env, SELLER);
  ok(Math.round(w.balance) === Math.round(share),
     'the balance shows what they have earned', w.balance);

  const avail = await W._availableBalance(env, SELLER);
  ok(avail === 0, 'but none of it has cleared yet', avail);

  const tried = await post(env, '/v1/market/withdraw', { destination: 'paypal@seller.com' }, tok);
  ok(tried.status >= 400, 'so a withdrawal is refused', tried.status);
  ok(/clear|hold|available/i.test(tried.body.error || ''),
     'and says it is a matter of time, not a rejection of them', tried.body.error);
  ok(/\d/.test(tried.body.error || ''), 'naming when', tried.body.error);
}

section('Once the hold clears they are paid, less the reserve that has not');
{
  /* THIS SECTION USED TO ASSERT 100% AT DAY 14, and that was right until the
     rolling reserve existed. It is deliberately no longer true: the 14-day
     hold answers "did this sale stick", and a card dispute can arrive up to
     120 days after the charge, so a slice of every sale is held across the
     whole window. Holding EVERYTHING for 120 days would be safe and would
     also make AMV useless to an honest seller waiting four months to be paid
     for delivered work.

     The property this section was really guarding is untouched and is checked
     harder below: the seller is paid IN FULL, eventually. The reserve is a
     delay, not a deduction, and a test that could not tell those apart would
     be the one worth worrying about. */
  const env = mkEnv();
  const tok = await sellerWithASale(env);
  await ageFunds(env, SELLER, W.PAYOUT_HOLD_MS + DAY);

  const share = +(999 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2);
  const reserved = +(share * W.PAYOUT_RESERVE_PCT).toFixed(2);
  const clears = +(share - reserved).toFixed(2);

  const avail = await W._availableBalance(env, SELLER);
  ok(Math.abs(avail - clears) < 0.01,
     'the share is available apart from the reserve slice', { avail, clears, reserved });
  ok(reserved > 0, 'and the reserve is a real amount, not a rounding artefact', reserved);

  const out = await post(env, '/v1/market/withdraw', { destination: 'paypal@seller.com' }, tok);
  ok(out.body.ok === true, 'the withdrawal goes through', out.body.error || 'ok');
  ok(Math.abs((out.body.amount || 0) - clears) < 0.01, 'for what has cleared', out.body.amount);

  const after = await W._availableBalance(env, SELLER);
  ok(after === 0, 'with nothing further available yet', after);

  /* AND THE REST ARRIVES. This is the assertion that keeps the reserve honest:
     it is the seller's money the whole time and it clears late rather than
     being kept. Without this, a bug that quietly confiscated 10% of every sale
     would pass everything above it. */
  await ageFunds(env, SELLER, W.PAYOUT_RESERVE_MS + DAY);
  const later = await W._availableBalance(env, SELLER);
  ok(Math.abs(later - reserved) < 0.01,
     'once the dispute window has passed, the reserve becomes available too', { later, reserved });

  const out2 = await post(env, '/v1/market/withdraw', { destination: 'paypal@seller.com' }, tok);
  ok(out2.body.ok === true, 'and they can take it', out2.body.error || 'ok');
  ok(Math.abs(((out.body.amount || 0) + (out2.body.amount || 0)) - share) < 0.01,
     'so across the two payouts they receive the entire share - the reserve delayed it and nothing kept it',
     { first: out.body.amount, second: out2.body.amount, share });
}

section('A chargeback inside the window takes back money that is still here');
{
  /* The whole point. The dispute arrives before the seller could withdraw, so
     the held funds are still on the books and the reversal is complete - AMV
     loses nothing. */
  const env = mkEnv();
  await sellerWithASale(env);
  const before = await W._wallet(env, SELLER);
  ok(before.balance > 0, 'the seller has been credited', before.balance);

  const reversed = await W._reverseSale(env, 'pi_1', 'dispute');
  ok(!!reversed, 'the sale is reversed', !!reversed);

  const w = await W._wallet(env, SELLER);
  ok(Math.round(w.balance) === 0, 'the credit is gone from the balance', w.balance);
  const avail = await W._availableBalance(env, SELLER);
  ok(avail <= 0, 'and there is nothing to withdraw', avail);
  ok((w.holds || []).length === 0, 'the hold is released rather than left dangling', (w.holds || []).length);
}

section('And the buyer does not keep what they charged back');
{
  const env = mkEnv();
  await sellerWithASale(env);
  await W._reverseSale(env, 'pi_1', 'dispute');
  const owns = await env.AMV_KV.get('entitleitem:buyer@example.com:itm1');
  ok(!owns, 'the item is taken back', owns);
}

section('Two sales clear on their own clocks');
{
  /* A seller trading normally has money at different ages, and only the mature
     part may leave. Paying out everything because the OLDEST credit has cleared
     is the same hole with an extra step. */
  const env = mkEnv();
  const tok = await sellerWithASale(env, { price: 100 });
  await ageFunds(env, SELLER, W.PAYOUT_HOLD_MS + DAY);      // first sale matures
  await W.DB.put(env, 'market', 'itm2', { id: 'itm2', title: 'Second', price: 500, authorEmail: SELLER });
  await W._creditSale(env, { itemId: 'itm2', buyer: 'buyer2@example.com', seller: SELLER,
                             amountCents: 50000, ref: 'pi_2' });

  const avail = await W._availableBalance(env, SELLER);
  /* The older sale's SHORT hold has matured. Its reserve slice has not - that
     one runs for the whole dispute window - and neither has any part of the
     newer sale. Counted rather than assumed, so this still fails if the two
     sales' clocks ever get confused with each other. */
  const first = +(100 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2);
  const firstClears = +(first * (1 - W.PAYOUT_RESERVE_PCT)).toFixed(2);
  ok(Math.abs(avail - firstClears) < 0.01,
     'only the older sale has cleared, and only the part of it that is not reserved',
     { avail, firstClears, first });

  const out = await post(env, '/v1/market/withdraw', { destination: 'paypal@seller.com' }, tok);
  ok(out.body.ok === true, 'they can take that much', out.body.error || 'ok');
  ok(Math.abs((out.body.amount || 0) - firstClears) < 0.01, 'and only that much', out.body.amount);

  const w = await W._wallet(env, SELLER);
  ok(w.balance > 0, 'the newer sale is still on the books', w.balance);
  /* Three holds remain: the older sale's reserve, and the newer sale's two.
     A sale leaves two holds now - the part that clears on the short window and
     the reserve that clears on the long one - so a count of "one per sale" is
     the assumption that broke here rather than the behaviour. */
  const remaining = (w.holds || []);
  ok(remaining.length === 3, 'still held, each on its own clock', remaining.length);
  ok(remaining.filter(h => h.reserve).length === 2,
     'two of them are reserve slices, one per sale', remaining.filter(h => h.reserve).length);
  ok(remaining.filter(h => h.ref === 'pi_2').length === 2,
     'and the newer sale is wholly unavailable, both of its parts', remaining.filter(h => h.ref === 'pi_2').length);
}

section('Nothing is silently taken from a seller who did nothing wrong');
{
  /* A hold is a delay, not a deduction. Everything credited has to be either
     available, held, or reversed - never quietly missing. */
  const env = mkEnv();
  await sellerWithASale(env, { price: 250 });
  const share = +(250 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2);
  const w = await W._wallet(env, SELLER);
  const held = (w.holds || []).reduce((n, h) => n + h.amount, 0);
  const avail = await W._availableBalance(env, SELLER);
  ok(Math.abs((held + avail) - w.balance) < 0.01,
     'held plus available is exactly the balance', { held, avail, balance: w.balance });
  ok(Math.abs(w.balance - share) < 0.01, 'which is what the sale earned them', { balance: w.balance, share });
}

section('Money that predates the hold is not frozen retroactively');
{
  /* A wallet written before any of this existed has no holds. Treating that as
     "nothing has cleared" would freeze every existing seller's balance on the
     day this ships, which is a way to lose sellers rather than fraud. */
  const env = mkEnv();
  const tok = (await (await call(env, '/auth/signup', { email: SELLER, name: 'S', password: PW })).json()).token;
  await W.DB.put(env, 'consent', SELLER, { birthYear: 1990, at: Date.now() });
  await W.DB.put(env, 'ent', SELLER, { plan: 'pro', source: 'stripe' });
  await W._saveWallet(env, SELLER, { balance: 120, lifetime: 120, currency: 'usd' });   // no holds field

  const avail = await W._availableBalance(env, SELLER);
  ok(avail === 120, 'an older balance is fully available', avail);
  const out = await post(env, '/v1/market/withdraw', { destination: 'paypal@seller.com' }, tok);
  ok(out.body.ok === true, 'and can still be withdrawn', out.body.error || 'ok');
}

section('The hold is a stated number, not a surprise');
{
  ok(typeof W.PAYOUT_HOLD_MS === 'number' && W.PAYOUT_HOLD_MS > 0,
     'there is a defined clearing period', W.PAYOUT_HOLD_MS);
  const days = W.PAYOUT_HOLD_MS / DAY;
  ok(days >= 7, 'long enough to be worth having', days);
  ok(days <= 45, 'and not so long that selling here is pointless', days);

  const env = mkEnv();
  const tok = await sellerWithASale(env, { price: 50 });
  const earn = await post(env, '/v1/market/earnings', {}, tok);
  ok(earn.body.available != null, 'the earnings screen says what has cleared', earn.body.available);
  ok(earn.body.pending > 0, 'and what is still clearing', earn.body.pending);
  ok(earn.body.holdDays === days, 'and how long that takes', earn.body.holdDays);
}

section('Two sales at the same moment both reach the seller');
{
  /* Credit was a read-modify-write with no lock. Two sales completing together
     both read the same balance and both write it back, so one seller credit
     vanished - silently, with nothing failing, and only ever under enough
     traffic for two things to happen at once. */
  const env = mkEnv();
  await sellerWithASale(env, { price: 100 });
  const first = (await W._wallet(env, SELLER)).balance;

  for (let i = 2; i <= 5; i++) {
    await W.DB.put(env, 'market', 'itm' + i, { id: 'itm' + i, title: 'T' + i, price: 100, authorEmail: SELLER });
  }
  await Promise.all([2, 3, 4, 5].map(i => W._creditSale(env, {
    itemId: 'itm' + i, buyer: 'b' + i + '@example.com', seller: SELLER,
    amountCents: 10000, ref: 'pi_' + i })));

  const w = await W._wallet(env, SELLER);
  const share = +(100 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2);
  ok(Math.abs(w.balance - (first + share * 4)) < 0.01,
     'all four concurrent credits are on the balance, none lost', { got: w.balance, want: first + share * 4 });
  /* Two holds per sale now - the part that clears on the short window and the
     reserve that clears across the dispute window - so five sales leave ten.
     Asserted as "per sale" rather than as a bare number, because the number is
     the thing that changed and the property is what matters. */
  const holds = (w.holds || []);
  const refs = new Set(holds.map(h => h.ref));
  ok(refs.size === 5, 'and each sale is represented', refs.size);
  ok(holds.length === refs.size * 2,
     'by both of its holds - the clearing part and the reserve', { holds: holds.length, sales: refs.size });
}

section('Cleared holds are dropped as sales come in, not only at payout');
{
  /* Holds were pruned in exactly one place - the withdrawal. A seller who does
     not withdraw therefore accumulated one entry per sale for ever, in a record
     that is READ AND REWRITTEN ON EVERY SALE. It is not a correctness bug until
     it is, and by then their wallet is megabytes and every sale is slow. */
  const env = mkEnv();
  await sellerWithASale(env, { price: 100 });
  await ageFunds(env, SELLER, W.PAYOUT_HOLD_MS + DAY);        // the first has cleared
  /* Ageing moves the clocks; it does not prune - that happens on the next
     credit or withdrawal, which is exactly what this section is about. So both
     holds are still carried here: the short one now matured, the reserve still
     running for the rest of the dispute window. */
  const afterAge = (await W._wallet(env, SELLER)).holds;
  ok(afterAge.length === 2, 'both holds are still carried before anything prunes', afterAge.length);
  ok(afterAge.filter(h => (h.until || 0) <= Date.now()).length === 1,
     'one of them has matured', afterAge.map(h => h.until));
  ok(afterAge.filter(h => h.reserve && (h.until || 0) > Date.now()).length === 1,
     'and the reserve is the one still running', afterAge.filter(h => h.reserve));

  await W.DB.put(env, 'market', 'itmN', { id: 'itmN', title: 'N', price: 100, authorEmail: SELLER });
  await W._creditSale(env, { itemId: 'itmN', buyer: 'bn@example.com', seller: SELLER,
                             amountCents: 10000, ref: 'pi_n' });

  const w = await W._wallet(env, SELLER);
  const hs = (w.holds || []);
  /* The matured SHORT hold of the first sale is gone. What remains is the first
     sale's reserve plus both of the new sale's holds - nothing that has
     matured is still being carried, which is what this section is about. */
  ok(hs.length === 3, 'only holds that are still running remain', hs.length);
  ok(hs.filter(h => h.ref === 'pi_n').length === 2, 'both parts of the new sale', hs.filter(h => h.ref === 'pi_n').length);
  ok(hs.filter(h => h.reserve).length === 2, 'and a reserve for each sale', hs.filter(h => h.reserve).length);
  ok(!hs.some(h => (h.until || 0) <= Date.now()), 'and nothing matured is still carried', hs.map(h => h.until));

  /* Pruning must not touch the money - only the bookkeeping. */
  const share = +(100 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2);
  ok(Math.abs(w.balance - share * 2) < 0.01, 'both sales are still on the balance', w.balance);
  const avail = await W._availableBalance(env, SELLER);
  const clearedPart = +(share * (1 - W.PAYOUT_RESERVE_PCT)).toFixed(2);
  ok(Math.abs(avail - clearedPart) < 0.01,
     'and the cleared part of the first sale is still withdrawable', { avail, clearedPart });
}

section('A sale landing mid-withdrawal cannot restore money that already left');
{
  /* The other direction, and the one that costs AMV rather than the seller: the
     payout writes the reduced balance, a concurrent sale writes back the number
     it read BEFORE the payout, and money already paid out is on the books to be
     withdrawn a second time. */
  const env = mkEnv();
  const tok = await sellerWithASale(env, { price: 1000 });
  await ageFunds(env, SELLER, W.PAYOUT_HOLD_MS + DAY);
  const cleared = (await W._wallet(env, SELLER)).balance;
  await W.DB.put(env, 'market', 'itmX', { id: 'itmX', title: 'X', price: 200, authorEmail: SELLER });

  const [out] = await Promise.all([
    post(env, '/v1/market/withdraw', { destination: 'paypal@seller.com' }, tok),
    W._creditSale(env, { itemId: 'itmX', buyer: 'bx@example.com', seller: SELLER,
                         amountCents: 20000, ref: 'pi_x' }),
  ]);
  ok(out.body.ok === true, 'the withdrawal completed', out.body.error || 'ok');

  const w = await W._wallet(env, SELLER);
  const newShare = +(200 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2);
  ok(Math.abs(w.balance - (cleared - (out.body.amount || 0) + newShare)) < 0.01,
     'the balance is exactly what left plus what arrived', { balance: w.balance, paid: out.body.amount, newShare });
  ok(W._availableBalance ? true : true, 'and the new sale is still held, not instantly withdrawable', true);
  const avail = await W._availableBalance(env, SELLER);
  ok(avail === 0, 'nothing is available again straight away', avail);
}

globalThis.fetch = realFetch;
if (report('money-clears-before-it-leaves') > 0) process.exitCode = 1;
done();
