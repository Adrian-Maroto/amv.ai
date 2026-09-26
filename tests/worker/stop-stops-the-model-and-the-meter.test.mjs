/* STOP STOPS THE MODEL, AND THE METER CHARGES FOR WHAT WAS WRITTEN.

   The proxy tee()d the model's stream - one branch to the browser, one to the
   meter - so a browser that went away closed only its own branch. The model
   finished every answer, the provider billed all of it, and the person who
   pressed Stop was charged for the words they had refused.

   A dropped connection must still work the way it did: the answer is finished
   and parked so the app can collect it, rather than paying twice. The server
   cannot tell the two apart from the connection, so Stop names the turn to
   /v1/stop first, and the stream checks for that once, when the browser goes.

   Driven against the real Worker with a model that streams slowly and records
   whether it was cancelled - so "the model stopped" is observed at the source,
   not inferred from the reply. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'stopstops.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const PW = 'A-real-Passw0rd!';
const CHUNKS = 60;                      // "word " x 60 = 300 characters if it runs to the end
const FULL_OUTPUT = 1000;               // what the provider reports at the end of a full answer

/* The model: one event every 15ms, and a note of whether anybody cancelled it. */
let model = null;
let firstDelay = 0;                     // ms before the model says anything at all
let firstWordDelay = 0;                 // ms between its opening event and its first word
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!/model\.example/.test(u)) return { ok: true, status: 200, json: async () => ({}) };
  const enc = new TextEncoder();
  const m = { produced: 0, cancelled: false, finished: false };
  model = m;
  let i = 0;
  const body = new ReadableStream({
    async pull(c) {
      if (i === 0) {
        if (firstDelay) await new Promise(r => setTimeout(r, firstDelay));
        c.enqueue(enc.encode('data: {"type":"message_start","message":{"usage":{"input_tokens":40,"output_tokens":1}}}\n\n'));
        i++; return;
      }
      if (i <= CHUNKS) {
        await new Promise(r => setTimeout(r, i === 1 && firstWordDelay ? firstWordDelay : 15));
        c.enqueue(enc.encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"word "}}\n\n'));
        m.produced++; i++; return;
      }
      c.enqueue(enc.encode('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":' + FULL_OUTPUT + '}}\n\n'
                         + 'data: {"type":"message_stop"}\n\n'));
      m.finished = true;
      c.close();
    },
    cancel() { m.cancelled = true; },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    _vals: vals, _kv: m,
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
        if (b.op === 'reserve') {
          if (b.cap != null && b.cap !== Infinity && cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount }));
        }
        if (b.op === 'incr') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: b.cap == null || cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const mkCtx = () => ({ _p: [], waitUntil(p) { if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
                        passThroughOnException() {}, async settle() { for (let i = 0; i < 5; i++) await Promise.all(this._p); } });

const call = (env, ctx, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '41.41.41.41' }, headers || {}),
  body: JSON.stringify(body),
}), env, ctx);

