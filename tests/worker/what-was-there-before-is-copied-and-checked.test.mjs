/* WHAT WAS THERE BEFORE IS COPIED, AND THEN CHECKED.

   Step 3 of docs/DATA-TIER.md, the backfill (src/worker/04b-pg-backfill.js),
   against a REAL throwaway Postgres with the real schema and the real Worker:
     - nothing happens until the owner starts it, and only with the admin token;
     - records written before step 2 (no binding) are copied: accounts with
       their plans and keys, teams, sellers' money lines;
     - it stops between pages and goes on from where it was;
     - the repair list is worked: a record copied as KV has it now, a money
       row exactly as it was kept, each taken off once written; one it cannot
       read stays and is counted;
     - a team whose owner has no account is not invented: it is listed;
     - every account is read back; a row changed behind its back is found;
     - run again from the start it copies nothing twice.
   And step 4, shadow reads (src/worker/04c-pg-shadow.js): only the cohort is
   compared, at most once a minute a record, KV always answers, an absent
   record is compared too, and a write on its way is not a difference. */
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdtempSync, chmodSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const NAME = 'what-was-there-before-is-copied-and-checked';
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const SCHEMA = join(ROOT, 'migrations', 'postgres', '0001_control_plane.sql');
const BIN = ['/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/local/bin', '/opt/homebrew/bin']
  .find(d => existsSync(join(d, 'initdb')));
ok(!!BIN, 'a Postgres server is available (install postgresql to run this suite)', BIN);
if (!BIN) { report(NAME); process.exitCode = 1; done(); process.exit(1); }

const asRoot = process.getuid && process.getuid() === 0;
const dir = mkdtempSync(join('/tmp', 'amv-pgbf-'));
chmodSync(dir, 0o777);
const PORT = 41000 + Math.floor(Math.random() * 8000);
const sh = (cmd) => asRoot ? execSync(`su postgres -c ${JSON.stringify(cmd)}`, { stdio: 'pipe' }) : execSync(cmd, { stdio: 'pipe' });
const user = asRoot ? 'postgres' : (process.env.USER || 'runner');
sh(`${BIN}/initdb -D ${dir}/data -A trust -U ${user} >/dev/null`);
sh(`${BIN}/pg_ctl -D ${dir}/data -o "-k ${dir} -p ${PORT} -c listen_addresses=127.0.0.1" -l ${dir}/log -w start >/dev/null`);
process.on('exit', () => { try { sh(`${BIN}/pg_ctl -D ${dir}/data -m fast -w stop >/dev/null`); } catch (e) {} try { rmSync(dir, { recursive: true, force: true }); } catch (e) {} });
const PSQL = existsSync(join(BIN, 'psql')) ? join(BIN, 'psql') : 'psql';
const q = (sql) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', String(PORT), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-c', sql], { stdio: 'pipe' }).toString().trim();
execFileSync(PSQL, ['-h', '127.0.0.1', '-p', String(PORT), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', SCHEMA], { stdio: 'pipe' });

mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'pgbackfill.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _pgSettle, runPgBackfill, pgBackfillRoute, pgShadowRoute, _pgLeaseRelease, _pgClient };\n');
const W = await import(harness + '?t=' + Date.now());

const quiet = console.log; const audits = [];
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('AUDIT')) { try { audits.push(JSON.parse(s.slice(6))); } catch (e) {} return; } quiet(...a); };

/* KV as Cloudflare's behaves where it matters here: keys in order, pages of
   at most `limit`, and a cursor that says where the next page starts. */
