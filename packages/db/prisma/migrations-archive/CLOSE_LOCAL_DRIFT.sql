-- Close the last of the local-only schema drift.        2026-08-03
--
-- RUN THIS ONLY AGAINST A LOCAL DEV DATABASE. It is destructive.
-- Everything it removes is already backed up in ORPHAN_TABLES.sql, which
-- carries both the data and the DDL needed to put it back.
--
--   docker exec -i <postgres-container> psql -U keyflow -d keyflow \
--     -v ON_ERROR_STOP=1 < CLOSE_LOCAL_DRIFT.sql
--
-- WHY THIS EXISTS
--
-- After adopting 0_baseline, `prisma migrate diff` still reported differences
-- between the local database and schema.prisma. All of them trace to the same
-- abandoned branch (c7ab974a, "Phase 5: payroll MVP") that left the orphan
-- tables behind: one org_assignments row named 'Test Payroll Clerk', created
-- in the same millisecond cluster as the payroll rows that referenced it.
--
-- The columns implemented "contact-only assignments" — assigning work to
-- someone who is not a platform user, reached over a preferred channel,
-- approving by reply. Nothing in apps/ or packages/ references isContactOnly,
-- autoApprovalViaReply, activeFlowSessionId, approverAssignmentId,
-- approverMethod or clauseAnalysis. The IDEA is worth revisiting when
-- KEY-to-human delegation gets built; these columns are not.
--
-- The row is what actually blocks things. schema.prisma declares
-- org_assignments.membership_id and .user_id NOT NULL, and a contact-only row
-- has BOTH null — that is the whole point of it. So while it exists, the real
-- schema can never be applied to this database. The two facts are one problem.
--
-- Nothing else references the row: the only remaining foreign key into
-- org_assignments is its own reports_to self-reference, and the payroll tables
-- that pointed at it are already gone.

BEGIN;

-- The row first — the NOT NULL below cannot be set while it exists.
DELETE FROM org_assignments WHERE is_contact_only = true;

ALTER TABLE "org_assignments"
  DROP COLUMN IF EXISTS "active_flow_session_id",
  DROP COLUMN IF EXISTS "auto_approval_via_reply",
  DROP COLUMN IF EXISTS "contact_email",
  DROP COLUMN IF EXISTS "contact_name",
  DROP COLUMN IF EXISTS "contact_phone",
  DROP COLUMN IF EXISTS "is_contact_only",
  DROP COLUMN IF EXISTS "preferred_channel";

ALTER TABLE "org_assignments"
  ALTER COLUMN "membership_id" SET NOT NULL,
  ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "ai_approval_items"
  DROP COLUMN IF EXISTS "approver_assignment_id",
  DROP COLUMN IF EXISTS "approver_method",
  DROP COLUMN IF EXISTS "notified_at";

ALTER TABLE "contracts"
  DROP COLUMN IF EXISTS "clause_analysis";

COMMIT;

-- Afterwards this should print "No difference detected.":
--
--   pnpm --filter @keyflow/db exec prisma migrate diff \
--     --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma
