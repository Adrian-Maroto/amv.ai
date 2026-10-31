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
    if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
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

section('A night is put back through the same rules as any restore');
{
  for (const k of [...env._m.keys()]) if (k.startsWith('acct:')) env._m.delete(k);
  let res, body, from = 0, rounds = 0;
  do {
    res = await W.backupImport(admin('/admin/backup/import', { fromNight: DAY, fromPart: from }), env);
    body = await res.json(); from = body.nextPart; rounds++;
  } while (body.more && rounds < 20);
  ok(res.status === 200 && body.ok && [...env._m.keys()].filter(k => k.startsWith('acct:')).length === 2600, 'every account is back', { status: res.status, restored: body.restored });
  /* A tampered part tries to switch the deployment off. */
  B.o.set('backups/' + DAY + '/part-000000.ndjson', JSON.stringify({ k: 'GLOBAL_KILL', v: '1' }) + '\n' + B.o.get('backups/' + DAY + '/part-000000.ndjson'));
  env._m.set('GLOBAL_KILL', '0');
  const t = await (await W.backupImport(admin('/admin/backup/import', { fromNight: DAY }), env)).json();
  ok(env._m.get('GLOBAL_KILL') === '0' && t.refused >= 1, 'a key outside the backup prefixes is refused, not written', { refused: t.refused });
  B.o.delete('backups/' + DAY + '/part-000001.ndjson');
  const miss = await W.backupImport(admin('/admin/backup/import', { fromNight: DAY }), env);
  const m = await miss.json();
  ok(miss.status === 422 && m.code === 'restore_incomplete' && m.nextPart === 1, 'a missing part stops the restore and says where', m);
  const none = await W.backupImport(admin('/admin/backup/import', { fromNight: '2020-01-01' }), env);
  ok(none.status === 404, 'a night with no complete backup is refused', none.status);
  const anon = await W.backupImport(new Request('https://api.amv.test/admin/backup/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' }, body: JSON.stringify({ fromNight: DAY }) }), env);
  ok(anon.status === 401 || anon.status === 403, 'and without the owner’s token nothing is restored', anon.status);
}

console.log = quiet;
if (report('every-night-is-backed-up') > 0) process.exitCode = 1;
done();
