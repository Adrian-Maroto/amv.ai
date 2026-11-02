# November 1 forensic audit: where each P0 stands

The audit (169 findings, 34 P0) said NO-GO. This page tracks its P0 list:
what each finding claimed, what was checked against the code, what changed,
and what stays with the owner. A row counts as **fixed** only when a test
proves the guard, and that test was seen to fail with the guard broken.

## Fixed in code (each with a test, mutation-checked)

| Finding | What was true | What changed | Proved by |
|---|---|---|---|
| DATA-001/002/003, DATA-006 | Postgres could answer a read for a row nobody had compared with KV; repair markers expired | Postgres answers only a row whose digest was proved equal to KV; any write removes the proof first; repair markers never expire | `postgres-answers-only-where-it-proved-it-can` |
| DATA-007 | Background mirror writes could die with the isolate, leaving no trace | An intent is written before the record; the mirror clears it, a failure or a stale intent becomes a repair entry | `accounts-and-plans-are-written-to-postgres-too` |
| DATA-008 | Two backfill runs could move one cursor | A lease row: taken only when free or silent, renewed in the same statement as every cursor save, released only by its holder | `what-was-there-before-is-copied-and-checked` |
| STATE-001/002 | Sync and retention writes were "guarded" by a read-then-write on KV | A compare-and-set on the account's Durable Object guards the KV write | `a-lock-that-expired-is-somebody-elses-lock`, `conversations-are-kept-only-as-long-as-chosen` |
| STATE-005 | Sensitive routes partly covered while revocation is unconfirmed | Withdrawals, data exports and agent saving join the routes that refuse (503) rather than trust a KV epoch; signing out never does | `revoked-means-revoked-everywhere` |
| COMP-001/002 | A failed restore let work run on an empty disk; a failed save stopped the machine anyway | Work refused until the person picks a copy or starts fresh; saves retried before stopping, and a lost save is told | `the-cloud-workspace-outlives-its-container` |
| COMP-003 | Restore unpacked over the live workspace | Unpacked into a staging folder and swapped in whole; a failure leaves the workspace exactly as it was | same suite |
| COMP-004 | A snapshot taken while files changed was accepted silently | Read again up to three times; a file that never settles is named with the copy | same suite |
| COMP-006 | Every container held the fleet-wide key | Each machine gets a key derived for its id and its start, every call is signed for one machine and path, once, within a minute | same suite |
| AGENT-008/009 | Forgetting a sign-in could fail silently | Revoked first, deletion read back, the truth reported, retried by the cron | `an-agent-keeps-a-sign-in-only-where-it-may` |
| AGENT-010 | One key sealed every agent's sign-ins | A key per agent, sealed under the connection key; forgetting destroys it | same suite |
| TASK-001 | A background tick skipped one account after a slice | The booking holds exactly the accounts not reached | `nothing-is-skipped-in-silence` |
| DR-004 | A restore could stop half way, or apply a changed backup | Every part has a checksum; a restore needs a sound drill of that night and checks each part again | `every-night-is-backed-up` |
| REL-001/002 | The launch gate checked keys, not the production architecture | Profiles require Postgres, the queue, backups and workspaces bound, plus a fresh backup and full Postgres reads | `a-comment-is-not-a-binding`, `alive-is-not-ready` |
| TEST-001 | Postgres suites "could not run" | They already ran in CI on the runner's own Postgres (they fail rather than skip); CI now installs it explicitly | `.github/workflows/test.yml` |
| SEC-005 (code half) | WebAuthn is AMV's own code | A seeded fuzz suite already mutates every field; a stolen credential id is now proved refused | `a-passkey-survives-anything-sent-at-it`, `a-passkey-or-a-second-step-guards-the-account` |

Also found and fixed on the way: editing an agent's sites dropped the
revocation stamps on what it had forgotten; erasing an account wrote back an
empty agents record.

## Not done in code, and why

| Finding | Why it is not a code change today | What it needs |
|---|---|---|
| DATA-004/005, USAGE-006 | Money from before dual-write cannot be rebuilt from AMV's own records; it has to come from Stripe and PayPal's history. Money reads never moved to Postgres (only `acct` and `ent` can), so nothing reads the gap. | A reconciliation job against the payment providers' exports, then a signed opening balance per account. The owner chooses when money reads may move. |
| DATA-013 | Teams, keys and money still read from KV. Moving each is the same proof model as accounts, one data class at a time. | Next, after accounts and plans have run at 100% with no difference. |
| TASK-002 | A durable workflow engine (steps that survive deploys and wait days for approval) is a new subsystem, not a fix. | A design and an owner yes; Cloudflare Workflows is the obvious host. |
| TASK-003, REL-006, COMP-013 | The bindings are commented in `wrangler.toml` because each one is a resource in the owner's account. The launch gate now refuses the paid profiles without them. | The owner creates them (GO-LIVE). |
| REL-003 | Readiness now checks state (backup fresh, Postgres reads), not only presence. Scheduled synthetics for each capability are partly there (the external probe). | Model, queue and payment round-trips on a schedule. |
| DR-001 | Backups cover KV. Postgres, R2 and Durable Objects each need their own provider-side backup. | Neon PITR, R2 versioning: owner switches. |
| COMP-011 | `max_instances = 50` is a Cloudflare quota. | The owner asks Cloudflare for more before launch. |
| AGENT-011 | Revocation is read from the agent's record and its key is destroyed on forget, so a stale copy cannot be opened anywhere. The record itself is KV. | Moving agent records to the Durable Object, with the rest of DATA-013. |
| SEC-005 (review) | An outside review cannot be done from inside. | The owner commissions it (OWNER-DECISIONS). |
| AGENT-010 (root key) | The key that seals agent keys lives in the Worker. | A key service (OWNER-DECISIONS 17). |
