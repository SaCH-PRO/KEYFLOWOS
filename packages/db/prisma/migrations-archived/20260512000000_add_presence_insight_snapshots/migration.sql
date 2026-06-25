-- Task #480 (S4): Storefront Intelligence — cached, narrated insight
-- snapshots produced by StorefrontIntelligenceService and surfaced in the
-- Presence Command Center > Insights tab.
CREATE TABLE IF NOT EXISTS "presence_insight_snapshots" (
  "id"               TEXT NOT NULL,
  "business_id"      TEXT NOT NULL,
  "version"          INTEGER NOT NULL DEFAULT 1,
  "window_days"      INTEGER NOT NULL DEFAULT 30,
  "payload"          JSONB NOT NULL,
  "stale"            BOOLEAN NOT NULL DEFAULT false,
  "narrative_source" TEXT,
  "model_used"       TEXT,
  "computed_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "presence_insight_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "presence_insight_snapshots_business_id_key"
  ON "presence_insight_snapshots"("business_id");
CREATE INDEX IF NOT EXISTS "presence_insight_snapshots_business_id_computed_at_idx"
  ON "presence_insight_snapshots"("business_id", "computed_at");
CREATE INDEX IF NOT EXISTS "presence_insight_snapshots_business_id_stale_idx"
  ON "presence_insight_snapshots"("business_id", "stale");

ALTER TABLE "presence_insight_snapshots"
  ADD CONSTRAINT "presence_insight_snapshots_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
