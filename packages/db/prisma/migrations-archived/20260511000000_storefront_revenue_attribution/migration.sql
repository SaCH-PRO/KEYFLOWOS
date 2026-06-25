-- S2: Storefront → Revenue/Goods/Services integration

-- Service: deposit + invoice timing config (per service)
ALTER TABLE "services"
  ADD COLUMN "invoice_timing"   TEXT,
  ADD COLUMN "deposit_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deposit_type"     TEXT,
  ADD COLUMN "deposit_value"    DOUBLE PRECISION;

-- Booking: deposit invoice + payment status
ALTER TABLE "bookings"
  ADD COLUMN "deposit_invoice_id" TEXT,
  ADD COLUMN "payment_status"     TEXT NOT NULL DEFAULT 'UNPAID';

CREATE UNIQUE INDEX "bookings_deposit_invoice_id_key" ON "bookings"("deposit_invoice_id");

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_deposit_invoice_id_fkey"
  FOREIGN KEY ("deposit_invoice_id") REFERENCES "invoices"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Revenue attribution rows
CREATE TABLE "revenue_attributions" (
  "id"                   TEXT PRIMARY KEY,
  "business_id"          TEXT NOT NULL,
  "source"               TEXT NOT NULL,
  "source_detail"        TEXT,
  "revenue_type"         TEXT NOT NULL,
  "revenue_id"           TEXT NOT NULL,
  "contact_id"           TEXT,
  "referral_contact_id"  TEXT,
  "referral_code"        TEXT,
  "visitor_id"           TEXT,
  "amount"               DOUBLE PRECISION NOT NULL,
  "currency"             TEXT NOT NULL DEFAULT 'TTD',
  "occurred_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "revenue_attributions_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "revenue_attributions_business_id_revenue_type_revenue_id_key"
  ON "revenue_attributions"("business_id", "revenue_type", "revenue_id");
CREATE INDEX "revenue_attributions_business_id_occurred_at_idx"
  ON "revenue_attributions"("business_id", "occurred_at");
CREATE INDEX "revenue_attributions_business_id_source_occurred_at_idx"
  ON "revenue_attributions"("business_id", "source", "occurred_at");
CREATE INDEX "revenue_attributions_business_id_referral_contact_id_idx"
  ON "revenue_attributions"("business_id", "referral_contact_id");
CREATE INDEX "revenue_attributions_business_id_contact_id_idx"
  ON "revenue_attributions"("business_id", "contact_id");

-- Daily storefront conversion aggregates
CREATE TABLE "storefront_conversion_daily" (
  "id"          TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL,
  "day"         DATE NOT NULL,
  "kind"        TEXT NOT NULL,
  "ref_id"      TEXT NOT NULL DEFAULT '',
  "views"       INTEGER NOT NULL DEFAULT 0,
  "cart_adds"   INTEGER NOT NULL DEFAULT 0,
  "checkouts"   INTEGER NOT NULL DEFAULT 0,
  "orders"      INTEGER NOT NULL DEFAULT 0,
  "bookings"    INTEGER NOT NULL DEFAULT 0,
  "revenue"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency"    TEXT NOT NULL DEFAULT 'TTD',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "storefront_conversion_daily_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "storefront_conversion_daily_business_id_day_kind_ref_id_key"
  ON "storefront_conversion_daily"("business_id", "day", "kind", "ref_id");
CREATE INDEX "storefront_conversion_daily_business_id_day_idx"
  ON "storefront_conversion_daily"("business_id", "day");
CREATE INDEX "storefront_conversion_daily_business_id_kind_day_idx"
  ON "storefront_conversion_daily"("business_id", "kind", "day");
