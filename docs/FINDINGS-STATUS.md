# Findings status

Updated as each is fixed. Phase 5 is everything not assigned above:
hardening and hygiene. Status: TODO / DONE / REJECTED (with reason).

| Phase | ID | Sev | Title | Status |
|---|---|---|---|---|
| 4 | AMV-001 | CRITICAL | Browser agent can disclose supplied secrets to a hostile page | TODO |
| 4 | AMV-002 | HIGH | Browser network isolation is incomplete: redirects are checked after requests  | TODO |
| 0 | AMV-003 | HIGH | Inbound SMS model usage is not charged and bypasses the global kill switch | TODO |
| 1 | AMV-004 | HIGH | Dollar spend ceilings are check-then-charge rather than atomic reservations | TODO |
| 0 | AMV-005 | HIGH | Family-cap refusal dereferences undefined `planCeiling` and returns a 500 | DONE |
| 1 | AMV-006 | HIGH | API-key authentication omits account holds, family limits, team billing identi | TODO |
| 1 | AMV-007 | HIGH | Cross-processor webhook ordering can overwrite a newer subscription state | TODO |
| 0 | AMV-008 | HIGH | PayPal webhook failures acknowledge success and suppress provider retries | DONE |
| 1 | AMV-009 | HIGH | Marketplace checkout allows duplicate charges and one-of-a-kind overselling | TODO |
| 1 | AMV-010 | HIGH | Marketplace reversal takes a permanent claim before best-effort, non-idempoten | TODO |
| 1 | AMV-011 | HIGH | Payout rejection is marked terminal before the seller is refunded | TODO |
| 0 | AMV-012 | HIGH | `_withKV` treats read/parse failures as an empty record and can overwrite live | TODO |
| 3 | AMV-013 | HIGH | Lease locks have no owner token, renewal, or fencing | TODO |
| 0 | AMV-014 | HIGH | Account export returns the live Canvas bearer token | TODO |
| 2 | AMV-015 | HIGH | Account deletion requires only a bearer token and can report success after par | TODO |
| 2 | AMV-016 | HIGH | Backup restore is KV-only and can restore stale authentication/authorization s | TODO |
| 2 | AMV-017 | HIGH | Concurrent signup can create multiple valid sessions for one email with last-w | TODO |
| 2 | AMV-018 | HIGH | Password-reset codes and links are not atomically attempt-limited or consumed | TODO |
| 2 | AMV-019 | HIGH | Refresh and access tokens are persisted in localStorage under a weak inline-sc | TODO |
| 2 | AMV-020 | HIGH | Service worker caches revocable or token-bearing same-origin pages | TODO |
| 0 | AMV-021 | HIGH | Model compatibility retry can throw outside reservation cleanup | TODO |
| 0 | AMV-022 | HIGH | Model transport has no default deadline | TODO |
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
| 0 | AMV-040 | MEDIUM | Payout wash-trading signal reads a field that is never populated | TODO |
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
| 0 | AMV-057 | MEDIUM | `test:worker` runs only the aggregate file, not all Worker test files | TODO |
| 0 | AMV-SP-01 | MEDIUM | Google signup analytics uses an undefined variable and omits population accoun | TODO |
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
