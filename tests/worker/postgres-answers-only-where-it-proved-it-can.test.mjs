/* POSTGRES ANSWERS ONLY WHERE IT HAS PROVED IT CAN (step 5 of the move to
   Postgres, src/worker/04d-pg-read.js; Oct 31 audit item 13).

   Against a real Postgres server, through the Worker's own routes and DB:
     - outside the PG_READ cohort, KV answers exactly as before;
     - inside it, an account and a plan come from Postgres - proved by
       changing the Postgres row alone and seeing the answer change;
     - a write reaches Postgres before the request goes on, so the next read
       sees it with nothing in flight;
     - an answer that differs from KV marks the record stale and KV answers
       from then on; the owner is told; when the copies agree again it goes
       back to Postgres;
     - Postgres down: KV answers, sign-in still works, and it is counted;
     - a write that cannot reach Postgres marks the record stale BEFORE the
       request returns, so the next read is never the old row;
     - sign-in and the plan a paid account is given are right throughout;
     - API keys are never answered from Postgres. */
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdtempSync, chmodSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const SCHEMA = join(ROOT, 'migrations', 'postgres', '0001_control_plane.sql');
const BIN = ['/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/local/bin', '/opt/homebrew/bin']
  .find(d => existsSync(join(d, 'initdb')));
ok(!!BIN, 'a Postgres server is available (install postgresql to run this suite)', BIN);
if (!BIN) { report('postgres-answers-only-where-it-proved-it-can'); process.exitCode = 1; done(); process.exit(1); }

const asRoot = process.getuid && process.getuid() === 0;
const dir = mkdtempSync(join('/tmp', 'amv-pgrd-'));
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
execFileSync(PSQL, ['-h', '127.0.0.1', '-p', String(PORT), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', SCHEMA.replace('0001_control_plane', '0002_money_constraints')], { stdio: 'pipe' });

mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'pgread.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _pgSettle, _planOf };\n');
const W = await import(harness + '?t=' + Date.now());

const quiet = console.log; const audits = [];
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('AUDIT')) { try { audits.push(JSON.parse(s.slice(6))); } catch (e) {} return; } quiet(...a); };
const alerts = [];
globalThis.fetch = async (u, init) => { if (String(u).startsWith('https://alerts.example')) alerts.push(String((init && init.body) || '')); return new Response('{}', { status: 200 }); };
const store = new Map(); const counters = new Map();
const GOOD = `postgres://${user}@127.0.0.1:${PORT}/postgres`;
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  ALERT_WEBHOOK: 'https://alerts.example/hook',
  PG: { connectionString: GOOD },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const r = o => new Response(JSON.stringify(o));
    const cur = counters.get(n) || 0;
    if (b.op === 'claim') { if (counters.has('c:' + n)) return r({ claimed: false }); counters.set('c:' + n, 1); return r({ claimed: true }); }
    if (b.op === 'release') { counters.delete('c:' + n); return r({ ok: true }); }
    if (b.op === 'incr') { counters.set(n, cur + (b.amount || 0)); return r({ value: counters.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    if (b.op === 'clear') { counters.delete(n); return r({ ok: true }); }
    if (b.op === 'lifeGet') return r({ tally: {} });
    return r({ allowed: true, value: cur });
  } }) }),
  AMV_KV: { async get(k){ return store.has(k) ? store.get(k) : null; }, async put(k, v){ store.set(k, v); }, async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil(){}, passThroughOnException(){} };
/* The proof lives in its own object now (Nov 3 audit DATA-019), not in KV. */
const proof = (k) => { const [, kind, email] = k.split(':'); const p = env.AMV_COUNTER._objects.get('pf|pgproof:' + kind + ':' + email); return p && p.digest ? p.digest : null; };
let ip = 1;
const post = async (path, body, tok) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.4.' + (ip++ % 250) }, tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: JSON.stringify(body) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const PW = 'a long enough passphrase here';
const settle = () => W._pgSettle();

/* Two accounts, written to both stores while nobody reads from Postgres. */
await post('/auth/signup', { email: 'in@example.com', name: 'Ina', password: PW });
await post('/auth/signup', { email: 'out@example.com', name: 'Otto', password: PW });
const ENT = { plan: 'pro', source: 'stripe', renewedAt: Date.UTC(2026, 9, 1), subId: 'sub_1', updatedAt: Date.UTC(2026, 9, 1, 12) };
await W.DB.put(env, 'ent', 'in@example.com', ENT);
await W.DB.put(env, 'ent', 'out@example.com', ENT);
await settle();
env.PG_READ = 'in@example.com';

section('Outside the cohort, KV answers exactly as before');
{
  q("update accounts set name = 'CHANGED IN PG' where email = 'out@example.com'");
  ok((await W.DB.get(env, 'acct', 'out@example.com')).name === 'Otto', 'a row changed in Postgres alone changes nothing for somebody outside it');
  q("update accounts set name = 'Otto' where email = 'out@example.com'");
}

