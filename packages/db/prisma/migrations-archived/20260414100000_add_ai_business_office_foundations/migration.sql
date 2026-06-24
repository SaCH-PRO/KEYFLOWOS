-- CreateTable
CREATE TABLE "ai_execution_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "tool_name" TEXT,
    "module" TEXT,
    "risk_tier" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL DEFAULT 'assisted',
    "actor" TEXT NOT NULL DEFAULT 'user',
    "rationale" TEXT,
    "input_summary" JSONB,
    "output_summary" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "plan_id" TEXT,
    "plan_step_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_approval_items" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "risk_tier" INTEGER NOT NULL DEFAULT 2,
    "tool_name" TEXT NOT NULL,
    "module" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rationale" TEXT,
    "expected_benefit" TEXT,
    "risks" TEXT,
    "input_payload" JSONB,
    "affected_entities" JSONB,
    "plan_id" TEXT,
    "plan_step_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolved_by_user_id" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_approval_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_memories" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'user',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_plans" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "objective" TEXT NOT NULL,
    "raw_input" TEXT,
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "scope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_risk_tier" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_plan_steps" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tool_name" TEXT,
    "module" TEXT,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "risk_tier" INTEGER NOT NULL DEFAULT 1,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "depends_on" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "input_payload" JSONB,
    "output_result" JSONB,
    "expected_benefit" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_plan_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_execution_logs_business_id_created_at_idx" ON "ai_execution_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_execution_logs_business_id_module_idx" ON "ai_execution_logs"("business_id", "module");

-- CreateIndex
CREATE INDEX "ai_execution_logs_business_id_tool_name_idx" ON "ai_execution_logs"("business_id", "tool_name");

-- CreateIndex
CREATE INDEX "ai_execution_logs_plan_id_idx" ON "ai_execution_logs"("plan_id");

-- CreateIndex
CREATE INDEX "ai_approval_items_business_id_status_idx" ON "ai_approval_items"("business_id", "status");

-- CreateIndex
CREATE INDEX "ai_approval_items_business_id_created_at_idx" ON "ai_approval_items"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_approval_items_plan_id_idx" ON "ai_approval_items"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_memories_business_id_category_key_key" ON "ai_memories"("business_id", "category", "key");

-- CreateIndex
CREATE INDEX "ai_memories_business_id_category_idx" ON "ai_memories"("business_id", "category");

-- CreateIndex
CREATE INDEX "ai_plans_business_id_status_idx" ON "ai_plans"("business_id", "status");

-- CreateIndex
CREATE INDEX "ai_plans_business_id_created_at_idx" ON "ai_plans"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_plan_steps_plan_id_order_idx" ON "ai_plan_steps"("plan_id", "order");

-- AddForeignKey
ALTER TABLE "ai_execution_logs" ADD CONSTRAINT "ai_execution_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_execution_logs" ADD CONSTRAINT "ai_execution_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_items" ADD CONSTRAINT "ai_approval_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_items" ADD CONSTRAINT "ai_approval_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_items" ADD CONSTRAINT "ai_approval_items_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plan_steps" ADD CONSTRAINT "ai_plan_steps_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ai_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
