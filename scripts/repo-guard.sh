#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="${1:-develop}"
REMOTE_BASE="origin/$BASE_BRANCH"

if ! git show-ref --verify --quiet "refs/remotes/$REMOTE_BASE"; then
  echo "Missing $REMOTE_BASE. Run: git fetch origin $BASE_BRANCH"
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"

# In CI (e.g. GitHub Actions), checkout can be detached HEAD.
# Fall back to provided ref metadata in that case.
if [[ -z "$CURRENT_BRANCH" ]]; then
  CURRENT_BRANCH="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
fi

if [[ -z "$CURRENT_BRANCH" ]]; then
  echo "Unable to determine current branch."
  echo "Tried git branch, GITHUB_HEAD_REF, and GITHUB_REF_NAME."
  exit 1
fi

if [[ "$CURRENT_BRANCH" != "$BASE_BRANCH" && "$CURRENT_BRANCH" != cursor/* ]]; then
  echo "Invalid working branch: $CURRENT_BRANCH"
  echo "Use '$BASE_BRANCH' or a 'cursor/*' branch."
  exit 1
fi

if [[ "$CURRENT_BRANCH" == cursor/* ]]; then
  local_ahead="$(git rev-list --left-right --count "$REMOTE_BASE...$CURRENT_BRANCH" | awk '{print $2}')"
  if [[ "${local_ahead:-0}" == "0" ]]; then
    echo "Branch '$CURRENT_BRANCH' has no unique commits ahead of $REMOTE_BASE."
    echo "Close/delete this branch if superseded."
    exit 1
  fi
fi

OPEN_PRS_JSON="$(gh pr list --state open --limit 100 --json number,headRefName,title 2>/dev/null || echo "[]")"
CURRENT_PR_COUNT="$(printf '%s' "$OPEN_PRS_JSON" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const branch = process.argv[1];
const hits = data.filter((pr) => pr.headRefName === branch);
process.stdout.write(String(hits.length));
' "$CURRENT_BRANCH")"

if [[ "$CURRENT_BRANCH" == cursor/* && "$CURRENT_PR_COUNT" -gt 1 ]]; then
  echo "Branch '$CURRENT_BRANCH' has multiple open PRs. Keep one PR per branch."
  exit 1
fi

echo "repo-guard passed for branch '$CURRENT_BRANCH' against '$REMOTE_BASE'."
