/* "EXACTLY ONCE" LASTED THIRTY SECONDS.

   `_claimOnce` does two different jobs with one signature. Most callers want a
   MUTEX - hold it while a withdrawal runs, release it after - and they pass a
   small number of seconds. Five callers wanted the other thing, a claim that
   says this has been handled and never stops saying it, and none of them passed
   anything at all. They got the default, and the default was thirty seconds.

     stripeevt / paypalevt  the webhook replay guard. Stripe and PayPal both
                            deliver AT LEAST once and document it. A duplicate
                            arriving thirty-one seconds later was processed as
                            new: seller credited twice for one sale, platform
                            fee booked twice, a renewal payment recorded twice.
     sale                   the same thing one layer in, guarding the credit.
     vidrefund              a failed video gives the quota back "EXACTLY ONCE",
                            says the comment above it. Polling that job's status
                            once a minute gave it back once a minute.
     inviteused             "this invite has already been used" was true for
                            thirty seconds and then quietly stopped being true.

   What kept it invisible is the part worth remembering: THE TWO BACKENDS
   DISAGREED. The KV path stored the key with no expiry when the argument was
   absent - permanent, and correct. The Durable Object path, which is the one
   that runs in production and was chosen precisely because it is atomic enough
   for money, turned the same absent argument into a thirty-second lease. The
   safer storage had the weaker guarantee.

   And every existing test that touches these paths builds an env with no
   AMV_COUNTER at all, so all of them exercised the KV path - the one that was
   already right. The bug lived exactly where the tests did not go, which is
   why the double below models the Durable Object's real semantics, expiry and
   all, rather than a Map that never forgets. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'claimttl.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, _claimOnce, _creditSale, _wallet, stripeWebhook, paypalWebhook, CLAIM_ONCE_TTL_S, MARKET_PLATFORM_FEE };\n');
const W = await import(harness + '?t=' + Date.now());

section('Every claim states how long it lasts');
{
  /* Exhaustive rather than a list of the five that were wrong. The defect was
     a DEFAULT, so what has to be true is that nobody is taking the default -
     and that stays true for a call site added next year only if this counts
     them all. */
  const code = codeOnly(src);
  const sites = [...code.matchAll(/_claimOnce\(\s*env\s*,\s*([^)]*?)\)\)?/g)]
    .map(m => m[1].replace(/\s+/g, ' ').trim())
    /* The definition's own signature is not a call site. */
    .filter(a => !/^env,|ttlSec/.test(a));
  /* A floor, not a census. It is the negative control on the regex above: if a
     refactor changes how claims are written and this stops matching anything,
     the real assertion below would pass by finding nothing to check. The floor
     sits below the current count so removing a feature does not fail a test
     about lifetimes - it was 16 before image and video generation came out. */
  ok(sites.length >= 12, 'the scan still finds the call sites', sites.length);

  /* Three arguments means the lifetime was left to the default. */
  /* A backtick OPENS and CLOSES with the same character, so counting it as a
     bracket makes `${email}:${id}` look like two levels deep and never come
     back - which read three real arguments as one and reported correct call
     sites as broken. A checker that cries wolf gets deleted. */
  const args = (a) => {
    let depth = 0, n = 1, tpl = false;
    for (const ch of a) {
      if (ch === '`') { tpl = !tpl; continue; }
      if (tpl) continue;
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (ch === ',' && depth === 0) n++;
    }
    return n;
  };
  const silent = sites.filter(a => args(a) < 3);
  ok(silent.length === 0,
     'no caller leaves its lifetime to whatever the default happens to be', silent);
}

