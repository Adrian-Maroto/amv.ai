/* ONE PART OF AMV CAN BE SWITCHED OFF.

   Scale audit #70, Oct 26. GLOBAL_KILL stops everything that spends; the
   owner also needs to stop exactly one thing - a feature, an engine, a
   connector, one kind of write - from the console, in seconds, with nothing
   redeployed and everything else still working. Through the real router.
   (Scaffolding shared with stop-means-stop-spending.) */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'switches.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _killCache, counter, todayKey, _swCache, runDueAutomations };\n');
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


const ADMIN = { 'X-Admin-Token': 'admin-secret' };
const flipSwitch = async (env, name, off, why) => {
  const r = await call(env, '/v1/admin/switch', { name, off, why }, ADMIN);
  W._swCache.at = 0;                     // every isolate re-reads within ten seconds; this one now
  return r;
};

section('One feature off: exactly that feature stops');
{
  const env = mkEnv({ AMV_FILES: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { objects: [] }; } } });
  const tok = await signedIn(env);
  const r0 = await call(env, '/v1/library', undefined, { Authorization: 'Bearer ' + tok });
  ok(r0.status !== 503, 'before: the library answers', r0.status);
  const f = await flipSwitch(env, 'feature:library', true, 'storage provider incident');
  ok(f.status === 200 && (await f.json()).off === true, 'the owner switches it off from the console');
  const r1 = await call(env, '/v1/library', undefined, { Authorization: 'Bearer ' + tok });
  const d1 = await r1.json();
  ok(r1.status === 503 && d1.code === 'paused' && d1.switch === 'feature:library', 'the library answers "paused", naming nothing internal', d1);
  ok(/Everything else is working/.test(d1.error), 'and says the rest of AMV is fine', d1.error);
  const chat = await ask(env, tok);
  ok(chat.status === 200, 'chat is untouched', chat.status);
  await flipSwitch(env, 'feature:library', false);
  const r2 = await call(env, '/v1/library', undefined, { Authorization: 'Bearer ' + tok });
  ok(r2.status !== 503, 'switched back on, it answers again', r2.status);
}

section('One engine off: refused by name, never swapped; the others run');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  await flipSwitch(env, 'model:amv-core', true, 'provider errors');
  modelCalls = [];
  const r = await ask(env, tok);
  const d = await r.json();
  ok(r.status === 503 && d.code === 'paused' && d.engine === 'amv-core', 'the paused engine is refused, and says which', d);
  ok(modelCalls.length === 0, 'and the model is not called', modelCalls.length);
  const other = await call(env, '/v1/messages', { model: 'amv-swift', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }, { Authorization: 'Bearer ' + tok });
  ok(other.status === 200, 'another engine still answers', other.status);
}

section('A connector off: its actions stop before anything is called');
{
  const env = mkEnv({ CONNECT_KEY: 'k'.repeat(32) });
  const tok = await signedIn(env);
  await flipSwitch(env, 'connector:gmail', true, 'wrong results reported');
  const r = await call(env, '/v1/connect/act', { action: 'gmail.unread' }, { Authorization: 'Bearer ' + tok });
  const d = await r.json();
  ok(r.status === 503 && d.code === 'paused' && d.switch === 'connector:gmail', 'a Gmail action is paused', d);
  await flipSwitch(env, 'connector:gmail', false);
  await flipSwitch(env, 'write:gmail.send', true);
  const send = await call(env, '/v1/connect/act', { action: 'gmail.send', args: {} }, { Authorization: 'Bearer ' + tok });
  ok(send.status === 503 && (await send.json()).switch === 'write:gmail.send', 'one write can be stopped on its own');
  const read = await call(env, '/v1/connect/act', { action: 'gmail.unread' }, { Authorization: 'Bearer ' + tok });
  ok(read.status !== 503, 'while reading the same account still goes through to the next check', read.status);
}

section('Background jobs off: nothing runs, nothing is lost');
{
  const env = mkEnv();
  await signedIn(env);
  await W.DB.put(env, 'auto', USER, { items: [{ id: 'a1', name: 'j', prompt: 'p', active: true, next: Date.now() - 60000, every: 'day' }] });
  await flipSwitch(env, 'feature:automations', true);
  modelCalls = [];
  const r = await W.runDueAutomations(env, Date.now());
  ok(r.paused === true && r.ran === 0 && modelCalls.length === 0, 'the scheduler runs nothing', r);
  const rec = await W.DB.get(env, 'auto', USER);
  ok(rec.items[0].active === true && rec.items[0].next < Date.now(), 'and the job is still there, still due', rec.items[0]);
}

section('Only the owner can flip one, and only a real one');
{
  const env = mkEnv();
  const tok = await signedIn(env);
  const asUser = await call(env, '/v1/admin/switch', { name: 'feature:library', off: true }, { Authorization: 'Bearer ' + tok });
  ok(asUser.status === 403, 'a signed-in customer cannot', asUser.status);
  const bad = await call(env, '/v1/admin/switch', { name: 'everything', off: true }, ADMIN);
  ok(bad.status === 400, 'a name that is not a switch is refused', bad.status);
  const nofeat = await call(env, '/v1/admin/switch', { name: 'feature:teleporter', off: true }, ADMIN);
  ok(nofeat.status === 400, 'and a feature that does not exist', nofeat.status);
  const list = await call(env, '/v1/admin/switches', undefined, ADMIN);
  const ld = await list.json();
  ok(list.status === 200 && ld.features.library && Array.isArray(ld.models), 'the console can list what exists', Object.keys(ld));
  await flipSwitch(env, 'feature:widget', true);
  const kill = await call(env, '/v1/admin/switches', undefined, ADMIN);
  ok(kill.status === 200, 'and the switch routes are never themselves switched off', kill.status);
}

if (report('one-part-of-amv-can-be-switched-off') > 0) process.exitCode = 1;
done();