const store = new Map();
const kv = {
  async get(k){ return store.has(k) ? store.get(k) : null; }, async put(k, v){ store.set(k, v); }, async delete(k){ store.delete(k); },
  async list({ prefix, cursor, limit }){
    const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
    const from = cursor ? all.findIndex(k => k > cursor) : 0;
    const start = from < 0 ? all.length : from;
    const keys = all.slice(start, start + (limit || 1000));
    const complete = start + keys.length >= all.length;
    return { keys: keys.map(name => ({ name })), list_complete: complete, cursor: complete ? undefined : keys[keys.length - 1] };
  },
};
const counters = new Map();
const PG = { connectionString: `postgres://${user}@127.0.0.1:${PORT}/postgres` };
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ADMIN_TOKEN: 'admin-token-for-the-test-0123456789',
  /* Counters that count, so the shadow tallies can be read back. */
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init){
    const b = JSON.parse(init.body); const cur = counters.get(n) || 0;
    if (b.op === 'incr') counters.set(n, cur + (b.amount || 0));
    return new Response(JSON.stringify({ allowed: true, value: counters.get(n) || 0 }));
  } }) }),
  AMV_KV: kv };
const admin = (method, body, token = env.ADMIN_TOKEN) => new Request('https://api.amv.test/admin/pg/backfill', { method,
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' }, token ? { 'X-Admin-Token': token } : {}),
  body: body ? JSON.stringify(body) : undefined });
const status = async () => (await W.pgBackfillRoute(admin('GET'), env)).json();
const runToEnd = async (sliceMs) => {
  let calls = 0, last = null;
  do { last = await W.runPgBackfill(env, { sliceMs }); calls++; } while (last.state === 'running' && calls < 200);
  return { calls, last };
};

/* ── What was there before step 2: written with no binding ─────────────── */
const N = 150;
for (let i = 0; i < N; i++) {
  const e = 'p' + String(i).padStart(3, '0') + '@example.com';
  await W.DB.put(env, 'acct', e, { name: 'Person ' + i, provider: 'email', pwHash: 'h' + i, salt: 's' + i, createdAt: Date.UTC(2026, 0, 1) });
  if (i % 3 === 0) await W.DB.put(env, 'ent', e, { plan: i % 2 ? 'pro' : 'max', source: 'stripe' });
  if (i % 10 === 0) await W.DB.put(env, 'apikeys', e, { items: [{ id: 'k' + i, hash: 'hash' + i, name: 'CI', scopes: ['chat'], created: Date.UTC(2026, 1, 1) },
    { id: 'k' + i + 'b', hash: 'hash' + i + 'b', created: Date.UTC(2026, 1, 1), revoked: Date.UTC(2026, 2, 1) }] });
}
await W.DB.put(env, 'team', 'team_one', { id: 'team_one', name: 'Studio', ownerEmail: 'p000@example.com',
  members: [{ email: 'p000@example.com', role: 'owner' }, { email: 'p001@example.com', role: 'member' }] });
await W.DB.put(env, 'team', 'team_orphan', { id: 'team_orphan', name: 'Nobody', ownerEmail: 'nobody@example.com', members: [] });
store.set('wallet_tx:p002@example.com', JSON.stringify([
  { type: 'withdrawal_paid', amount: 0, status: 'paid', id: 'wd_9', ts: Date.UTC(2026, 3, 3) },
  { type: 'withdrawal', amount: -4, status: 'pending', id: 'wd_9', ts: Date.UTC(2026, 3, 2) },
  { type: 'sale', amount: 9, item: 'itm_9', ref: 'pi_9', ts: Date.UTC(2026, 3, 1), holdUntil: Date.UTC(2026, 3, 15) },
  { type: 'sale', amount: 3, item: 'itm_old', ref: '', ts: Date.UTC(2025, 0, 1) },
]));
/* Left by step 2: a money row it could not write, a plan it could not write
   (which KV has since changed), and an entry nobody can read. */
