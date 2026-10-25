/* A PHOTO IS BOOKED BY WHAT IT COSTS TO READ, AND A REQUEST WITH ONE IS ACCEPTED.

   Two bounds made attaching a picture fail in production, and neither was
   visible to any suite:

   - /v1/messages took the default one-megabyte body, so a phone photo - sent
     as it was, three to five megabytes - was refused before a byte was read.
     The suites never met it because the harness never declared a length;
   - the usage booking counted a picture as a quarter of its base64 length,
     as if it were prose. A 400KB photo was booked as 100,000 tokens - five
     times a free account's day - so a free account could not send a photo at
     all. The engine reads it for about 1,600.

   Run against the Worker, with a counter that enforces its caps:
   - a free account sends a photo and is answered;
   - a picture is estimated at IMAGE_TOKENS whatever it weighs, and a PDF by
     its pages;
   - a request declaring several megabytes is read, and one past the bound is
     refused with a reason, before reading;
   - files are bounded on their own, so photos do not count against text. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'photobooked.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, todayKey, ANSWER_FLOOR_TOKENS, PLAN_LIMITS, _estimateInputTokens, _fitsContext, validateMessagesPayload, MAX_BINARY_CHARS, IMAGE_TOKENS, PDF_PAGE_TOKENS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const PW = 'A-real-Passw0rd!';
const DAY = W.PLAN_LIMITS.free.dayTokens;
const MONTH = W.PLAN_LIMITS.free.monthTokens;
const FLOOR = W.ANSWER_FLOOR_TOKENS;

/* What the model was sent, call by call. */
let sent = [];
const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
          + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
          + 'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n'
          + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url, init) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  sent.push(JSON.parse(init.body));
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

/* The counter records the highest value each name ever held, so "never past
   the cap" is measured at the moment of booking, not after reconciliation
   has given most of it back. */
function mkEnv() {
  const m = new Map(); const vals = new Map(); const peak = new Map();
  const set = (n, v) => { vals.set(n, v); peak.set(n, Math.max(peak.get(n) || 0, v)); };
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    _vals: vals, _peak: peak, _set: set,
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
        const r = (o) => new Response(JSON.stringify(o));
        if (b.op === 'reserve') {
          if (b.cap != null && b.cap !== Infinity && cur + b.amount > b.cap) return r({ allowed: false, value: cur });
          set(n, cur + b.amount); return r({ allowed: true, value: cur + b.amount });
        }
        if (b.op === 'incr') { set(n, cur + b.amount); return r({ value: vals.get(n) }); }
        if (b.op === 'get') return r({ value: cur });
        if (b.op === 'checkCap') return r({ allowed: b.cap == null || cur < b.cap, value: cur });
        if (b.op === 'rateCheck') return r({ allowed: true });
        if (b.op === 'claim') return r({ claimed: true });
        return r({ allowed: true, value: cur });
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); this._p = []; } };
const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '41.41.41.41' }, headers || {}),
  body: JSON.stringify(body),
}), env, ctx);

let n = 0;
async function freeAccount(env) {
  const email = `free${++n}@example.com`;
  const r = await call(env, '/auth/signup', { email, name: 'F', password: PW });
  return { email, tok: (await r.json()).token };
}

const photo = (kb) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/' + 'A'.repeat(kb * 1024) } });

section('A free account sends a photo and is answered');
{
  const env = mkEnv(); sent = [];
  const { email, tok } = await freeAccount(env);
  const r = await call(env, '/v1/messages', { model: 'amv-core', stream: true, max_tokens: 4000,
    messages: [{ role: 'user', content: [photo(400), { type: 'text', text: 'What is in this picture?' }] }] }, { Authorization: 'Bearer ' + tok });
  const d = r.status !== 200 ? await r.json() : {};
  await ctx.settle();
  ok(r.status === 200 && sent.length === 1, 'served - before this it was refused as the day being used up', { status: r.status, d });
  ok((env._peak.get(`usg:${email}:${W.todayKey()}`) || 0) <= W.PLAN_LIMITS.free.dayTokens, 'and the day was never booked past its cap', env._peak.get(`usg:${email}:${W.todayKey()}`));
}

section('A picture is booked by what it costs to read; a PDF by its pages');
{
  const est = (blocks) => W._estimateInputTokens([{ role: 'user', content: blocks }]);
  const small = est([photo(50)]), big = est([photo(4000)]);
  ok(small === big && small >= W.IMAGE_TOKENS && small < W.IMAGE_TOKENS + 300, 'a 50KB and a 4MB picture book the same, a little over what the engine reads', { small, big });
  const pdf = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 3 >> endobj\n'
    + [3, 4, 5].map(i => i + ' 0 obj << /Type /Page /Parent 2 0 R >> endobj\n').join('') + 'x'.repeat(300000) + '\n%%EOF';
  const doc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(pdf).toString('base64') } };
  ok(est([doc]) === 3 * W.PDF_PAGE_TOKENS, 'a three-page PDF is booked as three pages, not by its size', est([doc]));
  const blind = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD'.repeat(10000) } };
  ok(est([blind]) >= 10000, 'one whose pages cannot be counted falls back to its size - over, never under', est([blind]));
  const text = { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'word '.repeat(4000) } };
  ok(est([text]) >= 4000 && est([text]) < 6000, 'and a document of plain text is read as text', est([text]));
  const fit = W._fitsContext({ messages: [{ role: 'user', content: Array.from({ length: 20 }, () => photo(400)) }] }, { context: 1000000, maxOut: 32000 });
  ok(fit.ok && fit.tokens < 60000, 'twenty photos fit an engine, by the same measure', fit.tokens);
}

section('A request of several megabytes is read; past the bound it is refused before reading');
{
  const env = mkEnv(); sent = [];
  const { tok } = await freeAccount(env);
  const body = JSON.stringify({ model: 'amv-core', stream: true, max_tokens: 4000,
    messages: [{ role: 'user', content: [photo(3 * 1024), { type: 'text', text: 'and this?' }] }] });
  const r = await worker.fetch(new Request('https://api.amv.test/v1/messages', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '41.41.41.41', Authorization: 'Bearer ' + tok, 'Content-Length': String(body.length) }, body }), env, ctx);
  await ctx.settle();
  ok(r.status === 200, 'a 3MB photo, declared as 3MB, is read and answered - it was a 413', r.status);
  const huge = await worker.fetch(new Request('https://api.amv.test/v1/messages', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '41.41.41.41', Authorization: 'Bearer ' + tok, 'Content-Length': String(17 * 1024 * 1024) }, body: '{}' }), env, ctx);
  const hd = await huge.json();
  ok(huge.status === 413 && hd.code === 'body_too_large', 'one declaring 17MB is refused, with a reason, and nothing is read', { status: huge.status, hd });
}

section('Files are bounded on their own, so pictures do not use up the text');
{
  const msgs = (fileChars, textChars) => ({ messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'A'.repeat(fileChars) } }, { type: 'text', text: 'x'.repeat(textChars) }] }] });
  ok(W.validateMessagesPayload(msgs(6000000, 2000000)) === null, '6M characters of files beside 2M of text is a valid request - files used to count as text', W.validateMessagesPayload(msgs(6000000, 2000000)));
  const over = W.validateMessagesPayload(msgs(W.MAX_BINARY_CHARS + 1, 10));
  ok(/pictures and files/.test(String(over)), 'more files than the bound is refused, saying so', over);
}

if (report('a-photo-is-booked-by-what-it-costs') > 0) process.exitCode = 1;
done();
