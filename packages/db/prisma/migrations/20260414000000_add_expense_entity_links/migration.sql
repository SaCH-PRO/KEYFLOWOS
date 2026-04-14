-- AlterTable
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "contact_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "service_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "expenses_project_id_idx" ON "expenses"("project_id");
CREATE INDEX IF NOT EXISTS "expenses_contact_id_idx" ON "expenses"("contact_id");
CREATE INDEX IF NOT EXISTS "expenses_service_id_idx" ON "expenses"("service_id");
