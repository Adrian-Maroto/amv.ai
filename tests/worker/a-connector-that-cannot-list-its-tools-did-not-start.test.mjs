/* A CONNECTOR THAT CANNOT LIST ITS TOOLS DID NOT START.  (AMV-AUD-018)

   Starting a connector is a handshake and then a listing of its tools. When
   the listing failed, the bridge returned a successful start with no tools -
   and a server that really offers nothing looks exactly the same on the
   screen, so a broken connector read as an empty one. When the listing came
   in pages, the bridge returned the first page and stopped, so tools the
   server offers were silently missing.

   Driven against the real bridge and a real server switched into each case:
   a listing error, a malformed handshake, a listing in four pages, a cursor
   handed back twice, a listing that never ends, and - so the fix does not
   swing too far - a valid server that genuinely has no tools. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const AWKWARD = join(ROOT, 'tests', 'fixtures', 'mcp-awkward-server.mjs');
const ECHO = join(ROOT, 'tests', 'fixtures', 'mcp-echo-server.mjs');

const box = mkdtempSync(join(tmpdir(), 'amv-discovery-'));
const proj = join(box, 'proj');
mkdirSync(proj, { recursive: true });

const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj],
                    { stdio: ['ignore', 'pipe', 'pipe'] });
let banner = '';
child.stdout.on('data', b => { banner += b.toString(); });
child.stderr.on('data', b => { banner += b.toString(); });
const stop = () => { try { child.kill('SIGKILL'); } catch (e) {} };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('uncaughtException', (e) => { stop(); console.error(e); process.exit(1); });

const waitFor = async (re, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const m = banner.match(re); if (m) return m; await new Promise(r => setTimeout(r, 60)); }
  return null;
};
const PORT = (await waitFor(/Port\s+(\d+)/, 8000) || [])[1] || '0';
const CODE = (await waitFor(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000) || [])[1] || '';
const base = 'http://127.0.0.1:' + PORT;
let TOKEN = '';
const call = async (route, body) => {
  const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-AMV-Bridge-Token': TOKEN },
    body: JSON.stringify(body || {}) });
  let d = {}; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
};
{
  const r = await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code: CODE }) });
  TOKEN = ((await r.json().catch(() => ({}))).token) || '';
}
const start = (id, env, server) => call('mcp/start', { id, command: process.execPath, args: [server || AWKWARD], env: env || {} });
const running = async () => ((await call('mcp/list', {})).d.servers || []).map(s => s.id);

section('A listing that fails is a start that failed');
{
  const r = await start('listerr', { MCP_LIST_ERROR: '1' });
  ok(r.status === 502 && r.d.error === 'discovery_failed',
     'the start is refused, not reported as a server with no tools - this was the finding', r);
  ok(/discovery exploded/.test(String(r.d.message || '')), 'and says what the server said', r.d.message);
  ok(!(await running()).includes('listerr'), 'the half-started process is not left running', await running());
  const again = await start('listerr', {});
  ok(again.status === 200, 'and its name is free to start again once it works', again.status);
}

section('A handshake that is not a handshake is refused');
{
  const r = await start('badinit', { MCP_BAD_INIT: '1' });
  ok(r.status === 502 && r.d.error === 'handshake_failed', 'a non-object initialize result ends the start', r);
  ok(!(await running()).includes('badinit'), 'and the process is not left running', await running());
}

section('Every page of the listing is followed');
{
  const r = await start('paged', { MCP_PAGES: '1' });
  const names = (r.d.tools || []).map(t => t.name);
  ok(r.status === 200 && names.length === 4,
     'all four tools arrive across four pages, not the first one alone', names);
  ok(['split_text', 'burst', 'huge', 'echo'].every(n => names.includes(n)), 'each of them by name', names);
}

section('A listing that never ends is stopped, and said to be');
{
  const t0 = Date.now();
  const r = await start('repeat', { MCP_REPEAT_CURSOR: '1' });
  ok(r.status === 502 && r.d.error === 'discovery_failed' && /cursor/.test(String(r.d.message || '')),
     'a cursor handed back twice is refused rather than followed for ever', r);
  ok(Date.now() - t0 < 20000, 'promptly', Date.now() - t0);
  const e = await start('endless', { MCP_ENDLESS_PAGES: '1' });
  ok(e.status === 502 && e.d.error === 'discovery_failed' && /pages/.test(String(e.d.message || '')),
     'fresh cursors for ever stop at the page bound', e);
}

section('A server that really offers nothing still starts');
{
  const r = await start('empty', { MCP_NO_TOOLS: '1' }, ECHO);
  ok(r.status === 200 && Array.isArray(r.d.tools) && r.d.tools.length === 0,
     'no tools is a valid answer, and is not mistaken for a failure', r);
}

for (const id of await running()) await call('mcp/stop', { id });
stop();
report();
done();
