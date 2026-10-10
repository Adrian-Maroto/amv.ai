/* SWIFT ANSWERS FAST, OR SAYS IT DID NOT - AND BILLS WHAT RAN.

   amv-swift is a top engine in fast mode, which the provider ships as a beta
   with its own rate limit and twice the standard price. Driven through the
   Worker's own /v1/messages with the provider stood in for:

   - the request upstream carries speed:"fast" and the beta header, and the
     response says it ran fast;
   - a free account cannot reach it (the plan floor is Pro);
   - when fast capacity refuses (429), the same request runs again at standard
     speed, the answer still arrives, the response says "standard", and the
     turn is settled at the standard rate - never the fast one;
   - no other engine ever sends speed or the beta header. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'swift.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, ENGINES, monthKey };\n');
const W = await import(harness + '?t=' + Date.now());

const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1000,"output_tokens":0}}}\n\n'
  + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n'
  + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1000}}\n\n'
  + 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
let calls = [], script = [];
globalThis.fetch = async (url, init) => {
  if (!/model\.example/.test(String(url))) return new Response('{}', { status: 200 });
  const h = init.headers || {};
  calls.push({ body: JSON.parse(init.body), beta: h['anthropic-beta'] || '' });
  const step = script.shift() || 'ok';
  if (step === '429') return new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'fast mode capacity' } }), { status: 429 });
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

function mkEnv() {
  const m = new Map(), vals = new Map();
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    GLOBAL_DAILY_USD_CAP: '100000', _vals: vals,
    AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
      if (b.op === 'reserve') { vals.set(n, cur + Number(b.amount || 0)); return r({ allowed: true, value: vals.get(n) }); }
      if (b.op === 'incr') { vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
      if (b.op === 'get') return r({ value: cur });
      return r({ allowed: true, value: cur, count: 1 });
    } }) },
  };
}
const waits = [];
const ctx = { waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
const settle = async () => { await Promise.all(waits.splice(0)); };
const call = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '8.8.4.4', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body) }), env, ctx);
async function account(plan) {
  const env = mkEnv(); const email = plan + '-swift@example.com';
  const tok = (await (await call(env, '/auth/signup', { email, name: 'S', password: 'A-real-Passw0rd!' })).json()).token;
  if (plan !== 'free') await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return { env, tok, email };
}
const ask = (a, model) => call(a.env, '/v1/messages', { model, max_tokens: 2000, messages: [{ role: 'user', content: 'hi' }] }, a.tok);
/* What the month's cost counter settled at, in dollars. */
const spent = (a) => [...a.env._vals.entries()].filter(([k]) => k.startsWith('cost:')).reduce((n, [, v]) => n + v, 0);

section('Swift runs fast, and says so');
{
  const pro = await account('pro');
  calls = []; script = ['ok'];
  const r = await ask(pro, 'amv-swift');
  await r.text(); await settle();
  ok(r.status === 200 && r.headers.get('X-AMV-Engine') === 'amv-swift', 'Pro can use it', r.status);
  ok(calls.length === 1 && calls[0].body.speed === 'fast' && /fast-mode/.test(calls[0].beta), 'the request upstream asks for fast mode, with the beta header', calls[0] && { speed: calls[0].body.speed, beta: calls[0].beta });
  ok(r.headers.get('X-AMV-Speed') === 'fast', 'and the response says it ran fast', r.headers.get('X-AMV-Speed'));
  const usd = spent(pro);
  ok(Math.abs(usd - (1000 * 8 + 1000 * 40) / 1e6) < 0.002, 'settled at the fast rate: 1k in at $8/M + 1k out at $40/M = $0.048', usd);
}

section('A free account cannot reach it');
{
  const free = await account('free');
  calls = [];
  const r = await ask(free, 'amv-swift');
  const d = await r.json();
  ok(r.status === 402 && d.code === 'plan_required' && calls.length === 0, 'refused before anything is spent', { status: r.status, d });
}

section('Fast capacity full: the answer still comes, at standard speed and standard price');
{
  const pro = await account('pro');
  calls = []; script = ['429', 'ok'];
  const r = await ask(pro, 'amv-swift');
  const body = await r.text(); await settle();
  ok(r.status === 200 && /hi/.test(body), 'the person still gets an answer', r.status);
  ok(calls.length === 2 && calls[0].body.speed === 'fast' && !('speed' in calls[1].body), 'asked fast first, then the same request without speed', calls.map(c => c.body.speed));
  ok(r.headers.get('X-AMV-Speed') === 'standard', 'and the response says it ran at standard speed', r.headers.get('X-AMV-Speed'));
  const usd = spent(pro);
  ok(Math.abs(usd - (1000 * 4 + 1000 * 20) / 1e6) < 0.002, 'settled at the standard rate ($0.024), not the fast one', usd);
}

section('No other engine sends speed or the beta header');
{
  const elite = await account('elite');
  for (const m of ['amv-pulse', 'amv-core', 'amv-forge', 'amv-apex']) {
    calls = []; script = ['ok'];
    const r = await ask(elite, m); await r.text(); await settle();
    ok(calls.length === 1 && !('speed' in calls[0].body) && !calls[0].beta, m + ' runs at standard speed with no beta header', calls[0] && calls[0].beta);
  }
}

if (report('swift-answers-fast-or-says-it-did-not') > 0) process.exitCode = 1;
done();
