# November 3 audit: every finding

Statuses: **Fixed now** (code + test this round, guards mutation-checked), **Resolved before** (the audit itself found it resolved in the Nov 3 build), **Owner** (money, providers, accounts or people only the owner can arrange), **Roadmap** (a platform or product build larger than a fix), **Not done yet** (code work not reached this round).

Totals: Roadmap 49, Fixed now 48, Resolved before 39, Owner 29, Partly done 18, Verified here 6

| ID | Sev | Pri | Finding | Audit said | Now | Note |
|---|---|---|---|---|---|---|
| AGENT-008 | Critical | P0 | Disabling sign-in retention can falsely succeed when credential deletion fails | Partially fixed | Fixed now | a forget that cannot fence says so (503); one whose copy is not confirmed gone says pending, and is retried by the cron |
| AGENT-010 | Critical | P0 | One global CONNECT_KEY protects all saved Agent sign-ins | Partially fixed | Owner | per-agent keys exist; a root key held outside the Worker needs a key service (KMS/HSM) - owner choice of provider |
| AGENT-019 | Critical | P0 | Credential read or decrypt failure is misclassified as “nothing is held” | Open | Fixed now | reads answer absent/present/unknown; unknown is fenced and queued, never "nothing held" (an-agent-keeps-a-sign-in-only-where-it-may) |
| AGENT-020 | Critical | P0 | A watched run can resurrect a sign-in after concurrent revocation | Open | Fixed now | a generation in strong storage moves on every forget; a run that began before it keeps nothing |
| COMP-006 | Critical | P0 | One global AMV_COMPUTER_KEY authenticates the entire fleet | Partially fixed | Owner | each machine already has a derived key; the fleet root key in a key service is a provider choice |
| COMP-001 | Critical | P0 | Container stops even when workspace snapshot fails | Partially fixed | Fixed now | same as COMP-016 |
| COMP-002 | Critical | P0 | Restore failure starts an empty workspace and can overwrite the good snapshot | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| COMP-016 | Critical | P0 | After three failed checkpoints AMV deliberately stops and discards the latest workspace state | Open | Fixed now | never stopped with unsaved work: held running, retried each idle window, the person told; stopped only on a save or their discard |
| REL-001 | Critical | P0 | consumer_full profile omits critical production systems | Partially fixed | Owner | the profile requires the state flags, now meaningful; choosing the profile is the owner's |
| DATA-001 | Critical | P0 | Postgres serves a row before it has proved equivalence | Partially fixed | Fixed now | as DATA-019; an unreadable proof means KV answers |
| DATA-002 | Critical | P0 | Verification failure can leave an unverified Postgres row live | Partially fixed | Fixed now | as DATA-019; a mismatch withdraws the proof under its epoch, and a mismatching row is never served regardless |
| DATA-003 | Critical | P0 | Write-through can report success after both safety markers fail | Partially fixed | Fixed now | a failed write-through without a repair entry keeps its intent for the cron |
| DATA-021 | Critical | P0 | A mirror write can still disappear when both intent and repair writes fail | Open | Fixed now | a write whose intent and repair entry both cannot be recorded is refused before it happens |
| DATA-004 | Critical | P0 | Historical prepaid credits are explicitly omitted from backfill | Open | Fixed now | opening row per credit balance, measured against the live counters, written once; reconciled to the cent |
| DATA-005 | Critical | P0 | Older seller ledger history is knowingly truncated | Open | Fixed now | opening row per seller from the wallet balance; reconciled to the cent |
| DATA-019 | Critical | P0 | Postgres proof and write fence are themselves stored in eventually consistent KV | Open | Fixed now | the proof and its fence live in one strongly consistent object per record with an epoch; a comparison can set a proof only under the epoch it began in |
| DR-004 | Critical | P0 | Restore is additive/partial rather than atomic point-in-time recovery | Partially fixed | Fixed now | as DR-009; the atomic point-in-time switch is the Postgres provider's once records live there |
| DR-009 | Critical | P0 | Verified backup parts are still applied incrementally to the live authority | Open | Fixed now | a restore runs only with every change paused (feature:writes, the cron too); each part's previous values are kept first; { rollbackRun } puts every record back |
| TASK-001 | Critical | P0 | Timeout rebooking slice is off by one and catastrophically wrong at zero processed | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| STATE-001 | Critical | P0 | Retention can overwrite concurrent user sync in KV mode | Partially fixed | Fixed now | retention goes through the same commit |
| STATE-007 | Critical | P0 | The revision actor and the KV value form a split non-atomic authority | Open | Fixed now | value written under its own key first, then revision and digest committed together in the object; readers take the copy that matches (a-revision-and-its-value-are-one-write) |
| AGENT-009 | High | P0 | Forget-one-site endpoint reports success even when nothing was removed | Partially fixed | Fixed now | forget-one-site on an unreadable jar is unknown, fenced and queued - not "removed" |
| AGENT-011 | High | P0 | Credential storage/revocation relies on eventually consistent KV | Open | Fixed now | revocation decided by the strongly consistent generation, not the KV record; the stored copy is still in KV, fenced and queued for deletion |
| AGENT-021 | High | P0 | Forget-all can report complete removal after revocation or listing uncertainty | Open | Fixed now | forget-all whose fence or listing failed reports not removed and queues itself to run again |
| SEC-005 | High | P0 | Custom WebAuthn/CBOR implementation requires external security review | Open | Owner | the WebAuthn/CBOR code needs an outside security review |
| DR-001 | High | P0 | Nightly backup covers only selected KV prefixes | Partially fixed | Owner | Postgres point-in-time recovery and R2 versioning are provider settings |
| COMP-011 | High | P0 | Cloud computer is capped at 50 instances | Open | Owner | Cloudflare container instance quota (OWNER-DECISIONS 19) |
| COMP-013 | High | P0 | Workspace persistence binding is commented out by default | Open | Owner | the WORKSPACES bucket binding is the owner's to create and uncomment (DEPLOY.md) |
| COMP-003 | High | P0 | Restore is not atomic and can leave stale deleted files | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| COMP-017 | High | P0 | A workspace snapshot without a valid SHA-256 can still become canonical | Open | Fixed now | a snapshot without a valid SHA-256 is not stored; an old unchecked copy is held back until the person chooses to use it |
| REL-006 | High | P0 | Critical production bindings remain commented out | Partially fixed | Owner | bindings are created in the owner's Cloudflare account, then uncommented |
| REL-002 | High | P0 | Deploy workflow enforces only model, email, and payments | Partially fixed | Owner | set the repository variable AMV_LAUNCH_PROFILE - the deploy then enforces it |
| TASK-002 | High | P0 | AMV has no real durable Workflow engine for long multi-step Tasks | Open | Roadmap | a durable workflow engine (Cloudflare Workflows) for long tasks |
| USAGE-006 | High | P0 | Credits and entitlements must be authoritative in strong append-only storage before cutover | Open | Fixed now | money stays read from the live counters; Postgres money is only "ready" when every balance reconciles (moneyReconciled) |
| DATA-013 | High | P0 | Only account and entitlement reads can currently cut over | Partially fixed | Verified here | decided for API keys: each request reads the edge store and the strongly consistent revocation object; serving them from Postgres would add a proof check and a query to every API request for no gain. Postgres stays their system of record |
| DATA-006 | High | P0 | Stale and repair fences expire after 30 days | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| DATA-007 | High | P0 | Critical mirror writes use a global request context bridge | Partially fixed | Roadmap | mirror writes still use the request-context bridge; the awaited intent is what keeps a died write from vanishing |
| DATA-008 | High | P0 | Backfill has no strong single-run lease | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| TEST-001 | High | P0 | Four production-critical Postgres suites could not run without a real database | Environment-blocked / unverified | Fixed now | the four Postgres suites run against a real Postgres 16 here and in CI (test.yml installs it) |
| DATA-020 | High | P0 | Proof deletion failure after a digest mismatch is swallowed | Open | Fixed now | proof withdrawal is an epoch move; if it fails it is audited, and the row still cannot be served because it does not match |
| TASK-003 | High | P0 | AMV_JOBS is commented out by default | Partially fixed | Owner | AMV_JOBS queue binding |
| REL-003 | High | P0 | Most capability readiness is binding/key presence only | Partially fixed | Fixed now | every configured capability does one real harmless operation hourly (model list, SELECT 1, storage write/read/delete, email domains, Stripe balance); readiness reports proved, the outside probe fails on a broken one (configured-is-not-the-same-as-working) |
| REL-017 | High | P0 | backup_fresh means a status record says done, not that a recoverable backup exists | Open | Fixed now | backup_fresh = signed manifest + every checksum + last part present + a sound drill of that manifest; the cron drills each night |
| REL-018 | High | P0 | postgres_reads_all means 100% cohort, not a clean or complete Postgres cutover | Open | Fixed now | postgres_reads_all = 100% cohort AND nothing in the way; readiness names the blockers and which records Postgres serves |
| STATE-005 | High | P0 | Critical revocation still has KV fallback paths | Partially fixed | Roadmap | revocation is strong with fail-closed routes since Oct 26; the remaining KV reads are listed for the Postgres move |
| STATE-002 | High | P0 | Chat sync knowingly operates without arbitration in KV mode | Partially fixed | Fixed now | chat sync goes through the same commit |
| OPS-004 | High | P1 | Cross-system deletion needs durable orchestration and proof | Partially fixed | Roadmap | durable cross-system deletion orchestration |
| AGENT-013 | High | P1 | Cookie application failure is ignored, then use is audited | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| AGENT-015 | High | P1 | Read-only unattended browsing is a strong safety choice but incomplete product parity | Open | Roadmap | unattended browsing that acts, under approval |
| AGENT-012 | High | P1 | Financial-site hostname regex is not a complete risk policy | Partially fixed | Partly done | money, identity, government and health sites refused by host words; not a complete risk policy |
| AGENT-006 | High | P1 | No first-class Agent-to-Agent handoff protocol | Open | Roadmap | agent-to-agent handoff protocol |
| AGENT-004 | High | P1 | Agents lack complete tool/connector allowlists | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| AGENT-002 | High | P1 | Agents lack dedicated memory namespaces | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| AGENT-003 | High | P1 | Agents lack model and reasoning policy | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| AGENT-005 | High | P1 | Agents do not own an isolated durable workspace/browser profile by default | Partially fixed | Roadmap | an isolated workspace and browser profile per agent |
| SEC-008 | High | P1 | Global _liveCtx is concurrency-brittle | Partially fixed | Fixed now | each request, cron tick and queue batch runs in its own async-local context; background work is held by its own request (background-work-is-held-by-its-own-request) |
| DR-002 | High | P1 | Nightly backup lacks a strong single-run lease | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| DR-003 | High | P1 | Manifest counts do not provide per-part cryptographic inventory | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| DR-010 | High | P1 | Restore-drill freshness is not independently bound to a signed backup manifest | Open | Fixed now | a drill record carries the signature of the manifest it read; readiness and restore need that exact one |
| TEST-002 | High | P1 | Full Playwright matrix was not independently executable in this audit | Environment-blocked / unverified | Verified here | every e2e suite runs in the full gate (Playwright, Chromium); WebKit and Firefox run nightly (browsers.yml) |
| REL-004 | High | P1 | Canary observes readiness only for a short window | Partially fixed | Partly done | canary watch length is a repository variable (AMV_CANARY_SECONDS) |
| TEST-006 | High | P1 | Critical failure modes are underrepresented in tests | Open | Fixed now | every P0 fixed this audit has a regression test that fails on the vulnerable code, each mutation-checked |
| COMP-018 | High | P1 | Computer-call replay prevention is memory-only and tokens are not bound to method or body | Open | Fixed now | call tokens v2: signed over method and body SHA-256; used tokens kept in the object's storage across restarts |
| COMP-019 | High | P1 | Hostname deny patterns are not a complete private-network egress boundary | Open | Roadmap | product direction |
| COMP-004 | High | P1 | Snapshot accepts tar exit code 1 | Partially fixed | Partly done | files still changing after re-reads are named with the copy; tar exit 1 kept for exactly that case |
| COMP-005 | High | P1 | Rollback can proceed without preserving current state | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| COMP-007 | High | P1 | Workspace identity is derived from mutable email | Partially fixed | Roadmap | machine identity moves with the email to account-id migration (DATA-014) |
| COMP-010 | High | P1 | Single archive cap does not scale to real development/data work | Open | Roadmap | larger workspaces need volume storage |
| REL-007 | High | P1 | Launch profile is optional | Partially fixed | Owner | same as REL-002 |
| TASK-005 | High | P1 | Poison jobs are automatically rebooked after exhausting retries | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| SEC-011 | High | P1 | Dangerous switch changes can fall back to eventual KV and still return success | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| REL-005 | High | P1 | No mature staging environment equivalent to production | Partially fixed | Owner | needs a provider, a contract, people or a decision |
| SEC-001 | High | P1 | 2,347 empty catch patterns create silent-failure risk | Open | Fixed now | every empty catch in the 26 trust files says why; six that hid a failed money, sign-out or rollback write now audit it; ceiling on the rest (an-empty-catch-in-trust-code-says-why) |
| TASK-011 | High | P1 | Polling-first connectors will not scale to millions | Open | Roadmap | push connectors instead of polling |
| FILE-002 | High | P1 | No full quarantine/malware pipeline before availability | Open | Owner | needs a provider, a contract, people or a decision |
| FILE-001 | High | P1 | Large files still traverse Worker JSON/base64 paths | Open | Roadmap | direct signed uploads to storage |
| OPS-007 | High | P1 | Million-user signup/payment/referral abuse needs scalable risk controls | Open | Roadmap | abuse risk controls at scale |
| SEC-003 | High | P1 | 599 innerHTML assignments require centralized trust guarantees | Open | Partly done | fuzz poisons every user-named thing on 18 screens and 13 dialogs (catches a removed escape); ratchet on sinks; eval/new Function/allow-same-origin absent; CSP proven to keep injected script inert. Trusted Types enforcement not switched on: Stripe, Google sign-in and Turnstile must be proved under it on staging with live keys first |
| OPS-002 | High | P1 | Security and provider incident playbooks need live exercises | Open | Owner | live incident exercises are people and a schedule |
| PROD-013 | High | P1 | Production legal and privacy operations must match the product’s data reach | Open | Owner | needs a provider, a contract, people or a decision |
| MODEL-001 | High | P1 | One-million-token capability is configured rather than provider-authoritative | Partially fixed | Partly done | one capability record per engine from /v1/engines (Nov 2); provider-pulled limits are next |
| SEC-015 | High | P1 | The shared record mutation helper commits even when a callback returns an error result | Open | Fixed now | a mutate that refuses ({commit:false} or an error with a status or code) writes nothing (a-refusal-writes-nothing) |
| PROD-009 | High | P1 | Feature breadth exceeds onboarding/activation design | Open | Roadmap | onboarding and activation design |
| REL-009 | High | P1 | No complete 24/7 paging/on-call/status operation | Open | Owner | needs a provider, a contract, people or a decision |
| DATA-009 | High | P1 | Backfill throughput is unsuitable for very large migrations | Partially fixed | Roadmap | backfill throughput bounded by KV list paging |
| DATA-014 | High | P1 | Email is still used as a primary operational identity in many flows | Partially fixed | Roadmap | email to account-id is a data-model migration, done with the Postgres move |
| DATA-010 | High | P1 | Mismatch counters do not clearly represent current unresolved state | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| REL-014 | High | P1 | No evidence of reserved/negotiated model capacity for million-user peaks | Open | Owner | needs a provider, a contract, people or a decision |
| REL-013 | High | P1 | Circuit breaker/health knowledge is not globally coordinated enough | Partially fixed | Roadmap | globally coordinated circuit breaking |
| MODEL-003 | High | P1 | AMV remains heavily dependent on one model family/provider path | Open | Owner | needs a provider, a contract, people or a decision |
| TASK-004 | High | P1 | Queue covers only part of AMV asynchronous work | Partially fixed | Roadmap | more async work through the queue |
| DR-005 | High | P1 | Nightly backup permits up to roughly 24 hours RPO for KV-backed state | Open | Owner | a shorter RPO needs Postgres as the record (DR-001) |
| REL-019 | High | P1 | Production readiness does not execute end-to-end capability synthetics | Open | Fixed now | same as REL-003: readiness now carries what was proved, with its age |
| STATE-003 | High | P1 | Retention sweep has no strong global lease | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| TEST-003 | High | P1 | Bubblewrap security tests fail closed when the environment lacks bubblewrap | Environment-blocked / unverified | Verified here | bubblewrap is installed by the session setup and in CI; the fence suites pass in the gate |
| RETR-001 | High | P1 | Semantic meaning is on-demand reranking, not a persistent vector index | Open | Roadmap | persistent vector index |
| RETR-002 | High | P1 | Vector retrieval needs permission filtering at index/query time | Open | Roadmap | ACL-filtered vector retrieval, with RETR-001 |
| USAGE-002 | High | P1 | Global daily spend ceiling can become a global outage switch | Partially fixed | Owner | needs a provider, a contract, people or a decision |
| PROD-012 | High | P1 | Customer support infrastructure is not yet ready for mass paid launch | Partially fixed | Owner | needs a provider, a contract, people or a decision |
| OPS-001 | High | P1 | Support tooling needs least-privilege and break-glass controls | Partially fixed | Fixed now | support sees shape, never content, every look recorded and shown to the person; the one take-everything path (backup export) now pages the owner before a byte is sent. Two-person approval needs a second operator: owner decision |
| SUPPORT-001 | High | P1 | Support-access history is a mutable read-modify-write record, not an append-only audit log | Open | Fixed now | one key a look, written once; nothing rewrites another |
| TASK-008 | High | P1 | No single canonical Task lifecycle across Chat, Crew, Jobs, Handoff, and Agents | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| TASK-009 | High | P1 | Steering applies to future runs but not a universal durable active-step protocol | Partially fixed | Partly done | steering reaches future runs and each step's next prompt |
| PROD-017 | High | P1 | MCP/plugin success can weaken AMV’s verification promise | Open | Roadmap | verification for third-party connector results |
| PROD-011 | High | P1 | Operational abuse/safety system is not yet company-scale | Open | Owner | needs a provider, a contract, people or a decision |
| USAGE-004 | Medium | P1 | Task/Agent/browser/computer budgets are not uniformly enforced/displayed | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| AGENT-001 | Medium | P1 | Persistent Agent IDs use Math.random | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| SEC-007 | Medium | P1 | Audit logs include raw email despite “PII minimized” language | Partially fixed | Fixed now | log lines, the outside collector and analytics carry a keyed HMAC pseudonym, never an address or IP; owner looks one up on the go-live screen, audited (monitoring) |
| SEC-012 | Medium | P1 | Brownout coordination uses KV state and sequential switch changes | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| RETR-003 | Medium | P1 | Past-chat search is not yet a server-scale semantic index | Open | Roadmap | server-side past-chat index |
| COMP-008 | Medium | P1 | Timestamp-only version identifiers can collide | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| COMP-009 | Medium | P1 | Version copy/prune operations are not transactional | Partially fixed | Fixed now | a copy is read back at full size before it counts, and earlier copies are pruned only after it is confirmed |
| TEST-004 | Medium | P1 | Overall worker coverage is strong but masks low-risk distribution | Open | Fixed now | per-file coverage floors (docs/coverage-floors.json) and every trust-area function called, enforced in CI (coverage.mjs --enforce) |
| USAGE-001 | Medium | P1 | A mocked chat turn makes about 19.3 Durable Object calls | Partially fixed | Partly done | month figures are one object call per turn (Nov 2); the limit and money calls remain separate by design |
| FILE-003 | Medium | P1 | Library metadata is too account-aggregated for 25k+ files | Open | Roadmap | one metadata row per file (Postgres) |
| SEC-002 | Medium | P1 | 50 Math.random uses include persistent/server identifiers | Partially fixed | Fixed now | kept ids from crypto.getRandomValues; only a retry jitter uses Math.random |
| SEC-004 | Medium | P1 | Wildcard postMessage needs source/nonce/schema checks | Partially fixed | Fixed now | every window listener checks its sender, and only three posts target any origin - held by a test |
| REL-010 | Medium | P1 | SLOs are not backed by complete p50/p95/p99 and burn-rate telemetry | Partially fixed | Fixed now | objectives measured hourly with error budgets and an alert (Nov 2); time to first word now as p50/p95/p99 from a histogram that no longer ends at 5s (an-objective-is-measured-and-its-breach-said) |
| SEC-006 | Medium | P1 | PBKDF2 work factor remains below current OWASP reference | Open | Owner | Workers cap PBKDF2 at 100,000; the pepper is the mitigation |
| DATA-011 | Medium | P1 | Repair status is truncated to the first 1,000 KV keys | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| DATA-012 | Medium | P1 | Backfill digest is not canonically serialized | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| DATA-016 | Medium | P1 | Migration observability is not sufficient for a cutover decision | Partially fixed | Fixed now | readiness and the backfill status now say what blocks a cutover: phases, differing accounts, unreconciled balances, repairs, unfinished writes |
| REL-008 | Medium | P1 | Two release-gate tests currently fail | Environment-blocked / unverified | Verified here | the full gate is SHIPPABLE on the shipped commit - no release-gate test fails |
| STATE-004 | Medium | P1 | A user can be processed twice through personal and team indexes | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| TEST-005 | Medium | P1 | Acorn-based undefined-call test did not run in this audit environment | Environment-blocked / unverified | Verified here | the undefined-call stage runs in the gate |
| SUPPORT-002 | Medium | P1 | Support tooling lacks case workflow, dual-control break glass, and scoped elevation | Open | Owner | needs a provider, a contract, people or a decision |
| TASK-014 | Medium | P1 | The unified Tasks surface does not include every asynchronous AMV operation | Open | Roadmap | every async operation in the Tasks list |
| MODEL-002 | Medium | P1 | 3.2M character ceiling is not a tokenizer | Partially fixed | Partly done | near the limit the provider's own token count decides (Nov 2) |
| REL-012 | Medium | P1 | No universal trace ID across request, Queue, Task, Agent, tool, action, and verification | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| PROD-002 | Strategic | P1 | AMV needs a coherent proactive daily assistant surface | Strategic roadmap | Roadmap | product direction |
| PROD-004 | Strategic | P1 | AMV should combine durable computer with verification and Undo | Partially fixed | Roadmap | product direction |
| PROD-008 | Strategic | P1 | PWA/wrappers/extensions are not enough for everyday AI | Strategic roadmap | Roadmap | product direction |
| PROD-003 | Strategic | P1 | Agent isolation can be better than Grok Bot | Partially fixed | Roadmap | product direction |
| PROD-001 | Strategic | P1 | Unify Chat, Tasks, Agents, and Computer | Partially fixed | Roadmap | product direction |
| OPS-010 | Medium | P2 | Dynamic/intelligent UI needs systematic accessibility testing | Open | Fixed now | browser accessibility tree on 18 screens and 13 dialogs, both themes: no unnamed control, every dialog named (fixed: the labeller picked the title as the dialog), WCAG AA contrast. A screen-reader pass by a person remains worth doing |
| AGENT-014 | Medium | P2 | Saved browser sessions have a fixed 30-day TTL without renewal policy clarity | Partially fixed | Partly done | renewal and backup policy written (docs/AGENT-SIGN-INS.md); 30-day expiry kept |
| AGENT-017 | Medium | P2 | Agents lack strict output schemas and completion contracts | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| AGENT-007 | Medium | P2 | No Agent-specific eval and outcome scorecard | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| AGENT-016 | Medium | P2 | Agent records are account-aggregated rather than normalized | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| PROD-010 | Medium | P2 | Messages are the wrong north-star metric | Partially fixed | Owner | needs a provider, a contract, people or a decision |
| DR-006 | Medium | P2 | KV list/export strategy will become expensive at millions | Open | Roadmap | list/export cost at millions of records |
| REL-016 | Medium | P2 | Dependency vulnerability audit could not complete in this audit environment | Environment-blocked / unverified | Verified here | the dependency stage runs in check:fast and the gate; CI adds SBOM and CodeQL |
| SEC-009 | Medium | P2 | Public/API wildcard CORS paths require strict separation from cookie APIs | Partially fixed | Partly done | session routes answer their own origin only; API-key and widget routes are open and carry no cookies (Oct 26) |
| COMP-012 | Medium | P2 | One machine class cannot fit all workloads | Open | Roadmap | machine sizes are a plan and pricing decision |
| COMP-015 | Medium | P2 | SIGTERM/checkpoint behavior needs explicit crash-safe handling | Partially fixed | Partly done | a machine in use is saved every ten minutes; a platform stop can lose only minutes |
| COMP-014 | Medium | P2 | Environment reconstruction is not first-class | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| DR-007 | Medium | P2 | Backup policy for Agent/browser credentials is undefined | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| OPS-003 | Medium | P2 | Data classification must become executable policy | Partially fixed | Partly done | every record kind has a class checked against the code (Nov 2); per-class enforcement in more places is next |
| OPS-005 | Medium | P2 | Global KV/R2/provider architecture cannot promise region residency today | Open | Owner | needs a provider, a contract, people or a decision |
| PROD-015 | Medium | P2 | SDK/API need stable production governance | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| DR-008 | Medium | P2 | Restore drills are not yet full-system game days | Open | Owner | full-system game days are people and a schedule |
| REL-015 | Medium | P2 | Capability and launch documentation still drifts from code | Partially fixed | Fixed now | docs may name only files and suites that exist; the capability page lists the settings each one reads, derived from its code on every build, each shown on the go-live screen (a-doc-names-only-what-exists) |
| FILE-006 | Medium | P2 | Large/private files need signed/range download design | Open | Roadmap | signed range downloads |
| PROD-014 | Medium | P2 | SCIM/OIDC foundation needs custom RBAC and policy gateway | Partially fixed | Roadmap | custom RBAC and a policy gateway on top of SCIM/OIDC |
| PROD-018 | Medium | P2 | Shopping/travel/local places need structured first-class result objects | Open | Roadmap | structured shopping, travel and places results |
| FILE-005 | Medium | P2 | Some quota calculations use encoded character size instead of canonical object bytes | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| SEC-013 | Medium | P2 | No multi-party approval for the most consequential global controls | Open | Owner | needs a provider, a contract, people or a decision |
| STATE-006 | Medium | P2 | PII is embedded in KV keys and Queue bodies | Partially fixed | Roadmap | opaque ids in KV keys and queue bodies (with DATA-014) |
| OPS-009 | Medium | P2 | Large translation packs require quality/version governance | Open | Partly done | critical copy approved by fingerprint in 17 languages (Nov 2) |
| TEST-007 | Medium | P2 | The 200-user load probe is architectural, not production capacity evidence | Open | Roadmap | a production-scale load test needs a production-like environment |
| REL-011 | Medium | P2 | 100% head sampling is not sustainable at millions | Open | Roadmap | sampled tracing at scale |
| OPS-008 | Medium | P2 | Marketplace supply-chain governance needs publisher and update controls | Partially fixed | Partly done | operator takedown, seller freeze, installed copies switch off (Nov 2); signed updates not built |
| MODEL-005 | Medium | P2 | Prompt/model canaries need richer quality gating | Partially fixed | Roadmap | a large versioned eval corpus gating model changes |
| TEST-008 | Medium | P2 | Frontend bundle and runtime performance need device-level budgets | Open | Fixed now | low-end phone profile (6x CPU, slow 4G, touch): paint, script, input latency (Event Timing), screen switch and memory budgets; a 500ms keystroke stall fails it |
| DATA-015 | Medium | P2 | Generic D1, KV, and Postgres paths risk permanent triple-authority complexity | Partially fixed | Partly done | one authority per data class written down; D1 retired and refused under a launch profile |
| DATA-018 | Medium | P2 | No documented database region/failover/read-only degradation policy | Open | Owner | needs a provider, a contract, people or a decision |
| DATA-017 | Medium | P2 | Financial amounts and currency semantics require stronger constraints | Partially fixed | Fixed now | currencies table + foreign keys, non-zero and bounded amounts, seller money in whole cents in migration 0002; the Worker checks the same before it sends (a-money-row-is-exact-before-it-is-sent, 5000-case property test) |
| OPS-006 | Medium | P2 | Temporary/private modes need consistent behavior across Agents/Tasks/connectors | Partially fixed | Fixed now | a temporary chat sets up no background work and keeps no memory (Nov 2); publishing a live site, the one keeping tool it allowed, is now refused there too (a-temporary-chat-leaves-nothing) |
| TASK-007 | Medium | P2 | Five-minute claim buckets generate duplicate delivery noise | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| TASK-006 | Medium | P2 | Queue messages contain raw email | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| PROD-019 | Medium | P2 | Research Trail should distinguish found/opened/read/extracted/cited | Partially fixed | Partly done | the research panel keeps found / could-not-open / read / cited apart |
| RETR-004 | Medium | P2 | Every retrieved chunk needs stable source/page/section identity | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| TASK-013 | Medium | P2 | Interactive timeouts are healthy but not unified with Task promotion | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| SEC-010 | Medium | P2 | Shell execution remains a permanent high-risk boundary | Open | Roadmap | shell execution stays fenced and consented; a permanent boundary, not a defect to close |
| SEC-014 | Medium | P2 | Secrets/configuration remain operationally complex across main/cloud Workers | Open | Roadmap | one configuration schema across the main and cloud Workers |
| USAGE-003 | Medium | P2 | Sharded global spend reservation may reject while aggregate capacity remains | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| MODEL-004 | Medium | P2 | Streaming cannot transparently fail over after tokens are emitted | Partially fixed | Partly done | a cut stream keeps its part and offers Continue (Nov 2); transparent mid-stream failover is not possible once tokens are shown |
| TASK-010 | Medium | P2 | DAG nodes are not yet full tool-capable isolated Agents | Open | Roadmap | tool-capable isolated agents as graph nodes |
| TASK-012 | Medium | P2 | Cross-system idempotency needs one end-to-end key | Partially fixed | Partly done | connected-account writes carry one Idempotency-Key end to end (Nov 2) |
| USAGE-005 | Medium | P2 | AMV does not yet operate on cost per verified outcome as a first-class metric | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| FILE-004 | Medium | P2 | Quota reservation and orphan cleanup need explicit protocol | Resolved in Nov. 3 build | Resolved before | resolved in the Nov 3 build |
| VOICE-002 | Medium | P2 | Meeting/diarization workflow is incomplete | Open | Roadmap | meeting mode with diarization |
| PROD-006 | Strategic | P2 | AMV needs living collaborative Docs/Sheets/Slides | Strategic roadmap | Roadmap | product direction |
| PROD-007 | Strategic | P2 | General-purpose image generation/editing is absent | Strategic roadmap | Roadmap | product direction |
| PROD-020 | Strategic | P2 | Trusted agency must be the product thesis, not feature count | Strategic roadmap | Roadmap | product direction |
| PROD-016 | Strategic | P2 | Declarative plugins are safe but limited | Strategic roadmap | Roadmap | product direction |
| AGENT-018 | Strategic | P2 | AMV Companion is not yet a fully integrated persistent-agent experience | Strategic roadmap | Roadmap | product direction |
| PROD-005 | Strategic | P2 | Recorded workflows remain instruction-like rather than robust executable skills | Partially fixed | Roadmap | recorded workflows as executable skills |
| VOICE-001 | Strategic | P2 | Voice remains STT→text model→TTS rather than native speech-to-speech | Strategic roadmap | Roadmap | product direction |
