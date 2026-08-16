/* EVERY DOLLAR LIMIT IN AMV WAS TWO CALLS WITH A GAP IN THE MIDDLE.

   Read the total, compare it to the ceiling, do the work, add what it cost.
   Each of those steps is atomic on its own - the counter is a Durable Object -
   and the PAIR is not. Twenty requests that arrive together all read the same
   total, all decide they fit, and all proceed. Nothing about the ceiling bounds
   how far past it they go; the number of simultaneous requests does.

   The token allowance already knew this. There is a comment beside it recording
   an 8-request burst measured at 3.2x its daily cap, trivially produced from
   devtools with a fetch loop, and it was fixed by booking an upper bound
   atomically before the model runs and settling the difference after. The
   MONEY ceilings were left on the racing version - which is exactly the wrong
   way round. Tokens are an allowance. Dollars are the bill.

   Six ceilings were on the broken pattern: chat's account ceiling, the day's
   global ceiling, image, video, the widget's three, and SMS. Each of them is
   the last thing between AMV and a bill it cannot pay.

   This file does not read the code and check for the word `reserve`. It runs
   requests CONCURRENTLY against a counter that serialises the way the real one
   does, and asks what the total came to. That is the only form of this check
   that could have failed before and passes now, because the defect was never
   visible in any single request. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'atomicusd.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _reserveUSD, _releaseUSD, _recordSpend, ENGINES, todayKey };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'burst@example.com';
const PW = 'A-real-Passw0rd!';

const realFetch = globalThis.fetch;
let modelCalls = 0;
const sse = (outTok) => 'data: {"type":"message_start","message":{"usage":{"input_tokens":2000,"output_tokens":0}}}\n\n'
  + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
  + `data: {"type":"message_delta","usage":{"output_tokens":${outTok}}}\n\n`
  + 'data: {"type":"message_stop"}\n\n';

/* A provider that takes a moment to answer. The delay is the point: it holds
   every request inside the window between the check and the charge, which is
   the window the defect lived in. With an instant provider the requests
   serialise by accident and a broken ceiling looks fine. */
globalThis.fetch = async (url) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  modelCalls++;
  await new Promise(r => setTimeout(r, 25));
  return new Response(sse(4000), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

/* A counter that behaves like the Durable Object: one op at a time, and each
   op complete before the next begins. Requests still interleave BETWEEN ops,
   which is precisely what a check-then-charge pair cannot survive. */
function mkEnv(extra) {
  const m = new Map(); const vals = new Map(); modelCalls = 0;
  let chain = Promise.resolve();
  const serialise = (fn) => (chain = chain.then(fn, fn));
  return Object.assign({
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    GLOBAL_DAILY_USD_CAP: '100000',
    _vals: vals,
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
      get: (n) => ({ fetch(_u, init) {
        return serialise(async () => {
          /* A real await inside the op, so an implementation that reads and
             writes in two steps has a genuine window to be interleaved in -
             and cannot be, because this chain holds it. */
          await Promise.resolve();
          const b = JSON.parse(init.body);
          const cur = vals.get(n) || 0;
          if (b.op === 'reserve') {
            const amt = Number(b.amount);
            if (!Number.isFinite(amt) || amt < 0) return new Response(JSON.stringify({ allowed: false, value: cur }));
            if (b.cap != null && cur + amt > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
            vals.set(n, cur + amt); return new Response(JSON.stringify({ allowed: true, value: cur + amt }));
          }
          if (b.op === 'incr') { vals.set(n, Math.max(0, cur + (b.amount || 0))); return new Response(JSON.stringify({ value: vals.get(n) })); }
          if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: b.cap == null || cur < b.cap, value: cur }));
          if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
          if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
          if (b.op === 'release') return new Response(JSON.stringify({ ok: true }));
          if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
          return new Response(JSON.stringify({ allowed: true, value: cur }));
        });
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { const p = this._p || []; this._p = []; await Promise.all(p); } };

const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '40.40.40.40' }, headers || {}),
  body: JSON.stringify(body),
}), env, ctx);

