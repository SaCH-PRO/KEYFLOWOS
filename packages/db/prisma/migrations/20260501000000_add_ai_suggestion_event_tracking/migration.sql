-- Track which AI partner suggestions actually lead to deals.
-- Captures lifecycle events from suggestion shown -> clicked -> message/quote -> connection.

CREATE TABLE "ai_suggestion_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "target_business_id" TEXT,
    "event_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "score" INTEGER,
    "match_type" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_suggestion_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_suggestion_events_business_id_created_at_idx"
    ON "ai_suggestion_events"("business_id", "created_at");

CREATE INDEX "ai_suggestion_events_business_id_event_type_idx"
    ON "ai_suggestion_events"("business_id", "event_type");

CREATE INDEX "ai_suggestion_events_business_id_source_idx"
    ON "ai_suggestion_events"("business_id", "source");

CREATE INDEX "ai_suggestion_events_target_business_id_idx"
    ON "ai_suggestion_events"("target_business_id");

ALTER TABLE "ai_suggestion_events"
    ADD CONSTRAINT "ai_suggestion_events_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_suggestion_events"
    ADD CONSTRAINT "ai_suggestion_events_target_business_id_fkey"
    FOREIGN KEY ("target_business_id") REFERENCES "businesses"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
