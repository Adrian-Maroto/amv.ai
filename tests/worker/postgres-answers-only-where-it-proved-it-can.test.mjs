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

section('Inside it, the account and the plan come from Postgres, and match KV');
{
  const a = await W.DB.get(env, 'acct', 'in@example.com');
  const kv = JSON.parse(store.get('acct:in@example.com'));
  ok(a && a.email === 'in@example.com' && a.pwHash === kv.pwHash && a.salt === kv.salt && a.pwIter === kv.pwIter && a.sipHash === kv.sipHash && a.createdAt === kv.createdAt,
     'the account, rebuilt from its row, is the KV record field for field', { a, kv });
  const e = await W.DB.get(env, 'ent', 'in@example.com');
  ok(e.plan === 'pro' && e.subId === 'sub_1' && e.renewedAt === ENT.renewedAt && e.updatedAt === ENT.updatedAt && !('blocked' in e) && !('seats' in e),
     'the plan too - and no field the record never had', e);
  await settle();
  ok(!store.has('pgstale:acct:in@example.com') && !store.has('pgstale:ent:in@example.com'), 'the background check found both the same');
  const login = await post('/auth/login', { email: 'in@example.com', password: PW });
  ok(login.status === 200, 'and the person signs in with the record Postgres answered', login.status);
}

section('A write reaches Postgres before the request goes on');
{
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'ultra', updatedAt: ENT.updatedAt + 1 }));
  ok(q("select e.plan from entitlements e join accounts a on a.id=e.account_id where a.email='in@example.com'") === 'ultra', 'the row has it with nothing left in flight');
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === 'ultra', 'and the next read answers it');
  await settle();
}

section('An answer that differs from KV is handed back to KV, and comes back when they agree');
{
  q("update entitlements set plan = 'free' where account_id = (select id from accounts where email='in@example.com')");
  await new Promise(r => setTimeout(r, 0));
  // the instance checked this record a moment ago; a fresh instance would check now
  const fresh = await import(harness + '?t=' + Date.now() + 'b');
  const first = await fresh.DB.get(env, 'ent', 'in@example.com');
  await fresh._pgSettle();
  ok(first.plan === 'free', 'the read Postgres answered is what Postgres holds (this is the one the check exists for)');
  ok(store.has('pgstale:ent:in@example.com'), 'the check marks the record stale');
  ok(alerts.some(a => /answered an ent read differently/.test(a)), 'and the owner is told', alerts);
  ok((await fresh.DB.get(env, 'ent', 'in@example.com')).plan === 'ultra', 'from then on KV answers - the paid plan, not the wrong row');
  q("update entitlements set plan = 'ultra' where account_id = (select id from accounts where email='in@example.com')");
  const again = await import(harness + '?t=' + Date.now() + 'c');
  await again.DB.get(env, 'ent', 'in@example.com');
  await again._pgSettle();
  ok(!store.has('pgstale:ent:in@example.com'), 'once both copies agree, the mark is lifted and Postgres answers again');
}

section('Postgres down: KV answers, sign-in works, and it is counted');
{
  env.PG = { connectionString: `postgres://${user}@127.0.0.1:1/postgres` };
  const before = audits.filter(a => a.event === 'pg_read_fell_back' || a.type === 'pg_read_fell_back').length;
  const login = await post('/auth/login', { email: 'in@example.com', password: PW });
  ok(login.status === 200, 'the person still signs in', login.status);
  ok(audits.filter(a => JSON.stringify(a).includes('pg_read_fell_back')).length > before, 'and the fallback is on the record');
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === 'ultra', 'their plan is still right');
}

section('A write that cannot reach Postgres is marked stale before it returns');
{
  await W.DB.put(env, 'ent', 'in@example.com', Object.assign({}, ENT, { plan: 'elite', updatedAt: ENT.updatedAt + 2 }));
  ok(store.has('pgstale:ent:in@example.com') && store.has('pgrepair:ent:in@example.com'), 'stale and on the repair list the moment the put returns');
  env.PG = { connectionString: GOOD };
  ok((await W.DB.get(env, 'ent', 'in@example.com')).plan === 'elite', 'so with Postgres back, the next read is KV’s new plan, never the old row');
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
