/* A GITHUB REPOSITORY OPENS IN THE CLOUD WORKSPACE - AND THE KEY STAYS OUT.

   Driven through /v1/computer/checkout against a REAL bridge in --cloud mode
   (the container runtime is stood in for, as in the cloud computer's own
   suite) and a GitHub that serves a real .tar.gz:

   - one exact commit is copied, its text files land in repos/<name>, and the
     folder records the commit it came from and is tracked by git;
   - a binary, an oversized file, a symlink, a path that climbs out and .git
     are NOT copied - and each is named in the answer;
   - the GitHub key goes to GitHub's API only: not to the host the archive is
     redirected to, and never into the machine;
   - a free plan, no GitHub connection, and an archive past the bound are each
     refused before anything is written;
   - and the way back (github.push) builds on the copied commit and can
     remove files, but only with that commit named. */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { createServer } from 'net';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'checkout.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, CONN_KV, connSeal, CONN_ACTIONS };\n');
const W = await import(harness + '?t=' + Date.now());

const KEY = 'cloud-computer-key-for-this-suite-0123456789abcdef';
const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

/* One real cloud bridge per container name, started the first time it is asked for. */
const machines = new Map(), asked = [];
let failStart = false, commandTakes = 0;
/* The clock the Worker reads, moved forward by a "long" command or a gap. */
const realNow = Date.now.bind(Date); let skew = 0;
Date.now = () => realNow() + skew;
/* One start per name, even when two requests arrive together: the map holds
   the starting promise, as the real runtime holds one container per name.
   Without this, two first requests started two machines and a file written
   by one was missing from the other. */
function machine(name) {
  if (!machines.has(name)) machines.set(name, startMachine(name));
  return machines.get(name);
}
async function startMachine(name) {
  const box = mkdtempSync(join(tmpdir(), 'amv-cc-')); const port = await freePort();
  const c = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), box, '--cloud'], {
    stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { AMV_CLOUD_KEY: KEY, PORT: String(port) }) });
  running.push(c);
  let out = ''; c.stdout.on('data', b => { out += b; });
  for (let i = 0; i < 80 && !/ready on port/.test(out); i++) await new Promise(r => setTimeout(r, 100));
  return { port, box };
}
const NS = {
  idFromName: (name) => ({ name }),
  get: (id) => ({
    async fetch(req) {
      if (failStart) throw new Error('container failed to start');
      asked.push({ name: id.name, url: req.url, key: req.headers.get('X-AMV-Bridge-Token') });
      if (commandTakes) { skew += commandTakes; commandTakes = 0; }
      const m = await machine(id.name);
      const path = new URL(req.url).pathname;
      return fetch('http://127.0.0.1:' + m.port + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AMV-Bridge-Token': req.headers.get('X-AMV-Bridge-Token') || '' }, body: await req.text() });
    },
  }),
};

function mkEnv(extra) {
  const m = new Map(), vals = new Map();
  return Object.assign({
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test', _vals: vals,
    AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
      if (b.op === 'incr') { vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
      if (b.op === 'get') return r({ value: cur });
      return r({ allowed: true, value: cur, count: 1 });
    } }) },
  }, extra || {});
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const call = (env, path, body, tok, method) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.0.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: method === 'GET' ? undefined : JSON.stringify(body || {}) }), env, ctx);
async function account(env, email, plan) {
  const tok = (await (await call(env, '/auth/signup', { email, name: 'C', password: 'A-real-Passw0rd!' })).json()).token;
  if (plan !== 'free') await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const jsonOf = async (r) => ({ status: r.status, d: await r.json().catch(() => ({})) });


import zlib from 'zlib';
import { existsSync, readdirSync, statSync } from 'fs';

/* ── A real .tar.gz, the shape GitHub sends ──────────────────────────── */
function tarEntry(name, data, type) {
  const h = Buffer.alloc(512);
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
  h.write(name.slice(0, 100), 0);
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type || '0', 156);
  if (type === '2') h.write('/etc/passwd', 157);
  h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const pad = Buffer.alloc((512 - body.length % 512) % 512);
  return Buffer.concat([h, body, pad]);
}
const TOP = 'octo-hello-0123456/';
const SHA = 'a'.repeat(40);
function archive(extra) {
  const pax = '52 comment=' + SHA + '\n';
  return zlib.gzipSync(Buffer.concat([
    tarEntry('pax_global_header', pax, 'g'),
    tarEntry(TOP, '', '5'),
    tarEntry(TOP + 'README.md', '# Hello\nA repository.\n'),
    tarEntry(TOP + 'src/app.js', 'export const answer = 42;\n'),
    tarEntry(TOP + 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1])),
    tarEntry(TOP + 'big.txt', 'x'.repeat(600 * 1024)),
    tarEntry(TOP + 'link', '', '2'),
    tarEntry(TOP + '../escape.txt', 'should never be written'),
    tarEntry(TOP + '.git/config', '[core]'),
    ...(extra || []),
    Buffer.alloc(1024),
  ]));
}

