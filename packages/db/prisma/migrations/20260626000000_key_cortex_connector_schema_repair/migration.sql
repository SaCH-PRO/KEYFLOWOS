-- ────────────────────────────────────────────────────────────────────────────
-- Key Cortex / Key Connector / Keystore schema repair
-- Creates tables/columns that merged remote code expects but that were not
-- reflected in the Prisma schema or baseline migration.
-- All statements are idempotent so the migration is safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- ── IntegrationConnection additions ─────────────────────────────────────────
ALTER TABLE "integration_connections"
    ADD COLUMN IF NOT EXISTS "display_name" TEXT,
    ADD COLUMN IF NOT EXISTS "auth_data" JSONB,
    ADD COLUMN IF NOT EXISTS "health_score" INTEGER NOT NULL DEFAULT 100;

-- ── Connector audit logging ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "connector_audit_logs" (
    "id"            TEXT NOT NULL,
    "business_id"   TEXT NOT NULL,
    "user_id"       TEXT,
    "provider_key"  TEXT,
    "connection_id" TEXT,
    "action"        TEXT NOT NULL,
    "status"        TEXT NOT NULL,
    "details"       TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "connector_audit_logs_business_id_idx"
    ON "connector_audit_logs"("business_id");
CREATE INDEX IF NOT EXISTS "connector_audit_logs_business_id_created_at_idx"
    ON "connector_audit_logs"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "connector_audit_logs_connection_id_idx"
    ON "connector_audit_logs"("connection_id");

-- ── Keystore service marketplace ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "keystore_service_categories" (
    "id"          TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "slug"        TEXT NOT NULL,
    "icon"        TEXT,
    "description" TEXT,
    "sort_order"  INT  NOT NULL DEFAULT 0,
    "is_active"   BOOLEAN NOT NULL DEFAULT true,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keystore_service_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "keystore_service_categories_business_slug_unique" UNIQUE ("business_id", "slug")
);

CREATE TABLE IF NOT EXISTS "keystore_service_listings" (
    "id"                TEXT NOT NULL,
    "business_id"       TEXT NOT NULL,
    "category_id"       TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "slug"              TEXT NOT NULL,
    "description"       TEXT NOT NULL,
    "short_description" TEXT,
    "features"          TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliverables"      JSONB DEFAULT '[]',
    "pricing_tiers"     JSONB DEFAULT '[]',
    "addons"            JSONB DEFAULT '[]',
    "faq"               JSONB DEFAULT '[]',
    "brief_questions"   JSONB DEFAULT '[]',
    "estimated_days"    INT  NOT NULL DEFAULT 7,
    "requires_brief"    BOOLEAN NOT NULL DEFAULT true,
    "status"            TEXT NOT NULL DEFAULT 'ACTIVE',
    "sort_order"        INT  NOT NULL DEFAULT 0,
    "metadata"          JSONB DEFAULT '{}',
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keystore_service_listings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "keystore_service_listings_business_slug_unique" UNIQUE ("business_id", "slug")
);

CREATE TABLE IF NOT EXISTS "keystore_service_orders" (
    "id"              TEXT NOT NULL,
    "business_id"     TEXT NOT NULL,
    "listing_id"      TEXT NOT NULL,
    "contact_id"      TEXT,
    "user_id"         TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'REQUESTED',
    "pricing_tier"    TEXT NOT NULL,
    "selected_addons" JSONB DEFAULT '[]',
    "brief_answers"   JSONB DEFAULT '[]',
    "estimated_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "final_price"     DOUBLE PRECISION,
    "deposit_amount"  DOUBLE PRECISION,
    "deposit_paid"    BOOLEAN NOT NULL DEFAULT false,
    "invoice_id"      TEXT,
    "delivery_due_at" TIMESTAMP(3),
    "started_at"      TIMESTAMP(3),
    "completed_at"    TIMESTAMP(3),
    "delivered_at"    TIMESTAMP(3),
    "delivery_files"  JSONB DEFAULT '[]',
    "timeline"        JSONB DEFAULT '[]',
    "notes"           TEXT,
    "rating"          INT,
    "review"          TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keystore_service_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "keystore_service_order_messages" (
    "id"          TEXT NOT NULL,
    "order_id"    TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_id"   TEXT NOT NULL,
    "message"     TEXT NOT NULL,
    "attachments" JSONB DEFAULT '[]',
    "internal"    BOOLEAN NOT NULL DEFAULT false,
    "read_at"     TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keystore_service_order_messages_pkey" PRIMARY KEY ("id")
);

-- ── Keystore foreign keys (idempotent) ──────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'keystore_service_listings_business_id_fkey'
    ) THEN
        ALTER TABLE "keystore_service_listings"
            ADD CONSTRAINT "keystore_service_listings_business_id_fkey"
            FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'keystore_service_listings_category_id_fkey'
    ) THEN
        ALTER TABLE "keystore_service_listings"
            ADD CONSTRAINT "keystore_service_listings_category_id_fkey"
            FOREIGN KEY ("category_id") REFERENCES "keystore_service_categories"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'keystore_service_orders_business_id_fkey'
    ) THEN
        ALTER TABLE "keystore_service_orders"
            ADD CONSTRAINT "keystore_service_orders_business_id_fkey"
            FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'keystore_service_orders_listing_id_fkey'
    ) THEN
        ALTER TABLE "keystore_service_orders"
            ADD CONSTRAINT "keystore_service_orders_listing_id_fkey"
            FOREIGN KEY ("listing_id") REFERENCES "keystore_service_listings"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'keystore_service_orders_contact_id_fkey'
    ) THEN
        ALTER TABLE "keystore_service_orders"
            ADD CONSTRAINT "keystore_service_orders_contact_id_fkey"
            FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'keystore_service_order_messages_order_id_fkey'
    ) THEN
        ALTER TABLE "keystore_service_order_messages"
            ADD CONSTRAINT "keystore_service_order_messages_order_id_fkey"
            FOREIGN KEY ("order_id") REFERENCES "keystore_service_orders"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