store.set('pgrepair:ledger:credit:pi_pack_7', JSON.stringify({ at: 1, why: 'timeout', row: { email: 'p003@example.com', currency: 'USD', amount: 20, reason: 'purchase', key: 'credit:pi_pack_7', at: Date.UTC(2026, 4, 1), note: 'subject:p003@example.com' } }));
store.set('pgrepair:ent:p004@example.com', JSON.stringify({ at: 1, why: 'timeout' }));
await W.DB.put(env, 'ent', 'p004@example.com', { plan: 'team', source: 'stripe' });
store.set('pgrepair:ledger:mangled', '{not json');
env.PG = PG;

section('Nothing happens until the owner starts it, and only the owner can');
{
  const r = await W.runPgBackfill(env);
  ok(r.on && r.state === 'not_started' && q('select count(*) from accounts') === '0', 'binding the database copies nothing on its own', r);
  const denied = await W.pgBackfillRoute(admin('POST', { action: 'start' }, 'wrong-token'), env);
  ok(denied.status === 403 && q("select count(*) from migration_cursor where kind='_run'") === '0', 'a wrong token starts nothing', denied.status);
  const bad = await W.pgBackfillRoute(admin('POST', { action: 'go' }), env);
  ok(bad.status === 400, 'an action it does not know is refused', bad.status);
  const s = await (await W.pgBackfillRoute(admin('POST', { action: 'start' }), env)).json();
  ok(s.state === 'running' && s.phases.length === 5 && s.phases.every(p => !p.done), 'started, every phase still to do', s.state);
}

section('It stops between pages and goes on from where it was');
{
  const { calls, last } = await runToEnd(1);
  ok(calls >= 3, 'a short slice took several runs', calls);
  ok(last.state === 'done', 'and it finished', last);
  ok(q('select count(*) from accounts') === String(N), 'every account, once', q('select count(*) from accounts'));
  ok(q('select count(*) from migration_accounts where kv_digest is not null and backfilled_at is not null') === String(N), 'each with what it was copied from');
}

section('Each account arrives with its plan and its keys');
{
  ok(q('select count(*) from entitlements') === String(N / 3 + 1), 'one plan row for each account that has a plan (every third, and p004’s)', q('select count(*) from entitlements'));
  ok(q("select e.plan from entitlements e join accounts a on a.id=e.account_id where a.email='p003@example.com'") === 'pro', 'the plan it has');
  ok(q("select a.pw_hash||'|'||a.name from accounts a where a.email='p007@example.com'") === 'h7|Person 7', 'and its sign-in as it was');
  ok(q('select count(*) from api_keys') === String(2 * N / 10) && q('select count(*) from api_keys where revoked_at is not null') === String(N / 10),
     'every key by its hash, a revoked one with when', q('select count(*) from api_keys'));
}

section('Teams follow their members; one with no owner is listed, never invented');
{
  ok(q("select count(*) from memberships m join organizations o on o.id=m.org_id where o.legacy_id='team_one'") === '2', 'the team and both its members');
  ok(q("select count(*) from organizations where legacy_id='team_orphan'") === '0' && store.has('pgrepair:team:team_orphan'),
     'the one whose owner has no account is on the repair list instead', [...store.keys()].filter(k => k.startsWith('pgrepair:')));
  ok(audits.some(a => a.event === 'pg_backfill_failed' && /team_orphan/.test(a.key)), 'and on the record');
}

section('A seller’s history becomes the rows the live writes would have made');
{
  const rows = q("select idempotency_key||'|'||reason||'|'||amount::text from seller_ledger order by idempotency_key").split('\n');
  ok(rows.join() === 'seller:sale:pi_9:itm_9|sale|9.000000,seller:withdrawal:wd_9|payout|-4.000000', 'the sale and the payout; nothing for the paid mark; nothing for a line with no identity', rows);
}

