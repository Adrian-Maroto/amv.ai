# November 7 audit - where each finding stands

The register is AMV_FINDINGS_REGISTER_2026-11-07.csv in the audit package. This page records what changed since, by id. Every "Fixed here" item has a test that fails when its fix is removed.

## Fixed here

| Id | Severity | What changed |
|---|---|---|
| STATE-008 | Critical | A delete starts a new generation; a commit across a tombstone must name it (07-atomic-counters revCommit/revReset). a-revision-and-its-value-are-one-write. |
| STATE-009 | Critical | A read whose committed copy cannot be found is refused as 503 record_settling, never served stale (04-data-layer _revRead). |
| STATE-010 | Critical | Same fix as STATE-008: an erased record cannot be written back by a writer from before the erasure. |
| DATA-030 | Critical | Writes fence the Postgres proof whenever Postgres is configured, independent of PG_READ. |
| DATA-034 | High | Ledger key reuse reads the existing row back; a different payload is ledger_key_conflict, kept for repair. |
| AGENT-022 | Critical | Generation re-read after the jar write; a save overtaken by a forget is deleted or queued. |
| AGENT-023 | High | A jar that cannot be read is not saved over; an unopenable jar is replaced and audited. |
| AGENT-024 | High | An unknown listing is signInsUnknown; the card keeps Forget on every site. |
| AUTH-021 | Critical | A TOTP setup is spent once before recovery codes are made; the second confirm gets 409 totp_confirmed. |
| AUTH-023 | High | An unopenable TOTP secret is 503 totp_unavailable naming recovery codes and passkeys; owner alerted. |
| COMP-023 | High | A save whose prior copy could not be kept is marked priorNotKept and the screen says so (save still happens). |
| QUEUE-015 | High | Pause and the automations switch are read before each account and each due job (_autoStopNow). |
| REL-020 | High | Asset scan is quote-agnostic and reads the readable bundle; green on minified and --no-minify builds. |
| FIN-024 | High | Transaction ids compare account, amount, currency, kind and provider; a mismatch is refused and alerted. |
| USAGE-011 | High | Unknown credit preference reads as ask (stop for keys); no record stays auto. |
| CONN-030 | Critical | A non-4xx failure on a write returns outcome_unknown and asks the person to look before retrying. |
| COMP-022 | High | The cloud computer's root key rotates without downtime (AMV_COMPUTER_KEY_PREVIOUS); per-machine keys and per-call tokens were already there. Steps in GO-LIVE.md. |
| AUTH-020 | Critical | A passkey credential is claimed, indexed, then written to the account; an account not saved takes its index back. |
| FIN-022 | High | Finance totals are kept per currency; the main figure names its currency and lists the others; totals say they cover the page shown. |
| FIN-023 | High | Amounts use each currency's minor units (zero-, two- and three-decimal) - a 1000-yen charge is 1000 yen. |
| FIN-020 | High | A transaction's id is written first, pending and holding its time, so a retry finishes the same line instead of adding one. |
| LOCK-001 | Critical | A record or wallet lock commits only while its 15-second lease has 4 seconds left; past that it saves nothing and says busy. |
| DATA-038 | High | Cutover readiness reads every page of unfinished mirror writes; too many to count is a blocker. |
| READY-020 | Critical | Same fix as DATA-038. |
| (CI) | - | Mirror writes of one record run in write order; an older copy finishing last no longer deletes newer API keys or members (found by CI). |
| AUTH-022 | High | An account with no factor of its own passes step-up only with a sign-in made in the last ten minutes; otherwise reauth_required. |
| FIN-026 | High | A credit pack's add to the balance carries a once-only key kept with the value, so a retried webhook cannot add it twice. |

## Checked, and already bounded

| Id | Why no change |
|---|---|
| QUEUE-014 | A queue outage runs the leftover accounts inline only within the tick's 25-second budget, books the rest for the next tick and alerts - late, not an overload. Removing the fallback would stop everybody's jobs during an outage. |
| REL-022 | The launch gate already refuses `consumer_full` without the job queue (preflight.mjs, LIVE requirements). |

## Needs an owner decision

