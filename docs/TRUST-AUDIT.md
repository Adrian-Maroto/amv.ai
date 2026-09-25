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

## Round four: the work of this session, attacked as it was written

Seven features went in across four commits - cross-device sync, the
impossibility verdict, the green flag, retries, country-aware planning, the
catalogue's examples and sharing a result. Each was mutated as it landed rather
than afterwards, which is the only ordering that catches the suite that never
could have failed.

Fifteen mutations. All fifteen caught, but three of them only after fixing the
suite first, and those three are the interesting entries.

| # | what was broken | caught by |
|---|---|---|
| 1 | `AMVSync.flush` unwired from pagehide/visibilitychange | 6 assertions, incl. the second device |
| 2 | the sign-in push deleted | first sign-in puts it on the server |
| 3 | the returning-visit sync door deleted | both directions of a reload |
| 4 | the floor check dropped from the command bar | 3 assertions |
| 5 | a refusal parsed as an empty plan | the reason survives the parse |
| 6 | the review dropped from the green condition | an unchecked job is not called running |
| 7 | the needs screen scheduling behind your back | 4 assertions |
| 8 | every failure retried, not just the transient | attempted exactly once |
| 9 | the tick budget ignored by the retry loop | 3 assertions |
| 10 | one generic give-up paragraph for four causes | each cause gets its own answer |
| 11 | the country dropped from the plan call | and so is where they are |
| 12 | the example strip removed from both cards | 4 assertions |
| 13 | a region-less browser assumed American | not assumed to be American |
| 14 | share handed straight to the modal that publishes on open | no public page exists yet |
| 15 | the fiction check left in place but never asked | 4 assertions |

### The three that needed the suite fixed first

**14 passed before it should have.** "No public page exists yet" was measured on
a DISCONNECTED app, and the hosted share is only ever attempted when there is a
live backend and a session - so that assertion was true whatever the code did,
including a version that published the moment the screen opened. It connects
first now. This is the same shape as `saved-is-not-sent` in the harness notes:
an assertion that holds for a reason unrelated to the thing it names.

**15 was not covered at all, and reading the code said otherwise.** The fiction
check had three assertions on the pure function and none on the route, so
`if(false)` in `plan()` changed nothing any suite noticed. A verifier and the
route that uses it are two separate claims; only the first can be checked by
reading, and the first is worthless alone.

**12 was half-covered.** Browsing on the free plan renders the LOCKED card, so
every assertion measured that branch while the card a paying customer sees -
its own function, its own copy of the markup - was never rendered once. Removing
the strip from the live card only would have shipped.

### And one thing deleted rather than fixed

`AMVFeasible.say()` was written "ready to render" and called by nothing, in
source or in tests. Both surfaces that report an impossible verdict build their
own markup around the reason and the alternatives, so the helper was a third
phrasing waiting to drift from the two that ship. Removed.

### Round five: two more found by looking at this session's own work

Both are in code written the same day, and neither would have been noticed by
running the product.

**The flag that switches sync on was never proved to switch off.** One
bootstrap now serves both doors into sync and runs once per session, and
"once" is held by a flag. A flag that is never cleared is a feature that works
exactly one time. The case is not exotic: sign out, hand the laptop to
somebody else, they sign in on the same page load - and the second account
never pulls. They open AMV, their own chats are not there, and the product
looks broken on the first screen they ever see of it. `signOut` clears it and
always did; nothing measured that, so deleting the line changed no result.
Now `6 -> 6` pulls fails the assertion by name. (`signOutAndErase` reaches the
same function rather than repeating it, which is a call-graph fact and is
proved by reading rather than measured.)

**The share screen promised a page that would not exist.** The confirm said
"This makes a public web page" unconditionally. With no backend the share falls
back to packing the whole result into the URL fragment - nothing is stored on a
server, which sounds like the safer of the two and is the more dangerous one to
be careless with. There is nothing to revoke: the content IS the link, so
anybody who has it keeps it and forwarding it forwards the text. The old
sentence was false in the direction that matters, implying a page somebody
could take down, and the warning under it offered "a link can be revoked later"
as reassurance about a link that cannot be. Both switch now on the same
condition the share itself uses.

| # | what was broken | caught by |
|---|---|---|
| 16 | `_syncBooted` never cleared on sign-out | the second account pulls its own data |
| 17 | the confirm assuming a hosted share always happens | 4 assertions |

### Round six: the gate was green and CI was red, and both were honest

CI on `main` had failed four runs running - 738 through 741 - and `deploy.yml`
only runs after `tests` succeeds, so every deploy was SKIPPED and the Worker
had not shipped for days. The local gate said SHIPPABLE on the same commits.
Neither was lying.

`styles.css` ships a metric-matched fallback whose sources are all LOCAL
fonts: `local('Arial'), local('Helvetica Neue'), local('Roboto')`, with
`size-adjust:107%`. On a runner - or any real computer - one resolves and text
draws about 7% wider. In this container none exists, the declaration errors,
and text is narrower. Same page, two line-break patterns, so any layout
assertion that depends on where text wraps has two different answers.

Two real bugs lived in that gap, both invisible locally and true on nearly
every real machine:

- the plan cards' reassurance note ran to THREE lines, not two, so LAYER A62's
  `min-height:31px!important` reserved too little and the four buttons drifted
  15px apart - on the row where somebody decides to pay. The `!important` is
  why every later attempt to fix it from an append layer, including one made
  the same morning, was dead on arrival.
- an engine description wrapped in the 340px picker and the five-item menu
  came out 2px taller than its room, so a roomy desktop grew a scrollbar.

Fixed at the source in both cases, and by construction rather than by
calibration: `lh` for the note, so the reservation is line boxes of the
element's own text; and 400px for the picker, measured at 340/372/400 as the
width where NOTHING wraps in either font, rather than the 372 that merely
scraped past. `the-layout-holds-in-the-font-a-real-browser-draws` forces the
fallback onto a font both machines have and asserts FIRST that the text really
did get wider - without that control every check below it passes for the wrong
reason.

