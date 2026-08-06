-- Retire the conversation_* store, and fix the foreign key the merge broke.
--
-- message_intakes.thread_id is written by MessageIntakeOrchestrator on approval.
-- Since the omnichannel merge that id comes from key_inbox_threads, while the
-- foreign key still referenced conversation_threads — so approving an intake
-- raised a constraint violation at runtime. Nothing typechecked it: the column
-- is a nullable string and Prisma only knew the relation, not the values.

ALTER TABLE "message_intakes" DROP CONSTRAINT IF EXISTS "message_intakes_thread_id_fkey";

-- Any thread_id still pointing at the retired store cannot be honoured.
UPDATE "message_intakes" mi
   SET "thread_id" = NULL
 WHERE mi."thread_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "key_inbox_threads" t WHERE t."id" = mi."thread_id");

DO $$ BEGIN
  ALTER TABLE "message_intakes"
    ADD CONSTRAINT "message_intakes_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "key_inbox_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Nothing reads or writes these now; every path moved to key_inbox_*.
DROP TABLE IF EXISTS "conversation_messages";
DROP TABLE IF EXISTS "conversation_threads";
