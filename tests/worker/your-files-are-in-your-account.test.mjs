/* YOUR FILES ARE IN YOUR ACCOUNT, ON EVERY DEVICE - AND ONLY YOURS.

   The library used to live in one browser. These routes keep the same files
   in the account (object storage, bound as AMV_FILES), and every property that
   makes that safe is checked against the storage itself rather than against
   what a route answered:

     off until it is bound, and saying so rather than pretending to sync;
     a file is "kept" only after it is read back from storage;
     the plan's limit is enforced on the server, before a byte is stored;
     nobody can open somebody else's file by guessing its id;
     deleting a file, or the account, removes the bytes - checked in storage. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'library.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { DB, LIB_LIMITS };\n');
const W = await import(harness + '?t=' + Date.now());

/* Object storage the way R2 behaves for the calls AMV makes. `loseWrites`
   accepts a put and keeps nothing - the provider that says yes and does not. */
function mkR2() {
  const m = new Map();
  const r2 = {
    _m: m, loseWrites: false,
    async put(k, v) { if (!r2.loseWrites) m.set(k, String(v)); return { key: k }; },
    async get(k) { return m.has(k) ? { text: async () => m.get(k), size: new TextEncoder().encode(m.get(k)).length } : null; },
    async head(k) { return m.has(k) ? { key: k, size: new TextEncoder().encode(m.get(k)).length } : null; },
    async delete(k) { for (const x of [].concat(k)) m.delete(x); },
    async list({ prefix, limit } = {}) {
      const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix));
      return { objects: keys.slice(0, limit || 1000).map(key => ({ key })), truncated: false };
    },
  };
  return r2;
}
function mkEnv(files) {
  const m = new Map();
  return {
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    ...(files ? { AMV_FILES: files } : {}),
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const req = (env, path, body, tok, method) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: method || (body === undefined ? 'GET' : 'POST'),
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '55.55.55.55', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env, ctx);
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };
const PW = 'A-real-Passw0rd!';
const signup = async (env, email) => (await jsonOf(await req(env, '/auth/signup', { email, name: 'X', password: PW }))).token;
const file = (n, body) => ({ sig: 'text|' + n + '|' + body.length, kind: 'text', name: n, size: body.length, body });

section('Off until storage is bound, and it says so');
{
  const env = mkEnv(null);
  const tok = await signup(env, 'a@example.com');
  const d = await jsonOf(await req(env, '/v1/library', undefined, tok));
  ok(d.ok === true && d.configured === false && Array.isArray(d.files) && d.files.length === 0,
     'the list answers "not switched on", not an error and not an empty account', d);
  const p = await jsonOf(await req(env, '/v1/library/put', file('a.txt', 'hello'), tok));
  ok(p.configured === false && !p.file, 'and nothing claims to have been kept', p);
}

section('A file is kept, listed, and opened again - from the storage itself');
{
  const r2 = mkR2(), env = mkEnv(r2);
  const tok = await signup(env, 'a@example.com');
  const r = await req(env, '/v1/library/put', file('notes.txt', 'the contract says 30 days'), tok);
  const d = await jsonOf(r);
  ok(r.status === 200 && d.ok && d.verified === true && d.file && d.file.id, 'kept, and read back before it said so', d);
  ok(r2._m.size === 1 && [...r2._m.values()][0] === 'the contract says 30 days', 'the bytes really are in storage', r2._m.size);
  ok(![...r2._m.keys()][0].includes('a@example.com'), 'under a key that does not contain the address', [...r2._m.keys()][0]);
  const l = await jsonOf(await req(env, '/v1/library', undefined, tok));
  ok(l.configured === true && l.files.length === 1 && l.files[0].name === 'notes.txt', 'another device listing the account sees it', l.files);
  const g = await jsonOf(await req(env, '/v1/library/get?id=' + encodeURIComponent(d.file.id), undefined, tok));
  ok(g.body === 'the contract says 30 days', 'and opens exactly what was kept', g);
  const again = await jsonOf(await req(env, '/v1/library/put', file('notes.txt', 'the contract says 30 days'), tok));
  ok(again.existed === true && r2._m.size === 1, 'the same file sent twice is one file', [again, r2._m.size]);
}

section('Storage that says yes and keeps nothing is not "kept"');
{
  const r2 = mkR2(), env = mkEnv(r2);
  const tok = await signup(env, 'a@example.com');
  r2.loseWrites = true;
  const r = await req(env, '/v1/library/put', file('lost.txt', 'gone'), tok);
  const d = await jsonOf(r);
  ok(r.status === 502 && d.error === 'not_kept' && /still on this device/.test(d.message || ''), 'reported as not kept, and where it still is', [r.status, d]);
  const l = await jsonOf(await req(env, '/v1/library', undefined, tok));
  ok(l.files.length === 0, 'and the list never names a file that is not there', l.files);
}

section('Nobody opens or deletes somebody else’s file');
{
  const r2 = mkR2(), env = mkEnv(r2);
  const a = await signup(env, 'a@example.com'), b = await signup(env, 'b@example.com');
  const kept = await jsonOf(await req(env, '/v1/library/put', file('private.txt', 'mine'), a));
  const g = await req(env, '/v1/library/get?id=' + encodeURIComponent(kept.file.id), undefined, b);
  ok(g.status === 404, 'another account asking for its id gets nothing', g.status);
  await req(env, '/v1/library/delete', { ids: [kept.file.id] }, b);
  ok(r2._m.size === 1, 'and cannot delete it either', r2._m.size);
  const noone = await req(env, '/v1/library', undefined, null);
  ok(noone.status === 401, 'signed out, there is no list at all', noone.status);
}

section('The plan’s limit holds on the server, before a byte is stored');
{
  const r2 = mkR2(), env = mkEnv(r2);
  const tok = await signup(env, 'a@example.com');
  const cap = W.LIB_LIMITS.free.files;
  for (let i = 0; i < cap; i++) await req(env, '/v1/library/put', file('f' + i + '.txt', 'x' + i), tok);
  const before = r2._m.size;
  const r = await req(env, '/v1/library/put', file('one-more.txt', 'over'), tok);
  const d = await jsonOf(r);
  ok(before === cap, 'a free account keeps its full allowance', before);
  ok(r.status === 409 && d.error === 'library_full' && r2._m.size === cap, 'the next one is refused and nothing extra is stored', [r.status, r2._m.size]);
}

section('Deleting removes the bytes, and so does deleting the account');
{
  const r2 = mkR2(), env = mkEnv(r2);
  const tok = await signup(env, 'gone@example.com');
  const one = await jsonOf(await req(env, '/v1/library/put', file('a.txt', 'a'), tok));
  await req(env, '/v1/library/put', file('b.txt', 'b'), tok);
  const del = await jsonOf(await req(env, '/v1/library/delete', { ids: [one.file.id] }, tok));
  ok(del.ok && del.deleted === 1 && r2._m.size === 1, 'one file deleted is one object gone from storage', [del, r2._m.size]);
  const other = await signup(env, 'stays@example.com');
  await req(env, '/v1/library/put', file('c.txt', 'c'), other);
  const r = await req(env, '/auth/delete', { password: PW }, tok);
  ok(r.status === 200, 'the account deletes', r.status);
  const left = [...r2._m.values()];
  ok(left.length === 1 && left[0] === 'c', 'every object of that account is gone, and nobody else’s', left);
  ok(!(await W.DB.get(env, 'lib', 'gone@example.com')), 'and so is the list', true);
}

if (report('your-files-are-in-your-account') > 0) process.exitCode = 1;
done();