section('And the default fails in the safe direction anyway');
{
  const code = codeOnly(src);
  ok(/ttlMs:\s*\(ttlSec\s*\|\|\s*CLAIM_ONCE_TTL_S\)/.test(code.replace(/\s+/g, ' ')),
     'a caller that forgets gets the long lifetime, not thirty seconds', true);
  /* The two ways of being wrong are not equal. A claim held too long refuses a
     retry and somebody complains; one released too early pays twice and nobody
     notices. So the backstop has to be the one that gets noticed. */
  ok(W.CLAIM_ONCE_TTL_S >= 30 * 86400,
     'and that lifetime outlives any provider’s redelivery window', W.CLAIM_ONCE_TTL_S);
}

section('The short locks are still short, or a failed withdrawal locks somebody out for a year');
{
  const code = codeOnly(src).replace(/\s+/g, ' ');
  [['wdlock', 30], ['polock', 30], ["rmut:' + kind", 15], ['wmut', 15]].forEach(([name, secs]) => {
    ok(new RegExp("_claimOnce\\(env, '" + name.replace(/[$*+?.()|[\]{}^]/g, '\\$&') + "[^,]*, [^,]+, " + secs + "\\)").test(code),
       name + ' is still a mutex measured in seconds', name);
  });
}

/* ── against the running Worker, with storage that really expires ───────── */

/* A stand-in for the Durable Object that keeps the ONE semantic this is about:
   a claim has an expiry, and the clock can be moved past it. Everything else
   here is the same arithmetic the real one does. */
let NOW = Date.parse('2026-03-01T12:00:00Z');
const advance = (ms) => { NOW += ms; };

function mkEnv() {
  const m = new Map(), vals = new Map(), claims = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', APP_URL: 'https://amv.test',
    STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
    PAYPAL_WEBHOOK_ID: 'wh_test',
    _map: m, _vals: vals, _claims: claims,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
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
          const ttl = Math.max(1000, Number(b.ttlMs) || 30000);
          claims.set(x, NOW + ttl);
          return new Response(JSON.stringify({ claimed: true, until: NOW + ttl }));
        }
        if (b.op === 'release') { claims.delete(x); return new Response(JSON.stringify({ released: true })); }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
        if (b.op === 'reserve') {
          const next = cur + (b.amount || 0);
          if (b.cap && next > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(x, next); return new Response(JSON.stringify({ allowed: true, value: next }));
        }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { vals.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}

section('The double really does expire a claim, or nothing below proves anything');
{
  /* A test whose storage never forgets cannot tell a permanent claim from a
     thirty-second one, which is exactly how this survived: every existing test
     that reaches these paths builds an env with no counter at all. */
  const env = mkEnv();
  ok(await W._claimOnce(env, 'probe', 'x', 30) === true, 'a claim is taken', true);
  ok(await W._claimOnce(env, 'probe', 'x', 30) === false, 'and blocks a second one', true);
  advance(31000);
  ok(await W._claimOnce(env, 'probe', 'x', 30) === true,
     'and a 30-second claim really is gone after 31 seconds', true);
  advance(400 * 86400 * 1000);
  ok(await W._claimOnce(env, 'probe', 'y', W.CLAIM_ONCE_TTL_S) === true, 'a long claim is taken', true);
  advance(31000);
  ok(await W._claimOnce(env, 'probe', 'y', W.CLAIM_ONCE_TTL_S) === false,
     'and is still held long after a mutex would have lapsed', true);
}

const WHSEC = 'whsec_test_secret';
async function stripeEvent(env, event) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WHSEC),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + body));
  const v1 = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return W.stripeWebhook(new Request('https://w/v1/stripe/webhook', {
    method: 'POST', headers: { 'Stripe-Signature': 't=' + t + ',v1=' + v1 }, body }), env, { waitUntil() {} });
}