section('Unproved, KV answers; the comparison writes the proof; then Postgres answers (Nov 1 audit DATA-001)');
{
  /* Rows were mirrored before the cohort existed: there is no proof yet. */
  ok(!proof('pgok:acct:in@example.com') && !proof('pgok:ent:in@example.com'), 'no record starts out proved');
  q("update entitlements set plan = 'free' where account_id = (select id from accounts where email='in@example.com')");
  const first = await W.DB.get(env, 'ent', 'in@example.com');
  await settle();
  ok(first.plan === 'pro', 'a Postgres row that is WRONG is never served, not even once: KV answered the unproved record', first);
  ok(!proof('pgok:ent:in@example.com'), 'and the comparison found them different, so no proof was written');
  ok(alerts.some(a => /differs from KV/.test(a)), 'and the owner is told', alerts);
  q("update entitlements set plan = 'pro' where account_id = (select id from accounts where email='in@example.com')");
  const fresh = await import(harness + '?t=' + Date.now() + 'p');
  await fresh.DB.get(env, 'acct', 'in@example.com'); await fresh.DB.get(env, 'ent', 'in@example.com');
  await fresh._pgSettle();
  ok(!!proof('pgok:acct:in@example.com') && !!proof('pgok:ent:in@example.com'), 'once both copies agree, each record gets its proof');
  /* Proof that Postgres is the one answering: the KV copy is taken away
     behind its back, and the proved row still answers. */
  const kvAcct = store.get('acct:in@example.com');
  store.delete('acct:in@example.com');
  const a = await fresh.DB.get(env, 'acct', 'in@example.com');
  const kv = JSON.parse(kvAcct);
  ok(a && a.email === 'in@example.com' && a.pwHash === kv.pwHash && a.salt === kv.salt && a.pwIter === kv.pwIter && a.sipHash === kv.sipHash && a.createdAt === kv.createdAt,
     'a proved row answers, rebuilt from Postgres field for field', { a, kv });
  store.set('acct:in@example.com', kvAcct);
  const e = await fresh.DB.get(env, 'ent', 'in@example.com');
  ok(e.plan === 'pro' && e.subId === 'sub_1' && e.renewedAt === ENT.renewedAt && e.updatedAt === ENT.updatedAt && !('blocked' in e) && !('seats' in e),
     'the plan too - and no field the record never had', e);
  const login = await post('/auth/login', { email: 'in@example.com', password: PW });
  ok(login.status === 200, 'and the person signs in', login.status);
}

section('A row changed behind the proof is not served, and loses its proof');
{
  q("update entitlements set plan = 'free' where account_id = (select id from accounts where email='in@example.com')");
  const fresh = await import(harness + '?t=' + Date.now() + 'q');
  const r = await fresh.DB.get(env, 'ent', 'in@example.com');
  await fresh._pgSettle();
  ok(r.plan === 'pro', 'the changed row did not match its proof, so KV answered - the paid plan, not the wrong row', r);
  ok(!proof('pgok:ent:in@example.com'), 'and the proof is gone until the copies agree again');
  q("update entitlements set plan = 'pro' where account_id = (select id from accounts where email='in@example.com')");
  const again = await import(harness + '?t=' + Date.now() + 'r');
  await again.DB.get(env, 'ent', 'in@example.com'); await again._pgSettle();
  ok(!!proof('pgok:ent:in@example.com'), 'then it is proved again');
}

section('A write reaches Postgres before the request goes on, is read back, and is proved');
{
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'ultra', updatedAt: ENT.updatedAt + 1 }));
  ok(q("select e.plan from entitlements e join accounts a on a.id=e.account_id where a.email='in@example.com'") === 'ultra', 'the row has it with nothing left in flight');
  const before = proof('pgok:ent:in@example.com');
  ok(!!before, 'and the row it read back is proved');
  const kvEnt = store.get('ent:in@example.com'); store.delete('ent:in@example.com');
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === 'ultra', 'so the next read is answered by Postgres, with the new plan');
  store.set('ent:in@example.com', kvEnt);
}

section('A write Postgres cannot hold faithfully is not proved');
{
  /* A date stored as text, which the timestamp column cannot round-trip. */
  const odd = Object.assign({}, ENT, { plan: 'ultra', updatedAt: ENT.updatedAt + 3, renewedAt: '2026-10-01' });
  await W.DB.put(env, 'ent', 'in@example.com', odd);
  ok(!proof('pgok:ent:in@example.com') && /read back differs/.test(store.get('pgrepair:ent:in@example.com') || ''), 'the row read back is not what was written, so there is no proof and it is on the repair list', store.get('pgrepair:ent:in@example.com'));
  ok((await W.DB.get(env, 'ent', 'in@example.com')).renewedAt === '2026-10-01', 'and KV answers, exactly as written');
  store.delete('pgrepair:ent:in@example.com');
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'ultra', updatedAt: ENT.updatedAt + 4 }));
  ok(!!proof('pgok:ent:in@example.com'), 'a faithful write is proved again');
}

