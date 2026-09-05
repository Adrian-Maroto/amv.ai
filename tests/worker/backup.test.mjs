/* DATA SAFETY - backup & restore.
   Customer accounts, subscriptions, chats, and automations live in KV. These
   tests prove the snapshot captures the durable data (and skips ephemeral
   counters), that a restore is ADDITIVE and never deletes, that a total wipe can
   be recovered, that a tampered snapshot can't write control keys, and that it's
   admin-only. This is the insurance - it has to actually work. */
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
  // durable - must survive
  store.set('acct:alice@test.com', JSON.stringify({ email: 'alice@test.com', name: 'Alice' }));
  store.set('acct:bob@test.com', JSON.stringify({ email: 'bob@test.com', name: 'Bob' }));
  store.set('ent:alice@test.com', JSON.stringify({ plan: 'pro' }));
  store.set('auto:alice@test.com', JSON.stringify({ items: [{ id: 'a1', detail: 'watch BTC' }] }));
  store.set('data:alice@test.com', JSON.stringify({ chats: ['hello'] }));
  store.set('wallet:alice@test.com', JSON.stringify({ credits: 500 }));
  // ephemeral - should NOT be in the backup
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

/* ── Restore is additive - 'missing' mode never clobbers newer live data ─── */
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
/* `refused`, not `rejected`. One counter used to hold two unrelated events:
   a tampered snapshot correctly stopped from writing a control key, and real
   data being silently dropped during a recovery. The first is common and
   harmless, so the second hid behind it and the response said ok:true either
   way. Two names now, and this is the harmless one. */
ok(res3.refused === 2, 'the two out-of-scope keys are counted as refused', res3.refused);
ok(res3.unrestorable === 0, 'and none of it is mistaken for data that went missing', res3.unrestorable);
ok(res3.ok === true, 'so a snapshot whose only problem is a rejected control key still succeeds', res3.ok);

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
/* Still not written - that is the property, and it is asserted on the store
   rather than inferred from a count. What changed is the ANSWER: this used to
   be a 200 with ok:true and the count buried in the body, which a recovery
   script reads as success. A restore that could not write part of the snapshot
   is a failed restore, because a partial restore somebody believes was total is
   how a recovery quietly loses data. */
ok(!store.has('acct:huge@x.com'), 'an oversized value is not written', store.has('acct:huge@x.com'));
ok(r.status === 422 && bd.ok === false, 'and the restore reports that as a failure', { status: r.status, ok: bd.ok });
ok(bd.restored === 0 && bd.unrestorable >= 1, 'counting it as unrestorable', bd);
ok(Array.isArray(bd.lost) && bd.lost.includes('acct:huge@x.com'),
   'and naming it, so somebody can go and look', JSON.stringify(bd.lost));

/* ── Admin only ──────────────────────────────────────────────────────────── */
section('Backup endpoints are admin-only');

r = await W.backupExport(new Request('https://api.amv.dev/admin/backup/export', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
}), env);
/* 403, not 401: every admin-token refusal in the product now answers the
   same way, and it has to be 403 because the app treats a 401 on a
   non-/auth call as an expired session and signs the person out. The
   operator's session is fine; their admin token is not. The reasoning is
   written out once, in admin-security.test.mjs. */
ok(r.status === 403, 'export without the admin token is refused', r.status);

r = await W.backupImport(new Request('https://api.amv.dev/admin/backup/import', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'wrong' },
  body: JSON.stringify({ snapshot: snap })
}), env);
ok(r.status === 403, 'import with a wrong token is refused', r.status);

report();
done();
