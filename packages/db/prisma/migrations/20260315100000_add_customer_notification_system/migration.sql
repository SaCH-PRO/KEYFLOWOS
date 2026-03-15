-- AlterTable
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "notification_preferences" JSONB DEFAULT '{}';

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_notification_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "type" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "recipient_name" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "message_id" TEXT,
    "error" TEXT,
    "template_data" JSONB,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_notification_logs_business_id_created_at_idx" ON "customer_notification_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_notification_logs_business_id_type_idx" ON "customer_notification_logs"("business_id", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_notification_logs_business_id_status_idx" ON "customer_notification_logs"("business_id", "status");

-- AddForeignKey
ALTER TABLE "customer_notification_logs" ADD CONSTRAINT "customer_notification_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
