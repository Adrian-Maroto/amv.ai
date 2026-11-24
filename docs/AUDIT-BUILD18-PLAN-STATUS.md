# Build 18 master plan (234 items) - status (Nov 24, 2026)

Source: `AMV18_Master_234_Item_Action_Plan.csv`, the owner's upload of Nov 22.
Every row is accounted for here: done in code with evidence, partly done with
what is left, or not closable from code (it needs the owner, a live service,
or people). Nothing is marked done on the strength of reading code alone -
"evidence" is a suite, a workflow, or a document that states a measured fact.

## How the 234 split

| Group | Items | Where it stands |
|---|---|---|
| Build 16 carried forward - AG, STATE16, SEC, OPS, D16 | 63 | Worked in five lanes (Nov 21); each guard mutation-tested - `docs/TRUST-AUDIT.md`, `docs/BUYING.md`. |
| Build 17 - N17-001..035 (= B17-001..035), D17-001..008 | 43 | `docs/AUDIT-BUILD17-STATUS.md`, row by row. |
| Build 18 - B18-001..030 | 30 | `docs/AUDIT-BUILD18-STATUS.md`, row by row. |
| OWNER-01..44 | 44 | The owner's or the live operator's by definition (accounts, plans, DNS, providers, people, the launch decision). The steps for each are in `GO-LIVE.md`, `docs/KEYS.md` and `docs/OWNER-DECISIONS.md`. |
| FND-01..54 (foundation) | 54 | Below, one by one. |

## FND, one by one

Status: **Done** - in code and measured. **Partly** - the code half is done
and measured; the rest needs what is named. **Owner/live** - not closable
from code.

