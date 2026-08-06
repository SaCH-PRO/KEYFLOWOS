-- Merge the two omnichannel inboxes into key_inbox_*.
--
-- The product had two inbound message stores with two screens and two feeds:
--   key_inbox_threads      <- Gmail + Google Forms ingestion, and the four
--                             inbox_* KEY tools
--   conversation_threads   <- MessageIntakeOrchestrator (webhook controller and
--                             event listener) and OmnichannelProcessorService
--
-- Both were live. Neither showed the other's messages, so a business's customer
-- conversations were split in half by channel with no screen showing all of them.
--
-- key_inbox_* wins: it carries sender identity, html bodies, attachments and
-- send tracking, and it is the store KEY already acts through. These columns are
-- what conversation_* had and it did not.

ALTER TABLE "key_inbox_threads" ADD COLUMN IF NOT EXISTS "channel_id" TEXT;
ALTER TABLE "key_inbox_threads" ADD COLUMN IF NOT EXISTS "assigned_role" TEXT;
ALTER TABLE "key_inbox_threads" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP(3);

ALTER TABLE "key_inbox_messages" ADD COLUMN IF NOT EXISTS "raw_payload" JSONB;
ALTER TABLE "key_inbox_messages" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "key_inbox_messages" ADD COLUMN IF NOT EXISTS "intent" TEXT;
ALTER TABLE "key_inbox_messages" ADD COLUMN IF NOT EXISTS "sentiment" TEXT;
ALTER TABLE "key_inbox_messages" ADD COLUMN IF NOT EXISTS "ai_draft" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "key_inbox_messages" ADD COLUMN IF NOT EXISTS "ai_approved" BOOLEAN NOT NULL DEFAULT false;

-- key_inbox_threads carried a bare contact_id with no foreign key, while
-- conversation_threads had a real relation. Every inbox list shows who a
-- message is from, so the merged store needs the join.
DO $$ BEGIN
  ALTER TABLE "key_inbox_threads"
    ADD CONSTRAINT "key_inbox_threads_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "key_inbox_threads_contact_id_idx" ON "key_inbox_threads"("contact_id");
