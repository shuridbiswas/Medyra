#!/usr/bin/env bash
# Commits engineering/ to the engineering-state branch so state survives the ephemeral runner.
# Used only by .github/workflows/autonomous-development.yml. Never force-pushes; a rejected push
# (another writer got there first) fails the job instead of overwriting their state.
set -euo pipefail
message="${1:-state}"
tmp="$(mktemp -d)"
cp -R engineering "$tmp/engineering"
if git ls-remote --exit-code origin engineering-state >/dev/null; then
  git fetch origin engineering-state
  git worktree add "$tmp/wt" origin/engineering-state
else
  git worktree add --detach "$tmp/wt" HEAD
fi
rm -rf "$tmp/wt/engineering"
cp -R "$tmp/engineering" "$tmp/wt/engineering"
cd "$tmp/wt"
git add engineering
if git diff --cached --quiet; then
  echo "no state change"
  exit 0
fi
git commit -m "engineering state: $message"
git push origin HEAD:refs/heads/engineering-state
