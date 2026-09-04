/* "Responses stream by default."

   That sentence was shown to every developer who created an API key, and it is
   the opposite of the truth. `/v1/messages` writes `stream: true` into its
   upstream body as a literal and returns text/event-stream on its only success
   path, whatever the caller asked for. `body.stream` was never read. There is
   no default: there is one behaviour.

   "By default" tells a developer that `"stream": false` is available. Every
   client library in this shape offers it, so they send it, get an SSE body
   back, call .json() on it, and receive a parse error with nothing anywhere
   explaining why. That is LESSONS 309 exactly - the same mistake made inside
   AMV silently broke every surface except chat, and took a long time to find
   because the failure carries no explanation. Documented as the behaviour of a
   paid API, it is that trap sold to somebody who cannot read that file.

   So the server refuses it with a sentence instead of ignoring it, before the
   rate limit and before the reservation, and the docs say what actually
   happens. Both are checked by running the worker. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'streamonly.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'dev@example.com';
const PW = 'A-real-Passw0rd!';

let upstreamCalls = 0;
const sse = () => 'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
                + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
                + 'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n'
                + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  upstreamCalls++;
  return new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

function mkEnv() {
  const m = new Map(); const vals = new Map(); upstreamCalls = 0;
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    _vals: vals,
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
        if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount })); }
        if (b.op === 'incr') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: true, value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };

const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '40.40.40.40' }, headers || {}),
  body: JSON.stringify(body),
}), env, ctx);

async function signedIn(env) {
  const r = await call(env, '/auth/signup', { email: USER, name: 'D', password: PW });
  const tok = (await r.json()).token;
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const ask = (env, tok, extra) => call(env, '/v1/messages',
  Object.assign({ model: 'amv-core', max_tokens: 128, messages: [{ role: 'user', content: 'hello' }] }, extra || {}),
  { 'Authorization': 'Bearer ' + tok });
const booked = (env) => [...env._vals.entries()].filter(([k]) => k.startsWith('usg:')).reduce((n, [, v]) => n + v, 0);

section('An ordinary call streams, and books something');
/* The control. Without it the refusal below could pass against a worker that
   refuses everything, and against a measure that reads nothing. */
{
  const env = mkEnv();
  const tok = await signedIn(env);
  const r = await ask(env, tok);
  await ctx.settle();
  ok(r.status === 200, 'the turn is served', r.status);
  ok(/text\/event-stream/.test(r.headers.get('Content-Type') || ''),
     'as a stream, which is the only thing this endpoint returns', r.headers.get('Content-Type'));
  ok(booked(env) > 0, 'and the allowance records it', booked(env));
  ok(upstreamCalls === 1, 'one call reached the model', upstreamCalls);
}

section('Asking for it explicitly is the same thing');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  const r = await ask(env, tok, { stream: true });
  await ctx.settle();
  ok(r.status === 200, 'stream:true is served exactly as omitting it is', r.status);
  ok(/text\/event-stream/.test(r.headers.get('Content-Type') || ''), 'still a stream');
}

section('Asking for JSON is refused in a sentence, not ignored');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  const r = await ask(env, tok, { stream: false });
  await ctx.settle();
  /* Read as TEXT and parse defensively - which is the whole point. When the
     refusal is missing this body is an SSE stream, and a suite that called
     .json() on it would crash with the same unexplained parse error the bug
     hands a developer, instead of reporting which assertion failed. */
  const raw = await r.text();
  let d = {}; try { d = JSON.parse(raw); } catch (e) { d = { error: raw, code: '(not JSON: ' + raw.slice(0, 40) + ')' }; }
  ok(r.status === 400, 'it is a refusal, not a stream pretending to be an answer', r.status);
  ok(d.code === 'stream_required', 'with a code a client can branch on', d.code);
  ok(/always streams/i.test(d.error) && /event-stream/.test(d.error),
     'and a sentence saying what to do instead', d.error);
  ok(!/stream/.test(String(r.headers.get('Content-Type') || '')),
     'the refusal itself is JSON, so reading it does not need the thing it is about',
     r.headers.get('Content-Type'));
}

section('And the refusal costs the caller nothing');
/* It happens before the rate limit and before the reservation. A developer
   whose library defaults to stream:false would otherwise spend their whole
   day's allowance discovering that. */
{
  const env = mkEnv();
  const tok = await signedIn(env);
  await ask(env, tok, { stream: false });
  await ask(env, tok, { stream: false });
  await ask(env, tok, { stream: false });
  await ctx.settle();
  ok(booked(env) === 0, 'nothing is counted against the account', booked(env));
  ok(upstreamCalls === 0, 'and nothing reached the model, so nothing was paid for', upstreamCalls);
}

section('The upstream body is not built from what the caller asked for');
/* The root cause, stated as an assertion so it cannot drift back: stream is a
   literal in the request AMV sends, not a value copied from the client. */
{
  ok(/const upstreamBody = \{[^}]*stream: true,/s.test(src),
     'stream:true is written into the upstream body directly');
  ok(!/stream:\s*(?:!!)?body\.stream/.test(src),
     'and never taken from the caller, which is why there is nothing to default');
}

section('The docs a key holder reads say that');
/* Source-level, following LESSONS 353: the copy is checked where it is
   written. This pane is a static template with no branching, so what is in the
   source is what a developer sees. */
{
  /* Comments stripped first - the comment above the fix quotes the sentence it
     removed, and a comment explaining a removal must not read as the removal
     not having happened. Same rule as the dead-guards gate stage. */
  const docs = readFileSync(join(ROOT, 'src', 'app', '30-api-keys.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/stream by default/i.test(docs),
     'the sentence that promised a default is gone', (docs.match(/.{0,60}stream by default.{0,40}/i) || [''])[0]);
  ok(/always streams/i.test(docs), 'it says the endpoint always streams');
  ok(/event-stream/.test(docs), 'names the content type they will actually receive');
  ok(/stream_required/.test(docs), 'and the code they get if they ask for JSON');
  ok(/"stream":true/.test(docs), 'the copyable example asks for what it is going to get',
     (docs.match(/-d [^\n]{0,80}/) || [''])[0]);
}

report();
done();
