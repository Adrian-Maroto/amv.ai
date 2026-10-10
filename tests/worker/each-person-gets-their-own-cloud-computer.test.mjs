/* EACH PERSON GETS THEIR OWN CLOUD COMPUTER - AND IT IS PAID FOR BY THE MINUTE.

   Driven through the Worker's own /v1/computer routes. Cloudflare's container
   runtime cannot run here, so the binding is stood in for - and what it
   forwards to is a REAL bridge in --cloud mode, so a command really runs and
   a file is really written:

   - not switched on (no binding, or a key too short to be one): it says so,
     and the app's info says it is unavailable;
   - free accounts are refused; Pro reaches a machine;
   - each person reaches their own container, named from a hash of the
     signed-in account - never the address itself, never anything the request
     says;
   - the key the Worker holds is what the container is asked with;
   - command time is counted from what the bridge measured, shows in info,
     and once the month's minutes are spent the next command is refused
     before the container is asked;
   - a container that will not start is said as that, not as a crash;
   - only the bridge's own routes exist under /v1/computer. */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { createServer } from 'net';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'computer.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const KEY = 'cloud-computer-key-for-this-suite-0123456789abcdef';
const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

/* One real cloud bridge per container name, started the first time it is asked for. */
const machines = new Map(), asked = [];
let failStart = false;
async function machine(name) {
  if (machines.has(name)) return machines.get(name);
  const box = mkdtempSync(join(tmpdir(), 'amv-cc-')); const port = await freePort();
  const c = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), box, '--cloud'], {
    stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { AMV_CLOUD_KEY: KEY, PORT: String(port) }) });
  running.push(c);
  let out = ''; c.stdout.on('data', b => { out += b; });
  for (let i = 0; i < 80 && !/ready on port/.test(out); i++) await new Promise(r => setTimeout(r, 100));
  const m = { port, box }; machines.set(name, m); return m;
}
const NS = {
  idFromName: (name) => ({ name }),
  get: (id) => ({
    async fetch(req) {
      if (failStart) throw new Error('container failed to start');
      asked.push({ name: id.name, url: req.url, key: req.headers.get('X-AMV-Bridge-Token') });
      const m = await machine(id.name);
      const path = new URL(req.url).pathname;
      return fetch('http://127.0.0.1:' + m.port + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AMV-Bridge-Token': req.headers.get('X-AMV-Bridge-Token') || '' }, body: await req.text() });
    },
  }),
};

function mkEnv(extra) {
  const m = new Map(), vals = new Map();
  return Object.assign({
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test', _vals: vals,
    AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
      if (b.op === 'incr') { vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
      if (b.op === 'get') return r({ value: cur });
      return r({ allowed: true, value: cur, count: 1 });
    } }) },
  }, extra || {});
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const call = (env, path, body, tok, method) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.0.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: method === 'GET' ? undefined : JSON.stringify(body || {}) }), env, ctx);
async function account(env, email, plan) {
  const tok = (await (await call(env, '/auth/signup', { email, name: 'C', password: 'A-real-Passw0rd!' })).json()).token;
  if (plan !== 'free') await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const jsonOf = async (r) => ({ status: r.status, d: await r.json().catch(() => ({})) });

section('Not switched on: it says so');
{
  for (const [what, extra] of [['no binding', {}], ['a key too short to be one', { AMV_COMPUTER: NS, AMV_COMPUTER_KEY: 'short' }]]) {
    const env = mkEnv(extra);
    const t = await account(env, 'off@example.com', 'pro');
    const r = await jsonOf(await call(env, '/v1/computer/exec', { command: 'echo hi' }, t));
    ok(r.status === 503 && r.d.code === 'needs_service' && /not switched on/.test(r.d.error), what + ': refused, and said plainly', r);
    const info = await jsonOf(await call(env, '/v1/computer/info', null, t, 'GET'));
    ok(info.d.available === false, what + ': info says unavailable', info.d);
  }
}

const env = mkEnv({ AMV_COMPUTER: NS, AMV_COMPUTER_KEY: KEY });
const free = await account(env, 'free-cc@example.com', 'free');
const pat = await account(env, 'pat-cc@example.com', 'pro');
const sam = await account(env, 'sam-cc@example.com', 'pro');

section('A free account is refused; Pro reaches a machine that really runs');
{
  const f = await jsonOf(await call(env, '/v1/computer/exec', { command: 'echo hi' }, free));
  ok(f.status === 402 && f.d.code === 'plan_required', 'free: plan required', f);
  ok(asked.length === 0, 'and no container was asked');
  const w = await jsonOf(await call(env, '/v1/computer/write', { path: 'a.txt', content: 'pat was here' }, pat));
  ok(w.status === 200, 'Pro writes a file', w);
  const e = await jsonOf(await call(env, '/v1/computer/exec', { command: 'cat a.txt' }, pat));
  ok(e.status === 200 && /pat was here/.test(e.d.stdout), 'and a command reads it back', e.d);
}

section('Each person reaches their own container, named from a hash');
{
  const e = await jsonOf(await call(env, '/v1/computer/exec', { command: 'cat a.txt || echo none' }, sam));
  ok(e.status === 200 && !/pat was here/.test(e.d.stdout), 'Sam does not see Pat’s file', e.d.stdout);
  const names = [...new Set(asked.map(a => a.name))];
  ok(names.length === 2 && names.every(n => /^u:[0-9a-f]{48}$/.test(n)), 'two containers, each named by a hash', names);
  ok(!asked.some(a => /example\.com/.test(a.name + a.url)), 'and no address appears in a name or a path');
  ok(asked.every(a => a.key === KEY), 'every request carried the Worker’s key');
  const forged = await jsonOf(await call(env, '/v1/computer/exec', { command: 'echo x', container: 'u:' + '0'.repeat(48), email: 'pat-cc@example.com' }, sam));
  ok(forged.status === 200 && asked[asked.length - 1].name === names[1], 'a name or address in the request changes nothing', asked[asked.length - 1].name);
}

section('Command time is counted, shown, and stops at the plan’s minutes');
{
  const before = await jsonOf(await call(env, '/v1/computer/info', null, pat, 'GET'));
  ok(before.d.available === true && before.d.allowed === true && before.d.minutes.cap === 300 && before.d.minutes.used >= 1, 'info shows the minutes used and the cap', before.d);
  const key = [...env._vals.keys()].find(k => k.startsWith('cmin:pat-cc@example.com'));
  env._vals.set(key, 300 * 60);
  const n = asked.length;
  const r = await jsonOf(await call(env, '/v1/computer/exec', { command: 'echo more' }, pat));
  ok(r.status === 429 && r.d.code === 'computer_minutes' && /300 minutes/.test(r.d.error), 'spent: the next command is refused, and says why', r.d);
  ok(asked.length === n, 'without asking the container');
  const rd = await jsonOf(await call(env, '/v1/computer/read', { path: 'a.txt' }, pat));
  ok(rd.status === 200 && rd.d.content === 'pat was here', 'reading a file still works - only command time is metered', rd.d);
}

section('A container that will not start is said as that');
{
  failStart = true;
  const r = await jsonOf(await call(env, '/v1/computer/exec', { command: 'echo hi' }, sam));
  ok(r.status === 503 && r.d.code === 'computer_unavailable' && /did not start/.test(r.d.error), 'it says the cloud computer did not start', r);
  failStart = false;
}

section('Only the bridge’s own routes exist there');
{
  const r = await call(env, '/v1/computer/pair', { code: 'x' }, pat);
  ok(r.status === 404, 'pairing is not a route', r.status);
  const m = await call(env, '/v1/computer/mcp/start', {}, pat);
  ok(m.status === 404, 'nor are connectors', m.status);
}

for (const c of running) try { c.kill('SIGKILL'); } catch (e) {}
if (report('each-person-gets-their-own-cloud-computer') > 0) process.exitCode = 1;
done();
