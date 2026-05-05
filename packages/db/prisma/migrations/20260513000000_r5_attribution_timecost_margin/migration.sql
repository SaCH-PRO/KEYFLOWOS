-- R5: Money/People/Time/Goods leverage
-- Extends RevenueAttribution (campaign + staff + percent + edit audit),
-- adds TimeCostEntry ledger and links MarginSnapshot rows back to the
-- revenue event (invoice/order) that triggered them.

-- ---------------------------------------------------------------------------
-- 1. Revenue attribution: campaign / staff / percent / edit audit
-- ---------------------------------------------------------------------------
ALTER TABLE "revenue_attributions"
  ADD COLUMN "campaign_id"          TEXT,
  ADD COLUMN "staff_id"             TEXT,
  ADD COLUMN "attribution_percent"  DOUBLE PRECISION NOT NULL DEFAULT 100,
  ADD COLUMN "edited_at"            TIMESTAMP(3),
  ADD COLUMN "edited_by"            TEXT,
  ADD COLUMN "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "revenue_attributions_business_id_campaign_id_idx"
  ON "revenue_attributions"("business_id", "campaign_id");
CREATE INDEX "revenue_attributions_business_id_staff_id_idx"
  ON "revenue_attributions"("business_id", "staff_id");

-- Backfill: insert default attribution rows for invoices that don't yet have one.
-- Uses contact.source / invoice.campaignId / booking.staffId where available.
INSERT INTO "revenue_attributions" (
  "id", "business_id", "source", "source_detail", "revenue_type", "revenue_id",
  "contact_id", "campaign_id", "staff_id", "attribution_percent",
  "amount", "currency", "occurred_at", "created_at", "updated_at"
)
SELECT
  'ra_bf_' || substr(md5(i.id), 1, 22) AS id,
  i."business_id",
  COALESCE(NULLIF(c."source", ''), 'manual') AS source,
  c."source_detail",
  'INVOICE' AS revenue_type,
  i."id" AS revenue_id,
  i."contact_id",
  i."campaign_id",
  b."staff_id",
  100 AS attribution_percent,
  COALESCE(i."total", 0) AS amount,
  COALESCE(i."currency", 'TTD') AS currency,
  COALESCE(i."paid_at", i."created_at") AS occurred_at,
  CURRENT_TIMESTAMP AS created_at,
  CURRENT_TIMESTAMP AS updated_at
FROM "invoices" i
LEFT JOIN "contacts" c ON c."id" = i."contact_id"
LEFT JOIN "bookings" b ON b."id" = i."booking_id"
WHERE i."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "revenue_attributions" ra
    WHERE ra."business_id" = i."business_id"
      AND ra."revenue_type" = 'INVOICE'
      AND ra."revenue_id"   = i."id"
  );

-- ---------------------------------------------------------------------------
-- 2. Margin snapshot ↔ revenue event link
-- ---------------------------------------------------------------------------
ALTER TABLE "margin_snapshots"
  ADD COLUMN "invoice_id"   TEXT,
  ADD COLUMN "order_id"     TEXT,
  ADD COLUMN "quantity"     DOUBLE PRECISION,
  ADD COLUMN "gross_profit" DOUBLE PRECISION;

CREATE INDEX "margin_snapshots_invoice_id_idx" ON "margin_snapshots"("invoice_id");
CREATE INDEX "margin_snapshots_order_id_idx"   ON "margin_snapshots"("order_id");

-- ---------------------------------------------------------------------------
-- 3. TimeCostEntry ledger
-- ---------------------------------------------------------------------------
CREATE TABLE "time_cost_entries" (
  "id"          TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL,
  "ref_type"    TEXT NOT NULL,                      -- INVOICE | QUOTE | BOOKING | PROJECT | ORDER
  "ref_id"      TEXT NOT NULL,
  "contact_id"  TEXT,
  "staff_id"    TEXT,
  "user_id"     TEXT,
  "minutes"     INTEGER NOT NULL,
  "cost_rate"   DOUBLE PRECISION,
  "cost_amount" DOUBLE PRECISION,
  "currency"    TEXT NOT NULL DEFAULT 'TTD',
  "notes"       TEXT,
  "source"      TEXT NOT NULL DEFAULT 'manual',
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "time_cost_entries_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE
);

CREATE INDEX "time_cost_entries_business_id_ref_type_ref_id_idx"
  ON "time_cost_entries"("business_id", "ref_type", "ref_id");
CREATE INDEX "time_cost_entries_business_id_contact_id_occurred_at_idx"
  ON "time_cost_entries"("business_id", "contact_id", "occurred_at");
CREATE INDEX "time_cost_entries_business_id_staff_id_occurred_at_idx"
  ON "time_cost_entries"("business_id", "staff_id", "occurred_at");
CREATE INDEX "time_cost_entries_business_id_occurred_at_idx"
  ON "time_cost_entries"("business_id", "occurred_at");
