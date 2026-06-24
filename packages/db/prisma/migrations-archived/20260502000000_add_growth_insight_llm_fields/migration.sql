-- AlterTable
ALTER TABLE "growth_insights" ADD COLUMN IF NOT EXISTS "rationale" TEXT;
ALTER TABLE "growth_insights" ADD COLUMN IF NOT EXISTS "suggested_action" TEXT;
ALTER TABLE "growth_insights" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'heuristic';
