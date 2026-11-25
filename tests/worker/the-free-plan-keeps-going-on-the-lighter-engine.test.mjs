/* THE FREE PLAN KEEPS GOING ON THE LIGHTER ENGINE (owner, Nov 25).

   Free was 25 messages every five hours, then a wall. Now: 25 on the
   standard engine, then up to 100 more in the same five hours on the
   lightest engine - and tokens on that engine count at what they cost (a
   quarter), so the light messages do not empty the day. Driven through the
   Worker's own /v1/messages with only the model stood in for:

   - the first 25 run on the engine that was asked for;
   - the 26th is answered by the lightest engine, and the response says so
     (X-AMV-Engine, X-AMV-Engine-Why) - never passed off as the one chosen;
   - a token on it counts a quarter of a standard one against the day;
   - the window holds 125, and the 126th is refused with when it reopens;
   - a paid plan is never moved to the lighter engine by this;
   - Usage reports the window as 25 standard and 100 light. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';
import { sessionOp } from '../lib/session-op.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'freelight.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, ENGINES, PLAN_LIMITS, LIGHT_ENGINE_KEY };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const upstream = [];
const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":120,"output_tokens":0}}}\n\n'
  + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
  + 'data: {"type":"message_delta","usage":{"output_tokens":80}}\n\n'
  + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url, init) => {
  if (/model\.example/.test(String(url))) { try { upstream.push(JSON.parse(init.body).model); } catch (e) {} return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); }
  return new Response('{}', { status: 200 });
};
function mkEnv() {
  const m = new Map(), vals = new Map();
  let chain = Promise.resolve();
  const serialise = (fn) => (chain = chain.then(fn, fn));
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a',
    APP_URL: 'https://amv.test', GLOBAL_DAILY_USD_CAP: '100000', _vals: vals,
    AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: withAuthOps({ idFromName: (n) => n, get: (n) => ({ fetch(_u, init) { return serialise(async () => {
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      const r = (o) => new Response(JSON.stringify(o));
      { const so = sessionOp(vals, n, b); if (so) return r(so); }
      if (b.op === 'reserve') { const amt = Number(b.amount); if (b.cap != null && cur + amt > b.cap) return r({ allowed: false, value: cur }); vals.set(n, cur + amt); return r({ allowed: true, value: cur + amt }); }
      if (b.op === 'incr') { vals.set(n, Math.max(0, cur + (b.amount || 0))); return r({ value: vals.get(n) }); }
      if (b.op === 'checkCap') return r({ allowed: b.cap == null || cur < b.cap, value: cur });
      if (b.op === 'rateCheck') return r({ allowed: true });
      if (b.op === 'get') return r({ value: cur });
      return r({ allowed: true, value: cur });
    }); } }) }),
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { const p = this._p || []; this._p = []; await Promise.all(p); } };
let ipN = 1;
const call = (env, path, body, tok, method) => worker.fetch(new Request('https://api.amv.test' + path, { method: method || 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '42.0.' + (ipN % 250) + '.' + (ipN++ % 200 + 1) }, tok ? { Authorization: 'Bearer ' + tok } : {}),
  body: method === 'GET' ? undefined : JSON.stringify(body || {}) }), env, ctx);
async function account(env, email, plan) {
  const tok = (await (await call(env, '/auth/signup', { email, name: 'C', password: 'A-real-Passw0rd!' })).json()).token;
  if (plan !== 'free') await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const ask = async (env, tok) => {
  const r = await call(env, '/v1/messages', { model: 'amv-core', max_tokens: 400, messages: [{ role: 'user', content: 'hi' }] }, tok);
  const out = { status: r.status, engine: r.headers.get('X-AMV-Engine'), why: r.headers.get('X-AMV-Engine-Why') || '' };
  if (r.status === 200) await r.text(); else out.d = await r.json().catch(() => ({}));
  await ctx.settle();
  return out;
};
const dayKey = (env, email) => [...env._vals.keys()].find(k => k.startsWith('usg:' + email + ':') && /\d{4}-\d{2}-\d{2}$/.test(k));

const env = mkEnv();
const EMAIL = 'free-light@example.com';
const tok = await account(env, EMAIL, 'free');
const LIGHT = W.LIGHT_ENGINE_KEY;

section('The first 25 run on the engine that was asked for');
{
  const res = [];
  for (let i = 0; i < 25; i++) res.push(await ask(env, tok));
  ok(res.every(r => r.status === 200), 'all 25 answered', res.filter(r => r.status !== 200).slice(0, 2));
  ok(res.every(r => r.engine === 'amv-core'), 'all on the standard engine', [...new Set(res.map(r => r.engine))]);
  ok(upstream.length === 25 && upstream.every(m => m === W.ENGINES['amv-core'].model), 'and that is the engine the model was asked to run', [...new Set(upstream)]);
}

let usedBefore = 0;
section('The 26th is answered by the lighter engine, and says so');
{
  usedBefore = env._vals.get(dayKey(env, EMAIL)) || 0;
  const r = await ask(env, tok);
  ok(r.status === 200 && r.engine === LIGHT, 'answered, by ' + LIGHT, r);
  ok(/25 standard messages/.test(r.why) && /lighter engine/.test(r.why), 'with the reason in the response, not passed off as the one chosen', r.why);
  ok(upstream[upstream.length - 1] === W.ENGINES[LIGHT].model, 'the model really asked was the lighter one', upstream[upstream.length - 1]);
}

section('A token on the lighter engine counts a quarter of a standard one');
{
  const after = env._vals.get(dayKey(env, EMAIL)) || 0;
  const delta = after - usedBefore;
  ok(delta === Math.ceil(200 * 0.25), 'the 200 tokens it used counted as 50 against the day', { usedBefore, after, delta });
  ok(Math.abs(usedBefore - 25 * 200) <= 1, 'where each standard message counted all 200', usedBefore);
}

section('The window holds 125, and the 126th is refused with when it reopens');
{
  let last = null, n = 26;
  for (; n < 125; n++) { last = await ask(env, tok); if (last.status !== 200) break; }
  ok(n === 125 && last.status === 200 && last.engine === LIGHT, 'messages 27 to 125 answered on the lighter engine', { n, last });
  const over = await ask(env, tok);
  ok(over.status === 429 && over.d.code === 'quota_window' && over.d.resetAt > Date.now(), 'the 126th is refused, with the time it reopens', over);
}

section('Usage says the window is 25 standard and 100 light');
{
  const r = await call(env, '/v1/usage', null, tok, 'GET');
  const d = await r.json().catch(() => ({}));
  const w5 = d.window5h || {};
  ok(w5.limit === 125 && w5.standard === 25 && w5.light === 100 && w5.used === 125, 'limit 125: 25 standard, then 100 light - all used', w5);
}

section('A paid plan is never moved to the lighter engine');
{
  const proTok = await account(env, 'pro-light@example.com', 'pro');
  upstream.length = 0;
  const res = [];
  for (let i = 0; i < 30; i++) res.push(await ask(env, proTok));
  ok(res.every(r => r.status === 200 && r.engine === 'amv-core' && !r.why), 'thirty Pro messages, every one on the engine asked for', [...new Set(res.map(r => r.engine))]);
  ok(!W.PLAN_LIMITS.pro.messages5hLight && !W.PLAN_LIMITS.pro.costWeighted, 'Pro has no light messages and no weighting', W.PLAN_LIMITS.pro);
}

report();
done();
