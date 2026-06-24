-- Track external accounting sync state for invoices pushed to QuickBooks/Xero.
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "external_accounting_source"     TEXT,
  ADD COLUMN IF NOT EXISTS "external_accounting_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "external_accounting_synced_at"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "invoices_business_id_external_accounting_source_external_a_idx"
  ON "invoices" ("business_id", "external_accounting_source", "external_accounting_id");
