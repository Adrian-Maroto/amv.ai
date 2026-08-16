/* THE STORAGE BLIP THAT DELETED A RECORD AND REPORTED SUCCESS.

   `_withKV` is the locked read-modify-write behind wallets, entitlements, API
   keys, mail config and the seller ledger. It read the key, and it caught
   everything the read could throw - a timeout, an unreachable store, corrupt
   JSON - and returned the caller's `empty` value instead.

   Follow that through. The mutate is handed a blank record, fills it in as if
   the account were new, and the save writes it over the key. A momentary
   storage error therefore replaced somebody's live wallet with an empty one,
   inside a lock, with the operation returning ok.

   The lock is what made it invisible. The write is serialised and provably
   unraced, so the code reads as careful. Nothing was racing it. The read lied,
   and every layer above believed it.

   Two states were collapsed into one, and they are not the same claim:

     absent    - this record has never existed. A real answer. `empty` is right.
     unreadable - AMV does not know what this record contains. The only safe
                 action is to write nothing at all.

   This file separates them, and then checks the thing a fix like this most
   easily gets wrong: that failing inside the lock still gives the lock back. A
   throw that leaves the record wedged would trade a data-loss bug for an
   outage, and it would only be discovered under a storage incident, which is
   the same moment the first bug fires. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'withkv.harness.mjs');
writeFileSync(harness, src + '\nexport { _withKV, UnreadableRecordError };\n');
const W = await import(harness + '?t=' + Date.now());

/* A real Durable Object claim, so the lock under test is the lock in
   production rather than a stub that always succeeds. */
function mkEnv() {
  const m = new Map();
  const claims = new Map();
  const audits = [];
  let failFor = null;
  const env = {
    _map: m, _audits: audits,
    fail(prefix) { failFor = prefix; },
    heal() { failFor = null; },
    AMV_KV: {
      async get(k) {
        if (failFor && k.startsWith(failFor)) throw new Error('storage unreachable');
        return m.has(k) ? m.get(k) : null;
      },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list() { return { keys: [], list_complete: true }; },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        if (b.op === 'claim') {
          if (claims.has(n)) return new Response(JSON.stringify({ claimed: false }));
          claims.set(n, 1); return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { claims.delete(n); return new Response(JSON.stringify({ ok: true })); }
        return new Response(JSON.stringify({ allowed: true, value: 0 }));
      } }),
    },
    _claims: claims,
  };
  return env;
}

/* The shape the defect actually destroys: a record with a balance in it. */
const LIVE = JSON.stringify({ balance: 250, lifetime: 900, holds: [{ amount: 40 }] });

section('A record that has never existed still starts empty');
{
  /* The behaviour that must survive the fix. If absence stopped working, every
     first write in the product would fail, so this is not a formality. */
  const env = mkEnv();
  /* Snapshotted, not held by reference. The mutate writes into the same object
     the helper hands it - that is the whole contract of `_withKV`, which saves
     what `load` returned - so keeping the reference would read back the value
     the mutate just set and prove nothing about what it was given. */
  let saw = null;
  const out = await W._withKV(env, 'wallet', 'new@x.z', (rec) => { saw = JSON.stringify(rec); rec.balance = 10; return 'made'; }, { balance: 0 });
  ok(out === 'made', 'the mutate ran', out);
  ok(saw === '{"balance":0}', 'and was handed the empty record, not null', saw);
  ok(JSON.parse(env._map.get('wallet:new@x.z')).balance === 10, 'and the write landed', env._map.get('wallet:new@x.z'));
}

section('A read that failed writes nothing at all');
{
  const env = mkEnv();
  env._map.set('wallet:live@x.z', LIVE);
  env.fail('wallet:');

  let threw = null;
  let mutateRan = false;
  try {
    await W._withKV(env, 'wallet', 'live@x.z', (rec) => { mutateRan = true; rec.balance = 0; }, { balance: 0 });
  } catch (e) { threw = e; }

  ok(threw != null, 'the call fails instead of succeeding on a guess', threw && threw.message);
  ok(threw instanceof W.UnreadableRecordError, 'and says the record could not be read', threw && threw.name);
  ok(/wallet:live@x\.z/.test(String(threw && threw.message)),
     'naming the key, so an operator knows what to look at', threw && threw.message);
  ok(mutateRan === false, 'the mutate never saw a fabricated empty record', mutateRan);

  /* The whole point. */
  ok(env._map.get('wallet:live@x.z') === LIVE,
     'and the live record is exactly as it was - not overwritten with an empty one',
     env._map.get('wallet:live@x.z'));
}

section('The lock is given back, so a blip is not a wedge');
{
  /* The failure mode a fix like this introduces: throwing out of the load while
     holding the claim. Nothing would ever touch that record again until the TTL
     expired, and it would happen during a storage incident - the moment the
     product can least afford a second fault. */
  const env = mkEnv();
  env._map.set('wallet:live@x.z', LIVE);
  env.fail('wallet:');
  await W._withKV(env, 'wallet', 'live@x.z', () => {}, { balance: 0 }).catch(() => {});

  ok(env._claims.size === 0, 'no claim is left held after the failure', [...env._claims.keys()]);

  env.heal();
  const bal = await W._withKV(env, 'wallet', 'live@x.z', (rec) => { rec.balance += 5; return rec.balance; }, { balance: 0 });
  ok(bal === 255, 'and once the store recovers the record works normally again', bal);
}

section('Bytes that will not parse are a record to look at, not one to replace');
{
  /* Corrupt JSON is the same claim as an unreachable store: AMV does not know
     what is in there. Returning `empty` would silently replace it, which is the
     one action that destroys the evidence of whatever went wrong. */
  const env = mkEnv();
  env._map.set('ent:x@y.z', '{"plan":"ultra",,,broken');

  let threw = null;
  try { await W._withKV(env, 'ent', 'x@y.z', (rec) => { rec.plan = 'free'; }, {}); }
  catch (e) { threw = e; }

  ok(threw instanceof W.UnreadableRecordError, 'it refuses rather than parsing past it', threw && threw.name);
  ok(/invalid JSON/.test(String(threw && threw.message)), 'and says why', threw && threw.message);
  ok(env._map.get('ent:x@y.z') === '{"plan":"ultra",,,broken',
     'the unreadable bytes are still there to be looked at', env._map.get('ent:x@y.z'));
}

section('The catch-all that caused it cannot come back');
{
  /* Written against the shape rather than the wording: the load must not have a
     handler that returns the empty value. `empty` may only be reached from a
     genuine null. */
  const i = src.indexOf('async function _withKV');
  const body = codeOnly(src.slice(i, src.indexOf('\n}', src.indexOf('mutate);', i))));
  ok(body.length > 300, 'the helper body was actually read', body.length);

  ok(/throw new UnreadableRecordError/.test(body),
     'a failed read throws', true);
  ok(!/catch\s*\([^)]*\)\s*\{\s*return fresh\(\)/.test(body),
     'and no catch turns a failure back into an empty record', true);

  /* `fresh()` is the empty value. It may be returned from exactly one place:
     the genuine-absence branch. More than one means a second door reopened. */
  const returnsFresh = (body.match(/return fresh\(\)/g) || []).length;
  ok(returnsFresh === 1, 'the empty record is produced in exactly one place', returnsFresh);
  const iNull = body.indexOf('if (raw == null) return fresh()');
  ok(iNull > -1, 'and that place is the genuine-absence check', iNull);
}

if (report('a-read-that-failed-is-not-an-empty-record') > 0) process.exitCode = 1;
done();
