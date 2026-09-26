/* A CONNECTOR CAN CHANGE ITS TOOLS WHILE IT RUNS.

   MCP lets a server change what it offers mid-session and announce it with
   `notifications/tools/list_changed`. The bridge read the list once, at start,
   so an added tool was not seen until the next pairing. Driven against the real
   bridge and a real server that grows a tool, announces fifty times at once,
   and breaks its own listing:
     · an announcement is followed by a fresh listing, and `rev` goes up;
     · the new tool can be called;
     · fifty announcements cost a couple of listings, not fifty;
     · a listing that fails keeps the tools that were there. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const CHANGING = join(ROOT, 'tests', 'fixtures', 'mcp-changing-server.mjs');

const box = mkdtempSync(join(tmpdir(), 'amv-changing-'));
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = async (re, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const m = banner.match(re); if (m) return m; await sleep(60); }
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
const tool = (name) => call('mcp/call', { id: 'ch', method: 'tools/call', params: { name, arguments: {} } });
const textOf = (r) => String((((r.d.result || {}).content || [])[0] || {}).text || '');
const listed = async () => (await call('mcp/list', {})).d.servers.find(s => s.id === 'ch') || {};
const settle = async (pred, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const s = await listed(); if (pred(s)) return s; await sleep(80); }
  return await listed();
};

section('Started, with a count of the lists it has had');
const started = await call('mcp/start', { id: 'ch', command: process.execPath, args: [CHANGING] });
ok(started.status === 200 && started.d.rev === 0 && started.d.tools.length === 4, 'the first list is list 0', started.d);

section('A server that adds a tool and says so is listed again');
{
  const g = await tool('grow');
  ok(/added added_1/.test(textOf(g)), 'the server added a tool and announced it', g.d);
  const s = await settle(x => x.rev >= 1, 5000);
  ok(s.rev === 1 && s.tools.includes('added_1'), 'the bridge listed it again - this was the gap', s);
  const t = await call('mcp/tools', { id: 'ch' });
  ok(t.status === 200 && t.d.rev === 1 && t.d.tools.some(x => x.name === 'added_1' && x.inputSchema),
     'and hands the whole new list, schemas included, to a page that asks', t.d);
  const r = await tool('added_1');
  ok(textOf(r) === 'ran added_1', 'the new tool can be called', r.d);
}

section('Fifty announcements at once cost a couple of listings, not fifty');
{
  const before = Number(textOf(await tool('listings')));
  await tool('spam');
  await sleep(1200);
  const after = Number(textOf(await tool('listings')));
  const s = await listed();
  ok(after - before >= 1 && after - before <= 3, 'folded into one re-run while one is going', { before, after });
  ok(s.rev >= 2 && s.rev <= 4, 'and the count moved by as much, not by fifty', s.rev);
}

section('A listing that fails keeps the tools that were there');
{
  const was = await listed();
  await tool('break_listing');
  await sleep(1000);
  const s = await listed();
  ok(s.rev === was.rev && s.tools.includes('added_1') && s.tools.length === was.tools.length,
     'the list is unchanged rather than emptied', { was, now: s });
  ok(s.running === true, 'and the server is still running', s);
}

section('An unknown server has no list to hand over');
{
  const t = await call('mcp/tools', { id: 'nobody' });
  ok(t.status === 404 && t.d.error === 'no_such_server', 'refused by name', t);
  const u = await fetch(base + '/amv-bridge/mcp/tools', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ id: 'ch' }) });
  ok(u.status === 401, 'and nothing is listed to a caller that is not paired', u.status);
}

await call('mcp/stop', { id: 'ch' });
stop();
report();
done();
