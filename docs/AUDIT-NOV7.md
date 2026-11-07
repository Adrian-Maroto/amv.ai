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
| DATA-033 | High | Seller ledger amounts are whole minor units of their own currency. |
| READY-022 | High | The hourly model check asks the cheapest engine for one streamed token, not a model list. |
| CONN-031 | High | A connected-account write without an Idempotency-Key is refused before it reaches the account. |
| LOCK-002 | High | Claims hand back their owner; record and wallet locks release with it, so a late release cannot free a newer holder's lock. |
| AUDIT-010 | Critical | AsyncLocalStorage is imported statically, so every request - the first in an isolate included - holds its own background work. |
| READY-021 | High | The job queue is proved by a round trip each hour (probe sent, stamped on arrival, checked next run). Browser and meaning search remain unexercised: proving them spends real money. |

## Checked, and already bounded

| Id | Why no change |
|---|---|
| QUEUE-014 | A queue outage runs the leftover accounts inline only within the tick's 25-second budget, books the rest for the next tick and alerts - late, not an overload. Removing the fallback would stop everybody's jobs during an outage. |
| REL-022 | The launch gate already refuses `consumer_full` without the job queue (preflight.mjs, LIVE requirements). |

| CONN-032 | Claim (strong object) and result (KV) are separate, but a missing result never re-runs the write: the retry is told AMV may already have done it. |
| CONN-034 | Workers cannot open connections to private networks, so a public name resolving to 10.x/169.254 reaches nothing from the Worker; redirects are re-checked per hop (19-outbound-requests.js). |
| STATE-001 | Retention trims through DB.putIfRev, the same revision guard as sync, and retries on a lost race. |
| AGENT-009 | Forgetting a site the agent does not hold answers 404 not_held (an-agent-keeps-a-sign-in-only-where-it-may). |
| COMP-006 | Same as COMP-022: per-machine keys, per-call tokens, and rotation without downtime. |
| REL-001 | The launch gate's consumer_full profile requires browser, library, meaning, cloud computer, Postgres, job queue, nightly backup and workspaces. |
| READY-025 | /health/ready reports `proved` per capability, and the synthetic workflow fails on any proved=false; 200 means the stores answer, by design, so a monitor reads both. |

| DATA-037 | A revision blob expires only when the usual copy was written; if that write failed the blob is kept with no expiry until a read repairs it. Since STATE-009 a missing committed copy is refused, never answered stale. |
| CONN-033 | Third-party connector tools cannot be verified by AMV, so every call needs the person's consent in chat (CLAUDE.md, connectors) - the contract is consent, not a verification AMV would be inventing. |
| MODEL-022 | Decided against a global breaker (REL-013, Nov 3): one object in front of every chat is a bigger outage than per-isolate health. |
| REL-021 | CI runs the full gate with Postgres 16 and bubblewrap installed (seen in every run's log); WebKit and Firefox run nightly. |

| AGENT-008 | Turning off kept sign-ins or deleting an agent reports 503 `signins_not_forgotten` or `pending` when the forget fails, and queues it (77-agents.js). |
| AGENT-019 | The jar read answers absent, present or unknown (Nov 3); today AGENT-023/024 stop unknown being saved over or shown as none. |
| AGENT-020 | Sign-ins are stamped with the generation they were kept under and are never used after a forget; today AGENT-022 removes a save a forget overtook. |
| STATE-007 | Revision and digest commit together in the object, value first under its own key (Nov 3); today STATE-008/009 close the two proved gaps. |

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
| DR-004, DR-009, DR-011, DR-013 | Atomic point-in-time restore needs an isolated namespace and a binding switch (see DR-012). |
| OPS-020, OPS-021, OPS-022, OPS-024 | On-call and status page, legal and privacy operations, abuse operations, and provider capacity contracts are people and contracts, not code. |
| FILE-031 | Malware scanning needs a scanning provider; uploads are already size-capped, type-checked and opened only in the sandbox. |
| AGENT-011 | Moving credential storage off KV into per-agent Durable Objects is a storage migration; generations, fences and retries already live in the strong object. |

## Blocked by the Postgres cutover gate (Postgres is not the authority yet)

DATA-001, DATA-002, DATA-003, DATA-004, DATA-005, DATA-019, DATA-021, DATA-031, DATA-032, DATA-036: each is a reason Postgres may not answer yet, and the cutover check (`_pgCutover`) refuses while any applies. They matter at cutover, not before.

## Still open (code)

None. Every P0 code item is fixed here, checked as already bounded, or listed above as the owner's or the cutover's.
