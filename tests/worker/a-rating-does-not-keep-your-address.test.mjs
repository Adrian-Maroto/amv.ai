/* A RATING KEPT THE RATER'S ADDRESS SOMEWHERE ERASURE COULD NOT REACH.

   marketRate stored map[user.email] = stars into mkrate:<listingId>. That
   record is keyed by the LISTING - somebody else's listing - so it is not in
   PER_USER_KINDS and it could not be: erasing a rater's account cannot reach a
   record filed under a seller's item. The address outlived the deletion, with
   nothing anywhere able to find it.

   marketReview, the very next function in the file, already did this right and
   said why in its own comment: store a pseudonymous id, never the raw email,
   so a list can be shown publicly without leaking addresses. Same record shape,
   same reasoning, one function apart, and only one of them followed it. I fixed
   exactly this defect while building marketReport and did not think to look at
   the function above it.

   The second half of this file is about the register itself. SECURITY-SCAMS.md
   is a list of ~50 defences, each marked as implemented. It is the document
   somebody would be shown if they asked how AMV handles abuse, which makes an
   overstatement in it worse than a gap: it stops the check from being made.
   Item 24 claimed the page ships `default-src 'none'`. It ships 'self', and
   script-src carries 'unsafe-inline' because the app uses inline onclick
   attributes - so on that line the CSP is a host allowlist, not an
   inline-script defence, and escH plus the URL allowlist are what actually
   stop injection. Saying so is worth more than the sentence it replaced. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const register = readFileSync(join(ROOT, 'SECURITY-SCAMS.md'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'rate.harness.mjs');
writeFileSync(harness, src + '\nexport { _errHash };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

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
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, path, body, tok) => {
  const r = await call(env, path, body, tok);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const signup = async (env, email) =>
  (await (await call(env, '/auth/signup', { email, name: email.split('@')[0], password: 'A-real-Passw0rd!' })).json()).token;

const LISTING = { id: 'usr_x', title: 'A Thing', authorEmail: 'seller@example.com', price: 20, status: 'active', kind: 'prompt' };
/* Ownership is what marketRate gates on, and it is granted only by a completed
   purchase - which is also why a seller cannot rate their own listing: buying
   your own is refused, so the entitlement never exists. Set directly here so
   the rating path can be exercised without running a whole checkout. */
const own = (env, email) => env.AMV_KV._map.set(`entitleitem:${email}:usr_x`, '1');
const seed = (env) => env.AMV_KV._map.set('market:usr_x', JSON.stringify(LISTING));

section('A rating does not record who by, in a record erasure cannot reach');
{
  const env = mkEnv(); seed(env);
  const tok = await signup(env, 'rater@example.com'); own(env, 'rater@example.com');
  const r = await post(env, '/v1/market/rate', { id: 'usr_x', stars: 4 }, tok);
  ok(r.body.ok === true, 'the rating lands', r.body);
  const raw = env.AMV_KV._map.get('mkrate:usr_x');
  ok(!/rater@example\.com/.test(raw), 'and the address is not in it', raw);
  ok(/"[0-9a-f]{16}":\s*4/.test(raw), 'a one-way id is', raw);
  ok(r.body.rating === 4, 'while the number anybody actually reads is unchanged', r.body.rating);
}

section('One person still counts once');
{
  const env = mkEnv(); seed(env);
  const tok = await signup(env, 'rater@example.com'); own(env, 'rater@example.com');
  await post(env, '/v1/market/rate', { id: 'usr_x', stars: 5 }, tok);
  const r = await post(env, '/v1/market/rate', { id: 'usr_x', stars: 1 }, tok);
  ok(r.body.ratings === 1, 'a second rating replaces the first rather than stacking', r.body.ratings);
  ok(r.body.rating === 1, 'and the new one is what counts', r.body.rating);
}

