/* THE STAGING DRILL RUNS END TO END (scripts/staging-drill.mjs).

   The drill is what proves a real deployment; this proves the drill. It is
   run here exactly as it runs against staging - through the Worker's own
   routes, over HTTP-shaped requests - with the Worker on local stand-ins
   (the real counter object, one request at a time; KV, R2, the search index
   and the model as local doubles; Stripe answering in test mode). Every step
   that can pass here must pass, both throwaway accounts must be erased at
   the end, and the two refusals that keep it off production must hold. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'drill.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const { runDrill } = await import(join(ROOT, 'scripts', 'staging-drill.mjs'));
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const BASE = 'https://amv-staging.example.workers.dev';
let stripeLive = false;
const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n'
  + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ready"}}\n\n'
  + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n'
  + 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/api\.stripe\.com/.test(u)) { const id = (stripeLive ? 'cs_live_' : 'cs_test_') + 'drill'; return new Response(JSON.stringify({ id, url: 'https://checkout.stripe.com/c/pay/' + id }), { status: 200 }); }
  if (/cloudflare-dns\.com/.test(u)) return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }), { status: 200 });
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

function environment() {
  const kv = new Map(), meta = new Map(), r2 = new Map(), vectors = new Map(), objects = new Map();
  const copy = v => v === undefined ? undefined : structuredClone(v);
  return {
    JWT_SECRET: 'drill-'.repeat(8), ADMIN_TOKEN: 'drill-admin-token-0123456789abcdef', CONNECT_KEY: 'c'.repeat(44),
    APP_URL: 'https://app.example', AMV_MODEL_KEY: 'k', STRIPE_SECRET_KEY: 'sk_test_drill', STRIPE_PRICE_PRO: 'price_pro',
    AMV_KV: {
      async get(k, o) { const v = kv.has(k) ? kv.get(k) : null; return (o === 'json' || (o && o.type === 'json')) && v != null ? JSON.parse(v) : v; },
      async put(k, v, o) { kv.set(k, String(v)); if (o && o.metadata) meta.set(k, o.metadata); },
      async delete(k) { kv.delete(k); meta.delete(k); },
      async list({ prefix = '', limit = 1000, cursor } = {}) { const all = [...kv.keys()].filter(k => k.startsWith(prefix)).sort(); const at = +(cursor || 0);
        const keys = all.slice(at, at + limit).map(name => ({ name, metadata: meta.get(name) })); return { keys, list_complete: at + keys.length >= all.length, cursor: String(at + keys.length) }; },
    },
    AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(u, init) {
      if (!objects.has(n)) { const st = new Map(); objects.set(n, { o: new W.AMVCounter({ storage: { async get(k) { return copy(st.get(k)); }, async put(k, v) { st.set(k, copy(v)); }, async delete(k) { return st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {}), q: Promise.resolve() }); }
      const rec = objects.get(n); const p = rec.q.then(() => rec.o.fetch(new Request(u, init))); rec.q = p.catch(() => {}); return p; } }) },
    AMV_FILES: { async put(k, v) { r2.set(k, String(v)); }, async head(k) { return r2.has(k) ? { size: Buffer.byteLength(r2.get(k)) } : null; },
      async get(k) { return r2.has(k) ? { text: async () => r2.get(k) } : null; }, async delete(ks) { for (const k of [].concat(ks)) r2.delete(k); },
      async list({ prefix = '' } = {}) { return { objects: [...r2.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }; } },
    AI: { async run(_m, { text }) { return { data: text.map(t => [/lease|landlord|tenancy|rent/i.test(t) ? 1 : 0.01, /tax|receipt/i.test(t) ? 1 : 0.01, 0.1]) }; } },
    VECTORS: {
      async upsert(rows) { for (const r of rows) { if (Buffer.byteLength(r.id) > 64) throw new Error('vector id over 64 bytes'); vectors.set(r.id, r); } return { count: rows.length }; },
      async query(v, { topK, namespace, filter }) { const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };
        return { matches: [...vectors.values()].filter(r => r.namespace === namespace && (!filter || r.metadata.a === filter.a)).map(r => ({ id: r.id, score: cos(v, r.values), metadata: r.metadata })).sort((a, b) => b.score - a.score).slice(0, topK) }; },
      async deleteByIds(ids) { for (const id of ids) vectors.delete(id); return { count: ids.length }; } },
    _kv: kv, _r2: r2, _vectors: vectors,
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const through = (env) => async (url, init) => W.default.fetch(new Request(url, Object.assign({}, init, { headers: Object.assign({ 'CF-Connecting-IP': '203.0.113.' + (1 + Math.floor(Math.random() * 200)) }, init.headers) })), env, ctx);

section('Against a deployment with everything on, every step passes and nothing is left behind');
{
  const env = environment();
  const r = await runDrill({ base: BASE, adminToken: env.ADMIN_TOKEN, origin: 'https://app.example', fetch: through(env) });
  const by = Object.fromEntries(r.results.map(x => [x.id, x]));
  const must = ['health', 'invite', 'signup-a', 'signup-b', 'login', 'sync', 'sync-race', 'library', 'file-keep', 'file-same', 'file-race', 'file-long', 'search', 'isolation', 'file-delete', 'model', 'consent', 'stripe', 'erase-a', 'erase-b', 'invite-revoke'];
  const notPassed = must.filter(id => !by[id] || by[id].status !== 'passed').map(id => id + ': ' + (by[id] ? by[id].status + ' ' + by[id].note : 'missing'));
  ok(!notPassed.length, 'every flow passes: accounts, sync, files, search, isolation, model, Stripe test checkout, erasure', notPassed);
  ok(![...env._kv.keys()].some(k => /^(acct|data|lib|wallet):amv-drill/.test(k)) && env._r2.size === 0 && env._vectors.size === 0, 'and both throwaway accounts, their files and their passages are gone', [...env._kv.keys()].filter(k => /amv-drill/.test(k)).slice(0, 5));
}

section('It refuses production, and stops at a live Stripe key');
{
  const r = await runDrill({ base: 'https://amv.homes', adminToken: 'x', fetch: async () => { throw new Error('must not be called'); } });
  ok(!r.ok && /production/.test(r.refused || ''), 'amv.homes is refused before a single request', r.refused);
  const r2 = await runDrill({ base: 'https://api.custom-prod.example', adminToken: 'x', productionHosts: 'custom-prod.example', fetch: async () => { throw new Error('must not be called'); } });
  ok(!r2.ok && /production/.test(r2.refused || ''), 'and so is any host named in AMV_PRODUCTION_HOSTS', r2.refused);
  const env = environment(); stripeLive = true;
  const r3 = await runDrill({ base: BASE, adminToken: env.ADMIN_TOKEN, origin: 'https://app.example', fetch: through(env) });
  stripeLive = false;
  const st = r3.results.find(x => x.id === 'stripe');
  ok(!r3.ok && st && st.status === 'failed' && /LIVE/.test(st.note), 'a checkout that comes back live fails the drill, loudly', st);
  ok(r3.results.filter(x => /^erase-/.test(x.id)).every(x => x.status === 'passed'), 'and the accounts are still erased afterwards');
}

section('A wrong admin token stops it before anything is made');
{
  const env = environment();
  const r = await runDrill({ base: BASE, adminToken: 'wrong', origin: 'https://app.example', fetch: through(env) });
  ok(!r.ok && r.results.find(x => x.id === 'signup-a').status === 'skipped' && ![...env._kv.keys()].some(k => k.startsWith('acct:')), 'no account is made', r.results.map(x => x.id + ':' + x.status));
}

console.log = quiet;
report();
done();
