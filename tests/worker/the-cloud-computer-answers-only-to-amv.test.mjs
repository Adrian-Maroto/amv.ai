/* THE CLOUD COMPUTER ANSWERS ONLY TO AMV.

   The cloud computer is the same bridge, started with --cloud inside a
   container AMV runs for one person. No browser reaches it and there is no
   terminal to read a pairing code from, so a key the Worker starts it with
   replaces pairing. Real bridges, started in cloud mode:

   - it refuses to start at all without a key of real length;
   - every request without the key, or with the wrong one, is refused;
   - with the key, commands run and files are read and written - the same
     routes the app already drives on a person's own computer;
   - there is no pairing route to guess at, no browser-origin headers, and no
     screen;
   - disconnecting stops what is running and keeps the key, so AMV's next
     request still works - the container is the person's, not a new pairing. */
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'net';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRIDGE = join(ROOT, 'bridge', 'amv-bridge.mjs');
const KEY = 'k'.repeat(16) + 'cloud-key-for-this-suite-0123456789';
const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

section('It will not start without a key of real length');
{
  const box = mkdtempSync(join(tmpdir(), 'amv-cloud-'));
  const none = spawnSync(process.execPath, [BRIDGE, box, '--cloud'], { env: Object.assign({}, process.env, { AMV_CLOUD_KEY: '' }), timeout: 10000 });
  ok(none.status !== 0 && /needs AMV_CLOUD_KEY/.test(String(none.stderr)), 'no key: it refuses and says why', String(none.stderr).slice(0, 120));
  const short = spawnSync(process.execPath, [BRIDGE, box, '--cloud'], { env: Object.assign({}, process.env, { AMV_CLOUD_KEY: 'short' }), timeout: 10000 });
  ok(short.status !== 0, 'a short key: it refuses too');
}

const box = mkdtempSync(join(tmpdir(), 'amv-cloud-'));
const proj = join(box, 'work'); mkdirSync(proj, { recursive: true });
const port = await freePort();
const child = spawn(process.execPath, [BRIDGE, proj, '--cloud', '--computer'], {
  stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { AMV_CLOUD_KEY: KEY, PORT: String(port) }) });
running.push(child);
let out = '';
child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { out += b; });
for (let i = 0; i < 80 && !/ready on port/.test(out); i++) await new Promise(r => setTimeout(r, 100));
const base = 'http://127.0.0.1:' + port;
const call = async (route, body, key) => {
  const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' },
    key === null ? {} : { 'X-AMV-Bridge-Token': key === undefined ? KEY : key }), body: JSON.stringify(body || {}) });
  let d = {}; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d, cors: r.headers.get('access-control-allow-origin') };
};

section('Started with a key: ready, and it says it is the cloud computer');
{
  ok(/AMV cloud computer .* ready on port \d+/.test(out), 'it is listening', out.slice(0, 160));
  ok(!/[0-9A-F]{4}(?:-[0-9A-F]{4}){5}/.test(out), 'and prints no pairing code - there is nobody to read one');
  const h = await (await fetch(base + '/amv-bridge/hello')).json();
  ok(h.cloud === true && h.computer && h.computer.on === false, 'hello says cloud, and no screen even though --computer was given', h);
}

section('Without the key, nothing');
{
  const a = await call('exec', { command: 'echo hi' }, null);
  ok(a.status === 401, 'no key: refused', a.status);
  const b = await call('exec', { command: 'echo hi' }, KEY.replace(/.$/, 'X'));
  ok(b.status === 401, 'the wrong key: refused', b.status);
  const c = await call('pair', { code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF' }, null);
  ok(c.status === 404, 'and there is no pairing route to guess at', c.status);
}

section('With the key, the same routes the app already drives');
{
  const w = await call('write', { path: 'notes/hello.txt', content: 'from the cloud' });
  ok(w.status === 200, 'a file is written', w);
  const r = await call('read', { path: 'notes/hello.txt' });
  ok(r.status === 200 && r.d.content === 'from the cloud', 'and read back', r.d);
  const e = await call('exec', { command: 'cat notes/hello.txt && echo done' });
  ok(e.status === 200 && /from the cloud/.test(e.d.stdout) && e.d.exitCode === 0, 'a command runs in the folder', e.d);
  ok(!e.cors, 'with no browser-origin headers on the reply');
  const refused = await call('exec', { command: 'rm -rf /' });
  ok(refused.status === 403 && refused.d.error === 'refused', 'and the bridge’s own refusals still apply', refused.d);
}

section('Disconnecting stops what runs, and keeps the key');
{
  const slow = call('exec', { command: 'sleep 20; echo late', job: 'job-slow-1' });
  await new Promise(r => setTimeout(r, 400));
  const v = await call('revoke', {});
  ok(v.status === 200 && v.d.stopped.jobs === 1, 'the running command was stopped', v.d);
  const s = await slow;
  ok(!/late/.test((s.d && s.d.stdout) || ''), 'it never finished');
  const again = await call('exec', { command: 'echo still-here' });
  ok(again.status === 200 && /still-here/.test(again.d.stdout), 'and AMV’s next request still works', again.d);
}

child.kill('SIGKILL');
if (report('the-cloud-computer-answers-only-to-amv') > 0) process.exitCode = 1;
done();
