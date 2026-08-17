# Response to the external security audit

External audit received 2026-08-16. 72 findings: 1 critical, 24 high, 39 medium,
7 low, 1 informational. Verdict: NOT SAFE TO DEPLOY.

This document is the triage and the plan. It is written to be acted on in order.

---

## 0. The audit reviewed the wrong commit, and that is my fault

The archive I produced was built from a working tree that had rolled back to
`6dfce93`, not from `05a5f29` which was `main` at the time. I did not verify the
archive contents against HEAD before sending it.

Proof, not inference:

| | audit ledger | `6dfce93` | current HEAD `05a5f29` |
|---|---|---|---|
| `amv-backend.js` bytes | 934,278 | **934,278** | 1,331,364 |
| `amv-backend.js` lines | 16,924 | 16,923 (+1 EOF) | 19,802 |
| routes in matrix | 152 | 152 | 160 |

The eight routes absent from the audit's route matrix are exactly the eight added
after `6dfce93`: `/v1/coverage`, `/v1/everyday`, `/v1/telegram/{status,connect,
disconnect,send}`, `/v1/jobs/apply`, and the job-board catalogue.

### What this means

**The findings are still valid.** Everything after `6dfce93` was additive -
registries, new routes, and the SMTP STARTTLS path. None of it rewrote the money,
auth, lock, or webhook code the audit examined. Line numbers have drifted by up
to ~2,900 but the code is the same. I confirmed this by re-locating nine findings
in the current file (below).

**But four surfaces have never been reviewed by anyone but me:**

1. **Payments: `automatic_payment_methods`** on subscription and marketplace
   checkout. This is the change that touches money and it is unaudited.
2. **Telegram**: bot-token storage, encryption, the raw-token URL construction.
3. **SMTP STARTTLS**: the upgrade path, and specifically the ordering guarantee
   that no credential is written before the upgrade completes.
4. **The four new routes** and their auth posture.

These go back for review before launch. They are not covered by anything below.

---

## 1. Verification: I checked the report rather than trusting it

Nine findings traced to current code. **Nine confirmed, zero false.** That is a
high-quality report and it should be treated as such.

| ID | Claim | Verified in current code |
|---|---|---|
| AMV-003 | Kill switch misses `/sms/incoming` | `amv-backend.js:5513` - `if (path.startsWith('/v1/'))`. `/sms/incoming` invokes the model and sits outside. **Confirmed** |
| AMV-005 | `planCeiling` undefined in `aiProxy` | Defined only at `:606` inside another function; used at `:8397` inside `aiProxy` (`:8247-8556`), which does not define it. ReferenceError. **Confirmed** |
| AMV-008 | PayPal 200 on failure | `:15905-15911`. The catch logs, releases the claim, and falls through to `return json({received:true})` = HTTP 200. The comment says "let PayPal's retry reprocess it". The code prevents exactly that. **Confirmed** |
| AMV-012 | `_withKV` swallows read failure | `:12585` - `catch (err) { return ...empty }`, then `:12586` writes it back. A transient KV error overwrites live data. **Confirmed** |
| AMV-014 | Canvas token in export | `EXPORT_REDACTED` = `{fin, finlink, apikeys, stripecust}`. `school` is in `PER_USER_KINDS` but not redacted. **Confirmed, and worse:** `schoolConnect` stores the token **raw** via `DB.put`, while mail passwords and Telegram tokens are AES-GCM encrypted. Two defects, not one. |
| AMV-007 | Cross-processor entitlement ordering | `:10877` - staleness compares only when `prev.lastEventSrc === evtSrc`. **Confirmed.** See the note in Phase 1 - their implied fix is wrong. |
| AMV-021 | Compat retry outside refund catch | `:8490` is inside try/catch with `refundReservation()`. `:8517` `_callUpstream(plain)` is not. A throw there leaks the reservation. **Confirmed** |
| AMV-022 | No default model deadline | `_modelFetch`: `if (o.signal) init.signal = o.signal`. No default. **Confirmed** |
| AMV-057 | `test:worker` runs one file | `tests/run.mjs:26` filters by filename substring. `worker` matches 1 file of 139. **Confirmed** |

