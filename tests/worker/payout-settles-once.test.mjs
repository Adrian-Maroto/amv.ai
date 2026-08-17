/* REJECTING A PAYOUT TWICE PAID IT BACK TWICE.

   Settling a payout is the last step of the only path that moves real money out
   of AMV. Marking one `rejected` CREDITS the seller's wallet, because the
   balance was debited when they asked to withdraw and a payout that will never
   be sent has to come back.

   The guard against doing that twice was:

       const raw = await KV.get(`withdraw:${id}`)
       if (rec.status !== 'pending') return 409

   which is a read, then a decision, then a write. Two requests both read
   'pending', both pass, both write the status, and both add the amount back.
   One rejected payout, credited twice, out of nothing - and the seller can
   withdraw the invented money immediately.

   It needed no attacker. The founder dashboard left both buttons live for the
   whole round trip, so an operator double-clicking Reject was the ordinary way
   to produce it. marketWithdraw - the function directly above this one - has
   taken a lock for exactly this reason since it was written; the settle side of
   the same money had nothing.

   Now: claimed atomically, re-read inside the lock, released in a finally. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'payout.harness.mjs');
writeFileSync(harness, src + `
export { adminPayoutMark, adminPayouts, marketWithdraw, _wallet, _saveWallet, _claimOnce };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

/* Jittered, not uniform. With every hop taking exactly the same time, ten
   concurrent callers all read before any of them writes, so a lost update
   lands on ONE credit by luck and the balance looks correct even with the lock
   removed. Real hops vary, and it only takes one caller reading after another
   has written to credit the money twice. */
const tick = () => new Promise(r => setTimeout(r, Math.random() < 0.5 ? 0 : 2));
let store, claims;
/* A counter that actually serializes `claim`, which is what the Durable Object
   does in production. Without this the test would prove nothing about the
   lock - it would just be measuring the KV fallback. */
function makeEnv() {
  store = new Map();
  claims = new Map();
  return {
    ADMIN_TOKEN: 'admin-secret-token-value',
    /* Every read and write yields before it resolves.
       A store that answers in the same microtask lets a read-modify-write run
       to completion before the next caller starts, so concurrent requests
       serialize by accident and the balance comes out right even with the lock
       removed - the test would then be asserting nothing about the money. Real
       KV is a network hop. This makes the interleaving real. */
    AMV_KV: {
      async get(k) { await tick(); return store.has(k) ? store.get(k) : null; },
      async put(k, v) { await tick(); store.set(k, String(v)); },
      async delete(k) { await tick(); store.delete(k); },
      async list({ prefix, limit }) {
        await tick();
        return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({
        async fetch(_u, init) {
          const b = JSON.parse(init.body);
          const name = b.name || n;
          if (b.op === 'claim') {
            if (claims.has(name)) return new Response(JSON.stringify({ claimed: false }));
            claims.set(name, 1);
            return new Response(JSON.stringify({ claimed: true }));
          }
          if (b.op === 'release') { claims.delete(name); return new Response(JSON.stringify({ ok: true })); }
          return new Response(JSON.stringify({ value: 0, allowed: true }));
        },
      }),
    },
  };
}

const markReq = (id, status) => new Request('https://api.amv.dev/admin/payouts/mark', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-secret-token-value' },
  body: JSON.stringify({ id, status }),
});

const seedPayout = async (env, { id = 'wd_abcd1234', seller = 'sel@x.com', amount = 40 } = {}) => {
  store.set(`withdraw:${id}`, JSON.stringify({ id, seller, amount, destination: 'paypal:sel@x.com',
                                               status: 'pending', ts: Date.now() }));
  store.set(`wallet:${seller}`, JSON.stringify({ balance: 0, lifetime: 120, tx: [] }));
  return { id, seller, amount };
};
const balanceOf = (seller) => { try { return JSON.parse(store.get(`wallet:${seller}`)).balance; } catch (e) { return null; } };

let env = makeEnv();
W.__setRequireUser(async () => ({ email: 'op@x.com', plan: 'ultra' }));

section('A single rejection returns the money exactly once');
{
  env = makeEnv();
  const p = await seedPayout(env);
  const r = await W.adminPayoutMark(markReq(p.id, 'rejected'), env);
  const d = await r.json();
  ok(d.ok === true, 'the rejection is accepted', d);
  ok(balanceOf(p.seller) === 40, 'and $40 is back with the seller', balanceOf(p.seller));
}

section('Two at the same time still only return it once');
{
  /* The defect, driven the way it actually happened: two requests in flight
     together, which is what a double-click produces. */
  env = makeEnv();
  const p = await seedPayout(env);
  const [a, b] = await Promise.all([
    W.adminPayoutMark(markReq(p.id, 'rejected'), env),
    W.adminPayoutMark(markReq(p.id, 'rejected'), env),
  ]);
  const [da, db] = [await a.json(), await b.json()];
  const wins = [da, db].filter(x => x.ok === true).length;
  ok(wins === 1, 'exactly one of them settles it', { da, db });
  /* Correctness of the fixed path. It is NOT the assertion that catches the
     regression: with only two callers a lost update often still lands on one
     credit by luck of ordering. The winner count above is what discriminates,
     and the ten-way case below is where the money itself does. */
  ok(balanceOf(p.seller) === 40,
     'and the seller is credited once', balanceOf(p.seller));
  const loser = [da, db].find(x => !x.ok);
  ok(loser && /already|in_progress/.test(loser.code || ''),
     'the other is told why, rather than silently ignored', loser);
}

