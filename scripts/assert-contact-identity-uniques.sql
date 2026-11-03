-- Post-deploy guard for the contact identity uniques (V1-17, owner ruling D-62).
--
-- Run after `prisma migrate deploy` by scripts/post-merge.sh (step [4/4]) and
-- scripts/start-cloud-app.sh, through
--   pnpm --filter @keyflow/db exec prisma db execute --schema=./prisma/schema.prisma --file <this file>
-- It reads the catalog only and changes nothing. It raises, so the command
-- exits non-zero, unless both partial unique indexes of migration
-- 20261101000000_contact_partial_identity_uniques exist on contacts, are
-- valid, and cover (business_id, email_normalized) and
-- (business_id, phone_normalized) WHERE deleted_at IS NULL.
--
-- Why a separate check: Prisma cannot declare a partial unique, so neither
-- `prisma migrate diff` nor `prisma migrate status` can see these indexes. A
-- database whose _prisma_migrations records 20261101000000 as applied without
-- the indexes (for example after `prisma migrate resolve --applied` on a
-- database that never ran it) passes both, and two live contacts of one
-- business could then share an email or a phone. This check refuses it.

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(want.name, ', ' ORDER BY want.name) INTO missing
    FROM (VALUES
      ('contacts_business_id_email_normalized_live_key', 'email_normalized'),
      ('contacts_business_id_phone_normalized_live_key', 'phone_normalized')
    ) AS want(name, col)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_class tc ON tc.oid = i.indrelid
       JOIN pg_namespace ns ON ns.oid = tc.relnamespace
      WHERE ns.nspname = current_schema()
        AND tc.relname = 'contacts'
        AND ic.relname = want.name
        AND i.indisunique
        AND i.indisvalid
        AND pg_get_indexdef(i.indexrelid) ~ ('\(business_id, ' || want.col || '\) WHERE \(deleted_at IS NULL\)$')
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'contact identity uniques missing: % (migration 20261101000000_contact_partial_identity_uniques is recorded as applied but its partial unique indexes are absent; see MAINTENANCE.md "Adopting a database built without migrations")', missing;
  END IF;
END $$;
