-- CreateTable
CREATE TABLE "key_action_proposals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "source_mode" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "rationale" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "risk_level" TEXT NOT NULL DEFAULT 'LOW',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "executed_by" TEXT,
    "executed_at" TIMESTAMP(3),
    "execution_result" JSONB,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_action_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_idx" ON "key_action_proposals"("business_id");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_status_idx" ON "key_action_proposals"("business_id", "status");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_source_type_idx" ON "key_action_proposals"("business_id", "source_type");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_action_type_idx" ON "key_action_proposals"("business_id", "action_type");

