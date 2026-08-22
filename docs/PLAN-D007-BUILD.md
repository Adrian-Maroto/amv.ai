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
5. **One result pane. STARTED - the defect first.** Studio and Dev showed code
   two completely different ways for the same job: Dev has a Code tab, Studio
   opened a new browser window and wrote the markup into it.

   That was not just inconsistent, it was broken. `window.open` returns null
   when popups are blocked - the default in several browsers and common on
   phones - and the guarded call then did nothing at all: no window, no toast,
   no error, nothing on screen. Measured both ways rather than assumed. Studio
   shows the code in the surface now, matching Dev, with the same control id
   turned into a toggle.

   Still to do here: Lab's output pane and Dev's Preview/Code tabs are still two
   separate structures, and the tab bar is not yet a shared component. Studio's
   viewport switcher (desktop/tablet/phone) exists only on Studio, though Dev's
   preview would benefit from it. Those are the rest of this step.
6. **Retire the three renderers**, and run the step-1 inventory to prove every
   control still exists and still reaches the same function.

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
