-- CreateTable
CREATE TABLE IF NOT EXISTS "connector_statuses" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "connected_at" TIMESTAMP(3),
    "connected_account" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error" TEXT,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "sync_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "contact_external_mappings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_external_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "connector_statuses_business_id_idx" ON "connector_statuses"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "connector_statuses_business_id_connector_type_key" ON "connector_statuses"("business_id", "connector_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_external_mappings_contact_id_idx" ON "contact_external_mappings"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contact_external_mappings_business_id_source_external_id_key" ON "contact_external_mappings"("business_id", "source", "external_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contact_external_mappings_contact_id_fkey'
    ) THEN
        ALTER TABLE "contact_external_mappings" ADD CONSTRAINT "contact_external_mappings_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
