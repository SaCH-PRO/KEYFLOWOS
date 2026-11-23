-- FU-PATTERNS-ROUTES-SIGHT (orchestrator ruling A, after security review round 3 F-1): an additive index only.
--
-- GET /ai/businesses/:id/agent/patterns answers a reader who may not read every pattern (one without revenue and
-- expenses read) from keyset pages over the patterns updated in the last 30 days, ordered by (updated_at DESC,
-- id DESC), skipping the rows that state money or an expense (classified by their text, so only after they are read).
-- ai_memories had only (business_id, category) and the unique (business_id, category, key), so every page re-read and
-- re-sorted every pattern row of the business: the read grew faster than linearly in withheld rows. This index matches
-- the page query exactly (equality on business_id and category, range and order on updated_at, id), so each page is an
-- index range scan and the read grows linearly. It adds nothing else: no column, no constraint, no data change.
-- IF NOT EXISTS: schema.prisma declares the index (@@index), so a database built or kept in sync with db push already
-- holds it (MAINTENANCE.md "Adopting a database built without migrations"); deploy is then a no-op there, as
-- 20260808140000_bank_transaction_external_id_unique is.
-- Rollback: DROP INDEX "ai_memories_business_id_category_updated_at_id_idx".

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_memories_business_id_category_updated_at_id_idx" ON "ai_memories"("business_id", "category", "updated_at" DESC, "id" DESC);
