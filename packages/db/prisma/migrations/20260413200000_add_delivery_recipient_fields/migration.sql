-- Migration: Add per-recipient fields to OutboundDelivery + campaign contact lifecycle (Task #78 — Mission 1)
-- Enables per-recipient delivery expansion for email campaigns and WhatsApp audience sends.
-- Adds clicked_at and bounced_at to email_campaign_contacts for full lifecycle tracking.
-- All statements are idempotent (IF NOT EXISTS / DO $$ guards).

-- OutboundDelivery per-recipient fields
ALTER TABLE "outbound_deliveries" ADD COLUMN IF NOT EXISTS "contact_id" TEXT;
ALTER TABLE "outbound_deliveries" ADD COLUMN IF NOT EXISTS "recipient_email" TEXT;
ALTER TABLE "outbound_deliveries" ADD COLUMN IF NOT EXISTS "recipient_phone" TEXT;

CREATE INDEX IF NOT EXISTS "outbound_deliveries_contact_id_idx" ON "outbound_deliveries"("contact_id");

-- EmailCampaignContact lifecycle fields
ALTER TABLE "email_campaign_contacts" ADD COLUMN IF NOT EXISTS "clicked_at" TIMESTAMP(3);
ALTER TABLE "email_campaign_contacts" ADD COLUMN IF NOT EXISTS "bounced_at" TIMESTAMP(3);
