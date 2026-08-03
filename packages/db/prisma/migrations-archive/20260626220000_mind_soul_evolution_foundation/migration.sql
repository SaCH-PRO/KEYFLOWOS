-- Mind / Soul / Evolution foundation migration
-- Adds persistent cortex memory, cognitive event bus, value constraints, and knowledge sources.
-- Extends the autonomy verdict audit trail with outcome, proposal, and context-hash fields.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Extend AutonomyVerdict audit trail
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "autonomy_verdicts"
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "proposal_id" TEXT,
  ADD COLUMN "context_hash" TEXT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. KeyCortexMemory — persistent replacement for Redis-only cortex memory
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "key_cortex_memories" (
  "id"               TEXT NOT NULL,
  "business_id"      TEXT NOT NULL,
  "user_id"          TEXT,
  "type"             TEXT NOT NULL,
  "key"              TEXT NOT NULL,
  "value"            TEXT NOT NULL,
  "source"           TEXT NOT NULL DEFAULT 'inferred',
  "confidence"       DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "access_count"     INTEGER NOT NULL DEFAULT 1,
  "last_accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "key_cortex_memories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "key_cortex_memories_business_id_type_idx" ON "key_cortex_memories"("business_id", "type");
CREATE INDEX "key_cortex_memories_business_id_created_at_idx" ON "key_cortex_memories"("business_id", "created_at");
CREATE INDEX "key_cortex_memories_business_id_key_idx" ON "key_cortex_memories"("business_id", "key");

ALTER TABLE "key_cortex_memories"
  ADD CONSTRAINT "key_cortex_memories_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CognitiveEvent — normalized perception/event bus store
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "cognitive_events" (
  "id"           TEXT NOT NULL,
  "business_id"  TEXT NOT NULL,
  "source_type"  TEXT NOT NULL,
  "source_id"    TEXT,
  "event_type"   TEXT NOT NULL,
  "payload"      JSONB NOT NULL,
  "confidence"   DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cognitive_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cognitive_events_business_id_source_type_idx" ON "cognitive_events"("business_id", "source_type");
CREATE INDEX "cognitive_events_business_id_event_type_idx" ON "cognitive_events"("business_id", "event_type");
CREATE INDEX "cognitive_events_business_id_created_at_idx" ON "cognitive_events"("business_id", "created_at");

ALTER TABLE "cognitive_events"
  ADD CONSTRAINT "cognitive_events_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ValueConstraint — inferred weighted values from feedback
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "value_constraints" (
  "id"              TEXT NOT NULL,
  "business_id"     TEXT NOT NULL,
  "value_key"       TEXT NOT NULL,
  "weight"          DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "evidence_count"  INTEGER NOT NULL DEFAULT 0,
  "source"          TEXT NOT NULL DEFAULT 'feedback',
  "examples"        JSONB NOT NULL DEFAULT '[]',
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "value_constraints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "value_constraints_business_id_value_key_source_key" UNIQUE ("business_id", "value_key", "source")
);

CREATE INDEX "value_constraints_business_id_weight_idx" ON "value_constraints"("business_id", "weight");

ALTER TABLE "value_constraints"
  ADD CONSTRAINT "value_constraints_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. KnowledgeSource — ingested best-practice / research / regulation docs
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "knowledge_sources" (
  "id"           TEXT NOT NULL,
  "business_id"  TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "source_type"  TEXT NOT NULL,
  "source_url"   TEXT,
  "content"      TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'pending',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_sources_business_id_status_idx" ON "knowledge_sources"("business_id", "status");
CREATE INDEX "knowledge_sources_business_id_source_type_idx" ON "knowledge_sources"("business_id", "source_type");

ALTER TABLE "knowledge_sources"
  ADD CONSTRAINT "knowledge_sources_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