### Two corrections to the audit

**The route matrix's `auth` column is unreliable and should not be read as a
list of holes.** It only detects `requireUser` written literally inside a handler
body. Of 28 rows marked `auth=no, admin=no`:

- 23 are public **by design** (health, public-config, signup, login, refresh,
  reset, the two webhooks, waitlist, widget, market list/view)
- 5 are **false positives** where auth is delegated to a helper the scan could
  not follow: `/v1/mail/inbox` and `/v1/mail/message` (via `_mailRun`, which
  calls `requireUser`), and `/v1/admin/{support,stats,finance}` (via
  `requireAdmin`)
- **0 are genuinely unauthenticated when they should not be**

**AMV-057 does not mean the release gate is broken.** `check.mjs:130` calls
`node tests/run.mjs` with **no filter**, which runs all **248** suites. The
convenience script `npm run test:worker` is the thing that lies. Their Top-10 #10
says "regressions and broken artifacts can be promoted" - that overstates it. The
gate has been running everything. The script is still a footgun and gets fixed.

### One thing the audit is right about that I should say plainly

Several of these are the exact failure class I have been writing lessons about
all week: **a comment that states the intent while the code does the opposite.**
AMV-008 is the purest example - the comment explains that failures must be
retried, immediately above the line that tells PayPal not to. My own tests did
not catch it. `LESSONS.md` #235, #241, #243 describe this pattern; it recurred
anyway.

---

## 2. Context that changes priority, not severity

Nothing is deployed. `main` is code only: the KV namespace id is a placeholder,
Browser Rendering is commented out, and no live keys exist. So:

- **No customer is currently exposed.** The verdict is about readiness.
- The owner's stated sequence is **build -> buy keys -> test -> fix -> ship**.
  That sequence is protective, but it means **buy-day is the moment every one of
  these becomes live**. They must be fixed *before* the keys go in, not after.
- Features that cannot run without a key (browser agent, SMS, live payments,
  marketplace payouts) are *latent*, not safe. Fix before enabling.

---

## 3. The plan

Ordered by when it must be true, not by severity alone. Phase 0 is a day; the
rest is real work.

### Phase 0 - Outright defects with one correct answer

No design decisions. Each is a bug with an obvious fix and a cheap regression
test. Do these first because they are free and two of them lose money.

| ID | Fix | Test that must fail first |
|---|---|---|
| AMV-005 | Compute the ceiling in `aiProxy` or pass it in. Return the intended 429. | Family at cap gets 429 with the family message, not a 500 |
| AMV-008 | `return json({error:'processing failed'}, 500)` inside the catch so PayPal retries | A throwing handler returns 5xx and the claim is released |
| AMV-014 | Add `school` to `EXPORT_REDACTED`; encrypt the Canvas token with `_mailEncrypt` like every other credential | Export contains no bearer token; stored record is ciphertext |
| AMV-012 | Distinguish "no record" from "read failed" - rethrow on failure, only substitute `empty` on a genuine miss | A KV read that throws does not write an empty record |
| AMV-021 | Move the compatibility retry inside the refunding try/catch | A throw on retry refunds the reservation |
| AMV-022 | Default deadline in `_modelFetch` for every caller that does not pass one | A stalled provider aborts rather than holding the worker |
| AMV-003 | Apply the kill switch to every mutating/spending path, not the `/v1/` prefix | With the switch on, `/sms/incoming` refuses |
| AMV-057 | Filter by directory, not filename substring; or make the script run the directory | `npm run test:worker` runs 139 files |
| AMV-SP-01 | Undefined variable in Google signup analytics | Signup analytics records without throwing |
| AMV-040 | Wash-trading signal reads a field nothing populates - populate it or delete the check | The check fires on a constructed wash trade, or is removed |

### Phase 1 - Money integrity. Must be true before any live payment key.

- **AMV-004** Spend ceilings are check-then-charge. Make them atomic
  reservations through the Durable Object counter that already exists for usage,
  so concurrent requests cannot all pass the same check.
