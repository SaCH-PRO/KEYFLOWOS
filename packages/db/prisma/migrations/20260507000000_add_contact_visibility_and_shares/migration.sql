-- M7: Contact ownership, visibility, and ContactShare table.

-- 1) Add visibility column (TEAM = visible to whole workspace per crm.view scope,
--    PRIVATE = only owner + explicit shares, SHARED = TEAM-visible plus shares).
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'TEAM';

-- 2) Backfill ownerId for legacy rows: prefer existing owner_id, fall back to
--    the workspace owner (so per-user filters always have a referent).
UPDATE "contacts" c
SET "owner_id" = b."owner_id"
FROM "businesses" b
WHERE c."business_id" = b."id"
  AND c."owner_id" IS NULL;

-- 3) Indexes for ownership / visibility filtering.
CREATE INDEX IF NOT EXISTS "contacts_business_id_owner_id_idx"
  ON "contacts"("business_id", "owner_id");
CREATE INDEX IF NOT EXISTS "contacts_business_id_visibility_idx"
  ON "contacts"("business_id", "visibility");

-- 4) Per-user explicit shares (granular access for PRIVATE/SHARED contacts).
CREATE TABLE IF NOT EXISTS "contact_shares" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "contact_id"  TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "created_by"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_shares_contact_id_user_id_key"
  ON "contact_shares"("contact_id", "user_id");
CREATE INDEX IF NOT EXISTS "contact_shares_business_id_user_id_idx"
  ON "contact_shares"("business_id", "user_id");
CREATE INDEX IF NOT EXISTS "contact_shares_contact_id_idx"
  ON "contact_shares"("contact_id");

ALTER TABLE "contact_shares"
  ADD CONSTRAINT "contact_shares_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_shares"
  ADD CONSTRAINT "contact_shares_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
