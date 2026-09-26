/* ON A MAC, THE WHOLE BRIDGE RUNS INSIDE THE SYSTEM SANDBOX.

   macOS has no bubblewrap; it has sandbox-exec. The bridge re-starts itself
   under it with a profile denying the credential stores, so its file routes,
   its commands and its connectors are all inside, and the bridge inside
   claims the fence only after proving a canary is unreadable from where it
   stands. A sandbox that will not start leaves the bridge running unfenced
   and saying so; one that starts and hides nothing is reported as failed.

   Driven on Linux, with AMV_BRIDGE_PLATFORM=darwin and a stand-in
   sandbox-exec (tests/fixtures/fake-sandbox-exec.mjs) that enforces the
   profile it is handed. What that cannot show - Seatbelt itself accepting the
   profile - is exactly what the canary checks on every real Mac, every start. */
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });

const hasBwrap = spawnSync('sh', ['-c', 'command -v bwrap'], { stdio: 'ignore' }).status === 0;
section('This machine can stand in for a Mac');
ok(process.platform === 'linux' && hasBwrap, 'Linux with bubblewrap, which the stand-in enforces the profile with (apt-get install bubblewrap)', process.platform);

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'amv-machome-'));
  const put = (rel, text) => { mkdirSync(dirname(join(home, rel)), { recursive: true }); writeFileSync(join(home, rel), text); };
  put('.ssh/id_ed25519', 'SSH-PRIVATE-KEY-FAKE');
  put('.npmrc', '//registry.npmjs.org/:_authToken=NPM-FAKE-TOKEN');
  put('Library/Keychains/login.keychain-db', 'KEYCHAIN-FAKE');
  put('notes.txt', 'ORDINARY-HOME-FILE');
  mkdirSync(join(home, 'proj'), { recursive: true });
  return home;
}
const shimDir = mkdtempSync(join(tmpdir(), 'amv-sbx-shim-'));
writeFileSync(join(shimDir, 'sandbox-exec'),
  '#!/bin/sh\nexec "' + process.execPath + '" "' + join(ROOT, 'tests', 'fixtures', 'fake-sandbox-exec.mjs') + '" "$@"\n', { mode: 0o755 });

async function startMacBridge(home, extraEnv, extraArgs) {
  const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), join(home, 'proj')].concat(extraArgs || []), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { HOME: home, AMV_BRIDGE_PLATFORM: 'darwin', PATH: shimDir + ':' + process.env.PATH }, extraEnv || {}) });
  running.push(child);
  let banner = '';
  child.stdout.on('data', b => { banner += b; }); child.stderr.on('data', b => { banner += b; });
  const until = Date.now() + 20000;
  while (Date.now() < until && !/Close this window/.test(banner)) await new Promise(r => setTimeout(r, 60));
  const port = (banner.match(/Port\s+(\d+)/) || [])[1], code = (banner.match(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/) || [])[1];
  const base = 'http://127.0.0.1:' + port;
  const paired = await (await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code }) })).json().catch(() => ({}));
  const call = async (route, body) => {
    const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-AMV-Bridge-Token': paired.token || '' }, body: JSON.stringify(body || {}) });
    let d = {}; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };
  const hello = await (await fetch(base + '/amv-bridge/hello', { headers: { Origin: ORIGIN } })).json().catch(() => ({}));
  return { child, banner: () => banner, paired, call, hello };
}
const FAKES = /SSH-PRIVATE-KEY-FAKE|NPM-FAKE-TOKEN|KEYCHAIN-FAKE/;
const READ_ALL = 'cat ~/.ssh/id_ed25519 ~/.npmrc ~/Library/Keychains/login.keychain-db 2>&1; true';

