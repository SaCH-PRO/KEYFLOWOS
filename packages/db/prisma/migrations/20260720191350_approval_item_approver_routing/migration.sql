-- AlterTable
ALTER TABLE "ai_approval_items" ADD COLUMN     "approver_assignment_id" TEXT,
ADD COLUMN     "approver_method" TEXT,
ADD COLUMN     "notified_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ai_approval_items_business_id_approver_assignment_id_idx" ON "ai_approval_items"("business_id", "approver_assignment_id");
