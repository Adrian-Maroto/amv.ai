/* A BACKUP THAT HAS NEVER BEEN RESTORED IS NOT A BACKUP.

   There was an export, carefully written - it streams rather than building the
   store in memory, and it abandons the file rather than finishing short when a
   kind cannot be read. There was an import, also carefully written - it refuses
   keys outside the backup prefixes so a tampered snapshot cannot write a
   control key, and it will not let a restore undo a revocation.

   Nothing had ever run the two together.

   Measured, end to end: seven records in, six records out, and both halves
   reported success. The export wrote a 2MB+ record and called the file
   `"complete":true`; the import refused that same record, counted it, and
   answered `ok:true` with a 200. The limits were declared inside the importer
   and the exporter did not know they existed.

   That is this file's neighbour's own header defect - "a backup that is quietly
   incomplete is worse than no backup ... it is trusted, and it is trusted at
   the single worst moment there is" - reappearing one step downstream, because
   the fix was applied to the half somebody was looking at.

   THE RULE THIS ENCODES. The two halves of a recovery are one feature and have
   to be tested as one. A limit the writer does not know about is not a limit,
   it is a trap laid for the worst day of the year. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'roundtrip.harness.mjs');
writeFileSync(harness, src +
  '\nexport { backupExport, backupImport, BACKUP_MAX_VALUE_BYTES, BACKUP_MAX_KEYS };\n');
const W = await import(harness + '?t=' + Date.now());

const ADMIN = 'a-long-random-admin-token';
function mkEnv() {
  const m = new Map(), vals = new Map();
  return {
    JWT_SECRET: 'x'.repeat(40), ADMIN_TOKEN: ADMIN, _map: m,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, String(v)); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: cur + 1 <= (b.limit || 9999) })); }
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }) },
  };
}
const xreq = () => new Request('https://api.amv.test/admin/backup/export',
  { headers: { Authorization: 'Bearer ' + ADMIN, 'CF-Connecting-IP': '2.4.6.8' } });
const ireq = (snapshot, mode = 'merge') => new Request('https://api.amv.test/admin/backup/import',
  { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'CF-Connecting-IP': '2.4.6.8',
    'Content-Type': 'application/json' }, body: JSON.stringify({ snapshot, mode }) });

section('THE ROUND TRIP: what comes back is what went in');
{
  /* Driven through both real handlers, with the awkward values a real store
     holds - quotes and a backslash, a newline and a tab, non-ASCII and an
     emoji - because the export hand-writes its JSON with string concatenation
     and that is exactly where a round trip breaks. */
  const env = mkEnv();
  const seed = {
    'acct:a@x.com': JSON.stringify({ email: 'a@x.com', name: 'Ann' }),
    'ent:a@x.com':  JSON.stringify({ plan: 'pro' }),
    'wallet:a@x.com': JSON.stringify({ balance: 1234 }),
    'data:quote':   JSON.stringify({ n: 'she said "hi" and \\ left' }),
    'data:newline': JSON.stringify({ n: 'line1\nline2\ttabbed' }),
    'data:unicode': JSON.stringify({ n: 'café 日本語 🛰️' }),
  };
  for (const [k, v] of Object.entries(seed)) await env.AMV_KV.put(k, v);
  const before = new Map(env._map);

  const text = await (await W.backupExport(xreq(), env)).text();
  let snap = null;
  try { snap = JSON.parse(text); } catch (e) { /* asserted below */ }
  ok(!!snap, 'the exported file parses as JSON', snap ? 'yes' : text.slice(0, 120));
  ok(snap && snap.complete === true, 'and says it is complete', snap && snap.complete);
  ok(snap && Object.keys(snap.data).length === before.size,
     'with every record in it', { file: snap && Object.keys(snap.data).length, store: before.size });

  env._map.clear();                       // the disaster
  const res = await W.backupImport(ireq(snap), env);
  const out = await res.json();
  ok(res.status === 200 && out.ok === true, 'the restore reports success', { status: res.status, ok: out.ok });
  ok(out.restored === before.size, 'and restored every record', { said: out.restored, real: before.size });

  const wrong = [...before].filter(([k, v]) => env._map.get(k) !== v).map(([k]) => k);
  ok(wrong.length === 0, 'and each one came back byte for byte', wrong.join(', '));
  ok(env._map.size === before.size, 'with nothing extra invented', { after: env._map.size, before: before.size });
}

