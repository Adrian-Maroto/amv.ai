/* WHO IS STILL HERE WEEKS LATER (retention by signup cohort).

   The funnel counted "came back on another day, ever" - a number that looks
   healthy for a product that loses everybody by week three. This holds the
   cohort table the owner now steers by: of the people who started in a week,
   the share active one, two ... twelve weeks later. Driven through the real
   counter class and the real _markActive, with the clock moved by hand:
     - each person counts once in their start week, and once per later week;
     - a week that has not finished is not reported (not shown as 0%);
     - a record from before this change is not counted into any cohort,
       because its cohort's size was never counted;
     - the table is read in a bounded number of calls. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'retention.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _markActive, _retentionReport, _cohortWeekOf };\n');
const W = await import(harness + '?t=' + Date.now());

function realNamespace() {
  const objs = new Map(); let calls = 0;
  const get = (n) => {
    if (!objs.has(n)) {
      const store = new Map();
      const state = { storage: { async get(k) { return store.get(k); }, async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); }, async deleteAll() { store.clear(); }, async setAlarm() {}, async deleteAlarm() {} } };
      objs.set(n, new W.AMVCounter(state, {}));
    }
    return objs.get(n);
  };
  return { ns: { idFromName: n => n, get: (n) => ({ async fetch(u, init) { calls++; return get(n).fetch(new Request('https://do/c', init)); } }) }, calls: () => calls };
}
const kv = new Map();
const R = realNamespace();
const env = { AMV_COUNTER: R.ns, AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, String(v)); }, async delete(k) { kv.delete(k); },
  async list({ prefix } = {}) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; } } };

/* The clock, moved by hand: `new Date()` does not consult an overridden
   Date.now, so the whole Date is replaced for the length of the run. */
const RealDate = Date;
let fake = null;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(fake == null ? RealDate.now() : fake); }
  static now() { return fake == null ? RealDate.now() : fake; }
}
globalThis.Date = FakeDate;
const realNow = { restore() { fake = null; } };
const START = RealDate.UTC(2026, 9, 5, 10);   // Monday 5 Oct 2026, so the cohort week is that day
const at = (days) => { fake = START + days * 86400000; };
const DAY = 86400000;

section('People are counted into the week they started, and each later week once');
{
  at(0); await W._markActive(env, 'ana@x.com'); await W._markActive(env, 'bo@x.com'); await W._markActive(env, 'cy@x.com'); await W._markActive(env, 'di@x.com');
  at(0); await W._markActive(env, 'ana@x.com');          // same day: nothing more
  at(8); await W._markActive(env, 'ana@x.com'); await W._markActive(env, 'bo@x.com');    // week 1: two of four
  at(9); await W._markActive(env, 'ana@x.com');          // week 1 again: counted once
  at(15); await W._markActive(env, 'ana@x.com');         // week 2: one of four
  at(29); await W._markActive(env, 'cy@x.com');          // week 4: one of four
  /* Somebody whose first-day record is from before this change (a bare date). */
  kv.set('factive:old@x.com', '2026-10-05');
  at(8); await W._markActive(env, 'old@x.com');

  realNow.restore();
  const before = R.calls();
  const rep = await W._retentionReport(env, START + 32 * DAY);
  const reads = R.calls() - before;
  const c = rep.cohorts.find(x => x.week === '2026-10-05');
  ok(c && c.size === 4, 'the week has four people in it - the one from before is not counted', c && c.size);
  const w = (n) => (c.weeks.find(x => x.n === n) || {});
  ok(w(1).pct === 50 && w(1).count === 2, 'week 1: two of four, the repeat visit not counted twice', w(1));
  ok(w(2).pct === 25, 'week 2: one of four', w(2));
  ok(w(3).pct === 0, 'week 3: nobody, and it says 0%, because the week is over', w(3));
  ok(!c.weeks.find(x => x.n === 4), 'week 4 has not finished yet, so it is not reported at all - not shown as a share', c.weeks.map(x => x.n));
  const later = (await W._retentionReport(env, START + 40 * DAY)).cohorts.find(x => x.week === '2026-10-05');
  ok((later.weeks.find(x => x.n === 4) || {}).pct === 25, 'once it has, week 4 is one of four', later.weeks.find(x => x.n === 4));
  ok(reads <= 4 * 16 + 4, 'the whole table is a bounded number of reads (months x shards), not one per cell', reads);
}

section('The week a day belongs to');
{
  ok(W._cohortWeekOf('2026-10-11') === '2026-10-05' && W._cohortWeekOf('2026-10-05') === '2026-10-05' && W._cohortWeekOf('2026-10-12') === '2026-10-12',
    'a Sunday belongs to the Monday before it, a Monday to itself');
}

section('The owner console shows these, not the owner’s own clicks');
{
  const admin = readFileSync(join(ROOT, 'src', 'admin', 'admin.js'), 'utf8');
  const growth = admin.slice(admin.indexOf("else if(tab==='growth')"), admin.indexOf("else if(tab==='growth')") + 4000);
  ok(/live\.retention/.test(growth) && /live\.funnel/.test(growth), 'the Growth tab reads the server’s funnel and cohorts');
  ok(!/_loadLog/.test(growth), 'and no longer builds a funnel from events logged in this browser');
}

report();
done();
