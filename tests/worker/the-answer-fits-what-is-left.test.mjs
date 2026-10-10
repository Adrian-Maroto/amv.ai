/* THE ANSWER FITS WHAT IS LEFT, RATHER THAN THE QUESTION BEING REFUSED.

   The proxy books the longest answer a request allows before calling the
   model. On the free plan that was a 16,000-token ceiling plus AMV's own
   instructions against a 20,000-token day - so once the instructions grew by a
   few lines (tables, cards), a brand-new free account was told "Daily usage
   limit reached" on its FIRST message, having used nothing.

   Now the answer's ceiling is lowered to what remains, never below a floor
   that leaves room for a real answer, and the same lowered number is what the
   model is sent. Checked by running the Worker:

   - a fresh free account with long instructions is answered, its ceiling
     lowered, and the day never booked past its cap;
   - a day with only a little left is answered with a little;
   - a day with less than the floor left is still refused;
   - a request that fits is left exactly as asked;
   - no max_tokens reserves the engine's ceiling, which is what it is sent;
   - the month is fitted the same way, and the day is given back the gap. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'answerfits.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, todayKey, ANSWER_FLOOR_TOKENS, PLAN_LIMITS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const PW = 'A-real-Passw0rd!';
const DAY = W.PLAN_LIMITS.free.dayTokens;
const MONTH = W.PLAN_LIMITS.free.monthTokens;
const FLOOR = W.ANSWER_FLOOR_TOKENS;

/* What the model was sent, call by call. */
let sent = [];
const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
          + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
          + 'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n'
          + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url, init) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  sent.push(JSON.parse(init.body));
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

/* The counter records the highest value each name ever held, so "never past
   the cap" is measured at the moment of booking, not after reconciliation
   has given most of it back. */
function mkEnv() {
  const m = new Map(); const vals = new Map(); const peak = new Map();
  const set = (n, v) => { vals.set(n, v); peak.set(n, Math.max(peak.get(n) || 0, v)); };
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    _vals: vals, _peak: peak, _set: set,
    AMV_KV: {
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
        const r = (o) => new Response(JSON.stringify(o));
        if (b.op === 'reserve') {
          if (b.cap != null && b.cap !== Infinity && cur + b.amount > b.cap) return r({ allowed: false, value: cur });
          set(n, cur + b.amount); return r({ allowed: true, value: cur + b.amount });
        }
        if (b.op === 'incr') { set(n, cur + b.amount); return r({ value: vals.get(n) }); }
        if (b.op === 'get') return r({ value: cur });
        if (b.op === 'checkCap') return r({ allowed: b.cap == null || cur < b.cap, value: cur });
        if (b.op === 'rateCheck') return r({ allowed: true });
        if (b.op === 'claim') return r({ claimed: true });
        return r({ allowed: true, value: cur });
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); this._p = []; } };
const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '41.41.41.41' }, headers || {}),
  body: JSON.stringify(body),
}), env, ctx);

let n = 0;
async function freeAccount(env) {
  const email = `free${++n}@example.com`;
  const r = await call(env, '/auth/signup', { email, name: 'F', password: PW });
  return { email, tok: (await r.json()).token };
}
/* ~4,000 tokens of instructions by the proxy's own estimate (chars / 4), the
   size AMV's prompt reached when tables and cards were added. */
const LONG = 'Answer carefully. '.repeat(Math.ceil(16000 / 18)).slice(0, 16000);
const ask = (env, tok, extra) => call(env, '/v1/messages',
  Object.assign({ model: 'amv-core', stream: true, system: LONG, max_tokens: 16000,
                  messages: [{ role: 'user', content: 'hello' }] }, extra || {}),
  { Authorization: 'Bearer ' + tok });
const dayKey = (email) => `usg:${email}:${W.todayKey()}`;
const monthKey = (env, email) => [...env._vals.keys()].find(k => k.startsWith(`usg:${email}:`) && k !== dayKey(email));

