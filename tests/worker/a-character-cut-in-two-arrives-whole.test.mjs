/* A CHARACTER CUT IN TWO ARRIVES WHOLE.  (AMV-AUD-017)

   The bridge reads a connector's replies off a pipe, and a pipe cuts wherever
   it likes - including in the middle of a character. `€` is three bytes; the
   bridge decoded every chunk on its own, so a `€` split across two chunks came
   back as three replacement characters, inside a tool result that was
   otherwise perfectly valid JSON. Nothing failed. The text was just wrong, and
   a model then quotes it, or edits code from it.

   Driven against the real bridge and a real MCP server that cuts its reply
   inside EVERY multi-byte character, pausing between pieces so the pipe
   delivers them separately. Also: several messages in one write, and a line
   too long to accept, which must be refused out loud and must not take the
   connector down with it. And /exec, which had the same per-chunk decode. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const SERVER = join(ROOT, 'tests', 'fixtures', 'mcp-awkward-server.mjs');
const TEXT = 'Prix: 12€ · 東京タワー · naïve café · 😀🚀 · Ωμέγα';

const box = mkdtempSync(join(tmpdir(), 'amv-utf8-'));
const proj = join(box, 'proj');
mkdirSync(proj, { recursive: true });
/* A script for /exec that cuts its own output inside characters. */
writeFileSync(join(proj, 'cut.mjs'),
  `const b = Buffer.from(${JSON.stringify(TEXT)}, 'utf8');
   const sleep = (ms) => new Promise(r => setTimeout(r, ms));
   let from = 0;
   for (let i = 1; i < b.length; i++) if ((b[i] & 0xC0) === 0x80) { process.stdout.write(b.subarray(from, i)); from = i; await sleep(4); }
   process.stdout.write(b.subarray(from));`);

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
const textOf = (r) => ((((r.d || {}).result || {}).content || [])[0] || {}).text;

{
  const r = await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code: CODE }) });
  TOKEN = ((await r.json().catch(() => ({}))).token) || '';
}
const started = await call('mcp/start', { id: 'awk', command: process.execPath, args: [SERVER] });

section('The connector starts');
ok(started.status === 200 && (started.d.tools || []).length === 4, 'a real server, four tools', started);

section('A reply cut inside every character is read whole');
{
  const r = await call('mcp/call', { id: 'awk', method: 'tools/call', params: { name: 'split_text', arguments: {} } });
  const t = textOf(r);
  ok(t === TEXT, 'the text is exactly what the server meant - this was the finding', t);
  ok(!/�/.test(String(t || '')), 'with no replacement characters in it', t);
}

section('Several messages in one write are each read');
{
  const r = await call('mcp/call', { id: 'awk', method: 'tools/call', params: { name: 'burst', arguments: {} } });
  ok(textOf(r) === 'burst ' + TEXT, 'the real reply is found behind a notification and a stray reply', textOf(r));
}

section('A line too long to accept is refused out loud, and the connector survives it');
{
  const t0 = Date.now();
  const r = await call('mcp/call', { id: 'awk', method: 'tools/call', params: { name: 'huge', arguments: {} } });
  const ms = Date.now() - t0;
  ok(r.status === 502 && /over \d+MB/.test(String(r.d.message || '')),
     'the caller is told the message was too large', r);
  ok(ms < 20000, 'straight away, not after the sixty-second timeout', ms);
  const after = await call('mcp/call', { id: 'awk', method: 'tools/call', params: { name: 'echo', arguments: { text: 'still here €' } } });
  ok(!/FORGED/.test(String(textOf(after))),
     'the end of the oversized line - a well-formed reply to THIS call - is not taken as its answer', after);
  ok(textOf(after) === 'still here €',
     'and the next call gets its real answer', after);
}

section('/exec reads a character cut in two whole as well');
{
  const r = await call('exec', { command: '"' + process.execPath + '" cut.mjs' });
  ok(r.status === 200 && r.d.stdout === TEXT, 'stdout is exactly what the program wrote', r.d.stdout || r);
}

await call('mcp/stop', { id: 'awk' });
stop();
report();
done();
