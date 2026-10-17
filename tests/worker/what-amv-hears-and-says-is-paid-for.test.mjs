/* WHAT AMV HEARS AND SAYS IS PAID FOR, AND NEVER WRITTEN DOWN.

   Server speech (69-speech.js): a recording in, the words out with timestamps;
   text in, audio out. Driven through the real routes with the speech supplier
   stubbed and every call it receives recorded, and the spend counters read
   directly - so what is asserted is what was sent, what was charged and what
   was refused, not what a message says.

     - off, and saying so, until it has a price;
     - charged at what the supplier says the recording really was, through the
       same ceilings as everything else - and nothing when the supplier fails;
     - a recording cannot claim to be shorter than its size allows;
     - over the ceiling, the supplier is never called;
     - neither the audio nor the words reach a log line. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'speech.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { issueTokens };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'voice@test.com';
const store = new Map();
const vals = new Map();
const SPEECH = { AMV_SPEECH_URL: 'https://speech.example/v1', AMV_SPEECH_KEY: 'sk-speech',
  AMV_SPEECH_LISTEN_MODEL: 'hear-1', AMV_SPEECH_LISTEN_USD_PER_MIN: '0.006',
  AMV_SPEECH_VOICE_MODEL: 'speak-1', AMV_SPEECH_VOICE: 'calm', AMV_SPEECH_VOICE_USD_PER_1K_CHARS: '0.015' };
const env = Object.assign({ JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') {
        if (b.cap != null && cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
        vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount }));
      }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      if (b.op === 'rateCheck' || b.op === 'limit') return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
      return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
    } }),
  } }, SPEECH);
const ctx = { waitUntil(){}, passThroughOnException(){} };

store.set('ent:' + ME, JSON.stringify({ plan: 'pro', renewedAt: Date.now() }));
const pair = await W.issueTokens(env, ME, 'Voice');
let ip = 1;
const call = async (path, { body, type = 'application/json', auth = true } = {}) => {
  const headers = { 'Content-Type': type, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.6.' + (ip++) };
  if (auth) headers.Authorization = 'Bearer ' + pair.token;
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST', headers, body }), env, ctx);
  const ct = r.headers.get('Content-Type') || '';
  return { status: r.status, ct, d: /json/.test(ct) ? await r.json().catch(() => ({})) : null, bytes: /audio/.test(ct) ? new Uint8Array(await r.arrayBuffer()) : null };
};
const accountSpend = () => [...vals.entries()].filter(([k]) => k.startsWith('cost:' + ME)).reduce((a, [, v]) => a + v, 0);
const featSpend = () => [...vals.entries()].filter(([k]) => k.startsWith('featcost:speech:')).reduce((a, [, v]) => a + v, 0);

/* The supplier. Records each call; answers as the case says. */
let supplier = [], mode = 'ok', heardDuration = 42;
const SAID = 'The quarterly numbers are up nine percent in Lisbon.';
globalThis.fetch = async (u, init) => {
  const url = String(u);
  const entry = { url, auth: (init && init.headers && (init.headers.Authorization || init.headers.authorization)) || '' };
  if (init && init.body instanceof FormData) {
    entry.form = {}; for (const [k, v] of init.body.entries()) entry.form[k] = typeof v === 'string' ? v : { size: v.size, type: v.type };
  } else if (init && typeof init.body === 'string') { try { entry.json = JSON.parse(init.body); } catch (e) {} }
  supplier.push(entry);
  if (mode === 'fail') return new Response('{"error":"down"}', { status: 500 });
  if (/\/audio\/transcriptions$/.test(url))
    return new Response(JSON.stringify({ text: SAID, language: 'en', ...(heardDuration ? { duration: heardDuration } : {}),
      segments: [{ start: 0, end: 3.2, text: 'The quarterly numbers' }, { start: 3.2, end: 6.1, text: 'are up nine percent in Lisbon.' }] }), { status: 200 });
  if (/\/audio\/speech$/.test(url)) return new Response(new Uint8Array([73, 68, 51, 4, 0, 1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  return new Response('{}', { status: 404 });
};
/* Every log line, to check none carries the words. */
const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.map(String).join(' ')); };

const audio = (n) => new Uint8Array(n).fill(7);

section('Off, and saying so, until it has its price');
{
  const saved = env.AMV_SPEECH_LISTEN_USD_PER_MIN; delete env.AMV_SPEECH_LISTEN_USD_PER_MIN;
  const r = await call('/v1/audio/transcribe?seconds=10', { body: audio(2000), type: 'audio/webm' });
  ok(r.status === 503 && r.d.code === 'needs_service', 'hearing without a price is off', r.status + ' ' + (r.d && r.d.code));
  const cfg = await W.default.fetch(new Request('https://api.amv.test/v1/public-config', { headers: { Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.6.200' } }), env, ctx).then(x => x.json()).catch(() => ({}));
  ok(cfg.speech && cfg.speech.listen === false && cfg.speech.speak === true, 'and the page is told exactly which half works', cfg.speech);
  env.AMV_SPEECH_LISTEN_USD_PER_MIN = saved;
  ok(supplier.length === 0, 'nothing reached the supplier', supplier.length);
}

section('A recording is heard, with timestamps, and charged what it really was');
{
  supplier = []; vals.clear();
  const un = await call('/v1/audio/transcribe?seconds=60', { body: audio(4000), type: 'audio/webm', auth: false });
  ok(un.status === 401, 'not without signing in', un.status);
  const r = await call('/v1/audio/transcribe?seconds=60&lang=en', { body: audio(4000), type: 'audio/webm' });
  ok(r.status === 200 && r.d.text === SAID, 'the words come back', r.status + ' ' + JSON.stringify(r.d).slice(0, 120));
  ok(r.d.segments.length === 2 && r.d.segments[1].start === 3.2 && r.d.seconds === 42, 'with when each part was said, and how long it was', r.d.segments);
  const sent = supplier[0] || {};
  ok(/\/audio\/transcriptions$/.test(sent.url) && sent.auth === 'Bearer sk-speech', 'sent to the configured supplier with its key', sent.url);
  ok(sent.form && sent.form.model === 'hear-1' && sent.form.response_format === 'verbose_json' && sent.form.language === 'en' && sent.form.file && sent.form.file.size === 4000,
    'as the recording itself, with the model, timestamps and language asked for', sent.form);
  const want = (42 / 60) * 0.006;
  ok(Math.abs(accountSpend() - want) < 1e-9, 'charged for the 42 seconds the supplier heard, not the 60 declared', { charged: accountSpend(), want });
  ok(Math.abs(featSpend() - want) < 1e-9, 'and it shows in the owner’s cost figures as speech', featSpend());
}

section('A recording cannot claim to be shorter than its size');
{
  supplier = []; vals.clear(); heardDuration = 0;
  const big = 196608 * 120;
  const r = await call('/v1/audio/transcribe?seconds=1', { body: audio(big), type: 'audio/wav' });
  ok(r.status === 200, 'heard', r.status);
  const want = (120 / 60) * 0.006;
  ok(Math.abs(accountSpend() - want) < 1e-9, 'with no length from the supplier, charged by what its size proves - two minutes, not one second', { charged: accountSpend(), want });
  heardDuration = 42;
}

section('Nothing is charged when the supplier fails');
{
  supplier = []; vals.clear(); mode = 'fail';
  const r = await call('/v1/audio/transcribe?seconds=30', { body: audio(3000), type: 'audio/webm' });
  ok(r.status === 502 && /Nothing was charged/.test(r.d.error), 'it says so', r.status + ' ' + (r.d && r.d.error));
  ok(Math.abs(accountSpend()) < 1e-12, 'and the reservation went back', accountSpend());
  const s = await call('/v1/audio/speak', { body: JSON.stringify({ text: 'Hello there.' }) });
  ok(s.status === 502 && Math.abs(accountSpend()) < 1e-12, 'speaking too', s.status);
  mode = 'ok';
}

section('What is refused before anything is sent');
{
  supplier = [];
  const t = await call('/v1/audio/transcribe?seconds=10', { body: audio(100), type: 'text/plain' });
  ok(t.status === 415, 'something that is not audio', t.status);
  const l = await call('/v1/audio/transcribe?seconds=2000', { body: audio(100), type: 'audio/webm' });
  ok(l.status === 413 && l.d.code === 'too_long', 'longer than thirty minutes', l.status);
  const n = await call('/v1/audio/transcribe', { body: audio(100), type: 'audio/webm' });
  ok(n.status === 400 && n.d.code === 'needs_duration', 'a recording of no stated length', n.status);
  const s = await call('/v1/audio/speak', { body: JSON.stringify({ text: 'x'.repeat(4001) }) });
  ok(s.status === 413, 'and a speech longer than one go allows', s.status);
  ok(supplier.length === 0, 'none of it reached the supplier', supplier.length);
}

section('An answer is spoken, and charged by the character');
{
  supplier = []; vals.clear();
  const text = 'Your flight leaves at nine from gate twelve.';
  const r = await call('/v1/audio/speak', { body: JSON.stringify({ text }) });
  ok(r.status === 200 && /audio\/mpeg/.test(r.ct) && r.bytes && r.bytes.length === 8, 'audio comes back', r.status + ' ' + r.ct);
  const sent = supplier[0] || {};
  ok(sent.json && sent.json.model === 'speak-1' && sent.json.voice === 'calm' && sent.json.input === text, 'the configured model and voice said exactly that', sent.json);
  const want = (text.length / 1000) * 0.015;
  ok(Math.abs(accountSpend() - want) < 1e-12, 'charged for its ' + text.length + ' characters', { charged: accountSpend(), want });
  ok(Math.abs(featSpend() - want) < 1e-12, 'and it reaches the owner\u2019s cost figures, not only the account', featSpend());
}

section('Over the ceiling, the supplier is never called');
{
  supplier = []; vals.clear();
  /* Pro's allowance, nearly spent. */
  const r0 = await call('/v1/audio/speak', { body: JSON.stringify({ text: 'a' }) });
  const name = [...vals.keys()].find(k => k.startsWith('cost:' + ME));
  vals.set(name, 1e6);
  supplier = [];
  const r = await call('/v1/audio/transcribe?seconds=600', { body: audio(5000), type: 'audio/webm' });
  ok(r.status === 429 && /allowance|limit/i.test(r.d.error), 'refused with the reason', r.status + ' ' + (r.d && r.d.error));
  ok(supplier.length === 0, 'before anything was sent anywhere', supplier.length);
  vals.clear();
  void r0;
}

section('Neither the audio nor the words are written down');
{
  const all = logs.join('\n') + '\n' + [...store.values()].join('\n');
  ok(!/quarterly numbers|nine percent|flight leaves/i.test(all), 'no log line and no stored record carries what was said', all.length);
  ok(/speech_listened/.test(all), 'while the fact that it happened, and its cost, is recorded', /speech_listened/.test(all));
}

console.log = realLog;
if (report('what-amv-hears-and-says-is-paid-for') > 0) process.exitCode = 1;
done();
