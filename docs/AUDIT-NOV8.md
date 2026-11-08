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
| READY-021, READY-026 | The hourly check now proves the hosted browser (opens, renders one line, reads it back) and the meaning index (two phrases, two vectors that agree), held like the model while the day's ceiling is reached; every configured capability is now exercised. | configured-is-not-the-same-as-working |
| BETA-002 | An invite has an end date (1-365 days, 30 by default), can be revoked, and the owner console lists every invite with uses spent and whether it is open. | the-beta-lets-in-only-who-was-invited |
| DOC-020, DOC-021 | The Nov 3 and Nov 7 status pages no longer say nothing is left; they name what is open and point here. | - |
| FILE-033 | A library delete marks the files (gone from the list at once), deletes and checks the bytes, and removes only the records whose bytes are confirmed gone; any left stay marked and are removed by the next delete. | your-files-are-in-your-account |
| FIN-021 | The finance statement reads one line past its 300-line page and says `hasMore` when the ledger is longer, with or without Stripe; totals already say they cover the page. | finance |
| QUEUE-013 | The queue key is remade when its secret changes, instead of a warm isolate keeping the old one. | background-work-goes-through-the-queue |
| GROWTH-011 | The Growth tab shows confirmed actions per active person beside cost and revenue per person: work done, not messages. | what-brought-them-back |
| FRONT-022 | A file shared from another app carries when it arrived and is removed after an hour if the app never opened it - swept on each new share and when the service worker starts. | a-file-shared-from-another-app-arrives-in-amv |
| QUEUE-016 | A quarantine is also a mark in the account's strongly consistent object, set and cleared with the KV record; either holds the run. | background-work-goes-through-the-queue |
| COMP-021, LOG-010 | Checked: used call nonces are pruned on every call and bounded by the call rate; log sampling stays at 100% because the audit trail is written to the logs. | - |
| PERF-010, USAGE-001 | Measured (tools/load-probe.mjs): 18 counter calls on a person's first answer, about 14 on later ones - four are once-ever first-answer marks. Each remaining pair is a reserve before the model call and a settle after it, which is what keeps a person from spending past their limit; merging them would trade that guarantee for a fraction of a cent per thousand turns. Held by a budget in no-key-is-shared-by-everybody. | no-key-is-shared-by-everybody |
| GROWTH-010 | The first screen stays as the owner chose it (a greeting and five starting chips; the welcome card stays off). What was missing was learning: the first chip a person clicks is kept by name, a new funnel step counts the first job set to run again on its own (the habit), and the Growth tab shows, per first chip, how many got an answer, made it recurring, came back and paid - so the chips' order is decided by what keeps people. | what-somebody-came-for-first |
| TASK-017 (part) | A background run that was cut off (a deploy, a crash) no longer stalls its job for three days: the slot is a 15-minute lease, a run that finished writes a mark at once so it is never run twice even if its record was not saved, and a slot cut off three times stops and says so. Cloudflare Workflows stays the owner's infrastructure decision; this closes the lost-progress hole on what AMV already runs. | background-work-goes-through-the-queue |
| RETR-020 | A permanent index of every passage of every text file kept in an account (Vectorize, `VECTORS`), one namespace per account so a search reaches only its own; written when a file is kept, removed when it is deleted or the account erased, paid for like any meaning search, proved hourly. The library's search box then finds files by what they say. Off and said to be until the index is created and bound (GO-LIVE.md). | your-files-can-be-searched-by-what-they-say |
| FRONT-020 | The page's policy no longer lets script run from jsdelivr, cdnjs or blob: (nor fetch from jsdelivr): generated pages run in preview.html with a policy of their own and Python in the sandbox with its own, so the page never needed them. What remains are the named payment, sign-in, captcha and opt-in analytics hosts, each with a written decision. | somebody-elses-code-runs-on-this-page |
| FRONT-021 | Not yet: Trusted Types across about 600 HTML sinks is a rewrite. Script-src is pinned by hash with no unsafe-inline, which already refuses injected inline script and handlers. | - |
| AUTH-024 | A passkey's account is also kept in the strongly consistent object; sign-in reads KV, then the strong copy, so a passkey made a moment ago signs in from a region KV has not reached. Removed with the passkey. | a-passkey-or-a-second-step-guards-the-account |
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