section('And addresses already stored are converted rather than left');
{
  /* The migration is the point: a fix that only protects future raters leaves
     every existing address exactly where it was. The keys ARE the addresses and
     the hash is a pure function of one, so an old map can be converted here
     without knowing whose entries they are. */
  const env = mkEnv(); seed(env);
  env.AMV_KV._map.set('mkrate:usr_x', JSON.stringify({ 'old1@example.com': 5, 'old2@example.com': 3 }));
  const tok = await signup(env, 'rater@example.com'); own(env, 'rater@example.com');
  const r = await post(env, '/v1/market/rate', { id: 'usr_x', stars: 4 }, tok);
  const raw = env.AMV_KV._map.get('mkrate:usr_x');
  ok(!/@example\.com/.test(raw), 'no address survives the next write to that record', raw);
  ok(Object.keys(JSON.parse(raw)).length === 3, 'and every rating is still counted', Object.keys(JSON.parse(raw)));
  ok(r.body.rating === 4, 'with the average intact: (5+3+4)/3', r.body.rating);
  ok(Object.keys(JSON.parse(raw)).every(k => /^[0-9a-f]{16}$/.test(k)),
     'every key is a hash, old and new alike', Object.keys(JSON.parse(raw)));
}

section('A hashed key is not re-hashed on the next write');
{
  /* Migrating an already-migrated key would change it, which would turn one
     person into two and let somebody rate twice. */
  const env = mkEnv(); seed(env);
  const a = await signup(env, 'rater@example.com'); own(env, 'rater@example.com');
  await post(env, '/v1/market/rate', { id: 'usr_x', stars: 5 }, a);
  const first = Object.keys(JSON.parse(env.AMV_KV._map.get('mkrate:usr_x')));
  await post(env, '/v1/market/rate', { id: 'usr_x', stars: 2 }, a);
  const second = Object.keys(JSON.parse(env.AMV_KV._map.get('mkrate:usr_x')));
  ok(first.length === 1 && second.length === 1, 'still one rater', { first, second });
  ok(first[0] === second[0], 'and the same id, so a rehash cannot split one person into two', { first, second });
}

section('The two records that name a person agree with each other');
{
  /* The defect was that they did not: reviews hashed, ratings did not, one
     function apart. */
  const rate = src.slice(src.indexOf('async function marketRate('), src.indexOf('async function marketReview('));
  const review = src.slice(src.indexOf('async function marketReview('));
  ok(/_errHash\(/.test(rate), 'ratings store a hashed id', true);
  ok(/_errHash\(/.test(review.slice(0, 3000)), 'and so do reviews', true);
  /* Matched as CODE, not as prose. The first version matched `map[user.email]`
     anywhere in the slice and failed on the comment explaining what the old
     code did - and the second version stripped only lines starting with a
     comment marker, which misses the body of a block comment whose
     continuation lines start with plain text. A check that cannot tell a
     defect from a sentence about a defect will block the fix. */
  const codeOnly = rate.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/map\[\s*user\.email\s*\]\s*=/.test(codeOnly),
     'nothing keys a public aggregate by address any more', true);
}

section('The scam register describes the CSP that actually ships');
{
  /* A register that overstates a defence is worse than one that omits it: it
     stops somebody making the check. */
  const shipped = (html.match(/default-src ([^;"]*)/) || [])[1] || '';
  ok(/'self'/.test(shipped), 'the page ships default-src self', shipped.trim());

  const item24 = (register.match(/^24\..*$/m) || [''])[0];
  ok(item24.length > 0, 'item 24 was found', item24.slice(0, 60));
  ok(!/default-src\s*`?'none'/.test(item24),
     'and no longer claims a policy the page has never shipped', item24.slice(0, 200));
  ok(/default-src/.test(item24) && /'self'/.test(item24),
     'it names the one that is really there', true);
  ok(/unsafe-inline/.test(item24),
     'and states the limit rather than glossing it - script-src still allows inline, so the CSP is a host allowlist on this line',
     true);
}

section('And the register is not claiming that limit away elsewhere');
{
  const wrong = [...register.matchAll(/default-src\s*`?'none'/g)].length;
  ok(wrong === 0, 'nothing anywhere in the register claims default-src none', wrong);
}

if (report('a-rating-does-not-keep-your-address') > 0) process.exitCode = 1;
done();
