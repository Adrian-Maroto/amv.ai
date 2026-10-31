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
  const ANA = q("select id from accounts where email='ana@example.com'").out;
  const BEN = q("select id from accounts where email='ben@example.com'").out;
  const L = (who, cur, amt, reason, key) => q(`insert into credit_ledger(account_id,currency,amount,reason,idempotency_key) values ('${who}','${cur}',${amt},'${reason}','${key}')`);

  section('A ledger row is history: changing it is refused, not ignored');
  {
    ok(L(ANA, 'USD', 10, 'purchase', 'pi_1').ok, 'a purchase is written');
    const up = q("update credit_ledger set amount = 1000 where idempotency_key='pi_1'");
    ok(!up.ok && /append-only/.test(up.err), 'an UPDATE is an error, saying why', up.err && up.err.slice(0, 160));
    const del = q("delete from credit_ledger where idempotency_key='pi_1'");
    ok(!del.ok && /append-only/.test(del.err), 'a DELETE is an error too', del.err && del.err.slice(0, 160));
    ok(q("select amount::text from credit_ledger where idempotency_key='pi_1'").out === '10.000000', 'and the row is untouched');
    q(`insert into seller_ledger(account_id,currency,amount,reason,idempotency_key) values ('${BEN}','USD',5,'sale','sale_1')`);
    const sup = q("update seller_ledger set amount = 500 where idempotency_key='sale_1'");
    ok(!sup.ok && /append-only/.test(sup.err), 'a seller sale cannot be rewritten either', sup.err && sup.err.slice(0, 160));
  }

  section('Once means once');
  {
    const again = L(ANA, 'USD', 10, 'purchase', 'pi_1');
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
    const cur = L(ANA, 'usd', 1, 'grant', 'g_lower');
    ok(!cur.ok && /currency_code|check/.test(cur.err), 'a currency that is not an ISO code is refused', cur.err && cur.err.slice(0, 120));
    const why = L(ANA, 'USD', 1, 'because', 'g_bad');
    ok(!why.ok && /check constraint/.test(why.err), 'and so is a ledger reason nobody defined', why.err && why.err.slice(0, 120));
  }

  section('One person, many organizations - a consultant is in three');
  {
    const org = (name, kind, by) => q(`insert into organizations(name,kind,created_by) values ('${name}','${kind}','${by}') returning id`).out;
    const anaHome = org('Ana', 'personal', ANA), acme = org('Acme', 'company', BEN), client = org('Client Co', 'company', BEN);
    const join = (o, who, role) => q(`insert into memberships(org_id,account_id,role) values ('${o}','${who}','${role}')`);
    ok(join(anaHome, ANA, 'owner').ok && join(acme, ANA, 'member').ok && join(client, ANA, 'viewer').ok,
       'Ana is the owner of her own, a member at Acme and a viewer at a client - all at once');
    ok(q(`select count(*) from memberships where account_id='${ANA}'`).out === '3', 'three memberships, one person');
    const twice = join(acme, ANA, 'admin');
    ok(!twice.ok && /duplicate key/.test(twice.err), 'but only one role in each organization', twice.err && twice.err.slice(0, 120));
    const bad = join(acme, BEN, 'superuser');
    ok(!bad.ok && /check constraint/.test(bad.err), 'a role that does not exist is refused', bad.err && bad.err.slice(0, 120));
    const second = org('Ana again', 'personal', ANA);
    ok(!second, 'and nobody has two personal organizations', second);
    const ws = q(`insert into workspaces(org_id,name) values ('${acme}','Launch') returning id`).out;
    ok(!!ws && q(`insert into workspace_members(workspace_id,account_id,role) values ('${ws}','${ANA}','viewer')`).ok,
       'an organization has workspaces, and a member can be narrowed inside one');
  }

  section('An email changes; the person, their money and their keys do not');
  {
    q(`insert into api_keys(id,account_id,key_hash) values ('k_1','${ANA}','h1')`);
    ok(q("update accounts set email='ana@new.example' where email='ana@example.com'").ok, 'the address is changed');
    ok(q(`select count(*) from credit_ledger where account_id='${ANA}'`).out === '1' && q(`select count(*) from api_keys where account_id='${ANA}'`).out === '1',
       'and her ledger rows and API key are still hers - they point at the id, not the address');
  }

  section('Payments are kept by the provider\'s own ids');
  {
    ok(q(`insert into billing_customers(provider,provider_customer_id,account_id) values ('stripe','cus_1','${ANA}')`).ok, 'a Stripe customer belongs to an account');
    const both = q(`insert into billing_customers(provider,provider_customer_id,account_id,org_id) values ('stripe','cus_2','${ANA}',(select id from organizations where name='Acme'))`);
    ok(!both.ok && /check constraint/.test(both.err), 'to an account or an organization, never both', both.err && both.err.slice(0, 120));
    ok(q("insert into subscriptions(provider,provider_subscription_id,provider_customer_id,plan,status,currency,amount,interval) values ('stripe','sub_1','cus_1','pro','active','EUR',18,'month')").ok,
       'a subscription in euros');
    const orphan = q("insert into subscriptions(provider,provider_subscription_id,provider_customer_id,plan,status,currency,amount,interval) values ('stripe','sub_2','cus_nobody','pro','active','USD',20,'month')");
    ok(!orphan.ok && /foreign key/.test(orphan.err), 'and a subscription for a customer AMV does not know is refused', orphan.err && orphan.err.slice(0, 120));
  }

  section('A balance is the ledger, to the cent, per currency');
  {
    L(ANA, 'USD', -0.1, 'spend', 'r1'); L(ANA, 'USD', -0.2, 'spend', 'r2'); L(ANA, 'EUR', 5, 'purchase', 'pi_eur');
    const usd = q(`select sum(amount)::text from credit_ledger where account_id='${ANA}' and currency='USD'`).out;
    ok(usd === '9.700000', '10 - 0.1 - 0.2 dollars is exactly 9.70 (numeric, not float)', usd);
    const eur = q(`select sum(amount)::text from credit_ledger where account_id='${ANA}' and currency='EUR'`).out;
    ok(eur === '5.000000', 'and the euros are their own balance, never added to the dollars', eur);
  }
}

try { if (started) sh(`${BIN}/pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch (e) {}
try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
if (report('the-control-plane-schema-holds-money') > 0) process.exitCode = 1;
done();
