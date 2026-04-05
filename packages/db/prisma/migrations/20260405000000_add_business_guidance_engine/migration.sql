-- CreateTable
CREATE TABLE "business_guidance_profiles" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "current_step" TEXT,
    "completed_steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_guidance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_identity_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "mission_statement" TEXT,
    "vision_statement" TEXT,
    "core_values" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_market" TEXT,
    "unique_selling_point" TEXT,
    "brand_personality" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_identity_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "founder_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "years_experience" INTEGER,
    "technical_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leadership_style" TEXT,
    "previous_exits" INTEGER DEFAULT 0,
    "education_level" TEXT,
    "motivations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weekly_hours_available" INTEGER,
    "co_founders" INTEGER DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "founder_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "primary_offer" TEXT,
    "offer_type" TEXT,
    "value_proposition" TEXT,
    "differentiators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricing_model" TEXT,
    "price_range_low" DOUBLE PRECISION,
    "price_range_high" DOUBLE PRECISION,
    "delivery_method" TEXT,
    "production_cost" DOUBLE PRECISION,
    "margin_percent" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "target_demographic" TEXT,
    "age_range_low" INTEGER,
    "age_range_high" INTEGER,
    "income_level" TEXT,
    "geographic_focus" TEXT,
    "customer_pain_points" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acquisition_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retention_strategy" TEXT,
    "customer_lifetime_value" DOUBLE PRECISION,
    "current_customer_count" INTEGER,
    "monthly_new_customers" INTEGER,
    "churn_rate_percent" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "monthly_revenue" DOUBLE PRECISION,
    "annual_revenue" DOUBLE PRECISION,
    "revenue_streams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recurring_percent" DOUBLE PRECISION,
    "seasonal_variation" BOOLEAN DEFAULT false,
    "peak_months" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "average_order_value" DOUBLE PRECISION,
    "revenue_growth_rate" DOUBLE PRECISION,
    "target_monthly_revenue" DOUBLE PRECISION,
    "break_even_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "startup_capital" DOUBLE PRECISION,
    "current_cash_reserve" DOUBLE PRECISION,
    "monthly_burn_rate" DOUBLE PRECISION,
    "monthly_fixed_costs" DOUBLE PRECISION,
    "monthly_variable_costs" DOUBLE PRECISION,
    "debt_total" DOUBLE PRECISION,
    "funding_raised" DOUBLE PRECISION,
    "funding_sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "profit_margin_percent" DOUBLE PRECISION,
    "runway_months" INTEGER,
    "has_accountant" BOOLEAN DEFAULT false,
    "has_bookkeeper" BOOLEAN DEFAULT false,
    "tax_compliant" BOOLEAN,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "team_size" INTEGER,
    "full_time_employees" INTEGER,
    "part_time_employees" INTEGER,
    "contractors" INTEGER,
    "operating_hours_per_week" INTEGER,
    "tools_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "automation_level" TEXT,
    "bottlenecks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "key_processes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supply_chain_complexity" TEXT,
    "quality_control_process" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operations_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_guidance_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "business_registered" BOOLEAN,
    "registration_type" TEXT,
    "tax_id_number" TEXT,
    "has_business_insurance" BOOLEAN,
    "insurance_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "licenses_held" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "licenses_needed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "data_protection_compliant" BOOLEAN,
    "industry_regulations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_compliance_review" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_guidance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "growth_stage" TEXT,
    "marketing_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "marketing_budget" DOUBLE PRECISION,
    "customer_acquisition_cost" DOUBLE PRECISION,
    "brand_awareness" TEXT,
    "competitor_count" INTEGER,
    "competitive_advantage" TEXT,
    "market_size" TEXT,
    "market_share_percent" DOUBLE PRECISION,
    "partnership_count" INTEGER,
    "referral_program" BOOLEAN DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "short_term_goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "long_term_goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revenue_target_12m" DOUBLE PRECISION,
    "customer_target_12m" INTEGER,
    "hiring_plans" TEXT,
    "expansion_plans" TEXT,
    "exit_strategy" TEXT,
    "biggest_challenges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "help_needed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeline_urgency" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "overall_score" DOUBLE PRECISION,
    "category_scores" JSONB,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weaknesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opportunities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metrics" JSONB,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guidance_recommendations" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "impact" TEXT NOT NULL DEFAULT 'MEDIUM',
    "effort" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "action_url" TEXT,
    "completed_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guidance_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmap_items" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sequence_order" INTEGER NOT NULL,
    "estimated_days" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "depends_on" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "start_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roadmap_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_snapshots" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "overall_score" DOUBLE PRECISION,
    "category_scores" JSONB,
    "completed_recommendations" INTEGER NOT NULL DEFAULT 0,
    "total_recommendations" INTEGER NOT NULL DEFAULT 0,
    "completed_roadmap_items" INTEGER NOT NULL DEFAULT 0,
    "total_roadmap_items" INTEGER NOT NULL DEFAULT 0,
    "snapshot_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_guidance_profiles_business_id_key" ON "business_guidance_profiles"("business_id");

