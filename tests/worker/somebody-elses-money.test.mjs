/* THE MARKETPLACE MOVES MONEY THAT IS NOT AMV'S.

   A plan is a customer paying AMV. A marketplace sale is a stranger paying
   another stranger, with AMV holding the money in between and taking a cut -
   which makes every mistake here somebody else's loss, and the kind that ends
   in a complaint AMV has to answer for.

   Reading the code, this is the best-built part of the backend: the buyer's
   copy is snapshotted so a later edit cannot revoke it, a reversal takes the
   item back and debits the seller, the balance is allowed to go NEGATIVE so a
   seller cannot outrun a chargeback by withdrawing first, and every side effect
   is claimed exactly once.

   None of it was tested. Not one of those routes appeared in any suite, which
   means every one of those properties was one careless edit from being gone,
   silently, with the failure landing on a seller's balance rather than on a
   screen.

   So this is written as the money story: publish, buy, pay, get paid, refund,
   and the several ways somebody would try to take money that is not theirs. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'market.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _wallet, _creditSale, _reverseSale, MARKET_PLATFORM_FEE, MARKET_MIN_WITHDRAW };\n');
const W = await import(harness + '?t=' + Date.now());

const SELLER = 'seller@example.com';
const BUYER = 'buyer@example.com';
const PW = 'A-real-Passw0rd!';
const SECRET = 'whsec_market';

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/checkout\/sessions$/.test(u)) return { ok: true, status: 200, json: async () => ({ id: 'cs_m1', url: 'https://pay/x' }) };
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv() {
  const m = new Map();
  return {
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: SECRET,
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '11.11.11.11',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);

async function signup(env, email) {
  const d = await (await call(env, '/auth/signup', { email, name: 'X', password: PW })).json();
  await W.DB.put(env, 'consent', email, { birthYear: 1990, at: Date.now() });   // the real money age gate
  return d.token;
}
/* A genuinely signed Stripe delivery - the endpoint fails closed, so an
   unsigned fixture would only ever test the 400. */
async function webhook(env, evt) {
  const body = JSON.stringify(evt);
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const v1 = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  const r = await W.default.fetch(new Request('https://api.amv.test/v1/stripe/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` }, body,
  }), env, ctx);
  await ctx.settle();
  return r;
}
const listing = async (env, id, extra) =>
  env.AMV_KV.put(`market:${id}`, JSON.stringify(Object.assign(
    { id, title: 'A useful thing', kind: 'prompt', price: 20, authorEmail: SELLER, status: 'active' }, extra || {})));
const walletOf = async (env, em) => await W._wallet(env, em);
const owns = async (env, em, id) => !!(await env.AMV_KV.get(`entitleitem:${em}:${id}`));

/* payment_status: 'paid' because every real Checkout Session carries it, and
   this fixture did not. A marketplace sale is where that mattered most - an
   unpaid session used to credit the SELLER their eighty percent, so AMV booked
   a payout against money that had not arrived. See
   a-voucher-nobody-paid-is-not-a-payment for the unpaid direction. */
const sale = (id, itemId, amountCents, ref) => ({
  id, type: 'checkout.session.completed',
  data: { object: { id: 'cs_' + id, payment_status: 'paid', amount_total: amountCents, payment_intent: ref,
    metadata: { kind: 'market_purchase', itemId, buyer: BUYER, seller: SELLER } } },
});

section('A sale pays the seller their share and AMV its cut');
{
  const env = mkEnv();
  await listing(env, 'itm1');
  await webhook(env, sale('evt1', 'itm1', 2000, 'pi_1'));

  ok(await owns(env, BUYER, 'itm1'), 'the buyer owns what they paid for', true);
  const w = await walletOf(env, SELLER);
  const expected = +(20 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2);
  ok(w.balance === expected, 'the seller is credited their share, to the cent', { got: w.balance, expected });
  ok(w.lifetime === expected, 'and it counts toward what they have ever earned', w.lifetime);
}

