# AMV - Lessons Log

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
- Purged literal `-`/`-`, then `-`/`-` escapes, and this round the
  **HTML entities** `&mdash;`/`&ndash;` (18 in app.js) which also render as em
  dashes. **Rule:** when purging a glyph, sweep literal char, `\uXXXX` escape, AND
  `&entity;` forms.

## 2026-07-22 (later)

### 7. "sended" - never hand-roll past tense
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
  rely on `data-dact` delegation CANNOT - the event must reach `document`.
- **Rule:** Inside any modal that uses `data-dact`, do NOT stopPropagation on the
  container. Instead close only when the backdrop itself is clicked:
  `on(bg,'click',e=>{ if(e.target===e.currentTarget) close(); })`. Test buttons
  with a real `.click()` through the delegation, not by calling the handler directly.

### 6. Two dash forms to purge, not one
- **Mistake:** First em-dash purge only replaced literal `-`/`-` bytes and missed
  the `-`/`-` **escape sequences** in JS string literals (255 of them in
  app.js) - which render as em-dashes at runtime.
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
- **Mistake:** `Edit` calls failed because `old_string` used literal `✓` / `-`
  but the source stored `✓` / em-dash escapes - no byte match.
- **Root cause:** Assumed on-screen glyph equals stored bytes.
- **Rule:** For source with unicode escapes, match on exact bytes - use a Python
  heredoc with index-based splice instead of the Edit tool when glyphs are
  involved.

### 4. Test port collision (EADDRINUSE :9100)
- **Mistake:** Ran a verification script while `npm run check` was still running;
  both bound port 9100 → crash.
- **Root cause:** Ran concurrent processes that claim the same fixed port.
- **Rule:** Don't run a test/verify script while the check gate is running. Wait
  for the background job to finish first.

---

## Standing reminders (owner directives - not mistakes, but never break these)
- Max quality, **no fake features** - works for real or degrades honestly.
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

## 24. Assigning to a getter fails silently, and the test passes for the wrong reason
`AMV_API.live` is a getter over the configured base URL. A test that set
`AMV_API.live = true` did nothing at all - no error, no warning - so the pane
under test rendered its "no server" state and the assertions were measuring the
wrong screen. Before faking a dependency, check whether the property is an
accessor, and drive the thing it derives from instead.

## 25. A reward that pays on signup is a reward you are paying attackers
Every incentive attached to account creation is priced by whoever can create
accounts fastest, not by the value of a customer. The referral loop pays only
after the invited account is a day old AND has really used AMV, rejects
same-network pairs, caps signups per code per day, and caps active rewards per
account. The reward is capacity, never money or a plan - so even a defeat of
every one of those checks cannot be converted into cash.

## 26. A screen that cannot show bad news is not a security screen
The Security pane rendered one hardcoded row - "This browser - Active now",
with a green Active badge - reading nothing. It looked identical whether the
account was healthy or had been signed into from three countries that week.
Any status display must be able to render the bad state; if it cannot, it is
decoration and it is worse than nothing, because it reassures.

## 27. Scope a destructive action to what its label promises
"Sign out of this device" posted to an endpoint that bumped the account's token
epoch, killing every session everywhere - so signing out of a laptop silently
ended a session on a phone in someone's pocket. The two scopes are now two
different requests, and the buttons say which is which.

## 28. A fresh record silently drops everything that was not part of it
setEntitlement rebuilds the entitlement from scratch on every plan change,
which is what keeps a plan change clean - and it therefore deleted the referral
capacity an account had earned the moment that account subscribed. Rewarding
someone and then confiscating it for paying you is the worst possible ordering.
Any writer that replaces a whole record needs an explicit list of the fields
that belong to the account rather than to the thing being written.

## 29. When a request cannot be scoped, fail toward MORE revocation
Scoping sign-out to one device meant a cached older client, which sends no body,
suddenly revoked nothing at all. A request that promises to end a session must
never end zero sessions: with nothing identifying which one, the only honourable
reading of "sign me out" is all of them.

## 30. A cost knob the client can set is a bill the client can raise
Prompt-cache markers arrived from the browser untouched. A cache write costs
1.25x, so markers on content that will never be read back are somebody else's
bill going up - and five of them is a hard upstream error. Anything that changes
what a request COSTS is a server decision; strip the client's version first.

