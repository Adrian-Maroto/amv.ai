# Findings status

Updated as each is fixed. Phase 5 is everything not assigned above:
hardening and hygiene. Status: TODO / DONE / REJECTED (with reason).

**DONE means a test fails without the fix.** Every entry below was
sabotage-checked: the fix was reverted in the working tree, the test was run and
observed to fail on the assertions that name the defect, and the fix was
restored. A guard that has never been seen to fail is not a guard, and three
times this week a check turned out to be unable to fail at all.

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
| 1 | AMV-004 | HIGH | Dollar spend ceilings are check-then-charge rather than atomic reservations | TODO |
| 0 | AMV-005 | HIGH | Family-cap refusal dereferences undefined `planCeiling` and returns a 500 | DONE |
| 1 | AMV-006 | HIGH | API-key authentication omits account holds, family limits, team billing identi | TODO |
| 1 | AMV-007 | HIGH | Cross-processor webhook ordering can overwrite a newer subscription state | TODO |
| 0 | AMV-008 | HIGH | PayPal webhook failures acknowledge success and suppress provider retries | DONE |
| 1 | AMV-009 | HIGH | Marketplace checkout allows duplicate charges and one-of-a-kind overselling | TODO |
| 1 | AMV-010 | HIGH | Marketplace reversal takes a permanent claim before best-effort, non-idempoten | TODO |
| 1 | AMV-011 | HIGH | Payout rejection is marked terminal before the seller is refunded | TODO |
| 0 | AMV-012 | HIGH | `_withKV` treats read/parse failures as an empty record and can overwrite live | DONE |
| 3 | AMV-013 | HIGH | Lease locks have no owner token, renewal, or fencing | TODO |
| 0 | AMV-014 | HIGH | Account export returns the live Canvas bearer token | DONE |
| 2 | AMV-015 | HIGH | Account deletion requires only a bearer token and can report success after par | TODO |
| 2 | AMV-016 | HIGH | Backup restore is KV-only and can restore stale authentication/authorization s | TODO |
| 2 | AMV-017 | HIGH | Concurrent signup can create multiple valid sessions for one email with last-w | TODO |
| 2 | AMV-018 | HIGH | Password-reset codes and links are not atomically attempt-limited or consumed | TODO |
| 2 | AMV-019 | HIGH | Refresh and access tokens are persisted in localStorage under a weak inline-sc | TODO |
| 2 | AMV-020 | HIGH | Service worker caches revocable or token-bearing same-origin pages | TODO |
| 0 | AMV-021 | HIGH | Model compatibility retry can throw outside reservation cleanup | DONE |
| 0 | AMV-022 | HIGH | Model transport has no default deadline | DONE |
| 5 | AMV-060 | HIGH | Shipped deployment configuration is not launch-ready | TODO |
| 2 | AMV-SP-03 | HIGH | Account deletion cancels Stripe but not PayPal subscriptions | TODO |
| 2 | AMV-SP-04 | HIGH | Payout-in-flight lookup fails open during account deletion | TODO |
| 1 | AMV-023 | MEDIUM | SMS user context omits family limits | TODO |
| 5 | AMV-024 | MEDIUM | Changing an SMS phone leaves the old phone authorized | TODO |
| 5 | AMV-025 | MEDIUM | SMS verification uses `Math.random`, has no attempt cap, and updates uniquenes | TODO |
| 5 | AMV-026 | MEDIUM | Login and reset responses enumerate registered accounts | TODO |
| 5 | AMV-027 | MEDIUM | Google sign-in is an unbounded external-call amplifier and does not require `e | TODO |
| 5 | AMV-028 | MEDIUM | Configured CORS origin is ignored by JSON responses | TODO |
| 5 | AMV-029 | MEDIUM | No global request-body size limit exists before JSON/text/form parsing | TODO |
| 5 | AMV-030 | MEDIUM | Most routes do not enforce HTTP methods | TODO |
| 3 | AMV-031 | MEDIUM | Malformed database JSON is treated as a missing record | TODO |
| 3 | AMV-032 | MEDIUM | Atomic counters and claims silently fall back to non-atomic KV | TODO |
| 3 | AMV-033 | MEDIUM | Multiple shared records still use unlocked read-modify-write | TODO |
| 3 | AMV-034 | MEDIUM | Team creation and join are multi-record partial commits | TODO |
| 3 | AMV-035 | MEDIUM | Automation create/update/run workflows have race and exactly-once gaps | TODO |
| 4 | AMV-036 | MEDIUM | Browser spend control trusts client-declared amount and records it before laun | TODO |
| 5 | AMV-037 | MEDIUM | Public error telemetry can be poisoned and leak sensitive text | TODO |
| 5 | AMV-038 | MEDIUM | Backup export can silently omit D1 data and buffers the full store in memory | TODO |
| 5 | AMV-039 | MEDIUM | Account export swallows read/list failures and may claim completeness | TODO |
| 0 | AMV-040 | MEDIUM | Payout wash-trading signal reads a field that is never populated | DONE |
| 1 | AMV-041 | MEDIUM | `paidOut` increments on request and is not reversed when a payout is rejected | TODO |
| 3 | AMV-042 | MEDIUM | Marketplace ratings, reviews, and thread-read state lose concurrent updates | TODO |
| 5 | AMV-043 | MEDIUM | Reviews can become impossible after a seller unlists an item | TODO |
| 5 | AMV-044 | MEDIUM | Widget message listener does not verify origin or source | TODO |
| 3 | AMV-045 | MEDIUM | Widget configuration and live-key writes are non-transactional | TODO |
| 5 | AMV-046 | MEDIUM | Audit webhook delivery is fire-and-forget without `waitUntil` | TODO |
| 4 | AMV-047 | MEDIUM | IMAP literal parsing allocates attacker/provider-declared sizes before truncat | TODO |
| 4 | AMV-049 | MEDIUM | JavaScript sandbox timeout cannot stop a synchronous infinite loop | TODO |
| 4 | AMV-050 | MEDIUM | School work aggregation performs many sequential external calls and accepts la | TODO |
| 5 | AMV-051 | MEDIUM | Admin user listing converts storage failure into a valid empty result | TODO |
| 5 | AMV-052 | MEDIUM | Administrative routes use inconsistent authentication and rate-limiting gates | TODO |
| 3 | AMV-053 | MEDIUM | API-key creation limit is a racy read-append-write | TODO |
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
