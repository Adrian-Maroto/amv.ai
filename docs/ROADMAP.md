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

*Still to come here:* the evidence an action rests on, who is affected, and the
reasons object from `amvPolicyEvaluate` rendered directly rather than restated
by each surface.

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

**Still to come here:** allowlists and denylists ("never defence"), time
windows, and the offer-a-rule flow. Those are what turn the rest of that
sentence into something the engine can be handed.

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

*The decision to make:* whether an unattended run may ever send on somebody's
behalf. Three honest options, in increasing order of what they ask for:
**(a)** it drafts the cancellation and stops for approval, which needs nothing
new; **(b)** `mail.send` becomes available unattended only inside a rule the
person wrote, with the policy engine holding the bound; **(c)** provider APIs
per merchant, which is the only route that can read the cancellation back and
verify it. Until one is chosen, AMV tells you what is renewing and does not
pretend it can stop it.

One of the owner's ten. Not the riskiest - the one with a reversible outcome and
a clear verification: **Auto Cancel Subscriptions**, where the action can be
checked by reading the subscription back, and a mistake costs a re-subscribe
rather than money.

*Done when:* a renewal is detected, a rule authorises it, the cancellation runs,
reading the account back confirms it, and the timeline says what happened.

## Milestone 7 — Quiet by default

Interruption scoring, quiet hours, digest aggregation, the feedback buttons.
The brief is right that the product fails at 40 alerts a day.

## Milestone 8 — International by architecture

`home_region` is already on every event. Country packs, locale-correct dates and
currency, channel preferences, regional retention. The data-plane split is a
deployment change because nothing above storage names the store.

## Milestone 9 — Connector SDK and manifests

Only after the trust model holds. The brief is explicit: no marketplace before
the connector security model exists.

---

## What is deliberately not on this roadmap

Autonomous money movement, trading, tax filing, legal submission, medical
decisions, unrestricted browser control. R4 exists in the taxonomy so the engine
can refuse it. See `AUTONOMY.md`.
