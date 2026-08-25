/* AI ABUSE CONTROLS (AMV-022).

   AMV-022  the public widget had no per-visitor throttle, so one caller could
            drain the widget's whole daily budget in a burst.

   This suite also carried AMV-023 - image generation used get-then-incr, which
   is racy, and never refunded quota when the provider failed. Image generation
   is gone, and so are those two sections. The pattern is not gone: any counter
   that reserves before the work and does not give it back on failure burns
   somebody's allowance for something they never got. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ai-abuse.harness.mjs');
writeFileSync(harness, src + '\nexport { widgetChat, issueTokens };\n');
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
