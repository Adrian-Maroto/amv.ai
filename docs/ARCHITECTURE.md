# Architecture

The brief's six planes, drawn on the runtime AMV actually has.

---

## The pipeline

```
CONNECT → INGEST → NORMALIZE → CORRELATE → TRIAGE → PLAN
        → POLICY CHECK → APPROVAL → EXECUTE → VERIFY → REPORT → LEARN
```

Only three of these steps may involve a model, and none of them decides
anything: TRIAGE (is this relevant), PLAN (what could be done), REPORT (say it
in the user's words). Every other step is deterministic code.

## The six planes, and where each one lives

| Plane | Responsibility | Where it lives in AMV |
|---|---|---|
| Connector | auth, scopes, webhooks, sync, revocation, health | `13-integrations.js`, `38-mcp.js`, Worker OAuth routes |
| Event | one canonical language for every source | `40-agent-core.js` (new), KV event log |
| Intelligence | relevance, correlation, planning | `14-engine.js` `aiAgentLoop`, model router |
| **Trust** | **permissions, policy, approvals, limits, residency** | **`40-agent-core.js` (new) + Worker** |
| Execution | call, verify, retry, roll back | `14-engine.js`, connector tools |
| Experience | briefing, approvals, timeline, controls | `10-mission-control.js`, `28-activity.js` |

The Trust plane is the one that did not exist as a plane. Policy decisions were
made correctly but at 111 scattered call sites, which means the rule lives in
whoever remembered to write it. Milestone 1 gives it one home.

## Why no Temporal, Postgres or Kafka

The brief names them; `CLAUDE.md` forbids adding frameworks. Both are satisfied
by taking the *properties* and not the vendors:

- **Durable workflows** → workflow state is a KV record with a monotonic status
  and an idempotency key. The five-minute cron is the scheduler. A run that dies
  mid-flight is resumed by the next tick reading the same record, because the
  record - not the process - is the source of truth.
- **Exactly-once** → not claimed, as the brief instructs. Effectively-once comes
  from idempotency keys, monotonic state transitions and independent
  verification after the fact.
- **Event stream** → an append-only KV log per user with a cursor per connector,
  plus reconciliation for events the webhook never delivered.
- **Atomic counters** → the Durable Object already does this for spend. It is
  the same primitive an action budget needs.

Nothing above the storage layer names KV. Swapping the store is an
implementation change behind an interface, which is the point of defining the
interface first.

## Trust boundaries

```
   untrusted ─────────────────────────┐
   email bodies, web pages, files,    │  evidence, never instruction
   calendar text, tool output,        │
   connector responses, MCP servers   │
                                      ▼
   ┌──────────────────────────────────────────────────┐
   │  model: may PROPOSE an ActionContract            │
   └──────────────────────────────────────────────────┘
                                      │  proposal only
                                      ▼
   ┌──────────────────────────────────────────────────┐
   │  policy engine: deterministic, no model call     │  ← the authority
   │  law > platform > region > org > household >     │
   │  user > automation > model recommendation        │
   └──────────────────────────────────────────────────┘
                                      │  decision
                                      ▼
   ┌──────────────────────────────────────────────────┐
   │  server: money, limits, auth, content            │
   └──────────────────────────────────────────────────┘
```

A lower level can never widen what a higher level restricted. Content that
arrived from outside is at the top of this diagram on purpose: it can inform a
decision and can never make one.

## Failure modes this design accepts

- **Webhook never arrives.** Reconciliation reads the cursor and backfills.
- **Webhook arrives twice.** The deduplication key drops the second.
- **Run dies mid-flight.** State is in KV; the next cron tick resumes it.
- **Provider returns 200 but did nothing.** Verification is a separate read, so
  "completed" is never inferred from a status code.
- **Approval expires between proposal and execution.** Preconditions are
  rechecked immediately before the call, not at proposal time.
- **Model returns nonsense.** The contract is schema-validated; an invalid
  proposal is a denial, not a best-effort execution.
- **Model provider is down.** The gateway falls back; Tier 0 keeps working
  because it never needed a model.
