-- AlterTable
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "contact_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "service_id" TEXT;

-- CreateIndex (composite with businessId to match schema)
CREATE INDEX IF NOT EXISTS "expenses_business_id_project_id_idx" ON "expenses"("business_id", "project_id");
CREATE INDEX IF NOT EXISTS "expenses_business_id_contact_id_idx" ON "expenses"("business_id", "contact_id");
CREATE INDEX IF NOT EXISTS "expenses_business_id_service_id_idx" ON "expenses"("business_id", "service_id");
