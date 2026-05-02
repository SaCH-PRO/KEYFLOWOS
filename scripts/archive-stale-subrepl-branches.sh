#!/usr/bin/env bash
#
# archive-stale-subrepl-branches.sh
#
# Find local `subrepl-*` branches whose tip commit is older than N days,
# tag each one as `archive/<branch>-<YYYY-MM-DD>`, push the tag to origin
# (verifying it lands), and only then delete the local branch.
#
# This is the safety net for the recurrence the Branch Hygiene Policy
# (docs/branch-hygiene-policy.md) prevents: when subrepl-* branches pile
# up because task-merge cleanup didn't run, this script archives them
# without ever discarding work.
#
# DRY-RUN BY DEFAULT. Pass --apply to actually create tags / delete
# branches. Without --apply, the script prints exactly what it would do.
#
# Usage:
#   scripts/archive-stale-subrepl-branches.sh [options]
#
# Options:
#   --days N            Branches with tip commits older than N days are
#                       eligible. Default: 14.
#   --apply             Actually tag, push, and delete. Without this flag
#                       the script only prints the plan.
#   --remote NAME       Push tags to this remote. Default: origin.
#   --pattern GLOB      Branch name glob to scan. Default: subrepl-*.
#   --tag-date YYYY-MM-DD
#                       Date suffix on the archive tag. Default: today
#                       (UTC).
#   --skip BRANCH       Skip a specific branch (repeatable). Use this for
#                       any branch tied to an IN_PROGRESS task that the
#                       caller knows about.
#   --skip-merged       Skip branches that are already merged into main.
#                       Useful when you only want to clean up unmerged
#                       work. Default is OFF — by default merged branches
#                       are still archived and deleted, because the cost
#                       of an extra archive tag is zero and the policy
#                       (docs/branch-hygiene-policy.md, Rule 4) is
#                       archive-first for every deletion.
#   --no-skip-merged    Include already-merged branches (the default).
#                       Provided for symmetry with --skip-merged.
#   --require-archive-on-remote
#                       After pushing the tag, re-fetch and verify the
#                       tag exists on the remote before deleting the
#                       local branch. Default: ON. Pass
#                       --no-require-archive-on-remote to disable (NOT
#                       recommended).
#   --no-require-archive-on-remote
#                       Skip the remote verification step (dangerous).
#   -h | --help         Print this help.
#
# Exit codes:
#   0  All eligible branches processed (or none eligible).
#   1  At least one branch could not be archived/deleted safely.
#   2  Argument or environment error.
#
# Recovery:
#   To restore a deleted branch from its archive tag:
#     git fetch origin --tags
#     git checkout -b <branch> archive/<branch>-<YYYY-MM-DD>

set -euo pipefail

print_help() {
  sed -n '2,/^set -euo pipefail/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo pipefail/d'
}

DAYS=14
APPLY=0
REMOTE="origin"
PATTERN="subrepl-*"
TAG_DATE="$(date -u +%Y-%m-%d)"
SKIP_LIST=()
SKIP_MERGED=0
REQUIRE_ARCHIVE_ON_REMOTE=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)              DAYS="$2"; shift 2 ;;
    --apply)             APPLY=1; shift ;;
    --remote)            REMOTE="$2"; shift 2 ;;
    --pattern)           PATTERN="$2"; shift 2 ;;
    --tag-date)          TAG_DATE="$2"; shift 2 ;;
    --skip)              SKIP_LIST+=("$2"); shift 2 ;;
    --skip-merged)       SKIP_MERGED=1; shift ;;
    --no-skip-merged)    SKIP_MERGED=0; shift ;;
    --require-archive-on-remote)    REQUIRE_ARCHIVE_ON_REMOTE=1; shift ;;
    --no-require-archive-on-remote) REQUIRE_ARCHIVE_ON_REMOTE=0; shift ;;
    -h|--help)           print_help; exit 0 ;;
    *) echo "error: unknown option $1" >&2; exit 2 ;;
  esac
