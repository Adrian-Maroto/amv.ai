/* AGE, ON THE SIDE THE MONEY RUNS ON.

   The client has always had an age gate. It lived entirely in localStorage, so
   clearing one key walked through it - and an API key skips the browser
   altogether. Meanwhile the word "age" did not appear anywhere in the worker
   except in a cache header.

   That is the wrong place for it to be missing. Under-13 handling is strict
   liability, and a minor cannot form a binding contract, which is precisely why
   their purchases come back as chargebacks. The protection the product claimed
   to have existed only where it could not be enforced.

   Deny by default: an age nobody has recorded is "not known", never "adult".
   But not knowing is told apart from being too young, because an existing
   customer who has simply never been asked needs a prompt, not a wall. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'agegate.harness.mjs');
writeFileSync(harness, src + `
export { _moneyAgeGate, consentRecord, ADULT_AGE, DB, browserRun, stripeCheckout, paypalSubscribe, marketPublish };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, String(v)); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix||'')).map(name=>({name})), list_complete:true }; },
  },
};
W.__setRequireUser(async () => ({ email: 'a@x.com' }));
const req = (body) => new Request('https://x/v1/consent', { method:'POST', body: JSON.stringify(body || {}) });
const YEAR = new Date().getUTCFullYear();

section('An age nobody recorded is not an adult');
{
  store.clear();
  const g = await W._moneyAgeGate(env, 'a@x.com');
  ok(g && g.code === 'age_required', 'money is refused until the age is known', g);
  /* Distinct from a refusal on purpose: a customer who was never asked needs a
     prompt. Answering both with the same code would either wall them out or
     wave a minor through. */
  ok(g.code !== 'age_blocked', 'and "never asked" is not the same answer as "too young"', g.code);
}

section('The age is recorded through the consent route');
{
  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: YEAR - 30 }), env);
  const rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(rec.birthYear === YEAR - 30, 'the birth year is stored server-side', rec.birthYear);
  ok(rec.ageSetAt > 0, 'with when', rec.ageSetAt);
  ok(rec.current && rec.current.version === '2026-07-26', 'alongside the consent it came with', rec.current);

  const g = await W._moneyAgeGate(env, 'a@x.com');
  ok(g === null, 'and an adult may now use money features', g);
}

section('Only the year is kept, not a date of birth');
{
  const rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(typeof rec.birthYear === 'number' && String(rec.birthYear).length === 4,
     'the least personal thing that does the job', rec.birthYear);
}

section('It cannot be retyped once set');
{
  /* A limit anybody can raise by answering again is not a limit. */
  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: YEAR - 5 }), env);
  const rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(rec.birthYear === YEAR - 30, 'a second answer does not overwrite the first', rec.birthYear);
}

section('Someone under eighteen is refused, and told why');
{
  store.clear();
  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: YEAR - 15 }), env);
  const g = await W._moneyAgeGate(env, 'a@x.com');
  ok(g && g.code === 'age_blocked', 'money features are refused', g);
  ok(/18 and over/.test(g.error), 'in a sentence that says the rule', g.error);
}

section('A nonsense year is not recorded at all');
{
  store.clear();
  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: 1200 }), env);
  let rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(!rec.birthYear, 'a year before 1900 is ignored', rec.birthYear);

  await W.consentRecord(req({ termsVersion: '2026-07-26', birthYear: YEAR + 5 }), env);
  rec = await W.DB.get(env, 'consent', 'a@x.com');
  ok(!rec.birthYear, 'and one in the future', rec.birthYear);

  /* Ignoring it must leave the gate CLOSED, not open. */
  const g = await W._moneyAgeGate(env, 'a@x.com');
  ok(g && g.code === 'age_required', 'so money stays refused rather than allowed by a bad value', g);
}

section('The gate is actually wired into the money routes');
{
  const fn = (name) => {
    const at = src.indexOf('async function ' + name);
    const rest = src.slice(at + 1);
    const ends = [rest.indexOf('\nasync function '), rest.indexOf('\nfunction ')].filter(x => x >= 0);
    return ends.length ? src.slice(at, at + 1 + Math.min(...ends)) : src.slice(at);
  };
  ['marketBuy', 'marketWithdraw'].forEach(n => {
    const b = fn(n);
    ok(/_moneyAgeGate\(env, user\.email\)/.test(b), n + ' checks the age', n);
    /* Before it does anything with money, not after. */
    ok(b.indexOf('_moneyAgeGate') < b.indexOf('_getListing') || n !== 'marketBuy',
       'and checks it before reading the listing', n);
  });
}

