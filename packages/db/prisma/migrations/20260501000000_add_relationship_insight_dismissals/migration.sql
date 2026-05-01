-- CreateTable
CREATE TABLE IF NOT EXISTS "relationship_insight_dismissals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "target_business_id" TEXT NOT NULL,
    "dismissed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozed_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationship_insight_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "relationship_insight_dismissals_business_id_target_business_id_key"
    ON "relationship_insight_dismissals"("business_id", "target_business_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "relationship_insight_dismissals_business_id_idx"
    ON "relationship_insight_dismissals"("business_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "relationship_insight_dismissals_business_id_snoozed_until_idx"
    ON "relationship_insight_dismissals"("business_id", "snoozed_until");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'relationship_insight_dismissals_business_id_fkey'
    ) THEN
        ALTER TABLE "relationship_insight_dismissals"
            ADD CONSTRAINT "relationship_insight_dismissals_business_id_fkey"
            FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'relationship_insight_dismissals_target_business_id_fkey'
    ) THEN
        ALTER TABLE "relationship_insight_dismissals"
            ADD CONSTRAINT "relationship_insight_dismissals_target_business_id_fkey"
            FOREIGN KEY ("target_business_id") REFERENCES "businesses"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
