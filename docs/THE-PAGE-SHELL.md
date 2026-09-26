# The page shell, explained

These notes used to be HTML comments inside `index.html`, which meant every visitor
downloaded them - about 6KB, 2.8KB gzipped, on every page load - for text only a
developer reads. `index.html` is both the source and the shipped file, so the build
cannot strip them on the way out; they live here instead, and each spot in the page
keeps a one-line pointer: `<!-- shell note N: ... -->`.

## Shell note 1 - THE BACKEND THIS COPY OF THE APP TALKS TO

```text
THE BACKEND THIS COPY OF THE APP TALKS TO.

AMV_API.base read `amv_api_base` out of localStorage and nothing else, so
it was empty for every visitor who had not typed it in themselves. The
owner pastes it once in Settings and their own browser works perfectly -
which is exactly why this survived. For a stranger arriving at the live
site there was no engine, no server account, and no way to pay: the app
degraded honestly to its local demo, forever, for everybody.

The deployed artifact has to carry the address. Set it here, or pass
AMV_API_BASE to `node build.mjs` and the build writes it in. Settings can
still override it on one device for testing.
```

## Shell note 2 - SECURITY HEADERS

```text
SECURITY HEADERS
The CSP locks WHERE the page may load scripts, connect, frame, etc.

THE SCRIPT DIRECTIVE BELOW IS REWRITTEN BY THE BUILD. `node build.mjs`
replaces its value with the sha256 of every inline script this page ships
and drops the inline allowance, and refuses to write the file if inline
script is still permitted afterwards. Editing it by hand here has no
lasting effect on the hashes - change the hosts, and let the build own the
rest. It stays readable in the source because everything else in this
policy IS hand-maintained.

(Written this way on purpose: the directive name does not appear in this
comment, because several checks read the policy by finding the first
occurrence of that name in this file, and a comment mentioning it is a
decoy they will match instead. That cost a gate run.)

The STYLE directive keeps its inline allowance: several hundred inline
style attributes are presentation, and CSP has no way to hash them.

connect-src, frame-src, object-src, base-uri, form-action and
frame-ancestors are the directives that stop exfiltration, clickjacking
and base-tag hijack, and they are named explicitly rather than inherited.
For stronger protection, send these as real HTTP headers from the host
too - a meta CSP cannot set frame-ancestors on every browser.
```

## Shell note 3 - THE FONTS ARE AN ENHANCEMENT, NOT A GATE ON SEEING THE PAGE

```text
THE FONTS ARE AN ENHANCEMENT, NOT A GATE ON SEEING THE PAGE.

This was a plain <link rel="stylesheet"> to fonts.googleapis.com, which is
RENDER-BLOCKING: the browser will not paint a single pixel until it has
that file or has given up waiting. Measured on a page served locally, with
everything else identical: first contentful paint 12,584ms with it, 236ms
without. Fifty-three times.

Twelve seconds of blank white is not a slow font, it is a broken product,
and it happens to anybody whose browser cannot reach Google: a corporate
proxy, a strict content blocker, a bad mobile minute, a DNS failure, a
country where that host does not resolve. Everyone else still paid two
extra round trips - googleapis for the CSS, then gstatic for the files -
before anything appeared.

`display=swap` did not help. That governs what happens once the CSS has
ARRIVED; it has nothing to say about the wait for the CSS itself.

Loaded as `media="print"` so it is fetched at low priority and blocks
nothing. The launcher at the end of <body> switches it to `all`, which is
what actually applies it.

NOT an inline `onload=` attribute, which is the usual recipe for this and
would silently do nothing here: our own CSP sets script-src without
'unsafe-inline', so the browser refuses inline event handlers and the font
would never have loaded at all. The launcher is hash-pinned, so it runs.

The noscript copy keeps it working with JavaScript off. The page renders
immediately in the fallback stack every token now carries, and upgrades
when the webfont arrives - or simply stays in the fallback, which is a
deliberate stack rather than a browser default.
```

## Shell note 4 - Google Identity Services. Google does not publish a stable SRI hash fo

```text
Google Identity Services. Google does not publish a stable SRI hash for
gsi/client (it updates the file), so SRI can't be pinned here without
breaking sign-in on every Google update. crossorigin + referrerpolicy
applied; the CSP script-src allowlist restricts it to Google's origin.
```

## Shell note 5 - Announced to screen readers. Off-screen rather than display:none, beca

```text
Announced to screen readers. Off-screen rather than display:none, because
a hidden element is not read out at all. See announce() in the bundle.
```

## Shell note 6 - The first stop for a keyboard. Without it, reaching the conversation m

```text
The first stop for a keyboard. Without it, reaching the conversation means
tabbing through the whole sidebar and header on every single page. Visible
only while focused, so it costs nothing to anybody using a mouse.
```

## Shell note 7 - The five-step intro tour lived here and was unreachable: showIntro()

```text
The five-step intro tour lived here and was unreachable: showIntro()
had no callers, and every boot path went straight into the app. Removed
with its script. The landing block below is deliberately KEPT even
though visitors go straight to chat - it carries the h1, the product
description and the pricing copy, which is the only content a search
engine can read on this page.
```

## Shell note 8 - The whitespace between <b> and <span> is load-bearing. This block is

```text
The whitespace between <b> and <span> is load-bearing. This block is
never painted (see the note above #land) - its only reader is a
crawler or a text extractor, and both take textContent, where
adjacent tags with no source whitespace produce "Delegatewhole jobs"
and "$0to start". One space each, and the four read as written.
Guarded by tests/e2e/text-somebody-can-read.
```
