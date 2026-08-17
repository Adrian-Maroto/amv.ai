/* THE SECOND CLICK TOOK A SECOND CARD PAYMENT AND GRANTED NOTHING.

   Two defects at the same door, and both end with somebody charged for
   something they do not get.

   THE DUPLICATE. Every call to the buy route created a fresh payment session.
   Two clicks on a slow connection, a double-submit, a back button and a retry -
   any of them produced two live sessions for the same item, and both of them
   take a card. The credit is exactly-once per buyer and item, so the second
   payment grants nothing, which is WORSE than granting twice: the buyer is
   charged for a thing they already own and nothing anywhere notices, because
   from the inside the duplicate credit was correctly refused. The safety
   mechanism is what makes the loss silent.

   THE OVERSELL. A one-of-a-kind listing is checked for 'sold' and then acted
   on. Two buyers arriving together both read a status that has not changed yet,
   both are sent to checkout, and both pay. One gets the item. The other finds
   out by not receiving it.

   Both are a read followed by a decision with a gap in the middle, which is the
   same shape as the dollar ceilings and the wash-trading signal. The fix has to
   be atomic in both cases: a remembered session handed back rather than a
   second one created, and a reservation taken through the counter that
   serialises rather than written to storage after a read.

   These run concurrently on purpose. Neither defect is visible in a single
   request, which is exactly why they were there. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'mktbuy.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, MARKET_RESERVE_S, MARKET_SESSION_TTL_S };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const SELLER = 'seller@example.com';
const A = 'ann@example.com';
const B = 'ben@example.com';
const PW = 'A-real-Passw0rd!';
const ITEM = 'usr_oneofakind00';

/* Every Stripe session Stripe was asked to create. The count is the finding:
   one buyer must not be able to produce two. */