### And the one the gate found on the way

`the-session-survives-a-reload-without-a-token-on-disk` failed three
assertions under parallel load and passed alone - the shape of a flake, and
the shape people learn to re-run. It reproduced in two consecutive full gates,
so it was neither.

Instrumenting it: a refresh was in flight, signOut cleared everything
correctly, and 300ms later the token was back, written by `_setTokens` called
from `_doRefresh` called from `_fetch`'s 401 path. Nothing reached disk, so
nothing survived a reload - but `hasSession` reads memory, so the app went on
believing somebody was signed in and the next request would have carried a
working bearer token for the account that had just asked to leave. On a slow
connection that is not an edge case; it is what Sign out looks like when the
network is bad.

Fixed with a session generation counter: sign-out moves it on and drops the
in-flight promise, and work started under an older number does not get to
write. Cheaper than cancelling and correct even when it is too late to cancel.

TWO WRONG TURNS WORTH KEEPING. The mechanism was ruled out early because
`/auth/` paths are excluded from the 401-refresh path - true, and irrelevant,
since the refresh was provoked by an ordinary `/v1/usage` call. Then a probe
"disproved" it by calling `_doRefresh()` with `_fetch` stubbed; `_doRefresh`
is entered FROM INSIDE `_fetch` and never goes back out through it, so the
stub never saw the refresh. A test that reaches code by a route the product
never takes can pass while the product is broken. The regression suite stubs
the network underneath and lets the app find its own way there.

| # | what was broken | caught by |
|---|---|---|
| 18 | the note's reservation back to a hardcoded 31px | 4 assertions, both widths |
| 19 | the picker narrowed back to 340 | it fits, and no description wraps |
| 20 | the generation guard removed from the refresh | 3 assertions |

### Still open from this round

- **Two suites hardcode the same port.** `every-surface-that-is-not-chat` and
  `the-seller-actually-gets-it` both bind 9201. Not the cause of anything
  above - it was checked and ruled out - but a collision waiting to happen,
  and the kind that reads as a flake when it does.

### Still unmeasured, this round

- **The general impossibility layer needs a key.** The floor is a pure function
  and is measured directly; the catalogue layer is the planner, which is stubbed
  here. What is proven is the contract around it - that a refusal is parsed
  rather than mistaken for an empty plan, rendered as cannot rather than as an
  error, and that nothing is scheduled behind it. Whether the model judges any
  particular request correctly is not a property a suite can hold.
- **`keepalive` outliving the page is not demonstrated.** Showing it needs the
  tab destroyed with the request in flight, which was not reliable to drive from
  the harness. What is shown is the thing the fix adds: the request is SENT when
  the tab is hidden instead of waiting for a timer that will not run.
- **The retry loop is driven with a stubbed executor.** Which failures are worth
  repeating and what is said when repeating stops are decisions this code makes
  on its own, and those are measured. A real engine failing for real is not.

## Round seven - the bank becomes a real capability

The thing being attacked here is new power. An unattended run can now open a
bank connection and read balances and transactions, so the question is not
whether the reader works - it is whether the controls that stop it are real.

Worth saying plainly about scope: this is a READ. `AUTO_USES_ALLOWED` contains
nothing but entries ending `.read`, `_bankPost` is reachable only from
`/accounts/balance/get` and `/transactions/get`, and the aggregator's payment
and transfer products are not configured. Balances were already readable
unattended - the investing check-in has done it on cron since it was written -
so what was added is the transaction list beside them, not a new class of
access. There is still no route from the cron to moving money.

Eleven mutations, all eleven caught, each attributed by the failing assertion
and not by an exit code.

| # | what was broken | caught by |
|---|---|---|
| 21 | the pause check deleted from `_bankUse` | 5 assertions, including that the run behind it reached no provider |
| 22 | an unreadable `auto` record fails open instead of refusing | "it REFUSES - the cost of being wrong this way is a job that waits" |
| 23 | credits allowed to count as subscriptions | "money coming IN is never a subscription" |
| 24 | the pending-charge skip removed | "counted twice and not three times" |
| 25 | the receipt figure overwrites the debit in the merge | "at the figure that left the account" |
| 26 | boosts pushed into `missing` instead of `soft` | 3 assertions |
| 27 | `AUTO_USE_TO_CAPABILITY` seeding removed from `_autoNeedsFor` | "refused BEFORE the run, on the list screen" |
| 28 | a text matcher added that derives `bank.read` from words | 4 assertions |
| 29 | `'Bank connection'` row removed from `_CW_NEEDS_TO_USES` | 7 assertions across all five bank jobs |
| 30 | `_cwConnHas` stops answering `bank.read` | 4 assertions |
| 31 | the boost dropped in `_cwToggleReal`, then in `_scheduleTask` | "AND SO IS THE BOOST", once per joint |

Two of those mutations found live defects rather than confirming a control.

**#30 was a real bug, shipped in the first draft of this work.**
`_cwUnattendedReady` asked `_cwConnHas('bank.read')`, which searches the
connector grants for a `scopes` array - and a bank link has never lived there,
it lives in a `fin` record holding an aggregator token. So it answered no for
every account: the card said the job was ready and the same job was then
classified as running in the browser. Correct at both ends, unjoined in the
middle, which is the shape this file keeps recording.

**#31 was a real bug and it is the more instructive one.** `_cwToggleReal`
passed `boosts`, `_cwBoostsFor` computed it correctly, the card rendered it -
and `_scheduleTask` writes its outbound payload out field by field and did not
name `boosts`, so it was discarded one function short of the wire. Nine
assertions passed over the hole because all nine measured the computation. It
was found by deleting the caller's argument and watching the suite stay green.
The suite now intercepts `/auto/create` and drives the real toggle on the real
catalogue entry, so cutting either joint fails it.

