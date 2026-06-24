-- Mission 2: Commerce Data Layer & Supplier Architecture
-- Adds SupplierConnection, SupplierProduct, SupplierVariant, ProductVariant,
-- ProductSourceLink, ProductCostProfile, MarginSnapshot, FulfillmentRoute
-- Upgrades Product, MarketplaceListing, PurchaseOrder models

-- Product model upgrades
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "fulfillment_model" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "inventory_mode" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "compare_at_price" DOUBLE PRECISION;

-- MarketplaceListing model upgrade
ALTER TABLE "marketplace_listings" ADD COLUMN IF NOT EXISTS "fulfillment_strategy" TEXT DEFAULT 'local_stock';

-- SupplierConnection model
CREATE TABLE IF NOT EXISTS "supplier_connections" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "credentials" JSONB,
    "account_meta" JSONB,
    "connection_health" TEXT NOT NULL DEFAULT 'unknown',
    "sync_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "last_sync_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_connections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_connections_business_id_idx" ON "supplier_connections"("business_id");
CREATE INDEX IF NOT EXISTS "supplier_connections_business_id_provider_type_idx" ON "supplier_connections"("business_id", "provider_type");

-- PurchaseOrder: Add supplierConnectionId
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "supplier_connection_id" TEXT;
CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_connection_id_idx" ON "purchase_orders"("supplier_connection_id");

-- SupplierProduct model
CREATE TABLE IF NOT EXISTS "supplier_products" (
    "id" TEXT NOT NULL,
    "supplier_connection_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "normalized_title" TEXT,
    "normalized_description" TEXT,
    "normalized_price" DOUBLE PRECISION,
    "normalized_images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "availability" TEXT NOT NULL DEFAULT 'unknown',
    "lead_time_days" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_products_supplier_connection_id_external_id_key" ON "supplier_products"("supplier_connection_id", "external_id");
CREATE INDEX IF NOT EXISTS "supplier_products_supplier_connection_id_idx" ON "supplier_products"("supplier_connection_id");

-- SupplierVariant model
CREATE TABLE IF NOT EXISTS "supplier_variants" (
    "id" TEXT NOT NULL,
    "supplier_product_id" TEXT NOT NULL,
    "external_variant_id" TEXT,
    "attributes" JSONB NOT NULL,
    "sku" TEXT,
    "price" DOUBLE PRECISION,
    "availability" TEXT NOT NULL DEFAULT 'unknown',
    "stock_qty" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_variants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_variants_supplier_product_id_idx" ON "supplier_variants"("supplier_product_id");

-- ProductVariant model
CREATE TABLE IF NOT EXISTS "product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "sku" TEXT,
    "price_override" DOUBLE PRECISION,
    "image_url" TEXT,
    "track_stock" BOOLEAN NOT NULL DEFAULT false,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_variants_product_id_idx" ON "product_variants"("product_id");

-- ProductSourceLink model
CREATE TABLE IF NOT EXISTS "product_source_links" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "supplier_product_id" TEXT NOT NULL,
    "source_cost" DOUBLE PRECISION,
    "lead_time_days" INTEGER,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "shipping_assumptions" JSONB,
    "availability_state" TEXT NOT NULL DEFAULT 'available',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_source_links_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_source_links_product_id_idx" ON "product_source_links"("product_id");
CREATE INDEX IF NOT EXISTS "product_source_links_supplier_product_id_idx" ON "product_source_links"("supplier_product_id");

-- ProductCostProfile model
CREATE TABLE IF NOT EXISTS "product_cost_profiles" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "source_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shipping_estimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duties_estimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "packaging_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transaction_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "landed_cost_estimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gross_margin" DOUBLE PRECISION,
    "margin_band" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_cost_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "product_cost_profiles_product_id_key" ON "product_cost_profiles"("product_id");

-- MarginSnapshot model
CREATE TABLE IF NOT EXISTS "margin_snapshots" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "source_cost" DOUBLE PRECISION NOT NULL,
    "selling_price" DOUBLE PRECISION NOT NULL,
    "landed_cost_estimate" DOUBLE PRECISION NOT NULL,
    "gross_margin" DOUBLE PRECISION NOT NULL,
    "margin_band" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "snapshot_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "margin_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "margin_snapshots_product_id_idx" ON "margin_snapshots"("product_id");
CREATE INDEX IF NOT EXISTS "margin_snapshots_product_id_created_at_idx" ON "margin_snapshots"("product_id", "created_at");

-- FulfillmentRoute model
CREATE TABLE IF NOT EXISTS "fulfillment_routes" (
    "id" TEXT NOT NULL,
    "product_id" TEXT,
    "order_id" TEXT,
    "order_line_id" TEXT,
    "fulfillment_model" TEXT NOT NULL,
    "source_supplier" TEXT,
    "warehouse" TEXT,
    "lead_time_days" INTEGER,
    "shipping_method" TEXT,
    "tracking_state" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fallback_logic" JSONB,
    "cost_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fulfillment_routes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "fulfillment_routes_order_id_idx" ON "fulfillment_routes"("order_id");
CREATE INDEX IF NOT EXISTS "fulfillment_routes_product_id_idx" ON "fulfillment_routes"("product_id");
CREATE INDEX IF NOT EXISTS "fulfillment_routes_status_idx" ON "fulfillment_routes"("status");

-- Foreign key constraints
ALTER TABLE "supplier_connections" ADD CONSTRAINT "supplier_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_connection_id_fkey" FOREIGN KEY ("supplier_connection_id") REFERENCES "supplier_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_connection_id_fkey" FOREIGN KEY ("supplier_connection_id") REFERENCES "supplier_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_variants" ADD CONSTRAINT "supplier_variants_supplier_product_id_fkey" FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_source_links" ADD CONSTRAINT "product_source_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_source_links" ADD CONSTRAINT "product_source_links_supplier_product_id_fkey" FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_cost_profiles" ADD CONSTRAINT "product_cost_profiles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "margin_snapshots" ADD CONSTRAINT "margin_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
