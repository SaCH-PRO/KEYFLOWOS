-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_contacts" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "phone_number" TEXT NOT NULL,
  "display_name" TEXT,
  "contact_id" TEXT,
  "last_message_at" TIMESTAMP(3),
  "last_message_snippet" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_contacts_business_id_phone_number_key" ON "whatsapp_contacts"("business_id", "phone_number");
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_business_id_last_message_at_idx" ON "whatsapp_contacts"("business_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_contact_id_idx" ON "whatsapp_contacts"("contact_id");

ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "whatsapp_contact_id" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "body" TEXT,
  "template_name" TEXT,
  "template_language" TEXT,
  "template_params" JSONB,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "scheduled_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "wamid" TEXT,
  "destination_id" TEXT,
  "error_message" TEXT,
  "media_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_wamid_key" ON "whatsapp_messages"("wamid");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_business_id_whatsapp_contact_id_created_at_idx" ON "whatsapp_messages"("business_id", "whatsapp_contact_id", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_business_id_created_at_idx" ON "whatsapp_messages"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_status_scheduled_at_idx" ON "whatsapp_messages"("status", "scheduled_at");

ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_whatsapp_contact_id_fkey" FOREIGN KEY ("whatsapp_contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