async function signedIn(env, ctx, email) {
  const r = await call(env, ctx, '/auth/signup', { email, name: 'S', password: PW });
  const tok = (await r.json()).token;
  await W.DB.put(env, 'ent', email, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const ask = (env, ctx, tok, turn) => call(env, ctx, '/v1/messages',
  { model: 'amv-core', max_tokens: 2000, messages: [{ role: 'user', content: 'Write me a long story please.' }] },
  { 'Authorization': 'Bearer ' + tok, 'X-AMV-Request-Id': turn });
const stop = (env, ctx, tok, turn) => call(env, ctx, '/v1/stop', { id: turn }, tok ? { 'Authorization': 'Bearer ' + tok } : {});

/* Everything booked against the account's token counters, netted. */
const booked = (env) => [...env._vals.entries()].filter(([k]) => k.startsWith('usg:')).reduce((n, [, v]) => n + v, 0);

/* Read the first `n` model chunks off the reply, then hand back the reader. */
async function readSome(res, n) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let seen = 0, text = '';
  while (seen < n) {
    const { value, done } = await reader.read();
    if (done) break;
    const t = dec.decode(value);
    text += t;
    seen += (t.match(/text_delta/g) || []).length;
  }
  return { reader, text };
}

let fullCharge = 0, quickCharge = 0, startedCharge = 0;

section('An answer that runs to the end is charged in full - the baseline');
{
  const env = mkEnv(), ctx = mkCtx();
  const tok = await signedIn(env, ctx, 'full@x.com');
  const before = booked(env);
  const r = await ask(env, ctx, tok, 'turnFull01');
  await r.text();
  await ctx.settle();
  fullCharge = booked(env) - before;
  ok(r.status === 200 && model.finished && !model.cancelled, 'the model ran to the end', model);
  ok(fullCharge >= FULL_OUTPUT, 'and the charge includes the full output the provider reported', fullCharge);
}

section('Stop before the first word is not charged as half an answer');
{
  /* The model is slow to start, so Stop lands before it has said anything -
     not even the opening event that carries the input count. That is the case
     the "never saw usage" fallback exists for, and it charges HALF THE CAP -
     right for a stream that died, wrong for a person who changed their mind. */
  firstDelay = 300;
  const env = mkEnv(), ctx = mkCtx();
  const tok = await signedIn(env, ctx, 'quick@x.com');
  const before = booked(env);
  const r = await ask(env, ctx, tok, 'turnQuick1');
  const reader = r.body.getReader();
  await stop(env, ctx, tok, 'turnQuick1');
  await reader.cancel('user-stop');
  await ctx.settle();
  firstDelay = 0;
  const charged = booked(env) - before;
  quickCharge = charged;
  ok(model.cancelled === true, 'the model is cancelled', model);
  ok(charged < fullCharge / 4, 'and the charge is the question - nothing like half of the 2,000-token cap', { charged, fullCharge });
}

section('Stop after the model started but before any word: the question, counted exactly');
{
  /* The baseline the next section is measured against. The opening event -
     with the real input count - has arrived; no word has. */
  firstWordDelay = 400;
  const env = mkEnv(), ctx = mkCtx();
  const tok = await signedIn(env, ctx, 'started@x.com');
  const before = booked(env);
  const r = await ask(env, ctx, tok, 'turnStart1');
  const reader = r.body.getReader();
  await reader.read();                                   // the opening event
  await stop(env, ctx, tok, 'turnStart1');
  await reader.cancel('user-stop');
  await ctx.settle();
  firstWordDelay = 0;
  startedCharge = booked(env) - before;
  ok(model.cancelled === true && model.produced === 0, 'the model is cancelled before writing a word', model);
  ok(startedCharge > 0 && startedCharge < quickCharge,
     'charged for the question as the provider counted it - less than the floor an unseen question is estimated at', { startedCharge, quickCharge });
}

section('Stop during an answer stops the model and charges for what was written');
{
  const env = mkEnv(), ctx = mkCtx();
  const tok = await signedIn(env, ctx, 'alice@x.com');
  const before = booked(env);
  const r = await ask(env, ctx, tok, 'turnStop01');
  const { reader } = await readSome(r, 5);
  const s = await stop(env, ctx, tok, 'turnStop01');
  ok(s.status === 200, 'the stop is recorded', s.status);
  await reader.cancel('user-stop');
  await ctx.settle();
  const charged = booked(env) - before;
  ok(model.cancelled === true, 'the model was cancelled at the source - this was the finding', model);
  ok(model.finished === false && model.produced < CHUNKS, 'it did not write the rest of the answer', model.produced + ' of ' + CHUNKS);
  ok(charged < fullCharge / 2, 'the person is charged far less than the full answer', { charged, fullCharge });
  /* A meter that settled on message_start's placeholder output charges this
     the same as a Stop before any word - which is what it measured when the
     estimate was removed. */
  ok(charged > startedCharge,
     'but the words written are paid for - more than a Stop before any word', { charged, startedCharge });
}

section('A dropped connection with no Stop still finishes and keeps the answer');
{
  const env = mkEnv(), ctx = mkCtx();
  const tok = await signedIn(env, ctx, 'bob@x.com');
  const before = booked(env);
  const r = await ask(env, ctx, tok, 'turnDrop01');
  const { reader } = await readSome(r, 5);
  await reader.cancel('network');
  await ctx.settle();
  const charged = booked(env) - before;
  ok(model.cancelled === false && model.finished === true, 'the model finishes the answer, as before', model);
  ok([...env._kv.keys()].some(k => k === 'resume:bob@x.com:turnDrop01'), 'and it is parked for the app to collect', [...env._kv.keys()].filter(k => k.startsWith('resume:')));
  ok(charged >= FULL_OUTPUT, 'charged as a whole answer, because it is one, waiting to be collected', charged);
}

section('Nobody can stop somebody else’s answer');
{
  const env = mkEnv(), ctx = mkCtx();
  const alice = await signedIn(env, ctx, 'owner@x.com');
  const mallory = await signedIn(env, ctx, 'mallory@x.com');
  const r = await ask(env, ctx, alice, 'turnMine01');
  const { reader } = await readSome(r, 3);
  const s = await stop(env, ctx, mallory, 'turnMine01');   // a real account, the right id, the wrong person
  ok(s.status === 200, 'Mallory’s stop is accepted - for Mallory’s own turn of that name', s.status);
  await reader.cancel('network');
  await ctx.settle();
  ok(model.cancelled === false && model.finished === true, 'and Alice’s answer is treated as a dropped connection, not stopped', model);
}

section('The stop route asks who you are and what you mean');
{
  const env = mkEnv(), ctx = mkCtx();
  const tok = await signedIn(env, ctx, 'who@x.com');
  const anon = await stop(env, ctx, null, 'turnAnon01');
  ok(anon.status === 401, 'no account, no stop', anon.status);
  for (const bad of ['a', 'has space', '../../x', 'x'.repeat(100), 'a:b']) {
    const r = await stop(env, ctx, tok, bad);
    ok(r.status === 400, `"${bad.slice(0, 12)}" is refused as an id`, r.status);
  }
  ok(![...env._kv.keys()].some(k => /aistop:.*(\.\.|:a:b| )/.test(k)), 'and none of them reached storage', [...env._kv.keys()].filter(k => k.startsWith('aistop:')));
}

globalThis.fetch = realFetch;
report();
done();
