-- CreateTable
CREATE TABLE "temporal_flow_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "module" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "importance" TEXT NOT NULL DEFAULT 'NORMAL',
    "visibility" TEXT NOT NULL DEFAULT 'USER',
    "payload" JSONB DEFAULT '{}',
    "signals" JSONB DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reminder_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "genome_impact_potential" BOOLEAN NOT NULL DEFAULT false,
    "key_analysis_status" TEXT,
    "external_id" TEXT,
    "external_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "temporal_flow_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_occurred_at_idx" ON "temporal_flow_events"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_starts_at_idx" ON "temporal_flow_events"("business_id", "starts_at");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_source_idx" ON "temporal_flow_events"("business_id", "source");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_type_idx" ON "temporal_flow_events"("business_id", "type");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_module_idx" ON "temporal_flow_events"("business_id", "module");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_status_idx" ON "temporal_flow_events"("business_id", "status");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_reminder_at_idx" ON "temporal_flow_events"("business_id", "reminder_at");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_genome_impact_potential_idx" ON "temporal_flow_events"("business_id", "genome_impact_potential");

-- CreateIndex
CREATE UNIQUE INDEX "temporal_flow_events_business_id_source_external_id_key" ON "temporal_flow_events"("business_id", "source", "external_id");

-- AddForeignKey
ALTER TABLE "temporal_flow_events" ADD CONSTRAINT "temporal_flow_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

