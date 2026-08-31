/* EFFORT IS A SPEND LEVER, SO A PICKER FOR IT IS A WAY TO SPEND SOMEBODY
   ELSE'S MONEY UNLESS THE PLAN BOUNDS IT.

   Effort decides how hard the engine thinks, which decides what the call
   costs AMV. It used to be fixed per engine, which made it safe and made a
   control for it decoration. Making the control real opens exactly one hole
   worth caring about: a free account asking for the setting an Elite account
   pays for.

   THE TRAP THIS FILE HAD TO AVOID. Every assertion below reads what was
   actually SENT UPSTREAM, not what the route answered. A clamp that returns
   200 while forwarding the caller's own value is the failure being guarded
   against, and a status code cannot see it. The request body the worker
   handed to the model is captured and read.

   Down is deliberately not gated. Asking for less can only reduce the bill,
   and a control that refuses to save money reads as an upsell rather than a
   tool. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'effort.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { DB, ENGINES, _resolveEffort, PLAN_RANK };\n');
const W = await import(harness + '?t=' + Date.now());

/* A minimal event stream, so the route completes rather than erroring on a
   body it cannot read. */
const sse = () => 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
  + 'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n'
  + 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

let sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!/model\.example/.test(String(url))) return new Response('{}', { status: 200 });
  try { sent.push(JSON.parse(init.body)); } catch (e) { sent.push(null); }
  return new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    GLOBAL_DAILY_USD_CAP: '100000',
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body || '{}');
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + Number(b.amount || 0)); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      return new Response(JSON.stringify({ allowed: true, value: cur, count: 1 }));
    } }) },
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body),
}), env, ctx);

async function account(plan) {
  const env = mkEnv();
  const email = plan + '@example.com';
  const r = await call(env, '/auth/signup', { email, name: 'E', password: 'A-real-Passw0rd!' });
  const tok = (await r.json()).token;
  if (plan !== 'free') {
    await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  }
  return { env, tok };
}
/* What the model was actually asked to do, for the last call made. */
const askFor = async (a, model, effort) => {
  sent = [];
  const r = await call(a.env, '/v1/messages',
    { model, max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }],
      ...(effort === undefined ? {} : { effort }) }, a.tok);
  const last = sent[sent.length - 1];
  return { status: r.status,
           effort: last && last.output_config ? last.output_config.effort : undefined,
           hasConfig: !!(last && last.output_config),
           header: r.headers.get('X-AMV-Effort'),
           reached: sent.length > 0 };
};

section('A free account cannot buy the setting an Elite account pays for');
{
  const free = await account('free');
  const got = await askFor(free, 'amv-core', 'high');
  ok(got.status === 200, 'the request is answered rather than refused', got.status);
  ok(got.effort === 'medium',
     'but what reached the model is the plan’s ceiling, not the ask', got.effort);
  ok(got.header === 'medium',
     'and the response says what really ran, so the picker cannot report a wish',
     got.header);
}

section('Asking for less is allowed for everybody, because it can only save money');
{
  const elite = await account('elite');
  const got = await askFor(elite, 'amv-core', 'medium');
  ok(got.effort === 'medium', 'a lower setting is honoured as asked', got.effort);

  /* On the deep engine the engine's own setting is already the top, so this
     is the case where the control exists only to spend less. */
  const ultra = await account('ultra');
  const down = await askFor(ultra, 'amv-forge', 'medium');
  ok(down.effort === 'medium',
     'and on the deepest engine it is the way to run a turn cheaper', down.effort);
}

section('Elite and above really can raise it, or the control is an upsell that lies');
{
  const elite = await account('elite');
  const got = await askFor(elite, 'amv-core', 'high');
  ok(got.effort === 'high', 'a plan that pays for it gets it', got.effort);
}

section('Saying nothing leaves the engine exactly as it was');
{
  const free = await account('free');
  const got = await askFor(free, 'amv-core', undefined);
  ok(got.effort === 'medium', 'the engine’s own setting still goes out', got.effort);

  /* The engine with no effort at all must not acquire one. Sending the field
     to a model that does not take it is a 400 on a live request. */
  const pulse = await askFor(free, 'amv-pulse', 'high');
  ok(pulse.hasConfig === false,
     'and an engine that takes no effort is still sent none', pulse.hasConfig);
}

section('A value AMV does not recognise is refused, not quietly swapped');
{
  const free = await account('free');
  sent = [];
  const r = await call(free.env, '/v1/messages',
    { model: 'amv-core', max_tokens: 1000, effort: 'maximum',
      messages: [{ role: 'user', content: 'hi' }] }, free.tok);
  ok(r.status === 400, 'an unknown effort is a bad request', r.status);
  ok(sent.length === 0, 'and nothing was spent finding that out', sent.length);
}

section('The rule itself, on every engine and every plan');
{
  /* The route checks above cover the path somebody actually takes. This
     covers the whole table, so a new engine or plan cannot quietly land
     outside the rule. */
  let bad = [];
  for (const [key, eng] of Object.entries(W.ENGINES)) {
    for (const [plan, rank] of Object.entries(W.PLAN_RANK)) {
      for (const want of ['medium', 'high', undefined]) {
        const got = W._resolveEffort(eng, want, rank);
        if (!eng.effort) { if (got !== null) bad.push(`${key}/${plan}/${want}: ${got}`); continue; }
        /* Never above what the engine itself runs at, and never above the
           engine's own setting unless the plan is Elite or better. */
        const ceiling = rank >= W.PLAN_RANK.elite ? 'high' : eng.effort;
        const rankOf = { medium: 0, high: 1 };
        if (rankOf[got] > rankOf[ceiling]) bad.push(`${key}/${plan}/${want}: ${got} > ${ceiling}`);
      }
    }
  }
  ok(bad.length === 0, 'no engine and plan combination can exceed its ceiling', bad.slice(0, 4));
}

globalThis.fetch = realFetch;
if (report('effort-cannot-outrun-the-plan') > 0) process.exitCode = 1;
done();
