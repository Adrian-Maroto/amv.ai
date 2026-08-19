# Design audit: what was done, what was wrong, what needs a decision

The bundle (78 findings, overall 5.3/10, verdict "NOT READY TO LAUNCH AS A
POLISHED PRODUCT") is dated 2026-08-16. Every finding below was checked against
the CURRENT build before anything was changed, because the audit predates a
fortnight of CSS and markup work and several of its findings had already been
overtaken.

**Treat the bundle as a lead list, not a task list.** Nine of the findings acted
on so far did not reproduce, including both launch blockers.

## Closed

**AMV-D001 (P0) - did not reproduce.** The audit reports the app shell and the
landing rendering on top of each other on first load. At 1280, 768 and 390 the
landing is `display:none` and the app is the only visible layer. The CSS defect
it names is real - `#app` is re-declared with `display:flex` at two later points,
one of them `!important` - but nothing collides, because the landing is hidden
by script.

**AMV-D002 (P0) - did not reproduce.** Crew cards do not collapse. 93 cards
render at 189px on desktop and 208px on a phone, the scroll region is 742px
rather than 33,113px, and the only children under 60px wide are the 42px icons,
which are that size on purpose.

**AMV-D003 / AMV-D015 - resolved by decision.** Both concern the first-run
funnel. The owner's answer is that a visitor goes straight into chat and signs
up at the first send. Acting on that found the landing page and the entire
five-step tour were UNREACHABLE: `showIntro()` and `goLand()` had zero callers
and every boot branch hid both. The tour is removed - 88 lines of markup, ~100
of script, 15 of CSS that every visitor downloaded and nobody saw.

The landing markup is deliberately KEPT and hidden. Visitors never see it, but
it carries the `h1`, the product description and the pricing copy, and it is the
only content a search engine can read on the page.

**AMV-D035 / AMV-D036 - did not reproduce.** Zero controls anywhere in the
product lack an accessible name, on desktop or phone, across eight tabs.

**AMV-D037 / AMV-D038 - real, fixed, plus four the audit missed.** Six colour
pairs were below WCAG 2.1 AA. `--dim` measured 3.14:1 on the dark background and
2.47:1 in light. `--on-accent` was white in both themes and cannot be one
colour. A new `--accent-tx` covers accent text on dark. Both themes now measure
clean, guarded by `tests/e2e/text-somebody-can-read`.

**AMV-D039 - real, fixed.** The image style and ratio chips were 20px tall,
under WCAG 2.5.8's 24x24.

**AMV-D040 - measured against the wrong standard.** The audit reports a 32px
mobile floor against a 44px target. 44x44 is WCAG 2.5.5, which is AAA, and
Apple's interface guidance. Against the AA rule that applies, mobile has ZERO
controls under 24px. Raising 41 mobile controls to 44px would reflow most of the
phone layout to clear a bar this product is not held to. Left as a comfort
improvement for a deliberate decision, not done quietly as a correctness fix.

**AMV-D045 - real, fixed.** 67 `transition: all` declarations, each now naming
the properties it meant. Three more were hiding in inline styles inside JS
templates.

**AMV-D060 - did not reproduce.** The smallest copy in the auth modal is 13px.

**AMV-D071 - already fixed.** The profile menu already separates destructive
actions with a divider, colours them with `.danger`, labels them "Permanent.
Cannot be undone", and Delete Account already requires typing DELETE.

**Found while verifying, not in the audit:** one text field (`#hist-search`) was
12.5px on mobile. Safari on iOS zooms the whole page when a field under 16px is
focused and does not zoom back. Fixed and guarded.

## Low-effort batch, done 2026-08-19

The owner's ordering: every low-effort finding first, then the structural ones.
Nine were in scope. Seven changed the product, two did not reproduce as stated.
All of it is guarded by `tests/e2e/a-screen-explains-itself` (47 checks, each
sabotage-tested) and by two new sections in `tests/e2e/firstrun`.

**AMV-D021 - real in the only way it can be, fixed.** The proof strip put `<b>`
against `<span>` with no source whitespace, so `textContent` produced
"Delegatewhole jobs" and "$0to start". The audit also asked for real component
styling, and that half is deliberately NOT done: `#land` is `display:none` on
every boot path (nothing anywhere removes the class), so the block never paints
and its only reader is a crawler or a text extractor, both of which take
`textContent`. Four spaces fix what that reader sees. Thirty lines of CSS for a
block that never renders would add weight to every visitor's download to
improve a screen nobody looks at.

**AMV-D022 - half real, fixed.** The first-run card measured 310px of a 1440x900
desktop (34%), 310px of a 1366x768 laptop (40%) and 371px of a 390x844 phone
(44%). The audit's other claim, that the composer needs scrolling to reach, did
NOT reproduce at any of the three. Same three starting points, laid out as pills
instead of stacked title-and-paragraph blocks: 16% desktop, 18.8% laptop, 27.3%
phone. The phone misses the audit's 20% and is recorded at 27% rather than
massaged - three labels that each read as a sentence cannot fit two to a row at
358px, so the only routes to 20% there are cutting a starting point or
truncating the labels, which is shrinking the product to make a number go green.
The descriptions are not deleted; each pill carries its full description as its
accessible name and its hover title.

**AMV-D024 - real, fixed.** "Pause all autonomous" was the loudest control in
the Crew header on every account including one that has never run anything - an
emergency brake for a machine nobody started. It now appears when work is
running, "Resume autonomy" appears whenever autonomy is paused whether or not a
job is listed, and an idle account is offered the way in instead.

**AMV-D028 - did not reproduce.** The audit describes a utility rail of small
line icons for memory, tasks, integrations, team and marketplace. Measured
across every control in the sidebar, exactly ONE has no visible text label
(`.hidots`, the per-chat overflow menu) and it carries `aria-label="Options"`.
Every destination the finding names is a labelled item.

**AMV-D034 - real, fixed.** The model picker labelled its options by what they
cost rather than what they produce. They now describe the outcome, and the dead
`_modelCostLabel` (zero callers) went with it.

**AMV-D056 - real, fixed.** Twenty questions in one flat accordion, reachable
only by already knowing the word to search for. They are grouped under eight
headings, each group is a filter chip, and search runs across every answer
independently of the chip so the two routes compose rather than fight. A group
whose questions are all filtered out hides its heading too. Six questions are
visible without scrolling, against the audit's bar of five. The finding's second
half - contextual "Get help" links from relevant screens - is NOT done here; it
touches every render function and belongs with the screen-level batch.

**AMV-D058 - not applicable as written.** The finding is that the landing hero
paragraph runs to an uncomfortable measure at desktop widths. It has no measure
because it has no CSS: `.hero-rd-sub`, `.hero-rd-eyebrow`, `.hero-rd-row`,
`.hero-rd-strip` and `.hero-rd-stat` have no rules anywhere, and the block they
are in is never painted. Constraining the line length of invisible text is
styling for a screenshot rather than for a person. The copy itself is the page's
only machine-readable product description and is good as it stands.

**AMV-D059 - one third real, fixed.** Measured first: at 1440x900 the banner is
69px (7.7% of the viewport) and at 390x844 it is 142px (16.9%), and at neither
size does it overlap the composer - "dominates the first fold" did not
reproduce. What did reproduce is the weighting: Manage, Essential only and
Accept all were all `.btn`, and `.cc-actions .btn{flex:1}` gave a tertiary link
to a settings pane a third of a phone's row. Manage is a text link now (still a
`<button>`, so keyboard and screen-reader behaviour are untouched), the notice
is one sentence instead of two, and the phone banner came down to 124px (14.6%).

