/* THE ONE CHANNEL THAT SPENT MONEY AND NEVER REPORTED IT.

   `/sms/incoming` runs a model turn for every text somebody sends. Before it
   does, it checks the account against its monthly dollar ceiling - the same
   ceiling chat, images and video are measured against.

   Nothing ever told that ceiling an SMS turn had happened. The counter was read
   and never written, so for an account that used AMV only by text it held zero
   for ever and the ceiling could not be reached by any amount of use. The check
   was real, ran on every message, and could not fire.

   That is the same shape as a fraud signal reading a field nobody writes, or a
   sweep whose pattern never matches: a control that reads as a control and has
   no path to a refusal. They are hard to see because passing and being absent
   look identical.

   What actually bounded the bill was a per-number daily message cap. That is a
   count, not money, and it does not care how many numbers are linked to one
   account or what each turn costs.

   And it made the owner's own numbers wrong in the same stroke. The founder
   dashboard splits spend by feature; SMS was not a line on it, so the cost was
   not small - it was absent. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'smscost.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, ENGINES, todayKey, monthKey, verifyTwilioSignature };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const TOKEN = 'twilio-auth-token';
const PHONE = '+15550001111';
const USER = 'texter@example.com';

/* Real token counts, so the dollar figure below is arithmetic on the published
   rate rather than a number this file invented. */
const IN_TOK = 1200, OUT_TOK = 300;
const realFetch = globalThis.fetch;
let modelCalls = 0;
globalThis.fetch = async (url) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  modelCalls++;
  return new Response(JSON.stringify({
    content: [{ type: 'text', text: 'here you go' }],
    usage: { input_tokens: IN_TOK, output_tokens: OUT_TOK },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

function mkEnv() {
  const m = new Map(); const vals = new Map(); modelCalls = 0;
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', APP_URL: 'https://amv.test', TWILIO_AUTH_TOKEN: TOKEN,
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
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const cur = vals.get(n) || 0;
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'reserve') {
          if (b.cap != null && cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount }));
        }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: b.cap == null || cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };

/* A properly signed Twilio webhook, built with the Worker's own verifier's
   rules - an unsigned one is rejected before any of this is reached, so a case
   that forgot to sign would prove nothing and look like it passed. */
async function sms(env, body) {
  const url = 'https://api.amv.test/sms/incoming';
  const params = { From: PHONE, Body: body };
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const k of sorted) data += k + params[k];
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TOKEN),
                                            { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sig = Buffer.from(new Uint8Array(mac)).toString('base64');
  return worker.fetch(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig,
               'CF-Connecting-IP': '7.7.7.7' },
    body: new URLSearchParams(params).toString(),
  }), env, ctx);
}

async function linked(env, plan) {
  env.AMV_KV._map.set('acct:' + USER, JSON.stringify({ email: USER, name: 'T', createdAt: Date.now() }));
  await W.DB.put(env, 'ent', USER, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  env.AMV_KV._map.set(`sms:phone:${PHONE}`, USER);
}

const costKeys = (env) => [...env._vals.keys()].filter(k => k.startsWith('cost:'));
const spendOf = (env, prefix) => [...env._vals.entries()]
  .filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);

/* What one turn costs, from the rate table rather than a literal. */
const eng = W.ENGINES['amv-pulse'];
const EXPECTED = (IN_TOK / 1e6) * eng.inCost + (OUT_TOK / 1e6) * eng.outCost;

section('The message is answered, so the rest of the file is measuring a real turn');
{
  const env = mkEnv();
  await linked(env, 'pro');
  const r = await sms(env, 'what is on my list');
  await ctx.settle();
  ok(r.status === 200, 'a signed message is served', r.status);
  ok(modelCalls === 1, 'and the model really ran', modelCalls);
  const body = await r.text();
  ok(/here you go/.test(body), 'with the answer sent back as TwiML', body.slice(0, 80));
}

section('And the turn is charged against the ceiling it was checked against');
{
  const env = mkEnv();
  await linked(env, 'pro');
  await sms(env, 'hello');
  await ctx.settle();

  /* The counter the block above `runSmsAgent` reads with checkCap. Same key,
     or the check is measuring a different account's spend. */
  const keys = costKeys(env);
  ok(keys.length === 1, 'exactly one account cost counter moved', keys);
  const v = env._vals.get(keys[0]);
  ok(Math.abs(v - EXPECTED) < 1e-9,
     'by the published rate for the tier SMS runs on', { recorded: v, expected: EXPECTED });
}

