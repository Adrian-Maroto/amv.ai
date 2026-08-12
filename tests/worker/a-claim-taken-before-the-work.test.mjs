/* MAKING THE GUARD PERMANENT MOVED THE FAILURE, IT DID NOT REMOVE IT.

   The previous change made the exactly-once claims durable, because a
   thirty-second one let a duplicate webhook pay a seller twice. That is right,
   and it has a cost that has to be paid deliberately rather than discovered:

     the claim is taken BEFORE the work.

   So if the work then fails halfway - storage refusing, a record lock
   unavailable, a counter unreachable - the retry arrives, finds the claim
   held, and concludes the job is done. Not "paid twice" any more. Never paid,
   for ever, with the buyer already holding the item.

   The thirty-second expiry had been covering for that BY ACCIDENT. It is the
   uncomfortable kind of bug fix: the thing that was wrong was also, silently,
   the thing that made a second wrong thing survivable. Fixing one without the
   other trades a visible fault for an invisible one, which is the wrong
   direction - a seller paid twice notices and writes in, a seller never paid
   for a sale that shows as complete has nothing to point at.

   The webhook handler one layer up already had this right: it releases the
   event claim in its catch so the provider's retry can reprocess a genuinely
   failed event. Three places did not.

     sale         a credit that threw left the buyer owning the item and the
                  seller unpaid, permanently, with the reconcile sweep - which
                  exists precisely to finish an unfinished sale - refusing to
                  run because the claim said it was finished.
     vidrefund    a refund whose counter write failed never happened, and never
                  would: the next poll saw the claim and stopped.
     inviteused   every exit that is not a join burned a one-time invitation.
                  One of those exits is the team record being momentarily busy,
                  which resolves in about a second. Somebody clicks their
                  invitation, is told to try again, and finds it already used. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'claimwork.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, _claimOnce, _releaseClaim, _onceOrRetry, _creditSale, _wallet, teamJoin, CLAIM_ONCE_TTL_S, signToken };\n');
const W = await import(harness + '?t=' + Date.now());

section('There is one helper for "claim, work, give it back if the work failed"');
{
  const body = codeOnly(functionBody(src, '_onceOrRetry'));
  ok(/_claimOnce\(/.test(body), 'it takes the claim', true);
  ok(/_releaseClaim\(/.test(body), 'and releases it when the work throws', true);
  const rIdx = body.indexOf('_releaseClaim'), tIdx = body.indexOf('throw');
  ok(rIdx > 0 && tIdx > rIdx,
     'then rethrows, so nobody reports success for work that did not happen', { rIdx, tIdx });
}

/* Storage that can be told to fail one specific write, and a claim store with a
   real expiry so "permanent" and "thirty seconds" are distinguishable. */
let NOW = Date.parse('2026-04-01T09:00:00Z');
const advance = (ms) => { NOW += ms; };
let FAIL = null;                       // substring of a key whose write should throw

function mkEnv() {
  const m = new Map(), vals = new Map(), claims = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', APP_URL: 'https://amv.test',
    _map: m, _vals: vals, _claims: claims,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) {
        if (FAIL && k.includes(FAIL)) throw new Error('storage refused ' + k);
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
          if (held && held > NOW) return new Response(JSON.stringify({ claimed: false, until: held }));
          claims.set(x, NOW + Math.max(1000, Number(b.ttlMs) || 30000));
          return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { claims.delete(x); return new Response(JSON.stringify({ released: true })); }
        if (b.op === 'incr') {
          if (FAIL && x.includes(FAIL)) throw new Error('counter refused ' + x);
          vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) }));
        }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}

