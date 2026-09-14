# What was attacked, and what survived

A test suite tells you what somebody remembered to check. It does not tell you
what it would catch. The only way to learn the second is to break the code on
purpose and see whether anything notices.

This is the record of doing that to the four paths where a defect ends the
company rather than spoiling a demo. **Twenty-three mutations. Eight of them
went unnoticed by every suite in the repository.** All eight are now caught.

Re-run any of it by making the same edit by hand and running the suites named.

---

## Connectors — 8 attacked, 5 unnoticed

A connector is a program somebody else wrote, running on somebody's own
machine, on accounts AMV does not own. It is the largest blast radius in the
product and the one a marketplace would multiply.

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 1 | Connector tools stop needing consent | caught | `a-connector-acts-on-your-real-accounts` |
| 2 | **Consent asked, answer discarded, connector runs anyway** | **unnoticed** | `a-connector-acts-on-your-real-accounts` |
| 3 | The dialog stops showing the arguments | caught | `a-connector-acts-on-your-real-accounts` |
| 4 | **The server admits any tool name** | **unnoticed** | `the-bounds-that-make-a-connector-safe-to-admit` |
| 5 | **The tool-count bound is gone** | **unnoticed** | same |
| 6 | **A description may be any length** | **unnoticed** | same |
| 7 | **A schema may be any size** | **unnoticed** | same |
| 8 | `isMcpTool` matches nothing | caught | `a-connector-acts-on-your-real-accounts` |

Attack 2 is the one that matters. `const allowed = true; await
_confirmModelTool(…)` leaves the dialog on screen, leaves the person's Deny
unheard, and runs the connector. The only test that looked at the dispatch read
the source for `if(!allowed)`, which that edit leaves exactly in place.

Attacks 4-7 are the three constants `_safeTools`'s own comment names as the
reason admitting third-party tool NAMES by shape is not a hole. The argument
was sound; nothing tested it.

## Money — 6 attacked, 1 unnoticed

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 0 | The PayPal route ignores its verifier | unnoticed | `webhook-signature` |
| 1 | **A forged Stripe webhook is accepted** | **unnoticed** | `webhook-signature` |
| 2 | A lapsed subscription keeps its plan | caught | `a-widget-spends-its-owners-money` |
| 3 | A payout over the automatic limit is not flagged | caught | `payouts-decide-themselves`, `payouts` |
| 4 | A refused spend reservation is treated as allowed | caught | three suites |
| 5 | A missing ceiling means no counter at all | caught | three suites |

The money path is well tested. It had one hole and it was the front door:
anybody on the internet POSTing a `checkout.session.completed` and granting
themselves any plan. Same shape as the connector finding - the VERIFIER was
tested exhaustively and the ROUTE was checked by reading source text.

## Auth — 9 attacked, 2 unnoticed

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 1 | A forged JWT signature is accepted | caught | `auth`, `what-a-token-does-not-say` |
| 2 | **The algorithm is no longer pinned (`alg:none`)** | **unnoticed** | `what-a-token-does-not-say` |
| 3 | **A token from another era still works** | **unnoticed** | same |
| 4 | `requireUser` hands back a user with no token | caught | three suites |
| 5 | The admin token is compared loosely | caught | `admin-security` |
| 6 | A wrong password is accepted at sign-in | caught | `auth`, `authbypass` |
| 7 | A wrong password confirms account deletion | caught | `erasing-everything-needs-more-than-a-token` |

Both survivors refuse a PERFECTLY VALID token, which is why neither had a test:
a suite grows around what users do, and these two only matter on the worst day
of the company's life. The version check is the lever that signs everybody out
after a breach - if it is not enforced, the lever moves and nothing happens.

## The bridge — 5 attacked, 0 unnoticed

| # | Attack | Result |
|---|--------|--------|
| 1 | A path outside the project folder is allowed | caught |
| 2 | Symlinks are no longer resolved, so a link escapes the root | caught |
| 3 | The destructive-command refusal list never matches | caught |
| 4 | The session token is compared loosely | caught |
| 5 | Any origin may drive the bridge | caught |

All five by `the-bridge-only-reaches-one-folder`, which was written after a real
finding (the daemon promised "that folder and nowhere else" while exec reached
anywhere). **This is the example to copy.** It drives the daemon rather than
reading it, and it covers confinement, symlinks, refusals, the token and the
origin in one place.

---

## The counter, and erasure - 9 attacked, 4 unnoticed