## 31. A `let` at the top of the bundle is not on `window`
Top-level `function` declarations in a classic script become properties of the
global object; `let` and `const` do not. A test that assigned
`window._AUTO_EMAIL_READY` created a second, unrelated variable and passed
while proving nothing. Drive private state through the code path that sets it,
never by poking at it - and if that is impossible, the state probably wants an
accessor.

## 32. Enforce the rule where the user can still act on it
Automations were charged against a monthly ceiling that a free account does not
have, so the cron deactivated them on their first due run - silently. The user
had already been told "Scheduled - it'll run in the background". The same rule
applied at creation time costs nothing and turns a broken promise into an
upgrade prompt. Validate at the moment of the request, not at the moment of
the consequence.

## 33. Deliver where the promise said it would arrive
"Have it ready every morning, even with AMV closed" is only true if it reaches
somewhere the user looks while AMV is closed. Results defaulted to in-app, so
the only way to discover there had been a reason to come back was to come back.
A background feature that cannot reach the user is a feature they will never
know ran.

## 34. Store the baseline only after the delivery that made it real
The weekly digest wrote its snapshot whether or not the email actually went
out, so a provider outage would have made the next week compare against a week
nobody ever saw - quietly under-reporting the change. Anything that becomes the
reference point for a future comparison must be written after the thing it is
supposed to reference has happened, and the attempt must be released so it
retries rather than being silently lost.

## 35. One secret, one holder
Three surfaces needed the admin token and all three did something different:
one asked every session and promised it was never stored, one wrote it to
localStorage, and one sent the signed-in user's ACCESS token to an endpoint
gated on the admin secret - a request that could only ever be refused, which
surfaced to the operator as "network error". A credential used in more than one
place needs a single holder with a single lifetime, or the weakest treatment
becomes the real one.

## 36. Work done while the user is away has to be visible when they return
Automations ran, produced real answers, and stored them - and the only trace
was a toast that vanished in six seconds and a number on a nav item. The single
strongest reason to come back to a product was its least visible feature. If
something happens while the user is gone, the place they land has to show it;
anything that requires them to go looking will only be found by people who
already knew.

## 37. A status screen that cannot see the thing it reports on is decoration
The Go-Live list was assembled in the browser, which cannot see a single Worker
secret. Three of its rows were hardcoded to "not set up" whatever the truth
was, and the row for the AI engine reported whether THAT BROWSER had a session
- which says nothing about whether the server holds a key. The screen whose
entire job was to answer "is this real yet" answered confidently and could not
possibly know. Readiness has to be reported by the thing that holds the state.

## 38. Report that a secret exists, never anything about its value
Not a prefix, not a length, not a masked sample. A readiness screen that leaks
the shape of a key is worse than one that guesses, because it is trusted.

## 39. Cutting a customer off before the retry that would have paid you
The past-due grace was three days. The payment processor retries a failed card
for about three weeks, and most recoveries land inside the first. Ending the
subscription on day three loses revenue to an expired card or a bank's fraud
hold - not to anyone deciding to leave. Grace windows should be set from the
recovery curve, not from a round number, and the message during them should
read as recoverable rather than final.

## 40. Reach is opt-in when the cost of being wrong is permanent
A shared page that search engines index is a real acquisition channel and an
irreversible act: revoking a link does not remove a snippet somebody already
saw. Someone sharing a conversation with one person does not expect a search
result. So the growth is offered, with the permanence stated next to the
control, and never taken by default - including for anything created before the
choice existed, where silence is not consent.

## 41. A test that cannot fail is worse than no test
Every mobile assertion in this session used
`documentElement.scrollWidth <= window.innerWidth`. Both `html` and `body`
carry `overflow-x: hidden`, so the document can never report a scroll width
wider than the viewport - a 900px element on a 390px phone measures as zero
overflow. Six suites were asserting nothing at all, confidently. Before
trusting a new assertion, break the thing on purpose and watch it go red;
if it does not, the assertion is decoration. Measuring from element geometry
found a real 43px clipped toolbar within a minute of being fixed.

## 42. Clipped overflow is worse than scrolling overflow
Because the page hides horizontal overflow rather than scrolling it, anything
past the right edge is not awkward - it is unreachable. That makes width
regressions silent for users as well as for tests.

## 43. Writing a payout record nothing ever reads destroys the money
A seller could withdraw: the balance was zeroed, a debit was logged, and the
request was written to a key with no reader anywhere in the product. No
endpoint, no screen, no way to mark it paid. The money left the seller and
arrived nowhere, and the operator had no idea they owed anyone. Any write that
represents an obligation needs a reader and a settlement path shipped in the
same change, and refusing one has to return what was taken.

