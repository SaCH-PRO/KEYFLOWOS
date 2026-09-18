-- KF-EXEC-EXTFX-001
-- Add orthogonal effect/attempt/provider/consequence facts without assigning
-- provider certainty to historical rows.
ALTER TABLE "outbound_deliveries"
  ADD COLUMN "effect_fingerprint" TEXT,
  ADD COLUMN "effect_snapshot" JSONB,
  ADD COLUMN "attempt_sequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "current_attempt_id" TEXT,
  ADD COLUMN "attempt_started_at" TIMESTAMP(3),
  ADD COLUMN "attempt_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "provider_outcome" TEXT,
  ADD COLUMN "provider_first_attempt_at" TIMESTAMP(3),
  ADD COLUMN "provider_idempotency_key" TEXT,
  ADD COLUMN "consequence_state" TEXT;

ALTER TABLE "delivery_events"
  ADD COLUMN "attempt_id" TEXT;

CREATE INDEX "outbound_deliveries_business_id_provider_outcome_consequence_state_idx"
  ON "outbound_deliveries"("business_id", "provider_outcome", "consequence_state");

CREATE INDEX "outbound_deliveries_current_attempt_id_idx"
  ON "outbound_deliveries"("current_attempt_id");

CREATE INDEX "delivery_events_delivery_id_attempt_id_idx"
  ON "delivery_events"("delivery_id", "attempt_id");
