#!/usr/bin/env bash
#
# render-divergence-summary.sh
#
# Writes a Markdown summary of the divergence check to $GITHUB_STEP_SUMMARY
# so the result is visible on the GitHub Actions run page without needing
# to expand the raw log. Reads ./divergence.json produced by the prior
# step (output of `check-branch-divergence.sh --json`).

set -euo pipefail

STATUS="${STATUS:-0}"
BRANCH="${BRANCH:-unknown}"
MAX_COMMITS="${MAX_COMMITS:-?}"
MAX_FILES="${MAX_FILES:-?}"
MAX_LINES="${MAX_LINES:-?}"
OVERRIDE_REASON="${OVERRIDE_REASON:-}"

POLICY_URL="https://github.com/${GITHUB_REPOSITORY:-OWNER/REPO}/blob/main/docs/branch-hygiene-policy.md#rule-5--detect-divergence-early"

summary_file="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

{
  if [[ "$STATUS" == "0" ]]; then
    echo "## ✓ Branch divergence within thresholds"
  else
    echo "## ✗ Branch divergence threshold exceeded"
    echo
    echo "Branch \`$BRANCH\` has drifted past the configured thresholds."
    echo "See [Rule 5 of the branch hygiene policy]($POLICY_URL) for the"
    echo "rebase / merge / archive decision tree, or add an override in"
    echo "\`.github/branch-divergence-overrides.yml\` if the drift is"
    echo "expected (e.g. an in-flight large refactor)."
  fi

  echo
  echo "| Field | Value |"
  echo "| ----- | ----- |"
  echo "| Branch | \`$BRANCH\` |"
  echo "| Compared against | \`origin/main\` |"
  echo "| Threshold (commits / side) | $MAX_COMMITS |"
  echo "| Threshold (files) | $MAX_FILES |"
  echo "| Threshold (lines) | $MAX_LINES |"
  if [[ -n "$OVERRIDE_REASON" ]]; then
    echo "| Override applied | $OVERRIDE_REASON |"
  fi

  if [[ -f divergence.json ]]; then
    echo
    echo "<details><summary>Raw measurements (JSON)</summary>"
    echo
    echo '```json'
    cat divergence.json
    echo
    echo '```'
    echo "</details>"
  fi
} >> "$summary_file"
