-- FIN5: Business-level finance settings + per-business tax rates.

-- Note: "accounting_basis" is added by a later FIN2 migration
-- (20260605000000_fin2_revenue_ledger). Omitted here to avoid duplicate-column.
ALTER TABLE "businesses"
  ADD COLUMN "fiscal_year_start_month"   INTEGER DEFAULT 1,
  ADD COLUMN "default_cash_account_id"   TEXT,
  ADD COLUMN "default_ar_account_id"     TEXT,
  ADD COLUMN "default_ap_account_id"     TEXT,
  ADD COLUMN "default_tax_account_id"    TEXT;

CREATE TABLE "tax_rates" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "rate"        DECIMAL(8,4) NOT NULL,
  "type"        TEXT,
  "is_default"  BOOLEAN NOT NULL DEFAULT false,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tax_rates_business_id_name_key"
  ON "tax_rates" ("business_id", "name");
CREATE INDEX "tax_rates_business_id_is_active_idx"
  ON "tax_rates" ("business_id", "is_active");

ALTER TABLE "tax_rates"
  ADD CONSTRAINT "tax_rates_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
