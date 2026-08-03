-- Create AutonomyRule table (canonical rule cache for AutonomyOrchestratorService)
CREATE TABLE IF NOT EXISTS "autonomy_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "action_key" TEXT,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autonomy_rules_pkey" PRIMARY KEY ("id")
);

-- Create AutonomyVerdict table (immutable audit trail of autonomy verdicts)
CREATE TABLE IF NOT EXISTS "autonomy_verdicts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "action_key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "requires_approval" BOOLEAN NOT NULL,
    "tier" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "rule_trace" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autonomy_verdicts_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "autonomy_rules_business_id_active_idx" ON "autonomy_rules"("business_id", "active");
CREATE INDEX IF NOT EXISTS "autonomy_rules_business_id_action_key_idx" ON "autonomy_rules"("business_id", "action_key");
CREATE INDEX IF NOT EXISTS "autonomy_verdicts_business_id_action_key_idx" ON "autonomy_verdicts"("business_id", "action_key");
CREATE INDEX IF NOT EXISTS "autonomy_verdicts_business_id_created_at_idx" ON "autonomy_verdicts"("business_id", "created_at");

-- Add foreign keys
ALTER TABLE "autonomy_rules" ADD CONSTRAINT "autonomy_rules_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "autonomy_verdicts" ADD CONSTRAINT "autonomy_verdicts_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Vector similarity index for semantic memory search
CREATE INDEX IF NOT EXISTS "ai_memory_embeddings_embedding_hnsw_idx"
    ON "ai_memory_embeddings" USING hnsw (embedding vector_cosine_ops);
