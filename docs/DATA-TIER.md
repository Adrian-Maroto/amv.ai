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

## The shape, after the Oct 31 review

Before anything was applied, the schema had a second pass:
- **An account is an id.** Every row points at `accounts.id`; the email is a
  field that can change without moving anybody's money, keys or memberships.
- **Organizations, workspaces, memberships.** A person belongs to many
  organizations (their personal one, their company, a client's), with a role
  in each, and workspaces inside them. Plans attach to an account or to an
  organization (seats), never both.
- **Provider ids and currency.** Payment customers, subscriptions, invoices
  and events are kept by the provider's own ids; every amount carries its
  ISO currency, and a balance is per currency.
- **Password algorithm on the record** (`pw_algo`), so moving from PBKDF2 to
  Argon2id is a rehash at the next sign-in, not a migration.

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
   and the schema applied once with `psql -f migrations/postgres/0001_control_plane.sql` and then `0002_money_constraints.sql` (supported currencies, non-zero bounded amounts, seller money in whole minor units).

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
migration bookkeeping tables, and **step 2 for accounts and plans** (owner
decision #47): with the `PG` binding, every write of an `acct`, `ent`,
`apikeys` or `team` record also writes its rows (API keys by their hash
alone; a team as an organization with its memberships), tested against a real Postgres
(`accounts-and-plans-are-written-to-postgres-too`) - including a database
that is down (the request is unaffected; the write goes on the `pgrepair:`
list) and erasure (a tombstone with nothing personal on it).

Credit packs bought, refunded and disputed are written to `credit_ledger`,
one row per event keyed by the payment. Credit spent is a row per message at its settled cost. Every credit row notes
whose credit it was (`subject:` - a person, or a team, until the ledger has an
organization column). A seller's money lines are written to `seller_ledger`:
a sale (with when it can be withdrawn), its reversal, a payout requested and
one returned, each keyed by the sale's reference and item or the
withdrawal's id; a payout marked paid moves no money and writes no row.
Step 2 is complete.

The backfill (step 3) is built (`src/worker/04b-pg-backfill.js`, tested by
`what-was-there-before-is-copied-and-checked`) and starts only when the owner
starts it: `POST /admin/pg/backfill {"action":"start"}` with the admin token,
once step 2 has run a day with no failed writes. The five-minute cron then
gives it about twenty seconds a tick, in phases: accounts (with plans and
keys, skipping any whose digest has not changed), teams, sellers' money
lines, the `pgrepair:` list, and a read-back of every account compared with
KV (a difference is re-checked once, then counted on `migration_accounts`).
`GET /admin/pg/backfill` shows each phase, the row counts, the accounts that
differ and the repairs left; `stop` pauses it and `restart` runs it again
from the start without copying anything twice. It does not copy credit packs
bought before step 2, or seller lines older than the 500 a history keeps.
Shadow reads (step 4) are built (`src/worker/04c-pg-shadow.js`, tested in
the same suite) and start when the `PG_SHADOW` variable names a cohort:
addresses and/or a share of everybody by a hash of the address
(`amv@amv.homes,5%`). For those accounts every read of an account, a plan or
API keys - an absent one included - is also read from Postgres in the
background and compared; KV's answer is always the one used. A difference is
re-checked once (a write may be on its way), then counted against the
account, audited and alerted. At most one comparison per record per minute
per Worker instance. `GET /admin/pg/shadow` shows reads compared and
differing per day for a week, and the accounts that differ.

Built (owner approval Nov 1), off until `PG_READ` names somebody: **step 5,
the switch** (`src/worker/04d-pg-read.js`, tested against a real Postgres in
`postgres-answers-only-where-it-proved-it-can`). `PG_READ` takes the same
shape as `PG_SHADOW`, and the share uses the same hash, so 5% read is inside
5% shadow. For those accounts an account record and a plan are answered by
Postgres, rebuilt from their rows. Three rules make it safe to grow:

- **proved, or not served** (Nov 1 forensic audit DATA-001/002/003): a row
  answers only if it matches a proof (a digest of the record, held in a
  strongly consistent object per record, `pgproof:<kind>:<email>` - never in
  KV, where one region could still read a proof another had removed; Nov 3
  audit DATA-019) written after the two copies were compared and found the same,
  or after a write-through read its own row back. With no proof, KV answers
  and the comparison runs in the background - so a wrong row is never served
  even once, and a comparison that fails simply leaves no proof;
- a write moves the proof's epoch BEFORE KV changes - in the read cohort or
  not (if it cannot, the write fails), and a comparison may set a proof only
  under the epoch it began in; a write whose intent and repair entry both
  cannot be recorded does not happen (DATA-021). The write reaches Postgres
  before the request goes on, is read back, and is
  proved only if the row reads back as written; otherwise no proof, KV
  answers, and it goes on the repair list (no expiry - an unresolved
  difference does not become fine because time passed);
- Postgres unreachable or a query failing: KV answers, and it is counted.

`GET /admin/pg/shadow` now also shows, per day, the reads Postgres answered,
the reads KV answered because the record was not yet proved, the reads that
fell back, and the rows that differed. API keys stay on KV:
their record carries fields the key table does not, so a key rebuilt from its
row would not be the same record. The step's check is the plan above - grow
the cohort (staff, 1%, 10%, 50%, everyone) only while `differed` stays zero
and sign-in and payment success are unchanged.

Not built, on purpose: **step 6, Postgres alone.** It removes the KV write, so
it can only be checked by step 5 having run clean at 100% for a period on the
real database - which does not exist yet (the owner has not created it). Code
written now for a step that cannot be measured is a guess shipped as a
migration; it is built when step 5's numbers say it can be.

## One source of truth for every data class (Nov 1 audit DATA-015)

The final architecture, and where each class answers today:

| Store | What it is the authority for |
|---|---|
| **Postgres** (Hyperdrive) | The control plane. Today it answers for accounts and plans only, and only rows proved equal to KV; ledgers, teams and keys move one class at a time with the same proof. |
| **Durable Objects** | Coordination: every counter, limit, reservation, lock and lease, the sign-out-everywhere generation, the switchboard. |
| **R2** | Bytes: library files, nightly backups, saved cloud workspaces. |
| **KV** | Every record kind not yet moved - the authority for those until its class moves, then a cache. |
| **D1** | Retired. Never an authority; a launch profile refuses `DATA_STORE = "d1"`. |

Each record kind's authority is written in `docs/data-inventory.json`;
`tests/worker/every-record-has-a-class` holds it to the code.
