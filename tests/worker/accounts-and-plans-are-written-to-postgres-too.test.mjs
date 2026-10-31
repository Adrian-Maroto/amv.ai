/* ACCOUNTS AND PLANS ARE WRITTEN TO POSTGRES TOO - AND KV STILL DECIDES.

   Owner decision #47 (Oct 31): step 2 of docs/DATA-TIER.md, write to both.
   Against a REAL throwaway Postgres with the real schema applied, and the
   real Worker driving its real driver:
     - signing up writes the account row (password hash and all), and the
       migration's own record of it;
     - a plan written through the data layer lands as one entitlement row,
       with every field it has no column for kept beside it;
     - KV is unchanged by any of it: it is still the record;
     - a database that is down never fails a sign-up - the write is put on
       the record and on the repair list;
     - a plan that arrives before its account has a row is listed for repair,
       never invented;
     - deleting the account leaves a tombstone with nothing personal on it;
     - without the binding nothing is tried. */
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdtempSync, chmodSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const SCHEMA = join(ROOT, 'migrations', 'postgres', '0001_control_plane.sql');
const BIN = ['/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/local/bin', '/opt/homebrew/bin']
  .find(d => existsSync(join(d, 'initdb')));
ok(!!BIN, 'a Postgres server is available (install postgresql to run this suite)', BIN);
if (!BIN) { report('accounts-and-plans-are-written-to-postgres-too'); process.exitCode = 1; done(); process.exit(1); }

const asRoot = process.getuid && process.getuid() === 0;
const dir = mkdtempSync(join('/tmp', 'amv-pgdw-'));
chmodSync(dir, 0o777);
const PORT = 41000 + Math.floor(Math.random() * 8000);
const sh = (cmd) => asRoot ? execSync(`su postgres -c ${JSON.stringify(cmd)}`, { stdio: 'pipe' }) : execSync(cmd, { stdio: 'pipe' });
const user = asRoot ? 'postgres' : (process.env.USER || 'runner');
sh(`${BIN}/initdb -D ${dir}/data -A trust -U ${user} >/dev/null`);
const start = () => sh(`${BIN}/pg_ctl -D ${dir}/data -o "-k ${dir} -p ${PORT} -c listen_addresses=127.0.0.1" -l ${dir}/log -w start >/dev/null`);
const stop = () => sh(`${BIN}/pg_ctl -D ${dir}/data -m fast -w stop >/dev/null`);
start();
process.on('exit', () => { try { stop(); } catch (e) {} try { rmSync(dir, { recursive: true, force: true }); } catch (e) {} });
const PSQL = existsSync(join(BIN, 'psql')) ? join(BIN, 'psql') : 'psql';
const q = (sql) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', String(PORT), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-c', sql], { stdio: 'pipe' }).toString().trim();
execFileSync(PSQL, ['-h', '127.0.0.1', '-p', String(PORT), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', SCHEMA], { stdio: 'pipe' });

mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'pgdual.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _pgSettle };\n');
const W = await import(harness + '?t=' + Date.now());

const quiet = console.log; const audits = [];
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('AUDIT')) { try { audits.push(JSON.parse(s.slice(6))); } catch (e) {} return; } quiet(...a); };
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  PG: { connectionString: `postgres://${user}@127.0.0.1:${PORT}/postgres` },
  AMV_KV: { async get(k){ return store.has(k) ? store.get(k) : null; }, async put(k, v){ store.set(k, v); }, async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil(){}, passThroughOnException(){} };
let ip = 1;
const post = async (path, body, tok) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.3.' + (ip++) }, tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: JSON.stringify(body) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const PW = 'a long enough passphrase here';

let tok = '';
section('Signing up writes the account row, and the migration’s record of it');
{
  const s = await post('/auth/signup', { email: 'Ana@Example.com', name: 'Ana', password: PW });
  tok = s.d.token;
  await W._pgSettle();
  const kv = JSON.parse(store.get('acct:ana@example.com'));
  const row = q("select email, name, provider, pw_hash, pw_salt, pw_iter, extra::text from accounts where email='ana@example.com'").split('|');
  ok(s.status === 200 && row[0] === 'ana@example.com' && row[1] === 'Ana' && row[2] === 'email', 'the row is there, the address lower-cased', row.slice(0, 3));
  ok(row[3] === kv.pwHash && row[4] === kv.salt && +row[5] === kv.pwIter, 'with the same password hash, salt and cost as the KV record');
  ok(JSON.parse(row[6]).sipHash === kv.sipHash, 'and every field without a column of its own kept beside it');
  ok(q("select count(*) from migration_accounts where email='ana@example.com' and account_id is not null and read_from='kv'") === '1',
     'the migration knows the account, and that KV is still where it is read from');
}

