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
