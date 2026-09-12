# Roadmap

From what AMV is today to the platform the master brief describes. Sequenced so
each milestone is useful on its own, because a milestone that is only valuable
when the next one lands is a milestone that can be cancelled.

---

## Where AMV already is

Not at the start. Measured across the source: 425 approval sites, 397
verification sites, 385 audit sites, MCP connectors with per-call consent, a
Durable Object spend counter, a global daily USD cap, a platform kill switch, a
per-user autonomy pause, Crew jobs on cadences with per-job pause, and a
five-minute cron. Roughly the Connector, Execution and Experience planes.

What was missing was the **Trust plane as a plane** - and the typed spine
underneath it.

## ✅ Milestone 1 — The trust plane (done)

`src/app/40-agent-core.js`, 45 assertions.

Canonical events with deduplication that survives redelivery. Idempotency keys
stable across argument reordering. R0–R5 and autonomy 0–6 as separate scales.
Typed action contracts where an invalid proposal is a denial. A deterministic
policy engine - no model in the path - layered law → region → org → household →
user → rule, where a lower layer can never widen a higher one. An untrusted-
content gate that runs *after* the model has spoken.

## ✅ Milestone 2 — One event actually flowing (done)

`ingest` records + `tests/worker/ingest-cursor.test.mjs`, 39 assertions.

Gmail reads through a cursor, a bounded ring of ids already reported, and a
recorded hole. The same message is never reported twice; a burst bigger than
one page is reconciled by walking DOWN into the hole with a bounded window,
because `after:` alone can never reach it; and while a hole is open the model
is told the list is not everything that came in. The cursor advances only once
the result is durable, so every failure costs a repeat rather than a loss.

*Done when:* the same source event delivered three times produces one event, and
a deliberate gap in delivery is closed by reconciliation without duplicating.
**Both are asserted against the real cron path**, not the filter in isolation -
a mutation deleting the hand-off from `_autoExecute` left the unit assertions
green, which is how the end-to-end one came to exist.

*Not yet:* calendar and school-work read the same way each run. They are much
smaller windows (7 days ahead, current coursework) where a repeat is the
correct behaviour rather than a defect, so they were left alone deliberately.

## Milestone 3 — Proposals through the engine

**Started with the two facts a person could not see before pressing Approve.**
The card showed a title, a request line and four buttons. It did not say whether
the action could be taken back - "Send" and "Save a draft" looked identical - and
it did not say when the permission lapsed, because nothing lapsed. Both now come
from fields the server writes when the work is enqueued (`reversible`,
`expiresAt`), and the server refuses an expired approval whatever the screen drew.

**The rest of this milestone was framed wrongly, and the framing is corrected
here rather than built to.** "Route the 425 approval sites through the engine"
counts call sites, and call sites are not the unit that matters.

What the engine decides is whether something may happen WITH NOBODY PRESENT:
the risk ceiling for an autonomy level, R4 and R5 being unreachable, R1 being
silent only when it is genuinely reversible, a rule's budget and expiry. Every
one of those is a question about an unattended moment.

Measured: there is exactly ONE unattended decision point in the product -
`_runDueAuto`, and its server twin `runDueAutomations` - and it was routed
through the engine in Milestone 1. Everywhere else a person is looking at the
screen, and for an attended approval the person IS the authority. Passing their
own click through a policy engine to be told they are allowed to click is
ceremony, and ceremony in a security path is worse than nothing because it
looks like protection.

*What was actually missing* was the other half, and it is done: what the person
can see before they press the button - whether the action can be taken back and
when the permission lapses, both enforced by the server rather than drawn by the
screen.

*Genuinely still open:* `amvEvidenceIsSafe` has no caller, and correctly so. It
refuses an R2+ action whose only support is content a stranger wrote - the exact
shape of a successful injection. Nothing calls it because no path yet lets a
model PROPOSE an action out of mail: an unattended run produces text, and
`_autoEmailResult` can only ever reach the account owner. The day an Auto agent
can act on what it read, that gate is the thing standing between somebody's
inbox and their behalf - and wiring it before then would make it load-bearing
for nothing, which is the trap LESSONS 405 is about.

Route the existing approval surfaces through `amvPolicyEvaluate` instead of
their own scattered checks. The 425 sites become one decision with reasons.

*Done when:* every approval screen shows what will happen, why, what evidence,
who is affected, whether it can be undone, and when the approval expires -
because the engine returns all of it.

## Milestone 4 — Verify, then say it happened

Execution already verifies in 397 places. Make it a contract: every action
carries its own `verification` and `compensation`, and no action reports success
from a status code.

