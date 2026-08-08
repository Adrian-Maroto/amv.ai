/* THE BACKUP HAS NEVER BEEN PROVEN TO DO THE THING IT EXISTS FOR.

   Export and import are both tested, carefully, on their shapes: prefixes are
   allowlisted, oversized values rejected, key counts bounded, a tampered
   snapshot cannot write a control key. All true, and none of it answers the
   only question a backup is for.

   That question is: after the worst day, can a real customer sign in and find
   their plan, their purchases and their money exactly as they left them.

   A backup you have never restored is a hypothesis. The failure mode is
   specific and quiet - one prefix missing from a list, and everything restores
   cleanly except the ability to authenticate, or except the wallet, and you
   find out on the day you cannot afford to. Nothing in the shape tests would
   notice, because every one of them would still pass.

   So this does the whole thing through the real router: build a deployment
   with real accounts, take a snapshot, DESTROY it, import, and then use the
   product as those customers. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'restore.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, BACKUP_PREFIXES };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const PW = 'A-real-Passw0rd!';
const ADMIN = 'admin-token-secret';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

/* One deployment's storage. Kept as a plain Map so a case can look at it, wipe
   it, and count what survived. */
function makeStore() {
  const m = new Map();
  return {
    _map: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix, cursor, limit } = {}) {
      const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
      return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
    },
  };
}
let store = makeStore();
const env = {
  get AMV_KV() { return store; },
  JWT_SECRET: 'test-jwt-secret', ADMIN_TOKEN: ADMIN, APP_URL: 'https://amv.test',
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

const call = (path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '30.30.30.30' }, headers || {}),
  body: body === undefined ? undefined : JSON.stringify(body),
}), env, ctx);

const admin = (path, body) => call(path, body || {}, { 'Authorization': 'Bearer ' + ADMIN });
const signup = async (email) => (await (await call('/auth/signup', { email, name: email.split('@')[0], password: PW })).json()).token;
const login = async (email) => {
  const r = await call('/auth/login', { email, password: PW, provider: 'email' });
  return { status: r.status, d: await r.json().catch(() => ({})) };
};

let snapshot = null;

