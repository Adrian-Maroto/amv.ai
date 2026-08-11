/* THE CRON READ EVERY ACCOUNT IN THE PRODUCT, EVERY FIVE MINUTES.

   The tick opened with a scan of every `auto:` record - one read per account
   that has ever created an automation, whether or not anything was due. An
   earlier fix removed the two EXTRA lookups per user and left the base scan
   in place, so the cost still scaled with the population rather than with the
   work. At a million such accounts that is twelve million reads an hour to
   discover that nothing needs doing, and the bill arrives whether anybody's
   job runs or not.

   The work is due-driven. The cost was population-driven. Nothing about it
   fails - every job runs, every result is correct - so the only place it shows
   up is the invoice, and then only once the population is large enough that it
   is expensive to fix.

   So the accounts with work due in an hour are written down when the due time
   is set, sharded sixteen ways so job creation does not contend on one record,
   and the tick reads those buckets. What has to stay true, and is checked here:

     - the tick's cost stops growing with accounts that have nothing due;
     - every job that IS due still runs, which is the thing that must not be
       traded for the saving;
     - work that was deferred, or skipped because the day's ceiling was full,
       keeps its place - otherwise "the tick ran out of time" quietly becomes
       "your job did not run for an hour";
     - an empty index and an index that was never built are told apart, because
       the first means nothing is due and the second means everything is
       invisible;
     - and a full sweep still happens every hour, as the floor under all of it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody, codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ticksize.harness.mjs');
writeFileSync(harness, src +
  '\nexport { runDueAutomations, _autoBucketAdd, _autoDueCandidates, _autoHourKey, _autoShardOf,' +
  ' AUTO_BUCKET_SHARDS, AUTO_BUCKET_LOOKBACK_H, DB };\n');
const W = await import(harness + '?t=' + Date.now());

/* A pinned clock. The tick sweeps in the first five minutes of every hour, so
   a check that does not say WHEN it is running measures a different thing
   depending on when somebody runs it. */
const at = (h, m) => { const d = new Date(); d.setUTCHours(h, m, 0, 0); return d.getTime(); };

let reads = 0;
function mkEnv() {
  const store = new Map();
  reads = 0;
  return {
    _store: store,
    AMV_KV: {
      async get(k) { reads++; return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, String(v)); },
      async delete(k) { store.delete(k); },
      async list({ prefix, cursor, limit }) {
        const all = [...store.keys()].filter(k => k.startsWith(prefix || '')).sort();
        const start = cursor ? all.indexOf(cursor) + 1 : 0;
        const slice = all.slice(start, start + (limit || 1000));
        const complete = start + slice.length >= all.length;
        return { keys: slice.map(name => ({ name })), list_complete: complete,
                 cursor: complete ? undefined : slice[slice.length - 1] };
      },
    },
  };
}

/* Accounts with a job that is NOT due for hours - the population this used to
   be charged for. */
async function seedIdle(env, n, nowMs) {
  for (let i = 0; i < n; i++) {
    const em = 'idle' + i + '@x.com';
    const next = (nowMs || Date.now()) + 8 * 3600000;
    await W.DB.put(env, 'ent', em, { plan: 'pro' });
    await W.DB.put(env, 'auto', em, {
      items: [{ id: 'j', active: true, detail: 'later', next, interval: 86400000, approval: 'suggest' }],
      results: [],
    });
    await W._autoBucketAdd(env, em, next);
  }
}

section('The buckets round-trip, which everything below depends on');
{
  const env = mkEnv();
  await W._autoBucketAdd(env, 'A@X.com', Date.now());
  const c = await W._autoDueCandidates(env, Date.now());
  ok(c && c.has('a@x.com'), 'an account written for this hour is found in it', c && [...c]);
  ok(W.AUTO_BUCKET_SHARDS >= 8, 'and the hour is sharded, so job creation does not contend on one record',
     W.AUTO_BUCKET_SHARDS);
  const shards = new Set(['a@x.com', 'b@y.com', 'c@z.com', 'd@w.com', 'e@v.com'].map(W._autoShardOf));
  ok(shards.size > 1, 'different accounts land on different shards', [...shards]);
}

section('An hour with nothing due costs a fixed handful of reads');
{
  /* THE MEASUREMENT. Twenty idle accounts and a hundred and twenty idle
     accounts, at a minute where no sweep is due, must cost the SAME - because
     none of them has work. Before, the second cost six times the first. */
  const quiet = at(9, 30);   // not in the first five minutes: no sweep
  const run = async (n) => {
    const env = mkEnv();
    await seedIdle(env, n, quiet);
    /* Seeded, so an empty bucket is believed rather than treated as an index
       that was never built. */
    env._store.set('dueseeded', String(Date.now()));
    const before = reads;
    await W.runDueAutomations(env, quiet);
    return reads - before;
  };
  const small = await run(20);
  const large = await run(120);
  ok(large - small <= 5,
     'a hundred more idle accounts cost almost nothing more', { small, large, growth: large - small });
  const ceiling = (W.AUTO_BUCKET_LOOKBACK_H + 1) * W.AUTO_BUCKET_SHARDS + 10;
  ok(large <= ceiling,
     'and the whole tick is bounded by the index, not by the population', { large, ceiling });
}

