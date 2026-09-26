/* THE BRIDGE CANNOT BE RACED OUT OF ITS FOLDER.

   Every file route checked a PATH and then used the path again. A process
   running between the two - a command AMV started, flipping a link inside the
   folder between a directory inside it and one outside - made the check see
   one place and the use reach another. Measured before the fix: of 3,000
   reads through such a link, 344 returned the outside file; 163 of 3,000
   writes landed outside. And because the routes run in the bridge's own
   process, which the fence does not cover, a link flipped to ~/.ssh read the
   key no command could.

   Now the routes open first, prove what they opened, and act through the
   handle. Measured the same way, with a real bridge and a real flipper, for
   every route that touches a file: none of them ever reaches outside, and
   they still work whenever the link points in. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });

/* A folder with `dir` -> real/ inside, and `outside` next to it; the flipper
   swaps `dir` between the two as fast as it can, atomically each time. */
function stage(home, outside) {
  const proj = join(home, 'proj');
  mkdirSync(join(proj, 'real'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(proj, 'real', 'f.txt'), 'INSIDE');
  writeFileSync(join(outside, 'f.txt'), 'OUTSIDE-CONTENT');
  symlinkSync(join(proj, 'real'), join(proj, 'dir'));
  /* A second link for listings, whose two sides hold only DIRECTORIES: a
     listing of files sizes each one by name afterwards, and that second
     lookup failing hid a leaked listing behind an error. Directories are
     listed without it, so a listing that reached outside shows. */
  mkdirSync(join(proj, 'real2', 'inside-sub'), { recursive: true });
  mkdirSync(join(outside + '-list', 'OUTSIDE-NAME'), { recursive: true });
  symlinkSync(join(proj, 'real2'), join(proj, 'ldir'));
  const flip = spawn(process.execPath, ['-e', `
    const fs = require('fs'), p = require('path');
    const proj = ${JSON.stringify(proj)}, out = ${JSON.stringify(outside)};
    for (let i = 0; ; i++) {
      const t = p.join(proj, '.l' + (i % 2)), u = p.join(proj, '.m' + (i % 2));
      try { fs.unlinkSync(t); } catch (e) {}
      try { fs.unlinkSync(u); } catch (e) {}
      fs.symlinkSync(i % 2 ? out : p.join(proj, 'real'), t);
      fs.renameSync(t, p.join(proj, 'dir'));
      fs.symlinkSync(i % 2 ? out + '-list' : p.join(proj, 'real2'), u);
      fs.renameSync(u, p.join(proj, 'ldir'));
    }`], { stdio: 'ignore' });
  running.push(flip);
  return { proj, flip };
}

async function startBridge(home, folder) {
  const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), folder], {
    stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { HOME: home }) });
  running.push(child);
  let banner = '';
  child.stdout.on('data', b => { banner += b; }); child.stderr.on('data', b => { banner += b; });
  const until = Date.now() + 8000;
  while (Date.now() < until && !/Close this window/.test(banner)) await new Promise(r => setTimeout(r, 50));
  const port = (banner.match(/Port\s+(\d+)/) || [])[1], code = (banner.match(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/) || [])[1];
  const base = 'http://127.0.0.1:' + port;
  const tok = ((await (await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code }) })).json().catch(() => ({}))).token) || '';
  const call = async (route, body) => {
    const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-AMV-Bridge-Token': tok }, body: JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
  };
  return { child, call };
}

const N = 1500;
const home = mkdtempSync(join(tmpdir(), 'amv-race-'));
const outside = join(home, 'outside');
const { proj, flip } = stage(home, outside);
const b = await startBridge(home, proj);

section('Reads through a flipping link never return the outside file');
{
  let leaked = 0, fine = 0;
  for (let i = 0; i < N; i++) {
    const r = await b.call('read', { path: 'dir/f.txt' });
    if (r.text.includes('OUTSIDE-CONTENT')) leaked++;
    else if (r.status === 200 && r.text.includes('INSIDE')) fine++;
  }
  ok(leaked === 0, 'no read returns the outside file - 344 in 3,000 did', { leaked, of: N });
  ok(fine > 0, 'and reads still work when the link points in', fine);
}

section('Writes never land outside');
{
  let escaped = 0, fine = 0;
  for (let i = 0; i < N; i++) {
    const r = await b.call('write', { path: 'dir/w' + i + '.txt', content: 'X' });
    if (existsSync(join(outside, 'w' + i + '.txt'))) escaped++;
    else if (r.status === 200) fine++;
  }
  const strays = readdirSync(outside).filter(n => n.includes('.amv-'));
  ok(escaped === 0, 'no write creates a file outside - 163 in 3,000 did', { escaped, of: N });
  ok(strays.length === 0, 'nor leaves a temporary file there', strays);
  ok(fine > 0, 'and writes still work when the link points in', fine);
}

section('Deletes never remove an outside file');
{
  let removedOutside = 0, fine = 0;
  for (let i = 0; i < N / 2; i++) {
    writeFileSync(join(outside, 'del.txt'), 'keep me');
    writeFileSync(join(proj, 'real', 'del.txt'), 'remove me');
    const r = await b.call('delete', { path: 'dir/del.txt' });
    if (!existsSync(join(outside, 'del.txt'))) removedOutside++;
    else if (r.status === 200 && /"removed":true/.test(r.text)) fine++;
  }
  ok(removedOutside === 0, 'no delete removes the outside file', { removedOutside, of: N / 2 });
  ok(fine > 0, 'and deletes still work when the link points in', fine);
}

section('Listings never name what is outside');
{
  let leaked = 0, fine = 0;
  for (let i = 0; i < N / 2; i++) {
    const r = await b.call('list', { path: 'ldir' });
    if (r.text.includes('OUTSIDE-NAME')) leaked++;
    else if (r.status === 200 && r.text.includes('inside-sub')) fine++;
  }
  ok(leaked === 0, 'no listing shows the outside directory', { leaked, of: N / 2 });
  ok(fine > 0, 'and listings still work when the link points in', fine);
}
flip.kill('SIGKILL');
b.child.kill('SIGKILL');

section('A link flipped to the key store never reads the key');
{
  /* The case that mattered most: the routes are not inside the fence, so this
     is the one way a key was reachable at all. HOME is a fake home, and the
     outside directory IS its .ssh. */
  const home2 = mkdtempSync(join(tmpdir(), 'amv-race-home-'));
  const ssh = join(home2, '.ssh');
  const st = stage(home2, ssh);
  writeFileSync(join(ssh, 'f.txt'), 'SSH-PRIVATE-KEY-FAKE');
  const b2 = await startBridge(home2, st.proj);
  let leaked = 0, fine = 0;
  for (let i = 0; i < N; i++) {
    const r = await b2.call('read', { path: 'dir/f.txt' });
    if (r.text.includes('SSH-PRIVATE-KEY-FAKE')) leaked++;
    else if (r.status === 200) fine++;
  }
  ok(leaked === 0, 'the key never comes back', { leaked, of: N });
  ok(fine > 0, 'while the inside file still reads', fine);
  st.flip.kill('SIGKILL'); b2.child.kill('SIGKILL');
}

report();
done();
