-- M4: Sequence analytics & lifecycle reporting

-- Per-business attribution window (days). NULL = use 14-day default.
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "crm_attribution_window_days" INTEGER;

-- Link table connecting Deal won-events back to sequence enrollments
-- within the per-business attribution window.
CREATE TABLE IF NOT EXISTS "sequence_attributions" (
  "id"               TEXT PRIMARY KEY,
  "business_id"      TEXT NOT NULL,
  "sequence_id"      TEXT NOT NULL,
  "enrollment_id"    TEXT NOT NULL,
  "deal_id"          TEXT NOT NULL,
  "contact_id"       TEXT NOT NULL,
  "attributed_value" DECIMAL(12,2),
  "currency"         TEXT,
  "won_at"           TIMESTAMP(3) NOT NULL,
  "enrolled_at"      TIMESTAMP(3) NOT NULL,
  "window_days"      INTEGER NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sequence_attributions_enrollment_id_fkey"
    FOREIGN KEY ("enrollment_id")
    REFERENCES "crm_sequence_enrollments"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

-- One attribution row per deal (single last-touch attribution model)
CREATE UNIQUE INDEX IF NOT EXISTS "sequence_attributions_deal_id_key"
  ON "sequence_attributions" ("deal_id");
CREATE INDEX IF NOT EXISTS "sequence_attributions_business_id_sequence_id_idx"
  ON "sequence_attributions" ("business_id", "sequence_id");
CREATE INDEX IF NOT EXISTS "sequence_attributions_business_id_won_at_idx"
  ON "sequence_attributions" ("business_id", "won_at");
