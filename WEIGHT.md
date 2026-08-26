# What every visitor downloads, and where it goes

Measured on the built artifact, which is the only number that matters: a first
visit fetches `index.html` and nothing else, because the CSS and the whole
application are inlined into it.

**575KB gzipped** (2,016KB raw). The gate's ceiling is 620KB.

It was 607KB when this was first measured. Removing image and video generation,
the dead surface behind them, and the duplicated dictionary entries took 32KB
off. The rest of this file is what is left and what it would cost to move.

## Where the bytes are

| | gzipped | share |
|---|---|---|
| Translations (`04-i18n.js`) | ~65KB | 11% |
| Everything else in the client | ~380KB | 66% |
| Stylesheet | ~130KB | 23% |

## The one big lever, and it is your call

**Eighteen languages nobody is reading.** The dictionary carries all 19
supported languages inline, so a visitor in London downloads Tamil, Urdu,
Korean and sixteen more before a word appears on screen. That is 11% of the
page for something a given person uses one nineteenth of.

Two ways to fix it, and both change something you decided on purpose:

1. **Ship fewer languages.** The cheapest change and the only one that keeps
   the single-file build exactly as it is. It is a product decision: which
   markets AMV is for at launch. Dropping to five languages would save ~50KB.

2. **Fetch the other languages on demand.** English ships inline - it is the
   source text and is in the markup anyway - and switching language fetches one
   small file. English speakers pay nothing and everybody else pays one request
   at the moment they ask. It costs the single-file property: there would be a
   second file to deploy, and the honest-degradation rule means a failed fetch
   has to leave the interface in English rather than half-translated.

I have not done either. The first is yours to decide and the second changes how
the artifact is delivered, which is on your approval list.

## What is left that is mine

**Dead CSS - the safe subset is DONE: 97 rules, 10KB raw.**

That is far short of the 647 rules I first counted, and the gap is the point.
That number counted every rule mentioning a class that appears nowhere. This
removal used three much stricter conditions, all of which have to hold:

1. the class appears nowhere in the bundle, the shell, or the service worker;
2. no PREFIX of it appears either, so it cannot be assembled at runtime -
   `'chome-card-' + kind` builds a name a plain search never finds;
3. EVERY selector in the rule is dead, so `.live,.dead{}` keeps `.live` and
   loses nothing.

That takes 315 never-mentioned classes down to 102, and 647 rules to 97.

**Verified three ways, because a rule that turns out to be live does not throw -
it silently un-styles a screen nobody's test is looking at.**

- Computed styles for all 4,538 elements across 18 screens, before and after:
  identical. Animations are stopped first - the first run reported 29 "changes"
  that were all opacity partway through a fade, which is noise that looks
  exactly like a finding.
- The comparison itself was proved able to see a change, by forcing
  `display:none` on a live class and confirming it showed up. Without that, an
  identical result proves nothing about the removal and everything about a
  broken harness.
- And the strongest one: all 102 classes were given
  `display:none;padding:77px` at once, and NOT ONE element on any screen moved.
  A class that is really applied somewhere would have vanished. This proves they
  are absent from the DOM, not merely absent from the source.

The tools are kept: `tools/dead-css.mjs` (dry run by default) and
`tools/css-snapshot.mjs`.

**What is deliberately NOT done.** The negative control turned up something
else: removing a live `.chome-chip` rule changed nothing, because a later
append layer re-specifies it. There are fully-overridden rules in here beyond
the unused-class set. Removing those is a different risk - a rule overridden on
one screen may be the one that applies on another - and wants its own pass.

## What is NOT worth doing

**Minifying harder.** Already minified, and the remaining wins are single-digit
kilobytes.

**Splitting the bundle by route.** It would help a first paint and it fights the
single-file build for a product where the first thing a visitor does is start a
chat - which needs most of the client anyway. The language dictionary is a
better target because nobody needs eighteen of them, ever.
