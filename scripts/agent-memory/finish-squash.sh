#!/bin/bash
# finish-squash.sh <pkt-branch> <PACKET-ID> <scope>: after compact.sh stopped on an append-only conflict
# in fixture-prefixes.json, keep both sides (HEAD first) and make the RED + fix commits.
set -euo pipefail
B=$1; P=$2; S=$3; F=apps/server/test/helpers/fixture-prefixes.json
python3 - "$F" <<'PY'
import sys,re,json
p=sys.argv[1]; s=open(p).read()
def fix(m):
    a=m.group(1).rstrip('\n'); b=m.group(2).rstrip('\n')
    return a+'\n    },\n    {\n'+b+'\n'
s2=re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', fix, s, flags=re.S)
json.loads(s2); open(p,'w').write(s2)
pre=[x['prefix'] for x in json.loads(s2)['prefixes']]
assert len(pre)==len(set(pre)), 'duplicate prefix'
print('resolved; prefixes', len(pre))
PY
git add "$F"
[ -z "$(git diff --name-only --diff-filter=U)" ] || { echo "other conflicts remain" >&2; git diff --name-only --diff-filter=U >&2; exit 1; }
H=$(git rev-parse --short "origin/$B")
FILES=$(git diff --cached --name-only); git reset -q
RX='(\.spec\.tsx?|\.test\.tsx?|\.spec\.mjs|/test/|/e2e/|/__tests__/|fixture-prefixes\.json)'
TESTS=$(echo "$FILES" | grep -E "$RX" || true); REST=$(echo "$FILES" | grep -vE "$RX" || true)
if [ -n "$TESTS" ]; then git add -- $TESTS; git commit -q -m "test($S): RED for pkt/V1-$P (compacted)

Tests-only commit compacted from pkt/V1-$P at $H, where the full
history (each RED run recorded, every review round) stays. fixture-prefixes.json
keeps every row from both sides.

$COMMIT_TRAILER"; fi
if [ -n "$REST" ]; then git add -A -- $REST; git commit -q -m "fix($S): pkt/V1-$P (compacted)

Compacted from pkt/V1-$P at $H.

$COMMIT_TRAILER"; fi
echo "$P: tests=$(echo "$TESTS" | grep -c . || true) rest=$(echo "$REST" | grep -c . || true)"
