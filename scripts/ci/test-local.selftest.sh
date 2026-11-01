#!/usr/bin/env bash
#
# test-local.selftest.sh: regression test for scripts/test-local.sh
# (R0-16-PROOF-BINDING). CI runs it as `bash scripts/ci/test-local.selftest.sh`.
#
# It never starts Docker, never touches a database and never runs pnpm.
# test-local.sh runs inside a throwaway git repository (and a worktree of it)
# whose PATH puts recording stand-ins for docker and pnpm first; node and git
# are the real ones, so resource admission is the real admit-resources.mjs.
#
# What it pins:
#   1. --plan prints every step in order (admit, compose up, generate,
#      workspace builds, db:deploy, server build, vitest) and runs none of them.
#   2. A non-local DATABASE_URL is refused by admit-resources.mjs before any
#      step runs: in CI mode (ci-resources.json), in a main checkout, and in a
#      worktree with --packet.
#   2b. A DATABASE_URL, DIRECT_URL or REDIS_URL whose query string overrides
#      its connection target (?host=, ?hostaddr=, ?user=, ?port=, Redis ?db=)
#      is refused (KF_PROOF_RESOURCE_TARGET_OVERRIDE) before admission, in
#      every mode, without printing the value; ?schema= and other parameters
#      that do not move the target are admitted.
#   3. A worktree without --packet is refused.
#   4. An admitted run executes the steps in order, and --suite picks the
#      vitest step: release0 -> proof:manifests (every case manifest at HEAD),
#      server -> test:ci, anything else -> vitest run <files>.
#   5. --skip and --no-compose drop only the named steps; admission cannot be
#      skipped. A leading `--` (pnpm test:local -- ...) is accepted.
#
# Exits non-zero if any check fails.

set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
SUT="$REPO/scripts/test-local.sh"

pass=0
fail=0
ok() { echo "  OK   $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL $1"; fail=$((fail + 1)); }

if [[ ! -f $SUT ]]; then
  echo "  FAIL scripts/test-local.sh does not exist"
  echo "test-local selftest: 0 passed, 1 failed"
  exit 1
fi

SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/kf-test-local-selftest.XXXXXX")
trap 'rm -rf "$SANDBOX"' EXIT
MAIN="$SANDBOX/main"
WT="$SANDBOX/wt"
BIN="$SANDBOX/bin"
CALLS="$SANDBOX/calls.log"
OUT="$SANDBOX/out.log"
STATE="$SANDBOX/state.tsv"

# --- sandbox: a repository holding the runner and the admission it relies on
mkdir -p "$MAIN/scripts/proof-admission/manifests" "$BIN"
cp "$SUT" "$MAIN/scripts/test-local.sh"
cp "$REPO/scripts/proof-admission/admit-resources.mjs" "$MAIN/scripts/proof-admission/"
cp "$REPO/scripts/proof-admission/manifests/ci-resources.json" \
   "$REPO/scripts/proof-admission/manifests/local-worktree-resources.json" \
   "$MAIN/scripts/proof-admission/manifests/"
GIT_ID=(-c user.email=selftest@example.invalid -c user.name=selftest -c init.defaultBranch=main -c commit.gpgsign=false)
git "${GIT_ID[@]}" init -q "$MAIN"
git "${GIT_ID[@]}" -C "$MAIN" add -A
git "${GIT_ID[@]}" -C "$MAIN" commit -q -m sandbox
git "${GIT_ID[@]}" -C "$MAIN" worktree add -q -b pkt/R0-99-SELFTEST "$WT"
WT_REAL=$(cd "$WT" && pwd -P)

for tool in docker pnpm; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\n' "$tool" "$CALLS" > "$BIN/$tool"
  chmod +x "$BIN/$tool"
done

# The worktree's allocation, as scripts/worktree-resources.sh provision writes it.
printf 'r0_99\t9\t%s\n' "$WT_REAL" > "$STATE"
cat > "$WT/.env" <<'ENV'
KF_WT_PACKET=r0_99
DATABASE_URL=postgresql://keyflow:keyflow@localhost:5432/kf_wt_r0_99
DIRECT_URL=postgresql://keyflow:keyflow@localhost:5432/kf_wt_r0_99
REDIS_URL=redis://localhost:6379/9
ENV

