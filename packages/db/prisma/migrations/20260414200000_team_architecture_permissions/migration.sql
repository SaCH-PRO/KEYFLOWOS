-- AlterTable
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "permission_scopes" JSONB,
ADD COLUMN IF NOT EXISTS "max_approval_tier" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "team_activity_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "team_activity_logs_business_id_created_at_idx" ON "team_activity_logs"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "team_activity_logs_business_id_user_id_idx" ON "team_activity_logs"("business_id", "user_id");
CREATE INDEX IF NOT EXISTS "team_activity_logs_business_id_module_idx" ON "team_activity_logs"("business_id", "module");