section('A write whose proof cannot be removed does not happen (DATA-003)');
{
  /* The proof's object cannot be reached, so its fence cannot be moved. */
  const realNs = env.AMV_COUNTER;
  env.AMV_COUNTER = Object.assign({}, realNs, { get: (id) => { const inner = realNs.get(id); return { fetch: async (u, init) => {
    if (JSON.parse(init.body).op === 'proofFence') throw new Error('object unreachable'); return inner.fetch(u, init); } }; } });
  let threw = false;
  try { await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'elite', updatedAt: ENT.updatedAt + 9 })); } catch (e) { threw = true; }
  env.AMV_COUNTER = realNs;
  ok(threw, 'the put fails');
  ok(JSON.parse(store.get('ent:in@example.com')).plan === 'ultra', 'and KV was not changed underneath a proof that would still vouch for the old row');
}

section('Postgres down: KV answers, sign-in works, and it is counted');
{
  env.PG = { connectionString: `postgres://${user}@127.0.0.1:1/postgres` };
  const before = audits.filter(a => JSON.stringify(a).includes('pg_read_fell_back')).length;
  const login = await post('/auth/login', { email: 'in@example.com', password: PW });
  ok(login.status === 200, 'the person still signs in', login.status);
  ok(audits.filter(a => JSON.stringify(a).includes('pg_read_fell_back')).length > before, 'and the fallback is on the record');
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === 'ultra', 'their plan is still right');
}

section('A write that cannot reach Postgres leaves no proof, so the old row is never served (DATA-003)');
{
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'elite', updatedAt: ENT.updatedAt + 2 }));
  ok(!proof('pgok:ent:in@example.com') && store.has('pgrepair:ent:in@example.com'), 'no proof, and on the repair list the moment the put returns');
  /* Even if the repair marker could not be written, the missing proof alone keeps the old row from answering. */
  env.PG = { connectionString: GOOD };
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === 'elite', 'with Postgres back, the next read is KV’s new plan, never the old row');
  ok(q("select e.plan from entitlements e join accounts a on a.id=e.account_id where a.email='in@example.com'") === 'ultra', '(the row Postgres still holds is the old one)');
  await settle();
}

