-- CreateTable
CREATE TABLE IF NOT EXISTS "google_form_mappings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "form_title" TEXT,
    "field_mappings" JSONB NOT NULL DEFAULT '[]',
    "opportunity_defaults" JSONB,
    "auto_create" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_response_time" TIMESTAMP(3),
    "last_backfill_at" TIMESTAMP(3),
    "responses_processed" INTEGER NOT NULL DEFAULT 0,
    "contacts_created" INTEGER NOT NULL DEFAULT 0,
    "opportunities_created" INTEGER NOT NULL DEFAULT 0,
    "processed_response_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_form_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "google_form_mappings_business_id_form_id_key" ON "google_form_mappings"("business_id", "form_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "google_form_mappings_business_id_idx" ON "google_form_mappings"("business_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "google_form_mappings" ADD CONSTRAINT "google_form_mappings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
