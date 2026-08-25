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

**Dead CSS: 647 rules, ~70KB raw, ~13KB gzipped.** Selectors naming classes
that appear nowhere in the client or the shell. I removed only the ones I could
name - what belonged to image and video generation, the chat-home cards and the
model picker - because a stylesheet rule that turns out to be live does not
throw, it just silently un-styles a screen nobody's test is looking at. Doing
the remaining 600 safely means driving every screen and comparing screenshots,
not trusting a scan. Worth doing; worth doing carefully.

## What is NOT worth doing

**Minifying harder.** Already minified, and the remaining wins are single-digit
kilobytes.

**Splitting the bundle by route.** It would help a first paint and it fights the
single-file build for a product where the first thing a visitor does is start a
chat - which needs most of the client anyway. The language dictionary is a
better target because nobody needs eighteen of them, ever.
