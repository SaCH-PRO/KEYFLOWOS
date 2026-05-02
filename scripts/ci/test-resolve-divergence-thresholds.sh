#!/usr/bin/env bash
#
# test-resolve-divergence-thresholds.sh
#
# Lightweight regression test for scripts/ci/resolve-divergence-thresholds.sh.
# Covers the matching cases that the CI workflow relies on:
#   - exact match
#   - glob match
#   - exact-beats-glob precedence (regardless of file order)
#   - no match -> defaults
#   - empty / missing override file
#   - expired override emits a ::warning line
#
# Run with `bash scripts/ci/test-resolve-divergence-thresholds.sh`. Exits
# non-zero on the first failure. Intended to be invokable from a future CI
# job or local pre-commit hook.

set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/resolve-divergence-thresholds.sh"
WORK=$(mktemp -d)
OVERRIDES_FILE="$WORK/.github/branch-divergence-overrides.yml"
mkdir -p "$WORK/.github"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

pass=0
fail=0

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  OK   $label"
    pass=$((pass + 1))
  else
    echo "  FAIL $label: expected [$expected], got [$actual]"
    fail=$((fail + 1))
  fi
}

run() {
  # run <branch> <fixture-name> -> sets globals MC, MF, ML, NOTE, WARN
  local branch="$1" fixture="$2"
  local out_file="$WORK/out.env"
  : > "$out_file"
  local stderr_file="$WORK/stderr.log"
  : > "$stderr_file"
  (
    cd "$WORK" && \
      BRANCH="$branch" \
      DEFAULT_MAX_COMMITS=50 \
      DEFAULT_MAX_FILES=100 \
      DEFAULT_MAX_LINES=0 \
      GITHUB_OUTPUT="$out_file" \
      bash "$SCRIPT" >"$stderr_file" 2>&1
  )
  MC=$(awk -F= '/^max_commits=/ {print $2; exit}' "$out_file")
  MF=$(awk -F= '/^max_files=/   {print $2; exit}' "$out_file")
  ML=$(awk -F= '/^max_lines=/   {print $2; exit}' "$out_file")
  NOTE=$(awk -F= '/^reason=/    {print substr($0, length($1)+2); exit}' "$out_file")
  WARN=$(grep '^::warning' "$stderr_file" || true)
}

# ---------------------------------------------------------------------------
# Fixture 1: exact + glob, glob listed first to test precedence.
# ---------------------------------------------------------------------------
cat > "$OVERRIDES_FILE" <<'EOF'
overrides:
  - branch: feature/*
    max_commits: 200
    max_files: 400
    reason: "default for feature branches"
    owner: alice
  - branch: feature/critical-rebase
    max_commits: 999
    max_files: 999
    reason: "explicit exact entry"
    owner: bob
  - branch: spike/*
    max_commits: 75
    reason: "spike default"
    owner: alice
  - branch: refactor/storage-layer
    max_commits: 250
    max_files: 500
    reason: "storage rewrite"
    owner: bob
    expires: 2026-06-15
  - branch: legacy/expired-test
    max_commits: 999
    reason: "intentionally expired override for the test suite"
    owner: testbot
    expires: 2020-01-01
EOF

echo "Test 1: exact match wins over earlier glob"
run "feature/critical-rebase" "$OVERRIDES_FILE"
assert_eq "max_commits" "999" "$MC"
assert_eq "max_files"   "999" "$MF"

echo "Test 2: glob fallback when no exact match exists"
run "feature/random-thing" "$OVERRIDES_FILE"
assert_eq "max_commits" "200" "$MC"
assert_eq "max_files"   "400" "$MF"

echo "Test 3: glob matches with branch using slashes"
run "spike/auth-redo" "$OVERRIDES_FILE"
assert_eq "max_commits" "75"  "$MC"
assert_eq "max_files"   "100" "$MF"  # falls back to default

echo "Test 4: exact match for a non-glob entry"
run "refactor/storage-layer" "$OVERRIDES_FILE"
assert_eq "max_commits" "250" "$MC"
assert_eq "max_files"   "500" "$MF"

echo "Test 5: expired override emits ::warning"
run "legacy/expired-test" "$OVERRIDES_FILE"
if [[ -n "$WARN" ]]; then
  echo "  OK   warning emitted: $WARN"
  pass=$((pass + 1))
else
  echo "  FAIL no ::warning line for expired override"
  fail=$((fail + 1))
fi

echo "Test 6: no match -> workflow defaults"
run "totally-unmatched-branch" "$OVERRIDES_FILE"
assert_eq "max_commits" "50"  "$MC"
assert_eq "max_files"   "100" "$MF"
assert_eq "max_lines"   "0"   "$ML"
assert_eq "reason"      ""    "$NOTE"

# ---------------------------------------------------------------------------
# Fixture 2: empty overrides (the shipped default).
# ---------------------------------------------------------------------------
cat > "$OVERRIDES_FILE" <<'EOF'
overrides: []
EOF

echo "Test 7: empty overrides -> defaults"
run "anything" "$OVERRIDES_FILE"
assert_eq "max_commits" "50"  "$MC"
assert_eq "max_files"   "100" "$MF"

# ---------------------------------------------------------------------------
# Fixture 3: missing overrides file.
# ---------------------------------------------------------------------------
rm -f "$OVERRIDES_FILE"

echo "Test 8: missing overrides file -> defaults"
run "anything" "$OVERRIDES_FILE"
assert_eq "max_commits" "50"  "$MC"
assert_eq "max_files"   "100" "$MF"

echo
echo "Results: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]] || exit 1
