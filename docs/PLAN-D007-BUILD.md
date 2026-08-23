# AMV-D007 - one Build surface, made out of Studio, Dev and Lab

Status: **plan only. Nothing is changed yet.** The owner approved the finding and
asked explicitly that the large ones take the time they need and carry no
mistakes. This is the written spec that has to be right before any code moves.

## What exists today, measured rather than remembered

Three sidebar destinations, already grouped under a collapsible "Build" heading
(`_BUILD_TABS = ['studio','dev','lab']`, `src/app/03-sessions.js:782`). Each has
its own render function, its own state object, and its own copy of five or six
controls that do the same job.

| | Studio | Dev | Lab |
|---|---|---|---|
| Renders | `renderDesignView` (`11-design-code.js:4`) | `renderCodeView` (`11-design-code.js:663`) | `renderLabView` (`14-engine.js:481`) |
| State | `_STUDIO` | `_DEV` | `_LAB` |
| Starts from | a description | a description | code you already have |
| Produces | one HTML artifact | a file tree | an answer about the code |
| Model picker | none | `_sectionModelSelect('code','dev-model')` | `_sectionModelSelect('debug','lab-model')` |
| Bring code in | no | `dev-add` menu: files / folder / connect | `lab-upload-top`, `lab-drop`, paste |
| Run | preview iframe only | preview iframe | `_labRun` plus a `Run it` entry button (AMV-D033) |
| Deploy | no | `_devDeploy` | `_labDeploy` |
| Take it away | `_studioExportProject` | `_devDownloadProject` | no |
| New session | no | `_sessNew('dev')` | `lab-new` |

The seam is already cut and already used: Dev's `dev-tolab` button copies the
active file into `_LAB_HANDOFF` and calls `setTab('lab')`
(`11-design-code.js:758`), and Lab picks it up on its next render
(`14-engine.js:483`). That handoff exists because the split is artificial - the
product already knows these are one job.

**They are split by how the thing is built, not by what the person wants.**
Somebody who wants a landing page can get one from Studio (as an HTML artifact)
or from Dev (as a project). Nothing on either screen tells them which. That is
the finding.

## What the merged surface is

**One destination, `build`.** One shell: a conversation on the left, a result on
the right. What changes between the three of today is what the result pane shows
and which actions the toolbar offers - and both follow from what the person
brought in, not from a tab they had to pick first.

Three entry states, one screen:

1. **Describe something.** The composer, with starting points. This is Studio's
   hero and Dev's hero, which are already the same screen written twice.
2. **Bring code in.** Paste, upload files, upload a folder, connect a folder.
   This is Lab's entry card and Dev's add menu, which are already the same
   controls written twice.
3. **Come back to something.** The session list, which today is per-tool.

The result pane has the tabs the work needs: **Preview**, **Code**, **Findings**.
Findings is Lab's output pane; it appears when there is something to report and
not before. Preview is the iframe all three already have.

Design DNA stays and applies to everything the surface produces, which is what
it was always for - today it only reaches Studio.

## What must NOT change

- **Every capability survives.** Auto-Debug, the six analysis tools, agents,
  Python and JS execution, deploy, My Sites, the error dashboard, VS Code
  connect, folder write-back, project download, artifact export, Design DNA.
  Deleting functionality needs the owner's explicit approval and this is not
  that; the merge is about one door, not fewer rooms.
- **Deep links keep working.** `setTab('dev')` has 8 callers outside these files
  (`05-ui-blocks.js`, `07-workspace-memory.js`, `13-integrations.js`,
  `16-palette-sched.js`, `26-nextstep.js`), `setTab('studio')` and
  `setTab('lab')` have their own. `dev`, `studio` and `lab` stay as accepted tab
  names that route into `build` with the right entry state, permanently, not as
  a migration step.
- **Sessions survive.** `_sessNew('dev')` / `_sessNew('lab')` and anything
  already saved under those keys must still open. A merge that loses somebody's
  work is worse than the split.
- **The plan gates stay where they are.** Whatever Dev and Lab check today about
  deploy and model tiers is checked by the merged surface identically. The
  server is still the authority.

## Order of work, and where it can stop safely

