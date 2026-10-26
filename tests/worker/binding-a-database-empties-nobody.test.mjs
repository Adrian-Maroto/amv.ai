/* BINDING A DATABASE EMPTIES NOBODY.

   Scale audit, Oct 26. The data layer moved every read to D1 the moment
   env.DB existed, with no read-through to KV - so binding a new, empty
   database to a deployment with accounts would have made every account,
   plan and wallet read as missing at the next deploy. The only thing in the
   way was a comment. Now the binding alone changes nothing: D1 is the store
   only when DATA_STORE = "d1" is ALSO set, which is a separate, deliberate
   step taken after the data is copied and checked.

   And D1 refuses a row over 2,000,000 bytes while one person's synced data
   may reach about 4 MB, so a record that size is refused by name rather than
   by a database error somewhere less legible. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'binding-a-database.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const { DB } = await import(harness + '?t=' + Date.now());

const makeKV = () => { const m = new Map(); return {
  async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); },
  async delete(k) { m.delete(k); }, async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } }; };
/* An empty D1 that records what reached it. */
const makeD1 = () => { const rows = new Map(); const seen = [];
  return { seen, rows, prepare(sql) { return { bind(...a) { return {
    async first() { seen.push(sql); return rows.has(a[0] + ':' + a[1]) ? { json: rows.get(a[0] + ':' + a[1]) } : null; },
    async run() { seen.push(sql); if (/^INSERT/.test(sql)) rows.set(a[0] + ':' + a[1], a[2]); if (/^DELETE/.test(sql)) rows.delete(a[0] + ':' + a[1]); return {}; },
    async all() { seen.push(sql); return { results: [] }; } }; } }; } }; };

section('An account in KV, then an empty database bound beside it');
{
  const env = { AMV_KV: makeKV(), DB: makeD1() };
  await env.AMV_KV.put('user:ana@example.com', JSON.stringify({ email: 'ana@example.com', plan: 'pro' }));
  const u = await DB.get(env, 'user', 'ana@example.com');
  ok(u && u.plan === 'pro', 'the account still reads, from where it is', u);
  ok(env.DB.seen.length === 0, 'and the empty database was never asked', env.DB.seen);
  await DB.put(env, 'user', 'ben@example.com', { email: 'ben@example.com' });
  ok(!!(await env.AMV_KV.get('user:ben@example.com')) && env.DB.rows.size === 0, 'a write goes to KV too, not into the unused database');
}

section('Switched on deliberately, the database is the store');
{
  const env = { AMV_KV: makeKV(), DB: makeD1(), DATA_STORE: 'd1' };
  await DB.put(env, 'user', 'cy@example.com', { email: 'cy@example.com' });
  ok(env.DB.rows.has('user:cy@example.com'), 'with DATA_STORE = "d1", writes go to D1');
  ok((await DB.get(env, 'user', 'cy@example.com')).email === 'cy@example.com', 'and read back from it');
}

section('A record over the D1 row limit is refused by name');
{
  const env = { AMV_KV: makeKV(), DB: makeD1(), DATA_STORE: 'd1' };
  const big = { convs: 'é'.repeat(1000000) };        // 1M characters, 2M bytes
  let threw = null;
  try { await DB.put(env, 'data', 'dee@example.com', big); } catch (e) { threw = e; }
  ok(threw && /over the database's 1900000-byte limit/.test(threw.message) && /data record/.test(threw.message),
     'it says which record and that it is over the limit, in bytes not characters', threw && threw.message);
  ok(!env.DB.rows.has('data:dee@example.com'), 'and nothing half-written reached the database');
  const fine = { convs: 'a'.repeat(1000000) };       // 1M characters, 1M bytes
  await DB.put(env, 'data', 'eve@example.com', fine);
  ok(env.DB.rows.has('data:eve@example.com'), 'a record under the limit is stored as before');
  const kvEnv = { AMV_KV: makeKV() };
  await DB.put(kvEnv, 'data', 'dee@example.com', big);
  ok(!!(await kvEnv.AMV_KV.get('data:dee@example.com')), 'on KV, where the limit is 25 MB, the same record is stored');
}

if (report('binding-a-database-empties-nobody') > 0) process.exitCode = 1;
done();
