/* THE DAY'S SPEND IS SAID ON THE WAY UP.

   Audit, Oct 31: one warning at 80% of the daily ceiling is a ceiling found
   out about when everybody's chat stops. The owner is now told at 50, 70, 85
   and 95% - each once a day - and the 95% warning says what happens at 100%
   and what to do. Driven through the real router, with the real counter
   class holding the day's spend, and the alert destination recording what
   it was sent. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'spendalerts.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, todayKey, counter };\n');
const W = await import(harness + '?t=' + Date.now());

const alerts = [];
const sse = (out) => 'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n'
  + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n'
  + 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":' + out + '}}\n\n'
  + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url, o) => {
  const u = String(url);
  if (/alerts\.example/.test(u)) { alerts.push(JSON.parse((o && o.body) || '{}')); return new Response('ok'); }
  if (/model\.example/.test(u)) return new Response(sse(4000), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  return new Response('{}');
};

function mkEnv() {
  const store = new Map(), objs = new Map();
  const make = () => { const s = new Map(); return new W.AMVCounter({ storage: {
    async get(k) { return s.has(k) ? s.get(k) : undefined; }, async put(k, v) { s.set(k, v); }, async delete(k) { s.delete(k); },
    async deleteAll() { s.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {}); };
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'j'.repeat(48), APP_URL: 'https://amv.test',
    ALERT_WEBHOOK: 'https://alerts.example/hook', GLOBAL_DAILY_USD_CAP: '10',
    AMV_KV: { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, String(v)); },
      async delete(k) { store.delete(k); }, async list({ prefix } = {}) { return { keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: { idFromName: n => n, get: (n) => ({ fetch: (u, init) => { if (!objs.has(n)) objs.set(n, make()); return objs.get(n).fetch(new Request('https://do/c', init)); } }) },
  };
}
const ctx = () => { const c = { _p: [], waitUntil(p) { c._p.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} }; return c; };
let ip = 0;
async function call(env, path, body, tok) {
  const c = ctx();
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.3.0.' + (++ip) }, tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: JSON.stringify(body) }), env, c);
  const text = await r.text(); await Promise.all(c._p); return { status: r.status, text };
}
async function account(env, email) {
  const r = await call(env, '/auth/signup', { email, name: 'S', password: 'A-real-Passw0rd!' });
  await W.DB.put(env, 'ent', email, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return JSON.parse(r.text).token;
}
const turn = (env, tok) => call(env, '/v1/messages', { model: 'amv-core', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }, tok);
/* The day's spend so far, put where every account books it (a $10 ceiling is one share). */
const spentSoFar = (env, usd) => W.counter(env, 'spend:' + W.todayKey() + ':s0', { op: 'incr', amount: usd, keep: true });
const said = () => alerts.map(a => String(a.text || a.content || JSON.stringify(a)));

section('Crossing 50% is said, once');
{
  const env = mkEnv(); alerts.length = 0;
  const tok = await account(env, 'a@spend.test');
  await spentSoFar(env, 4.99);
  const r = await turn(env, tok);
  ok(r.status === 200, 'the turn is answered', r.status);
  const s = said().filter(t => /Spend alert/.test(t));
  ok(s.length === 1 && /50% of the \$10 daily ceiling/.test(s[0]), 'one warning, at 50%', s);
  await turn(env, tok);
  ok(said().filter(t => /Spend alert/.test(t)).length === 1, 'and not again for the next turn', said());
}

section('Jumping past several at once says each one it passed');
{
  const env = mkEnv(); alerts.length = 0;
  const tok = await account(env, 'b@spend.test');
  await spentSoFar(env, 9.49);
  await turn(env, tok);
  const s = said().filter(t => /Spend alert/.test(t));
  ok([50, 70, 85, 95].every(p => s.some(t => t.includes(p + '% of'))), '50, 70, 85 and 95 are all said', s);
  const last = s.find(t => t.includes('95% of')) || '';
  ok(/every paid model call stops/.test(last) && /GLOBAL_DAILY_USD_CAP/.test(last), 'and the 95% warning says what happens at 100%, and what to do', last);
}

section('Below 50%, nothing');
{
  const env = mkEnv(); alerts.length = 0;
  const tok = await account(env, 'c@spend.test');
  await spentSoFar(env, 1);
  await turn(env, tok);
  ok(!said().some(t => /Spend alert/.test(t)), 'no warning', said());
}

if (report('the-days-spend-is-said-on-the-way-up') > 0) process.exitCode = 1;
done();
