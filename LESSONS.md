# AMV — Lessons Log

A running record of mistakes I made and the rule I take away from each, so I
don't repeat them. Read this at the start of every session. Newest at top.

Format: **Mistake → Root cause → Rule going forward.**

---

## 2026-07-25 (architecture)

### 19. Split a working single-file app ONLY as a byte-identical operation
- **Context:** Splitting the 18k-line `app.js` into `src/app/*.js` modules. A
  working file that auto-deploys to production must not change behavior during a
  reorg.
- **Rule:** Cut only at top-level boundaries (section banners, never mid-
  declaration), and PROVE the split is safe before wiring anything: the ordered
  concatenation of the module files must equal the original file byte-for-byte
  (sha256 match). Then the build reads the modules and the full gate confirms.
  Keep the concatenated file (`app.js`) committed + generated so `check.mjs` /
  `preflight` / grep keep working, and document loudly that the modules are the
  source (hand-edits to the generated file are lost on rebuild). It is still one
  runtime script - the modules are organization only, so top-level order across
  boundaries must be preserved (concatenation does this for free).

## 2026-07-25 (security audit)

### 18. An unescaped "icon" field is a stored-XSS hole across users
- **Mistake/risk:** Marketplace/project `icon` fields render UNescaped (they can
  legitimately hold one of our own file-type SVGs). The client only ever sets
  `icon` to a trusted `_fileIcon` SVG or an emoji, but the whole listing object
  (including `icon`) is POSTed to `/v1/market/publish`. A crafted API listing
  could smuggle `<img onerror=...>` into `icon` and it would execute in ANOTHER
  user's browser on browse - stored XSS. Escaping blindly would break the legit
  SVG icons, so the instinct to "just escH it" is wrong here.
- **Rule:** For a field that legitimately carries trusted markup, sanitize with
  an ALLOWLIST, not a blanket escape: allow only our own generated markup (exact
  match against a set we build) or treat it as plain text (escaped); anything
  else falls back to a safe default. `_safeIcon()` does this. And a client fix is
  defense-in-depth only - the server must constrain the field too.

## 2026-07-25 (later)

### 17. Whole-UI translation that only walks #app misses every popup
- **Mistake:** `_translateUI` walked only `#app`, but the top-right profile menu
  is appended to `document.body` and all modals render into `#ovr` - both
  OUTSIDE `#app`. So changing language translated the sidebar (dictionary) but
  left every popup/menu/modal in English. It also only ran at switch time, so
  anything rendered AFTER (opening a menu, switching tabs) stayed English.
- **Rule:** UI translation must cover every render surface (`#app`, `#ovr`,
  body-appended menus) AND re-run for content created later. A MutationObserver
  on `document.body` (guarded by an "applying" flag + rAF so it never self-loops,
  and skipping `[data-no-i18n]`) makes the WHOLE interface follow the language,
  not just what existed at switch time. Exclude live chat (`#cm` -> data-no-i18n):
  the AI already replies in the user's language; re-translating a stream is wrong.
  For no-key honest degradation, put the always-visible chrome (profile menu,
  settings sections) in the instant dictionary, not only the AI-cache path.

## 2026-07-25

### 16. A "live scan" list with per-render random ids = dead action buttons
- **Mistake:** The Fraud Monitor merged live-scanned flags (derived fresh from
  the audit log each render) with stored flags. Each scanned flag got a NEW
  random id every render and was never persisted, so clicking its action button
  called `resolve(id)` against the stored log, found nothing, did nothing - yet
  still toasted "Recorded." A button that looks like it works but silently
  no-ops is exactly the fake feature the owner rejects.
- **Rule:** Anything an operator can ACT on must have a stable identity and be
  persisted before you render an action for it. For derived/ephemeral items,
  give them a deterministic id (content + time bucket) and fold them into the
  real store (dedupe by that id) so decisions stick and nothing duplicates.
  Never show a working-looking control over data the handler can't reach.

## 2026-07-23

### 13. A "smart" prompt heuristic that forces a face onto every object
- **Mistake:** `_enhanceImgPrompt` prepended "recognizable face, true to life" to any
  prompt starting with a capital OR any single word, so "Red car", "Eiffel Tower",
  and "car" all rendered a person. Objects couldn't be generated.
- **Rule:** Auto-enhancement must fire on a NARROW, unmistakable signal only
  (here: a single camelCase/handle token like "MrBeast"), never on generic
  capitalization or single common words. When a heuristic changes model output,
  test the false-positive cases (objects, places, colors), not just the happy path.

### 14. A modal styled only for named classes renders "in the background"
- **Mistake:** The out-of-usage nudge used `.nudge-modal`, but the `#ovr` overlay
  backdrop/centering CSS was a `:has()` list of specific classes that didn't
  include it. Result: no backdrop, no z-index, no click-out - it appeared behind
  content and couldn't be dismissed.
