# Build 18 audit - status (Nov 22, 2026)

Source: the independent "AMV Build 18 final pre-purchase engineering audit"
(30 new items, B18-001..030). Each row says what was done here, with the
evidence, or why it is not code.

## Fixed in code, with a test proved by breaking the fix

| Item | What | Evidence |
|---|---|---|
| B18-029 | `MAIL_CRED_KEY` could not be rotated: replacing it made every stored mailbox password, school and Telegram token and calendar link unreadable. `MAIL_CRED_KEY_PREVIOUS` now reads the old seals and each is sealed again where it is used. The key order and every rotation are in `docs/KEYS.md`. | `a-rotated-credential-key-keeps-connections`: 8/8. Removing the re-seal, or the PREVIOUS read, fails it. |
| B18-001 | A closed purchase hold could be armed again from a stale stored copy after settlement's receipt write failed. The auditor's patch was applied as given: a retried hold asks the counter whether it closed (`onceGet`), 409 if it did, 503 if the counter cannot say. | `a-purchase-closes-once`: 32/32. With the old `spendHold` restored, the two new assertions fail. |
| B18-013 | The repository checkout suite asked the real DNS service, so it failed on any machine whose network refuses it. Lookups are now answered inside the suite, and a new case sends the download to a name that points inside: refused as `blocked`, never fetched. | `a-repository-opens-in-the-cloud-workspace`: 27/27. Giving that name a public address fails the new assertions. |
| SEC-14 (plan, "partial") | Purchase holds past the first page of a person's index were never shown to be exported or erased - and could not be: the shared test store answered every listing in one page and called it complete. It now lists as the real store does (1,000 a page, a cursor resuming after the last key). | `every-purchase-hold-is-exported-and-erased`: 2,351 holds over three pages plus the old list. Stopping either walk after one page fails it. |
| B18-026 | `GO-LIVE.md` said the counter and Browser Rendering need Workers Paid. Corrected to the free-plan facts the auditor cited (SQLite Durable Objects on Free; a small daily Browser Rendering allowance), marked as their reading: Cloudflare's docs are not reachable from this session. | `GO-LIVE.md` rows for `AMV_COUNTER` and `BROWSER`. |

## Environment, not product (B18-008..012, 014)

The auditor's machine had no terser, acorn, Playwright, bubblewrap or
PostgreSQL, so 11 suites could not run there. All 11 run and pass in this
repository's gate (`CI=true npm run check`, 25/25 stages, all suites) with
PostgreSQL 16, bubblewrap and Chromium installed, and on GitHub's CI before
every deploy. B18-024's 4 MB figure is the `--no-minify` build; the shipped
page is minified (about 1.5 MB) and held under a gzipped ceiling by the gate.

## Owner or live infrastructure (not closable from code)

B18-002 (PostgreSQL as sole authority; B18-003 is already covered by the opening-balance and reconcile phases - docs/DATA-TIER.md corrected),
B18-004/005/006/007 (queue, browser, cloud computer, workspaces bindings -
`consumer_full` preflight fails on purpose until they exist),
B18-015 (restore drill), B18-016/019/020 (live sign-in providers, Stripe
sandbox, email domain), B18-017 (merchant verification - checkout stays
person-operated, docs/BUYING.md), B18-018 (the eval set now has 14 cases - four added here: an instruction hidden in a document, answering only from given text, never claiming a booking it did not make, never keeping a password; each grades a bad answer as failed. Running them needs the model key: docs/KEYS.md step 2),
B18-021 (independent penetration test), B18-022/023 (load, on-call),
B18-025 (visual QA on real devices), B18-027 (per-country capability ledger
with live contract tests), B18-028 (checked live from outside by the
`synthetic` workflow: server source 404), B18-030 (signed launch gate).
