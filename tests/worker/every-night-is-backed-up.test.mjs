/* EVERY NIGHT IS BACKED UP, AND A NIGHT CAN BE PUT BACK.

   Oct 31 production audit, "automated backups": the only backup was a file
   an operator downloads by hand. With the AMV_BACKUPS bucket bound
   (27a-nightly-backup.js), each night is copied in slices on the five-minute
   tick. What has to be true:
     - the night holds every record under the backup prefixes, and nothing
       else - not a rate limit, not the kill switch;
     - a tick that dies part-way loses nothing: the next one goes on from the
       last part it saved, and no record is missing or doubled;
     - a night counts only when its manifest is written, last;
     - a record too large to restore abandons the night and says so;
     - a night not finished by 06:00 UTC the next day is paged;
     - thirty nights are kept, older ones deleted;
     - a restore puts a night back through the same rules as any restore:
       a tampered part cannot write a control key, a missing part stops the
       restore and says where, and only the owner's token can do any of it;
     - with no bucket, nothing runs and nothing breaks. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { createHash } from 'crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'nightly.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { runNightlyBackup, backupImport, backupNights, BACKUP_MAX_VALUE_BYTES };\n');
const W = await import(harness + '?t=' + Date.now());

const ADMIN = 'a-long-random-admin-token-for-nightly';
const alerts = [], audits = [];
const quiet = console.log;
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('AUDIT')) { try { audits.push(JSON.parse(s.slice(6))); } catch (e) {} return; } quiet(...a); };

/* KV that pages like the real one: at most `limit` keys, then a cursor. */
const kv = (m) => ({
  async get(k) { return m.has(k) ? m.get(k) : null; },
  async put(k, v) { m.set(k, String(v)); },
  async delete(k) { m.delete(k); },
  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const all = [...m.keys()].filter(k => k.startsWith(prefix)).sort();
    const from = cursor ? +cursor : 0;
    const keys = all.slice(from, from + limit).map(name => ({ name }));
    const end = from + keys.length >= all.length;
    return { keys, list_complete: end, cursor: end ? undefined : String(from + keys.length) };
  },
});
/* The bucket, standing in: objects by key; list with a prefix, a delimiter
   and pages; and it can be told to fail one write. */
