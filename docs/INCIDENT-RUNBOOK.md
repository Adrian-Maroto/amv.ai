# When something is wrong: the runbook

One page for whoever is on call. Every control named here exists in this
repository and is tested; nothing here is aspirational. The order of the
sections is the order to check.

## 0. First minute: is it AMV, and how much of it?

| Ask | How | What it tells you |
|---|---|---|
| Is the Worker running? | `GET https://api.amv.homes/v1/health` | `ok:true` means the code runs. Nothing more. |
| Can it serve? | `GET https://api.amv.homes/v1/health/ready` | `ready:false` and a 503 name the store that failed (`kv`, `counter`, `d1`) and why. |
| What is switched on? | the same answer, `capabilities` | Model key, email, payments, browser, library, meaning, cloud computer - yes or no. |
| What does the owner console say? | Founder Dashboard | Spend today against the ceiling, actions confirmed done, failures, speed. |

Liveness up and readiness down means the stores, not the code: see section 3.

## 1. The bill is running away

**Pause everything that spends:** Founder Dashboard > *Pause service (kill
switch)*. Sign-in, payment webhooks and the switch itself keep working; chat,
jobs and every paid feature stop, and people are told the service is paused.
The background tick stops spending too. Resume from the same button.

The daily ceiling (`GLOBAL_DAILY_USD_CAP`) is the automatic version of this.
Reaching it is an incident, not a setting to raise (owner decision 28).

## 2. One part is misbehaving

**Switch off exactly that part:** Founder Dashboard > *Switch off one part*.
Write why in the box; it is kept beside the switch and shown to the next
person. Reaches every server within about a minute.

| Symptom | Switch |
|---|---|
| A connected account gives wrong results or errors | `connector:<app>` (e.g. `connector:gmail`) |
| One kind of write is unsafe | `write:<action>` (e.g. `write:gmail.send`) |
| One engine fails or is slow | `model:<engine>` (e.g. `model:amv-core`) |
| A feature is broken | `feature:browser`, `computer`, `library`, `widget`, `speech`, `meaning`, `marketplace`, `finance`, `telegram`, `sms`, `api`, `automations` |

People using a switched-off part are told it is paused and that everything
else works. Nothing is quietly replaced by something else. Switching off
`automations` keeps every job in place; they run at the first tick after.

## 3. A store is failing

- **KV failing** (`ready` names `kv`): everything that reads accounts fails.
  Nothing in AMV can route around it; check Cloudflare's status page.
- **Counter object failing** (`counter`): usage ceilings refuse rather than
  guess (`atomic_unavailable`); sign-in stays up on its slower path and the
  operator is alerted (`revocation_degraded`). Paid chat continues; free work
  is shed first.
- **Switches unreadable**: the last answer each server had stays in force and
  an alert says so (`switches_unread`).
- **Data lost or damaged** (a bad migration, a namespace emptied, records
  overwritten): restore from a nightly backup, once `AMV_BACKUPS` is bound.
  List the nights with `GET /admin/backup/nights` (owner token). Restore one
  with `POST /admin/backup/import {"fromNight":"YYYY-MM-DD","mode":"missing"}`
  - `missing` puts back only what is gone and never overwrites newer data;
  `merge` writes the whole night over what is there. A large night answers
  `202` with `nextPart`: call again with `"fromPart": <nextPart>` until it
  answers `200`. A restore never undoes a revocation, a block or a sign-out
  that happened after the night was taken, and says how many it held forward.
  When D1 is the store, use D1 Time Travel instead (thirty days, to the minute).

## 4. The model provider is failing

Automatic: each server tracks the primary endpoint; five failures in a minute
send everything to `MODEL_API_FALLBACK_URL` for thirty seconds, then the
primary is tried again. A chat turn that fails before its first word moves to
the fallback whole. **Without a fallback URL set, none of this can happen** -
set one before launch. To take one engine out by hand: `model:<engine>`.

## 5. Email is not arriving

Readiness screen > *Email* > send the test. Then:
- *Domain not verified*: verify the sending domain with the email provider.
  Until then sign-in codes cannot be sent and sign-in continues without one
  (owner decision 35 explains the risk).
- *Busy or unreachable provider*: job results, messages and digests wait in
  the outbox and are retried at 5m, 15m, 1h, 3h and 6h; an alert says if one
  is finally given up on. Sign-in codes are never queued.

## 6. An account is compromised

The person's own *Sign out everywhere* (Settings), or, for the owner, the
admin API: `POST /v1/admin/user` with `{"email": "...", "action": "revoke"}`
and the admin token (deliberately not a button in the console - a test holds
it there). Both take effect on every server at once (the account's
revocation object), and API keys revoked by the person stop at once too.
A password reset does the same.

## 7. Payments look wrong

Payment webhooks keep working through a pause. A payment that succeeded and
was never applied is reconciled by the five-minute tick
(`reconcilePayments`). Every provider event is recorded once; a redelivery
cannot charge or credit twice.

## 8. After it is over

Write down, in `LESSONS.md`: what happened, how it was noticed, how long it
took, what was switched, and the rule that stops it happening again. Turn
back on everything that was switched off, and confirm on the dashboard that
nothing was left off.

## What this runbook cannot do yet

An on-call rota, paging, a public status page and outside monitoring that
calls `/v1/health/ready` every minute are services the owner signs up for
(owner decision 40 and the scale audit, #66). Until then, nobody is woken up
by anything: the alerts go to `ALERT_WEBHOOK`, if it is set.
