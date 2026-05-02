#!/usr/bin/env bash
#
# sweep-divergence.sh
#
# Runs scripts/check-branch-divergence.sh against `origin/main` for either
# a single branch (when $BRANCH is set) or every non-main branch on origin
# (when $BRANCH is empty). Writes a per-branch row into the workflow
# summary and exits non-zero if ANY branch exceeded the thresholds.
#
# Used by the scheduled and workflow_dispatch jobs in
# .github/workflows/branch-divergence.yml.

set -uo pipefail

BRANCH="${BRANCH:-}"
MAX_COMMITS="${MAX_COMMITS:-50}"
MAX_FILES="${MAX_FILES:-100}"
MAX_LINES="${MAX_LINES:-0}"

POLICY_URL="https://github.com/${GITHUB_REPOSITORY:-OWNER/REPO}/blob/main/docs/branch-hygiene-policy.md#rule-5--detect-divergence-early"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

# Build the list of branches to check.
declare -a branches=()
if [[ -n "$BRANCH" ]]; then
  branches+=("$BRANCH")
else
  while IFS= read -r ref; do
    # Only keep refs that actually live under origin/, i.e. real remote
    # branches. Skips bare "origin", any "origin/HEAD" symbolic ref, and
    # main itself.
    [[ "$ref" != origin/* ]] && continue
    name="${ref#origin/}"
    [[ "$name" == "HEAD" ]] && continue
    [[ "$name" == "main" ]] && continue
    [[ -z "$name" ]] && continue
    branches+=("$name")
  done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin/)
fi

if [[ ${#branches[@]} -eq 0 ]]; then
  echo "No non-main branches found on origin to check." | tee -a "$summary_file"
  exit 0
fi

{
  echo "## Branch divergence sweep"
  echo
  echo "Compared against \`origin/main\`. Thresholds: commits=$MAX_COMMITS files=$MAX_FILES lines=$MAX_LINES."
  echo
  echo "| Branch | Status | Commits ahead (branch / main) | Files | Lines (+/-) | Notes |"
  echo "| ------ | ------ | ----------------------------- | ----- | ----------- | ----- |"
} >> "$summary_file"

overall_status=0
checked=0
failed=0

for b in "${branches[@]}"; do
  if ! git rev-parse --verify --quiet "origin/$b" >/dev/null; then
    echo "| \`$b\` | skipped | — | — | — | ref not found on origin |" >> "$summary_file"
    continue
  fi

  checked=$((checked + 1))

  # Per-branch override resolution. Point the resolver's GITHUB_OUTPUT at
  # a per-iteration mktemp file so we read its STRUCTURED key=value output
  # (the same contract the per-push job consumes via Actions outputs)
  # rather than the human-readable log lines. The resolver also prints
  # `::warning` lines on stale overrides; we forward those to stderr so
  # GitHub Actions still surfaces them in the run log.
  RESOLVED_FILE="$(mktemp -t resolved-divergence.XXXXXX.env)"
  RESOLVED_LOG="$(mktemp -t resolved-divergence.XXXXXX.log)"
  BRANCH="$b" \
    DEFAULT_MAX_COMMITS="$MAX_COMMITS" \
    DEFAULT_MAX_FILES="$MAX_FILES" \
    DEFAULT_MAX_LINES="$MAX_LINES" \
    GITHUB_OUTPUT="$RESOLVED_FILE" \
    bash scripts/ci/resolve-divergence-thresholds.sh > "$RESOLVED_LOG" 2>&1 || true
  while IFS= read -r line; do
    [[ "$line" == ::warning* ]] && echo "$line" >&2
  done < "$RESOLVED_LOG"
  bmc=$(awk -F= '/^max_commits=/ {print $2; exit}' "$RESOLVED_FILE")
  bmf=$(awk -F= '/^max_files=/   {print $2; exit}' "$RESOLVED_FILE")
  bml=$(awk -F= '/^max_lines=/   {print $2; exit}' "$RESOLVED_FILE")
  override_note=$(awk -F= '/^reason=/ {print substr($0, length($1)+2); exit}' "$RESOLVED_FILE")
  rm -f "$RESOLVED_FILE" "$RESOLVED_LOG"
  bmc="${bmc:-$MAX_COMMITS}"
  bmf="${bmf:-$MAX_FILES}"
  bml="${bml:-$MAX_LINES}"

  # Capture both the JSON payload and the script's exit code without the
  # `|| true` shortcut (which would mask the non-zero rc we rely on for
  # the threshold-exceeded signal).
  json=$(scripts/check-branch-divergence.sh \
           "origin/main" "origin/$b" \
           --max-commits "$bmc" \
           --max-files "$bmf" \
           --max-lines "$bml" \
           --json 2>/dev/null)
  rc=$?

  if [[ -z "$json" ]]; then
    echo "| \`$b\` | error | — | — | — | check-branch-divergence.sh failed |" >> "$summary_file"
    overall_status=1
    failed=$((failed + 1))
    continue
  fi

  # Parse with jq when available (preinstalled on ubuntu-latest runners) so
  # we tolerate any future format tweaks in check-branch-divergence.sh
  # (e.g. new fields, reordered keys). Fall back to sed string-matching
  # only if jq is missing — guardrail continuity beats parser fidelity.
  if command -v jq >/dev/null 2>&1; then
    left=$(echo  "$json" | jq -r '.commits_unique_to_a // 0')
    right=$(echo "$json" | jq -r '.commits_unique_to_b // 0')
    files=$(echo "$json" | jq -r '.files_changed // 0')
    ins=$(echo   "$json" | jq -r '.insertions // 0')
    del=$(echo   "$json" | jq -r '.deletions // 0')
    exceeded=$(echo "$json" | jq -r '.exceeded | map("\"" + . + "\"") | join(",")')
  else
    left=$(echo "$json"  | sed -n 's/.*"commits_unique_to_a":\([0-9]*\).*/\1/p')
    right=$(echo "$json" | sed -n 's/.*"commits_unique_to_b":\([0-9]*\).*/\1/p')
    files=$(echo "$json" | sed -n 's/.*"files_changed":\([0-9]*\).*/\1/p')
    ins=$(echo "$json"   | sed -n 's/.*"insertions":\([0-9]*\).*/\1/p')
    del=$(echo "$json"   | sed -n 's/.*"deletions":\([0-9]*\).*/\1/p')
    exceeded=$(echo "$json" | sed -n 's/.*"exceeded":\[\(.*\)\]}.*/\1/p')
  fi

  if [[ "$rc" -eq 0 ]]; then
    status_cell="OK"
  else
    status_cell="**EXCEEDED**"
    overall_status=1
    failed=$((failed + 1))
    echo "::warning title=Branch divergence::Branch '$b' exceeded thresholds: $exceeded — see $POLICY_URL"
  fi

  notes="${override_note:-}"
  [[ -n "$exceeded" ]] && notes="${notes:+$notes; }$exceeded"

  echo "| \`$b\` | $status_cell | ${right:-?} / ${left:-?} | ${files:-?} | +${ins:-0} / -${del:-0} | ${notes:-—} |" >> "$summary_file"
done

{
  echo
  echo "Checked $checked branch(es); $failed exceeded thresholds."
  if [[ "$overall_status" -ne 0 ]]; then
    echo
    echo "See [Rule 5 of the branch hygiene policy]($POLICY_URL) for next steps,"
    echo "or add a per-branch override in \`.github/branch-divergence-overrides.yml\`."
  fi
} >> "$summary_file"

exit "$overall_status"
