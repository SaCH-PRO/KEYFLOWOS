-- CreateTable
CREATE TABLE IF NOT EXISTS "contact_momentum" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "previous_score" INTEGER,
    "trend" TEXT NOT NULL DEFAULT 'stable',
    "recency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frequency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monetary_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagement_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenure_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_momentum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "contact_momentum_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "trend" TEXT NOT NULL DEFAULT 'stable',
    "recency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frequency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monetary_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagement_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenure_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_momentum_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "momentum_recommendations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "draft_message" TEXT,
    "draft_subject" TEXT,
    "suggested_channel" TEXT,
    "trigger_reason" TEXT,
    "momentum_score" INTEGER,
    "snoozed_until" TIMESTAMP(3),
    "actioned_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "auto_executed" BOOLEAN NOT NULL DEFAULT false,
    "scheduled_for" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "momentum_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contact_momentum_business_id_contact_id_key" ON "contact_momentum"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_momentum_business_id_idx" ON "contact_momentum"("business_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_momentum_business_id_score_idx" ON "contact_momentum"("business_id", "score");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_momentum_business_id_calculated_at_idx" ON "contact_momentum"("business_id", "calculated_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contact_momentum_snapshots_business_id_contact_id_snapshot_date_key" ON "contact_momentum_snapshots"("business_id", "contact_id", "snapshot_date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_momentum_snapshots_business_id_contact_id_idx" ON "contact_momentum_snapshots"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_momentum_snapshots_business_id_snapshot_date_idx" ON "contact_momentum_snapshots"("business_id", "snapshot_date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "momentum_recommendations_business_id_status_idx" ON "momentum_recommendations"("business_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "momentum_recommendations_business_id_contact_id_idx" ON "momentum_recommendations"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "momentum_recommendations_business_id_scheduled_for_idx" ON "momentum_recommendations"("business_id", "scheduled_for");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "momentum_recommendations_business_id_created_at_idx" ON "momentum_recommendations"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "contact_momentum" ADD CONSTRAINT "contact_momentum_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_momentum_snapshots" ADD CONSTRAINT "contact_momentum_snapshots_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "momentum_recommendations" ADD CONSTRAINT "momentum_recommendations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