## 44. Charging for the thing that creates the habit
Background automations - the strongest reason anyone returns - were entirely
behind the paywall, so the users most likely to churn were the only ones who
never saw one. You cannot convert someone who never found out what they were
converting to. One free weekly job on the cheapest engine, with a hard
ceiling of cents, is a marketing budget rather than a leak.

## 45. Money must be reversible in both directions
A marketplace purchase granted the item and credited the seller. A refund or a
chargeback on that same payment did none of the reverse - the buyer kept the
item, the seller kept the money and could withdraw it, and the platform ate the
charge. "Buy the expensive listing and charge it back" was a way to take money
out. Any credit needs its debit written in the same change, keyed to something
the reversal will actually arrive quoting, and the balance has to be allowed to
go negative or being fast is rewarded.

## 46. One refund is not one kind of refund
Every Stripe refund called setEntitlement(free), so a paying subscriber who
refunded a nine dollar listing lost the plan they were still paying for.
Payments for different things need telling apart before anything is revoked.

## 47. Do not offer a standing job for a settled fact
Widening the activation offer to any long answer would have proposed re-running
"what is the capital of France" every week - a feature that does nothing, which
is worse than offering nothing. Activation only counts when the thing offered
is genuinely useful for that question.

## 48. A guard that stops at its own boundary hides everything inside it
The translator skipped any node inside `[data-no-i18n]`, checked with
closest() - which matched the boundary element itself, so the walk never
descended and no opt-in inside could ever be found. Carrying the state down the
walk instead of looking it up made both directions expressible: protect model
output, translate AMV's own words sitting next to it.

## 49. SHIPPABLE and DEPLOYABLE are different claims
The gate printed one green line for both, so a config blocker hid behind a
passing test suite. Code can be perfect while the deploy would fail on a
placeholder namespace id, and "all checks passed" is exactly the sentence that
stops anyone looking further.

## 50. Nothing measured whether the answers were good
Cost, latency, margin, abuse and growth were all instrumented. Quality was not,
so a routing or prompt change could make AMV materially worse with every
dashboard staying green. Measuring it must not mean storing conversations: the
engine, the direction and a coarse reason answer the question without keeping
anything worth stealing.

## 51. A revoke that only marks the record is not a revoke
The first version of API key revocation set `revoked` on the item and left the
hash-to-account lookup in place, so the key kept working. A revoke button that
does nothing is worse than none, because it is believed. Whatever the request
path actually reads is the thing that has to be removed.

## 52. Validate a URL where it enters, not where it is used
A listing could store any string as a file URL. Nothing renders it as a link
today, so it was not a live hole - but trusting every future renderer not to
make it an href is how stored XSS arrives by way of an unrelated change months
later. Scheme-check at the door.

## 53. A number that can be manufactured is not a ranking signal
Marketplace installs drove ranking and were unauthenticated, limited only per
IP. A rented address pool could rank anything to the top. An install now costs
an account and counts once per account per listing.

## 54. Speed is the thing users feel and the thing nobody was measuring
Cost and quality were instrumented; latency was not. A routing change that
halved the bill and doubled the wait would have looked like a pure win on every
screen. Time to the first token is bucketed rather than logged - the shape is
the useful part, and a per-request log of who asked what and when is only a
liability.

## 55. A gate that only exists in the browser is not a gate
Teams was gated on the Elite plan in `renderTeamView` and nowhere else. The
server's `teamCreate` happily created a team for anybody who called it. Every
"this plan includes X" check has to be answered by the side that also does the
work, or the plan is a suggestion the app makes to itself.

## 56. Inheriting a plan without pooling the counters multiplies the bill
Team members drawing on the owner's Elite plan while keeping their own `usg:`
and `cost:` keys is not a shared subscription, it is twenty-five subscriptions
for the price of one. The plan and the counters have to travel together, which
is what `billingSubject` is for. And the seat count has to be re-derived on
every request, not only at invite time - otherwise upgrade, fill every seat,
downgrade is a way to buy Ultra for the price of Pro.