section('A sale that fails halfway can be finished by the retry');
{
  const env = mkEnv();
  const SELLER = 'seller@test.com', BUYER = 'buyer@test.com', ITEM = 'usr_broken';
  await W.DB.put(env, 'market', ITEM, { id: ITEM, title: 'A thing', kind: 'prompt', price: 40, authorEmail: SELLER, status: 'active' });

  /* The wallet write is the one that matters: the buyer has already been
     granted the item by the time it runs, so a failure here is precisely
     "buyer holds it, seller unpaid". */
  FAIL = 'wallet:' + SELLER;
  let threw = null;
  try { await W._creditSale(env, { itemId: ITEM, buyer: BUYER, seller: SELLER, amountCents: 4000, ref: 'ch_x' }); }
  catch (e) { threw = e; }
  FAIL = null;

  ok(!!threw, 'the credit fails, loudly rather than quietly', threw && String(threw.message).slice(0, 60));
  const mid = await W._wallet(env, SELLER);
  ok(!(mid.balance > 0), 'and the seller has not been paid yet', mid.balance);

  /* Stripe retries, or the reconcile sweep runs. Either way this is the second
     attempt, and it is the one that used to find the claim held and give up. */
  advance(10 * 60 * 1000);
  await W._creditSale(env, { itemId: ITEM, buyer: BUYER, seller: SELLER, amountCents: 4000, ref: 'ch_x' });
  const after = await W._wallet(env, SELLER);
  ok(after.balance > 0, 'the retry finishes the sale and the seller is paid', after.balance);

  /* And still only once - the release must not have turned this back into the
     double-credit it was written to prevent. */
  advance(10 * 60 * 1000);
  await W._creditSale(env, { itemId: ITEM, buyer: BUYER, seller: SELLER, amountCents: 4000, ref: 'ch_x' });
  const third = await W._wallet(env, SELLER);
  ok(third.balance === after.balance,
     'and a third delivery still does not pay again', { after: after.balance, third: third.balance });
  ok((third.holds || []).length === (after.holds || []).length,
     'nor place another hold on money earned once', (third.holds || []).length);

  /* THE OTHER HALF, AND THE ONE THAT ONLY SHOWS UP ONCE RETRIES ARE ALLOWED.

     Letting the retry run means the steps that already succeeded run AGAIN.
     Puts do not care. Appends and counters do, and every one of them below was
     an append or a counter: this is what "at least once" costs if the work is
     not idempotent, and it is why the release above is only half a fix. */
  const raw = await env.AMV_KV.get('purchases:' + BUYER);
  const list = JSON.parse(raw || '[]');
  ok(list.length === 1, 'and the buyer bought it exactly once', list.length);

  const txRaw = await env.AMV_KV.get('wallet_tx:' + SELLER);
  const txs = JSON.parse(txRaw || '[]').filter((t) => t && t.item === ITEM);
  ok(txs.length === 1, 'the seller’s history shows one sale, not three', txs.length);

  const listing = await W.DB.get(env, 'market', ITEM);
  ok(listing.sales === 1, 'and the listing counted one sale', listing.sales);
  ok(listing.installs === 1, 'and one install', listing.installs);
}

section('And a sale that fails AFTER the money moved does not pay twice');
{
  /* The case above fails at the wallet, so the retry finds nothing credited and
     the guard inside the lock is never asked anything - which is why removing
     that guard did not fail this file until this section existed. The dangerous
     retry is the other one: the credit SUCCEEDED and a later step threw, so the
     work runs again with the money already paid. */
  const env = mkEnv();
  const SELLER = 'late@test.com', BUYER = 'lateb@test.com', ITEM = 'usr_late';
  await W.DB.put(env, 'market', ITEM, { id: ITEM, title: 'Late', kind: 'prompt', price: 30, authorEmail: SELLER, status: 'active' });

  /* The seller's history is written straight after the credit, so failing it
     puts the fault exactly where the money is already gone. */
  FAIL = 'wallet_tx:' + SELLER;
  let threw = null;
  try { await W._creditSale(env, { itemId: ITEM, buyer: BUYER, seller: SELLER, amountCents: 3000, ref: 'ch_late' }); }
  catch (e) { threw = e; }
  FAIL = null;
  ok(!!threw, 'the sale fails after the credit', threw && String(threw.message).slice(0, 50));

  const paidOnce = await W._wallet(env, SELLER);
  ok(paidOnce.balance > 0, 'the seller has been paid', paidOnce.balance);

  advance(10 * 60 * 1000);
  await W._creditSale(env, { itemId: ITEM, buyer: BUYER, seller: SELLER, amountCents: 3000, ref: 'ch_late' });
  const paidTwice = await W._wallet(env, SELLER);

  ok(paidTwice.balance === paidOnce.balance,
     'and the retry that finishes the rest does NOT pay again',
     { once: paidOnce.balance, twice: paidTwice.balance });
  ok((paidTwice.holds || []).length === (paidOnce.holds || []).length,
     'nor place a second hold for one sale', (paidTwice.holds || []).length);

  const txs = JSON.parse(await env.AMV_KV.get('wallet_tx:' + SELLER) || '[]').filter((t) => t && t.item === ITEM);
  ok(txs.length === 1, 'the history line the first pass could not write is written once', txs.length);

  const listing = await W.DB.get(env, 'market', ITEM);
  ok(listing.sales === 1, 'and the listing still counted one sale, not two', listing.sales);
}

