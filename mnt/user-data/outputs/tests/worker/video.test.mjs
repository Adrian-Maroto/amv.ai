/* VIDEO — it must be REAL.
   This feature was previously a setInterval that faked a progress bar and
   produced nothing. These tests assert it now calls a real provider, polls real
   status, returns a real file, meters against the plan, and refunds when it
   fails. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'video.harness.mjs');
writeFileSync(harness, src +
  '\nexport { videoGenerate, videoStatus, videoList, PLAN_LIMITS };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

const kv = new Map();
const counters = new Map();

const mkEnv = (extra = {}) => ({
  JWT_SECRET: 's',
  AMV_KV: {
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async put(k, v) { kv.set(k, v); },
    async delete(k) { kv.delete(k); },
    async list({ prefix }) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
  },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (id) => ({
      async fetch(url, init) {
        const b = JSON.parse((init && init.body) || '{}');
        const cur = counters.get(id) || 0;
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'incr') { const n = Math.max(0, cur + (b.amount || 0)); counters.set(id, n); return new Response(JSON.stringify({ value: n })); }
        if (b.op === 'reserve') {
          if (cur >= b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          counters.set(id, cur + (b.amount || 0));
          return new Response(JSON.stringify({ allowed: true, value: cur + (b.amount || 0) }));
        }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        return new Response('{}');
      }
    })
  },
  ...extra
});

const CONFIGURED = {
  VIDEO_API_URL: 'https://api.replicate.com/v1/predictions',
  VIDEO_API_KEY: 'r8_test',
  VIDEO_MODEL: 'some-model-version'
};

let CURRENT = { email: 'pro@test.com', plan: 'pro' };
W.__setRequireUser(async () => ({ email: CURRENT.email, plan: CURRENT.plan, customCfg: null }));

const post = (path, body) => new Request('https://api.amv.dev' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
  body: JSON.stringify(body)
});

/* ═══ Not configured: it must SAY SO, not fake it ═══════════════════════ */
section('No provider configured: it says so — it does NOT fake a render');

let env = mkEnv();     // no VIDEO_* secrets
let r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'a cat' }), env);
let d = await r.json();
ok(d.configured === false, 'returns configured:false', d);
ok(!d.id, 'and no job id — nothing was started', d);

/* ═══ Configured: a REAL job is created at the provider ═════════════════ */
section('Configured: it really calls the provider');

env = mkEnv(CONFIGURED);
const providerCalls = [];
globalThis.fetch = async (url, opts) => {
  providerCalls.push({ url: String(url), method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
  if ((opts?.method || 'GET') === 'POST') {
    return new Response(JSON.stringify({ id: 'pred_123', status: 'starting' }), { status: 201 });
  }
  return new Response(JSON.stringify({ id: 'pred_123', status: 'processing' }), { status: 200 });
};

r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'a cat surfing', seconds: 5, aspect: '16:9' }), env);
d = await r.json();
ok(d.ok && !!d.id, 'a job is created and an id returned', d);
ok(providerCalls.length === 1, 'the provider was ACTUALLY called', providerCalls.length);
ok(providerCalls[0].url.includes('replicate'), 'at the configured URL', providerCalls[0].url);
ok(providerCalls[0].body.input.prompt === 'a cat surfing', 'with the real prompt', providerCalls[0].body.input);
const jobId = d.id;

/* ═══ Polling reports the REAL provider state ══════════════════════════ */
section('Polling reflects the provider — no invented progress');

r = await W.videoStatus(post('/v1/video/status', { id: jobId }), env);
d = await r.json();
ok(d.status === 'processing', 'while the provider is working, we say processing', d.status);
ok(!d.url, 'and there is no video yet', d.url);

// provider finishes
globalThis.fetch = async () => new Response(JSON.stringify({
  id: 'pred_123', status: 'succeeded', output: ['https://cdn.test/video.mp4']
}), { status: 200 });

r = await W.videoStatus(post('/v1/video/status', { id: jobId }), env);
d = await r.json();
ok(d.status === 'succeeded', 'when it finishes, we say succeeded', d.status);
ok(d.url === 'https://cdn.test/video.mp4', 'and hand back a REAL video URL', d.url);