## 57. Anything not in ENT_CARRY_KEYS is destroyed by the next plan change
`setEntitlement` rebuilds the entitlement record from scratch. `teamId` was
being written to it and would have been wiped by the first upgrade, downgrade,
admin override or Stripe webhook - silently ejecting a member from the team
whose plan they were on, with nothing anywhere explaining why. The same trap
already ate referral bonuses once.

## 58. A failed request is not an empty result
`AMVTeam.get()` caught its own errors and returned `null`, which the caller
reads as "you have no team". One dropped request put an owner in front of a
create-a-team form for a team that already existed, and a member in front of an
upgrade wall for a team they were already in. Load failures need their own
branch and their own words.

## 59. A nav item built at runtime can silently fail to appear
The Admin tab's only entry point injected itself after `.snb[data-tab="tasks"]`
- a selector the sidebar stopped matching when Tasks moved into the tool rail.
The injection found nothing, threw nothing, and the operator view became
unreachable from the app. Static markup that gets unhidden cannot fail this way,
and a test that clicks the entry point catches it when it does.

## 60. "custom" is a price, not a tier
`PLAN_RANK['custom']` is undefined. On the client that read as rank 0 and
refused every custom plan the copy promised teams to; on the server it had been
hardcoded to 3, so a twenty dollar custom plan outranked Elite. Anything that
compares plans has to rank a custom plan by what was actually paid.

## 61. An unset config value becomes the key "undefined"
`PLAN_FROM_PRICE` was an object literal keyed on env vars. Every unconfigured
price collapsed onto the same `undefined` entry, and whichever plan was written
last won it - so a webhook quoting an unknown price, or an invoice event with no
price at all, resolved to a real plan and granted it. Three plans hid it; adding
a fourth exposed it. Build lookup maps by inserting only what is actually set.

## 62. A silent lookup is a feature that can disappear without a trace
`getElementById` returning null throws nothing and logs nothing, and nearly
every one of those lookups is wrapped in the `if (!el) return` that makes the
silence permanent. That is how the Admin tab became unreachable, how the billing
portal button stopped existing while its handler stayed, and how Ctrl+B kept
toggling a drawer that had been removed. `tests/e2e/wiring-anchors.test.mjs`
now fails the build when the bundle looks up an id nothing anywhere creates.

## 63. Copying a destination into six call sites removes the ability to change it
The model endpoint, auth header and protocol version were duplicated across six
`fetch` calls. The duplication was the small problem; the real one was that
switching endpoints during an outage meant editing six places correctly under
pressure, so it was never going to happen. One transport function made failover
a config value. It does NOT retry streams: words already delivered would be
repeated, and a duplicated answer is worse than an honest error.

## 64. A price table copied three times is three chances to be wrong about money
`{pro:15, elite:75, ultra:200}` lived in the chat backstop, the SMS backstop and
the automation budget, each with its own handling of a custom plan - and the
number they compute IS the margin guarantee. Adding a per-seat plan would have
had to be done in all three, correctly, forever. One `_planPriceUSD`.

## 65. Plan population cannot tell you whether the product is working
Every dashboard number described the business today. None answered "of the
people who signed up, how many ever got value, came back, and paid" - so first
screens, activation nudges and onboarding copy were all judged on feel. The
funnel is four cumulative counters, each marked once per user off the event that
actually proves the step, so the ratios stay exact with no scan.

## 66. Scheduling a job is not the same as being able to do it
The investing check-in created a real server automation, the tests proved the
job existed, and the screen said it would run every morning. But the cron hands
`item.detail` to a model whose only tool is web search - it cannot read a
brokerage account. So the one thing the feature promised was the one thing it
could not do, and its two available outcomes were an apology every morning or an
invented figure about somebody's retirement. A check-in is now `kind:'invest'`
and the cron runs the real read itself, so the numbers come from the institution
or are absent. The general rule: when scheduling something, check what the
RUNNER can do, not just that the job was accepted. "The job exists" is the
easiest thing to test and the least of what was promised.

## 67. A fixed-width source slice is a test that eventually cries wolf
`key-readiness` asserted the link email is addressed to the owner by slicing
2600 characters from the start of `linkInvite`. Lengthening a string inside that
function pushed `to:[owner]` past the window, and the gate reported a security
regression in an unchanged line. A test that fails for the wrong reason is worse
than no test: the next real failure looks like the same false alarm. Slice
functions by their next declaration, and assert the slice reached the thing
being checked.