*Done when:* a provider that returns 200 and does nothing produces a failed
action, not a completed one.

## Milestone 5 — Bounded autonomy, in the product

The engine supports rules today. The user cannot yet write one. Rule builder,
budgets, allowlists, windows, and the honest default: an offer to create a rule,
never a rule created because approval happened often enough.

*Done when:* "apply to at most 5 NYC roles a day, never defence, using my
approved answers" is a rule the engine enforces - and the sixth application does
not happen.

**Budgets: done.** Auto Approve has a third bound - "at most N runs a day" -
and it is the sixth-run half of that sentence. It is a real per-day period in
the user's own timezone, not a lifetime count wearing a daily label: the count
starts again when the local date changes, while "the first run only" stays a
lifetime budget that never refills. A cap that cannot be read falls back to one
run rather than to unlimited, and both bounds hold together - budget left over
does not outlive the end date.

**Done since:** time windows (quiet hours) and the "never defence", which
turned out to be a DENYLIST rather than the allowlist the engine was built to
take - see AUTONOMY.md for why an allowlist of everybody AMV may contact is a
list nobody can finish.

**Done.** The offer-a-rule flow shipped last: AMV counts how a person has
answered about each job and, once the answer is established, offers to write it
down - deliver without asking, or pause a job whose output keeps being thrown
away. Both directions exist, and that is not a nicety: an offer that only ever
points towards more autonomy is a growth nudge in the costume of helpfulness,
and would be worth more to AMV than to the person. Declined once, never raised
again. See AUTONOMY.md.

## Milestone 6 — The first Auto agent end to end

**Blocked on an owner decision, and it is worth stating precisely why.**
`AUTO_USES_ALLOWED` is `['mail.read', 'calendar.read', 'school.read']`: an
unattended run may READ and may not write. So no scheduled job can cancel
anything, send anything, or touch an account - by design, and it is a good
design. Building an agent that "cancels" today would mean either widening
unattended write scope (an owner decision, not an implementation detail) or
shipping something that says it cancelled and did not.

So the FIND half is built and the DO half is not. What exists now:

- `_detectSubscriptions` reads recurring charges out of the mail the ingestion
  already fetches - merchant, amount, currency, cadence, and the line each
  figure came from. Deterministic, for the same reason `_investCheckin` does
  its own arithmetic: this is money, and a model handed receipts produces a
  confident number that is sometimes the price from an advertisement.
- A charge is claimed only when BOTH a recurring signal and an amount are
  present, so a one-off order is never put on a cancel list. Refunds, failed
  payments, cancellation confirmations and un-charged trials are excluded.
- What cannot be read is reported as unread rather than estimated, and an
  unstated cadence is never assumed monthly - which would misprice a yearly
  plan by twelve on any screen that adds these up.

*The decision, made by the owner:* **(a) is what ships now, (c) is the path,
(b) is off the table permanently.**

The three options were: **(a)** it drafts the cancellation and stops for
approval, which needs nothing new; **(b)** `mail.send` becomes available
unattended inside a rule the person wrote, with the policy engine holding the
bound; **(c)** provider APIs per merchant, the only route that can read the
cancellation back and verify it.

**Why (b) is refused rather than deferred.** It is the comfortable middle and
it is the trap. It buys the appearance of autonomy by giving up the one
property that makes the rest of this system defensible: that an unattended run
can READ and cannot WRITE. That sentence is currently true without qualification
- it is enforced by `AUTO_USES_ALLOWED`, not by care - and it is what lets AMV
say "nothing goes out on its own" without a footnote. (b) replaces it with
"nothing goes out on its own unless a rule said so", and every rule engine ever
written has had a bug. The blast radius is not a bad email; it is that the
guarantee stops being checkable, so nobody can ever again answer "can it send
without me?" with a flat no.

And it buys almost nothing (a) does not already give. The person still has to
be right about the rule up front instead of right about the letter in front of
them, which is a worse moment to ask them to be right - the bounded version
asks for the harder judgement earlier and with less information.

**Why (a) can ship today.** It needs no new scope at all. The unattended half
stays read-only; the send happens only after a person presses a button, on a
path that already exists and is already audited.

**Why (c) is the destination and not the start.** It is the only option where
AMV can read the outcome back. An action AMV cannot verify is an action AMV
cannot claim, and "we sent a cancellation request" is not the same sentence as
"you are not being billed any more". (c) is per-merchant work with no shortcut,
so it arrives one provider at a time - and (a) is what makes the wait bearable
rather than a blank screen.

