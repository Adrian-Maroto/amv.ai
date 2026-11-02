/* YOUR FILES ARE IN YOUR ACCOUNT, ON EVERY DEVICE - AND ONLY YOURS.

   The library used to live in one browser. These routes keep the same files
   in the account (object storage, bound as AMV_FILES), and every property that
   makes that safe is checked against the storage itself rather than against
   what a route answered:

     off until it is bound, and saying so rather than pretending to sync;
     a file is "kept" only after it is read back from storage;
     the plan's limit is enforced on the server, before a byte is stored;
     nobody can open somebody else's file by guessing its id;
     deleting a file, or the account, removes the bytes - checked in storage;
     a folder is checked on the server and a move is read back before it is
     called done. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

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
    AMV_COUNTER: withAuthOps({ idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0, ok: true })); } }) }),
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
  /* Nov 1 audit FILE-005: the limit counts what the store holds - bytes - not characters. */
  const text = 'é'.repeat(1000);            // 1,000 characters, 2,000 bytes
  await req(env, '/v1/library/put', file('accents.txt', text), tok);
  const rec = await W.DB.get(env, 'lib', 'a@example.com');
  const f = rec.files.find(x => x.name === 'accents.txt');
  ok(f && f.bytes === 2000 && f.chars === 1000, 'a file is counted by its stored bytes', f && { bytes: f.bytes, chars: f.chars });
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