**AMV-D070 - real, fixed.** Of eleven tabs measured, Images and Video were the
only two with no visible `h1` or `h2` at all - both opened straight onto a form.
Both now carry a compact page header with an outcome-focused title. It is a new
SHARED component, `.pghd`, not a fourth bespoke one: Crew, Marketplace and the
centred `.vi` block each have their own version of this header, which is the
duplication AMV-D013 names, and adding another would have made that worse to
fix. Video's card-level "AI Video Generator" `h3` is gone rather than moved -
the audit's specific ask was to stop repeating the location label in every piece
of chrome.

**AMV-D033 - real, fixed, and it was hiding a dead button.** Held back at first
because AMV-D007 rewrites this surface; the owner asked for the small findings
cleared before any large one, so it is done.

Measured first: on the EMPTY Lab screen there were two Run controls visible at
once ("Run" in the toolbar, "Run it" in the entry row) and two fix controls
("Auto-Debug", "Find & fix the bugs"). With code loaded there was exactly one of
each, so the duplication was confined to the entry state. One thing the audit
predicted did NOT hold: the two Run buttons have the same scope. The paste box
syncs into the editor, so the toolbar Run really does run what you pasted -
checked by pasting code and pressing it.

The toolbar's code actions are now hidden while the entry screen is up. They act
on an editor that is empty by definition in that state, and the audit asks for
the one surviving action to sit beside the input. Upload and New stay, because
those are how code gets in. Everything returns the moment there is code. The
eight entry buttons are split into the two people came for and the six analyses.