let sessions = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/checkout\/sessions/.test(u)) {
    const id = 'cs_' + (sessions.length + 1);
    sessions.push({ id, body: String((init && init.body) || '') });
    return { ok: true, status: 200,
             json: async () => ({ id, url: 'https://checkout.example/' + id }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv() {
  const m = new Map(); const vals = new Map(); sessions = [];
  return {
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admintok', APP_URL: 'https://amv.test',
    STRIPE_SECRET_KEY: 'sk_test',
    _vals: vals,
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
    /* Serialised, one op at a time, the way the real counter is - so a claim
       that is really a read followed by a write still has a window to lose in,
       and cannot win by accident. */
    AMV_COUNTER: (() => {
      let chain = Promise.resolve();
      return {
        idFromName: (n) => n,
        get: (n) => ({ fetch(_u, init) {
          return (chain = chain.then(async () => {
            await Promise.resolve();
            const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
            if (b.op === 'claim') {
              if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
              vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
            }
            if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
            if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
            if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
            return new Response(JSON.stringify({ allowed: true, value: cur }));
          }));
        } }),
      };
    })(),
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '3.3.3.3',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };

async function buyer(env, email) {
  const r = await call(env, '/auth/signup', { email, name: email.split('@')[0], password: PW });
  const tok = (await r.json()).token;
  /* Money out of a card needs a confirmed birth year - a different control,
     and not the one under test. */
  env.AMV_KV._map.set('consent:' + email, JSON.stringify({ email, birthYear: 1990, at: Date.now() }));
  return tok;
}
function listing(env, id, status) {
  env.AMV_KV._map.set('market:' + id, JSON.stringify({
    id, title: 'A thing', price: 40, authorEmail: SELLER, status: status || 'active', sales: 0,
  }));
}
const buy = (env, tok, id) => post(env, '/v1/market/buy', { id: id || ITEM }, tok);

section('One buyer, one checkout');
{
  const env = mkEnv();
  listing(env, ITEM);
  const tok = await buyer(env, A);
  const r = await buy(env, tok);
  ok(r.body.ok === true, 'the checkout is created', r.body);
  ok(sessions.length === 1, 'and Stripe was asked for exactly one session', sessions.length);
}

section('Clicking buy again hands back the SAME checkout');
{
  /* The duplicate charge, in the shape it actually happens: the same person,
     twice, because the first click looked like it did nothing. */
  const env = mkEnv();
  listing(env, ITEM);
  const tok = await buyer(env, A);

  const first = await buy(env, tok);
  const second = await buy(env, tok);

  ok(second.body.ok === true, 'the second click still works for them', second.body);
  ok(second.body.id === first.body.id, 'and lands on the checkout they already had', second.body.id);
  ok(second.body.url === first.body.url, 'at the same URL', second.body.url);
  ok(sessions.length === 1,
     'Stripe was never asked for a second session, so there is no second card charge',
     sessions.length);
}

section('And five at once produce one');
{
  /* A double-click is the ordinary case; a retry storm is the one that proves
     the check is atomic rather than merely ordered. */
  const env = mkEnv();
  listing(env, ITEM);
  const tok = await buyer(env, A);

  const rs = await Promise.all(Array.from({ length: 5 }, () => buy(env, tok)));
  const ids = new Set(rs.filter(r => r.body.ok).map(r => r.body.id));
  ok(rs.every(r => r.body.ok === true), 'every attempt is answered', rs.map(r => r.status));
  ok(ids.size === 1, 'they all point at one checkout', [...ids]);
  ok(sessions.length === 1, 'and only one session was ever created', sessions.length);
}

section('A one-of-a-kind item is held for whoever got there first');
{
  /* The oversell. Two different people, same item. */
  const env = mkEnv();
  listing(env, ITEM);
  const ta = await buyer(env, A);
  const tb = await buyer(env, B);

  const ra = await buy(env, ta);
  ok(ra.body.ok === true, 'the first buyer reaches checkout', ra.body);

  const rb = await buy(env, tb);
  ok(rb.status === 409, 'the second is refused rather than sent to pay', rb.status);
  ok(rb.body.code === 'item_reserved', 'and told the item is being bought', rb.body.code);
  ok(/message the seller/i.test(rb.body.error || ''),
     'with something they can actually do about it', rb.body.error);
  ok(sessions.length === 1, 'so only one card is ever charged for it', sessions.length);
}

section('Two buyers arriving at the same instant');
{
  /* Sequentially, a read-then-write reservation looks correct. Concurrently it
     is the same race it was meant to close. */
  const env = mkEnv();
  listing(env, ITEM);
  const ta = await buyer(env, A);
  const tb = await buyer(env, B);

  const [ra, rb] = await Promise.all([buy(env, ta), buy(env, tb)]);
  const okCount = [ra, rb].filter(r => r.body.ok).length;
  ok(okCount === 1, 'exactly one of them reaches checkout', { a: ra.status, b: rb.status });
  ok(sessions.length === 1, 'and exactly one session exists', sessions.length);
  ok([ra, rb].some(r => r.status === 409), 'the other is told why', [ra.status, rb.status]);
}

section('The buyer who holds it can still return to their own checkout');
{
  /* A reservation that locked out the person it was taken for would turn a
     double-click into a purchase somebody cannot complete. */
  const env = mkEnv();
  listing(env, ITEM);
  const ta = await buyer(env, A);
  const first = await buy(env, ta);
  const again = await buy(env, ta);
  ok(again.body.ok === true, 'they are not blocked by their own reservation', again.body);
  ok(again.body.id === first.body.id, 'and get the same checkout back', again.body.id);
}

section('A repeatable listing is not reserved at all');
{
  /* Only one-of-a-kind listings can be oversold. Holding a downloadable item
     would stop two people buying the same thing, which is the business. */
  const env = mkEnv();
  listing(env, 'pack_reusable01');
  const ta = await buyer(env, A);
  const tb = await buyer(env, B);
  const ra = await buy(env, ta, 'pack_reusable01');
  const rb = await buy(env, tb, 'pack_reusable01');
  ok(ra.body.ok === true && rb.body.ok === true,
     'two people can buy the same repeatable item', { a: ra.status, b: rb.status });
  ok(sessions.length === 2, 'each with their own checkout', sessions.length);
}

section('A checkout that could not be created gives the item back');
{
  /* Otherwise a provider error takes a listing off the market for the length of
     the reservation, over a purchase that never started. */
  const env = mkEnv();
  listing(env, ITEM);
  const ta = await buyer(env, A);
  const tb = await buyer(env, B);

  const saved = globalThis.fetch;
  globalThis.fetch = async (u) => (/checkout\/sessions/.test(String(u))
    ? { ok: false, status: 402, json: async () => ({ error: { message: 'card_declined' } }) }
    : { ok: true, status: 200, json: async () => ({}) });
  const failed = await buy(env, ta);
  globalThis.fetch = saved;

  ok(failed.status === 502, 'the buyer is told it failed', failed.status);
  const other = await buy(env, tb);
  ok(other.body.ok === true, 'and the item is immediately available to somebody else', other.body);
}

section('The reservation is taken atomically, not written after a read');
{
  /* The structural half. A get-then-put reservation passes every sequential
     case in this file and loses the concurrent one - and the first version of
     the fix was exactly that, which is why this is checked on the mechanism
     rather than only on the outcome. */
  const fn = codeOnly(functionBody(src, 'marketBuy'));
  ok(/_claimOnce\(env, 'mktresv'/.test(fn),
     'the hold goes through the serialising claim', true);
  ok(!/AMV_KV\.get\(`mktresv/.test(fn),
     'and is not a value read out of storage and written back', true);

  /* It has to be taken after the buyer's own session is handed back, or they
     lock themselves out. Position, not presence. */
  const iReuse = fn.indexOf('market_checkout_reused');
  const iClaim = fn.indexOf("_claimOnce(env, 'mktresv'");
  ok(iReuse > -1 && iClaim > iReuse,
     'and after their existing checkout is returned', { reuse: iReuse, claim: iClaim });

  /* Both notes expire. A permanent one would take an item off the market for
     ever after one abandoned checkout. */
  ok(W.MARKET_RESERVE_S > 0 && W.MARKET_RESERVE_S <= 3600,
     'a hold lasts long enough to pay and no longer', W.MARKET_RESERVE_S);
  ok(W.MARKET_SESSION_TTL_S > 0 && W.MARKET_SESSION_TTL_S <= 24 * 3600,
     'and a remembered checkout does not outlive the session it names', W.MARKET_SESSION_TTL_S);
}

globalThis.fetch = realFetch;
if (report('two-clicks-is-not-two-purchases') > 0) process.exitCode = 1;
done();
