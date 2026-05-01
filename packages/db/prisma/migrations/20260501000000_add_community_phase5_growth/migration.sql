-- Migration: Community Phase 5 — Network Activity & Growth Layer (Task #132)
-- Adds: Opportunity Board, Partner Programs, Resource Marketplace (Product extensions),
--       Network Activity Feed, Network Analytics (Profile Views), Resource Downloads.
-- All statements are idempotent (IF NOT EXISTS guards).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend products with resource marketplace fields
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "resource_type"  TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "download_url"   TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "preview_url"    TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "license_terms"  TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_free"        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "file_size"      INTEGER;

CREATE INDEX IF NOT EXISTS "products_resource_type_idx" ON "products"("resource_type") WHERE "resource_type" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. community_opportunities (Opportunity Board)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "community_opportunities" (
    "id"                       TEXT PRIMARY KEY,
    "poster_business_id"       TEXT NOT NULL,
    "type"                     TEXT NOT NULL DEFAULT 'PROJECT',
    "title"                    TEXT NOT NULL,
    "description"              TEXT NOT NULL,
    "category"                 TEXT,
    "skills_required"          TEXT[] NOT NULL DEFAULT '{}',
    "budget_min"               DOUBLE PRECISION,
    "budget_max"               DOUBLE PRECISION,
    "currency"                 TEXT NOT NULL DEFAULT 'TTD',
    "timeline"                 TEXT,
    "location"                 TEXT,
    "remote_ok"                BOOLEAN NOT NULL DEFAULT TRUE,
    "attachments"              TEXT[] NOT NULL DEFAULT '{}',
    "status"                   TEXT NOT NULL DEFAULT 'OPEN',
    "awarded_to_business_id"   TEXT,
    "expires_at"               TIMESTAMP(3),
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"               TIMESTAMP(3),
    CONSTRAINT "community_opportunities_poster_fk" FOREIGN KEY ("poster_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "community_opportunities_poster_created_idx" ON "community_opportunities"("poster_business_id","created_at");
CREATE INDEX IF NOT EXISTS "community_opportunities_status_created_idx" ON "community_opportunities"("status","created_at");
CREATE INDEX IF NOT EXISTS "community_opportunities_type_status_idx"    ON "community_opportunities"("type","status");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. community_opportunity_applications
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "community_opportunity_applications" (
    "id"                      TEXT PRIMARY KEY,
    "opportunity_id"          TEXT NOT NULL,
    "applicant_business_id"   TEXT NOT NULL,
    "message"                 TEXT NOT NULL,
    "proposed_budget"         DOUBLE PRECISION,
    "proposed_timeline"       TEXT,
    "attachments"             TEXT[] NOT NULL DEFAULT '{}',
    "status"                  TEXT NOT NULL DEFAULT 'SUBMITTED',
    "response_note"           TEXT,
    "responded_at"            TIMESTAMP(3),
    "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_opportunity_apps_opportunity_fk" FOREIGN KEY ("opportunity_id") REFERENCES "community_opportunities"("id") ON DELETE CASCADE,
    CONSTRAINT "community_opportunity_apps_applicant_fk"   FOREIGN KEY ("applicant_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "community_opportunity_apps_unique_idx" ON "community_opportunity_applications"("opportunity_id","applicant_business_id");
CREATE INDEX IF NOT EXISTS "community_opportunity_apps_applicant_created_idx" ON "community_opportunity_applications"("applicant_business_id","created_at");
CREATE INDEX IF NOT EXISTS "community_opportunity_apps_opportunity_status_idx"  ON "community_opportunity_applications"("opportunity_id","status");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. community_partner_programs (Partner Programs)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "community_partner_programs" (
    "id"                       TEXT PRIMARY KEY,
    "initiator_business_id"    TEXT NOT NULL,
    "partner_business_id"      TEXT NOT NULL,
    "program_type"             TEXT NOT NULL DEFAULT 'REFERRAL',
    "name"                     TEXT NOT NULL,
    "description"              TEXT NOT NULL,
    "terms"                    JSONB,
    "commission_rate"          DOUBLE PRECISION,
    "start_date"               TIMESTAMP(3),
    "end_date"                 TIMESTAMP(3),
    "status"                   TEXT NOT NULL DEFAULT 'PROPOSED',
    "visibility"               TEXT NOT NULL DEFAULT 'PUBLIC',
    "response_note"            TEXT,
    "accepted_at"              TIMESTAMP(3),
    "ended_at"                 TIMESTAMP(3),
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_partner_programs_initiator_fk" FOREIGN KEY ("initiator_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
    CONSTRAINT "community_partner_programs_partner_fk"   FOREIGN KEY ("partner_business_id")   REFERENCES "businesses"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "community_partner_programs_initiator_status_idx" ON "community_partner_programs"("initiator_business_id","status");
CREATE INDEX IF NOT EXISTS "community_partner_programs_partner_status_idx"   ON "community_partner_programs"("partner_business_id","status");
CREATE INDEX IF NOT EXISTS "community_partner_programs_status_created_idx"   ON "community_partner_programs"("status","created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. community_profile_views (Network Analytics)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "community_profile_views" (
    "id"                  TEXT PRIMARY KEY,
    "viewer_business_id"  TEXT,
    "viewed_business_id"  TEXT NOT NULL,
    "source"              TEXT,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_profile_views_viewer_fk" FOREIGN KEY ("viewer_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL,
    CONSTRAINT "community_profile_views_viewed_fk" FOREIGN KEY ("viewed_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "community_profile_views_viewed_created_idx" ON "community_profile_views"("viewed_business_id","created_at");
CREATE INDEX IF NOT EXISTS "community_profile_views_viewer_created_idx" ON "community_profile_views"("viewer_business_id","created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. community_network_activities (Activity Feed)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "community_network_activities" (
    "id"                  TEXT PRIMARY KEY,
    "actor_business_id"   TEXT NOT NULL,
    "type"                TEXT NOT NULL,
    "ref_type"            TEXT,
    "ref_id"              TEXT,
    "title"               TEXT NOT NULL,
    "body"                TEXT,
    "metadata"            JSONB,
    "visibility"          TEXT NOT NULL DEFAULT 'PUBLIC',
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_network_activities_actor_fk" FOREIGN KEY ("actor_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "community_network_activities_actor_created_idx" ON "community_network_activities"("actor_business_id","created_at");
CREATE INDEX IF NOT EXISTS "community_network_activities_type_created_idx"  ON "community_network_activities"("type","created_at");
CREATE INDEX IF NOT EXISTS "community_network_activities_created_idx"       ON "community_network_activities"("created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. community_resource_downloads (Resource Marketplace tracking)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "community_resource_downloads" (
    "id"                       TEXT PRIMARY KEY,
    "product_id"               TEXT NOT NULL,
    "downloader_business_id"   TEXT NOT NULL,
    "price_paid"               DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency"                 TEXT NOT NULL DEFAULT 'TTD',
    "source"                   TEXT,
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_resource_downloads_product_fk"    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE,
    CONSTRAINT "community_resource_downloads_downloader_fk" FOREIGN KEY ("downloader_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "community_resource_downloads_product_created_idx"   ON "community_resource_downloads"("product_id","created_at");
CREATE INDEX IF NOT EXISTS "community_resource_downloads_downloader_created_idx" ON "community_resource_downloads"("downloader_business_id","created_at");