| Item | Status | Evidence, or what is left |
|---|---|---|
| FND-01 Reproduce the exact build | Done | CI: Node 22 pinned, `npm ci` from the lockfile, PostgreSQL 16, bubblewrap and Chromium installed; `CI=true npm run check` runs every suite and the minified build; the build-fresh stage fails on drift. |
| FND-02 Constrain checkout and autonomous writes | Done | Checkout stays person-operated (`docs/BUYING.md`); every connected-account write goes through the action protocol and is read back (`09a-action-protocol.js`; a write with neither undo nor an irreversible statement stops the Worker starting). |
| FND-03 Inventory every state writer, one authority per domain | Partly | `docs/KV-WRITERS.md`, `docs/DATA-TIER.md`, the "stores nothing writes" gate stage. The single authority (PostgreSQL) needs the owner's database (OWNER-12). |
| FND-04 Identity, membership, money, job and action schemas | Partly | Control-plane schema and mirror (`04a-control-plane.js`), suites `accounts-and-plans-are-written-to-postgres-too` and the pg* suites. Live database: OWNER-12. |
| FND-05 Transactional mutation APIs, fence stale writers | Partly | Revision-checked writes (`04-data-layer.js`, `REV_KINDS`), the Durable Object counter for money. Full transactional cutover needs the database. |
| FND-06 Backfill, change capture, reconciliation | Partly | `04b-pg-backfill.js`, `04c-pg-shadow.js`, `04d-pg-read.js` with their suites; running it needs the database. |
| FND-07 Cut over every writer by domain | Owner/live | Needs the provisioned database and a rehearsal (OWNER-14). |
| FND-08 Reconcile historical credits, refunds, holds | Partly | Opening-balance and reconcile phases (`docs/DATA-TIER.md`); purchase holds close once (`a-purchase-closes-once`). Historical reconciliation runs against live data. |
| FND-09 Persist jobs, runs, actions, approvals, outbox | Done | `15a-job-queue.js` (durable queue with outbox), schedules and approvals (`13-schedules-and-approvals.js`), suites on runs and approvals. |
| FND-10 One typed action authorization at every effect | Done | The action protocol (`09a-action-protocol.js`), `every-route-decides`, `cross-account-writes`, and since Nov 24 `one-account-cannot-reach-anothers-things` (two real accounts, eight domains, proved by breaking two owner checks). |
| FND-11 Provider idempotency and unknown outcomes | Partly | Idempotent holds and settlements (B17-005), unknown outcomes reported not retried (batches: a stale running item is reported, never re-run). Against real providers: OWNER-31. |
| FND-12 Per-action provider contracts and sandbox tests | Partly | Contract checks by fixture (connectors workflow, `every-connected-action-the-app-asks-for-exists`); sandbox accounts: OWNER-23/29. |
| FND-13 Scheduling, timezone, next occurrence | Done | `eight-oclock-is-eight-oclock-every-day`, `a-monthly-job-stays-monthly`, `a-job-runs-when-you-said`. |
| FND-14 Due-time indexing, fair admission, bounded workers | Partly | Hour-bucket index and admission limits in code; lateness at millions of users is a load-test question (FND-37). |
| FND-15 One task/job/run/action state across surfaces | Done | `a-job-connects-runs-and-shows-running`, `crew-shows-what-is-running`, `one-job-runs-once-and-cancel-means-cancel`. |
| FND-16 Centralized memory writes, bound source and destination | Done | Memory lanes of B16 (AG-05..13); `docs/TRUST-AUDIT.md`. |
| FND-17 Complete export and erasure | Done | `account-export`, `account-delete`, `erasure-covers-every-key`, `every-purchase-hold-is-exported-and-erased` (2,351 holds over three pages). |
| FND-18 Tenant/object/action authorization matrix | Done | `one-account-cannot-reach-anothers-things` (Nov 24) plus the static pair above. It found an audit-log line naming a refused attempt as a revocation; fixed. |
| FND-47 Multi-device conflict semantics | Done | Revisions with a base (`baseRev`) on sync; a push nobody can arbitrate is told to the operator once (`a-sync-nobody-can-arbitrate-is-told-once`). |
| FND-19 Upload, extraction, storage, download boundaries | Done | Library refuses programs, macros and disguised files and reads back what it stored (`68-cloud-library.js`); upload suites. |
| FND-20 Retrieval coverage, freshness, isolation, deletion | Partly | Project search and file index are per account and deleted with the file; freshness against real corpora needs live use. |
| FND-21 OAuth and connector lifecycle under real failures | Owner/live | Needs the production OAuth applications (OWNER-23/24). |
| FND-22 Egress, browser, container and bridge isolation | Partly | Bridge fence proved by canary (`bubblewrap` in the gate), DNS-safe outbound (`19-outbound-requests.js`, B17 lane 3). The hosted browser and cloud computer are not enabled (B18-004..007). |
| FND-23 Subscription and payment-event lifecycle | Partly | Webhook signature, duplicate and order suites; the full lifecycle against a Stripe sandbox is OWNER-31. |
| FND-24 Version models, prompts, schemas, budgets | Done | Model catalogue and plan budgets versioned in code; `docs/API-VERSIONS.md`. |
| FND-40 Service identity and popularity provenance | Done | Every catalogue entry carries its Wikidata id, and every order its Chrome UX Report month; `docs/RESEARCH.md` names source and date per list; `docs/COUNTRY-DATA.md`, `docs/CREW-SERVICES.md`. |
| FND-25 Restore the full system in isolation | Partly | `staging-drill` workflow and `27-backup-restore.js`; a full restore needs the owner's staging resources (OWNER-17). |
| FND-26 Immutable, complete, verifiable backups | Partly | `every-night-is-backed-up`; immutability is a storage-account setting (OWNER-15). |
| FND-27 Machine-readable release attestations | Partly | The deploy records what each release contains and its SBOM (`deploy.yml`, CycloneDX); signing it is B18-030 (owner). |
| FND-28 Build once, scan once, deploy exact artifacts | Done | Content-hashed code file with an integrity value; the site check compares every published file byte for byte (`deploy.yml`); `image-scan` workflow. |
| FND-29 Rehearse canary, migrations, rollback | Partly | The Worker releases through a canary and puts the previous version back if not ready (`deploy.yml`, `a-new-version-serves-a-few-before-everybody`); a rehearsal with in-flight work needs staging (OWNER-43). |
| FND-30 Real authority integration tests where doubles mislead | Partly | Real PostgreSQL in CI, the real Worker behind a real browser (`tests/lib/live-backend.mjs`), the shared store now pages like the real one (SEC-14). Real Cloudflare bindings: OWNER-07. |
| FND-31 Outcome-based model and tool evaluations | Partly | `evals/cases.json` (14 graded cases); running them needs the model key (`docs/KEYS.md` step 2). |
| FND-32 Hosting-side review and deploy protections | Owner/live | Repository protections are GitHub settings (OWNER-39). |
| FND-51 License and supplier inventory | Partly | SBOM per release; data sources and their terms in `docs/RESEARCH.md` (Wikidata CC0, Chrome UX Report via crux-top-lists). Supplier commitments are contracts (owner). |
| FND-54 Authorization and erasure after disaster recovery | Owner/live | Needs a restore drill (FND-25). |
| FND-39 Real loading and interaction costs | Done | `the-page-arrives-fast-enough-to-use` (paint with every third party dead, blocking time at 4x CPU), page-weight ceiling, the content-hashed code file (repeat visit 482 -> 217 ms). |
| FND-41 Country, language, timezone as independent preferences | Done | Country saved and shared by Crew, Tasks and Integrations (`_cwSetCountry`), language its own setting with packs per language, schedules in the person's time. |
| FND-42 Responsive, localization and assistive-technology matrix | Partly | `every-control-is-big-enough-to-hit`, `nothing-hides-past-the-right-edge`, label and keyboard suites, 17 languages with critical copy approved, WebKit and Firefox nightly. Real devices and screen readers: B18-025 (people). |
| FND-43 Core journeys with representative new users | Owner/live | People. |
| FND-44 Help, onboarding, limitations, release docs | Done | Help center questions, `GO-LIVE.md`, `docs/CAPABILITIES.md` (each capability built where it says, checked by a gate stage). |
| FND-45 Retire public Marketplace journeys, keep saved work | Owner/live | A product decision; the owner has kept the marketplace with payouts. |
| FND-46 Truthful asynchronous and offline states | Done | "Failures turned into answers" gate stage (`docs/silenced-failures.json`), offline suites. |
| FND-52 Stream interruption, stop, retry, edit, answer actions | Done | Resumable streams (`39-resumable-streams.js`), stop and answer-action suites. |
| FND-33 Owned SLIs and SLOs | Partly | `docs/SLO.md`; measured from live traffic once there is some. |
| FND-34 Correlated, redacted telemetry with retention | Partly | Error reporting with redaction and retention (`17-error-reporting.js`); a telemetry backend is OWNER-35. |
| FND-35 Alerting, incident command, support recovery | Partly | `docs/INCIDENT-RUNBOOK.md`, operator alerts by webhook, `synthetic` workflow; people on call: OWNER-36/37. |
| FND-36 Define and benchmark the launch workload | Owner/live | OWNER-05. |
| FND-37 Ramp, burst, soak, noisy-tenant, failure tests | Owner/live | Needs provisioned infrastructure (OWNER-42). |
| FND-38 Per-feature costs, spend and admission ceilings | Partly | Server-side metering on the one money path, per-plan limits, spending limits; reconciling against invoices needs live billing. |
| FND-50 Independent review of the repaired release | Owner/live | B18-021 (penetration test). |
| FND-53 Abuse controls for costly and effectful features | Done | Rate limits and guards on every costly route (`45-abuse-and-activity.js`, `spending-routes-bounded`, `making-accounts-is-not-free`), `SECURITY-SCAMS.md`. |
| FND-48 Measured cohorts with stop conditions | Owner/live | A launch decision (OWNER-44). |
| FND-49 Incident, support and post-release learning loops | Partly | `LESSONS.md` (every mistake and its rule), the incident runbook; running the loop needs a live service. |

## Counts

Of the 54 foundation items: **20 Done**, **24 Partly** (code half done and
measured), **10 Owner/live**. Every "Partly" names what closes it; none is
waiting on code that could be written now without the resource it names.
