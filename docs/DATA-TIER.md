# The data tier: what moves to Postgres, in what order, and how each step is checked

Owner decision 30 (Oct 26): **managed Postgres, reached through Cloudflare
Hyperdrive**, for the records that must be true. This document is the plan;
`migrations/postgres/0001_control_plane.sql` is the schema, and
`tests/worker/the-control-plane-schema-holds-money.test.mjs` runs that schema
against a real Postgres and holds it to its promises.

## Why, in one paragraph

KV is a cache that AMV has been using as a database. It answers fast from
everywhere and it may answer with a value up to a minute old, and it has no
transactions. That is fine for a profile picture and wrong for money and
permissions: a plan that was cancelled, a credit that was spent, a team member
who was removed. The control plane needs one place that answers the same thing
to everybody, and that can change two records together or not at all.

## What goes where

| Data | Where it lives | Why |
|---|---|---|
| Accounts, plans, teams and members, families, company sign-in domains, API keys | **Postgres** | Must be true everywhere at once; joined and counted by the owner's screens |
| Credits bought and spent, seller earnings | **Postgres, append-only ledgers** | Money is a history, never one number someone overwrites |
| Payment-provider events | **Postgres**, keyed by the provider's own id | A second delivery is a constraint violation, not a second charge |
| Usage counters, rate limits, the day's spend shares, revocation | **Durable Objects** (as today) | Hot, per-key, serialized - what an actor is for |
| Files, workspaces, exports, backups | **R2** | Large and binary |
| Chats, projects, preferences (the sync record) | **KV now; Postgres rows + R2 bodies later (phase 3)** | Large, per person; the 4 MB record has to be split first |
| Public catalogues, configuration, read caches | **KV** | What KV is good at |

## What the owner provides

1. **A Postgres provider and plan.** Any managed Postgres 15+ that Hyperdrive
   can reach over TLS. Choose for: point-in-time recovery of at least 7 days,
   a region near most users, and connection limits above Hyperdrive's pool.
2. **A Hyperdrive configuration** pointing at it
   (`npx wrangler hyperdrive create amv-control --connection-string=...`),
   which returns an id. The connection string never enters this repository: it
   is given to Hyperdrive once, in the terminal or the dashboard.
3. The id is then added to wrangler.toml as `[[hyperdrive]] binding = "PG"`,
   and the schema applied once with `psql -f migrations/postgres/0001_control_plane.sql`.

Nothing changes for anybody until step 4 of the migration below.

## The migration: copy, check, compare, switch - never a flip

Every step can be stopped and resumed, can be run twice without doing anything
twice, and reports what it did. Each step has a check that must pass before
the next starts.

1. **Schema.** Applied once. *Check:* the schema test passes against the
   real database (the same file the test suite runs).
2. **Write to both.** Every write to a control-plane record also writes its
   Postgres row, in the same request. KV stays the source of truth. A Postgres
   write that fails is audited and queued for the backfill to repair; it never
   fails the request. *Check:* for a day, the number of failed second writes
   is zero, or every one was repaired.
3. **Backfill.** A resumable job copies every existing record, kind by kind
   (`migration_cursor` holds where it got to), and records a digest of what it
   copied per account (`migration_accounts.kv_digest`). Re-running it skips
   what is already copied and identical. *Check:* row counts per kind match
   the KV key counts, and every account's digest matches.
4. **Shadow read.** For accounts marked `shadow`, every read is answered from
   KV *and* Postgres; the KV answer is used, and any difference is recorded
   (`mismatches`, `last_mismatch`) and alerted. *Check:* a week of shadow
   reads with zero unexplained differences, across every kind.
5. **Switch, a few at a time.** Accounts move to `read_from = 'postgres'` in
   growing groups: staff, then 1%, 10%, 50%, everyone. KV is still written,
   so moving an account back is one field. *Check at each step:* error rate,
   sign-in success and payment success unchanged.
6. **Postgres is the record.** KV writes for these kinds stop; KV keeps only
   what it caches. *Check:* restore drill - restore the database to a point
   an hour ago into a copy and compare.
7. **Retire.** The old KV records are deleted after 30 days of no reads.

Phase 3, later and separately: the sync record (chats and projects, up to
4 MB per person) becomes rows per conversation with large bodies in R2. It is
the one record too large for a database row as it stands, which is why the
D1 guard refuses it (`binding-a-database-empties-nobody`).

## Targets (design targets, not customer promises until demonstrated)

- Accounts, plans and money: lose at most **5 minutes** of writes in a
  disaster (point-in-time recovery), back in service within **30-60 minutes**.
- A restore is rehearsed before step 6 and quarterly after it.

## What is built now, and what is not

Built and tested: the schema, its money guarantees against real Postgres, the
migration bookkeeping tables. Not built yet, and waiting on the provider: the
Worker's Postgres reads and writes (step 2 onward). They need the Hyperdrive
binding to exist before they can be run against anything real, and money code
that has never touched its database is not shipped.
