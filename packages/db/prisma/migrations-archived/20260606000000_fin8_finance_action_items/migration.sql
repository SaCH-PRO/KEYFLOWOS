-- FIN8: Finance intelligence action items. Idempotent detector output
-- mirrored into revenue_actions (FIN_*) so the same item also surfaces
-- in KEYFLOW Today via the existing R3 queue.
CREATE TABLE "finance_action_items" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL DEFAULT '',
    "entity_id" TEXT NOT NULL DEFAULT '',
    "recommended_action" TEXT,
    "evidence" JSONB,
    "amount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution" TEXT,
    "mirrored_action_id" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "finance_action_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "finance_action_items_business_id_kind_entity_type_entity_id_key"
  ON "finance_action_items" ("business_id", "kind", "entity_type", "entity_id");
CREATE INDEX "finance_action_items_business_id_status_severity_idx"
  ON "finance_action_items" ("business_id", "status", "severity");
CREATE INDEX "finance_action_items_business_id_kind_status_idx"
  ON "finance_action_items" ("business_id", "kind", "status");

ALTER TABLE "finance_action_items"
  ADD CONSTRAINT "finance_action_items_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
