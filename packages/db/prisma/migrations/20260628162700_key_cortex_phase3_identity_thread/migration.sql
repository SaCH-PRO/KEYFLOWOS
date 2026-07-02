-- Phase 3 Skeleton: add cross-cutting identity thread to KEY Cortex tables

-- CortexSession: link session to a turn/command correlation
ALTER TABLE "cortex_sessions" ADD COLUMN IF NOT EXISTS "correlation_id" TEXT;
ALTER TABLE "cortex_sessions" ADD COLUMN IF NOT EXISTS "command_id" TEXT;
CREATE INDEX IF NOT EXISTS "cortex_sessions_business_id_correlation_id_idx" ON "cortex_sessions"("business_id", "correlation_id");

-- KeyCommand: link command back to originating chat session
ALTER TABLE "key_commands" ADD COLUMN IF NOT EXISTS "session_id" TEXT;
ALTER TABLE "key_commands" ADD COLUMN IF NOT EXISTS "correlation_id" TEXT;
CREATE INDEX IF NOT EXISTS "key_commands_business_id_correlation_id_idx" ON "key_commands"("business_id", "correlation_id");

-- AiExecutionLog: link execution to session/command/turn
ALTER TABLE "ai_execution_logs" ADD COLUMN IF NOT EXISTS "session_id" TEXT;
ALTER TABLE "ai_execution_logs" ADD COLUMN IF NOT EXISTS "command_id" TEXT;
ALTER TABLE "ai_execution_logs" ADD COLUMN IF NOT EXISTS "correlation_id" TEXT;
CREATE INDEX IF NOT EXISTS "ai_execution_logs_business_id_correlation_id_idx" ON "ai_execution_logs"("business_id", "correlation_id");

-- CortexActionLog: lifecycle timestamps, required tenant, identity thread
ALTER TABLE "cortex_action_logs" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3);
ALTER TABLE "cortex_action_logs" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);
ALTER TABLE "cortex_action_logs" ADD COLUMN IF NOT EXISTS "duration_ms" INTEGER;
ALTER TABLE "cortex_action_logs" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "cortex_action_logs" ADD COLUMN IF NOT EXISTS "command_id" TEXT;
ALTER TABLE "cortex_action_logs" ADD COLUMN IF NOT EXISTS "correlation_id" TEXT;
ALTER TABLE "cortex_action_logs" ADD COLUMN IF NOT EXISTS "business_id" TEXT;

-- Remove orphaned action logs that cannot be tied to a business before making business_id required.
DELETE FROM "cortex_action_logs" WHERE "business_id" IS NULL;

-- Drop the loose foreign key and enforce required business_id with cascade delete.
ALTER TABLE "cortex_action_logs" DROP CONSTRAINT IF EXISTS "cortex_action_logs_business_id_fkey";
ALTER TABLE "cortex_action_logs" ALTER COLUMN "business_id" SET NOT NULL;
ALTER TABLE "cortex_action_logs" ADD CONSTRAINT "cortex_action_logs_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "cortex_action_logs_business_id_created_at_idx" ON "cortex_action_logs"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "cortex_action_logs_business_id_correlation_id_idx" ON "cortex_action_logs"("business_id", "correlation_id");

-- AiApprovalItem: identity thread
ALTER TABLE "ai_approval_items" ADD COLUMN IF NOT EXISTS "correlation_id" TEXT;
CREATE INDEX IF NOT EXISTS "ai_approval_items_business_id_correlation_id_idx" ON "ai_approval_items"("business_id", "correlation_id");

-- BusinessEvent: identity thread so audit log ties back to AI session/command
ALTER TABLE "business_events" ADD COLUMN IF NOT EXISTS "session_id" TEXT;
ALTER TABLE "business_events" ADD COLUMN IF NOT EXISTS "command_id" TEXT;
ALTER TABLE "business_events" ADD COLUMN IF NOT EXISTS "correlation_id" TEXT;
CREATE INDEX IF NOT EXISTS "business_events_business_id_correlation_id_idx" ON "business_events"("business_id", "correlation_id");
