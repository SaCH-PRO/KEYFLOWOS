-- Migration: Inventory Command Center (Task #90)
-- Adds stock_movements table and inventory sheet sync fields on businesses.
-- All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add inventory sheet sync fields to businesses table
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "inventory_linked_sheet_id"   TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "inventory_linked_sheet_name" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "inventory_last_sync_at"      TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Create stock_movements table (audit log for inventory changes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "stock_movements" (
    "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "business_id"      TEXT NOT NULL,
    "warehouse_id"     TEXT,
    "product_id"       TEXT,
    "type"             TEXT NOT NULL,
    "quantity_change"  INTEGER NOT NULL,
    "reason_code"      TEXT,
    "note"             TEXT,
    "reference_id"     TEXT,
    "created_by"       TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes for stock_movements
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "stock_movements_business_id_idx" ON "stock_movements"("business_id");
CREATE INDEX IF NOT EXISTS "stock_movements_product_id_idx"  ON "stock_movements"("product_id");
CREATE INDEX IF NOT EXISTS "stock_movements_created_at_idx"  ON "stock_movements"("created_at" DESC);
