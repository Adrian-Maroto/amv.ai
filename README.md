# AMV tests

```bash
npm install
npx playwright install chromium
npm test              # build + run everything
npm run test:e2e      # browser tests only
npm run test:worker   # Cloudflare Worker tests only
```

`npm test` rebuilds `index.html` first — the e2e suites run against the **built
app**, not the source, so a broken build fails the tests.

## Layout

```
tests/
  lib/harness.mjs        boots the app in a browser, in a known state
  lib/assert.mjs         assertions + reporting (no dependencies)
  e2e/smoke.test.mjs         every tab + settings pane renders, nothing throws
  e2e/security.test.mjs      XSS, iframe sandboxing, account isolation
  e2e/regressions.test.mjs   every bug that has ever shipped and been fixed
  e2e/agentic.test.mjs       tools really execute; honesty when the engine is off
  worker/worker.test.mjs     cron automations + real hosting, against a mock KV
  run.mjs                runs all suites, exits non-zero on failure
```

## Why these tests exist

Every assertion in `regressions.test.mjs` is a bug that **actually shipped**.
If one goes red, that bug is back. A few worth knowing about:

- **Font size broke the composer.** "Large"/"Largest" applied CSS `zoom` to
  `#app`, which is `height:100vh` — so the app became 129vh tall and the text
  box fell off the bottom of the screen. Users literally could not type.
- **Studio never reached Recents.** `_sessTouch` used ONE shared debounce timer
  across Dev/Lab/Studio, so touching two tools within ~900ms cancelled the first
  one's save.
- **`md()` broke every list.** It converted every `\n` to `<br>`, including
  between `<li>` elements — invalid HTML, huge dead gaps.
- **Onboarding was dead code.** It was triggered from `loginUser()`, but signup
  goes through `_completeIntroLogin()`, so new users never saw it.
- **Video generation was fake.** It ran a scripted progress bar and produced
  nothing. `agentic.test.mjs` asserts it stays honest.

## Traps when writing new tests

These have all bitten me. Read them before adding a test:

- **`AMV_API.live` is a getter** derived from `.base`. You cannot assign to it,
  and replacing `window.AMV_API` does nothing (the code closes over the original
  `const`). Use `harness.connect()`, or set `AMV_API.base` + `.token`.
- **`store`/`load`/`saveStr`/`loadStr` scope every key per account** via
  `_scopeKey()`. Writing raw `localStorage.setItem('amv_fs', …)` will NOT be seen
  by the app. This silently made a font-size test pass while the feature was broken.
- **The Worker's `requireUser` is module-scoped.** Stubbing `globalThis.requireUser`
  does nothing — inject with the exported `__setRequireUser()` instead.
- **`#ovr` has zero height** even when a modal is open (its child is
  `position:fixed`). Don't measure the wrapper; check the modal content.
- **Verify a selector matches a live element before asserting on it.** More than
  one "bug" here turned out to be a bad selector in the test.
