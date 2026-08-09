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
  + ' PAYOUT_HOLD_MS, MARKET_MIN_WITHDRAW, MARKET_PLATFORM_FEE };\n');
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
        if (b.op === 'claim') { if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true })); }
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

section('Once it has cleared, they are paid in full');
{
  const env = mkEnv();
  const tok = await sellerWithASale(env);
  await ageFunds(env, SELLER, W.PAYOUT_HOLD_MS + DAY);

  const share = +(999 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2);
  const avail = await W._availableBalance(env, SELLER);
  ok(Math.abs(avail - share) < 0.01, 'the whole share is available', { avail, share });

  const out = await post(env, '/v1/market/withdraw', { destination: 'paypal@seller.com' }, tok);
  ok(out.body.ok === true, 'and the withdrawal goes through', out.body.error || 'ok');
  ok(Math.abs((out.body.amount || 0) - share) < 0.01, 'for the full amount', out.body.amount);

  const after = await W._availableBalance(env, SELLER);
  ok(after === 0, 'with nothing left available afterwards', after);
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
  const first = +(100 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2);
  ok(Math.abs(avail - first) < 0.01, 'only the older sale has cleared', { avail, first });

  const out = await post(env, '/v1/market/withdraw', { destination: 'paypal@seller.com' }, tok);
  ok(out.body.ok === true, 'they can take that much', out.body.error || 'ok');
  ok(Math.abs((out.body.amount || 0) - first) < 0.01, 'and only that much', out.body.amount);

  const w = await W._wallet(env, SELLER);
  ok(w.balance > 0, 'the newer sale is still on the books', w.balance);
  ok((w.holds || []).length === 1, 'still held, on its own clock', (w.holds || []).length);
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

globalThis.fetch = realFetch;
if (report('money-clears-before-it-leaves') > 0) process.exitCode = 1;
done();
