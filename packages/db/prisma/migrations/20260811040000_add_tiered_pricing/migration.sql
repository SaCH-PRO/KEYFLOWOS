-- Tiered pricing: a customer pricing tier on contacts + per-product tier price overrides.
-- RETAIL price stays on products.price; non-retail tiers (e.g. WHOLESALE) live in product_tier_prices.

ALTER TABLE "contacts" ADD COLUMN "pricing_tier" TEXT NOT NULL DEFAULT 'RETAIL';

CREATE TABLE "product_tier_prices" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_tier_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_tier_prices_product_id_tier_key" ON "product_tier_prices"("product_id", "tier");

CREATE INDEX "product_tier_prices_business_id_idx" ON "product_tier_prices"("business_id");

ALTER TABLE "product_tier_prices" ADD CONSTRAINT "product_tier_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