Added after the four paths above. Both were reported wrongly before they were
reported correctly; LESSONS 467 has the method failure in full.

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 1 | **`reserve` stops enforcing the cap (unbounded overshoot)** | **unnoticed** | `the-ceiling-is-decided-inside-the-counter` |
| 2 | **`reserve` accepts a negative amount (free budget for everyone)** | **unnoticed** | same |
| 3 | **`incr` lets a refund drive the counter negative** | **unnoticed** | same |
| 4 | `release` deletes a lock it does not own | caught | `a-lock-that-expired-is-somebody-elses-lock` |
| 5 | A half-worked erasure answers `ok:true` | caught | three suites |
| 6 | The reauth answer is computed and discarded | caught | `erasing-everything-needs-more-than-a-token` |
| 7 | Unsettled payouts no longer block deletion | caught | same |
| 8 | A failed payout lookup reads as "nothing outstanding" | caught | same |
| 9 | **One erasure phase (team membership) fails silently** | **unnoticed** | `an-erasure-that-half-worked-has-to-say-so` |

1-3 are the guards on every dollar in the product, in the one class no suite
ever ran: eight money suites all drive a test double of it.

9 is the connector-consent shape once more. The phase audits AND pages an
operator, so the suite's silent-catch check correctly skips it, and its count
check passes with 26 reports where 15 are required. Nothing asserted the thing
the code's own comment claims - that the ROUTE stops answering "deleted". An
operator being paged is not the person being told, and erasure is an obligation
to the person.

## Authorization, payouts and the admin door - 12 attacked, 2 unnoticed

Run on the rebuilt instrument, which prepends a CONTROL mutation with a known
answer to every run and ABORTS if the control is not caught. Six wrong results
preceded it; LESSONS 467 and 471 have the method failures.

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 1 | A deployed site edited by a stranger | caught | `letting-somebody-into-your-account` |
| 2 | A share listed/unlisted by a stranger | caught | `cross-account-writes`, `share-pages` |
| 3 | **A permission link revoked by a third party** | **unnoticed** | `letting-somebody-into-your-account` |
| 4 | An invite redeemed by whoever holds the link | caught | `team-security` |
| 5 | An OAuth state from another account accepted | caught | `a-connected-account-is-a-key-somebody-lent-you` |
| 6 | Somebody else's listing deleted | caught | `the-routes-nobody-tested` |
| 7 | The payout settle lock removed | caught | `payout-settles-once` |
| 8 | An already-settled payout settled again | caught | `a-claim-kept-after-a-failure-is-a-lie` |
| 9 | A rejected payout not recording money owed | caught | same |
| 10 | A settled payout left named in the in-flight index | unnoticed - **correctly** | see below |
| 11 | The admin token check removed | caught | `a-restore-brings-it-back` |
| 12 | **The admin rate limit no longer refuses** | **unnoticed** | `admin-security` |

3 is a test passing for the wrong reason. `linkRevoke` refuses a stranger twice
- 404 because the links record is read under the CALLER's key, then 403 for
ownership - and the suite asserted only that SOME error came back. The 404
answered, so the 403 branch had never run. Asserting a call failed is not
asserting why.

12 is the second lock: the limit bounds what a STOLEN admin token is worth on
the route that reads every record under every prefix.

10 is NOT a defect and was deliberately not pinned - `_payoutsInFlight` re-reads
each id and trusts the record's own status, so the index is allowed to be
stale. What was missing is a test of that TOLERANCE, since a stale entry that
DID block would refuse somebody's erasure for ever over money already paid.

## Round three - 19 attacked, 3 unnoticed

Run on the self-calibrating instrument: every run prepends a CONTROL mutation
with a known answer and ABORTS if the control is not caught, so no number
reaches this table from a run that could not detect a known bug.

| # | Attack | Was | Now caught by |
|---|--------|-----|---------------|
| 1 | A revoked API key still authenticates | **unnoticed** | `api-keys` |
| 2 | A key from a deleted account authenticates | caught | `api-keys` |
| 3 | The API key prefix check accepts anything | unnoticed - **harmless** | not pinned; a non-key falls through to JWT unchanged |
| 4 | A past-due subscription keeps its plan | caught | `renewal-sweep`, `subscription-lifecycle` |
| 5 | The grace period runs backwards | caught | `renewal-sweep` |
| 6 | A child's monthly cap ignored | caught | `a-parents-limit-reaches-the-cron` |
| 7 | A child's cap RAISES the plan ceiling | caught | same |
| 8 | A child barred from the marketplace buys | caught | `family` |
| 9 | A child barred from payouts withdraws | caught | `family` |
| 10 | **The agent stop flag ignored between rounds** | **unnoticed** | `stop-really-stops-the-agent` |
| 11 | **The stop flag ignored between TOOL CALLS** | **unnoticed** | same |
| 12 | **The round ceiling no longer ends the loop** | **unnoticed** | same |
| 13 | **The wall clock no longer ends the loop** | **unnoticed** | same |
| 14 | The proxy accepts `stream:false` | caught | stream suites |
| 15 | A tampered snapshot writes any key | caught | `a-backup-nobody-has-ever-restored` |
| 16 | **The snapshot key ceiling is not enforced** | **unnoticed** | same |
| 17 | An oversized record restored not reported | caught | same |
| 18 | A blocked account is off hold | caught | `a-hold-that-only-stops-buying` |
| 19 | `GLOBAL_KILL` no longer pauses the cron | caught | `stop-means-stop-spending` |

