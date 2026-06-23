-- C: Temporal Flow Memory Layer
-- Add link columns to temporal_flow_events and create temporal_flow_memories table.
-- All changes are additive.

ALTER TABLE "temporal_flow_events"
  ADD COLUMN IF NOT EXISTS "thread_id" TEXT,
  ADD COLUMN IF NOT EXISTS "message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_id" TEXT,
  ADD COLUMN IF NOT EXISTS "memory_embedding_id" TEXT;

CREATE INDEX IF NOT EXISTS "temporal_flow_events_business_id_thread_id_idx"
  ON "temporal_flow_events"("business_id", "thread_id");

CREATE INDEX IF NOT EXISTS "temporal_flow_events_business_id_contact_id_idx"
  ON "temporal_flow_events"("business_id", "contact_id");

CREATE INDEX IF NOT EXISTS "temporal_flow_events_business_id_message_id_idx"
  ON "temporal_flow_events"("business_id", "message_id");

CREATE TABLE IF NOT EXISTS "temporal_flow_memories" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "source_event_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "source_module" TEXT NOT NULL,
  "metadata" JSONB DEFAULT '{}',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "temporal_flow_memories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "temporal_flow_memories_business_entity_idx"
  ON "temporal_flow_memories"("business_id", "entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "temporal_flow_memories_business_type_idx"
  ON "temporal_flow_memories"("business_id", "type");

CREATE INDEX IF NOT EXISTS "temporal_flow_memories_business_updated_idx"
  ON "temporal_flow_memories"("business_id", "updated_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'temporal_flow_memories_business_id_fkey'
  ) THEN
    ALTER TABLE "temporal_flow_memories"
      ADD CONSTRAINT "temporal_flow_memories_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;
  END IF;
END $$;
