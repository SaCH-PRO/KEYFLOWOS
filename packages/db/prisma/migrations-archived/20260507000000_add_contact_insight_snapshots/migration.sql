-- CreateTable
CREATE TABLE "contact_insight_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "model_used" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_insight_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_insight_snapshots_contact_id_key" ON "contact_insight_snapshots"("contact_id");

-- CreateIndex
CREATE INDEX "contact_insight_snapshots_business_id_stale_idx" ON "contact_insight_snapshots"("business_id", "stale");

-- CreateIndex
CREATE INDEX "contact_insight_snapshots_business_id_computed_at_idx" ON "contact_insight_snapshots"("business_id", "computed_at");

-- AddForeignKey
ALTER TABLE "contact_insight_snapshots" ADD CONSTRAINT "contact_insight_snapshots_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_insight_snapshots" ADD CONSTRAINT "contact_insight_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
