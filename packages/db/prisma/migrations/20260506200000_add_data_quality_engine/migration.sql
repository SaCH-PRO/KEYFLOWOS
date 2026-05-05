-- M6: Continuous data-quality engine.
-- Adds per-business stale-data threshold + last-run timestamp, per-contact
-- score and verification timestamps, and a ContactDataIssue table with one
-- row per (contact, kind) so the nightly scanner can upsert without
-- duplicating issues.

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "data_quality_stale_days" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS "data_quality_last_run_at" TIMESTAMP(3);

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "data_quality_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "data_quality_checked_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_verified_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "contacts_business_id_data_quality_score_idx"
  ON "contacts"("business_id", "data_quality_score");

CREATE TABLE IF NOT EXISTS "contact_data_issues" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "field" TEXT,
  "message" TEXT NOT NULL,
  "recommended_fix" JSONB,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolved_at" TIMESTAMP(3),
  "resolved_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contact_data_issues_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_data_issues_contact_id_kind_key"
  ON "contact_data_issues"("contact_id", "kind");
CREATE INDEX IF NOT EXISTS "contact_data_issues_business_id_status_idx"
  ON "contact_data_issues"("business_id", "status");
CREATE INDEX IF NOT EXISTS "contact_data_issues_business_id_kind_status_idx"
  ON "contact_data_issues"("business_id", "kind", "status");
CREATE INDEX IF NOT EXISTS "contact_data_issues_business_id_severity_status_idx"
  ON "contact_data_issues"("business_id", "severity", "status");

DO $$ BEGIN
  ALTER TABLE "contact_data_issues"
    ADD CONSTRAINT "contact_data_issues_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "contact_data_issues"
    ADD CONSTRAINT "contact_data_issues_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