section('A deployment with real customers in it');
{
  await signup(ALICE);
  await signup(BOB);
  /* Everything a customer would be upset to lose, written the way the product
     writes it. */
  await W.DB.put(env, 'ent', ALICE, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  await W.DB.put(env, 'ent', BOB, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  await W.DB.put(env, 'data', ALICE, { chats: [{ id: 'c1', title: 'Quarterly plan', msgs: [{ role: 'user', c: 'help me plan' }] }] });
  await W.DB.put(env, 'wallet', BOB, { balance: 84.5, lifetime: 120 });
  await W.DB.put(env, 'purchases', ALICE, [{ id: 'item1', title: 'A crew she paid for' }]);
  await W.DB.put(env, 'auto', ALICE, { list: [{ id: 'a1', name: 'Monday digest' }] });
  await env.AMV_KV.put('entitleitem:' + ALICE + ':item1', '1');

  const a = await login(ALICE);
  ok(a.status === 200, 'Alice can sign in', a.status);
  ok(store._map.size > 5, 'and there is a deployment to lose', store._map.size);
}

section('A snapshot is taken');
{
  const r = await admin('/admin/backup/export');
  ok(r.status === 200, 'the export is served to the operator', r.status);
  snapshot = await r.json();
  ok(snapshot._amv_backup === 1, 'it is a backup snapshot', snapshot._amv_backup);
  ok(Object.keys(snapshot.data).length > 5, 'with the deployment in it', Object.keys(snapshot.data).length);

  /* The one thing without which every other assertion below is moot: the
     ACCOUNT records. A snapshot that restores chats and wallets but not the
     ability to authenticate has restored a museum. */
  ok(Object.keys(snapshot.data).some(k => k === 'acct:' + ALICE),
     'including the account records themselves', true);
}

section('And nobody but the operator can take one');
{
  /* This file downloads every account, every chat and every balance in one
     request. It is the single most valuable object the system can produce. */
  const anon = await call('/admin/backup/export');
  ok(anon.status === 401, 'without the admin token it is refused', anon.status);
  const wrong = await call('/admin/backup/export', undefined, { 'Authorization': 'Bearer nope' });
  ok(wrong.status === 401, 'and a wrong one is refused', wrong.status);
}

section('THE WORST DAY: the deployment is destroyed');
{
  store = makeStore();
  ok(store._map.size === 0, 'there is nothing left at all', store._map.size);
  const gone = await login(ALICE);
  ok(gone.status >= 400, 'and Alice cannot sign in, because she does not exist', gone.status);
}

section('The snapshot is imported');
{
  const r = await admin('/admin/backup/import', { snapshot, mode: 'merge' });
  const d = await r.json();
  ok(r.status === 200, 'the import runs', r.status);
  ok(d.restored > 5, 'and writes the deployment back', d.restored);
  ok(!d.rejected, 'rejecting nothing from a snapshot it produced itself', d.rejected);
}

section('And the customers are back - not the data, the CUSTOMERS');
{
  /* The assertion the shape tests cannot make. Signing in exercises the
     account record, the password hash, the token epoch and the signing key
     together; any one of them missing from the backup and this fails while
     every other check still passes. */
  const a = await login(ALICE);
  ok(a.status === 200 && !!a.d.token, 'Alice signs in with her own password', a.status);
  const b = await login(BOB);
  ok(b.status === 200, 'and so does Bob', b.status);
}

section('With the plan they are paying for');
{
  const a = await login(ALICE);
  const r = await call('/v1/entitlement?email=' + encodeURIComponent(ALICE), undefined,
    { 'Authorization': 'Bearer ' + a.d.token });
  const d = await r.json();
  ok((d.entitlement || {}).plan === 'ultra',
     'Alice is still on the plan she bought', (d.entitlement || {}).plan);
  const bEnt = (await W.DB.get(env, 'ent', BOB)) || {};
  ok(bEnt.plan === 'pro', 'and Bob on his', bEnt.plan);
  ok(typeof bEnt.renewedAt === 'number',
     'with the renewal stamp intact, so the sweep does not read them as lapsed', bEnt.renewedAt);
}

section('And everything they would be upset to lose');
{
  const chats = await W.DB.get(env, 'data', ALICE);
  ok(/Quarterly plan/.test(JSON.stringify(chats)), 'her conversations', true);
  const purchases = await W.DB.get(env, 'purchases', ALICE);
  ok(/A crew she paid for/.test(JSON.stringify(purchases)), 'what she bought', true);
  ok(await env.AMV_KV.get('entitleitem:' + ALICE + ':item1'),
     'and her right to use it, which is a different record', true);
  const autos = await W.DB.get(env, 'auto', ALICE);
  ok(/Monday digest/.test(JSON.stringify(autos)), 'her automations', true);

  /* Read defensively: when a prefix is missing from the backup list this
     record is ABSENT, and reading .balance off undefined throws - which
     crashes the file instead of failing the assertion, so the sabotage that
     proves this case produces no output at all. A test that explodes says
     less than one that fails. */
  const wallet = (await W.DB.get(env, 'wallet', BOB)) || {};
  ok(wallet.balance === 84.5,
     'and Bob’s money, to the penny, because that is somebody’s livelihood', wallet.balance);
}

section('A tampered snapshot cannot switch the product off');
{
  /* An import writes whatever it is given. The keys that are NOT customer data
     are the dangerous ones: GLOBAL_KILL stops the entire platform, and a
     rogue admin token would hand somebody everything above. */
  const evil = { _amv_backup: 1, createdISO: new Date().toISOString(), data: {
    'GLOBAL_KILL': '1',
    'ADMIN_TOKEN': 'attacker-token',
    'apikey:deadbeef': JSON.stringify({ email: ALICE, id: 'x' }),
    /* One legitimate key alongside them, so this also proves the import did
       not simply refuse the whole file - the dangerous keys are dropped
       individually while the real ones apply. */
    'data:carol@example.com': JSON.stringify({ chats: [{ id: 'c9', title: 'from the snapshot' }] }),
  } };
  const r = await admin('/admin/backup/import', { snapshot: evil, mode: 'merge' });
  const d = await r.json();
  ok(r.status === 200, 'the import completes', r.status);
  ok(d.rejected >= 2, 'having refused the keys outside the backup prefixes', d);
  ok(await env.AMV_KV.get('GLOBAL_KILL') === null,
     'the platform is not switched off by a snapshot', await env.AMV_KV.get('GLOBAL_KILL'));
  ok(await env.AMV_KV.get('ADMIN_TOKEN') === null, 'and no admin token is planted', true);
  ok(await env.AMV_KV.get('apikey:deadbeef') === null,
     'nor a credential that would authenticate as somebody', true);

  const carol = await W.DB.get(env, 'data', 'carol@example.com');
  ok(/from the snapshot/.test(JSON.stringify(carol)),
     'while the legitimate key in the same file still applied', true);

  const still = await login(ALICE);
  ok(still.status === 200, 'and Alice is untouched by any of it', still.status);
}

section('An import DOES overwrite live records, which is what a restore is');
{
  /* Worth stating rather than discovering. An import writes what it is given
     over what is there - that is the whole point of "merge" - so a snapshot
     that contains an ACCOUNT record replaces the live one, password hash and
     all. There is nothing wrong with that and it is not a hole: the route is
     admin-only and restoring is destructive by nature.

     It is written down because the first version of the case above put an
     account record in a hostile snapshot and then asserted that person could
     still sign in. They could not, correctly, and it read like a bug in the
     product for ten minutes. An operator restoring a partial snapshot needs
     to know this is what "merge" means, and that "missing" is the mode for
     not doing it. */
  const before = await login(ALICE);
  ok(before.status === 200, 'Alice can sign in now', before.status);

  const partial = { _amv_backup: 1, createdISO: new Date().toISOString(), data: {
    ['acct:' + ALICE]: JSON.stringify({ email: ALICE, name: 'no password in here' }),
  } };
  await admin('/admin/backup/import', { snapshot: partial, mode: 'merge' });
  const after = await login(ALICE);
  ok(after.status >= 400,
     'and after merging a snapshot whose account record lacks her password, she cannot', after.status);

  /* Put her back, so the cases below run against a real deployment. */
  await admin('/admin/backup/import', { snapshot, mode: 'merge' });
  const restored = await login(ALICE);
  ok(restored.status === 200, 'restoring the full snapshot brings her back', restored.status);
}

section('Importing twice does not double anything');
{
  /* A restore gets run twice - by two people, or by somebody who was not sure
     the first one worked. It has to be safe. */
  const before = JSON.stringify([...store._map.entries()].sort());
  await admin('/admin/backup/import', { snapshot, mode: 'merge' });
  const after = JSON.stringify([...store._map.entries()].sort());
  ok(before === after, 'the second run changes nothing', before === after);
  const wallet = (await W.DB.get(env, 'wallet', BOB)) || {};
  ok(wallet.balance === 84.5, 'and Bob’s balance is not doubled', wallet.balance);
}

section('"missing" mode does not overwrite what is already live');
{
  /* The mode for recovering PART of a deployment. Getting it backwards
     overwrites live data with an old snapshot, which is a second disaster on
     top of the one being recovered from. */
  await W.DB.put(env, 'wallet', BOB, { balance: 999, lifetime: 999 });
  await admin('/admin/backup/import', { snapshot, mode: 'missing' });
  const wallet = (await W.DB.get(env, 'wallet', BOB)) || {};
  ok(wallet.balance === 999,
     'the newer live record is left alone', wallet.balance);
}

globalThis.fetch = realFetch;
if (report('a-restore-brings-it-back') > 0) process.exitCode = 1;
done();
