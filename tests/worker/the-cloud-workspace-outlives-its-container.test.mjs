/* THE CLOUD WORKSPACE OUTLIVES ITS CONTAINER.

   Oct 31 production audit, "make Cloud Workspace persistent across container
   death": a cloud container stops after a few idle minutes and its disk goes
   with it. With the WORKSPACES bucket bound to AMV's computer Worker
   (cloud/computer.mjs), the workspace is saved before the container stops and
   put back before the next one answers anything. Driven here with REAL
   bridges in cloud mode and real tar, and the computer Worker loaded with a
   stand-in for the container library whose port is the real bridge:
     - only AMV's key can take a snapshot or restore one;
     - a machine stopped for being idle saves the workspace, and the next one
       starts with it - the person's files, not installed packages;
     - with no bucket nothing changes and nothing breaks;
     - a snapshot that fails never replaces the last good copy;
     - an archive whose names climb out of the workspace writes nothing
       outside it;
     - erasing the account deletes the saved workspace and stops the machine,
       and only AMV's key can ask for that. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'net';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const BRIDGE = join(ROOT, 'bridge', 'amv-bridge.mjs');
const KEY = 'w'.repeat(16) + 'workspace-key-for-this-suite-0123';
const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function bridge(dir) {
  const port = await freePort();
  const child = spawn(process.execPath, [BRIDGE, dir, '--cloud'], {
    stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { AMV_CLOUD_KEY: KEY, PORT: String(port) }) });
  running.push(child);
  let out = '';
  child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { out += b; });
  for (let i = 0; i < 80 && !/ready on port/.test(out); i++) await new Promise(r => setTimeout(r, 100));
  return { base: 'http://127.0.0.1:' + port, child, log: () => out };
}

/* The container library, standing in: the computer Worker's own code runs
   unchanged on top of it, and its container's port is a real bridge. */
const computerSrc = readFileSync(join(ROOT, 'cloud', 'computer.mjs'), 'utf8')
  .replace(/import \{ Container \} from '@cloudflare\/containers';\nexport \{ ContainerProxy \} from '@cloudflare\/containers';/,
    `class Container {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.container = ctx.container; this.stopped = false; this.destroyed = false; }
  async stop() { this.stopped = true; this.container.running = false; }
  async destroy() { this.destroyed = true; this.container.running = false; }
  async fetch() { return new Response('proxied to the container'); }
}`);
ok(computerSrc.includes('class Container {'), 'the computer Worker was loaded with the stand-in library');
mkdirSync(join(__dir, '.build'), { recursive: true });
const compFile = join(__dir, '.build', 'computer.' + process.pid + '.mjs');
writeFileSync(compFile, computerSrc);
globalThis.FixedLengthStream = class extends TransformStream {
  constructor(n) { let seen = 0; super({ transform(c, ctl) { seen += c.byteLength; ctl.enqueue(c); }, flush(ctl) { if (seen !== n) ctl.error(new Error('length mismatch')); } }); }
};
const { AMVComputer } = await import(compFile + '?t=' + Date.now());

const portTo = (base) => ({ running: true, getTcpPort: () => ({
  fetch: (url, init) => fetch(String(url).replace('http://container', base), Object.assign({ duplex: 'half' }, init || {})) }) });
const bucket = () => {
  const m = new Map();
  return { m,
    meta: new Map(),
    /* As the real bucket does: given sha256, it refuses bytes that do not match. */
    async put(k, v, o) { const chunks = []; for await (const c of v) chunks.push(Buffer.from(c)); const buf = Buffer.concat(chunks);
      if (o && o.sha256 && createHash('sha256').update(buf).digest('hex') !== o.sha256) throw new Error('sha256 mismatch');
      m.set(k, buf); this.meta.set(k, (o && o.customMetadata) || {}); },
    async get(k) { if (!m.has(k)) return null; const b = m.get(k); return { size: b.length, body: new Blob([b]).stream(), customMetadata: this.meta.get(k) || {}, uploaded: new Date() }; },
    async head(k) { return m.has(k) ? { size: m.get(k).length } : null; },
    async list({ prefix }) { return { objects: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key, size: m.get(key).length })), truncated: false }; },
    async delete(k) { m.delete(k); } };
};
const id = { toString: () => 'a1b2c3d4' };
const quiet = console.log; const events = [];
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('{"event"')) { events.push(JSON.parse(s).event); return; } quiet(...a); };

