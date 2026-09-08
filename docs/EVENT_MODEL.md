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
