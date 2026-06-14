-- Add missing BusinessBlueprint columns that exist in schema.prisma but were
-- omitted from the original 20260611000000_business_blueprint migration.

ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "workflow_model" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "ai_preferences" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "confidence_scores" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "last_analyzed_at" TIMESTAMP(3);
