/* THE DAY'S CEILING IS COUNTED IN SIXTEEN PLACES.

   Scale audit, Oct 26, owner yes. Every model call reserved and settled
   against one counter for the whole platform, and one counter is one actor
   doing one thing at a time - a ceiling on throughput near five hundred calls
   a second. The day's ceiling is now up to sixteen equal shares, one per $20
   of it. Against the REAL AMVCounter class, one object per name:
     - many payers spread across the shares, by who pays;
     - however many reserve at once, the shares together never pass the
       ceiling;
     - a full share spills to two others before anybody is refused;
     - a settle lands on the share that was booked, by name;
     - the owner's total is the sum of every share and the old counter;
     - a small ceiling is one share, so the largest single call still fits. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'sixteen-shares.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { _reserveGlobalUSD, _releaseUSD, _recordSpend, _globalSpendToday, _spendSharesFor, _spendNameFor, todayKey, counter };\n');
const W = await import(harness + '?t=' + Date.now());

function realObjects() {
  const objs = new Map(); const calls = new Map();
  const make = () => { const store = new Map(); return new W.AMVCounter({ storage: {
    async get(k) { return store.has(k) ? store.get(k) : undefined; }, async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); }, async deleteAll() { store.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {}); };
  /* Serialized per object, as the runtime guarantees - and only per object,
     so sixteen shares really are sixteen independent queues. */
  const queues = new Map();
  return { objs, calls, idFromName: n => n,
    get: (n) => ({ fetch: (u, init) => {
      calls.set(n, (calls.get(n) || 0) + 1);
      if (!objs.has(n)) objs.set(n, make());
      const run = () => objs.get(n).fetch(new Request('https://do/counter', init));
      const p = (queues.get(n) || Promise.resolve()).then(run, run); queues.set(n, p.catch(() => {})); return p; } }) };
}
const mkEnv = (cap) => ({ GLOBAL_DAILY_USD_CAP: String(cap), AMV_COUNTER: realObjects(),
  AMV_KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [], list_complete: true }; } } });
const value = async (env, name) => (await W.counter(env, name, { op: 'get' })).value || 0;

section('A $500 ceiling is sixteen shares, and payers spread across them');
{
  const env = mkEnv(500);
  ok(W._spendSharesFor(500) === 16, 'sixteen shares at $500', W._spendSharesFor(500));
  const names = new Set();
  for (let i = 0; i < 200; i++) names.add(W._spendNameFor('person' + i + '@example.com', env));
  ok(names.size === 16, 'two hundred payers land on all sixteen', names.size);
  ok([...names].every(n => new RegExp('^spend:' + W.todayKey() + ':s([0-9]|1[0-5])$').test(n)), 'each named spend:<day>:s<k>', [...names].slice(0, 3));
}

section('However many reserve at once, the total never passes the ceiling');
{
  const env = mkEnv(500);
  const tries = Array.from({ length: 400 }, (_, i) => W._reserveGlobalUSD(env, 'p' + (i % 97) + '@example.com', 2, 500, 86400000));
  const res = await Promise.all(tries);
  const booked = res.filter(r => r.allowed).reduce((n, r) => n + r.reserved, 0);
  const total = await W._globalSpendToday(env);
  ok(total <= 500 + 1e-9, 'the shares together hold no more than $500', total);
  ok(Math.abs(total - booked) < 1e-9, 'and exactly what was granted', { total, booked });
  ok(booked >= 400, 'and most of the room was usable, not stranded by the split', booked);
  const busiest = Math.max(...[...env.AMV_COUNTER.calls.entries()].filter(([k]) => /:s\d+$/.test(k)).map(([, v]) => v));
  ok(busiest < 400, 'no single counter took every call', { busiest, of: 400 });
}

section('A full share spills to two others before anybody is refused');
{
  const env = mkEnv(320);                         // 16 shares of $20
  const who = 'heavy@example.com';
  const own = W._spendNameFor(who, env);
  await W.counter(env, own, { op: 'incr', amount: 20 });   // their own share is full
  const r = await W._reserveGlobalUSD(env, who, 5, 320, 86400000);
  ok(r.allowed && r.name !== own, 'booked on another share', r);
  const r2 = await W._reserveGlobalUSD(env, who, 5, 320, 86400000);
  ok(r2.allowed, 'and again', r2);
}

section('Settled and released on the share that was booked');
{
  const env = mkEnv(500);
  const r = await W._reserveGlobalUSD(env, 'ana@example.com', 0.5, 500, 86400000);
  await W._recordSpend(env, 'ana@example.com', 0.2, 'chat', 'm', { global: r.reserved, globalName: r.name });
  ok(Math.abs(await value(env, r.name) - 0.2) < 1e-9, 'the booked share now holds what it really cost', await value(env, r.name));
  const r3 = await W._reserveGlobalUSD(env, 'ben@example.com', 0.7, 500, 86400000);
  await W._releaseUSD(env, r3.name, r3.reserved, 86400000);
  ok(Math.abs(await W._globalSpendToday(env) - 0.2) < 1e-9, 'a release gives back to the same share, and the day total is right', await W._globalSpendToday(env));
}

section('The owner’s total is every share plus the old counter');
{
  const env = mkEnv(500);
  await W.counter(env, 'spend:' + W.todayKey(), { op: 'incr', amount: 3 });           // booked before this shipped
  await W.counter(env, 'spend:' + W.todayKey() + ':s4', { op: 'incr', amount: 2 });
  await W.counter(env, 'spend:' + W.todayKey() + ':s15', { op: 'incr', amount: 1 });
  ok(Math.abs(await W._globalSpendToday(env) - 6) < 1e-9, '3 + 2 + 1', await W._globalSpendToday(env));
}

section('A small ceiling is one share, so the biggest single call still fits');
{
  ok(W._spendSharesFor(30) === 1 && W._spendSharesFor(50) === 2 && W._spendSharesFor(5000) === 16, 'one share per $20, at least one, at most sixteen',
     [W._spendSharesFor(30), W._spendSharesFor(50), W._spendSharesFor(5000)]);
  const env = mkEnv(30);
  const r = await W._reserveGlobalUSD(env, 'big@example.com', 16, 30, 86400000);
  ok(r.allowed, 'a $16 call is booked against a $30 ceiling', r);
  const r2 = await W._reserveGlobalUSD(env, 'other@example.com', 16, 30, 86400000);
  ok(!r2.allowed, 'and a second one, which would pass $30, is refused', r2);
}

if (report('the-days-ceiling-is-counted-in-sixteen-places') > 0) process.exitCode = 1;
done();
