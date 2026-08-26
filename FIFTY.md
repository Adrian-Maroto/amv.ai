# The overnight run: what was asked, what was found, what was done

You asked for fifty beneficial edits that do not need your approval, done
continuously overnight, all green, nothing left queued.

This file is the honest version of that. It is written to be read first.

---

## The number

**Nine real fixes are in, verified and merged. Not fifty.**

I could have reached fifty. Doing so would have meant keeping findings I could
not defend, and two of my first ten were already wrong - which is the whole
reason the number is what it is rather than what you asked for.

What went wrong is worth more to you than a longer list:

I wrote a scanner that finds functions defined and called by nobody. It has
been the best tool I have. It stripped block comments before counting, and this
codebase is full of regexes and URLs inside strings, so one stray sequence
opened a fake comment that swallowed real code. Two findings came out of it and
both were false:

- *"Sign out everywhere renders nowhere while the Security pane names it."* It
  renders in Settings, Account, and always did.
- *"No dialog traps focus, Escape closes only six."* Both were already handled
  globally, forty lines below where I added them again. The file's own comment
  says "There is a Tab trap." I had not read it.

I shipped both as fixes. The first put a second element on the page sharing an
id with the real one. The second duplicated a working handler. **Sabotage caught
both and nothing else would have** - the focus test passed happily with my trap
disabled, because the real trap underneath was doing the work.

The scanner now has a negative control it must pass before I believe anything
it says, and it counts raw occurrences: a mention in prose inflates a count,
which sends me to look by hand. Under-reporting dead code costs nothing.
Over-reporting it deletes working features.

## What is actually in

Each one a direct fact about the source or a behaviour I drove and watched
fail, never an inference from a tool.

1. **A half-written message no longer dies with the tab.** Measured before:
   type 492 characters, refresh, 492 characters gone. That is the most valuable
   text in the product at the moment it is lost, and on a phone the browser
   evicts background tabs routinely. Now persisted per conversation, debounced,
   capped, pruned, and re-keyed onto the fresh chat a reload lands you in.
2. **Eleven icon-only buttons** announced themselves as "button" to a screen
   reader - the close control on nine dialogs, a delete, a help.
3. **Ten selects and range inputs** sat beside labels that were siblings rather
   than associated, so the visible text named nothing.
4. **Six colour pickers** were not merely unnamed but indistinguishable from
   each other; the control inventory had been counting them as one.
5. **Three dialogs** declared a role and no modality.
6. **A skip link**, so reaching the conversation does not mean tabbing the whole
   shell on every page.
7. **Ten destructive actions** used the browser's own confirm - leaving a team,
   delisting from the marketplace, pausing the service for every user. They now
   use the product's own dialog and say what is actually lost.
8. **`_mcCancelSched` swallowed a failed write** and reported success, so a job
   that could not be cancelled told somebody it was.
9. **The Google access token left localStorage** - a live bearer token to
   somebody's mail, readable by any script and outliving the tab.

## What the gate caught in my own work

Eight defects, in one night, all mine, none found by me reading it back:

- the skip link failed WCAG contrast at 1.1:1 - the one control added FOR
  accessibility was the least readable text in the product
- the same link failed the keyboard sweep, sliding in 140ms late
- a duplicate function, committed while reading the duplication checker's output
- a test seeding a store the code no longer reads
- two storage-registry facts about my own changes
- an unbounded outbound call on the disconnect route
- a durable record neither backed up nor excluded
- a public endpoint with no rate limit

## Left for you, deliberately

**The unreachable functions - DONE.** There were 27; the Google migration and
the media removal accounted for most of them, and the last nine were dealt with
one at a time rather than as a batch, because "unreachable" and "dead" are
different claims (LESSONS 296).

Four were removed as residue of something already gone: `_langForGeneration`
(instructed image and video generators that no longer exist), and the
`_BUILD_MODEL` family - a second store for the per-section model preference
whose pickers were deleted, sitting beside the live one. Two stores for one
preference is how they drift; `_autoMaxLabel` went too, being the sentence form
of a number the plan table deliberately prints bare.

One was WIRED, not removed. `handleSheetFile` is the only way into the
spreadsheet editor - a CSV parsed into a real table with an AI toolbar and a
download - and no file input in the product accepted a spreadsheet, so the whole
feature was unreachable while its tests passed about it. It now has a door on
the chat attachment chip, alongside attaching rather than instead of it.

Four remain and are declared, with reasons, in
`tests/e2e/every-entry-point-has-a-door`: `_pkceConsume` (the consume half of a
pair whose start half is live), `runAgentic` and `qDecompose` (engines other
code calls into), and `amvOpenFile` (a bridge called from outside the page).

**Connected accounts need three secrets** before any of it does anything:
`CONNECT_KEY`, then `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Until they
exist, providers read as "not set up on this deployment" rather than opening a
flow that fails.

**`AMV_KV` is still the placeholder**, so nothing deploys.
