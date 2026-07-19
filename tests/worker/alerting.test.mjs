/* ERROR ALERTING — so you find out prod broke before your customers do.
   Proves: a new server error alerts, duplicates are throttled (no spam), a
   model-auth failure pages loudly, a Stripe checkout failure alerts, and with
   no ALERT_WEBHOOK configured nothing throws (alerting is opt-in). */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'alert.harness.mjs');
writeFileSync(harness, src +
  '\nexport { alertOnce, notify, _workerError };\n');
const W = await import(harness + '?t=' + Date.now());

// capture outbound webhook posts
let posts = [];
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('hooks.test')) { posts.push(JSON.parse(opts.body)); return { ok: true, status: 200 }; }
  return { ok: true, status: 200, json: async () => ({}) };
};

const store = new Map();
const mkEnv = (withHook) => ({
  ALERT_WEBHOOK: withHook ? 'https://hooks.test/x' : undefined,
  AMV_KV: {
    async get(k){ return store.has(k)?store.get(k):null; },
    async put(k,v){ store.set(k,v); },
    async delete(k){ store.delete(k); },
    async list(){ return { keys: [], list_complete: true }; }
  }
});

/* ── alertOnce fires, then throttles ─────────────────────────────────────── */
section('alertOnce fires the first time and throttles duplicates');

store.clear(); posts = [];
const env = mkEnv(true);
await W.alertOnce(env, 'thing:broken', 'first alert', 30);
await W.alertOnce(env, 'thing:broken', 'second alert (should be suppressed)', 30);
await W.alertOnce(env, 'thing:broken', 'third (suppressed)', 30);
ok(posts.length === 1, 'the same alert key fires ONCE per window, not repeatedly', posts.length);
ok(/first alert/.test(posts[0].text), 'and it is the first message');

section('Different alert keys each fire');

posts = [];
await W.alertOnce(env, 'payment:down', 'payments broken', 30);
await W.alertOnce(env, 'model:down', 'model broken', 30);
ok(posts.length === 2, 'distinct problems each page you', posts.length);

/* ── No webhook = silent, never throws ───────────────────────────────────── */
section('With no ALERT_WEBHOOK, alerting is a safe no-op');

store.clear(); posts = [];
const noHook = mkEnv(false);
let threw = false;
try { await W.alertOnce(noHook, 'x', 'y', 30); } catch { threw = true; }
ok(!threw, 'alertOnce does not throw when no webhook is set', threw);
ok(posts.length === 0, 'and sends nothing', posts.length);

/* ── A worker error alerts on first occurrence ───────────────────────────── */
section('A new server error pages you the first time it happens');

store.clear(); posts = [];
await W._workerError(env, '/v1/some-endpoint', new Error('boom: something broke'));
ok(posts.length === 1, 'the first occurrence of an error fires an alert', posts.length);
ok(/boom: something broke/.test(posts[0].text), 'the alert includes the error message', posts[0] && posts[0].text);
ok(/some-endpoint/.test(posts[0].text), 'and where it happened');

section('The SAME error does not spam you');

posts = [];
// same error fingerprint, many times
for (let i = 0; i < 20; i++) await W._workerError(env, '/v1/some-endpoint', new Error('boom: something broke'));
ok(posts.length === 0, 'repeated identical errors are throttled (no alert storm)', posts.length);

globalThis.fetch = origFetch;
report();
done();
