# Nov 8 release-certification audit - what changed

The audit's verdict stands: NO-GO for an open or million-user launch; an
invite-only beta is realistic once its critical items are closed and retested
against real infrastructure. This file records what the code now does about
each item, and what remains the owner's or the Postgres cutover's.

## The four reproduced defects - fixed, each with a test that fails without the fix

| Id | What changed | Test |
|---|---|---|
| BETA-001 | An invite use is the LAST check of a sign-up (password, passkey, Google) and is handed back, once-only, whenever no account was made. | the-beta-lets-in-only-who-was-invited |
| DR-015 | Restore writes nothing over protected live state (`ent:`, `seller:`, `apikeys:`, `tokepoch:`) it cannot read or parse; the record is named in `lost` and the restore is reported incomplete. | a-restore-cannot-give-access-back |
| FIN-027 | A transaction id is claimed in the strongly consistent object before its line is written; the other writer waits for the winner's record and answers with it. | finance |
| AGENT-027 | An agent's sign-in jar is saved under a per-agent lock, and merged only into the copy whose fingerprint matches the last write (held in the strong object); a copy that never catches up is not merged into. | two-runs-of-one-agent-keep-both-sign-ins |

## Other items fixed in this build

| Id | What changed | Test |
|---|---|---|
| AUDIT-010 | Background work is held only by the context it runs in; the shared last-request context is used only where the runtime has no async-local storage at all. | background-work-is-held-by-its-own-request |
| DR-011, DR-016 | Every queue batch and cron tick pauses while a restore has writes off - and also when the switchboard cannot be asked (`_writesPaused`). | background-work-goes-through-the-queue |
| CONN-035 | The generic connected-app route needs an Idempotency-Key for any change, sends it once (a retry gets the first answer), passes the key to the provider, and a lost answer or a 5xx after sending is `outcome_unknown`. | an-app-with-a-public-api-connects-and-stays-in-its-lane |
| CONN-036 | A connector tool call that failed after it was sent says it may have been done; refused at the door (401/403) still says nothing changed. | an-app-you-sign-in-to-is-an-app-amv-can-use |
| QUEUE-017 | A quarantine that cannot be read holds the run. | background-work-goes-through-the-queue |
| FIN-029 | Stripe amounts (subscriptions, renewals, credit packs, refunds, marketplace sales, invoices) are read in their own currency's minor units. | a-money-row-is-exact-before-it-is-sent |
| AUTH-025 | A failed passkey sign-up or registration releases its claim, so the same passkey can be added again at once. | a-passkey-or-a-second-step-guards-the-account |
| CONN-034 | Every outbound hop to an address somebody chose is looked up (A and AAAA over DNS-over-HTTPS) and refused when any answer is private, loopback, link-local or metadata - redirects included. A lookup that cannot be made does not refuse; the Worker's egress does not reach private networks. | a-name-that-points-inside-is-refused |
| AUTH-026 | Turning on the authenticator app keeps its answer sealed for fifteen minutes and shows the same recovery codes again to whoever holds the app; an account write that failed leaves the setup usable. | a-passkey-or-a-second-step-guards-the-account |

## Postgres mirror, ahead of the cutover

| Id | What changed | Test |
|---|---|---|
| DATA-040 | Every mirror carries a per-record revision from the strongly consistent object, taken when the write is made; Postgres keeps the newest that landed (`mirror_revisions`), so an older mirror from any isolate finishing later changes nothing. | accounts-and-plans-are-written-to-postgres-too |
| DATA-041 | Each mirror - an account and its migration record, an erasure's five statements, a team and its members, a key list - is one SQL transaction with its revision. | accounts-and-plans-are-written-to-postgres-too |
| DATA-032 | A money row is put on the repair list, awaited by the caller, before it is sent, and taken off once Postgres has it. | accounts-and-plans-are-written-to-postgres-too |
| DATA-042 | Ledger key reuse also compares the source event (credit) and hold date (seller). | accounts-and-plans-are-written-to-postgres-too |

## Marked open in the register, already changed on Nov 7

The register carries these forward as open; the Nov 7 build changed each and
`docs/AUDIT-NOV7.md` names the test: LOCK-001, LOCK-002, AUTH-020, AUTH-021,
AUTH-022, AUTH-023, CONN-030, CONN-031, READY-020, READY-022, DATA-038,
FIN-020, FIN-024, FIN-026, USAGE-011, COMP-023, AGENT-022/023/024. Retest
against those tests; where the audit still sees a gap (for example a lease
rather than a transaction), the remaining step is the Postgres cutover below.

## Needs the Postgres cutover (Postgres is not the authority yet)

DATA-003, DATA-021, DATA-031, DATA-036, STATE-001, STATE-007: each asks
for Postgres to become the one transactional authority, which is the
cutover itself. The
cutover check (`_pgCutover`) refuses while any applies.

## Needs the owner

AGENT-010/026 and COMP-006/022 (KMS/HSM envelope keys), DR-004/009/012
(restore into an isolated namespace and switch bindings), TASK-017
(Cloudflare Workflows), FILE-030/031 (R2 signed uploads, malware scanning),
FIN-025/028 (cash payouts stay off), OPS-020..024 (on-call, legal, abuse
operations, provider capacity), REL-001/022 (which bindings are mandatory).
