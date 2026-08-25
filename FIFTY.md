# Fifty edits, found and worked overnight

Rules I set for this list, so it is worth what it claims:

- **Nothing on it needs approval.** No schema change, no auth change, no billing
  change, no deleted feature, no visual redesign. Every item is a defect, a
  broken promise, an accessibility gap, or a safety or clarity fix.
- **Every item was verified before it went on the list**, not guessed from a
  smell. Where a scan suggested something and the code disproved it, it was
  dropped rather than padded in. Two candidates were dropped exactly that way:
  `_spendRecord` looked like an uncounted spend ceiling and its own comment
  explains it is a deliberate leftover beside a live reserve/release path, and
  the worker's other unreferenced helpers are one-line wrappers, not features.
- **Value, not tidiness.** The largest group is things the product ADVERTISES
  and cannot actually do, because that is what a customer meets.

Status is kept honest: an item is only ticked when it is done, tested, and the
test has been sabotaged to prove it would fail if the fix were removed.

---

## A. Advertised, built, and unreachable (the broken promises)

Found by counting references in the built bundle: a function that appears
exactly once appears only in its own definition. Nothing reaches it - not a
call, not a `window.` export, not a `data-dact` string.

1. **Excel & CSV upload does nothing.** Integrations advertises "Upload a sheet
   - AMV runs formulas, builds pivots and charts, then you download." The
   handler `handleSheetFile` is unreachable, as is the editor it opens.
2. **The Word document editor is unreachable.** `openDocEditor` and its
   download path exist and nothing opens them.
3. **`quickGmail` is unreachable.** A one-click inbox read, fully written.
4. **`quickCalendar` is unreachable.**
5. **`quickDrive` is unreachable.**
6. **`_modelPickerHTML` is unreachable** - a whole engine picker component.
7. **`_activeSessionsHTML` is unreachable.** Somebody cannot see the devices
   signed in to their account, which is a security surface, not a nicety.
8. **`_crewSyncLive` is unreachable** - the multi-device sync for Crew jobs.
9. **`_handoffSyncLive` is unreachable** - the same for handoffs.
10. **`_planDetails` and `_planHighlights` are unreachable** - pricing detail on
    the page whose entire job is converting somebody.
11. **`_payActivate`, `goToStripeSettings`, `_pmLabel`, `_cardBrand` are
    unreachable** - billing surface.
12. **`_cehCard`, `_starterCard`, `_starterChip`, `_chomeRecentWork` are
    unreachable** - chat home components.
13. **`_mcAutonCard` and `_crewQueueHTML` are unreachable** - Mission Control.
14. **`filterTaskCat`, `showMsg`, `closeTab`, `_pageReset` are unreachable.**
15. **`connectGoogle` is unreachable**, duplicated by the Integrations path.

Each of these gets one of two honest outcomes: wired up where the product
promises it, or removed where it is a leftover - and removing unreachable code
takes weight off a 605KB page every visitor downloads.

## B. Accessibility, which is both reach and legal exposure

16. Twelve icon-only buttons carry no accessible name - close buttons, delete
    buttons, a help button. A screen reader announces "button".
17. Three `role="dialog"` elements have no `aria-modal`.
18. Five `<select>` controls have no accessible name.
19. Modals do not trap focus; tab walks out of a dialog into the page behind it.
20. There is no skip-to-content link.
21. The engine picker's options are not announced when the plan disables one.

## C. Destructive actions

22. Seven destructive actions use the browser's native `confirm()` - leaving a
    team, removing a member, deleting a task, delisting from the marketplace.
    It blocks the page, cannot be styled, reads as browser spam on a phone, and
    the product already has `showConfirmAsync` for exactly this.

## D. Honesty and error recovery

23. Errors that name a cause but not a fix.
24. An offline state that says what still works.
25. States audited on the surfaces that lack them.

## E. Weight and speed

26. The page is 2.1MB, 605KB over the wire. Dead code removal from A pays into
    this directly.

## F. Tests for the paths that carry money and trust

27. Sabotage-proof coverage for each fix above.

(The remaining items are enumerated as they are verified, so the list stays
honest rather than padded to a round number in advance.)