section('Everything that IS due still runs');
{
  /* The saving is worthless if it costs a job. Fifty accounts, ten of them
     overdue, and all ten have to run. */
  /* Everything here is relative to the pinned clock, so "overdue" means
     overdue at the moment the tick believes it is running. */
  const NOW = at(9, 30);
  const env = mkEnv();
  await seedIdle(env, 40, NOW);
  for (let i = 0; i < 10; i++) {
    const em = 'due' + i + '@x.com';
    const next = NOW - 60000;
    await W.DB.put(env, 'ent', em, { plan: 'pro' });
    await W.DB.put(env, 'auto', em, {
      items: [{ id: 'j', active: true, detail: 'now', next, interval: 86400000, approval: 'suggest' }],
      results: [],
    });
    await W._autoBucketAdd(env, em, next);
  }
  env._store.set('dueseeded', String(Date.now()));
  const r = await W.runDueAutomations(env, NOW);
  ok(r.queued === 10, 'exactly the ten with work are queued', r.queued);
  ok(r.ran === 10, 'and all ten run', { ran: r.ran, failed: r.failed });
}

section('An index that was never built is not mistaken for an empty one');
{
  /* The dangerous confusion. Both look like "no candidates" and they mean
     opposite things: nothing is due, or every automation that predates this
     index is invisible. Told apart by a marker the first full sweep writes -
     so an account with no bucket still runs, and self-heals on the way. */
  const env = mkEnv();
  const em = 'old@x.com';
  const next = Date.now() - 60000;
  await W.DB.put(env, 'ent', em, { plan: 'pro' });
  await W.DB.put(env, 'auto', em, {
    items: [{ id: 'j', active: true, detail: 'now', next, interval: 86400000, approval: 'suggest' }],
    results: [],
  });
  /* Deliberately NOT bucketed - this is what everything written before the
     index looks like. */
  ok(!env._store.has('dueseeded'), 'nothing has swept yet', true);
  const r = await W.runDueAutomations(env);
  ok(r.ran === 1, 'an automation with no bucket entry still runs', { ran: r.ran, queued: r.queued });
  ok(env._store.has('dueseeded'), 'and the sweep records that the index can now be trusted', true);

  /* Having run, it is in a bucket for its NEXT occurrence, so it never needs
     the slow path again. */
  const after = await W.DB.get(env, 'auto', em);
  const nextAt = after.items[0].next;
  const cands = await W._autoDueCandidates(env, nextAt);
  ok(cands && cands.has(em), 'it joined the fast path by running once', cands && [...cands]);
}

section('A truncated sweep does not license skipping the rest');
{
  /* A scan that stopped short has NOT seen everything, so it must not be the
     thing that says an empty bucket can be believed. */
  const sweep = codeOnly(functionBody(src, 'runDueAutomations'));
  ok(/if \(!s\.truncated\)[\s\S]{0,120}dueseeded/.test(sweep),
     'the marker is only written when the scan was complete', true);
}

section('Deferred work keeps its place');
{
  /* Running out of time is a busy minute. Losing the work is a customer whose
     nightly job did not run and nothing anywhere saying why - and with a
     due-time index that is exactly what happens if a deferred account is not
     put back, because nothing re-set its due time. */
  const tick = codeOnly(functionBody(src, 'runDueAutomations'));
  const i = tick.indexOf('AUTO_TICK_BUDGET_MS');
  const window = tick.slice(i, i + 700);
  ok(/_autoBucketAdd/.test(window),
     'the accounts that did not get their turn go back into this hour', true);

  /* And the same for a skip, RUN rather than read. A source grep for the call
     passes on a call that iterates nothing, which is exactly the shape a
     careless edit leaves - so the day's ceiling is filled for real and the
     bucket is inspected afterwards. */
  const NOW = at(9, 30);
  const env = mkEnv();
  const em = 'capped@x.com';
  const next = NOW - 60000;
  await W.DB.put(env, 'ent', em, { plan: 'free' });
  await W.DB.put(env, 'auto', em, {
    items: [{ id: 'j', active: true, detail: 'now', next, interval: 86400000, approval: 'suggest' }],
    results: [],
  });
  await W._autoBucketAdd(env, em, next);
  env._store.set('dueseeded', String(Date.now()));
  /* The day's ceiling, already spent. */
  env.GLOBAL_DAILY_USD_CAP = '10';
  env._store.set('ctr:spend:' + new Date(NOW).toISOString().slice(0, 10), '9999');

  const r = await W.runDueAutomations(env, NOW);
  ok(r.ran === 0, 'the job is skipped while the ceiling is full', { ran: r.ran });
  /* Still findable, so the next tick tries again rather than waiting for the
     hourly sweep. An entry is not consumed by being read - the bucket names
     who to LOOK at, and looking is what just happened - so what this proves is
     that a skip does not remove it and does not move it out of reach. */
  const stillThere = await W._autoDueCandidates(env, NOW);
  ok(stillThere && stillThere.has(em),
     'and it is still in the fast path for the next tick', stillThere && [...stillThere]);
  /* And an hour later it is STILL reachable, because a skip re-books it into
     the hour it was skipped in rather than leaving it in a bucket that has
     scrolled out of the lookback. */
  const laterR = await W.runDueAutomations(env, NOW + 3600000);
  ok(laterR.queued >= 1, 'an hour later it is still being tried', laterR.queued);
}

section('A full sweep still happens every hour');
{
  const tick = codeOnly(functionBody(src, 'runDueAutomations'));
  ok(/getUTCMinutes\(\) < 5/.test(tick),
     'the floor under every way a bucket can be wrong is still there', true);
  ok(/scan\(env, 'auto', SCAN_ALL/.test(tick),
     'and it is the same complete scan as before', true);
}

if (report('the-tick-costs-what-is-due-not-who-exists') > 0) process.exitCode = 1;
done();