Each step ends with the product working and the gate green. Nothing here is a
big-bang rewrite.

1. **Prove the inventory. DONE.** `tests/e2e/the-build-surfaces-keep-every-control`
   plus `tests/fixtures/build-surface-controls.json`: 279 controls captured by
   driving the real app across eight states, and 46 operable ids checked against
   the built bundle. It passes on today's build and must pass after every step
   below.

   Taking it found the gap that would have made it worthless. A first pass drove
   Studio's hero and stopped, because reaching the canvas behind it normally
   needs a model call - so it inventoried seven controls and left eight (back,
   add, refine, download, export, code, history) outside the baseline. Studio's
   entire working surface could have been deleted with every check green. Design
   DNA had the same shape: twelve sections, one mounted at a time, 217 controls
   between them, of which a naive snapshot sees a twelfth.

   Five controls cannot be reached by driving at all - three hidden file inputs,
   a hidden language select, and Save, which appears only once a folder is
   connected. Those are asserted against the bundle instead, because "I could not
   click it" and "it is gone" have to stay different answers. Sabotage-tested
   three ways: deleting a visible canvas control fails the rendered half,
   deleting the hidden file input fails ONLY the source half, and dropping one
   DNA section fails with fourteen named controls.
2. **One shell, three renderers. DONE.** `renderBuildView` dispatches on
   `_buildMode()` and the router's three cases all go through it. The three
   renderers are untouched - a refactor and a redesign in one commit is how you
   lose the ability to say which one broke something.

   `studio`, `dev` and `lab` stay real route names rather than becoming
   redirects, and the guard asserts that: `setTab('dev')` has callers in five
   other modules and none of them should ever need to know this became one
   screen. The Dev-to-Lab handoff is checked too, since that crossing is the
   product already admitting these are one job.

   Nothing a person can see changed, which is the point, and the inventory from
   step 1 passing unchanged is what says so.
3. **One toolbar. DONE.** `_buildBarHTML(mode)` is the single definition. Dev and
   Lab had drifted the way copies do - the same job wore a paperclip on one and
   an upload tray on the other, New session was the only glyph they agreed on,
   and Deploy was written twice.

   It emits the SAME ids each surface already wires, so no event handler moved.
   The ids collapse into shared ones in step 6, when the surfaces genuinely
   become one and the wiring moves with them. A markup change and a rewiring in
   one commit leaves no way to say which broke something.

   Still to do in this area, deliberately deferred: the two deploy paths
   (`_devDeploy` and `_labDeploy`) are still two functions behind one shared
   button shape, and download/export is still per-surface. Those are wiring, so
   they belong with step 6.
4. **One entry state. DONE, in the form the product can actually honour.** All
   three surfaces now open with the same header and the same three outcomes -
   design it, build an app, work on code you already have - so the choice is
   made once, in the open, and can be changed without going back to the sidebar
   to guess again.

   The three heroes were NOT collapsed into a single composer, and that is a
   decision rather than a shortfall. Studio's composer creates a design, Dev's
   builds a running app, and Lab takes code that already exists. One composer
   would have to infer which, inference needs a model call, and a model call
   means it cannot work without a key - so "type anything and we will work out
   the tool" would be a feature that demos and then strands somebody on the
   wrong surface. Three visible choices are one click and never wrong.

   Each mode keeps its own composer and starting points with the same ids, so no
   wiring moved.

   The switch sits ABOVE each surface's toolbar, not inside its scrolling
   content, because the first version did the latter: on a 390px phone Lab's
   toolbar wraps to 164px and the first mode button rendered at the right size,
   in the right place, with the right label, BEHIND the bar. Found by clicking
   it, not by measuring it.