**And the button did not work.** Pasting code and pressing "Run it" did nothing:
the code appeared in the editor, the entry screen closed, no run started,
nothing threw. `labLoad` ends with `setBlank()`, `.lab-entry` only renders while
`lab-blank` is set, and blur fires before click - so pressing any entry action
blurred the paste box, which loaded the code, which hid the entry screen and
pulled the button out from under the pointer between mousedown and mouseup.
Every one of the eight entry buttons was dead whenever the paste box had focus,
which is precisely the state somebody is in the instant after pasting. It is
pre-existing, not a regression: verified by checking out the previous commit and
reproducing it there.

Taking the paste on blur is kept - it is what stops the text being lost when
somebody clicks Upload instead - but it no longer leaves the entry screen.
Guarded by `tests/e2e/a-screen-explains-itself`, which now runs the real path:
paste, click, and assert the pasted code's own output comes back.

## Owner decisions, recorded 2026-08-18

Asked for all 65 remaining findings, answered in blocks.

**REFUSED - not to be done.**
- **AMV-D008** merge Crew, Handoff and Tasks into one Automate surface. The
  owner does not want these merged. The three stay separate concepts. Anything
  below that assumes a merged Automate is void.

**DEFERRED - the owner has questions and will decide later. Do not start these.**
- **AMV-D005** the information architecture exposes too many peer-level products.
- **AMV-D012** there is no global operational home for active work.

**AMV-D057 was deferred and is now APPROVED** after the question was answered:
three catalogues split adjacent things by how they are built rather than what
they do, so somebody looking for a service cannot tell which to search. One
Connections area for external accounts, one Marketplace for installable things,
and Apps dropped unless it is a genuinely distinct runtime surface.

**APPROVED - everything else, 61 findings.** Including the large ones:
AMV-D007 (merge Studio, Dev and Lab into one Build surface), AMV-D009 (reduce 18
user settings panes and 5 owner panes), AMV-D013/D014 (cascade ownership and
token adoption), AMV-D041 to D044 (type, radius and colour token migrations).

**Standing instruction on pace and order.** The owner's words: do not "take like
3 mins for each - for the ones that take a long time, weeks even, take your
time", and "there can be no mistakes on the big ones, it is huge edits".

Order: **every low-effort finding first, then the structural ones.** The large
items get a written plan, real design work, and verification on the surface a
person actually uses, with nothing rushed to reach a count.

One consequence to respect while working small-first: D007 subsumes D031, D032
and D033, and D009 subsumes D067 and D068. D033 (Lab's duplicate Run action) is
LOW effort and would normally be in the first batch - it is deliberately held
back, because merging Lab into Build rewrites that surface and fixing it now is
work thrown away twice.

**On my call.** D041/D042 (type scale), D064 (global library) and D065 (bulk
actions) were left to my judgement. They are approved and will be done, but
incrementally with before-and-after comparison rather than as a find-and-replace
- 187 rules use 13px against a 13.5px token, so a bulk pass shifts type on every
screen while reporting itself as consistency.

## Real, and needs a deliberate decision rather than a quiet change

These are not defects with a right answer. Each changes what the product IS.

**AMV-D041 - 69% of visible text on the chat surface is 12px or smaller**, with
19 elements at 11px. That is a real measurement and a real readability cost. It
is also the product's entire visual density: raising it changes every screen.

**AMV-D042 / D043 / D044 - 72 distinct font sizes, 51 distinct border radii,
hardcoded colour and stacking values.** The token scale exists and is partly
adopted. Migrating is mechanical but NOT invisible: 187 rules use `13px` and the
nearest token is 13.5px, so a bulk migration shifts type across the whole
product. Worth doing deliberately, screen by screen, with before-and-after
comparison - not as a find-and-replace.

**AMV-D004 to D012, D016 to D020, D046 to D057, D061 to D078** are product and
information-architecture questions: rebuild navigation around user jobs, merge
Studio/Dev/Lab into one Build surface, merge Crew/Handoff/Tasks into one
Automate surface, reduce 18 settings panes, create a global work Home, rework
plan comparison, marketplace trust hierarchy, and so on.

Every one of these is either a major visual redesign or the removal of
functionality. Both need the owner's explicit decision first, one at a time.
