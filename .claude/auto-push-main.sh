#!/usr/bin/env bash
# Auto-sync committed work to main. Safety net so no finished change is left
# only on the feature branch (Render deploys main). Runs on Stop.
# Deliberately conservative: does NOTHING unless the tree is clean, we're on the
# designated feature branch, and there are new commits past origin/main.
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

# Push the feature branch, then fast-forward main to it (main is always an
# ancestor of this branch, so this is a clean fast-forward — never a force).
out=""
if git push origin "$branch:$branch" --quiet 2>&1 && git push origin "HEAD:main" --quiet 2>&1; then
  printf '{"systemMessage":"Auto-synced %s to main (%s)"}\n' "$branch" "$(git rev-parse --short HEAD)"
else
  printf '{"systemMessage":"Auto-push to main FAILED — push manually"}\n'
fi
exit 0
