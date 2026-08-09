#!/usr/bin/env bash
# Auto-sync committed work. Safety net so no finished change is left only on the
# feature branch. Runs on Stop.
# Deliberately conservative: does NOTHING unless the tree is clean, we're on the
# designated feature branch, and there are new commits past origin/main.
#
# MAIN MOVES ONLY ON A COMMIT THE GATE HAS PASSED.
#
# Render deploys main, so fast-forwarding it on every commit deployed whatever
# had just been committed - including a commit that was red for the few minutes
# before the follow-up fixed it. That is where a mailbox full of CI failure mail
# came from: not one broken thing, but unproven commits reaching main.
# `npm run check` writes .gate-pass with the SHA it passed on. The branch is
# still pushed unconditionally, so work is never stranded; main waits.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT" || exit 0

BRANCH_EXPECTED="claude/push-files-github-09u7ye"

# 1. Never push a work-in-progress tree.
[ -z "$(git status --porcelain)" ] || exit 0
# 2. Only auto-sync the designated feature branch.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
[ "$branch" = "$BRANCH_EXPECTED" ] || exit 0
# 3. Only act when the branch is ahead of what main already has locally.
head="$(git rev-parse HEAD 2>/dev/null)"
base="$(git rev-parse origin/main 2>/dev/null || echo none)"
[ "$head" != "$base" ] || exit 0

# The branch always goes up: unproven is not the same as unwanted, and work that
# only exists on one machine is the thing this hook was written to prevent.
if ! git push origin "$branch:$branch" --quiet 2>&1; then
  printf '{"systemMessage":"Push of %s FAILED — push manually"}\n' "$branch"
  exit 0
fi

# Has the full gate passed on exactly this commit?
gate=""
[ -f .gate-pass ] && gate="$(tr -d '[:space:]' < .gate-pass)"
if [ "$gate" != "$head" ]; then
  printf '{"systemMessage":"Pushed %s to its branch. main NOT moved: npm run check has not passed on %s, and Render deploys main. Run the gate, then it syncs."}\n' \
    "$branch" "$(git rev-parse --short HEAD)"
  exit 0
fi

# Proven. Fast-forward main to it (main is always an ancestor of this branch, so
# this is a clean fast-forward — never a force).
if git push origin "HEAD:main" --quiet 2>&1; then
  printf '{"systemMessage":"Auto-synced %s to main (%s, gate passed)"}\n' "$branch" "$(git rev-parse --short HEAD)"
else
  printf '{"systemMessage":"Branch pushed, but main did NOT move — push manually"}\n'
fi
exit 0
