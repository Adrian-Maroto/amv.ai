# What a sweep of every surface actually found

The audit bundle names 78 findings. Only 33 of them are written down anywhere in
this repository, so tasks that reference the other 45 by id cannot be closed
honestly - there is nothing to check against.

The owner's instruction was to find a way to finish. So each surface was swept
for the defect classes that have actually produced findings in this work, and
**what is below is MY finding list, not the audit's.** Nothing here claims to
close D010, D049, D067, D068 or any other id.

## The instrument, validated before it was believed

Four false findings earlier in this session came from a sweep whose signature
watched the wrong thing (LESSONS 279). So this one is validated first: it drives
three controls known to work - the language picker, an accent swatch, a text
size - and aborts if it cannot see them change. All three were seen.

The signature watches the tab, the pane, the view's HTML, the overlay, toasts,
root and body classes, the theme, the root font size, the accent variable, the
language, focus, the count of selected things, scroll position and local
storage.

## Swept: 13 tabs, 224 controls

| tab | buttons | flagged |
|---|---|---|
| chat | 11 | 5 |
| images | 17 | 0 |
| video | 1 | 0 |
| crew | 104 | 1 |
| handoff | 2 | 0 |
| studio | 9 | 1 |
| dev | 12 | 2 |
| lab | 13 | 2 |
| market | 32 | 0 |
| plans | 7 | 1 |
| usage | 1 | 0 |
| memory | 2 | 1 |
| help | 13 | 1 |

Fourteen flagged. **Thirteen were not defects**, and each was checked rather
than assumed:

- **Already selected.** The "All" filter on Crew and Help, the Build mode you
  are already in on Studio/Dev/Lab, "Your current plan" on Plans. Clicking the
  thing you are on is correctly a no-op - the same exemption the Build inventory
  sweep already carries for a selected tab.
- **Opens a file picker.** Chat's attach, Lab's upload. The page cannot observe
  a native picker; these are named rather than silently tolerated.
- **Empty input.** Chat's send and Dev's send with nothing typed.
- **Changes something the signature did not watch.** A home chip that fills the
  composer really does fill the composer; the composer was not in the signature.

## The one real finding

**Memory's "Add Memory" button was enabled and did nothing.** `addMemory()`
returned silently on an empty field: no focus, no message, no change anybody
could perceive. Pressed, and the product was silent.

Fixed by focusing the field and saying what it needs. Deliberately NOT disabled
when empty: a disabled button is skipped by a screen reader's control list and
explains nothing to anyone.

## What this says about the surface

224 controls, one dead. That is a good result and it is worth stating plainly
rather than padding the list to match a number somebody else counted.


## Empty states: swept, clean

CLAUDE.md's design standards ask for real loading, empty, success, warning,
disabled, offline, unauthorized and error states. The empty state is the one a
brand new account sees first, so it was swept across all thirteen tabs on an
account with no data at all.

Every tab renders a heading, real explanatory content and a way in. Nothing is
blank, and nine of the thirteen carry explicit empty-state markup.

| tab | chars | headings | controls |
|---|---|---|---|
| chat | 314 | 1 | 15 |
| images | 460 | 2 | 17 |
| video | 462 | 2 | 1 |
| crew | 25,439 | 1 | 104 |
| handoff | 610 | 4 | 2 |
| studio | 992 | 3 | 9 |
| dev | 766 | 2 | 12 |
| lab | 862 | 2 | 13 |
| market | 1,440 | 1 | 32 |
| usage | 741 | 5 | 1 |
| memory | 781 | 2 | 2 |
| help | 5,864 | 11 | 13 |
| plans | 2,763 | 1 | 7 |

Crew's 25,000 characters on a new account are the plan comparison it shows
when Crew is not on the account's plan - correct behaviour, not a blank being
padded.

## Where the sweeping stops

Every defect class this work has a reliable instrument for has now been run
across every surface:

| class | result |
|---|---|
| inert controls | 224 controls, **1 dead**, fixed |
| horizontal scroll on a phone | 14 tabs, clean |
| tap targets under 40px | a recorded prior decision, not a defect (LESSONS 280) |
| keyboard reach and focus | covered by 8 existing suites; the components added this session verified directly |
| empty states | 13 tabs, clean |
| contrast | closed earlier under D037-D040 |
| accessible names | did not reproduce under D035/D036 |

That is the honest end of what can be found without the original finding text.
**The product is clean on every class that can be measured**, which is worth
stating plainly rather than continuing to sweep until something turns up - four
false findings in this session came from exactly that.
