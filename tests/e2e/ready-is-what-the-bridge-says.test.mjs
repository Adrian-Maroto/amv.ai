/* "READY" IS WHAT THE BRIDGE SAYS, NOT WHAT THE TAB REMEMBERS.  (AMV-AUD-019)

   Connecting a computer starts every configured connector and says how many
   are ready. The start skipped any connector that already had an entry in the
   tab's table and counted it ready - and a failed start leaves an entry too,
   holding the error. So a connector that had failed once was announced ready,
   with zero tools, and nothing ever tried it again. One whose process had died
   since was announced the same way.

   Driven against a real bridge and a real MCP server, with four connectors in
   the four states the audit named: one that failed before, one whose process
   was killed, one that is up and offers no tools (valid, and not a failure),
   and one that is up and ready. Only the last two may be reused; the first two
   must actually be started again, and what is reported is what that start
   said. A fifth can never start, and must say so every time. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(ROOT, 'tests', 'fixtures', 'mcp-echo-server.mjs');
const box = mkdtempSync(join(tmpdir(), 'amv-mcp-ready-'));
const proj = join(box, 'proj');
mkdirSync(proj, { recursive: true });
const pidFile = (id) => join(box, id + '.pid');
const pidOf = (id) => existsSync(pidFile(id)) ? readFileSync(pidFile(id), 'utf8').trim() : '';

const bridge = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: Object.assign({}, process.env, { AMV_BRIDGE_DEV: '1' }),
});
const stop = () => { try { bridge.kill('SIGKILL'); } catch (e) {} };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('uncaughtException', (e) => { stop(); console.error(e); process.exit(1); });

let banner = '';
bridge.stdout.on('data', b => { banner += b.toString(); });
bridge.stderr.on('data', b => { banner += b.toString(); });
const waitFor = async (re, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const m = banner.match(re); if (m) return m; await new Promise(r => setTimeout(r, 60)); }
  return null;
};
const PORT = (await waitFor(/Port\s+(\d+)/, 8000) || [])[1] || '0';
const CODE = (await waitFor(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000) || [])[1] || '';

const A = await bootApp({ tab: 'chat' });
const { page, errors } = A;

const first = await page.evaluate(async ([port, code, exe, server, files]) => {
  for (const id of ['failed', 'dead', 'empty', 'ready']) {
    const env = { MCP_PID_FILE: files[id] };
    if (id === 'empty') env.MCP_NO_TOOLS = '1';
    _mcpAdd(id, exe, [server], env);
  }
  _mcpAdd('broken', exe, [server + '.does-not-exist'], {});
  await _bridgePair(port, code);
  return await mcpStartAll();
}, [PORT, CODE, process.execPath, SERVER,
    { failed: pidFile('failed'), dead: pidFile('dead'), empty: pidFile('empty'), ready: pidFile('ready') }]);

section('The first start is real');
{
  const by = Object.fromEntries(first.map(r => [r.id, r]));
  ok(['failed', 'dead', 'empty', 'ready'].every(id => by[id] && by[id].ok === true),
     'the four good connectors start', first);
  ok(by.empty && by.empty.tools === 0, 'the empty one is up with no tools - valid, not a failure', by.empty);
  ok(by.broken && by.broken.ok === false, 'the broken one says it could not start', by.broken);
}

/* Now put two of them into the states that used to be reported as ready. */
const pidsBefore = { failed: pidOf('failed'), dead: pidOf('dead'), empty: pidOf('empty'), ready: pidOf('ready') };
await page.evaluate(() => {
  /* A failure recorded earlier, the way mcpStartAll records one. */
  MCP.live.failed = { tools: [], info: null, error: 'it failed last time', session: BRIDGE.token };
});
try { process.kill(Number(pidsBefore.dead), 'SIGKILL'); } catch (e) {}
await new Promise(r => setTimeout(r, 400));

const second = await page.evaluate(async () => {
  const out = await mcpStartAll();
  return { out, live: Object.fromEntries(Object.keys(MCP.live).map(k => [k, { n: (MCP.live[k].tools || []).length, error: MCP.live[k].error }])) };
});
const by2 = Object.fromEntries(second.out.map(r => [r.id, r]));
const pidsAfter = { failed: pidOf('failed'), dead: pidOf('dead'), empty: pidOf('empty'), ready: pidOf('ready') };

section('A connector that failed before is tried again, not announced ready');
{
  ok(by2.failed && by2.failed.ok === true && !by2.failed.reused,
     'it is started again rather than reused - this was the finding', by2.failed);
  ok(by2.failed && by2.failed.tools === 2 && second.live.failed.n === 2 && !second.live.failed.error,
     'and it reports the tools the fresh start really found', { report: by2.failed, live: second.live.failed });
}

section('A connector whose process died is started again');
{
  ok(by2.dead && !by2.dead.reused, 'it is not reused', by2.dead);
  ok(pidsAfter.dead && pidsAfter.dead !== pidsBefore.dead,
     'a new process is really running for it', { before: pidsBefore.dead, after: pidsAfter.dead });
  ok(by2.dead && by2.dead.ok === true && by2.dead.tools === 2, 'and it is ready with its tools', by2.dead);
}

section('A connector that is really running is left alone');
{
  ok(by2.ready && by2.ready.ok === true && by2.ready.reused === true && pidsAfter.ready === pidsBefore.ready,
     'the ready one is reused - same process, no restart', { report: by2.ready, pids: [pidsBefore.ready, pidsAfter.ready] });
  ok(by2.empty && by2.empty.ok === true && by2.empty.reused === true && by2.empty.tools === 0
     && pidsAfter.empty === pidsBefore.empty,
     'and so is the empty one - offering nothing is not failing', by2.empty);
}

section('A connector that can never start says so every time');
{
  ok(by2.broken && by2.broken.ok === false && by2.broken.error,
     'the second attempt reports the failure again instead of "ready"', by2.broken);
}

section('A cached entry from another pairing is not trusted');
{
  const r = await page.evaluate(async () => {
    MCP.live.ready.session = 'a-token-from-an-earlier-bridge';
    const out = await mcpStartAll();
    return out.find(x => x.id === 'ready');
  });
  const after = pidOf('ready');
  ok(r && r.ok === true && !r.reused && after !== pidsAfter.ready,
     'it is restarted rather than reused', { report: r, pids: [pidsAfter.ready, after] });
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await A.close();
stop();
report();
done();
