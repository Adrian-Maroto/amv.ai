/* THE ONE IRREVERSIBLE ACTION TOOK THE ONE CREDENTIAL MOST LIKELY TO LEAK.

   Deleting an account erases everything AMV holds for somebody and cannot be
   undone. It accepted whatever the auth path accepted and asked for nothing
   else - so an access token was enough.

   An access token is exactly the wrong thing to accept for this. It is the
   credential lying around on a shared laptop somebody stayed signed in on, the
   one a script on another page can reach, the one on a borrowed phone. Holding
   a session is not the same as being the account owner at this moment, and
   every other product with an irreversible action asks the person to prove they
   are still there.

   An API key was enough too, which is worse. A key exists so a machine can act
   without a person; no automation has a reason to erase the account it runs on,
   so allowing it only means a leaked key can.

   AND THE SECOND HALF, which is about money rather than access.

   Deletion is refused while a payout is on its way, because erasure takes the
   wallet with it. That check caught every read failure and returned an empty
   list - and an empty list is indistinguishable from a clean one. So a storage
   blip meant "nothing is in flight", the account was erased, and the balance
   the payout was debited from went with it. The comment defending it said the
   payout records survive erasure, which is half true: the record survives and
   the person it was owed to does not.

   Both are the same mistake pointed at different things - reading an absent
   answer as a permissive one - and both fail in the direction that cannot be
   undone. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'delreauth.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _payoutsInFlight };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'leaving@example.com';
const PW = 'A-real-Passw0rd!';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map(); const vals = new Map();
  const env = {
    JWT_SECRET: 'j', APP_URL: 'https://amv.test', _vals: vals, _failOpen: false,
    AMV_KV: {
      _map: m,
      async get(k) {
        if (env._failOpen && k.startsWith('wdopen:')) throw new Error('storage down');
        return m.has(k) ? m.get(k) : null;
      },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        if (env._failOpen && prefix === 'withdraw:') throw new Error('storage down');
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
        /* The real counter REFUSES past the limit. A stub that always allows is
           more permissive than the thing it stands in for, so a throttle that
           had stopped working would still look enforced here - which is how a
           test double turns a check into decoration. */
        if (b.op === 'rateCheck') {
          const next = cur + 1; vals.set(n, next);
          return new Response(JSON.stringify({ allowed: next <= (b.limit || 999), count: next }));
        }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
  return env;
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '2.2.2.2' }, headers || {}),
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, h) => { const r = await call(env, p, b, h); return { status: r.status, body: await r.json().catch(() => ({})) }; };

async function signedIn(env) {
  const r = await call(env, '/auth/signup', { email: USER, name: 'L', password: PW });
  return (await r.json()).token;
}
const del = (env, tok, body) => post(env, '/auth/delete', body || {}, { Authorization: 'Bearer ' + tok });
const alive = (env) => !!env.AMV_KV._map.get('acct:' + USER);

section('A session alone is not enough to erase everything');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  const r = await del(env, tok);
  ok(r.status === 401, 'the request is refused', r.status);
  ok(r.body.code === 'reauth_required', 'asking them to confirm they are still there', r.body.code);
  ok(r.body.need === 'password', 'by their password, which is what this account has', r.body.need);
  ok(alive(env), 'and the account is untouched', alive(env));
}

section('A wrong password does not erase it either');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  const r = await del(env, tok, { password: 'not-the-password' });
  ok(r.status === 401, 'refused', r.status);
  ok(r.body.code === 'reauth_failed', 'and told plainly that the password is wrong', r.body.code);
  ok(alive(env), 'the account survives', alive(env));
}

section('The right password does');
{
  /* The control. A gate that refused everybody would pass both cases above and
     be a different bug - somebody with a right to erasure who cannot exercise
     it. */
  const env = mkEnv();
  const tok = await signedIn(env);
  const r = await del(env, tok, { password: PW });
  ok(r.status === 200, 'the account is deleted', r.status);
  ok(r.body.deleted === true, 'and says so', r.body.deleted);
  ok(!alive(env), 'the record is gone', alive(env));
}

section('Guessing at the confirmation is bounded');
{
  /* This endpoint now takes a password, and everything that takes a password is
     a guessing surface. */
  const env = mkEnv();
  const tok = await signedIn(env);
  const codes = [];
  for (let i = 0; i < 8; i++) {
    const r = await del(env, tok, { password: 'guess-' + i });
    codes.push(r.status);
  }
  ok(codes.some(c => c === 429), 'a run of wrong passwords is throttled', codes);
  ok(alive(env), 'and the account is still there', alive(env));
}

