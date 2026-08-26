# AMV.AI - Project Guide

AMV is a premium AI product (chat, images, video, autonomous agents, a
marketplace with payouts, subscriptions) built to production quality. This file
is the standing contract for how work is done here. Read it first, every session.

Companion docs (do not duplicate them here - read them):
- `CONTEXT.md` - product brief and architecture background.
- `LESSONS.md` - mistakes made and the rule taken from each. Read at session start.
- `SECURITY-SCAMS.md` - the scam/abuse defense register (50+ vectors).
- `DEPLOY.md` / `GO-LIVE.md` - deploy steps and the keys that unlock live power.

## Owner directives (never break these)
- Max quality. No fake or visual-only features - everything works for real or
  degrades honestly.
- Honest degradation with no keys; full power the moment keys are pasted.
- Never mention Claude/Anthropic or any other AI company in user-facing output,
  commits, PRs, code comments, or pushed artifacts. Brand everything as AMV.
- Verify every change on the surface the owner actually uses. "Done" means the
  deployed artifact, not just the local build. Render deploys `main`.
- Go one at a time. Review before delivering. No mistakes then they see it.
- Usable on EVERY device. Hard to lose money.
- Auto-push to `main` after each prompt (Stop hook + `.claude/auto-push-main.sh`).
- If a tool or change would make AMV worse, do not use it. Say so instead.

## Architecture reality (know this before editing)
- The app ships as a SINGLE-FILE build, but the JS SOURCE is MODULAR:
  `src/app/NN-name.js` files (01-core, 02-state, ... 16-palette-sched) are
  concatenated IN NAME ORDER to form the bundle. `node build.mjs` concatenates
  them (regenerating `app.js`) and injects that + `styles.css` into `index.html`
  between the BUILD:CSS / BUILD:JS markers.
  - **Edit `src/app/*.js`, NOT `app.js`.** `app.js` is the GENERATED
    concatenation - the build overwrites it from the modules every run, so any
    hand-edit to `app.js` is lost. It stays committed only so `check.mjs`,
    `preflight`, and grep keep working against the whole bundle.
  - It is still ONE runtime script (shared global scope) - the modules are
    organization only, concatenated with no wrappers. Order across module
    boundaries is preserved, so top-level order dependencies still hold.
  - The nav/body shell in `index.html` is safe to edit directly; everything
    else comes from the sources. Always rebuild.
  - `node build.mjs` MINIFIES by default, because `index.html` is the artifact
    every visitor downloads (1.8MB minified, ~505KB over the wire; 2.3MB and
    ~690KB without). `app.js` is written unminified beside it either way, and
    that is the copy `check.mjs`, `preflight` and grep read - so the readable
    artifact is kept where it is actually used. `--no-minify` opts out.
    `npm run check` has a gzipped ceiling on `index.html`, so it can only grow
    by somebody raising it on purpose.
- Vanilla JS. There is NO React, Next.js, Vue, Tailwind, or bundler. Do not add
  one. Framework-specific tools and advice do not apply here.
- Backend: a Cloudflare Worker (`amv-backend.js`) + KV + a Durable Object
  (atomic usage counter) + cron. The server is always the authority on money,
  limits, auth, and content. Client checks are defense-in-depth only.
- CSS is applied as append-only override LAYERs (A1..A17+). New work adds a NEW
  layer at the end to win the cascade. Reuse tokens/classes; do not fork a
  component per page.
