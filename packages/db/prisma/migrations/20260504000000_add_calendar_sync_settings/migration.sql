-- AlterTable
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "calendar_sync_direction" TEXT NOT NULL DEFAULT 'two_way';
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "calendar_sync_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE IF NOT EXISTS "calendar_sync_conflicts" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "booking_id" TEXT,
  "external_event_id" TEXT,
  "conflict_type" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "external_summary" TEXT,
  "booking_start" TIMESTAMP(3),
  "booking_end" TIMESTAMP(3),
  "external_start" TIMESTAMP(3),
  "external_end" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolution" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "calendar_sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "calendar_sync_conflicts_business_id_status_idx" ON "calendar_sync_conflicts"("business_id", "status");
CREATE INDEX IF NOT EXISTS "calendar_sync_conflicts_business_id_created_at_idx" ON "calendar_sync_conflicts"("business_id", "created_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "calendar_sync_conflicts" ADD CONSTRAINT "calendar_sync_conflicts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
