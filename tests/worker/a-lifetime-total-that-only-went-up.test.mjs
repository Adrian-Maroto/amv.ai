/* THE SELLER WAS CREDITED WITH MONEY AMV NEVER SENT.

   `wallet.paidOut` is added to when a payout is REQUESTED. Rejecting one gives
   the balance back - there is a careful comment about that, and a lock around
   it - and nothing ever took back the lifetime total. So it moved in one
   direction only, and every refused request left a permanent record of money
   that was never paid.

   It feeds exactly one decision: the point past which somebody has to verify
   their identity before more can be sent. An inflated figure therefore asks an
   honest seller for documents they do not owe yet, and the error ACCUMULATES -
   enough refused requests and a seller is stuck at a threshold they never
   reached, over payouts that never happened.

   The same file already states the correct rule eight lines further down: the
   tax total is recorded at SETTLEMENT, not at request, "because what is
   reportable is what was actually sent". Two totals about the same money, one
   following that rule and one not, in the same function.

   So the test is about the direction the number can move. A total of money sent
   must be able to go down, because payouts get refused. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'paidout.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _payoutRisk, PAYOUT_KYC_THRESHOLD_USD, PAYOUT_MIN_AGE_DAYS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const SELLER = 'seller@example.com';
const PW = 'A-real-Passw0rd!';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admintok', APP_URL: 'https://amv.test',
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
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') {
          if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
          vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '5.5.5.5',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };

/* An established seller with money on the books, built the way the payout test
   builds one so the risk score does not stop the request for other reasons. */
async function seller(env, balance) {
  const r = await call(env, '/auth/signup', { email: SELLER, name: 'S', password: PW });
  const tok = (await r.json()).token;
  const acct = JSON.parse(env.AMV_KV._map.get('acct:' + SELLER));
  acct.createdAt = Date.now() - 400 * 86400000;
  env.AMV_KV._map.set('acct:' + SELLER, JSON.stringify(acct));
  env.AMV_KV._map.set('consent:' + SELLER, JSON.stringify({ email: SELLER, birthYear: 1990, at: Date.now() }));
  env.AMV_KV._map.set('wallet:' + SELLER, JSON.stringify({
    balance, lifetime: balance, currency: 'usd', holds: [], paidOut: 0, payouts: [],
  }));
  env.AMV_KV._map.set('wallet_tx:' + SELLER, JSON.stringify(
    Array.from({ length: 6 }, (_, i) => ({ type: 'sale', buyer: 'b' + i + '@x.z', amount: 20, ts: Date.now() }))));
  return tok;
}
const wallet = (env) => JSON.parse(env.AMV_KV._map.get('wallet:' + SELLER) || '{}');
const withdraw = (env, tok) => post(env, '/v1/market/withdraw', { destination: 'paypal@seller.com' }, tok);
const settle = (env, id, status) => post(env, '/admin/payouts/mark', { id, status }, 'admintok');

section('Requesting a payout counts it, which is the conservative choice');
{
  /* Counting at request rather than at settlement is deliberate for the
     identity signal: money in flight is money that may be sent. The problem was
     never this line, it was that nothing undid it. */
  const env = mkEnv();
  const tok = await seller(env, 200);
  const r = await withdraw(env, tok);
  ok(r.body.ok === true, 'the payout is requested', r.body);
  ok(wallet(env).paidOut > 0, 'and the lifetime total moves', wallet(env).paidOut);
}

section('Rejecting it takes the money back AND the record of it');
{
  const env = mkEnv();
  const tok = await seller(env, 200);
  const before = wallet(env).balance;

  const r = await withdraw(env, tok);
  const amount = r.body.amount;
  ok(amount > 0, 'a real amount was requested', amount);
  ok(wallet(env).balance < before, 'the balance is debited while it is in flight', wallet(env).balance);

  const m = await settle(env, r.body.id, 'rejected');
  ok(m.body.ok === true, 'an operator rejects it', m.body);

  ok(Math.abs(wallet(env).balance - before) < 1e-9,
     'the money comes back, as it always did', { before, after: wallet(env).balance });

  /* The finding. */
  ok(wallet(env).paidOut === 0,
     'and the lifetime total goes back to what was really sent, which is nothing',
     wallet(env).paidOut);
}

