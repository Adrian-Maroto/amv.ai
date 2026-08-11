/* THE LAST THING BETWEEN AMV AND A BILL IT CANNOT PAY.

   Two controls exist for the worst case. GLOBAL_KILL halts the platform, and
   GLOBAL_DAILY_USD_CAP is a hard ceiling on a day's model spend. They are what
   an operator reaches for at 3am when the graph is going the wrong way, and
   the only thing worse than not having them is having them and being wrong
   about what they do.

   The kill switch was checked in exactly one place: the fetch router, for /v1/
   paths. That stops every request a PERSON makes. It did nothing about the
   cron - which fires every five minutes, runs everybody's automations, and
   calls the model with nobody present. So an operator could hit the switch,
   watch user traffic stop, and go on paying for automated work indefinitely.
   The one control whose entire purpose is "stop spending now" did not stop the
   spender that needs no one there.

   The cases below are about what each control actually reaches, in both
   directions: nothing that spends may get through, and the switch has to be
   reversible or it is not a pause, it is an outage you inflicted on yourself. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'kill.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _killCache, counter, todayKey };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'spender@example.com';
const PW = 'A-real-Passw0rd!';

let modelCalls = [];
const realFetch = globalThis.fetch;
const sse = () => 'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
                + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
                + 'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n'
                + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/model\.example/.test(u)) { modelCalls.push(u); return new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv(extra) {
  const m = new Map(); const vals = new Map(); modelCalls = [];
  return Object.assign({
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
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
        if (b.op === 'reserve') {
          if (b.cap != null && b.cap !== Infinity && cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount }));
        }
        if (b.op === 'incr') { vals.set(n, Math.max(0, cur + b.amount)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: b.cap == null || cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: cur + 1 <= (b.limit || 999) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
    _vals: vals,
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };

const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '40.40.40.40' }, headers || {}),
  body: body === undefined ? undefined : JSON.stringify(body),
}), env, ctx);

async function signedIn(env) {
  const r = await call(env, '/auth/signup', { email: USER, name: 'S', password: PW });
  const d = await r.json();
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return d.token;
}
const ask = (env, tok) => call(env, '/v1/messages',
  { model: 'amv-core', max_tokens: 128, messages: [{ role: 'user', content: 'hello' }] },
  { 'Authorization': 'Bearer ' + tok });

/* The switch is cached in-isolate for a few seconds on the request path. A
   case that flips it has to clear that, or it is testing the cache. */
const flip = async (env, on) => {
  if (on) await env.AMV_KV.put('GLOBAL_KILL', '1'); else await env.AMV_KV.delete('GLOBAL_KILL');
  W._killCache.ts = 0;
};

section('Normally, a paying customer spends money');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  const r = await ask(env, tok);
  ok(r.status === 200, 'their turn is served', r.status);
  ok(modelCalls.length === 1, 'and the model is called', modelCalls.length);
}

section('The kill switch stops it');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  await flip(env, true);
  const r = await ask(env, tok);
  ok(r.status === 503, 'the turn is refused', r.status);
  ok(modelCalls.length === 0, 'and nothing is spent', modelCalls.length);
  const d = await r.json();
  ok(/paused|try again/i.test(d.error || ''),
     'with a sentence that reads as temporary, because it is', d.error);
}

