-- AlterTable
ALTER TABLE "ai_plans" ADD COLUMN     "goal_id" TEXT;

-- CreateTable
CREATE TABLE "ai_goals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "target_date" TIMESTAMP(3),
    "parent_goal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_plan_results" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "goal_achievement_score" INTEGER,
    "user_feedback" TEXT,
    "business_impact_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,

    CONSTRAINT "ai_plan_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_cortex_trigger_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "filter_json" JSONB,
    "goal_template_id" TEXT,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_daily_firings" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_cortex_trigger_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_outcome_scores" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "approval_count" INTEGER NOT NULL DEFAULT 0,
    "avg_execution_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_outcome_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_variants" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "variant_key" TEXT NOT NULL,
    "prompt_template" TEXT NOT NULL,
    "selection_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_goals_business_id_status_idx" ON "ai_goals"("business_id", "status");

-- CreateIndex
CREATE INDEX "ai_goals_business_id_priority_idx" ON "ai_goals"("business_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ai_plan_results_plan_id_key" ON "ai_plan_results"("plan_id");

-- CreateIndex
CREATE INDEX "ai_plan_results_plan_id_idx" ON "ai_plan_results"("plan_id");

-- CreateIndex
CREATE INDEX "key_cortex_trigger_rules_business_id_event_type_idx" ON "key_cortex_trigger_rules"("business_id", "event_type");

-- CreateIndex
CREATE INDEX "key_cortex_trigger_rules_business_id_enabled_idx" ON "key_cortex_trigger_rules"("business_id", "enabled");

-- CreateIndex
CREATE INDEX "tool_outcome_scores_business_id_tool_name_idx" ON "tool_outcome_scores"("business_id", "tool_name");

-- CreateIndex
CREATE UNIQUE INDEX "tool_outcome_scores_business_id_tool_name_key" ON "tool_outcome_scores"("business_id", "tool_name");

-- CreateIndex
CREATE INDEX "prompt_variants_business_id_variant_key_idx" ON "prompt_variants"("business_id", "variant_key");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_variants_business_id_variant_key_key" ON "prompt_variants"("business_id", "variant_key");

-- AddForeignKey
ALTER TABLE "ai_goals" ADD CONSTRAINT "ai_goals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plan_results" ADD CONSTRAINT "ai_plan_results_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ai_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plan_results" ADD CONSTRAINT "ai_plan_results_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_cortex_trigger_rules" ADD CONSTRAINT "key_cortex_trigger_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_outcome_scores" ADD CONSTRAINT "tool_outcome_scores_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_variants" ADD CONSTRAINT "prompt_variants_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "ai_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

