-- AlterTable
ALTER TABLE "key_action_proposals" ADD COLUMN     "affected_entities" JSONB,
ADD COLUMN     "business_event_id" TEXT,
ADD COLUMN     "command_id" TEXT,
ADD COLUMN     "correlation_id" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "expected_benefit" TEXT,
ADD COLUMN     "input_payload" JSONB,
ADD COLUMN     "module" TEXT,
ADD COLUMN     "multi_step_parent_id" TEXT,
ADD COLUMN     "resolution" JSONB,
ADD COLUMN     "resolved_by_user_id" TEXT,
ADD COLUMN     "risks" TEXT,
ADD COLUMN     "session_id" TEXT,
ADD COLUMN     "tool_name" TEXT;

-- AlterTable
ALTER TABLE "ai_approval_items" ADD COLUMN     "migrated_to_proposal_id" TEXT;

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "migrated_to_proposal_id" TEXT;

-- AlterTable
ALTER TABLE "cortex_action_logs" ADD COLUMN     "proposal_id" TEXT;

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_tool_name_idx" ON "key_action_proposals"("business_id", "tool_name");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_correlation_id_idx" ON "key_action_proposals"("business_id", "correlation_id");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_command_id_idx" ON "key_action_proposals"("business_id", "command_id");

-- CreateIndex
CREATE INDEX "key_action_proposals_multi_step_parent_id_idx" ON "key_action_proposals"("multi_step_parent_id");

-- CreateIndex
CREATE INDEX "ai_approval_items_migrated_to_proposal_id_idx" ON "ai_approval_items"("migrated_to_proposal_id");

-- CreateIndex
CREATE INDEX "approval_requests_migrated_to_proposal_id_idx" ON "approval_requests"("migrated_to_proposal_id");

-- CreateIndex
CREATE INDEX "cortex_action_logs_business_id_proposal_id_idx" ON "cortex_action_logs"("business_id", "proposal_id");

