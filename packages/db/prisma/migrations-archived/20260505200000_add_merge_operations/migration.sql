-- Track merge operations so contacts can be unmerged within 24 hours.
CREATE TABLE IF NOT EXISTS "merge_operations" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "primary_id" TEXT NOT NULL,
  "duplicate_id" TEXT NOT NULL,
  "duplicate_snapshot" JSONB NOT NULL,
  "field_overrides" JSONB,
  "resolved_fields" JSONB,
  "repointed_counts" JSONB,
  "actor_id" TEXT,
  "actor_type" TEXT,
  "reverted_at" TIMESTAMP(3),
  "reverted_actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "merge_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "merge_operations_business_id_created_at_idx"
  ON "merge_operations"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "merge_operations_business_id_primary_id_idx"
  ON "merge_operations"("business_id", "primary_id");
CREATE INDEX IF NOT EXISTS "merge_operations_business_id_duplicate_id_idx"
  ON "merge_operations"("business_id", "duplicate_id");
