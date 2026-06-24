-- Baseline migration for tables that exist in the Prisma schema but were not
-- created by any earlier migration. This lets the migration chain run cleanly
-- on fresh databases while remaining safe to skip on databases where the
-- tables already exist (via `IF NOT EXISTS`).

CREATE TABLE IF NOT EXISTS "key_inbox_threads" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "external_thread_id" TEXT,
    "contact_id" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "last_message_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "ai_summary" TEXT,
    "ai_intent" TEXT,
    "ai_sentiment" TEXT,
    "ai_urgency" TEXT,
    "ai_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "key_inbox_threads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "key_inbox_threads_business_id_last_message_at_idx" ON "key_inbox_threads"("business_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "key_inbox_threads_business_id_channel_idx" ON "key_inbox_threads"("business_id", "channel");

CREATE TABLE IF NOT EXISTS "key_inbox_messages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "sender_name" TEXT,
    "sender_handle" TEXT,
    "sender_email" TEXT,
    "sender_phone" TEXT,
    "content_text" TEXT,
    "content_html" TEXT,
    "attachments" JSONB DEFAULT '[]',
    "external_message_id" TEXT,
    "received_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "send_status" TEXT,
    "provider_message_id" TEXT,
    "send_error" TEXT,
    "sent_by_user_id" TEXT,
    "sent_via" TEXT,
    "ai_analysis" JSONB DEFAULT '{}',
    "extracted_entities" JSONB DEFAULT '{}',
    "suggested_actions" JSONB DEFAULT '[]',
    "ai_confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "key_inbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "key_inbox_messages_business_id_received_at_idx" ON "key_inbox_messages"("business_id", "received_at");
CREATE INDEX IF NOT EXISTS "key_inbox_messages_business_id_channel_idx" ON "key_inbox_messages"("business_id", "channel");
CREATE INDEX IF NOT EXISTS "key_inbox_messages_thread_id_idx" ON "key_inbox_messages"("thread_id");

CREATE TABLE IF NOT EXISTS "key_inbox_insights" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "channel" TEXT,
    "summary" TEXT NOT NULL,
    "key_findings" JSONB DEFAULT '[]',
    "recommendations" JSONB DEFAULT '[]',
    "task_suggestions" JSONB DEFAULT '[]',
    "metrics" JSONB DEFAULT '{}',
    "trends" JSONB DEFAULT '{}',
    "insights" JSONB DEFAULT '[]',
    "channel_breakdown" JSONB DEFAULT '{}',
    "genome_signals" JSONB DEFAULT '[]',
    "report_version" INTEGER NOT NULL DEFAULT 1,
    "generated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "key_inbox_insights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "key_inbox_insights_business_id_period_start_period__idx" ON "key_inbox_insights"("business_id", "period_start", "period_end");

CREATE TABLE IF NOT EXISTS "marketplace_orders" (
    "id" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    CONSTRAINT "marketplace_orders_pkey" PRIMARY KEY ("id")
);
