-- FU-PROPOSAL-MONEY-TAG (V1-88, D-238, D-227):
-- Additive, nullable, reversible structural money tag stamped on KeyActionProposal at creation.
-- Null represents legacy/untagged rows (readers fail closed via heuristic backstop).
-- Reversal: ALTER TABLE "key_action_proposals" DROP COLUMN IF EXISTS "carries_money";
ALTER TABLE "key_action_proposals" ADD COLUMN IF NOT EXISTS "carries_money" BOOLEAN;