async function signedIn(env, plan) {
  const r = await call(env, '/auth/signup', { email: USER, name: 'B', password: PW });
  const tok = (await r.json()).token;
  await W.DB.put(env, 'ent', USER, { plan: plan || 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const ask = (env, tok) => call(env, '/v1/messages',
  { model: 'amv-core', max_tokens: 4000, messages: [{ role: 'user', content: 'hello' }] },
  { 'Authorization': 'Bearer ' + tok });

const acctSpend = (env) => [...env._vals.entries()]
  .filter(([k]) => k.startsWith('cost:')).reduce((n, [, v]) => n + v, 0);
const globalSpend = (env) => [...env._vals.entries()]
  .filter(([k]) => k.startsWith('spend:')).reduce((n, [, v]) => n + v, 0);
const acctKey = (env) => [...env._vals.keys()].find(k => k.startsWith('cost:')) || '';

section('The primitive itself: a ceiling reached is a ceiling refused');
{
  const env = mkEnv();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => W._reserveUSD(env, 'cost:x:m', 1, 10, 1000)));
  const allowed = results.filter(r => r.allowed).length;
  ok(allowed === 10, 'exactly ten of twenty $1 reservations fit under a $10 ceiling', allowed);
  ok(env._vals.get('cost:x:m') === 10, 'and the counter lands exactly on it, not past it',
     env._vals.get('cost:x:m'));
}

section('A reservation given back can be taken again');
{
  /* Otherwise a refused request would permanently consume the allowance it was
     refused from, which is a worse bug than the one being fixed. */
  const env = mkEnv();
  const a = await W._reserveUSD(env, 'cost:y:m', 9, 10, 1000);
  ok(a.allowed && a.reserved === 9, 'the first booking fits', a);
  const b = await W._reserveUSD(env, 'cost:y:m', 9, 10, 1000);
  ok(!b.allowed && b.reserved === 0, 'the second does not', b);
  await W._releaseUSD(env, 'cost:y:m', 9, 1000);
  ok(env._vals.get('cost:y:m') === 0, 'releasing puts it back', env._vals.get('cost:y:m'));
  const c = await W._reserveUSD(env, 'cost:y:m', 9, 10, 1000);
  ok(c.allowed, 'and the room is available again', c.allowed);
}

section('Settling does not charge twice');
{
  /* The mirror-image failure, and the easy one to ship: book the estimate, then
     add the real cost on top of it. Every call would cost roughly double and
     the ceiling would look like it was working unusually well. */
  const env = mkEnv();
  await W._reserveUSD(env, 'cost:z:m', 0.20, 100, 1000);
  await W._reserveUSD(env, 'spend:' + W.todayKey(), 0.20, 100, 1000);
  await W._recordSpend(env, 'z', 0.05, 'chat', 'm', { account: 0.20, global: 0.20 });
  ok(Math.abs(env._vals.get('cost:z:m') - 0.05) < 1e-9,
     'the account ledger holds what the work really cost', env._vals.get('cost:z:m'));
  ok(Math.abs(env._vals.get('spend:' + W.todayKey()) - 0.05) < 1e-9,
     'and so does the day’s', env._vals.get('spend:' + W.todayKey()));

  /* The two reporting ledgers were never reserved against, so they take the
     full amount - settling them would leave the owner's numbers short by
     whatever had been pre-booked. */
  ok(Math.abs([...env._vals.entries()].filter(([k]) => k.startsWith('costtotal:'))
       .reduce((n, [, v]) => n + v, 0) - 0.05) < 1e-9,
     'the platform total takes the full figure', true);
}

section('Twenty simultaneous turns cannot walk through one account ceiling');
{
  /* The finding, run rather than read. Every request is started before any of
     them finishes, so they are all inside the old check-then-charge window at
     the same time. */
  const env = mkEnv();
  const tok = await signedIn(env);

  /* A ceiling the account is already most of the way through, so a small number
     of turns is all that fits. Set on the same key the gate reads. */
  const primed = await ask(env, tok);
  await primed.text().catch(() => {});
  await ctx.settle();
  const key = acctKey(env);
  ok(key, 'the account cost counter was found', key);

  const CEILING = 0.30;
  env._vals.set(key, 0);
  env.GLOBAL_DAILY_USD_CAP = '100000';
  modelCalls = 0;

  /* An exact ceiling, set the way the product sets one: a parent's monthly
     limit on a child. Built through the same two records _familyOf reads - the
     entitlement's `familyOf` pointer and a `child` membership carrying the
     limits - because membership is what the resolver treats as the source of
     truth, and a family record without it resolves to no cap at all. */
  await W.DB.put(env, 'fam', 'f1', { id: 'f1', parentEmail: 'p@x.z',
    members: [{ email: USER, role: 'child', limits: { monthlyUSD: CEILING } }] });
  const ent = await W.DB.get(env, 'ent', USER);
  ent.familyOf = 'f1';
  await W.DB.put(env, 'ent', USER, ent);

  const rs = await Promise.all(Array.from({ length: 20 }, () => ask(env, tok)));
  await Promise.all(rs.map(r => r.text().catch(() => '')));
  await ctx.settle();

  const served = rs.filter(r => r.status === 200).length;
  const refused = rs.filter(r => r.status === 429).length;
  ok(served + refused === 20, 'every request got a definite answer', { served, refused });
  ok(served > 0, 'some turns were served, so the ceiling is not simply off', served);
  ok(refused > 0, 'and some were refused, so it is doing something', refused);

  /* THE ASSERTION. Under check-then-charge every one of the twenty passed the
     same read and the total ran far past the ceiling. */
  const spent = acctSpend(env);
  ok(spent <= CEILING + 1e-9,
     'the account never spends past the ceiling, however many arrive at once',
     { spent, ceiling: CEILING, served });
}

section('And the day’s global ceiling holds the same way');
{
  const env = mkEnv({ GLOBAL_DAILY_USD_CAP: '0.25' });
  const tok = await signedIn(env);
  modelCalls = 0;

  const rs = await Promise.all(Array.from({ length: 20 }, () => ask(env, tok)));
  await Promise.all(rs.map(r => r.text().catch(() => '')));
  await ctx.settle();

  const spent = globalSpend(env);
  ok(spent <= 0.25 + 1e-9,
     'the platform’s daily spend never runs past its ceiling under a burst',
     { spent, cap: 0.25 });
  ok(rs.some(r => r.status === 503), 'and the ones that did not fit are told AMV is at capacity',
     rs.map(r => r.status).filter(s => s !== 200).slice(0, 3));
}

section('Being refused costs nothing');
{
  /* A reservation that is not handed back on a refusal turns "you were told no"
     into "you were charged for being told no", and it compounds: each refusal
     makes the next one more likely. */
  const env = mkEnv({ GLOBAL_DAILY_USD_CAP: '0.0001' });
  const tok = await signedIn(env);
  modelCalls = 0;

  const before = acctSpend(env);
  const rs = await Promise.all(Array.from({ length: 5 }, () => ask(env, tok)));
  await Promise.all(rs.map(r => r.text().catch(() => '')));
  await ctx.settle();

  ok(rs.every(r => r.status !== 200), 'every turn is refused', rs.map(r => r.status));
  ok(modelCalls === 0, 'and no model call was made', modelCalls);
  ok(acctSpend(env) === before,
     'so the account’s own ceiling is untouched by five refusals', { before, after: acctSpend(env) });
}

section('No dollar ceiling is left on the racing pattern');
{
  /* The behavioural cases above cover chat. The sweep is what covers the ones
     they do not reach - image, video, the widget's three, SMS, and the cron -
     and it is derived from the code rather than from a list I remembered.

     Any `checkCap` against a MONEY counter is a ceiling still being read rather
     than booked. Token counters are a different question and are not money. */
  const code = codeOnly(src);
  const MONEY = /^(cost|spend|wspend):/;
  const offenders = [];
  for (const m of code.matchAll(/counter\(\s*env\s*,\s*([`'"][^`'"]*[`'"])[^)]*op\s*:\s*'checkCap'/g)) {
    const name = m[1].replace(/[`'"]/g, '');
    if (MONEY.test(name)) offenders.push(name);
  }
  /* The automation runner keeps ONE read: a coarse "is the day's budget gone,
     skip this account entirely" pre-check taken before its item loop. The
     binding reservation is taken per run further down. Named, so it is an
     acknowledged exception rather than a hole the sweep cannot see. */
  const allowed = offenders.filter(n => n.startsWith('spend:${todayKey()}'));
  ok(offenders.length - allowed.length === 0,
     'every money ceiling is reserved against rather than read', offenders);
  ok(allowed.length <= 1, 'with exactly one acknowledged coarse pre-check', allowed);

  /* And that the sweep can find anything at all - a pattern that matches
     nothing reports a clean result and an empty one identically. */
  const anyCheckCap = (code.match(/op\s*:\s*'checkCap'/g) || []).length;
  ok(anyCheckCap > 0, 'the sweep’s pattern does match real call sites', anyCheckCap);
  const anyReserve = (code.match(/_reserveUSD\(/g) || []).length;
  ok(anyReserve >= 6, 'and money ceilings really are booked in several places', anyReserve);
}

section('The widget meters into the ledger it checks');
{
  /* Found while fixing this one. The widget checked the owner's `cost:` ceiling
     before every turn and metered into `wspend:<key>` - so that ceiling was
     read constantly and written never, and could not be reached by a widget
     however much a stranger typed into it. */
  const code = codeOnly(src);
  ok(/acctCostName: ownerCostName/.test(code),
     'the widget hands meterStream the owner’s own ledger', true);
  ok(/counter\(env, acctCostName, \{ op: 'incr'/.test(code),
     'and the metering increments it', true);
}

globalThis.fetch = realFetch;
if (report('a-ceiling-that-twenty-requests-cannot-walk-through') > 0) process.exitCode = 1;
done();
