/* CONNECTORS RUN ON THE CLOUD COMPUTER - FOR PAID PLANS, IN A FOLDER OF THEIR OWN.

   Owner, Nov 25: a connector should work without the person's own computer
   switched on, on paid plans only. Driven through the Worker's own
   /v1/computer/mcp/* routes; the container binding forwards to a REAL bridge
   in --cloud mode, which starts a REAL connector (tests/fixtures/mcp-echo-server.mjs)
   that speaks the protocol over stdio:

   - a free account is refused before any container is asked;
   - Pro starts a connector, sees its tools, and a call really reaches it;
   - the connector runs in a throwaway folder OUTSIDE the workspace - the
     workspace is saved to storage between sessions, and a connector may write
     its token cache wherever it runs - and that folder is gone once it stops;
   - the browser that needs a screen is refused: the cloud computer has none;
   - a connector that is not running answers no_such_server, which is what the
     page reads to start it again after the machine slept. */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readlinkSync } from 'fs';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { createServer } from 'net';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'cloud-connectors.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const KEY = 'cloud-connector-key-for-this-suite-0123456789abcdef';
const ECHO = join(ROOT, 'tests', 'fixtures', 'mcp-echo-server.mjs');
const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const machines = new Map(), asked = [];
function machine(name) {
  if (!machines.has(name)) machines.set(name, (async () => {
    const box = mkdtempSync(join(tmpdir(), 'amv-ccm-')); const port = await freePort();
    const c = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), box, '--cloud'], {
      stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { AMV_CLOUD_KEY: KEY, PORT: String(port) }) });
    running.push(c);
    let out = ''; c.stdout.on('data', b => { out += b; });
    for (let i = 0; i < 80 && !/ready on port/.test(out); i++) await new Promise(r => setTimeout(r, 100));
    return { port, box };
  })());
  return machines.get(name);
}
const NS = {
  idFromName: (name) => ({ name }),
  get: (id) => ({
    async fetch(req) {
      const path = new URL(req.url).pathname;
      asked.push({ name: id.name, path });
      const m = await machine(id.name);
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
    AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
      if (b.op === 'incr') { vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
      if (b.op === 'get') return r({ value: cur });
      return r({ allowed: true, value: cur, count: 1 });
    } }) }),
  }, extra || {});
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const call = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.8.0.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}) }), env, ctx);
async function account(env, email, plan) {
  const tok = (await (await call(env, '/auth/signup', { email, name: 'C', password: 'A-real-Passw0rd!' })).json()).token;
  if (plan !== 'free') await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const jsonOf = async (r) => ({ status: r.status, d: await r.json().catch(() => ({})) });

const env = mkEnv({ AMV_COMPUTER: NS, AMV_COMPUTER_KEY: KEY });
const free = await account(env, 'free-ccm@example.com', 'free');
const pro = await account(env, 'pro-ccm@example.com', 'pro');
const pidFile = join(mkdtempSync(join(tmpdir(), 'amv-ccm-pid-')), 'pid');
const START = { id: 'echo', command: process.execPath, args: [ECHO], env: { MCP_PID_FILE: pidFile } };

section('A free account is refused before any machine is asked');
{
  for (const route of ['mcp/start', 'mcp/call', 'mcp/list']) {
    const r = await jsonOf(await call(env, '/v1/computer/' + route, START, free));
    ok(r.status === 402 && r.d.code === 'plan_required', route + ': plan required', r);
  }
  ok(asked.length === 0, 'and no container was asked', asked);
}

let workDir = '';
section('Pro starts a connector there, and a call really reaches it');
{
  const s = await jsonOf(await call(env, '/v1/computer/mcp/start', START, pro));
  ok(s.status === 200 && Array.isArray(s.d.tools) && s.d.tools.some(t => t.name === 'shout'), 'it starts and lists its tools', s);
  ok(asked.every(a => a.path.startsWith('/amv-bridge/mcp/')), 'what reached the machine was the bridge’s connector route', asked);
  const c = await jsonOf(await call(env, '/v1/computer/mcp/call', { id: 'echo', method: 'tools/call', params: { name: 'shout', arguments: { text: 'cloud' } } }, pro));
  ok(c.status === 200 && JSON.stringify(c.d.result || {}).includes('CLOUD'), 'a tool call comes back from the real process', c.d);
  const l = await jsonOf(await call(env, '/v1/computer/mcp/list', {}, pro));
  ok(l.status === 200 && l.d.servers.length === 1 && l.d.servers[0].running === true, 'the list shows it running', l.d);
  const t = await jsonOf(await call(env, '/v1/computer/mcp/tools', { id: 'echo' }, pro));
  ok(t.status === 200 && t.d.tools.length === s.d.tools.length, 'and its whole tool list can be asked for again', t.d);
}

section('It runs in a folder of its own, outside the saved workspace');
{
  const box = (await [...machines.values()][0]).box;
  let pid = ''; for (let i = 0; i < 30 && !pid; i++) { try { pid = readFileSync(pidFile, 'utf8').trim(); } catch (e) {} if (!pid) await new Promise(r => setTimeout(r, 50)); }
  try { workDir = readlinkSync('/proc/' + pid + '/cwd'); } catch (e) {}
  ok(/\/amv-mcp-[^/]+$/.test(workDir), 'its folder is a fresh amv-mcp- folder', workDir);
  ok(workDir && !workDir.startsWith(box), 'not the workspace, which is saved between sessions', { workDir, box });
  const st = await jsonOf(await call(env, '/v1/computer/mcp/stop', { id: 'echo' }, pro));
  ok(st.status === 200 && st.d.stopped === true, 'stopping it is said as stopped', st.d);
  ok(workDir && !existsSync(workDir), 'and its folder is gone', workDir);
}

section('The browser that needs a screen is refused there');
{
  const r = await jsonOf(await call(env, '/v1/computer/mcp/start', { id: 'amv-browser', command: process.execPath, args: [ECHO], desktop: true }, pro));
  ok(r.status === 403 && r.d.error === 'no_screen' && /own computer/.test(r.d.message), 'no screen, and it says where that runs', r);
  const l = await jsonOf(await call(env, '/v1/computer/mcp/list', {}, pro));
  ok(l.d.servers.length === 0, 'and nothing was started', l.d);
}

section('A connector that is not running says so, so the page can start it again');
{
  const r = await jsonOf(await call(env, '/v1/computer/mcp/call', { id: 'echo', method: 'tools/list' }, pro));
  ok(r.status === 404 && r.d.error === 'no_such_server', 'no_such_server - not a crash, not an empty answer', r);
}

for (const c of running) try { c.kill('SIGKILL'); } catch (e) {}
if (report('connectors-run-on-the-cloud-computer-for-paid-plans') > 0) process.exitCode = 1;
done();