- **Rule:** Any modal dropped into `#ovr` must match the overlay's backdrop rule
  (add its class to the `:has()` list) AND wire backdrop-click + Esc + an X. Don't
  rely on a single "Maybe later" button as the only exit.

### 15. Localized pricing must be display-only and USD-pegged (anti-arbitrage)
- The "Argentina store" exploit works when a region gets a genuinely CHEAPER
  price. Fix: show local currency as an ESTIMATE converted from the USD price at a
  fixed FX rate, with NO per-country discount, and say so plainly. A VPN/spoofed
  locale then changes only the label, never the charge. Infer region from
  `navigator.languages` (no GPS permission), and localize the whole document so
  the landing page (rendered before login) updates too - not just the in-app view.

## 2026-07-22 (scan & ask)

### 11. Order of checks in an intent handler changes what the user sees
- **Mistake:** Put the "is the integration connected?" gate before the
  clarify/recurring checks in `mcRunCommand`, so "email X every morning" hit
  "connect email" instead of the schedule chooser, and "send an email" (no
  recipient) hit "connect email" instead of "who to?".
- **Rule:** Understand the request first. Order: recurring-detection → clarify
  (ask for missing details) → capability/integration gate → run. Scheduling and
  clarifying don't need the integration connected yet.

### 12. A global `input{width:100%}` stretches radios/checkboxes too
- **Mistake:** New radio options rendered with the radio taking the full row
  width (global input rule), squishing the label into a sliver.
- **Rule:** For inline radios/checkboxes inside a flex row, set
  `width:auto!important;flex:0 0 auto` on the input and `flex:1 1 auto` on the
  label text. Always screenshot new form controls - unit tests pass while the
  layout is visibly broken.

## 2026-07-22 (marketplace)

### 9. A listing that installs to a field the seller never fills = a dead purchase
- **Mistake:** `install()` for a crew read `item.crew` (structured agents), but the
  sell form only captures free-text `item.text`. So every user-listed crew installed
  with ZERO agents and did nothing when run - the buyer paid for a dead button.
