-- M7: Per-contact audit log + GDPR export & forget

-- Business privacy settings
ALTER TABLE "businesses"
  ADD COLUMN "forget_grace_days" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "default_forget_reason" TEXT;

-- ContactAuditEntry
CREATE TABLE "contact_audit_entries" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "contact_id" TEXT,
  "contact_hash" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL DEFAULT 'contact',
  "entity_id" TEXT,
  "actor" JSONB,
  "before" JSONB,
  "after" JSONB,
  "changed_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reason" TEXT,
  "ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_audit_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "contact_audit_entries_business_id_contact_id_created_at_idx"
  ON "contact_audit_entries" ("business_id", "contact_id", "created_at");
CREATE INDEX "contact_audit_entries_business_id_contact_hash_created_at_idx"
  ON "contact_audit_entries" ("business_id", "contact_hash", "created_at");
CREATE INDEX "contact_audit_entries_business_id_action_created_at_idx"
  ON "contact_audit_entries" ("business_id", "action", "created_at");
ALTER TABLE "contact_audit_entries"
  ADD CONSTRAINT "contact_audit_entries_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_audit_entries"
  ADD CONSTRAINT "contact_audit_entries_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ContactExportJob
CREATE TABLE "contact_export_jobs" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "requested_by_id" TEXT,
  "token" TEXT NOT NULL,
  "json_key" TEXT NOT NULL,
  "zip_key" TEXT NOT NULL,
  "byte_size" INTEGER,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "max_downloads" INTEGER NOT NULL DEFAULT 1,
  "download_count" INTEGER NOT NULL DEFAULT 0,
  "last_downloaded_at" TIMESTAMP(3),
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_export_jobs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contact_export_jobs_token_key" ON "contact_export_jobs" ("token");
CREATE INDEX "contact_export_jobs_business_id_contact_id_idx"
  ON "contact_export_jobs" ("business_id", "contact_id");
CREATE INDEX "contact_export_jobs_expires_at_idx" ON "contact_export_jobs" ("expires_at");
ALTER TABLE "contact_export_jobs"
  ADD CONSTRAINT "contact_export_jobs_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_export_jobs"
  ADD CONSTRAINT "contact_export_jobs_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ContactForgetRequest
CREATE TABLE "contact_forget_requests" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "contact_id" TEXT,
  "contact_hash" TEXT,
  "requested_by_id" TEXT,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purge_at" TIMESTAMP(3) NOT NULL,
  "purged_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  CONSTRAINT "contact_forget_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contact_forget_requests_contact_id_key"
  ON "contact_forget_requests" ("contact_id");
CREATE INDEX "contact_forget_requests_business_id_status_idx"
  ON "contact_forget_requests" ("business_id", "status");
CREATE INDEX "contact_forget_requests_status_purge_at_idx"
  ON "contact_forget_requests" ("status", "purge_at");
CREATE INDEX "contact_forget_requests_contact_hash_idx"
  ON "contact_forget_requests" ("contact_hash");
ALTER TABLE "contact_forget_requests"
  ADD CONSTRAINT "contact_forget_requests_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_forget_requests"
  ADD CONSTRAINT "contact_forget_requests_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
