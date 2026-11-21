/* A BACKUP PART THAT CHANGED IS NEVER PUBLISHED (Build 16 audit STATE16-04,
   Nov 20).

   A night is copied in slices, and its checkpoint lives in a store that can
   answer with an older copy. A writer resuming from an older checkpoint can
   write a part again with different records in it, and the manifest - which
   promises each part's hash - would then describe bytes the bucket no longer
   holds: a backup that is refused exactly when somebody needs it.
   - a night whose part no longer matches its record publishes no manifest,
     starts again under a new generation, and pages the operator;
   - the night it then publishes matches the bucket, part for part;
   - a stale checkpoint replayed after the night finished changes nothing. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'bkpart.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _nightlyBackupSlice };\n');
const W = await import(harness + '?t=' + Date.now());
const audits = []; const quiet = console.log;
console.log = (...a) => { const s = a.join(' '); if (s.startsWith('AUDIT')) { try { audits.push(JSON.parse(s.slice(6))); } catch (e) {} return; } quiet(...a); };
globalThis.fetch = async () => new Response('{}', { status: 200 });

const DAY = '2026-11-18';
let now = Date.parse(DAY + 'T02:00:00Z'); const realNow = Date.now; Date.now = () => now;
const live = new Map(), r2 = new Map();
let beforeR2 = null;
const env = { JWT_SECRET: 'x'.repeat(40), ADMIN_TOKEN: 'y'.repeat(40), ALERT_WEBHOOK: 'https://hooks.example.com/a',
  AMV_KV: { async get(k) { return live.has(k) ? live.get(k) : null; }, async put(k, v) { live.set(k, String(v)); }, async delete(k) { live.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...live.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; } },
  AMV_BACKUPS: { async put(k, v) { if (beforeR2) await beforeR2(k); r2.set(k, String(v)); }, async get(k) { return r2.has(k) ? { text: async () => r2.get(k) } : null; },
    async delete(k) { r2.delete(k); }, async list({ prefix = '' } = {}) { return { objects: [...r2.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), delimitedPrefixes: [], truncated: false }; } } };
const sha = (t) => createHash('sha256').update(t).digest('hex');
const manifest = () => { const m = r2.get('backups/' + DAY + '/manifest.json'); return m ? JSON.parse(m) : null; };
const partsMatch = (man) => Array.from({ length: man.parts }, (_, i) => r2.get('backups/' + DAY + '/' + man.gen + '/part-' + String(i).padStart(6, '0') + '.ndjson'))
  .every((t, i) => t != null && sha(t) === man.partSha[i]);

live.set('acct:kim@example.com', JSON.stringify({ name: 'Kim' }));
live.set('ent:kim@example.com', JSON.stringify({ plan: 'pro' }));

section('A part that no longer matches its record: nothing is published');
{
  /* The first slice runs out of time after its first part. */
  let first = true;
  beforeR2 = async (k) => { if (k.endsWith('.ndjson') && first) { first = false; now += 21000; } };
  const a = await W._nightlyBackupSlice(env, now);
  beforeR2 = null;
  ok(a.more && !manifest(), 'the night is part-way, with no manifest yet', a);
  const gen0 = JSON.parse(live.get('bkrun:' + DAY)).gen;
  /* Another writer, resuming from an older checkpoint, wrote part 0 again. */
  const p0 = 'backups/' + DAY + '/' + gen0 + '/part-000000.ndjson';
  r2.set(p0, JSON.stringify({ k: 'acct:kim@example.com', v: '{"name":"someone else"}' }) + '\n');
  now += 10000;
  const b = await W._nightlyBackupSlice(env, now);
  ok(b.restarted && !manifest(), 'the mismatch is found before publishing, and the night starts again', b);
  ok(audits.some(x => x.event === 'nightly_backup_restarted'), 'and it is on the record', audits.filter(x => /nightly/.test(x.event)).map(x => x.event));
  const gen1 = JSON.parse(live.get('bkrun:' + DAY)).gen;
  ok(gen1 && gen1 !== gen0, 'under a new generation, so nothing already written is overwritten', { gen0, gen1 });
  ok(r2.get(p0).includes('someone else'), 'the old generation’s parts are left as they were', r2.get(p0));
}

section('The night it then publishes matches the bucket');
{
  let out = null;
  for (let i = 0; i < 5 && !(out && out.done); i++) { now += 10000; out = await W._nightlyBackupSlice(env, now); }
  const man = manifest();
  ok(out && out.done && man && man.complete, 'the night finishes', out);
  ok(man && partsMatch(man), 'and every part it names has the hash it promises', man && man.partSha);
  ok(man && man.keyCount === 2, 'with both records in it', man && man.keyCount);
}

section('A stale checkpoint replayed after it finished changes nothing');
{
  const man = manifest(); const before = new Map(r2);
  live.set('bkrun:' + DAY, JSON.stringify({ day: DAY, gen: man.gen, prefix: 0, cursor: null, part: 0, count: 0, bytes: 0, startedAt: now, done: false, failed: '' }));
  live.set('ent:kim@example.com', JSON.stringify({ plan: 'ultra' }));
  now += 10000;
  const r = await W._nightlyBackupSlice(env, now);
  ok(r.done, 'the signed manifest says it is done', r);
  ok([...before].every(([k, v]) => r2.get(k) === v), 'and no part of it was written again', [...r2.keys()].filter(k => before.get(k) !== r2.get(k)));
  ok(partsMatch(manifest()), 'the published night still matches', true);
}

section('Parts are bounded by bytes, and a slice can stop mid-page (Build 16 audit OPS-06)');
{
  const DAY2 = '2026-11-19';
  now = Date.parse(DAY2 + 'T02:00:00Z');
  live.clear(); r2.clear();
  const big = 'x'.repeat(1900 * 1024);
  for (let i = 0; i < 6; i++) live.set('acct:big' + i + '@example.com', JSON.stringify({ name: 'B' + i, blob: big }));
  /* Each record read costs eight seconds of the slice's twenty. */
  const realGet = env.AMV_KV.get;
  env.AMV_KV.get = async (k) => { if (String(k).startsWith('acct:big')) now += 8000; return realGet.call(env.AMV_KV, k); };
  let out = null, slices = 0;
  while (!(out && out.done) && slices < 20) { slices++; out = await W._nightlyBackupSlice(env, now); now += 1000; }
  env.AMV_KV.get = realGet;
  const man = JSON.parse(r2.get('backups/' + DAY2 + '/manifest.json') || 'null');
  ok(out && out.done && man && man.keyCount === 6, 'every record is in the night, once', { out, keys: man && man.keyCount, slices });
  ok(slices > 2, 'over several slices, each stopping part-way through the page', slices);
  const sizes = man ? Array.from({ length: man.parts }, (_, i) => Buffer.byteLength(r2.get('backups/' + DAY2 + '/' + man.gen + '/part-' + String(i).padStart(6, '0') + '.ndjson') || '')) : [];
  ok(sizes.length >= 2 && sizes.every(n => n <= 8 * 1024 * 1024 + 4096), 'and no part is larger than the bound', sizes);
  const names = new Set();
  for (let i = 0; man && i < man.parts; i++) for (const l of r2.get('backups/' + DAY2 + '/' + man.gen + '/part-' + String(i).padStart(6, '0') + '.ndjson').trim().split('\n')) names.add(JSON.parse(l).k);
  ok([...names].filter(k => k.startsWith('acct:big')).length === 6, 'no record lost or doubled across the stops', [...names]);
}

Date.now = realNow; console.log = quiet;
if (report('a-backup-part-that-changed-is-never-published') > 0) process.exitCode = 1;
done();
