/* MARKETPLACE REFUNDS AND CHARGEBACKS - the money went one way only.

   A purchase granted the item and credited the seller 80%. A refund or a
   chargeback on that same payment did none of the reverse: the buyer kept the
   item, the seller kept the money and could withdraw it, and AMV ate the whole
   charge. "Buy the expensive listing, then charge it back" was a way to take
   money out of the platform. The fraud register already had a signal named for
   this exact pattern; nothing on the server acted on it.

   It was wrong in the other direction too. Every refund called
   setEntitlement(free) - so a paying subscriber who refunded a nine dollar
   listing had their whole subscription revoked for it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'mktrev.harness.mjs');
writeFileSync(harness, src + `
export { _creditSale, _reverseSale, _wallet, _saveWallet, _walletTx, _purchasesList,
         setEntitlement, _planOf, marketWithdraw, signToken, DB, MARKET_PLATFORM_FEE };
`);
const W = await import(harness + '?t=' + Date.now());

/* Money endpoints now require a recorded adult age - an account that has never
   been asked is refused with age_required, which is a prompt rather than a
   verdict. Production accounts answer it once; fixtures have to say it too. */
async function _adult(env, email){
  await W.DB.put(env, 'consent', String(email).toLowerCase(),
    { birthYear: new Date().getUTCFullYear() - 30, ageSetAt: Date.now(), history: [] });
}

function makeEnv() {
  const kv = new Map();
  return { _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnop',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }),
    } };
}
const REF = 'pi_test_123';
async function listAnItem(env, id = 'usr_thing', price = 200) {
  await env.AMV_KV.put('market:' + id, JSON.stringify({
    id, title: 'A costly thing', kind: 'prompt', price, authorEmail: 'seller@x.com', status: 'active', sales: 0 }));
  return id;
}
const buy = (env, id, price) => W._creditSale(env, {
  itemId: id, buyer: 'buyer@x.com', seller: 'seller@x.com', amountCents: price * 100, ref: REF });
const owns = async (env, id) => !!(await env.AMV_KV.get('entitleitem:buyer@x.com:' + id));
const balance = async (env, who) => (await W._wallet(env, who)).balance;

section('A sale credits the seller and grants the buyer, as before');
{
  const env = makeEnv();
  const id = await listAnItem(env);
  await buy(env, id, 200);
  ok(await owns(env, id), 'the buyer gets the item');
  ok((await balance(env, 'seller@x.com')) === 160, 'and the seller gets 80%', await balance(env, 'seller@x.com'));
  ok(!!(await env.AMV_KV.get('saleref:' + REF)),
     'and the payment is remembered, which is what makes it reversible at all');
}

section('A chargeback takes the item back AND the money');
{
  const env = makeEnv();
  const id = await listAnItem(env);
  await buy(env, id, 200);

  const rec = await W._reverseSale(env, REF, 'dispute');
  ok(!!rec, 'the sale is found from the payment reference', !!rec);
  ok(!(await owns(env, id)), 'the buyer does not keep what they did not pay for');
  ok((await balance(env, 'seller@x.com')) === 0, 'and the seller does not keep the money',
     await balance(env, 'seller@x.com'));

  const purchases = await W._purchasesList(env, 'buyer@x.com');
  ok(!purchases.some(p => p.id === id), 'it leaves their library too', purchases);
  ok(!(await W.DB.get(env, 'mktsnap', 'buyer@x.com:' + id)), 'along with the snapshot they were given');

  const tx = await W._walletTx(env, 'seller@x.com');
  ok(tx.some(t => t.type === 'sale_reversed' && t.amount === -160),
     'and the clawback is on the seller\'s statement, not silent', tx.map(t => t.type));
}

section('A seller who already withdrew still owes it');
{
  /* The attack is timing: sell, withdraw, then have the buyer charge back. If
     the balance floors at zero the platform eats it and being fast is rewarded. */
  const env = makeEnv();
  const id = await listAnItem(env);
  await buy(env, id, 200);
  const w = await W._wallet(env, 'seller@x.com');
  w.balance = 0;                                        // already paid out
  await W._saveWallet(env, 'seller@x.com', w);

  await W._reverseSale(env, REF, 'dispute');
  ok((await balance(env, 'seller@x.com')) === -160,
     'the balance goes negative rather than being written off', await balance(env, 'seller@x.com'));

  await _adult(env, 'seller@x.com');
  const token = await W.signToken({ email: 'seller@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  const r = await W.marketWithdraw(new Request('https://w/v1/market/withdraw',
    { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' }), env);
  ok(r.status === 400, 'so they cannot withdraw again until it is paid back', r.status);
}

section('Reversing twice does not claw twice');
{
  const env = makeEnv();
  const id = await listAnItem(env);
  await buy(env, id, 200);
  await W._reverseSale(env, REF, 'refund');
  const after = await balance(env, 'seller@x.com');
  await W._reverseSale(env, REF, 'dispute');   // Stripe sends both on some flows
  ok((await balance(env, 'seller@x.com')) === after,
     'a refund followed by a dispute on the same charge reverses once', await balance(env, 'seller@x.com'));
}

section('A one-of-a-kind listing goes back on sale');
{
  const env = makeEnv();
  const id = await listAnItem(env);
  await buy(env, id, 200);
  let it = JSON.parse(await env.AMV_KV.get('market:' + id));
  ok(it.status === 'sold', 'it was marked sold', it.status);
  await W._reverseSale(env, REF, 'refund');
  it = JSON.parse(await env.AMV_KV.get('market:' + id));
  ok(it.status === 'active', 'and is listed again once the sale is undone', it.status);
  ok(it.sales === 0, 'with the sale count corrected', it.sales);
}

section('Refunding a listing does NOT cancel a subscription');
{
  /* Both handlers called setEntitlement(free) on any refund. A paying customer
     who refunded a nine dollar prompt lost the plan they were still paying for. */
  const env = makeEnv();
  const id = await listAnItem(env, 'usr_small', 9);
  await W.setEntitlement(env, 'buyer@x.com', 'ultra');
  await W._creditSale(env, { itemId: id, buyer: 'buyer@x.com', seller: 'seller@x.com', amountCents: 900, ref: REF });

  await W._reverseSale(env, REF, 'refund');
  const ent = await W.DB.get(env, 'ent', 'buyer@x.com');
  ok(W._planOf(ent) === 'ultra', 'the subscription they are still paying for is untouched', W._planOf(ent));
  ok(!(await owns(env, id)), 'while the refunded item is still taken back');
}

section('A payment that bought nothing in the marketplace reverses nothing');
{
  const env = makeEnv();
  const r = await W._reverseSale(env, 'pi_a_subscription_charge', 'refund');
  ok(r === null, 'an unrelated charge is not matched to a sale', r);
  ok((await W._reverseSale(env, '', 'refund')) === null, 'and neither is a missing reference');
}

section('The buyer is recorded, because doing it repeatedly is the attack');
{
  const env = makeEnv();
  const id = await listAnItem(env);
  await buy(env, id, 200);
  await W._reverseSale(env, REF, 'dispute');
  const abuse = await W.DB.get(env, 'abuse', 'buyer@x.com');
  ok(!!abuse && abuse.disputes >= 1, 'the dispute lands on the buyer\'s record', abuse && abuse.disputes);
  ok(abuse.events.some(e => e.marketItem === id), 'naming what was disputed', abuse.events);
}

report('market-reversal');
done();
