-- M6 — External contact sync (Google + Outlook + signature parsing)
-- Adds Microsoft (Outlook) contacts OAuth/delta-sync columns on businesses,
-- a per-business signature-parsing toggle, and a ContactSyncAudit table for
-- conflict-resolution audit logging across all contact sources.

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "ms_contacts_email"          TEXT,
  ADD COLUMN IF NOT EXISTS "ms_contacts_access_token"   TEXT,
  ADD COLUMN IF NOT EXISTS "ms_contacts_refresh_token"  TEXT,
  ADD COLUMN IF NOT EXISTS "ms_contacts_token_expiry"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ms_contacts_last_sync_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ms_contacts_delta_link"     TEXT,
  ADD COLUMN IF NOT EXISTS "signature_parsing_enabled"  BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "contact_sync_audits" (
  "id"             TEXT        NOT NULL,
  "business_id"    TEXT        NOT NULL,
  "contact_id"     TEXT,
  "source"         TEXT        NOT NULL,
  "external_id"    TEXT,
  "action"         TEXT        NOT NULL,
  "resolution"     TEXT,
  "fields_changed" TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "detail"         JSONB,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contact_sync_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "contact_sync_audits_business_id_source_created_at_idx"
  ON "contact_sync_audits" ("business_id", "source", "created_at");

CREATE INDEX IF NOT EXISTS "contact_sync_audits_business_id_contact_id_idx"
  ON "contact_sync_audits" ("business_id", "contact_id");
