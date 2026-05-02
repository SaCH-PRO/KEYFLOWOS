#!/usr/bin/env bash
#
# resolve-divergence-thresholds.sh
#
# Reads .github/branch-divergence-overrides.yml and, given $BRANCH (with
# defaults in $DEFAULT_MAX_COMMITS / $DEFAULT_MAX_FILES / $DEFAULT_MAX_LINES),
# emits the effective thresholds as GitHub Actions outputs:
#
#   max_commits=<int>
#   max_files=<int>
#   max_lines=<int>
#   reason=<string>   # empty when no override matched
#
# Override lookup is exact-match first, then glob (fnmatch via `case`). The
# first override that matches wins.
#
# This script intentionally avoids non-stdlib YAML parsing — the override
# file format is small and stable enough to parse with awk. If the format
# grows, swap to `yq` (already pinned in CI runners).

set -euo pipefail

BRANCH="${BRANCH:-}"
DEFAULT_MAX_COMMITS="${DEFAULT_MAX_COMMITS:-50}"
DEFAULT_MAX_FILES="${DEFAULT_MAX_FILES:-100}"
DEFAULT_MAX_LINES="${DEFAULT_MAX_LINES:-0}"

OVERRIDES_FILE=".github/branch-divergence-overrides.yml"

# Per-run scratch file for the parsed overrides table. Use mktemp so we
# never collide with another concurrent run reusing /tmp/overrides.tsv.
TSV="$(mktemp -t branch-divergence-overrides.XXXXXX.tsv)"
trap 'rm -f "$TSV"' EXIT

emit() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "max_commits=$1"
      echo "max_files=$2"
      echo "max_lines=$3"
      echo "reason=$4"
    } >> "$GITHUB_OUTPUT"
  fi
  echo "Resolved thresholds for branch '$BRANCH':"
  echo "  max_commits = $1"
  echo "  max_files   = $2"
  echo "  max_lines   = $3"
  if [[ -n "$4" ]]; then
    echo "  override    = $4"
  else
    echo "  override    = (none — using workflow defaults)"
  fi
}

if [[ -z "$BRANCH" ]] || [[ ! -f "$OVERRIDES_FILE" ]]; then
  emit "$DEFAULT_MAX_COMMITS" "$DEFAULT_MAX_FILES" "$DEFAULT_MAX_LINES" ""
  exit 0
fi

# Walk the YAML one override block at a time. We only support the keys
# documented in the override file: branch / max_commits / max_files /
# max_lines / reason / owner / expires.
awk '
  function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
  function strip_quotes(s) {
    if (length(s) >= 2 && ((substr(s,1,1)=="\"" && substr(s,length(s),1)=="\"") || (substr(s,1,1)=="'\''" && substr(s,length(s),1)=="'\''"))) {
      return substr(s, 2, length(s)-2)
    }
    return s
  }

  BEGIN {
    in_overrides = 0
    block = 0
    branch=""; mc=""; mf=""; ml=""; reason=""; owner=""; expires=""
  }

  /^[[:space:]]*#/ { next }
  /^overrides:[[:space:]]*\[\][[:space:]]*$/ { exit }
  /^overrides:[[:space:]]*$/ { in_overrides = 1; next }

  in_overrides && /^[[:space:]]*-[[:space:]]+branch:/ {
    if (block) {
      print branch "|" mc "|" mf "|" ml "|" reason "|" owner "|" expires
    }
    block = 1
    branch=""; mc=""; mf=""; ml=""; reason=""; owner=""; expires=""
    line = $0
    sub(/^[^:]*:[[:space:]]*/, "", line)
    branch = strip_quotes(trim(line))
    next
  }

  in_overrides && block && /^[[:space:]]+[a-z_]+:/ {
    key = $0
    sub(/^[[:space:]]+/, "", key)
    val = key
    sub(/^[a-z_]+:[[:space:]]*/, "", val)
    sub(/:[[:space:]].*/, "", key)
    val = strip_quotes(trim(val))
    if (key == "max_commits") mc = val
    else if (key == "max_files") mf = val
    else if (key == "max_lines") ml = val
    else if (key == "reason")    reason = val
    else if (key == "owner")     owner = val
    else if (key == "expires")   expires = val
    next
  }

  END {
    if (block) {
      print branch "|" mc "|" mf "|" ml "|" reason "|" owner "|" expires
    }
  }
' "$OVERRIDES_FILE" > "$TSV" || true

if [[ ! -s "$TSV" ]]; then
  emit "$DEFAULT_MAX_COMMITS" "$DEFAULT_MAX_FILES" "$DEFAULT_MAX_LINES" ""
  exit 0
fi

apply_match() {
  local ob="$1" mc="$2" mf="$3" ml="$4" reason="$5" owner="$6" expires="$7"
  local out_mc="${mc:-$DEFAULT_MAX_COMMITS}"
  local out_mf="${mf:-$DEFAULT_MAX_FILES}"
  local out_ml="${ml:-$DEFAULT_MAX_LINES}"
  local note="branch=$ob owner=${owner:-?} expires=${expires:-?} reason=${reason:-?}"
  if [[ -n "$expires" ]]; then
    local today
    today=$(date -u +%Y-%m-%d)
    if [[ "$today" > "$expires" ]]; then
      echo "::warning title=Stale divergence override::Override for '$ob' expired on $expires (today=$today). Remove it from .github/branch-divergence-overrides.yml or extend its expires date."
    fi
  fi
  emit "$out_mc" "$out_mf" "$out_ml" "$note"
}

# Two-pass matching: exact branch names beat glob patterns regardless of
# their order in the override file. This avoids surprises where an early
# glob (e.g. `feature/*`) silently wins over a later exact entry
# (`feature/critical-rebase`).
while IFS='|' read -r ob mc mf ml reason owner expires; do
  [[ -z "$ob" ]] && continue
  if [[ "$ob" == "$BRANCH" ]]; then
    apply_match "$ob" "$mc" "$mf" "$ml" "$reason" "$owner" "$expires"
    exit 0
  fi
done < "$TSV"

while IFS='|' read -r ob mc mf ml reason owner expires; do
  [[ -z "$ob" ]] && continue
  # Skip rows that lack a glob metacharacter — those were exact entries
  # we already considered above.
  case "$ob" in
    *'*'*|*'?'*|*'['*) ;;
    *) continue ;;
  esac
  case "$BRANCH" in
    $ob)
      apply_match "$ob" "$mc" "$mf" "$ml" "$reason" "$owner" "$expires"
      exit 0
      ;;
  esac
done < "$TSV"

emit "$DEFAULT_MAX_COMMITS" "$DEFAULT_MAX_FILES" "$DEFAULT_MAX_LINES" ""
