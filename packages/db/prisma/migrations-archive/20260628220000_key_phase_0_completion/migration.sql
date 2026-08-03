-- Phase 0 completion: add maxTierWithoutApproval to BusinessAutonomyProfile
ALTER TABLE "business_autonomy_profiles" ADD COLUMN "max_tier_without_approval" INTEGER NOT NULL DEFAULT 3;
