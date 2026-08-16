/* WORK THAT DID NOT HAPPEN, RECORDED AS WORK THAT DID.

   Two places in the marketplace claim something once and then do the work.
   Both had the claim on the wrong side of the failure.

   THE REVERSAL (AMV-010). A refund followed by a dispute on the same charge
   must not claw the money back twice, so the reversal is claimed once, and the
   claim is permanent - it has to be, or a redelivery weeks later would reverse
   the same sale again. It was taken before any of the four steps that follow,
   and three of those steps swallowed their own errors.

   So a wallet locked by another writer, or one blink of the store, and the
   reversal stops halfway with the claim still held. The provider retries, the
   retry is discarded as a duplicate of work that never happened, and the buyer
   keeps an item they charged back or the seller keeps money taken off a card.
   Nothing errors. From outside, a held claim and a finished reversal are
   indistinguishable.

   `_creditSale` - the same money going the other way - had this fixed already,
   with a comment saying exactly why. The reversal was left on the bare claim.

   THE REJECTED PAYOUT (AMV-011). The status is written before the money moves,
   deliberately, and the note explaining it is right that the other order risks
   crediting and then leaving the record settleable again. What it misses is the
   cost of the order it chose: if the credit fails, the payout is terminally
   'rejected' and the seller's balance was never returned. The money was debited
   when they asked for it, and it is now neither in flight nor back. They are
   out of pocket, silently.

   Both orders have a bad failure, so the answer is neither order: the refund is
   claimed once and marked outstanding on the record until it lands, and a
   rejected payout that still owes money can be settled again to finish it.

   Every case here works by making the failure happen. A test that only checks
   the happy path cannot tell these two states apart, which is the entire
   reason they survived. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'claimfail.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _reverseSale, _refundRejectedPayout, _creditSale };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const SELLER = 'seller@example.com';
const BUYER = 'buyer@example.com';
const PW = 'A-real-Passw0rd!';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map(); const vals = new Map();
  const env = {
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admintok', APP_URL: 'https://amv.test',
    _vals: vals, _failWallet: false,
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) {
        if (env._failWallet && k.startsWith('wallet:')) throw new Error('storage down');
        m.set(k, v);
      },
      async delete(k) {
        if (env._failRevoke && k.startsWith('entitleitem:')) throw new Error('storage down');
        m.delete(k);
      },
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
        if (b.op === 'claim') {
          if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
          vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
  return env;
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '6.6.6.6',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const held = (env) => [...env._vals.keys()].filter(k => k.startsWith('c:'));
const wallet = (env, who) => JSON.parse(env.AMV_KV._map.get('wallet:' + (who || SELLER)) || '{}');

/* A completed sale, in the shape _reverseSale reads. */
function sold(env, ref) {
  env.AMV_KV._map.set(`saleref:${ref}`, JSON.stringify({
    itemId: 'usr_thing', buyer: BUYER, seller: SELLER, sellerShare: 32, price: 40, ref,
  }));
  env.AMV_KV._map.set(`entitleitem:${BUYER}:usr_thing`, '1');
  env.AMV_KV._map.set(`purchases:${BUYER}`, JSON.stringify([{ id: 'usr_thing', at: Date.now() }]));
  env.AMV_KV._map.set('wallet:' + SELLER, JSON.stringify({
    balance: 32, lifetime: 32, currency: 'usd', holds: [], paidOut: 0, payouts: [] }));
}

section('An ordinary reversal takes the item back and the money with it');
{
  const env = mkEnv();
  sold(env, 'ch_1');
  const r = await W._reverseSale(env, 'ch_1', 'dispute');
  ok(r && r.itemId === 'usr_thing', 'the sale is reversed', r && r.itemId);
  ok(!env.AMV_KV._map.get(`entitleitem:${BUYER}:usr_thing`), 'the buyer loses access', true);
  ok(wallet(env).balance === 0, 'and the seller loses the credit', wallet(env).balance);
}

section('Doing it twice does nothing the second time');
{
  /* The reason the claim exists at all: a refund and a dispute on one charge
     must not claw the money back twice. */
  const env = mkEnv();
  sold(env, 'ch_1');
  await W._reverseSale(env, 'ch_1', 'refund');
  const again = await W._reverseSale(env, 'ch_1', 'dispute');
  ok(again === null, 'the second attempt is refused', again);
  ok(wallet(env).balance === 0, 'and the seller is not debited twice', wallet(env).balance);
}

