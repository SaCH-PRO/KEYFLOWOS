-- S3 Presence editor: SitePageDraft + SitePagePublished
-- Draft → Preview → Published state machine for the public site composition.

CREATE TABLE IF NOT EXISTS "site_page_drafts" (
  "id"                   TEXT PRIMARY KEY,
  "business_id"          TEXT NOT NULL,
  "version"              INTEGER NOT NULL DEFAULT 1,
  "payload"              JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status"               TEXT NOT NULL DEFAULT 'DRAFT',
  "preview_token"        TEXT,
  "preview_expires_at"   TIMESTAMP(3),
  "last_saved_by_id"     TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "site_page_drafts_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "site_page_drafts_business_id_key"
  ON "site_page_drafts" ("business_id");

CREATE UNIQUE INDEX IF NOT EXISTS "site_page_drafts_preview_token_key"
  ON "site_page_drafts" ("preview_token");

CREATE INDEX IF NOT EXISTS "site_page_drafts_business_id_idx"
  ON "site_page_drafts" ("business_id");

CREATE TABLE IF NOT EXISTS "site_pages_published" (
  "id"                   TEXT PRIMARY KEY,
  "business_id"          TEXT NOT NULL,
  "version"              INTEGER NOT NULL DEFAULT 1,
  "payload"              JSONB NOT NULL DEFAULT '{}'::jsonb,
  "published_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_by_id"      TEXT,
  "unpublished_at"       TIMESTAMP(3),
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "site_pages_published_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "site_pages_published_business_id_key"
  ON "site_pages_published" ("business_id");

CREATE INDEX IF NOT EXISTS "site_pages_published_business_id_idx"
  ON "site_pages_published" ("business_id");