section('A sale that fails at the very last step finishes that step, and only that step');
{
  /* The third position, and the one that decides the SHAPE of the fix. Here
     the credit and the seller's history line both succeeded and the listing
     write failed. The retry has to skip two things and do one - and an earlier
     version of this keyed the remaining work off "was the credit new", which
     meant a resumed sale skipped exactly the step it still owed. A retry that
     cannot finish the job is not a retry. */
  const env = mkEnv();
  const SELLER = 'last@test.com', BUYER = 'lastb@test.com', ITEM = 'usr_last';
  await W.DB.put(env, 'market', ITEM, { id: ITEM, title: 'Last', kind: 'prompt', price: 25, authorEmail: SELLER, status: 'active' });

  FAIL = 'market:' + ITEM;
  let threw = null;
  try { await W._creditSale(env, { itemId: ITEM, buyer: BUYER, seller: SELLER, amountCents: 2500, ref: 'ch_last' }); }
  catch (e) { threw = e; }
  FAIL = null;
  ok(!!threw, 'the sale fails on the listing write', threw && String(threw.message).slice(0, 50));

  const before = await W._wallet(env, SELLER);
  const listingBefore = await W.DB.get(env, 'market', ITEM);
  ok(!(listingBefore.sales > 0), 'so the listing has not counted it', listingBefore.sales);

  advance(10 * 60 * 1000);
  await W._creditSale(env, { itemId: ITEM, buyer: BUYER, seller: SELLER, amountCents: 2500, ref: 'ch_last' });

  const after = await W._wallet(env, SELLER);
  ok(after.balance === before.balance, 'the retry does not pay again', { before: before.balance, after: after.balance });
  const txs = JSON.parse(await env.AMV_KV.get('wallet_tx:' + SELLER) || '[]').filter((t) => t && t.item === ITEM);
  ok(txs.length === 1, 'nor write the history line again', txs.length);

  const listing = await W.DB.get(env, 'market', ITEM);
  ok(listing.sales === 1, 'and DOES finish the step that failed', listing.sales);
  ok(listing.status === 'sold', 'so a one-of-a-kind listing really does leave the catalogue', listing.status);

  const log = JSON.parse(await env.AMV_KV.get('txn:log') || '[]').filter((t) => t && t.ref === ITEM);
  ok(log.length === 1, 'and the platform fee is on the books exactly once', log.length);
}

section('A refund whose write fails is refunded by the next poll');
{
  const env = mkEnv();
  FAIL = 'vid:someone@test.com';
  const first = await W._claimOnce(env, 'vidrefund', 'vid_9', W.CLAIM_ONCE_TTL_S);
  ok(first === true, 'the first attempt claims the refund', first);
  /* What the handler does on a failed counter write. */
  try { throw new Error('counter refused'); } catch (e) { await W._releaseClaim(env, 'vidrefund', 'vid_9'); }
  FAIL = null;
  advance(60 * 1000);
  ok(await W._claimOnce(env, 'vidrefund', 'vid_9', W.CLAIM_ONCE_TTL_S) === true,
     'and because it gave the claim back, the next poll can actually refund', true);
  ok(await W._claimOnce(env, 'vidrefund', 'vid_9', W.CLAIM_ONCE_TTL_S) === false,
     'after which it is spent for good', true);
}

section('The handler really does release it, not just the test');
{
  /* The section above proves the mechanism. This proves the CODE uses it -
     without this, the assertion above is a statement about _releaseClaim and
     nothing at all about the video path. */
  const vid = codeOnly(functionBody(src, 'videoStatus') || '');
  const where = vid.indexOf("'vidrefund'");
  ok(where > 0, 'the video path claims its refund', where);
  ok(/_releaseClaim\(env, 'vidrefund'/.test(vid),
     'and gives the claim back when the refund does not happen', true);
}

section('An invitation is spent only if somebody actually joined');
{
  const src2 = codeOnly(functionBody(src, 'teamJoin') || functionBody(src, 'teamAccept') || '');
  ok(/_releaseClaim\(env, 'inviteused'/.test(src2) || /_unspend\(\)/.test(src2),
     'the redemption gives the claim back when nobody joined', true);
  /* Named individually, because the general statement above is satisfied by
     releasing on ONE path, and the transient one is the reason this matters:
     the team record being briefly busy must not consume somebody's invite. */
  const busy = src2.indexOf('_busyJson');
  ok(busy > 0 && /_unspend\(\)/.test(src2.slice(Math.max(0, busy - 120), busy)),
     'including when the team record was momentarily busy - which resolves in a second', true);
  const seat = src2.indexOf('joined.error');
  ok(seat > 0 && /_unspend\(\)/.test(src2.slice(seat, seat + 120)),
     'and when the team turned out to have no free seat', true);
}

section('Nothing here loosened the guard it was built on');
{
  const code = codeOnly(src).replace(/\s+/g, ' ');
  ok(/_onceOrRetry\(env, 'sale'/.test(code),
     'the sale still goes through a claim, not around one', true);
  ok(W.CLAIM_ONCE_TTL_S >= 30 * 86400,
     'and that claim is still permanent rather than a lease', W.CLAIM_ONCE_TTL_S);
}

if (report('a-claim-taken-before-the-work') > 0) process.exitCode = 1;
done();
