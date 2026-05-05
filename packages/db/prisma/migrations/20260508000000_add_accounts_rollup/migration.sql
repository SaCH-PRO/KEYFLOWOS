-- M5: Account / Company rollup.
-- Promotes free-text contact.companyName to a first-class Account record so
-- contacts and deals can be aggregated per company.

CREATE TABLE IF NOT EXISTS "accounts" (
  "id"                  TEXT NOT NULL,
  "business_id"         TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "domain"              TEXT,
  "industry"            TEXT,
  "size"                TEXT,
  "website"             TEXT,
  "primary_contact_id"  TEXT,
  "owner_user_id"       TEXT,
  "tags"                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"               TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  "deleted_at"          TIMESTAMP(3),
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "accounts_business_id_domain_key"
  ON "accounts"("business_id", "domain");
CREATE INDEX IF NOT EXISTS "accounts_business_id_name_idx"
  ON "accounts"("business_id", "name");
CREATE INDEX IF NOT EXISTS "accounts_business_id_industry_idx"
  ON "accounts"("business_id", "industry");
CREATE INDEX IF NOT EXISTS "accounts_business_id_owner_user_id_idx"
  ON "accounts"("business_id", "owner_user_id");
CREATE INDEX IF NOT EXISTS "accounts_business_id_deleted_at_idx"
  ON "accounts"("business_id", "deleted_at");

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Contact.accountId (nullable, indexed). companyName is preserved as a
-- legacy fallback display; the merge job converts distinct values into Accounts.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "account_id" TEXT;
CREATE INDEX IF NOT EXISTS "contacts_business_id_account_id_idx"
  ON "contacts"("business_id", "account_id");
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Deal.accountId (nullable, indexed). When a deal is created on a contact we
-- auto-fill from the contact's account; UI can override.
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "account_id" TEXT;
CREATE INDEX IF NOT EXISTS "deals_business_id_account_id_idx"
  ON "deals"("business_id", "account_id");
ALTER TABLE "deals"
  ADD CONSTRAINT "deals_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