const box = mkdtempSync(join(tmpdir(), 'amv-ws-'));
const one = join(box, 'one'), two = join(box, 'two');
mkdirSync(join(one, 'src'), { recursive: true }); mkdirSync(join(one, 'node_modules', 'left-pad'), { recursive: true });
mkdirSync(join(one, 'app', 'node_modules', 'x'), { recursive: true }); mkdirSync(two, { recursive: true });
writeFileSync(join(one, 'notes.md'), '# My plan\nShip on Friday.\n');
writeFileSync(join(one, 'src', 'app.js'), 'console.log("hello")\n');
writeFileSync(join(one, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n');
writeFileSync(join(one, 'app', 'node_modules', 'x', 'i.js'), '1\n');
const A = await bridge(one), B = await bridge(two);

section('Only AMV’s key takes a snapshot or puts one back');
{
  const none = await fetch(A.base + '/amv-bridge/snapshot');
  const wrong = await fetch(A.base + '/amv-bridge/snapshot', { headers: { 'X-AMV-Bridge-Token': 'x'.repeat(48) } });
  ok(none.status === 401 && wrong.status === 401, 'no key, or the wrong one: refused', [none.status, wrong.status]);
  const put = await fetch(B.base + '/amv-bridge/restore', { method: 'PUT', body: 'x' });
  ok(put.status === 401, 'and nothing can be put back without it', put.status);
  const snap = await fetch(A.base + '/amv-bridge/snapshot', { headers: { 'X-AMV-Bridge-Token': KEY } });
  const bytes = Buffer.from(await snap.arrayBuffer());
  ok(snap.status === 200 && bytes[0] === 0x1f && bytes[1] === 0x8b && +snap.headers.get('content-length') === bytes.length,
     'with it: a whole compressed archive, its length stated', [snap.status, bytes.length]);
}

section('Stopped for being idle, the workspace is saved; the next machine starts with it');
{
  const env = { AMV_COMPUTER_KEY: KEY, WORKSPACES: bucket() };
  const first = new AMVComputer({ id, container: portTo(A.base) }, env);
  await first.onActivityExpired();
  ok(first.stopped && env.WORKSPACES.m.has('ws/a1b2c3d4.tgz'), 'saved under the machine’s own id, then stopped', [...env.WORKSPACES.m.keys()]);
  ok(![...env.WORKSPACES.m.keys()].some(k => /@|\.com/.test(k)), 'no address or name in where it is kept');
  const next = new AMVComputer({ id, container: portTo(B.base) }, env);
  await next.onStart();
  ok(existsSync(join(two, 'notes.md')) && readFileSync(join(two, 'notes.md'), 'utf8').includes('Ship on Friday'),
     'the new machine has the person’s files', events);
  ok(existsSync(join(two, 'src', 'app.js')), 'folders and all');
  ok(!existsSync(join(two, 'node_modules')) && !existsSync(join(two, 'app', 'node_modules')), 'but not installed packages - an install makes those again');
}

section('The saved copy carries its checksum, and a damaged one is never unpacked');
{
  const env = { AMV_COMPUTER_KEY: KEY, WORKSPACES: bucket() };
  await new AMVComputer({ id, container: portTo(A.base) }, env).onActivityExpired();
  const saved = env.WORKSPACES.m.get('ws/a1b2c3d4.tgz');
  const meta = env.WORKSPACES.meta.get('ws/a1b2c3d4.tgz');
  ok(meta && meta.sha256 === createHash('sha256').update(saved).digest('hex'), 'saved with the checksum of exactly what was saved', meta);
  /* The stored object is replaced by another archive that unpacks perfectly
     well - a stale copy, a swapped object - so only the checksum can tell. */
  const other = join(box, 'other'); mkdirSync(other, { recursive: true }); writeFileSync(join(other, 'not-yours.txt'), 'someone else\n');
  const otherTgz = join(box, 'other.tgz');
  spawnSync('tar', ['-czf', otherTgz, '-C', other, '.']);
  env.WORKSPACES.m.set('ws/a1b2c3d4.tgz', readFileSync(otherTgz));
  const three = join(box, 'three'); mkdirSync(three, { recursive: true }); writeFileSync(join(three, 'mine.txt'), 'already here\n');
  const C = await bridge(three);
  events.length = 0;
  await new AMVComputer({ id, container: portTo(C.base) }, env).onStart();
  ok(events.includes('workspace_restore_failed') && !existsSync(join(three, 'not-yours.txt')), 'a copy that is not the one saved is refused, nothing of it unpacked', events);
  ok(readFileSync(join(three, 'mine.txt'), 'utf8') === 'already here\n', 'and what was there is untouched');
  const wrong = await fetch(C.base + '/amv-bridge/restore', { method: 'PUT', headers: { 'X-AMV-Bridge-Token': KEY, 'X-AMV-SHA256': 'f'.repeat(64) }, body: saved });
  ok(wrong.status === 422 && (await wrong.json()).error === 'checksum_mismatch', 'the bridge itself says why', wrong.status);
}

section('With no bucket nothing changes, and nothing breaks');
{
  const env = { AMV_COMPUTER_KEY: KEY };
  const m = new AMVComputer({ id, container: portTo(A.base) }, env);
  await m.onStart();
  await m.onActivityExpired();
  ok(m.stopped, 'it simply stops when idle, as before');
}

section('A snapshot that fails never replaces the last good copy');
{
  const env = { AMV_COMPUTER_KEY: 'not-the-key-' + 'z'.repeat(40), WORKSPACES: bucket() };
  env.WORKSPACES.m.set('ws/a1b2c3d4.tgz', Buffer.from('the last good copy'));
  const m = new AMVComputer({ id, container: portTo(A.base) }, env);
  await m.onActivityExpired();
  ok(String(env.WORKSPACES.m.get('ws/a1b2c3d4.tgz')) === 'the last good copy' && m.stopped, 'the old copy is kept, and the machine still stops', events.slice(-2));
}

section('An archive that climbs out of the workspace writes nothing outside it');
{
  const t = mkdtempSync(join(tmpdir(), 'amv-evil-'));
  mkdirSync(join(t, 'in'), { recursive: true });
  writeFileSync(join(t, 'escape.txt'), 'outside\n');
  const evil = join(t, 'evil.tgz');
  spawnSync('tar', ['-czPf', evil, '-C', join(t, 'in'), '../escape.txt']);
  const r = await fetch(B.base + '/amv-bridge/restore', { method: 'PUT', headers: { 'X-AMV-Bridge-Token': KEY }, body: readFileSync(evil) });
  ok(!existsSync(join(box, 'escape.txt')) && !existsSync(join(dirname(two), 'escape.txt')), 'nothing was written beside the workspace', r.status);
}

section('Erasing the account deletes the saved workspace and stops the machine - on AMV’s key only');
{
  const env = { AMV_COMPUTER_KEY: KEY, WORKSPACES: bucket() };
  env.WORKSPACES.m.set('ws/a1b2c3d4.tgz', Buffer.from('saved'));
  const m = new AMVComputer({ id, container: Object.assign(portTo(A.base), { running: true }) }, env);
  const bad = await m.fetch(new Request('http://amv-computer/amv-workspace/forget', { method: 'POST', headers: { 'X-AMV-Bridge-Token': 'nope' } }));
  ok(bad.status === 401 && env.WORKSPACES.m.size === 1, 'without the key: refused, nothing deleted', bad.status);
  const good = await m.fetch(new Request('http://amv-computer/amv-workspace/forget', { method: 'POST', headers: { 'X-AMV-Bridge-Token': KEY } }));
  ok(good.status === 200 && env.WORKSPACES.m.size === 0 && m.destroyed, 'with it: the copy is gone and the machine stopped', good.status);
  const other = await m.fetch(new Request('http://amv-computer/amv-bridge/exec', { method: 'POST' }));
  ok(await other.text() === 'proxied to the container', 'every other request still goes to the machine');
}

section('Each save keeps the copy it replaces, the newest five are kept, and one can be put back');
{
  const env = { AMV_COMPUTER_KEY: KEY, WORKSPACES: bucket() };
  const at = (n) => readFileSync(join(one, 'notes.md'), 'utf8');
  for (let i = 1; i <= 7; i++) {
    writeFileSync(join(one, 'notes.md'), 'version ' + i + '\n');
    await new AMVComputer({ id, container: portTo(A.base) }, env).onActivityExpired();
    await new Promise(r => setTimeout(r, 3));
  }
  const vkeys = [...env.WORKSPACES.m.keys()].filter(k => k.startsWith('ws/a1b2c3d4.v/'));
  ok(vkeys.length === 5 && vkeys.every(k => /\/\d{13}\.tgz$/.test(k)), 'seven saves leave the copy plus the five before it', vkeys);
  const m = new AMVComputer({ id, container: Object.assign(portTo(A.base), { running: true }) }, env);
  const no = await m.fetch(new Request('http://amv-computer/amv-workspace/versions', { method: 'POST', headers: { 'X-AMV-Bridge-Token': 'nope' } }));
  ok(no.status === 401, 'listing them needs AMV\u2019s key', no.status);
  const list = await (await m.fetch(new Request('http://amv-computer/amv-workspace/versions', { method: 'POST', headers: { 'X-AMV-Bridge-Token': KEY } }))).json();
  ok(list.current && list.versions.length === 5 && list.versions[0].id > list.versions[4].id && list.versions.every(v => v.bytes > 0 && !('key' in v)),
     'listed newest first, with when and how big, and no storage key', list);
  const bad = await m.fetch(new Request('http://amv-computer/amv-workspace/rollback', { method: 'POST', headers: { 'X-AMV-Bridge-Token': KEY }, body: JSON.stringify({ id: '../../x' }) }));
  const gone = await m.fetch(new Request('http://amv-computer/amv-workspace/rollback', { method: 'POST', headers: { 'X-AMV-Bridge-Token': KEY }, body: JSON.stringify({ id: '1000000000000' }) }));
  ok(bad.status === 400 && gone.status === 404, 'a malformed or unknown copy is refused', [bad.status, gone.status]);
  /* The oldest kept copy holds "version 2" (saves 2..6 replaced 1..5 copies; the copy itself is version 7). */
  writeFileSync(join(one, 'notes.md'), 'unsaved work on the running machine\n');
  const oldest = list.versions[list.versions.length - 1].id;
  const back = await m.fetch(new Request('http://amv-computer/amv-workspace/rollback', { method: 'POST', headers: { 'X-AMV-Bridge-Token': KEY }, body: JSON.stringify({ id: oldest }) }));
  const bd = await back.json();
  ok(back.status === 200 && bd.restored && m.destroyed, 'putting one back stops the running machine', bd);
  const four = join(box, 'four'); mkdirSync(four, { recursive: true });
  const D = await bridge(four);
  await new AMVComputer({ id, container: portTo(D.base) }, env).onStart();
  ok(readFileSync(join(four, 'notes.md'), 'utf8') === 'version 2\n', 'and the next machine starts with the chosen copy', readFileSync(join(four, 'notes.md'), 'utf8'));
  const after = await (await m.fetch(new Request('http://amv-computer/amv-workspace/versions', { method: 'POST', headers: { 'X-AMV-Bridge-Token': KEY } }))).json();
  const kept = [];
  for (const v of after.versions) {
    const buf = env.WORKSPACES.m.get('ws/a1b2c3d4.v/' + v.id + '.tgz');
    const t = mkdtempSync(join(tmpdir(), 'amv-v-')); writeFileSync(join(t, 'a.tgz'), buf);
    spawnSync('tar', ['-xzf', join(t, 'a.tgz'), '-C', t]);
    try { kept.push(readFileSync(join(t, 'notes.md'), 'utf8').trim()); } catch (e) { kept.push('?'); }
  }
  ok(kept.includes('unsaved work on the running machine'), 'what was on the running machine was kept as a copy first, so this can be undone', kept);
  ok(after.versions.length === 5, 'and still only five are kept', after.versions.length);
  const forget = await m.fetch(new Request('http://amv-computer/amv-workspace/forget', { method: 'POST', headers: { 'X-AMV-Bridge-Token': KEY } }));
  ok(forget.status === 200 && env.WORKSPACES.m.size === 0, 'erasing the account deletes every copy, not only the latest', [...env.WORKSPACES.m.keys()]);
}

/* The main Worker's half: deleting the account asks the computer to forget. */
section('Deleting an account reaches the computer Worker');
{
  const harness = join(__dir, '.build', 'wsforget.' + process.pid + '.harness.mjs');
  writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { issueTokens };\n');
  const W = await import(harness + '?t=' + Date.now());
  const store = new Map(); const asked = [];
  const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
    AMV_COMPUTER_KEY: KEY,
    AMV_COMPUTER: { idFromName: (n) => n, get: (n) => ({ async fetch(req) {
      asked.push({ name: n, url: req.url, key: req.headers.get('X-AMV-Bridge-Token') });
      return new Response(JSON.stringify({ forgotten: true }), { headers: { 'Content-Type': 'application/json' } }); } }) },
    AMV_KV: { async get(k){ return store.has(k) ? store.get(k) : null; }, async put(k, v){ store.set(k, v); }, async delete(k){ store.delete(k); },
      async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
  const ctx = { waitUntil(){}, passThroughOnException(){} };
  const post = async (path, body, tok) => { const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.6.1' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: JSON.stringify(body) }), env, ctx); return { status: r.status, d: await r.json().catch(() => ({})) }; };
  const PW = 'a long enough passphrase here';
  const s = await post('/auth/signup', { email: 'wren@example.com', name: 'Wren', password: PW });
  /* The saved copies, through the main Worker: a plan that has the
     workspace, and AMV's key on the way in. */
  const freeList = await post('/v1/computer/versions', {}, s.d.token);
  ok(freeList.status === 402 && freeList.d.code === 'plan_required', 'without a plan that has the workspace, the copies are not listed', freeList);
  store.set('ent:wren@example.com', JSON.stringify({ plan: 'pro', source: 'stripe', renewedAt: Date.now(), updatedAt: Date.now() }));
  asked.length = 0;
  await post('/v1/computer/versions', {}, s.d.token);
  await post('/v1/computer/rollback', { id: '1700000000000' }, s.d.token);
  ok(asked.length === 2 && /\/amv-workspace\/versions$/.test(asked[0].url) && /\/amv-workspace\/rollback$/.test(asked[1].url) && asked.every(a => a.key === KEY),
     'with one, the list and the put-back reach the computer Worker with AMV\u2019s key', asked.map(a => a.url));
  const del = await post('/auth/delete', { password: PW }, s.d.token);
  const f = asked.find(a => /\/amv-workspace\/forget$/.test(a.url));
  ok(del.status === 200 && f && f.key === KEY, 'the account was deleted and the computer asked to forget, with AMV’s key', { status: del.status, asked: asked.map(a => a.url) });
  ok(f && /^u:[0-9a-f]{48}$/.test(f.name), 'the machine it asked is named by a hash of the account, never the address', f && f.name);
}

console.log = quiet;
for (const c of running) try { c.kill('SIGKILL'); } catch (e) {}
try { rmSync(box, { recursive: true, force: true }); } catch (e) {}
if (report('the-cloud-workspace-outlives-its-container') > 0) process.exitCode = 1;
done();