-- CreateIndex
CREATE INDEX "business_guidance_profiles_business_id_idx" ON "business_guidance_profiles"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_identity_profiles_guidance_profile_id_key" ON "business_identity_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "business_identity_profiles_guidance_profile_id_idx" ON "business_identity_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "founder_profiles_guidance_profile_id_key" ON "founder_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "founder_profiles_guidance_profile_id_idx" ON "founder_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "offer_profiles_guidance_profile_id_key" ON "offer_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "offer_profiles_guidance_profile_id_idx" ON "offer_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_guidance_profile_id_key" ON "customer_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "customer_profiles_guidance_profile_id_idx" ON "customer_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_profiles_guidance_profile_id_key" ON "revenue_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "revenue_profiles_guidance_profile_id_idx" ON "revenue_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_profiles_guidance_profile_id_key" ON "finance_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "finance_profiles_guidance_profile_id_idx" ON "finance_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "operations_profiles_guidance_profile_id_key" ON "operations_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "operations_profiles_guidance_profile_id_idx" ON "operations_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_guidance_profiles_guidance_profile_id_key" ON "compliance_guidance_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "compliance_guidance_profiles_guidance_profile_id_idx" ON "compliance_guidance_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "growth_profiles_guidance_profile_id_key" ON "growth_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "growth_profiles_guidance_profile_id_idx" ON "growth_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "goals_profiles_guidance_profile_id_key" ON "goals_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "goals_profiles_guidance_profile_id_idx" ON "goals_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "assessment_results_guidance_profile_id_idx" ON "assessment_results"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "assessment_results_guidance_profile_id_created_at_idx" ON "assessment_results"("guidance_profile_id", "created_at");

-- CreateIndex
CREATE INDEX "guidance_recommendations_guidance_profile_id_idx" ON "guidance_recommendations"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "guidance_recommendations_guidance_profile_id_status_idx" ON "guidance_recommendations"("guidance_profile_id", "status");

-- CreateIndex
CREATE INDEX "guidance_recommendations_guidance_profile_id_priority_idx" ON "guidance_recommendations"("guidance_profile_id", "priority");

-- CreateIndex
CREATE INDEX "roadmap_items_guidance_profile_id_idx" ON "roadmap_items"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "roadmap_items_guidance_profile_id_sequence_order_idx" ON "roadmap_items"("guidance_profile_id", "sequence_order");

-- CreateIndex
CREATE INDEX "roadmap_items_guidance_profile_id_status_idx" ON "roadmap_items"("guidance_profile_id", "status");

-- CreateIndex
CREATE INDEX "progress_snapshots_guidance_profile_id_idx" ON "progress_snapshots"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "progress_snapshots_guidance_profile_id_snapshot_date_idx" ON "progress_snapshots"("guidance_profile_id", "snapshot_date");

-- AddForeignKey
ALTER TABLE "business_guidance_profiles" ADD CONSTRAINT "business_guidance_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_identity_profiles" ADD CONSTRAINT "business_identity_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "founder_profiles" ADD CONSTRAINT "founder_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_profiles" ADD CONSTRAINT "offer_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_profiles" ADD CONSTRAINT "revenue_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_profiles" ADD CONSTRAINT "finance_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations_profiles" ADD CONSTRAINT "operations_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_guidance_profiles" ADD CONSTRAINT "compliance_guidance_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_profiles" ADD CONSTRAINT "growth_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals_profiles" ADD CONSTRAINT "goals_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guidance_recommendations" ADD CONSTRAINT "guidance_recommendations_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
