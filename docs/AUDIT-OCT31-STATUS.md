# The Oct 31 audit's 110-item roadmap: where each item stands

The audit asked for its section 88 roadmap to be used as the production master
checklist. This is that checklist, item by item, checked against the code on
Nov 1 2026. Every row says what is true now, not what is planned.

**Status words**
- **Done** - built, tested, on main.
- **Built, needs you** - built and tested; it does nothing until the owner
  binds, sets or switches on what the row names (all in `docs/OWNER-DECISIONS.md`).
- **Partial** - part of it exists; the row says which part is missing.
- **Yours** - only the owner can do it (money, accounts, settings, people).
- **Outside** - needs a party outside AMV (a reviewer, an auditor, a lawyer).
- **Not yet** - code AMV can write, not written yet.
- **Not doing** - deliberately not done, with the reason.

## Data tier (Postgres)

| # | Item | Status |
|---|---|---|
| 1 | Provision managed Postgres | Yours |
| 2 | Provision Hyperdrive | Yours |
| 3 | Postgres driver | Done (`postgres` 3.4.9, pinned) |
| 4 | Organizations/workspaces schema | Done (`migrations/postgres/0001_control_plane.sql`) |
| 5 | Multi-team membership | Done (memberships table; teams mirrored) |
| 6 | Currency/payment ledger schema | Done (append-only in the database itself) |
| 7 | Repositories for accounts, plans, teams, keys, money | Done (`04a-control-plane.js`) |
| 8 | Dual-write mode | Built, needs you (the `PG` binding) |
| 9 | Resumable backfill | Built, needs you (`POST /admin/pg/backfill`) |
| 10 | Digest comparison | Done (per-account digest and a full read-back) |
| 11 | Shadow reads | Built, needs you (`PG_SHADOW`) |
| 12 | Staff accounts first | Built, needs you (name them in `PG_SHADOW`) |
| 13 | Progressive migration 1 -> 100% | Built, needs you (`PG_READ`, after the database exists and a clean week of `PG_SHADOW`). Postgres answers accounts and plans for the cohort, written there first, checked against KV after every answer, handed back to KV on any difference or failure |
| 14 | Postgres authoritative | Not yet, on purpose - removing the KV write can only be checked by step 13 running clean at 100% on the real database, which does not exist yet (`docs/DATA-TIER.md`) |

## Security and auth

| # | Item | Status |
|---|---|---|
| 15 | Strong consistency for revocation | Done (revocation object; sensitive routes refuse when it cannot be read) |
| 16 | Fail-closed policy for keys and auth | Done (API keys and sensitive routes fail closed) |
| 17 | Passwords not standing alone at 8 | Done (passkey first; a password alone needs 15) |
| 18 | Argon2id password hashing | Built, needs you (`PASSWORD_PEPPER`). Argon2id does not exist in the Workers runtime and PBKDF2 is capped at 100000 rounds there; what closes the offline-guessing gap instead is a pepper - the hash keyed with a Worker secret the store never holds. Existing passwords move to it at their next sign-in; rotation and a fail-closed missing key are built and tested |
| 19 | External WebAuthn/auth review | Outside |

## Queues, workflows and Tasks

| # | Item | Status |
|---|---|---|
| 20 | Queues | Built, needs you (`AMV_JOBS`, its dead-letter queue) |
| 21 | Email outbox on the queue | Done (Nov 1; the KV record stays the truth) |
| 22 | Webhook processing on the queue | Not doing - the payment provider already re-sends every event until it is answered and AMV applies each once; a second queue would be a second record of the same money, and it is a billing change |
| 23 | Indexing/ingestion on the queue | Not doing - there is no server-side ingestion to move: files are read on the person's device, and files kept in the account are checked as they arrive |
| 24 | Dead-letter queues and replay | Done (a dead job is booked again; a dead email pointer leaves the email for the tick) |
| 25 | Durable workflow engine | Not doing, on purpose - background work already runs on a durable engine of its own: the queue, run leases keyed on the due time, retries with backoff, steps that wait on each other, and each finished step's result kept (26, 27). Moving it onto Cloudflare Workflows would run two engines side by side through the move, for no capability AMV lacks |
| 26 | Long Tasks as durable workflows | Done - a Task is steps that wait on each other, run under leases with retries, survive a failed run, and are cancelled with a reason when what they wait for fails for good (`a-task-in-steps-keeps-going-without-you`) |
| 27 | Task checkpoints | Done at the step: each finished step's result is kept, and a step that fails is picked up again from there - the finished steps are not run again and the retried one starts from their saved results (proved in `a-task-in-steps-keeps-going-without-you`). A step is one model call, which either answers or does not; one cut off at its length limit now says so |
| 28 | Task resume/steering | Done - a chat turn can be steered; a background job or a step of a Task takes a note for its next run (Crew > the job > Note for next run), used once and then never again, checked for credentials like the job itself. A single model call already running cannot be changed mid-answer |
| 29 | Human-approval pauses | Done (approval levels; "waiting for your OK") |

## Cloud computer and browser

