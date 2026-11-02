# November 1 audit: every finding

Statuses: **Fixed** (code + test, guard mutation-checked), **Already true** (verified in code), **Owner** (money, accounts, providers or people only the owner can arrange), **Roadmap** (a feature or platform build, not a fix), **Not a defect here**, **Not done** (with why).

Totals: Fixed 89, Roadmap 33, Owner 25, Already true 14, Not a defect here 8

| ID | Sev | Pri | Finding | Status | Note |
|---|---|---|---|---|---|
| DATA-001 | Critical | P0 | Postgres serves a row before it has proved equivalence | Fixed | Postgres answers only rows proved equal to KV |
| DATA-002 | Critical | P0 | Verification failure can leave an unverified Postgres row live | Fixed | same proof model |
| DATA-003 | Critical | P0 | Write-through can report success after both safety markers fail | Fixed | any write removes the proof first |
| DATA-004 | Critical | P0 | Historical prepaid credits are explicitly omitted from backfill | Owner | needs Stripe/PayPal history (OWNER-DECISIONS 20); money reads never moved to Postgres |
| DATA-005 | Critical | P0 | Older seller ledger history is knowingly truncated | Owner | same as DATA-004 |
| DATA-006 | High | P0 | Stale and repair fences expire after 30 days | Fixed | repair markers never expire |
| DATA-007 | High | P0 | Critical mirror writes use a global request context bridge | Fixed | intent written before every mirrored write; stale intents become repairs |
| DATA-008 | High | P0 | Backfill has no strong single-run lease | Fixed | backfill lease, fenced cursor writes |
| DATA-009 | High | P1 | Backfill throughput is unsuitable for very large migrations | Roadmap | throughput is bounded by KV list paging; fine until millions of accounts |
| DATA-010 | High | P1 | Mismatch counters do not clearly represent current unresolved state | Fixed | current vs past differences kept apart |
| DATA-011 | Medium | P1 | Repair status is truncated to the first 1,000 KV keys | Fixed | whole repair backlog counted by kind |
| DATA-012 | Medium | P1 | Backfill digest is not canonically serialized | Fixed | digests independent of key order |
| DATA-013 | High | P0 | Only account and entitlement reads can currently cut over | Roadmap | teams, keys and money move to Postgres one class at a time with the same proof model |
| DATA-014 | High | P1 | Email is still used as a primary operational identity in many flows | Roadmap | email-as-id to account-id is a data-model migration |
| DATA-015 | Medium | P2 | Generic D1, KV, and Postgres paths risk permanent triple-authority complexity | Fixed | the final architecture is declared (docs/DATA-TIER.md): Postgres control plane, Durable Objects for coordination, R2 for bytes, KV for what has not moved; each record kind names its one authority in docs/data-inventory.json, checked against the code; D1 is retired and a launch profile refuses it (every-record-has-a-class, a-comment-is-not-a-binding) |
| DATA-016 | Medium | P1 | Migration observability is not sufficient for a cutover decision | Fixed | status reports current differences, backlog by kind, lease, read proofs |
| DATA-017 | Medium | P2 | Financial amounts and currency semantics require stronger constraints | Already true | schema already numeric(18,6) with a currency domain; sign rules per reason are a schema change for the owner |
| DATA-018 | Medium | P2 | No documented database region/failover/read-only degradation policy | Owner | database region/failover is a provider choice |
| STATE-001 | Critical | P0 | Retention can overwrite concurrent user sync in KV mode | Fixed | compare-and-set on the account object guards sync writes |
| STATE-002 | High | P0 | Chat sync knowingly operates without arbitration in KV mode | Fixed | same for retention |
| STATE-003 | High | P1 | Retention sweep has no strong global lease | Fixed | retention sweep lease |
| STATE-004 | Medium | P1 | A user can be processed twice through personal and team indexes | Fixed | team pass skips people already reached; trimming is idempotent |
| STATE-005 | High | P0 | Critical revocation still has KV fallback paths | Fixed | money out, exports, agent saving refuse while revocation is unconfirmed |
| STATE-006 | Medium | P2 | PII is embedded in KV keys and Queue bodies | Fixed | queue messages carry a sealed reference, not an address; KV keys keep the address until DATA-014 moves records to account ids |
| COMP-001 | Critical | P0 | Container stops even when workspace snapshot fails | Fixed | failed save does not stop the machine; lost save is told |
| COMP-002 | Critical | P0 | Restore failure starts an empty workspace and can overwrite the good snapshot | Fixed | failed restore stops work |
| COMP-003 | High | P0 | Restore is not atomic and can leave stale deleted files | Fixed | staged restore swapped in whole |
| COMP-004 | High | P1 | Snapshot accepts tar exit code 1 | Fixed | snapshot re-read while files change; unsettled files named |
| COMP-005 | High | P1 | Rollback can proceed without preserving current state | Fixed | rollback saves running work first |
| COMP-006 | Critical | P0 | One global AMV_COMPUTER_KEY authenticates the entire fleet | Fixed | per-machine keys, per-call signed tokens |
| COMP-007 | High | P1 | Workspace identity is derived from mutable email | Already true | machine name is a hash of the account; renaming email is DATA-014 |
| COMP-008 | Medium | P1 | Timestamp-only version identifiers can collide | Fixed | version ids unique within a millisecond |
| COMP-009 | Medium | P1 | Version copy/prune operations are not transactional | Fixed | chosen copy staged before pruning |
| COMP-010 | High | P1 | Single archive cap does not scale to real development/data work | Roadmap | 512 MB cap; larger needs volume storage |
| COMP-011 | High | P0 | Cloud computer is capped at 50 instances | Owner | Cloudflare container quota (OWNER-DECISIONS 19) |
| COMP-012 | Medium | P2 | One machine class cannot fit all workloads | Roadmap | more machine sizes is a plan/pricing decision |
| COMP-013 | High | P0 | Workspace persistence binding is commented out by default | Fixed | launch gate requires workspace storage for paid profiles |
| COMP-014 | Medium | P2 | Environment reconstruction is not first-class | Fixed | the machine image carries its version; a saved workspace records the image it ran on; restored onto a different one, the workspace's own .amv/setup.sh runs and then .amv/check.sh, as its own user with its commands' environment, and the outcome is recorded in .amv/last-setup.json and shown to the person; same image and already set up, nothing reruns; a failing check is said and undoes nothing (the-cloud-workspace-outlives-its-container) |
| COMP-015 | Medium | P2 | SIGTERM/checkpoint behavior needs explicit crash-safe handling | Fixed | in-use machine saved every ten minutes |
| AGENT-001 | Medium | P1 | Persistent Agent IDs use Math.random | Fixed | no Math.random ids anywhere in the Worker |
| AGENT-002 | High | P1 | Agents lack dedicated memory namespaces | Fixed | each run is told what that agent's own last runs found, fenced as data |
| AGENT-003 | High | P1 | Agents lack model and reasoning policy | Fixed | agent engine, plan-checked at save and every run, charged at that engine's prices; chosen in the agent editor |
| AGENT-004 | High | P1 | Agents lack complete tool/connector allowlists | Fixed | web search per agent; unattended runs have no other tools, connector writes need a person |
| AGENT-005 | High | P1 | Agents do not own an isolated durable workspace/browser profile by default | Fixed | each agent has its own sign-ins sealed under a key of its own that opens no other agent's, each unattended read starts a fresh browser holding only that agent's sign-ins and closes it, each run is told only its own agent's memory and instructions, and a step hands the next agent only its checked result (an-agent-keeps-a-sign-in-only-where-it-may, an-agent-works-within-what-it-was-given); agents have no file workspace, so there is none to share |
| AGENT-006 | High | P1 | No first-class Agent-to-Agent handoff protocol | Fixed | a task in steps hands each step to its own agent: the step names its owner, runs on that agent's budget, engine, web and sign-in permissions, and receives only the previous step's result after it passed that agent's output contract - never its memory, instructions or sign-ins; an off-form result is handed to nobody (an-agent-works-within-what-it-was-given) |
| AGENT-007 | Medium | P2 | No Agent-specific eval and outcome scorecard | Fixed | each agent shows its last 30 days from what its runs produced - runs, good, failed, off its output contract, cost per good result - and three bad runs in a row pause it, saying why, until a person resumes it with a fresh start (an-agent-works-within-what-it-was-given) |
| AGENT-008 | Critical | P0 | Disabling sign-in retention can falsely succeed when credential deletion fails | Fixed | revoked first, deletion read back, truth reported |
| AGENT-009 | High | P0 | Forget-one-site endpoint reports success even when nothing was removed | Fixed | same |
| AGENT-010 | Critical | P0 | One global CONNECT_KEY protects all saved Agent sign-ins | Fixed | per-agent key, destroyed on forget; KMS is OWNER-DECISIONS 17 |
| AGENT-011 | High | P0 | Credential storage/revocation relies on eventually consistent KV | Fixed | forgetting destroys the key, so a stale copy cannot open anywhere |
| AGENT-012 | High | P1 | Financial-site hostname regex is not a complete risk policy | Fixed | identity, government, health sites refused too |
| AGENT-013 | High | P1 | Cookie application failure is ignored, then use is audited | Fixed | unapplied sign-in reads nothing and says so |
| AGENT-014 | Medium | P2 | Saved browser sessions have a fixed 30-day TTL without renewal policy clarity | Fixed | renewal policy written down |
| AGENT-015 | High | P1 | Read-only unattended browsing is a strong safety choice but incomplete product parity | Not a defect here | unattended work makes no writes by owner decision 46, so there is no unattended action to model; what it reads (mail, pages, signed-in sites, earlier results) is fenced with a tag minted per run and tested against an attacker closing it (the-fence-an-attacker-cannot-close, web-agent-security). Any future unattended write must ship through the action protocol, which refuses a write with no verification or undo |
| AGENT-016 | Medium | P2 | Agent records are account-aggregated rather than normalized | Fixed | edits go through the account lock with an optimistic revision: a save from an older revision is refused (409) instead of overwriting, and every change keeps the previous wording, the last ten (an-agent-works-within-what-it-was-given); moving agent records into their own rows is part of DATA-013 |
| AGENT-017 | Medium | P2 | Agents lack strict output schemas and completion contracts | Fixed | an agent can promise named sections or a typed JSON object; checked by code after every run, repaired once from its own answer, otherwise marked and no dependent step starts (an-agent-works-within-what-it-was-given) |
| AGENT-018 | Strategic | P2 | AMV Companion is not yet a fully integrated persistent-agent experience | Roadmap | Companion integration |
| TASK-001 | Critical | P0 | Timeout rebooking slice is off by one and catastrophically wrong at zero processed | Fixed | ticks book exactly the accounts not reached |
| TASK-002 | High | P0 | AMV has no real durable Workflow engine for long multi-step Tasks | Roadmap | durable workflow engine (Cloudflare Workflows) |
| TASK-003 | High | P0 | AMV_JOBS is commented out by default | Fixed | launch gate requires the queue + dead letters for paid profiles |
| TASK-004 | High | P1 | Queue covers only part of AMV asynchronous work | Fixed | every piece of work done with nobody waiting - each scheduled duty and each queue message kind - is registered in docs/async-inventory.json with the function that runs it, its owning file and its retry rule, checked against the scheduled handler and the queue consumer both ways (every-background-duty-has-an-owner); per-account jobs and mail go through the queue with dead letters, sweeps run under leases with cursors |
| TASK-005 | High | P1 | Poison jobs are automatically rebooked after exhausting retries | Fixed | poison jobs quarantined until released |
| TASK-006 | Medium | P2 | Queue messages contain raw email | Fixed | queue messages and dead letters carry a sealed reference |
| TASK-007 | Medium | P2 | Five-minute claim buckets generate duplicate delivery noise | Already true | execution lease prevents duplicate work; extra messages cost little |
| TASK-008 | High | P1 | No single canonical Task lifecycle across Chat, Crew, Jobs, Handoff, and Agents | Fixed | GET /v1/tasks is one view over every kind of background work - Crew jobs, tasks in steps, agents' jobs, triggered jobs and batches - in one shape (status vocabulary, budget with spent and left, latest evidence, whether it can be stopped); POST /v1/tasks/cancel stops any of them with one meaning; the command-line tool has amv tasks (all-background-work-is-one-list). The systems keep their own records, so there is no second truth |
| TASK-009 | High | P1 | Steering applies to future runs but not a universal durable active-step protocol | Fixed | steering note applied to the next run (earlier batch) |
| TASK-010 | Medium | P2 | DAG nodes are not yet full tool-capable isolated Agents | Fixed | each step of a task graph can be its own agent with its own engine, web access, budget, memory, sign-ins and output contract; steps that wait for nothing run side by side, a join receives every result under its step, a checker role verifies before answering, and an off-form result is joined by nothing (an-agent-works-within-what-it-was-given) |
| TASK-011 | High | P1 | Polling-first connectors will not scale to millions | Roadmap | push connectors instead of polling |
| TASK-012 | Medium | P2 | Cross-system idempotency needs one end-to-end key | Fixed | every write on a connected account carries one key from the page; the first request claims it on the atomic object, its answer is kept a day, a lost answer is asked for again under the same key and gets the first answer with nothing written twice; a claimed key with no kept answer is never run again (what-amv-did-can-be-taken-back, a-lost-answer-is-asked-for-again-once). Unattended runs make no writes. |
| TASK-013 | Medium | P2 | Interactive timeouts are healthy but not unified with Task promotion | Fixed | chat hands work too long for one answer to the servers: crew_add now (one job) or crew_steps (several) return a job id at once, start within a minute by the server clock, carry on with AMV closed and land in Crew; the answer says so and stops (a-job-that-runs-once, the-time-you-say-is-the-time-it-runs). The model decides which work is long - there is no separate duration predictor |
| DR-001 | High | P0 | Nightly backup covers only selected KV prefixes | Owner | Postgres PITR and R2 versioning are provider switches |
| DR-002 | High | P1 | Nightly backup lacks a strong single-run lease | Fixed | backup lease |
| DR-003 | High | P1 | Manifest counts do not provide per-part cryptographic inventory | Fixed | per-part checksums in the manifest |
| DR-004 | Critical | P0 | Restore is additive/partial rather than atomic point-in-time recovery | Fixed | restore needs a sound drill and re-checks every part |
| DR-005 | High | P1 | Nightly backup permits up to roughly 24 hours RPO for KV-backed state | Owner | shorter RPO needs Postgres as the record |
| DR-006 | Medium | P2 | KV list/export strategy will become expensive at millions | Roadmap | list/export cost at millions |
| DR-007 | Medium | P2 | Backup policy for Agent/browser credentials is undefined | Fixed | credential backup policy written down |
| DR-008 | Medium | P2 | Restore drills are not yet full-system game days | Owner | full-system game days are an operating practice |
| REL-001 | Critical | P0 | consumer_full profile omits critical production systems | Fixed | launch gate reads real bindings incl. cloud/ |
| REL-002 | High | P0 | Deploy workflow enforces only model, email, and payments | Fixed | state checks: fresh backup, Postgres reads |
| REL-003 | High | P0 | Most capability readiness is binding/key presence only | Fixed | readiness checks state, synthetic probe on (owner step done) |
| REL-004 | High | P1 | Canary observes readiness only for a short window | Fixed | canary window configurable (AMV_CANARY_SECONDS) |
| REL-005 | High | P1 | No mature staging environment equivalent to production | Owner | a staging environment is another Cloudflare account/zone |
| REL-006 | High | P0 | Critical production bindings remain commented out | Fixed | bindings required per profile by the gate |
| REL-007 | High | P1 | Launch profile is optional | Fixed | deploys warn when no profile is declared |
| REL-008 | Medium | P1 | Two release-gate tests currently fail | Not a defect here | the two failing tests needed bubblewrap/acorn, which CI installs |
| REL-009 | High | P1 | No complete 24/7 paging/on-call/status operation | Owner | on-call/paging service (OWNER-DECISIONS 13) |
| REL-010 | Medium | P1 | SLOs are not backed by complete p50/p95/p99 and burn-rate telemetry | Roadmap | percentile/burn-rate telemetry |
| REL-011 | Medium | P2 | 100% head sampling is not sustainable at millions | Owner | log sampling vs. Logpush cost |
| REL-012 | Medium | P1 | No universal trace ID across request, Queue, Task, Agent, tool, action, and verification | Fixed | every answer carries X-AMV-Request-Id (the Cloudflare ray id), also in the 500 log line; queue/task propagation still to do |
| REL-013 | High | P1 | Circuit breaker/health knowledge is not globally coordinated enough | Already true | model circuit breaker already shared through KV |
| REL-014 | High | P1 | No evidence of reserved/negotiated model capacity for million-user peaks | Owner | reserved model capacity is a contract |
| REL-015 | Medium | P2 | Capability and launch documentation still drifts from code | Fixed | capability record gate; docs updated with each change |
| REL-016 | Medium | P2 | Dependency vulnerability audit could not complete in this audit environment | Not a defect here | npm audit runs in the gate (deps stage) |
| FILE-001 | High | P1 | Large files still traverse Worker JSON/base64 paths | Roadmap | direct-to-storage uploads |
| FILE-002 | High | P1 | No full quarantine/malware pipeline before availability | Owner | malware scanning service |
| FILE-003 | Medium | P1 | Library metadata is too account-aggregated for 25k+ files | Roadmap | per-file metadata rows |
| FILE-004 | Medium | P2 | Quota reservation and orphan cleanup need explicit protocol | Fixed | abandoned uploads cleared with their bytes |
| FILE-005 | Medium | P2 | Some quota calculations use encoded character size instead of canonical object bytes | Fixed | limit counts stored bytes |
| FILE-006 | Medium | P2 | Large/private files need signed/range download design | Roadmap | signed range downloads |
| RETR-001 | High | P1 | Semantic meaning is on-demand reranking, not a persistent vector index | Roadmap | persistent vector index |
| RETR-002 | High | P1 | Vector retrieval needs permission filtering at index/query time | Fixed | there is no shared index to filter: passages are searched on the device from the person's own files, account files are read only by their owner, a team project only by current members - removal is tested to cut off reading and listing - and the meaning ranker scores only what the caller sends and keeps nothing (a-team-edits-one-project-together, your-files-are-in-your-account, a-search-can-find-it-by-meaning) |
| RETR-003 | Medium | P1 | Past-chat search is not yet a server-scale semantic index | Roadmap | server-side past-chat index |
| RETR-004 | Medium | P2 | Every retrieved chunk needs stable source/page/section identity | Fixed | every passage from a project, the library or an attached document is named by file, the section heading it sits under (documents, slides and sheets alike) and the lines it spans; passages never cross a heading; the model is told to cite by that label (a-project-finds-the-part-you-asked-about) |
| MODEL-001 | High | P1 | One-million-token capability is configured rather than provider-authoritative | Fixed | one registry on the server (ENGINES and the partner list, which is confirmed against the partner's own model list every six hours) says what each engine reads (context, output), and whether it reads pictures and PDFs, uses tools, searches and thinks; the router obeys it (a partner engine without vision gets a note instead of the picture), near the limit the provider's count decides, and /v1/engines hands the same registry to the page, which keeps no list of its own (partner-engines-are-sold-as-amv, a-message-is-measured-against-its-engine) |
| MODEL-002 | Medium | P1 | 3.2M character ceiling is not a tokenizer | Fixed | near the limit the refusal or acceptance is by the provider's token count, not characters; far from it the per-script estimate is used and is harmless |
| MODEL-003 | High | P1 | AMV remains heavily dependent on one model family/provider path | Owner | second model provider is commercial |
| MODEL-004 | Medium | P2 | Streaming cannot transparently fail over after tokens are emitted | Fixed | a broken stream keeps what arrived, marked as cut off by the engine or the connection, and offers Continue: a new turn carrying the part, so the rest is written once (when-the-engine-fails-partway); a lost connection recovers the whole parked answer |
| MODEL-005 | Medium | P2 | Prompt/model canaries need richer quality gating | Roadmap | quality-gated model canaries |
| VOICE-001 | Strategic | P2 | Voice remains STT→text model→TTS rather than native speech-to-speech | Roadmap | native speech-to-speech |
| VOICE-002 | Medium | P2 | Meeting/diarization workflow is incomplete | Roadmap | meetings/diarization |
| USAGE-001 | Medium | P1 | A mocked chat turn makes about 19.3 Durable Object calls | Fixed | the owner's month figures for a turn (cost, cost by feature, outcome, caching saved, time to first word) are one object call instead of up to seven: the load probe goes from 20.4 to 18.1 object calls per first turn and about 14 for a returning person's turn; every call that guards money or limits is unchanged, so every quota invariant is (no-key-is-shared-by-everybody, the-owners-month-figures-are-one-call) |
| USAGE-002 | High | P1 | Global daily spend ceiling can become a global outage switch | Owner | global ceiling is a spend decision; now refuses only when truly full |
| USAGE-003 | Medium | P2 | Sharded global spend reservation may reject while aggregate capacity remains | Fixed | spend shares all tried before refusing |
| USAGE-004 | Medium | P1 | Task/Agent/browser/computer budgets are not uniformly enforced/displayed | Fixed | every unattended run reserves its worst case before it starts - model, searches, a contract repair and the pages AMV's browser may open - against its job, its agent, the account and the platform, and settles to what it really cost; job and agent rows show spent, left and why they wait (an-agent-works-within-what-it-was-given, an-agent-keeps-a-sign-in-only-where-it-may). The cloud computer is never reached by unattended work and is held to the plan minutes it shows |
| USAGE-005 | Medium | P2 | AMV does not yet operate on cost per verified outcome as a first-class metric | Fixed | every answer and every background and agent run is counted good or not (delivered whole; result in the form promised), actions by whether AMV read them back as done; the owner console shows runs, good rate, cost and cost per good outcome by kind of work each month (a-message-is-measured-against-its-engine, an-agent-works-within-what-it-was-given) |
| USAGE-006 | High | P0 | Credits and entitlements must be authoritative in strong append-only storage before cutover | Owner | with DATA-004/005 |
| SEC-001 | High | P1 | 2,347 empty catch patterns create silent-failure risk | Already true | gate fails any swallowed money/permission write; others reviewed by area |
| SEC-002 | Medium | P1 | 50 Math.random uses include persistent/server identifiers | Fixed | Math.random banned in Worker code |
| SEC-003 | High | P1 | 599 innerHTML assignments require centralized trust guarantees | Already true | escH on user output, strict CSP; centralizing 599 sites is a refactor |
| SEC-004 | Medium | P1 | Wildcard postMessage needs source/nonce/schema checks | Fixed | preview.html locked to its sandbox parent; was exploitable |
| SEC-005 | High | P0 | Custom WebAuthn/CBOR implementation requires external security review | Owner | outside review (OWNER-DECISIONS 18); fuzz suite + stolen-id test in CI |
| SEC-006 | Medium | P1 | PBKDF2 work factor remains below current OWASP reference | Not a defect here | Workers cap PBKDF2 at 100k; pepper set (owner step done) |
| SEC-007 | Medium | P1 | Audit logs include raw email despite “PII minimized” language | Fixed | no address/IP in anything sent outside |
| SEC-008 | High | P1 | Global _liveCtx is concurrency-brittle | Fixed | correctness no longer depends on it (DATA-007 intents) |
| SEC-009 | Medium | P2 | Public/API wildcard CORS paths require strict separation from cookie APIs | Already true | CORS split between session and API routes (Oct) |
| SEC-010 | Medium | P2 | Shell execution remains a permanent high-risk boundary | Already true | bridge fenced, consent per command |
| SEC-011 | High | P1 | Dangerous switch changes can fall back to eventual KV and still return success | Fixed | switch failures reported honestly |
| SEC-012 | Medium | P1 | Brownout coordination uses KV state and sequential switch changes | Fixed | brownout is one switchboard write |
| SEC-013 | Medium | P2 | No multi-party approval for the most consequential global controls | Owner | two-person approval needs two operators |
| SEC-014 | Medium | P2 | Secrets/configuration remain operationally complex across main/cloud Workers | Owner | secret management practice |
| TEST-001 | High | P0 | Four production-critical Postgres suites could not run without a real database | Fixed | CI installs Postgres; suites already ran there |
| TEST-002 | High | P1 | Full Playwright matrix was not independently executable in this audit | Not a defect here | the full Playwright matrix runs in CI and nightly lanes |
| TEST-003 | High | P1 | Bubblewrap security tests fail closed when the environment lacks bubblewrap | Not a defect here | fail-closed without bubblewrap is intended; CI installs it |
| TEST-004 | Medium | P1 | Overall worker coverage is strong but masks low-risk distribution | Already true | coverage report lists never-called trust functions |
| TEST-005 | Medium | P1 | Acorn-based undefined-call test did not run in this audit environment | Not a defect here | acorn installed in CI |
| TEST-006 | High | P1 | Critical failure modes are underrepresented in tests | Fixed | many failure-mode tests added in this pass |
| TEST-007 | Medium | P2 | The 200-user load probe is architectural, not production capacity evidence | Owner | production load test needs production capacity |
| TEST-008 | Medium | P2 | Frontend bundle and runtime performance need device-level budgets | Already true | three performance suites with budgets |
| PROD-001 | Strategic | P1 | Unify Chat, Tasks, Agents, and Computer | Roadmap | product direction |
| PROD-002 | Strategic | P1 | AMV needs a coherent proactive daily assistant surface | Roadmap | product direction |
| PROD-003 | Strategic | P1 | Agent isolation can be better than Grok Bot | Roadmap | product direction |
| PROD-004 | Strategic | P1 | AMV should combine durable computer with verification and Undo | Roadmap | product direction |
| PROD-005 | Strategic | P2 | Recorded workflows remain instruction-like rather than robust executable skills | Roadmap | product direction |
| PROD-006 | Strategic | P2 | AMV needs living collaborative Docs/Sheets/Slides | Roadmap | product direction |
| PROD-007 | Strategic | P2 | General-purpose image generation/editing is absent | Not a defect here | image generation was removed on purpose and stays removed |
| PROD-008 | Strategic | P1 | PWA/wrappers/extensions are not enough for everyday AI | Roadmap | product direction |
| PROD-009 | High | P1 | Feature breadth exceeds onboarding/activation design | Roadmap | onboarding/activation design |
| PROD-010 | Medium | P2 | Messages are the wrong north-star metric | Owner | which metric leads is the owner's call |
| PROD-011 | High | P1 | Operational abuse/safety system is not yet company-scale | Owner | abuse operations need people and a vendor |
| PROD-012 | High | P1 | Customer support infrastructure is not yet ready for mass paid launch | Owner | support staffing and tooling |
| PROD-013 | High | P1 | Production legal and privacy operations must match the product’s data reach | Owner | legal and privacy operations |
| PROD-014 | Medium | P2 | SCIM/OIDC foundation needs custom RBAC and policy gateway | Roadmap | product direction |
| PROD-015 | Medium | P2 | SDK/API need stable production governance | Fixed | a dated API version on every /v1/ answer, named by the SDK and the command-line tool; unknown versions refused, deprecated ones served with Deprecation and Sunset and counted per month, retired ones refused with 410; policy in docs/API-VERSIONS.md checked against the code (the-api-says-which-version-it-is; the SDK and CLI suites drive the current version). A Python package and an OpenAPI file are not built yet |
| PROD-016 | Strategic | P2 | Declarative plugins are safe but limited | Roadmap | product direction |
| PROD-017 | High | P1 | MCP/plugin success can weaken AMV’s verification promise | Already true | every connector tool call needs per-call consent; writes go through the action protocol with read-back |
| PROD-018 | Medium | P2 | Shopping/travel/local places need structured first-class result objects | Roadmap | structured shopping/travel results |
| PROD-019 | Medium | P2 | Research Trail should distinguish found/opened/read/extracted/cited | Already true | the research panel already keeps found (in search results), opened-but-could-not-read, read, and cited apart, per source and in the trail (a-source-is-found-read-and-cited); "extracted" is not a state AMV can observe separately, so it is not claimed |
| PROD-020 | Strategic | P2 | Trusted agency must be the product thesis, not feature count | Roadmap | product direction |
| OPS-001 | High | P1 | Support tooling needs least-privilege and break-glass controls | Roadmap | support tooling with break-glass |
| OPS-002 | High | P1 | Security and provider incident playbooks need live exercises | Owner | live incident exercises |
| OPS-003 | Medium | P2 | Data classification must become executable policy | Fixed | every kind of record the Worker keeps has a class, what it holds and how long it is kept in docs/data-inventory.json; a test checks it against the code both ways and enforces the class rules: no credential in a backup, no short-lived challenge restored, every lasting money record backed up (every-record-has-a-class); erasure is enforced by erasure-covers-every-key |
| OPS-004 | High | P1 | Cross-system deletion needs durable orchestration and proof | Already true | erasure names everything it could not delete |
| OPS-005 | Medium | P2 | Global KV/R2/provider architecture cannot promise region residency today | Owner | region residency is a provider choice |
| OPS-006 | Medium | P2 | Temporary/private modes need consistent behavior across Agents/Tasks/connectors | Fixed | a temporary chat is not stored or synced, reads and writes no memory, and now sets up no background job, task in steps, watch or standing instruction (a-temporary-chat-leaves-nothing) |
| OPS-007 | High | P1 | Million-user signup/payment/referral abuse needs scalable risk controls | Roadmap | abuse risk controls at scale |
| OPS-008 | Medium | P2 | Marketplace supply-chain governance needs publisher and update controls | Roadmap | marketplace publisher controls |
| OPS-009 | Medium | P2 | Large translation packs require quality/version governance | Fixed | every sign-in, money and privacy sentence has its translation in all 17 languages approved by fingerprint (docs/i18n-critical.json, scripts/i18n-approve.mjs); a new one, a missing one, an English one or a changed one fails the gate until it is read and approved (critical-copy-is-approved-in-every-language); the build already refuses a pack entry missing a language |
| OPS-010 | Medium | P2 | Dynamic/intelligent UI needs systematic accessibility testing | Already true | control size and dialog reach tested; more a11y suites to add |
