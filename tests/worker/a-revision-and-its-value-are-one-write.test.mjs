/* A REVISION AND ITS VALUE ARE ONE WRITE (Nov 3 audit STATE-007/001/002).

   Synced data was guarded by a revision held in a Durable Object while the
   value lived in KV, written separately: a writer that died between the two
   left the revision ahead of the value, a later writer overtook it after a
   timer, and a reader could see either copy. Now the value is written under
   a key of its own first, and the object commits revision and digest in one
   step. Checked through DB.putIfRev / DB.get / DB.del themselves. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'revone.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _revCommitRestored };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const kv = new Map();
const env = { AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, String(v)); }, async delete(k) { kv.delete(k); },
  async list({ prefix } = {}) { return { keys: [...kv.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: null };
/* The real object, not a stand-in: one per name, each with its own storage. */
const objects = new Map();
env.AMV_COUNTER = { _objects: { get: (k) => { const name = k.replace(/^rc\|/, ''); const o = objects.get(name); return o && o.__rev; } },
  idFromName: n => n,
  get: (name) => {
    if (!objects.has(name)) {
      const st = new Map();
      const obj = new W.AMVCounter({ storage: { async get(k) { return st.get(k); }, async put(k, v) { st.set(k, v); }, async delete(k) { st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {} } }, {});
      Object.defineProperty(obj, '__rev', { get: () => st.get('rev') });
      Object.defineProperty(obj, '__st', { value: st });
      objects.set(name, obj);
    }
    const obj = objects.get(name);
    return { fetch: (u, init) => obj.fetch(new Request('https://do/counter', init)) };
  } };
const ME = 'kai@example.com', MAIN = 'data:' + ME;
const rec = (rev, note) => ({ _rev: rev, note });

section('A write commits revision and value together');
{
  ok((await W.DB.putIfRev(env, 'data', ME, rec(1, 'first'), 0)).ok, 'the first write commits');
  ok((await W.DB.get(env, 'data', ME)).note === 'first', 'and reads back');
  ok((await W.DB.putIfRev(env, 'data', ME, rec(2, 'second'), 1)).ok, 'a write from the current revision commits');
  ok(!(await W.DB.putIfRev(env, 'data', ME, rec(2, 'stale'), 1)).ok && (await W.DB.get(env, 'data', ME)).note === 'second', 'one from an older revision is refused, and nothing changes');
}

section('The copy readers use failed or is stale: the committed value still answers');
{
  const realPut = env.AMV_KV.put;
  env.AMV_KV.put = async (k, v, o) => { if (k === MAIN) throw new Error('store down'); return realPut.call(env.AMV_KV, k, v, o); };
  ok((await W.DB.putIfRev(env, 'data', ME, rec(3, 'third'), 2)).ok, 'committed even though the usual copy could not be written');
  env.AMV_KV.put = realPut;
  ok(JSON.parse(kv.get(MAIN)).note === 'second', '(the usual copy is still the old one)');
  ok((await W.DB.get(env, 'data', ME)).note === 'third', 'a read answers with what was committed, not the old copy');
  ok(JSON.parse(kv.get(MAIN)).note === 'third', 'and repairs the usual copy');
  /* A region that has not seen the newest copy yet: the usual key is old. */
  kv.set(MAIN, JSON.stringify(rec(2, 'second')));
  ok((await W.DB.get(env, 'data', ME)).note === 'third', 'an old copy is never answered as current while the committed one can be found');
}

section('A writer that dies before its commit changes nothing, and nobody is overtaken by a timer');
{
  /* Staged but never committed (the Worker died between the two). */
  kv.set('revblob:data:' + ME + ':4', JSON.stringify(rec(4, 'never committed')));
  ok((await W.DB.get(env, 'data', ME)).note === 'third', 'readers still see the committed value');
  ok((await W.DB.putIfRev(env, 'data', ME, rec(4, 'fourth'), 3)).ok && (await W.DB.get(env, 'data', ME)).note === 'fourth', 'the next writer goes on from the committed revision - nothing is stuck');
  /* However long ago the newest commit was, a writer behind it is refused:
     the old object let one through after two minutes. */
  const o = env.AMV_COUNTER._objects.get('rc|rev:data:' + ME); o.at = Date.now() - 3600000;
  ok(!(await W.DB.putIfRev(env, 'data', ME, rec(4, 'late'), 3)).ok, 'a writer behind the commit is refused, however old the commit is');
}

section('Deleted is committed: a remaining copy is never read back');
{
  kv.set('revblob:data:' + ME + ':4', JSON.stringify(rec(4, 'fourth')));
  await W.DB.del(env, 'data', ME);
  kv.set(MAIN, JSON.stringify(rec(4, 'fourth')));          // a copy somewhere that the delete has not reached
  ok((await W.DB.get(env, 'data', ME)) === null, 'an erased record reads as absent, whatever copies remain');
  /* Nov 7 audit STATE-008/010: a writer that read the record BEFORE the
     delete - revision 4 - must not put it back. It used to: the tombstone kept
     revision 4 and a commit skipped the check whenever the record was absent. */
  ok(!(await W.DB.putIfRev(env, 'data', ME, rec(5, 'resurrected'), 4)).ok && (await W.DB.get(env, 'data', ME)) === null,
    'a writer holding the record from before the delete is refused, and it stays deleted');
  ok(!(await W.DB.putIfRev(env, 'data', ME, rec(9, 'resurrected'), 9)).ok && (await W.DB.get(env, 'data', ME)) === null,
    'so is one claiming a revision past the delete it never saw');
  const life = rec(1, 'new life');
  ok((await W.DB.putIfRev(env, 'data', ME, life, 0)).ok && (await W.DB.get(env, 'data', ME)).note === 'new life', 'a writer that read "absent" can create it again');
  ok(life._rev === 6 && (await W.DB.get(env, 'data', ME))._rev === 6, 'above every revision before it: delete was generation 5, the new life is 6', life._rev);
  ok(!(await W.DB.putIfRev(env, 'data', ME, rec(5, 'old'), 4)).ok, 'and the old writer is still refused against the new life');
}

section('The committed copy cannot be found: the stale one is not answered (Nov 7 audit STATE-009)');
{
  const OTHER = 'lee@example.com';
  ok((await W.DB.putIfRev(env, 'data', OTHER, rec(1, 'committed'), 0)).ok, 'a committed value');
  kv.set('data:' + OTHER, JSON.stringify(rec(0, 'stale')));
  kv.delete('revblob:data:' + OTHER + ':1');
  let threw = null;
  try { await W.DB.get(env, 'data', OTHER); } catch (e) { threw = e; }
  ok(threw && threw.name === 'RecordSettlingError' && threw.amvRefusal && threw.amvRefusal.status === 503 && threw.amvRefusal.body.code === 'record_settling',
    'the read is refused as a short wait - a 503 the router answers as one, not the copy it knows is wrong', threw && threw.message);
  kv.set('revblob:data:' + OTHER + ':1', JSON.stringify(rec(1, 'committed')));
  ok((await W.DB.get(env, 'data', OTHER)).note === 'committed', 'and once the committed copy arrives, it is what is read');
}

section('A tombstone from before generations is one above the revision it deleted');
{
  const OLD = 'old@example.com';
  env.AMV_COUNTER.get('rev:data:' + OLD);
  /* Exactly what a delete wrote before this change: the revision it deleted, marked absent. */
  objects.get('rev:data:' + OLD).__st.set('rev', { rev: 3, absent: true, at: Date.now() });
  ok(!(await W.DB.putIfRev(env, 'data', OLD, rec(4, 'stale'), 3)).ok && (await W.DB.get(env, 'data', OLD)) === null,
    'the writer that read revision 3 before that delete is refused');
  const again = rec(1, 'again');
  ok((await W.DB.putIfRev(env, 'data', OLD, again, 0)).ok && again._rev === 5, 'and a writer that read "absent" creates it at 5, above the delete', again._rev);
  await W.DB.del(env, 'data', OLD);
  const t = objects.get('rev:data:' + OLD).__rev;
  ok(t && t.absent && t.gen === true && t.rev === 6, 'a delete now writes the next generation itself', t);
}

section('A restore is what readers see afterwards, byte for byte');
{
  ok((await W.DB.putIfRev(env, 'data', ME, rec(7, 'before restore'), 6)).ok, 'a committed value');
  const restored = JSON.stringify(rec(9, 'from the backup'));
  kv.set(MAIN, restored);                                   // what a restore writes
  await W._revCommitRestored(env, 'data', ME, restored);
  ok((await W.DB.get(env, 'data', ME)).note === 'from the backup' && kv.get(MAIN) === restored, 'readers get the restored value, unchanged - not the copy committed before it');
  ok((await W.DB.putIfRev(env, 'data', ME, rec(10, 'after'), 9)).ok, 'and the next write goes on from the restored revision');
}

section('No object to commit with: nothing is written');
{
  const real = env.AMV_COUNTER;
  const was = (await W.DB.get(env, 'data', ME)).note;
  env.AMV_COUNTER = { idFromName: n => n, get: () => ({ async fetch() { throw new Error('object unreachable'); } }) };
  const r = await W.DB.putIfRev(env, 'data', ME, rec(9, 'unguarded'), 8);
  env.AMV_COUNTER = real;
  ok(!r.ok && r.unavailable && (await W.DB.get(env, 'data', ME)).note === was, 'refused and said, never written unguarded');
}

console.log = quiet;
if (report('a-revision-and-its-value-are-one-write') > 0) process.exitCode = 1;
done();
