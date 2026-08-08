-- AlterTable
ALTER TABLE "org_assignments" ADD COLUMN     "active_flow_session_id" TEXT,
ADD COLUMN     "auto_approval_via_reply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "is_contact_only" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferred_channel" TEXT NOT NULL DEFAULT 'whatsapp',
ALTER COLUMN "membership_id" DROP NOT NULL,
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "org_assignments_business_id_contact_phone_idx" ON "org_assignments"("business_id", "contact_phone");
