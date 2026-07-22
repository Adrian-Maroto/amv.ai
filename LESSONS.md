# AMV — Lessons Log

A running record of mistakes I made and the rule I take away from each, so I
don't repeat them. Read this at the start of every session. Newest at top.

Format: **Mistake → Root cause → Rule going forward.**

---

## 2026-07-22

### 5. `data-dact` buttons are DEAD inside a `stopPropagation` modal
- **Mistake:** Built the approval editor, schedule editor, and preview footer
  using `data-dact` buttons, but those modals put `onclick="event.stopPropagation()"`
  on the inner container. The global `[data-dact]` click delegation lives on
  `document`, so stopPropagation killed every button (Back, Delete, Save, Save &
  send, Ask AMV to revise, Cancel, schedule Edit/Pause). The user hit ALL of them.
- **Root cause:** Two ways to close-on-backdrop coexist in this codebase. Modals
  that wire their own buttons with `on()` can use `stopPropagation`. Modals that
  rely on `data-dact` delegation CANNOT — the event must reach `document`.
- **Rule:** Inside any modal that uses `data-dact`, do NOT stopPropagation on the
  container. Instead close only when the backdrop itself is clicked:
  `on(bg,'click',e=>{ if(e.target===e.currentTarget) close(); })`. Test buttons
  with a real `.click()` through the delegation, not by calling the handler directly.

### 6. Two dash forms to purge, not one
- **Mistake:** First em-dash purge only replaced literal `—`/`–` bytes and missed
  the `—`/`–` **escape sequences** in JS string literals (255 of them in
  app.js) — which render as em-dashes at runtime.
- **Rule:** When purging a character from JS source, replace BOTH the literal char
  and its `\uXXXX` escape. And guard any regex that intentionally matches the char
  (write it with `\u` escapes so the purge can't neuter it).

## 2026-07-21

### 1. "Done" on the feature branch while the live host served old code
- **Mistake:** I told the owner fixes were live; their iPhone still showed the
  old broken UI. Rounds of "it still doesn't work" were actually an old deploy,
  not broken fixes.
- **Root cause:** Render deploys `main`. All my work was on
  `claude/push-files-github-09u7ye`. `main` was frozen at a pre-session commit
  (f09fdcd), so nothing I did reached the live site. I verified the *local*
  build, not the *deployed* artifact.
- **Rule:** "Verify live" means the artifact the host actually serves, not my
  local build. **Merge to `main` every time** (Render deploys `main`), push both
  branches, and confirm the deployed commit matches my work before saying "done."

### 2. Claimed a fix worked before confirming it on the real target
- **Mistake:** Reported fixes as complete based on local screenshots.
- **Root cause:** Conflated "the code is correct locally" with "the owner can see
  it working." These are different claims.
- **Rule:** Honesty rule (owner directive): never say a thing works until I've
  seen it work on the surface the owner will actually use. State exactly what I
  verified and where.

### 3. Edit tool failed to match unicode-escaped characters
- **Mistake:** `Edit` calls failed because `old_string` used literal `✓` / `—`
  but the source stored `✓` / em-dash escapes — no byte match.
- **Root cause:** Assumed on-screen glyph equals stored bytes.
- **Rule:** For source with unicode escapes, match on exact bytes — use a Python
  heredoc with index-based splice instead of the Edit tool when glyphs are
  involved.

### 4. Test port collision (EADDRINUSE :9100)
- **Mistake:** Ran a verification script while `npm run check` was still running;
  both bound port 9100 → crash.
- **Root cause:** Ran concurrent processes that claim the same fixed port.
- **Rule:** Don't run a test/verify script while the check gate is running. Wait
  for the background job to finish first.

---

## Standing reminders (owner directives — not mistakes, but never break these)
- Max quality, **no fake features** — works for real or degrades honestly.
- Honest degradation without keys; full power the moment keys are pasted.
- Never mention Claude/Anthropic in anything user-facing or pushed to the repo.
- Verify every change live. Go in order, one at a time. Review before delivering.
- Usable on **every** device. Hard to lose money. Building to be worth billions.
