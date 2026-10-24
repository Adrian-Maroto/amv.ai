/* A MESSAGE IS MEASURED AGAINST THE ENGINE THAT WILL READ IT.

   Every AMV engine reads a million tokens. The server used to refuse anything
   over 600,000 characters - about 150,000 tokens of English - so a pasted
   report that any engine could read whole was turned away, and the page split
   it into parts that lost the connections between them.

   Now the bound is the engine's own: a request is estimated by script
   (Chinese, Japanese and Korean about a token a character, other text about
   four characters a token) against the engine's context less its output and a
   margin. A request that fits is served. One that does not is refused with a
   sentence and a code BEFORE the rate limit and the reservation, so being too
   long costs nothing - the engine would have refused it anyway, after
   AMV had booked it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'fitscontext.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _fitsContext, _estimateTextTokens, ENGINES };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'dev@example.com';
const PW = 'A-real-Passw0rd!';

let upstreamCalls = 0;
const sse = () => 'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
                + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
                + 'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n'
                + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  upstreamCalls++;
  return new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

function mkEnv() {
  const m = new Map(); const vals = new Map(); upstreamCalls = 0;
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    _vals: vals,
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
        if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount })); }
        if (b.op === 'incr') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: true, value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };

const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '40.40.40.40' }, headers || {}),
  body: JSON.stringify(body),
}), env, ctx);

async function signedIn(env) {
  const r = await call(env, '/auth/signup', { email: USER, name: 'D', password: PW });
  const tok = (await r.json()).token;
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}

const ask = (env, tok, content) => call(env, '/v1/messages',
  { model: 'amv-core', max_tokens: 128, messages: [{ role: 'user', content }] },
  { 'Authorization': 'Bearer ' + tok });
const booked = (env) => [...env._vals.entries()].filter(([k]) => k.startsWith('usg:')).reduce((n, [, v]) => n + v, 0);
const prose = (n) => 'The northern region rose by four percent while the south held. '.repeat(Math.ceil(n / 63) + 1).slice(0, n);
const zh = (n) => '北部地区的季度数据上升了百分之四而南部门店保持稳定'.repeat(Math.ceil(n / 25)).slice(0, n);

section('Every engine says how much it reads, and it is a million tokens');
{
  const keys = Object.keys(W.ENGINES);
  ok(keys.length >= 5 && keys.every(k => W.ENGINES[k].context === 1000000), 'each engine carries its context', keys.map(k => k + ':' + W.ENGINES[k].context));
}

section('Text is counted by script');
{
  ok(W._estimateTextTokens(prose(4000)) === 1000, 'four characters of English is a token', W._estimateTextTokens(prose(4000)));
  ok(W._estimateTextTokens(zh(1000)) === 1000, 'one Chinese character is a token', W._estimateTextTokens(zh(1000)));
  ok(W._estimateTextTokens('한국어') === 3 && W._estimateTextTokens('かな') === 2, 'and so are Korean and Japanese');
}

section('2.5 million characters of English is read whole');
/* ~625,000 tokens: refused outright before, served now. */
{
  const env = mkEnv();
  const tok = await signedIn(env);
  const r = await ask(env, tok, prose(2500000));
  await ctx.settle();
  ok(r.status === 200, 'the turn is served', r.status);
  ok(upstreamCalls === 1 && booked(env) > 0, 'it reached the engine and was booked', { upstreamCalls, booked: booked(env) });
}

section('1.2 million Chinese characters is more than an engine reads, and says so');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  const r = await ask(env, tok, zh(1200000));
  await ctx.settle();
  const raw = await r.text();
  let d = {}; try { d = JSON.parse(raw); } catch (e) { d = { error: raw }; }
  ok(r.status === 413, 'it is refused as too large', r.status);
  ok(d.code === 'too_long_for_engine', 'with a code a client can branch on', d.code);
  ok(d.tokens >= 1200000 && d.room < 1000000, 'carrying the measure and the room', { tokens: d.tokens, room: d.room });
  ok(/can read in one request/.test(d.error) && /in parts/.test(d.error), 'and a sentence saying what to do', d.error);
  ok(upstreamCalls === 0 && booked(env) === 0, 'and it cost nothing: nothing booked, nothing sent', { upstreamCalls, booked: booked(env) });
}

section('A picture counts by its encoded size');
{
  const eng = W.ENGINES['amv-core'];
  const img = { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(4000000) } }] };
  const f = W._fitsContext({ messages: [img] }, eng);
  ok(!f.ok && f.tokens === 1000000, 'four million encoded characters is a million tokens, over the room', f);
  const nested = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(4000000) } }] }] };
  const fn = W._fitsContext({ messages: [nested] }, eng);
  ok(!fn.ok && fn.tokens === 1000000, 'and so does a picture inside a tool result, a screenshot', fn);
  ok(W._fitsContext({ messages: [{ role: 'user', content: 'hi' }] }, {}).room === 200000 - 16000 - 8000,
     'an engine that does not say falls back to 200,000');
}

report();
done();
