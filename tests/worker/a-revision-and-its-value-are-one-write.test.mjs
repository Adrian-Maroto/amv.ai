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
  ok((await W.DB.putIfRev(env, 'data', ME, rec(1, 'new life'), 0)).ok && (await W.DB.get(env, 'data', ME)).note === 'new life', 'and a new one can be written after it');
}

section('A restore is what readers see afterwards, byte for byte');
{
  ok((await W.DB.putIfRev(env, 'data', ME, rec(2, 'before restore'), 1)).ok, 'a committed value');
  const restored = JSON.stringify(rec(7, 'from the backup'));
  kv.set(MAIN, restored);                                   // what a restore writes
  await W._revCommitRestored(env, 'data', ME, restored);
  ok((await W.DB.get(env, 'data', ME)).note === 'from the backup' && kv.get(MAIN) === restored, 'readers get the restored value, unchanged - not the copy committed before it');
  ok((await W.DB.putIfRev(env, 'data', ME, rec(8, 'after'), 7)).ok, 'and the next write goes on from the restored revision');
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