### Still unmeasured, this round

- **No real aggregator is called.** The provider is stubbed at `fetch`, so what
  is proven is the shape AMV sends, the two endpoints it is willing to call, and
  what it does with the answer. Whether a particular institution returns
  `merchant_name` populated, or dates in the field this reader prefers, is not
  something a suite here can hold. The consequence of it being absent is
  visible rather than silent: `_txnMerchant` falls back to `name`, and a row
  with neither names nobody and is dropped.
- **A yearly subscription is not detected and is not claimed to be.** Two
  charges are required and the window is 120 days, so an annual plan simply
  does not appear. That is the deliberate choice - inventing a monthly figure
  from one annual charge is the expensive false positive - but it means the
  list is genuinely incomplete and the prompt has to say so. That it says so is
  asserted; that somebody reads it is not.
- **Credit watch still cannot answer its own question.** A transactions link
  carries no credit score and no report. The block names that absence
  explicitly so a model holding rich bank data does not treat "credit" as
  covered by it, and the job's own prompt says to say so. The job remains one
  AMV cannot really do, and that is a product decision rather than a test gap.

## Round eight - the Connectors page, rebuilt

Not a security round. What is being attacked is whether the page tells the
truth about what it has and has not done, and whether the claims that were
removed with the topic rows were actually re-established somewhere rather than
quietly dropped.

Seven mutations, all seven caught.

| # | what was broken | caught by |
|---|---|---|
| 32 | the search box moved back inside the repainted node | 4 position assertions, plus element identity across a repaint |
| 33 | the box rendered in BOTH places (two `#cdir-find`) | "there is exactly one of it, not one per section" |
| 34 | `idle` falls through to "nothing matches" again | 2 assertions, one sampling from the first frame |
| 35 | the second page fetch dropped | "holding about a hundred" and the round-trip count |
| 36 | the overview starts fetching on paint again | "makes no registry request at all" |
| 37 | the bank row reverts to a plain `use` shape | "no Connect or Disconnect this page could not carry out" |
| 38 | the Bank & money door runs `ecommerce` instead of `finance` | "no query has both a hand-built door and a registry door" |

Two of those were live defects rather than confirmations.

**#33 is a note about how a mutation can lie.** The first attempt at putting the
search box back inside `.cdir` did not fail anything - because it did not MOVE
the element, it added a second one with the same id, and `getElementById` kept
returning the surviving one. The mutation looked like it proved the test was
worthless; it actually proved the test was measuring something the mutation had
not changed. The fix was to assert there is exactly one, which is a real
constraint on its own (two inputs sharing an id is undefined behaviour for any
label pointing at it) and is the only way that mutation can be made faithful.

**#34 was a real bug and removing the rows is what exposed it.** See LESSONS
497. A branch that had never been reachable became the state the page opens in.

### What was deliberately NOT done

- **`MCPREG_MAX` stayed at 50.** "About a hundred each" is met with two round
  trips rather than by raising the per-request ceiling. That ceiling is not a
  layout number: the route needs no account and one request there can cause six
  reads of somebody else's registry, so doubling what a stranger can pull per
  request to satisfy a copy decision would be trading an abuse bound for a
  round trip. Two requests from one person browsing is nothing.
- **The bank link was not reimplemented on this page.** It is a hosted sign-in
  with a pre-opened window, a user activation that must not be spent on an
  await, and a returning step on a replaced node. The row navigates to the one
  implementation instead. A second copy of a money flow is two things to keep
  correct and one of them will rot.

### Still unmeasured, this round

- **The concurrency gate is no longer exercised by the product.** `CDIR_PARALLEL`
  and the queue behind it were built because thirty rows asking at once tripped
  the route's own rate limit. Nothing now issues more than two requests at a
  time, so the gate is live code on a path that cannot saturate it. It is kept
  because `Load more` and rapid topic switching still queue through it, and the
  suite still asserts nothing exceeds four in flight - but that assertion can no
  longer fail for the reason it was written.
- **No real registry is called.** The provider is stubbed at the route, so what
  is proven is what AMV sends, how many times, and what it does with the answer.
  Whether a given topic word finds things in the live registry is not something
  a suite here can hold, and the module's own rule - a heading is only allowed
  if its query finds things - still rests on somebody having checked.

## Round nine - the first two high findings from the external audit

An external audit reported 29 findings (8 high, 17 medium, 4 low) against the
browser bundle and the bridge daemon. This round covers the two with the worst
outcomes: silent loss of somebody's file, and a stop control that did not stop.

Neither was taken on the report's word. Both were reproduced against a real
daemon, and one of them turned out to be correct about the symptom and wrong
about the cause.

| # | what was broken | caught by |
|---|---|---|
| 39 | exec children no longer killed on shutdown | "the command the bridge started is gone with it" (marker file on disk) |
| 40 | `not_found` collapsed back into a generic failure | nothing - see below |
| 41 | every read failure means absent again (client) | 4 assertions in the undo suite |

**AMV-AUD-004, and it needed a real process to see.** The signal handler killed
MCP servers, because those are the children something kept a list of. `/exec`
spawns its child inside the route handler, so nothing outside that closure ever
knew it existed - a build, a download or a long test run carried on after the
daemon was gone. The request socket closed, so the person saw the command stop;
the process did not. Exec jobs are tracked now, killed by process group on
`exit`/`SIGINT`/`SIGTERM`, and nothing new is admitted once teardown starts.

The suite proves it on DISK: the child sleeps past the daemon's death and then
writes a marker. A process id says nothing once the parent is gone, and "the
socket closed" is exactly the false comfort this defect hid behind. It also
asserts the daemon really died, so the section cannot pass against a live bridge
that happened to be tidy.

