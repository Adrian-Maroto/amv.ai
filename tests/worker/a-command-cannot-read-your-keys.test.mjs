/* A COMMAND CANNOT READ YOUR KEYS.  (AMV-AUD-001, the file half of AMV-AUD-005)

   A command AMV runs is chosen by a model, and it runs as the person - so it
   could read the files credentials live in. `cat ~/.ssh/id_ed25519` in one
   command's output is a key gone.

   On Linux with bubblewrap, commands now run with the credential stores under
   home covered: directories empty, files empty. Everything else - the project,
   toolchains under home, the rest of the machine - is as it was. The fence is
   started once at startup and used only if that worked; otherwise the bridge
   says, in its terminal and to the page, that commands can read everything.
   The bridge's own file routes refuse the same places on every system.

   Real bridges, started with HOME pointed at a fake home seeded with fake keys.
   Needs bubblewrap where it runs: without it the fence cannot be measured, and
   this suite says so rather than passing on the fallback alone. */
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const NODE = '"' + process.execPath + '"';

const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });

/* A home with the things a developer's home has. */
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'amv-home-'));
  const put = (rel, text) => { mkdirSync(dirname(join(home, rel)), { recursive: true }); writeFileSync(join(home, rel), text); };
  put('.ssh/id_ed25519', 'SSH-PRIVATE-KEY-FAKE');
  put('.aws/credentials', '[default]\naws_secret_access_key=AWS-FAKE-SECRET');
  put('.npmrc', '//registry.npmjs.org/:_authToken=NPM-FAKE-TOKEN');
  put('.git-credentials', 'https://user:GIT-FAKE-TOKEN@github.com');
  put('.bash_history', 'export STRIPE_KEY=HISTORY-FAKE-KEY');
  put('.config/gcloud/credentials.db', 'GCLOUD-FAKE');
  put('.nvm/versions/node/v20/bin/tool', 'TOOLCHAIN-STILL-HERE');   // must stay visible
  put('notes.txt', 'ORDINARY-HOME-FILE');                          // must stay visible
  mkdirSync(join(home, 'proj'), { recursive: true });
  return home;
}

async function startBridge(home, folder, extraArgs) {
  const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), folder].concat(extraArgs || []), {
    stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { HOME: home }),
  });
  running.push(child);
  let banner = '';
  child.stdout.on('data', b => { banner += b.toString(); });
  child.stderr.on('data', b => { banner += b.toString(); });
  const waitFor = async (re, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { const m = banner.match(re); if (m) return m; await new Promise(r => setTimeout(r, 60)); }
    return null;
  };
  const port = (await waitFor(/Port\s+(\d+)/, 8000) || [])[1] || '0';
  const code = (await waitFor(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000) || [])[1] || '';
  await waitFor(/Close this window/, 4000);
  const base = 'http://127.0.0.1:' + port;
  const pr = await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code }) });
  const paired = await pr.json().catch(() => ({}));
  const call = async (route, body) => {
    const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-AMV-Bridge-Token': paired.token || '' },
      body: JSON.stringify(body || {}) });
    let d = {}; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };
  const hello = await (await fetch(base + '/amv-bridge/hello', { headers: { Origin: ORIGIN } })).json().catch(() => ({}));
  return { child, banner: () => banner, paired, call, hello };
}
const sh = (b, command) => b.call('exec', { command, timeout: 15000 });
const FAKES = /SSH-PRIVATE-KEY-FAKE|AWS-FAKE-SECRET|NPM-FAKE-TOKEN|GIT-FAKE-TOKEN|HISTORY-FAKE-KEY|GCLOUD-FAKE/;
const READ_ALL = 'cat ~/.ssh/id_ed25519 ~/.aws/credentials ~/.npmrc ~/.git-credentials ~/.bash_history ~/.config/gcloud/credentials.db 2>&1; true';

section('This machine can measure the fence');
const hasBwrap = process.platform === 'linux' && spawnSync('sh', ['-c', 'command -v bwrap'], { stdio: 'ignore' }).status === 0;
ok(hasBwrap, 'bubblewrap is installed where this suite runs (apt-get install bubblewrap) - without it the fence cannot be measured', process.platform);

