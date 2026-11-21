# Build 17 audit - status of all 43 findings

Updated Nov 21. **Fixed** means a suite fails when the fix is taken out.
Each section of `the-build-17-audit-stays-fixed` was checked by breaking the
guard it covers. **Owner** means the repository cannot close it: it costs
money, needs an account in the owner's name, or needs people outside AMV.
For those, this file says exactly what to do and what AMV recommends.

## Fixed in code (27)

| Finding | What changed | Suite that fails without it |
|---|---|---|
| B17-001 | A session ends only on the revocation object's own `ended: true` for that session id; anything else is 202 "pending" | the-build-17-audit-stays-fixed |
| B17-002 | No local copy + authority unreachable = a short wait, never "absent" | the-build-17-audit-stays-fixed, the-verified-failures-of-nov-8-stay-fixed |
| B17-003, B17-004, B17-008 | A receipt is its own record with an index row (`buyix:`), paginated, with no length cap and no shared list to rewrite | a-purchase-closes-once |
| B17-005 | A purchase hold is keyed by the page's key; a retry finds the same hold, and different terms are refused | a-purchase-is-held-against-your-limits-first |
| B17-006 | "Seen on the page" is recorded as reported by the page, never as verified | a-purchase-is-held-against-your-limits-first, amv-never-presses-pay-without-your-tap |
| B17-007 | Export and erasure walk the hold index, then the older list | a-purchase-closes-once, build16-state |
| B17-009 | With DATA_STORE=d1, a write under a record lock is compare-and-swap on `updated_at` | the-build-17-audit-stays-fixed |
| B17-010 | Every `_withKV` caller classified (`docs/KV-WRITERS.md`). SMS code tries and listing takedowns moved to the atomic object | sms-security, a-compromised-publisher-is-switched-off |
| B17-015 | A dependency audit that could not run fails in CI instead of passing as a skip | `audit-deps.mjs` (CI) |
| B17-021 | What a receipt is and is not, written down (`docs/BUYING.md`); transaction ids, refunds and disputes need a store contract or phase 2 cards | - (documentation) |
| B17-022 | A job-queue message is sealed or not sent; with no key the account runs inline | the-build-17-audit-stays-fixed |
| B17-023 | An address whose DNS lookup failed is refused and asked again next time; NXDOMAIN is still an answer | the-build-17-audit-stays-fixed |
| B17-029 | Sweep at 320/360/390/768/1024/1440/1920 and right-to-left. Found and fixed: the phone menu stuck 50px over the page right to left; the cookie notice English in every language; billing facts misaligned | nothing-hides-past-the-right-edge, a-narrow-or-rtl-screen-hides-nothing |
| B17-031 | Readiness wording corrected (with no origin set, no cookie is accepted; sign-in is not exposed). Neighbouring origins checked: subdomain, lookalike, http, other port, `null` | a-locked-api-still-answers-the-widget-and-keys |
| B17-032 | Spending names a purchase, the AMV plan and a connected bank apart | a-job-and-a-payment-say-how-they-act |
| B17-033 | A Crew job says how it acts (web search, connected account, or AMV's browser) and where it runs, before it is switched on; "each evening" jobs open at 18:00 | a-job-and-a-payment-say-how-they-act |
| B17-034 | A connection that stopped working wears a red "not working" tag, not the green one, with Reconnect | a-narrow-or-rtl-screen-hides-nothing |
| D17-001 | Company sign-in binds issuer + subject; linking an existing account needs a verified address | a-company-signs-in-only-its-own-people |
| D17-002 | The sign-in callback's state is spent once, atomically | a-company-signs-in-only-its-own-people |
| D17-003 | Signing out says done only when both the refresh token and the session are provably ended | the-build-17-audit-stays-fixed |
| D17-004 | An undo ticket takes something back once; a repeat is told the first answer | what-amv-did-can-be-taken-back |
| D17-005 | A paged scan names the records it could not read and does not call the pass complete | the-build-17-audit-stays-fixed |
| D17-006 | Two tabs renewing together are timed by the claim object, not a KV mark another region may not see | the-build-17-audit-stays-fixed |
| D17-007 | When mail is refused for an account under attack, sign-in stops rather than skipping the code | a-code-is-the-other-half-of-the-key |
| D17-008 | An unreachable rate limiter admits 5 a minute per instance, then refuses | the-build-17-audit-stays-fixed |

## Already measured, with the limits named (1)

- **B17-011** (due-work index capacity): `docs/DUE-WORK.md` gives every limit,
  what happens past it, the alert that fires, and the order of the fixes.
  Steps 1 and 4 there are owner decisions (a paid queue; a schema change).

## Owner (15)

Recommendation, in order. The first two are the floor; nothing past them is
worth paying for until they are done.

1. **B17-020 Cloudflare plan.** Move to Workers Paid ($5/month), then set
   `AMV_OPS_PER_RUN=10000`. Free allows 50 outside calls and 10 ms of CPU per
   run; background jobs already stop cleanly at that limit and page, but they
   cannot scale on it.
2. **B17-013 Job queue.** Bind `AMV_JOBS` and its dead-letter queue (the
   `wrangler.toml` block is written). Background work then stops sharing one
   tick's budget.
3. **B17-027 Payments in a sandbox.** Put Stripe test keys and test price ids
   on a staging Worker, then run the staging drill (`GO-LIVE.md` 5b):
   subscribe, renew, cancel, refund, a disputed charge, and a webhook replayed.
   The code paths have suites; a real provider round trip does not exist yet.
4. **B17-012 Postgres.** Provision Postgres (or Hyperdrive) for staging first.
   The read cohort and shadow reads are built (`docs/DATA-TIER.md`); the
   authority only moves when `PG_READ` reaches 100% on staging.
5. **B17-018 Restore drill.** Once a staging copy exists, restore last night's
   backup into it and time it. The nightly backup and the restore code are
   tested; a timed restore of real data is not.
6. **B17-026 Cloud computer and hosted browser.** Turn on only after 1-3.
   They are a per-minute cost line, already metered against plans.
7. **B17-017, B17-030 Evaluations.** Set a model key on staging and run the
   eval corpus (`npm run eval`). No score is claimed until it has run.
8. **B17-019 Load.** A staging ramp after 1-4, with the SLOs in `docs/SLO.md`.
9. **B17-028 Independent review.** A penetration test and a privacy review
   before taking money at scale. This needs people outside AMV.
10. **B17-014, B17-016 Full gate in a clean environment.** CI (`test.yml`)
    runs `npm ci` and the full gate (minified build included); the
    auditors' environment lacked terser and a browser. Nothing to do unless CI
    stops running it.
11. **B17-024, B17-025 Country catalogue.** The catalogue is research and
    browser-assisted work, not 100,000 native connectors, and the job panel
    now says which a job is (B17-033). `docs/COUNTRY-DATA.md` holds the real
    counts; what is not backed yet is under *Gaps* in `docs/RESEARCH.md`.
12. **B17-035 People.** Five first-time users through Team, Help, sign-in
    and a lost connection, on a phone and with a screen reader. This is user
    research; AMV cannot do it for itself.

Take off the table: launching on Workers Free; adding Postgres before the queue;
paying for the cloud computer before payments have been through a sandbox once.
