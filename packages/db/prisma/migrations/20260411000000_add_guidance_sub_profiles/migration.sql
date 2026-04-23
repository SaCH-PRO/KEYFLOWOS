-- CreateTable
CREATE TABLE IF NOT EXISTS "sales_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "sales_process" TEXT,
    "sales_cycle" TEXT,
    "pipeline_stages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conversion_rate" DOUBLE PRECISION,
    "average_deal_size" DOUBLE PRECISION,
    "sales_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "crm_approach" TEXT,
    "lead_sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "follow_up_strategy" TEXT,
    "sales_team_size" INTEGER,
    "quota_target" DOUBLE PRECISION,
    "objection_handling" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "marketing_strategy_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "brand_voice" TEXT,
    "messaging_framework" TEXT,
    "content_pillars" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content_frequency" TEXT,
    "campaign_history" TEXT,
    "social_strategy" TEXT,
    "email_strategy" TEXT,
    "seo_strategy" TEXT,
    "paid_advertising" TEXT,
    "advertising_budget" DOUBLE PRECISION,
    "target_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brand_guidelines" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_strategy_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "people_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "company_culture" TEXT,
    "hiring_criteria" TEXT,
    "compensation_philosophy" TEXT,
    "training_approach" TEXT,
    "org_structure" TEXT,
    "employee_benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retention_strategy" TEXT,
    "performance_review" TEXT,
    "remote_policy" TEXT,
    "diversity_policy" TEXT,
    "key_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hiring_timeline" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "technology_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "tech_stack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "digital_maturity" TEXT,
    "cybersecurity_posture" TEXT,
    "data_strategy" TEXT,
    "cloud_services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "website_platform" TEXT,
    "ecommerce_platform" TEXT,
    "automation_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "analytics_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "it_budget" DOUBLE PRECISION,
    "data_backup_strategy" TEXT,
    "tech_debt" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technology_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "partnerships_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "key_suppliers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vendor_relationships" TEXT,
    "strategic_alliances" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "distribution_partners" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "referral_partners" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joint_ventures" TEXT,
    "community_involvement" TEXT,
    "industry_associations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "partnership_goals" TEXT,
    "supplier_diversification" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partnerships_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "intellectual_property_profiles" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT NOT NULL,
    "trademarks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "patents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "copyrights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trade_secrets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proprietary_processes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brand_assets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domain_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ip_protection_strategy" TEXT,
    "licensing_strategy" TEXT,
    "ip_registration_status" TEXT,
    "competitive_ip_risks" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intellectual_property_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sales_profiles_guidance_profile_id_key" ON "sales_profiles"("guidance_profile_id");
CREATE INDEX IF NOT EXISTS "sales_profiles_guidance_profile_id_idx" ON "sales_profiles"("guidance_profile_id");

CREATE UNIQUE INDEX IF NOT EXISTS "marketing_strategy_profiles_guidance_profile_id_key" ON "marketing_strategy_profiles"("guidance_profile_id");
CREATE INDEX IF NOT EXISTS "marketing_strategy_profiles_guidance_profile_id_idx" ON "marketing_strategy_profiles"("guidance_profile_id");

CREATE UNIQUE INDEX IF NOT EXISTS "people_profiles_guidance_profile_id_key" ON "people_profiles"("guidance_profile_id");
CREATE INDEX IF NOT EXISTS "people_profiles_guidance_profile_id_idx" ON "people_profiles"("guidance_profile_id");

CREATE UNIQUE INDEX IF NOT EXISTS "technology_profiles_guidance_profile_id_key" ON "technology_profiles"("guidance_profile_id");
CREATE INDEX IF NOT EXISTS "technology_profiles_guidance_profile_id_idx" ON "technology_profiles"("guidance_profile_id");

CREATE UNIQUE INDEX IF NOT EXISTS "partnerships_profiles_guidance_profile_id_key" ON "partnerships_profiles"("guidance_profile_id");
CREATE INDEX IF NOT EXISTS "partnerships_profiles_guidance_profile_id_idx" ON "partnerships_profiles"("guidance_profile_id");

CREATE UNIQUE INDEX IF NOT EXISTS "intellectual_property_profiles_guidance_profile_id_key" ON "intellectual_property_profiles"("guidance_profile_id");
CREATE INDEX IF NOT EXISTS "intellectual_property_profiles_guidance_profile_id_idx" ON "intellectual_property_profiles"("guidance_profile_id");

-- AddForeignKey
ALTER TABLE "sales_profiles" ADD CONSTRAINT "sales_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_strategy_profiles" ADD CONSTRAINT "marketing_strategy_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "people_profiles" ADD CONSTRAINT "people_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "technology_profiles" ADD CONSTRAINT "technology_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partnerships_profiles" ADD CONSTRAINT "partnerships_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intellectual_property_profiles" ADD CONSTRAINT "intellectual_property_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
