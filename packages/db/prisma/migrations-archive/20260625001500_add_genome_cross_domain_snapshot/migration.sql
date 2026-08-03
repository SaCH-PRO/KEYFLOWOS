-- CreateTable
CREATE TABLE "genome_cross_domain_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "period" TEXT,
    "overall_health_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overall_risk_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "domain_scores" JSONB NOT NULL DEFAULT '{}',
    "domain_risks" JSONB NOT NULL DEFAULT '{}',
    "readiness_summary" JSONB NOT NULL DEFAULT '{}',
    "evidence_summary" JSONB NOT NULL DEFAULT '{}',
    "bottlenecks" JSONB NOT NULL DEFAULT '[]',
    "opportunities" JSONB NOT NULL DEFAULT '[]',
    "recommended_focus" JSONB NOT NULL DEFAULT '[]',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_cross_domain_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "genome_cross_domain_snapshots_business_id_period_idx" ON "genome_cross_domain_snapshots"("business_id", "period");

-- CreateIndex
CREATE INDEX "genome_cross_domain_snapshots_business_id_overall_risk_leve_idx" ON "genome_cross_domain_snapshots"("business_id", "overall_risk_level");

-- AddForeignKey
ALTER TABLE "genome_cross_domain_snapshots" ADD CONSTRAINT "genome_cross_domain_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
