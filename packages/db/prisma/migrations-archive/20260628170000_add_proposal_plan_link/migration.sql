-- Add plan linkage to KeyActionProposal for AI plan step approvals
ALTER TABLE "key_action_proposals" ADD COLUMN "plan_id" TEXT;
ALTER TABLE "key_action_proposals" ADD COLUMN "plan_step_id" TEXT;

CREATE INDEX "key_action_proposals_plan_id_idx" ON "key_action_proposals"("plan_id");
CREATE INDEX "key_action_proposals_plan_step_id_idx" ON "key_action_proposals"("plan_step_id");
