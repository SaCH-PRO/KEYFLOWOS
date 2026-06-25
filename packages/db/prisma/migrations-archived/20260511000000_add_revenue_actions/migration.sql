-- R3: Revenue Action Queue
CREATE TABLE IF NOT EXISTS "revenue_actions" (
  "id"              TEXT NOT NULL,
  "business_id"     TEXT NOT NULL,
  "contact_id"      TEXT,
  "type"            TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "detail"          TEXT,
  "priority"        INTEGER NOT NULL DEFAULT 2,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "due_at"          TIMESTAMP(3),
  "snoozed_until"   TIMESTAMP(3),
  "related_type"    TEXT,
  "related_id"      TEXT,
  "amount_at_risk"  DOUBLE PRECISION,
  "recommendation"  JSONB,
  "completed_at"    TIMESTAMP(3),
  "resolved_by"     TEXT,
  "resolution"      TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "revenue_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "revenue_actions_business_id_type_related_type_related_id_key"
  ON "revenue_actions"("business_id", "type", "related_type", "related_id");
CREATE INDEX IF NOT EXISTS "revenue_actions_business_id_status_priority_idx"
  ON "revenue_actions"("business_id", "status", "priority");
CREATE INDEX IF NOT EXISTS "revenue_actions_business_id_type_status_idx"
  ON "revenue_actions"("business_id", "type", "status");
CREATE INDEX IF NOT EXISTS "revenue_actions_business_id_contact_id_idx"
  ON "revenue_actions"("business_id", "contact_id");

ALTER TABLE "revenue_actions"
  ADD CONSTRAINT "revenue_actions_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
