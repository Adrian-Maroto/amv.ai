# Findings status

Updated as each is fixed. Phase 5 is everything not assigned above:
hardening and hygiene. Status: TODO / DONE / REJECTED (with reason).

**DONE means a test fails without the fix.** Every entry below was
sabotage-checked: the fix was reverted in the working tree, the test was run and
observed to fail on the assertions that name the defect, and the fix was
restored. A guard that has never been seen to fail is not a guard, and three
times this week a check turned out to be unable to fail at all.

## Phase 3 - in progress

**Done: AMV-013, 031, 032, 033, 042, 045, 053.** Left: AMV-034, 035, SP-05.

**AMV-033, 042, 045 and 053 were one pattern.** Eight handlers read a record,
changed it and wrote it back with no lock, and every one was excused in the lock
roster on the same reasoning: it is the caller's own record, so there is nobody
to race. That is true about who OWNS the record and says nothing about how many
WRITERS it has - a phone and a laptop is two, a double-submitted form is two, a
retry beside the request it retries is two.

Three were wrong on their own terms as well:

- `apiKeyCreate` was excused because "the cap below refuses the second anyway".
  The cap is read inside the window it is meant to close. The key that loses the
  race is worse than lost: its lookup row is written regardless, so it goes on
  authenticating while vanishing from the list that is the only way to revoke it.
- `handoffCreate` was excused as writing "the SENDER's own copy" and writes the
  recipient's inbox too - a record every other sender appends to.
- `widgetConfigSave` was excused because "the only other writer is this same
  handler", which is the race rather than a reason there isn't one.

Two more were never the caller's record at all: ratings are keyed by the LISTING
and reviews by the SELLER, so their writers are every buyer of it.

All eight exemptions were deleted rather than reworded, and moving the two
marketplace records under the lock made them visible to the backup and
cross-account rosters for the first time - both of which then demanded a
decision, which is what they are for.

**AMV-013.** Locks expire, so a holder whose work outran its lease lost the lock
without being told and somebody else took it - and then the first one finished
and released, unconditionally, deleting the second holder's lock while that
holder was still inside. Both then believe they are alone, which is the state a
lock exists to make impossible, and it needs load rather than an attacker. A
claim carries an owner token now and a release must name it. A refused release
means a lease too short for its work, which is reported.

**AMV-032.** The atomic counter falls back to plain storage when the Durable
Object cannot be reached. Reasonable for a tally; not for `claim` and `reserve`,
which through storage are a read followed by a write - the exact race they exist
to close. An alert for this was added once and the fallback still ran underneath
it. Those two ops now refuse rather than degrade. An UNBOUND namespace keeps its
fallback: that is a development machine, and refusing there would mean the
product does not run without wrangler.

**AMV-031.** A record that will not parse reads as one that is not there, which
is right for most callers and exactly wrong where absence GRANTS something: an
unreadable seller row is a seller who was never banned, an abuse row is somebody
with no disputes, a family row is a child with no spending limit. And an account
row is an address nobody has registered - which, once signup started deciding
existence from that read, meant a corrupt account record could be signed up over
with a new password. Those four callers ask a strict question now; everything
else keeps the null it needs.

## Phase 2 - complete (and AMV-028 with it)

All eight, plus AMV-028 pulled forward from Phase 5 because AMV-019 depends on it.

**AMV-019.** A session is two tokens. The access token is short-lived and has to
be readable by script; the refresh token is valid for a month and mints access
tokens on demand, so a copy of it is a copy of the account. Both were in
localStorage, readable by anything that ends up running on the page. The long
one is now an HttpOnly cookie, scoped to `/auth`, which script cannot read at
all.

**AMV-028 was the prerequisite.** A cross-origin cookie needs SameSite=None,
which needs Secure, which needs a concrete Allow-Origin and Allow-Credentials -
a browser refuses credentials beside a wildcard. `ALLOWED_ORIGIN` and a
`corsFor` helper both existed and nothing called either: every response went out
through `json()`, which carries a hardcoded `*`. Applied at the single point
every response passes through, because `json()` has several hundred call sites
and no access to `env` - which is why it went unapplied for so long.

