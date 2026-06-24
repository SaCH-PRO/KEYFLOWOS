-- CreateTable
CREATE TABLE "market_strategies" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "swot" JSONB,
    "pestle" JSONB,
    "positioning" JSONB,
    "launch_plan" JSONB,
    "analysis_summary" JSONB,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "threat_level" TEXT,
    "strengths" TEXT[],
    "weaknesses" TEXT[],
    "positioning" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_strategies_business_id_key" ON "market_strategies"("business_id");

-- CreateIndex
CREATE INDEX "competitors_business_id_idx" ON "competitors"("business_id");

-- AddForeignKey
ALTER TABLE "market_strategies" ADD CONSTRAINT "market_strategies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Down migration
-- DROP TABLE IF EXISTS "competitors";
-- DROP TABLE IF EXISTS "market_strategies";
