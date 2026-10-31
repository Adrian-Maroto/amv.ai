/* WHEN EVERYTHING BREAKS, NOTHING OPENS.

   Scale audit, chaos testing. Each store's failure has its own suite (a KV
   read that fails is not zero, a counter that fails refuses, a model that
   fails moves to the fallback), and each was written with that one failure in
   mind. What none of them does is break several things at once, at random,
   in the middle of real requests - which is what an outage actually looks
   like. This drives the real router with KV, the counter objects (the real
   AMVCounter class) and the model provider each failing at random, over many
   seeded runs, and holds four things true on every single answer:

     1. NO SPEND WITHOUT A RESERVATION. A request that reached the model
        booked against the day's spend first. A counter that cannot be asked
        is a refusal, never a free pass.
     2. A DOOR THAT WAS SHUT STAYS SHUT. A token that was revoked, a forged
        one, or none at all, gets in nowhere it was refused with everything
        healthy - however the stores are failing. A wrong password never
        signs anybody in.
     3. THE SERVER ALWAYS ANSWERS. The Worker returns a response for every
        request; it never throws out of fetch.
     4. AN ERROR NEVER LEAKS ITS INSIDES. No stack, no internal error class,
        and none of the stores' own error text reaches the caller.

   The seeds are fixed, so a failure here is reproduced by running the suite
   again, and the line that fails names the seed, the request and the fault. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'chaos.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { DB, revokeUserTokens };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

/* Error text no caller should ever see: each store throws with its own. */
const KV_SECRET = 'CHAOS-KV-INTERNAL-7f3a';
const DO_SECRET = 'CHAOS-DO-INTERNAL-91bc';
const MODEL_SECRET = 'CHAOS-MODEL-INTERNAL-c2d4';

function mulberry32(seed) {
  return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* The faults in force, and what happened during the current request. */
const F = { kv: 0, doThrow: 0, doJunk: 0, model: 0, modelStatus: 0, rnd: Math.random };
const T = { reserves: 0, modelCalls: 0 };
const fail = (p) => p > 0 && F.rnd() < p;

const store = new Map();
const kv = {
  async get(k) { if (fail(F.kv)) throw new Error(KV_SECRET + ' get'); return store.has(k) ? store.get(k) : null; },
  async put(k, v) { if (fail(F.kv)) throw new Error(KV_SECRET + ' put'); store.set(k, String(v)); },
  async delete(k) { if (fail(F.kv)) throw new Error(KV_SECRET + ' delete'); store.delete(k); },
  async list({ prefix, limit } = {}) { if (fail(F.kv)) throw new Error(KV_SECRET + ' list');
    const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
    return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true }; },
};

/* The real counter class, one instance per name, calls serialized - with an
   object that is unreachable, or that answers something meaningless. */
