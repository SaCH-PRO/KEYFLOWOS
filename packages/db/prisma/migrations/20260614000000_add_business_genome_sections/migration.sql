-- Add Business Genesis Patch 1 sections to BusinessBlueprint.
-- These JSONB columns hold the new founder, legal, tax, ownership, market,
-- offer, sales, marketing, operations, projection, risk, compliance, and
-- execution-roadmap profiles. readiness_score tracks Genesis maturity
-- independently of the legacy core completeness score.

ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "founder_profile" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "legal_profile" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "registration_profile" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "tax_profile" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "ownership_profile" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "market_profile" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "offer_architecture" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "sales_system" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "marketing_system" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "operations_system" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "projection_profile" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "risk_profile" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "compliance_profile" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "execution_roadmap" JSONB;
ALTER TABLE "business_blueprints" ADD COLUMN IF NOT EXISTS "readiness_score" INTEGER NOT NULL DEFAULT 0;
