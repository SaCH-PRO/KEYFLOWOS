-- Persist the merge operation id on both contact rows so reverts are
-- deterministic without scanning by time.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "last_merge_id" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "merged_into_id" TEXT;
CREATE INDEX IF NOT EXISTS "contacts_business_id_last_merge_id_idx"
  ON "contacts"("business_id", "last_merge_id");
