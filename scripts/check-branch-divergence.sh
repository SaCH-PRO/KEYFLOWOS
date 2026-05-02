#!/usr/bin/env bash
#
# check-branch-divergence.sh
#
# Compare two named git branches and exit non-zero when their divergence
# exceeds a configurable threshold (commit count or files changed).
#
# Designed to be wired into CI later as a guardrail against the kind of
# 60/31-commit + 247-file split that develop and main accumulated before
# Task #238 / #240. It is intentionally read-only — never mutates refs.
#
# Usage:
#   scripts/check-branch-divergence.sh <ref-a> <ref-b> [options]
#
# Options:
#   --max-commits N      Fail if either side has more than N unique commits.
#                        Default: 50.
#   --max-files N        Fail if `git diff --name-only A B` lists more than
#                        N files. Default: 100.
#   --max-lines N        Fail if combined inserted+deleted lines exceed N.
#                        Default: 0 (disabled).
#   --fetch              Run `git fetch --no-tags --quiet` for both refs'
#                        remotes before measuring. Default: off.
#   --json               Emit a single JSON object to stdout instead of the
#                        human-readable table.
#   -h | --help          Print this help.
#
# Exit codes:
#   0  Within all configured thresholds.
#   1  Threshold exceeded (the script prints which one).
#   2  Argument or git error (refs missing, etc.).
#
# Examples:
#   scripts/check-branch-divergence.sh main develop
#   scripts/check-branch-divergence.sh main origin/develop --max-commits 25
#   scripts/check-branch-divergence.sh main feature/x --json --fetch

set -euo pipefail

print_help() {
  sed -n '2,/^set -euo pipefail/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo pipefail/d'
}

if [[ $# -lt 1 ]] || [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
  print_help
  exit 0
fi

if [[ $# -lt 2 ]]; then
  echo "error: need exactly two refs" >&2
  echo "usage: $0 <ref-a> <ref-b> [options]" >&2
  exit 2
fi

REF_A="$1"
REF_B="$2"
shift 2

MAX_COMMITS=50
MAX_FILES=100
MAX_LINES=0
DO_FETCH=0
JSON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-commits) MAX_COMMITS="$2"; shift 2 ;;
    --max-files)   MAX_FILES="$2";   shift 2 ;;
    --max-lines)   MAX_LINES="$2";   shift 2 ;;
    --fetch)       DO_FETCH=1;       shift ;;
    --json)        JSON=1;           shift ;;
    -h|--help)     print_help; exit 0 ;;
    *) echo "error: unknown option $1" >&2; exit 2 ;;
  esac
done

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 2
fi

if [[ "$DO_FETCH" -eq 1 ]]; then
  for r in "$REF_A" "$REF_B"; do
    remote="${r%%/*}"
    if git remote | grep -qx "$remote"; then
      git fetch --no-tags --quiet "$remote" || true
    fi
  done
fi

for r in "$REF_A" "$REF_B"; do
  if ! git rev-parse --verify --quiet "$r" >/dev/null; then
    echo "error: ref '$r' not found" >&2
    exit 2
  fi
done

SHA_A=$(git rev-parse "$REF_A")
SHA_B=$(git rev-parse "$REF_B")

# `git rev-list --left-right --count A...B` -> "<left> <right>" (tab separated)
read -r LEFT RIGHT < <(git rev-list --left-right --count "$REF_A...$REF_B")

FILES=$(git diff --name-only "$REF_A" "$REF_B" | wc -l | tr -d ' ')

# shortstat format:  "X files changed, Y insertions(+), Z deletions(-)"
SHORTSTAT=$(git diff --shortstat "$REF_A" "$REF_B" 2>/dev/null || echo "")
INS=$(echo "$SHORTSTAT" | grep -oE '[0-9]+ insertions' | head -1 | grep -oE '[0-9]+' || true)
DEL=$(echo "$SHORTSTAT" | grep -oE '[0-9]+ deletions'  | head -1 | grep -oE '[0-9]+' || true)
INS=${INS:-0}
DEL=${DEL:-0}
LINES=$((INS + DEL))

EXCEEDED=()
if (( LEFT > MAX_COMMITS )); then
  EXCEEDED+=("commits-on-$REF_A:$LEFT>$MAX_COMMITS")
fi
if (( RIGHT > MAX_COMMITS )); then
  EXCEEDED+=("commits-on-$REF_B:$RIGHT>$MAX_COMMITS")
fi
if (( FILES > MAX_FILES )); then
  EXCEEDED+=("files:$FILES>$MAX_FILES")
fi
if (( MAX_LINES > 0 )) && (( LINES > MAX_LINES )); then
  EXCEEDED+=("lines:$LINES>$MAX_LINES")
fi

if [[ "$JSON" -eq 1 ]]; then
  printf '{"ref_a":"%s","sha_a":"%s","ref_b":"%s","sha_b":"%s","commits_unique_to_a":%s,"commits_unique_to_b":%s,"files_changed":%s,"insertions":%s,"deletions":%s,"thresholds":{"max_commits":%s,"max_files":%s,"max_lines":%s},"exceeded":[' \
    "$REF_A" "$SHA_A" "$REF_B" "$SHA_B" "$LEFT" "$RIGHT" "$FILES" "$INS" "$DEL" "$MAX_COMMITS" "$MAX_FILES" "$MAX_LINES"
  first=1
  for x in "${EXCEEDED[@]:-}"; do
    [[ -z "$x" ]] && continue
    if [[ $first -eq 1 ]]; then first=0; else printf ','; fi
    printf '"%s"' "$x"
  done
  printf ']}\n'
else
  echo "Branch divergence: $REF_A  <->  $REF_B"
  printf "  %-32s %s\n" "$REF_A"               "$SHA_A"
  printf "  %-32s %s\n" "$REF_B"               "$SHA_B"
  printf "  %-32s %s\n" "commits unique to A:" "$LEFT"
  printf "  %-32s %s\n" "commits unique to B:" "$RIGHT"
  printf "  %-32s %s\n" "files changed:"       "$FILES"
  printf "  %-32s +%s / -%s (= %s lines)\n" "diff lines:" "$INS" "$DEL" "$LINES"
  printf "  %-32s commits=%s files=%s lines=%s\n" "thresholds:" "$MAX_COMMITS" "$MAX_FILES" "$MAX_LINES"
  if [[ "${#EXCEEDED[@]}" -gt 0 ]]; then
    echo "  EXCEEDED: ${EXCEEDED[*]}"
  else
    echo "  status: OK"
  fi
fi

if [[ "${#EXCEEDED[@]}" -gt 0 ]]; then
  exit 1
fi
exit 0