section('A sale delivered twice is a sale credited once');
{
  const env = mkEnv();
  const SELLER = 'seller@test.com', BUYER = 'buyer@test.com', ITEM = 'usr_thing';
  await W.DB.put(env, 'market', ITEM, { id: ITEM, title: 'A thing', kind: 'prompt', price: 50, authorEmail: SELLER, status: 'active' });

  const evt = {
    id: 'evt_dupe_1', type: 'checkout.session.completed', created: Math.floor(NOW / 1000),
    data: { object: { id: 'cs_1', mode: 'payment', amount_total: 5000, payment_status: 'paid',
      metadata: { kind: 'market_purchase', itemId: ITEM, buyer: BUYER, seller: SELLER } } },
  };

  const r1 = await stripeEvent(env, evt);
  ok(r1.status === 200, 'the first delivery is accepted', r1.status);
  const after1 = await W._wallet(env, SELLER);
  ok(after1.balance > 0, 'and the seller is credited for the sale', after1.balance);

  /* Stripe's guarantee is AT LEAST once, and its retries are minutes and hours
     apart - never thirty seconds. This is the delivery the guard existed for
     and the one it had already forgotten about. */
  advance(10 * 60 * 1000);
  const r2 = await stripeEvent(env, evt);
  ok(r2.status === 200, 'the duplicate is accepted quietly, as a webhook must be', r2.status);
  const after2 = await W._wallet(env, SELLER);
  ok(after2.balance === after1.balance,
     'and the seller is NOT credited a second time for one charge', { was: after1.balance, now: after2.balance });
  ok((after2.holds || []).length === (after1.holds || []).length,
     'nor is a second hold placed on money that was only earned once',
     { was: (after1.holds || []).length, now: (after2.holds || []).length });

  const purchases = await W.DB.get(env, 'purchases', BUYER) || (await env.AMV_KV.get('purchases:' + BUYER));
  const list = Array.isArray(purchases) ? purchases : JSON.parse(purchases || '[]');
  ok(list.length === 1, 'and the buyer bought it once, not twice', list.length);
}

section('The credit itself refuses a replay, even called directly');
{
  /* _creditSale is reachable from the webhook AND from the reconcile sweep, so
     the guard has to hold at its own level rather than only at the webhook's. */
  const env = mkEnv();
  const SELLER = 's2@test.com', BUYER = 'b2@test.com', ITEM = 'usr_two';
  await W.DB.put(env, 'market', ITEM, { id: ITEM, title: 'Two', kind: 'prompt', price: 20, authorEmail: SELLER, status: 'active' });
  await W._creditSale(env, { itemId: ITEM, buyer: BUYER, seller: SELLER, amountCents: 2000, ref: 'ch_1' });
  const one = (await W._wallet(env, SELLER)).balance;
  advance(6 * 60 * 60 * 1000);          // the reconcile sweep, hours later
  await W._creditSale(env, { itemId: ITEM, buyer: BUYER, seller: SELLER, amountCents: 2000, ref: 'ch_1' });
  const two = (await W._wallet(env, SELLER)).balance;
  ok(one > 0 && two === one, 'the sweep does not pay for the same sale again', { one, two });
}

section('A one-time invite is one-time for longer than half a minute');
{
  const env = mkEnv();
  ok(await W._claimOnce(env, 'inviteused', 'tok_abc', W.CLAIM_ONCE_TTL_S) === true,
     'the invite is redeemed', true);
  advance(60 * 60 * 1000);
  ok(await W._claimOnce(env, 'inviteused', 'tok_abc', W.CLAIM_ONCE_TTL_S) === false,
     'and an hour later it is still used up', true);
}

section('A failed video gives the quota back once, not once a minute');
{
  const env = mkEnv();
  ok(await W._claimOnce(env, 'vidrefund', 'vid_1', W.CLAIM_ONCE_TTL_S) === true,
     'the first poll refunds', true);
  advance(5 * 60 * 1000);
  ok(await W._claimOnce(env, 'vidrefund', 'vid_1', W.CLAIM_ONCE_TTL_S) === false,
     'and polling again five minutes later does not', true);
}

if (report('a-guard-that-expires-is-not-a-guard') > 0) process.exitCode = 1;
done();