- Delegated events: `data-dact` / `data-darg` dispatch through a single
  `document` click handler. Buttons inside a modal that calls
  `event.stopPropagation()` are DEAD for this delegation - guard the backdrop
  with `if(e.target===e.currentTarget)` instead (see LESSONS.md #5).
- i18n: `T()` + the `I18N` dictionary (instant, no key) with an AI-cache fallback
  (needs a key). A MutationObserver translates content rendered after a language
  switch across `#app`, `#ovr`, and body-appended menus. Chat content is marked
  `data-no-i18n`. Never mistranslate live model output.

## Verify like this
- `npm run check` is the shippability gate (syntax, worker load, build fresh,
  all suites, deploy preflight -> "SHIPPABLE"). Roughly 15 MINUTES: the suites
  run several at a time (`tests/run.mjs`, default four, `--jobs=N` to change it,
  `--serial` to reproduce something that might be about ordering). All 138 e2e
  suites take ~13 minutes together; serially they took hours, which is why the
  runner is parallel now. Output is buffered per suite and printed in selection
  order, so a parallel transcript reads exactly like a serial one - and a slow
  suite early in the list holds back the printing of everything behind it, which
  is what the `[n/138]` counter on stderr is for.
  The harness asks the kernel for a free port, so nothing binds a fixed one and
  two runs no longer collide.
- `npm run check:fast` is the ITERATION loop: ~7 seconds, seven stages (syntax,
  worker loads, build fresh, dead guards, page weight, deps, preflight). It
  deliberately SKIPS the suites and the workerd stage, so it catches a broken
  build and a stale artifact but NOT a behavioural regression. Use it between
  edits; use the full `npm run check` before calling anything done.
- The DEAD GUARDS stage exists because of LESSONS 297. It fails when
  `typeof X === 'function'` names something defined nowhere - a guard that can
  never pass, so whatever it protects never runs. That is not theoretical: it
  caught `checkOAuthCallback` being deleted (every account connection silently
  threw away the authorization code), `applyTheme` (the model tool that switches
  to light mode saved the setting and left the screen dark) and `confirmModal`
  (three destructive actions fell to their fallbacks, two of which skipped
  asking entirely). It reads `app.js` with comments and strings stripped, so a
  comment explaining a removal is not mistaken for the removal not happening.
- e2e uses the Playwright harness in `tests/lib/harness.mjs` (`bootApp`).
- Rebuild (`node build.mjs`) before checking, or the "build fresh" step fails.
- **Editing `index.html`:** only lines outside the BUILD:CSS and BUILD:JS
  markers are yours (the head/meta/CSP block, and the landing + app shell
  markup). Anything between the markers is generated and is overwritten. The
  build warns when it finds a hand-edit in a generated block and saves the old
  content to `.discarded-index-*.txt` rather than dropping it, but the edit
  still belongs in `styles.css` or `src/app/*.js`. Any index.html edit needs a
  rebuild: the CSP pins the inline scripts by hash, so an edited boot script
  that has not been rebuilt is refused by the browser.

## Installed tooling and when to use it
Enabled project-wide (see `.claude/settings.json`). Use them for the job each is
best at; do not run redundant overlapping passes.
- **superpowers** - primary methodology for substantial features: clarify
  requirements, write a short spec + plan, TDD, subagent-driven work, verify
  before claiming done. Use before writing unplanned code for anything nontrivial.
- **frontend-design** (Anthropic) - implementation quality for distinctive,
  production-grade UI. Use when building/refining user-facing screens.
- **ui-ux-pro-max** (community, offline) - design-system intelligence: palettes,
  typography, industry patterns, anti-patterns. Use for research/direction BEFORE
  implementing. Pairs with frontend-design (research -> implementation).
- **modern-web-guidance** (Google Chrome) - audit finished UI against current web
  platform + accessibility guidance. Use AFTER implementation, not as the design step.
- **code-review** - multi-agent review of a diff (correctness, security, tests).
  Use on substantial changes. Do not also run a second review plugin for the same diff.
- **context7** (MCP, connected) - pull current, version-specific docs for a
  library/API (Cloudflare Workers, Stripe, browser APIs) BEFORE using unfamiliar
  or version-sensitive methods. Prevents hallucinated APIs.
- **playwright** (MCP, connected) - drive a real browser to verify flows,
  responsive layouts, and states. LOCAL/STAGING ONLY. Do not point browser
  automation at production (`amv.homes`) without explicit owner authorization.

Built-in skills also available: `/security-review`, `/code-review`, `skill-creator`,
`dataviz`, `artifact-design`. GitHub is wired via MCP in-session.

Not enabled on purpose (turn on locally if wanted, with reasons in the report):
`security-guidance` (its push/Stop LLM-review hooks collide with auto-push-to-main
every turn and add per-push cost); `serena` (LSP indexing a single 18k-line file
is heavy for marginal gain over Grep/Read here).

## AMV design standards
- Must NOT look like a generic AI dashboard. Avoid predictable purple gradients,
  glowing borders, excessive glassmorphism, random floating cards, and decorative
  effects with no purpose. Preserve AMV's established brand direction.
- Build a coherent design system, not per-page styling. Use design tokens for
  type, color, spacing, radii, borders, shadows, motion, breakpoints. Reuse
  shared components; do not fork a near-duplicate per page.

### Canonical design tokens (use these; do not invent parallel scales)
A real, adopted token system already exists in `styles.css :root`. Reuse it.
Do NOT add new `:root` blocks or a parallel scale, and do not hardcode values a
token already covers. New CSS still goes in a NEW append LAYER, but referencing
these tokens.
- **Color (theme-aware, light/dark):** `--bg`, `--s1..--s4` (raised surfaces),
  `--tx` (text), `--mu` (muted), `--dim`, `--bd`/`--bdl` (borders),
  `--accent`/`--accent-d`/`--accent-soft`/`--accent-grad` (user-themeable),
  status `--grn` / `--red` / `--gold`. Deprecated aliases - do not use in new
  code: `--green`(use `--grn`), `--amber`(use `--gold`), `--pur`/`--indigo`/
  `--blue`(use `--accent`).
- **Type scale:** `--t-xs` 11, `--t-sm` 12, `--t-base` 13.5, `--t-md` 14,
  `--t-lg` 16, `--t-xl` 20, `--t-2xl` 26, `--t-3xl` 34, `--t-hero`. Use these
  instead of hardcoding `font-size:Npx` in new UI. (~600 legacy inline styles
  still hardcode px; migrate opportunistically and screenshot-verify - some live
  in EXPORTED/generated HTML where `:root` vars do not exist, so never blanket
  find/replace.)
- **Spacing:** `--sp-1..--sp-8` (already widely adopted). Prefer over raw px gaps.
- **Radius:** `--r-xs`/`--r-sm`/`--r-md`/`--r-lg`/`--r-xl`/`--r-2xl`/`--r-pill`
  (a later LAYER sets the effective `--r-sm/md/lg/2xl` a bit smaller via
  `!important`). Deprecated - do not use or extend: `--r`, `--rad`, `--rad-*`.
- **Shadow:** `--sh-sm`/`--sh-md`/`--sh-lg`/`--sh-xl`/`--sh-glow`.
- **Motion:** `--ease`, `--ease-soft`. Respect `prefers-reduced-motion`.
- **Font family:** `--fn` (Inter body), `--fdisplay` (Space Grotesk display),
  `--mn` (mono). **Layout:** `--sbw` (sidebar width), `--nav-h`.
- Strong hierarchy and information density without clutter. Distinctive but restrained.
- Provide real loading, empty, success, warning, disabled, offline, unauthorized,
  and error states.
- Purposeful motion only; respect reduced-motion. Support desktop, tablet, mobile.
- Keyboard nav, semantic HTML, focus states, screen-reader labels, sufficient contrast.
- Test with realistic content. Visually inspect substantial changes in a real
  browser and compare against the rest of the product before calling them done.

## AMV engineering standards
- Inspect the relevant code/architecture before editing. For substantial features
  write a short spec + plan first (use superpowers).
- Preserve working functionality. Do not rewrite stable systems without a clear
  reason. Do not add frameworks/dependencies because they are popular.
- Prefer the simplest architecture that meets the need. Avoid duplicated logic and
  unnecessary abstraction. Use current official docs (context7) for version-sensitive APIs.
- Do not silently swallow errors. Give meaningful messages and recovery paths.
- Do not ship mock behavior as real. Do not claim completion without verification.
- Record important architectural decisions (append to LESSONS.md when a mistake
  teaches a rule).

## AMV security standards
- Never put secrets in client code. Never commit keys, tokens, passwords, private
  keys, or connection strings. Never print env vars/secrets.
- Validate all untrusted input. Enforce authorization server-side. Least privilege.
- Defend against XSS, CSRF, SSRF, SQL/command injection, IDOR, privilege
  escalation, unsafe uploads. Escape all user-supplied output (`escH`); keep the
  strict CSP intact.
- Separate read from write permissions. Require explicit approval for destructive
  actions, payments, purchases, publishing, external communications, account
  changes, and exposing private info.
- Log meaningful autonomous actions without logging secrets or unnecessary PII.
- No unrestricted production-database access for agents. Do not execute downloaded
  third-party code without inspecting it. Review dependencies for known vulns.
- Protect automation endpoints against replay and unauthorized triggering. Add
  rate limits wherever abuse is possible. (See SECURITY-SCAMS.md and AMVFraud.)

## AMV testing standards
- Test important workflows in a real browser (playwright), on desktop, tablet, and
  mobile. Test forms with valid AND invalid input. Test loading, empty,
  unauthorized, offline, degraded, and error states.
- Test auth/authorization boundaries, approval workflows, autonomous actions,
  retries, cancellation, and failure recovery. Test keyboard navigation.
- Run `npm run check` (build + all suites + preflight) before declaring done. Fix
  failures; do not merely document them.

## AMV review standards
- Review substantial work for correctness, security, privacy, accessibility,
  responsiveness, performance, maintainability, visual consistency, error recovery.
- Use the minimum number of overlapping review agents. Prioritize high-confidence
  findings. Verify fixes after applying them.
- No endless autonomous loops: set explicit completion criteria and an iteration
  cap. Keep commits logically grouped and clearly described.

## Wait for explicit owner approval before
Changing the database/KV schema; deleting functionality; changing authentication;
modifying billing; changing production infrastructure; adding invasive analytics
(session recording, etc.); granting broad external permissions; or a major visual
redesign. Propose first, then wait.