**AMV-AUD-007 was real and the report blamed the wrong end.** See LESSONS 498.
The daemon has always distinguished absence (ENOENT becomes 404 `not_found` in
the handler at the bottom of the request function); `_bridgeCall` threw a plain
Error carrying no code, so the browser could not act on it. Mutation 40 is
recorded as caught by NOTHING on purpose: it is the mutation that proved a fix
of mine was redundant, and removing it is the finding.

The real fix is in three places - `_bridgeCall` carries `code`, `bridgeRead`
returns null only for absence, and `_agentRunTool` refuses to write a file it
could not read - and mutation 41 fails four assertions.

**A rule was deliberately changed, not just repaired.** Undo no longer deletes a
created file whose contents have stopped matching what the turn wrote. An
existing assertion said the opposite and was rewritten rather than worked
around, with the reasoning in place: overwriting is recoverable through Redo, a
delete is not, and `after` lives in one tab. See LESSONS 499.

### Still open from this round

- **A per-job cancellation route.** The audit asks for one, and shutdown is not
  it: stopping the whole daemon to stop one command is a blunt instrument, and
  it is the only instrument today. Nothing can cancel a single running exec.
- **AMV-AUD-003 is untouched.** Disconnect still clears browser state without
  telling the daemon anything, so a previously copied token stays valid and
  running connectors stay alive. It shares machinery with the cancellation route
  above and is the next thing to do.
- **AMV-AUD-005 is a decision, not a defect to fix quietly.** Isolated execution
  with a minimal environment allowlist changes what the bridge fundamentally is
  and what it can do for people. The owner decides that, not this file.

## Round ten - disconnect reaches the machine

AMV-AUD-003. `_bridgeForget` cleared the browser's copy of the pairing token
and made no request at all, so the daemon kept the session valid, kept running
connectors alive, and kept accepting work from anything still holding that
token from an allowed origin - while the screen said "Disconnected. AMV can no
longer reach that folder."

| # | what was broken | caught by |
|---|---|---|
| 42 | revoke does not clear the session | "the SAME token is refused afterwards", plus one per route |
| 43 | revoke does not stop running work | "the running command was killed" (marker file on disk) |
| 44 | disconnect goes back to telling nobody | "exactly one request goes out" |
| 45 | disconnect claims revoked whatever happened | 4 assertions across the unreachable and 500 cases |

The daemon route is authenticated by the token it is about to destroy, so only
the session that owns it can end it, and it is total: session cleared, exec jobs
killed by process group, connectors stopped. There is no partial disconnect -
a connector left running is a program somebody else wrote, still on their
computer, after they said stop. It reports what it stopped so the page can say
so rather than assume.

**The browser half is where the honesty is.** Clearing local state only on a
successful revoke would be worse than the original defect: somebody would stay
paired in a tab they had just told to disconnect. So local state always goes and
the SENTENCE changes - "the bridge ended the session on your computer" against
"disconnected here, but AMV could not reach the bridge; close the bridge window
to be sure." Those are different facts about somebody's machine and only the
person can act on the second.

A 401 counts as revoked, deliberately: there is nothing left to end, which is
the state being asked for. A 500 does not, because the daemon is there and did
not do it.

### Still open

- **Per-job cancellation.** The audit asks for one and this is not it: stopping
  a single running command still means revoking the whole session or closing the
  daemon. Both are blunt, and both are all there is.
- **Session expiry.** The audit asks for idle/absolute expiry. Not added: a
  bridge left open overnight on a long build is the normal case, and an expiry
  that fires mid-run would be a new way to lose work. It is a product decision
  with real friction either way, and it is the owner's.
- **AMV-AUD-005 and AMV-AUD-001 remain decisions, not defects.** Isolated
  execution and a minimal environment allowlist change what the bridge is and
  what it can do for people.

## Round eleven - a tool that was never offered

AMV-AUD-006. Both agent loops dispatched whatever name the model returned.
`aiAgentLoop` ran `runTool(c.name, ...)`; the chat streaming turn ran
`_amvRunTool(t.name, ...)`. Neither checked membership in the tool list the
request had actually supplied - and the dispatchers behind them are not narrow:
`_amvRunTool` reaches account actions, `_agentRunTool` writes files and runs
commands on somebody's computer.

This needs no adversarial model. Tool names are conventional and models
generalise across them, so the ordinary case is a plausible name for something
the surface does not have. It also matters because both lists are CONDITIONAL -
the machine's tools only while a bridge is connected, connectors only while they
are running - so "what exists" and "what this turn offered" are different sets,
and a name remembered from a previous turn was still dispatchable.

| # | what was broken | caught by |
|---|---|---|
| 46 | the loop dispatches any name again | 4 assertions, led by "the dispatcher was not called at all" |

The refusal is a tool RESULT rather than a throw: the model is told what it may
use and the turn carries on with a correction instead of ending at the moment
the work starts. One bad name in a batch does not stop the good ones, which is
asserted - refusing the batch would turn a correctable mistake into a lost turn.

In the chat loop the check sits BEFORE the consent prompt. Asking somebody to
approve a tool that does not exist in this turn is a dialog about nothing, and a
"yes" to it would be consent pointing at a dispatcher lookup rather than at a
known action.

### Honest about what this round does NOT measure

- **The chat dispatch site is checked by reading source, not by driving it.**
  Reaching that turn behaviourally needs a stub for the whole SSE path, its
  tool-block assembly and its rendering - a large amount of fiction for one
  claim. What the source check asserts is ORDER (membership before consent,
  before dispatch) and that the offered set is assembled exactly once. A test
  that reads source can only say a line is present; the behaviour there remains
  unmeasured and is recorded as such rather than implied.
