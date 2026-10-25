/* YOU CAN SEE WHERE YOUR USAGE WENT.

   The Usage screen said how much of the month was gone, and nothing about
   where: a person whose allowance ran out on the 20th could not tell whether
   Crew, a project, or an API key had spent it. Every request was recorded as
   "chat", because the one metered path never asked.

   Now each answer is counted, as it is metered, by surface and by project,
   and /v1/usage hands the month back. What is checked here, against the real
   counter object (not a stub that stores nothing):

     the app's own sign-in may say which screen and project a request came
     from, from a fixed list - and nothing else it says is believed;
     an API key is counted as the API whatever its body claims, and never
     gets a project, so a key cannot dress its usage up as the person's;
     a month keeps a bounded number of projects and folds the rest into one;
     and the label changes nothing about what was charged. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'usagewhere.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _usageTagOf, LIFE_PROJECTS_MAX };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'where@example.com';
const PW = 'A-real-Passw0rd!';

const sse = (n) => 'data: {"type":"message_start","message":{"usage":{"input_tokens":' + n + ',"output_tokens":0}}}\n\n'
  + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
  + 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n'
  + 'data: {"type":"message_stop"}\n\n';
let upstream = [];
globalThis.fetch = async (url, init) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  upstream.push(JSON.parse(init.body));
  return new Response(sse(90), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

/* The real Durable Object, one per name, over an in-memory storage. */
function mkEnv() {
  const m = new Map(); const objs = new Map();
  const env = {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
  };
  env.AMV_COUNTER = {
    idFromName: (n) => n,
    get: (n) => {
      if (!objs.has(n)) {
        const st = new Map();
        const storage = { async get(k) { return st.get(k); }, async put(k, v) { st.set(k, structuredClone(v)); },
          async delete(k) { st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {}, async deleteAlarm() {} };
        objs.set(n, new W.AMVCounter({ storage }, env));
      }
      const o = objs.get(n);
      return { fetch: (u, init) => o.fetch(new Request('https://do/', init)) };
    },
  };
  return env;
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); this._p = []; } };
const call = (env, path, body, tok, method = 'POST') => worker.fetch(new Request('https://api.amv.test' + path, {
  method,
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '41.41.41.41' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
  body: method === 'POST' ? JSON.stringify(body) : undefined,
}), env, ctx);
const ask = async (env, tok, amv) => {
  const r = await call(env, '/v1/messages', Object.assign({ model: 'amv-core', max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] }, amv ? { amv } : {}), tok);
  await r.text(); await ctx.settle(); return r.status;
};
const usage = async (env, tok) => (await call(env, '/v1/usage', null, tok, 'GET')).json();

const env = mkEnv();
const tok = (await (await call(env, '/auth/signup', { email: USER, name: 'W', password: PW })).json()).token;
await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });

section('The app says which screen and project; the month is broken down by both');
{
  ok(await ask(env, tok, { surface: 'chat', project: 'ws1' }) === 200, 'a chat in a project is served');
  await ask(env, tok, { surface: 'crew' });
  await ask(env, tok, { surface: 'build', project: 'ws1700000000000' });
  await ask(env, tok);
  const b = (await usage(env, tok)).breakdown;
  const cur = b && b.current;
  ok(cur && cur.tokens === 400, 'four answers of 100 tokens each this month', cur && cur.tokens);
  ok(cur && cur.surfaces.chat === 200 && cur.surfaces.crew === 100 && cur.surfaces.build === 100,
     'by surface: two chats (one unlabelled), Crew, Build', cur && cur.surfaces);
  ok(cur && cur.projects.ws1 === 100 && cur.projects.ws1700000000000 === 100 && Object.keys(cur.projects).length === 2,
     'by project: each id once, nothing for the requests outside one', cur && cur.projects);
  ok(b && b.previous && b.previous.tokens === 0 && /^\d{4}-\d{2}$/.test(b.previous.month), 'and last month is there to compare, empty here', b && b.previous);
}

section('Nothing the page says beyond the list is believed');
{
  const before = (await usage(env, tok)).breakdown.current;
  await ask(env, tok, { surface: 'batch' });
  await ask(env, tok, { surface: 'api', project: '../../etc' });
  await ask(env, tok, { surface: 'Chat<script>', project: '_other' });
  const cur = (await usage(env, tok)).breakdown.current;
  ok(!cur.surfaces.batch && !cur.surfaces.api, 'a signed-in page cannot claim to be a batch or an API key', cur.surfaces);
  ok(cur.surfaces.chat === (before.surfaces.chat || 0) + 300, 'what it claimed falls back to chat', cur.surfaces);
  ok(Object.keys(cur.projects).length === 2, 'and neither a path nor the reserved bucket becomes a project', cur.projects);
}

section('An API key is the API, whatever its body says');
{
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const kr = await call(env, '/v1/keys/create', { name: 'k' }, tok);
  const key = (await kr.json()).key;
  ok(typeof key === 'string' && key.length > 10, 'a key was made', kr.status);
  const before = (await usage(env, tok)).breakdown.current;
  const st = await ask(env, key, { surface: 'chat', project: 'ws1' });
  const cur = (await usage(env, tok)).breakdown.current;
  ok(st === 200, 'the key is served', st);
  ok(cur.surfaces.api === 100, 'and counted as the API', cur.surfaces);
  ok(cur.surfaces.chat === before.surfaces.chat && cur.projects.ws1 === before.projects.ws1,
     'not as chat, and not as the project it named', { chat: cur.surfaces.chat, ws1: cur.projects.ws1 });
}

section('The label never reaches the engine and changes nothing about the charge');
{
  ok(upstream.length > 0 && upstream.every(b => !('amv' in b)), 'no request sent upstream carries it', upstream.map(b => Object.keys(b)));
  const booked = async (labels) => {
    const e = mkEnv(), who = 'two' + labels.length + Math.random().toString(36).slice(2, 6) + '@example.com';
    const t = (await (await call(e, '/auth/signup', { email: who, name: 'T', password: PW })).json()).token;
    await W.DB.put(e, 'ent', who, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
    for (const a of labels) await ask(e, t, a);
    const u = await usage(e, t);
    return { day: u.day.used, month: u.month.used, cost: u.month.costPct };
  };
  const plain = await booked([null, null]);
  const tagged = await booked([{ surface: 'crew', project: 'p1' }, { surface: 'build' }]);
  ok(plain.day > 0 && JSON.stringify(plain) === JSON.stringify(tagged), 'two answers book exactly the same, labelled or not', { plain, tagged });
}

section('A month keeps a bounded list of projects');
{
  const e3 = mkEnv();
  const t3 = (await (await call(e3, '/auth/signup', { email: 'many@example.com', name: 'M', password: PW })).json()).token;
  await W.DB.put(e3, 'ent', 'many@example.com', { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const N = W.LIFE_PROJECTS_MAX + 5;
  for (let i = 0; i < N; i++) await ask(e3, t3, { surface: 'chat', project: 'p' + i });
  const p = (await usage(e3, t3)).breakdown.current.projects;
  ok(Object.keys(p).length === W.LIFE_PROJECTS_MAX + 1 && p._other === 500, 'the first ' + W.LIFE_PROJECTS_MAX + ' by name, the rest in one bucket', Object.keys(p).length + ' / ' + p._other);
  ok(Object.values(p).reduce((a, b) => a + b, 0) === N * 100, 'and every token is still counted', Object.values(p).reduce((a, b) => a + b, 0));
}

report('you-can-see-where-your-usage-went');
done();