section('Ten refused requests do not accumulate into a threshold');
{
  /* The reason a one-way total matters. Each refusal used to leave its amount
     behind for ever, so somebody who was never paid anything could be pushed
     past the identity line by their own rejected requests. */
  const env = mkEnv();
  const tok = await seller(env, 200);
  for (let i = 0; i < 10; i++) {
    const r = await withdraw(env, tok);
    if (!r.body.ok) break;
    await settle(env, r.body.id, 'rejected');
  }
  ok(wallet(env).paidOut === 0, 'nothing was sent, so nothing is recorded as sent', wallet(env).paidOut);
  ok(Math.abs(wallet(env).balance - 200) < 1e-9, 'and the balance is whole', wallet(env).balance);
}

section('A payout that IS paid still counts, permanently');
{
  /* The correction must not be a way to erase real payouts, or the identity
     threshold could be walked around by having payouts approved and then
     re-marked. */
  const env = mkEnv();
  const tok = await seller(env, 200);
  const r = await withdraw(env, tok);
  await settle(env, r.body.id, 'paid');
  ok(wallet(env).paidOut > 0, 'a payout that was sent stays on the lifetime total', wallet(env).paidOut);
  ok(Math.abs(wallet(env).paidOut - r.body.amount) < 1e-9, 'at the amount sent', wallet(env).paidOut);
}

section('The identity threshold reads a true figure');
{
  /* What the number is FOR. With the old behaviour a seller who had been paid
     nothing but had requested and been refused a large amount would be scored
     as though they were near the line. */
  const env = mkEnv();
  const w = { balance: 100, payouts: [], paidOut: 0 };
  const big = W.PAYOUT_KYC_THRESHOLD_USD;
  env.AMV_KV._map.set('acct:' + SELLER, JSON.stringify({ email: SELLER, createdAt: Date.now() - 400 * 86400000 }));

  const clean = await W._payoutRisk(env, SELLER, 10, w);
  ok(!clean.reasons.some(r => /identity has not been verified/.test(r)),
     'a seller who has been paid nothing is not asked for identity over a small payout', clean.reasons);

  const inflated = await W._payoutRisk(env, SELLER, 10, { balance: 100, payouts: [], paidOut: big });
  ok(inflated.reasons.some(r => /identity has not been verified/.test(r)),
     'and one whose real lifetime total is past the line is', inflated.reasons);
}

section('The correction happens under the wallet lock, with the refund');
{
  /* Two facts about one event. Written separately they can disagree - a crash
     between them leaves the balance restored and the total still inflated, or
     the reverse - and a second unlocked write to the wallet is the exact defect
     the comment above this block was added for. */
  /* The rejection now goes through a named helper rather than sitting inline,
     because the refund had to become idempotent and separately recoverable
     (AMV-011). The property is unchanged - one lock, both corrections - so this
     follows it there rather than asserting the shape it used to have. */
  const branch = codeOnly(functionBody(src, '_refundRejectedPayout'));
  ok(branch.length > 400, 'the refund helper was read', branch.length);
  ok(/_onceOrRetry\(env, 'porefund'/.test(branch),
     'and the refund is claimed once, so completing it twice is impossible', true);

  const lockIdx = branch.indexOf('_withWallet(');
  const balIdx = branch.indexOf('ww.balance');
  const paidIdx = branch.indexOf('ww.paidOut');
  ok(lockIdx > -1 && balIdx > lockIdx && paidIdx > lockIdx,
     'both corrections happen inside the same _withWallet', { lockIdx, balIdx, paidIdx });
  ok((branch.match(/_withWallet\(/g) || []).length === 1,
     'and there is exactly one wallet mutation, not two that can disagree',
     (branch.match(/_withWallet\(/g) || []).length);

  /* Floored, because a total of money sent cannot be negative whatever order
     historical records arrive in. */
  ok(/Math\.max\(0,/.test(branch), 'the total cannot be driven below zero', true);
}

globalThis.fetch = realFetch;
if (report('a-lifetime-total-that-only-went-up') > 0) process.exitCode = 1;
done();