The default stays open. Locking the API is a real choice with consequences for
anybody embedding the widget, and turning it on for people who never asked would
break working deployments to enforce a setting they did not set.

**AMV-020.** The service worker stored every same-origin 200, keyed by the full
URL - so an OAuth return carrying a code, or a share link carrying its token,
went into Cache Storage where script can read it and outlived signing out. URLs
with a query string are never stored now, and the server's own `no-store` is
honoured, which is a rule rather than a list of paths somebody has to extend.

**AMV-016.** A restore wrote every key straight over the live one, and a restore
is normally run after an incident - so the state being overwritten is the state
created by responding to it. Restoring an old token epoch makes every session
issued before it valid again: sign out everywhere, restore yesterday's snapshot
as part of putting things right, and the stolen session is live again. Same
shape for a revoked API key, a blocked account and a suspended seller.
Revocation is monotonic now, and the restore reports what it held forward -
a partial restore an operator does not know about is one they assume was total.

**Still open from AMV-019:** the CSP allows `unsafe-inline`, and 97 inline
`onclick` handlers depend on it. Removing it is a real UI refactor across
fifteen files, not a header change, so it is tracked separately rather than
rushed - a broken button on a payment screen is a worse outcome than the
hardening is a gain.

**AMV-018 was a five-attempt limit that counted five per round trip.** A
six-digit code is a million possibilities, which five tries makes safe. The
counter was read, compared, incremented and written - four steps with three
gaps - so guesses arriving together all read the same number and all wrote the
same increment back. The cap bounded sequential guesses and nothing else, which
turns a million possibilities into a few minutes of parallel traffic against
whatever address somebody names. Two submissions of a CORRECT code likewise both
consumed it and both minted a single-use token.

**AMV-017** is the same shape on the way in: read the account, find nothing,
write one. Two signups for an address arriving together both wrote, the last won,
and both callers were handed a working session for an account whose password
belonged to the second person. Measured at three accounts created for one address
with ten concurrent requests before the fix.

The lock roster carried an exemption for the signup saying there was nobody to
race and that a claim already stopped it. Both halves were false and there was no
claim. The exemption is gone rather than reworded.

Deletion is the one irreversible action in the product and it took whatever the
auth path accepted - so an access token was enough, and an access token is the
credential most likely to have leaked. An API key was enough too, which is
worse: a key exists so a machine can act without a person, and no automation has
a reason to erase the account it runs on.

**AMV-SP-04 is the same mistake pointed at money.** Deletion waits while a
payout is on its way, because erasure takes the wallet. That check caught every
read failure and returned an empty list, which is indistinguishable from a clean
one - so a storage blip erased an account with money in flight. The comment
defending it said the payout records survive erasure; the record survives and
the person it was owed to does not.

One existing test asserted that behaviour as correct. It has been rewritten to
the reasoning above rather than worked around.

**AMV-SP-03**: only Stripe was cancelled on deletion. A PayPal subscriber who
deleted their account went on being charged every month - worse on that side,
because PayPal bills against an agreement with nothing on AMV's side involved.
The subscription id is on the entitlement where AMV-007 records it.

Eight suites needed updating for the new confirmation. That is a real behaviour
change, so each call site was corrected rather than the gate weakened - and the
deletion throttle's own counter keys, which name the account, are now erased
with it.

## Phase 1 - complete

All eight: AMV-004, 006, 007, 009, 010, 011, 023, 041.

**AMV-009 was two defects at one door.** Every call to the buy route created a
fresh payment session, so a double-click produced two live checkouts and both
took a card - and because the credit is exactly-once per buyer and item, the
second payment granted nothing. The safety mechanism is what made the loss
silent. Separately, a one-of-a-kind listing was checked for 'sold' and then
acted on, so two buyers arriving together both paid and one received nothing.
The session is now remembered and handed back, and the listing is reserved
through the counter that serialises - a first version wrote the reservation to
storage after a read, which is the same race with an extra step.

**AMV-010 and AMV-011 are both a claim on the wrong side of a failure.** The
marketplace reversal took a permanent claim before four steps that could each
fail, three of which swallowed their own errors: a half-finished reversal left
the claim held, the provider's retry was discarded as a duplicate of work that
never happened, and the buyer kept an item they charged back. `_creditSale` -
the same money going the other way - had this fixed already, with a comment
saying why.