/* ── GitHub ───────────────────────────────────────────────────────────── */
const GH_TOKEN = 'gho_secret_token_value_for_this_suite';
let tarball = archive(), seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const auth = (init && init.headers && (init.headers.Authorization || init.headers.authorization)) || (input && input.headers && input.headers.get && input.headers.get('Authorization')) || '';
  if (/^https:\/\/(api\.github\.com|codeload\.github\.com)\//.test(url)) seen.push({ url, auth: String(auth) });
  const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
  if (url === 'https://api.github.com/repos/octo/hello') return J({ default_branch: 'main' });
  if (url === 'https://api.github.com/repos/octo/hello/commits/main') return J({ sha: SHA });
  if (url === 'https://api.github.com/repos/octo/hello/tarball/' + SHA)
    return new Response(null, { status: 302, headers: { Location: 'https://codeload.github.com/octo/hello/legacy.tar.gz/' + SHA } });
  if (url.startsWith('https://codeload.github.com/')) return new Response(tarball, { status: 200, headers: { 'Content-Type': 'application/x-gzip' } });
  return realFetch(input, init);
};
async function withGitHub(env, email, scopes) {
  const sealed = await W.connSeal(env, { access: GH_TOKEN, exp: Date.now() + 3600e3 });
  await W.DB.put(env, W.CONN_KV, email, { g1: { provider: 'github', scopes, sealed, unattended: false } });
}
const allFiles = (dir) => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? allFiles(p) : [p]; });

const env = mkEnv({ AMV_COMPUTER: NS, AMV_COMPUTER_KEY: KEY, CONNECT_KEY: 'test-connect-key', GH_CLIENT_ID: 'ghid', GH_CLIENT_SECRET: 'ghsec' });
const free = await account(env, 'free-co@example.com', 'free');
const nogh = await account(env, 'nogh-co@example.com', 'pro');
const pat = await account(env, 'pat-co@example.com', 'pro');
await withGitHub(env, 'pat-co@example.com', ['repo.read', 'code.write']);

section('Refused before anything is written');
{
  const f = await jsonOf(await call(env, '/v1/computer/checkout', { repo: 'octo/hello' }, free));
  ok(f.status === 402 && f.d.code === 'plan_required', 'a free plan is refused like every other cloud workspace request', f);
  const n = await jsonOf(await call(env, '/v1/computer/checkout', { repo: 'octo/hello' }, nogh));
  ok(n.status === 409 && /Connect GitHub/.test(n.d.message || ''), 'no GitHub connection says what to connect', n);
  const b = await jsonOf(await call(env, '/v1/computer/checkout', { repo: '../etc' }, pat));
  ok(b.status === 400 && b.d.error === 'bad_repo', 'a name that is not owner/name is refused', b);
  ok(asked.length === 0, 'and no machine was asked anything', asked.length);
}

section('One exact commit is copied, its text files land, and it is tracked');
{
  seen = [];
  const r = await jsonOf(await call(env, '/v1/computer/checkout', { repo: 'octo/hello' }, pat));
  ok(r.status === 200 && r.d.ok === true && r.d.base === SHA && r.d.ref === 'main' && r.d.folder === 'repos/hello', 'copied, at the commit main pointed to', r.d);
  ok(r.d.files === 2 && r.d.tracked === true, 'two text files, and git tracks the copy', r.d);
  const where = await jsonOf(await call(env, '/v1/computer/exec', { command: 'pwd' }, pat));
  const box = String(where.d.stdout || '').trim()
  ok(readFileSync(join(box, 'repos/hello/README.md'), 'utf8') === '# Hello\nA repository.\n'
     && readFileSync(join(box, 'repos/hello/src/app.js'), 'utf8') === 'export const answer = 42;\n', 'byte for byte', true);
  const mark = JSON.parse(readFileSync(join(box, 'repos/hello/.amv-checkout.json'), 'utf8'));
  ok(mark.base === SHA && mark.repo === 'octo/hello', 'the folder records which commit it is', mark);
  const log = await jsonOf(await call(env, '/v1/computer/exec', { command: 'git log --oneline | wc -l && git status --porcelain | wc -l', cwd: 'repos/hello' }, pat));
  ok(/^\s*1\s*\n\s*0\s*$/.test(log.d.stdout || ''), 'one commit, nothing changed yet - so "what changed" starts from here', log.d.stdout);
  const why = Object.fromEntries((r.d.skipped || []).map(s => [s.path, s.why]));
  ok(why['logo.png'] === 'not text' && why['big.txt'] === 'larger than 512 KB' && why['link'] === 'not a regular file',
     'a binary, an oversized file and a symlink are not copied, and each is named', why);
  ok(Object.keys(why).some(p => /escape\.txt/.test(p)) && Object.keys(why).some(p => /\.git/.test(p)), 'nor a path that climbs out, nor .git', why);
  ok(!existsSync(join(box, 'escape.txt')) && !existsSync(join(box, '..', 'escape.txt')) && !existsSync(join(box, 'repos', 'escape.txt')),
     'the path that climbs out was written nowhere', true);
  ok(readFileSync(join(box, 'repos/hello/.git/config'), 'utf8') !== '[core]', 'the archive\u2019s .git/config is not the one there - that is git\u2019s own, from tracking the copy', true);
  ok(!existsSync(join(box, 'repos/hello/logo.png')) && !existsSync(join(box, 'repos/hello/big.txt')), 'and the binary and the oversized file are not there either', true);
  ok(!existsSync(join(box, 'repos/hello/link')), 'the symlink was never made', true);
}

