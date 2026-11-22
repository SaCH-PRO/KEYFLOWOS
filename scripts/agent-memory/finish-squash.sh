#!/bin/bash
# finish-squash.sh <pkt-branch> <PACKET-ID> <scope>: after compact.sh stopped on a conflict in fixture-prefixes.json
# (two packets appended rows at the same place), merge the two sides as JSON and make the RED + fix commits.
#
# The registry is merged from git's index stages, not from the conflict markers: git splits a conflict differently
# depending on which lines the two sides share, so editing marker text is fragile (Codex on #223). Rule: keep every
# top-level key; for a list, HEAD's items first, then the packet's items that HEAD does not already have (rows are
# matched by "prefix", other items by value); a non-list key must be equal on both sides. Refuses on a prefix that
# appears twice, on invalid JSON, or if any other file is still conflicted.
# Set COMMIT_TRAILER to the attribution lines your harness requires (default: none).
set -euo pipefail
B=$1; P=$2; S=$3; F=apps/server/test/helpers/fixture-prefixes.json
TRAILER=${COMMIT_TRAILER:-}

if git ls-files -u -- "$F" | grep -q .; then
  OURS=$(mktemp); THEIRS=$(mktemp)
  git show ":2:$F" > "$OURS"; git show ":3:$F" > "$THEIRS"
  python3 - "$OURS" "$THEIRS" "$F" <<'PY'
import json, sys
ours, theirs, out = (json.load(open(sys.argv[1])), json.load(open(sys.argv[2])), sys.argv[3])
def key(x): return ('prefix', x['prefix']) if isinstance(x, dict) and 'prefix' in x else ('value', json.dumps(x, sort_keys=True))
merged = {}
for k in list(ours.keys()) + [k for k in theirs if k not in ours]:
    a, b = ours.get(k), theirs.get(k)
    if isinstance(a, list) or isinstance(b, list):
        a, b = a or [], b or []
        seen = {key(x) for x in a}
        merged[k] = a + [x for x in b if key(x) not in seen]
    elif k not in theirs or k not in ours or a == b:
        merged[k] = a if k in ours else b
    else:
        sys.exit(f'{out}: key {k!r} differs on both sides; resolve by hand')
pre = [x['prefix'] for x in merged.get('prefixes', []) if isinstance(x, dict)]
dupes = sorted({p for p in pre if pre.count(p) > 1})
if dupes: sys.exit(f'{out}: prefix registered twice: {dupes}')
open(out, 'w').write(json.dumps(merged, indent=2, ensure_ascii=False) + '\n')
print(f'resolved {out}; prefixes {len(pre)}')
PY
  rm -f "$OURS" "$THEIRS"
  git add "$F"
fi
[ -z "$(git diff --name-only --diff-filter=U)" ] || { echo "other conflicts remain" >&2; git diff --name-only --diff-filter=U >&2; exit 1; }

H=$(git rev-parse --short "origin/$B")
FILES=$(git diff --cached --name-only); git reset -q
RX='(\.spec\.tsx?|\.test\.tsx?|\.spec\.mjs|/test/|/e2e/|/__tests__/|fixture-prefixes\.json)'
TESTS=$(echo "$FILES" | grep -E "$RX" || true); REST=$(echo "$FILES" | grep -vE "$RX" || true)
if [ -n "$TESTS" ]; then git add -- $TESTS; git commit -q -m "test($S): RED for pkt/V1-$P (compacted)

Tests-only commit compacted from pkt/V1-$P at $H, where the full
history (each RED run recorded, every review round) stays. fixture-prefixes.json
keeps every row from both sides.${TRAILER:+

$TRAILER}"; fi
if [ -n "$REST" ]; then git add -A -- $REST; git commit -q -m "fix($S): pkt/V1-$P (compacted)

Compacted from pkt/V1-$P at $H.${TRAILER:+

$TRAILER}"; fi
echo "$P: tests=$(echo "$TESTS" | grep -c . || true) rest=$(echo "$REST" | grep -c . || true)"