section('Ten messages cost ten times as much, so the ceiling is reachable');
{
  /* The failure was not "slightly under-counted", it was "cannot move". A
     single increment could be a fluke of ordering; a proportional one cannot. */
  const env = mkEnv();
  await linked(env, 'pro');
  for (let i = 0; i < 10; i++) await sms(env, 'message ' + i);
  await ctx.settle();
  const v = spendOf(env, 'cost:');
  ok(Math.abs(v - EXPECTED * 10) < 1e-9, 'ten turns cost ten turns', { recorded: v, oneTurn: EXPECTED });
}

section('An account already at its ceiling is refused before the model runs');
{
  /* The other half of the same control. Recording spend is only worth having
     if reaching the ceiling stops the spending. */
  const env = mkEnv();
  await linked(env, 'pro');
  await sms(env, 'first');            // establishes the counter key
  await ctx.settle();
  const key = costKeys(env)[0];
  env._vals.set(key, 1e9);            // far past any plan ceiling
  const before = modelCalls;

  const r = await sms(env, 'second');
  await ctx.settle();
  ok(modelCalls === before, 'no model call is made', modelCalls - before);
  const body = await r.text();
  ok(/allowance|resets/i.test(body), 'and the person is told why, in a text they can read', body.slice(0, 140));
}

section('It shows up as its own line in what the owner reads');
{
  /* A cost folded into another feature's total is a cost the owner cannot
     manage. SMS is the channel with a per-message carrier fee on top, so it is
     the one worth seeing separately. */
  const env = mkEnv();
  await linked(env, 'pro');
  await sms(env, 'hello');
  await ctx.settle();

  ok(Math.abs(spendOf(env, 'featcost:sms:') - EXPECTED) < 1e-9,
     'the per-feature split has an sms line', spendOf(env, 'featcost:sms:'));
  ok(Math.abs(spendOf(env, 'costtotal:') - EXPECTED) < 1e-9,
     'and it is inside the platform total the dashboard reports', spendOf(env, 'costtotal:'));
  ok(Math.abs(spendOf(env, 'spend:') - EXPECTED) < 1e-9,
     'and inside the day’s spend, which the daily kill ceiling reads', spendOf(env, 'spend:'));
}

section('A free account is bounded too');
{
  /* The case that mattered most: no plan, no plan ceiling, and the daily
     message cap as the only limit. */
  const env = mkEnv();
  await linked(env, 'free');
  await sms(env, 'hello');
  await ctx.settle();
  ok(spendOf(env, 'cost:') > 0, 'a free turn is counted as spend', spendOf(env, 'cost:'));
  ok(costKeys(env).length === 1, 'against exactly one counter', costKeys(env));
}

section('The recording goes through the one helper that knows every ledger');
{
  /* Written by hand it would have landed in the account counter and missed the
     platform total and the feature split, which is precisely the mistake
     _recordSpend exists to have already made once. */
  const i = src.indexOf('async function smsIncoming');
  const fn = codeOnly(src.slice(i, src.indexOf('async function runSmsAgent')));
  ok(/_recordSpend\(/.test(fn), 'smsIncoming records spend through the shared helper', true);
  ok(/'sms'/.test(fn), 'tagged as sms', true);

  /* And it is recorded AFTER the turn, not before - charging for a call that
     was never made is the mirror-image bug. */
  const iRun = fn.indexOf('runSmsAgent(');
  const iRec = fn.indexOf('_recordSpend(');
  ok(iRun > -1 && iRec > iRun, 'after the model answered, not before it was asked',
     { ran: iRun, recorded: iRec });
}

section('A turn that failed is not charged');
{
  /* If the provider throws there is nothing to bill for, and the person still
     needs an answer they can read. */
  const env = mkEnv();
  await linked(env, 'pro');
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (/model\.example/.test(String(url))) throw new TypeError('fetch failed');
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const r = await sms(env, 'hello');
  await ctx.settle();
  globalThis.fetch = saved;

  ok(r.status === 200, 'the sender still gets a reply', r.status);
  ok(/went wrong/i.test(await r.text()), 'saying it failed rather than nothing', true);
  ok(spendOf(env, 'cost:') === 0, 'and nothing is charged for it', spendOf(env, 'cost:'));
}

globalThis.fetch = realFetch;
if (report('a-text-message-costs-what-it-costs') > 0) process.exitCode = 1;
done();
