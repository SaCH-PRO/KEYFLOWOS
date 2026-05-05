-- Task #584 (INV1): Per-product out-of-stock behavior controlling whether
-- the public storefront hides, shows-as-OOS, or allows backorder for a
-- tracked product whose available quantity has reached zero.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "out_of_stock_behavior" TEXT DEFAULT 'hide';
