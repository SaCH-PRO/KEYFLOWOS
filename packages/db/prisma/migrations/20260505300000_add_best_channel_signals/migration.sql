-- M2: Best channel & best time to contact signals
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "best_channel" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "best_channel_confidence" DOUBLE PRECISION;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "best_time_window_json" JSONB;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "best_signal_updated_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "contacts_business_id_best_channel_idx" ON "contacts"("business_id", "best_channel");

CREATE TABLE IF NOT EXISTS "contact_channel_stats" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  "reply_count" INTEGER NOT NULL DEFAULT 0,
  "open_count" INTEGER NOT NULL DEFAULT 0,
  "last_reply_at" TIMESTAMP(3),
  "last_sent_at" TIMESTAMP(3),
  "hour_buckets_json" JSONB,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_channel_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_channel_stats_contact_id_channel_key" ON "contact_channel_stats"("contact_id", "channel");
CREATE INDEX IF NOT EXISTS "contact_channel_stats_business_id_contact_id_idx" ON "contact_channel_stats"("business_id", "contact_id");

ALTER TABLE "contact_channel_stats" ADD CONSTRAINT "contact_channel_stats_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_channel_stats" ADD CONSTRAINT "contact_channel_stats_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
