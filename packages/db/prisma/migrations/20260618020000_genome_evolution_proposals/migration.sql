-- CreateTable
CREATE TABLE "genome_evolution_proposals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "proposed_patch" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB DEFAULT '[]',
    "confidence" DOUBLE PRECISION DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "source_event_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_evolution_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "genome_evolution_proposals_business_id_status_idx" ON "genome_evolution_proposals"("business_id", "status");

-- CreateIndex
CREATE INDEX "genome_evolution_proposals_business_id_section_idx" ON "genome_evolution_proposals"("business_id", "section");

-- CreateIndex
CREATE INDEX "genome_evolution_proposals_business_id_created_at_idx" ON "genome_evolution_proposals"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "genome_evolution_proposals" ADD CONSTRAINT "genome_evolution_proposals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

