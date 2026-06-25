-- Ensure email_campaigns exists before adding FK (historical migration fix)
CREATE TABLE IF NOT EXISTS "email_campaigns" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "segment_filter" JSONB,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "email_campaigns_business_id_status_idx" ON "email_campaigns"("business_id", "status");

-- CreateTable
CREATE TABLE "campaign_briefings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "delivery_rate" DOUBLE PRECISION,
    "open_rate" DOUBLE PRECISION,
    "click_rate" DOUBLE PRECISION,
    "bounce_rate" DOUBLE PRECISION,
    "historical_avg_open_rate" DOUBLE PRECISION,
    "historical_avg_click_rate" DOUBLE PRECISION,
    "performance_vs_avg" TEXT,
    "insights" JSONB,
    "recommendations" JSONB,
    "audience_health" JSONB,
    "send_time_analysis" JSONB,
    "ai_briefing" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_briefings_campaign_id_key" ON "campaign_briefings"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_briefings_business_id_idx" ON "campaign_briefings"("business_id");

-- AddForeignKey
ALTER TABLE "campaign_briefings" ADD CONSTRAINT "campaign_briefings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