- **AMV-007** Cross-processor entitlement. **Do not implement their implied fix.**
  Comparing timestamps across Stripe and PayPal is unsound - two providers' clocks
  are not one timeline, and the existing comment says so correctly. The right fix
  is *ownership*: record which processor and subscription id currently owns the
  plan, and refuse events from a non-owning processor unless they are establishing
  new ownership.
- **AMV-009** Marketplace: reserve the listing and make checkout idempotent per
  buyer+listing, so one item cannot be sold twice.
- **AMV-010 / AMV-011** Ordering: never take a terminal claim before the work
  that must succeed. Refund first, mark terminal last.
- **AMV-041** `paidOut` increments on request and is never reversed on rejection.
- **AMV-006 / AMV-023** One canonical principal for web, API key, SMS, cron and
  widget, carrying holds, family limits, team billing and seat state. Today the
  API-key path silently omits all of it.

### Phase 2 - Identity and data safety. Before real users.

- **AMV-015** Deletion: require reauthentication, stop swallowing cleanup
  failures, and report what actually completed.
- **AMV-SP-03** Cancel PayPal subscriptions on delete (Stripe already is).
- **AMV-SP-04** Payout-in-flight lookup fails open - a storage error lets
  deletion proceed as if no money were owed.
- **AMV-016** Backup/restore: signed, versioned, logical records; must not roll
  back token epochs or revocation state.
- **AMV-017 / AMV-018** Signup race and reset-code atomicity.
- **AMV-019 / AMV-020** Refresh token out of localStorage into an HttpOnly
  cookie; tighten CSP; stop the service worker caching revocable pages.

### Phase 3 - Locks and concurrency. Foundational; touches everything.

- **AMV-013** Lease locks have no owner token or fencing - a slow writer outlives
  its lease and its release deletes someone else's lock. This is the root cause
  under several other findings.
- **AMV-031 / AMV-032 / AMV-033** Malformed JSON read as missing; atomic
  primitives silently degrading to non-atomic KV; remaining unlocked
  read-modify-write sites.
- **AMV-034 / 035 / 042 / 045 / 053 / SP-05** Partial commits and lost updates in
  teams, automations, ratings, widget config, API keys.

### Phase 4 - Gated features. Fix before enabling, not before launch.

**Browser Rendering stays commented out until this phase is done.**

- **AMV-001 (critical)** The browser agent resolves a model-proposed field name
  to a real secret and types it into a page. A hostile page can induce that
  choice. Secrets must be bound to an approved origin and field and be
  single-use; the model must never select which secret is used.
- **AMV-002** No request interception - subresources, redirects, XHR and form
  posts are never checked. Intercept before connection, not after.
- **AMV-036** Browser spend trusts a client-declared amount and records it before
  launch succeeds.
- **AMV-047 / 049 / 050** IMAP declared-size allocation, sandbox timeout cannot
  stop a synchronous loop, school aggregation fan-out.

### Phase 5 - Hardening and hygiene

Remaining mediums and all lows: CORS actually applied, HTTP method enforcement,
global body-size limit, account enumeration on login/reset, Google
`email_verified`, SRI pinning, CI action pinning by SHA, JWT `typ`/`nbf`/`exp`,
identifier entropy, mail KDF salt, OAuth redirect prefix comparison, and the
documentation that overstates guarantees (AMV-SP-11 - which is the same
comment-versus-code class as above).

### Phase 6 - Re-audit what was never reviewed

Payments (`automatic_payment_methods`), Telegram, STARTTLS ordering, and the four
new routes. Send the **correct** archive this time, with its SHA-256 verified
against `git archive HEAD` before it leaves.

---

## 4. Process changes so this does not recur

1. **Archives are verified before they are sent.** `git archive HEAD | sha256sum`
   compared against the file, and a spot check that a known-recent symbol is
   present. The failure here was silent and I did not look.
2. **`npm run test:worker` gets fixed** so the shortcut and the gate agree.
3. **A test for the comment-versus-code class.** Three lessons and it still
   happened twice more. Where a comment states a guarantee about a response code,
   a retry, or a credential, the test asserts the behaviour rather than the prose.