section('The share is taken from what was actually paid, not from the listing');
{
  /* A price the seller edited after checkout must not change what anybody is
     paid. The charge is the fact; the listing is a page. */
  const env = mkEnv();
  await listing(env, 'itm2', { price: 999 });
  await webhook(env, sale('evt2', 'itm2', 1000, 'pi_2'));   // they actually paid $10
  const w = await walletOf(env, SELLER);
  ok(w.balance === +(10 * (1 - W.MARKET_PLATFORM_FEE)).toFixed(2),
     'paid on the $10 charged, not the $999 on the page', w.balance);
}

section('What the buyer bought cannot be taken away by editing it');
{
  /* They paid for THIS content. A seller who rewrites or deletes the listing
     afterwards must not be able to reach into what somebody already owns. */
  const env = mkEnv();
  await listing(env, 'itm3', { body: 'the original deliverable' });
  await webhook(env, sale('evt3', 'itm3', 2000, 'pi_3'));

  await listing(env, 'itm3', { body: 'REPLACED WITH NOTHING', title: 'Changed' });
  const snap = await W.DB.get(env, 'mktsnap', `${BUYER}:itm3`);
  ok(!!snap, 'a copy was kept at the moment of purchase', !!snap);
  ok(/original deliverable/.test(JSON.stringify(snap)), 'and it is what they actually bought', snap.title);
}

section('A refund takes the item back AND the money');
{
  /* Before the reversal existed, a chargeback left the buyer with the item, the
     seller with the credit, and AMV with the loss - which makes "buy the
     expensive listing, charge it back" a way to withdraw money from AMV. */
  const env = mkEnv();
  await listing(env, 'itm4');
  await webhook(env, sale('evt4', 'itm4', 2000, 'pi_4'));
  const before = (await walletOf(env, SELLER)).balance;
  ok(before > 0 && await owns(env, BUYER, 'itm4'), 'sold and paid first', before);

  await W._reverseSale(env, 'pi_4', 'refund');
  ok(!(await owns(env, BUYER, 'itm4')), 'the buyer no longer owns it', true);
  ok((await walletOf(env, SELLER)).balance === 0, 'and the seller no longer has the money', (await walletOf(env, SELLER)).balance);
  const purchases = JSON.parse((await env.AMV_KV.get(`purchases:${BUYER}`)) || '[]');
  ok(!purchases.some(p => p.id === 'itm4'), 'and it is gone from their purchases', purchases.length);
}

section('A seller who withdrew first cannot outrun the reversal');
{
  /* The balance goes NEGATIVE on purpose. Clamping it at zero would mean the
     fastest seller keeps a refunded payment and AMV eats it, which is the whole
     scam this exists to stop. */
  const env = mkEnv();
  await listing(env, 'itm5');
  await webhook(env, sale('evt5', 'itm5', 5000, 'pi_5'));
  const w = await walletOf(env, SELLER);
  await env.AMV_KV.put(`wallet:${SELLER}`, JSON.stringify({ ...w, balance: 0 }));   // as if withdrawn

  await W._reverseSale(env, 'pi_5', 'chargeback');
  const after = await walletOf(env, SELLER);
  ok(after.balance < 0, 'the balance goes negative rather than being forgiven', after.balance);

  /* And a debt cannot be cashed out. */
  const tok = await signup(env, SELLER);
  const r = await (await call(env, '/v1/market/withdraw', { destination: 'seller@paypal.com' }, tok)).json();
  ok(!!r.error, 'a seller in debt cannot withdraw', r.error);
  ok((await walletOf(env, SELLER)).balance < 0, 'and the debt is still there', (await walletOf(env, SELLER)).balance);
}

section('A refund followed by a dispute claws back once, not twice');
{
  const env = mkEnv();
  await listing(env, 'itm6');
  await webhook(env, sale('evt6', 'itm6', 3000, 'pi_6'));
  const paid = (await walletOf(env, SELLER)).balance;

  await W._reverseSale(env, 'pi_6', 'refund');
  const once = (await walletOf(env, SELLER)).balance;
  await W._reverseSale(env, 'pi_6', 'dispute');
  const twice = (await walletOf(env, SELLER)).balance;
  ok(paid > 0 && once === 0, 'the first reversal takes the share back', { paid, once });
  ok(twice === once, 'the second takes nothing further', { once, twice });
}