if (hasBwrap) {
  const home = fakeHome();
  const b = await startBridge(home, join(home, 'proj'));

  section('A command cannot read the credential stores');
  {
    const r = await sh(b, READ_ALL);
    ok(r.status === 200 && !FAKES.test(r.d.stdout + r.d.stderr), 'none of the fake keys come back - this was the finding', r.d);
    ok(r.d.fenced === true, 'and the command says it ran fenced', r.d.fenced);
    const ls = await sh(b, 'ls -A ~/.ssh | wc -l');
    ok(ls.d.stdout.trim() === '0', 'the key directory is there, and empty', ls.d);
    const viaNode = await sh(b, NODE + ' -e "try{process.stdout.write(require(\'fs\').readFileSync(require(\'os\').homedir()+\'/.aws/credentials\',\'utf8\'))}catch(e){process.stdout.write(\'refused\')}"');
    ok(!FAKES.test(viaNode.d.stdout), 'not through another program either', viaNode.d);
  }

  section('Everything else is as it was');
  {
    const r = await sh(b, 'cat ~/notes.txt ~/.nvm/versions/node/v20/bin/tool; echo made > built.txt && cat built.txt');
    ok(/ORDINARY-HOME-FILE/.test(r.d.stdout) && /TOOLCHAIN-STILL-HERE/.test(r.d.stdout), 'home and the toolchains in it are readable', r.d);
    ok(/made/.test(r.d.stdout) && existsSync(join(home, 'proj', 'built.txt')), 'and the command writes in the project, for real', r.d);
    const n = await sh(b, NODE + ' -e "process.stdout.write(String(6*7))"');
    ok(n.d.stdout === '42' && n.d.exitCode === 0, 'programs run normally', n.d);
  }

  section('A command that needed a key is told why it failed');
  {
    const r = await sh(b, 'cat ~/.ssh/id_ed25519 >/dev/null; echo "Permission denied (publickey)." >&2; exit 1');
    ok(/credential files are hidden/.test(r.d.stderr) && /--no-fence/.test(r.d.stderr), 'the error names the fence and how to lift it', r.d.stderr);
    const plain = await sh(b, 'echo "no such file" >&2; exit 1');
    ok(!/credential files are hidden/.test(plain.d.stderr), 'and an ordinary failure is left as it was', plain.d.stderr);
  }

  section('A command stopped at its limit is stopped, fence and all');
  {
    const pidFile = join(home, 'proj', 'pid');
    const r = await b.call('exec', { command: 'echo $$ > pid; exec sleep 30', timeout: 1500 });
    await new Promise(res => setTimeout(res, 300));
    /* Read from the process table rather than asked with kill(pid, 0): inside
       the fence the command is a grandchild, and once killed it waits as a
       zombie (state Z) for pid 1 to collect it - which a container's pid 1
       may never do. A zombie has stopped running; kill(0) would call it alive. */
    let alive = false, state = 'gone';
    try {
      const pid = Number(require_('fs').readFileSync(pidFile, 'utf8'));
      state = require_('fs').readFileSync('/proc/' + pid + '/stat', 'utf8').replace(/^.*\)\s+/, '').split(' ')[0];
      alive = state !== 'Z' && state !== 'X';
    } catch (e) {}
    ok(r.d.timedOut === true && !alive, 'the process inside the fence is gone', { d: r.d, state });
  }

  section('The bridge says the fence is on');
  ok(b.hello.fence === 'on' && b.paired.fence === 'on', 'to the page, at hello and at pairing', { hello: b.hello.fence, pair: b.paired.fence });
  ok(/hidden from commands/.test(b.banner()), 'and in its terminal', b.banner());

  section('The file routes refuse the stores too, when the folder is home');
  {
    const h = await startBridge(home, home);
    const r = await h.call('read', { path: '.ssh/id_ed25519' });
    ok(r.status === 403 && r.d.error === 'secret_path' && !FAKES.test(JSON.stringify(r.d)), 'a key is not read through the file route', r);
    const w = await h.call('write', { path: '.aws/credentials', content: 'overwritten' });
    ok(w.status === 403 && w.d.error === 'secret_path', 'nor written', w);
    symlinkSync(join(home, '.ssh'), join(home, 'proj', 'keys'));
    const l = await h.call('read', { path: 'proj/keys/id_ed25519' });
    ok(l.status === 403 && !FAKES.test(JSON.stringify(l.d)), 'nor reached through a link to it', l);
    const n = await h.call('read', { path: 'notes.txt' });
    ok(n.status === 200 && /ORDINARY-HOME-FILE/.test(JSON.stringify(n.d)), 'while an ordinary file there still reads', n.status);
    h.child.kill('SIGKILL');
  }

  section('--no-fence lifts it, and says so');
  {
    const o = await startBridge(home, join(home, 'proj'), ['--no-fence']);
    const r = await sh(o, READ_ALL);
    ok(/SSH-PRIVATE-KEY-FAKE/.test(r.d.stdout) && r.d.fenced === false, 'the key is readable, as asked', r.d);
    ok(o.hello.fence === 'off' && /--no-fence is ON/.test(o.banner()), 'and the page and the terminal both say so', { fence: o.hello.fence });
    o.child.kill('SIGKILL');
  }

  section('No bubblewrap: unfenced, and said plainly');
  {
    const bare = mkdtempSync(join(tmpdir(), 'amv-nobwrap-'));
    /* A PATH with node and sh but no bwrap. */
    for (const p of ['sh', 'cat', 'ls', 'wc', 'sleep']) {
      const at = spawnSync('sh', ['-c', 'command -v ' + p], { encoding: 'utf8' }).stdout.trim();
      if (at) symlinkSync(at, join(bare, p));
    }
    const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), join(home, 'proj')], {
      stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { HOME: home, PATH: bare }) });
    running.push(child);
    let out = ''; child.stdout.on('data', x => { out += x; }); child.stderr.on('data', x => { out += x; });
    const until = Date.now() + 8000;
    while (Date.now() < until && !/Close this window/.test(out)) await new Promise(r => setTimeout(r, 60));
    ok(/Commands and connectors can read every file you can/.test(out) && /Install bubblewrap/.test(out), 'the terminal says commands can read everything, and how to fix it', out);
    child.kill('SIGKILL');
  }

  section('A fence that starts but hides nothing is not claimed');
  {
    /* The canary rule: a stand-in bwrap that runs the command and ignores
       every instruction to hide anything. It starts fine, and a check that
       only asked "did it start" called this fenced. */
    const shim = mkdtempSync(join(tmpdir(), 'amv-leakybwrap-'));
    writeFileSync(join(shim, 'bwrap'), '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 });
    const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), join(home, 'proj')], {
      stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { HOME: home, PATH: shim + ':' + process.env.PATH }) });
    running.push(child);
    let out = ''; child.stdout.on('data', x => { out += x; }); child.stderr.on('data', x => { out += x; });
    const until = Date.now() + 8000;
    while (Date.now() < until && !/Close this window/.test(out)) await new Promise(r => setTimeout(r, 60));
    const port = (out.match(/Port\s+(\d+)/) || [])[1];
    const hello = await (await fetch('http://127.0.0.1:' + port + '/amv-bridge/hello', { headers: { Origin: ORIGIN } })).json().catch(() => ({}));
    ok(hello.fence === 'failed', 'reported as failed, not on', hello.fence);
    child.kill('SIGKILL');
  }

  section('A connector cannot read the keys either');
  {
    const r = await b.call('mcp/start', { id: 'echo', command: process.execPath,
      args: [join(ROOT, 'tests', 'fixtures', 'mcp-echo-server.mjs')] });
    ok(r.status === 200, 'a connector starts inside the fence', r.status);
    const key = await b.call('mcp/call', { id: 'echo', method: 'tools/call',
      params: { name: 'count_lines', arguments: { path: join(home, '.ssh', 'id_ed25519') } } });
    const note = await b.call('mcp/call', { id: 'echo', method: 'tools/call',
      params: { name: 'count_lines', arguments: { path: join(home, 'notes.txt') } } });
    ok(key.d.result && key.d.result.isError === true, 'it cannot open the key - this was the gap', key.d);
    ok(note.d.result && !note.d.result.isError && note.d.result.content[0].text === '1', 'while an ordinary file in home still reads', note.d);
    await b.call('mcp/stop', { id: 'echo' });
  }

  section('bubblewrap that will not start: unfenced, and said plainly');
  {
    /* What a system that refuses user namespaces looks like: the program is
       there and fails. The bridge must find that out at startup, not assume
       from finding the file that commands are fenced. */
    const shim = mkdtempSync(join(tmpdir(), 'amv-badbwrap-'));
    writeFileSync(join(shim, 'bwrap'), '#!/bin/sh\necho "bwrap: setting up uid map: Permission denied" >&2\nexit 1\n', { mode: 0o755 });
    const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), join(home, 'proj')], {
      stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { HOME: home, PATH: shim + ':' + process.env.PATH }) });
    running.push(child);
    let out = ''; child.stdout.on('data', x => { out += x; }); child.stderr.on('data', x => { out += x; });
    const until = Date.now() + 8000;
    while (Date.now() < until && !/Close this window/.test(out)) await new Promise(r => setTimeout(r, 60));
    const port = (out.match(/Port\s+(\d+)/) || [])[1];
    const hello = await (await fetch('http://127.0.0.1:' + port + '/amv-bridge/hello', { headers: { Origin: ORIGIN } })).json().catch(() => ({}));
    ok(hello.fence === 'failed' && /would not start on this computer/.test(out), 'it reports the fence as failed, to the page and in the terminal', { fence: hello.fence });
    child.kill('SIGKILL');
  }

  b.child.kill('SIGKILL');
}

import { createRequire } from 'module';
function require_(m) { return createRequire(import.meta.url)(m); }

report();
done();
