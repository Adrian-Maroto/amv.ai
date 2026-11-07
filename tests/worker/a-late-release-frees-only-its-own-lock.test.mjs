/* A LATE RELEASE FREES ONLY ITS OWN LOCK (Nov 7 audit LOCK-002).

   Lock owners were kept in one map per isolate, one entry per lock name. A
   holder whose lease ran out, while somebody else in the same isolate took
   the lock again, then released with the newcomer's owner - and freed the
   newcomer's lock while it was still working. The record helpers now keep
   their own owner and release with it. Driven through the real counter. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'lateRelease.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _claimOnceDetail, _releaseClaim };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const objs = new Map();
const obj = (n) => { if (!objs.has(n)) { const st = new Map(); objs.set(n, new W.AMVCounter({ storage: { async get(k) { return st.get(k); }, async put(k, v) { st.set(k, v); }, async delete(k) { st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {})); } return objs.get(n); };
const kv = new Map();
const env = { AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, String(v)); }, async delete(k) { kv.delete(k); } },
  AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ fetch: (u, init) => obj(n).fetch(new Request('https://do/c', init)) }) } };

section('A holder whose lease ran out cannot free the lock somebody took after it');
{
  const realNow = Date.now;
  const a = await W._claimOnceDetail(env, 'rmut:test', 'k1', 15);
  ok(a.claimed && a.owner, 'A takes the lock, and is told its owner', a);
  Date.now = () => realNow() + 20000;                    // A's lease is over
  const b = await W._claimOnceDetail(env, 'rmut:test', 'k1', 15);
  ok(b.claimed && b.owner && b.owner !== a.owner, 'B takes it after the lease, in the same isolate', b);
  await W._releaseClaim(env, 'rmut:test', 'k1', a.owner); // A finishes late
  const c = await W._claimOnceDetail(env, 'rmut:test', 'k1', 15);
  ok(!c.claimed, 'A’s late release did not free B’s lock - a third writer is still kept out', c);
  await W._releaseClaim(env, 'rmut:test', 'k1', b.owner);
  ok((await W._claimOnceDetail(env, 'rmut:test', 'k1', 15)).claimed, 'and B’s own release does free it');
  Date.now = realNow;
}

section('The record helpers release with their own owner');
{
  const src = readFileSync(join(ROOT, 'src', 'worker', '53-marketplace-economy.js'), 'utf8');
  ok(/_releaseClaim\(env, 'rmut:' \+ kind, key, lk\.owner \|\| null\)/.test(src) && /_releaseClaim\(env, 'wmut', em, lk\.owner \|\| null\)/.test(src), 'record and wallet locks hand back the owner they were given');
}

console.log = quiet;
if (report('a-late-release-frees-only-its-own-lock') > 0) process.exitCode = 1;
done();
