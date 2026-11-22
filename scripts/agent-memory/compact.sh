#!/bin/bash
# compact.sh <pkt-branch> <PACKET-ID> <commit-scope> [hold-regex] [extra fix-message text]
#
# Squash one packet branch into the current (wave) branch as exactly two commits:
#   1. test(<scope>): RED for pkt/V1-<ID> (compacted)  -- every test/spec/e2e file and fixture-prefixes.json
#   2. fix(<scope>):  pkt/V1-<ID> (compacted)          -- everything else
# Files matching <hold-regex> (e.g. Release 0 evidence edits authorised by an owner ruling) ride the FIX commit even
# though they are tests, so the RED commit never turns a Release 0 suite red.
# The full history stays on the pkt/* branch; the subjects are what scripts/agent-memory/status.mjs reads.
# Set COMMIT_TRAILER to the attribution lines your harness requires (default: none).
# Run from the root of a clean wave worktree that has fetched origin/<pkt-branch>.
set -euo pipefail
B=$1; P=$2; S=$3; HOLD=${4:-}; EXTRA=${5:-}
TRAILER=${COMMIT_TRAILER:-}
[ -z "$(git status --porcelain)" ] || { echo "worktree not clean" >&2; exit 1; }
git merge --squash -q "origin/$B" >/dev/null
git reset -q
TESTS=(); REST=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ -n "$HOLD" ] && echo "$f" | grep -qE "$HOLD"; then REST+=("$f")
  elif echo "$f" | grep -qE '(\.spec\.tsx?|\.test\.tsx?|\.spec\.mjs|/test/|/e2e/|/__tests__/|fixture-prefixes\.json)'; then TESTS+=("$f")
  else REST+=("$f"); fi
done < <(git status --porcelain -uall | awk '{print $2}')
HEADSHA=$(git rev-parse --short "origin/$B")
if [ ${#TESTS[@]} -gt 0 ]; then
  git add -- "${TESTS[@]}"
  git commit -q -m "test($S): RED for pkt/V1-$P (compacted)

Tests-only commit compacted from pkt/V1-$P at $HEADSHA, where the full
history (each RED run recorded, every review round) stays.${TRAILER:+

$TRAILER}"
fi
git add -A -- "${REST[@]}"
git commit -q -m "fix($S): pkt/V1-$P (compacted)

Compacted from pkt/V1-$P at $HEADSHA.${EXTRA:+
$EXTRA}${TRAILER:+

$TRAILER}"
echo "$P: tests=${#TESTS[@]} rest=${#REST[@]}"