section('A finished job is cached (we stop hammering the provider)');
let hits = 0;
globalThis.fetch = async () => { hits++; return new Response('{}', { status: 200 }); };
await W.videoStatus(post('/v1/video/status', { id: jobId }), env);
ok(hits === 0, 'a completed job does not re-poll the provider', hits);

/* ═══ Quota ════════════════════════════════════════════════════════════ */
section('Free plan: video is not included');

CURRENT = { email: 'free@test.com', plan: 'free' };
r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'x' }), env);
d = await r.json();
ok(r.status === 402, 'a free account is refused (402)', r.status);
ok(d.code === 'plan_required', 'and told it needs a plan', d);

section('Paid plan: the monthly video cap actually holds');

CURRENT = { email: 'capped@test.com', plan: 'pro' };
counters.clear();
globalThis.fetch = async (url, opts) =>
  new Response(JSON.stringify({ id: 'p', status: 'starting' }), { status: (opts?.method === 'POST') ? 201 : 200 });

const cap = W.PLAN_LIMITS.pro.videosMonth;   // 30
// pre-fill the counter to just under the cap
counters.set(`vid:capped@test.com:${new Date().toISOString().slice(0, 7)}`, cap - 1);

r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'ok' }), env);
ok((await r.json()).ok, 'the last video in the plan is allowed');

r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'one too many' }), env);
d = await r.json();
ok(r.status === 429, 'the one past the cap is refused', r.status);
ok(d.code === 'video_quota', 'with a video_quota code', d);

section('A burst cannot bypass the video cap');

CURRENT = { email: 'burst@test.com', plan: 'pro' };
counters.clear();
counters.set(`vid:burst@test.com:${new Date().toISOString().slice(0, 7)}`, cap - 2);

const results = await Promise.all(
  Array.from({ length: 8 }, () => W.videoGenerate(post('/v1/video/generate', { prompt: 'burst' }), env))
);
const started = results.filter(x => x.status === 200).length;
ok(started <= 2, 'only the videos that fit under the cap start', { started, room: 2 });

/* ═══ Refunds ══════════════════════════════════════════════════════════ */
section('A failed video does NOT count against your plan');

CURRENT = { email: 'fail@test.com', plan: 'pro' };
counters.clear();
const vKey = `vid:fail@test.com:${new Date().toISOString().slice(0, 7)}`;

// provider accepts the job...
globalThis.fetch = async (url, opts) =>
  new Response(JSON.stringify({ id: 'p_fail', status: 'starting' }), { status: (opts?.method === 'POST') ? 201 : 200 });
r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'doomed' }), env);
const failJob = (await r.json()).id;
ok(counters.get(vKey) === 1, 'the video is reserved up front', counters.get(vKey));

// ...then fails
globalThis.fetch = async () => new Response(JSON.stringify({
  id: 'p_fail', status: 'failed', error: 'model exploded'
}), { status: 200 });
r = await W.videoStatus(post('/v1/video/status', { id: failJob }), env);
d = await r.json();
ok(d.status === 'failed', 'the job reports failed', d.status);
ok(counters.get(vKey) === 0, 'and the reservation is REFUNDED — you keep your quota', counters.get(vKey));

section('If the provider refuses the job, nothing is charged');

counters.clear();
globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'invalid model' }), { status: 422 });
r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'bad' }), env);
ok(r.status === 502, 'we report the failure honestly', r.status);
ok((counters.get(vKey) || 0) === 0, 'and the user is not charged for it', counters.get(vKey));

/* ═══ Privacy ══════════════════════════════════════════════════════════ */
section('You cannot read someone else"s video job');

CURRENT = { email: 'owner@test.com', plan: 'pro' };
counters.clear();
globalThis.fetch = async (url, opts) =>
  new Response(JSON.stringify({ id: 'p_own', status: 'starting' }), { status: (opts?.method === 'POST') ? 201 : 200 });
r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'mine' }), env);
const ownJob = (await r.json()).id;

CURRENT = { email: 'snooper@test.com', plan: 'pro' };
r = await W.videoStatus(post('/v1/video/status', { id: ownJob }), env);
ok(r.status === 404, 'another user gets a 404, not the video', r.status);

section('Unauthenticated access is refused');
W.__setRequireUser(async () => null);
r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'x' }), env);
ok(r.status === 401, 'no token = no video', r.status);

report();
done();
