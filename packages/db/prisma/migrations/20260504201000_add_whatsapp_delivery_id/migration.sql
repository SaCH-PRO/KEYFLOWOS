ALTER TABLE "whatsapp_messages" ADD COLUMN "delivery_id" TEXT;
CREATE UNIQUE INDEX "whatsapp_messages_delivery_id_key" ON "whatsapp_messages"("delivery_id");
