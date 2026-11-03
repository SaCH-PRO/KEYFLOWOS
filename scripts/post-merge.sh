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
#   - A database built or kept in sync without migrations (every environment
#     before V1-83) holds schema that _prisma_migrations does not record:
#     deploy refuses it with P3005, or, once only 0_baseline is recorded,
#     with P3018 "already exists" and then P3009. An operator adopts it once
#     with MAINTENANCE.md "Adopting a database built without migrations"
#     (record 0_baseline and every migration it already holds, starting with
#       pnpm --filter @keyflow/db exec prisma migrate resolve --applied 0_baseline
#     and leave 20261101000000_contact_partial_identity_uniques to deploy).
#     This script never records a migration by itself.
#   - After deploy, scripts/assert-contact-identity-uniques.sql must find
#     both partial contact identity uniques of V1-17. Prisma cannot see them
#     (`migrate diff` and `migrate status` are silent), so a database that
#     records V1-17 as applied without them fails here, loudly.
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
  echo "[3/4] Skipping drift check (POST_MERGE_SKIP_DB_PUSH=1)."
  echo "[4/4] Skipping migrate deploy (POST_MERGE_SKIP_DB_PUSH=1)."
  echo "=== Post-merge setup complete (db steps skipped) ==="
  exit 0
fi

# Detect drift before deploying so the operator gets a one-line summary of
# what would change (or has already changed in production). This check reads
# schema.prisma only: it cannot see the partial contact identity uniques of
# V1-17 (Prisma cannot declare them), so step [4/4] checks those separately.
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
  if grep -qE 'Migration name: 20261101000000_contact_partial_identity_uniques|20261101000000_contact_partial_identity_uniques` migration started' "$DEPLOY_TMP"; then
    echo "  20261101000000_contact_partial_identity_uniques (V1-17) did not apply. Most" >&2
    echo "  likely two live contacts of one business share an email or a phone: run the" >&2
    echo "  duplicate scan in its migration.sql, resolve the duplicates, then rerun after:" >&2
    echo "    pnpm --filter @keyflow/db exec prisma migrate resolve --rolled-back 20261101000000_contact_partial_identity_uniques" >&2
    echo "  Never mark it --applied: that records V1-17 with no contact identity unique." >&2
  elif grep -qE 'P3005|P3009|Migration name: 0_baseline|already exists' "$DEPLOY_TMP"; then
    echo "  This database holds schema that _prisma_migrations does not record: it was" >&2
    echo "  built or kept in sync without migrations. Recording 0_baseline alone is not" >&2
    echo "  enough; the next deploy re-runs later migrations and stops with P3018" >&2
    echo "  'already exists', then P3009. Adopt it once with MAINTENANCE.md" >&2
    echo "  \"Adopting a database built without migrations\": back it up, check its" >&2
    echo "  contact identity indexes and run the duplicate scan, then record 0_baseline" >&2
    echo "  and each migration listed there (a failed one included), starting with:" >&2
    echo "    pnpm --filter @keyflow/db exec prisma migrate resolve --applied 0_baseline" >&2
    echo "  Leave 20261101000000_contact_partial_identity_uniques for migrate deploy; never" >&2
    echo "  mark it --applied unless both *_live_key indexes already exist." >&2
  fi
  rm -f "$DEPLOY_TMP"
  exit 1
fi
rm -f "$DEPLOY_TMP"

# Prisma cannot see the partial contact identity uniques of V1-17, so a
# database that records 20261101000000 as applied without them passes both
# migrate deploy and the drift check. Refuse it here.
echo "  → checking the contact identity uniques (V1-17)…"
if ! pnpm --filter @keyflow/db exec prisma db execute --schema=./prisma/schema.prisma --file "$ROOT_DIR/scripts/assert-contact-identity-uniques.sql"; then
  echo "[FATAL] contacts_business_id_email_normalized_live_key and/or" >&2
  echo "  contacts_business_id_phone_normalized_live_key is missing although every" >&2
  echo "  migration is recorded as applied: 20261101000000_contact_partial_identity_uniques" >&2
  echo "  was recorded by hand without running. Two live contacts of one business can" >&2
  echo "  share an email or a phone until it runs. Run the duplicate scan in its" >&2
  echo "  migration.sql, resolve any duplicates, then run its SQL once and rerun:" >&2
  echo "    pnpm --filter @keyflow/db exec prisma db execute --schema=./prisma/schema.prisma --file ./prisma/migrations/20261101000000_contact_partial_identity_uniques/migration.sql" >&2
  echo "  (MAINTENANCE.md \"Adopting a database built without migrations\")." >&2
  exit 1
fi

echo "=== Post-merge setup complete ==="
