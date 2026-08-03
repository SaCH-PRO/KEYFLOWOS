-- Scope chat sessions to the user who had the conversation.
--
-- FlowSession carried only businessId, and listSessions returned every session
-- in the business — so any team member could open the owner's conversations
-- with KEY. Tenancy by businessId is correct for business DATA; a conversation
-- is not business data in the same sense.
--
-- Nullable on purpose. Sessions created before this change have no known owner,
-- and the application excludes NULL-owner rows from every listing rather than
-- showing them to everyone. They are preserved, not deleted, so they can be
-- claimed by a backfill if their owner can be established.
--
-- Purely additive: no column is dropped, no row is rewritten, and the index is
-- created concurrently-safe via IF NOT EXISTS.

ALTER TABLE "flow_sessions" ADD COLUMN IF NOT EXISTS "user_id" TEXT;

CREATE INDEX IF NOT EXISTS "flow_sessions_business_id_user_id_idx"
  ON "flow_sessions" ("business_id", "user_id");