section('Ten at once is still forty dollars');
{
  /* A lock that only holds for two is not a lock. */
  env = makeEnv();
  const p = await seedPayout(env);
  const rs = await Promise.all(Array.from({ length: 10 }, () => W.adminPayoutMark(markReq(p.id, 'rejected'), env)));
  const ds = await Promise.all(rs.map(r => r.json()));
  ok(ds.filter(x => x.ok === true).length === 1, 'one winner out of ten', ds.filter(x => x.ok).length);
  /* This one does catch it. Ten jittered callers reliably produce a straddle -
     somebody reads the balance after somebody else has written it - so without
     the lock the seller is credited $80, $120 or more out of nothing. */
  ok(balanceOf(p.seller) === 40, 'and $40 was credited, not a multiple of it', balanceOf(p.seller));
}

section('Marking paid does not credit anything');
{
  env = makeEnv();
  const p = await seedPayout(env);
  const r = await W.adminPayoutMark(markReq(p.id, 'paid'), env);
  const d = await r.json();
  ok(d.ok === true && d.status === 'paid', 'it settles', d);
  ok(balanceOf(p.seller) === 0,
     'and the money stays gone, because it was really sent', balanceOf(p.seller));
}

section('A settled payout cannot be settled again later');
{
  /* The sequential case the original check did handle, which must keep working. */
  env = makeEnv();
  const p = await seedPayout(env);
  await W.adminPayoutMark(markReq(p.id, 'rejected'), env);
  const r2 = await W.adminPayoutMark(markReq(p.id, 'rejected'), env);
  const d2 = await r2.json();
  ok(!d2.ok && d2.code === 'already_settled', 'the second attempt is refused', d2);
  ok(balanceOf(p.seller) === 40, 'with the balance untouched', balanceOf(p.seller));
}

section('The lock is released, so the next payout is settleable');
{
  /* Held after the request finished, one stuck payout would freeze every other
     one behind it. */
  env = makeEnv();
  const p1 = await seedPayout(env, { id: 'wd_aaaa1111', seller: 'a@x.com', amount: 10 });
  const p2 = await seedPayout(env, { id: 'wd_bbbb2222', seller: 'b@x.com', amount: 25 });
  await W.adminPayoutMark(markReq(p1.id, 'rejected'), env);
  const r = await W.adminPayoutMark(markReq(p2.id, 'rejected'), env);
  const d = await r.json();
  ok(d.ok === true, 'a different payout settles straight after', d);
  ok(balanceOf('a@x.com') === 10 && balanceOf('b@x.com') === 25, 'both sellers got theirs', {
    a: balanceOf('a@x.com'), b: balanceOf('b@x.com') });
  /* A LOCK and a ONCE-CLAIM are different things and only one of them is
     released.

     `polock` serialises settlements of a payout and must be given back, or the
     next operator action on it hangs for the length of the TTL. `porefund` is
     the opposite: it is what makes the refund impossible to complete twice
     (AMV-011), so it is kept deliberately and for ever. Asserting that no claim
     survives at all would be demanding the idempotency be thrown away, which is
     how a correct guard gets deleted to make a test pass. */
  const locks = [...claims.keys()].filter(k => /polock/.test(k));
  ok(locks.length === 0, 'and no lock was left held', locks);
  const once = [...claims.keys()].filter(k => /porefund/.test(k));
  ok(once.length === 2,
     'while each refund keeps its once-claim, so it can never be paid twice', once);
}

section('The status is written before the money moves');
{
  /* If the credit fails, "settled and not paid" is recoverable by hand and
     "paid twice" is not. The safe order is asserted, not assumed. */
  const fn = String(W.adminPayoutMark);
  const putAt = fn.indexOf('withdraw:${id}`, JSON.stringify(rec)');
  /* ANCHORED ON THE OPERATION, NOT ON ONE SPELLING OF IT.

     This looked for `_saveWallet`, which was how the refund reached storage
     until the refund was moved under the wallet lock - and then this check
     could not find the credit at all and failed on correct code. The same
     brittleness is what let the unlocked write exist in the first place: the
     lock sweep was also looking for a particular spelling. So: any of the ways
     this function can put money back into a balance. */
  const creditAt = Math.min(...['_saveWallet', '_withWallet']
    .map(n => fn.indexOf(n)).filter(i => i >= 0).concat([Infinity]));
  ok(putAt > 0 && creditAt < Infinity, 'both steps were located', { putAt, creditAt });
  ok(putAt < creditAt, 'the record is settled first', { putAt, creditAt });
}

section('Only an admin can settle one at all');
{
  env = makeEnv();
  const p = await seedPayout(env);
  const bad = new Request('https://api.amv.dev/admin/payouts/mark', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-the-token' },
    body: JSON.stringify({ id: p.id, status: 'rejected' }),
  });
  const r = await W.adminPayoutMark(bad, env);
  ok(r.status === 403, 'a wrong token is refused', r.status);
  ok(balanceOf(p.seller) === 0, 'and nothing moved', balanceOf(p.seller));
}

if (report('payout-settles-once') > 0) process.exitCode = 1;
done();
