-- CreateTable
CREATE TABLE "cognition_sessions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "context_snapshot" JSONB DEFAULT '{}',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cognition_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_provider_costs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "session_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task_category" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "input_cost" DOUBLE PRECISION NOT NULL,
    "output_cost" DOUBLE PRECISION NOT NULL,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_provider_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cognition_sessions_business_id_session_id_idx" ON "cognition_sessions"("business_id", "session_id");

-- CreateIndex
CREATE INDEX "cognition_sessions_business_id_status_idx" ON "cognition_sessions"("business_id", "status");

-- CreateIndex
CREATE INDEX "cognition_sessions_created_at_idx" ON "cognition_sessions"("created_at");

-- CreateIndex
CREATE INDEX "llm_provider_costs_business_id_created_at_idx" ON "llm_provider_costs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_provider_costs_business_id_provider_idx" ON "llm_provider_costs"("business_id", "provider");

-- CreateIndex
CREATE INDEX "llm_provider_costs_business_id_task_category_idx" ON "llm_provider_costs"("business_id", "task_category");

-- AddForeignKey
ALTER TABLE "cognition_sessions" ADD CONSTRAINT "cognition_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_provider_costs" ADD CONSTRAINT "llm_provider_costs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