The rejected payout is subtler. The status is written before the money moves,
deliberately, and the note explaining it is right that the other order risks
crediting twice. What it misses is what its own order costs: if the credit
fails, the payout is terminally rejected and the seller's balance was never
returned. Both orders lose, so neither is used - the refund is claimed once and
marked outstanding on the record until it lands, and a rejected payout that
still owes money can be settled again to finish it.

**AMV-007** is the one where the audit's implied fix is wrong. Comparing
timestamps across Stripe and PayPal is unsound - two processors' clocks are not
one timeline, and the existing comment says so correctly. The gap is that when
the event comes from the OTHER processor the comparison never applies, so it
wins by default: cancel PayPal, resubscribe on Stripe, and PayPal's retried
cancellation revokes the plan they are currently paying for.

Fixed by OWNERSHIP, which needs no shared clock. One subscription owns the plan;
its events are authoritative; an event from any other may do exactly one thing -
take ownership by granting a paid plan, the one message that can only follow
real money moving. A subscription that loses ownership is retired and can never
speak again, because its own retries are what is being defended against. Events
with no subscription id (a chargeback, a refund) make no ownership claim and
apply only from the processor that owns the plan.

**AMV-006 and AMV-023 are one defect with two doors.** Three places built the
principal every spending check reads. The browser built it completely; the API
key returned five fields and none of the three that stop spending; the SMS
handler built six by hand and also omitted the family. So a child capped at $10
a month could create an API key in settings and spend past it, or text AMV all
month. A team member's key drew on their own email rather than the team's pooled
allowance. An account blocked for charging back kept working through a key it
made earlier.

The SMS copy carried a comment saying a parent's limit reaches it, above code
that could not do that - the comment-versus-code class again. There is one
resolution now and the three doors share it.

**AMV-004 (atomic spend ceilings) and AMV-041 (payout total) are done.**

AMV-004 turned out to be six ceilings, not one: chat's account ceiling, the
day's global ceiling, image, video, the widget's three, and SMS. All were a read
followed by a charge, which twenty concurrent requests walk straight through -
measured at 4.4x a $0.30 ceiling before the fix. They now book an upper bound
atomically before the work and settle the difference after, the same shape the
token allowance has used since an 8-request burst was measured at 3.2x its cap.

Two things found while fixing it that the audit did not report:

- **The widget metered into a ledger it did not check.** `widgetChat` tested the
  owner's `cost:<subject>` ceiling before every turn and handed the metering
  `wspend:<key>`. So the owner's monthly ceiling - the one a family cap and the
  plan backstop both flow into - was read constantly and written never by widget
  traffic, and could not be reached however much a stranger on somebody else's
  website typed into it. Third instance this week of the same shape; see
  LESSONS #249.
- **A reservation can delete a feature.** The first automation reservation
  priced one worst case at $0.149 against a free ceiling of $0.10, so every free
  automation was refused and simply never ran. LESSONS #247.

## Phase 0 - complete

Ten findings, ten fixes, eight new test files. Two things were found while
fixing them that the audit did not report:

- **AMV-003 had a second half.** The finding is titled "not charged AND bypasses
  the kill switch". The kill switch was the visible half. The other half is that
  `/sms/incoming` *checked* the account's monthly dollar ceiling and never
  *incremented* it, so for an account that used AMV only by text the counter
  held zero for ever and the ceiling could not be reached by any amount of use.
  What bounded the bill was a per-number daily message count. Now recorded
  through `_recordSpend` like every other channel, with `sms` as its own line in
  the owner's per-feature split.
- **AMV-SP-01 had a sibling in the path that worked.** The Google signup threw a
  ReferenceError into an empty catch. The password signup made the same mistake
  without the exception - it passed the RAW typed address to the funnel while
  every other record uses the normalised one, so somebody who typed a capital or
  a leading space was filed as a signup under one identity and a payment under
  another, and counted for ever as a customer who never converted. Fixed at the
  call site and normalised at the choke point.

Also corrected while testing AMV-040: the existing payout test built the phantom
`wallet.tx` shape the dead check was looking for. The test and the code agreed
with each other and both disagreed with the product, which is why the signal
read as working for as long as it did.

