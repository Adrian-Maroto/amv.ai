# Due work at scale: how a scheduled job is found, and what it takes past a million accounts

Written Nov 21 for Build 16 audit OPS-07. The code is `src/worker/15-run-context-and-execution.js`
(`_autoBucketAdd`, `_autoDueCandidates`, `_autoSweep`, `runDueAutomations`) and
`src/worker/15a-job-queue.js` (the AMV_JOBS queue).

## How it works today

1. **Every write of an automation record books its soonest due time** into an hour bucket,
   `duehour:<YYYY-MM-DDTHH>:<shard>`, 16 shards by a hash of the account. One place does
   this (`_withAuto`), so no caller can forget it.
2. **Each tick reads the current hour and the two before it** (48 reads), loads only the
   accounts those buckets name, and runs what is due, most overdue first, inside a time
   budget. What it cannot reach is booked into the current hour and leads the next tick.
3. **The index is a hint, never a reason to skip.** An empty or unreadable index means
   "read properly". Underneath it, a paged sweep (`_autoSweep`, 4 pages of 500 records per
   tick, resuming from a cursor) walks every automation record and books what is due soon,
   so a lost booking is found within one pass.
4. **With AMV_JOBS bound**, each due account is sent as a message and runs in a consumer of
   its own; only what could not be sent runs inside the tick.

## Where it stops being enough

| Limit | Value | What happens past it | Seen how |
|---|---|---|---|
| Accounts per hour shard | 20,000 (`AUTO_BUCKET_MAX`) | the oldest bookings in that hour are dropped; those jobs wait for the sweep | **alert** `THE DUE-WORK INDEX IS FULL` + audit `auto_bucket_overflow` (Nov 21) |
| Accounts per hour, all shards | 320,000 | as above, across shards | same alert, per shard |
| Sweep pace | 2,000 records per tick | at 1,000,000 accounts one pass is ~500 ticks (~42 h at 5 min) - a dropped booking can be that late | lateness below |
| Tick budget, queue unbound | `AUTO_TICK_BUDGET_MS` | due accounts are deferred, most overdue first | **alert** `THE AUTONOMOUS TICK IS OUT OF TIME` + audit `auto_tick_deferred` |
| Oldest due work | - | every run can succeed while this grows | **`lateS`** in the tick's summary (seconds the most overdue job waited; logged with `[cron] automations`) |

Nothing here loses a job outright: the sweep reaches every record. What grows is lateness,
which is why the two alerts and `lateS` exist - lateness that nobody can see becomes "my job
stopped running".

## The plan, in order

1. **Bind AMV_JOBS** (owner: it is a Cloudflare Queues resource and a cost line; the
   `wrangler.toml` block is written and commented, with the dead-letter queue). This removes
   the tick budget as a limit: the tick only finds and sends, consumers run. *Owner decision.*
2. **Raise `AUTO_BUCKET_SHARDS` from 16 to 64** once the overflow alert has fired once, or
   before 250,000 accounts with jobs - whichever is first. Reads per tick go 48 -> 192, still
   flat in the number of accounts. Code change only; a deploy reads new and old shard counts
   for one lookback window (3 h), so it is a two-step change, not a flag.
3. **Pace the sweep by population**: pages per tick from the record count, so one pass stays
   under 6 hours at any size. Code change; KV `list` cost rises with it, which is the trade.
4. **A durable due-time index** (one row per job and due time, claimed with a lease) replaces
   the hour buckets when (1)-(3) stop holding - by measurement, not by date. It belongs in the
   accounts database the data-tier plan names (`docs/DATA-TIER.md`), not in a new store. Each
   claim carries the job's id and revision, so a repeat delivery is recognised and does
   nothing twice; runs are already idempotent per due time (`next` moves under the lock).
   *Owner decision: it is a schema change.*

## Lateness objective

Proposed, for the owner to adopt into `docs/SLO.md`: 99% of due jobs start within 10 minutes
of their due time; `lateS` above 1,800 on three ticks in a row is a page. Not adopted yet -
an objective nobody has agreed to is a number, not a promise.

## Tested

`tests/worker/nothing-is-skipped-in-silence.test.mjs`: a full hour bucket stays bounded,
keeps the newest booking and pages once; a bucket with room pages nobody; the tick reports
how late its most overdue job was; and the existing sections - most overdue first, stop on
purpose, nobody starved.
