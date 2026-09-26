# Deferring part of the bundle - what it would actually take

A decision document, not a proposal. It exists because I proposed the wrong
thing twice on this subject from numbers I had not measured, and the owner
should be able to accept or reject this on evidence rather than on my say-so.

## The number, measured properly

Not read off disk, not the span between two `const` declarations. Measured by
removing each module and re-minifying and re-gzipping the whole bundle, which is
the only figure that predicts what a visitor downloads:

```
JS, minified + gzipped   420 KB        CSS, gzipped   112 KB
index.html as shipped    543 KB gzipped        ceiling in check.mjs   620 KB

  04-i18n.js             58.5      10-mission-control.js   51.2
  12-handoff.js          47.5      11-design-code.js       37.1
  05-ui-blocks.js        35.8      07-workspace-memory.js  25.3
  08-admin-fraud.js      20.8      14-engine.js            17.5
```

77 KB of headroom. Nothing is failing. This is not urgent.

## The thing I got wrong

I described the four largest screen-ish modules - mission-control, handoff,
design-code, admin-fraud - as "~157 KB gzipped, none of it needed to paint the
first screen", and framed the decision as whether to give up the single-script
property.

That framing was wrong, and the file names are what made it plausible. They are
not screens. Every one of them defines functions the rest of the bundle calls:

| module | defines | called from the rest of the bundle |
|---|---|---|
| `10-mission-control.js` | 102 | 8, incl. `_cwJobs`, `_autonomyPaused`, `_clarifyCheck` |
| `12-handoff.js` | 136 | 18, incl. `renderView`, `_profileContext`, `_localeContext` |
| `11-design-code.js` | 107 | 18, incl. `_toolNeedsConsent`, `dnaPromptBlock` |
| `08-admin-fraud.js` | 59 | 10, incl. `syncEntitlement`, `_planAllowsModel`, `_setPlan` |

`08-admin-fraud.js` is not an admin screen - it holds plan and entitlement logic
the whole app depends on. `11-design-code.js` holds `_toolNeedsConsent`, which is
the approval gate in the middle of every chat turn that uses a tool. Deferring
either would break the product at boot, not degrade it.

So "defer these four files" is not a smaller version of the right idea. It is
not implementable.

## What is actually separable

Splitting the top-level functions in those four modules into the ones something
outside calls (including anything assigned to `window` or reachable through the
`data-dact` delegated-event dispatch, both of which are dynamic and invisible to
a plain reference search) and the ones that are only used inside their own file:

```
must stay      219 KB raw
self-contained 349 KB raw   (61%)
```

61% of that mass is genuinely leaf rendering. Against the modules' 157 KB
gzipped, that is roughly **95 KB gzipped, about 17% of the page** - if the split
were free, which it is not.

## What it would cost

1. **A second file in the deploy path.** Fine on its own: the deployment already
   serves `sw.js`, `manifest.webmanifest` and the icons, the CSP allows
   `script-src 'self'`, and the service worker is network-first with runtime
   caching, so a deferred chunk caches itself after first use.

2. **Splitting mid-module, not at file boundaries.** The build concatenates
   `src/app/*.js` in name order into one shared scope with no wrappers, and
   order dependencies across module boundaries are load-bearing. A split that
   respects that has to move individual functions, which means either new source
   files (renumbering, and every order dependency re-checked) or build-time
   extraction by marker.

3. **Dynamic reachability is the risk that bites.** `window.x = x` and
   `data-dact="x"` both make a function callable without any textual call site.
   The analysis above accounts for both, but a function reached by a string
   built at runtime would not appear in either, and the failure mode is a dead
   button on one screen for some users - exactly the class of defect this
   codebase keeps finding.

4. **A visible failure mode where there is none today.** A deferred chunk that
   404s or is blocked leaves a screen that cannot render. Today the app either
   loads or does not.

## What would make it worth doing

Not the 17%. It would be worth doing if any of these became true:

- the gzipped page approaches the 620 KB ceiling and real features are being
  held back by it;
- first-paint measurements on a real slow connection show the bundle, rather
  than the network round trip, as the thing people wait on;
- the split falls out of work already happening - e.g. if the modules get
  disentangled for maintainability, deferral becomes nearly free.

## If it is approved anyway, this is the order

1. Extract the 219 KB of shared functions out of the four modules into a core
   module, leaving each file as leaf rendering only. **No deferral yet** - this
   is a pure move, and the gate proves the app is unchanged.
2. Add a standing check that nothing in the leaf modules is referenced from the
   core, from `window.*`, or from `data-dact`. This is what stops step 3 from
   silently breaking a screen later.
3. Only then, defer the leaf modules, with an honest failure path: a screen
   whose code did not arrive says so and offers a retry, rather than rendering
   empty.
4. Verify on a real browser on a throttled connection, every screen, before and
   after.

## Recommendation

**No, not now.** The headroom is real, the win is 17% rather than 29%, and the
prerequisite refactor is the actual work - it touches the boot path of a
shipping product to save bytes nobody is currently waiting on. Revisit when one
of the three conditions above is true.

## 2026-09-26 - the owner said do it; measured again first, and it is still no

The owner approved splitting the bundle. Before touching the boot path I measured
what a per-screen split could actually move, with a parser rather than a
reference count:

- every top-level function each screen's entry point (`renderCrewView`,
  `renderAdminView`, ...) can reach, parsed with acorn across all modules;
- then pruned of anything referenced from ANY other code - another module, load
  time code, the HTML shell, or any string (which covers `window.x`,
  `data-dact="x"` and names built into markup), iterated to a fixed point.

```
crew 55KB   admin 43KB   team 36KB   billing 35KB   market 31KB   tasks 19KB
help 11KB   upgrade 9KB  plans 7KB   apps 6KB   integrations 5KB   handoff 5KB
settings 4KB   memory 4KB   prompts 3KB   build 1KB          (raw source, comments included)
total ~279KB raw of 2,806KB source  ->  roughly 35KB gzipped, ~6% of the page
```

Settings defers 4KB because its panes are reached from a dozen places; Build 1KB
for the same reason. The screens are not separable at their current seams, and
making them separable is the refactor this document already described as the real
work.

**What was done instead:** the translations (`04-i18n.js`, the largest single
module on the wire) now ship one language at a time - 44KB gzipped off every
page, with no screen able to fail to load because of it. `index.html` is 577KB
gzipped, from 621KB.

**Still the recommendation: do not defer screens.** ~35KB is not worth a failure
mode where a screen's code does not arrive. Revisit if the modules are
disentangled for their own sake, and re-run the measurement then - the script is
recorded in the 2026-09-26 session notes and takes seconds.
