-- CreateTable
CREATE TABLE "genome_recommendation_outcomes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "recommendation_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissal_reason" TEXT,
    "pre_health_score" INTEGER,
    "pre_readiness_score" INTEGER,
    "pre_confidence" INTEGER,
    "pre_risk_level" TEXT,
    "post_health_score" INTEGER,
    "post_readiness_score" INTEGER,
    "post_confidence" INTEGER,
    "post_risk_level" TEXT,
    "observed_at" TIMESTAMP(3),
    "impact_score" DOUBLE PRECISION,
    "impact_evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linked_action_type" TEXT,
    "linked_action_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_recommendation_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_outcome_learning_windows" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "window_days" INTEGER NOT NULL DEFAULT 14,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_outcome_learning_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "genome_recommendation_outcomes_business_id_domain_idx" ON "genome_recommendation_outcomes"("business_id", "domain");

-- CreateIndex
CREATE INDEX "genome_recommendation_outcomes_business_id_decision_idx" ON "genome_recommendation_outcomes"("business_id", "decision");

-- CreateIndex
CREATE INDEX "genome_recommendation_outcomes_recommendation_id_idx" ON "genome_recommendation_outcomes"("recommendation_id");

-- CreateIndex
CREATE INDEX "genome_recommendation_outcomes_decided_at_idx" ON "genome_recommendation_outcomes"("decided_at");

-- CreateIndex
CREATE UNIQUE INDEX "genome_outcome_learning_windows_business_id_domain_key" ON "genome_outcome_learning_windows"("business_id", "domain");

-- AddForeignKey
ALTER TABLE "genome_recommendation_outcomes" ADD CONSTRAINT "genome_recommendation_outcomes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_outcome_learning_windows" ADD CONSTRAINT "genome_outcome_learning_windows_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