**How an approved cancellation reaches the merchant.** Every send path in AMV
addresses the ACCOUNT OWNER, deliberately - `_autoEmailResult` takes the
address from the account, which is what makes "a scheduled job cannot email a
stranger" structurally true rather than carefully maintained. A cancellation
has to reach the merchant, so that question had to be answered on purpose.

*The owner's decision:* **hand the person a ready-to-send draft now; sending
from their own mailbox is the path; AMV never sends to strangers from its own
domain.**

- **Now:** the draft is handed over as something their own mail client sends -
  the letter opens in their mail app, or they copy it. No new scope, no new
  permission, and it works the day a key is set. It is also the only version
  where the person literally sees the thing that went out, in their own Sent
  folder.
- **The path:** sending on their behalf from their own connected mailbox, so
  the cancellation comes FROM them. That needs a new Google scope and a consent
  review, so it is a deliberate later step rather than something to slip in.
- **Refused:** AMV sending to third parties from AMV's own domain. It is the
  option that feels most automatic and it fails twice. It makes AMV a sending
  relay, so one abuse wave burns the domain's reputation and takes password
  resets and receipts down for every user at once - the failure that ends the
  company, not the one that spoils the demo. And it does not even work: a
  merchant cannot verify that a robot address is the account holder, so a
  cancellation from `amv.homes` is exactly the one they are entitled to ignore.

**The honest limit of (a), stated in the product and not only here.** A
cancellation emailed to the address a receipt came from often does nothing:
plenty of providers send from `no-reply@` and cancel only from their own
account page. AMV says so on the card rather than drafting a letter into a
void, and it never reports a cancellation as done - the most it claims is that
a request was sent.

One of the owner's ten. Not the riskiest - the one with a reversible outcome and
a clear verification: **Auto Cancel Subscriptions**, where the action can be
checked by reading the subscription back, and a mistake costs a re-subscribe
rather than money.

*Done when:* a renewal is detected, a rule authorises it, the cancellation runs,
reading the account back confirms it, and the timeline says what happened.

## ✅ Milestone 7 — Quiet by default (done)

Interruption scoring, digest aggregation, the feedback buttons. The brief is
right that the product fails at 40 alerts a day.

Quiet hours are DONE and shipped ahead of this milestone, because they were the
one writable bound in M5 that had something to bind to on the path that
actually exists. See AUTONOMY.md: held not skipped, enforced by both the cron
and the browser tick, and the two compared over one table.

**Digest aggregation is DONE.** A tick used to send from inside the per-job
loop, so five jobs due at seven in the morning were five separate emails. They
are now collected per ACCOUNT and sent once - nothing summarised, shortened or
reordered, every result in full under its own heading, in the order they ran. A
person with ONE job still gets exactly the email they always got; a digest
wrapper around a single item is a worse email for no reason. A refused send is
told to every job that was in it, because a person waiting on an email that is
never coming, beside a row showing green, is the failure this was meant to
prevent rather than a new way to cause it.

A job BLOCKED on a connection is part of the same picture and was the quietest
failure in the tick: it returned before the notify branch, so it told nobody.
It now says so once, in that morning's one email, and again only if what it is
waiting for changes.

**Interruption scoring is DONE, and not as a score.** Two reasons the shape in
the original line is wrong. A model asked "how urgent is this" returns a
confident number with nothing behind it, and a number nobody can trace is worse
than none because it gets acted on. But a rule-based score is barely better: it
still hides a threshold the person cannot see, so somebody who asked to be
emailed daily and was not has no way to find out why. And overriding an explicit
request silently is the failure that loses an account - one boring email is not.

So the one rule with nothing to guess about is used as an OFFER, through the
machinery M5 already built. A run digests its own output; five identical
mornings on a job set to email earns "this job has said exactly the same thing
five times in a row - email you only when the answer changes?" Refusable, final
either way, and until they tap, every morning is still emailed. Once accepted, a
repeat stays in AMV and the job's ROW says "same answer since <date> · in AMV,
not your inbox" - because a job running quietly must never look like a job that
has quietly stopped working. The moment the answer changes, it arrives again.

**The feedback buttons are DONE, and they are not analytics.** Two buttons on a
result - was this worth telling you about - are trivial to add and worthless by
default: a button whose only effect is a number on somebody else's dashboard
costs a tap and returns nothing, and within a week the number describes only the
few people still pressing it.

So answering buys something. Three "not worth it" in a row earns an offer to
stop EMAILING that job (the complaint was the email; the job keeps running and
every result still lands in AMV) - or, for a job that was never emailing anybody
and so has no interruption left to remove, an offer to pause it rather than keep
spending on something they have said three times they do not want. And three
"worth it" in a row on a job AMV has been holding back earns an offer to undo
that: AMV made that call, the person is the only one who can judge it, and
without this the product would only ever ratchet towards silence.

