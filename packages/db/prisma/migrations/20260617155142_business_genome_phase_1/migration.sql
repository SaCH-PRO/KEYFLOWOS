-- AlterTable
ALTER TABLE "business_blueprints" ADD COLUMN     "business_assets" JSONB DEFAULT '{}',
ADD COLUMN     "constitution_generated_at" TIMESTAMP(3),
ADD COLUMN     "constitution_version" INTEGER DEFAULT 1,
ADD COLUMN     "executive_readiness_score" INTEGER,
ADD COLUMN     "genesis_completed" BOOLEAN DEFAULT false,
ADD COLUMN     "genome_dna_confidence" JSONB DEFAULT '{}',
ADD COLUMN     "genome_dna_scores" JSONB DEFAULT '{}',
ADD COLUMN     "genome_integrity" INTEGER,
ADD COLUMN     "genome_stage" TEXT,
ADD COLUMN     "last_genome_sync_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "genome_chat_messages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "genome_chat_messages_business_id_created_at_idx" ON "genome_chat_messages"("business_id", "created_at");
