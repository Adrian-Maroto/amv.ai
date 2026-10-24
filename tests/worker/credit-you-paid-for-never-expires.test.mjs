/* CREDIT SOMEBODY PAID FOR NEVER EXPIRES - INCLUDING WHILE THEY ARE USING IT.

   Extra usage is two counters, bought and spent, and each carried its own
   400-day timer that its own writes reset. Somebody who bought $50 once and
   used it slowly kept refreshing "spent" and never "bought", so 400 days after
   the purchase "bought" was wiped and the balance went to zero mid-use. The
   reverse lapse - "spent" wiped while "bought" stays - hands the money back
   for free. Either way the number on the screen stopped being what was paid.

   Driven through the REAL Durable Object with its alarms, and a clock moved
   forward by years: what is checked is the balance after the alarms fire. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'creditkeep.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { counter, _creditState, _creditGrant, _reserveUSD, _releaseUSD };\n');
const W = await import(harness + '?t=' + Date.now());

/* Time, moved by hand. */
let now = Date.UTC(2026, 0, 1);
const realNow = Date.now;
Date.now = () => now;
const DAY = 86400000;

/* One real AMVCounter per name, each with storage and an alarm that fires
   when the clock passes it. */
const dos = new Map();
function mkDO() {
  const store = new Map();
  const d = { alarmAt: null };
  const state = { storage: {
    async get(k) { return store.has(k) ? store.get(k) : undefined; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async deleteAll() { store.clear(); },
    async setAlarm(t) { d.alarmAt = t; },
    async deleteAlarm() { d.alarmAt = null; },
    async getAlarm() { return d.alarmAt; },
  } };
  d.obj = new W.AMVCounter(state, {});
  return d;
}
async function passTime(days) {
  now += days * DAY;
  for (const d of dos.values()) if (d.alarmAt != null && d.alarmAt <= now) { d.alarmAt = null; await d.obj.alarm(); }
}
const env = {
  AMV_KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [], list_complete: true }; } },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => { if (!dos.has(n)) dos.set(n, mkDO()); const d = dos.get(n);
      return { fetch: (_u, init) => d.obj.fetch(new Request('https://do/counter', init)) }; },
  },
};
const balance = async (s) => (await W._creditState(env, s)).balance;

section('A pack bought once and used slowly is still there years later');
{
  const s = 'slow@example.com';
  await W._creditGrant(env, { subject: s, email: s, usd: 50, ref: 'pi_slow' });
  ok(await balance(s) === 50, 'fifty dollars of credit', await balance(s));
  /* A little every month for three years: only "spent" is ever written. */
  for (let m = 0; m < 36; m++) {
    await passTime(30);
    await W._reserveUSD(env, 'creditspent:' + s, 0.5, 50, 0, true);
  }
  ok(await balance(s) === 32, 'after three years of slow use, exactly what was not spent is left: $32', await balance(s));
  ok([...dos.values()].every(d => d.alarmAt == null), 'and no credit counter is waiting to be wiped', [...dos.entries()].filter(([, d]) => d.alarmAt != null).map(([n]) => n));
}

section('Credit bought before this change, with the old timer, is rescued the next time it is looked at');
{
  const s = 'early@example.com';
  /* Exactly what the old code wrote: both counters with a 400-day timer. */
  await W.counter(env, 'creditbuy:' + s, { op: 'incr', amount: 25, ttlMs: 400 * DAY });
  await W.counter(env, 'creditspent:' + s, { op: 'incr', amount: 5, ttlMs: 400 * DAY });
  await passTime(200);
  ok(await balance(s) === 20, 'the balance is read', await balance(s));   // this read cancels both timers
  await passTime(400);
  ok(await balance(s) === 20, 'and 600 days after it was bought, it is all still there', await balance(s));
}

section('A spend never hands the money back by outliving its purchase');
{
  const s = 'busy@example.com';
  await W._creditGrant(env, { subject: s, email: s, usd: 10, ref: 'pi_busy' });
  await W._reserveUSD(env, 'creditspent:' + s, 4, 10, 0, true);
  await passTime(900);
  ok(await balance(s) === 6, 'spent stays spent, bought stays bought: $6, not $10 and not $0', await balance(s));
}

section('Everything else keeps its expiry: only paid-for credit is kept');
{
  await W.counter(env, 'usg:someone:2026-01-01', { op: 'incr', amount: 100, ttlMs: 2 * DAY });
  await passTime(3);
  ok((await W.counter(env, 'usg:someone:2026-01-01', { op: 'get' })).value === 0, 'a daily usage counter still lapses on its own', true);
}

Date.now = realNow;
if (report('credit-you-paid-for-never-expires') > 0) process.exitCode = 1;
done();
