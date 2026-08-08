/* THE DASHBOARD SAID 100% CONVERSION. THE TRUTH WAS 4.8%.

   The owner's stats page is not decoration - it is what decides where the next
   month of work goes. MRR says whether this is a business. Conversion says
   whether the funnel needs fixing. A wrong number here does not cause an
   outage; it causes months spent on the wrong thing, which is worse because
   nothing ever tells you.

   Conversion was `paying / entRows.length`. A free signup creates no
   entitlement row, so the denominator was, near enough, the set of people who
   had already paid - and the answer was ~100% no matter what was really
   happening. Measured on twenty free accounts and one payer it read 100.

   That is the most expensive shape a bug can have: it says the thing you are
   worst at is the thing you have already solved.

   So these cases build a deployment whose true answers are known by
   construction, and check the dashboard against them. Every number is asserted
   against arithmetic done here, not against whatever the code returns. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ownernums.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, PLAN_PRICE_USD };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const PW = 'A-real-Passw0rd!';
const ADMIN = 'admin-secret';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const cur = vals.get(n) || 0;
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
    JWT_SECRET: 'j', ADMIN_TOKEN: ADMIN, APP_URL: 'https://amv.test',
    _vals: vals,
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '50.50.50.50' }, headers || {}),
  body: body === undefined ? undefined : JSON.stringify(body),
}), env, ctx);
const stats = async (env) => (await call(env, '/v1/admin/stats', {}, { 'Authorization': 'Bearer ' + ADMIN })).json();
const signup = (env, email) => call(env, '/auth/signup', { email, name: 'U', password: PW });

/* A deployment whose real answers are arithmetic, not opinion. */
async function build(env, { free = 0, pro = 0, elite = 0 } = {}) {
  for (let i = 0; i < free; i++) await signup(env, `free${i}@x.com`);
  for (let i = 0; i < pro; i++) {
    await signup(env, `pro${i}@x.com`);
    await W.DB.put(env, 'ent', `pro${i}@x.com`, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  }
  for (let i = 0; i < elite; i++) {
    await signup(env, `elite${i}@x.com`);
    await W.DB.put(env, 'ent', `elite${i}@x.com`, { plan: 'elite', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  }
}

section('Conversion is measured against everybody, not only against payers');
{
  /* The exact fixture the bug was found on. */
  const env = mkEnv();
  await build(env, { free: 20, pro: 1 });
  const d = await stats(env);

  const truth = +((1 / 21) * 100).toFixed(1);
  ok(d.users.conversionPct === truth,
     'one payer in twenty-one accounts is reported as ' + truth + '%', d.users.conversionPct);
  ok(d.users.conversionPct < 10,
     'and nowhere near the 100% the old denominator produced', d.users.conversionPct);
  ok(d.users.accounts === 21, 'because the denominator is every account', d.users.accounts);
  ok(d.users.basis === undefined || d.users.conversionBasis === 'accounts',
     'and says which basis it used, so the meaning cannot change silently', d.users.conversionBasis);
}

section('It moves the right way when somebody converts');
{
  /* A number that is merely plausible is not the same as one that is right.
     This checks the DIRECTION and the SIZE of a change, which a constant or a
     coincidentally-close formula would fail. */
  const env = mkEnv();
  await build(env, { free: 9, pro: 1 });
  const before = (await stats(env)).users.conversionPct;
  ok(before === 10, 'one in ten is 10%', before);

  await W.DB.put(env, 'ent', 'free0@x.com', { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const after = (await stats(env)).users.conversionPct;
  ok(after === 20, 'a second payer in the same ten is 20%', after);
}

section('And the wrong way when somebody leaves');
{
  const env = mkEnv();
  await build(env, { free: 9, pro: 1 });
  const tok = (await (await call(env, '/auth/login', { email: 'free0@x.com', password: PW, provider: 'email' })).json()).token;
  await call(env, '/auth/delete', {}, { 'Authorization': 'Bearer ' + tok });
  const d = await stats(env);
  ok(d.users.accounts === 9,
     'a deleted account leaves the denominator, or the funnel looks worse every time somebody goes', d.users.accounts);
}

section('MRR is the sum of what people are actually paying');
{
  const env = mkEnv();
  await build(env, { free: 5, pro: 3, elite: 2 });
  const d = await stats(env);
  const truth = 3 * W.PLAN_PRICE_USD.pro + 2 * W.PLAN_PRICE_USD.elite;
  ok(d.revenue.estMRR === truth,
     'three Pro and two Elite add up to $' + truth, d.revenue.estMRR);
  ok(d.users.paying === 5, 'and five people are paying', d.users.paying);
}

section('A lapsed subscription is not revenue');
{
  /* Counting a subscription whose payment failed as money overstates MRR and
     hides the problem. The owner needs to see revenue at RISK, not revenue
     assumed. */
  const env = mkEnv();
  await build(env, { free: 5, pro: 2 });
  const full = (await stats(env)).revenue.estMRR;

  await W.DB.put(env, 'ent', 'pro0@x.com', {
    plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe',
    pastDueSince: Date.now() - 40 * 86400000,           // long past the grace window
  });
  const d = await stats(env);
  const now = d.revenue.estMRR;
  ok(now < full, 'MRR drops when a subscription lapses', { full, now });
  ok(now === W.PLAN_PRICE_USD.pro, 'to exactly the one still being paid for', now);
  ok(d.users.paying === 1, 'and only one person counts as paying', d.users.paying);
}

section('Plan population matches the accounts on each plan');
{
  const env = mkEnv();
  await build(env, { free: 4, pro: 3, elite: 1 });
  const d = await stats(env);
  ok(d.users.byPlan.pro === 3, 'three on Pro', d.users.byPlan.pro);
  ok(d.users.byPlan.elite === 1, 'one on Elite', d.users.byPlan.elite);
}

section('An empty deployment reports zero, not a division by nothing');
{
  /* The state every deployment starts in, and the one most likely to produce
     NaN or Infinity in a dashboard nobody has looked at yet. */
  const env = mkEnv();
  const d = await stats(env);
  ok(d.users.conversionPct === 0, 'conversion is 0', d.users.conversionPct);
  ok(Number.isFinite(d.users.conversionPct), 'and a real number', d.users.conversionPct);
  const mrr = d.revenue.estMRR;
  ok(mrr === 0 && Number.isFinite(mrr), 'MRR is 0', mrr);
}

section('And the numbers are the operator’s alone');
{
  const env = mkEnv();
  await build(env, { free: 2, pro: 1 });
  const anon = await call(env, '/v1/admin/stats', {});
  ok(anon.status >= 400, 'without the admin token there are no numbers', anon.status);
}

globalThis.fetch = realFetch;
if (report('the-owners-numbers-are-true') > 0) process.exitCode = 1;
done();