section('A reversal that FAILS gives its claim back');
{
  /* AMV-010. The failure is made to happen: the wallet cannot be written. What
     matters is not that this attempt failed - it is what the next one can do. */
  const env = mkEnv();
  sold(env, 'ch_2');
  env._failWallet = true;

  let threw = null;
  try { await W._reverseSale(env, 'ch_2', 'dispute'); } catch (e) { threw = e; }
  ok(threw != null, 'the reversal reports the failure rather than swallowing it', threw && threw.message);
  ok(held(env).length === 0, 'and holds no claim afterwards', held(env));

  /* The retry the provider is already going to send. */
  env._failWallet = false;
  const r = await W._reverseSale(env, 'ch_2', 'dispute');
  ok(r && r.itemId === 'usr_thing', 'so the retry completes the reversal', r && r.itemId);
  ok(wallet(env).balance === 0, 'and the money really does come back', wallet(env).balance);
}

section('A revocation that fails is a failure, not a success');
{
  /* The buyer keeping a charged-back item is the attack this exists to stop, so
     it cannot be caught and discarded. It used to be, which turned "AMV could
     not take it back" into "AMV took it back" - permanently, because the claim
     was already held. */
  const env = mkEnv();
  sold(env, 'ch_3');
  env._failRevoke = true;

  let threw = null;
  try { await W._reverseSale(env, 'ch_3', 'dispute'); } catch (e) { threw = e; }
  ok(threw != null, 'it fails rather than reporting a reversal that did not happen', threw && threw.message);
  ok(held(env).length === 0, 'the claim is released', held(env));
  ok(!!env.AMV_KV._map.get(`entitleitem:${BUYER}:usr_thing`),
     'and the buyer still has the item, which is the true state', true);

  env._failRevoke = false;
  await W._reverseSale(env, 'ch_3', 'dispute');
  ok(!env.AMV_KV._map.get(`entitleitem:${BUYER}:usr_thing`), 'until the retry takes it', true);
}

section('A rejected payout that could not be refunded says so');
{
  /* AMV-011. The seller's balance was debited when they asked. If the credit
     fails after the status is written, they are out of pocket with a terminally
     rejected payout and nothing anywhere saying money is owed. */
  const env = mkEnv();
  env.AMV_KV._map.set('wallet:' + SELLER, JSON.stringify({ balance: 0, holds: [], paidOut: 50, payouts: [] }));
  const rec = { id: 'wd_abc123', seller: SELLER, amount: 50, status: 'rejected', refundDue: 50 };

  env._failWallet = true;
  const first = await W._refundRejectedPayout(env, rec);
  ok(first === false, 'the refund reports that it did not land', first);
  ok(rec.refundDue === 50, 'and the record still says the seller is owed', rec.refundDue);
  ok(wallet(env).balance === 0, 'because the money is genuinely not back', wallet(env).balance);

  env._failWallet = false;
  const second = await W._refundRejectedPayout(env, rec);
  ok(second === true, 'a second attempt completes it', second);
  ok(rec.refundDue === undefined, 'and the record stops saying anything is owed', rec.refundDue);
  ok(wallet(env).balance === 50, 'the seller has their money', wallet(env).balance);
}

section('And completing it twice does not pay twice');
{
  /* The failure the original ordering was chosen to avoid. It still must not
     happen - a refund that can be repeated is money out of nothing. */
  const env = mkEnv();
  env.AMV_KV._map.set('wallet:' + SELLER, JSON.stringify({ balance: 0, holds: [], paidOut: 50, payouts: [] }));
  const rec = { id: 'wd_xyz789', seller: SELLER, amount: 50, status: 'rejected', refundDue: 50 };

  await W._refundRejectedPayout(env, rec);
  ok(wallet(env).balance === 50, 'the first one lands', wallet(env).balance);

  rec.refundDue = 50;                    // as if a stale record were settled again
  await W._refundRejectedPayout(env, rec);
  ok(wallet(env).balance === 50, 'and the second changes nothing', wallet(env).balance);
}

