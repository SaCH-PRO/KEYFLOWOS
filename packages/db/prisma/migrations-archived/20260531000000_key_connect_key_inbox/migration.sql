-- Add Key Inbox settings to connector_statuses
ALTER TABLE "connector_statuses"
ADD COLUMN IF NOT EXISTS "intake_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "auto_approve_threshold" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "create_contacts_automatically" BOOLEAN NOT NULL DEFAULT true;

-- Create ingestion_items table
CREATE TABLE IF NOT EXISTS "ingestion_items" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_connector_type" TEXT NOT NULL,
    "external_id" TEXT,
    "contact_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "raw_payload" JSONB NOT NULL,
    "summary" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "to_destination" TEXT,
    "received_at" TIMESTAMP(3),
    "attachments" JSONB,
    "from_name" TEXT,
    "from_email" TEXT,
    "from_phone" TEXT,
    "from_external_id" TEXT,
    "dedupe_hash" TEXT,
    "intent_type" TEXT,
    "confidence" DOUBLE PRECISION,
    "extracted_data" JSONB,
    "proposed_actions" JSONB,
    "user_feedback" JSONB,
    "executed_results" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_items_pkey" PRIMARY KEY ("id")
);

-- IngestionItem indexes
CREATE UNIQUE INDEX IF NOT EXISTS "ingestion_items_business_id_source_type_external_id_key" ON "ingestion_items"("business_id", "source_type", "external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ingestion_items_business_id_dedupe_hash_key" ON "ingestion_items"("business_id", "dedupe_hash");
CREATE INDEX IF NOT EXISTS "ingestion_items_business_id_status_idx" ON "ingestion_items"("business_id", "status");
CREATE INDEX IF NOT EXISTS "ingestion_items_business_id_source_type_idx" ON "ingestion_items"("business_id", "source_type");
CREATE INDEX IF NOT EXISTS "ingestion_items_business_id_created_at_idx" ON "ingestion_items"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "ingestion_items_business_id_contact_id_idx" ON "ingestion_items"("business_id", "contact_id");

-- IngestionItem foreign keys
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create webhook_delivery_logs table
CREATE TABLE IF NOT EXISTS "webhook_delivery_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "status_code" INTEGER,
    "response_body" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "webhook_delivery_logs_business_id_connector_type_created_at_idx"
    ON "webhook_delivery_logs"("business_id", "connector_type", "created_at");
