-- Runtime-configurable feature flags. Each row identifies a workspace nav
-- feature (or any other gated capability) and stores whether it is in a
-- "coming soon" state plus a list of user emails that bypass the lock.
CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id"            TEXT          NOT NULL,
  "key"           TEXT          NOT NULL,
  "label"         TEXT          NOT NULL,
  "category"      TEXT,
  "coming_soon"   BOOLEAN       NOT NULL DEFAULT false,
  "bypass_emails" TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_key" ON "feature_flags"("key");

-- Seed the SEO nav lock that previously lived in code with the same
-- super-admin bypass it had hardcoded so behaviour is preserved post-deploy.
INSERT INTO "feature_flags" ("id", "key", "label", "category", "coming_soon", "bypass_emails", "updated_at")
VALUES (
  'ff_nav_workspaces_seo',
  'nav.workspaces.seo',
  'SEO',
  'Workspaces',
  true,
  ARRAY['keyflowos.tt@gmail.com']::TEXT[],
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
