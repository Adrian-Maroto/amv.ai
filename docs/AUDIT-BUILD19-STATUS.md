# Build 19 audit - status of every item (Nov 28, 2026)

The Build 19 register has 90 items: B19-R/D/P/S (65) and NEW-01..25. The
234 Build 16-18 items are already accounted for row by row in
`docs/AUDIT-BUILD18-PLAN-STATUS.md`, so they are not repeated here. The
audited copy is main at 0676d77 (Nov 26). The Nov 27-28 work after it is
counted where it closes an item.

**Done** means changed in code AND held by a suite that fails when the fix
is undone (mutation-checked where marked "M"). **Partly** means part is
fixed and the rest is named. **Live** means it needs live infrastructure,
real accounts, real users or the owner, and nothing in this repository can
prove it. **Not adopted** means the audit's proposal was weighed against an
owner decision and declined, with the reason.

| Item | Status | Evidence / what remains |
|---|---|---|
| B19-R-01 | Done (M) | Counted jobs lead Popular (`_cjPopular`, `_cjMeasured`). Suite `what-people-switch-on-leads-crew`: a job outside the fifty with 9 accounts is first. |
| B19-R-02 | Done (M) | Service rows are keyed by id and site (`_ccSvcKey`). Suites `a-country-switch-never-mixes-two-countries` and `a-service-site-is-the-one-for-its-country`. |
| B19-R-03 | Done (M) | Banks, phone companies, supermarkets, lines, hospitals, schools and government bodies not placed in the country (Wikidata country, headquarters, operating area, jurisdiction, place or subsidiary; or the country's own domain; or listed by no other country) go last, marked "Not confirmed in ..." (`_ccNotHere`, `scripts/country-sites.mjs`). Not deleted: a missing fact is not proof of absence. |
| B19-R-04 | Partly | Tasks are 103 everyday tasks naming no company (Nov 28). Their order within a section is editorial, not measured per country, as RESEARCH.md says. |
| B19-R-05 | Partly | The notes say "visit most (Chrome UX Report, month)" - a bucket, not a rank. Category-specific demand data needs a paid source (GWI, which is paywalled). |
| B19-R-06 | Partly | No padding: no section is filled with another kind's services, and an empty topic says "Nothing here connects yet". Coverage per country is in `docs/COUNTRY-DATA.md`. Filling the 529 empty cells needs source research. |
| B19-R-07 | Done | The button says "Ask AMV": a new chat with a request that checks the site serves the country and does nothing unasked. 3 suites. |
| B19-R-08 | Partly | Directory rows say "Ask AMV", never "connect". A certified per-provider capability registry needs live providers (NEW-10). |
| B19-R-09 | Done (M) | `scripts/site-fit.mjs` picks each organisation's site for the country: its own domain, then fewer labels, then more visits. The replacement must be the same organisation. Run on every country: 1,068 sites corrected. The first run's mistakes were reverted and the rule fixed (LESSONS). |
| B19-R-10 | Done | The 104 covered countries are listed in `docs/COUNTRY-DATA.md`. Another country gets "AMV has no tasks for this country yet" (checked: Bhutan). |
| B19-R-11 | Done (M) | Every section puts counted jobs first (`_cjEvidenceFirst`). Suite: a counted job leads "Inbox & calendar", and leaves the top when the count is removed. |
| B19-R-12 | Live | City-level demand needs city data AMV does not have. |
| B19-R-13 | Done | Past 6 months the note says the order may have changed; past 18, that it is too old to say. Suite `popular-says-what-it-measured`, run with the clock moved forward. |
| B19-R-14 | Done (before) | The country's own before the world's within a bucket (`x`, country-reach). |
| B19-R-15 | Done | Visits are deliberately NOT treated as evidence of availability. Evidence is Wikidata placement, the country's own domain, or a listing no other country has. |
| B19-R-16 | Done (M) | One account counts once per job per country (`_jobuseFirst`, in its own job record, capped at 400 pairs). People are counted separately. Suite: 30 creations by one account are 1. |
| B19-R-17 | Partly | Tasks no longer rank by site visits. Measured task demand needs use data (NEW-09). |
| B19-R-18 | Partly | One site per organisation per country (R-09). Merging brands across kinds is not done. |
| B19-R-19 | Done | Directory rows never claim to be connected (R-07); the connectable apps are separate cards. |
| B19-R-20 | Live | Needs a user experiment. |
| B19-D-01 | Done (M) | At 320px the consent answers fit on one line, and the Crew composer and Run button are never covered. Suite `a-320-screen-shows-everything-whole`. |
| B19-D-02 | Done (M) | Without the server, All no longer opens on "Xfinity inbox digest": the everyday fifty come before one provider's jobs. |
| B19-D-03 | Done (before) | The Chat start is a greeting and a composer, not a Build hero (seen at 390px). |
| B19-D-04 | Live | Distinct statuses exist (Ask AMV, Connect, Run, approval cards). Proving they are understood needs a 10-person usability test. |
| B19-D-05 | Live | Needs a real signed-in test account. |
| B19-D-06 | Partly | The connect step is one centred page per need (Nov 27, #150). Live accounts are not tested. |
| B19-D-07 | Live | Needs the live billing sandbox. |
| B19-D-08 | Done (before) | Country and language are separate settings (the Spanish note test runs in country ES with language es; the Bangladesh tests run in English). |
| B19-D-09 | Live | Authenticated Team and Help end to end. |
| B19-D-10 | Partly | Keyboard check: every Crew and Integrations control shows a focus ring (the composer through its box). A screen reader matrix is manual. |
| B19-D-11 | Partly (M) | At 320px the header ran off screen on every tab and the country was cut to "Pak": both fixed, suite. Every state at 320-1920 is not swept. |
| B19-D-12 | Partly | Crew opens on the country's ten plus search; the rest sits behind chips and Show more. Usability test pending. |
| B19-P-01 | Done (M) | Typing froze the page 420-484ms per letter (4x CPU); now 0ms after the first letter. Suite `typing-in-crew-never-freezes`. |
| B19-P-02 | Partly | Cross-country search is already capped and cancellable (`_ccSearchTok`). A compressed index is not built. |
| B19-P-03 | Partly | Non-chat screens are fetched files. The page is held under a 597KB gzipped ceiling by the gate. |
| B19-P-04 | Partly | Measured at 4x CPU: Crew opens with a 170-250ms task. A country switch still blocks 170-280ms once while the 25,000-job list is rebuilt. Not fixed. |
| B19-P-05 | Done | The country order computes each entry's keys once, not on every one of about 400,000 comparisons. |
| B19-P-06 | Done (M) | A late answer for a country somebody left changes nothing (Tasks ids per country; Integrations checks it is still wanted). |
| B19-P-07 | Done (before) | Content-hashed app file with SRI; the last 3 builds are kept (`app-files.json`). |
| B19-P-08 | Live | Real-user measurement needs production traffic. |
| B19-S-01 | Live | `preflight --profile=consumer_full` refuses missing bindings by design. Provisioning them is the owner's infrastructure. |
| B19-S-02 | Live | Postgres authority cutover (GO-LIVE.md). |
| B19-S-03 | Live | Merchant checkout needs live merchants. Final-basket approval exists in code (Build 16 AG-01..04). |
| B19-S-04 | Live | Identity lifecycle under real providers. |
| B19-S-05 | Live | Restore drill on real infrastructure. |
| B19-S-06 | Done here | The full gate runs every Worker suite with Postgres, Playwright and bubblewrap installed (`.claude/session-setup.sh`). |
| B19-S-07 | Done here | terser is in the lockfile. `npm ci` provides it, and the gate builds minified. |
| B19-S-08 | Live | The queue and dead-letter queue bindings are the owner's infrastructure (preflight names them). |
| B19-S-09 | Live | Real Postgres tenancy contract tests. |
| B19-S-10 | Live | Provider credentials go in environment secrets, never in code. |
| B19-S-11 | Done here | The export and erasure suites run in the gate with Playwright. |
| B19-S-12 | Done (before) | Per-IP and per-account limits (`guardAction`) on public and paid routes, plus a global spend cap. |
| B19-S-13 | Partly | Directory rows are separate from connectable apps (R-07/R-19). A tested scope registry is live work (NEW-10). |
| B19-S-14 | Done (before) | The action protocol: every write reads its result back and declares an undo or why it is irreversible, or the Worker refuses to start (`09a-action-protocol.js`). |
| B19-S-15 | Live | Real provider failures. |
| B19-S-16 | Live | Needs an advisory service. The deps stage of the gate checks the lockfile. |
| B19-S-17 | Live | Tracing and on-call. |
| B19-S-18 | Live | Load and soak tests. |
| B19-S-19 | Partly | Global spend cap plus GLOBAL_KILL exist. **Proposed, owner's decision:** per-feature kill switches (buying, hosted browser, Crew runs) as KV control keys - a KV schema change, so not built unasked. |
| B19-S-20 | Done (settled) | The host publishes only `public/`. Suite `the-host-publishes-only-what-a-visitor-needs`; the owner confirmed it. |
| B19-S-21 | Partly | See S-19. |
| B19-S-22 | Live | Model task evaluations. |
| B19-S-23 | Done (M) | Nothing is published below 25 distinct accounts in a place, or below 3 behind a job, not even the totals. Suite. |
| B19-S-24 | Partly | Every country run is told to check deadlines, fees and rules against the official source (`_countryRunNote`). A legal review per jurisdiction is the owner's. |
| B19-S-25 | Partly | Launch profiles (team, consumer_full, enterprise) make missing infrastructure an error. Production proof is live. |
| NEW-01 | Done (M) | See R-01. |
| NEW-02 | Done (M) | See R-11. |
| NEW-03 | Done (M) | The inbox leads; the holidays job no longer opens Pakistan's or Bangladesh's Crew. Suite. |
| NEW-04 | Done | 103 tasks in every country, naming no company (Nov 28). |
| NEW-05 | Done (M) | Pakistan's Sam's Club and Walmart Canada go last, marked "Not confirmed in Pakistan". Suite. |
| NEW-06 | Done (M) | See R-02. |
| NEW-07 | Done (M) | See P-06. |
| NEW-08 | Done | See R-07. |
| NEW-09 | Partly | Crew now counts deduplicated, floored starts per country (R-16). Tasks demand is not measured. Real use is needed either way. |
| NEW-10 | Live | A capability registry needs live providers. |
| NEW-11 | Partly | See R-06. |
| NEW-12 | Done (M) | See R-09. |
| NEW-13 | Done | See R-13. Each file carries its source and month (`source`, `generated`, `popular`). |
| NEW-14 | Done | Every new sentence this round has all 17 languages, written by hand (Suggested, the Popular notes, Not confirmed in {0}, the freshness notes). |
| NEW-15 | Done (M) | See P-01. Country switch still open (P-04). |
| NEW-16 | Done (M) | See D-01. |
| NEW-17 | Done here | The full gate is green before shipping (see the commit). |
| NEW-18 | Live | Postgres authority, purchases and receipts, erasure and restore on real infrastructure. |
| NEW-19 | Done | Unplaced local services are never first (NEW-05). Ask AMV acts on nothing without asking. |
| NEW-20 | Done | Every ranked list names its source and month, and each order rule has a dated row in `docs/RESEARCH.md`. |
| NEW-21 | Live | Sandbox accounts. |
| NEW-22 | Partly | See D-10/D-11. |
| NEW-23 | Live | See S-18. |
| NEW-24 | Done (before) | SRI and content hash are checked by `the-page-may-only-run-the-script-we-shipped`. |
| NEW-25 | Done / not adopted in part | The fault (a US mailbox first for Pakistan) is fixed in All's own order. Crew still opens on All, led by the country's researched ten (the owner's Nov 15 design), not on Suggested as the audit proposed: opening on the fifty would hide that ten. |

## Not adopted from the audit's patch, and why
- **Crew opening on "Suggested"** (NEW-25): see above.
- **Filtering weak services out of Tasks** (their `_ccTopCandidate` in
  `ccLeads`): Tasks name no service since Nov 28, so there is nothing to
  filter.
- **Treating Chrome visits as eligibility evidence**: refused, because the
  audit itself (R-15) says visits do not prove availability.