const bucket = () => {
  const o = new Map(); let failNext = 0;
  return { o, fail(n = 1) { failNext = n; },
    async put(k, v) { if (failNext > 0) { failNext--; throw new Error('bucket unavailable'); } o.set(k, String(v)); },
    async get(k) { return o.has(k) ? { text: async () => o.get(k) } : null; },
    async delete(k) { o.delete(k); },
    async list({ prefix = '', delimiter, cursor } = {}) {
      const keys = [...o.keys()].filter(k => k.startsWith(prefix)).sort();
      if (!delimiter) return { objects: keys.map(key => ({ key })), truncated: false };
      const pre = new Set(keys.map(k => { const rest = k.slice(prefix.length); const i = rest.indexOf(delimiter); return i >= 0 ? prefix + rest.slice(0, i + 1) : null; }).filter(Boolean));
      return { objects: [], delimitedPrefixes: [...pre], truncated: false };
    } };
};
const counterVals = new Map();
const mkEnv = (extra = {}) => Object.assign({
  JWT_SECRET: 'x'.repeat(40), ADMIN_TOKEN: ADMIN, _m: new Map(),
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = counterVals.get(n) || 0;
    if (b.op === 'rateCheck') { counterVals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
    /* A claim as the object makes one: held until released by its owner or expired. */
    if (b.op === 'claim') { const h = counterVals.get('c:' + n); if (h && h.until > Date.now()) return new Response(JSON.stringify({ claimed: false }));
      const owner = 'o' + Math.floor(Math.random() * 1e9); counterVals.set('c:' + n, { owner, until: Date.now() + (b.ttlMs || 30000) }); return new Response(JSON.stringify({ claimed: true, owner })); }
    if (b.op === 'release') { const h = counterVals.get('c:' + n); if (h && b.owner && h.owner !== b.owner) return new Response(JSON.stringify({ released: false })); counterVals.delete('c:' + n); return new Response(JSON.stringify({ released: true })); }
    return new Response(JSON.stringify({ allowed: true, value: cur }));
  } }) },
}, extra);
const withKV = (env) => { env.AMV_KV = kv(env._m); return env; };
const admin = (path, body) => new Request('https://api.amv.test' + path, { method: body ? 'POST' : 'GET',
  headers: { Authorization: 'Bearer ' + ADMIN, 'CF-Connecting-IP': '2.4.6.' + (1 + Math.floor(Math.random() * 200)), 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined });

/* 2,600 accounts (three pages of acct:), and a little of everything else -
   including keys that must never be in a backup. */
const seed = (env) => {
  for (let i = 0; i < 2600; i++) env._m.set('acct:user' + String(i).padStart(5, '0') + '@x.com', JSON.stringify({ name: 'U' + i }));
  env._m.set('ent:a@x.com', JSON.stringify({ plan: 'pro' }));
  env._m.set('auto:a@x.com', JSON.stringify({ items: [{ id: 'j1' }] }));
  env._m.set('rl:1.2.3.4', '7');
  env._m.set('GLOBAL_KILL', '0');
};
const nightRecords = (b, day) => {
  const out = new Map();
  for (const [k, v] of b.o) if (k.startsWith('backups/' + day + '/part-'))
    for (const line of v.split('\n').filter(Boolean)) { const r = JSON.parse(line); out.set(r.k, (out.get(r.k) || 0) + 1); }
  return out;
};
const T0 = Date.UTC(2026, 9, 31, 2, 0, 0);
const DAY = '2026-10-31';

/* Whole-night drill and restore, slice after slice, as the owner console runs them. */
async function drillAll(){
  let res, body, from = 0, rounds = 0, verified = 0;
  do {
    res = await W.backupImport(admin('/admin/backup/import', { fromNight: DAY, fromPart: from, mode: 'verify' }), env);
    body = await res.json(); from = body.nextPart; rounds++; verified = body.verified || verified;
  } while (body.more && rounds < 20);
  return Object.assign(body, { res, verified });
}
async function restoreAll(){
  let res, body, from = 0, rounds = 0;
  do {
    res = await W.backupImport(admin('/admin/backup/import', { fromNight: DAY, fromPart: from }), env);
    body = await res.json(); from = body.nextPart; rounds++;
  } while (body.more && rounds < 20);
  return Object.assign(body, { res });
}

section('With no bucket, nothing runs and nothing breaks');
{
  const env = withKV(mkEnv()); seed(env);
  const r = await W.runNightlyBackup(env, T0);
  ok(r.on === false, 'it says it is off', r);
}

const B = bucket();
const env = withKV(mkEnv({ AMV_BACKUPS: B })); seed(env);

section('A tick that dies part-way loses nothing; the night holds every record, once');
{
  B.fail(1);
  /* The first part's write fails: that tick throws, as a real one would. */
  let threw = false; try { await W.runNightlyBackup(env, T0); } catch (e) { threw = true; }
  ok(threw && !B.o.has('backups/' + DAY + '/manifest.json'), 'the failed tick wrote no manifest', threw);
  let r; for (let i = 0; i < 10 && !(r && (r.done || r.failed)); i++) r = await W.runNightlyBackup(env, T0 + i * 300000);
  ok(r && r.done, 'later ticks finish the night', r);
  const got = nightRecords(B, DAY);
  const want = [...env._m.keys()].filter(k => /^(acct|ent|auto):/.test(k));
  ok(want.every(k => got.get(k) === 1) && got.size === want.length, 'every record under the backup prefixes, exactly once', { want: want.length, got: got.size });
  ok(!got.has('rl:1.2.3.4') && !got.has('GLOBAL_KILL'), 'and nothing that is not one - no rate limit, no kill switch');
  const man = JSON.parse(B.o.get('backups/' + DAY + '/manifest.json'));
  ok(man.complete && man.keyCount === want.length && man.parts >= 3, 'the manifest, written last, says how much and in how many parts', man);
  ok(audits.some(a => a.event === 'nightly_backup' && a.keyCount === want.length), 'and it is on the record');
}

section('A record too large to restore abandons the night and says so');
{
  const b2 = bucket();
  const e2 = withKV(mkEnv({ AMV_BACKUPS: b2 }));
  e2._m.set('acct:big@x.com', 'x'.repeat(W.BACKUP_MAX_VALUE_BYTES + 10));
  e2._m.set('acct:small@x.com', '{}');
  const r = await W.runNightlyBackup(e2, T0);
  ok(r.failed && /acct:big@x\.com/.test(r.failed) && !b2.o.has('backups/' + DAY + '/manifest.json'), 'no manifest: it is not a backup, and the record is named', r);
  const again = await W.runNightlyBackup(e2, T0 + 300000);
  ok(again.failed && !b2.o.has('backups/' + DAY + '/manifest.json'), 'and later ticks do not quietly finish it short', again);
}

section('A night not finished by morning is paged');
{
  const b3 = bucket();
  const e3 = withKV(mkEnv({ AMV_BACKUPS: b3, ALERT_WEBHOOK: 'https://hooks.example/amv' }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { alerts.push(String((init && init.body) || '')); return new Response('{}'); };
  e3._m.set('bkrun:' + DAY, JSON.stringify({ day: DAY, prefix: 0, part: 0, done: false }));
  const nextMorning = Date.UTC(2026, 10, 1, 7, 0, 0);
  await W.runNightlyBackup(e3, nextMorning);
  globalThis.fetch = realFetch;
  ok(e3._m.has('alerted:nightly_backup_late') && alerts.some(a => /did not finish/.test(a) && a.includes(DAY)),
     'the operator is told last night’s backup did not finish, naming the night', alerts.slice(-1));
  const early = withKV(mkEnv({ AMV_BACKUPS: bucket(), ALERT_WEBHOOK: 'https://hooks.example/amv' }));
  early._m.set('bkrun:' + DAY, JSON.stringify({ day: DAY, prefix: 0, part: 0, done: false }));
  await W.runNightlyBackup(early, Date.UTC(2026, 10, 1, 3, 0, 0));
  ok(!early._m.has('alerted:nightly_backup_late'), 'but not at 03:00, while it may still be running');
}

section('Thirty nights are kept; older ones go');
{
  B.o.set('backups/2026-09-01/part-000000.ndjson', '{"k":"acct:old","v":"{}"}\n');
  B.o.set('backups/2026-09-01/manifest.json', JSON.stringify({ complete: true, parts: 1 }));
  env._m.delete('bkrun:2026-11-01');
  let r; for (let i = 0; i < 10 && !(r && r.done); i++) r = await W.runNightlyBackup(env, Date.UTC(2026, 10, 1, 2, 0, 0) + i * 300000);
  ok(r && r.done && ![...B.o.keys()].some(k => k.startsWith('backups/2026-09-01/')), 'a night older than thirty days is deleted when a new one completes', [...B.o.keys()].filter(k => !/part-/.test(k)));
  ok(B.o.has('backups/' + DAY + '/manifest.json'), 'and a recent one is kept');
  const list = await (await W.backupNights(admin('/admin/backup/nights'), env)).json();
  ok(list.on && list.nights.some(n => n.day === DAY && n.complete), 'the owner console lists the nights there are to restore from', list.nights);
}

section('The restore drill reads a whole night through the restore path and writes nothing');
{
  /* Its own bookkeeping (that the night was drilled) aside: no record. */
  const dataOnly = () => JSON.stringify([...env._m.entries()].filter(([k]) => !k.startsWith('bkdrill:')).sort());
  const before = dataOnly();
  const man = JSON.parse(B.o.get('backups/' + DAY + '/manifest.json'));
  ok(Array.isArray(man.partSha) && man.partSha.length === man.parts && man.partSha.every(h => /^[0-9a-f]{64}$/.test(h)), 'the manifest carries a checksum for every part (Nov 1 audit DR-004)', man.partSha);
  const body = await drillAll();
  ok(body.res.status === 200 && body.drill && body.ok && body.verified === man.keyCount && body.checksums === true, 'every record the manifest counts is read, every part matches its checksum', { status: body.res.status, verified: body.verified, expected: man.keyCount });
  ok(dataOnly() === before, 'and not one record was written');
  /* A part changed after the backup was taken: its checksum no longer matches. */
  const p0 = 'backups/' + DAY + '/part-000000.ndjson', orig = B.o.get(p0);
  B.o.set(p0, JSON.stringify({ k: 'GLOBAL_KILL', v: '1' }) + '\n' + orig);
  const bad = await drillAll();
  ok(bad.ok === false && bad.badParts.includes(0) && env._m.get('GLOBAL_KILL') === '0', 'a part that does not match its checksum fails the drill, and nothing in it is written', bad);
  /* The same record in a backup whose checksum matches it (taken that way): the record check still refuses it. */
  const man2 = JSON.parse(B.o.get('backups/' + DAY + '/manifest.json'));
  const tampered = B.o.get(p0); const realSum = man2.partSha[0];
  man2.partSha[0] = createHash('sha256').update(tampered).digest('hex');
  B.o.set('backups/' + DAY + '/manifest.json', JSON.stringify(man2));
  const bad2 = await drillAll();
  ok(bad2.ok === false && bad2.refused === 1 && env._m.get('GLOBAL_KILL') === '0', 'a record outside what a restore accepts fails the drill, and is still not written', bad2);
  B.o.set(p0, orig); man2.partSha[0] = realSum; B.o.set('backups/' + DAY + '/manifest.json', JSON.stringify(man2));
  const nameless = await W.backupImport(admin('/admin/backup/import', { mode: 'verify' }), env);
  ok(nameless.status === 400, 'a drill names the night it reads', nameless.status);
}

section('A night is put back only after a drill found all of it sound, through the same rules as any restore');
{
  for (const k of [...env._m.keys()]) if (k.startsWith('acct:')) env._m.delete(k);
  for (const k of [...env._m.keys()]) if (k.startsWith('bkdrill:')) env._m.delete(k);
  const early = await W.backupImport(admin('/admin/backup/import', { fromNight: DAY }), env);
  const e = await early.json();
  ok(early.status === 409 && e.code === 'drill_required' && ![...env._m.keys()].some(k => k.startsWith('acct:')), 'without a sound drill of that night, nothing is restored at all', e);
  await drillAll();
  const body = await restoreAll();
  ok(body.res.status === 200 && body.ok && [...env._m.keys()].filter(k => k.startsWith('acct:')).length === 2600, 'after one, every account is back', { status: body.res.status, restored: body.restored });
  /* A part changed after a sound drill: the restore checks it again and stops. */
  const p0 = 'backups/' + DAY + '/part-000000.ndjson', orig = B.o.get(p0);
  B.o.set(p0, JSON.stringify({ k: 'GLOBAL_KILL', v: '1' }) + '\n' + orig);
  env._m.set('GLOBAL_KILL', '0');
  const t = await W.backupImport(admin('/admin/backup/import', { fromNight: DAY }), env);
  const tb = await t.json();
  ok(t.status === 422 && tb.code === 'restore_checksum' && env._m.get('GLOBAL_KILL') === '0', 'a part changed since the drill stops the restore before it is applied', tb);
  B.o.set(p0, orig);
  /* A missing part: the drill finds it, and the restore is not even started. */
  const p1 = 'backups/' + DAY + '/part-000001.ndjson', orig1 = B.o.get(p1);
  B.o.delete(p1);
  const d = await drillAll();
  ok(d.res.status === 422 && d.code === 'restore_incomplete', 'a missing part fails the drill and says where', d);
  for (const k of [...env._m.keys()]) if (k.startsWith('acct:')) env._m.delete(k);
  const r2 = await W.backupImport(admin('/admin/backup/import', { fromNight: DAY }), env);
  ok(r2.status === 409 && ![...env._m.keys()].some(k => k.startsWith('acct:')), 'and with no sound drill since, the restore writes nothing - no half-restored store', r2.status);
  B.o.set(p1, orig1);
  const none = await W.backupImport(admin('/admin/backup/import', { fromNight: '2020-01-01' }), env);
  ok(none.status === 404, 'a night with no complete backup is refused', none.status);
  const anon = await W.backupImport(new Request('https://api.amv.test/admin/backup/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' }, body: JSON.stringify({ fromNight: DAY }) }), env);
  ok(anon.status === 401 || anon.status === 403, 'and without the owner’s token nothing is restored', anon.status);
}

section('One backup slice at a time (Nov 1 audit DR-002)');
{
  const later = T0 + 3 * 86400000;
  const stateKeys = () => [...env._m.keys()].filter(k => k.startsWith('bkrun:')).sort().join();
  /* Somebody else's slice holds the lease: this one does nothing. */
  counterVals.set('c:lease:nightly-backup', { owner: 'someone-else', until: Date.now() + 60000 });
  const before = stateKeys();
  const busy = await W.runNightlyBackup(env, later);
  ok(busy.busy === true && stateKeys() === before, 'a slice that finds another running does nothing, and touches no progress', busy);
  ok(counterVals.get('c:lease:nightly-backup').owner === 'someone-else', 'and leaves the other holder holding it');
  counterVals.delete('c:lease:nightly-backup');
  /* Two at once: one works, one is a clean no-op; the lease is given back. */
  const pair = await Promise.all([W.runNightlyBackup(env, later), W.runNightlyBackup(env, later)]);
  ok(pair.filter(r => r.busy).length === 1 && pair.filter(r => !r.busy).length === 1, 'two started together: one runs, the other does nothing', pair.map(r => r.busy ? 'busy' : (r.done ? 'done' : 'ran')));
  ok(!counterVals.has('c:lease:nightly-backup'), 'and the lease is given back when the slice ends');
}

console.log = quiet;
if (report('every-night-is-backed-up') > 0) process.exitCode = 1;
done();
