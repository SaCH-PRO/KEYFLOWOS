-- AlterTable
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'openai';
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "latency_ms" INTEGER;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "fallback_used" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "fallback_provider" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "error_code" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "task_category" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_usage_logs_business_id_provider_idx" ON "ai_usage_logs"("business_id", "provider");