- **Arguments are still not validated against the declared schema.** The finding
  asks for that too. Only the NAME boundary is closed. A tool called with the
  right name and wrong-shaped arguments is still passed through to its handler,
  which is where the existing per-tool checks are.
- **One assertion in this round was wrong and failed honestly.** A regex meant
  to prove the offered set is "never rebuilt from the reply" matched the
  legitimate construction, because the map parameter over `tools` is also named
  `t`. A pattern that cannot tell the right construction from the wrong one is
  not a check. It was replaced with a count of assignments, which can.

## Round twelve - signing out gives up the keys too

AMV-AUD-002. `_wipeAccountState` reset a lot of state - recents, the Dev
project, Lab code, memory, the verified plan, the renewal date, the admin
figures - and every one of those belongs to a SCREEN. What it did not touch was
a different kind of thing: live authorities that never consult `S.user`, and so
kept working after the user was gone.

An administrator token that `isAdmin()` reads instead of the user. A bridge
token and its stored pairing, which is shell access to a computer. Connector
credentials in sessionStorage. A granted `FileSystemDirectoryHandle` - read-write
access to a real folder - plus the files already read out of it.

Alice signs out, Bob signs in on the same browser, and the tab holds Alice's
administrator token, her machine, her connectors' credentials and her folder,
while the screen says nobody is signed in. The shared machine is the ordinary
case here, not an exotic one.

| # | what was broken | caught by |
|---|---|---|
| 47 | the administrator token is not cleared | 2 assertions |
| 48 | the bridge is not disconnected | 2 assertions |
| 49 | connector credentials are left in sessionStorage | 3 assertions |
| 50 | the folder handle is kept | 3 assertions |

Each holder is cleared in its own `try`, and the suite asserts that property
directly: with the first clear made to throw, the bridge token, the connector
credentials and the folder handle still go. A single `try` around all of them
would clear whatever came before the throw and leave the rest, and the order
that survives is arbitrary - which means the dangerous ones can be the
survivors.

The bridge is TOLD rather than forgotten, through the same `bridgeDisconnect`
the Disconnect button uses, for the same reason: forgetting a token locally
leaves the daemon accepting work from anything that still holds it. It is not
awaited - sign-out must not become conditional on a program being reachable -
and a suite asserts the browser gives up the token even when the daemon is gone.

### A note on method

Three mutations in this round were first run through a shell loop whose escaping
mangled `&&` into `\&\&`. Two of them failed to BUILD, so the suite ran against
the previous bundle and reported "21 passed" - a pass that measured nothing.
They were rerun from a script. A mutation whose build failed is not a mutation
that was survived, and the tell was that the build error and the test result
were printed by different commands with nothing tying them together.

### Still open

- **AMV-AUD-008 (refresh tokens not bound to a backend origin)** is the last
  high finding that is a defect rather than a decision.
- **AMV-AUD-001 and AMV-AUD-005** remain decisions for the owner: an isolated
  execution origin, and sandboxed execution with a minimal environment
  allowlist. Both change what the product can do for people.

## Round thirteen - a credential belongs to one backend

AMV-AUD-008, and it is the last of the eight high findings that is a defect
rather than a decision.

`_fetch` has refused to attach the bearer token to an origin it was not issued
for since AMV-013. `_doRefresh` had no such check: it posted `{refreshToken}`
to `this.base + '/auth/refresh'` whatever `this.base` had become. So pointing
AMV at a different backend withheld the credential that expires in minutes and
then offered the one valid for weeks to the new destination on the very next
401. That is the wrong way round - a copy of a refresh token is a copy of the
account.

| # | what was broken | caught by |
|---|---|---|
| 51 | the setter keeps the bundle on an origin change | 4 assertions |
| 52 | the refresh token is kept | "AND SO IS THE REFRESH TOKEN" |
| 53 | the authentication generation is not moved | "work in flight lands as stale" |
| 54 | `_doRefresh` unguarded again | 3 assertions, led by "never put on the wire" |

**The fix is invalidation, not a second guard.** Guarding `_doRefresh` alone
would leave a bundle in memory belonging to nobody: an access token for one
origin, a refresh token that may not be used, and a cookie-auth flag set by a
server nobody is talking to. Changing the backend drops all of it and moves the
authentication generation, so a refresh already in flight lands as stale rather
than writing a token back for the origin that was just left.

The guard inside `_doRefresh` stays as defence in depth and is asserted
separately - the setter is one way the base changes and a stored value edited
elsewhere is another, and this is the expensive credential.

**The thing this must not do is sign people out for pressing a button.**
Settings writes the base on every test-connection press, so invalidation fires
on a real ORIGIN CHANGE, not on a write. Asserted: saving the same URL twice,
once with a trailing slash, leaves the bundle and the generation untouched.

### The eight high findings, after this round

Six are fixed and measured: 002 (sign-out teardown), 003 (disconnect revokes),
004 (shutdown stops exec children), 006 (unoffered tool names), 007 (read
failure is not absence, and Undo keeps your edits), 008 (credential binding).

Two are NOT defects to fix quietly and remain open for the owner:

- **AMV-AUD-001** - generated code runs in a worker on the application origin.
  Moving it to a dedicated non-authenticated origin means a second host and a
  change to production infrastructure.
- **AMV-AUD-005** - `/exec` runs a real shell as the person, inheriting their
  environment. Isolated execution with a minimal environment allowlist changes
  what the bridge fundamentally is and what it can do for people.

Both are recorded rather than acted on, because both change the product rather
than repair it.

## Round fourteen - two gate suites were reading prose as code

The full gate after round thirteen failed in two suites, and both failures were
caused by comments written during the audit work. Chasing them found that the
false alarms were the harmless half of a real weakness.

