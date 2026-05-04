-- Add relationship-tracking fields to contacts.
-- Values are constrained at the API/UI layer (see CONTACT_RELATIONSHIP_TYPES, etc).
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "relationship_type" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "pipeline_stage" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "relationship_health" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "last_contacted_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "next_action_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "next_action_type" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "priority" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "favorite" BOOLEAN DEFAULT false;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "contacts_business_id_relationship_type_idx" ON "contacts"("business_id", "relationship_type");
CREATE INDEX IF NOT EXISTS "contacts_business_id_pipeline_stage_idx" ON "contacts"("business_id", "pipeline_stage");
CREATE INDEX IF NOT EXISTS "contacts_business_id_priority_idx" ON "contacts"("business_id", "priority");
CREATE INDEX IF NOT EXISTS "contacts_business_id_next_action_at_idx" ON "contacts"("business_id", "next_action_at");
CREATE INDEX IF NOT EXISTS "contacts_business_id_archived_at_idx" ON "contacts"("business_id", "archived_at");
