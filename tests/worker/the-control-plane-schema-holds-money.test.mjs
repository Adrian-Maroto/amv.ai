/* THE CONTROL-PLANE SCHEMA HOLDS MONEY THE WAY IT SAYS.

   Owner decision 30 (Oct 26): accounts, plans, the credit ledger and API keys
   move to Postgres. migrations/postgres/0001_control_plane.sql makes promises
   in its comments; a comment is a test plan, so this runs the file against a
   real, throwaway Postgres and holds it to each one:
     - the schema applies cleanly, in one transaction;
     - a ledger row cannot be changed or deleted - it is REFUSED, not ignored;
     - a payment provider's event, or a ledger idempotency key, lands once;
     - an email that is not lower-cased is refused at the door;
     - a person is in one team, by constraint;
     - a balance is the sum of the ledger, to the cent, in numeric not float.
   Needs a Postgres server binary (initdb). Without one the suite says so and
   fails, rather than passing having checked nothing. */
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const SQL = join(ROOT, 'migrations', 'postgres', '0001_control_plane.sql');

const BIN = ['/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/local/bin', '/opt/homebrew/bin']
  .find(d => existsSync(join(d, 'initdb')));
ok(!!BIN, 'a Postgres server is available to run the schema against (install postgresql to run this suite)', BIN);
if (!BIN) { report('the-control-plane-schema-holds-money'); process.exitCode = 1; done(); process.exit(1); }

/* Postgres refuses to run as root; the CI runner is not root, this container is. */
const asRoot = process.getuid && process.getuid() === 0;
const dir = mkdtempSync(join('/tmp', 'amv-pg-'));
chmodSync(dir, 0o777);
const PORT = 50000 + Math.floor(Math.random() * 9000);
const sh = (cmd) => asRoot ? execSync(`su postgres -c ${JSON.stringify(cmd)}`, { stdio: 'pipe' }) : execSync(cmd, { stdio: 'pipe' });
const user = asRoot ? 'postgres' : (process.env.USER || 'runner');
let started = false;
try {
  sh(`${BIN}/initdb -D ${dir}/data -A trust -U ${user} >/dev/null`);
  sh(`${BIN}/pg_ctl -D ${dir}/data -o "-k ${dir} -p ${PORT} -c listen_addresses=" -l ${dir}/log -w start >/dev/null`);
  started = true;
} catch (e) { ok(false, 'the throwaway Postgres started', String(e.stderr || e.message).slice(0, 300)); }

const PSQL = existsSync(join(BIN, 'psql')) ? join(BIN, 'psql') : 'psql';
const q = (sql) => {
  try { return { ok: true, out: execFileSync(PSQL, ['-h', dir, '-p', String(PORT), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-c', sql], { stdio: 'pipe' }).toString().trim() }; }
  catch (e) { return { ok: false, err: String(e.stderr || e.message) }; }
};

if (started) {
  section('The schema applies, in one transaction');
  {
    let applied = true, err = '';
    try { execFileSync(PSQL, ['-h', dir, '-p', String(PORT), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', SQL], { stdio: 'pipe' }); }
    catch (e) { applied = false; err = String(e.stderr || e.message); }
    ok(applied, 'migrations/postgres/0001_control_plane.sql applies cleanly', err.slice(0, 400));
    const tables = q("select count(*) from information_schema.tables where table_schema='public'").out;
    ok(+tables >= 12, 'and creates the control-plane tables', tables);
  }

  q("insert into accounts(email,name) values ('ana@example.com','Ana'),('ben@example.com','Ben')");

  section('A ledger row is history: changing it is refused, not ignored');
  {
    ok(q("insert into credit_ledger(email,amount_usd,reason,idempotency_key) values ('ana@example.com',10,'purchase','pi_1')").ok, 'a purchase is written');
    const up = q("update credit_ledger set amount_usd = 1000 where idempotency_key='pi_1'");
    ok(!up.ok && /append-only/.test(up.err), 'an UPDATE is an error, saying why', up.err && up.err.slice(0, 160));
    const del = q("delete from credit_ledger where idempotency_key='pi_1'");
    ok(!del.ok && /append-only/.test(del.err), 'a DELETE is an error too', del.err && del.err.slice(0, 160));
    ok(q("select amount_usd::text from credit_ledger where idempotency_key='pi_1'").out === '10.000000', 'and the row is untouched');
    q("insert into seller_ledger(email,amount_usd,reason,idempotency_key) values ('ben@example.com',5,'sale','sale_1')");
    const sup = q("update seller_ledger set amount_usd = 500 where idempotency_key='sale_1'");
    ok(!sup.ok && /append-only/.test(sup.err), 'a seller sale cannot be rewritten either', sup.err && sup.err.slice(0, 160));
  }

  section('Once means once');
  {
    const again = q("insert into credit_ledger(email,amount_usd,reason,idempotency_key) values ('ana@example.com',10,'purchase','pi_1')");
    ok(!again.ok && /duplicate key/.test(again.err), 'the same purchase delivered twice is refused by the key', again.err && again.err.slice(0, 120));
    ok(q("insert into billing_events(provider,event_id,kind,payload_digest) values ('stripe','evt_1','checkout','d')").ok, 'a webhook event is recorded');
    const dup = q("insert into billing_events(provider,event_id,kind,payload_digest) values ('stripe','evt_1','checkout','d')");
    ok(!dup.ok && /duplicate key/.test(dup.err), 'and its redelivery is refused', dup.err && dup.err.slice(0, 120));
    ok(q("insert into billing_events(provider,event_id,kind,payload_digest) values ('paypal','evt_1','checkout','d')").ok, 'the same id from another provider is a different event');
  }

  section('The door checks what comes in');
  {
    const up = q("insert into accounts(email) values ('Cy@Example.com')");
    ok(!up.ok && /check constraint/.test(up.err), 'an email that is not lower-cased is refused', up.err && up.err.slice(0, 120));
    q("insert into teams(id,name,owner_email) values ('t1','One','ana@example.com'),('t2','Two','ben@example.com')");
    ok(q("insert into team_members(team_id,email,role) values ('t1','ana@example.com','owner')").ok, 'a person joins a team');
    const two = q("insert into team_members(team_id,email,role) values ('t2','ana@example.com','member')");
    ok(!two.ok && /duplicate key/.test(two.err), 'and cannot be in a second one', two.err && two.err.slice(0, 120));
    const role = q("insert into team_members(team_id,email,role) values ('t2','ben@example.com','superuser')");
    ok(!role.ok && /check constraint/.test(role.err), 'a role that does not exist is refused', role.err && role.err.slice(0, 120));
  }

  section('A balance is the ledger, to the cent');
  {
    q("insert into credit_ledger(email,amount_usd,reason,idempotency_key) values ('ana@example.com',-0.1,'spend','r1'),('ana@example.com',-0.2,'spend','r2')");
    const bal = q("select sum(amount_usd)::text from credit_ledger where email='ana@example.com'").out;
    ok(bal === '9.700000', '10 - 0.1 - 0.2 is exactly 9.70 (numeric, not float)', bal);
  }
}

try { if (started) sh(`${BIN}/pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch (e) {}
try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
if (report('the-control-plane-schema-holds-money') > 0) process.exitCode = 1;
done();
