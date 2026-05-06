-- FIN7 — Canonical TaxRate FK on Invoice and Expense; numeric fields
-- retained as legacy fallback.
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "tax_rate_id" TEXT,
  ADD CONSTRAINT "invoices_tax_rate_id_fkey"
    FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "invoices_tax_rate_id_idx" ON "invoices"("tax_rate_id");

ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "tax_rate_id" TEXT,
  ADD CONSTRAINT "expenses_tax_rate_id_fkey"
    FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "expenses_tax_rate_id_idx" ON "expenses"("tax_rate_id");