- **Rule:** Whatever the seller can actually enter must be what "use it" runs. Build
  the runnable artifact from the fields the form captures (fell back to running the
  listing's `text` as the goal). And gate publish with a per-kind deliverable check
  (`_mktDeliverableOK`) so empty/fake listings can't go live.

### 10. There are FOUR dash forms, not two
- Purged literal `—`/`–`, then `—`/`–` escapes, and this round the
  **HTML entities** `&mdash;`/`&ndash;` (18 in app.js) which also render as em
  dashes. **Rule:** when purging a glyph, sweep literal char, `\uXXXX` escape, AND
  `&entity;` forms.

## 2026-07-22 (later)

### 7. "sended" — never hand-roll past tense
- **Mistake:** Built the approve toast as `verb.replace(/e?$/,'ed')`, which turns
  "send" into "sended" and "submit" into "submited". A user running an autonomous
  task can't fix wording before it auto-sends, so this is a money risk.
- **Rule:** Use an explicit past-tense map (send→Sent, submit→Submitted, …). Never
  derive English inflection with a regex. And for anything AMV may AUTO-SEND, the
  system prompt must demand flawless spelling/grammar and a proofread pass.

### 8. A row action that re-opens its own manager pops a modal unexpectedly
- **Mistake:** `_schedToggleApproval` called `openSchedManager()` unconditionally,
  so toggling a job's mode from the Crew PAGE popped the manager modal open.
- **Rule:** Refresh only the surface that's actually showing:
  `if($('sm-bg')) openSchedManager(); if(S.tab==='crew') renderCrewView();`.

### Clarity model that worked (keep it)
- One-time drafts live in **Needs your approval**. Recurring work lives in
  **Running jobs**, each with an explicit mode: **Autonomous - sends
  automatically** (never appears in approvals) vs **Ask first - you approve each
  one** (drops a fresh draft in approvals every run). One prominent toggle flips
  between them. This is the mental model users must never be confused about.

## 2026-07-22

### 5. `data-dact` buttons are DEAD inside a `stopPropagation` modal
- **Mistake:** Built the approval editor, schedule editor, and preview footer
  using `data-dact` buttons, but those modals put `onclick="event.stopPropagation()"`
  on the inner container. The global `[data-dact]` click delegation lives on
  `document`, so stopPropagation killed every button (Back, Delete, Save, Save &
  send, Ask AMV to revise, Cancel, schedule Edit/Pause). The user hit ALL of them.
- **Root cause:** Two ways to close-on-backdrop coexist in this codebase. Modals
  that wire their own buttons with `on()` can use `stopPropagation`. Modals that
  rely on `data-dact` delegation CANNOT — the event must reach `document`.
- **Rule:** Inside any modal that uses `data-dact`, do NOT stopPropagation on the
  container. Instead close only when the backdrop itself is clicked:
  `on(bg,'click',e=>{ if(e.target===e.currentTarget) close(); })`. Test buttons
  with a real `.click()` through the delegation, not by calling the handler directly.

### 6. Two dash forms to purge, not one
- **Mistake:** First em-dash purge only replaced literal `—`/`–` bytes and missed
  the `—`/`–` **escape sequences** in JS string literals (255 of them in
  app.js) — which render as em-dashes at runtime.
- **Rule:** When purging a character from JS source, replace BOTH the literal char
  and its `\uXXXX` escape. And guard any regex that intentionally matches the char
  (write it with `\u` escapes so the purge can't neuter it).

## 2026-07-21

### 1. "Done" on the feature branch while the live host served old code
- **Mistake:** I told the owner fixes were live; their iPhone still showed the
  old broken UI. Rounds of "it still doesn't work" were actually an old deploy,
  not broken fixes.
- **Root cause:** Render deploys `main`. All my work was on
  `claude/push-files-github-09u7ye`. `main` was frozen at a pre-session commit
  (f09fdcd), so nothing I did reached the live site. I verified the *local*
  build, not the *deployed* artifact.
- **Rule:** "Verify live" means the artifact the host actually serves, not my
  local build. **Merge to `main` every time** (Render deploys `main`), push both
  branches, and confirm the deployed commit matches my work before saying "done."

### 2. Claimed a fix worked before confirming it on the real target
- **Mistake:** Reported fixes as complete based on local screenshots.
- **Root cause:** Conflated "the code is correct locally" with "the owner can see
  it working." These are different claims.
- **Rule:** Honesty rule (owner directive): never say a thing works until I've
  seen it work on the surface the owner will actually use. State exactly what I
  verified and where.

### 3. Edit tool failed to match unicode-escaped characters
- **Mistake:** `Edit` calls failed because `old_string` used literal `✓` / `—`
  but the source stored `✓` / em-dash escapes — no byte match.
- **Root cause:** Assumed on-screen glyph equals stored bytes.
- **Rule:** For source with unicode escapes, match on exact bytes — use a Python
  heredoc with index-based splice instead of the Edit tool when glyphs are
  involved.

### 4. Test port collision (EADDRINUSE :9100)
- **Mistake:** Ran a verification script while `npm run check` was still running;
  both bound port 9100 → crash.
- **Root cause:** Ran concurrent processes that claim the same fixed port.
- **Rule:** Don't run a test/verify script while the check gate is running. Wait
  for the background job to finish first.

---

## Standing reminders (owner directives — not mistakes, but never break these)
- Max quality, **no fake features** — works for real or degrades honestly.
- Honest degradation without keys; full power the moment keys are pasted.
- Never mention Claude/Anthropic in anything user-facing or pushed to the repo.
- Verify every change live. Go in order, one at a time. Review before delivering.
- Usable on **every** device. Hard to lose money. Building to be worth billions.

## 18. A feature the interface promises must exist in the code
"AMV Auto" was the default model and its description said it picks the right
model for each task. It was one line in an alias table pointing at a single
engine. Every claim the UI makes is a promise; grep the code path behind any
description that sounds like behaviour before believing it.

## 19. A cost table is not documentation, it is enforcement
Two engines were priced at two to three times their real rate. Nobody was
overcharged - but the margin backstop spends against those numbers, so paying
users were cut off after burning a third of the allowance their money covered.
Wrong constants in a table that only feeds a report are cosmetic; wrong
constants that feed a limiter are a product defect.

## 20. A limit denominated in a unit that can move is not a fixed limit
Plan allowances are counted in tokens. Changing the engine changed how many
tokens the same sentence costs, so a model upgrade silently cut every user's
real allowance by about a quarter. When a limit is expressed in a derived unit,
write down what it was calibrated against, and re-derive it when that moves.

## 21. Merge-by-replacement destroys other devices' work
Sync stored each list with Object.assign, so the last device to push won
wholesale and a stale phone could erase a laptop's conversations. Any
multi-device write path needs either item-level merge or a revision check. And
the merge itself needs a tiebreak that prefers substance, or a payload that was
trimmed to fit a size cap will overwrite the full copy it was trimmed from.

## 22. Optional tuning must not be able to take the product down
thinking, effort and cache markers are tuning, not the request. If a model
stops accepting one, a naked 400 breaks every chat at once. One retry with the
optional parts stripped keeps the product working, and an alert stops "still
working" from meaning "silently degraded forever".

## 23. Logic with no way in is not a feature
Spending limits, family links and the consent gate all shipped as working,
tested code with no screen. Worse, the consent gate refused every purchase
until terms were accepted and an age confirmed - with nowhere to do either.
Before calling a module done, open the app and try to reach it as a user.
