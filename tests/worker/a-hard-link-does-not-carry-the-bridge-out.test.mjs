/* A HARD LINK DOES NOT CARRY THE BRIDGE OUT OF THE FOLDER.  (AMV-AUD-021)

   The bridge's confinement is all about NAMES: is the path inside, does a
   symlink along it point out. A hard link passes every one of those checks -
   its name is inside, it is not a symlink - and it is the very same bytes as a
   file somewhere else. Reading it read that file. Writing it rewrote that file.

   Now a read of a file with a second name is refused, and a write never writes
   INTO an existing file: it writes a new one beside it and renames it into
   place, so the outside name keeps its bytes. Also checked, because the write
   path changed under them: an executable stays executable, and a symlink that
   stays inside is still written through rather than replaced. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, symlinkSync, chmodSync, statSync, lstatSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';

const box = mkdtempSync(join(tmpdir(), 'amv-hardlink-'));
const proj = join(box, 'proj');
mkdirSync(proj, { recursive: true });
const outside = join(box, 'somebody-elses-file.txt');
writeFileSync(outside, 'THE ORIGINAL, OUTSIDE THE FOLDER');
linkSync(outside, join(proj, 'looks-local.txt'));
writeFileSync(join(proj, 'ordinary.txt'), 'plain');
writeFileSync(join(proj, 'run.sh'), '#!/bin/sh\necho hi\n'); chmodSync(join(proj, 'run.sh'), 0o755);
writeFileSync(join(proj, 'real-target.txt'), 'before');
symlinkSync('real-target.txt', join(proj, 'alias.txt'));

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

section('Reading a hard-linked file is refused');
{
  const r = await call('read', { path: 'looks-local.txt' });
  ok(r.status === 403 && r.d.error === 'hard_linked', 'the read is refused - this was the finding', r);
  ok(!/THE ORIGINAL/.test(JSON.stringify(r.d)), 'and none of the outside file’s contents come back', r.d);
  const plain = await call('read', { path: 'ordinary.txt' });
  ok(plain.status === 200 && plain.d.content === 'plain', 'an ordinary file still reads', plain.d);
}

section('Writing a hard-linked file leaves the other name alone');
{
  const r = await call('write', { path: 'looks-local.txt', content: 'written by AMV' });
  ok(r.status === 200, 'the write is accepted', r.status);
  ok(readFileSync(outside, 'utf8') === 'THE ORIGINAL, OUTSIDE THE FOLDER',
     'the file outside the folder is unchanged - this was the finding', readFileSync(outside, 'utf8'));
  ok(readFileSync(join(proj, 'looks-local.txt'), 'utf8') === 'written by AMV', 'the name inside has the new contents', true);
  ok(statSync(join(proj, 'looks-local.txt')).nlink === 1, 'and is now a file of its own', statSync(join(proj, 'looks-local.txt')).nlink);
}

section('The new way of writing keeps what the old one kept');
{
  const x = await call('write', { path: 'run.sh', content: '#!/bin/sh\necho changed\n' });
  ok(x.status === 200 && (statSync(join(proj, 'run.sh')).mode & 0o777) === 0o755,
     'an executable script stays executable', (statSync(join(proj, 'run.sh')).mode & 0o777).toString(8));
  const a = await call('write', { path: 'alias.txt', content: 'after' });
  ok(a.status === 200 && lstatSync(join(proj, 'alias.txt')).isSymbolicLink()
     && readFileSync(join(proj, 'real-target.txt'), 'utf8') === 'after',
     'a symlink inside the folder is written through, and stays a symlink', lstatSync(join(proj, 'alias.txt')).isSymbolicLink());
  const n = await call('write', { path: 'sub/new-file.txt', content: 'fresh' });
  ok(n.status === 200 && readFileSync(join(proj, 'sub', 'new-file.txt'), 'utf8') === 'fresh', 'a new file in a new folder is created', n.status);
  ok(!readdirSync(proj).some(f => /\.amv-[0-9a-f]+$/.test(f)), 'and no temporary file is left behind', readdirSync(proj));
}

stop();
report();
done();