section('A federated account confirms the way it can');
{
  /* No password to check, so what can honestly be asked is that somebody types
     the address - which still requires a person at the screen rather than a
     token being replayed. */
  const env = mkEnv();
  const tok = await signedIn(env);
  const acct = await W.DB.get(env, 'acct', USER);
  acct.provider = 'google'; delete acct.pwHash;
  await W.DB.put(env, 'acct', USER, acct);

  const bare = await del(env, tok);
  ok(bare.status === 401, 'a bare request is refused', bare.status);
  ok(bare.body.need === 'confirmEmail', 'asking for the address', bare.body.need);

  const wrong = await del(env, tok, { confirmEmail: 'someone@else.com' });
  ok(wrong.status === 401, 'the wrong address is refused', wrong.status);
  ok(alive(env), 'and it is still there', alive(env));

  const right = await del(env, tok, { confirmEmail: USER });
  ok(right.status === 200, 'their own address confirms it', right.status);
  ok(!alive(env), 'and the account is gone', alive(env));
}

section('An API key cannot erase the account it runs on');
{
  /* A key exists so a machine can act without a person. No automation has a
     reason to do this, so allowing it only means a leaked key can. */
  const env = mkEnv();
  const tok = await signedIn(env);
  /* Keys are part of a paid plan, so the account has to be on one before it can
     have a key at all. */
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const k = await post(env, '/v1/keys/create', { name: 'bot' }, { Authorization: 'Bearer ' + tok });
  const key = k.body.key || k.body.apiKey || k.body.value || '';
  ok(key.length > 10, 'a key was issued', key ? key.slice(0, 8) + '...' : key);

  const r = await del(env, key, { password: PW });
  ok(r.status === 403, 'and it cannot delete the account', r.status);
  ok(/sign in/i.test(r.body.error || ''), 'saying what to do instead', r.body.error);
  ok(alive(env), 'the account is untouched', alive(env));
}

section('Money on its way is a reason to wait, and still is');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  env.AMV_KV._map.set('withdraw:wd_inflight1', JSON.stringify({
    id: 'wd_inflight1', seller: USER, amount: 80, status: 'pending', ts: Date.now() }));

  const r = await del(env, tok, { password: PW });
  ok(r.status === 409, 'deletion waits', r.status);
  ok(r.body.code === 'payout_pending', 'because a payout is unsettled', r.body.code);
  ok(alive(env), 'and the account, and the wallet with it, survive', alive(env));
}

section('A check that could not run is not a clean check');
{
  /* AMV-SP-04. The lookup is made to fail. Before, that produced an empty list,
     which reads exactly like "nothing outstanding" - and erasure takes the
     wallet, so the money the payout was debited from goes too. */
  const env = mkEnv();
  const tok = await signedIn(env);
  env.AMV_KV._map.set('withdraw:wd_inflight2', JSON.stringify({
    id: 'wd_inflight2', seller: USER, amount: 120, status: 'pending', ts: Date.now() }));
  env._failOpen = true;

  const r = await del(env, tok, { password: PW });
  ok(r.status === 503, 'deletion does not proceed on a lookup that never happened', r.status);
  ok(r.body.code === 'payout_check_unavailable', 'and names the reason', r.body.code);
  ok(/temporary|try again/i.test(r.body.error || ''),
     'telling them it is a fault rather than a refusal', r.body.error);
  ok(alive(env), 'the account is intact', alive(env));

  /* And it is a delay, not a wall. */
  env._failOpen = false;
  const after = await del(env, tok, { password: PW });
  ok(after.status === 409, 'once the store recovers it answers honestly again', after.status);
}

section('The helper says which of the two happened');
{
  /* Read directly, because the difference between the two answers is the whole
     finding and a route test could pass on either by coincidence. */
  const env = mkEnv();
  const empty = await W._payoutsInFlight(env, 'nobody@example.com');
  ok(Array.isArray(empty) && empty.length === 0,
     'a genuine miss is an empty list, which still means nothing is owed', empty);

  env._failOpen = true;
  let threw = null;
  try { await W._payoutsInFlight(env, 'nobody@example.com'); } catch (e) { threw = e; }
  ok(threw != null, 'and an unreadable one throws rather than answering', threw && threw.message);
  ok(threw && threw.code === 'payout_check_unavailable', 'with a code the caller can act on', threw && threw.code);
}

