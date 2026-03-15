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