section('A plan lands as one entitlement row, and KV is unchanged by it');
{
  const ent = { plan: 'pro', source: 'stripe', renewedAt: Date.UTC(2026, 9, 1), subId: 'sub_123', updatedAt: Date.now() };
  await W.DB.put(env, 'ent', 'ana@example.com', ent);
  await W._pgSettle();
  const row = q("select e.plan, e.source, to_char(e.period_start at time zone 'UTC','YYYY-MM-DD'), e.extra::text from entitlements e join accounts a on a.id=e.account_id where a.email='ana@example.com'").split('|');
  ok(row[0] === 'pro' && row[1] === 'stripe' && row[2] === '2026-10-01', 'plan, source and when it renewed', row);
  ok(JSON.parse(row[3]).subId === 'sub_123', 'and the subscription id kept in its extras');
  await W.DB.put(env, 'ent', 'ana@example.com', Object.assign({}, ent, { plan: 'ultra' }));
  await W._pgSettle();
  ok(q("select count(*)||':'||max(plan) from entitlements") === '1:ultra', 'a change updates the one row, it does not add a second');
  ok(JSON.parse(store.get('ent:ana@example.com')).plan === 'ultra' && JSON.parse(store.get('ent:ana@example.com')).subId === 'sub_123', 'KV holds exactly what it was given');
}

section('API keys land one row each, by their hash alone; revoking one keeps its row with when');
{
  const a = await post('/v1/keys/create', { name: 'CI' }, tok);
  const b = await post('/v1/keys/create', { name: 'Zapier' }, tok);
  await W._pgSettle();
  const rows = q("select k.id, k.name, k.key_hash, (k.revoked_at is null) from api_keys k join accounts a on a.id=k.account_id where a.email='ana@example.com' order by k.name").split('\n').map(r => r.split('|'));
  const kv = JSON.parse(store.get('apikeys:ana@example.com')).items;
  ok(a.status === 200 && b.status === 200 && rows.length === 2 && rows[0][1] === 'CI' && rows[1][1] === 'Zapier', 'two keys, two rows', rows);
  ok(rows.every(r => kv.some(k => k.id === r[0] && k.hash === r[2])) && !q('select key_hash from api_keys').includes(a.d.key),
     'each by its hash - the key itself is nowhere in the database');
  await post('/v1/keys/revoke', { id: a.d.item.id }, tok);
  await W._pgSettle();
  ok(q(`select (revoked_at is not null) from api_keys where id='${a.d.item.id}'`) === 't' && q('select count(*) from api_keys') === '2',
     'the revoked key keeps its row, saying when');
}

section('A plan before its account has a row is listed for repair, never invented');
{
  let threw = '';
  try { await W.DB.put(env, 'ent', 'ghost@example.com', { plan: 'pro' }); } catch (e) { threw = e.message; }
  await W._pgSettle();
  ok(!threw && JSON.parse(store.get('ent:ghost@example.com')).plan === 'pro', 'the write itself succeeds - the mirror failing is not the caller’s failure', threw);
  ok(store.has('pgrepair:ent:ghost@example.com') && q("select count(*) from accounts where email='ghost@example.com'") === '0',
     'on the repair list, and no account made up for it', [...store.keys()].filter(k => k.startsWith('pgrepair:')));
}

section('A database that is down never fails a sign-up');
{
  stop();
  audits.length = 0;
  const t0 = Date.now();
  const s = await post('/auth/signup', { email: 'ben@example.com', name: 'Ben', password: PW });
  const took = Date.now() - t0;
  await W._pgSettle();
  ok(s.status === 200 && !!s.d.token, 'the account is made, as if nothing were wrong', s.status);
  ok(took < 5000, 'without waiting on the database', took);
  ok(store.has('pgrepair:acct:ben@example.com') && audits.some(a => a.event === 'pg_mirror_failed' && a.kind === 'acct'), 'the missed write is on the record and on the repair list');
  start();
}

section('Deleting the account leaves a tombstone with nothing personal on it');
{
  const del = await post('/auth/delete', { password: PW }, tok);
  await W._pgSettle();
  ok(del.status === 200, 'deleted', del.status);
  ok(q("select count(*) from accounts where email like '%ana%'") === '0', 'the address is gone from every row');
  const t = q("select name, coalesce(pw_hash,'none'), coalesce(pw_salt,'none'), extra::text, (deleted_at is not null) from accounts where email like 'erased-%'").split('|');
  ok(t[0] === '' && t[1] === 'none' && t[2] === 'none' && t[3] === '{}' && t[4] === 't', 'the tombstone has no name, no password and no extras', t);
  ok(q("select count(*) from migration_accounts where email='ana@example.com'") === '0', 'and the migration no longer names it');
  ok(q("select count(*) from api_keys") === '0' && q("select count(*) from entitlements e join accounts a on a.id=e.account_id where a.deleted_at is not null") === '0',
     'its keys and its plan are gone from the database too');
}

section('Without the binding, nothing is tried');
{
  const saved = env.PG; delete env.PG;
  for (const k of [...store.keys()]) if (k.startsWith('pgrepair:')) store.delete(k);
  await post('/auth/signup', { email: 'cy@example.com', name: 'Cy', password: PW });
  await W._pgSettle();
  ok(q("select count(*) from accounts where email='cy@example.com'") === '0' && ![...store.keys()].some(k => k.startsWith('pgrepair:')), 'no row, and nothing to repair');
  env.PG = saved;
}

console.log = quiet;
if (report('accounts-and-plans-are-written-to-postgres-too') > 0) process.exitCode = 1;
done();
process.exit(process.exitCode || 0);
