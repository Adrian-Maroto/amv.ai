# November 3 audit: what changed

Every finding, with its status, is in `docs/AUDIT-NOV3-ALL.md`. This page is
the short version.

**The 19 critical findings the audit left open or partly fixed:** 16 are fixed,
each with a test that was checked by breaking the guard and watching it fail.
The other 3 need the owner: a key service to hold the root key for agent
sign-ins and the cloud computer (AGENT-010, COMP-006), and choosing the launch
profile (REL-001).

**The 41 P0 findings left open or partly fixed:** 26 are fixed, 10 need the
owner, and 5 are platform builds (moving API keys, teams and money reads to
Postgres; per-capability external synthetics; a durable workflow engine).

## The principle, applied

The audit's main finding was that a safety mechanism cannot rely on weaker
consistency than the state it protects. Each place it named now keeps its
deciding fact in strongly consistent storage:

| Was in KV (eventually consistent) | Now |
|---|---|
| The proof that a Postgres row equals its record, and the fence that removes it | One object per record with an epoch; a proof is set only under the epoch its comparison began in |
| A forgotten agent sign-in's revocation | A generation on the agent's own object; a run that began before a forget keeps nothing |
| A synced record's revision (object) and its value (KV), written separately | Value written under its own key first, then revision and digest committed together |
| Migration intent and repair, best effort | A write that cannot record either is refused |
| "Backup fresh" from a status record | A signed manifest, every checksum, the last part present, and a sound drill of that manifest |
| Support access history as one rewritable list | One key a look, written once |

## Fixed this round

| Finding | What changed |
|---|---|
| AGENT-019, 008, 009, 021, 011 | A sign-in read answers absent, present or unknown; unknown is fenced and queued, never "nothing held". Forget-all whose fence or listing failed does not report removal |
| AGENT-020 | Generation in strong storage; a watched run that began before a forget keeps nothing when it ends |
| COMP-016, 001 | A cloud computer is never stopped with work it could not save: held running, retried, the person told; it stops on a save or their discard |
| COMP-017 | A snapshot without a valid SHA-256 is never stored; an older unchecked copy is held back until the person chooses to use it |
| COMP-018 | Call tokens are signed over method and body, and used ones are remembered across restarts |
| DATA-019, 001, 002, 020 | Postgres proof and fence in a strongly consistent object (above) |
| DATA-021, 003 | A write Postgres could miss without any record is refused; a failed write-through keeps its intent |
| DATA-004, 005, USAGE-006 | One opening ledger row per credit balance and per seller; every balance reconciled to the cent before money may be read from Postgres |
| STATE-007, 001, 002 | Revision and value committed as one write; retention and chat sync both use it |
| DR-009, 004 | A restore runs with every change paused (people, API, webhooks, the cron), keeps each part's previous values first, and can be taken back exactly |
| DR-010, REL-017 | Readiness counts a backup only when its signed manifest has a sound drill; the cron drills every night |
| REL-018, DATA-016 | "Postgres reads everything" needs nothing in the way, and readiness names what is |
| SEC-015 | A record helper's refusal writes nothing |
| SUPPORT-001 | Support access log is append-only |
| SEC-002 | Kept ids come from the cryptographic source |
| SEC-004 | Every window message listener checks its sender, held by a test |
| COMP-009 | A workspace copy is read back before it counts; earlier copies are pruned only after |
| SEC-008 | Background work is held by the request it belongs to, not the most recent one |
| TEST-001 | The Postgres suites run against a real Postgres here and in CI |

## Where a restore stands

A KV store has no switch between two whole copies, so a restore is still
applied record by record. What changed is that nothing else can write while
it runs and that it can be taken back to exactly what was there. The atomic
point-in-time switch the audit asks for is the database provider's, once the
records it covers live in Postgres.

## What is left

- **Roadmap (52):** platform and product builds larger than a fix, each named
  in the ledger: retrieval at scale (vector index, past-chat index),
  direct-to-storage uploads and per-file rows, the durable workflow engine,
  the email to account-id migration, agent-to-agent handoff and per-agent
  workspaces, onboarding, structured shopping and travel results, meeting
  mode, sampled tracing, globally coordinated circuit breaking.
- **Owner (29):** a key service for root keys, provider settings (Postgres
  point-in-time recovery, R2 versioning, container quota), the launch profile,
  reserved model capacity, a second model provider, legal and privacy
  operations, on-call and support staffing, an outside security review.
- **Partly done (20):** fixed in earlier rounds, with the remaining part named.
- **Not done yet (9):** reviews that are line-by-line work across the codebase:
  the empty catches and innerHTML assignments one by one, raw addresses in
  audit lines, more failure-mode and accessibility tests, device performance
  budgets, money amount constraints, and documentation drift.