section('The proof lives where it cannot be stale, and a comparison cannot outlive a write (Nov 3 audit DATA-019/020)');
{
  /* The real object, not the stand-in: a proof is set only under the epoch
     its comparison began in, and every fence moves the epoch. */
  const st = new Map();
  const obj = new W.AMVCounter({ storage: { async get(k) { return st.get(k); }, async put(k, v) { st.set(k, v); }, async delete(k) { st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {} } }, {});
  const call = async (b) => (await obj.fetch(new Request('https://do/counter', { method: 'POST', body: JSON.stringify(b) }))).json();
  const began = await call({ op: 'proofGet' });
  await call({ op: 'proofFence' });                                   // a write lands during the comparison
  const late = await call({ op: 'proofSet', epoch: began.epoch, digest: 'abc' });
  ok(late.ok === false && !(await call({ op: 'proofGet' })).digest, 'a comparison that began before a write cannot set its proof');
  const now = await call({ op: 'proofGet' });
  ok((await call({ op: 'proofSet', epoch: now.epoch, digest: 'abc' })).ok && (await call({ op: 'proofGet' })).digest === 'abc', 'one that began after it can');
  await call({ op: 'proofFence' });
  ok(!(await call({ op: 'proofGet' })).digest, 'and the next fence removes it at once, for every reader');

  /* The audit's sequence: a region still holds the OLD proof (as KV could),
     a write moves the record while Postgres misses it, and the old row
     would match that old proof exactly. */
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'pro', updatedAt: ENT.updatedAt + 30 }));
  await settle();
  await W.DB.get(env, 'ent', 'in@example.com'); await settle();
  for (let i = 0; i < 3 && !proof('pgok:ent:in@example.com'); i++) { await new Promise(r => setTimeout(r, 1100)); await W.DB.get(env, 'ent', 'in@example.com'); await settle(); }
  const oldProof = proof('pgok:ent:in@example.com');
  ok(!!oldProof, 'the record is proved (Postgres holds plan pro)');
  store.set('pgok:ent:in@example.com', oldProof);                 // a stale copy of the proof, where the old design kept it
  env.PG = { connectionString: `postgres://${user}@127.0.0.1:1/postgres` };
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'elite', updatedAt: ENT.updatedAt + 31 }));
  env.PG = { connectionString: GOOD };
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === 'elite', 'the old row is not served, however stale a copy of its proof somewhere is');
  await settle();

  /* Written while the record was OUT of the read cohort: the proof is still
     fenced, so putting it back in does not revive the old row. */
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'pro', updatedAt: ENT.updatedAt + 32 }));
  await settle();
  for (let i = 0; i < 3 && !proof('pgok:ent:in@example.com'); i++) { await new Promise(r => setTimeout(r, 1100)); await W.DB.get(env, 'ent', 'in@example.com'); await settle(); }
  ok(!!proof('pgok:ent:in@example.com'), 'proved again');
  env.PG_READ = 'someone-else@example.com';
  env.PG = { connectionString: `postgres://${user}@127.0.0.1:1/postgres` };
  try { await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'ultra', updatedAt: ENT.updatedAt + 33 })); } catch (e) {}
  await settle();
  env.PG = { connectionString: GOOD };
  env.PG_READ = 'in@example.com';
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === 'ultra', 'a write made outside the cohort still fences the proof');
  await settle();

  /* Nov 7 audit DATA-030: reads switched OFF altogether, a write Postgres
     misses, reads switched back on - the old proof must not answer. */
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'ultra', updatedAt: ENT.updatedAt + 35 }));
  await settle();
  for (let i = 0; i < 3 && !proof('pgok:ent:in@example.com'); i++) { await new Promise(r => setTimeout(r, 1100)); await W.DB.get(env, 'ent', 'in@example.com'); await settle(); }
  ok(!!proof('pgok:ent:in@example.com'), 'proved again, once Postgres has the write');
  delete env.PG_READ;
  env.PG = { connectionString: `postgres://${user}@127.0.0.1:1/postgres` };
  try { await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'max', updatedAt: ENT.updatedAt + 36 })); } catch (e) {}
  await settle();
  env.PG = { connectionString: GOOD };
  env.PG_READ = 'in@example.com';
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === 'max', 'a write made while reads were off still fences the proof - switching them on does not revive the old row');
  await settle();

  /* The proof's object cannot be asked: Postgres does not answer. */
  const realNs = env.AMV_COUNTER;
  env.AMV_COUNTER = Object.assign({}, realNs, { get: (id) => { const inner = realNs.get(id); return { fetch: async (u, init) => {
    if (JSON.parse(init.body).op === 'proofGet') throw new Error('object unreachable'); return inner.fetch(u, init); } }; } });
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === JSON.parse(store.get('ent:in@example.com')).plan, 'with the proof unreadable, KV answers');
  env.AMV_COUNTER = realNs;
  await settle();
}

section('A write that cannot be recorded for Postgres does not happen (Nov 3 audit DATA-021/003)');
{
  const realPut = env.AMV_KV.put;
  env.AMV_KV.put = async (k, v, o) => { if (k.startsWith('pgintent:') || k.startsWith('pgrepair:')) throw new Error('store down'); return realPut.call(env.AMV_KV, k, v, o); };
  const before = store.get('ent:in@example.com');
  let threw = false;
  try { await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'elite', updatedAt: ENT.updatedAt + 40 })); } catch (e) { threw = /pg_write_unrecorded/.test(e.message); }
  env.AMV_KV.put = realPut;
  ok(threw && store.get('ent:in@example.com') === before, 'with neither an intent nor a repair entry possible, the write is refused and nothing changes');

  /* Postgres refuses the write and the repair entry cannot be written: the
     intent stays, for the cron to turn into a repair - it is not cleared as
     though Postgres had it. */
  env.PG = { connectionString: `postgres://${user}@127.0.0.1:1/postgres` };
  env.AMV_KV.put = async (k, v, o) => { if (k.startsWith('pgrepair:')) throw new Error('store down'); return realPut.call(env.AMV_KV, k, v, o); };
  for (const k of [...store.keys()]) if (k.startsWith('pgintent:')) store.delete(k);
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'elite', updatedAt: ENT.updatedAt + 41 }));
  env.AMV_KV.put = realPut;
  env.PG = { connectionString: GOOD };
  ok([...store.keys()].some(k => k.startsWith('pgintent:ent:in@example.com')), 'a failed write-through with no repair entry keeps its intent');
  await settle();
}

section('API keys are never answered from Postgres');
{
  store.set('apikeys:in@example.com', JSON.stringify({ items: [{ id: 'k1', hash: 'h1', prefix: 'amv_sk_ab', name: 'mine', created: 1 }] }));
  const k = await W.DB.get(env, 'apikeys', 'in@example.com');
  ok(k.items[0].prefix === 'amv_sk_ab', 'KV answers them, with every field');
}

report();
done();