5. **One result pane. DONE.** Studio and Dev showed code
   two completely different ways for the same job: Dev has a Code tab, Studio
   opened a new browser window and wrote the markup into it.

   That was not just inconsistent, it was broken. `window.open` returns null
   when popups are blocked - the default in several browsers and common on
   phones - and the guarded call then did nothing at all: no window, no toast,
   no error, nothing on screen. Measured both ways rather than assumed. Studio
   shows the code in the surface now, matching Dev, with the same control id
   turned into a toggle.

   Second half: a phone can now give the result the whole screen on all three.
   Dev and Lab already had a pane toggle; Studio, the one surface whose entire
   purpose IS the preview, did not - its side panel took 575px of an 844px
   screen and the canvas got 190px. It now uses the same toggle, mounted where
   the canvas is created rather than at setTab, because the canvas does not
   exist yet when setTab runs.

   Third: one viewport switcher. Studio could check a design at tablet and phone
   width; Dev could not, so the same question got a different answer depending
   on which surface you were on. One component and one handler, and the handler
   takes the frame as a FUNCTION because Dev replaces its iframe on every build.

   Studio's had never worked. The inline width was applied correctly and the
   frame did not move, because `.studio-frame` carries `flex:1` - in a flex row
   the basis decides the main size and `width` is not consulted. The buttons
   highlighted, the transition ran on nothing. Confirmed pre-existing by
   rebuilding the previous commit.

   **Finished 2026-08-23 with `_resultBarHTML`.** One component, a left slot for
   tabs or a title and a right slot for a status and actions. Dev passes tabs,
   Lab passes a title, Studio passes tabs - which is how Studio's code toggle
   left the side panel and became a tab where Dev keeps its, and how Studio's
   status came to sit beside the stage it describes. Both kept their ids, so
   the step-1 inventory proves they still reach the same function.

   Two mistakes made and caught by measuring rather than by reading: hiding the
   title on narrow screens left Lab with an empty strip, and the new tab class
   was not enrolled in the tap-target rule the old one was in, so the tabs lost
   their 40px phone minimum while still looking right. Both are checks now, in
   `tests/e2e/one-bar-above-every-result`.
   **Read before starting, 2026-08-23.** The two structures were measured rather
   than assumed, and they are not the same shape:

       Dev    .dev-prev-bar = .dev-prev-tabs [Preview|Code] + .dev-prev-acts
              (viewport switch, status, download, deploy, open external)
              two bodies, #dev-prev-body and #dev-code-body, toggled by showPV

       Lab    .lab-out-top  = a label and #lab-out-stat
              one body, #lab-out-body, plus a chat composer under it

   Dev has Preview|Code because Dev GENERATES the code and has to show both.
   Lab's code is already on screen in the editor beside the output. So giving
   Lab a Preview/Code tab bar would make the two surfaces identical at the cost
   of giving Lab a tab that shows it what it is already looking at.

   **So the shared thing is the BAR, not the tabs.** One component with a left
   slot (tabs, or a title) and a right slot (actions and status). Dev passes
   tabs; Lab passes a title. Studio uses the same bar. That unifies the chrome,
   the spacing, the status position and the action group - which is what D013 is
   actually about - without inventing a control Lab has no use for.

   This is worth saying explicitly because "merge the surfaces" read literally
   would produce the worse product, and the finding is about duplication of
   STYLE, not of concept.

   All three bars, measured 2026-08-23:

   | | left of the bar | right of the bar | bodies | status lives |
   |---|---|---|---|---|
   | Dev | tabs `Preview\|Code` | viewport, download, deploy, open | 2, toggled | in the bar, right |
   | Lab | title `Output` | nothing | 1 (+ chat) | in the bar, left |
   | Studio | 3 fake window dots, title | viewport | 2, toggled | **in the side panel** |

   Two things fall out of that table, and both are user-visible, which matters
   because step 6 is not:

   **Studio's code toggle is a button in the SIDE panel; Dev's is a tab in the
   bar.** Same job, two places, two idioms. Moving Studio's into the bar as a
   tab is the actual D007 win on this surface - it is the "one control, one
   place" the finding asks for, and a person switching between the two surfaces
   stops having to relearn where it lives.

   **Studio's status is in the side panel, away from the stage it describes.**
   Dev and Lab both put it in the bar. This was noticed the hard way: an e2e
   probe waiting for Studio to report a refusal had to watch an element in a
   different pane from the thing that failed.

   So the component is `_resultBarHTML({ tabs | title, actions, status })`, and
   adopting it moves two controls to where the other surfaces already keep
   them. The fake window dots go - they are decoration on one surface out of
   three and they cost the bar its left slot.