| # | Item | Status |
|---|---|---|
| 30 | Workspace storage in R2 | Built, needs you (`WORKSPACES` bucket) |
| 31 | Checkpoint before sleep | Done |
| 32 | Restore on wake | Done |
| 33 | Workspace checksums/versioning | Done - checksums (the bucket refuses an upload that does not match, a restore refuses a copy that does not), and each save keeps the copy it replaces: the five newest are listed on the cloud workspace card and any can be put back; putting one back first keeps what is on the running machine, so it can be undone |
| 34 | Container crash/recovery tests | Partial (the workspace outlives its container; no crash-mid-write test) |
| 35 | Capacity beyond 50 | Yours (`max_instances`, a cost decision) |
| 36 | Wait UI when capacity is full | Done (Nov 1: connecting waits for a free workspace, up to five tries, saying so each time; not a queue with a place in line) |
| 37 | Dynamic computer sizes | Yours - more container sizes are a cost decision (`cloud/wrangler.toml` instance types); the code takes whichever is configured |
| 38 | Persistent cloud browser identity | Done (decision #46: sealed per-agent sign-ins) |
| 39 | Connectors before browser credentials | Done |
| 40 | Isolated profile per Agent | Done |

## Agents

| # | Item | Status |
|---|---|---|
| 41 | First-class persistent Agents | Done (decision #44) |
| 42 | Roles, instructions, memory, tools | Partial - role and instructions; no memory or tool list of its own |
| 43 | Agent budgets | Done |
| 44 | Agent permissions | Partial - each job's approval level; no per-agent permission set |
| 45 | Event subscriptions | Done through its jobs (a job can start from an address another service calls) |
| 46 | Routines | Done (its jobs) |
| 47 | Evidence history | Done (each job's results) |
| 48 | Companion on top of Agent | Not doing for now - your decision #44 keeps agents out of the way until someone keeps one |
| 49 | Multi-agent tool-capable DAG nodes | Partial (steps of a Task can go to different agents) |
| 50 | Parallel researcher/coder/critic patterns | Done - steps run side by side and a step can wait for several; a step can now be the critic (it checks what it waits for against each other - unsourced claims, disagreements, sums, gaps - and answers with what survives), and `pattern: second_opinion` makes one question into two researchers from different angles plus a critic. Chat can ask for a critic step |

## Files, retrieval and research

| # | Item | Status |
|---|---|---|
| 51 | Direct R2 uploads | Not yet - needs R2 API credentials from you to sign upload links; until then files go through the Worker (12 MB at most) |
| 52 | File quarantine/scanning | Partial (Nov 1: a file must be what it says it is; programs and macro-carrying Office files are never kept). An antivirus engine is an outside service, yours to choose |
| 53 | Asynchronous file ingestion | Not doing - as 23: files are read on the device, not ingested by the server |
| 54 | Persistent vector indexing | Partial ("searching by meaning" exists; not a persistent index) |
| 55 | Hybrid lexical/vector retrieval | Partial (project files searched by passage) |
| 56 | Large-scale conversation index | Not yet, on purpose - each person's conversations are one record (at most 4 MB) that every signed-in device already holds and searches; a server index starts paying off when chats become rows per conversation (phase 3 of `docs/DATA-TIER.md`), and built before that it would index a record that is about to change shape |
| 57 | Source states found/read/extracted/cited | Done (the research trail) |
| 58 | Real source logos/previews | Done (kept) |

## Models and money

| # | Item | Status |
|---|---|---|
| 59 | Model health telemetry | Partial (circuit and failure audit events, readiness) |
| 60 | Shared/provider-level failover | Done (Nov 1: a server whose circuit opens tells the others; read at most every five seconds, only when a fallback is configured) |
| 61 | Multi-provider routing | Partial (partner engines; a fallback endpoint) |
| 62 | Negotiate model capacity | Yours |
| 63 | Load shedding / brownout | Done (Nov 1: one owner action pauses the heavy parts) |
| 64 | Fewer Durable Object calls per chat | Partial (switches held, totals sharded) |
| 65 | Production spend ceiling set on purpose | Yours (`GLOBAL_DAILY_USD_CAP`) |
| 66 | Per-provider budgets | Done (Nov 1: `PARTNER_DAILY_USD_CAP` - the second supplier's own daily ceiling, booked, refunded and settled like the others; AMV's own engines are held by the overall ceiling) |
| 67 | Per-Agent budgets | Done |
| 68 | Per-Task budgets | Done (Nov 1: a job's own monthly budget) |

## Launch, docs and operations

| # | Item | Status |
|---|---|---|
| 69 | consumer_full profile mandatory in CI | Built, needs you (`AMV_LAUNCH_PROFILE`) |
| 70 | Rewrite GO-LIVE.md | Done (stage table) |
| 71 | Stale Agent/Companion docs | Done (Agents are real again) |
| 72 | Expand the capability registry | Done (Nov 1: 76 entries, every built one naming its code and test, checked by the gate) |
| 73 | Docs/readiness generated from the registry | Done (Nov 1: `docs/CAPABILITIES.md` is written from the registry on every build; a stale or hand-edited copy fails the gate) |
| 74 | Deep synthetic monitoring | Done (`.github/workflows/synthetic.yml`, on since Nov 1) |
| 75 | External uptime monitor | Done (the same probe, every 15 minutes from GitHub's runners) |
| 76 | Paging/on-call | Yours |
| 77 | Public status page | Yours |
| 78 | SLOs | Done (`docs/SLO.md`) |
| 79 | RPO/RTO | Done (`docs/SLO.md`: up to 24 hours today) |
| 80 | Managed backup strategy | Built, needs you (`AMV_BACKUPS`); point-in-time recovery comes with Postgres |
| 81 | Restore drills | Built, needs you (`node backup.mjs drill`, monthly) |
| 82 | Staging environment | Yours (a second Cloudflare environment) |
| 83 | Canary deployments | Built, needs you (`AMV_CANARY=on`; `scripts/canary-deploy.mjs`: 10% first, readiness asked of the new version itself, old version back if not ready) |
| 84 | Automated rollback | Done (a deployed version that is not ready is rolled back by the deploy workflow) |
| 85 | CodeQL | Done (turned on Nov 1; its first run passed) |
| 86 | Secret scanning / push protection | Done (in the gate, and GitHub's own turned on Nov 1) |
| 87 | SBOM / build provenance | SBOM done (every deploy); provenance needs a pinned attestation action added to the workflow |
| 88 | Container image scanning | Done (`.github/workflows/image-scan.yml`: the cloud computer's image, built as deploy builds it, scanned on every change and weekly; fails on any fixable HIGH or CRITICAL; the image upgrades its OS packages at build) |
| 89 | Load tests at 1K/10K/100K | Partial (`tools/load-probe.mjs`) |
| 90 | Chaos/fault injection | Done (store and model failures never fail open) |
| 91 | Model/prompt eval framework | Done (Nov 1: `npm run evals` - eight cases through AMV's own API, graded by checks that do not depend on wording; costs model credit, so it is run before a change, not on every commit) |
| 92 | Canary model/prompt changes | Done (`--compare`: fails when the new engine loses any case the current one passes) |
| 93 | Trust & Safety operations | Yours (people and process) |
| 94 | Customer-support operations | Yours |
| 95 | Legal/privacy review | Outside |
| 96 | SOC 2 | Outside |
| 97 | Activation funnel analytics | Done (the funnel in the owner digest) |
| 98 | First value in under 3 minutes | Done as a measurement (Nov 1: time from sign-up to the first answer, in the owner digest); making it fast is product work |
| 99 | Companion/routine onboarding | Not doing for now (decision #44) |
| 100 | Native iOS/Android | Yours to decide; not started |
| 101 | macOS/Windows apps | Yours to decide; not started |
| 102 | Push notifications and approvals | Done (VAPID keys set Nov 1; the live readiness reports notifications on) |
| 103 | Image creation/editing | Not doing (decision #45) |
| 104 | Living Docs/Sheets/Slides | Partial (Office files edited in place; the sheet editor) |
| 105 | Enterprise RBAC/group policy | Partial (three team roles; SCIM; company sign-in) |
| 106 | Policy/DLP gateway | Done (Nov 1: a team's data rule, enforced on the server - a message carrying an access key, a private key or a card number is refused before the model is called, naming the kind and never echoing it; a switch on the Team screen) |
| 107 | SIEM/audit export | Done (every team action also kept by day for 400 days; owners and admins download any period up to 92 days as NDJSON, from the Team page or with an API key at `/team/audit/export`; a day past its cap says how many are missing) |
| 108 | Retention/residency controls | Retention done: a person (Settings > Privacy) or a team's owner or admin chooses 30, 90, 180 or 365 days, the shorter wins, and the server enforces it on every sync push and pull and in a nightly sweep, with the app trimming its own copy. Residency is outside the code: the store is Cloudflare's global KV, so a region cannot be promised here |
| 109 | Skills/MCP ecosystem | Partial (connectors from the open registry) |
| 110 | Then competitor parity | - |

## From the audit's other sections

- **Logs at 100% (53):** kept on purpose; the audit agrees for now. Sample
  ordinary successes when traffic passes a million requests a day.
- **"1M context" (41):** no product copy promises it; the size is one server
  constant (`ENGINE_CONTEXT_TOKENS`). Provider-reported capabilities per model
  are not yet read from the provider.

## Counts

Of the 109 items with work in them (110 is "then parity"), as of Nov 1 after
the owner's approval of every item that needed it: **56 done**, **12 built
and waiting on you** (a binding, a setting or a key - including canary
deploys `AMV_CANARY`, the password pepper `PASSWORD_PEPPER` and Postgres
reads `PG_READ`), **15 partial** (each says what is missing; 87 counted here:
SBOM done, provenance not), **13 yours** and **3 an outside party's**
(accounts, money, people, reviews), **8 not done on purpose** with the reason
beside each (22, 23, 25, 48, 53, 56, 99, 103), and **2 not yet**: Postgres
alone (14, which can only be checked once step 13 has run on the real
database) and direct uploads (51, which needs R2 credentials from you).