section('The key goes to GitHub’s API, not to the archive host, and never into the machine');
{
  const api = seen.filter(s => s.url.startsWith('https://api.github.com/')), cl = seen.filter(s => s.url.startsWith('https://codeload.github.com/'));
  ok(api.length >= 2 && api.every(s => s.auth.includes(GH_TOKEN)), 'every call to the API carried it', api.map(s => s.url));
  ok(cl.length === 1 && !cl[0].auth, 'the redirected download did not', cl);
  const box = String((await jsonOf(await call(env, '/v1/computer/exec', { command: 'pwd' }, pat))).d.stdout || '').trim();
  const leaked = allFiles(box).filter(p => { try { return readFileSync(p, 'utf8').includes(GH_TOKEN); } catch (e) { return false; } });
  ok(leaked.length === 0, 'no file in the machine holds it', leaked);
  ok(!asked.some(a => /gho_/.test(a.url)), 'and no request to the machine named it', true);
}

section('An archive past the bound is refused before anything is written');
{
  const before = asked.length;
  tarball = zlib.gzipSync(Buffer.alloc(90 * 1024 * 1024));
  const r = await jsonOf(await call(env, '/v1/computer/checkout', { repo: 'octo/hello' }, pat));
  tarball = archive();
  ok(r.status === 413 && r.d.error === 'too_large', 'more than it unpacks to is refused, and said', r);
  ok(asked.length === before, 'and the machine was not touched', asked.length - before);
}

section('The way back builds on the copied commit, and removes files only with it named');
{
  const sent = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input), m = (init && init.method) || 'GET', b = init && init.body ? JSON.parse(init.body) : null;
    sent.push({ m, url, b });
    const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200 });
    if (/\/git\/blobs$/.test(url)) return J({ sha: 'blob0' });
    if (/\/git\/trees$/.test(url)) return J({ sha: 'tree0' });
    if (/\/git\/commits$/.test(url)) return J({ sha: 'c'.repeat(40) });
    if (/\/git\/refs$/.test(url)) return J({ ref: b.ref });
    if (/\/git\/ref\/heads\/amv-x$/.test(url)) return J({ object: { sha: 'c'.repeat(40) } });
    if (/\/git\/ref\/heads\/main$/.test(url)) return J({ object: { sha: 'b'.repeat(40) } });
    return J({});
  };
  const push = W.CONN_ACTIONS['github.push'];
  const r = await push.run('tok', { repo: 'octo/hello', base: 'main', branch: 'amv-x', baseSha: SHA, message: 'm',
    files: [{ path: 'src/app.js', content: 'export const answer = 43;\n' }], deletes: ['README.md'] });
  const tree = sent.find(s => /\/git\/trees$/.test(s.url)).b, commit = sent.find(s => /\/git\/commits$/.test(s.url)).b;
  ok(r.verified === true && commit.parents[0] === SHA && tree.base_tree === SHA, 'the branch is built on the commit that was copied', [commit.parents, tree.base_tree]);
  ok(!sent.some(s => /\/git\/ref\/heads\/main$/.test(s.url)), 'not on wherever main has moved to since', sent.map(s => s.url));
  ok(tree.tree.some(e => e.path === 'README.md' && e.sha === null) && tree.tree.some(e => e.path === 'src/app.js' && e.sha === 'blob0'), 'the change and the removal are both in it', tree.tree);
  let err = '';
  try { await push.run('tok', { repo: 'octo/hello', base: 'main', branch: 'amv-y', files: [], deletes: ['README.md'] }); } catch (e) { err = e.message; }
  ok(err === 'deletes_need_base', 'removing a file without naming the starting commit is refused', err);
  globalThis.fetch = realFetch;
}

if (report('a-repository-opens-in-the-cloud-workspace') > 0) process.exitCode = 1;
done();