| Phase | ID | Sev | Title | Status |
|---|---|---|---|---|
| 4 | AMV-001 | CRITICAL | Browser agent can disclose supplied secrets to a hostile page | TODO |
| 4 | AMV-002 | HIGH | Browser network isolation is incomplete: redirects are checked after requests  | TODO |
| 0 | AMV-003 | HIGH | Inbound SMS model usage is not charged and bypasses the global kill switch | DONE |
| 1 | AMV-004 | HIGH | Dollar spend ceilings are check-then-charge rather than atomic reservations | DONE |
| 0 | AMV-005 | HIGH | Family-cap refusal dereferences undefined `planCeiling` and returns a 500 | DONE |
| 1 | AMV-006 | HIGH | API-key authentication omits account holds, family limits, team billing identi | DONE |
| 1 | AMV-007 | HIGH | Cross-processor webhook ordering can overwrite a newer subscription state | DONE |
| 0 | AMV-008 | HIGH | PayPal webhook failures acknowledge success and suppress provider retries | DONE |
| 1 | AMV-009 | HIGH | Marketplace checkout allows duplicate charges and one-of-a-kind overselling | DONE |
| 1 | AMV-010 | HIGH | Marketplace reversal takes a permanent claim before best-effort, non-idempoten | DONE |
| 1 | AMV-011 | HIGH | Payout rejection is marked terminal before the seller is refunded | DONE |
| 0 | AMV-012 | HIGH | `_withKV` treats read/parse failures as an empty record and can overwrite live | DONE |
| 3 | AMV-013 | HIGH | Lease locks have no owner token, renewal, or fencing | DONE |
| 0 | AMV-014 | HIGH | Account export returns the live Canvas bearer token | DONE |
| 2 | AMV-015 | HIGH | Account deletion requires only a bearer token and can report success after par | DONE |
| 2 | AMV-016 | HIGH | Backup restore is KV-only and can restore stale authentication/authorization s | DONE |
| 2 | AMV-017 | HIGH | Concurrent signup can create multiple valid sessions for one email with last-w | DONE |
| 2 | AMV-018 | HIGH | Password-reset codes and links are not atomically attempt-limited or consumed | DONE |
| 2 | AMV-019 | HIGH | Refresh and access tokens are persisted in localStorage under a weak inline-sc | DONE |
| 2 | AMV-020 | HIGH | Service worker caches revocable or token-bearing same-origin pages | DONE |
| 0 | AMV-021 | HIGH | Model compatibility retry can throw outside reservation cleanup | DONE |
| 0 | AMV-022 | HIGH | Model transport has no default deadline | DONE |
| 5 | AMV-060 | HIGH | Shipped deployment configuration is not launch-ready | TODO |
| 2 | AMV-SP-03 | HIGH | Account deletion cancels Stripe but not PayPal subscriptions | DONE |
| 2 | AMV-SP-04 | HIGH | Payout-in-flight lookup fails open during account deletion | DONE |
| 1 | AMV-023 | MEDIUM | SMS user context omits family limits | DONE |
| 5 | AMV-024 | MEDIUM | Changing an SMS phone leaves the old phone authorized | TODO |
| 5 | AMV-025 | MEDIUM | SMS verification uses `Math.random`, has no attempt cap, and updates uniquenes | TODO |
| 5 | AMV-026 | MEDIUM | Login and reset responses enumerate registered accounts | TODO |
| 5 | AMV-027 | MEDIUM | Google sign-in is an unbounded external-call amplifier and does not require `e | TODO |
| 5 | AMV-028 | MEDIUM | Configured CORS origin is ignored by JSON responses | DONE |
| 5 | AMV-029 | MEDIUM | No global request-body size limit exists before JSON/text/form parsing | TODO |
| 5 | AMV-030 | MEDIUM | Most routes do not enforce HTTP methods | TODO |
| 3 | AMV-031 | MEDIUM | Malformed database JSON is treated as a missing record | DONE |
| 3 | AMV-032 | MEDIUM | Atomic counters and claims silently fall back to non-atomic KV | DONE |
| 3 | AMV-033 | MEDIUM | Multiple shared records still use unlocked read-modify-write | DONE |
| 3 | AMV-034 | MEDIUM | Team creation and join are multi-record partial commits | TODO |
| 3 | AMV-035 | MEDIUM | Automation create/update/run workflows have race and exactly-once gaps | TODO |
| 4 | AMV-036 | MEDIUM | Browser spend control trusts client-declared amount and records it before laun | TODO |
| 5 | AMV-037 | MEDIUM | Public error telemetry can be poisoned and leak sensitive text | TODO |
| 5 | AMV-038 | MEDIUM | Backup export can silently omit D1 data and buffers the full store in memory | TODO |
| 5 | AMV-039 | MEDIUM | Account export swallows read/list failures and may claim completeness | TODO |
| 0 | AMV-040 | MEDIUM | Payout wash-trading signal reads a field that is never populated | DONE |
| 1 | AMV-041 | MEDIUM | `paidOut` increments on request and is not reversed when a payout is rejected | DONE |
| 3 | AMV-042 | MEDIUM | Marketplace ratings, reviews, and thread-read state lose concurrent updates | DONE |
| 5 | AMV-043 | MEDIUM | Reviews can become impossible after a seller unlists an item | TODO |
| 5 | AMV-044 | MEDIUM | Widget message listener does not verify origin or source | TODO |
| 3 | AMV-045 | MEDIUM | Widget configuration and live-key writes are non-transactional | DONE |
| 5 | AMV-046 | MEDIUM | Audit webhook delivery is fire-and-forget without `waitUntil` | TODO |
| 4 | AMV-047 | MEDIUM | IMAP literal parsing allocates attacker/provider-declared sizes before truncat | TODO |
| 4 | AMV-049 | MEDIUM | JavaScript sandbox timeout cannot stop a synchronous infinite loop | TODO |
| 4 | AMV-050 | MEDIUM | School work aggregation performs many sequential external calls and accepts la | TODO |
| 5 | AMV-051 | MEDIUM | Admin user listing converts storage failure into a valid empty result | TODO |
| 5 | AMV-052 | MEDIUM | Administrative routes use inconsistent authentication and rate-limiting gates | TODO |
| 3 | AMV-053 | MEDIUM | API-key creation limit is a racy read-append-write | DONE |
| 5 | AMV-056 | MEDIUM | Third-party frontend code is broadly trusted without integrity pinning | TODO |
| 0 | AMV-057 | MEDIUM | `test:worker` runs only the aggregate file, not all Worker test files | DONE |
| 0 | AMV-SP-01 | MEDIUM | Google signup analytics uses an undefined variable and omits population accoun | DONE |
| 5 | AMV-SP-02 | MEDIUM | Google OAuth grant is outside the shared export/erasure inventory | TODO |
| 3 | AMV-SP-05 | MEDIUM | Team task and audit collections still have multi-writer lost-update windows | TODO |
| 5 | AMV-SP-06 | MEDIUM | Approval and handoff flows can report success after partial delivery/state upd | TODO |
| 5 | AMV-SP-07 | MEDIUM | Clearing abuse records can leave entitlement-level blocking in place | TODO |
| 5 | AMV-SP-09 | MEDIUM | Marketplace success/cancel redirects can reflect the request Origin when APP_U | TODO |
| 5 | AMV-SP-10 | MEDIUM | Password login accepts unbounded password length before PBKDF2 | TODO |
| 5 | AMV-048 | LOW | Mail credential KDF uses a fixed salt and permits weak deployment secrets | TODO |
| 5 | AMV-054 | LOW | JWT verifier treats `typ`, `nbf`, and `exp` as optional | TODO |
| 5 | AMV-055 | LOW | Short deterministic identifiers use weak 32-bit or ~56-bit spaces | TODO |
| 5 | AMV-058 | LOW | CI actions are referenced by mutable major tags | TODO |
| 5 | AMV-059 | LOW | Deploy script depends on an undeclared global Wrangler installation | TODO |
| 5 | AMV-SP-08 | LOW | Google OAuth redirect validation uses a prefix comparison | TODO |
| 5 | AMV-SP-11 | LOW | Route comments and documentation overstate several security guarantees | TODO |
| 5 | AMV-SP-12 | INFO | Dependency vulnerability audit is not reproducible in the supplied environment | TODO |