section('A file must be what it says it is: programs and macro-carrying Office files are not kept');
{
  const r2 = mkR2(), env = mkEnv(r2);
  const tok = await signup(env, 'q@example.com');
  const b64 = (buf) => Buffer.from(buf).toString('base64');
  const bin = (kind, n, bytes, extra) => ({ sig: kind + '|' + n + '|' + bytes.length, kind, name: n, size: bytes.length, body: b64(bytes), ...(extra || {}) });
  /* A tiny zip whose list of parts names what is inside it. */
  const zip = (parts) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40), Buffer.from(parts.join('\n')), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);
  const put = async (f) => { const r = await req(env, '/v1/library/put', f, tok); return { status: r.status, d: await jsonOf(r) }; };
  const pdf = await put(bin('pdf', 'contract.pdf', Buffer.from('%PDF-1.7\n1 0 obj')));
  ok(pdf.status === 200 && pdf.d.ok, 'a real PDF is kept', pdf);
  const png = await put(bin('img', 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])));
  ok(png.status === 200, 'a real image is kept', png.status);
  const docx = await put(bin('office', 'plan.docx', zip(['[Content_Types].xml', 'word/document.xml']), { format: 'docx' }));
  ok(docx.status === 200, 'a Word file is kept', docx);
  const before = r2._m.size;
  const fakePdf = await put(bin('pdf', 'invoice.pdf', Buffer.from('<html><script>steal()</script>')));
  ok(fakePdf.status === 422 && fakePdf.d.error === 'refused_not_what_it_says' && /not what it says it is/.test(fakePdf.d.message), 'a "PDF" that is not one is refused, and said', fakePdf.d);
  const exe = await put(bin('pdf', 'invoice.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60)])));
  ok(exe.status === 422 && exe.d.error === 'refused_program', 'a program named like a PDF is refused as a program', exe.d);
  const svg = await put(bin('img', 'logo.svg', Buffer.from('<svg onload="x()"></svg>')));
  ok(svg.status === 422, 'an "image" that is markup is not kept as an image', svg.status);
  const macro = await put(bin('office', 'budget.xlsx', zip(['[Content_Types].xml', 'xl/workbook.xml', 'xl/vbaProject.bin']), { format: 'xlsx' }));
  ok(macro.status === 422 && macro.d.error === 'refused_macros' && /contains macros/.test(macro.d.message), 'an Office file carrying macros is refused, and says why', macro.d);
  ok(r2._m.size === before, 'and nothing refused reached storage', r2._m.size - before);
  const text = await put(file('readme.txt', 'MZ is just two letters in a note'));
  ok(text.status === 200, 'a text note is text, whatever it starts with', text.status);
}

section('Folders: checked on the server, and a move is read back');
{
  const r2 = mkR2(), env = mkEnv(r2);
  const tok = await signup(env, 'folders@example.com');
  const other = await signup(env, 'neighbour@example.com');
  const bad = await req(env, '/v1/library/put', { ...file('x.txt', 'x'), folder: 'a/b/c/d' }, tok);
  ok(bad.status === 400 && (await jsonOf(bad)).error === 'bad_folder' && r2._m.size === 0,
     'a folder four names deep is refused before anything is stored', [bad.status, r2._m.size]);
  for (const f of ['../up', 'a/./b', 'x'.repeat(41), 'a\\b', '<b>']) {
    const r = await req(env, '/v1/library/put', { ...file('y.txt', 'y'), folder: f }, tok);
    ok(r.status === 400, 'and so is ' + JSON.stringify(f.slice(0, 12)), r.status);
  }
  const kept = await jsonOf(await req(env, '/v1/library/put', { ...file('tax.txt', 'tax'), folder: ' Taxes / 2026 ' }, tok));
  ok(kept.file && kept.file.folder === 'Taxes/2026', 'a file can arrive in a folder, written the same way every time', kept.file);
  const two = await jsonOf(await req(env, '/v1/library/put', file('notes.txt', 'notes'), tok));
  let list = (await jsonOf(await req(env, '/v1/library', undefined, tok))).files || [];
  ok(list.find(f => f.id === kept.file.id)?.folder === 'Taxes/2026' && !list.find(f => f.id === two.file.id)?.folder,
     'the list says which folder each file is in', list.map(f => f.folder));

  const mv = await req(env, '/v1/library/move', { ids: [two.file.id], folder: 'Taxes/2026' }, tok);
  const md = await jsonOf(mv);
  list = (await W.DB.get(env, 'lib', 'folders@example.com')).files;
  ok(mv.status === 200 && md.ok && md.moved === 1 && md.verified === true && list.find(f => f.id === two.file.id).folder === 'Taxes/2026',
     'a move is in the stored list, not only in the answer', [mv.status, md]);
  const out = await jsonOf(await req(env, '/v1/library/move', { ids: [kept.file.id], folder: '' }, tok));
  list = (await W.DB.get(env, 'lib', 'folders@example.com')).files;
  ok(out.ok && out.folder === '' && !list.find(f => f.id === kept.file.id).folder, 'and a file can be taken out of its folder', out);

  const badMv = await req(env, '/v1/library/move', { ids: [two.file.id], folder: '..' }, tok);
  list = (await W.DB.get(env, 'lib', 'folders@example.com')).files;
  ok(badMv.status === 400 && list.find(f => f.id === two.file.id).folder === 'Taxes/2026', 'a bad folder moves nothing', badMv.status);
  const none = await req(env, '/v1/library/move', { ids: [], folder: 'A' }, tok);
  ok(none.status === 400, 'a move that names no file is refused', none.status);
  const theirs = await req(env, '/v1/library/move', { ids: [two.file.id], folder: 'Mine' }, other);
  list = (await W.DB.get(env, 'lib', 'folders@example.com')).files;
  ok(theirs.status === 404 && list.find(f => f.id === two.file.id).folder === 'Taxes/2026',
     'another account cannot move somebody else’s file by its id', theirs.status);
  const partial = await jsonOf(await req(env, '/v1/library/move', { ids: [two.file.id, 'no-such-id'], folder: 'Work' }, tok));
  ok(partial.ok && partial.moved === 1 && partial.verified === false, 'a move of some of what was named says so instead of calling it all done', partial);
  const anon = await req(env, '/v1/library/move', { ids: [two.file.id], folder: 'A' }, null);
  ok(anon.status === 401, 'signed out, nothing moves', anon.status);
}

section('An Office file is kept as the file itself, and only as one');
{
  const r2 = mkR2(), env = mkEnv(r2);
  const tok = await signup(env, 'office@example.com');
  const b64 = Buffer.from('PK\u0003\u0004 a word document').toString('base64');
  const doc = { sig: 'office|r.docx|' + b64.length, kind: 'office', name: 'r (edited).docx', size: 20, format: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: b64 };
  const d = await jsonOf(await req(env, '/v1/library/put', doc, tok));
  ok(d.ok && d.verified === true && d.file && d.file.kind === 'office' && d.file.format === 'docx', 'a Word file is kept as an office entry', d);
  const g = await jsonOf(await req(env, '/v1/library/get?id=' + encodeURIComponent(d.file.id), undefined, tok));
  ok(g.body === b64, 'and opened again byte for byte, so another device has the file and not just its words', g.body && g.body.length);
  const noFmt = await req(env, '/v1/library/put', Object.assign({}, doc, { sig: 'x1', format: 'exe' }), tok);
  ok(noFmt.status === 400, 'an office entry that is not Word, Excel or PowerPoint is refused', noFmt.status);
  const notB64 = await req(env, '/v1/library/put', Object.assign({}, doc, { sig: 'x2', body: '<script>alert(1)</script>' }), tok);
  ok(notB64.status === 400, 'and so is one whose body is not base64', notB64.status);
  ok(r2._m.size === 1, 'neither refusal stored a byte', r2._m.size);
}

if (report('your-files-are-in-your-account') > 0) process.exitCode = 1;
done();