Counted separately from the approval tally, because "yes, send this" and "that
was worth telling me" are different sentences, and their "already asked" flags
are separate too - answering one question must never silence the other.

**Milestone 7 is complete.**

## Milestone 8 — International by architecture

`home_region` is already on every event. Country packs, locale-correct dates and
currency, channel preferences, regional retention. The data-plane split is a
deployment change because nothing above storage names the store.

**Country packs: already done.** `EVERYDAY_BY_COUNTRY` carries 105 countries and
525 jobs, and the crew catalogue draws its examples straight from it, so the two
cannot drift.

**Currency: done, and it opened with a defect.** The unattended investing
check-in printed a literal `$` in front of every figure and appended the
currency code once, at the end of the first line - so somebody in Frankfurt read
"Total: $12,345.00 EUR", then "Up $1,234.00" and "Pension: $9,000.00
(+$120.00)", which carried the wrong symbol and no currency at all. Their
pension, reported while they were asleep, in a currency that is not theirs. The
PAGE had it right the whole time, so two renderings of one set of numbers
disagreed and the wrong one was the one that left the building. Now the ISO code
on every figure - `$` belongs to seven countries and `¥` to two, so a symbol
table trades one ambiguity for another - with no minor unit on the currencies
that have none. Held by
`a-figure-never-wears-another-currencys-symbol`, nine mutations, all caught.

**Dates: already correct**, and checked rather than assumed. Everything a person
reads goes through `toLocaleDateString(undefined, …)`, which is their own
locale; the only fixed format left is the ISO date a run stamps on its own
output, which is unambiguous by construction and is deliberately not localised -
`_runDigest` strips exactly that stamp to decide whether a run said anything
new, and a stamp that changed shape by locale would break it.

Still open, and each needs the owner rather than the repository:

- **Channel preferences by region.** Email is the only channel AMV has. Adding
  one (SMS in markets where mail is not how people are reached) is a cost and a
  compliance decision, not an engineering one.
- **Regional retention.** How long results are kept, per region. The machinery
  to erase exists and is proven; what is missing is the POLICY, and picking a
  retention period on the owner's behalf is picking their legal exposure.
- **The data-plane split.** A deployment change: nothing above storage names the
  store. It needs an account, a region and a bill.

## Milestone 9 — Connector SDK and manifests

Only after the trust model holds. The brief is explicit: no marketplace before
the connector security model exists.

### The trust model was audited before anything was built on it

Eight attacks were made on the connector path and run against every connector
suite in the repository. **Five went unnoticed**, including the one the whole
model rests on: show the consent dialog, discard the answer, call the connector
anyway. The only test that looked at the dispatch read the source for
`if(!allowed)`, which a mutation setting `allowed = true` one line earlier
satisfies perfectly.

The other four were the bounds `_safeTools`'s own comment names as the reason
admitting third-party tool names by shape is safe - the tool count, the
description length, the schema size, and the name shape itself. The claim was
true and nothing held it.

Both are closed now, measured rather than described:
`the-bounds-that-make-a-connector-safe-to-admit` feeds hostile input to
`_safeTools` directly, and `a-connector-acts-on-your-real-accounts` now drives
AMV's real dispatch with the model loop stubbed and the person denying - so
"deny" is proven to stop the connector, not merely to close the dialog. All
eight attacks are caught.

### The marketplace itself is the owner's decision, not the repository's

The audit above says the RUNTIME model holds. It says nothing about provenance,
which is what a marketplace changes and what M9 actually is.

Today a connector is a command the person typed into the connect card. They
chose it, and the bridge runs it on their own machine. A marketplace replaces
"I typed this" with "AMV listed this", and that is a transfer of
responsibility, not a feature. Nothing in the current model covers who may
publish, what review a listing gets before it appears, whether packages are
pinned by hash or float to latest, or what happens on the day a listed
connector is compromised upstream and runs on every machine that installed it.

Those are not engineering unknowns - they are decisions about liability, cost
and who AMV vouches for. Building the marketplace and answering them afterwards
is the failure that ends the company, so M9 stays closed until the owner
answers them. What can be built without those answers is already built.

---

## What is deliberately not on this roadmap

Autonomous money movement, trading, tax filing, legal submission, medical
decisions, unrestricted browser control. R4 exists in the taxonomy so the engine
can refuse it. See `AUTONOMY.md`.