section('The card stops being charged, whoever holds it');
{
  /* AMV-SP-03. Only Stripe was ended here. A customer paying through PayPal
     who deleted their account went on being charged every month for a product
     they no longer had - the exact failure the comment above the Stripe block
     describes, left in place for the other half of the paying customers.

     Worse on that side: PayPal bills against an agreement the customer set up,
     so it keeps taking money with nothing on AMV's side involved at all. */
  const cancels = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (/oauth2\/token/.test(u)) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    if (/billing\/subscriptions\/[^/]+\/cancel/.test(u)) {
      cancels.push(u);
      return { ok: true, status: 204, json: async () => ({}) };
    }
    if (/api\.stripe\.com/.test(u)) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const env = mkEnv();
  Object.assign(env, { PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec', PAYPAL_MODE: 'sandbox' });
  const tok = await signedIn(env);
  /* The subscription that is billing them, recorded where AMV-007 puts it. */
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(),
                                     source: 'paypal', lastEventSrc: 'paypal', subId: 'I-PPSUB123' });

  const r = await del(env, tok, { password: PW });
  globalThis.fetch = saved;

  ok(r.status === 200, 'the account is deleted', r.status);
  ok(cancels.length === 1, 'and their PayPal subscription is cancelled', cancels);
  ok(/I-PPSUB123/.test(cancels[0] || ''), 'the one that was actually billing them', cancels[0]);
}

section('And a Stripe customer is unaffected by that');
{
  /* The PayPal branch keys off which processor owns the plan, so it must not
     fire for somebody Stripe is billing - a cancel call against a subscription
     id that is not PayPal's would fail and raise an alert about nothing. */
  const cancels = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (/oauth2\/token/.test(u)) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    if (/billing\/subscriptions\/[^/]+\/cancel/.test(u)) { cancels.push(u); return { ok: true, status: 204, json: async () => ({}) }; }
    if (/api\.stripe\.com/.test(u)) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const env = mkEnv();
  Object.assign(env, { PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec' });
  const tok = await signedIn(env);
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(),
                                     source: 'stripe', lastEventSrc: 'stripe', subId: 'sub_STRIPE1' });
  await del(env, tok, { password: PW });
  globalThis.fetch = saved;
  ok(cancels.length === 0, 'no PayPal cancellation is attempted for a Stripe customer', cancels);
}

section('The reauthentication happens before anything is touched');
{
  /* Position, not presence. A confirmation checked after the first record is
     deleted is not a confirmation. */
  const fn = codeOnly(functionBody(src, 'authDeleteAccount'));
  const iAuth = fn.indexOf('_reauthForDelete(');
  const iPayout = fn.indexOf('_payoutsInFlight(');
  const iDel = fn.search(/DB\.del\(|AMV_KV\.delete\(/);
  ok(iAuth > -1, 'the deletion asks for confirmation', iAuth);
  ok(iAuth < iPayout, 'before it looks at anything', { auth: iAuth, payout: iPayout });
  ok(iDel === -1 || iAuth < iDel, 'and long before it deletes anything', { auth: iAuth, del: iDel });

  /* The payout check no longer swallows. */
  const pf = codeOnly(functionBody(src, '_payoutsInFlight'));
  ok(!/catch[\s\S]{0,200}?return \[\];/.test(pf),
     'and a failed lookup is not turned back into an empty answer', true);
  ok(/payout_check_unavailable/.test(pf), 'it is named instead', true);

  /* Both processors are ended, and both before the records that name them are
     erased - after erasure there is nothing left pointing at the subscription. */
  const iStripe = fn.indexOf('api.stripe.com/v1/subscriptions');
  const iPaypal = fn.indexOf('billing/subscriptions');
  ok(iStripe > -1 && iPaypal > -1, 'deletion ends a subscription on either processor',
     { stripe: iStripe, paypal: iPaypal });
  const iErase = fn.indexOf('for (const kind of perUserKinds)');
  ok(iErase === -1 || (iStripe < iErase && iPaypal < iErase),
     'and does it before the records that name them are erased',
     { stripe: iStripe, paypal: iPaypal, erase: iErase });
}

globalThis.fetch = realFetch;
if (report('erasing-everything-needs-more-than-a-token') > 0) process.exitCode = 1;
done();
