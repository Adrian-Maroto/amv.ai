/* MONITORING FORWARDING - Sentry (errors) + PostHog (product events) are wired
   server-side and stay INERT until you set a secret. Proves: no secret = no
   outbound call (zero behavior change), a real DSN/key produces a correct POST,
   and PostHog ids are pseudonymous so no raw email/IP ever leaves the Worker. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'monitoring.harness.mjs');
writeFileSync(harness, src + '\nexport { _forwardSentry, _sentryEndpoint, _phId, audit };\n');
const W = await import(harness + '?t=' + Date.now());

// capture outbound posts to Sentry / PostHog
let posts = [];
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  posts.push({ url: String(url), body: (() => { try { return JSON.parse(opts.body); } catch { return null; } })(), headers: (opts && opts.headers) || {} });
  return { ok: true, status: 200, json: async () => ({}) };
};

/* ── _phId: pseudonymous, stable, no PII ─────────────────────────────────── */
section('PostHog distinct_id is pseudonymous, stable, and leaks no PII');
const a1 = W._phId('alice@example.com'), a2 = W._phId('alice@example.com'), b = W._phId('bob@example.com');
ok(a1 === a2, 'same user maps to the same id (funnels still work)', a1);
ok(a1 !== b, 'different users map to different ids');
ok(!a1.includes('@') && !/alice/.test(a1), 'the raw email never appears in the id');

/* ── _sentryEndpoint: parses a DSN, safe on garbage ──────────────────────── */
section('Sentry DSN parsing');
const ep = W._sentryEndpoint('https://PUBKEY@o1.ingest.sentry.io/42');
ok(ep && ep.url === 'https://o1.ingest.sentry.io/api/42/store/', 'DSN resolves to the store endpoint', ep && ep.url);
ok(ep && ep.key === 'PUBKEY', 'and extracts the public key');
ok(W._sentryEndpoint('nonsense') === null, 'a malformed DSN returns null (never throws)');

/* ── Sentry forwarding: inert without secret, fires with it ──────────────── */
section('Sentry forwarding is inert until SENTRY_DSN is set');
posts = [];
W._forwardSentry({}, null, { msg: 'boom', where: 'chat', kind: 'error' });
ok(posts.length === 0, 'no SENTRY_DSN -> no outbound call', posts.length);

posts = [];
W._forwardSentry({ SENTRY_DSN: 'https://K@o9.ingest.sentry.io/7' }, null, { msg: 'kaboom', where: 'market', kind: 'error', stack: 'x' });
ok(posts.length === 1, 'with SENTRY_DSN -> exactly one POST', posts.length);
ok(/\/api\/7\/store\/$/.test(posts[0].url), 'posts to the project store endpoint', posts[0] && posts[0].url);
ok((posts[0].headers['X-Sentry-Auth'] || '').includes('sentry_key=K'), 'auth header carries the key');
ok(posts[0].body && posts[0].body.message === 'kaboom', 'payload carries the error message');
let threw = false;
try { W._forwardSentry({ SENTRY_DSN: 'garbage' }, null, { msg: 'x' }); } catch { threw = true; }
ok(!threw, 'a bad DSN never throws (telemetry must not break the request)');

/* ── PostHog via audit(): inert without key, fires with it, no PII ───────── */
section('audit() mirrors business events to PostHog only when POSTHOG_KEY is set');
posts = [];
W.audit({}, 'market_publish', { by: 'seller@x.com', title: 'Thing', price: 9 });
ok(posts.length === 0, 'no POSTHOG_KEY -> no capture call', posts.length);

posts = [];
W.audit({ POSTHOG_KEY: 'phc_test' }, 'market_publish', { by: 'seller@x.com', title: 'Thing', price: 9 });
const cap = posts.find(p => /\/capture\/$/.test(p.url));
ok(!!cap, 'with POSTHOG_KEY -> a capture call fires', posts.map(p => p.url));
ok(cap && cap.body && cap.body.event === 'srv_market_publish', 'event name is namespaced (srv_)', cap && cap.body && cap.body.event);
ok(cap && cap.body && cap.body.api_key === 'phc_test', 'sends the project key');
ok(cap && cap.body && /^u_/.test(cap.body.distinct_id), 'distinct_id is the pseudonymous id', cap && cap.body && cap.body.distinct_id);
const bodyStr = cap ? JSON.stringify(cap.body) : '';
ok(!/seller@x\.com/.test(bodyStr), 'the raw seller email is NOT in the payload (masked)');
ok(cap && cap.body && cap.body.properties && cap.body.properties.title === 'Thing', 'non-PII properties are preserved for analytics');

globalThis.fetch = origFetch;
report();
done();
