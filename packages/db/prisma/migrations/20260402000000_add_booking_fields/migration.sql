-- AlterTable: Add buffer_mins and lead_time_mins to services
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "buffer_mins" INTEGER;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "lead_time_mins" INTEGER;

-- AlterTable: Add notes to bookings
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- AlterTable: Add booking_reminder_mins to businesses
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "booking_reminder_mins" INTEGER NOT NULL DEFAULT 60;
