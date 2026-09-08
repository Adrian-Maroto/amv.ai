# Assumptions

Every important choice made without asking, and why. The master brief says to
pick a sensible default, write it down, and continue. This is that record.

---

## A1. The repository is not empty, so the architecture is adapted rather than scaffolded

The brief says: *"If the repository is empty, create the architecture and
scaffold described below."*

It is not empty. AMV is a working, deployed product: 39 source modules, a
26,000-line Cloudflare Worker, 401 test suites, a 17-stage shippability gate,
and a live backend at `api.amv.homes` that self-deploys on green.

More to the point, **AMV already implements a large part of what the brief
describes.** Measured across the source:

| Spec concept | References in AMV today |
|---|---|
| Approval requests | 425 |
| Verification | 397 |
| Audit | 385 |
| Connectors (MCP, per-call consent) | 127 |
| Webhooks | 160 |
| Digests | 101 |
| Policy (scattered) | 111 |
| Kill switch / autonomy pause | present |

So the work is not to build this product. It is to find what is genuinely
missing and add it to the product that exists.

## A2. The prescribed stack is declined, and the architecture is kept

The brief prescribes Next.js, PostgreSQL, Redis, Temporal, Kubernetes and a
`/apps` + `/packages` monorepo. AMV's standing contract (`CLAUDE.md`) says the
opposite in as many words: vanilla JS, no React, no Next.js, no bundler, and a
runtime of one Cloudflare Worker plus KV, a Durable Object and cron.

Adopting the prescribed stack would mean starting a second product and
abandoning a working one. That is not a trade the brief intends - its own
instruction is to build the platform that makes future automations safe, not to
prefer a particular vendor's box diagram.

**So: the six planes, the pipeline, the risk taxonomy, the policy engine, the
action contract and the canonical event model are all adopted. The
infrastructure they were drawn on is not.** Where the brief names Temporal,
AMV uses durable state in KV plus the five-minute cron and idempotent replay.
Where it names Postgres, AMV uses KV with explicit key partitioning. Where it
names Kafka, AMV uses the event log with cursors and reconciliation.

If AMV ever outgrows that runtime, the interfaces defined here are what make
the move possible: nothing above the storage layer knows what the storage is.

## A3. "Billions" is designed for, not built for, today

The brief's Stage 4 is 100M-1B users and ~231,000 events/second. AMV has one
region and one Worker. Pretending otherwise would be the "do not claim
production-ready" failure the brief warns about.

What is done now is the part that is expensive to retrofit and cheap to add
early: every event carries `home_region`, every record is keyed by tenant and
user, every action carries an idempotency key, and no code assumes a single
global store. Regional data planes are a deployment change later, not a rewrite.

## A4. The tiered reasoning ladder is a cost decision, not an optimisation

Tier 0 (deterministic) handles anything that can be settled by comparison,
schema, allowlist or existing state. A model is only reached when the answer is
genuinely ambiguous. At the brief's own arithmetic - $0.01/user/day is $300M a
month at a billion users - this is not tuning, it is whether the product can
exist. AMV already routes to the cheapest engine that can do the job; that
router becomes Tier 1.

## A5. The LLM never decides authorization, and this is enforced in code

The brief is unambiguous and so is `CLAUDE.md`: the server is the authority on
money, limits, auth and content. The policy engine added here is deterministic -
plain comparisons over typed data, no model call anywhere in the path. A model
may only ever *propose* an `ActionContract`. Whether it runs is decided by code
that cannot be talked out of its answer by an email.

## A6. Autonomy is opt-in per rule, never learned from repeated approval

The brief says never widen autonomy because a user keeps approving something.
AMV's memory system already refuses to convert one behaviour into a permanent
preference (LESSONS). The same rule binds the policy engine: bounded autonomy
requires a rule the user wrote, with an explicit budget, allowlist and window.

## A7. R4 and R5 are not implemented, deliberately

Money movement, trading, tax filing, legal submission, medical decisions and
identity changes are defined in the taxonomy so that the engine can *refuse*
them. No connector or tool that could perform one is being added. Defining a
class is how you deny it, not how you enable it.

## A8. The first vertical slice is the one AMV can actually complete

The brief's wedge is Gmail + Google Calendar. AMV has neither as a read
connector today - it has Connected accounts (OAuth2 + PKCE) and read-only
Classroom, and image/video generation was deliberately removed.

Rather than claim a Gmail slice that does not exist, Milestone 1 delivers the
spine every slice needs, with tests, and the connector work is sequenced after
it. A slice built on an untyped spine has to be built twice.
