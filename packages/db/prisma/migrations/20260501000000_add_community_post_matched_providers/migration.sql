-- AlterTable
ALTER TABLE "community_posts" ADD COLUMN IF NOT EXISTS "matched_providers" JSONB;