section('The repair list is worked: as KV has it now, or the row exactly as kept');
{
  ok(q("select amount::text||'|'||reason||'|'||note from credit_ledger where idempotency_key='credit:pi_pack_7'") === '20.000000|purchase|subject:p003@example.com', 'the kept money row, as it was kept');
  ok(q("select e.plan from entitlements e join accounts a on a.id=e.account_id where a.email='p004@example.com'") === 'team', 'the plan as KV has it now, not as it was when the write failed');
  ok(!store.has('pgrepair:ledger:credit:pi_pack_7') && !store.has('pgrepair:ent:p004@example.com'), 'each off the list once written');
  ok(store.has('pgrepair:ledger:mangled'), 'one nobody can read stays for a person to look at');
}

section('Every account was read back, and they match');
{
  const s = await status();
  ok(s.accountsDiffering === 0 && s.rows.accounts === N && s.phases.every(p => p.done), 'none differ, every phase done', s);
  ok(s.repairsWaiting === 2 && /Credit packs bought before step 2/.test(s.notCopied), 'and it says what is left, and what it does not copy', s.repairsWaiting);
}

section('Run again from the start, it copies nothing twice and finds a row changed behind its back');
{
  q("update accounts set name='Somebody else' where email='p010@example.com'");
  await W.pgBackfillRoute(admin('POST', { action: 'restart' }), env);
  audits.length = 0;
  const { last } = await runToEnd();
  ok(last.state === 'done', 'it finished again', last);
  ok(q('select count(*) from accounts') === String(N) && q('select count(*) from seller_ledger') === '2' && q('select count(*) from credit_ledger') === '1',
     'the same rows, none twice');
  ok(audits.some(a => a.event === 'pg_backfill_mismatch' && a.id === 'p010@example.com' && a.fields === 'name'), 'the changed name is found by reading it back', audits.filter(a => a.event === 'pg_backfill_mismatch'));
  ok(q("select mismatches||'|'||last_mismatch from migration_accounts where email='p010@example.com'") === '1|name', 'and counted against that account');
  const s = await status();
  ok(s.accountsDiffering === 1, 'the status says so', s.accountsDiffering);
}

section('One run at a time: a lease, taken over only from a run that went silent (Nov 1 audit DATA-008)');
{
  const phaseCursors = () => q("select coalesce(string_agg(kind||'='||coalesce(cursor,'-')||':'||copied, ',' order by kind), '') from migration_cursor where kind not like '\\_%'");
  await W.pgBackfillRoute(admin('POST', { action: 'restart' }), env);
  /* Somebody else holds it, and is alive. */
  q("insert into migration_cursor (kind, cursor, copied, updated_at) values ('_lease', 'run:other', 0, now()) on conflict (kind) do update set cursor='run:other', updated_at=now()");
  const before = phaseCursors();
  const busy = await W.runPgBackfill(env, { sliceMs: 60000 });
  ok(busy.busy === true && phaseCursors() === before && q("select cursor from migration_cursor where kind='_lease'") === 'run:other',
     'a run that finds the lease held does nothing, and leaves the holder holding it', busy);
  /* The holder went silent: taken over, and released at the end of the slice. */
  q("update migration_cursor set updated_at = now() - interval '10 minutes' where kind='_lease'");
  const took = await W.runPgBackfill(env, { sliceMs: 1 });
  ok(!took.busy && !took.leaseLost && phaseCursors() !== before, 'a lease silent past its time is taken over, and the run moves on', took);
  ok(q("select cursor from migration_cursor where kind='_lease'") === '', 'and the lease is given back when the slice ends');
  /* Two at once: exactly one works. */
  const pair = await Promise.all([W.runPgBackfill(env, { sliceMs: 1 }), W.runPgBackfill(env, { sliceMs: 1 })]);
  ok(pair.filter(r => r.busy).length === 1 && pair.filter(r => !r.busy).length === 1, 'two runs started together: one holds the lease, the other is a clean no-op', pair.map(r => r.busy ? 'busy' : r.state));
  /* Losing the lease in the middle of a slice: the cursor is not moved, and the run stops. */
  const mid = phaseCursors();
  const realList = kv.list; let stolen = false;
  kv.list = async (o) => { if (!stolen && /^(acct|ent|team|apikeys|wallet_tx|pgrepair)/.test(o.prefix || '')) { stolen = true; q("update migration_cursor set cursor='run:thief', updated_at=now() where kind='_lease'"); } return realList.call(kv, o); };
  const lost = await W.runPgBackfill(env, { sliceMs: 60000 });
  kv.list = realList;
  ok(stolen && lost.leaseLost === true && phaseCursors() === mid, 'a run whose lease was taken stops, and moves no cursor', { lost, before: mid, after: phaseCursors() });
  ok(q("select cursor from migration_cursor where kind='_lease'") === 'run:thief', 'and does not give back a lease that is not its own');
  const c = await W._pgClient(env);
  try { await W._pgLeaseRelease(c, 'run:not-the-holder'); } finally { await c.end({ timeout: 5 }); }
  ok(q("select cursor from migration_cursor where kind='_lease'") === 'run:thief', 'releasing is only ever done by the holder: anybody else\u2019s release changes nothing');
  q("update migration_cursor set cursor='' where kind='_lease'");
  const { last } = await runToEnd();
  ok(last.state === 'done', 'with the lease free again, it finishes', last);
}

