/* THE BRIDGE BOUNDS WHAT RUNS AT ONCE, NOT ONLY EACH THING.  (AMV-AUD-022)

   Every request to the bridge had limits of its own - body size, output,
   time - and nothing limited how many there were. Twenty builds asked for at
   once started twenty, each inside its own bounds and together enough to take
   somebody's machine. A connector that stopped answering collected requests
   without end. A negative timeout slipped through `Number(x) || default` and
   killed the command the moment it started, and the output ceiling counted
   characters, letting text that is not ASCII through at up to four times it.

   All against the real daemon. The fifth command is checked for not having
   STARTED, by a file it would have written - a refusal that still spawned the
   process would be a limit on the reply, not on the work. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const AWKWARD = join(ROOT, 'tests', 'fixtures', 'mcp-awkward-server.mjs');
const NODE = '"' + process.execPath + '"';

const box = mkdtempSync(join(tmpdir(), 'amv-bounds-'));
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
const call = async (route, body, opts) => {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (!(opts && opts.noToken)) headers['X-AMV-Bridge-Token'] = TOKEN;
  const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST', headers, body: JSON.stringify(body || {}),
                                                      signal: opts && opts.signal });
  let d = {}; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
};
{
  const r = await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code: CODE }) });
  TOKEN = ((await r.json().catch(() => ({}))).token) || '';
}

section('The counts are readable, and only by the paired page');
{
  const no = await call('status', {}, { noToken: true });
  ok(no.status === 401, 'an unpaired caller is refused', no.status);
  const r = await call('status', {});
  ok(r.status === 200 && r.d.exec && r.d.exec.running === 0 && r.d.exec.max >= 1,
     'nothing is running, and the limit is stated', r.d);
}

section('Commands past the limit are refused before they start');
{
  const sleeper = NODE + ' -e "setTimeout(()=>{},2500)"';
  const first = Array.from({ length: 4 }, () => call('exec', { command: sleeper, timeout: 20000 }));
  await new Promise(r => setTimeout(r, 500));
  const mid = await call('status', {});
  const marker = join(proj, 'fifth-ran.txt');
  const fifth = await call('exec', { command: NODE + ' -e "require(\'fs\').writeFileSync(\'fifth-ran.txt\',\'x\')"' });
  ok(mid.d.exec.running === 4, 'four are running', mid.d.exec);
  ok(fifth.status === 429 && fifth.d.error === 'busy' && fifth.d.running === 4,
     'the fifth is refused as busy, saying how many are running - this was the finding', fifth);
  await new Promise(r => setTimeout(r, 300));
  ok(!existsSync(marker), 'and it never started: the file it would have written does not exist', existsSync(marker));
  const done4 = await Promise.all(first);
  ok(done4.every(x => x.status === 200 && x.d.exitCode === 0), 'the four finish normally', done4.map(x => x.status));
  const after = await call('exec', { command: NODE + ' -e "console.log(1)"' });
  ok(after.status === 200 && after.d.exitCode === 0, 'and once they have, the next one runs', after.status);
}

section('A timeout that is not a positive number is not obeyed');
{
  const r = await call('exec', { command: NODE + ' -e "setTimeout(()=>console.log(\'ran\'),300)"', timeout: -5 });
  ok(r.status === 200 && r.d.timedOut === false && /ran/.test(r.d.stdout || ''),
     'a negative timeout does not kill the command the moment it starts', r.d);
  const z = await call('exec', { command: NODE + ' -e "console.log(\'ok\')"', timeout: 'soon' });
  ok(z.status === 200 && /ok/.test(z.d.stdout || ''), 'nor does one that is not a number', z.d);
}

section('The output ceiling is counted in bytes');
{
  /* A million euro signs: a million characters, three million bytes. */
  const r = await call('exec', { command: NODE + ' -e "process.stdout.write(\'€\'.repeat(1000000))"', timeout: 30000 });
  const bytes = Buffer.byteLength(r.d.stdout || '', 'utf8');
  ok(r.d.truncated === true && bytes <= 2 * 1024 * 1024,
     'three megabytes of text are cut at the two-megabyte ceiling, not let through as "a million characters"',
     { truncated: r.d.truncated, bytes });
}

section('A connector that stops answering cannot collect requests without end');
{
  const s = await call('mcp/start', { id: 'stuck', command: process.execPath, args: [AWKWARD] });
  ok(s.status === 200, 'a connector is running', s.status);
  const ctrl = new AbortController();
  const waiting = Array.from({ length: 16 }, () =>
    call('mcp/call', { id: 'stuck', method: 'tools/call', params: { name: 'hang', arguments: {} } }, { signal: ctrl.signal }).catch(() => null));
  await new Promise(r => setTimeout(r, 500));
  const t0 = Date.now();
  const extra = await call('mcp/call', { id: 'stuck', method: 'tools/call', params: { name: 'echo', arguments: { text: 'x' } } });
  const ms = Date.now() - t0;
  const st = await call('status', {});
  ok(extra.status === 502 && /requests waiting/.test(String(extra.d.message || '')) && ms < 5000,
     'the seventeenth is turned away at once, not added to the pile', { status: extra.status, message: extra.d.message, ms });
  const stuck = (st.d.mcp || []).find(m => m.id === 'stuck');
  ok(stuck && stuck.pending === 16, 'and the status says sixteen are waiting on it', stuck);
  ctrl.abort();
  await call('mcp/stop', { id: 'stuck' });
  await Promise.all(waiting);
}

stop();
report();
done();
