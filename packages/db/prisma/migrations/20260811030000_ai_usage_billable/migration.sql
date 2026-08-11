-- Separate the product's own AI work from the customer's allowance.
--
-- WHY, measured on production 2026-08-10: 243 credits consumed in a month
-- against a FREE allowance of 10, of which **184 were `semantic_embedding`** —
-- vectors written whenever a memory is stored. Nobody asked for them. KEYFLOW's
-- own indexing spent 76% of the owner's allowance and then locked them out of
-- every AI feature. The limiter worked correctly; it was counting the wrong pool.
--
-- The column is stored rather than derived from `feature` at read time because
-- overage is billed (AI_OVERAGE_RATE_TTD), and a past invoice must not change
-- when someone later edits SYSTEM_AI_FEATURES.
--
-- THE BACKFILL IS THE POINT, not housekeeping. Defaulting every existing row to
-- billable=true would leave production exactly as locked out as it is now,
-- because the 184 historical embeddings would keep counting. Reclassifying them
-- is what actually restores service, and it is correct: they were never work the
-- customer asked for.

ALTER TABLE "ai_usage_logs"
  ADD COLUMN "billable" BOOLEAN NOT NULL DEFAULT true;

-- Keep this list in step with SYSTEM_AI_FEATURES in
-- apps/server/src/modules/subscriptions/plans.ts. A spec asserts they agree.
UPDATE "ai_usage_logs"
   SET "billable" = false
 WHERE "feature" IN (
   'semantic_embedding',
   'genome_extraction',
   'pattern_detect',
   'feedback_loop',
   -- key-cortex background cognition. The same defect an order of magnitude
   -- larger and still latent: FEATURE_TASK_MAP's own comment puts reflection at
   -- "21 per business per tick, and it ticks every 30 minutes". Production has
   -- not felt it only because cortex has barely run there.
   'reflection-rank',
   'reflection-outcome',
   'dream-connections',
   'dream-hypotheses',
   'synthesis-report',
   'intuition-semantic',
   'intuition-anomaly-explain',
   'creativity-strategy',
   'creativity-lateral',
   'creativity-combination',
   'creativity-inversion',
   'creativity-analogy',
   'creativity-constraint-removal',
   'creativity-extreme-users',
   'creativity-trend-riding',
   'creativity-problem-first'
 );

-- The allowance query filters on businessId + createdAt + billable every time
-- checkCredits runs, which is before every AI call in the product.
CREATE INDEX "ai_usage_logs_business_id_billable_created_at_idx"
  ON "ai_usage_logs" ("business_id", "billable", "created_at");