section('Stopped, it stays stopped');
{
  await W.pgBackfillRoute(admin('POST', { action: 'stop' }), env);
  const r = await W.runPgBackfill(env);
  ok(r.state === 'stopped', 'the cron does nothing while it is stopped', r);
}

section('A change that lands while an account is being read back is not a difference');
{
  /* Only the read-back left to do. The first read of p020 sees KV with a new
     name whose Postgres write has not landed yet; by the second it has - the
     live dual write in flight, which is what the read-back must not report. */
  q("update migration_cursor set cursor=null, copied=0 where kind='verify'");
  await W.pgBackfillRoute(admin('POST', { action: 'start' }), env);
  const key = 'acct:p020@example.com', get = kv.get; let reads = 0;
  const renamed = () => JSON.stringify(Object.assign(JSON.parse(store.get(key)), { name: 'Renamed' }));
  kv.get = async (k) => {
    if (k !== key) return get(k);
    reads++;
    if (reads === 2) q("update accounts set name='Renamed' where email='p020@example.com'");
    return renamed();
  };
  audits.length = 0;
  const { last } = await runToEnd();
  kv.get = get;
  ok(last.state === 'done' && reads >= 2, 'read back again, and finished', { last, reads });
  ok(!audits.some(a => a.event === 'pg_backfill_mismatch' && a.id === 'p020@example.com') &&
     q("select mismatches from migration_accounts where email='p020@example.com'") === '0', 'not reported as a difference');
}

/* ── Step 4: shadow reads ───────────────────────────────────────────────── */
const shadowAudits = (id) => audits.filter(a => (a.event === 'pg_shadow_mismatch' || a.event === 'pg_shadow_failed') && a.id === id);
const compared = () => [...counters.entries()].filter(([k]) => /^pgshadow:.*:compared:s\d+$/.test(k)).reduce((t, [, v]) => t + v, 0);

section('Shadow reads: with nobody in the cohort, nothing is compared');
{
  delete env.PG_SHADOW;
  const before = compared();
  const v = await W.DB.get(env, 'acct', 'p030@example.com');
  await W._pgSettle();
  ok(v && v.name === 'Person 30' && compared() === before, 'the read is answered and nothing else happens');
  const st = await (await W.pgShadowRoute(admin('GET'), env)).json();
  ok(st.on === false && /PG_SHADOW/.test(st.note), 'and the status says why', st);
}

