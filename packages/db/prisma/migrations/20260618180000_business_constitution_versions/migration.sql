-- CreateTable
CREATE TABLE "business_constitution_versions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Business Constitution',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "content" JSONB NOT NULL,
    "summary" TEXT,
    "change_notes" TEXT,
    "source_genome_integrity" INTEGER,
    "source_executive_readiness" INTEGER,
    "source_genome_stage" TEXT,
    "source_dna_scores" JSONB,
    "source_dna_confidence" JSONB,
    "generated_by" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_constitution_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_constitution_versions_business_id_idx" ON "business_constitution_versions"("business_id");

-- CreateIndex
CREATE INDEX "business_constitution_versions_business_id_status_idx" ON "business_constitution_versions"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_constitution_versions_business_id_version_key" ON "business_constitution_versions"("business_id", "version");

-- AddForeignKey
ALTER TABLE "business_constitution_versions" ADD CONSTRAINT "business_constitution_versions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