section('A rejection whose credit fails leaves the debt on the record');
{
  /* The finding end to end, through the real route rather than by handing the
     helper a record that already says money is owed. That shortcut is why the
     first version of this file passed with the marker deleted: it tested the
     recovery without testing that anything ever asks for it.

     A payout is requested, the store is made to fail, and an operator rejects
     it. The status is terminal and the money did not move - so the ONLY thing
     standing between the seller and a silent loss is the record saying so. */
  const env = mkEnv();
  env.AMV_KV._map.set('wallet:' + SELLER, JSON.stringify({
    balance: 0, holds: [], paidOut: 60, payouts: [{ at: Date.now(), amount: 60 }] }));
  env.AMV_KV._map.set('withdraw:wd_live001', JSON.stringify({
    id: 'wd_live001', seller: SELLER, amount: 60, status: 'pending', ts: Date.now() }));

  env._failWallet = true;
  const r = await post(env, '/admin/payouts/mark', { id: 'wd_live001', status: 'rejected' }, 'admintok');
  env._failWallet = false;

  const rec = JSON.parse(env.AMV_KV._map.get('withdraw:wd_live001'));
  ok(rec.status === 'rejected', 'the decision is recorded', rec.status);
  ok(wallet(env).balance === 0, 'and the money did NOT go back, because the store failed', wallet(env).balance);
  ok(+rec.refundDue === 60,
     'so the record carries what the seller is still owed, rather than reading as finished',
     rec.refundDue);

  /* And that debt is what makes the recovery reachable at all. */
  const fix = await post(env, '/admin/payouts/mark', { id: 'wd_live001', status: 'rejected' }, 'admintok');
  ok(fix.body.refundCompleted === true, 'settling it again completes the refund', fix.body);
  ok(wallet(env).balance === 60, 'and the seller is made whole', wallet(env).balance);
}

section('An operator can finish a stuck refund through the route');
{
  /* The recovery has to be reachable. A terminal state that refuses everything
     leaves the only fix as somebody editing storage by hand. */
  const env = mkEnv();
  env.AMV_KV._map.set('wallet:' + SELLER, JSON.stringify({ balance: 0, holds: [], paidOut: 50, payouts: [] }));
  env.AMV_KV._map.set('withdraw:wd_stuck01', JSON.stringify({
    id: 'wd_stuck01', seller: SELLER, amount: 50, status: 'rejected', refundDue: 50, ts: Date.now() }));

  const r = await post(env, '/admin/payouts/mark', { id: 'wd_stuck01', status: 'rejected' }, 'admintok');
  ok(r.body.ok === true, 'settling it again is accepted rather than refused as already settled', r.body);
  ok(r.body.refundCompleted === true, 'and it says the refund was completed', r.body.refundCompleted);
  ok(wallet(env).balance === 50, 'the seller has their money', wallet(env).balance);

  const rec = JSON.parse(env.AMV_KV._map.get('withdraw:wd_stuck01'));
  ok(rec.refundDue === undefined, 'and nothing is outstanding on the record', rec.refundDue);
}

section('A settled payout with nothing owed is still refused');
{
  /* The exception must be narrow. Reopening every terminal payout would be a
     second way to pay twice. */
  const env = mkEnv();
  env.AMV_KV._map.set('withdraw:wd_done001', JSON.stringify({
    id: 'wd_done001', seller: SELLER, amount: 50, status: 'paid', ts: Date.now() }));
  const r = await post(env, '/admin/payouts/mark', { id: 'wd_done001', status: 'rejected' }, 'admintok');
  ok(r.status === 409, 'a finished payout cannot be settled again', r.status);
  ok(r.body.code === 'already_settled', 'and says why', r.body.code);
}

section('Both claims are taken through the helper that releases them');
{
  /* The structural half, on the shape rather than the wording: a bare
     _claimOnce in front of work that can fail is the defect. */
  const rev = codeOnly(functionBody(src, '_reverseSale'));
  ok(/_onceOrRetry\(env, 'salerev'/.test(rev),
     'the reversal claims through the releasing helper', true);
  ok(!/_claimOnce\(env, 'salerev'/.test(rev),
     'and not through the bare claim it used to', true);

  const ref = codeOnly(functionBody(src, '_refundRejectedPayout'));
  ok(/_onceOrRetry\(env, 'porefund'/.test(ref), 'and so does the payout refund', true);

  /* The rejected payout records what it owes BEFORE the status is written, or a
     crash between them is the original defect again. */
  const mark = codeOnly(functionBody(src, 'adminPayoutMark'));
  const iDue = mark.indexOf('rec.refundDue =');
  const iPut = mark.indexOf('AMV_KV.put(`withdraw:', iDue);
  ok(iDue > -1 && iPut > iDue,
     'what is owed is recorded before the record is written', { due: iDue, write: iPut });
}

globalThis.fetch = realFetch;
if (report('a-claim-kept-after-a-failure-is-a-lie') > 0) process.exitCode = 1;
done();
