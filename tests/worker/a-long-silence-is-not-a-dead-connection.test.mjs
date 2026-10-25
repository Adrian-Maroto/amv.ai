/* A LONG SILENCE WHILE THE ENGINE THINKS IS NOT TAKEN FOR A DEAD CONNECTION.

   The newest engines send nothing while they think, and on a hard question
   that is thirty seconds or more. The page gives up on a stream silent for
   30 seconds - a dropped phone connection looks the same - so it said "the
   connection stalled, please retry" about an answer that was still being
   written and billed, and the retry was billed again. The server now sends
   an SSE comment to the browser every AI_KEEPALIVE_MS while the engine is
   silent. Run against the Worker with an engine that thinks in silence:
   - the browser receives a keep-alive inside the silence, as a comment line
     no reader of this stream treats as data;
   - the answer still arrives whole after it;
   - a quick answer gets none - nothing is added when the engine is talking. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'keepalive.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, todayKey, ANSWER_FLOOR_TOKENS, PLAN_LIMITS, AI_KEEPALIVE_MS };\n');
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
let silentMs = 0;
globalThis.fetch = async (url, init) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  sent.push(JSON.parse(init.body));
  const enc = new TextEncoder();
  const parts = sse.split('\n\n').filter(Boolean).map(p => p + '\n\n');
  const body = new ReadableStream({ async start(c) {
    c.enqueue(enc.encode(parts[0]));                        // message_start, then the engine thinks in silence
    await new Promise(r => setTimeout(r, silentMs));
    for (const p of parts.slice(1)) c.enqueue(enc.encode(p));
    c.close();
  } });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
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

async function readTimed(res) {
  const reader = res.body.getReader(); const dec = new TextDecoder();
  const t0 = Date.now(); const got = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; got.push({ at: Date.now() - t0, text: dec.decode(value) }); }
  return got;
}
const ask = (env, tok) => call(env, '/v1/messages', { model: 'amv-core', stream: true, max_tokens: 2000,
  messages: [{ role: 'user', content: 'A hard question' }] }, { Authorization: 'Bearer ' + tok });

section('An engine silent for longer than the keep-alive: the browser hears from AMV meanwhile');
{
  const env = mkEnv(); sent = [];
  const { tok } = await freeAccount(env);
  silentMs = W.AI_KEEPALIVE_MS + 2500;
  const r = await ask(env, tok);
  const got = await readTimed(r);
  await ctx.settle();
  const beats = got.filter(g => /^: keepalive\n\n$/.test(g.text));
  ok(r.status === 200 && beats.length >= 1, 'a keep-alive arrived during the silence', got.map(g => [g.at, g.text.slice(0, 30)]));
  ok(beats.every(b => b.at >= W.AI_KEEPALIVE_MS - 1500 && b.at < silentMs), 'inside the silence, not before it was needed', beats.map(b => b.at));
  const all = got.map(g => g.text).join('');
  ok(/"text":"ok"/.test(all) && /message_stop/.test(all), 'and the whole answer still arrived after it', all.slice(-160));
  ok(all.split('\n').filter(l => l.startsWith(': ')).every(l => l === ': keepalive'), 'every added line is an SSE comment - never a data line a reader would parse', true);
}

section('A quick answer gets no keep-alive');
{
  const env = mkEnv(); sent = [];
  const { tok } = await freeAccount(env);
  silentMs = 50;
  const got = await readTimed(await ask(env, tok));
  await ctx.settle();
  ok(!got.some(g => /keepalive/.test(g.text)), 'nothing added while the engine is talking', got.map(g => g.text.slice(0, 20)));
}

if (report('a-long-silence-is-not-a-dead-connection') > 0) process.exitCode = 1;
done();
