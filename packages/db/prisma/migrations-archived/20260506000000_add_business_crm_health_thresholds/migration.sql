-- Per-business overrides for relationship-health threshold configuration.
-- Shape: { hot: number, warm: number, cold: number, atRiskClientDays: number }
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "crm_health_thresholds" JSONB;
