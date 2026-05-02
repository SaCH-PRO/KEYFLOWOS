#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="${1:-develop}"
OUT_DIR="${2:-/opt/cursor/artifacts}"
OUT_FILE="$OUT_DIR/repo_health_audit_$(date +%Y%m%d_%H%M%S).md"

mkdir -p "$OUT_DIR"

{
  echo "# Repo Health Audit"
  echo
  echo "- Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
  echo "- Base branch: \`$BASE_BRANCH\`"
  echo
  echo "## Current Git State"
  echo
  echo '```'
  git status -sb
  echo '```'
  echo
  echo "## Local Branches"
  echo
  echo '```'
  git branch -vv
  echo '```'
  echo
  echo "## Open Pull Requests"
  echo
  echo '```'
  gh pr list --state open --limit 50 || true
  echo '```'
  echo
  echo "## Branch Divergence vs $BASE_BRANCH"
  echo
  echo "| Branch | Behind/Ahead vs $BASE_BRANCH |"
  echo "|---|---|"
  while read -r branch; do
    if [[ "$branch" == "$BASE_BRANCH" ]]; then
      continue
    fi
    if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      counts="$(git rev-list --left-right --count "$BASE_BRANCH...origin/$branch" 2>/dev/null || echo "n/a")"
      echo "| \`$branch\` | \`$counts\` |"
    fi
  done < <(git for-each-ref --format='%(refname:short)' refs/heads)
  echo
  echo "## Vercel Status Snapshot (Open PRs)"
  echo
  while read -r prnum; do
    [[ -z "$prnum" ]] && continue
    echo "### PR #$prnum"
    echo
    echo '```'
    gh pr checks "$prnum" || true
    echo '```'
    echo
  done < <(gh pr list --state open --limit 50 --json number --jq '.[].number' || true)
} > "$OUT_FILE"

echo "$OUT_FILE"