| Id | Why |
|---|---|
| AGENT-026 | KMS/HSM envelope root - infrastructure the owner chooses. |
| AGENT-010 | Same as AGENT-026. |
| FIN-025 | Cash payouts stay off; KYC/AML/tax is a provider and legal decision. |
| DR-012 | Restore into an isolated environment needs a second KV namespace and a binding switch at deploy time - the only atomic switch KV has. Meanwhile revocations are held forward, every restore run can be rolled back, and the drill writes nothing. |
| TASK-017 | Cloudflare Workflows adoption is an infrastructure change. |
| FILE-030 | Direct signed R2 uploads need R2 S3 credentials (FILE-001, owner). |
| REL-022 | Which bindings are mandatory is a deploy decision. |

## Still open (code)

Open or partly fixed P0 items not yet changed here:

- AGENT-008 (Critical): Disabling sign-in retention can falsely succeed when credential deletion fails
- AGENT-019 (Critical): Credential read or decrypt failure is misclassified as “nothing is held”
- AGENT-020 (Critical): A watched run can resurrect a sign-in after concurrent revocation
- COMP-006 (Critical): One global AMV_COMPUTER_KEY authenticates the entire fleet
- REL-001 (Critical): consumer_full profile omits critical production systems
- DATA-001 (Critical): Postgres serves a row before it has proved equivalence
- DATA-002 (Critical): Verification failure can leave an unverified Postgres row live
- DATA-003 (Critical): Write-through can report success after both safety markers fail
- DATA-021 (Critical): A mirror write can still disappear when both intent and repair writes fail
- DATA-004 (Critical): Historical prepaid credits are explicitly omitted from backfill
- DATA-005 (Critical): Older seller ledger history is knowingly truncated
- DATA-019 (Critical): Postgres proof and write fence are themselves stored in eventually consistent KV
- DR-004 (Critical): Restore is additive/partial rather than atomic point-in-time recovery
- DR-009 (Critical): Verified backup parts are still applied incrementally to the live authority
- STATE-001 (Critical): Retention can overwrite concurrent user sync in KV mode
- STATE-007 (Critical): The revision actor and the KV value form a split non-atomic authority
- AGENT-009 (High): Forget-one-site endpoint reports success even when nothing was removed
- AGENT-011 (High): Credential storage/revocation relies on eventually consistent KV
- DATA-031 (High): Postgres write-through reports success even when proof publication loses a race
- DATA-032 (Critical): Money ledger mirrors have no durable pre-write outbox
- DATA-033 (High): Seller currency validation assumes two decimal places
- DATA-036 (High): Migration intent and repair records still share the eventually consistent KV failure domain
- DATA-037 (High): Canonical revision blobs expire before all stale paths are impossible
- LOCK-002 (High): Claim ownership is tracked in a mutable process-global map
- DR-011 (Critical): Restore write freeze can fall back to eventually consistent state
- DR-013 (High): Nightly backup does not prove complete recovery across all production data planes
- REL-021 (High): Postgres, browser and OS-sandbox gates are not guaranteed in one reproducible CI matrix
- AUDIT-010 (Critical): Background financial/audit work can fall back to a mutable global request context
- CONN-031 (High): Idempotency keys are not mandatory for every external mutation
- CONN-032 (High): Action claim and result are not stored in one strong transaction
- CONN-033 (High): MCP/plugin mutations do not inherit AMV’s independent verify/Undo contract
- CONN-034 (High): Public-looking DNS names are not fully resolved/reevaluated against private targets
- FILE-031 (High): Uploaded objects lack a complete quarantine and malware-scanning state machine
- READY-021 (High): Critical synthetics do not exercise the real Queue, browser and semantic-search path
- READY-022 (High): Model synthetic proves model listing/configuration rather than a real inference round trip
- READY-025 (High): /health/ready can return HTTP 200 while the consumer product is operationally incomplete
- MODEL-022 (High): Circuit breaker health is per isolate rather than globally coordinated
- OPS-020 (High): 24/7 on-call, paging and public status operations are not fully established
- OPS-021 (High): Broad launch needs completed legal, privacy and data-governance operations
- OPS-022 (High): Model safeguards are not a complete abuse-operations system
- OPS-024 (High): AMV lacks proved commercial capacity for million-user model/browser/computer load