## 68. Two of the three states of a schedule were lies
The investing pane wrote the chosen frequency to localStorage and posted a new
server job. Choosing daily and then weekly created two jobs and deleted neither,
so the buttons showed one schedule while two ran. "Stop" cleared the local key
and said "AMV will not check on its own" while the server kept checking. Any
control over remote state has to remember the id of what it created, delete it
before replacing it, and say what happened only AFTER the server agrees -
including the case where the delete fails and the old job is still running.

## 69. Three things pointed at a screen that did not have them
Server automations ran, produced answers, and were fetched into `_AUTOS` and
`_AUTO_RESULTS`. The unread badge was pinned to the Tasks nav item, and every
scheduling confirmation said the result would be waiting in Tasks. The Tasks
screen rendered a queue held in localStorage and nothing else. The only screen
that DID render those results guarded on `S.tab==='automation'` - a tab value
that has never existed, so `renderAutomationView` was unreachable and its two
refresh hooks never fired once. Nothing threw; a badge simply led nowhere. When
a count, a badge, and a confirmation all name a destination, open that
destination and read it - the pointer is cheap to write and no test asserts the
thing pointed at is there.

## 70. A hardcoded colour is a second theme waiting to be wrong
`.sec-head h3` was `color:#e6edf3`, picked when AMV had only a dark theme. Every
section heading in the product - "Only on AMV" included - rendered as pale grey
on white the moment the light theme existed, and it had presumably been that way
for as long as the light theme had. Nothing failed and no test covers colour, so
it survived until a screenshot was taken in both themes. The token was already
correct in both. Screenshot BOTH themes for any screen touched; a value a token
already covers must never be written literally.

## 71. Seventy switches attached to nothing
Crew's standing jobs looked like the reason to buy a plan: toggle one on and AMV
works in the background. The toggle wrote `{key, on_flag}` into a `crewjobs` KV
record, and grep for that key finds exactly three places - the endpoint that
writes it, the same endpoint reading it back to redraw the switch, and account
deletion. The cron walks `auto` records and has never read `crewjobs` at all. So
every standing job on the screen was a switch attached to nothing: it looked on,
it reported on, and no work was ever scheduled anywhere. Nothing failed, because
nothing ran. Before adding to a catalogue, follow ONE entry all the way to the
thing that executes it; a feature can be complete at every layer except the join
between them, and the join is the only part with no UI to notice.

## 72. Declaring a requirement is not checking one
Every preset carried a `needs` field - 'Email', 'Bank connection' - rendered
under each card as "Uses: ...". Nothing ever read it. Switching on a job needing
a mailbox that was never connected produced an active-looking card that could
not work. Displaying a requirement and enforcing it look identical in a
screenshot and are opposite in behaviour.

## 73. The runner's powers decide what a catalogue may promise
The server runner can search the web and write. The Gmail and Calendar tokens
live in the browser tab and the server never sees them, so a job needing a
mailbox genuinely cannot run with AMV closed - and half the catalogue needed
one. Presenting both kinds as the same "background job" promised something the
architecture cannot do. They are now two honest states: web-research jobs create
a real server automation, tab-bound ones go on the local schedule and say they
need AMV open. Write down what the executor can actually reach BEFORE writing
the copy that sells it.

## 74. A test that recognises only one code path fails on the other one working
`i18n-coverage` measured translation by counting strings carrying the mock's
"ES " prefix, which only the MODEL route adds. The instant dictionary route -
the common chrome, Connect, All, Run - correctly translated strings without it,
so the dictionary working counted as English. Adding fifty Connect buttons to
one screen pushed the ratio past the threshold and the gate reported an i18n
regression for a screen that translates fine. The honest measure was already in
the DOM: `_i18nSrc` is the original the replacement remembered, so a node
carrying one that differs from what is on screen has been translated by
whichever route did it. Measure the OUTCOME, not the signature of one
implementation of it.

## 75. Sweep for state that is written and never read
Grepping every `store`/`saveStr`/`setItem` key against every `load`/`loadStr`/
`getItem` took one command and found three real defects, because a write with no
reader throws nothing and runs fine forever. Every conversation save wrote a
second FULL copy - attachments included - to `amv_convs`, which no code path
reads, while the real per-account save deliberately slims attachments and keeps
the last 40 messages to fit the quota; the copy nobody could read was the only
one ignoring the budget. A team invite clicked before Teams was available was
stored for later and never picked up, so the link was spent and the person
joined nothing. Run this sweep periodically - the same query also catches the
opposite shape, a setting read from a key nothing ever writes.