section('A one-of-a-kind listing goes back on sale when it is reversed');
{
  const env = mkEnv();
  await listing(env, 'usr_thing', { price: 40 });
  await webhook(env, sale('evt7', 'usr_thing', 4000, 'pi_7'));
  ok(JSON.parse(await env.AMV_KV.get('market:usr_thing')).status === 'sold', 'marked sold', true);

  await W._reverseSale(env, 'pi_7', 'refund');
  ok(JSON.parse(await env.AMV_KV.get('market:usr_thing')).status === 'active',
     'and back on sale, rather than lost to everybody', true);
}

section('A redelivered webhook does not pay the seller twice');
{
  const env = mkEnv();
  await listing(env, 'itm8');
  await webhook(env, sale('evt8', 'itm8', 2000, 'pi_8'));
  const first = (await walletOf(env, SELLER)).balance;
  await webhook(env, sale('evt8', 'itm8', 2000, 'pi_8'));       // same event id again
  ok((await walletOf(env, SELLER)).balance === first, 'the same event credits once', first);
}

section('You cannot buy your own listing, or buy the same thing twice');
{
  const env = mkEnv();
  await listing(env, 'itm9');
  const sellerTok = await signup(env, SELLER);
  const own = await (await call(env, '/v1/market/buy', { id: 'itm9' }, sellerTok)).json();
  ok(/cannot buy your own/i.test(own.error || ''), 'a seller cannot buy from themselves', own.error);

  await webhook(env, sale('evt9', 'itm9', 2000, 'pi_9'));
  const buyerTok = await signup(env, BUYER);
  const again = await (await call(env, '/v1/market/buy', { id: 'itm9' }, buyerTok)).json();
  ok(/already own/i.test(again.error || ''), 'and nobody pays twice for the same item', again.error);
}

section('Money needs an age on file');
{
  /* A minor cannot form a binding contract, which is exactly why their
     purchases come back as chargebacks. */
  const env = mkEnv();
  await listing(env, 'itm10');
  const d = await (await call(env, '/auth/signup', { email: 'kid@example.com', name: 'K', password: PW })).json();
  const r = await (await call(env, '/v1/market/buy', { id: 'itm10' }, d.token)).json();
  ok(/age/i.test(r.error || ''), 'buying is refused until an age is confirmed', r.error);

  await W.DB.put(env, 'consent', 'kid@example.com', { birthYear: new Date().getUTCFullYear() - 12, at: Date.now() });
  const r2 = await (await call(env, '/v1/market/buy', { id: 'itm10' }, d.token)).json();
  ok(/only available to people/i.test(r2.error || ''), 'and refused for a child', r2.error);
}

section('And you can only review somebody you actually bought from');
{
  const env = mkEnv();
  await listing(env, 'itm11');
  const buyerTok = await signup(env, BUYER);

  const before = await (await call(env, '/v1/market/review', { seller: SELLER, stars: 1, text: 'terrible' }, buyerTok)).json();
  ok(/only review sellers you/i.test(before.error || ''),
     'a stranger cannot leave a review', before.error);

  await webhook(env, sale('evt11', 'itm11', 2000, 'pi_11'));
  const after = await (await call(env, '/v1/market/review', { seller: SELLER, stars: 5, text: 'genuinely useful' }, buyerTok)).json();
  ok(after.ok === true || !after.error, 'somebody who bought from them can', after.error || 'ok');

  const self = await (await call(env, '/v1/market/review', { seller: BUYER, stars: 5, text: 'I am great' }, buyerTok)).json();
  ok(!!self.error, 'and nobody reviews themselves', self.error);
}

globalThis.fetch = realFetch;
if (report('somebody-elses-money') > 0) process.exitCode = 1;
done();