section('A new free account with long instructions is answered, not refused');
{
  const env = mkEnv(); sent = [];
  const { email, tok } = await freeAccount(env);
  const r = await ask(env, tok);
  await ctx.settle();
  ok(r.status === 200, 'the first message is served', r.status);
  const mt = sent[0] && sent[0].max_tokens;
  ok(mt >= FLOOR && mt < 16000, 'with the answer’s ceiling lowered to what the day has room for', mt);
  ok((env._peak.get(dayKey(email)) || 0) <= DAY, 'and the day was never booked past its cap', env._peak.get(dayKey(email)));
}

section('A day with a little left gets a little');
{
  const env = mkEnv(); sent = [];
  const { email, tok } = await freeAccount(env);
  env._set(dayKey(email), DAY - 4000 - 5000);   // instructions ~4,000 + 5,000 of room
  const r = await ask(env, tok);
  await ctx.settle();
  const mt = sent[0] && sent[0].max_tokens;
  ok(r.status === 200 && mt >= FLOOR && mt <= 5000, 'served, with an answer no bigger than the room', { status: r.status, mt });
  ok((env._peak.get(dayKey(email)) || 0) <= DAY, 'still inside the cap', env._peak.get(dayKey(email)));
}

section('Less than the floor left is still refused');
{
  const env = mkEnv(); sent = [];
  const { email, tok } = await freeAccount(env);
  env._set(dayKey(email), DAY - 4000 - (FLOOR - 500));
  const before = env._vals.get(dayKey(email));
  const r = await ask(env, tok);
  const d = r.status === 429 ? await r.json() : {};   // a served answer is a stream, not JSON
  await ctx.settle();
  ok(r.status === 429 && d.code === 'quota_day', 'refused as the day being used up', { status: r.status, d });
  ok(sent.length === 0, 'the model is never called', sent.length);
  ok(env._vals.get(dayKey(email)) === before, 'and nothing is left booked', env._vals.get(dayKey(email)));
}

section('A request that fits is left exactly as asked');
{
  const env = mkEnv(); sent = [];
  const { tok } = await freeAccount(env);
  const r = await ask(env, tok, { system: 'Be brief.', max_tokens: 700 });
  await ctx.settle();
  ok(r.status === 200 && sent[0].max_tokens === 700, 'max_tokens is untouched', sent[0] && sent[0].max_tokens);
}

section('No max_tokens books the ceiling the model is actually sent');
{
  const env = mkEnv(); sent = [];
  const { email, tok } = await freeAccount(env);
  const body = { model: 'amv-core', stream: true, system: 'Be brief.', messages: [{ role: 'user', content: 'hello' }] };
  const r = await call(env, '/v1/messages', body, { Authorization: 'Bearer ' + tok });
  const bookedAtCall = env._vals.get(dayKey(email)) || 0;
  await ctx.settle();
  ok(r.status === 200, 'served', r.status);
  ok(bookedAtCall >= sent[0].max_tokens, 'the reservation covers the ceiling it was sent - not a flat 1,024', { bookedAtCall, sent: sent[0].max_tokens });
}

section('The month is fitted the same way, and the day is given the gap back');
{
  const env = mkEnv(); sent = [];
  const { email, tok } = await freeAccount(env);
  await ask(env, tok, { system: 'Be brief.', max_tokens: 50 });   // creates the month counter so its name is known
  await ctx.settle();
  const mk = monthKey(env, email);
  ok(!!mk, 'the month counter is found', mk);
  const dayBefore = env._vals.get(dayKey(email)) || 0;
  env._set(mk, MONTH - 4000 - 3000);
  sent = [];
  const r = await ask(env, tok);
  const dayAtCall = (env._vals.get(dayKey(email)) || 0) - dayBefore;
  const monthAtCall = env._vals.get(mk) - (MONTH - 4000 - 3000);
  await ctx.settle();
  const mt = sent[0] && sent[0].max_tokens;
  ok(r.status === 200 && mt >= FLOOR && mt <= 3000, 'served with what the month has room for', { status: r.status, mt });
  ok(dayAtCall === monthAtCall, 'and the day holds exactly what the month does, not the larger first booking', { dayAtCall, monthAtCall });
  ok((env._peak.get(mk) || 0) <= MONTH, 'the month never passed its cap', env._peak.get(mk));
}

if (report('the-answer-fits-what-is-left') > 0) process.exitCode = 1;
done();
