-- Add per-user saved views for the contacts pipeline.
ALTER TABLE "contact_lists" ADD COLUMN IF NOT EXISTS "rules" JSONB;

CREATE TABLE IF NOT EXISTS "contact_saved_views" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "filter_state" JSONB NOT NULL,
  "sort" JSONB,
  "visible_columns" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contact_saved_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_saved_views_user_id_business_id_name_key"
  ON "contact_saved_views"("user_id", "business_id", "name");
CREATE INDEX IF NOT EXISTS "contact_saved_views_business_id_user_id_idx"
  ON "contact_saved_views"("business_id", "user_id");