const objs = new Map();
const makeObj = () => { const s = new Map(); return new W.AMVCounter({ storage: {
  async get(k) { return s.has(k) ? s.get(k) : undefined; }, async put(k, v) { s.set(k, v); },
  async delete(k) { s.delete(k); }, async deleteAll() { s.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {}); };
let q = Promise.resolve();
const counterNs = {
  idFromName: n => n,
  get: (n) => ({ fetch: (u, init) => {
    if (fail(F.doThrow)) return Promise.reject(new Error(DO_SECRET + ' unreachable'));
    if (fail(F.doJunk)) return Promise.resolve(new Response('{"' + DO_SECRET + '":1}'));
    if (!objs.has(n)) objs.set(n, makeObj());
    const run = async () => {
      const r = await objs.get(n).fetch(new Request('https://do/counter', init));
      let body = null; try { body = JSON.parse(init.body); } catch (e) {}
      if (body && body.op === 'reserve' && /^spend:/.test(n)) {
        const out = await r.clone().json().catch(() => ({}));
        if (out.allowed) T.reserves++;
      }
      return r;
    };
    const p = q.then(run, run); q = p.catch(() => {}); return p;
  } }),
};

const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
          + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n'
          + 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n'
          + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url) => {
  if (/model\.example|fallback\.example/.test(String(url))) {
    T.modelCalls++;
    if (F.modelStatus) return new Response(JSON.stringify({ error: { type: 'x', message: MODEL_SECRET + ' status ' + F.modelStatus } }), { status: F.modelStatus });
    if (fail(F.model)) {
      if (F.rnd() < 0.5) throw new Error(MODEL_SECRET + ' reset');
      return new Response(JSON.stringify({ error: { message: MODEL_SECRET + ' overloaded' } }), { status: 529 });
    }
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return new Response('{}', { status: 200 });
};

const env = {
  AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', MODEL_API_FALLBACK_URL: 'https://fallback.example',
  JWT_SECRET: 'j'.repeat(48), APP_URL: 'https://amv.test', GLOBAL_DAILY_USD_CAP: '5000',
  AMV_KV: kv, AMV_COUNTER: counterNs,
};
const ctx = () => { const c = { _p: [], waitUntil(p) { c._p.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} }; return c; };

let ipN = 0;
async function call(path, { body, tok, method } = {}) {
  const c = ctx();
  const req = new Request('https://api.amv.test' + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.' + ((ipN >> 8) & 255) + '.' + (ipN++ & 255) },
                           tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let res, threw = null, text = '';
  try { res = await worker.fetch(req, env, c); } catch (e) { threw = e; }
  if (res) { try { text = await res.text(); } catch (e) { text = ''; } }
  await Promise.all(c._p);
  return { status: res ? res.status : 0, text, threw, type: res ? (res.headers.get('Content-Type') || '') : '' };
}

/* ── Accounts, made while everything is healthy ───────────────────────── */
const PW = 'A-real-Passw0rd!';
async function signup(email) {
  const r = await call('/auth/signup', { body: { email, name: 'C', password: PW } });
  let d = {}; try { d = JSON.parse(r.text); } catch (e) {}
  if (!d.token) throw new Error('signup failed for ' + email + ': ' + r.status + ' ' + r.text.slice(0, 200));
  return d.token;
}
const FREE = 'free@chaos.test', PRO = 'pro@chaos.test', GONE = 'gone@chaos.test';
const id = {
  free: await signup(FREE),
  pro: await signup(PRO),
  revoked: await signup(GONE),
  forged: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm9AY2hhb3MudGVzdCIsImV4cCI6OTk5OTk5OTk5OX0.' + 'A'.repeat(43),
  none: '',
};
await W.DB.put(env, 'ent', PRO, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
await W.revokeUserTokens(env, GONE);

const chat = { model: 'amv-core', max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] };
const ROUTES = {
  chat:        (t) => call('/v1/messages', { body: chat, tok: t }),
  usage:       (t) => call('/v1/usage', { tok: t }),
  entitlement: (t) => call('/v1/entitlement', { tok: t }),
  syncPull:    (t) => call('/sync/pull', { body: {}, tok: t }),
  syncPush:    (t) => call('/sync/push', { body: { data: { chats: [] } }, tok: t }),
  security:    (t) => call('/auth/security', { tok: t }),
};
const LOGINS = {
  wrongPassword: () => call('/auth/login', { body: { email: PRO, password: 'not-' + PW } }),
  goneAccount:   () => call('/auth/login', { body: { email: 'nobody@chaos.test', password: PW } }),
};

/* What each identity gets with everything healthy: the doors that are shut. */
const shut = new Set();
for (const [who, tok] of Object.entries(id)) {
  if (who === 'free' || who === 'pro') continue;
  for (const [r, fn] of Object.entries(ROUTES)) {
    const x = await fn(tok);
    if (x.status === 401 || x.status === 403) shut.add(who + ' ' + r);
  }
}

section('With everything healthy: the doors that must stay shut, are');
{
  ok(shut.has('revoked usage') && shut.has('revoked syncPull') && shut.has('forged usage') && shut.has('none syncPull'),
     'a revoked token, a forged one and none are refused where an account is needed', [...shut]);
  ok(shut.has('revoked chat'), 'and a revoked token cannot chat', [...shut]);
  T.modelCalls = 0; T.reserves = 0;
  const x = await ROUTES.chat(id.pro);
  ok(x.status === 200 && T.modelCalls === 1 && T.reserves >= 1, 'a healthy turn reaches the model once, after booking the spend',
     { status: x.status, calls: T.modelCalls, reserves: T.reserves, body: x.text.slice(0, 160) });
}

/* ── The chaos runs ───────────────────────────────────────────────────── */
const problems = { spend: [], door: [], threw: [], leak: [] };
const counts = { requests: 0, s2xx: 0, s5xx: 0, modelReached: 0 };
const LEAK = new RegExp([KV_SECRET, DO_SECRET, MODEL_SECRET, '\\n\\s+at ', '\\.js:\\d+:\\d+', 'TypeError', 'ReferenceError',
                         'Cannot read propert', 'is not a function', 'is not defined'].join('|'));

async function one(label, fn, who, route) {
  T.reserves = 0; T.modelCalls = 0;
  const x = await fn();
  counts.requests++;
  if (x.status >= 200 && x.status < 300) counts.s2xx++;
  if (x.status >= 500) counts.s5xx++;
  if (T.modelCalls > 0) counts.modelReached++;
  if (x.threw) problems.threw.push(label + ' threw: ' + String(x.threw && x.threw.stack || x.threw).slice(0, 300));
  if (T.modelCalls > 0 && T.reserves === 0) problems.spend.push(label + ' reached the model ' + T.modelCalls + 'x with no reservation');
  if (who && shut.has(who + ' ' + route) && x.status >= 200 && x.status < 300) problems.door.push(label + ' got ' + x.status + ': ' + x.text.slice(0, 160));
  if (who && who !== 'free' && who !== 'pro' && T.modelCalls > 0) problems.door.push(label + ' (' + who + ') reached the model');
  if (route === 'login' && x.status >= 200 && x.status < 300) problems.door.push(label + ' signed in: ' + x.text.slice(0, 160));
  if (process.env.CHAOS_DEBUG && label.includes(process.env.CHAOS_DEBUG)) console.log("DBG", label, x.status, x.text.slice(0, 120));
  if (LEAK.test(x.text)) problems.leak.push(label + ' (' + x.status + '): ' + x.text.slice(0, 240));
}

const MIXES = [
  { name: 'KV flaky',            kv: 0.25, doThrow: 0,    doJunk: 0,    model: 0 },
  { name: 'counters flaky',      kv: 0,    doThrow: 0.3,  doJunk: 0.1,  model: 0 },
  { name: 'model flaky',         kv: 0,    doThrow: 0,    doJunk: 0,    model: 0.5 },
  { name: 'everything flaky',    kv: 0.15, doThrow: 0.2,  doJunk: 0.1,  model: 0.3 },
  { name: 'counters down',       kv: 0,    doThrow: 1,    doJunk: 0,    model: 0 },
  { name: 'counters talk junk',  kv: 0,    doThrow: 0,    doJunk: 1,    model: 0 },
  { name: 'KV down',             kv: 1,    doThrow: 0,    doJunk: 0,    model: 0 },
  { name: 'everything down',     kv: 1,    doThrow: 1,    doJunk: 0,    model: 1 },
];
const SEEDS = [1, 7, 42, 1009, 31337];
const WHO = Object.keys(id);
const RN = Object.keys(ROUTES);
const PER_RUN = 60;
const perMix = {};
for (const mix of MIXES) {
  perMix[mix.name] = { modelReached: 0, requests: 0 };
  for (const seed of SEEDS) {
    /* Fresh accounts each run, made while healthy: per-account rate limits
       are per minute, and a run reusing the last run's accounts would test
       the rate limiter instead of the failure. */
    const tag = mix.name.replace(/\W+/g, '-') + '-' + seed;
    id.free = await signup('free-' + tag + '@chaos.test');
    id.pro = await signup('pro-' + tag + '@chaos.test');
    await W.DB.put(env, 'ent', 'pro-' + tag + '@chaos.test', { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
    const rnd = mulberry32(seed * 7919 + mix.name.length);
    for (let i = 0; i < PER_RUN; i++) {
      Object.assign(F, mix, { rnd });
      const before = counts.modelReached;
      const pick = rnd();
      if (pick < 0.08) {
        const [lname, lfn] = Object.entries(LOGINS)[(rnd() * 2) | 0];
        await one(`[${mix.name} seed ${seed} #${i}] login ${lname}`, lfn, null, 'login');
      } else {
        const who = WHO[(rnd() * WHO.length) | 0];
        /* Chat is the money path: asked for most often. */
        const route = rnd() < 0.45 ? 'chat' : RN[(rnd() * RN.length) | 0];
        await one(`[${mix.name} seed ${seed} #${i}] ${who} ${route}`, () => ROUTES[route](id[who]), who, route);
      }
      perMix[mix.name].requests++;
      perMix[mix.name].modelReached += counts.modelReached - before;
    }
    Object.assign(F, { kv: 0, doThrow: 0, doJunk: 0, model: 0 });
  }
}

section(`${counts.requests} requests under ${MIXES.length} kinds of failure, ${SEEDS.length} seeds each`);
ok(problems.spend.length === 0, 'NO SPEND WITHOUT A RESERVATION: every request that reached the model booked first', problems.spend.slice(0, 5));
ok(perMix['counters down'].modelReached === 0, 'with the counters down, nothing reaches the model at all', perMix['counters down']);
ok(perMix['counters talk junk'].modelReached === 0, 'nor when they answer nonsense', perMix['counters talk junk']);
ok(problems.door.length === 0, 'A DOOR THAT WAS SHUT STAYS SHUT: no revoked, forged or missing token got in, no wrong password signed in', problems.door.slice(0, 5));
ok(problems.threw.length === 0, 'THE SERVER ALWAYS ANSWERS: fetch never threw', problems.threw.slice(0, 3));
ok(problems.leak.length === 0, 'AN ERROR NEVER LEAKS ITS INSIDES: no stack, no internal error, no store\'s own message', problems.leak.slice(0, 5));

section('And the chaos was real - this is not a suite that passes by doing nothing');
/* Per-account rate limits rightly refuse most of a burst this fast, so the
   bar is that the model WAS reached under every partial failure. */
ok(perMix['model flaky'].modelReached > 40, 'with only the model flaky, turns still reached it', perMix['model flaky']);
ok(counts.s2xx > 100 && counts.s5xx > 50, 'plenty succeeded and plenty failed', counts);

section('The model refusing is told in AMV\'s words, and never as a sign-in that ended');
{
  /* Each status on a new account, so no rate limit decides the answer. */
  const want = { 401: [503, 'model_unavailable'], 403: [503, 'model_unavailable'], 400: [400, 'invalid_request'],
                 429: [429, 'provider_error'], 529: [529, 'provider_error'], 500: [500, 'provider_error'] };
  let n = 0;
  for (const [st, [code, name]] of Object.entries(want)) {
    const tok = await signup('status' + (n++) + '@chaos.test');
    await W.DB.put(env, 'ent', 'status' + (n - 1) + '@chaos.test', { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
    F.modelStatus = +st;
    const x = await call('/v1/messages', { body: chat, tok });
    F.modelStatus = 0;
    let d = {}; try { d = JSON.parse(x.text); } catch (e) {}
    ok(x.status === code && d.code === name && !LEAK.test(x.text) && /Nothing was charged/.test(d.error || ''),
       'the model answering ' + st + ' reaches the caller as ' + code + ' ' + name + ', in AMV\'s own sentence', { status: x.status, body: x.text.slice(0, 200) });
  }
}

section('Healthy again, it works again');
{
  Object.assign(F, { kv: 0, doThrow: 0, doJunk: 0, model: 0, rnd: Math.random });
  T.modelCalls = 0; T.reserves = 0;
  const fresh = await signup('after@chaos.test');
  await W.DB.put(env, 'ent', 'after@chaos.test', { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const x = await call('/v1/messages', { body: chat, tok: fresh });
  ok(x.status === 200 && T.modelCalls === 1, 'the next turn after the outage is answered', { status: x.status, body: x.text.slice(0, 200) });
  const u = await ROUTES.usage(id.free);
  ok(u.status === 200, 'and the free account can read its usage', u.status);
}

if (report('when-everything-breaks-nothing-opens') > 0) process.exitCode = 1;
done();