**`the-app-asks-for-routes-that-exist` had a hole the size of the API.** It
scrapes the worker's route table from `case '/v1/x':` lines and from
`path.startsWith('/prefix/')` calls, and a prefix answers everything under it.
It read the worker with comments in, and the worker contains a comment
explaining why a prefix was REMOVED:

    This was `path.startsWith('/v1/')`, which reads like "the API" and is not.

That line was parsed as a live `/v1/` prefix, so `answered()` returned true for
every path beginning `/v1/` - almost every route in the product. The suite's
whole purpose is to catch the app asking for a route the worker does not serve,
and for `/v1/` it could not.

Measured, not reasoned about: a deliberate call to `/v1/not-a-real-route` was
added to the client and the suite passed. With comments stripped from both
sides it fails, naming the path.

**`tool-consent-coverage` could be satisfied by a comment.** It passes a
model-driven dispatch site when `_toolNeedsConsent(` and `_confirmModelTool(`
appear in the 900 characters above it. A comment mentioning those names
satisfied that exactly as well as code did - so a genuinely ungated dispatch
under a paragraph ABOUT consent would have been reported as gated. The false
alarm that surfaced it ran the other way: a comment of mine quoted
`_amvRunTool(t.name, ...)` and was counted as a dispatch site.

Both suites now read through `codeOnly`, the helper the gate's DEAD GUARDS stage
already uses "so a comment explaining a removal is not mistaken for the removal
not happening". The same reasoning had simply never been applied to these two.

| # | what was broken | caught by |
|---|---|---|
| 55 | the client asks for a `/v1/` route the worker does not serve | "nothing is asked for at a spelling the worker does not answer" (was: nothing) |
| 56 | the chat consent gate deleted, a comment about consent left in its place | 4 assertions (was: nothing) |

### What is still NOT caught, stated plainly

- **`if(false && _toolNeedsConsent(t.name))` passes `tool-consent-coverage`.**
  A test that reads source can only say a line is present, and that mutation
  leaves every line present. The chat consent path is behaviourally unmeasured.
  The `runAgentic` path could be measured - it goes through `aiAgentLoop`,
  which now has a behavioural harness - and has not been yet.

### The pattern, for the next person

Four suites in this session had to be fixed for reading prose as code, and the
gate already had the lesson written down in one stage. A check that scrapes
source is a parser, and a parser that treats comments as syntax is wrong in both
directions at once: it raises alarms about sentences and it accepts sentences as
evidence. Every source-reading check should strip comments unless it is
specifically about comments.

## Round fifteen - a fix that failed was reported as fixed

AMV-AUD-010, and broader than reported. `autoDebug` returns `{success}`; both
callers tested `res.ok !== false` on a result that has never had an `ok`, so
EVERY failure path - budget, fixer error, identical fix, attempts exhausted -
was announced as "Fixed and now passing". See LESSONS 501.

| # | what was broken | caught by |
|---|---|---|
| 57 | the chat tool back to `res.ok !== false` | 9 assertions |
| 58 | the Lab back to `res.ok !== false` | 3 assertions |
| 59 | the never-run patch no longer flagged | 2 assertions |

Both callers now read one `_debugOutcome`, which passes only on `success ===
true`, carries the real last error, and flags a patch that was never run. The
suite drives both real callers with the runner and the fixer stubbed - the
defect is in what the callers conclude, not in the model.

One stub was wrong first and the product exposed it: a "new fix" string
contained `Math.random()` as TEXT, so every fix was identical and the loop
correctly stopped on "identical" rather than reaching the cap. The product
reported that truthfully; the section meant to exhaust the attempts was fixed.

### A gate run was discarded, deliberately

The full gate for round fourteen was stopped part-way. Its build stage ran
between two source edits for this round and built a tree that never existed as a
commit, so its verdict could not have meant anything about either. See LESSONS
500. Round fourteen and this round are gated together below.

## Round sixteen - the device ledger stops asserting payments it cannot see

Billing has two lists. The processor's invoices, read from the server, are the
record, and the page says so. "Payments recorded on this device" is kept in the
browser and is explicitly secondary. Two paths wrote untrue things into it.

**AMV-AUD-012 - a plan change was written down as a payment.** `_setPlan`
appended a `paid` subscription at list price whenever the plan went up, and the
plan goes up for reasons that are not payments: an entitlement sync, an admin
grant, a trial. It was titled "monthly" even for yearly plans. Removed outright.
Nothing real is lost - with no backend nothing is ever charged, and with one the
real charges are the processor's invoices, which are untouched.

**AMV-AUD-011 - a return URL was taken as a receipt.** `?bought=` marked "the
first pending marketplace record" paid and announced "Purchase complete", on a
query string anybody can type and that can arrive before the webhook. The return
is now a request to check: `/v1/market/purchases` is asked a few times, and only
an order it lists is settled - that one, by listing id. Until then the screen
says it is confirming; if it never confirms, it says that.

| # | what was broken | caught by |
|---|---|---|
| 60 | a plan change writes a paid transaction again | a-return-url-is-not-a-receipt |
| 61 | settle takes the first pending order again | both suites (2 + 3 assertions) |
| 62 | the return URL settles without asking the server | both suites (3 + 1) |
| 63 | the confirm accepts ANY listed purchase | a-return-url-is-not-a-receipt |

**Two of these mutations survived the first version of the suite**, and both
were the test's fault. "First pending" passed because `_recordTxn` PREPENDS, so
the order recorded second - the right one - sat first, and the buggy lookup
happened to pick correctly. And "accept any listed purchase" settled nothing in
the made-up-id case only because no order matched, while still announcing
"Purchase complete" for a listing never bought - which that section did not
check. Both sections were tightened until the mutations failed.

**A rule was changed on purpose.** `txn-settle` held that "the completed case is
knowable - the return says so". Its requirement - a purchase that really
completed must stop saying Pending - still stands and is still asserted; the
evidence it accepts changed from the URL to the server's record.