## 76. A security control that reports success and does nothing
`linkList` and `linkRevoke` were complete, careful server endpoints - revoke
deactivates the link on BOTH sides and checks the caller is one of them - and no
client code had ever called either. The screen instead read the LOCAL store, so
a second device showed nobody with access at all; and "Remove" wrote
`active:false` into localStorage, told the server nothing, and said "that access
stopped immediately". The server is what authorises a linked account, so access
continued. This is worse than having no button: a missing control makes you go
and check, a lying one talks you out of it. Any control over who can reach an
account must go to the authority that enforces it FIRST, and say nothing until
that call returned.

## 77. Two bugs hid behind the same reflex
Fixing the above, both mistakes I have made before came back at once. Nulling
the cached list before re-rendering made the redraw fire a fresh request whose
late reply redrew again and wiped the confirmation off the screen. And recording
the failed fetch without re-rendering left the pane showing its empty local
fallback, which reads as "nobody has access" - reassurance built on a request
that failed. Update a cache in place when you already know the new value, and
set state AND redraw on the failure path, not just the success one.

## 78. "Is the state still null" is not "is a request already running"
Adding a second independent fetch to the family pane made both of them
self-multiply. Each reply re-renders, and on that render the OTHER request was
still in flight with its state still null, so the guard re-issued it - one call
became three. It converges, so nothing hangs and nothing looks wrong; the only
symptom is extra requests. A guard on the RESULT is not a guard on the REQUEST.
Track in-flight separately whenever a render can be triggered by something other
than the fetch it owns. The test caught it only because it counted calls - and
then had to be sharpened to count per endpoint, because a total cannot tell two
different fetches from one fetch happening twice.

## 79. Erasure is where a miss is invisible
Deleting an account left behind a live bank access token, the record of somebody's
real balances, grants letting other accounts act, and a spend cap that would have
gone on applying to children with nobody left able to lift it. It also never
cancelled the Stripe subscription - the card kept being charged monthly for an
account that no longer existed, and because the customer reverse-map WAS deleted,
the webhook for those charges could no longer resolve to anybody. API keys kept
authenticating. Public shared conversations stayed on the internet. A team kept
its paid plan with nobody paying for it. Nothing surfaces any of this, because
the account is gone from every screen. Erasure needs a list derived from what is
WRITTEN, not from memory - and it has to reach outside the worker, to the payment
processor and the data aggregator, or it is not erasure.

## 80. Replacing a list with the server's rows deletes everything the server does not know
`_crewSyncLive` rebuilt the Crew catalogue from the rows the backend returns. The
backend stores a row only for jobs that have ever been switched on, so the first
sync collapsed seventy-odd jobs to the handful the user had touched - and dropped
every field the mapping did not name, including each job's category, its actual
instruction, and the id of the automation it had created. Definitions are the
source of truth for what a thing IS; the server is the source of truth for its
STATE. Merge state onto definitions, never the reverse.

## 81. A shared device shares more than the screen
The nickname AMV calls you, what you do, and your custom instructions were stored
device-wide, and all three go into the system prompt. On a family laptop the
second account to sign in was greeted by the first person's name, assumed to do
their job, and answered according to their instructions. Custom instructions are
where people write the thing they would not say twice. Before making a key
global, ask whether two accounts on one machine should see the same value - and
if the answer is no, re-scoping alone is not enough, because it makes existing
data appear to vanish; it needs a migration that moves it.

## 82. The gate that mattered was on the side that could be cleared
`24-compliance.js` carries a careful essay on why age matters - under-13 is
strict liability, a minor cannot form a binding contract, which is exactly why
their purchases return as chargebacks - and then implements the gate entirely in
localStorage. The word "age" did not appear anywhere in the worker except in a
cache header. So the protection the file claimed to provide existed only where
it could not be enforced: clear one key, or call the API with a key at all, and
it was gone. It is now recorded server-side and checked where money moves.

Adding it broke four suites and would have broken every existing customer, none
of whom has ever been asked - which is the other half of the lesson. A new
precondition on an existing money path needs the question asked at the point it
is needed, not a wall and a settings pane nobody had a reason to open. "Not
asked" and "too young" are different answers and need different codes.

