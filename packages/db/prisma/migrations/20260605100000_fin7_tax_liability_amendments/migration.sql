-- FIN7: Proper amendment modelling for TaxLiability — replaces the
-- periodStart+1ms hack. An amendment is a new row that references the
-- locked original via amends_tax_liability_id, with a monotonic version.

ALTER TABLE "tax_liabilities"
  ADD COLUMN "amends_tax_liability_id" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "is_amendment" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "tax_liabilities"
  ADD CONSTRAINT "tax_liabilities_amends_fkey"
  FOREIGN KEY ("amends_tax_liability_id") REFERENCES "tax_liabilities"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tax_liabilities_amends_tax_liability_id_idx"
  ON "tax_liabilities" ("amends_tax_liability_id");

-- Drop the old period-uniqueness so amendments can share (start, end) with
-- their original. Replace it with a partial index that only enforces
-- uniqueness across non-amendment rows.
ALTER TABLE "tax_liabilities"
  DROP CONSTRAINT IF EXISTS "tax_liabilities_business_id_type_period_start_period_end_key";

CREATE UNIQUE INDEX "tax_liabilities_canonical_period_unique"
  ON "tax_liabilities" ("business_id", "type", "period_start", "period_end")
  WHERE "is_amendment" = FALSE;
