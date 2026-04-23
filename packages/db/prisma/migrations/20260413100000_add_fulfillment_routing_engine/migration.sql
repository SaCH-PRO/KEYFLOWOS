-- Migration: Fulfillment Routing Engine (Task #81 — Mission 2)
-- The fulfillment_routes table was first created by:
--   20260413000000_add_mission2_commerce_supplier_architecture
-- with a legacy schema including fulfillment_model TEXT NOT NULL.
-- This migration upgrades that table to the full routing engine schema
-- and ensures compatibility for both fresh and existing DBs.
-- All statements are idempotent (IF NOT EXISTS / DO $$ guards).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend marketplace_listings with supplier fields + fulfillment strategy
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "marketplace_listings" ADD COLUMN IF NOT EXISTS "supplier_name"    TEXT;
ALTER TABLE "marketplace_listings" ADD COLUMN IF NOT EXISTS "supplier_email"   TEXT;
ALTER TABLE "marketplace_listings" ADD COLUMN IF NOT EXISTS "supplier_phone"   TEXT;
ALTER TABLE "marketplace_listings" ADD COLUMN IF NOT EXISTS "supplier_country" TEXT;
ALTER TABLE "marketplace_listings" ADD COLUMN IF NOT EXISTS "deposit_percent"  DOUBLE PRECISION;
-- fulfillment_strategy default was set to lowercase 'local_stock' by companion migration.
-- Upgrade to uppercase and backfill existing values.
ALTER TABLE "marketplace_listings" ALTER COLUMN "fulfillment_strategy" SET DEFAULT 'LOCAL_STOCK';
UPDATE "marketplace_listings"
   SET "fulfillment_strategy" = UPPER("fulfillment_strategy")
 WHERE "fulfillment_strategy" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Upgrade fulfillment_routes to the routing engine schema
-- ─────────────────────────────────────────────────────────────────────────────
-- Add new columns if not already present (table exists from companion migration)
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "business_id"        TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "order_id"           TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "order_item_id"      TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "listing_id"         TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "strategy"           TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "source_type"        TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "warehouse_id"       TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "purchase_order_id"  TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "pre_order_id"       TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "shipment_id"        TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "source_link_id"     TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "notes"              TEXT;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "metadata"           JSONB;
ALTER TABLE "fulfillment_routes" ADD COLUMN IF NOT EXISTS "resolved_at"        TIMESTAMP(3);
-- created_at / updated_at already exist from companion migration

-- Backfill strategy from legacy fulfillment_model column
UPDATE "fulfillment_routes"
   SET "strategy" = UPPER("fulfillment_model")
 WHERE "strategy" IS NULL
   AND "fulfillment_model" IS NOT NULL;

-- Ensure strategy has a sensible default for unmapped legacy rows
UPDATE "fulfillment_routes"
   SET "strategy" = 'MANUAL'
 WHERE "strategy" IS NULL;

-- Set NOT NULL on strategy now that it has been populated (matches Prisma schema)
-- First make it NOT NULL with a default so any in-flight rows are safe
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fulfillment_routes' AND column_name = 'strategy'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "fulfillment_routes" ALTER COLUMN "strategy" SET NOT NULL;
  END IF;
END $$;

-- Relax fulfillment_model: it is a legacy column from the companion migration.
-- Drop the NOT NULL constraint so new Prisma inserts (which don't write it) succeed.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fulfillment_routes' AND column_name = 'fulfillment_model'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "fulfillment_routes" ALTER COLUMN "fulfillment_model" DROP NOT NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Extend PurchaseOrder with lifecycle timestamps
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "submitted_at"    TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "acknowledged_at" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "shipped_at"      TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. Normalize MarketplaceOrder status default to match new state machine
-- ─────────────────────────────────────────────────────────────────────────────
-- Update default from 'PENDING' to 'placed' to match new lowercase status machine
ALTER TABLE "marketplace_orders" ALTER COLUMN "status" SET DEFAULT 'placed';
-- Backfill existing PENDING orders to 'placed' so state machine works consistently
UPDATE "marketplace_orders" SET "status" = 'placed' WHERE "status" = 'PENDING';
-- Note: other legacy uppercase statuses (CONFIRMED, PROCESSING, etc.) are left as-is
-- since they represent historical data; the application handles them gracefully.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Indexes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "fulfillment_routes_business_id_idx" ON "fulfillment_routes"("business_id");
-- order_id_idx and status_idx already created by companion migration

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Foreign key constraints (idempotent via DO blocks)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_routes_business_id_fkey') THEN
    ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_business_id_fkey"
      FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_routes_order_id_fkey') THEN
    ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_routes_listing_id_fkey') THEN
    ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_listing_id_fkey"
      FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_routes_warehouse_id_fkey') THEN
    ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_warehouse_id_fkey"
      FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_routes_purchase_order_id_fkey') THEN
    ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_purchase_order_id_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_routes_pre_order_id_fkey') THEN
    ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_pre_order_id_fkey"
      FOREIGN KEY ("pre_order_id") REFERENCES "pre_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_routes_shipment_id_fkey') THEN
    ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_shipment_id_fkey"
      FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_routes_source_link_id_fkey') THEN
    ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_source_link_id_fkey"
      FOREIGN KEY ("source_link_id") REFERENCES "product_source_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
