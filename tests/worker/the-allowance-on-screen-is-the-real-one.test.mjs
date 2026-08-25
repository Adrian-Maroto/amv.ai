/* THE NUMBER ON THE SCREEN IS THE NUMBER THAT REFUSES YOU.

   A person opens the usage page for one reason: to find out what they have
   left. If that figure is not the one the server enforces, the page is worse
   than blank - they plan around it, and then get refused at a number they were
   never shown, or stop early at a limit that was never real.

   Both failures were live.

   Both failures were live, on the two allowances that no longer exist. The
   images bar was a device-local count against a hardcoded 4 while the real cap
   was 100 a day on Pro - somebody paying was shown a ceiling twenty-five times
   smaller than the one they bought, and told to upgrade while already on the
   top plan. The video allowance was reported by a route no screen read, so it
   was invisible until generation refused.

   Removing image and video generation does not retire the property, it narrows
   it to the allowance that is left and matters most: TOKENS. So this file
   asserts one thing in several ways - every allowance a person can spend is
   reported by the server, from the same counter that enforces it, and moves
   when the plan moves. The reported number is checked by being SPENT, because
   a hardcoded figure that happens to match one plan passes any assertion that
   only reads it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'allowance.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, PLAN_LIMITS, todayKey, _periodKeyOf };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv(extra) {
  const m = new Map(); const vals = new Map();
  return Object.assign({
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    /* Exposed so a test can fill an allowance to a chosen point and watch where
       the refusal lands, rather than making thousands of requests to get there. */
    _counters: vals,
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
        if (b.op === 'reserve') {
          if (b.cap != null && cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) }));
        }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '44.44.44.44',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const PW = 'A-real-Passw0rd!';
const USER = 'spender@example.com';
async function signedIn(env, plan) {
  const tok = (await (await call(env, '/auth/signup', { email: USER, name: 'S', password: PW })).json()).token;
  if (plan) await W.DB.put(env, 'ent', USER, { plan, source: 'stripe', updatedAt: Date.now(), renewedAt: Date.now() });
  return tok;
}

section('Every allowance a person can spend is reported');
{
  const env = mkEnv();
  const tok = await signedIn(env, 'pro');
  const u = (await post(env, '/v1/usage', {}, tok)).body;
  ok(!!u.day && !!u.month, 'the day and the month, with a used and a limit on each', u.day);
  ok(u.day.limit === W.PLAN_LIMITS.pro.dayTokens,
     'and the day\u2019s limit is the plan\u2019s own number', { reported: u.day.limit, plan: W.PLAN_LIMITS.pro.dayTokens });
  ok(u.month.limit === W.PLAN_LIMITS.pro.monthTokens,
     'as is the month\u2019s', { reported: u.month.limit, plan: W.PLAN_LIMITS.pro.monthTokens });
  ok(typeof u.month.costUSD === 'number', 'with what it has cost so far', u.month.costUSD);
}

section('And it is the number the server actually enforces');
{
  /* The point of the whole file. Read the reported limit, fill the counter to
     one token short of it, and require the next turn to be refused - at the
     number the screen showed, not at some other number the handler happens to
     hold. A hardcoded figure on a page cannot pass this, because the fill is
     computed from what the page was told. */
  const env = mkEnv({ AMV_MODEL_KEY: 'sk-test' });
  const tok = await signedIn(env, 'pro');
  const u = (await post(env, '/v1/usage', {}, tok)).body;
  const limit = u.day.limit;
  ok(limit > 0, 'the day\u2019s allowance was reported', limit);

  const ent = await W.DB.get(env, 'ent', USER);
  const dayName = `usg:${USER}:${W.todayKey()}`;
  const chat = () => post(env, '/v1/messages',
    { model: 'amv-core', messages: [{ role: 'user', content: 'hello' }] }, tok);

  /* One token short of the reported limit. Any reservation at all is now more
     than what is left, so the refusal has to come from the allowance rather
     than from anything else that can refuse a turn. */
  env._counters.set(dayName, limit - 1);
  const over = await chat();
  ok(over.status === 429, 'a turn that does not fit the reported allowance is refused', over.status);
  ok(/quota|allowance|limit/i.test(JSON.stringify(over.body)),
     'and says it is the allowance, not something the customer cannot act on', over.body);

  /* And the same request, with the same everything, is NOT refused when the
     counter is empty - so the refusal above is the allowance and not a
     permanent property of this request. */
  env._counters.set(dayName, 0);
  const under = await chat();
  ok(under.status !== 429, 'while the same turn on an empty allowance is not', under.status);
}

section('A bigger plan really is a bigger number');
{
  /* A constant passes every assertion above if it happens to match one plan.
     It cannot survive the plan changing underneath it. */
  const env = mkEnv();
  const tok = await signedIn(env, 'free');
  const free = (await post(env, '/v1/usage', {}, tok)).body;
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', source: 'stripe', updatedAt: Date.now(), renewedAt: Date.now() });
  const ultra = (await post(env, '/v1/usage', {}, tok)).body;

  ok(ultra.day.limit > free.day.limit, 'paying raises the daily allowance', { free: free.day.limit, ultra: ultra.day.limit });
  ok(ultra.month.limit > free.month.limit, 'and the monthly one', { free: free.month.limit, ultra: ultra.month.limit });
  ok(ultra.plan === 'ultra', 'and the screen is told which plan it is reading', ultra.plan);
}

section('A shared allowance says it is shared');
{
  /* Somebody on a team sees usage that is not all theirs. "Used" meaning the
     whole team is a surprise otherwise - they go looking for what they spent
     and find a number they did not spend. */
  const env = mkEnv();
  const tok = await signedIn(env, 'pro');
  const solo = (await post(env, '/v1/usage', {}, tok)).body;
  ok(solo.shared === null, 'an ordinary account is not told about a team it is not on', solo.shared);
}

section('The screen reads those numbers, rather than inventing its own');
{
  /* The defect was never in the Worker - it was a page confidently drawing a
     limit nobody enforced. Checked against the shipped bundle, because that is
     what a person looks at. */
  ok(/d\.day/.test(client) && /d\.month/.test(client),
     'the usage screen reads the reported day and month allowances', true);
  ok(!/Images<\/span><span>'\+ic\+' \/ 4</.test(client),
     'and draws no allowance against a hardcoded number', true);
  ok(!/'\+mc\+' \/ 30</.test(client),
     'nor messages against a hardcoded 30', true);
}

globalThis.fetch = realFetch;
if (report('the-allowance-on-screen-is-the-real-one') > 0) process.exitCode = 1;
done();