section('AND it stops the cron, which spends with nobody present');
{
  /* The gap this file was written for. Stopping requests stops what people
     do; automations run on a five-minute timer whether anybody is there or
     not, and they call the model. An operator who has hit the switch and
     watched user traffic stop would have gone on paying indefinitely. */
  const env = mkEnv();
  await signedIn(env);
  /* The record shape the cron actually reads: `items`, each with `active` and
     a `next` timestamp in the past. The first version of this used `list` and
     `nextRun`, so nothing was ever due - and the case passed identically with
     the kill check removed, proving nothing at all. Sabotage found it. */
  await W.DB.put(env, 'auto', USER, { items: [{
    id: 'a1', name: 'runaway', prompt: 'do the thing',
    active: true, next: Date.now() - 60000, every: 'day',
  }] });

  await flip(env, true);
  const c = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
  await worker.scheduled({ cron: '*/5 * * * *' }, env, c);
  await c.settle();

  ok(modelCalls.length === 0,
     'a cron tick during a pause calls the model zero times', modelCalls.length);

  /* And the control that makes that mean something: the SAME fixture, not
     paused, really does spend. Without this the assertion above is satisfied
     by an automation that was never going to run. */
  const env2 = mkEnv();
  await call(env2, '/auth/signup', { email: USER, name: 'S', password: PW });
  await W.DB.put(env2, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  await W.DB.put(env2, 'auto', USER, { items: [{
    id: 'a1', name: 'runaway', prompt: 'do the thing',
    active: true, next: Date.now() - 60000, every: 'day',
  }] });
  const c2 = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
               passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
  await worker.scheduled({ cron: '*/5 * * * *' }, env2, c2);
  await c2.settle();
  ok(modelCalls.length > 0,
     'while the identical automation, unpaused, really does call the model', modelCalls.length);
}

section('AND the day\u2019s ceiling stops the cron, which it never used to');
{
  /* The kill switch stopped the cron. The daily spend ceiling did not.

     Chat, image, video and the widget all CHECK the global counter before
     spending. The automation tick incremented it afterwards and never asked -
     so once the ceiling was reached, every path a person can see refused and
     the unattended cron carried on. The one thing running while nobody is
     watching was the one thing the ceiling did not stop, which is the worst
     place in the product for that hole to be. */
  const env = mkEnv();
  env.GLOBAL_DAILY_USD_CAP = '10';
  await signedIn(env);
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  await W.DB.put(env, 'auto', USER, { items: [{
    id: 'a1', name: 'runaway', prompt: 'do the thing',
    active: true, next: Date.now() - 60000, every: 'day',
  }] });
  /* The day is already spent. */
  await W.counter(env, `spend:${W.todayKey()}`, { op: 'incr', amount: 25, ttlMs: 86400000 });

  const c = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
  await worker.scheduled({ cron: '*/5 * * * *' }, env, c);
  await c.settle();
  ok(modelCalls.length === 0,
     'a cron tick past the day\u2019s ceiling calls the model zero times', modelCalls.length);

  /* The control, so this is not satisfied by an automation that was never
     going to run: the identical fixture with the day NOT spent does spend. */
  const env2 = mkEnv();
  env2.GLOBAL_DAILY_USD_CAP = '10';
  await call(env2, '/auth/signup', { email: USER, name: 'S', password: PW });
  await W.DB.put(env2, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  await W.DB.put(env2, 'auto', USER, { items: [{
    id: 'a1', name: 'runaway', prompt: 'do the thing',
    active: true, next: Date.now() - 60000, every: 'day',
  }] });
  const c2 = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
               passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
  await worker.scheduled({ cron: '*/5 * * * *' }, env2, c2);
  await c2.settle();
  ok(modelCalls.length > 0,
     'while the identical automation, with the day unspent, really does run', modelCalls.length);
}

section('And the cron runs normally when it is not paused');
{
  /* The other half. A kill check that is always on is not a kill switch, it
     is a broken scheduler - and automations silently never running is a
     failure nobody would attribute to this. */
  const env = mkEnv();
  const kill = await env.AMV_KV.get('GLOBAL_KILL');
  ok(kill === null, 'nothing is paused here', kill);
  const c = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
  let threw = null;
  try { await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.settle(); }
  catch (e) { threw = String(e && e.message); }
  ok(threw === null, 'the tick runs without throwing', threw);
}

section('Lifting it brings the product straight back');
{
  /* A pause you cannot undo is an outage you inflicted on yourself, and the
     moment to discover that is not while the graph is on fire. */
  const env = mkEnv();
  const tok = await signedIn(env);
  await flip(env, true);
  const paused = await ask(env, tok);
  ok(paused.status === 503, 'paused', paused.status);

  await flip(env, false);
  const back = await ask(env, tok);
  ok(back.status === 200, 'and serving again as soon as it is lifted', back.status);
  ok(modelCalls.length === 1, 'really serving, not just answering 200', modelCalls.length);
}

section('The daily spend ceiling stops the model too');
{
  /* The other backstop, and the one that acts without anybody watching. */
  const env = mkEnv({ GLOBAL_DAILY_USD_CAP: '10' });
  const tok = await signedIn(env);
  const day = new Date().toISOString().slice(0, 10);
  env._vals.set(`spend:${day}`, 25);          // already past the ceiling
  const r = await ask(env, tok);
  ok(r.status === 503 || r.status === 429, 'the turn is refused', r.status);
  ok(modelCalls.length === 0, 'and the model is not called', modelCalls.length);
}

section('A refusal from either says nothing about why, to a user');
{
  /* "We have hit our spend cap" tells a customer that AMV's finances, not
     their request, are the problem - and tells anybody probing exactly which
     lever they are pulling on. */
  const env = mkEnv({ GLOBAL_DAILY_USD_CAP: '10' });
  const tok = await signedIn(env);
  env._vals.set(`spend:${new Date().toISOString().slice(0, 10)}`, 25);
  const d = await (await ask(env, tok)).json();
  /* Word boundaries, because "at capacity" contains "cap" and is exactly the
     right thing to say - it describes the service, not the finances. The
     words that must not appear are the ones about money. */
  ok(!/\b(budget|spend|spending|bill|billing|cost|costs|quota exhausted)\b/i.test(d.error || ''),
     'no mention of money', d.error);
  ok(/capacity|try again/i.test(d.error || ''),
     'while still saying something a customer can act on', d.error);
}

section('An operator can flip it without a deploy, and only an operator can');
{
  const env = mkEnv();
  const bad = await call(env, '/v1/admin/kill', { on: true });
  ok(bad.status >= 400, 'not without the admin token', bad.status);
  ok(await env.AMV_KV.get('GLOBAL_KILL') === null, 'and nothing was flipped', true);

  const good = await call(env, '/v1/admin/kill', { on: true }, { 'Authorization': 'Bearer admin-secret' });
  ok(good.status === 200, 'with it, the switch is thrown', good.status);
  ok(await env.AMV_KV.get('GLOBAL_KILL') === '1', 'and really set', true);

  await call(env, '/v1/admin/kill', { on: false }, { 'Authorization': 'Bearer admin-secret' });
  ok(await env.AMV_KV.get('GLOBAL_KILL') === null, 'and can be lifted the same way', true);
}

section('Signing in still works while paused');
{
  /* Deliberate. Killing auth would lock every customer out of their own
     account - including the operator - over a spend problem that has nothing
     to do with them, and turn a pause into a support incident. */
  const env = mkEnv();
  await signedIn(env);
  await flip(env, true);
  const r = await call(env, '/auth/login', { email: USER, password: PW, provider: 'email' });
  ok(r.status === 200, 'people can still reach their account', r.status);
  ok(modelCalls.length === 0, 'while nothing that spends runs', modelCalls.length);
}

globalThis.fetch = realFetch;
if (report('stop-means-stop-spending') > 0) process.exitCode = 1;
done();
