-- M3 Deal intelligence: per-deal health score, bottleneck flag, win/loss reason linkage,
-- and a per-business configurable WonLostReason catalog.

ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "health_score"          INTEGER,
  ADD COLUMN IF NOT EXISTS "health_score_at"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "health_breakdown"      JSONB,
  ADD COLUMN IF NOT EXISTS "bottleneck_flag"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "bottleneck_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "won_lost_reason_id"    TEXT,
  ADD COLUMN IF NOT EXISTS "won_lost_reason_notes" TEXT;

CREATE INDEX IF NOT EXISTS "deals_business_id_bottleneck_flag_idx"
  ON "deals" ("business_id", "bottleneck_flag");

CREATE TABLE IF NOT EXISTS "won_lost_reasons" (
  "id"          TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "is_default"  BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "won_lost_reasons_business_id_kind_slug_key"
  ON "won_lost_reasons" ("business_id", "kind", "slug");

CREATE INDEX IF NOT EXISTS "won_lost_reasons_business_id_kind_position_idx"
  ON "won_lost_reasons" ("business_id", "kind", "position");

ALTER TABLE "won_lost_reasons"
  ADD CONSTRAINT "won_lost_reasons_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_won_lost_reason_id_fkey"
  FOREIGN KEY ("won_lost_reason_id") REFERENCES "won_lost_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
