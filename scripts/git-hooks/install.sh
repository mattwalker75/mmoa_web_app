#!/usr/bin/env bash
# scripts/git-hooks/install.sh — wire up the repo's local git guards.
#
#   1. Installs scripts/git-hooks/pre-commit into .git/hooks (refuses commits
#      that contain live-looking secrets).
#   2. Marks config.json skip-worktree, so the copy on this machine — the one
#      with real keys — is invisible to `git status` / `git add -A` and can't
#      be staged by accident. The committed, scrubbed config.json stays
#      tracked and is what production clones.
#
# To deliberately commit a structural change to config.json:
#   git update-index --no-skip-worktree config.json
#   (scrub the values, stage, commit)
#   git update-index --skip-worktree config.json
set -euo pipefail
cd "$(dirname "$0")/../.."

install -m 0755 scripts/git-hooks/pre-commit .git/hooks/pre-commit
echo "[git-hooks] installed .git/hooks/pre-commit"

if git ls-files --error-unmatch config.json >/dev/null 2>&1; then
  git update-index --skip-worktree config.json
  echo "[git-hooks] config.json marked skip-worktree (local edits hidden from git add/status)"
fi
