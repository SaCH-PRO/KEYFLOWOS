-- AlterTable
ALTER TABLE "community_notifications" ADD COLUMN IF NOT EXISTS "data" JSONB;
