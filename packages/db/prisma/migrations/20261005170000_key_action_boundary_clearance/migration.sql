-- KF-EXEC-ACTION-001
-- Capability -> Control -> Clearance boundary, first adoption
-- (helpdesk_create_ticket). KeyActionProposal is the action record: it gains
-- the capability identity, the frozen envelope and its fingerprint, the
-- control requirement and evidence, the principal chain and the outcome
-- evidence. Every column is nullable and additive; no existing row changes.
--
-- The execution claim needs no schema change: it is a row in idempotency_keys,
-- whose (business_id, idempotency_key) unique index already exists.
ALTER TABLE "key_action_proposals"
  ADD COLUMN "capability_name" TEXT,
  ADD COLUMN "capability_version" INTEGER,
  ADD COLUMN "execution_surface" TEXT,
  ADD COLUMN "action_envelope" JSONB,
  ADD COLUMN "action_fingerprint" TEXT,
  ADD COLUMN "control_requirement" JSONB,
  ADD COLUMN "control_evidence" JSONB,
  ADD COLUMN "evidence_expires_at" TIMESTAMP(3),
  ADD COLUMN "requested_by" TEXT,
  ADD COLUMN "proposed_by" TEXT,
  ADD COLUMN "executed_for" TEXT,
  ADD COLUMN "outcome_evidence" JSONB;

CREATE INDEX "key_action_proposals_capability_fingerprint_idx"
  ON "key_action_proposals"("business_id", "capability_name", "action_fingerprint");
