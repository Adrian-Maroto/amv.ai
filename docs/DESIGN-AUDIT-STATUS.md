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