LOCAL_DB=postgresql://keyflow:keyflow@localhost:5432/keyflowos
FOREIGN_DB=postgresql://keyflow:keyflow@db.example.com:5432/keyflowos
FOREIGN_WT_DB=postgresql://keyflow:keyflow@db.example.com:5432/kf_wt_r0_99
LOCAL_REDIS=redis://localhost:6379
CI_ENV=(CI=true GITHUB_ACTIONS=true)

status=0
# run_sut <dir> [VAR=value ...] -- <test-local.sh args ...>
run_sut() {
  local dir=$1
  shift
  local vars=()
  while [[ $# -gt 0 && $1 != -- ]]; do
    vars+=("$1")
    shift
  done
  [[ ${1:-} == -- ]] && shift
  : > "$CALLS"
  status=0
  (cd "$dir" && env -i PATH="$BIN:$PATH" HOME="$SANDBOX" KF_WT_STATE_FILE="$STATE" "${vars[@]}" \
    bash scripts/test-local.sh "$@") > "$OUT" 2>&1 || status=$?
}

calls() { cat "$CALLS"; }
nothing_ran() { [[ ! -s $CALLS ]]; }

# in_order <file> <fixed string> ... : every string occurs, each on a later line than the one before.
in_order() {
  local file=$1
  shift
  local last=0 n
  for needle in "$@"; do
    n=$(grep -nF -- "$needle" "$file" | head -1 | cut -d: -f1)
    [[ -n $n && $n -gt $last ]] || return 1
    last=$n
  done
}

STEP_COMPOSE='docker compose up -d db redis'
STEP_GENERATE='pnpm db:generate'
STEP_WORKSPACE='pnpm --filter @keyflow/shared --filter @keyflow/db --filter @keyflow/api build'
STEP_DEPLOY='pnpm db:deploy'
STEP_BUILD='pnpm --filter server build'
STEP_RELEASE0='pnpm --filter server proof:manifests --skip-build'

echo "test-local selftest (sandbox $SANDBOX)"

# 1. --plan prints every step in order and runs none of them.
run_sut "$MAIN" "${CI_ENV[@]}" DATABASE_URL=$LOCAL_DB DIRECT_URL=$LOCAL_DB REDIS_URL=$LOCAL_REDIS -- --plan
if [[ $status -eq 0 ]] && in_order "$OUT" 'admit-resources.mjs --manifest' "$STEP_COMPOSE" "$STEP_GENERATE" "$STEP_WORKSPACE" "$STEP_DEPLOY" "$STEP_BUILD" "$STEP_RELEASE0"; then
  ok '--plan prints admit, compose up, generate, workspace builds, db:deploy, server build and vitest, in that order'
else
  bad "--plan output (exit $status): $(cat "$OUT")"
fi
if nothing_ran; then ok '--plan runs nothing'; else bad "--plan ran: $(calls)"; fi

run_sut "$MAIN" "${CI_ENV[@]}" DATABASE_URL=$FOREIGN_DB DIRECT_URL=$FOREIGN_DB REDIS_URL=$LOCAL_REDIS -- -- --plan --suite release0
if [[ $status -eq 0 ]] && grep -qF "$STEP_RELEASE0" "$OUT" && nothing_ran; then
  ok 'a leading -- is accepted (pnpm test:local -- --suite release0) and --plan only prints'
else
  bad "leading -- with --plan (exit $status): $(cat "$OUT")"
fi

# 2. A non-local DATABASE_URL is refused by admit-resources.mjs before any step runs.
run_sut "$MAIN" "${CI_ENV[@]}" DATABASE_URL=$FOREIGN_DB DIRECT_URL=$FOREIGN_DB REDIS_URL=$LOCAL_REDIS -- --suite release0
if [[ $status -ne 0 ]] && grep -q 'KF_PROOF_RESOURCE_HOST_UNSAFE' "$OUT" && nothing_ran; then
  ok 'CI mode: a non-local DATABASE_URL is refused (KF_PROOF_RESOURCE_HOST_UNSAFE) and nothing runs'
else
  bad "CI mode non-local database (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

run_sut "$MAIN" DATABASE_URL=$FOREIGN_DB DIRECT_URL=$FOREIGN_DB REDIS_URL=$LOCAL_REDIS -- --suite release0
if [[ $status -ne 0 ]] && grep -q 'KF_PROOF_RESOURCE_HOST_UNSAFE' "$OUT" && nothing_ran; then
  ok 'main checkout: a non-local DATABASE_URL is refused (KF_PROOF_RESOURCE_HOST_UNSAFE) and nothing runs'
else
  bad "main checkout non-local database (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

run_sut "$WT" DATABASE_URL=$FOREIGN_WT_DB DIRECT_URL=$FOREIGN_WT_DB -- --packet R0-99 --suite release0
if [[ $status -ne 0 ]] && grep -q 'KF_PROOF_RESOURCE_HOST_UNSAFE' "$OUT" && nothing_ran; then
  ok 'worktree --packet: an exported non-local DATABASE_URL is refused by admit-resources.mjs --packet and nothing runs'
else
  bad "worktree non-local database (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

run_sut "$WT" DATABASE_URL=$LOCAL_DB DIRECT_URL=$LOCAL_DB -- --packet R0-99 --suite release0
if [[ $status -ne 0 ]] && grep -q 'KF_PROOF_RESOURCE_DATABASE_SHARED' "$OUT" && nothing_ran; then
  ok 'worktree --packet: the main-tree database is refused (KF_PROOF_RESOURCE_DATABASE_SHARED) and nothing runs'
else
  bad "worktree main-tree database (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

# 2b. A query string that overrides the connection target is refused before admission.
# node-postgres and Prisma read ?host= in place of the URL's host (and pg ?user=
# and ?port=), so each of these names localhost yet would connect elsewhere.
run_sut "$MAIN" DATABASE_URL="$LOCAL_DB?host=db.example.com" DIRECT_URL=$LOCAL_DB REDIS_URL=$LOCAL_REDIS -- --suite release0
if [[ $status -ne 0 ]] && grep -q 'KF_PROOF_RESOURCE_TARGET_OVERRIDE' "$OUT" && grep -q '"DATABASE_URL"' "$OUT" \
  && ! grep -q 'db.example.com' "$OUT" && nothing_ran; then
  ok 'main checkout: DATABASE_URL ...@localhost/keyflowos?host=<remote> is refused (KF_PROOF_RESOURCE_TARGET_OVERRIDE), the value is not printed, and nothing runs'
else
  bad "main checkout ?host= override (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

run_sut "$MAIN" "${CI_ENV[@]}" DATABASE_URL=$LOCAL_DB DIRECT_URL="$LOCAL_DB?sslmode=disable&hostaddr=192.0.2.10" REDIS_URL=$LOCAL_REDIS -- --suite release0
if [[ $status -ne 0 ]] && grep -q 'KF_PROOF_RESOURCE_TARGET_OVERRIDE' "$OUT" && grep -q '"DIRECT_URL"' "$OUT" && grep -q '"hostaddr"' "$OUT" && nothing_ran; then
  ok 'CI mode: DIRECT_URL with ?hostaddr= is refused before admission and nothing runs'
else
  bad "CI mode ?hostaddr= override (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

WT_DB=postgresql://keyflow:keyflow@localhost:5432/kf_wt_r0_99
run_sut "$WT" DATABASE_URL=$WT_DB DIRECT_URL="$WT_DB?user=postgres&port=6543" -- --packet R0-99 --suite release0
if [[ $status -ne 0 ]] && grep -q 'KF_PROOF_RESOURCE_TARGET_OVERRIDE' "$OUT" && grep -q '"user"' "$OUT" && grep -q '"port"' "$OUT" && nothing_ran; then
  ok 'worktree --packet: the packet database with ?user=&port= is refused before admission and nothing runs'
else
  bad "worktree ?user=&port= override (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

run_sut "$MAIN" DATABASE_URL=$LOCAL_DB DIRECT_URL=$LOCAL_DB REDIS_URL="$LOCAL_REDIS?db=5" -- --suite release0
if [[ $status -ne 0 ]] && grep -q 'KF_PROOF_RESOURCE_TARGET_OVERRIDE' "$OUT" && grep -q '"REDIS_URL"' "$OUT" && nothing_ran; then
  ok 'main checkout: REDIS_URL with ?db= (an index admission never judged) is refused and nothing runs'
else
  bad "main checkout Redis ?db= override (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

run_sut "$MAIN" DATABASE_URL="$LOCAL_DB?schema=public&connection_limit=5" DIRECT_URL=$LOCAL_DB REDIS_URL=$LOCAL_REDIS -- --suite release0
if [[ $status -eq 0 ]] && grep -q 'ADMITTED_NONPRODUCTION' "$OUT" && in_order "$CALLS" "$STEP_COMPOSE" "$STEP_RELEASE0"; then
  ok 'main checkout: ?schema= and ?connection_limit= do not move the target and are admitted'
else
  bad "main checkout ?schema= (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

# 3. A worktree without --packet is refused.
run_sut "$WT" -- --suite release0
if [[ $status -ne 0 ]] && grep -q -- '--packet' "$OUT" && nothing_ran; then
  ok 'worktree without --packet is refused and nothing runs'
else
  bad "worktree without --packet (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

# 4. An admitted run executes the steps in order; --suite picks the vitest step.
run_sut "$MAIN" DATABASE_URL=$LOCAL_DB DIRECT_URL=$LOCAL_DB REDIS_URL=$LOCAL_REDIS -- --suite release0
if [[ $status -eq 0 ]] && in_order "$CALLS" "$STEP_COMPOSE" "$STEP_GENERATE" "$STEP_WORKSPACE" "$STEP_DEPLOY" "$STEP_BUILD" "$STEP_RELEASE0" \
  && [[ $(wc -l < "$CALLS") -eq 6 ]]; then
  ok 'main checkout, admitted: the six steps run in order and --suite release0 runs proof:manifests'
else
  bad "main checkout admitted run (exit $status): ran: $(calls) / $(cat "$OUT")"
fi
if grep -q 'ADMITTED_NONPRODUCTION' "$OUT" && ! grep -q 'keyflow:keyflow' "$OUT"; then
  ok 'the admission receipt is printed without credentials'
else
  bad "admission receipt: $(cat "$OUT")"
fi

run_sut "$WT" -- --packet R0-99 --suite server --no-compose
if [[ $status -eq 0 ]] && in_order "$CALLS" "$STEP_GENERATE" "$STEP_WORKSPACE" "$STEP_DEPLOY" "$STEP_BUILD" 'pnpm --filter server test:ci' \
  && ! grep -q '^docker' "$CALLS"; then
  ok 'worktree --packet, admitted from .env: --no-compose skips docker and --suite server runs test:ci'
else
  bad "worktree admitted run (exit $status): ran: $(calls) / $(cat "$OUT")"
fi

run_sut "$WT" -- --packet R0-99 --skip generate,workspace --suite test/a.integration.test.ts --suite src/b.spec.ts
if [[ $status -eq 0 ]] && in_order "$CALLS" "$STEP_COMPOSE" "$STEP_DEPLOY" "$STEP_BUILD" 'pnpm --filter server exec vitest run test/a.integration.test.ts src/b.spec.ts' \
  && ! grep -qF "$STEP_GENERATE" "$CALLS" && ! grep -qF "$STEP_WORKSPACE" "$CALLS"; then
  ok '--skip drops only the named steps, and file suites run through vitest run'
else
  bad "--skip run (exit $status): ran: $(calls) / $(cat "$OUT")"
fi

# 5. Admission cannot be skipped; unknown options are refused.
run_sut "$WT" -- --packet R0-99 --skip admit
if [[ $status -ne 0 ]] && nothing_ran; then
  ok '--skip admit is refused and nothing runs'
else
  bad "--skip admit (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

run_sut "$MAIN" DATABASE_URL=$LOCAL_DB DIRECT_URL=$LOCAL_DB REDIS_URL=$LOCAL_REDIS -- --frobnicate
if [[ $status -ne 0 ]] && nothing_ran; then
  ok 'an unknown option is refused and nothing runs'
else
  bad "unknown option (exit $status, ran: $(calls)): $(cat "$OUT")"
fi

echo "test-local selftest: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