**Not a billing change.** Nothing here charges, refunds, grants, prices, or
talks to a processor. It stops a display from asserting money it has no evidence
of.

## Round seventeen - "local mode" is only said when it is true

AMV-AUD-013. The backend field in Settings is a per-device OVERRIDE. Clearing it
stores an empty string and the getter falls back to the address the deployment
was built with - which is the designed behaviour, written into the code as
"clearing it falls back to what shipped". The toast said "Cleared - local mode".
On every configured deployment that was false: requests kept going to the
built-in backend, and somebody who cleared the field to stop talking to a server
was told they had.

The behaviour was right and the sentence was wrong, so the sentence changed. It
is now decided by where requests actually go after clearing - the built-in host
by name, or "local mode" only when no backend is left. The Settings pane also
says whether the address in the box is this device's override or the
deployment's own, because after clearing, the built-in address reappears in the
box - true, and baffling without a word saying which it is.

| # | what was broken | caught by |
|---|---|---|
| 64 | the toast says local mode regardless | 2 assertions |
| 65 | the pane stops saying which address it shows | 2 assertions |

**Two wrong turns in the test, both about reaching the pane.** The Live /
Backend pane is owner-only (`ADMIN_SET_SECTIONS`), so the first version read a
screen with no pane on it; the second rendered it directly and the renderer's own
admin gate - correctly - swapped in the Account pane. Both found "no Status
line", which read identically to the defect. Admin is granted for the render and
restored straight after: the gate is another suite's claim, the wording is this
one's.

**What was deliberately NOT built:** a true "local-only" switch that gates every
request. The audit suggests an explicit mode enum. That would be a new product
state touching every network path, and nothing asks for it except the toast that
promised it - so the promise was withdrawn instead. If an offline mode is wanted,
it is a product decision.

## Round eighteen - two connector tools never share a name (AMV-AUD-020)

Connector tool names were squeezed into `mcp__<server>__<tool>` and identity was
recovered by splitting that name and taking the first tool whose spelling
matched. Colliding names made one tool unreachable and routed its calls to the
other; the consent dialog split the name the same way. Every offered tool now
gets an alias from a registry, bound to its exact server id and tool name for the
life of the tab, and routing, consent and the step list all read the registry.

`two-connector-tools-never-share-a-name` drives the real functions with
punctuation, spaces, a `__` inside a tool name, the `a__b`/`b__c` spelling
collision, two 65-character names sharing their first 64, two non-Latin names
that squeeze to the same thing, and a server listing one name twice. Only the
bridge call underneath is replaced, so the routed server and tool can be read.

| # | what was broken | caught by |
|---|---|---|
| 66 | lookup splits the name and takes the first match (the finding) | 3 assertions |
| 67 | colliding names are not given distinct aliases | 3+ assertions |
| 68 | the consent dialog splits the name instead of asking the registry | 1 assertion |
| 69 | a server listing one name twice offers it twice | 2 assertions |
| 70 | the registry is rebuilt on each listing, so a reorder swaps two names | 1 assertion |

Five for five.

## Round nineteen - "ready" is what the bridge says (AMV-AUD-019)

`mcpStartAll` reported any connector with a cached entry as ready, including
entries that recorded a failure. A connector is now reused only when its entry
holds no error, came from the current pairing, and the bridge's `mcp/list`
reports its process running; anything else is stopped (freeing the name on the
bridge, which still holds a dead process) and started again.

`ready-is-what-the-bridge-says` runs a real bridge with five connectors: one
seeded with an earlier failure, one whose process is SIGKILLed between pairings,
one that is up with no tools, one that is up and ready, and one that can never
start. Reuse is proven by the server's own pid file, not by the report.

| # | what was broken | caught by |
|---|---|---|
| 71 | any cached entry counts as ready (the finding) | 3+ assertions |
| 72 | the error field is not checked | 2 assertions |
| 73 | the process is not checked with the bridge | 2 assertions |
| 74 | an entry from an earlier pairing is trusted | 1 assertion |
| 75 | a dead process is restarted without being stopped first | 3 assertions |

Five for five.

## Round twenty - a character cut in two arrives whole (AMV-AUD-017)

The bridge decoded each stdout chunk separately, for connectors and for `/exec`,
so a multi-byte character split by the pipe was corrupted. Connector output is
now split into lines on the newline byte and each whole line decoded; `/exec`
and connector stderr keep one decoder per stream. An oversized line now fails
its waiting callers straight away, and is discarded through its end.

`a-character-cut-in-two-arrives-whole` uses a new fixture,
`mcp-awkward-server.mjs`, which cuts its reply inside every multi-byte
character (euro, CJK, accents, four-byte emoji, Greek) with a pause between
pieces so the pipe delivers them apart. It also sends three messages in one
write and a five-megabyte line.

| # | what was broken | caught by |
|---|---|---|
| 76 | connector replies decoded per chunk (the finding) | 2 assertions |
| 77 | an oversized line leaves its caller waiting for the timeout | 2 assertions |
| 78 | an oversized line is not discarded through its end | 2 assertions - SURVIVED at first |
| 79 | `/exec` output decoded per chunk | 1 assertion |

**78 survived the first version.** Its tail was `x` characters, which never
parse, so reading on from the cut point did no visible harm. The fixture now
ends that line with a well-formed reply to the NEXT request, preceded by
whitespace JSON allows, and without the discard that forgery answers the
following call. See LESSONS 504.

## Round twenty-one - a connector that cannot list its tools did not start (AMV-AUD-018)

A `tools/list` error became a 200 start with no tools, and a paginated listing
returned its first page. Discovery is now part of the start: every page is
followed, bounded at 20 pages and 500 tools; a repeated cursor is refused; any
failure kills the half-started process, frees its name, and returns
`discovery_failed` with the reason. A handshake whose result is not an object
is `handshake_failed`.

