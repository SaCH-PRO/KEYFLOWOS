-- Scope chat sessions to the user who had the conversation.
--
-- FlowSession carried only businessId, and listSessions returned every session
-- in the business — so any team member could open the owner's conversations
-- with KEY. Tenancy by businessId is correct for business DATA; a conversation
-- is not business data in the same sense.
--
-- WHY THIS EXISTS SEPARATELY FROM 0_baseline
--
-- 0_baseline already declares this column, so on a fresh database this file is
-- a no-op. It exists for the databases that will never RUN 0_baseline.
--
-- Adopting the baseline means recording it with `migrate resolve --applied`,
-- which writes one bookkeeping row and executes no DDL — by design, because the
-- tables are already there. But this column is NOT already there: it was added
-- by hand to local dev only, and its original migration
-- (20260803180000_flow_session_user_scope) was archived along with the other
-- 18, where `migrate deploy` can never see it.
--
-- So without this file the sequence is: resolve the baseline, deploy reports
-- "No pending migrations to apply", the release ships, and the regenerated
-- client emits `user_id` in the WHERE of every sessionScope() query against a
-- table that has no such column — 42703, surfaced by Prisma as P2022, breaking
-- session listing, loading and persistence for KEY's chat.
--
-- Sorting after `0_baseline` ('0' < '2') is what makes it work in both
-- directions: a fresh database creates the column in the baseline and no-ops
-- here, and an existing database skips the baseline and gains the column here.
--
-- Nullable on purpose. Sessions created before this change have no known owner,
-- and the application excludes NULL-owner rows from every listing rather than
-- showing them to everyone. They are preserved, not deleted, so they can be
-- claimed by a backfill if their owner can be established.
--
-- Purely additive and idempotent: no column is dropped, no row is rewritten,
-- and both statements are guarded so re-running is harmless.

ALTER TABLE "flow_sessions" ADD COLUMN IF NOT EXISTS "user_id" TEXT;

CREATE INDEX IF NOT EXISTS "flow_sessions_business_id_user_id_idx"
  ON "flow_sessions" ("business_id", "user_id");