## 83. An agent run is priced by its cheapest step, not its hardest
Crew ran the plan, every step, and the delivery on whichever engine the model
dropdown was set to. So "pull the three numbers out of this" was billed at the
price of the hardest thing the product can do, multiplied by the number of
steps. Route by what the work IS: machinery (routing, titles, summaries,
extraction, translation) on the cheapest engine, one bounded piece of real work
in the middle, and planning plus the final review - where the whole run's
quality is actually decided - on the best one the account can reach.

## 84. A cheap model is not worse at everything, it is worse at catching itself
Which is fixable for far less than the price difference. A specific instruction
helps a small engine more than a large one; one focused self-check pass on the
SAME engine catches most of what is left, at a fraction of a premium call; and
the rest - refusals, placeholders, truncation, JSON that is not JSON - is
detectable with no model at all. Only THAT is worth escalating a tier for, once,
never in a chain. The floor is set by validation rather than by price.

## 85. Two of my own bugs in the validator that checks for bugs
`\b(...)\b` around an alternation whose branches begin with `[` or `<` can never
match, so every bracketed placeholder pattern - the most common shape there is -
was silently dead. And `xxx+` matched redactions, hashes and ordinary prose. The
test that caught it then failed for its own reason: it anchored on
`indexOf('async function runAutonomous')`, which finds `runAutonomousTask`
first. A prefix is not an anchor.

## 86. The most complete feature in the file had never run
17-jobhunt.js has a decision engine, a two-lane batch planner, a channel
detector, a daily report builder and a setup modal that collects somebody's
resume, contact details and work authorisation. Nothing anywhere calls run(),
planBatch() or dailyReport(), and run() itself returned {ok:true, staged:true}
having done no search, no draft and no send. It was the FIRST card in the Crew
catalogue and promised to apply to jobs and email a morning report.

ok:true on a no-op is the worst answer available, because every caller reads it
as "it ran". Completeness of the parts says nothing about whether the whole is
reachable - and the more finished the parts look, the less anybody checks.

## 87. "First match" is not a selector
A test picked its subject with `find(x => /Email/.test(x.needs) && x.prompt)`.
Giving job_hunt a prompt silently moved the test onto it - and job_hunt is the
one job whose toggle opens a setup modal instead of scheduling, so the test
failed for a reason that had nothing to do with the change. Pick the subject
deterministically, or exclude the special case by name and say why.

## 88. A security screen that renders security events as ordinary rows
28-activity.js opens by explaining why it exists: the old screen showed one
hardcoded "Active now" row, so somebody whose password had leaked would have
been reassured by a picture. It then labelled 7 of the 16 event kinds the worker
records. The 9 unlabelled ones fell through to a fallback that renders the raw
word untoned - and they included a bank account being linked, an API key being
created, and the account joining a family. That is the exact list of what an
attacker does after taking an account: connect to the money, mint a credential
that survives a password change, attach the account to something they control.
A lookup table with a graceful fallback hides its own gaps, so the gap needs a
test: every kind the server can record must have a label.

## 89. Raw localStorage is an unscoped write
`store`/`load`/`saveStr`/`loadStr` route through `_scopeKey`, which files a value
under the signed-in account. `localStorage.setItem` does not, and three places
used it directly: the scheduled-jobs list, "Pause all autonomous", and the
per-section model choice. All three were therefore shared by every account on
the device.

The scheduled-jobs one is the serious case. Signing in as somebody else showed
their jobs - goal text carries whatever personal detail the task involved - and
`_runDueAuto` then EXECUTED them under whoever happened to be signed in,
spending their quota on another person's work. The autonomy pause is the
sharpest: a safety control that another account can toggle for you, and resume
again, is not a safety control.

Nothing about the calls looks wrong at the call site; they are ordinary and they
work. Grep for raw localStorage whenever a scoping helper exists, because the
helper only helps where it is used.

## 90. A migration that only runs at sign-in never runs for anyone signed in
Re-scoping the profile keys was correct, and the migration that moved existing
values into the account was correct, and it was called from loginUser() - which
a returning user never reaches. The session is restored straight from storage at
boot. So every existing user would have loaded to an empty profile, no custom
instructions, no scheduled jobs and no autonomy pause, with all of it still on
disk under the old key and nothing looking there.

The failing test that exposed it was failing for a different reason entirely (a
fixture writing the raw key), which is the part worth remembering: the gate did
not tell me about this. It told me something near it was wrong, and the bug was
found by asking why rather than by making the assertion pass. Ask where the code
path STARTS for the people who already exist, not only for the ones created
after the change.