`a-connector-that-cannot-list-its-tools-did-not-start` drives each case through
the real bridge with the awkward fixture, plus the echo server with no tools, so
that "empty" is proven to still be a valid start.

| # | what was broken | caught by |
|---|---|---|
| 80 | a listing error becomes an empty success (the finding) | 3 assertions |
| 81 | only the first page is read | 3 assertions |
| 82 | a repeated cursor is followed | 1 assertion |
| 83 | the page bound returns a partial list as complete | 1 assertion |
| 84 | a non-object handshake result is accepted | 2 assertions |
| 85 | a failed discovery leaves the process running | 2 assertions |

Six for six. **Not built:** refreshing a server's tool list when it sends
`notifications/tools/list_changed`. The list is read at each start; a server
that changes its tools mid-session is seen at the next pairing.

## Round twenty-two - a cancel that is passed in happens (AMV-AUD-014)

`fetchDeadline` and `AMV_API._fetch` replaced the caller's signal with their
deadline controller's. Both now link it in and refuse an already-aborted
signal before dispatch; `_fetch` also links a per-session controller that
`signOut` aborts before sending its logout (and `_dropCredentials` on a backend
change), makes backoff cancellable, and never retries or refreshes after a
cancel. `aiAgentLoop` takes `signal`, and the build agent's Stop aborts it.

`a-cancel-that-is-passed-in-happens` replaces `fetch` with one that honours its
signal the way the browser's does - before headers and mid-body - and records
what went out.

| # | what was broken | caught by |
|---|---|---|
| 86 | fetchDeadline drops the caller's signal (the finding) | 1 assertion |
| 87 | fetchDeadline sends with an already-aborted signal | 1 assertion |
| 88 | `_fetch` drops the caller's signal | 1 assertion - SURVIVED at first |
| 89 | `_fetch` drops the session signal | 1 assertion - SURVIVED at first |
| 90 | `_fetch` sends with an already-aborted signal | 1 assertion |
| 91 | `_fetch` treats a cancel as a network failure | 1 assertion - SURVIVED at first |
| 92 | backoff cannot be cancelled | 1 assertion - SURVIVED at first |
| 93 | sign-out aborts after sending its logout | 1 assertion |
| 94 | the agent loop ignores its signal | 1 assertion |
| 95 | Stop does not abort | 1 assertion |
| 96 | the turn passes no signal | 2 assertions |

**Four survived the first version** (LESSONS 506): the sections asserted the
result and not its timing, and a request aborted by its own 20-second deadline
looked identical to one aborted by the cancel. Timing assertions, a 3-second
`Retry-After`, and a cancel on the final attempt fixed all four.

**Not built:** cancelling on the SERVER. A request aborted mid-stream stops
the browser reading and closes the connection; whether the Worker stops the
upstream generation, and how the usage reservation settles for a cancelled
stream, is not measured here.

## Round twenty-three - one Python job cannot see the last (AMV-AUD-016)

One Pyodide lived for the tab; now each job takes its own worker and the worker
is terminated when the job ends, with the next one warmed in the background.
Jobs are queued one at a time with the timeout starting when each starts;
signing out stops the running job, refuses the queued ones and drops the warm
worker; output is capped inside the worker; the worker source becomes a Blob
URL once instead of once per restart.

`one-python-job-cannot-see-the-last` serves a stand-in runtime at Pyodide's own
address - a tiny interpreter whose state lives exactly as long as its worker -
so everything around it is the real code.

| # | what was broken | caught by |
|---|---|---|
| 97 | one interpreter for every job (the finding) | 2 assertions |
| 98 | the next runtime is not warmed | 1 assertion |
| 99 | jobs run concurrently | 2 assertions |
| 100 | sign-out does not reset the sandbox | 2 assertions |
| 101 | reset leaves the running job going | 1 assertion |
| 102 | reset lets queued jobs run | 1 assertion |
| 103 | output is not capped | 1 assertion |
| 104 | a Blob URL per worker | 1 assertion |
| 105 | a raw compiler error instead of words | 1 assertion |

Nine for nine.

**AMV-AUD-015 confirmed in a real browser, and still open.** The last section
serves a stand-in that compiles WebAssembly as the real runtime does first, and
the page's shipped policy refuses it: Python cannot start on AMV today. The
person is now told so in words. The fix the audit recommends - allowing
`wasm-unsafe-eval` only inside a separate execution origin - is AMV-AUD-001's
isolated environment, which is the owner's decision. Adding it to the main
page's policy was deliberately NOT done.

## Round twenty-four - the cache holds only what is public (AMV-AUD-026, AMV-AUD-024)

The service worker stored any same-origin GET that did not carry an
Authorization header or `credentials:'include'`, missing the browser's default
`same-origin` mode; and activation deleted every cache on the origin that was
not the current build's. It now stores an allowlist - the page under one key,
plus the published files, taken from the build's `PUBLISH` list - and only
stores a navigation as the page when it is HTML. Activation retires only caches
named `amv-*`; the current name is `amv-shell-<stamp>`.

`the-cache-holds-only-what-is-public` runs the real generated worker in a real
browser: cookie-bearing default-mode fetches to paths off the list, a navigation
to another route, a navigation to the manifest, an offline visit to a route
never seen, and a fresh profile seeded with another application's cache and an
old AMV one before the worker first installs.

| # | what was broken | caught by |
|---|---|---|
| 106 | activation deletes every cache (AMV-AUD-024) | 1 assertion |
| 107 | no allowlist - storage by inference (AMV-AUD-026) | 2 assertions |
| 108 | a navigation stored under its own URL | 1 assertion |
| 109 | a non-page navigation stored as the shell | 1 assertion - SURVIVED at first |

**109 survived the first version**: the section went back to `/` before looking,
which stored the real page again over the manifest. It now reads the cache from
the manifest's own document.