if (process.platform === 'linux' && hasBwrap) {
  const home = fakeHome();
  const log = join(home, 'profile.sb');
  const b = await startMacBridge(home, { FAKE_SBX_LOG: log });

  section('The bridge starts inside the sandbox and proves it');
  ok(b.hello.fence === 'on' && b.paired.fence === 'on', 'the fence is on, at hello and at pairing', { hello: b.hello.fence, pair: b.paired.fence });
  ok(/hidden from commands and connectors/.test(b.banner()), 'and the terminal says so', b.banner());

  section('Commands, connectors and the bridge itself are all inside');
  {
    const r = await b.call('exec', { command: READ_ALL, timeout: 15000 });
    ok(r.status === 200 && !FAKES.test(r.d.stdout + r.d.stderr), 'a command cannot read the keys, the token or the keychain', r.d);
    const n = await b.call('exec', { command: 'cat ~/notes.txt; echo made > built.txt && cat built.txt', timeout: 15000 });
    ok(/ORDINARY-HOME-FILE/.test(n.d.stdout) && /made/.test(n.d.stdout), 'while home and the project work as before', n.d);
    const s = await b.call('mcp/start', { id: 'echo', command: process.execPath, args: [join(ROOT, 'tests', 'fixtures', 'mcp-echo-server.mjs')] });
    const key = await b.call('mcp/call', { id: 'echo', method: 'tools/call', params: { name: 'count_lines', arguments: { path: join(home, '.ssh', 'id_ed25519') } } });
    ok(s.status === 200 && key.d.result && key.d.result.isError === true, 'a connector cannot open the key', key.d);
    await b.call('mcp/stop', { id: 'echo' });
    /* The bridge's own process: its parent is the stand-in, not the terminal. */
    const pp = await b.call('exec', { command: 'cat /proc/$PPID/cmdline | tr "\\0" " "', timeout: 15000 });
    ok(/--amv-inside-fence=/.test(pp.d.stdout), 'and the process running them is the one inside the sandbox', pp.d.stdout);
  }

  section('The profile names the stores by path, including ones not there yet');
  {
    const profile = existsSync(log) ? readFileSync(log, 'utf8') : '';
    ok(profile.includes('(subpath "' + join(home, '.ssh') + '")'), 'the key directory', profile.slice(0, 200));
    ok(profile.includes('(subpath "' + join(home, '.aws') + '")'), 'a cloud login directory that does not exist yet - Seatbelt covers it when it appears', true);
    ok(profile.includes('(literal "' + join(home, '.npmrc') + '")'), 'a token file', true);
    ok(!profile.includes('(subpath "' + join(home, 'proj')), 'and not the project', true);
  }

  section('Stopping the bridge stops the one inside');
  {
    const pp = await b.call('exec', { command: 'echo $PPID', timeout: 15000 });
    const inner = Number(pp.d.stdout.trim());
    b.child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1500));
    let state = 'gone';
    try { state = readFileSync('/proc/' + inner + '/stat', 'utf8').replace(/^.*\)\s+/, '').split(' ')[0]; } catch (e) {}
    ok(inner > 0 && (state === 'gone' || state === 'Z'), 'no bridge is left running inside', { inner, state });
  }

  section('A sandbox that starts and hides nothing is reported as failed');
  {
    const x = await startMacBridge(home, { FAKE_SBX_MODE: 'ignore' });
    ok(x.hello.fence === 'failed' && /can read every file you can/.test(x.banner()), 'failed, and the terminal warns', { fence: x.hello.fence });
    x.child.kill('SIGKILL');
  }

  section('A sandbox that will not start: the bridge runs, unfenced, and says so');
  {
    const x = await startMacBridge(home, { FAKE_SBX_MODE: 'refuse' });
    const r = await x.call('exec', { command: 'echo still-works', timeout: 15000 });
    ok(x.hello.fence === 'failed' && /would not start on this computer/.test(x.banner()), 'failed, said in the terminal', { fence: x.hello.fence });
    ok(/still-works/.test(r.d.stdout || ''), 'and the bridge still works', r.d);
    x.child.kill('SIGKILL');
  }

  section('--no-fence on a Mac: no sandbox, and said so');
  {
    const log2 = join(home, 'profile2.sb');
    const x = await startMacBridge(home, { FAKE_SBX_LOG: log2 }, ['--no-fence']);
    ok(x.hello.fence === 'off' && !existsSync(log2), 'off, and the sandbox was never asked for', { fence: x.hello.fence });
    x.child.kill('SIGKILL');
  }
}

report();
done();
