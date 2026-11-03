#!/usr/bin/env bash
# Post-merge setup for the KeyflowOS monorepo.
#
# Runs automatically after a task agent merges into the main repl. Keeps the
# host environment in lockstep with the merged code: installs deps, generates
# the Prisma client, and applies the committed migrations.
#
# Schema step (owner ruling D-62): `prisma migrate deploy` applies
# packages/db/prisma/migrations and nothing else. It replaced `prisma db push`,
# which reconciles a database with schema.prisma alone and so cannot create
# what only a migration declares: on a database one migration behind
# 20261101000000_contact_partial_identity_uniques it dropped both contact
# identity uniques and created neither partial *_live_key index.
#
# Failure policy:
#   - Dependency install: fail loudly.
#   - Prisma generate: fail loudly.
#   - Migrate deploy: fail loudly. Real schema drift used to be silently
#     swallowed here, which led to the deployed app going live with a
#     broken database. We now propagate the failure.
#   - A database with no _prisma_migrations record of 0_baseline (one that
#     was built with db push) is refused (P3005) until an operator records
#     the baseline once, after checking the database matches it:
#       pnpm --filter @keyflow/db exec prisma migrate resolve --applied 0_baseline
#     This script never records it by itself.
#
# Override:
#   POST_MERGE_SKIP_DB_PUSH=1   skip both database steps (drift check and
#                               migrate deploy); the name is kept for operators
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

echo "[4/4] Applying migrations (prisma migrate deploy)…"
DEPLOY_TMP=$(mktemp)
set +e
pnpm --filter @keyflow/db exec prisma migrate deploy --schema=./prisma/schema.prisma 2>&1 | tee "$DEPLOY_TMP"
DEPLOY_EXIT=${PIPESTATUS[0]}
set -e
if [ "$DEPLOY_EXIT" -ne 0 ]; then
  echo "[FATAL] prisma migrate deploy failed (exit ${DEPLOY_EXIT}) — aborting." >&2
  if grep -qE 'P3005|Migration name: 0_baseline' "$DEPLOY_TMP"; then
    echo "  This database has no _prisma_migrations record of 0_baseline: it was built" >&2
    echo "  without migrations. Back it up, confirm its schema matches 0_baseline" >&2
    echo "  (docs/SCHEMA_DEPLOYMENT.md §3), record the baseline once, then rerun:" >&2
    echo "    pnpm --filter @keyflow/db exec prisma migrate resolve --applied 0_baseline" >&2
  fi
  rm -f "$DEPLOY_TMP"
  exit 1
fi
rm -f "$DEPLOY_TMP"

echo "=== Post-merge setup complete ==="
