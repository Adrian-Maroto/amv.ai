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

## Milestone 2 — One event actually flowing

Wire the spine to something real. A connector emits a `CanonicalEvent`, it is
deduplicated, stored against a cursor, and reconciliation backfills what the
webhook missed. No new connector yet - use what exists.

*Done when:* the same source event delivered three times produces one event, and
a deliberate gap in delivery is closed by reconciliation without duplicating.

## Milestone 3 — Proposals through the engine

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