done

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 2
fi

if ! git remote | grep -qx "$REMOTE"; then
  echo "error: remote '$REMOTE' not configured" >&2
  exit 2
fi

NOW=$(date -u +%s)
CUTOFF=$((NOW - DAYS * 86400))

is_skipped() {
  local b="$1"
  for s in "${SKIP_LIST[@]:-}"; do
    [[ -z "$s" ]] && continue
    [[ "$s" == "$b" ]] && return 0
  done
  return 1
}

is_merged_into_main() {
  local b="$1"
  if git rev-parse --verify --quiet main >/dev/null; then
    git merge-base --is-ancestor "$b" main
  else
    return 1
  fi
}

mode_label="DRY-RUN"
[[ "$APPLY" -eq 1 ]] && mode_label="APPLY"
echo "archive-stale-subrepl-branches: mode=$mode_label remote=$REMOTE pattern='$PATTERN' days=$DAYS tag-date=$TAG_DATE"

declare -i eligible=0
declare -i archived=0
declare -i deleted=0
declare -i skipped=0
declare -i errors=0

while read -r branch sha ts; do
  [[ -z "$branch" ]] && continue
  if (( ts > CUTOFF )); then
    continue
  fi
  if is_skipped "$branch"; then
    echo "  skip (--skip): $branch"
    skipped+=1
    continue
  fi

  if [[ "$SKIP_MERGED" -eq 1 ]] && is_merged_into_main "$branch"; then
    echo "  skip (--skip-merged; already in main): $branch"
    skipped+=1
    continue
  fi

  eligible+=1
  tag="archive/${branch}-${TAG_DATE}"
  echo "* $branch  sha=$sha  age=$(( (NOW - ts) / 86400 ))d  -> $tag"

  if [[ "$APPLY" -eq 0 ]]; then
    if is_merged_into_main "$branch"; then
      echo "    (would tag, push, then 'git branch -d $branch' — merged into main)"
    else
      echo "    (would tag, push, verify on $REMOTE, then 'git branch -D $branch')"
    fi
    continue
  fi

  if git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
    echo "    tag $tag already exists locally; skipping create"
  else
    if ! git tag "$tag" "$branch"; then
      echo "    error: failed to create tag $tag" >&2
      errors+=1
      continue
    fi
  fi

  if ! git push "$REMOTE" "refs/tags/$tag:refs/tags/$tag"; then
    echo "    error: failed to push tag $tag to $REMOTE" >&2
    errors+=1
    continue
  fi
  archived+=1

  if [[ "$REQUIRE_ARCHIVE_ON_REMOTE" -eq 1 ]]; then
    if ! git ls-remote --tags "$REMOTE" "refs/tags/$tag" | grep -q "refs/tags/$tag$"; then
      echo "    error: tag $tag not visible on $REMOTE after push; refusing to delete branch" >&2
      errors+=1
      continue
    fi
  fi

  if is_merged_into_main "$branch"; then
    if git branch -d "$branch"; then
      deleted+=1
    else
      echo "    error: 'git branch -d $branch' refused; archive tag is safe; investigate manually" >&2
      errors+=1
    fi
  else
    if git branch -D "$branch"; then
      deleted+=1
    else
      echo "    error: 'git branch -D $branch' failed" >&2
      errors+=1
    fi
  fi
done < <(git for-each-ref \
            --format='%(refname:short) %(objectname:short) %(committerdate:unix)' \
            "refs/heads/${PATTERN}")

echo
echo "Summary: eligible=$eligible archived=$archived deleted=$deleted skipped=$skipped errors=$errors"
if [[ "$APPLY" -eq 0 ]]; then
  echo "(dry-run; re-run with --apply to actually archive and delete)"
fi
if (( errors > 0 )); then
  exit 1
fi
exit 0
