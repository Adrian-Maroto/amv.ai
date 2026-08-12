/* THE ONE WALLET WRITE THAT DID NOT TAKE THE WALLET LOCK.

   Every change to somebody's balance in this product goes through _withWallet,
   which serialises them - that is the whole answer to two money writes landing
   at once, and it took several defects to arrive at.

   Rejecting a payout did not. It read the wallet, added the refunded amount and
   wrote the WHOLE record back raw:

       const w = await _wallet(env, rec.seller);
       w.balance = w.balance + rec.amount;
       await _saveWallet(env, rec.seller, w);

   `polock` serialises settlements of that payout and says nothing about the
   wallet, so a sale credit or another withdrawal landing in between was simply
   overwritten - and not only the balance. The object written back is the one
   read before those changes happened, so it carries their holds, their
   pendingOut and their payout history away with it.

   Both directions cost somebody money. The refund losing to a sale drops the
   refund; the refund winning drops the sale, and puts back a stale balance on
   top - money the seller may already have withdrawn.

   The check that exists to find exactly this could not see it, for TWO reasons
   at once, and both are the same reason: it recognised things by how they were
   spelled. It looked for `DB.put(env, 'kind'`, and the wallet is written by a
   named helper. And it built its list of locked kinds from `_withX(env, 'kind'`,
   while _withWallet takes an email - so `wallet` was never even on the list of
   records that have a lock. The rule the whole file rests on had never once
   applied to the record holding people's money. Both are now derived from the
   source instead, and a-lock-nobody-takes-is-not-a-lock asserts it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'refundlock.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, _wallet, _saveWallet, _withWallet, _creditSale, adminPayoutMark, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

section('Only the lock helper writes a wallet');
{
  /* _saveWallet is how a wallet reaches storage. Exactly one thing may call it:
     the lock. Anything else is a writer that can be raced. */
  const code = codeOnly(src);
  const callers = [];
  const decls = [...code.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
    .map(m => ({ name: m[1], at: m.index }));
  for (const m of code.matchAll(/\b_saveWallet\(/g)) {
    let owner = '';
    for (const d of decls) { if (d.at <= m.index) owner = d.name; else break; }
    if (owner && owner !== '_saveWallet') callers.push(owner);
  }
  const outside = [...new Set(callers)].filter(n => n !== '_withWallet');
  ok(outside.length === 0,
     'nothing writes a wallet except the helper that holds the lock while it does', outside);
}

let ORDER = [];
function mkEnv() {
  const m = new Map(), vals = new Map(), claims = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    _map: m,
    AMV_KV: {
      /* Every read and write yields, so two concurrent money paths really do
         interleave rather than each running to completion. Without that this
         file would pass on unlocked code and prove nothing. */
      async get(k) { await new Promise(r => setTimeout(r, 1)); return m.has(k) ? m.get(k) : null; },
      async put(k, v) {
        await new Promise(r => setTimeout(r, 1));
        if (k.startsWith('wallet:')) ORDER.push('write ' + JSON.parse(v).balance);
        m.set(k, v);
      },
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
const settle = (env, id, status) => W.adminPayoutMark(new Request('https://api/v1/admin/payouts/settle', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret', 'CF-Connecting-IP': '4.4.4.4' },
  body: JSON.stringify({ id, status }),
}), env);

section('A rejected payout and a sale landing together both survive');
{
  const env = mkEnv();
  ORDER = [];
  /* The seller withdrew everything, so the balance is empty and $100 is out in
     a payout an operator is about to reject. */
  await W._saveWallet(env, SELLER, { balance: 0, lifetime: 100, holds: [], payouts: [], paidOut: 100 });
  await env.AMV_KV.put(`withdraw:wd_reject01`, JSON.stringify({
    id: 'wd_reject01', seller: SELLER, amount: 100, destination: 'paypal@test.com', status: 'approved', ts: Date.now(),
  }));
  await W.DB.put(env, 'market', 'usr_x', { id: 'usr_x', title: 'X', kind: 'prompt', price: 20, authorEmail: SELLER, status: 'active' });

  /* At the same moment: the operator rejects the payout, and a buyer's purchase
     credits the seller. Two money writes, one wallet. */
  const [rej] = await Promise.all([
    settle(env, 'wd_reject01', 'rejected'),
    W._creditSale(env, { itemId: 'usr_x', buyer: 'buyer@test.com', seller: SELLER, amountCents: 2000, ref: 'ch_r' }),
  ]);
  ok(rej.status === 200, 'the rejection is accepted', rej.status);

  const w = await W._wallet(env, SELLER);
  /* $100 returned by the rejection, plus the seller's 80% of a $20 sale. */
  ok(w.balance === 116,
     'the balance carries BOTH the refund and the sale, not whichever wrote last',
     { balance: w.balance, writes: ORDER });
  ok((w.holds || []).length > 0,
     'and the sale’s hold survived, rather than being written away with a stale record',
     (w.holds || []).length);
}

section('The refund is still refunded when nothing else is happening');
{
  const env = mkEnv();
  await W._saveWallet(env, SELLER, { balance: 5, lifetime: 105, holds: [], payouts: [], paidOut: 100 });
  await env.AMV_KV.put(`withdraw:wd_quiet01`, JSON.stringify({
    id: 'wd_quiet01', seller: SELLER, amount: 50, destination: 'paypal@test.com', status: 'pending', ts: Date.now(),
  }));
  const r = await settle(env, 'wd_quiet01', 'rejected');
  ok(r.status === 200, 'the operator can reject a payout', r.status);
  const w = await W._wallet(env, SELLER);
  ok(w.balance === 55, 'and the money goes back to the seller', w.balance);
  const rec = JSON.parse(await env.AMV_KV.get('withdraw:wd_quiet01'));
  ok(rec.status === 'rejected', 'with the payout marked rejected', rec.status);
}

section('And a payout marked paid still does not put money back');
{
  const env = mkEnv();
  await W._saveWallet(env, SELLER, { balance: 0, lifetime: 100, holds: [], payouts: [], paidOut: 0 });
  await env.AMV_KV.put(`withdraw:wd_paid0001`, JSON.stringify({
    id: 'wd_paid0001', seller: SELLER, amount: 100, destination: 'paypal@test.com', status: 'approved', ts: Date.now(),
  }));
  const r = await settle(env, 'wd_paid0001', 'paid');
  ok(r.status === 200, 'it can be marked paid', r.status);
  const w = await W._wallet(env, SELLER);
  ok(w.balance === 0, 'and the money stays gone, because it was actually sent', w.balance);
}

if (report('a-refund-that-skipped-the-wallet-lock') > 0) process.exitCode = 1;
done();
