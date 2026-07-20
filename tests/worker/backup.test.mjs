/* DATA SAFETY — backup & restore.
   Customer accounts, subscriptions, chats, and automations live in KV. These
   tests prove the snapshot captures the durable data (and skips ephemeral
   counters), that a restore is ADDITIVE and never deletes, that a total wipe can
   be recovered, that a tampered snapshot can't write control keys, and that it's
   admin-only. This is the insurance — it has to actually work. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'backup.harness.mjs');
writeFileSync(harness, src + '\nexport { backupExport, backupImport, BACKUP_PREFIXES };\n');
const W = await import(harness + '?t=' + Date.now());

// a KV store we can inspect and wipe
let store = new Map();
const env = {
  ADMIN_TOKEN: 'admin-secret',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix, cursor, limit }) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
      return { keys, list_complete: true };
    }
  }
};

const adminReq = (body) => new Request('https://api.amv.dev/admin/backup/export', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret' },
  body: JSON.stringify(body || {})
});

/* ── Seed realistic durable data + some ephemeral junk ───────────────────── */
function seed() {
  store = new Map();
  // durable — must survive
  store.set('acct:alice@test.com', JSON.stringify({ email: 'alice@test.com', name: 'Alice' }));
  store.set('acct:bob@test.com', JSON.stringify({ email: 'bob@test.com', name: 'Bob' }));
  store.set('ent:alice@test.com', JSON.stringify({ plan: 'pro' }));
  store.set('auto:alice@test.com', JSON.stringify({ items: [{ id: 'a1', detail: 'watch BTC' }] }));
  store.set('data:alice@test.com', JSON.stringify({ chats: ['hello'] }));
  store.set('wallet:alice@test.com', JSON.stringify({ credits: 500 }));
  // ephemeral — should NOT be in the backup
  store.set('spend:2026-07-16', '42');
  store.set('active:alice@test.com:2026-07-16', '1');
  store.set('authfail:bob@test.com:1.2.3.4', '3');
  store.set('GLOBAL_KILL', '1');
}

/* ── Export captures durable data, skips ephemeral ───────────────────────── */
section('Export snapshots the durable data and skips ephemeral keys');

seed();
let r = await W.backupExport(adminReq(), env);
ok(r.status === 200, 'export returns 200 for an admin', r.status);
const snap = await r.json();
ok(snap._amv_backup === 1, 'the file is a tagged AMV backup');
ok(snap.data['acct:alice@test.com'], 'accounts are captured');
ok(snap.data['ent:alice@test.com'], 'entitlements (subscriptions) are captured');
ok(snap.data['auto:alice@test.com'], 'automations are captured');
ok(snap.data['data:alice@test.com'], 'synced chat/project data is captured');
ok(snap.data['wallet:alice@test.com'], 'wallets are captured');
ok(!snap.data['spend:2026-07-16'], 'usage counters are NOT captured (ephemeral)');
ok(!snap.data['active:alice@test.com:2026-07-16'], 'active markers are NOT captured');
ok(!snap.data['GLOBAL_KILL'], 'control keys like GLOBAL_KILL are NOT captured');
ok(snap.keyCount === 6, 'exactly the 6 durable keys are in the snapshot', snap.keyCount);

/* ── The whole point: recover from a TOTAL WIPE ──────────────────────────── */
section('Restore recovers everything after a total data wipe');

const importReq = (body) => new Request('https://api.amv.dev/admin/backup/import', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret' },
  body: JSON.stringify(body)
});

store = new Map();   // simulate: someone deleted the namespace. everything gone.
ok(store.size === 0, 'the data store is wiped (disaster)');

r = await W.backupImport(importReq({ snapshot: snap, mode: 'merge' }), env);
const res = await r.json();
ok(res.ok && res.restored === 6, 'all 6 durable keys are restored', res.restored);
ok(store.get('acct:alice@test.com'), 'Alice\'s account is back');
ok(JSON.parse(store.get('ent:alice@test.com')).plan === 'pro', 'her subscription is back');
ok(JSON.parse(store.get('auto:alice@test.com')).items[0].detail === 'watch BTC', 'her automation is back');

/* ── Restore is additive — 'missing' mode never clobbers newer live data ─── */
section('Missing-mode restore never overwrites newer live data');

seed();  // fresh live data
store.set('ent:alice@test.com', JSON.stringify({ plan: 'ultra' }));  // she UPGRADED since the backup
// snapshot still says 'pro'. A missing-mode restore must NOT downgrade her.
r = await W.backupImport(importReq({ snapshot: snap, mode: 'missing' }), env);
const res2 = await r.json();
ok(JSON.parse(store.get('ent:alice@test.com')).plan === 'ultra',
   'her CURRENT ultra plan is preserved, not overwritten by the old pro snapshot');
ok(res2.skipped > 0, 'existing keys are skipped in missing mode', res2.skipped);

/* ── A tampered snapshot cannot write arbitrary control keys ─────────────── */
section('A tampered snapshot cannot inject control keys');

const evil = { _amv_backup: 1, createdAt: Date.now(), data: {
  'GLOBAL_KILL': '1',                       // try to kill the platform
  'acct:evil@x.com': JSON.stringify({ email: 'evil@x.com' }),  // this one is legit-shaped
  'randomkey': 'whatever'
}};
store = new Map();
r = await W.backupImport(importReq({ snapshot: evil, mode: 'merge' }), env);
const res3 = await r.json();
ok(!store.has('GLOBAL_KILL'), 'GLOBAL_KILL is REJECTED (outside backup scope)');
ok(!store.has('randomkey'), 'an arbitrary key is rejected');
ok(store.has('acct:evil@x.com'), 'a validly-prefixed account key is allowed');
ok(res3.rejected === 2, 'the two out-of-scope keys are counted as rejected', res3.rejected);

/* ── A garbage / non-snapshot file is refused ────────────────────────────── */
section('A non-snapshot file is refused');

r = await W.backupImport(importReq({ snapshot: { foo: 'bar' } }), env);
ok(r.status === 400, 'a file without the backup marker is a 400', r.status);

/* ── AMV-036: import is bounded ───────────────────────────────────────────── */
section('AMV-036: import rejects oversized values');
r = await W.backupImport(new Request('https://api.amv.dev/admin/backup/import', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret' },
  body: JSON.stringify({ snapshot: { _amv_backup: 1, data: { 'acct:huge@x.com': 'A'.repeat(3 * 1024 * 1024) } } })
}), env);
const bd = await r.json();
ok(r.status === 200 && bd.restored === 0 && bd.rejected >= 1, 'an oversized value is rejected, not written', bd);

/* ── Admin only ──────────────────────────────────────────────────────────── */
section('Backup endpoints are admin-only');

r = await W.backupExport(new Request('https://api.amv.dev/admin/backup/export', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
}), env);
ok(r.status === 401, 'export without the admin token is unauthorized', r.status);

r = await W.backupImport(new Request('https://api.amv.dev/admin/backup/import', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'wrong' },
  body: JSON.stringify({ snapshot: snap })
}), env);
ok(r.status === 401, 'import with a wrong token is unauthorized', r.status);

report();
done();
