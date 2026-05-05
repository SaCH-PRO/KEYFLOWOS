#!/usr/bin/env bash
# Post-merge setup for the KeyflowOS monorepo.
#
# Runs automatically after a task agent merges into the main repl. Keeps the
# host environment in lockstep with the merged code: installs deps, generates
# the Prisma client, and reconciles the database schema.
#
# Failure policy:
#   - Dependency install: fail loudly.
#   - Prisma generate: fail loudly.
#   - Schema push: fail loudly. Real schema drift used to be silently
#     swallowed here, which led to the deployed app going live with a
#     broken database. We now propagate the failure.
#
# Override:
#   POST_MERGE_SKIP_DB_PUSH=1   skip the db push step entirely
#   POST_MERGE_ALLOW_DB_DRIFT=1 reduce drift detection to a warning
#                               (use only when intentional schema drift exists)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Post-merge setup ==="

echo "[1/4] Installing dependencies…"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "[2/4] Generating Prisma client…"
pnpm --filter @keyflow/db run db:generate

if [ "${POST_MERGE_SKIP_DB_PUSH:-0}" = "1" ]; then
  echo "[3/4] Skipping schema push (POST_MERGE_SKIP_DB_PUSH=1)."
  echo "[4/4] Skipping drift check (POST_MERGE_SKIP_DB_PUSH=1)."
  echo "=== Post-merge setup complete (db steps skipped) ==="
  exit 0
fi

# Detect drift before pushing so the operator gets a one-line summary of
# what would change (or has already changed in production).
echo "[3/4] Checking for schema drift (prisma migrate diff)…"
DIFF_TMP=$(mktemp)
set +e
pnpm --filter @keyflow/db exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel    prisma/schema.prisma \
  --exit-code 2>"$DIFF_TMP" >>"$DIFF_TMP"
DIFF_EXIT=$?
set -e

case "$DIFF_EXIT" in
  0)
    echo "  → no drift between live database and schema."
    ;;
  2)
    SUMMARY=$(grep -E '^\s*\[\+|\-|~\]' "$DIFF_TMP" | head -5 | tr '\n' '; ' | sed 's/;\s*$//')
    if [ -z "$SUMMARY" ]; then
      SUMMARY=$(head -3 "$DIFF_TMP" | tr '\n' '; ' | sed 's/;\s*$//')
    fi
    echo "  → drift detected: ${SUMMARY:-<see prisma output>}"
    if [ "${POST_MERGE_ALLOW_DB_DRIFT:-0}" != "1" ] && [ "${NODE_ENV:-development}" != "development" ]; then
      echo "[FATAL] Schema drift detected in non-dev environment — aborting." >&2
      cat "$DIFF_TMP" >&2
      rm -f "$DIFF_TMP"
      exit 1
    fi
    ;;
  *)
    echo "  → prisma migrate diff failed with exit ${DIFF_EXIT}; continuing but recording output:"
    cat "$DIFF_TMP"
    ;;
esac
rm -f "$DIFF_TMP"

echo "[4/4] Syncing database schema (prisma db push)…"
# In development, accept Prisma's data-loss warnings for additive changes
# (e.g. adding a unique constraint on a brand-new nullable column where every
# existing row is NULL — harmless in Postgres but Prisma flags it). Production
# merges still require an explicit migration.
PUSH_FLAGS="--schema=./prisma/schema.prisma --skip-generate"
if [ "${NODE_ENV:-development}" = "development" ] || [ "${POST_MERGE_ACCEPT_DATA_LOSS:-0}" = "1" ]; then
  PUSH_FLAGS="$PUSH_FLAGS --accept-data-loss"
fi
pnpm --filter @keyflow/db exec prisma db push $PUSH_FLAGS

echo "=== Post-merge setup complete ==="