section('A subscription asks too, and asks rather than refuses');
{
  /* THE ROUTE THAT WAS LEFT UNGATED, AND WHY IT COULD NOT JUST BE GATED.

     `age_required` means nobody ever asked, which is true of every account
     older than the gate. Answering that with a refusal stops those people
     RENEWING - the largest and longest contract the product sells - from a
     screen with no way to fix it. So the status has to be the one that means
     "answer this first", and something has to ask.

     Driven, not read: the gate is reached through the real route, with a real
     KV, before and after an age is recorded. */
  /* Configured enough to REACH the gate. The gate deliberately sits after
     every configuration refusal - asking somebody's birth year on a deployment
     that cannot take a payment is asking under false pretences - so an env
     missing APP_URL answers 503 needs_service and never gets as far as the
     question. That ordering is asserted in
     the-fallback-that-was-never-only-for-development; here it just has to be
     satisfied, or this section measures the wrong refusal. */
  const payEnv = Object.assign({}, env, {
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_PRO: 'price_pro',
    APP_URL: 'https://amv.test',
    PAYPAL_CLIENT_ID: 'id', PAYPAL_SECRET: 'sec',
  });
  const post = (path, body) => new Request('https://x' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
    body: JSON.stringify(body || {}),
  });

  /* A fresh account, never asked. */
  W.__setRequireUser(async () => ({ email: 'newpayer@x.com', plan: 'free' }));

  for (const [name, fn, body] of [
    ['stripeCheckout', W.stripeCheckout, { plan: 'pro' }],
    ['paypalSubscribe', W.paypalSubscribe, { plan: 'pro' }],
    ['marketPublish', W.marketPublish, { title: 'A prompt pack', price: 5 }],
  ]) {
    const r = await fn(post('/x', body), payEnv);
    const d = await r.json().catch(() => ({}));
    ok(r.status === 428, name + ' asks first rather than refusing', name + ' -> ' + r.status);
    ok(d.code === 'age_required',
       'and says which question it is, so the client knows to ask it', d.code);
  }

  /* Answer it once, the way the app does. */
  W.__setRequireUser(async () => ({ email: 'newpayer@x.com', plan: 'free' }));
  const rec = await W.consentRecord(new Request('https://x/v1/consent', {
    method: 'POST', body: JSON.stringify({ termsVersion: '2026-08-05', birthYear: YEAR - 30 }),
  }), payEnv);
  ok(rec.status === 200, 'the answer is accepted', rec.status);

  /* And the same call is no longer stopped by the gate. Past the gate it really
     does try to open a Checkout Session, so the processor is stood in for -
     otherwise this reaches the network and fails for a reason that has nothing
     to do with age. */
  const keepFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (/checkout\/sessions$/.test(String(u)))
      return new Response(JSON.stringify({ id: 'cs_1', url: 'https://pay.test/s' }), { status: 200 });
    return keepFetch(u, o);
  };
  try {
    for (const [name, fn, body] of [
      ['stripeCheckout', W.stripeCheckout, { plan: 'pro' }],
      ['marketPublish', W.marketPublish, { title: 'A prompt pack', price: 5 }],
    ]) {
      const r = await fn(post('/x', body), payEnv);
      ok(r.status !== 428, name + ' no longer asks once it has been answered', name + ' -> ' + r.status);
    }
  } finally { globalThis.fetch = keepFetch; }

  /* Somebody under age is refused, and that IS a wall - which is the point of
     telling the two apart. */
  W.__setRequireUser(async () => ({ email: 'young@x.com', plan: 'free' }));
  await W.consentRecord(new Request('https://x/v1/consent', {
    method: 'POST', body: JSON.stringify({ termsVersion: '2026-08-05', birthYear: YEAR - 14 }),
  }), payEnv);
  const yr = await W.stripeCheckout(post('/x', { plan: 'pro' }), payEnv);
  const yd = await yr.json().catch(() => ({}));
  ok(yr.status === 403, 'a fourteen-year-old is refused, not asked again', yr.status);
  ok(yd.code === 'age_blocked', 'with the code that means no', yd.code);

  W.__setRequireUser(async () => ({ email: 'a@x.com' }));
}

section('The browser agent cannot be used to walk around it');
{
  /* It can complete a checkout, so a purchase routed through it would skip the
     check marketBuy makes. 18-universal.js warns about exactly this bypass, and
     the gate it relies on is the client-side one that can be cleared. */
  const fn = (name) => {
    const at = src.indexOf('async function ' + name);
    const rest = src.slice(at + 1);
    const ends = [rest.indexOf('\nasync function '), rest.indexOf('\nfunction ')].filter(x => x >= 0);
    return ends.length ? src.slice(at, at + 1 + Math.min(...ends)) : src.slice(at);
  };
  const b = fn('browserRun');
  ok(/_moneyAgeGate\(env, user\.email\)/.test(b), 'browserRun checks the age', true);
  /* A spend does not have to be DECLARED to happen, so the goal itself is read. */
  ok(/buy\|purchase\|checkout\|order\|pay\|subscribe/.test(b),
     'and treats a purchase-shaped goal as a purchase even with no amount declared', true);
  /* Anchored on the spend CHECK rather than on any one constant, so moving the
     ceiling somewhere else cannot quietly retire this ordering rule. */
  ok(/_spendReserve\(/.test(b) && b.indexOf('_moneyAgeGate') < b.indexOf('_spendReserve('),
     'before the money is booked, so an underage run is refused rather than merely capped', true);
}

if (report('age-gate') > 0) process.exitCode = 1;
done();