-- ── Keystore indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "keystore_service_categories_business_id_idx"
    ON "keystore_service_categories"("business_id");
CREATE INDEX IF NOT EXISTS "keystore_service_categories_business_active_idx"
    ON "keystore_service_categories"("business_id", "is_active");

CREATE INDEX IF NOT EXISTS "keystore_service_listings_business_id_idx"
    ON "keystore_service_listings"("business_id");
CREATE INDEX IF NOT EXISTS "keystore_service_listings_business_status_idx"
    ON "keystore_service_listings"("business_id", "status");
CREATE INDEX IF NOT EXISTS "keystore_service_listings_category_id_idx"
    ON "keystore_service_listings"("category_id");

CREATE INDEX IF NOT EXISTS "keystore_service_orders_business_id_idx"
    ON "keystore_service_orders"("business_id");
CREATE INDEX IF NOT EXISTS "keystore_service_orders_business_status_idx"
    ON "keystore_service_orders"("business_id", "status");
CREATE INDEX IF NOT EXISTS "keystore_service_orders_user_id_idx"
    ON "keystore_service_orders"("user_id");
CREATE INDEX IF NOT EXISTS "keystore_service_orders_listing_id_idx"
    ON "keystore_service_orders"("listing_id");
CREATE INDEX IF NOT EXISTS "keystore_service_orders_created_at_idx"
    ON "keystore_service_orders"("created_at");

CREATE INDEX IF NOT EXISTS "keystore_service_order_messages_order_id_idx"
    ON "keystore_service_order_messages"("order_id");
CREATE INDEX IF NOT EXISTS "keystore_service_order_messages_order_created_idx"
    ON "keystore_service_order_messages"("order_id", "created_at");