10-13 are one finding and the worst of the session: `aiAgentLoop` runs tools on
somebody's own machine unattended, and NO TEST HAD EVER CALLED IT. Three suites
name it - one greps the source, one replaces it with a stub, one describes it in
a registry. Mentioned three times, executed zero.

16 is a ceiling that was declared, exported, and had a test asserting it EXISTS,
while nothing checked the importer obeys it.

1 is revocation working by the door that was tested: the revoke deletes the
lookup row AND marks the item, the suite proves the key dies, and it dies by the
delete - which is wrapped in a catch that swallows.

## What this does NOT cover

Said plainly, because an audit that implies more than it measured is worse than
none.

- **Twenty-three mutations is not every mutation.** These were chosen as the
  ones with the worst consequence, not exhaustively.
- **Nothing here tests the live deployment.** It tests the code in this
  repository. Secrets, bindings and DNS are checked by the deploy preflight and
  by the CI health check, which are different claims.
- **Provenance is not covered at all.** Every connector finding above is about
  a connector the person chose to run. Who may publish one, what review a
  listing gets, and whether a package is pinned are open questions and the
  reason Milestone 9 is closed. See ROADMAP.md.
- **The model is not a security boundary and is not treated as one.** A
  connector's description goes into the model's context verbatim; the bound on
  its length is a cost control. What stops a tool call the person did not want
  is the consent dialog, which is why attack 2 above mattered so much.

## Round two: the owner's own fault list, attacked the same way

The security audit above measured guards by breaking them. This round applies
the same test to the suite that checks the fourteen faults the owner reported,
`every-fault-that-was-reported-stays-fixed`. Every assertion in it was written
to protect a complaint the owner made in their own words, so an assertion that
cannot fail is a complaint nobody is actually watching.

Thirteen mutations, one per claim, each reverted immediately.

| # | what was broken | caught by |
|---|---|---|
| 1 | repaint suppression deleted | 10 assertions, incl. build and chat |
| 2 | the shared Build offset deleted | 3 assertions |
| 3 | the Build entry made unscrollable past its edge | reachability |
| 4 | `_STUDIO.openWip` never set on resume | 2 assertions |
| 5 | `buildHome()` dropped from the sidebar | pressing Build lands on Build |
| 6 | `cwCountry` made to ignore its argument | 2 assertions |
| 7 | the top block cut from five to three | five jobs lead the catalogue |
| 8 | a credential field added to the connect screen | asks for no credential |
| 9 | the job panel's action pushed below the fold | the decision is on screen |
| 10 | the price rendered twice | states the price once |
| 11 | a removed feature promised again in Help | Help promises nothing removed |
| 12 | Lab made a scroller inside a scroller | 3 assertions |
| 13 | `CW_START_HERE` cut to three entries | NOTHING - and correctly so |

13 is not a hole. The code tops the block back up to five from the catalogue
ranking when a curated id is missing, deliberately, so the mutation changed
nothing a person would see. A mutation that does not change behaviour cannot
measure an assertion, and recording it as a miss would have been the wrong
report. Mutation 7 tested the real claim and was caught.

### What this round actually found

One real hole, and it was on the complaint made most often.

Deleting the repaint suppression originally failed only THREE assertions -
crew, handoff, integrations - while build, chat, lab and billing stayed green.
Those four were not protected; they were vacuous. The reason is mechanical:
`arrive` waits for a view to repaint itself, and a view only repaints when it
FETCHES. Crew, Handoff and Integrations load data. Build and Chat render
synchronously and never repaint under test, so their assertion was true no
matter what the code did.

Build and chat are two of the four screens the owner named. A test that cannot
fail on the exact screen somebody complained about is the failure mode this
file was written to prevent, reproduced inside the file itself.

Fixed by causing the repaint instead of waiting for it: `renderView()` is the
dispatch the app re-runs when data lands, so calling it is the same event
without the wait. The same mutation now fails ten assertions, build and chat
among them.

### Still unmeasured

- **The live site.** Everything here drives `public/` served locally. Whether
  `amv.homes` serves these bytes is the host's business and is not checked from
  the repository.
- **Billing is checked for what it SAYS, not how it looks.** "It has to look
  professional" is not a property a DOM assertion holds. The checks cover the
  price appearing once, no bare dash where a date belongs, one surface rather
  than a stack of boxes, and the one action that matters being present.
- **Thirteen mutations is not every assertion.** Sections 4 to 7 each have one
  or two claims proven able to fail, not all of them.
