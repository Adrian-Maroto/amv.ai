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
- The app is a SINGLE-FILE build. Source of truth: `app.js` (~18k lines) and
  `styles.css`. `node build.mjs` swaps them into `index.html` between the
  BUILD:CSS / BUILD:JS markers. The nav/body shell in `index.html` is safe to
  edit directly; everything else comes from the sources. Always rebuild.
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
  all suites, deploy preflight -> "SHIPPABLE"). It takes ~210s; do not run a
  second test that binds port 9100 while it runs.
- e2e uses the Playwright harness in `tests/lib/harness.mjs` (`bootApp`).
- Rebuild (`node build.mjs`) before checking, or the "build fresh" step fails.

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
