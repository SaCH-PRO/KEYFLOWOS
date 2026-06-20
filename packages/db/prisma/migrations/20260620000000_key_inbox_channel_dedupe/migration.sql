-- B.10: add DB-level deduplication for non-null external thread/message IDs.
-- PostgreSQL unique indexes allow multiple NULLs, so this safely covers the
-- nullable external IDs while preventing duplicate concrete values.

CREATE UNIQUE INDEX IF NOT EXISTS "key_inbox_threads_business_channel_external_thread_uidx"
ON "key_inbox_threads" ("business_id", "channel", "external_thread_id")
WHERE "external_thread_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "key_inbox_messages_business_channel_external_message_uidx"
ON "key_inbox_messages" ("business_id", "channel", "external_message_id")
WHERE "external_message_id" IS NOT NULL;