section('A record the restore would refuse is caught at BACKUP time');
{
  /* THE DEFECT. The exporter applied no size limit, so a record larger than the
     importer accepts went into the file under `"complete":true` and vanished on
     the way back. Discovering that during a recovery is discovering it too
     late: the moment to learn a record cannot be backed up is an ordinary day,
     while the store is still healthy and somebody can go and look at it. */
  const env = mkEnv();
  await env.AMV_KV.put('acct:a@x.com', JSON.stringify({ email: 'a@x.com' }));
  await env.AMV_KV.put('data:big', 'z'.repeat(W.BACKUP_MAX_VALUE_BYTES + 50));

  let complete = false, why = '';
  try {
    const t = await (await W.backupExport(xreq(), env)).text();
    complete = /"complete":true/.test(t);
  } catch (e) { why = String((e && e.message) || e); }

  ok(!complete, 'the export does not call that file complete', complete);
  ok(/data:big/.test(why), 'and it names the record that could not be backed up', why.slice(0, 140));
  ok(/restore/i.test(why), 'saying plainly that it could not have been restored', why.slice(0, 140));
}

section('And a snapshot that cannot be fully restored is NOT reported as ok');
{
  /* The other half of the same rule, for a file that reached the operator
     some other way - an older snapshot, or one edited by hand. It used to
     answer 200 / ok:true with the count buried in the body, which a recovery
     script reads as success. */
  const env = mkEnv();
  const snap = { _amv_backup: 1, createdISO: new Date().toISOString(), data: {
    'acct:a@x.com': JSON.stringify({ email: 'a@x.com' }),
    'data:big': 'z'.repeat(W.BACKUP_MAX_VALUE_BYTES + 50),
  } };
  const res = await W.backupImport(ireq(snap), env);
  const out = await res.json();
  ok(res.status === 422, 'it answers with a failure status', res.status);
  ok(out.ok === false, 'and does not say ok', out.ok);
  ok(out.code === 'restore_incomplete', 'with a code a script can branch on', out.code);
  ok(out.unrestorable === 1, 'counting what was lost', out.unrestorable);
  ok(Array.isArray(out.lost) && out.lost.includes('data:big'),
     'and naming it, so somebody can go and look', JSON.stringify(out.lost));
  ok(env._map.get('acct:a@x.com') !== undefined,
     'while everything it COULD write is still written', true);
}

section('A refused control key is not the same event as a lost record');
{
  /* Both used to increment one counter, so a tampered snapshot being correctly
     stopped and real data being silently dropped were indistinguishable in the
     response - and the dangerous one hid behind the harmless one. */
  const env = mkEnv();
  const snap = { _amv_backup: 1, createdISO: new Date().toISOString(), data: {
    'acct:a@x.com': JSON.stringify({ email: 'a@x.com' }),
    'GLOBAL_KILL': '1',
  } };
  const res = await W.backupImport(ireq(snap), env);
  const out = await res.json();
  ok(env._map.get('GLOBAL_KILL') === undefined,
     'the control key is still kept out of the store', env._map.get('GLOBAL_KILL'));
  ok(out.refused === 1, 'and counted as refused', out.refused);
  ok(out.unrestorable === 0, 'not as data that went missing', out.unrestorable);
  ok(out.ok === true && res.status === 200,
     'so a snapshot with nothing but a rejected control key still succeeds',
     { ok: out.ok, status: res.status });
}

section('The two halves share one set of limits, so they cannot drift apart');
{
  ok(typeof W.BACKUP_MAX_VALUE_BYTES === 'number' && W.BACKUP_MAX_VALUE_BYTES > 0,
     'the per-record limit is declared once', W.BACKUP_MAX_VALUE_BYTES);
  ok(typeof W.BACKUP_MAX_KEYS === 'number' && W.BACKUP_MAX_KEYS > 0,
     'and so is the key ceiling', W.BACKUP_MAX_KEYS);
  const body = src.slice(src.indexOf('async function backupImport'));
  ok(!/const\s+MAX_VALUE_BYTES\s*=/.test(body) && !/const\s+MAX_IMPORT_KEYS\s*=/.test(body),
     'the importer no longer keeps its own private copy', true);
}

if (report('a-backup-nobody-has-ever-restored') > 0) process.exitCode = 1;
done();
