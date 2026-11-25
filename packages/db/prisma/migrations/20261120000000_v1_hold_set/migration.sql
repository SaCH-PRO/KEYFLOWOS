-- V1-64 (MIGRATION-SET-A, owner rulings D-165, D-166, D-167):
-- Single v1 hold migration set:
--   1. businesses.vat_number: TEXT NULL (D-165)
--   2. contacts.pricing_tier: TEXT NULL (D-167)
--   3. quote_items.quantity and invoice_items.quantity: INTEGER -> DOUBLE PRECISION (D-166)
--   4. product_tier_prices table with UNIQUE (product_id, tier) and tenant indexes (D-167)
--   (No chart_of_accounts unique index — stays service-level 409 per SWP-COA-UNIQUE-CODE.)

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "vat_number" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "pricing_tier" TEXT;

-- AlterTable
ALTER TABLE "quote_items" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "invoice_items" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- CreateTable
CREATE TABLE IF NOT EXISTS "product_tier_prices" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_tier_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_tier_prices_business_id_idx" ON "product_tier_prices"("business_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_tier_prices_business_id_product_id_idx" ON "product_tier_prices"("business_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "product_tier_prices_product_id_tier_key" ON "product_tier_prices"("product_id", "tier");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'product_tier_prices_business_id_fkey'
    ) THEN
        ALTER TABLE "product_tier_prices"
            ADD CONSTRAINT "product_tier_prices_business_id_fkey"
            FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'product_tier_prices_product_id_fkey'
    ) THEN
        ALTER TABLE "product_tier_prices"
            ADD CONSTRAINT "product_tier_prices_product_id_fkey"
            FOREIGN KEY ("product_id") REFERENCES "products"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