6. **Retire the three renderers**, and run the step-1 inventory to prove every
   control still exists and still reaches the same function.

   Standing caveat, restated: the benefit of step 6 is tidiness. No control
   moves, nothing a person can see changes. It is ~3,600 lines of renderer and
   the inventory in step 1 exists precisely so it can be done safely - but if
   anything ahead of it in the queue is user-visible, that goes first.

## What is deliberately deferred

- **AMV-D033** (Lab's duplicate Run) is folded into step 3 rather than fixed
  first. It is low effort, so it would normally have shipped with the small
  batch; fixing it now means writing that code twice.
- **AMV-D031 / D032** are subsumed the same way.
- **AMV-D005 and D012** are unresolved owner questions about the wider
  information architecture, and both touch what the sidebar looks like around
  this. Nothing here assumes an answer to either.

## How it gets verified

Not by the build passing. On every step: the full gate, then the surface driven
in a real browser at 1440, 1366, 768 and 390, signed in and signed out, on a
free plan and a paid one. The step-1 inventory is the backstop against the
failure this kind of merge actually has, which is not a crash - it is a button
that quietly stopped being anywhere.


## Found by reading the duplicated wiring, not by merging it

Step 6 begins by checking whether the two deploy paths had drifted, since deploy
is the one duplicated action that costs money and touches something public.

**They had not drifted where it would have been dangerous.** `_devDeploy` and
Lab's `deploy_site` tool both call `_deployApi('/deploy')`, so both get
`deploySite`'s auth, rate limits (10/min, 100/day), 2MB cap, per-user site cap
and slug-ownership check. No security or billing divergence.

**They had drifted twice where it cost the user something.**

1. Dev passed a slug so re-deploying updated the same URL; the tool path passed
   none, so every Lab publish minted a NEW site against a 25-site cap.
   Publishing one page twenty-five times filled the whole allowance with copies
   of it. Fixed by threading the slug through the tool.

2. Worse, and pre-existing on both: the slug was never cleared when a session
   was reset. Build an app, publish it, press New session, build a different
   app, publish it - and the second silently replaced the first at its own
   address. Destructive, silent, and to a public artifact. Reproduced before
   fixing and guarded in both directions, because the obvious fix (always clear
   it) reintroduces problem 1.

**One asymmetry left deliberately for the owner.** Pressing Deploy in Dev
publishes a public page immediately. Pressing it in Lab routes through the
model-tool path, which asks "publish a public web page live on the internet?"
first. Both are human-initiated, so the extra dialog is arguably redundant - and
equally, publishing to the internet is the kind of thing a confirmation suits.
It is a product decision about how much friction publishing deserves, not a
defect, so it is written down rather than settled unilaterally.


## Download: one helper, and the sites still to convert

Fourteen copies of the same four-line blob-download dance existed across the
app, and they had drifted: three append the anchor to the document before
clicking it, the rest click a detached one. Studio appended; Dev did not.

Being straight about the evidence: **no failure was reproduced.** A detached
anchor downloads correctly in Chromium, the only engine testable here.
Appending is the pattern browsers have historically required and that
implementations still use defensively, and it costs nothing. So `amvDownload`
is alignment on the safer of two behaviours, not a verified bug fix, and should
not be described as one.

What is certain is that fourteen copies drift, and these already had.

**Converted:** the Build surfaces - `_studioDownload`, and both paths in
`_devDownloadProject`. Verified by real download events rather than by reading:
`my-design.html`, `index.html`, `amv-project.txt` all fire.

**Still to convert**, catalogued rather than changed in a commit about something
else:

- `src/app/02-state.js:766` - audit log export
- `src/app/03-sessions.js:1522` - session export
- `src/app/05-ui-blocks.js:350` - chat artifact download
- `src/app/07-workspace-memory.js:177` - workspace file exports
- `src/app/11-design-code.js:1074` - Dev multi-file save without a folder handle
- `src/app/28-activity.js:131` - activity export
- plus the export paths in `12-handoff.js` and `13-integrations.js`

Three of these already append; the rest do not. They belong with the polish
batch, where they can be converted and verified together.
