-- FIN7 — Track tax paid on purchases (input VAT) at the expense level.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "tax_amount" DOUBLE PRECISION DEFAULT 0;