section('Shadow reads: a named account is compared, and an account outside is not');
{
  env.PG_SHADOW = 'p030@example.com';
  const before = compared();
  await W.DB.get(env, 'acct', 'p030@example.com');
  await W.DB.get(env, 'acct', 'p031@example.com');
  await W._pgSettle();
  ok(compared() === before + 1 && !shadowAudits('p030@example.com').length, 'one read compared, and it matches', compared() - before);
  await W.DB.get(env, 'acct', 'p030@example.com');
  await W._pgSettle();
  ok(compared() === before + 1, 'read again within the minute, it is not compared again');
}

section('Shadow reads: a difference is found, counted - and KV still answers');
{
  env.PG_SHADOW = 'p033@example.com,p036@example.com';
  q("update entitlements set plan='free' where account_id=(select id from accounts where email='p033@example.com')");
  audits.length = 0;
  const v = await W.DB.getStrict(env, 'ent', 'p033@example.com');
  ok(v && v.plan === 'pro', 'the person is answered from KV: their real plan', v);
  await W._pgSettle();
  const m = shadowAudits('p033@example.com');
  ok(m.length === 1 && m[0].event === 'pg_shadow_mismatch' && m[0].fields === 'plan' && m[0].kind === 'ent', 'the plan difference is on the record', m);
  ok(q("select last_mismatch from migration_accounts where email='p033@example.com'") === 'ent:plan', 'and against the account');
  const st = await (await W.pgShadowRoute(admin('GET'), env)).json();
  ok(st.on && st.cohort.addresses === 2 && st.days[0].differed === 1 && st.differing.some(d => d.email === 'p033@example.com' && d.last === 'ent:plan'),
     'the status shows the day’s count and the account', st);
}

section('Shadow reads: a record KV no longer has is compared too');
{
  env.PG_SHADOW = 'p039@example.com';
  store.delete('ent:p039@example.com');
  audits.length = 0;
  ok((await W.DB.get(env, 'ent', 'p039@example.com')) === null, 'KV answers: no plan');
  await W._pgSettle();
  ok(shadowAudits('p039@example.com').some(a => a.fields === 'plan_not_removed'), 'and the plan Postgres still has is found', shadowAudits('p039@example.com'));
}

section('Shadow reads: a write on its way to Postgres is not a difference');
{
  /* KV already has the new plan; the Postgres write lands before the second
     look (which is the second read of the key). */
  env.PG_SHADOW = 'p036@example.com';
  store.set('ent:p036@example.com', JSON.stringify({ plan: 'pro', source: 'stripe' }));
  const get = kv.get; let reads = 0;
  kv.get = async (k) => {
    if (k === 'ent:p036@example.com' && ++reads === 2) q("update entitlements set plan='pro' where account_id=(select id from accounts where email='p036@example.com')");
    return get(k);
  };
  audits.length = 0;
  await W.DB.get(env, 'ent', 'p036@example.com');
  await W._pgSettle();
  kv.get = get;
  ok(reads === 2, 'looked at twice', reads);
  ok(!shadowAudits('p036@example.com').length && q("select mismatches from migration_accounts where email='p036@example.com'") === '0', 'read again, it matches, and nothing is reported');
}

section('Shadow reads: a share of everybody, by a hash of the address');
{
  env.PG_SHADOW = '100%';
  const before = compared();
  for (const e of ['p040@example.com', 'p041@example.com', 'p042@example.com']) await W.DB.get(env, 'apikeys', e);
  await W._pgSettle();
  ok(compared() === before + 3, 'at 100%, every read is compared', compared() - before);
  env.PG_SHADOW = '0%';
  await W.DB.get(env, 'acct', 'p043@example.com');
  await W._pgSettle();
  ok(compared() === before + 3, 'at 0%, none is');
  delete env.PG_SHADOW;
}

section('Without the binding, nothing is tried');
{
  const saved = env.PG; delete env.PG;
  ok((await W.runPgBackfill(env)).on === false && (await status()).on === false, 'the cron and the route both say it is off');
  env.PG = saved;
}

console.log = quiet;
if (report(NAME) > 0) process.exitCode = 1;
done();
process.exit(process.exitCode || 0);
