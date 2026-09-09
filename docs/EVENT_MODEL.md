# Canonical event model

Every source speaks its own dialect. One event language means a workflow can be
written once and a new connector adds a translator rather than a special case.

## Why events, not polling

The brief is emphatic and the arithmetic agrees: at a billion users and twenty
events each per day, that is ~231,000 events/second. Running a model per event
is not a cost problem, it is an impossibility. So:

1. webhook or native push where the provider offers one
2. deterministic validation, dedup, schema - no model
3. cheap classification for relevance
4. correlation against events already held
5. a stronger model only when the answer is genuinely ambiguous
6. digest aggregation for anything not urgent
7. reconciliation for what the webhook never delivered

## The shape

`CanonicalEvent` carries identity (`event_id`, `tenant_id`, `user_id`,
`home_region`), provenance (`source_connector`, `source_event_id`, `actor`,
`trust_level`), meaning (`event_type`, `summary`, `correlation_keys`), and
handling (`sensitivity_class`, `deduplication_key`, `expiration`).

Two fields carry more weight than the rest:

- **`trust_level`** — whether this content may be treated as evidence or must be
  treated as hostile. Anything a stranger can write into is `untrusted`.
- **`deduplication_key`** — stable across redeliveries of the same source fact,
  so a webhook fired three times produces one event.

## Deduplication

A key is derived from the connector, the source event id and the fact itself -
never from arrival time, which differs on every redelivery. Same fact, same key,
one event. The reconciliation pass produces identical keys to the webhook path
on purpose: a backfill must not duplicate what already arrived live.

## What is actually wired today

One source, `google.mail`, reads through this model. It is the one that had a
visible defect: every scheduled run asked Gmail for the newest 25 INBOX
messages unconditionally, so a daily job reported the same message every day,
and a burst bigger than one page left older mail unreported with nothing
recording that it had been missed.

Per account, per source, three things are kept in an `ingest` record:

| | |
|---|---|
| `cursor` | the newest `occurred_at` actually DELIVERED to the person - the frontier |
| `seen` | a bounded ring of source ids already reported (300) |
| `gap` | `{from, to}` when a hole is known to exist below the frontier |

Within one source's bucket the SOURCE ID is the deduplication key: the
connector and account are implied by which bucket it is in, so the hashed
composite would restate them in a form nobody can read in a stored record.

Three properties are load-bearing, and each one was a bug before it was a rule:

1. **The frontier fetch overlaps backwards; a backfill does not.** An exact
   boundary at a moving edge loses messages, so the live window reaches back
   two minutes and the ring removes the duplicates. A backfill is bounded on
   both sides and its floor is a cursor already trusted - widening it there
   only fills the page with mail reported long ago, and the walk stops
   converging.
2. **A hole only ever gets shallower.** Gmail answers newest-first, so a quiet
   run's overlapping frontier page can come back full of already-seen mail;
   taking its floor as the new boundary would raise the hole back up and undo
   every backfill already done.
3. **A short page closes a hole, an empty harvest does not.** A full page that
   happened to be entirely already-seen means there is still more underneath.

## Reconciliation, concretely

`after:` alone can never reach mail older than what has been reported, because
the answer is newest-first. So a run bounds the window from ABOVE and walks one
page down into the hole per run - one page, not a loop, because a tick has a
deadline and draining a large burst in one go starves every other job on it.
While a hole is open the model is told, in words, that the list is not
everything that came in.

## The cursor moves last

Nothing marks mail as reported until the result is in the record the person
reads it from. Every failure in this path therefore costs a REPEAT, never a
loss: a run that reads the inbox and then dies leaves the next run seeing the
same mail. A corrupt `ingest` record is replaced rather than preserved for the
same reason - it is derived, so the cost is one repeated digest, where refusing
to write would leave deduplication broken for that account for ever.

## Correlation

`correlation_keys` are what let an email about a refund meet a bank credit that
never appeared. Keys are conservative - an order number, a flight number, a
thread id, a normalised amount-and-date pair. Names are not keys: two people
called the same thing are not one person, and identities are never permanently
merged on a similarity.

## Retention

Raw content is stored only where a workflow genuinely needs it, and only as long
as the user's retention setting allows. The default is to keep the extracted
state and a reference to the source, not the source. An inbox is not a thing to
copy because you happen to have permission to read it.
