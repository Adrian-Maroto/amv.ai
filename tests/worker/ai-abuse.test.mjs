/* AI ABUSE CONTROLS (AMV-022, AMV-023).

   AMV-022  the public widget had no per-visitor throttle, so one caller could
            drain the widget's whole daily budget in a burst.
   AMV-023  image generation used get-then-incr (racy) and never refunded on a
            provider failure, so failures permanently burned quota. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ai-abuse.harness.mjs');
writeFileSync(harness, src + '\nexport { imageMeter, imageGenerate, widgetChat, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const mkEnv = (extra = {}) => ({
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  },
  ...extra,
});
const tok = async (env, email) => (await W.issueTokens(env, email, 'U')).token;
const imgCtr = () => { const k = [...store.keys()].find(x => x.startsWith('ctr:img:')); return k ? parseFloat(store.get(k)) : 0; };

/* ── AMV-023: image reservation is atomic and refunded on failure ──────── */
section('AMV-023: image quota is atomic + refunded on provider failure');
{
  store.clear();
  const env = mkEnv({ IMAGE_API_URL: 'https://img.example', IMAGE_API_KEY: 'k' });
  const t = await tok(env, 'u@x.com');   // free plan → imagesDay 8
  const realFetch = globalThis.fetch;
  const gen = (b) => new Request('https://api/v1/image/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(b) });
  // provider FAILS → 502 and quota is refunded (back to 0)
  globalThis.fetch = async () => ({ ok: false, status: 502, text: async () => 'boom', json: async () => ({}) });
  let r = await W.imageGenerate(gen({ prompt: 'a cat' }), env);
  ok(r.status === 502, 'a provider failure returns 502', r.status);
  ok(imgCtr() === 0, 'the failed image is refunded (quota back to 0)', imgCtr());
  // provider SUCCEEDS → 200 and exactly one is consumed
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ url: 'https://img.example/1.png' }] }) });
  r = await W.imageGenerate(gen({ prompt: 'a dog' }), env);
  ok(r.status === 200, 'a successful image returns 200', r.status);
  ok(imgCtr() === 1, 'a successful image consumes exactly one from quota', imgCtr());
  globalThis.fetch = realFetch;
}

section('AMV-023: image meter denies past the daily cap (no overshoot)');
{
  store.clear();
  const env = mkEnv();
  const t = await tok(env, 'v@x.com');   // free → 8/day
  const meter = () => new Request('https://api/v1/image', { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
  let allowed = 0, denied = 0;
  for (let i = 0; i < 10; i++) { const r = await W.imageMeter(meter(), env); (r.status === 200 ? allowed++ : denied++); }
  ok(allowed === 8 && denied === 2, 'exactly 8 images allowed on the free plan, then denied', { allowed, denied });
}

/* ── AMV-022: the public widget throttles per visitor ──────────────────── */
section('AMV-022: public widget throttles a single visitor');
{
  store.clear();
  const env = mkEnv();
  store.set('widget:wk1', JSON.stringify({ key: 'wk1', enabled: true, origins: ['https://site.example'], model: 'amv-core', systemPrompt: '', maxOut: 256, dailyMsgCap: 0, dailySpendCapUSD: 0 }));
  const realFetch = globalThis.fetch;
  const ctx = { waitUntil: () => {} };
  const makeBody = () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: message\ndata: {}\n\n')); c.close(); } });
  globalThis.fetch = async () => ({ ok: true, status: 200, body: makeBody(), json: async () => ({}), headers: { get: () => null } });
  const wreq = () => new Request('https://api/v1/widget/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site.example', 'CF-Connecting-IP': '9.9.9.9' }, body: JSON.stringify({ key: 'wk1', messages: [{ role: 'user', content: 'hi' }] }) });
  let throttled = 0, ok200 = 0;
  for (let i = 0; i < 20; i++) { const r = await W.widgetChat(wreq(), env, ctx); if (r.status === 429) throttled++; else ok200++; }
  globalThis.fetch = realFetch;
  ok(throttled > 0, 'a burst from one visitor gets throttled (429)', { throttled, ok200 });
  ok(ok200 <= 15, 'no more than the per-minute visitor allowance gets through', ok200);
}

if (report() > 0) process.exitCode = 1;
done();
