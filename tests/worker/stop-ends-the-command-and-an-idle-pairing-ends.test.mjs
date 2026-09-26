/* STOP ENDS THE COMMAND, AND A PAIRING NOBODY USES ENDS TOO.

   Two things the bridge could not do. A running command could only be ended
   by its timeout, by revoking the whole pairing, or by closing the bridge -
   so Stop in AMV left an `npm install` running until it finished. And a
   pairing lived as long as the bridge did, so a tab closed yesterday left a
   token that could still run commands.

   Now each command carries the page's id and `exec/cancel` ends that one, by
   process group. And a pairing unused for the idle limit ends at the next
   request that uses it - never while a command is running. Driven against a
   real bridge with a short limit (AMV_BRIDGE_IDLE_MS). */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function startBridge(env) {
  const box = mkdtempSync(join(tmpdir(), 'amv-stop-'));
  const proj = join(box, 'proj'); mkdirSync(proj, { recursive: true });
  const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj], {
    stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env || {}) });
  running.push(child);
  let banner = '';
  child.stdout.on('data', b => { banner += b; }); child.stderr.on('data', b => { banner += b; });
  const until = Date.now() + 10000;
  while (Date.now() < until && !/Close this window/.test(banner)) await sleep(50);
  const port = (banner.match(/Port\s+(\d+)/) || [])[1], code = (banner.match(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/) || [])[1];
  const base = 'http://127.0.0.1:' + port;
  const tok = ((await (await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code }) })).json().catch(() => ({}))).token) || '';
  const call = async (route, body, token) => {
    const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-AMV-Bridge-Token': token === undefined ? tok : token },
      body: JSON.stringify(body || {}) });
    let d = {}; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };
  return { child, proj, call, banner: () => banner };
}
const procState = (pid) => { try { return readFileSync('/proc/' + pid + '/stat', 'utf8').replace(/^.*\)\s+/, '').split(' ')[0]; } catch (e) { return 'gone'; } };
const dead = (pid) => { const s = procState(pid); return s === 'gone' || s === 'Z'; };

section('Stop ends the command it names, and says so');
{
  const b = await startBridge();
  const t0 = Date.now();
  const run = b.call('exec', { command: 'echo $$ > pid; exec sleep 30', timeout: 60000, job: 'job-long-1' });
  await sleep(700);
  const c = await b.call('exec/cancel', { job: 'job-long-1' });
  const r = await run;
  const ms = Date.now() - t0;
  const pid = Number(readFileSync(join(b.proj, 'pid'), 'utf8'));
  await sleep(300);
  ok(c.status === 200 && c.d.cancelled === true, 'the cancel is accepted for the command that is running', c.d);
  ok(r.d.cancelled === true && r.d.timedOut === false, 'the command answers that it was stopped - not timed out, not finished', r.d);
  ok(ms < 5000, 'at once, not at its thirty seconds', ms);
  ok(dead(pid), 'and the process is gone', { pid, state: procState(pid) });

  section('Only that one');
  const a = b.call('exec', { command: 'sleep 1; echo first-finished', timeout: 20000, job: 'job-keep-1' });
  const z = b.call('exec', { command: 'exec sleep 30', timeout: 60000, job: 'job-stop-2' });
  await sleep(300);
  await b.call('exec/cancel', { job: 'job-stop-2' });
  const [ra, rz] = await Promise.all([a, z]);
  ok(rz.d.cancelled === true, 'the named command is stopped', rz.d);
  ok(ra.d.cancelled === false && /first-finished/.test(ra.d.stdout) && ra.d.exitCode === 0, 'and the other runs to the end', ra.d);

  section('Nothing to stop, and nobody to ask');
  const n = await b.call('exec/cancel', { job: 'never-ran-1' });
  ok(n.status === 200 && n.d.cancelled === false, 'an id nothing runs under is answered as nothing stopped', n.d);
  const u = await b.call('exec/cancel', { job: 'job-keep-1' }, '');
  ok(u.status === 401, 'and a caller that is not paired is refused', u.status);
  b.child.kill('SIGKILL');
}

section('A pairing unused past the limit ends at the next request');
{
  const b = await startBridge({ AMV_BRIDGE_IDLE_MS: '1500' });
  const first = await b.call('status', {});
  ok(first.status === 200, 'it works while it is being used', first.status);
  await sleep(2000);
  const late = await b.call('status', {});
  ok(late.status === 401 && late.d.error === 'expired', 'after the limit, the next request is told it expired', late);
  const again = await b.call('status', {});
  ok(again.status === 401 && again.d.error === 'not_paired', 'and the token is gone for good', again);
  ok(/unused for/.test(b.banner()), 'the terminal says why', true);
  b.child.kill('SIGKILL');
}

section('Use keeps it alive');
{
  const b = await startBridge({ AMV_BRIDGE_IDLE_MS: '1500' });
  let all = true;
  for (let i = 0; i < 5; i++) { await sleep(700); if ((await b.call('status', {})).status !== 200) all = false; }
  ok(all, 'a request every 0.7s for 3.5s never expires a 1.5s limit', all);
  b.child.kill('SIGKILL');
}

section('Never while a command is running');
{
  const b = await startBridge({ AMV_BRIDGE_IDLE_MS: '1500' });
  const run = b.call('exec', { command: 'sleep 3; echo done-late', timeout: 20000, job: 'job-long-3' });
  await sleep(2200);
  const mid = await b.call('status', {});
  ok(mid.status === 200, 'past the limit, but a command is running, so the pairing stands', mid.status);
  const r = await run;
  ok(/done-late/.test(r.d.stdout || ''), 'and the command finishes', r.d);
  /* Measured with NOTHING asked during the run - a request made mid-run
     restarts the clock on its own, which is how the first version of this
     check passed with the restart at the finish removed. */
  const quiet = await b.call('exec', { command: 'sleep 2.5', timeout: 20000, job: 'job-long-4' });
  const after = await b.call('status', {});
  ok(quiet.status === 200 && after.status === 200, 'and the clock restarts when a command finishes, not when it started', { quiet: quiet.status, after: after.status });
  b.child.kill('SIGKILL');
}

report();
done();
