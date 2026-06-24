-- R2: recurring failure tracking + invoice<->recurring link + receipt resend timestamp.

ALTER TABLE "recurring_invoices"
  ADD COLUMN IF NOT EXISTS "failure_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_failure_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_error"      TEXT,
  ADD COLUMN IF NOT EXISTS "cancelled_at"    TIMESTAMP(3);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "recurring_invoice_id" TEXT,
  ADD COLUMN IF NOT EXISTS "receipt_sent_at"      TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "invoices_business_id_recurring_invoice_id_idx"
  ON "invoices"("business_id", "recurring_invoice_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_recurring_invoice_id_fkey'
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_recurring_invoice_id_fkey"
      FOREIGN KEY ("recurring_invoice_id") REFERENCES "recurring_invoices"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
