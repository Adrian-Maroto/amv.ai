# Service objectives, and what losing data would cost

What AMV promises itself about staying up and not losing things, written down
before the outage rather than after it (Oct 31 audit, items 56-57 and 78-79).
These are objectives, not customer promises: a number goes into a contract only
after a quarter of measurement shows it is met.

## How it is measured

| Signal | Where it comes from | Since |
|---|---|---|
| Server answers, stores reachable, page loads, source private | `.github/workflows/synthetic.yml`, every 15 minutes from outside Cloudflare (`AMV_SYNTHETIC=on`) | on since Nov 1 |
| Every deploy serves what was built and is ready | `.github/workflows/deploy.yml` (ready check, byte-for-byte publish check) | live |
| Model calls failing, the circuit opening, spend climbing | the audit log and alerts (`model_circuit_open`, the spend alerts at 50/70/85/95%) | live |
| Background work dying | the dead-letter queue alert (`15a-job-queue.js`) | live once `AMV_JOBS` is bound |
| A backup missing or unrestorable | the late-night alert, and `node backup.mjs drill` | live once `AMV_BACKUPS` is bound |

The synthetic probe measures availability from one place every fifteen minutes,
so it can see an outage of more than a few minutes and not a brief one. That
precision suits the objectives below and does not suit a tighter one.
Per-request latency percentiles need request analytics (Workers Analytics
Engine or a log pipeline), which is the owner's to switch on - until then the
latency objectives below are targets, not measurements.

## Objectives

| What | Objective | Measured by | Error budget (30 days) |
|---|---|---|---|
| The site loads | 99.9% of probes | synthetic, "Page loads" | 43 minutes |
| Sign-in and the API answer | 99.9% of probes | synthetic, "Server answers" and "Stores reachable" | 43 minutes |
| A chat answer is delivered whole | 99.5% of answers | measured: every answer counted good or not (`slo` in `/admin/stats`), checked hourly, the owner told when the budget is spent | 0.5% of answers |
| A chat answer starts streaming within 5 s | 99.5% of answers | measured: time-to-first-word buckets by engine, same check | 0.5% of answers |
| A payment's plan arrives | 100% of paid events within 1 hour | the provider's own retries, idempotent on AMV's side; reconciled by the renewal sweep | none: a missed payment is an incident |
| Background work runs | 99% of runs produce their result | measured: every background and agent run counted, same check; dead-letter alerts once the queue is bound | 1% of runs |
| Nothing is served that should not be | 100% | synthetic, "Server source not served"; the deploy's publish check | none |

**When the budget is spent:** no new features ship until the cause is fixed and
the probe has been green for a week. The point of the budget is that this
decision is made in advance, by a rule, not argued during the outage.

## How much can be lost, and for how long (RPO / RTO)

The honest numbers for AMV as it is deployed today, not as it will be:

| Data | Where it lives | Lost in the worst case (RPO) | Back in service (RTO) |
|---|---|---|---|
| Accounts, plans, keys, teams, chats, projects, jobs | Workers KV | **up to 24 hours** - the nightly backup (`27a-nightly-backup.js`) is the only copy outside KV | as long as a restore takes: measure it with `node backup.mjs drill`; reading is the floor, writing every record adds to it |
| Usage counters, revocation epochs, spend | Durable Objects | not in the backup; Cloudflare stores them durably. A lost counter fails closed for revocation and money | immediate once the object answers |
| Payments | the payment provider | none - the provider is the record and re-sends events; AMV applies each once | as soon as the webhook is answered again |
| Uploaded files, cloud workspace | R2 | depends on the bucket; R2 is not versioned here | not restorable beyond what R2 keeps |
| Once Postgres is the record (DATA-TIER step 6) | managed Postgres with point-in-time recovery | the design target: **5 minutes** | the design target: **30-60 minutes** |

The 24-hour RPO is the largest number on this page and the main reason step 6
of `docs/DATA-TIER.md` matters: until accounts and money live in a database
with point-in-time recovery, a bad night can cost a day of sign-ups and plan
changes. Payments are not at risk (the provider re-sends), but the accounts
they belong to are.

## Drills

- **Restore drill, monthly:** `AMV_API_URL=... AMV_ADMIN_TOKEN=... node backup.mjs drill`
  reads the newest complete night through the restore path, writes nothing,
  and fails if the night holds fewer records than its manifest says or any
  record a restore would refuse. Record the time it reports here.
- **Probe drill, after any change to the workflow:** run `synthetic` by hand
  (Actions > synthetic > Run workflow) and read the summary.

| Date | Night read | Records | Read time | Result |
|---|---|---|---|---|
| - | - | - | - | not yet run against production |

## What only the owner can do

Paging a person (an on-call rota and a phone, e.g. PagerDuty or Opsgenie fed
by the failed-workflow email or by Cloudflare notifications), a public status
page, request analytics for latency, and turning the probe on. None of these
can be done from the repository, and each is listed in
`docs/OWNER-DECISIONS.md`.
