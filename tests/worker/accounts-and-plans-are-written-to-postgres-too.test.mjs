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
import { createServer, connect } from 'net';
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
execFileSync(PSQL, ['-h', '127.0.0.1', '-p', String(PORT), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', SCHEMA.replace('0001_control_plane', '0002_money_constraints')], { stdio: 'pipe' });

mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'pgdual.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _pgSettle, _pgMirror, _creditGrant, _creditReverse, meterStream, ENGINES, CREDIT_MARKUP, _pushWalletTx, runPgIntentSweep, _pgLedger };\n');
const W = await import(harness + '?t=' + Date.now());

const quiet = console.log; const audits = [];
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('AUDIT')) { try { audits.push(JSON.parse(s.slice(6))); } catch (e) {} return; } quiet(...a); };
const store = new Map(); const counters = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  PG: { connectionString: `postgres://${user}@127.0.0.1:${PORT}/postgres` },
  /* The counter object, standing in: claims taken once, sums kept. */
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

section('Two isolates’ mirrors of one record, landing in reverse order, leave the newer (Nov 8 audit DATA-040)');
{
  /* Revision 2 (plan ultra) lands first; revision 1 (plan pro), written
     earlier in another isolate, finishes after it. */
  const base = JSON.parse(store.get('ent:ana@example.com'));
  await W._pgMirror(env, 'ent', 'ana@example.com', Object.assign({}, base, { plan: 'team' }), null, 1000002);
  await W._pgMirror(env, 'ent', 'ana@example.com', Object.assign({}, base, { plan: 'pro' }), null, 1000001);
  ok(q("select max(e.plan) from entitlements e join accounts a on a.id=e.account_id where a.email='ana@example.com'") === 'team', 'the older mirror finishing last changes nothing', q("select plan from entitlements"));
  ok(q("select rev from mirror_revisions where kind='ent' and record_id='ana@example.com'") === '1000002', 'and the newest revision is the one kept');
  await W._pgMirror(env, 'ent', 'ana@example.com', Object.assign({}, base, { plan: 'ultra' }), null, 1000003);
  ok(q("select max(e.plan) from entitlements e join accounts a on a.id=e.account_id where a.email='ana@example.com'") === 'ultra', 'a newer one still lands');
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

section('Writes to one record reach Postgres in the order they were made');
{
  /* Four versions of one account's key list, each a key longer, written
     back to back without waiting for the mirror - the order two quick key
     creations produce. The last one written is the one Postgres must hold. */
  const acctId = q("select id from accounts where email='ana@example.com'");
  const base = JSON.parse(store.get('apikeys:ana@example.com')).items;
  /* The database's first connection is slow - what CI's busy machine did -
     so the mirror of the FIRST write starts after the later ones finished. */
  let first = true;
  const proxy = createServer((c) => {
    const slow = first; first = false;
    setTimeout(() => { const up = connect(PORT, '127.0.0.1'); c.pipe(up); up.pipe(c); up.on('error', () => c.destroy()); c.on('error', () => up.destroy()); }, slow ? 600 : 0);
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const realPg = env.PG;
  env.PG = { connectionString: realPg.connectionString.replace(':' + PORT + '/', ':' + proxy.address().port + '/') };
  const items = [];
  for (let i = 0; i < 4; i++) {
    items.push({ id: 'ord' + i, hash: 'h_ord_' + i, name: 'Order ' + i, created: Date.now() });
    await W.DB.put(env, 'apikeys', 'ana@example.com', { items: base.concat(items) });
  }
  await W._pgSettle();
  env.PG = realPg; proxy.close();
  const n = q(`select count(*) from api_keys where account_id='${acctId}' and id like 'ord%'`);
  ok(n === '4', 'all four keys are there - the oldest copy, finishing last, did not take the newer ones out', n);
  await W.DB.put(env, 'apikeys', 'ana@example.com', { items: base });
  await W._pgSettle();
}

section('A team is an organization with one membership per member; one with no account yet sends it for repair');
{
  await post('/auth/signup', { email: 'dee@example.com', name: 'Dee', password: PW });
  await W._pgSettle();
  const team = { id: 'team_abc123', name: 'Acme', ownerEmail: 'ana@example.com', createdAt: Date.now(), data: {}, planCache: 'team',
    members: [{ email: 'ana@example.com', role: 'owner', joinedAt: Date.now() }, { email: 'dee@example.com', role: 'viewer', joinedAt: Date.now() },
              { email: 'nobody-yet@example.com', role: 'member', joinedAt: Date.now() }] };
  await W.DB.put(env, 'team', team.id, team);
  await W._pgSettle();
  const org = q("select name, kind, extra->>'planCache' from organizations where legacy_id='team_abc123'").split('|');
  ok(org[0] === 'Acme' && org[1] === 'company' && org[2] === 'team', 'the team is an organization, its own fields kept', org);
  const mem = q("select a.email||':'||m.role from memberships m join accounts a on a.id=m.account_id join organizations o on o.id=m.org_id where o.legacy_id='team_abc123' order by a.email").split('\n');
  ok(mem.join() === 'ana@example.com:owner,dee@example.com:viewer', 'each member with an account has a membership, with their role', mem);
  ok(store.has('pgrepair:team:team_abc123'), 'the member with no account row yet sends the team for repair, rather than being dropped');
  team.members = team.members.filter(m => m.email !== 'dee@example.com' && m.email !== 'nobody-yet@example.com');
  await W.DB.put(env, 'team', team.id, team);
  await W._pgSettle();
  ok(q("select count(*) from memberships m join organizations o on o.id=m.org_id where o.legacy_id='team_abc123'") === '1', 'a member who left is gone from it');
  await W.DB.del(env, 'team', team.id);
  await W._pgSettle();
  ok(q("select count(*) from organizations where legacy_id='team_abc123'") === '0' && q("select count(*) from memberships m join accounts a on a.id=m.account_id where a.email='ana@example.com'") === '0',
     'a deleted team is gone, memberships and all');
}

section('Money is one row per event: a pack bought once is one row however often it is reported; each refund is its own row');
{
  const ref = 'pi_pack_1';
  ok(await W._creditGrant(env, { subject: 'ana@example.com', email: 'ana@example.com', usd: 20, ref }), 'a pack is credited');
  await W._creditGrant(env, { subject: 'ana@example.com', email: 'ana@example.com', usd: 20, ref });
  await W._pgSettle();
  ok(q("select count(*)||':'||sum(amount)::text||':'||max(reason) from credit_ledger where idempotency_key='credit:pi_pack_1'") === '1:20.000000:purchase',
     'one purchase row for 20, however many times the payment is reported');
  await W._creditReverse(env, ref, 'refund', 5);
  await W._creditReverse(env, ref, 'refund', 5);
  await W._creditReverse(env, ref, 'dispute', 0);
  await W._pgSettle();
  /* Written in the background, so in any order: compared as a set. */
  const rows = q("select reason||':'||amount::text from credit_ledger where account_id=(select id from accounts where email='ana@example.com') order by reason").split('\n');
  ok(rows.join() === 'dispute:-15.000000,purchase:20.000000,refund:-5.000000', 'a partial refund, the same refund again (nothing), then a dispute for the rest', rows);
  ok(q("select sum(amount)::text from credit_ledger where account_id=(select id from accounts where email='ana@example.com')") === '0.000000',
     'and the ledger adds up to what is left: nothing');
  const upd = (() => { try { q("update credit_ledger set amount=999 where idempotency_key='credit:pi_pack_1'"); return 'changed'; } catch (e) { return String(e.stderr || e.message); } })();
  ok(/append-only/.test(upd), 'and a row, once written, cannot be changed', upd.slice(0, 80));
}

section('The same key with different money is a conflict, not a duplicate (Nov 7 audit DATA-034)');
{
  await W._pgLedger(env, { email: 'ana@example.com', currency: 'USD', amount: 20, reason: 'purchase', key: 'credit:pi_pack_1', source: 'stripe:pi_pack_1' });
  /* Nov 8 audit DATA-032: by the time the caller goes on, the exact row is
     already kept - an isolate that ends now leaves it on the repair list. */
  { const held = JSON.parse(store.get('pgrepair:ledger:credit:pi_pack_1') || 'null');
    ok(held && held.why === 'pending' && held.row && held.row.amount === 20, 'the row is written down before it is sent', held); }
  await W._pgSettle();
  ok(!store.has('pgrepair:ledger:credit:pi_pack_1'), 'the same event again is the same row - nothing to repair');
  await W._pgLedger(env, { email: 'ana@example.com', currency: 'USD', amount: 2000, reason: 'purchase', key: 'credit:pi_pack_1', source: 'stripe:pi_pack_1' });
  await W._pgSettle();
  const rep = JSON.parse(store.get('pgrepair:ledger:credit:pi_pack_1') || 'null');
  ok(rep && /ledger_key_conflict/.test(rep.why), 'a different amount under that key is refused and kept for repair, said as a conflict', rep && rep.why);
  ok(q("select count(*)||':'||sum(amount)::text from credit_ledger where idempotency_key='credit:pi_pack_1'") === '1:20.000000', 'and the row that was there is untouched');
  store.delete('pgrepair:ledger:credit:pi_pack_1');
}

section('Credit spent is a row per message, at what it cost; a request id sent twice is two spends, not one');
{
  const sse = (inTok, outTok) => new Response([
    'event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: inTok, output_tokens: 0 } } }) + '\n\n',
    'event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: outTok } }) + '\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'].join('')).body;
  const run = () => W.meterStream(sse(1000, 1000), W.ENGINES['amv-core'], { dName: 'd:ana', mName: 'm:ana', gName: 'g:day', costName: 'cost:ana',
    user: { email: 'ana@example.com', plan: 'pro' }, env, limits: { daily: 1e9, monthly: 1e9 }, reqMessages: [],
    creditName: 'creditspent:ana@example.com', reservedCreditUSD: 0, reqId: 'same-id-123' });
  await run(); await run();
  await W._pgSettle();
  const want = (-(1000 / 1e6 * 2 + 1000 / 1e6 * 10) * W.CREDIT_MARKUP).toFixed(6);
  const rows = q("select amount::text||'|'||note from credit_ledger where reason='spend'").split('\n');
  ok(rows.length === 2 && rows.every(r => r.startsWith(want + '|')), 'two messages, two rows, each what it cost at the markup', { rows, want });
  ok(rows.every(r => /subject:ana@example\.com/.test(r) && /req:same-id-123/.test(r)), 'each says whose credit paid, and which request');
}

section('A seller’s money is a row per line that moved it; the same sale reported twice is one row, a payout marked paid is none');
{
  const day = 86400e3, sold = Date.UTC(2026, 9, 1);
  const sale = { type: 'sale', amount: 7, gross: 10, item: 'itm_1', title: 'Deck', buyer: 'b@example.com', ref: 'pi_sale_1', ts: sold, holdUntil: sold + 14 * day };
  ok(await W._pushWalletTx(env, 'ana@example.com', sale), 'a sale is a new line');
  ok(!(await W._pushWalletTx(env, 'ana@example.com', Object.assign({}, sale))), 'the same sale again is not');
  await W._pushWalletTx(env, 'ana@example.com', { type: 'sale_reversed', amount: -7, item: 'itm_1', buyer: 'b@example.com', reason: 'refund', ref: 'pi_sale_1', ts: sold + day });
  await W._pushWalletTx(env, 'ana@example.com', { type: 'withdrawal', amount: -3, status: 'pending', id: 'wd_1', ts: sold + 2 * day });
  await W._pushWalletTx(env, 'ana@example.com', { type: 'withdrawal_paid', amount: 0, status: 'paid', id: 'wd_1', ts: sold + 3 * day });
  await W._pushWalletTx(env, 'ana@example.com', { type: 'withdrawal', amount: -2, status: 'pending', id: 'wd_2', ts: sold + 2 * day });
  await W._pushWalletTx(env, 'ana@example.com', { type: 'withdrawal_returned', amount: 2, status: 'rejected', id: 'wd_2', ts: sold + 4 * day });
  await W._pgSettle();
  const rows = q("select idempotency_key||'|'||reason||'|'||amount::text from seller_ledger order by idempotency_key").split('\n');
  ok(rows.join() === [
    'seller:sale:pi_sale_1:itm_1|sale|7.000000',
    'seller:sale_reversed:pi_sale_1:itm_1|reversal|-7.000000',
    'seller:withdrawal:wd_1|payout|-3.000000',
    'seller:withdrawal:wd_2|payout|-2.000000',
    'seller:withdrawal_returned:wd_2|correction|2.000000'].join(), 'a sale, its reversal, two payouts and one returned - and nothing for the one marked paid', rows);
  ok(q("select to_char(hold_until at time zone 'UTC','YYYY-MM-DD')||'|'||to_char(at at time zone 'UTC','YYYY-MM-DD') from seller_ledger where reason='sale'") === '2026-10-15|2026-10-01',
     'the sale keeps when it happened and when it can be withdrawn');
  ok(q("select sum(amount)::text from seller_ledger") === '-3.000000', 'and the rows add up to what left: the one payout that went');
  const del = (() => { try { q("delete from seller_ledger"); return 'deleted'; } catch (e) { return String(e.stderr || e.message); } })();
  ok(/append-only/.test(del), 'and none of it can be deleted', del.slice(0, 80));
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

section('A mirror write ends in Postgres or on the repair list, never nowhere (Nov 1 audit DATA-007)');
{
  await W._pgSettle();
  ok(![...store.keys()].some(k => k.startsWith('pgintent:')), 'every write mirrored so far left no intent behind');
  /* The intent is on record before the record itself is written. */
  await W.DB.put(env, 'acct', 'ivy@example.com', { name: 'Ivy', provider: 'email', createdAt: Date.now() });
  await W._pgSettle();
  const order = []; const realPut = env.AMV_KV.put;
  env.AMV_KV.put = async (k, v, o) => { order.push(k.split(':')[0]); return realPut.call(env.AMV_KV, k, v, o); };
  await W.DB.put(env, 'team', 'team_intent', { id: 'team_intent', name: 'Order', ownerEmail: 'ivy@example.com', members: [{ email: 'ivy@example.com', role: 'owner' }] });
  env.AMV_KV.put = realPut;
  ok(order.indexOf('pgintent') >= 0 && order.indexOf('pgintent') < order.indexOf('team'), 'the intent is written before the record', order);
  await W._pgSettle();
  ok(![...store.keys()].some(k => k.startsWith('pgintent:')) && !store.has('pgrepair:team:team_intent') && q("select count(*) from organizations where legacy_id='team_intent'") === '1', 'and cleared once Postgres has the row', [...store.keys()].filter(k => /^pg(intent|repair)/.test(k)));
  /* The background died: its intent is still there after five minutes. */
  store.set('pgintent:team:team_lost:abc123', JSON.stringify({ at: Date.now() - 6 * 60 * 1000 }));
  store.set('pgintent:team:team_busy:def456', JSON.stringify({ at: Date.now() }));
  const sw = await W.runPgIntentSweep(env);
  ok(sw.moved === 1 && store.has('pgrepair:team:team_lost') && !store.has('pgintent:team:team_lost:abc123'),
     'an intent the background never finished becomes a repair entry', sw);
  ok(store.has('pgintent:team:team_busy:def456') && !store.has('pgrepair:team:team_busy'), 'one still within its time is left alone', [...store.keys()].filter(k => /^pg(intent|repair):team/.test(k)));
  store.delete('pgintent:team:team_busy:def456'); store.delete('pgrepair:team:team_lost');
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
