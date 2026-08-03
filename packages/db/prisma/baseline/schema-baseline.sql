-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOID', 'OVERDUE', 'FAILED', 'PENDING', 'PARTIALLY_PAID', 'FULLY_CREDITED', 'PARTIALLY_CREDITED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'VIEWED', 'EXPIRED', 'INVOICED', 'PAID', 'CONVERTED');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'UNCONFIRMED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('COMPLETED', 'PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "ProjectTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BusinessAssetStatus" AS ENUM ('ACTIVE', 'PENDING', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RENEWAL_DUE', 'EXPIRED', 'TERMINATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractAlertType" AS ENUM ('EXPIRY_30', 'EXPIRY_7', 'EXPIRY_1', 'RENEWAL_DUE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FlowType" AS ENUM ('TEMPORAL', 'FINANCIAL', 'PEOPLE');

-- CreateEnum
CREATE TYPE "FlowSignalStatus" AS ENUM ('RECORDED', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED', 'SNOOZED');

-- CreateEnum
CREATE TYPE "FlowSignalImportance" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'AUTO_APPROVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "BusinessEventType" AS ENUM ('ACTION_EXECUTED', 'DECISION_MADE', 'INSIGHT_GENERATED', 'ALERT_TRIGGERED', 'AUTONOMY_EXERCISED', 'GOVERNANCE_DECISION', 'RECOMMENDATION_OFFERED', 'RECOMMENDATION_ACTED', 'RECOMMENDATION_IGNORED', 'GENOME_EVOLUTION', 'USER_INTERACTION', 'SYSTEM_EVENT');

-- CreateEnum
CREATE TYPE "EvidenceClaimType" AS ENUM ('TASK_COMPLETED', 'INVOICE_COLLECTED', 'LEAD_CONVERTED', 'BOOKING_COMPLETED', 'CAMPAIGN_SENT', 'PAYMENT_RECEIVED', 'CUSTOMER_RETAINED', 'AUTOMATION_EXECUTED', 'RECOMMENDATION_ACTED', 'GOVERNANCE_DECISION');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "avatar_url" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "referral_code" TEXT,
    "referred_by_user_id" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "slug" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Port_of_Spain',
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "logo_url" TEXT,
    "tagline" TEXT,
    "description" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "facebook" TEXT,
    "instagram" TEXT,
    "twitter" TEXT,
    "linkedin" TEXT,
    "tiktok" TEXT,
    "youtube" TEXT,
    "whatsapp" TEXT,
    "headline" TEXT,
    "bio" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "business_stage" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accepting_work" BOOLEAN NOT NULL DEFAULT true,
    "current_capacity" TEXT,
    "lead_time" TEXT,
    "preferred_project_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budget_fit" TEXT,
    "positioning_statement" TEXT,
    "profile_completeness" INTEGER NOT NULL DEFAULT 0,
    "primary_color" TEXT DEFAULT '#F97316',
    "secondary_color" TEXT DEFAULT '#14B8A6',
    "default_tax_rate" DOUBLE PRECISION DEFAULT 0,
    "invoice_template" TEXT DEFAULT 'classic',
    "quote_template" TEXT DEFAULT 'classic',
    "accounting_basis" TEXT NOT NULL DEFAULT 'CASH',
    "accountant_email" TEXT,
    "business_intent" TEXT,
    "archetype" TEXT,
    "industry" TEXT,
    "revenue_model" TEXT,
    "budget_range" TEXT,
    "time_commitment" TEXT,
    "team_size" TEXT,
    "autopilot_enabled" BOOLEAN NOT NULL DEFAULT true,
    "autopilot_stage" TEXT,
    "compliance_status" TEXT,
    "compliance_data" JSONB,
    "last_health_check" TIMESTAMP(3),
    "crm_health_thresholds" JSONB,
    "crm_attribution_window_days" INTEGER,
    "fiscal_year_start_month" INTEGER DEFAULT 1,
    "default_cash_account_id" TEXT,
    "default_ar_account_id" TEXT,
    "default_ap_account_id" TEXT,
    "default_tax_account_id" TEXT,
    "notification_preferences" JSONB DEFAULT '{}',
    "gmail_email" TEXT,
    "gmail_access_token" TEXT,
    "gmail_refresh_token" TEXT,
    "gmail_token_expiry" TIMESTAMP(3),
    "calendar_email" TEXT,
    "calendar_access_token" TEXT,
    "calendar_refresh_token" TEXT,
    "calendar_token_expiry" TIMESTAMP(3),
    "calendar_id" TEXT,
    "calendar_sync_direction" TEXT NOT NULL DEFAULT 'two_way',
    "calendar_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "calendar_sync_settings" JSONB,
    "drive_email" TEXT,
    "drive_access_token" TEXT,
    "drive_refresh_token" TEXT,
    "drive_token_expiry" TIMESTAMP(3),
    "message_intake_enabled" BOOLEAN NOT NULL DEFAULT false,
    "forms_email" TEXT,
    "forms_access_token" TEXT,
    "forms_refresh_token" TEXT,
    "forms_token_expiry" TIMESTAMP(3),
    "contacts_email" TEXT,
    "contacts_access_token" TEXT,
    "contacts_refresh_token" TEXT,
    "contacts_token_expiry" TIMESTAMP(3),
    "contacts_last_sync_at" TIMESTAMP(3),
    "contacts_sync_token" TEXT,
    "ms_contacts_email" TEXT,
    "ms_contacts_access_token" TEXT,
    "ms_contacts_refresh_token" TEXT,
    "ms_contacts_token_expiry" TIMESTAMP(3),
    "ms_contacts_last_sync_at" TIMESTAMP(3),
    "ms_contacts_delta_link" TEXT,
    "signature_parsing_enabled" BOOLEAN NOT NULL DEFAULT false,
    "bp_email" TEXT,
    "bp_access_token" TEXT,
    "bp_refresh_token" TEXT,
    "bp_token_expiry" TIMESTAMP(3),
    "bp_account_id" TEXT,
    "bp_location_id" TEXT,
    "google_suite_email" TEXT,
    "inventory_linked_sheet_id" TEXT,
    "inventory_linked_sheet_name" TEXT,
    "inventory_last_sync_at" TIMESTAMP(3),
    "store_enabled" BOOLEAN NOT NULL DEFAULT true,
    "onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_step" TEXT DEFAULT 'welcome',
    "onboarding_started_at" TIMESTAMP(3),
    "onboarding_completed_at" TIMESTAMP(3),
    "booking_reminder_mins" INTEGER NOT NULL DEFAULT 60,
    "forget_grace_days" INTEGER NOT NULL DEFAULT 7,
    "default_forget_reason" TEXT,
    "business_hours" JSONB,
    "data_quality_stale_days" INTEGER NOT NULL DEFAULT 180,
    "data_quality_last_run_at" TIMESTAMP(3),
    "meta_data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_assets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BusinessAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider" TEXT,
    "url" TEXT,
    "identifier" TEXT,
    "owner" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contract_type" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "renewal_date" TIMESTAMP(3),
    "renewal_type" TEXT,
    "renewal_notice_days" INTEGER,
    "contract_value" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'TTD',
    "jurisdiction" TEXT,
    "retention_policy" TEXT,
    "retention_until" TIMESTAMP(3),
    "notes" TEXT,
    "source_asset_id" TEXT,
    "source_business_asset_id" TEXT,
    "source_document_instance_id" TEXT,
    "source_drive_file_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_parties" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "contact_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_terms" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "term_key" TEXT NOT NULL,
    "term_value" TEXT NOT NULL,
    "source_text" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_versions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "change_summary" TEXT,
    "file_name" TEXT,
    "file_url" TEXT,
    "file_asset_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_alerts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "alert_type" "ContractAlertType" NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_tags" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_tags_on_contracts" (
    "contract_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_tags_on_contracts_pkey" PRIMARY KEY ("contract_id","tag_id")
);

-- CreateTable
CREATE TABLE "temporal_flow_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "module" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "importance" TEXT NOT NULL DEFAULT 'NORMAL',
    "visibility" TEXT NOT NULL DEFAULT 'USER',
    "payload" JSONB DEFAULT '{}',
    "signals" JSONB DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reminder_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "genome_impact_potential" BOOLEAN NOT NULL DEFAULT false,
    "key_analysis_status" TEXT,
    "external_id" TEXT,
    "external_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "thread_id" TEXT,
    "message_id" TEXT,
    "contact_id" TEXT,
    "memory_embedding_id" TEXT,

    CONSTRAINT "temporal_flow_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_signals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "flows" "FlowType"[],
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "module" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "reminder_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "status" "FlowSignalStatus" NOT NULL DEFAULT 'RECORDED',
    "importance" "FlowSignalImportance" NOT NULL DEFAULT 'NORMAL',
    "visibility" TEXT NOT NULL DEFAULT 'USER',
    "owner_role_hint" TEXT,
    "payload" JSONB DEFAULT '{}',
    "signals" JSONB DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_role_subscriptions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "flow_type" "FlowType" NOT NULL,
    "type_filter" TEXT,
    "source_filter" TEXT,
    "module_filter" TEXT,
    "importance_filter" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_role_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporal_flow_memories" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_event_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_module" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "temporal_flow_memories_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "genome_facts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "value_type" TEXT NOT NULL,
    "source_module" TEXT,
    "source_type" TEXT NOT NULL,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "completeness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freshness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "operational_readiness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verification_status" TEXT NOT NULL DEFAULT 'INFERRED',
    "risk_if_wrong" TEXT NOT NULL DEFAULT 'MEDIUM',
    "last_verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_evidence" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "fact_id" TEXT,
    "source_module" TEXT NOT NULL,
    "source_entity_type" TEXT NOT NULL,
    "source_entity_id" TEXT,
    "summary" TEXT NOT NULL,
    "evidence_strength" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "occurred_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_signals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source_module" TEXT NOT NULL,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "signal_type" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "field" TEXT,
    "proposed_value" JSONB,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "genome_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_module_readiness" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "readiness_score" INTEGER NOT NULL,
    "required_facts" JSONB NOT NULL DEFAULT '[]',
    "missing_facts" JSONB NOT NULL DEFAULT '[]',
    "optional_facts" JSONB NOT NULL DEFAULT '[]',
    "blocked_reasons" JSONB NOT NULL DEFAULT '[]',
    "recommended_setup_actions" JSONB NOT NULL DEFAULT '[]',
    "automation_allowed" BOOLEAN NOT NULL DEFAULT false,
    "risk_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "last_computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_module_readiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_recommendations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "insight" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "expected_gain" TEXT,
    "expected_gain_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "risk_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "effort_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidence_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggested_experiment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "outcome_tracked_at" TIMESTAMP(3),

    CONSTRAINT "genome_recommendations_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "genome_experiments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "success_metric" TEXT NOT NULL,
    "baseline_value" DOUBLE PRECISION,
    "target_value" DOUBLE PRECISION,
    "duration_days" INTEGER NOT NULL DEFAULT 14,
    "risk_level" TEXT NOT NULL DEFAULT 'LOW',
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "genome_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_departments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "primary_sections" JSONB NOT NULL DEFAULT '[]',
    "supporting_sections" JSONB NOT NULL DEFAULT '[]',
    "impacted_modules" JSONB NOT NULL DEFAULT '[]',
    "core_capabilities" JSONB NOT NULL DEFAULT '[]',
    "maturity_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "readiness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "risk_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "autonomy_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "automation_allowed" BOOLEAN NOT NULL DEFAULT false,
    "gap_summary" JSONB NOT NULL DEFAULT '[]',
    "recommended_actions" JSONB NOT NULL DEFAULT '[]',
    "last_computed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_memory_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_entity_id" TEXT,
    "event_type" TEXT NOT NULL,
    "domain" TEXT,
    "section" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "outcome" TEXT,
    "impact_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidence_delta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "lessons" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_memory_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_financial_metrics" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL,
    "period" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "source_module" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "notes" TEXT,
    "occurred_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_financial_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_finance_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "period" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "revenue" DOUBLE PRECISION,
    "gross_profit" DOUBLE PRECISION,
    "net_profit" DOUBLE PRECISION,
    "monthly_expenses" DOUBLE PRECISION,
    "cash_on_hand" DOUBLE PRECISION,
    "accounts_receivable" DOUBLE PRECISION,
    "accounts_payable" DOUBLE PRECISION,
    "tax_reserve" DOUBLE PRECISION,
    "gross_margin_percent" DOUBLE PRECISION,
    "net_margin_percent" DOUBLE PRECISION,
    "runway_months" DOUBLE PRECISION,
    "average_ticket" DOUBLE PRECISION,
    "health_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cash_flow_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "margin_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "pricing_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "tax_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "overall_risk" TEXT NOT NULL DEFAULT 'MEDIUM',
    "missing_inputs" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_finance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_customer_segments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "segment_type" TEXT NOT NULL,
    "estimated_size" DOUBLE PRECISION,
    "average_revenue" DOUBLE PRECISION,
    "average_cost" DOUBLE PRECISION,
    "lifetime_value" DOUBLE PRECISION,
    "acquisition_cost" DOUBLE PRECISION,
    "churn_rate" DOUBLE PRECISION,
    "conversion_rate" DOUBLE PRECISION,
    "channel" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source_module" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_customer_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_sales_motions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "motion_type" TEXT NOT NULL,
    "stage" TEXT,
    "conversion_rate" DOUBLE PRECISION,
    "average_deal_size" DOUBLE PRECISION,
    "cycle_days" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "channel" TEXT,
    "revenue_contribution" DOUBLE PRECISION,
    "cost_per_lead" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source_module" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_sales_motions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_customer_sales_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "period" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "total_customers" DOUBLE PRECISION,
    "active_customers" DOUBLE PRECISION,
    "new_customers" DOUBLE PRECISION,
    "churned_customers" DOUBLE PRECISION,
    "retention_rate" DOUBLE PRECISION,
    "conversion_rate" DOUBLE PRECISION,
    "average_revenue_per_customer" DOUBLE PRECISION,
    "lifetime_value" DOUBLE PRECISION,
    "customer_acquisition_cost" DOUBLE PRECISION,
    "ltv_cac_ratio" DOUBLE PRECISION,
    "revenue_quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenue_concentration_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "cac_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "ltv_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "churn_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "conversion_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "overall_risk" TEXT NOT NULL DEFAULT 'MEDIUM',
    "missing_inputs" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_customer_sales_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_operational_processes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "process_type" TEXT NOT NULL,
    "owner_role" TEXT,
    "frequency" TEXT,
    "documented" BOOLEAN NOT NULL DEFAULT false,
    "has_sop" BOOLEAN NOT NULL DEFAULT false,
    "average_cycle_time_hours" DOUBLE PRECISION,
    "failure_rate" DOUBLE PRECISION,
    "rework_rate" DOUBLE PRECISION,
    "handoff_count" INTEGER,
    "automation_candidate" BOOLEAN NOT NULL DEFAULT false,
    "autonomy_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "maturity_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "risk_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "bottlenecks" JSONB NOT NULL DEFAULT '[]',
    "missing_inputs" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "source_module" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_operational_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_delivery_capabilities" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capability_type" TEXT NOT NULL,
    "current_capacity" DOUBLE PRECISION,
    "max_capacity" DOUBLE PRECISION,
    "capacity_unit" TEXT,
    "utilization_rate" DOUBLE PRECISION,
    "backlog_volume" DOUBLE PRECISION,
    "average_lead_time_days" DOUBLE PRECISION,
    "quality_score" DOUBLE PRECISION,
    "reliability_score" DOUBLE PRECISION,
    "risk_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "dependencies" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "source_module" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_delivery_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_operations_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "period" TEXT,
    "process_count" INTEGER NOT NULL DEFAULT 0,
    "documented_count" INTEGER NOT NULL DEFAULT 0,
    "sop_coverage_rate" DOUBLE PRECISION,
    "average_process_maturity" DOUBLE PRECISION,
    "average_utilization_rate" DOUBLE PRECISION,
    "average_lead_time_days" DOUBLE PRECISION,
    "bottleneck_count" INTEGER NOT NULL DEFAULT 0,
    "high_risk_process_count" INTEGER NOT NULL DEFAULT 0,
    "overloaded_capability_count" INTEGER NOT NULL DEFAULT 0,
    "delivery_readiness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quality_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "capacity_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "sop_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "overall_risk" TEXT NOT NULL DEFAULT 'MEDIUM',
    "missing_inputs" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_operations_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_growth_channels" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "monthly_budget" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "target_cac" DOUBLE PRECISION,
    "target_conversion_rate" DOUBLE PRECISION,
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "evidence_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source_module" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_growth_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_content_strategies" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "pillars" TEXT[],
    "cadence" TEXT,
    "formats" TEXT[],
    "distribution_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content_goals" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source_module" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genome_content_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genome_marketing_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "period" TEXT,
    "channelMix" JSONB NOT NULL DEFAULT '[]',
    "lead_volume_estimate" DOUBLE PRECISION,
    "blended_cac" DOUBLE PRECISION,
    "content_consistency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "channel_diversification_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "funnel_conversion_estimate" DOUBLE PRECISION,
    "overall_risk" TEXT NOT NULL DEFAULT 'MEDIUM',
    "missing_inputs" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "signals_generated_at" TIMESTAMP(3),
    "recommendations_generated_at" TIMESTAMP(3),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_marketing_snapshots_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "key_action_proposals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "source_mode" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "rationale" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "tool_name" TEXT,
    "module" TEXT,
    "description" TEXT,
    "expected_benefit" TEXT,
    "risks" TEXT,
    "input_payload" JSONB,
    "affected_entities" JSONB,
    "resolved_by_user_id" TEXT,
    "resolution" JSONB,
    "multi_step_parent_id" TEXT,
    "plan_id" TEXT,
    "plan_step_id" TEXT,
    "correlation_id" TEXT,
    "command_id" TEXT,
    "session_id" TEXT,
    "business_event_id" TEXT,
    "risk_level" TEXT NOT NULL DEFAULT 'LOW',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "executed_by" TEXT,
    "executed_at" TIMESTAMP(3),
    "execution_result" JSONB,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_action_proposals_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "drive_sync_cursors" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "last_sync_at" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00 +00:00',
    "page_token" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "error_message" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drive_sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_intake_files" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "web_view_link" TEXT,
    "size" INTEGER,
    "modified_time" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confidence" DOUBLE PRECISION,
    "document_type" TEXT,
    "extracted_data" JSONB,
    "proposed_actions" JSONB,
    "error_message" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "drive_intake_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_intakes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "source_channel" TEXT NOT NULL,
    "external_id" TEXT,
    "from" TEXT NOT NULL,
    "from_name" TEXT,
    "to" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "raw_payload" JSONB,
    "contact_id" TEXT,
    "thread_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confidence" DOUBLE PRECISION,
    "intent_type" TEXT,
    "riskTier" INTEGER NOT NULL DEFAULT 1,
    "extracted_data" JSONB,
    "proposed_actions" JSONB,
    "error_message" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "message_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_items" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_connector_type" TEXT NOT NULL,
    "external_id" TEXT,
    "contact_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "raw_payload" JSONB NOT NULL,
    "summary" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "to_destination" TEXT,
    "received_at" TIMESTAMP(3),
    "attachments" JSONB,
    "from_name" TEXT,
    "from_email" TEXT,
    "from_phone" TEXT,
    "from_external_id" TEXT,
    "dedupe_hash" TEXT,
    "intent_type" TEXT,
    "confidence" DOUBLE PRECISION,
    "extracted_data" JSONB,
    "proposed_actions" JSONB,
    "user_feedback" JSONB,
    "executed_results" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permission_scopes" JSONB,
    "max_approval_tier" INTEGER NOT NULL DEFAULT 0,
    "daily_capacity_hours" DOUBLE PRECISION DEFAULT 8,
    "user_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_activity_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_units" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DEPARTMENT',
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "manager_id" TEXT,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_roles" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "permissions" JSONB,
    "default_approval_tier" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT DEFAULT '#64748b',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_assignments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_unit_id" TEXT NOT NULL,
    "job_role_id" TEXT,
    "reports_to_id" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegation_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "delegator_id" TEXT NOT NULL,
    "delegate_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "max_tier" INTEGER NOT NULL,
    "active_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_until" TIMESTAMP(3),
    "reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delegation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "email_normalized" TEXT,
    "phone" TEXT,
    "phone_normalized" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LEAD',
    "source" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom" JSONB DEFAULT '{}',
    "display_name" TEXT,
    "secondary_email" TEXT,
    "secondary_phone" TEXT,
    "whatsapp_number" TEXT,
    "preferred_channel" TEXT,
    "best_channel" TEXT,
    "best_channel_confidence" DOUBLE PRECISION,
    "best_time_window_json" JSONB,
    "best_signal_updated_at" TIMESTAMP(3),
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "timezone" TEXT,
    "company_name" TEXT,
    "job_title" TEXT,
    "department" TEXT,
    "industry" TEXT,
    "owner_id" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'TEAM',
    "lifecycle_stage" TEXT,
    "source_detail" TEXT,
    "segment" TEXT,
    "language" TEXT,
    "marketing_opt_in" BOOLEAN,
    "do_not_contact" BOOLEAN,
    "notes_internal" TEXT,
    "age_group" TEXT,
    "relationship_type" TEXT,
    "pipeline_stage" TEXT,
    "relationship_health" TEXT,
    "last_contacted_at" TIMESTAMP(3),
    "next_action_at" TIMESTAMP(3),
    "next_action_type" TEXT,
    "priority" TEXT,
    "favorite" BOOLEAN DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "last_merge_id" TEXT,
    "merged_into_id" TEXT,
    "business_id" TEXT NOT NULL,
    "account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lead_score" INTEGER,
    "last_interaction_at" TIMESTAMP(3),
    "conversion_probability" DOUBLE PRECISION,
    "lifetime_value" DOUBLE PRECISION,
    "average_spend" DOUBLE PRECISION,
    "payment_reliability" INTEGER,
    "booking_frequency" INTEGER,
    "cancellation_rate" DOUBLE PRECISION,
    "responsiveness_score" INTEGER,
    "preferred_services" JSONB,
    "sentiment_score" DOUBLE PRECISION,
    "referral_likelihood" INTEGER,
    "follow_up_priority" TEXT,
    "next_best_action" TEXT,
    "risk_flags" JSONB,
    "opportunities" JSONB,
    "data_quality_score" INTEGER,
    "data_quality_checked_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "search_vector" tsvector,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "placeholder" TEXT,
    "options" JSONB,
    "default_value" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_custom_field_values" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "contact_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contact_id","tag_id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "website" TEXT,
    "primary_contact_id" TEXT,
    "owner_user_id" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OPEN',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "account_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "company_name" TEXT,
    "value" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "stage_id" TEXT NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "probability" INTEGER,
    "owner_user_id" TEXT,
    "source" TEXT,
    "source_detail" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "expected_close_at" TIMESTAMP(3),
    "won_at" TIMESTAMP(3),
    "lost_at" TIMESTAMP(3),
    "loss_reason" TEXT,
    "last_stage_changed_at" TIMESTAMP(3),
    "health_score" INTEGER,
    "health_score_at" TIMESTAMP(3),
    "health_breakdown" JSONB,
    "bottleneck_flag" BOOLEAN NOT NULL DEFAULT false,
    "bottleneck_at" TIMESTAMP(3),
    "won_lost_reason_id" TEXT,
    "won_lost_reason_notes" TEXT,
    "quote_id" TEXT,
    "invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_relationships" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "from_contact_id" TEXT NOT NULL,
    "to_contact_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "since" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_shares" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_data_issues" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "field" TEXT,
    "message" TEXT NOT NULL,
    "recommended_fix" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_data_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "won_lost_reasons" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "won_lost_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_external_mappings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_external_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_sync_audits" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "action" TEXT NOT NULL,
    "resolution" TEXT,
    "fields_changed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_sync_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_sync_conflicts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "external_event_id" TEXT,
    "conflict_type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "external_summary" TEXT,
    "booking_start" TIMESTAMP(3),
    "booking_end" TIMESTAMP(3),
    "external_start" TIMESTAMP(3),
    "external_end" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3),
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "color" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'TEAM',
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_url" TEXT,
    "contact_id" TEXT,
    "staff_id" TEXT,
    "assignee_id" TEXT,
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "meta" JSONB,
    "sync_status" TEXT NOT NULL DEFAULT 'LOCAL',
    "google_event_id" TEXT,
    "google_calendar_id" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_statuses" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "connected_at" TIMESTAMP(3),
    "connected_account" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error" TEXT,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "sync_count" INTEGER NOT NULL DEFAULT 0,
    "intake_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_approve_threshold" DOUBLE PRECISION,
    "create_contacts_automatically" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "status_code" INTEGER,
    "response_body" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_activity_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "items_affected" INTEGER,
    "duration_ms" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "actor_type" TEXT,
    "actor_id" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_read_states" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_channel_stats" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "last_reply_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "hour_buckets_json" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_channel_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_ai_insights" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message_ref" TEXT,
    "hash" TEXT NOT NULL,
    "sentiment" TEXT,
    "intent" TEXT,
    "summary" TEXT,
    "payload" JSONB,
    "model_used" TEXT,
    "feature" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_ai_insights_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "contact_notes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tasks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "title" TEXT NOT NULL,
    "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "remind_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "source" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidence_required" BOOLEAN NOT NULL DEFAULT false,
    "call_log_id" TEXT,

    CONSTRAINT "contact_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_imports" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_url" TEXT,
    "original_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total_rows" INTEGER,
    "processed_rows" INTEGER,
    "header_mapping" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "contact_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_import_contacts" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "raw_data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_import_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_media" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "ocr_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_playbooks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "contact_playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_lists" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "type" TEXT NOT NULL DEFAULT 'MANUAL',
    "filters" JSONB,
    "rules" JSONB,
    "contact_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_operations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "primary_id" TEXT NOT NULL,
    "duplicate_id" TEXT NOT NULL,
    "duplicate_snapshot" JSONB NOT NULL,
    "field_overrides" JSONB,
    "resolved_fields" JSONB,
    "repointed_counts" JSONB,
    "actor_id" TEXT,
    "actor_type" TEXT,
    "reverted_at" TIMESTAMP(3),
    "reverted_actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merge_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_saved_views" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter_state" JSONB NOT NULL,
    "sort" JSONB,
    "visible_columns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_list_members" (
    "id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_list_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "category" TEXT NOT NULL DEFAULT 'SERVICE',
    "duration" INTEGER,
    "image_url" TEXT,
    "sku" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "execution_model" TEXT,
    "execution_meta" JSONB,
    "fulfillment_model" TEXT,
    "inventory_mode" TEXT,
    "out_of_stock_behavior" TEXT DEFAULT 'hide',
    "compare_at_price" DOUBLE PRECISION,
    "resource_type" TEXT,
    "download_url" TEXT,
    "preview_url" TEXT,
    "license_terms" TEXT,
    "is_free" BOOLEAN NOT NULL DEFAULT false,
    "file_size" INTEGER,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "quote_number" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_rate" DOUBLE PRECISION DEFAULT 0,
    "tax_amount" DOUBLE PRECISION DEFAULT 0,
    "discount_type" TEXT,
    "discount_value" DOUBLE PRECISION DEFAULT 0,
    "discount_amount" DOUBLE PRECISION DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "notes" TEXT,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiry_date" TIMESTAMP(3),
    "view_token" TEXT,
    "sent_at" TIMESTAMP(3),
    "viewed_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "last_follow_up_at" TIMESTAMP(3),
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "quote_id" TEXT NOT NULL,
    "product_id" TEXT,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_rate" DOUBLE PRECISION DEFAULT 0,
    "tax_amount" DOUBLE PRECISION DEFAULT 0,
    "tax_rate_id" TEXT,
    "discount_type" TEXT,
    "discount_value" DOUBLE PRECISION DEFAULT 0,
    "discount_amount" DOUBLE PRECISION DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "notes" TEXT,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "quote_id" TEXT,
    "campaign_id" TEXT,
    "external_accounting_source" TEXT,
    "external_accounting_id" TEXT,
    "external_accounting_synced_at" TIMESTAMP(3),
    "recurring_invoice_id" TEXT,
    "receipt_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT DEFAULT 'card',
    "provider_payment_id" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "recorded_by" TEXT,
    "processor_fee" DOUBLE PRECISION DEFAULT 0,
    "evidence_url" TEXT,
    "evidence_mime_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT,
    "business_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "folder_path" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "max_hours_per_week" DOUBLE PRECISION DEFAULT 40,
    "hourly_rate" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "buffer_mins" INTEGER,
    "lead_time_mins" INTEGER,
    "source_product_id" TEXT,
    "business_id" TEXT NOT NULL,
    "invoice_timing" TEXT,
    "deposit_required" BOOLEAN NOT NULL DEFAULT false,
    "deposit_type" TEXT,
    "deposit_value" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availabilities" (
    "id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,

    CONSTRAINT "availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "staff_id" TEXT,
    "org_unit_id" TEXT,
    "invoice_id" TEXT,
    "deposit_invoice_id" TEXT,
    "payment_status" TEXT NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "location" TEXT,
    "location_place_id" TEXT,
    "location_lat_lng" JSONB,
    "calendar_event_id" TEXT,
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_connections" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platform_id" TEXT,
    "account_name" TEXT,
    "profile_picture" TEXT,
    "token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(3),
    "scopes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "media_urls" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "channel_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publish_results" JSONB,
    "external_post_id" TEXT,
    "external_url" TEXT,
    "last_error" TEXT,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_connections" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "account_email" TEXT,
    "token" TEXT,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(3),
    "scopes" TEXT,
    "provider_meta" JSONB,
    "healthState" TEXT NOT NULL DEFAULT 'Connected',
    "health_message" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_destinations" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platform_id" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "destination_meta" JSONB,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_content" (
    "id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'social_post',
    "subject" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "scheduled_at" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/Port_of_Spain',
    "published_at" TIMESTAMP(3),
    "content_meta" JSONB,
    "business_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outbound_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_variants" (
    "id" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "text_body" TEXT,
    "html_body" TEXT,
    "media_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variant_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_deliveries" (
    "id" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "destination_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "external_post_id" TEXT,
    "external_url" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "next_retry_at" TIMESTAMP(3),
    "result_snapshot" JSONB,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_events" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status_before" TEXT,
    "status_after" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "result_data" JSONB,
    "attempt_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "display_name" TEXT,
    "contact_id" TEXT,
    "last_message_at" TIMESTAMP(3),
    "last_message_snippet" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "whatsapp_contact_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT,
    "template_name" TEXT,
    "template_language" TEXT,
    "template_params" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "wamid" TEXT,
    "destination_id" TEXT,
    "delivery_id" TEXT,
    "error_message" TEXT,
    "media_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_engagements" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "post_id" TEXT,
    "external_id" TEXT,
    "from_user_id" TEXT,
    "from_user_name" TEXT,
    "content" TEXT,
    "ai_handled" BOOLEAN NOT NULL DEFAULT false,
    "ai_response" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "business_id" TEXT NOT NULL,
    "action_data" JSONB,
    "condition" TEXT,
    "last_run_at" TIMESTAMP(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_module_workflows" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "workflow_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "last_run_at" TIMESTAMP(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_module_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_agent_jobs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "icon" TEXT,
    "tone" TEXT,
    "data" JSONB,
    "contact_id" TEXT,
    "category" TEXT,
    "actor_type" TEXT,
    "actor_id" TEXT,
    "status" TEXT,
    "priority" TEXT,
    "revenue_impact" DOUBLE PRECISION,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "color" TEXT,
    "hourly_rate" DOUBLE PRECISION,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "budget_amount" DOUBLE PRECISION,
    "budget_hours" DOUBLE PRECISION,
    "business_id" TEXT NOT NULL,
    "goal_id" TEXT,
    "contact_id" TEXT,
    "invoice_id" TEXT,
    "booking_id" TEXT,
    "due_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "due_date" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "assignee_id" TEXT,
    "status" "ProjectTaskStatus" NOT NULL DEFAULT 'TODO',
    "position" INTEGER NOT NULL DEFAULT 0,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "estimated_hours" DOUBLE PRECISION,
    "tracked_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "project_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "evidence_required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "description" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "hourly_rate" DOUBLE PRECISION,
    "user_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "project_id" TEXT,
    "task_id" TEXT,
    "invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "task_titles" JSONB NOT NULL,
    "business_id" TEXT NOT NULL,
    "product_id" TEXT,

    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_plans" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "ai_plan_id" TEXT,
    "goal_id" TEXT,
    "project_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "user_idea" TEXT NOT NULL,
    "strategy_summary" TEXT,
    "estimated_total_hours" DOUBLE PRECISION,
    "estimated_budget" DOUBLE PRECISION,
    "estimated_people" INTEGER,
    "estimated_duration_days" INTEGER,
    "risk_analysis" JSONB,
    "swot_analysis" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_plan_events" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "execution_context" TEXT NOT NULL,
    "automation_tool" TEXT,
    "tool_payload" JSONB,
    "auto_execute" BOOLEAN NOT NULL DEFAULT false,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "manual_instructions" TEXT,
    "manual_evidence_required" BOOLEAN NOT NULL DEFAULT false,
    "estimated_hours" DOUBLE PRECISION,
    "estimated_start" TIMESTAMP(3),
    "estimated_end" TIMESTAMP(3),
    "depends_on" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimated_cost" DOUBLE PRECISION,
    "project_task_id" TEXT,
    "project_milestone_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "impact_analysis" JSONB,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_plan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "assigned_to_id" TEXT,
    "org_unit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "site_data" JSONB,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopilot_tasks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "auto_executable" BOOLEAN NOT NULL DEFAULT false,
    "executed_at" TIMESTAMP(3),
    "executed_by" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approval_data" JSONB,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "scheduled_for" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "related_type" TEXT,
    "related_id" TEXT,
    "ai_context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autopilot_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegation_loops" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "loop_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "risk_tier" INTEGER NOT NULL DEFAULT 2,
    "config" JSONB DEFAULT '{}',
    "stats" JSONB DEFAULT '{}',
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "interval_min" INTEGER NOT NULL DEFAULT 360,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delegation_loops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegation_loop_runs" (
    "id" TEXT NOT NULL,
    "loop_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "items_scanned" INTEGER NOT NULL DEFAULT 0,
    "items_matched" INTEGER NOT NULL DEFAULT 0,
    "actions_created" INTEGER NOT NULL DEFAULT 0,
    "actions_blocked" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB DEFAULT '[]',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegation_loop_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notification_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "type" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "recipient_name" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "message_id" TEXT,
    "error" TEXT,
    "template_data" JSONB,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "price_monthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trial_ends_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "gateway" TEXT,
    "gateway_sub_id" TEXT,
    "gateway_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "method" TEXT NOT NULL,
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "reference" TEXT,
    "notes" TEXT,
    "gateway" TEXT,
    "gateway_txn_id" TEXT,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'gpt-5.2',
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credits_used" INTEGER NOT NULL DEFAULT 1,
    "latency_ms" INTEGER,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "fallback_provider" TEXT,
    "error_code" TEXT,
    "task_category" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_alerts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "threshold" INTEGER,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,

    CONSTRAINT "ai_usage_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "business_id" TEXT NOT NULL,
    "chart_of_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "tax_amount" DOUBLE PRECISION DEFAULT 0,
    "tax_rate_id" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor" TEXT,
    "receipt_url" TEXT,
    "notes" TEXT,
    "payment_method" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurring_frequency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "due_date" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "items" JSONB,
    "category_id" TEXT,
    "project_id" TEXT,
    "contact_id" TEXT,
    "service_id" TEXT,
    "recurring_expense_id" TEXT,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_expenses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "next_run_date" TIMESTAMP(3) NOT NULL,
    "last_run_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_failure_at" TIMESTAMP(3),
    "last_error" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "vendor" TEXT,
    "payment_method" TEXT,
    "notes" TEXT,
    "creates_bill" BOOLEAN NOT NULL DEFAULT false,
    "due_offset_days" INTEGER,
    "category_id" TEXT,
    "project_id" TEXT,
    "contact_id" TEXT,
    "service_id" TEXT,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "dn_number" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "delivered_at" TIMESTAMP(3),
    "deliverer_name" TEXT,
    "deliverer_signature" TEXT,
    "receiver_name" TEXT,
    "receiver_signature" TEXT,
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "gr_number" TEXT NOT NULL,
    "purchase_order_id" TEXT,
    "supplier_name" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "count_number" TEXT NOT NULL,
    "count_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counted_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "payment_method" TEXT NOT NULL,
    "received_from" TEXT,
    "received_by" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_budgets" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "alert_at" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "rollover" BOOLEAN NOT NULL DEFAULT false,
    "category_id" TEXT,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "next_run_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_generated_at" TIMESTAMP(3),
    "generated_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "contact_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_failure_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "segment_filter" JSONB,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_briefings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "delivery_rate" DOUBLE PRECISION,
    "open_rate" DOUBLE PRECISION,
    "click_rate" DOUBLE PRECISION,
    "bounce_rate" DOUBLE PRECISION,
    "historical_avg_open_rate" DOUBLE PRECISION,
    "historical_avg_click_rate" DOUBLE PRECISION,
    "performance_vs_avg" TEXT,
    "insights" JSONB,
    "recommendations" JSONB,
    "audience_health" JSONB,
    "send_time_analysis" JSONB,
    "ai_briefing" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaign_contacts" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "bounced_at" TIMESTAMP(3),
    "business_id" TEXT NOT NULL,

    CONSTRAINT "email_campaign_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_forms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "settings" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "embed_code" TEXT,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lead_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_form_mappings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "form_title" TEXT,
    "field_mappings" JSONB NOT NULL DEFAULT '[]',
    "opportunity_defaults" JSONB,
    "auto_create" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_response_time" TIMESTAMP(3),
    "last_backfill_at" TIMESTAMP(3),
    "responses_processed" INTEGER NOT NULL DEFAULT 0,
    "contacts_created" INTEGER NOT NULL DEFAULT 0,
    "opportunities_created" INTEGER NOT NULL DEFAULT 0,
    "processed_response_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_form_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_form_submissions" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "contact_id" TEXT,
    "source" TEXT,
    "ip_address" TEXT,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "industry" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_template_usages" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_template_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_pages" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'default',
    "sections" JSONB NOT NULL,
    "settings" JSONB,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'BEGINNER',
    "duration" INTEGER,
    "lessons" JSONB NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "is_free" BOOLEAN NOT NULL DEFAULT true,
    "price" DOUBLE PRECISION,
    "business_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_enrollments" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "progress" JSONB,
    "completed_at" TIMESTAMP(3),
    "certificate_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohorts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "max_members" INTEGER NOT NULL DEFAULT 10,
    "industry" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "business_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohort_members" (
    "id" TEXT NOT NULL,
    "cohort_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohort_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_posts" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DISCUSSION',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "likes" INTEGER NOT NULL DEFAULT 0,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "matched_providers" JSONB,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_comments" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "community_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_connections" (
    "id" TEXT NOT NULL,
    "from_business_id" TEXT NOT NULL,
    "to_business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FOLLOW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endorsements" (
    "id" TEXT NOT NULL,
    "from_business_id" TEXT NOT NULL,
    "to_business_id" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "endorsements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "participant_a_id" TEXT NOT NULL,
    "participant_b_id" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_business_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_requests" (
    "id" TEXT NOT NULL,
    "from_business_id" TEXT NOT NULL,
    "to_business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'COLLABORATION',
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collaboration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_notifications" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_feedback" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "target_business_id" TEXT NOT NULL,
    "feedback" TEXT NOT NULL,
    "match_score" INTEGER,
    "match_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_insight_dismissals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "target_business_id" TEXT NOT NULL,
    "dismissed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozed_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationship_insight_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Webhook',
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "market_reach" TEXT NOT NULL DEFAULT 'LOCAL',
    "countries" TEXT[],
    "regions" TEXT[],
    "fulfillment_strategy" TEXT NOT NULL DEFAULT 'LOCAL_STOCK',
    "supplier_name" TEXT,
    "supplier_email" TEXT,
    "supplier_phone" TEXT,
    "supplier_country" TEXT,
    "deposit_percent" DOUBLE PRECISION,
    "pricing_overrides" JSONB,
    "shipping_enabled" BOOLEAN NOT NULL DEFAULT true,
    "digital_delivery" BOOLEAN NOT NULL DEFAULT false,
    "hs_code" TEXT,
    "origin_country" TEXT,
    "weight" DOUBLE PRECISION,
    "weight_unit" TEXT DEFAULT 'kg',
    "dimensions" JSONB,
    "min_order_qty" INTEGER NOT NULL DEFAULT 1,
    "max_order_qty" INTEGER,
    "lead_time_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_routes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "listing_id" TEXT,
    "strategy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source_type" TEXT,
    "warehouse_id" TEXT,
    "purchase_order_id" TEXT,
    "pre_order_id" TEXT,
    "shipment_id" TEXT,
    "source_link_id" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillment_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT[],
    "regions" TEXT[],
    "base_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "per_kg_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "free_above" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "estimated_days" INTEGER,
    "carrier" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "type" TEXT NOT NULL DEFAULT 'STORAGE',
    "capacity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stocks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "reorder_at" INTEGER,
    "cost_per_unit" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "product_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'ADJUSTMENT',
    "quantity_change" INTEGER NOT NULL,
    "reason_code" TEXT,
    "note" TEXT,
    "reference_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_orders" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'placed',
    "type" TEXT NOT NULL DEFAULT 'STANDARD',
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "customer_country" TEXT,
    "shipping_address" JSONB,
    "billing_address" JSONB,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shipping_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duty_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "payment_status" TEXT NOT NULL DEFAULT 'UNPAID',
    "payment_method" TEXT,
    "payment_ref" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "promo_code_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',

    CONSTRAINT "marketplace_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "order_id" TEXT,
    "tracking_number" TEXT,
    "carrier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "origin_country" TEXT,
    "destination_country" TEXT,
    "destination_address" JSONB,
    "weight" DOUBLE PRECISION,
    "weight_unit" TEXT DEFAULT 'kg',
    "dimensions" JSONB,
    "shipping_cost" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "estimated_delivery" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "milestones" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customs_declarations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "declaration_type" TEXT NOT NULL DEFAULT 'EXPORT',
    "reference_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "hs_code" TEXT,
    "goods_description" TEXT,
    "origin_country" TEXT,
    "destination_country" TEXT,
    "declared_value" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "duty_rate" DOUBLE PRECISION,
    "duty_amount" DOUBLE PRECISION,
    "vat_amount" DOUBLE PRECISION,
    "total_charges" DOUBLE PRECISION,
    "documents" JSONB,
    "notes" TEXT,
    "filed_at" TIMESTAMP(3),
    "cleared_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customs_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_orders" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "deposit_amount" DOUBLE PRECISION,
    "deposit_paid" BOOLEAN NOT NULL DEFAULT false,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expected_date" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "supplier_name" TEXT NOT NULL,
    "supplier_email" TEXT,
    "supplier_phone" TEXT,
    "supplier_country" TEXT,
    "supplier_connection_id" TEXT,
    "items" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shipping_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "expected_delivery" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "payment_status" TEXT NOT NULL DEFAULT 'UNPAID',
    "po_paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sequences" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL,
    "graph" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sequence_enrollments" (
    "id" TEXT NOT NULL,
    "sequence_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "current_node_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "next_step_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "crm_sequence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_attributions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "sequence_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "attributed_value" DECIMAL(12,2),
    "currency" TEXT,
    "won_at" TIMESTAMP(3) NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL,
    "window_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequence_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_momentum" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "previous_score" INTEGER,
    "trend" TEXT NOT NULL DEFAULT 'stable',
    "recency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frequency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monetary_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagement_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenure_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_momentum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_momentum_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "trend" TEXT NOT NULL DEFAULT 'stable',
    "recency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frequency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monetary_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagement_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenure_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_momentum_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "momentum_recommendations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "draft_message" TEXT,
    "draft_subject" TEXT,
    "suggested_channel" TEXT,
    "trigger_reason" TEXT,
    "momentum_score" INTEGER,
    "snoozed_until" TIMESTAMP(3),
    "actioned_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "auto_executed" BOOLEAN NOT NULL DEFAULT false,
    "scheduled_for" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "momentum_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hashed_key" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_plans" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT 'Business Plan',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "intake" JSONB NOT NULL DEFAULT '{}',
    "model" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_plans_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "sales_profiles" (
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
CREATE TABLE "marketing_strategy_profiles" (
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
CREATE TABLE "people_profiles" (
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
CREATE TABLE "technology_profiles" (
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
CREATE TABLE "partnerships_profiles" (
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
CREATE TABLE "intellectual_property_profiles" (
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
CREATE TABLE "guidance_assessments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "business_type" TEXT,
    "business_stage" TEXT,
    "scores" JSONB,
    "flags" JSONB,
    "ai_summary" JSONB,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guidance_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guidance_recommendations" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT,
    "assessment_id" TEXT,
    "template_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "impact_level" TEXT,
    "urgency" TEXT DEFAULT 'planned',
    "rationale" TEXT,
    "suggested_action" TEXT,
    "estimated_difficulty" TEXT,
    "impact" TEXT DEFAULT 'MEDIUM',
    "effort" TEXT DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "action_url" TEXT,
    "score_value" INTEGER,
    "trigger_score_key" TEXT,
    "completed_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guidance_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmap_items" (
    "id" TEXT NOT NULL,
    "guidance_profile_id" TEXT,
    "assessment_id" TEXT,
    "title" TEXT,
    "description" TEXT,
    "category" TEXT,
    "sequence_order" INTEGER,
    "order_index" INTEGER,
    "action_title" TEXT,
    "why_it_matters" TEXT,
    "expected_outcome" TEXT,
    "linked_score_area" TEXT,
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

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "min_order_value" DOUBLE PRECISION,
    "max_uses" INTEGER,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_reviews" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT,
    "rating" INTEGER NOT NULL,
    "review_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "seller_response" TEXT,
    "order_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_profile_versions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "changed_by" TEXT,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'UNIVERSAL_CORE',
    "trigger" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "risk_tier" TEXT NOT NULL DEFAULT 'GREEN',
    "jurisdiction_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "required_profile_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conditional_questions" JSONB,
    "required_reviews" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "renewal_trigger" TEXT,
    "expiry_days" INTEGER,
    "linked_document_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brand_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "financial_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "legal_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "document_type_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "structure" JSONB NOT NULL,
    "system_prompt" TEXT,
    "tone_options" TEXT[] DEFAULT ARRAY['formal', 'friendly', 'premium']::TEXT[],
    "jurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_clauses" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "editable_mode" TEXT NOT NULL DEFAULT 'GUIDED',
    "risk_score" TEXT NOT NULL DEFAULT 'GREEN',
    "review_required" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "depends_on_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_clauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clause_variants" (
    "id" TEXT NOT NULL,
    "clause_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB,
    "risk_note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clause_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_instances" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "document_type_id" TEXT NOT NULL,
    "template_id" TEXT,
    "profile_version_id" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "health_status" TEXT NOT NULL DEFAULT 'CURRENT',
    "health_reason" TEXT,
    "current_version_num" INTEGER NOT NULL DEFAULT 1,
    "context_inputs" JSONB,
    "tone_settings" JSONB,
    "generation_meta" JSONB,
    "effective_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "drive_file_id" TEXT,
    "drive_file_name" TEXT,
    "drive_file_mime_type" TEXT,
    "drive_last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "section_snapshots" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approval_status" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "effective_date" TIMESTAMP(3),
    "superseded_date" TIMESTAMP(3),
    "created_by" TEXT,
    "change_notes" TEXT,
    "based_on_profile_version" INTEGER,
    "based_on_template_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sections" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "section_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_format" TEXT NOT NULL DEFAULT 'PLAIN',
    "content_source" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    "editable_mode" TEXT NOT NULL DEFAULT 'GUIDED',
    "depends_on_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risk_score" TEXT NOT NULL DEFAULT 'GREEN',
    "review_required" BOOLEAN NOT NULL DEFAULT false,
    "last_modified_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "selected_variant_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_change_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "instance_id" TEXT,
    "change_type" TEXT NOT NULL,
    "audit_level" TEXT NOT NULL DEFAULT 'CHANGE',
    "section_key" TEXT,
    "previous_value" TEXT,
    "new_value" TEXT,
    "changed_by" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_tasks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "section_key" TEXT,
    "review_type" TEXT NOT NULL,
    "assigned_to" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impact_rules" (
    "id" TEXT NOT NULL,
    "document_type_id" TEXT NOT NULL,
    "profile_field" TEXT NOT NULL,
    "impact_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT,
    "auto_update" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impact_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_standards" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "output_templates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "formality" TEXT NOT NULL DEFAULT 'medium',
    "targetLength" TEXT NOT NULL DEFAULT 'medium',
    "required_sections" JSONB NOT NULL DEFAULT '[]',
    "custom_instructions" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_system_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "output_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_submissions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budget" TEXT,
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qualification_journeys" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "session_id" TEXT,
    "customer_name" TEXT,
    "customer_email" TEXT,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "scores" JSONB,
    "recommended_product_ids" TEXT[],
    "selected_product_id" TEXT,
    "execution_model_chosen" TEXT,
    "quote_id" TEXT,
    "invoice_id" TEXT,
    "project_id" TEXT,
    "intake_id" TEXT,
    "intake_status" TEXT NOT NULL DEFAULT 'pending',
    "intake_data" JSONB,
    "intake_completed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'started',
    "source" TEXT NOT NULL DEFAULT 'guided_flow',
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qualification_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_sessions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_connections" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "credentials" JSONB,
    "account_meta" JSONB,
    "connection_health" TEXT NOT NULL DEFAULT 'unknown',
    "sync_capabilities" TEXT[],
    "last_sync_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "id" TEXT NOT NULL,
    "supplier_connection_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "normalized_title" TEXT,
    "normalized_description" TEXT,
    "normalized_price" DOUBLE PRECISION,
    "normalized_images" TEXT[],
    "availability" TEXT NOT NULL DEFAULT 'unknown',
    "lead_time_days" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_variants" (
    "id" TEXT NOT NULL,
    "supplier_product_id" TEXT NOT NULL,
    "external_variant_id" TEXT,
    "attributes" JSONB NOT NULL,
    "sku" TEXT,
    "price" DOUBLE PRECISION,
    "availability" TEXT NOT NULL DEFAULT 'unknown',
    "stock_qty" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "sku" TEXT,
    "price_override" DOUBLE PRECISION,
    "image_url" TEXT,
    "track_stock" BOOLEAN NOT NULL DEFAULT false,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_source_links" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "supplier_product_id" TEXT NOT NULL,
    "source_cost" DOUBLE PRECISION,
    "lead_time_days" INTEGER,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "shipping_assumptions" JSONB,
    "availability_state" TEXT NOT NULL DEFAULT 'available',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_source_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_cost_profiles" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "source_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shipping_estimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duties_estimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "packaging_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transaction_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "landed_cost_estimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gross_margin" DOUBLE PRECISION,
    "margin_band" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_cost_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "margin_snapshots" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "source_cost" DOUBLE PRECISION NOT NULL,
    "selling_price" DOUBLE PRECISION NOT NULL,
    "landed_cost_estimate" DOUBLE PRECISION NOT NULL,
    "gross_margin" DOUBLE PRECISION NOT NULL,
    "margin_band" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "snapshot_reason" TEXT,
    "invoice_id" TEXT,
    "order_id" TEXT,
    "quantity" DOUBLE PRECISION,
    "gross_profit" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "margin_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_execution_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "tool_name" TEXT,
    "module" TEXT,
    "risk_tier" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL DEFAULT 'assisted',
    "actor" TEXT NOT NULL DEFAULT 'user',
    "rationale" TEXT,
    "input_summary" JSONB,
    "output_summary" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "plan_id" TEXT,
    "plan_step_id" TEXT,
    "tool_result" JSONB,
    "next_step_suggested" JSONB,
    "replan_required" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" TEXT,
    "command_id" TEXT,
    "correlation_id" TEXT,

    CONSTRAINT "ai_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_approval_items" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "risk_tier" INTEGER NOT NULL DEFAULT 2,
    "tool_name" TEXT NOT NULL,
    "module" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rationale" TEXT,
    "expected_benefit" TEXT,
    "risks" TEXT,
    "input_payload" JSONB,
    "affected_entities" JSONB,
    "plan_id" TEXT,
    "plan_step_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolved_by_user_id" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "correlation_id" TEXT,
    "migrated_to_proposal_id" TEXT,

    CONSTRAINT "ai_approval_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopilot_settings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "autonomy_level" INTEGER NOT NULL DEFAULT 0,
    "approved_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_daily_auto_actions" INTEGER NOT NULL DEFAULT 10,
    "approval_timeout_hours" INTEGER NOT NULL DEFAULT 24,
    "notify_on_auto_action" BOOLEAN NOT NULL DEFAULT true,
    "learning_enabled" BOOLEAN NOT NULL DEFAULT true,
    "slack_webhook_url" TEXT,
    "briefing_enabled" BOOLEAN NOT NULL DEFAULT true,
    "briefing_time" TEXT NOT NULL DEFAULT '06:00',
    "briefing_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "briefing_modules" TEXT[] DEFAULT ARRAY['commerce', 'crm', 'bookings', 'projects']::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autopilot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_autonomy_profiles" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "global_kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "max_daily_auto_actions" INTEGER NOT NULL DEFAULT 10,
    "max_daily_spend_ttd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "max_tier_without_approval" INTEGER NOT NULL DEFAULT 3,
    "notify_on_block" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_autonomy_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomy_daily_spends" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount_ttd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autonomy_daily_spends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomy_daily_action_counts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "action_type" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autonomy_daily_action_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "request_hash" TEXT,
    "response" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saga_executions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "saga_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "correlation_id" TEXT,
    "command_id" TEXT,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "saga_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saga_steps" (
    "id" TEXT NOT NULL,
    "saga_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "compensation_action" JSONB,
    "compensation_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "saga_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_goals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "target_date" TIMESTAMP(3),
    "parent_goal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_plan_results" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "goal_achievement_score" INTEGER,
    "user_feedback" TEXT,
    "business_impact_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,

    CONSTRAINT "ai_plan_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_cortex_trigger_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "filter_json" JSONB,
    "goal_template_id" TEXT,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_daily_firings" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_cortex_trigger_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_outcome_scores" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "approval_count" INTEGER NOT NULL DEFAULT 0,
    "avg_execution_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_outcome_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_variants" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "variant_key" TEXT NOT NULL,
    "prompt_template" TEXT NOT NULL,
    "selection_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authority_grants" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "grantor_id" TEXT NOT NULL,
    "grantee_type" TEXT NOT NULL,
    "grantee_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "max_amount" DOUBLE PRECISION,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authority_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomy_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "action_key" TEXT,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autonomy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomy_verdicts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "action_key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "requires_approval" BOOLEAN NOT NULL,
    "tier" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "rule_trace" JSONB NOT NULL,
    "outcome" TEXT,
    "proposal_id" TEXT,
    "context_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autonomy_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_cortex_memories" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'inferred',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "access_count" INTEGER NOT NULL DEFAULT 1,
    "last_accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_cortex_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cognitive_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cognitive_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "value_constraints" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "value_key" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'feedback',
    "examples" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "value_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_url" TEXT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_triggers" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event_pattern" TEXT NOT NULL,
    "condition" JSONB,
    "objective" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_execute" BOOLEAN NOT NULL DEFAULT false,
    "max_risk_tier" INTEGER NOT NULL DEFAULT 2,
    "schedule" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sender_agent_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_actions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMP(3),
    "snoozed_until" TIMESTAMP(3),
    "related_type" TEXT,
    "related_id" TEXT,
    "amount_at_risk" DOUBLE PRECISION,
    "recommendation" JSONB,
    "completed_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_items" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source_module" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "urgency" INTEGER NOT NULL DEFAULT 50,
    "impact_score" INTEGER NOT NULL DEFAULT 0,
    "expected_value" DECIMAL(18,4),
    "currency" TEXT,
    "riskTier" INTEGER NOT NULL DEFAULT 1,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "executable_by_key" BOOLEAN NOT NULL DEFAULT false,
    "execution_tool" TEXT,
    "execution_payload" JSONB,
    "recommended_by" TEXT,
    "owner_type" TEXT,
    "owner_id" TEXT,
    "contact_id" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "due_at" TIMESTAMP(3),
    "snoozed_until" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_action_items" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL DEFAULT '',
    "entity_id" TEXT NOT NULL DEFAULT '',
    "recommended_action" TEXT,
    "evidence" JSONB,
    "amount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution" TEXT,
    "mirrored_action_id" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyflow_notes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "target_label" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "ai_brief" TEXT,
    "author_id" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keyflow_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_memories" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'user',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_memory_embeddings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_memory_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_plans" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "objective" TEXT NOT NULL,
    "raw_input" TEXT,
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "scope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_risk_tier" INTEGER NOT NULL DEFAULT 1,
    "role" TEXT,
    "journey_instance_id" TEXT,
    "goal_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_matches" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "target_business_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "explanation" TEXT NOT NULL DEFAULT '',
    "match_type" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_plan_steps" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tool_name" TEXT,
    "module" TEXT,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "risk_tier" INTEGER NOT NULL DEFAULT 1,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT,
    "journey_step_index" INTEGER,
    "depends_on" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "input_payload" JSONB,
    "output_result" JSONB,
    "expected_benefit" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_plan_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_instances" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "trigger_event" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "plan_id" TEXT,
    "steps" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_threads" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "channel" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigned_role" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "raw_payload" JSONB,
    "role" TEXT,
    "intent" TEXT,
    "sentiment" TEXT,
    "ai_draft" BOOLEAN NOT NULL DEFAULT false,
    "ai_approved" BOOLEAN NOT NULL DEFAULT false,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_goals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "target_value" DOUBLE PRECISION,
    "current_value" DOUBLE PRECISION,
    "unit" TEXT,
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "role" TEXT,
    "auto_actions" BOOLEAN NOT NULL DEFAULT true,
    "actions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_quote_requests" (
    "id" TEXT NOT NULL,
    "from_business_id" TEXT NOT NULL,
    "to_business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budget_min" DOUBLE PRECISION,
    "budget_max" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "timeline" TEXT,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "response_note" TEXT,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_referrals" (
    "id" TEXT NOT NULL,
    "from_business_id" TEXT NOT NULL,
    "to_business_id" TEXT NOT NULL,
    "referred_to_name" TEXT NOT NULL,
    "referred_to_email" TEXT,
    "referred_to_phone" TEXT,
    "opportunity" TEXT NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "status_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_collaborations" (
    "id" TEXT NOT NULL,
    "from_business_id" TEXT NOT NULL,
    "to_business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SUBCONTRACTING',
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "proposed_terms" TEXT,
    "timeline" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "response_note" TEXT,
    "project_id" TEXT,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_collaborations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_messages" (
    "id" TEXT NOT NULL,
    "from_business_id" TEXT NOT NULL,
    "to_business_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "content" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_businesses" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "saved_business_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_reviews" (
    "id" TEXT NOT NULL,
    "reviewer_business_id" TEXT NOT NULL,
    "reviewee_business_id" TEXT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "quality_rating" INTEGER,
    "communication_rating" INTEGER,
    "timeliness_rating" INTEGER,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_reputation" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "average_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "total_completed" INTEGER NOT NULL DEFAULT 0,
    "completed_quotes" INTEGER NOT NULL DEFAULT 0,
    "completed_collabs" INTEGER NOT NULL DEFAULT 0,
    "completed_referrals" INTEGER NOT NULL DEFAULT 0,
    "on_time_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "response_time_hours" DOUBLE PRECISION,
    "repeat_client_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "referrals_sent" INTEGER NOT NULL DEFAULT 0,
    "referrals_converted" INTEGER NOT NULL DEFAULT 0,
    "referrals_received" INTEGER NOT NULL DEFAULT 0,
    "referrals_accepted" INTEGER NOT NULL DEFAULT 0,
    "reputation_score" INTEGER NOT NULL DEFAULT 0,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "last_calculated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_reputation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_opportunities" (
    "id" TEXT NOT NULL,
    "poster_business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PROJECT',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "skills_required" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budget_min" DOUBLE PRECISION,
    "budget_max" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "timeline" TEXT,
    "location" TEXT,
    "remote_ok" BOOLEAN NOT NULL DEFAULT true,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "awarded_to_business_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "community_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_opportunity_applications" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "applicant_business_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "proposed_budget" DOUBLE PRECISION,
    "proposed_timeline" TEXT,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "response_note" TEXT,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_opportunity_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_partner_programs" (
    "id" TEXT NOT NULL,
    "initiator_business_id" TEXT NOT NULL,
    "partner_business_id" TEXT NOT NULL,
    "programType" TEXT NOT NULL DEFAULT 'REFERRAL',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "terms" JSONB,
    "commission_rate" DOUBLE PRECISION,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "response_note" TEXT,
    "accepted_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_partner_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_profile_views" (
    "id" TEXT NOT NULL,
    "viewer_business_id" TEXT,
    "viewed_business_id" TEXT NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_profile_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_network_activities" (
    "id" TEXT NOT NULL,
    "actor_business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_network_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_resource_downloads" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "downloader_business_id" TEXT NOT NULL,
    "price_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_resource_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestion_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "target_business_id" TEXT,
    "event_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "score" INTEGER,
    "match_type" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_pages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "page_type" TEXT NOT NULL,
    "title" TEXT,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "h1" TEXT,
    "word_count" INTEGER,
    "indexing_status" TEXT NOT NULL DEFAULT 'unknown',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "organic_sessions" INTEGER NOT NULL DEFAULT 0,
    "bounce_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_session_duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "product_id" TEXT,
    "service_id" TEXT,
    "last_crawled" TIMESTAMP(3),
    "last_synced" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_keywords" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "page_id" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_tracked" BOOLEAN NOT NULL DEFAULT true,
    "search_volume" INTEGER,
    "difficulty" INTEGER,
    "current_position" DOUBLE PRECISION,
    "previous_position" DOUBLE PRECISION,
    "best_position" DOUBLE PRECISION,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trend" TEXT NOT NULL DEFAULT 'stable',
    "position_change" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "last_updated" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_snapshots" (
    "id" TEXT NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "page_id" TEXT,
    "position" DOUBLE PRECISION NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_issues" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "issue_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "page_url" TEXT,
    "keyword" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "impact" TEXT,
    "recommendation" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_briefs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "page_id" TEXT,
    "title" TEXT NOT NULL,
    "target_keyword" TEXT NOT NULL,
    "secondary_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content_type" TEXT NOT NULL DEFAULT 'article',
    "search_intent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "outline" JSONB,
    "suggested_meta_title" TEXT,
    "suggested_meta_description" TEXT,
    "recommended_word_count" INTEGER,
    "call_to_action" TEXT,
    "competitor_angle" TEXT,
    "internal_link_suggestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content_gap_source" TEXT,
    "approval_status" TEXT NOT NULL DEFAULT 'pending',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "content_request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_journeys" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'AWARENESS',
    "first_touch_at" TIMESTAMP(3),
    "last_touch_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "first_touch_channel" TEXT,
    "first_touch_source" TEXT,
    "first_touch_campaign" TEXT,
    "last_touch_channel" TEXT,
    "last_touch_source" TEXT,
    "last_touch_campaign" TEXT,
    "touchpoint_count" INTEGER NOT NULL DEFAULT 0,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "total_revenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "conversion_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "days_to_conversion" INTEGER,
    "momentum" INTEGER NOT NULL DEFAULT 0,
    "health_score" INTEGER NOT NULL DEFAULT 50,
    "risk_level" TEXT NOT NULL DEFAULT 'none',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_touchpoints" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "campaign_id" TEXT,
    "campaign_name" TEXT,
    "content_id" TEXT,
    "touchpoint_type" TEXT NOT NULL,
    "stage_hint" TEXT,
    "value" DECIMAL(12,2),
    "currency" TEXT DEFAULT 'TTD',
    "metadata" JSONB,
    "first_touch_weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "last_touch_weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "linear_weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_touchpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribution_results" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "dimension_key" TEXT NOT NULL,
    "dimension_label" TEXT,
    "model" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "attributed_revenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "touchpoints" INTEGER NOT NULL DEFAULT 0,
    "unique_contacts" INTEGER NOT NULL DEFAULT 0,
    "cost_spent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "roas" DOUBLE PRECISION,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_insights" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "insight_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "recommendation" TEXT,
    "rationale" TEXT,
    "suggested_action" TEXT,
    "source" TEXT NOT NULL DEFAULT 'heuristic',
    "estimated_impact" DECIMAL(12,2),
    "impact_currency" TEXT DEFAULT 'TTD',
    "action_label" TEXT,
    "action_route" TEXT,
    "dimension" TEXT,
    "dimension_key" TEXT,
    "metrics" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "acknowledged_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "hit_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_blueprints" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "identity" JSONB NOT NULL DEFAULT '{}',
    "operating_model" JSONB NOT NULL DEFAULT '{}',
    "goals" JSONB NOT NULL DEFAULT '{}',
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "brand" JSONB NOT NULL DEFAULT '{}',
    "customer_model" JSONB NOT NULL DEFAULT '{}',
    "financials" JSONB NOT NULL DEFAULT '{}',
    "intelligence" JSONB NOT NULL DEFAULT '{}',
    "workflow_model" JSONB,
    "ai_preferences" JSONB,
    "founder_profile" JSONB,
    "legal_profile" JSONB,
    "registration_profile" JSONB,
    "tax_profile" JSONB,
    "ownership_profile" JSONB,
    "market_profile" JSONB,
    "offer_architecture" JSONB,
    "sales_system" JSONB,
    "marketing_system" JSONB,
    "operations_system" JSONB,
    "projection_profile" JSONB,
    "risk_profile" JSONB,
    "compliance_profile" JSONB,
    "execution_roadmap" JSONB,
    "document_profile" JSONB,
    "readiness_score" INTEGER NOT NULL DEFAULT 0,
    "confidence_scores" JSONB DEFAULT '{}',
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "last_analyzed_at" TIMESTAMP(3),
    "genome_integrity" INTEGER,
    "genome_dna_scores" JSONB DEFAULT '{}',
    "genome_dna_confidence" JSONB DEFAULT '{}',
    "genome_stage" TEXT,
    "genesis_completed" BOOLEAN DEFAULT false,
    "constitution_version" INTEGER DEFAULT 1,
    "constitution_generated_at" TIMESTAMP(3),
    "last_genome_sync_at" TIMESTAMP(3),
    "business_assets" JSONB DEFAULT '{}',
    "executive_readiness_score" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_blueprints_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "coming_soon" BOOLEAN NOT NULL DEFAULT false,
    "bypass_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_audit_logs" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "email" TEXT,
    "user_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_audit_entries" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "contact_hash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL DEFAULT 'contact',
    "entity_id" TEXT,
    "actor" JSONB,
    "before" JSONB,
    "after" JSONB,
    "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_export_jobs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "token" TEXT NOT NULL,
    "json_key" TEXT NOT NULL,
    "zip_key" TEXT NOT NULL,
    "byte_size" INTEGER,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_downloads" INTEGER NOT NULL DEFAULT 1,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "last_downloaded_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_page_drafts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "preview_token" TEXT,
    "preview_expires_at" TIMESTAMP(3),
    "last_saved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_page_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_pages_published" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" TEXT,
    "unpublished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_pages_published_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_forget_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "contact_hash" TEXT,
    "requested_by_id" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purge_at" TIMESTAMP(3) NOT NULL,
    "purged_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "contact_forget_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_attributions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_detail" TEXT,
    "revenue_type" TEXT NOT NULL,
    "revenue_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "referral_contact_id" TEXT,
    "referral_code" TEXT,
    "visitor_id" TEXT,
    "campaign_id" TEXT,
    "staff_id" TEXT,
    "attribution_percent" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "edited_at" TIMESTAMP(3),
    "edited_by" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_cost_entries" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "staff_id" TEXT,
    "user_id" TEXT,
    "minutes" INTEGER NOT NULL,
    "cost_rate" DOUBLE PRECISION,
    "cost_amount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_conversion_daily" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL DEFAULT '',
    "views" INTEGER NOT NULL DEFAULT 0,
    "cart_adds" INTEGER NOT NULL DEFAULT 0,
    "checkouts" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "bookings" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_conversion_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_visitor_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "type" TEXT NOT NULL,
    "source_detail" TEXT,
    "referral_code" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "identified_at" TIMESTAMP(3),

    CONSTRAINT "public_visitor_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "session_id" TEXT,
    "contact_id" TEXT,
    "type" TEXT NOT NULL,
    "path" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ip_hash" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_visitors" (
    "business_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "first_source" TEXT,
    "first_medium" TEXT,
    "first_campaign" TEXT,
    "first_referrer" TEXT,
    "first_path" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contact_id" TEXT,

    CONSTRAINT "public_visitors_pkey" PRIMARY KEY ("business_id","visitor_id")
);

-- CreateTable
CREATE TABLE "presence_insight_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "window_days" INTEGER NOT NULL DEFAULT 30,
    "payload" JSONB NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "narrative_source" TEXT,
    "model_used" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presence_insight_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presence_daily_stats" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "dim_key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "uniques" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presence_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "chart_of_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "opening_balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "current_balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "institution" TEXT,
    "account_last4" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "system_key" TEXT,
    "parent_id" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "contact_id" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "external_ref" TEXT,
    "reversal_of_id" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "posted_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "date" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "locked_by_reconciliation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "reference" TEXT,
    "matched_transaction_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "rawData" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "statement_balance" DECIMAL(18,4) NOT NULL,
    "system_balance" DECIMAL(18,4) NOT NULL,
    "difference" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_liabilities" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "taxable_sales" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_collected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_paid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount_due" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "amends_tax_liability_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_amendment" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_liabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(8,4) NOT NULL,
    "type" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "pattern" TEXT NOT NULL,
    "match_type" TEXT NOT NULL DEFAULT 'contains',
    "account_id" TEXT NOT NULL,
    "expense_category_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_journal_entries" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" TEXT NOT NULL,
    "next_run_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "entries" JSONB NOT NULL,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_run_date" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "credit_note_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "items" JSONB,
    "applied_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "reversal_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "locked_transaction_stamp" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_connections" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "financial_account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_item_id" TEXT,
    "access_token" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at" TIMESTAMP(3),
    "last_sync_cursor" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "purchase_cost" DECIMAL(18,4) NOT NULL,
    "salvage_value" DECIMAL(18,4),
    "useful_life_months" INTEGER NOT NULL,
    "depreciation_method" TEXT NOT NULL DEFAULT 'straight_line',
    "accumulated_depreciation" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net_book_value" DECIMAL(18,4) NOT NULL,
    "disposal_date" TIMESTAMP(3),
    "disposal_proceeds" DECIMAL(18,4),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_document_templates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "preview_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_commands" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "raw_input" TEXT NOT NULL,
    "input_mode" TEXT NOT NULL DEFAULT 'TEXT',
    "intent" JSONB NOT NULL DEFAULT '{}',
    "grounded_data" JSONB,
    "plan_summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "risk_level" TEXT NOT NULL DEFAULT 'LOW',
    "autonomy_level" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL DEFAULT 'do',
    "execution_result" JSONB,
    "execution_logs" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "session_id" TEXT,
    "correlation_id" TEXT,

    CONSTRAINT "key_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "user_prompt" TEXT NOT NULL,
    "interpreted_need" JSONB NOT NULL DEFAULT '{}',
    "recommended_packages" JSONB NOT NULL DEFAULT '{}',
    "brief" JSONB NOT NULL DEFAULT '{}',
    "estimated_budget" JSONB,
    "priority" TEXT,
    "internal_notes" TEXT,
    "supplier_connection_id" TEXT,
    "purchase_order_id" TEXT,
    "po_issued_at" TIMESTAMP(3),
    "vendor_acknowledged_at" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "invoiced_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "event_type" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "evidence_ids" TEXT[],
    "message_ids" TEXT[],
    "approval_id" TEXT,
    "risk_score" INTEGER,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" TEXT,
    "command_id" TEXT,
    "correlation_id" TEXT,

    CONSTRAINT "business_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "submitted_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "linked_type" TEXT NOT NULL,
    "linked_id" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignments" (
    "id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "assignable_type" TEXT NOT NULL,
    "assignable_id" TEXT NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content_types" TEXT[],
    "business_goal" TEXT NOT NULL,
    "target_audience" TEXT,
    "offer" TEXT,
    "product_or_service" TEXT,
    "branch" TEXT,
    "tone" TEXT,
    "due_date" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "required_inputs" TEXT[],
    "attached_asset_ids" TEXT[],
    "assigned_team_member_ids" TEXT[],
    "google_drive_folder_id" TEXT,
    "delivery_file_ids" TEXT[],
    "approval_required" BOOLEAN NOT NULL DEFAULT true,
    "approved_by" TEXT,
    "estimated_hours" DOUBLE PRECISION,
    "invoice_on_delivery" BOOLEAN NOT NULL DEFAULT false,
    "invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_delivery_packages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "content_request_id" TEXT NOT NULL,
    "destination_type" TEXT NOT NULL DEFAULT 'google_drive',
    "destination_folder_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "uploaded_by" TEXT NOT NULL,
    "uploaded_file_ids" TEXT[],
    "user_notified" BOOLEAN NOT NULL DEFAULT false,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_delivery_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "task_id" TEXT,
    "caller_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration" INTEGER,
    "outcome" TEXT,
    "notes" TEXT,
    "script" TEXT,
    "recording_url" TEXT,
    "evidence_ids" TEXT[],
    "follow_up_task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "threshold" DOUBLE PRECISION,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "migrated_to_proposal_id" TEXT,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL,
    "approval_request_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "approver_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "delegated_to" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision" TEXT,
    "comment" TEXT,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "tags" TEXT[],
    "folder" TEXT NOT NULL DEFAULT 'uncategorized',
    "permissions" TEXT NOT NULL DEFAULT 'team',
    "uploaded_by" TEXT NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION,
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "invoice_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retainer_agreements" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_amount" DOUBLE PRECISION NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "included_hours" DOUBLE PRECISION,
    "rollover_hours" BOOLEAN NOT NULL DEFAULT false,
    "rollover_cap" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retainer_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retainer_periods" (
    "id" TEXT NOT NULL,
    "retainer_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "hours_used" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hours_billed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount_billed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retainer_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_access" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "last_accessed_at" TIMESTAMP(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_orders" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "original_scope" TEXT,
    "new_scope" TEXT,
    "additional_amount" DOUBLE PRECISION,
    "additional_hours" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_entity_links" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "from_type" TEXT NOT NULL,
    "from_id" TEXT NOT NULL,
    "to_type" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "strength" INTEGER NOT NULL DEFAULT 50,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_entity_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_risks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "likelihood" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "owner_id" TEXT,
    "mitigation" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_reserve_buckets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "target_amount" DECIMAL(18,4),
    "current_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_reserve_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_templates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "trigger_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "steps" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "template_id" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "context" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_documents" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sop_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaign_plans" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "audience" TEXT,
    "offer" TEXT,
    "channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "budget" DECIMAL(18,4),
    "expected_revenue" DECIMAL(18,4),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_campaign_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_initiatives" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "goal_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "owner_id" TEXT,
    "expected_impact" DECIMAL(18,4),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_signals" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "contact_id" TEXT,
    "score" INTEGER,
    "value" DECIMAL(18,4),
    "currency" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "business_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_health_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_providers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "auth_type" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "display_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "auth_data_ref" TEXT,
    "auth_data" JSONB,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "health_score" INTEGER NOT NULL DEFAULT 100,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_object_maps" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "external_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "internal_type" TEXT NOT NULL,
    "internal_id" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "data_hash" TEXT,

    CONSTRAINT "external_object_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "business_id" TEXT,
    "session_id" TEXT,
    "event_name" TEXT NOT NULL,
    "module" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "business_id" TEXT,
    "module" TEXT,
    "page" TEXT,
    "feedback_type" TEXT NOT NULL,
    "rating" INTEGER,
    "message" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_usage_daily" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "module" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "user_count" INTEGER NOT NULL DEFAULT 0,
    "business_count" INTEGER NOT NULL DEFAULT 0,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "feature_usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_quality_signals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "business_id" TEXT,
    "command_id" TEXT,
    "module" TEXT,
    "signal_type" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_quality_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_experiments" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "variants" JSONB NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_roadmap_insights" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "opportunity_score" INTEGER NOT NULL DEFAULT 50,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_roadmap_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_nodes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "label" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 50,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_edges" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "from_node_id" TEXT NOT NULL,
    "to_node_id" TEXT NOT NULL,
    "edgeType" TEXT NOT NULL,
    "strength" INTEGER NOT NULL DEFAULT 50,
    "value" DECIMAL(18,4),
    "currency" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "display_name" TEXT,
    "external_account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction_intents" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "message_id" TEXT,
    "call_log_id" TEXT,
    "contact_id" TEXT,
    "intentType" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "extracted_data" JSONB NOT NULL DEFAULT '{}',
    "recommended_action" TEXT,
    "profit_potential" DECIMAL(18,4),
    "currency" TEXT DEFAULT 'TTD',
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_drafts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "message_id" TEXT,
    "call_log_id" TEXT,
    "contact_id" TEXT,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "risk_tier" INTEGER NOT NULL DEFAULT 2,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT NOT NULL DEFAULT 'KEY',
    "approved_by_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "response_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "channel" TEXT NOT NULL,
    "consent_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "granted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trigger_definitions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "name" TEXT NOT NULL,
    "channel" TEXT,
    "event_type" TEXT NOT NULL,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trigger_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "object_path" TEXT NOT NULL,
    "public_url" TEXT,
    "file_name" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "media_type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "capture_mode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "linked_entity_type" TEXT,
    "linked_entity_id" TEXT,
    "contact_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visual_intakes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "detected_type" TEXT,
    "summary" TEXT,
    "extracted_text" TEXT,
    "extractedData" JSONB NOT NULL DEFAULT '{}',
    "confidence_score" INTEGER,
    "profit_potential" DECIMAL(18,4),
    "recommended_actions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visual_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_entities" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "visual_intake_id" TEXT,
    "media_asset_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "proposed_data" JSONB NOT NULL DEFAULT '{}',
    "matched_entity_type" TEXT,
    "matched_entity_id" TEXT,
    "match_confidence" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extracted_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_sessions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'push_to_talk',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voice_key" TEXT,
    "transcript" TEXT,
    "summary" TEXT,
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "command_items" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_voice_preferences" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "voice_key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "accent" TEXT,
    "speaking_rate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "pitch" DOUBLE PRECISION DEFAULT 1.0,
    "personality" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_voice_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_flows" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "goal" TEXT,
    "trigger_summary" TEXT,
    "risk_tier" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "blueprint_tags" JSONB NOT NULL DEFAULT '[]',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "automation_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_versions" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_runs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "flow_version_id" TEXT NOT NULL,
    "source_event_id" TEXT,
    "contact_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "current_node_id" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT,

    CONSTRAINT "flow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_run_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "business_types" JSONB NOT NULL DEFAULT '[]',
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "required_connectors" JSONB NOT NULL DEFAULT '[]',
    "estimated_impact" TEXT,
    "risk_tier" INTEGER NOT NULL DEFAULT 1,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_outcomes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "flow_id" TEXT,
    "agent_id" TEXT,
    "run_id" TEXT,
    "outcome_type" TEXT NOT NULL,
    "value" DECIMAL(18,4),
    "currency" TEXT,
    "contact_id" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "attribution" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_agents" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "channels" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "persona" JSONB NOT NULL DEFAULT '{}',
    "knowledge_sources" JSONB NOT NULL DEFAULT '[]',
    "allowed_tools" JSONB NOT NULL DEFAULT '[]',
    "blocked_topics" JSONB NOT NULL DEFAULT '[]',
    "escalation_rules" JSONB NOT NULL DEFAULT '{}',
    "risk_tier" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bot_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_conversation_states" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "bot_agent_id" TEXT,
    "thread_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "current_goal" TEXT,
    "slots" JSONB NOT NULL DEFAULT '{}',
    "history_summary" TEXT,
    "last_action" TEXT,
    "next_expected_input" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_conversation_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_agent_configs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agent_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "channels" JSONB NOT NULL DEFAULT '[]',
    "goals" JSONB NOT NULL DEFAULT '[]',
    "allowed_tools" JSONB NOT NULL DEFAULT '[]',
    "approval_policy" JSONB NOT NULL DEFAULT '{}',
    "memory_scope" TEXT NOT NULL DEFAULT 'business',
    "knowledge_sources" JSONB NOT NULL DEFAULT '[]',
    "kpis" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "key_agent_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "snapshot_type" TEXT NOT NULL,
    "snapshot_date" TIMESTAMP(3) NOT NULL,
    "total_revenue" DECIMAL(18,4),
    "invoice_count" INTEGER,
    "paid_invoice_count" INTEGER,
    "overdue_invoice_count" INTEGER,
    "total_overdue_amount" DECIMAL(18,4),
    "average_invoice_value" DECIMAL(18,4),
    "collection_rate" DOUBLE PRECISION,
    "total_contacts" INTEGER,
    "new_contacts" INTEGER,
    "active_leads" INTEGER,
    "lead_conversion_rate" DOUBLE PRECISION,
    "customer_retention_rate" DOUBLE PRECISION,
    "total_bookings" INTEGER,
    "upcoming_bookings" INTEGER,
    "completed_bookings" INTEGER,
    "no_show_rate" DOUBLE PRECISION,
    "total_quotes" INTEGER,
    "accepted_quotes" INTEGER,
    "quote_acceptance_rate" DOUBLE PRECISION,
    "total_deals" INTEGER,
    "open_deals_value" DECIMAL(18,4),
    "active_flows" INTEGER,
    "flow_runs" INTEGER,
    "flow_success_rate" DOUBLE PRECISION,
    "messages_sent" INTEGER,
    "messages_received" INTEGER,
    "response_rate" DOUBLE PRECISION,
    "avg_response_time_min" INTEGER,
    "storefront_visits" INTEGER,
    "orders_received" INTEGER,
    "cart_abandonment_rate" DOUBLE PRECISION,
    "health_score" INTEGER,
    "momentum_score" INTEGER,
    "growth_rate" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maturity_scores" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "assessment_date" TIMESTAMP(3) NOT NULL,
    "revenue_maturity" INTEGER NOT NULL,
    "customer_maturity" INTEGER NOT NULL,
    "operations_maturity" INTEGER NOT NULL,
    "marketing_maturity" INTEGER NOT NULL,
    "automation_maturity" INTEGER NOT NULL,
    "financial_maturity" INTEGER NOT NULL,
    "team_maturity" INTEGER NOT NULL,
    "data_maturity" INTEGER NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "percentile" INTEGER,
    "stage" TEXT NOT NULL,
    "gaps" JSONB NOT NULL DEFAULT '[]',
    "strengths" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maturity_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projections" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "projection_type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "baseline_value" DECIMAL(18,4),
    "baseline_periods" JSONB NOT NULL,
    "projected_values" JSONB NOT NULL,
    "confidence_interval" JSONB NOT NULL,
    "growth_assumption" DOUBLE PRECISION,
    "actual_values" JSONB,
    "accuracy" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "account_name" TEXT,
    "account_email" TEXT,
    "external_id" TEXT,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "settings" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_inbox_threads" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "external_thread_id" TEXT,
    "contact_id" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "last_message_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "aiSummary" TEXT,
    "aiIntent" TEXT,
    "aiSentiment" TEXT,
    "aiUrgency" TEXT,
    "aiTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_inbox_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_inbox_messages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "sender_name" TEXT,
    "sender_handle" TEXT,
    "sender_email" TEXT,
    "sender_phone" TEXT,
    "content_text" TEXT,
    "content_html" TEXT,
    "attachments" JSONB DEFAULT '[]',
    "external_message_id" TEXT,
    "received_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "send_status" TEXT,
    "provider_message_id" TEXT,
    "send_error" TEXT,
    "sent_by_user_id" TEXT,
    "sent_via" TEXT,
    "aiAnalysis" JSONB DEFAULT '{}',
    "extractedEntities" JSONB DEFAULT '{}',
    "suggestedActions" JSONB DEFAULT '[]',
    "ai_confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_inbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_inbox_insights" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "channel" TEXT,
    "summary" TEXT NOT NULL,
    "keyFindings" JSONB DEFAULT '[]',
    "recommendations" JSONB DEFAULT '[]',
    "taskSuggestions" JSONB DEFAULT '[]',
    "metrics" JSONB DEFAULT '{}',
    "trends" JSONB DEFAULT '{}',
    "insights" JSONB DEFAULT '[]',
    "channel_breakdown" JSONB DEFAULT '{}',
    "genome_signals" JSONB DEFAULT '[]',
    "report_version" INTEGER NOT NULL DEFAULT 1,
    "generated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_inbox_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_audit_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "provider_key" TEXT,
    "connection_id" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keystore_service_categories" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keystore_service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keystore_service_listings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "short_description" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliverables" JSONB NOT NULL DEFAULT '[]',
    "pricing_tiers" JSONB NOT NULL DEFAULT '[]',
    "addons" JSONB NOT NULL DEFAULT '[]',
    "faq" JSONB NOT NULL DEFAULT '[]',
    "brief_questions" JSONB NOT NULL DEFAULT '[]',
    "estimated_days" INTEGER NOT NULL DEFAULT 7,
    "requires_brief" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keystore_service_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keystore_service_orders" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "pricing_tier" TEXT NOT NULL,
    "selected_addons" JSONB NOT NULL DEFAULT '[]',
    "brief_answers" JSONB NOT NULL DEFAULT '[]',
    "estimated_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "final_price" DOUBLE PRECISION,
    "deposit_amount" DOUBLE PRECISION,
    "deposit_paid" BOOLEAN NOT NULL DEFAULT false,
    "invoice_id" TEXT,
    "delivery_due_at" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "delivery_files" JSONB NOT NULL DEFAULT '[]',
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "rating" INTEGER,
    "review" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keystore_service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keystore_service_order_messages" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keystore_service_order_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cortex_sessions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "persona" TEXT NOT NULL DEFAULT 'jarvis',
    "voice" TEXT NOT NULL DEFAULT 'echo',
    "mood" TEXT NOT NULL DEFAULT 'focused',
    "preferred_provider" TEXT NOT NULL DEFAULT 'openai',
    "title" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "context_snapshot" JSONB,
    "running_summary" TEXT,
    "last_accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "detected_role" TEXT,
    "detected_function" TEXT,
    "layers_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "llm_calls_made" INTEGER NOT NULL DEFAULT 0,
    "response_time_ms" INTEGER,
    "user_feedback" TEXT,
    "correlation_id" TEXT,
    "command_id" TEXT,

    CONSTRAINT "cortex_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cortex_action_logs" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "result" TEXT,
    "error" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "estimated_impact" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "command_id" TEXT,
    "correlation_id" TEXT,
    "proposal_id" TEXT,

    CONSTRAINT "cortex_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_documents" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "storage_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "chunks_indexed" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_evolution_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "recommendation_type" TEXT NOT NULL,
    "user_action" TEXT NOT NULL,
    "outcome" TEXT,
    "outcome_value" DOUBLE PRECISION,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_evolution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_call_sessions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "call_sid" TEXT,
    "phone_number" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "script" TEXT,
    "transcript" JSONB DEFAULT '[]',
    "summary" TEXT,
    "sentiment" TEXT,
    "outcome" TEXT,
    "recording_url" TEXT,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "key_call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_tuning_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_tuning_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_user_preferences" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "response_length" TEXT NOT NULL DEFAULT 'medium',
    "preferred_tone" TEXT NOT NULL DEFAULT 'professional',
    "active_recommendation_types" JSONB NOT NULL DEFAULT '[]',
    "ignored_recommendation_types" JSONB NOT NULL DEFAULT '[]',
    "peak_activity_hours" JSONB NOT NULL DEFAULT '[]',
    "preferred_communication_style" TEXT NOT NULL DEFAULT 'concise',
    "acceptance_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_interactions" INTEGER NOT NULL DEFAULT 0,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_interaction_feedback" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "user_rating" INTEGER,
    "user_comment" TEXT,
    "actions_taken" JSONB NOT NULL DEFAULT '[]',
    "actions_skipped" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,

    CONSTRAINT "key_interaction_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_execution_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "code" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_type" TEXT,
    "error" TEXT,
    "output" TEXT,
    "execution_time_ms" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_approval_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "parameters" JSONB DEFAULT '{}',
    "command_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "win_rate" DOUBLE PRECISION,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cognition_memories" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "role_id" TEXT,
    "function_id" TEXT,
    "session_id" TEXT,
    "query" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "user_response" TEXT NOT NULL,
    "actual_outcome" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "lessons_learned" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence_delta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cognition_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cognition_sessions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "context_snapshot" JSONB DEFAULT '{}',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cognition_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_provider_costs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "session_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task_category" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "input_cost" DOUBLE PRECISION NOT NULL,
    "output_cost" DOUBLE PRECISION NOT NULL,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_provider_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_health_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "provider_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_health_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "direction" TEXT NOT NULL DEFAULT 'bidirectional',
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "meta" JSONB DEFAULT '{}',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "ai_autonomy_level" TEXT NOT NULL DEFAULT 'supervised',
    "ai_always_require_approval" JSONB NOT NULL DEFAULT '[]',
    "ai_never_require_approval" JSONB NOT NULL DEFAULT '[]',
    "ai_spending_threshold" DOUBLE PRECISION,
    "ai_action_spending_limits" JSONB NOT NULL DEFAULT '{}',
    "ai_max_auto_executions_per_hour" INTEGER NOT NULL DEFAULT 100,
    "preferences" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_genomes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "dna_scores" JSONB NOT NULL DEFAULT '{}',
    "stage" TEXT NOT NULL DEFAULT 'seed',
    "current_stage" TEXT,
    "stage_progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "readiness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "executive_readiness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growth_trajectory" TEXT NOT NULL DEFAULT 'stable',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_genomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee_id" TEXT,
    "due_date" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_definitions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "edges" JSONB NOT NULL DEFAULT '[]',
    "trigger" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT,
    "execution_count" INTEGER NOT NULL DEFAULT 0,
    "last_execution_at" TIMESTAMP(3),
    "last_execution_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_executions" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "current_node_id" TEXT,
    "context" JSONB DEFAULT '{}',
    "results" JSONB DEFAULT '[]',
    "error" TEXT,
    "parent_execution_id" TEXT,
    "iteration_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT '30d',
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "status" TEXT NOT NULL DEFAULT 'generating',
    "result_url" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "trigger_time" TIMESTAMP(3) NOT NULL,
    "recipient_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'active',
    "trigger_type" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'note',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'cortex_ai',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "estimated_value" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_campaigns" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tasks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_tickets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "requester_id" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assigned_to" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpdesk_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_MembershipToSkill" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_MembershipToSkill_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ServiceToStaffMember" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ServiceToStaffMember_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_SkillToStaffMember" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SkillToStaffMember_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");

-- CreateIndex
CREATE INDEX "business_assets_business_id_idx" ON "business_assets"("business_id");

-- CreateIndex
CREATE INDEX "business_assets_business_id_type_idx" ON "business_assets"("business_id", "type");

-- CreateIndex
CREATE INDEX "business_assets_business_id_status_idx" ON "business_assets"("business_id", "status");

-- CreateIndex
CREATE INDEX "contracts_business_id_idx" ON "contracts"("business_id");

-- CreateIndex
CREATE INDEX "contracts_business_id_status_idx" ON "contracts"("business_id", "status");

-- CreateIndex
CREATE INDEX "contracts_business_id_expiry_date_idx" ON "contracts"("business_id", "expiry_date");

-- CreateIndex
CREATE INDEX "contract_parties_business_id_idx" ON "contract_parties"("business_id");

-- CreateIndex
CREATE INDEX "contract_parties_contract_id_idx" ON "contract_parties"("contract_id");

-- CreateIndex
CREATE INDEX "contract_terms_business_id_idx" ON "contract_terms"("business_id");

-- CreateIndex
CREATE INDEX "contract_terms_contract_id_idx" ON "contract_terms"("contract_id");

-- CreateIndex
CREATE INDEX "contract_terms_term_key_idx" ON "contract_terms"("term_key");

-- CreateIndex
CREATE INDEX "contract_versions_business_id_idx" ON "contract_versions"("business_id");

-- CreateIndex
CREATE INDEX "contract_versions_contract_id_idx" ON "contract_versions"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_versions_contract_id_version_number_key" ON "contract_versions"("contract_id", "version_number");

-- CreateIndex
CREATE INDEX "contract_alerts_business_id_idx" ON "contract_alerts"("business_id");

-- CreateIndex
CREATE INDEX "contract_alerts_contract_id_idx" ON "contract_alerts"("contract_id");

-- CreateIndex
CREATE INDEX "contract_alerts_due_date_idx" ON "contract_alerts"("due_date");

-- CreateIndex
CREATE INDEX "contract_tags_business_id_idx" ON "contract_tags"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_tags_business_id_name_key" ON "contract_tags"("business_id", "name");

-- CreateIndex
CREATE INDEX "contract_tags_on_contracts_contract_id_idx" ON "contract_tags_on_contracts"("contract_id");

-- CreateIndex
CREATE INDEX "contract_tags_on_contracts_tag_id_idx" ON "contract_tags_on_contracts"("tag_id");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_occurred_at_idx" ON "temporal_flow_events"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_starts_at_idx" ON "temporal_flow_events"("business_id", "starts_at");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_source_idx" ON "temporal_flow_events"("business_id", "source");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_type_idx" ON "temporal_flow_events"("business_id", "type");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_module_idx" ON "temporal_flow_events"("business_id", "module");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_status_idx" ON "temporal_flow_events"("business_id", "status");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_reminder_at_idx" ON "temporal_flow_events"("business_id", "reminder_at");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_genome_impact_potential_idx" ON "temporal_flow_events"("business_id", "genome_impact_potential");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_thread_id_idx" ON "temporal_flow_events"("business_id", "thread_id");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_contact_id_idx" ON "temporal_flow_events"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "temporal_flow_events_business_id_message_id_idx" ON "temporal_flow_events"("business_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "temporal_flow_events_business_id_source_external_id_key" ON "temporal_flow_events"("business_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "flow_signals_business_id_flows_idx" ON "flow_signals"("business_id", "flows");

-- CreateIndex
CREATE INDEX "flow_signals_business_id_status_occurred_at_idx" ON "flow_signals"("business_id", "status", "occurred_at");

-- CreateIndex
CREATE INDEX "flow_signals_business_id_owner_role_hint_status_idx" ON "flow_signals"("business_id", "owner_role_hint", "status");

-- CreateIndex
CREATE INDEX "flow_signals_business_id_entity_type_entity_id_idx" ON "flow_signals"("business_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "flow_signals_business_id_type_status_idx" ON "flow_signals"("business_id", "type", "status");

-- CreateIndex
CREATE INDEX "flow_role_subscriptions_business_id_role_key_idx" ON "flow_role_subscriptions"("business_id", "role_key");

-- CreateIndex
CREATE INDEX "flow_role_subscriptions_business_id_flow_type_idx" ON "flow_role_subscriptions"("business_id", "flow_type");

-- CreateIndex
CREATE INDEX "temporal_flow_memories_business_id_entity_type_entity_id_idx" ON "temporal_flow_memories"("business_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "temporal_flow_memories_business_id_type_idx" ON "temporal_flow_memories"("business_id", "type");

-- CreateIndex
CREATE INDEX "temporal_flow_memories_business_id_updated_at_idx" ON "temporal_flow_memories"("business_id", "updated_at");

-- CreateIndex
CREATE INDEX "genome_evolution_proposals_business_id_status_idx" ON "genome_evolution_proposals"("business_id", "status");

-- CreateIndex
CREATE INDEX "genome_evolution_proposals_business_id_section_idx" ON "genome_evolution_proposals"("business_id", "section");

-- CreateIndex
CREATE INDEX "genome_evolution_proposals_business_id_created_at_idx" ON "genome_evolution_proposals"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "genome_facts_business_id_section_idx" ON "genome_facts"("business_id", "section");

-- CreateIndex
CREATE INDEX "genome_facts_business_id_domain_idx" ON "genome_facts"("business_id", "domain");

-- CreateIndex
CREATE INDEX "genome_facts_business_id_verification_status_idx" ON "genome_facts"("business_id", "verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "genome_facts_business_id_section_domain_field_key" ON "genome_facts"("business_id", "section", "domain", "field");

-- CreateIndex
CREATE INDEX "genome_evidence_business_id_fact_id_idx" ON "genome_evidence"("business_id", "fact_id");

-- CreateIndex
CREATE INDEX "genome_evidence_business_id_source_module_idx" ON "genome_evidence"("business_id", "source_module");

-- CreateIndex
CREATE INDEX "genome_evidence_business_id_occurred_at_idx" ON "genome_evidence"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "genome_signals_business_id_source_module_idx" ON "genome_signals"("business_id", "source_module");

-- CreateIndex
CREATE INDEX "genome_signals_business_id_status_idx" ON "genome_signals"("business_id", "status");

-- CreateIndex
CREATE INDEX "genome_signals_business_id_section_idx" ON "genome_signals"("business_id", "section");

-- CreateIndex
CREATE INDEX "genome_module_readiness_business_id_readiness_score_idx" ON "genome_module_readiness"("business_id", "readiness_score");

-- CreateIndex
CREATE UNIQUE INDEX "genome_module_readiness_business_id_module_key" ON "genome_module_readiness"("business_id", "module");

-- CreateIndex
CREATE INDEX "genome_recommendations_business_id_status_idx" ON "genome_recommendations"("business_id", "status");

-- CreateIndex
CREATE INDEX "genome_recommendations_business_id_domain_idx" ON "genome_recommendations"("business_id", "domain");

-- CreateIndex
CREATE INDEX "genome_recommendations_business_id_risk_level_idx" ON "genome_recommendations"("business_id", "risk_level");

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

-- CreateIndex
CREATE INDEX "genome_experiments_business_id_status_idx" ON "genome_experiments"("business_id", "status");

-- CreateIndex
CREATE INDEX "genome_departments_business_id_risk_level_idx" ON "genome_departments"("business_id", "risk_level");

-- CreateIndex
CREATE INDEX "genome_departments_business_id_readiness_score_idx" ON "genome_departments"("business_id", "readiness_score");

-- CreateIndex
CREATE UNIQUE INDEX "genome_departments_business_id_code_key" ON "genome_departments"("business_id", "code");

-- CreateIndex
CREATE INDEX "genome_memory_events_business_id_source_type_idx" ON "genome_memory_events"("business_id", "source_type");

-- CreateIndex
CREATE INDEX "genome_memory_events_business_id_event_type_idx" ON "genome_memory_events"("business_id", "event_type");

-- CreateIndex
CREATE INDEX "genome_memory_events_business_id_domain_idx" ON "genome_memory_events"("business_id", "domain");

-- CreateIndex
CREATE INDEX "genome_memory_events_business_id_occurred_at_idx" ON "genome_memory_events"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "genome_financial_metrics_business_id_metric_type_idx" ON "genome_financial_metrics"("business_id", "metric_type");

-- CreateIndex
CREATE INDEX "genome_financial_metrics_business_id_period_idx" ON "genome_financial_metrics"("business_id", "period");

-- CreateIndex
CREATE INDEX "genome_financial_metrics_business_id_occurred_at_idx" ON "genome_financial_metrics"("business_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "genome_financial_metrics_business_id_metric_type_period_key" ON "genome_financial_metrics"("business_id", "metric_type", "period");

-- CreateIndex
CREATE INDEX "genome_finance_snapshots_business_id_period_idx" ON "genome_finance_snapshots"("business_id", "period");

-- CreateIndex
CREATE INDEX "genome_finance_snapshots_business_id_overall_risk_idx" ON "genome_finance_snapshots"("business_id", "overall_risk");

-- CreateIndex
CREATE INDEX "genome_customer_segments_business_id_segment_type_idx" ON "genome_customer_segments"("business_id", "segment_type");

-- CreateIndex
CREATE INDEX "genome_customer_segments_business_id_channel_idx" ON "genome_customer_segments"("business_id", "channel");

-- CreateIndex
CREATE INDEX "genome_sales_motions_business_id_motion_type_idx" ON "genome_sales_motions"("business_id", "motion_type");

-- CreateIndex
CREATE INDEX "genome_sales_motions_business_id_stage_idx" ON "genome_sales_motions"("business_id", "stage");

-- CreateIndex
CREATE INDEX "genome_sales_motions_business_id_isActive_idx" ON "genome_sales_motions"("business_id", "isActive");

-- CreateIndex
CREATE INDEX "genome_customer_sales_snapshots_business_id_period_idx" ON "genome_customer_sales_snapshots"("business_id", "period");

-- CreateIndex
CREATE INDEX "genome_customer_sales_snapshots_business_id_overall_risk_idx" ON "genome_customer_sales_snapshots"("business_id", "overall_risk");

-- CreateIndex
CREATE INDEX "genome_operational_processes_business_id_process_type_idx" ON "genome_operational_processes"("business_id", "process_type");

-- CreateIndex
CREATE INDEX "genome_operational_processes_business_id_risk_level_idx" ON "genome_operational_processes"("business_id", "risk_level");

-- CreateIndex
CREATE INDEX "genome_operational_processes_business_id_has_sop_idx" ON "genome_operational_processes"("business_id", "has_sop");

-- CreateIndex
CREATE INDEX "genome_delivery_capabilities_business_id_capability_type_idx" ON "genome_delivery_capabilities"("business_id", "capability_type");

-- CreateIndex
CREATE INDEX "genome_delivery_capabilities_business_id_risk_level_idx" ON "genome_delivery_capabilities"("business_id", "risk_level");

-- CreateIndex
CREATE INDEX "genome_operations_snapshots_business_id_period_idx" ON "genome_operations_snapshots"("business_id", "period");

-- CreateIndex
CREATE INDEX "genome_operations_snapshots_business_id_overall_risk_idx" ON "genome_operations_snapshots"("business_id", "overall_risk");

-- CreateIndex
CREATE INDEX "genome_growth_channels_business_id_key_idx" ON "genome_growth_channels"("business_id", "key");

-- CreateIndex
CREATE INDEX "genome_growth_channels_business_id_status_idx" ON "genome_growth_channels"("business_id", "status");

-- CreateIndex
CREATE INDEX "genome_growth_channels_business_id_channel_type_idx" ON "genome_growth_channels"("business_id", "channel_type");

-- CreateIndex
CREATE INDEX "genome_content_strategies_business_id_idx" ON "genome_content_strategies"("business_id");

-- CreateIndex
CREATE INDEX "genome_marketing_snapshots_business_id_period_idx" ON "genome_marketing_snapshots"("business_id", "period");

-- CreateIndex
CREATE INDEX "genome_marketing_snapshots_business_id_overall_risk_idx" ON "genome_marketing_snapshots"("business_id", "overall_risk");

-- CreateIndex
CREATE INDEX "genome_cross_domain_snapshots_business_id_period_idx" ON "genome_cross_domain_snapshots"("business_id", "period");

-- CreateIndex
CREATE INDEX "genome_cross_domain_snapshots_business_id_overall_risk_leve_idx" ON "genome_cross_domain_snapshots"("business_id", "overall_risk_level");

-- CreateIndex
CREATE INDEX "business_constitution_versions_business_id_idx" ON "business_constitution_versions"("business_id");

-- CreateIndex
CREATE INDEX "business_constitution_versions_business_id_status_idx" ON "business_constitution_versions"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_constitution_versions_business_id_version_key" ON "business_constitution_versions"("business_id", "version");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_idx" ON "key_action_proposals"("business_id");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_status_idx" ON "key_action_proposals"("business_id", "status");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_source_type_idx" ON "key_action_proposals"("business_id", "source_type");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_action_type_idx" ON "key_action_proposals"("business_id", "action_type");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_tool_name_idx" ON "key_action_proposals"("business_id", "tool_name");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_correlation_id_idx" ON "key_action_proposals"("business_id", "correlation_id");

-- CreateIndex
CREATE INDEX "key_action_proposals_business_id_command_id_idx" ON "key_action_proposals"("business_id", "command_id");

-- CreateIndex
CREATE INDEX "key_action_proposals_plan_id_idx" ON "key_action_proposals"("plan_id");

-- CreateIndex
CREATE INDEX "key_action_proposals_plan_step_id_idx" ON "key_action_proposals"("plan_step_id");

-- CreateIndex
CREATE INDEX "key_action_proposals_multi_step_parent_id_idx" ON "key_action_proposals"("multi_step_parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_strategies_business_id_key" ON "market_strategies"("business_id");

-- CreateIndex
CREATE INDEX "competitors_business_id_idx" ON "competitors"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "drive_sync_cursors_business_id_key" ON "drive_sync_cursors"("business_id");

-- CreateIndex
CREATE INDEX "drive_intake_files_business_id_status_idx" ON "drive_intake_files"("business_id", "status");

-- CreateIndex
CREATE INDEX "drive_intake_files_business_id_modified_time_idx" ON "drive_intake_files"("business_id", "modified_time");

-- CreateIndex
CREATE UNIQUE INDEX "drive_intake_files_business_id_drive_file_id_key" ON "drive_intake_files"("business_id", "drive_file_id");

-- CreateIndex
CREATE INDEX "message_intakes_business_id_status_idx" ON "message_intakes"("business_id", "status");

-- CreateIndex
CREATE INDEX "message_intakes_business_id_contact_id_idx" ON "message_intakes"("business_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_intakes_business_id_source_channel_external_id_key" ON "message_intakes"("business_id", "source_channel", "external_id");

-- CreateIndex
CREATE INDEX "ingestion_items_business_id_status_idx" ON "ingestion_items"("business_id", "status");

-- CreateIndex
CREATE INDEX "ingestion_items_business_id_source_type_idx" ON "ingestion_items"("business_id", "source_type");

-- CreateIndex
CREATE INDEX "ingestion_items_business_id_created_at_idx" ON "ingestion_items"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ingestion_items_business_id_contact_id_idx" ON "ingestion_items"("business_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_items_business_id_source_type_external_id_key" ON "ingestion_items"("business_id", "source_type", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_items_business_id_dedupe_hash_key" ON "ingestion_items"("business_id", "dedupe_hash");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE INDEX "memberships_business_id_idx" ON "memberships"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_business_id_key" ON "memberships"("user_id", "business_id");

-- CreateIndex
CREATE INDEX "team_activity_logs_business_id_created_at_idx" ON "team_activity_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "team_activity_logs_business_id_user_id_idx" ON "team_activity_logs"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "team_activity_logs_business_id_module_idx" ON "team_activity_logs"("business_id", "module");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_business_id_idx" ON "push_subscriptions"("business_id");

-- CreateIndex
CREATE INDEX "org_units_business_id_idx" ON "org_units"("business_id");

-- CreateIndex
CREATE INDEX "org_units_business_id_type_idx" ON "org_units"("business_id", "type");

-- CreateIndex
CREATE INDEX "job_roles_business_id_idx" ON "job_roles"("business_id");

-- CreateIndex
CREATE INDEX "org_assignments_business_id_membership_id_idx" ON "org_assignments"("business_id", "membership_id");

-- CreateIndex
CREATE INDEX "org_assignments_business_id_org_unit_id_idx" ON "org_assignments"("business_id", "org_unit_id");

-- CreateIndex
CREATE INDEX "org_assignments_business_id_user_id_idx" ON "org_assignments"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "delegation_rules_business_id_delegator_id_idx" ON "delegation_rules"("business_id", "delegator_id");

-- CreateIndex
CREATE INDEX "delegation_rules_business_id_scope_idx" ON "delegation_rules"("business_id", "scope");

-- CreateIndex
CREATE INDEX "contacts_business_id_idx" ON "contacts"("business_id");

-- CreateIndex
CREATE INDEX "contacts_business_id_created_at_idx" ON "contacts"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "contacts_business_id_status_idx" ON "contacts"("business_id", "status");

-- CreateIndex
CREATE INDEX "contacts_business_id_lead_score_idx" ON "contacts"("business_id", "lead_score");

-- CreateIndex
CREATE INDEX "contacts_business_id_deleted_at_idx" ON "contacts"("business_id", "deleted_at");

-- CreateIndex
CREATE INDEX "contacts_business_id_deleted_at_status_idx" ON "contacts"("business_id", "deleted_at", "status");

-- CreateIndex
CREATE INDEX "contacts_business_id_deleted_at_created_at_idx" ON "contacts"("business_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "contacts_business_id_last_merge_id_idx" ON "contacts"("business_id", "last_merge_id");

-- CreateIndex
CREATE INDEX "contacts_business_id_data_quality_score_idx" ON "contacts"("business_id", "data_quality_score");

-- CreateIndex
CREATE INDEX "contacts_business_id_relationship_type_idx" ON "contacts"("business_id", "relationship_type");

-- CreateIndex
CREATE INDEX "contacts_business_id_pipeline_stage_idx" ON "contacts"("business_id", "pipeline_stage");

-- CreateIndex
CREATE INDEX "contacts_business_id_priority_idx" ON "contacts"("business_id", "priority");

-- CreateIndex
CREATE INDEX "contacts_business_id_next_action_at_idx" ON "contacts"("business_id", "next_action_at");

-- CreateIndex
CREATE INDEX "contacts_business_id_archived_at_idx" ON "contacts"("business_id", "archived_at");

-- CreateIndex
CREATE INDEX "contacts_business_id_owner_id_idx" ON "contacts"("business_id", "owner_id");

-- CreateIndex
CREATE INDEX "contacts_business_id_visibility_idx" ON "contacts"("business_id", "visibility");

-- CreateIndex
CREATE INDEX "contacts_business_id_account_id_idx" ON "contacts"("business_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_business_id_email_normalized_key" ON "contacts"("business_id", "email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_business_id_phone_normalized_key" ON "contacts"("business_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "custom_field_definitions_business_id_idx" ON "custom_field_definitions"("business_id");

-- CreateIndex
CREATE INDEX "custom_field_definitions_business_id_archived_at_idx" ON "custom_field_definitions"("business_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_business_id_name_key" ON "custom_field_definitions"("business_id", "name");

-- CreateIndex
CREATE INDEX "contact_custom_field_values_contact_id_idx" ON "contact_custom_field_values"("contact_id");

-- CreateIndex
CREATE INDEX "contact_custom_field_values_definition_id_idx" ON "contact_custom_field_values"("definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_custom_field_values_contact_id_definition_id_key" ON "contact_custom_field_values"("contact_id", "definition_id");

-- CreateIndex
CREATE INDEX "tags_business_id_idx" ON "tags"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_business_id_name_key" ON "tags"("business_id", "name");

-- CreateIndex
CREATE INDEX "contact_tags_contact_id_idx" ON "contact_tags"("contact_id");

-- CreateIndex
CREATE INDEX "contact_tags_tag_id_idx" ON "contact_tags"("tag_id");

-- CreateIndex
CREATE INDEX "accounts_business_id_name_idx" ON "accounts"("business_id", "name");

-- CreateIndex
CREATE INDEX "accounts_business_id_industry_idx" ON "accounts"("business_id", "industry");

-- CreateIndex
CREATE INDEX "accounts_business_id_owner_user_id_idx" ON "accounts"("business_id", "owner_user_id");

-- CreateIndex
CREATE INDEX "accounts_business_id_deleted_at_idx" ON "accounts"("business_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_business_id_domain_key" ON "accounts"("business_id", "domain");

-- CreateIndex
CREATE INDEX "deal_stages_business_id_position_idx" ON "deal_stages"("business_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "deal_stages_business_id_slug_key" ON "deal_stages"("business_id", "slug");

-- CreateIndex
CREATE INDEX "deals_business_id_status_idx" ON "deals"("business_id", "status");

-- CreateIndex
CREATE INDEX "deals_business_id_stage_id_idx" ON "deals"("business_id", "stage_id");

-- CreateIndex
CREATE INDEX "deals_business_id_owner_user_id_idx" ON "deals"("business_id", "owner_user_id");

-- CreateIndex
CREATE INDEX "deals_business_id_expected_close_at_idx" ON "deals"("business_id", "expected_close_at");

-- CreateIndex
CREATE INDEX "deals_contact_id_idx" ON "deals"("contact_id");

-- CreateIndex
CREATE INDEX "deals_business_id_account_id_idx" ON "deals"("business_id", "account_id");

-- CreateIndex
CREATE INDEX "deals_business_id_deleted_at_idx" ON "deals"("business_id", "deleted_at");

-- CreateIndex
CREATE INDEX "deals_business_id_bottleneck_flag_idx" ON "deals"("business_id", "bottleneck_flag");

-- CreateIndex
CREATE INDEX "contact_relationships_business_id_idx" ON "contact_relationships"("business_id");

-- CreateIndex
CREATE INDEX "contact_relationships_business_id_type_idx" ON "contact_relationships"("business_id", "type");

-- CreateIndex
CREATE INDEX "contact_relationships_from_contact_id_idx" ON "contact_relationships"("from_contact_id");

-- CreateIndex
CREATE INDEX "contact_relationships_to_contact_id_idx" ON "contact_relationships"("to_contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_relationships_from_contact_id_to_contact_id_type_key" ON "contact_relationships"("from_contact_id", "to_contact_id", "type");

-- CreateIndex
CREATE INDEX "contact_shares_business_id_user_id_idx" ON "contact_shares"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "contact_shares_contact_id_idx" ON "contact_shares"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_shares_contact_id_user_id_key" ON "contact_shares"("contact_id", "user_id");

-- CreateIndex
CREATE INDEX "contact_data_issues_business_id_status_idx" ON "contact_data_issues"("business_id", "status");

-- CreateIndex
CREATE INDEX "contact_data_issues_business_id_kind_status_idx" ON "contact_data_issues"("business_id", "kind", "status");

-- CreateIndex
CREATE INDEX "contact_data_issues_business_id_severity_status_idx" ON "contact_data_issues"("business_id", "severity", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contact_data_issues_contact_id_kind_key" ON "contact_data_issues"("contact_id", "kind");

-- CreateIndex
CREATE INDEX "won_lost_reasons_business_id_kind_position_idx" ON "won_lost_reasons"("business_id", "kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "won_lost_reasons_business_id_kind_slug_key" ON "won_lost_reasons"("business_id", "kind", "slug");

-- CreateIndex
CREATE INDEX "contact_external_mappings_contact_id_idx" ON "contact_external_mappings"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_external_mappings_business_id_source_external_id_key" ON "contact_external_mappings"("business_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "contact_sync_audits_business_id_source_created_at_idx" ON "contact_sync_audits"("business_id", "source", "created_at");

-- CreateIndex
CREATE INDEX "contact_sync_audits_business_id_contact_id_idx" ON "contact_sync_audits"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "calendar_sync_conflicts_business_id_status_idx" ON "calendar_sync_conflicts"("business_id", "status");

-- CreateIndex
CREATE INDEX "calendar_sync_conflicts_business_id_created_at_idx" ON "calendar_sync_conflicts"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "calendar_events_business_id_start_at_idx" ON "calendar_events"("business_id", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_business_id_module_start_at_idx" ON "calendar_events"("business_id", "module", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_business_id_type_start_at_idx" ON "calendar_events"("business_id", "type", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_business_id_contact_id_idx" ON "calendar_events"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "calendar_events_business_id_staff_id_idx" ON "calendar_events"("business_id", "staff_id");

-- CreateIndex
CREATE INDEX "calendar_events_business_id_sync_status_idx" ON "calendar_events"("business_id", "sync_status");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_business_id_source_type_source_id_key" ON "calendar_events"("business_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "connector_statuses_business_id_idx" ON "connector_statuses"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "connector_statuses_business_id_connector_type_key" ON "connector_statuses"("business_id", "connector_type");

-- CreateIndex
CREATE INDEX "webhook_delivery_logs_business_id_connector_type_created_at_idx" ON "webhook_delivery_logs"("business_id", "connector_type", "created_at");

-- CreateIndex
CREATE INDEX "connector_activity_logs_business_id_connector_type_created__idx" ON "connector_activity_logs"("business_id", "connector_type", "created_at");

-- CreateIndex
CREATE INDEX "connector_activity_logs_business_id_created_at_idx" ON "connector_activity_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "contact_events_business_id_contact_id_idx" ON "contact_events"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_events_business_id_contact_id_type_idx" ON "contact_events"("business_id", "contact_id", "type");

-- CreateIndex
CREATE INDEX "contact_events_business_id_type_created_at_idx" ON "contact_events"("business_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "contact_read_states_business_id_user_id_idx" ON "contact_read_states"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "contact_read_states_contact_id_idx" ON "contact_read_states"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_read_states_business_id_user_id_contact_id_key" ON "contact_read_states"("business_id", "user_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_channel_stats_business_id_contact_id_idx" ON "contact_channel_stats"("business_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_channel_stats_contact_id_channel_key" ON "contact_channel_stats"("contact_id", "channel");

-- CreateIndex
CREATE INDEX "conversation_ai_insights_business_id_contact_id_kind_idx" ON "conversation_ai_insights"("business_id", "contact_id", "kind");

-- CreateIndex
CREATE INDEX "conversation_ai_insights_business_id_contact_id_created_at_idx" ON "conversation_ai_insights"("business_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_ai_insights_business_id_hash_idx" ON "conversation_ai_insights"("business_id", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_ai_insights_business_id_contact_id_kind_messag_key" ON "conversation_ai_insights"("business_id", "contact_id", "kind", "message_ref");

-- CreateIndex
CREATE UNIQUE INDEX "contact_insight_snapshots_contact_id_key" ON "contact_insight_snapshots"("contact_id");

-- CreateIndex
CREATE INDEX "contact_insight_snapshots_business_id_stale_idx" ON "contact_insight_snapshots"("business_id", "stale");

-- CreateIndex
CREATE INDEX "contact_insight_snapshots_business_id_computed_at_idx" ON "contact_insight_snapshots"("business_id", "computed_at");

-- CreateIndex
CREATE INDEX "contact_notes_business_id_contact_id_idx" ON "contact_notes"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_notes_business_id_created_at_idx" ON "contact_notes"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "contact_tasks_business_id_contact_id_idx" ON "contact_tasks"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_tasks_business_id_status_due_date_idx" ON "contact_tasks"("business_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "contact_tasks_business_id_assignee_id_status_idx" ON "contact_tasks"("business_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "contact_imports_business_id_created_at_idx" ON "contact_imports"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "contact_import_contacts_import_id_idx" ON "contact_import_contacts"("import_id");

-- CreateIndex
CREATE INDEX "contact_import_contacts_contact_id_idx" ON "contact_import_contacts"("contact_id");

-- CreateIndex
CREATE INDEX "contact_media_business_id_contact_id_idx" ON "contact_media"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_playbooks_business_id_contact_id_idx" ON "contact_playbooks"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_lists_business_id_idx" ON "contact_lists"("business_id");

-- CreateIndex
CREATE INDEX "merge_operations_business_id_created_at_idx" ON "merge_operations"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "merge_operations_business_id_primary_id_idx" ON "merge_operations"("business_id", "primary_id");

-- CreateIndex
CREATE INDEX "merge_operations_business_id_duplicate_id_idx" ON "merge_operations"("business_id", "duplicate_id");

-- CreateIndex
CREATE INDEX "contact_saved_views_business_id_user_id_idx" ON "contact_saved_views"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_saved_views_user_id_business_id_name_key" ON "contact_saved_views"("user_id", "business_id", "name");

-- CreateIndex
CREATE INDEX "contact_list_members_contact_id_idx" ON "contact_list_members"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_list_members_list_id_contact_id_key" ON "contact_list_members"("list_id", "contact_id");

-- CreateIndex
CREATE INDEX "products_business_id_idx" ON "products"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_view_token_key" ON "quotes"("view_token");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_invoice_id_key" ON "quotes"("invoice_id");

-- CreateIndex
CREATE INDEX "quotes_business_id_contact_id_idx" ON "quotes"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "quotes_business_id_status_sent_at_idx" ON "quotes"("business_id", "status", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_business_id_quote_number_key" ON "quotes"("business_id", "quote_number");

-- CreateIndex
CREATE INDEX "quote_items_quote_id_idx" ON "quote_items"("quote_id");

-- CreateIndex
CREATE INDEX "quote_items_product_id_idx" ON "quote_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_quote_id_key" ON "invoices"("quote_id");

-- CreateIndex
CREATE INDEX "invoices_business_id_contact_id_idx" ON "invoices"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "invoices_business_id_external_accounting_source_external_ac_idx" ON "invoices"("business_id", "external_accounting_source", "external_accounting_id");

-- CreateIndex
CREATE INDEX "invoices_business_id_recurring_invoice_id_idx" ON "invoices"("business_id", "recurring_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_business_id_invoice_number_key" ON "invoices"("business_id", "invoice_number");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_items_product_id_idx" ON "invoice_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_business_id_invoice_id_idx" ON "payments"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "webhook_events_business_id_received_at_idx" ON "webhook_events"("business_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "generated_documents_business_id_entity_type_entity_id_idx" ON "generated_documents"("business_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "generated_documents_business_id_generated_at_idx" ON "generated_documents"("business_id", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_token_key" ON "payment_links"("token");

-- CreateIndex
CREATE INDEX "payment_links_token_idx" ON "payment_links"("token");

-- CreateIndex
CREATE INDEX "payment_links_business_id_idx" ON "payment_links"("business_id");

-- CreateIndex
CREATE INDEX "staff_members_business_id_idx" ON "staff_members"("business_id");

-- CreateIndex
CREATE INDEX "services_business_id_idx" ON "services"("business_id");

-- CreateIndex
CREATE INDEX "services_source_product_id_idx" ON "services"("source_product_id");

-- CreateIndex
CREATE INDEX "availabilities_staff_id_idx" ON "availabilities"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_invoice_id_key" ON "bookings"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_deposit_invoice_id_key" ON "bookings"("deposit_invoice_id");

-- CreateIndex
CREATE INDEX "bookings_business_id_staff_id_start_time_end_time_idx" ON "bookings"("business_id", "staff_id", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "bookings_business_id_contact_id_idx" ON "bookings"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "bookings_business_id_org_unit_id_idx" ON "bookings"("business_id", "org_unit_id");

-- CreateIndex
CREATE INDEX "social_connections_business_id_idx" ON "social_connections"("business_id");

-- CreateIndex
CREATE INDEX "social_connections_business_id_platform_idx" ON "social_connections"("business_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_business_id_platform_platform_id_key" ON "social_connections"("business_id", "platform", "platform_id");

-- CreateIndex
CREATE INDEX "social_posts_business_id_status_scheduled_at_idx" ON "social_posts"("business_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "channel_connections_business_id_idx" ON "channel_connections"("business_id");

-- CreateIndex
CREATE INDEX "channel_connections_business_id_provider_idx" ON "channel_connections"("business_id", "provider");

-- CreateIndex
CREATE INDEX "channel_destinations_connection_id_idx" ON "channel_destinations"("connection_id");

-- CreateIndex
CREATE INDEX "channel_destinations_business_id_idx" ON "channel_destinations"("business_id");

-- CreateIndex
CREATE INDEX "channel_destinations_business_id_platform_idx" ON "channel_destinations"("business_id", "platform");

-- CreateIndex
CREATE INDEX "outbound_content_business_id_status_idx" ON "outbound_content"("business_id", "status");

-- CreateIndex
CREATE INDEX "outbound_content_business_id_content_type_idx" ON "outbound_content"("business_id", "content_type");

-- CreateIndex
CREATE INDEX "outbound_content_business_id_scheduled_at_idx" ON "outbound_content"("business_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "outbound_variants_content_id_idx" ON "outbound_variants"("content_id");

-- CreateIndex
CREATE INDEX "outbound_variants_content_id_platform_idx" ON "outbound_variants"("content_id", "platform");

-- CreateIndex
CREATE INDEX "outbound_deliveries_business_id_idx" ON "outbound_deliveries"("business_id");

-- CreateIndex
CREATE INDEX "outbound_deliveries_business_id_status_idx" ON "outbound_deliveries"("business_id", "status");

-- CreateIndex
CREATE INDEX "outbound_deliveries_content_id_idx" ON "outbound_deliveries"("content_id");

-- CreateIndex
CREATE INDEX "outbound_deliveries_destination_id_idx" ON "outbound_deliveries"("destination_id");

-- CreateIndex
CREATE INDEX "outbound_deliveries_contact_id_idx" ON "outbound_deliveries"("contact_id");

-- CreateIndex
CREATE INDEX "outbound_deliveries_status_scheduled_at_idx" ON "outbound_deliveries"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "outbound_deliveries_status_next_retry_at_idx" ON "outbound_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "delivery_events_delivery_id_idx" ON "delivery_events"("delivery_id");

-- CreateIndex
CREATE INDEX "delivery_events_delivery_id_event_type_idx" ON "delivery_events"("delivery_id", "event_type");

-- CreateIndex
CREATE INDEX "whatsapp_contacts_business_id_last_message_at_idx" ON "whatsapp_contacts"("business_id", "last_message_at");

-- CreateIndex
CREATE INDEX "whatsapp_contacts_contact_id_idx" ON "whatsapp_contacts"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_business_id_phone_number_key" ON "whatsapp_contacts"("business_id", "phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_wamid_key" ON "whatsapp_messages"("wamid");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_delivery_id_key" ON "whatsapp_messages"("delivery_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_business_id_whatsapp_contact_id_created_a_idx" ON "whatsapp_messages"("business_id", "whatsapp_contact_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_business_id_created_at_idx" ON "whatsapp_messages"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_status_scheduled_at_idx" ON "whatsapp_messages"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "social_engagements_business_id_platform_ai_handled_idx" ON "social_engagements"("business_id", "platform", "ai_handled");

-- CreateIndex
CREATE INDEX "social_engagements_business_id_created_at_idx" ON "social_engagements"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "automations_business_id_trigger_idx" ON "automations"("business_id", "trigger");

-- CreateIndex
CREATE INDEX "cross_module_workflows_business_id_idx" ON "cross_module_workflows"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "cross_module_workflows_business_id_workflow_key_key" ON "cross_module_workflows"("business_id", "workflow_key");

-- CreateIndex
CREATE INDEX "scheduled_agent_jobs_status_scheduled_for_idx" ON "scheduled_agent_jobs"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_agent_jobs_business_id_entity_id_checkpoint_key" ON "scheduled_agent_jobs"("business_id", "entity_id", "checkpoint");

-- CreateIndex
CREATE INDEX "activities_business_id_occurred_at_idx" ON "activities"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_business_id_category_occurred_at_idx" ON "activities"("business_id", "category", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_business_id_entity_type_entity_id_idx" ON "activities"("business_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "activities_business_id_contact_id_occurred_at_idx" ON "activities"("business_id", "contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "projects_business_id_idx" ON "projects"("business_id");

-- CreateIndex
CREATE INDEX "projects_business_id_status_idx" ON "projects"("business_id", "status");

-- CreateIndex
CREATE INDEX "projects_goal_id_idx" ON "projects"("goal_id");

-- CreateIndex
CREATE INDEX "project_tasks_project_id_idx" ON "project_tasks"("project_id");

-- CreateIndex
CREATE INDEX "project_tasks_business_id_idx" ON "project_tasks"("business_id");

-- CreateIndex
CREATE INDEX "project_tasks_project_id_status_idx" ON "project_tasks"("project_id", "status");

-- CreateIndex
CREATE INDEX "project_tasks_project_id_position_idx" ON "project_tasks"("project_id", "position");

-- CreateIndex
CREATE INDEX "time_entries_business_id_idx" ON "time_entries"("business_id");

-- CreateIndex
CREATE INDEX "time_entries_business_id_user_id_idx" ON "time_entries"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "time_entries_business_id_project_id_idx" ON "time_entries"("business_id", "project_id");

-- CreateIndex
CREATE INDEX "time_entries_business_id_billable_billed_idx" ON "time_entries"("business_id", "billable", "billed");

-- CreateIndex
CREATE INDEX "time_entries_business_id_start_time_idx" ON "time_entries"("business_id", "start_time");

-- CreateIndex
CREATE UNIQUE INDEX "project_templates_product_id_key" ON "project_templates"("product_id");

-- CreateIndex
CREATE INDEX "project_templates_business_id_idx" ON "project_templates"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_plans_ai_plan_id_key" ON "project_plans"("ai_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_plans_project_id_key" ON "project_plans"("project_id");

-- CreateIndex
CREATE INDEX "project_plans_business_id_status_idx" ON "project_plans"("business_id", "status");

-- CreateIndex
CREATE INDEX "project_plan_events_plan_id_sort_order_idx" ON "project_plan_events"("plan_id", "sort_order");

-- CreateIndex
CREATE INDEX "project_plan_events_plan_id_status_idx" ON "project_plan_events"("plan_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_business_id_idx" ON "support_tickets"("business_id");

-- CreateIndex
CREATE INDEX "support_tickets_business_id_status_idx" ON "support_tickets"("business_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_contact_id_idx" ON "support_tickets"("contact_id");

-- CreateIndex
CREATE INDEX "support_tickets_org_unit_id_idx" ON "support_tickets"("org_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_subdomain_key" ON "sites"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "sites_business_id_key" ON "sites"("business_id");

-- CreateIndex
CREATE INDEX "autopilot_tasks_business_id_status_idx" ON "autopilot_tasks"("business_id", "status");

-- CreateIndex
CREATE INDEX "autopilot_tasks_business_id_scheduled_for_idx" ON "autopilot_tasks"("business_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "delegation_loops_business_id_enabled_idx" ON "delegation_loops"("business_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "delegation_loops_business_id_loop_type_key" ON "delegation_loops"("business_id", "loop_type");

-- CreateIndex
CREATE INDEX "delegation_loop_runs_loop_id_started_at_idx" ON "delegation_loop_runs"("loop_id", "started_at");

-- CreateIndex
CREATE INDEX "delegation_loop_runs_business_id_started_at_idx" ON "delegation_loop_runs"("business_id", "started_at");

-- CreateIndex
CREATE INDEX "notifications_business_id_read_created_at_idx" ON "notifications"("business_id", "read", "created_at");

-- CreateIndex
CREATE INDEX "customer_notification_logs_business_id_created_at_idx" ON "customer_notification_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_notification_logs_business_id_type_idx" ON "customer_notification_logs"("business_id", "type");

-- CreateIndex
CREATE INDEX "customer_notification_logs_business_id_status_idx" ON "customer_notification_logs"("business_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_business_id_status_idx" ON "subscriptions"("business_id", "status");

-- CreateIndex
CREATE INDEX "subscription_payments_business_id_idx" ON "subscription_payments"("business_id");

-- CreateIndex
CREATE INDEX "subscription_payments_subscription_id_idx" ON "subscription_payments"("subscription_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_business_id_created_at_idx" ON "ai_usage_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_business_id_feature_idx" ON "ai_usage_logs"("business_id", "feature");

-- CreateIndex
CREATE INDEX "ai_usage_logs_business_id_provider_idx" ON "ai_usage_logs"("business_id", "provider");

-- CreateIndex
CREATE INDEX "ai_usage_logs_user_id_created_at_idx" ON "ai_usage_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_alerts_business_id_type_idx" ON "ai_usage_alerts"("business_id", "type");

-- CreateIndex
CREATE INDEX "ai_usage_alerts_notified_triggered_at_idx" ON "ai_usage_alerts"("notified", "triggered_at");

-- CreateIndex
CREATE INDEX "expense_categories_business_id_idx" ON "expense_categories"("business_id");

-- CreateIndex
CREATE INDEX "expense_categories_business_id_chart_of_account_id_idx" ON "expense_categories"("business_id", "chart_of_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_business_id_name_key" ON "expense_categories"("business_id", "name");

-- CreateIndex
CREATE INDEX "expenses_business_id_date_idx" ON "expenses"("business_id", "date");

-- CreateIndex
CREATE INDEX "expenses_business_id_category_id_idx" ON "expenses"("business_id", "category_id");

-- CreateIndex
CREATE INDEX "expenses_business_id_vendor_idx" ON "expenses"("business_id", "vendor");

-- CreateIndex
CREATE INDEX "expenses_business_id_project_id_idx" ON "expenses"("business_id", "project_id");

-- CreateIndex
CREATE INDEX "expenses_business_id_contact_id_idx" ON "expenses"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "expenses_business_id_service_id_idx" ON "expenses"("business_id", "service_id");

-- CreateIndex
CREATE INDEX "expenses_business_id_status_due_date_idx" ON "expenses"("business_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "expenses_business_id_recurring_expense_id_idx" ON "expenses"("business_id", "recurring_expense_id");

-- CreateIndex
CREATE INDEX "recurring_expenses_business_id_is_active_idx" ON "recurring_expenses"("business_id", "is_active");

-- CreateIndex
CREATE INDEX "recurring_expenses_business_id_next_run_date_idx" ON "recurring_expenses"("business_id", "next_run_date");

-- CreateIndex
CREATE INDEX "delivery_notes_business_id_idx" ON "delivery_notes"("business_id");

-- CreateIndex
CREATE INDEX "delivery_notes_business_id_invoice_id_idx" ON "delivery_notes"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "delivery_notes_business_id_status_idx" ON "delivery_notes"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_business_id_dn_number_key" ON "delivery_notes"("business_id", "dn_number");

-- CreateIndex
CREATE INDEX "goods_receipts_business_id_idx" ON "goods_receipts"("business_id");

-- CreateIndex
CREATE INDEX "goods_receipts_business_id_purchase_order_id_idx" ON "goods_receipts"("business_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipts_business_id_status_idx" ON "goods_receipts"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_business_id_gr_number_key" ON "goods_receipts"("business_id", "gr_number");

-- CreateIndex
CREATE INDEX "stock_counts_business_id_idx" ON "stock_counts"("business_id");

-- CreateIndex
CREATE INDEX "stock_counts_business_id_status_idx" ON "stock_counts"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_business_id_count_number_key" ON "stock_counts"("business_id", "count_number");

-- CreateIndex
CREATE INDEX "receipts_business_id_idx" ON "receipts"("business_id");

-- CreateIndex
CREATE INDEX "receipts_business_id_invoice_id_idx" ON "receipts"("business_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_business_id_receipt_number_key" ON "receipts"("business_id", "receipt_number");

-- CreateIndex
CREATE INDEX "expense_budgets_business_id_month_year_idx" ON "expense_budgets"("business_id", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "expense_budgets_business_id_category_id_month_year_key" ON "expense_budgets"("business_id", "category_id", "month", "year");

-- CreateIndex
CREATE INDEX "recurring_invoices_business_id_status_idx" ON "recurring_invoices"("business_id", "status");

-- CreateIndex
CREATE INDEX "recurring_invoices_business_id_next_run_date_idx" ON "recurring_invoices"("business_id", "next_run_date");

-- CreateIndex
CREATE INDEX "email_campaigns_business_id_status_idx" ON "email_campaigns"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_briefings_campaign_id_key" ON "campaign_briefings"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_briefings_business_id_idx" ON "campaign_briefings"("business_id");

-- CreateIndex
CREATE INDEX "email_campaign_contacts_business_id_idx" ON "email_campaign_contacts"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_campaign_contacts_campaign_id_contact_id_key" ON "email_campaign_contacts"("campaign_id", "contact_id");

-- CreateIndex
CREATE INDEX "lead_forms_business_id_idx" ON "lead_forms"("business_id");

-- CreateIndex
CREATE INDEX "google_form_mappings_business_id_idx" ON "google_form_mappings"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "google_form_mappings_business_id_form_id_key" ON "google_form_mappings"("business_id", "form_id");

-- CreateIndex
CREATE INDEX "lead_form_submissions_form_id_idx" ON "lead_form_submissions"("form_id");

-- CreateIndex
CREATE INDEX "lead_form_submissions_business_id_created_at_idx" ON "lead_form_submissions"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "business_templates_name_key" ON "business_templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "business_template_usages_business_id_template_id_key" ON "business_template_usages"("business_id", "template_id");

-- CreateIndex
CREATE INDEX "landing_pages_business_id_idx" ON "landing_pages"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "landing_pages_business_id_slug_key" ON "landing_pages"("business_id", "slug");

-- CreateIndex
CREATE INDEX "courses_category_idx" ON "courses"("category");

-- CreateIndex
CREATE UNIQUE INDEX "course_enrollments_course_id_business_id_key" ON "course_enrollments"("course_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "cohort_members_cohort_id_business_id_key" ON "cohort_members"("cohort_id", "business_id");

-- CreateIndex
CREATE INDEX "community_posts_business_id_created_at_idx" ON "community_posts"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_comments_post_id_idx" ON "community_comments"("post_id");

-- CreateIndex
CREATE INDEX "network_connections_from_business_id_idx" ON "network_connections"("from_business_id");

-- CreateIndex
CREATE INDEX "network_connections_to_business_id_idx" ON "network_connections"("to_business_id");

-- CreateIndex
CREATE UNIQUE INDEX "network_connections_from_business_id_to_business_id_type_key" ON "network_connections"("from_business_id", "to_business_id", "type");

-- CreateIndex
CREATE INDEX "endorsements_from_business_id_idx" ON "endorsements"("from_business_id");

-- CreateIndex
CREATE INDEX "endorsements_to_business_id_idx" ON "endorsements"("to_business_id");

-- CreateIndex
CREATE UNIQUE INDEX "endorsements_from_business_id_to_business_id_skill_key" ON "endorsements"("from_business_id", "to_business_id", "skill");

-- CreateIndex
CREATE INDEX "conversations_participant_a_id_idx" ON "conversations"("participant_a_id");

-- CreateIndex
CREATE INDEX "conversations_participant_b_id_idx" ON "conversations"("participant_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_participant_a_id_participant_b_id_key" ON "conversations"("participant_a_id", "participant_b_id");

-- CreateIndex
CREATE INDEX "direct_messages_conversation_id_created_at_idx" ON "direct_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "direct_messages_sender_business_id_idx" ON "direct_messages"("sender_business_id");

-- CreateIndex
CREATE INDEX "collaboration_requests_from_business_id_idx" ON "collaboration_requests"("from_business_id");

-- CreateIndex
CREATE INDEX "collaboration_requests_to_business_id_idx" ON "collaboration_requests"("to_business_id");

-- CreateIndex
CREATE INDEX "collaboration_requests_status_idx" ON "collaboration_requests"("status");

-- CreateIndex
CREATE INDEX "community_notifications_business_id_is_read_idx" ON "community_notifications"("business_id", "is_read");

-- CreateIndex
CREATE INDEX "community_notifications_business_id_created_at_idx" ON "community_notifications"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "match_feedback_business_id_idx" ON "match_feedback"("business_id");

-- CreateIndex
CREATE INDEX "match_feedback_business_id_feedback_idx" ON "match_feedback"("business_id", "feedback");

-- CreateIndex
CREATE UNIQUE INDEX "match_feedback_business_id_target_business_id_key" ON "match_feedback"("business_id", "target_business_id");

-- CreateIndex
CREATE INDEX "relationship_insight_dismissals_business_id_idx" ON "relationship_insight_dismissals"("business_id");

-- CreateIndex
CREATE INDEX "relationship_insight_dismissals_business_id_snoozed_until_idx" ON "relationship_insight_dismissals"("business_id", "snoozed_until");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_insight_dismissals_business_id_target_business_key" ON "relationship_insight_dismissals"("business_id", "target_business_id");

-- CreateIndex
CREATE INDEX "marketplace_listings_business_id_idx" ON "marketplace_listings"("business_id");

-- CreateIndex
CREATE INDEX "marketplace_listings_market_reach_idx" ON "marketplace_listings"("market_reach");

-- CreateIndex
CREATE INDEX "fulfillment_routes_business_id_idx" ON "fulfillment_routes"("business_id");

-- CreateIndex
CREATE INDEX "fulfillment_routes_order_id_idx" ON "fulfillment_routes"("order_id");

-- CreateIndex
CREATE INDEX "shipping_zones_business_id_idx" ON "shipping_zones"("business_id");

-- CreateIndex
CREATE INDEX "warehouses_business_id_idx" ON "warehouses"("business_id");

-- CreateIndex
CREATE INDEX "inventory_stocks_business_id_idx" ON "inventory_stocks"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stocks_product_id_warehouse_id_key" ON "inventory_stocks"("product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_movements_business_id_idx" ON "stock_movements"("business_id");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_idx" ON "stock_movements"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_orders_order_number_key" ON "marketplace_orders"("order_number");

-- CreateIndex
CREATE INDEX "marketplace_orders_business_id_idx" ON "marketplace_orders"("business_id");

-- CreateIndex
CREATE INDEX "marketplace_orders_status_idx" ON "marketplace_orders"("status");

-- CreateIndex
CREATE INDEX "marketplace_order_items_order_id_idx" ON "marketplace_order_items"("order_id");

-- CreateIndex
CREATE INDEX "shipments_business_id_idx" ON "shipments"("business_id");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "customs_declarations_business_id_idx" ON "customs_declarations"("business_id");

-- CreateIndex
CREATE INDEX "pre_orders_business_id_idx" ON "pre_orders"("business_id");

-- CreateIndex
CREATE INDEX "pre_orders_status_idx" ON "pre_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "purchase_orders_business_id_idx" ON "purchase_orders"("business_id");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_connection_id_idx" ON "purchase_orders"("supplier_connection_id");

-- CreateIndex
CREATE INDEX "crm_sequences_business_id_idx" ON "crm_sequences"("business_id");

-- CreateIndex
CREATE INDEX "crm_sequence_enrollments_sequence_id_idx" ON "crm_sequence_enrollments"("sequence_id");

-- CreateIndex
CREATE INDEX "crm_sequence_enrollments_contact_id_idx" ON "crm_sequence_enrollments"("contact_id");

-- CreateIndex
CREATE INDEX "crm_sequence_enrollments_status_next_step_at_idx" ON "crm_sequence_enrollments"("status", "next_step_at");

-- CreateIndex
CREATE INDEX "sequence_attributions_business_id_sequence_id_idx" ON "sequence_attributions"("business_id", "sequence_id");

-- CreateIndex
CREATE INDEX "sequence_attributions_business_id_won_at_idx" ON "sequence_attributions"("business_id", "won_at");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_attributions_deal_id_key" ON "sequence_attributions"("deal_id");

-- CreateIndex
CREATE INDEX "contact_momentum_business_id_idx" ON "contact_momentum"("business_id");

-- CreateIndex
CREATE INDEX "contact_momentum_business_id_score_idx" ON "contact_momentum"("business_id", "score");

-- CreateIndex
CREATE INDEX "contact_momentum_business_id_calculated_at_idx" ON "contact_momentum"("business_id", "calculated_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_momentum_business_id_contact_id_key" ON "contact_momentum"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_momentum_snapshots_business_id_contact_id_idx" ON "contact_momentum_snapshots"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_momentum_snapshots_business_id_snapshot_date_idx" ON "contact_momentum_snapshots"("business_id", "snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "contact_momentum_snapshots_business_id_contact_id_snapshot__key" ON "contact_momentum_snapshots"("business_id", "contact_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "momentum_recommendations_business_id_status_idx" ON "momentum_recommendations"("business_id", "status");

-- CreateIndex
CREATE INDEX "momentum_recommendations_business_id_contact_id_idx" ON "momentum_recommendations"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "momentum_recommendations_business_id_scheduled_for_idx" ON "momentum_recommendations"("business_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "momentum_recommendations_business_id_created_at_idx" ON "momentum_recommendations"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "api_keys_business_id_idx" ON "api_keys"("business_id");

-- CreateIndex
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "business_plans_business_id_idx" ON "business_plans"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_plans_business_id_version_key" ON "business_plans"("business_id", "version");

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
CREATE UNIQUE INDEX "sales_profiles_guidance_profile_id_key" ON "sales_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "sales_profiles_guidance_profile_id_idx" ON "sales_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_strategy_profiles_guidance_profile_id_key" ON "marketing_strategy_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "marketing_strategy_profiles_guidance_profile_id_idx" ON "marketing_strategy_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "people_profiles_guidance_profile_id_key" ON "people_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "people_profiles_guidance_profile_id_idx" ON "people_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "technology_profiles_guidance_profile_id_key" ON "technology_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "technology_profiles_guidance_profile_id_idx" ON "technology_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "partnerships_profiles_guidance_profile_id_key" ON "partnerships_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "partnerships_profiles_guidance_profile_id_idx" ON "partnerships_profiles"("guidance_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "intellectual_property_profiles_guidance_profile_id_key" ON "intellectual_property_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "intellectual_property_profiles_guidance_profile_id_idx" ON "intellectual_property_profiles"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "assessment_results_guidance_profile_id_idx" ON "assessment_results"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "assessment_results_guidance_profile_id_created_at_idx" ON "assessment_results"("guidance_profile_id", "created_at");

-- CreateIndex
CREATE INDEX "guidance_assessments_business_id_idx" ON "guidance_assessments"("business_id");

-- CreateIndex
CREATE INDEX "guidance_assessments_business_id_created_at_idx" ON "guidance_assessments"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "guidance_recommendations_guidance_profile_id_idx" ON "guidance_recommendations"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "guidance_recommendations_guidance_profile_id_status_idx" ON "guidance_recommendations"("guidance_profile_id", "status");

-- CreateIndex
CREATE INDEX "guidance_recommendations_guidance_profile_id_priority_idx" ON "guidance_recommendations"("guidance_profile_id", "priority");

-- CreateIndex
CREATE INDEX "guidance_recommendations_assessment_id_idx" ON "guidance_recommendations"("assessment_id");

-- CreateIndex
CREATE INDEX "roadmap_items_guidance_profile_id_idx" ON "roadmap_items"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "roadmap_items_guidance_profile_id_sequence_order_idx" ON "roadmap_items"("guidance_profile_id", "sequence_order");

-- CreateIndex
CREATE INDEX "roadmap_items_guidance_profile_id_status_idx" ON "roadmap_items"("guidance_profile_id", "status");

-- CreateIndex
CREATE INDEX "roadmap_items_assessment_id_idx" ON "roadmap_items"("assessment_id");

-- CreateIndex
CREATE INDEX "progress_snapshots_guidance_profile_id_idx" ON "progress_snapshots"("guidance_profile_id");

-- CreateIndex
CREATE INDEX "progress_snapshots_guidance_profile_id_snapshot_date_idx" ON "progress_snapshots"("guidance_profile_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "promo_codes_business_id_idx" ON "promo_codes"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_business_id_code_key" ON "promo_codes"("business_id", "code");

-- CreateIndex
CREATE INDEX "product_reviews_business_id_idx" ON "product_reviews"("business_id");

-- CreateIndex
CREATE INDEX "product_reviews_business_id_product_id_idx" ON "product_reviews"("business_id", "product_id");

-- CreateIndex
CREATE INDEX "product_reviews_business_id_status_idx" ON "product_reviews"("business_id", "status");

-- CreateIndex
CREATE INDEX "product_reviews_product_id_status_idx" ON "product_reviews"("product_id", "status");

-- CreateIndex
CREATE INDEX "business_profile_versions_business_id_idx" ON "business_profile_versions"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_profile_versions_business_id_version_number_key" ON "business_profile_versions"("business_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "document_categories_slug_key" ON "document_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_slug_key" ON "document_types"("slug");

-- CreateIndex
CREATE INDEX "document_types_category_id_idx" ON "document_types"("category_id");

-- CreateIndex
CREATE INDEX "document_templates_document_type_id_idx" ON "document_templates"("document_type_id");

-- CreateIndex
CREATE INDEX "document_clauses_template_id_idx" ON "document_clauses"("template_id");

-- CreateIndex
CREATE INDEX "clause_variants_clause_id_idx" ON "clause_variants"("clause_id");

-- CreateIndex
CREATE INDEX "document_instances_business_id_idx" ON "document_instances"("business_id");

-- CreateIndex
CREATE INDEX "document_instances_business_id_document_type_id_idx" ON "document_instances"("business_id", "document_type_id");

-- CreateIndex
CREATE INDEX "document_instances_business_id_status_idx" ON "document_instances"("business_id", "status");

-- CreateIndex
CREATE INDEX "document_instances_business_id_health_status_idx" ON "document_instances"("business_id", "health_status");

-- CreateIndex
CREATE INDEX "document_versions_instance_id_idx" ON "document_versions"("instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_instance_id_version_number_key" ON "document_versions"("instance_id", "version_number");

-- CreateIndex
CREATE INDEX "document_sections_instance_id_idx" ON "document_sections"("instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_sections_instance_id_section_key_key" ON "document_sections"("instance_id", "section_key");

-- CreateIndex
CREATE INDEX "document_change_logs_business_id_idx" ON "document_change_logs"("business_id");

-- CreateIndex
CREATE INDEX "document_change_logs_instance_id_idx" ON "document_change_logs"("instance_id");

-- CreateIndex
CREATE INDEX "review_tasks_business_id_idx" ON "review_tasks"("business_id");

-- CreateIndex
CREATE INDEX "review_tasks_instance_id_idx" ON "review_tasks"("instance_id");

-- CreateIndex
CREATE INDEX "review_tasks_business_id_status_idx" ON "review_tasks"("business_id", "status");

-- CreateIndex
CREATE INDEX "impact_rules_document_type_id_idx" ON "impact_rules"("document_type_id");

-- CreateIndex
CREATE INDEX "impact_rules_profile_field_idx" ON "impact_rules"("profile_field");

-- CreateIndex
CREATE INDEX "org_standards_business_id_idx" ON "org_standards"("business_id");

-- CreateIndex
CREATE INDEX "output_templates_business_id_idx" ON "output_templates"("business_id");

-- CreateIndex
CREATE INDEX "output_templates_business_id_category_idx" ON "output_templates"("business_id", "category");

-- CreateIndex
CREATE INDEX "output_templates_business_id_category_is_default_idx" ON "output_templates"("business_id", "category", "is_default");

-- CreateIndex
CREATE INDEX "intake_submissions_business_id_status_created_at_idx" ON "intake_submissions"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "intake_submissions_business_id_category_idx" ON "intake_submissions"("business_id", "category");

-- CreateIndex
CREATE INDEX "qualification_journeys_business_id_status_idx" ON "qualification_journeys"("business_id", "status");

-- CreateIndex
CREATE INDEX "qualification_journeys_business_id_created_at_idx" ON "qualification_journeys"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "qualification_journeys_business_id_customer_email_idx" ON "qualification_journeys"("business_id", "customer_email");

-- CreateIndex
CREATE INDEX "flow_sessions_business_id_idx" ON "flow_sessions"("business_id");

-- CreateIndex
CREATE INDEX "flow_sessions_business_id_updated_at_idx" ON "flow_sessions"("business_id", "updated_at");

-- CreateIndex
CREATE INDEX "flow_sessions_business_id_user_id_idx" ON "flow_sessions"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "supplier_connections_business_id_idx" ON "supplier_connections"("business_id");

-- CreateIndex
CREATE INDEX "supplier_connections_business_id_provider_type_idx" ON "supplier_connections"("business_id", "provider_type");

-- CreateIndex
CREATE INDEX "supplier_products_supplier_connection_id_idx" ON "supplier_products"("supplier_connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_products_supplier_connection_id_external_id_key" ON "supplier_products"("supplier_connection_id", "external_id");

-- CreateIndex
CREATE INDEX "supplier_variants_supplier_product_id_idx" ON "supplier_variants"("supplier_product_id");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_source_links_product_id_idx" ON "product_source_links"("product_id");

-- CreateIndex
CREATE INDEX "product_source_links_supplier_product_id_idx" ON "product_source_links"("supplier_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_cost_profiles_product_id_key" ON "product_cost_profiles"("product_id");

-- CreateIndex
CREATE INDEX "margin_snapshots_product_id_idx" ON "margin_snapshots"("product_id");

-- CreateIndex
CREATE INDEX "margin_snapshots_product_id_created_at_idx" ON "margin_snapshots"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "margin_snapshots_invoice_id_idx" ON "margin_snapshots"("invoice_id");

-- CreateIndex
CREATE INDEX "margin_snapshots_order_id_idx" ON "margin_snapshots"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_execution_logs_idempotency_key_key" ON "ai_execution_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_execution_logs_business_id_created_at_idx" ON "ai_execution_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_execution_logs_business_id_idempotency_key_idx" ON "ai_execution_logs"("business_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "ai_execution_logs_business_id_module_idx" ON "ai_execution_logs"("business_id", "module");

-- CreateIndex
CREATE INDEX "ai_execution_logs_business_id_tool_name_idx" ON "ai_execution_logs"("business_id", "tool_name");

-- CreateIndex
CREATE INDEX "ai_execution_logs_business_id_correlation_id_idx" ON "ai_execution_logs"("business_id", "correlation_id");

-- CreateIndex
CREATE INDEX "ai_execution_logs_plan_id_idx" ON "ai_execution_logs"("plan_id");

-- CreateIndex
CREATE INDEX "ai_execution_logs_plan_step_id_idx" ON "ai_execution_logs"("plan_step_id");

-- CreateIndex
CREATE INDEX "ai_approval_items_business_id_status_idx" ON "ai_approval_items"("business_id", "status");

-- CreateIndex
CREATE INDEX "ai_approval_items_business_id_created_at_idx" ON "ai_approval_items"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_approval_items_business_id_correlation_id_idx" ON "ai_approval_items"("business_id", "correlation_id");

-- CreateIndex
CREATE INDEX "ai_approval_items_plan_id_idx" ON "ai_approval_items"("plan_id");

-- CreateIndex
CREATE INDEX "ai_approval_items_migrated_to_proposal_id_idx" ON "ai_approval_items"("migrated_to_proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "autopilot_settings_business_id_key" ON "autopilot_settings"("business_id");

-- CreateIndex
CREATE INDEX "autopilot_settings_business_id_idx" ON "autopilot_settings"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_autonomy_profiles_business_id_key" ON "business_autonomy_profiles"("business_id");

-- CreateIndex
CREATE INDEX "business_autonomy_profiles_business_id_idx" ON "business_autonomy_profiles"("business_id");

-- CreateIndex
CREATE INDEX "autonomy_daily_spends_business_id_date_idx" ON "autonomy_daily_spends"("business_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_daily_spends_business_id_date_currency_key" ON "autonomy_daily_spends"("business_id", "date", "currency");

-- CreateIndex
CREATE INDEX "autonomy_daily_action_counts_business_id_date_idx" ON "autonomy_daily_action_counts"("business_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_daily_action_counts_business_id_date_action_type_key" ON "autonomy_daily_action_counts"("business_id", "date", "action_type");

-- CreateIndex
CREATE INDEX "idempotency_keys_business_id_idempotency_key_idx" ON "idempotency_keys"("business_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_business_id_idempotency_key_key" ON "idempotency_keys"("business_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "saga_executions_business_id_status_idx" ON "saga_executions"("business_id", "status");

-- CreateIndex
CREATE INDEX "saga_executions_correlation_id_idx" ON "saga_executions"("correlation_id");

-- CreateIndex
CREATE INDEX "saga_steps_saga_id_step_index_idx" ON "saga_steps"("saga_id", "step_index");

-- CreateIndex
CREATE INDEX "ai_goals_business_id_status_idx" ON "ai_goals"("business_id", "status");

-- CreateIndex
CREATE INDEX "ai_goals_business_id_priority_idx" ON "ai_goals"("business_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ai_plan_results_plan_id_key" ON "ai_plan_results"("plan_id");

-- CreateIndex
CREATE INDEX "ai_plan_results_plan_id_idx" ON "ai_plan_results"("plan_id");

-- CreateIndex
CREATE INDEX "key_cortex_trigger_rules_business_id_event_type_idx" ON "key_cortex_trigger_rules"("business_id", "event_type");

-- CreateIndex
CREATE INDEX "key_cortex_trigger_rules_business_id_enabled_idx" ON "key_cortex_trigger_rules"("business_id", "enabled");

-- CreateIndex
CREATE INDEX "tool_outcome_scores_business_id_tool_name_idx" ON "tool_outcome_scores"("business_id", "tool_name");

-- CreateIndex
CREATE UNIQUE INDEX "tool_outcome_scores_business_id_tool_name_key" ON "tool_outcome_scores"("business_id", "tool_name");

-- CreateIndex
CREATE INDEX "prompt_variants_business_id_variant_key_idx" ON "prompt_variants"("business_id", "variant_key");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_variants_business_id_variant_key_key" ON "prompt_variants"("business_id", "variant_key");

-- CreateIndex
CREATE INDEX "authority_grants_business_id_idx" ON "authority_grants"("business_id");

-- CreateIndex
CREATE INDEX "authority_grants_grantee_type_grantee_id_idx" ON "authority_grants"("grantee_type", "grantee_id");

-- CreateIndex
CREATE INDEX "autonomy_rules_business_id_active_idx" ON "autonomy_rules"("business_id", "active");

-- CreateIndex
CREATE INDEX "autonomy_rules_business_id_action_key_idx" ON "autonomy_rules"("business_id", "action_key");

-- CreateIndex
CREATE INDEX "autonomy_verdicts_business_id_action_key_idx" ON "autonomy_verdicts"("business_id", "action_key");

-- CreateIndex
CREATE INDEX "autonomy_verdicts_business_id_created_at_idx" ON "autonomy_verdicts"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "key_cortex_memories_business_id_type_idx" ON "key_cortex_memories"("business_id", "type");

-- CreateIndex
CREATE INDEX "key_cortex_memories_business_id_created_at_idx" ON "key_cortex_memories"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "key_cortex_memories_business_id_key_idx" ON "key_cortex_memories"("business_id", "key");

-- CreateIndex
CREATE INDEX "cognitive_events_business_id_source_type_idx" ON "cognitive_events"("business_id", "source_type");

-- CreateIndex
CREATE INDEX "cognitive_events_business_id_event_type_idx" ON "cognitive_events"("business_id", "event_type");

-- CreateIndex
CREATE INDEX "cognitive_events_business_id_created_at_idx" ON "cognitive_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "value_constraints_business_id_weight_idx" ON "value_constraints"("business_id", "weight");

-- CreateIndex
CREATE UNIQUE INDEX "value_constraints_business_id_value_key_source_key" ON "value_constraints"("business_id", "value_key", "source");

-- CreateIndex
CREATE INDEX "knowledge_sources_business_id_status_idx" ON "knowledge_sources"("business_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_sources_business_id_source_type_idx" ON "knowledge_sources"("business_id", "source_type");

-- CreateIndex
CREATE INDEX "agent_triggers_business_id_enabled_idx" ON "agent_triggers"("business_id", "enabled");

-- CreateIndex
CREATE INDEX "agent_triggers_business_id_event_pattern_idx" ON "agent_triggers"("business_id", "event_pattern");

-- CreateIndex
CREATE INDEX "agent_messages_business_id_topic_processed_idx" ON "agent_messages"("business_id", "topic", "processed");

-- CreateIndex
CREATE INDEX "agent_messages_created_at_idx" ON "agent_messages"("created_at");

-- CreateIndex
CREATE INDEX "revenue_actions_business_id_status_priority_idx" ON "revenue_actions"("business_id", "status", "priority");

-- CreateIndex
CREATE INDEX "revenue_actions_business_id_type_status_idx" ON "revenue_actions"("business_id", "type", "status");

-- CreateIndex
CREATE INDEX "revenue_actions_business_id_contact_id_idx" ON "revenue_actions"("business_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_actions_business_id_type_related_type_related_id_key" ON "revenue_actions"("business_id", "type", "related_type", "related_id");

-- CreateIndex
CREATE INDEX "command_items_business_id_status_priority_idx" ON "command_items"("business_id", "status", "priority");

-- CreateIndex
CREATE INDEX "command_items_business_id_category_status_idx" ON "command_items"("business_id", "category", "status");

-- CreateIndex
CREATE INDEX "command_items_business_id_source_module_source_id_idx" ON "command_items"("business_id", "source_module", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "command_items_business_id_source_module_source_type_source__key" ON "command_items"("business_id", "source_module", "source_type", "source_id", "action_type");

-- CreateIndex
CREATE INDEX "finance_action_items_business_id_status_severity_idx" ON "finance_action_items"("business_id", "status", "severity");

-- CreateIndex
CREATE INDEX "finance_action_items_business_id_kind_status_idx" ON "finance_action_items"("business_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "finance_action_items_business_id_kind_entity_type_entity_id_key" ON "finance_action_items"("business_id", "kind", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "keyflow_notes_business_id_target_type_target_id_idx" ON "keyflow_notes"("business_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "keyflow_notes_business_id_updated_at_idx" ON "keyflow_notes"("business_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_memories_business_id_category_idx" ON "ai_memories"("business_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ai_memories_business_id_category_key_key" ON "ai_memories"("business_id", "category", "key");

-- CreateIndex
CREATE INDEX "ai_memory_embeddings_business_id_idx" ON "ai_memory_embeddings"("business_id");

-- CreateIndex
CREATE INDEX "ai_memory_embeddings_business_id_source_type_idx" ON "ai_memory_embeddings"("business_id", "source_type");

-- CreateIndex
CREATE INDEX "ai_plans_business_id_status_idx" ON "ai_plans"("business_id", "status");

-- CreateIndex
CREATE INDEX "ai_plans_business_id_created_at_idx" ON "ai_plans"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "business_matches_business_id_computed_at_idx" ON "business_matches"("business_id", "computed_at");

-- CreateIndex
CREATE INDEX "business_matches_target_business_id_idx" ON "business_matches"("target_business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_matches_business_id_target_business_id_key" ON "business_matches"("business_id", "target_business_id");

-- CreateIndex
CREATE INDEX "ai_plan_steps_plan_id_order_idx" ON "ai_plan_steps"("plan_id", "order");

-- CreateIndex
CREATE INDEX "ai_plan_steps_plan_id_status_idx" ON "ai_plan_steps"("plan_id", "status");

-- CreateIndex
CREATE INDEX "ai_plan_steps_status_scheduled_at_idx" ON "ai_plan_steps"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "journey_instances_business_id_status_idx" ON "journey_instances"("business_id", "status");

-- CreateIndex
CREATE INDEX "journey_instances_plan_id_idx" ON "journey_instances"("plan_id");

-- CreateIndex
CREATE INDEX "conversation_threads_business_id_contact_id_idx" ON "conversation_threads"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "conversation_threads_business_id_channel_status_idx" ON "conversation_threads"("business_id", "channel", "status");

-- CreateIndex
CREATE INDEX "conversation_threads_business_id_assigned_role_status_idx" ON "conversation_threads"("business_id", "assigned_role", "status");

-- CreateIndex
CREATE INDEX "conversation_threads_last_message_at_idx" ON "conversation_threads"("last_message_at");

-- CreateIndex
CREATE INDEX "conversation_messages_thread_id_created_at_idx" ON "conversation_messages"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_messages_thread_id_direction_idx" ON "conversation_messages"("thread_id", "direction");

-- CreateIndex
CREATE INDEX "business_goals_business_id_status_idx" ON "business_goals"("business_id", "status");

-- CreateIndex
CREATE INDEX "business_goals_business_id_deadline_idx" ON "business_goals"("business_id", "deadline");

-- CreateIndex
CREATE INDEX "community_quote_requests_from_business_id_created_at_idx" ON "community_quote_requests"("from_business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_quote_requests_to_business_id_status_idx" ON "community_quote_requests"("to_business_id", "status");

-- CreateIndex
CREATE INDEX "community_referrals_from_business_id_created_at_idx" ON "community_referrals"("from_business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_referrals_to_business_id_status_idx" ON "community_referrals"("to_business_id", "status");

-- CreateIndex
CREATE INDEX "community_collaborations_from_business_id_created_at_idx" ON "community_collaborations"("from_business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_collaborations_to_business_id_status_idx" ON "community_collaborations"("to_business_id", "status");

-- CreateIndex
CREATE INDEX "business_messages_from_business_id_to_business_id_created_a_idx" ON "business_messages"("from_business_id", "to_business_id", "created_at");

-- CreateIndex
CREATE INDEX "business_messages_to_business_id_read_idx" ON "business_messages"("to_business_id", "read");

-- CreateIndex
CREATE INDEX "business_messages_thread_id_created_at_idx" ON "business_messages"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "saved_businesses_business_id_created_at_idx" ON "saved_businesses"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "saved_businesses_business_id_saved_business_id_key" ON "saved_businesses"("business_id", "saved_business_id");

-- CreateIndex
CREATE INDEX "community_reviews_reviewee_business_id_created_at_idx" ON "community_reviews"("reviewee_business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_reviews_reviewer_business_id_created_at_idx" ON "community_reviews"("reviewer_business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "community_reviews_reviewer_business_id_transaction_type_tra_key" ON "community_reviews"("reviewer_business_id", "transaction_type", "transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_reputation_business_id_key" ON "business_reputation"("business_id");

-- CreateIndex
CREATE INDEX "business_reputation_reputation_score_idx" ON "business_reputation"("reputation_score");

-- CreateIndex
CREATE INDEX "business_reputation_is_verified_reputation_score_idx" ON "business_reputation"("is_verified", "reputation_score");

-- CreateIndex
CREATE INDEX "community_opportunities_poster_business_id_created_at_idx" ON "community_opportunities"("poster_business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_opportunities_status_created_at_idx" ON "community_opportunities"("status", "created_at");

-- CreateIndex
CREATE INDEX "community_opportunities_type_status_idx" ON "community_opportunities"("type", "status");

-- CreateIndex
CREATE INDEX "community_opportunity_applications_applicant_business_id_cr_idx" ON "community_opportunity_applications"("applicant_business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_opportunity_applications_opportunity_id_status_idx" ON "community_opportunity_applications"("opportunity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "community_opportunity_applications_opportunity_id_applicant_key" ON "community_opportunity_applications"("opportunity_id", "applicant_business_id");

-- CreateIndex
CREATE INDEX "community_partner_programs_initiator_business_id_status_idx" ON "community_partner_programs"("initiator_business_id", "status");

-- CreateIndex
CREATE INDEX "community_partner_programs_partner_business_id_status_idx" ON "community_partner_programs"("partner_business_id", "status");

-- CreateIndex
CREATE INDEX "community_partner_programs_status_created_at_idx" ON "community_partner_programs"("status", "created_at");

-- CreateIndex
CREATE INDEX "community_profile_views_viewed_business_id_created_at_idx" ON "community_profile_views"("viewed_business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_profile_views_viewer_business_id_created_at_idx" ON "community_profile_views"("viewer_business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_network_activities_actor_business_id_created_at_idx" ON "community_network_activities"("actor_business_id", "created_at");

-- CreateIndex
CREATE INDEX "community_network_activities_type_created_at_idx" ON "community_network_activities"("type", "created_at");

-- CreateIndex
CREATE INDEX "community_network_activities_created_at_idx" ON "community_network_activities"("created_at");

-- CreateIndex
CREATE INDEX "community_resource_downloads_product_id_created_at_idx" ON "community_resource_downloads"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "community_resource_downloads_downloader_business_id_created_idx" ON "community_resource_downloads"("downloader_business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_suggestion_events_business_id_created_at_idx" ON "ai_suggestion_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_suggestion_events_business_id_event_type_idx" ON "ai_suggestion_events"("business_id", "event_type");

-- CreateIndex
CREATE INDEX "ai_suggestion_events_business_id_source_idx" ON "ai_suggestion_events"("business_id", "source");

-- CreateIndex
CREATE INDEX "ai_suggestion_events_target_business_id_idx" ON "ai_suggestion_events"("target_business_id");

-- CreateIndex
CREATE INDEX "seo_pages_business_id_idx" ON "seo_pages"("business_id");

-- CreateIndex
CREATE INDEX "seo_pages_business_id_page_type_idx" ON "seo_pages"("business_id", "page_type");

-- CreateIndex
CREATE INDEX "seo_pages_business_id_impressions_idx" ON "seo_pages"("business_id", "impressions");

-- CreateIndex
CREATE UNIQUE INDEX "seo_pages_business_id_path_key" ON "seo_pages"("business_id", "path");

-- CreateIndex
CREATE INDEX "seo_keywords_business_id_idx" ON "seo_keywords"("business_id");

-- CreateIndex
CREATE INDEX "seo_keywords_business_id_is_tracked_idx" ON "seo_keywords"("business_id", "is_tracked");

-- CreateIndex
CREATE INDEX "seo_keywords_business_id_current_position_idx" ON "seo_keywords"("business_id", "current_position");

-- CreateIndex
CREATE UNIQUE INDEX "seo_keywords_business_id_keyword_key" ON "seo_keywords"("business_id", "keyword");

-- CreateIndex
CREATE INDEX "ranking_snapshots_keyword_id_snapshot_date_idx" ON "ranking_snapshots"("keyword_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "ranking_snapshots_page_id_snapshot_date_idx" ON "ranking_snapshots"("page_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "seo_issues_business_id_status_idx" ON "seo_issues"("business_id", "status");

-- CreateIndex
CREATE INDEX "seo_issues_business_id_severity_idx" ON "seo_issues"("business_id", "severity");

-- CreateIndex
CREATE INDEX "seo_issues_business_id_category_idx" ON "seo_issues"("business_id", "category");

-- CreateIndex
CREATE INDEX "content_briefs_business_id_status_idx" ON "content_briefs"("business_id", "status");

-- CreateIndex
CREATE INDEX "content_briefs_business_id_priority_idx" ON "content_briefs"("business_id", "priority");

-- CreateIndex
CREATE INDEX "content_briefs_content_request_id_idx" ON "content_briefs"("content_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_journeys_contact_id_key" ON "customer_journeys"("contact_id");

-- CreateIndex
CREATE INDEX "customer_journeys_business_id_stage_idx" ON "customer_journeys"("business_id", "stage");

-- CreateIndex
CREATE INDEX "customer_journeys_business_id_last_touch_at_idx" ON "customer_journeys"("business_id", "last_touch_at");

-- CreateIndex
CREATE INDEX "customer_journeys_business_id_health_score_idx" ON "customer_journeys"("business_id", "health_score");

-- CreateIndex
CREATE INDEX "journey_touchpoints_business_id_contact_id_occurred_at_idx" ON "journey_touchpoints"("business_id", "contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "journey_touchpoints_business_id_channel_occurred_at_idx" ON "journey_touchpoints"("business_id", "channel", "occurred_at");

-- CreateIndex
CREATE INDEX "journey_touchpoints_business_id_source_occurred_at_idx" ON "journey_touchpoints"("business_id", "source", "occurred_at");

-- CreateIndex
CREATE INDEX "journey_touchpoints_journey_id_occurred_at_idx" ON "journey_touchpoints"("journey_id", "occurred_at");

-- CreateIndex
CREATE INDEX "journey_touchpoints_business_id_campaign_id_idx" ON "journey_touchpoints"("business_id", "campaign_id");

-- CreateIndex
CREATE INDEX "attribution_results_business_id_model_period_end_idx" ON "attribution_results"("business_id", "model", "period_end");

-- CreateIndex
CREATE INDEX "attribution_results_business_id_dimension_model_idx" ON "attribution_results"("business_id", "dimension", "model");

-- CreateIndex
CREATE UNIQUE INDEX "attribution_results_business_id_dimension_dimension_key_mod_key" ON "attribution_results"("business_id", "dimension", "dimension_key", "model", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "growth_insights_business_id_status_created_at_idx" ON "growth_insights"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "growth_insights_business_id_category_status_idx" ON "growth_insights"("business_id", "category", "status");

-- CreateIndex
CREATE INDEX "growth_insights_business_id_severity_status_idx" ON "growth_insights"("business_id", "severity", "status");

-- CreateIndex
CREATE INDEX "auth_rate_limits_bucket_hit_at_idx" ON "auth_rate_limits"("bucket", "hit_at");

-- CreateIndex
CREATE UNIQUE INDEX "business_blueprints_business_id_key" ON "business_blueprints"("business_id");

-- CreateIndex
CREATE INDEX "business_blueprints_completeness_idx" ON "business_blueprints"("completeness");

-- CreateIndex
CREATE INDEX "genome_chat_messages_business_id_created_at_idx" ON "genome_chat_messages"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE INDEX "auth_audit_logs_event_created_at_idx" ON "auth_audit_logs"("event", "created_at");

-- CreateIndex
CREATE INDEX "auth_audit_logs_email_created_at_idx" ON "auth_audit_logs"("email", "created_at");

-- CreateIndex
CREATE INDEX "auth_audit_logs_user_id_created_at_idx" ON "auth_audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "auth_audit_logs_ip_created_at_idx" ON "auth_audit_logs"("ip", "created_at");

-- CreateIndex
CREATE INDEX "contact_audit_entries_business_id_contact_id_created_at_idx" ON "contact_audit_entries"("business_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX "contact_audit_entries_business_id_contact_hash_created_at_idx" ON "contact_audit_entries"("business_id", "contact_hash", "created_at");

-- CreateIndex
CREATE INDEX "contact_audit_entries_business_id_action_created_at_idx" ON "contact_audit_entries"("business_id", "action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_export_jobs_token_key" ON "contact_export_jobs"("token");

-- CreateIndex
CREATE INDEX "contact_export_jobs_business_id_contact_id_idx" ON "contact_export_jobs"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_export_jobs_expires_at_idx" ON "contact_export_jobs"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "site_page_drafts_business_id_key" ON "site_page_drafts"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_page_drafts_preview_token_key" ON "site_page_drafts"("preview_token");

-- CreateIndex
CREATE INDEX "site_page_drafts_business_id_idx" ON "site_page_drafts"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_pages_published_business_id_key" ON "site_pages_published"("business_id");

-- CreateIndex
CREATE INDEX "site_pages_published_business_id_idx" ON "site_pages_published"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_forget_requests_contact_id_key" ON "contact_forget_requests"("contact_id");

-- CreateIndex
CREATE INDEX "contact_forget_requests_business_id_status_idx" ON "contact_forget_requests"("business_id", "status");

-- CreateIndex
CREATE INDEX "contact_forget_requests_status_purge_at_idx" ON "contact_forget_requests"("status", "purge_at");

-- CreateIndex
CREATE INDEX "contact_forget_requests_contact_hash_idx" ON "contact_forget_requests"("contact_hash");

-- CreateIndex
CREATE INDEX "revenue_attributions_business_id_occurred_at_idx" ON "revenue_attributions"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "revenue_attributions_business_id_source_occurred_at_idx" ON "revenue_attributions"("business_id", "source", "occurred_at");

-- CreateIndex
CREATE INDEX "revenue_attributions_business_id_referral_contact_id_idx" ON "revenue_attributions"("business_id", "referral_contact_id");

-- CreateIndex
CREATE INDEX "revenue_attributions_business_id_contact_id_idx" ON "revenue_attributions"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "revenue_attributions_business_id_campaign_id_idx" ON "revenue_attributions"("business_id", "campaign_id");

-- CreateIndex
CREATE INDEX "revenue_attributions_business_id_staff_id_idx" ON "revenue_attributions"("business_id", "staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_attributions_business_id_revenue_type_revenue_id_key" ON "revenue_attributions"("business_id", "revenue_type", "revenue_id");

-- CreateIndex
CREATE INDEX "time_cost_entries_business_id_ref_type_ref_id_idx" ON "time_cost_entries"("business_id", "ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "time_cost_entries_business_id_contact_id_occurred_at_idx" ON "time_cost_entries"("business_id", "contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "time_cost_entries_business_id_staff_id_occurred_at_idx" ON "time_cost_entries"("business_id", "staff_id", "occurred_at");

-- CreateIndex
CREATE INDEX "time_cost_entries_business_id_occurred_at_idx" ON "time_cost_entries"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "storefront_conversion_daily_business_id_day_idx" ON "storefront_conversion_daily"("business_id", "day");

-- CreateIndex
CREATE INDEX "storefront_conversion_daily_business_id_kind_day_idx" ON "storefront_conversion_daily"("business_id", "kind", "day");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_conversion_daily_business_id_day_kind_ref_id_key" ON "storefront_conversion_daily"("business_id", "day", "kind", "ref_id");

-- CreateIndex
CREATE INDEX "public_visitor_events_business_id_visitor_id_idx" ON "public_visitor_events"("business_id", "visitor_id");

-- CreateIndex
CREATE INDEX "public_visitor_events_business_id_contact_id_idx" ON "public_visitor_events"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "public_visitor_events_business_id_type_created_at_idx" ON "public_visitor_events"("business_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "public_events_business_id_ts_idx" ON "public_events"("business_id", "ts");

-- CreateIndex
CREATE INDEX "public_events_business_id_type_ts_idx" ON "public_events"("business_id", "type", "ts");

-- CreateIndex
CREATE INDEX "public_events_business_id_visitor_id_idx" ON "public_events"("business_id", "visitor_id");

-- CreateIndex
CREATE INDEX "public_events_business_id_session_id_idx" ON "public_events"("business_id", "session_id");

-- CreateIndex
CREATE INDEX "public_visitors_business_id_last_seen_at_idx" ON "public_visitors"("business_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "public_visitors_business_id_contact_id_idx" ON "public_visitors"("business_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "presence_insight_snapshots_business_id_key" ON "presence_insight_snapshots"("business_id");

-- CreateIndex
CREATE INDEX "presence_insight_snapshots_business_id_computed_at_idx" ON "presence_insight_snapshots"("business_id", "computed_at");

-- CreateIndex
CREATE INDEX "presence_insight_snapshots_business_id_stale_idx" ON "presence_insight_snapshots"("business_id", "stale");

-- CreateIndex
CREATE INDEX "presence_daily_stats_business_id_day_idx" ON "presence_daily_stats"("business_id", "day");

-- CreateIndex
CREATE INDEX "presence_daily_stats_business_id_metric_day_idx" ON "presence_daily_stats"("business_id", "metric", "day");

-- CreateIndex
CREATE UNIQUE INDEX "presence_daily_stats_business_id_day_metric_dimension_dim_k_key" ON "presence_daily_stats"("business_id", "day", "metric", "dimension", "dim_key");

-- CreateIndex
CREATE INDEX "financial_accounts_business_id_idx" ON "financial_accounts"("business_id");

-- CreateIndex
CREATE INDEX "financial_accounts_business_id_type_idx" ON "financial_accounts"("business_id", "type");

-- CreateIndex
CREATE INDEX "financial_accounts_business_id_is_active_idx" ON "financial_accounts"("business_id", "is_active");

-- CreateIndex
CREATE INDEX "financial_accounts_business_id_chart_of_account_id_idx" ON "financial_accounts"("business_id", "chart_of_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_business_id_name_key" ON "financial_accounts"("business_id", "name");

-- CreateIndex
CREATE INDEX "chart_of_accounts_business_id_idx" ON "chart_of_accounts"("business_id");

-- CreateIndex
CREATE INDEX "chart_of_accounts_business_id_type_idx" ON "chart_of_accounts"("business_id", "type");

-- CreateIndex
CREATE INDEX "chart_of_accounts_business_id_parent_id_idx" ON "chart_of_accounts"("business_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_business_id_system_key_key" ON "chart_of_accounts"("business_id", "system_key");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_reversal_of_id_key" ON "financial_transactions"("reversal_of_id");

-- CreateIndex
CREATE INDEX "financial_transactions_business_id_date_idx" ON "financial_transactions"("business_id", "date");

-- CreateIndex
CREATE INDEX "financial_transactions_business_id_source_type_source_id_idx" ON "financial_transactions"("business_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "financial_transactions_business_id_type_idx" ON "financial_transactions"("business_id", "type");

-- CreateIndex
CREATE INDEX "financial_transactions_business_id_contact_id_idx" ON "financial_transactions"("business_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_business_id_external_ref_key" ON "financial_transactions"("business_id", "external_ref");

-- CreateIndex
CREATE INDEX "ledger_entries_business_id_date_idx" ON "ledger_entries"("business_id", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_business_id_account_id_date_idx" ON "ledger_entries"("business_id", "account_id", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_locked_by_reconciliation_id_idx" ON "ledger_entries"("locked_by_reconciliation_id");

-- CreateIndex
CREATE INDEX "bank_transactions_business_id_account_id_date_idx" ON "bank_transactions"("business_id", "account_id", "date");

-- CreateIndex
CREATE INDEX "bank_transactions_business_id_status_idx" ON "bank_transactions"("business_id", "status");

-- CreateIndex
CREATE INDEX "bank_transactions_business_id_account_id_status_idx" ON "bank_transactions"("business_id", "account_id", "status");

-- CreateIndex
CREATE INDEX "reconciliations_business_id_account_id_period_end_idx" ON "reconciliations"("business_id", "account_id", "period_end");

-- CreateIndex
CREATE INDEX "reconciliations_business_id_status_idx" ON "reconciliations"("business_id", "status");

-- CreateIndex
CREATE INDEX "tax_liabilities_business_id_status_idx" ON "tax_liabilities"("business_id", "status");

-- CreateIndex
CREATE INDEX "tax_liabilities_business_id_type_period_end_idx" ON "tax_liabilities"("business_id", "type", "period_end");

-- CreateIndex
CREATE INDEX "tax_liabilities_amends_tax_liability_id_idx" ON "tax_liabilities"("amends_tax_liability_id");

-- CreateIndex
CREATE INDEX "tax_rates_business_id_is_active_idx" ON "tax_rates"("business_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_business_id_name_key" ON "tax_rates"("business_id", "name");

-- CreateIndex
CREATE INDEX "bank_rules_business_id_idx" ON "bank_rules"("business_id");

-- CreateIndex
CREATE INDEX "bank_rules_business_id_is_active_idx" ON "bank_rules"("business_id", "is_active");

-- CreateIndex
CREATE INDEX "bank_rules_business_id_priority_idx" ON "bank_rules"("business_id", "priority");

-- CreateIndex
CREATE INDEX "recurring_journal_entries_business_id_idx" ON "recurring_journal_entries"("business_id");

-- CreateIndex
CREATE INDEX "recurring_journal_entries_business_id_is_active_idx" ON "recurring_journal_entries"("business_id", "is_active");

-- CreateIndex
CREATE INDEX "recurring_journal_entries_business_id_next_run_date_idx" ON "recurring_journal_entries"("business_id", "next_run_date");

-- CreateIndex
CREATE INDEX "credit_notes_business_id_idx" ON "credit_notes"("business_id");

-- CreateIndex
CREATE INDEX "credit_notes_business_id_invoice_id_idx" ON "credit_notes"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_business_id_status_idx" ON "credit_notes"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_business_id_credit_note_number_key" ON "credit_notes"("business_id", "credit_note_number");

-- CreateIndex
CREATE INDEX "accounting_periods_business_id_status_idx" ON "accounting_periods"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_business_id_year_month_key" ON "accounting_periods"("business_id", "year", "month");

-- CreateIndex
CREATE INDEX "bank_connections_business_id_idx" ON "bank_connections"("business_id");

-- CreateIndex
CREATE INDEX "bank_connections_business_id_status_idx" ON "bank_connections"("business_id", "status");

-- CreateIndex
CREATE INDEX "bank_connections_business_id_financial_account_id_idx" ON "bank_connections"("business_id", "financial_account_id");

-- CreateIndex
CREATE INDEX "exchange_rates_business_id_from_currency_to_currency_idx" ON "exchange_rates"("business_id", "from_currency", "to_currency");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_business_id_from_currency_to_currency_date_key" ON "exchange_rates"("business_id", "from_currency", "to_currency", "date");

-- CreateIndex
CREATE INDEX "fixed_assets_business_id_idx" ON "fixed_assets"("business_id");

-- CreateIndex
CREATE INDEX "fixed_assets_business_id_status_idx" ON "fixed_assets"("business_id", "status");

-- CreateIndex
CREATE INDEX "commercial_document_templates_business_id_type_idx" ON "commercial_document_templates"("business_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_document_templates_business_id_type_name_key" ON "commercial_document_templates"("business_id", "type", "name");

-- CreateIndex
CREATE INDEX "key_commands_business_id_status_created_at_idx" ON "key_commands"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "key_commands_business_id_user_id_created_at_idx" ON "key_commands"("business_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "key_commands_business_id_correlation_id_idx" ON "key_commands"("business_id", "correlation_id");

-- CreateIndex
CREATE INDEX "procurement_requests_business_id_status_idx" ON "procurement_requests"("business_id", "status");

-- CreateIndex
CREATE INDEX "procurement_requests_business_id_created_at_idx" ON "procurement_requests"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "procurement_requests_business_id_supplier_connection_id_idx" ON "procurement_requests"("business_id", "supplier_connection_id");

-- CreateIndex
CREATE INDEX "business_events_business_id_created_at_idx" ON "business_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "business_events_business_id_event_type_idx" ON "business_events"("business_id", "event_type");

-- CreateIndex
CREATE INDEX "business_events_business_id_correlation_id_idx" ON "business_events"("business_id", "correlation_id");

-- CreateIndex
CREATE INDEX "business_events_subject_type_subject_id_idx" ON "business_events"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "business_events_actor_type_actor_id_idx" ON "business_events"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "business_events_business_id_event_type_created_at_idx" ON "business_events"("business_id", "event_type", "created_at");

-- CreateIndex
CREATE INDEX "evidence_business_id_linked_type_linked_id_idx" ON "evidence"("business_id", "linked_type", "linked_id");

-- CreateIndex
CREATE INDEX "evidence_business_id_evidence_type_idx" ON "evidence"("business_id", "evidence_type");

-- CreateIndex
CREATE INDEX "evidence_business_id_submitted_at_idx" ON "evidence"("business_id", "submitted_at");

-- CreateIndex
CREATE INDEX "task_assignments_task_type_task_id_idx" ON "task_assignments"("task_type", "task_id");

-- CreateIndex
CREATE INDEX "task_assignments_assignable_type_assignable_id_idx" ON "task_assignments"("assignable_type", "assignable_id");

-- CreateIndex
CREATE INDEX "task_assignments_assigned_by_idx" ON "task_assignments"("assigned_by");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignments_task_type_task_id_assignable_type_assignab_key" ON "task_assignments"("task_type", "task_id", "assignable_type", "assignable_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_requests_invoice_id_key" ON "content_requests"("invoice_id");

-- CreateIndex
CREATE INDEX "content_requests_business_id_status_idx" ON "content_requests"("business_id", "status");

-- CreateIndex
CREATE INDEX "content_requests_business_id_due_date_idx" ON "content_requests"("business_id", "due_date");

-- CreateIndex
CREATE INDEX "content_requests_business_id_priority_idx" ON "content_requests"("business_id", "priority");

-- CreateIndex
CREATE INDEX "content_delivery_packages_business_id_content_request_id_idx" ON "content_delivery_packages"("business_id", "content_request_id");

-- CreateIndex
CREATE INDEX "content_delivery_packages_business_id_status_idx" ON "content_delivery_packages"("business_id", "status");

-- CreateIndex
CREATE INDEX "call_logs_business_id_contact_id_idx" ON "call_logs"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "call_logs_business_id_caller_id_idx" ON "call_logs"("business_id", "caller_id");

-- CreateIndex
CREATE INDEX "call_logs_business_id_scheduled_at_idx" ON "call_logs"("business_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "call_logs_business_id_outcome_idx" ON "call_logs"("business_id", "outcome");

-- CreateIndex
CREATE INDEX "approval_requests_business_id_status_idx" ON "approval_requests"("business_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_business_id_request_type_idx" ON "approval_requests"("business_id", "request_type");

-- CreateIndex
CREATE INDEX "approval_requests_business_id_requester_id_idx" ON "approval_requests"("business_id", "requester_id");

-- CreateIndex
CREATE INDEX "approval_requests_migrated_to_proposal_id_idx" ON "approval_requests"("migrated_to_proposal_id");

-- CreateIndex
CREATE INDEX "approval_steps_approval_request_id_step_order_idx" ON "approval_steps"("approval_request_id", "step_order");

-- CreateIndex
CREATE INDEX "assets_business_id_type_idx" ON "assets"("business_id", "type");

-- CreateIndex
CREATE INDEX "assets_business_id_tags_idx" ON "assets"("business_id", "tags");

-- CreateIndex
CREATE INDEX "assets_business_id_folder_idx" ON "assets"("business_id", "folder");

-- CreateIndex
CREATE INDEX "assets_business_id_created_at_idx" ON "assets"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "project_milestones_project_id_idx" ON "project_milestones"("project_id");

-- CreateIndex
CREATE INDEX "project_milestones_project_id_due_date_idx" ON "project_milestones"("project_id", "due_date");

-- CreateIndex
CREATE INDEX "retainer_agreements_business_id_idx" ON "retainer_agreements"("business_id");

-- CreateIndex
CREATE INDEX "retainer_agreements_business_id_status_idx" ON "retainer_agreements"("business_id", "status");

-- CreateIndex
CREATE INDEX "retainer_agreements_contact_id_idx" ON "retainer_agreements"("contact_id");

-- CreateIndex
CREATE INDEX "retainer_periods_retainer_id_idx" ON "retainer_periods"("retainer_id");

-- CreateIndex
CREATE INDEX "retainer_periods_retainer_id_period_start_idx" ON "retainer_periods"("retainer_id", "period_start");

-- CreateIndex
CREATE INDEX "retainer_periods_retainer_id_status_idx" ON "retainer_periods"("retainer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "portal_access_token_key" ON "portal_access"("token");

-- CreateIndex
CREATE INDEX "portal_access_business_id_idx" ON "portal_access"("business_id");

-- CreateIndex
CREATE INDEX "portal_access_token_idx" ON "portal_access"("token");

-- CreateIndex
CREATE INDEX "portal_access_contact_id_idx" ON "portal_access"("contact_id");

-- CreateIndex
CREATE INDEX "change_orders_project_id_idx" ON "change_orders"("project_id");

-- CreateIndex
CREATE INDEX "change_orders_project_id_status_idx" ON "change_orders"("project_id", "status");

-- CreateIndex
CREATE INDEX "business_entity_links_business_id_from_type_from_id_idx" ON "business_entity_links"("business_id", "from_type", "from_id");

-- CreateIndex
CREATE INDEX "business_entity_links_business_id_to_type_to_id_idx" ON "business_entity_links"("business_id", "to_type", "to_id");

-- CreateIndex
CREATE INDEX "business_entity_links_business_id_relation_idx" ON "business_entity_links"("business_id", "relation");

-- CreateIndex
CREATE INDEX "business_risks_business_id_category_status_idx" ON "business_risks"("business_id", "category", "status");

-- CreateIndex
CREATE INDEX "cash_reserve_buckets_business_id_status_idx" ON "cash_reserve_buckets"("business_id", "status");

-- CreateIndex
CREATE INDEX "workflow_templates_business_id_module_status_idx" ON "workflow_templates"("business_id", "module", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_business_id_status_idx" ON "workflow_runs"("business_id", "status");

-- CreateIndex
CREATE INDEX "sop_documents_business_id_department_status_idx" ON "sop_documents"("business_id", "department", "status");

-- CreateIndex
CREATE INDEX "marketing_campaign_plans_business_id_status_idx" ON "marketing_campaign_plans"("business_id", "status");

-- CreateIndex
CREATE INDEX "business_initiatives_business_id_status_idx" ON "business_initiatives"("business_id", "status");

-- CreateIndex
CREATE INDEX "business_rules_business_id_module_enabled_idx" ON "business_rules"("business_id", "module", "enabled");

-- CreateIndex
CREATE INDEX "business_signals_business_id_module_status_idx" ON "business_signals"("business_id", "module", "status");

-- CreateIndex
CREATE INDEX "business_signals_business_id_severity_status_idx" ON "business_signals"("business_id", "severity", "status");

-- CreateIndex
CREATE INDEX "business_signals_business_id_entity_type_entity_id_idx" ON "business_signals"("business_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "business_health_snapshots_business_id_area_calculated_at_idx" ON "business_health_snapshots"("business_id", "area", "calculated_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_providers_key_key" ON "integration_providers"("key");

-- CreateIndex
CREATE INDEX "integration_providers_category_status_idx" ON "integration_providers"("category", "status");

-- CreateIndex
CREATE INDEX "integration_connections_business_id_status_idx" ON "integration_connections"("business_id", "status");

-- CreateIndex
CREATE INDEX "integration_connections_provider_key_status_idx" ON "integration_connections"("provider_key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_business_id_provider_key_key" ON "integration_connections"("business_id", "provider_key");

-- CreateIndex
CREATE INDEX "integration_sync_runs_business_id_provider_key_started_at_idx" ON "integration_sync_runs"("business_id", "provider_key", "started_at");

-- CreateIndex
CREATE INDEX "integration_sync_runs_connection_id_started_at_idx" ON "integration_sync_runs"("connection_id", "started_at");

-- CreateIndex
CREATE INDEX "external_object_maps_business_id_internal_type_internal_id_idx" ON "external_object_maps"("business_id", "internal_type", "internal_id");

-- CreateIndex
CREATE INDEX "external_object_maps_provider_key_external_type_idx" ON "external_object_maps"("provider_key", "external_type");

-- CreateIndex
CREATE UNIQUE INDEX "external_object_maps_business_id_provider_key_external_type_key" ON "external_object_maps"("business_id", "provider_key", "external_type", "external_id");

-- CreateIndex
CREATE INDEX "product_events_business_id_event_name_occurred_at_idx" ON "product_events"("business_id", "event_name", "occurred_at");

-- CreateIndex
CREATE INDEX "product_events_user_id_occurred_at_idx" ON "product_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "product_events_module_occurred_at_idx" ON "product_events"("module", "occurred_at");

-- CreateIndex
CREATE INDEX "user_feedback_business_id_module_created_at_idx" ON "user_feedback"("business_id", "module", "created_at");

-- CreateIndex
CREATE INDEX "user_feedback_feedback_type_status_idx" ON "user_feedback"("feedback_type", "status");

-- CreateIndex
CREATE INDEX "user_feedback_status_created_at_idx" ON "user_feedback"("status", "created_at");

-- CreateIndex
CREATE INDEX "feature_usage_daily_day_module_idx" ON "feature_usage_daily"("day", "module");

-- CreateIndex
CREATE UNIQUE INDEX "feature_usage_daily_day_module_feature_key_key" ON "feature_usage_daily"("day", "module", "feature_key");

-- CreateIndex
CREATE INDEX "ai_quality_signals_business_id_module_created_at_idx" ON "ai_quality_signals"("business_id", "module", "created_at");

-- CreateIndex
CREATE INDEX "ai_quality_signals_signal_type_created_at_idx" ON "ai_quality_signals"("signal_type", "created_at");

-- CreateIndex
CREATE INDEX "ai_quality_signals_command_id_idx" ON "ai_quality_signals"("command_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_experiments_key_key" ON "product_experiments"("key");

-- CreateIndex
CREATE INDEX "product_experiments_status_idx" ON "product_experiments"("status");

-- CreateIndex
CREATE INDEX "product_roadmap_insights_source_status_idx" ON "product_roadmap_insights"("source", "status");

-- CreateIndex
CREATE INDEX "product_roadmap_insights_status_opportunity_score_idx" ON "product_roadmap_insights"("status", "opportunity_score");

-- CreateIndex
CREATE INDEX "network_nodes_business_id_nodeType_idx" ON "network_nodes"("business_id", "nodeType");

-- CreateIndex
CREATE INDEX "network_nodes_business_id_ref_type_ref_id_idx" ON "network_nodes"("business_id", "ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "network_edges_business_id_edgeType_idx" ON "network_edges"("business_id", "edgeType");

-- CreateIndex
CREATE INDEX "network_edges_business_id_from_node_id_idx" ON "network_edges"("business_id", "from_node_id");

-- CreateIndex
CREATE INDEX "network_edges_business_id_to_node_id_idx" ON "network_edges"("business_id", "to_node_id");

-- CreateIndex
CREATE INDEX "channel_accounts_business_id_provider_key_status_idx" ON "channel_accounts"("business_id", "provider_key", "status");

-- CreateIndex
CREATE INDEX "interaction_intents_business_id_intentType_created_at_idx" ON "interaction_intents"("business_id", "intentType", "created_at");

-- CreateIndex
CREATE INDEX "interaction_intents_business_id_contact_id_idx" ON "interaction_intents"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "response_drafts_business_id_status_created_at_idx" ON "response_drafts"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "response_drafts_business_id_contact_id_idx" ON "response_drafts"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "consent_records_business_id_contact_id_channel_idx" ON "consent_records"("business_id", "contact_id", "channel");

-- CreateIndex
CREATE INDEX "consent_records_business_id_consent_type_status_idx" ON "consent_records"("business_id", "consent_type", "status");

-- CreateIndex
CREATE INDEX "trigger_definitions_business_id_event_type_enabled_idx" ON "trigger_definitions"("business_id", "event_type", "enabled");

-- CreateIndex
CREATE INDEX "trigger_definitions_is_system_enabled_idx" ON "trigger_definitions"("is_system", "enabled");

-- CreateIndex
CREATE INDEX "media_assets_business_id_media_type_created_at_idx" ON "media_assets"("business_id", "media_type", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_business_id_linked_entity_type_linked_entity_i_idx" ON "media_assets"("business_id", "linked_entity_type", "linked_entity_id");

-- CreateIndex
CREATE INDEX "media_assets_business_id_contact_id_idx" ON "media_assets"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "visual_intakes_business_id_detected_type_status_idx" ON "visual_intakes"("business_id", "detected_type", "status");

-- CreateIndex
CREATE INDEX "visual_intakes_business_id_media_asset_id_idx" ON "visual_intakes"("business_id", "media_asset_id");

-- CreateIndex
CREATE INDEX "extracted_entities_business_id_entity_type_status_idx" ON "extracted_entities"("business_id", "entity_type", "status");

-- CreateIndex
CREATE INDEX "voice_sessions_business_id_user_id_started_at_idx" ON "voice_sessions"("business_id", "user_id", "started_at");

-- CreateIndex
CREATE INDEX "key_voice_preferences_business_id_user_id_idx" ON "key_voice_preferences"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "automation_flows_business_id_deleted_at_status_category_idx" ON "automation_flows"("business_id", "deleted_at", "status", "category");

-- CreateIndex
CREATE INDEX "automation_flows_business_id_deleted_at_created_at_idx" ON "automation_flows"("business_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "automation_flows_business_id_deleted_at_name_idx" ON "automation_flows"("business_id", "deleted_at", "name");

-- CreateIndex
CREATE INDEX "flow_versions_flow_id_status_version_idx" ON "flow_versions"("flow_id", "status", "version");

-- CreateIndex
CREATE UNIQUE INDEX "flow_versions_flow_id_version_key" ON "flow_versions"("flow_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "flow_runs_idempotency_key_key" ON "flow_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "flow_runs_business_id_flow_id_status_started_at_idx" ON "flow_runs"("business_id", "flow_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "flow_runs_business_id_status_started_at_idx" ON "flow_runs"("business_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "flow_runs_business_id_contact_id_idx" ON "flow_runs"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "flow_runs_idempotency_key_idx" ON "flow_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "flow_run_steps_run_id_node_id_idx" ON "flow_run_steps"("run_id", "node_id");

-- CreateIndex
CREATE INDEX "flow_run_steps_run_id_status_idx" ON "flow_run_steps"("run_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "flow_templates_key_key" ON "flow_templates"("key");

-- CreateIndex
CREATE INDEX "flow_templates_category_is_system_idx" ON "flow_templates"("category", "is_system");

-- CreateIndex
CREATE INDEX "flow_templates_is_system_key_idx" ON "flow_templates"("is_system", "key");

-- CreateIndex
CREATE INDEX "automation_outcomes_business_id_flow_id_occurred_at_idx" ON "automation_outcomes"("business_id", "flow_id", "occurred_at");

-- CreateIndex
CREATE INDEX "automation_outcomes_business_id_outcome_type_occurred_at_idx" ON "automation_outcomes"("business_id", "outcome_type", "occurred_at");

-- CreateIndex
CREATE INDEX "bot_agents_business_id_deleted_at_status_idx" ON "bot_agents"("business_id", "deleted_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bot_conversation_states_business_id_thread_id_key" ON "bot_conversation_states"("business_id", "thread_id");

-- CreateIndex
CREATE INDEX "key_agent_configs_business_id_deleted_at_agent_type_status_idx" ON "key_agent_configs"("business_id", "deleted_at", "agent_type", "status");

-- CreateIndex
CREATE INDEX "business_snapshots_business_id_snapshot_type_snapshot_date_idx" ON "business_snapshots"("business_id", "snapshot_type", "snapshot_date");

-- CreateIndex
CREATE INDEX "business_snapshots_snapshot_date_idx" ON "business_snapshots"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "business_snapshots_business_id_snapshot_type_snapshot_date_key" ON "business_snapshots"("business_id", "snapshot_type", "snapshot_date");

-- CreateIndex
CREATE INDEX "maturity_scores_business_id_assessment_date_idx" ON "maturity_scores"("business_id", "assessment_date");

-- CreateIndex
CREATE UNIQUE INDEX "maturity_scores_business_id_assessment_date_key" ON "maturity_scores"("business_id", "assessment_date");

-- CreateIndex
CREATE INDEX "projections_business_id_projection_type_period_start_date_idx" ON "projections"("business_id", "projection_type", "period", "start_date");

-- CreateIndex
CREATE INDEX "connector_accounts_business_id_provider_idx" ON "connector_accounts"("business_id", "provider");

-- CreateIndex
CREATE INDEX "connector_accounts_business_id_service_idx" ON "connector_accounts"("business_id", "service");

-- CreateIndex
CREATE INDEX "key_inbox_threads_business_id_last_message_at_idx" ON "key_inbox_threads"("business_id", "last_message_at");

-- CreateIndex
CREATE INDEX "key_inbox_threads_business_id_channel_idx" ON "key_inbox_threads"("business_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "key_inbox_threads_business_id_channel_external_thread_id_key" ON "key_inbox_threads"("business_id", "channel", "external_thread_id");

-- CreateIndex
CREATE INDEX "key_inbox_messages_business_id_received_at_idx" ON "key_inbox_messages"("business_id", "received_at");

-- CreateIndex
CREATE INDEX "key_inbox_messages_business_id_channel_idx" ON "key_inbox_messages"("business_id", "channel");

-- CreateIndex
CREATE INDEX "key_inbox_messages_thread_id_idx" ON "key_inbox_messages"("thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "key_inbox_messages_business_id_channel_external_message_id_key" ON "key_inbox_messages"("business_id", "channel", "external_message_id");

-- CreateIndex
CREATE INDEX "key_inbox_insights_business_id_period_start_period_end_idx" ON "key_inbox_insights"("business_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "connector_audit_logs_business_id_idx" ON "connector_audit_logs"("business_id");

-- CreateIndex
CREATE INDEX "connector_audit_logs_business_id_created_at_idx" ON "connector_audit_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "connector_audit_logs_connection_id_idx" ON "connector_audit_logs"("connection_id");

-- CreateIndex
CREATE INDEX "keystore_service_categories_business_id_idx" ON "keystore_service_categories"("business_id");

-- CreateIndex
CREATE INDEX "keystore_service_categories_business_id_is_active_idx" ON "keystore_service_categories"("business_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "keystore_service_categories_business_id_slug_key" ON "keystore_service_categories"("business_id", "slug");

-- CreateIndex
CREATE INDEX "keystore_service_listings_business_id_idx" ON "keystore_service_listings"("business_id");

-- CreateIndex
CREATE INDEX "keystore_service_listings_business_id_status_idx" ON "keystore_service_listings"("business_id", "status");

-- CreateIndex
CREATE INDEX "keystore_service_listings_category_id_idx" ON "keystore_service_listings"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "keystore_service_listings_business_id_slug_key" ON "keystore_service_listings"("business_id", "slug");

-- CreateIndex
CREATE INDEX "keystore_service_orders_business_id_idx" ON "keystore_service_orders"("business_id");

-- CreateIndex
CREATE INDEX "keystore_service_orders_business_id_status_idx" ON "keystore_service_orders"("business_id", "status");

-- CreateIndex
CREATE INDEX "keystore_service_orders_user_id_idx" ON "keystore_service_orders"("user_id");

-- CreateIndex
CREATE INDEX "keystore_service_orders_listing_id_idx" ON "keystore_service_orders"("listing_id");

-- CreateIndex
CREATE INDEX "keystore_service_orders_created_at_idx" ON "keystore_service_orders"("created_at");

-- CreateIndex
CREATE INDEX "keystore_service_order_messages_order_id_idx" ON "keystore_service_order_messages"("order_id");

-- CreateIndex
CREATE INDEX "keystore_service_order_messages_order_id_created_at_idx" ON "keystore_service_order_messages"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "cortex_sessions_business_id_status_idx" ON "cortex_sessions"("business_id", "status");

-- CreateIndex
CREATE INDEX "cortex_sessions_business_id_last_accessed_at_idx" ON "cortex_sessions"("business_id", "last_accessed_at");

-- CreateIndex
CREATE INDEX "cortex_sessions_business_id_created_at_idx" ON "cortex_sessions"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "cortex_sessions_business_id_detected_role_idx" ON "cortex_sessions"("business_id", "detected_role");

-- CreateIndex
CREATE INDEX "cortex_sessions_business_id_correlation_id_idx" ON "cortex_sessions"("business_id", "correlation_id");

-- CreateIndex
CREATE INDEX "cortex_action_logs_session_id_created_at_idx" ON "cortex_action_logs"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "cortex_action_logs_business_id_created_at_idx" ON "cortex_action_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "cortex_action_logs_business_id_correlation_id_idx" ON "cortex_action_logs"("business_id", "correlation_id");

-- CreateIndex
CREATE INDEX "cortex_action_logs_business_id_proposal_id_idx" ON "cortex_action_logs"("business_id", "proposal_id");

-- CreateIndex
CREATE INDEX "key_documents_business_id_status_idx" ON "key_documents"("business_id", "status");

-- CreateIndex
CREATE INDEX "key_documents_business_id_created_at_idx" ON "key_documents"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "key_evolution_logs_business_id_user_id_created_at_idx" ON "key_evolution_logs"("business_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "key_evolution_logs_business_id_recommendation_type_idx" ON "key_evolution_logs"("business_id", "recommendation_type");

-- CreateIndex
CREATE INDEX "key_evolution_logs_business_id_created_at_idx" ON "key_evolution_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "key_call_sessions_business_id_status_idx" ON "key_call_sessions"("business_id", "status");

-- CreateIndex
CREATE INDEX "key_call_sessions_business_id_created_at_idx" ON "key_call_sessions"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "key_tuning_logs_business_id_created_at_idx" ON "key_tuning_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "key_user_preferences_business_id_created_at_idx" ON "key_user_preferences"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "key_user_preferences_business_id_user_id_key" ON "key_user_preferences"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "key_interaction_feedback_session_id_created_at_idx" ON "key_interaction_feedback"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "sandbox_execution_logs_business_id_language_idx" ON "sandbox_execution_logs"("business_id", "language");

-- CreateIndex
CREATE INDEX "sandbox_execution_logs_business_id_success_idx" ON "sandbox_execution_logs"("business_id", "success");

-- CreateIndex
CREATE INDEX "sandbox_execution_logs_business_id_created_at_idx" ON "sandbox_execution_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_approval_requests_business_id_status_idx" ON "ai_approval_requests"("business_id", "status");

-- CreateIndex
CREATE INDEX "ai_approval_requests_business_id_user_id_idx" ON "ai_approval_requests"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "ai_approval_requests_correlation_id_idx" ON "ai_approval_requests"("correlation_id");

-- CreateIndex
CREATE INDEX "ai_approval_requests_business_id_created_at_idx" ON "ai_approval_requests"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "prompt_versions_prompt_id_is_active_idx" ON "prompt_versions"("prompt_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_prompt_id_version_key" ON "prompt_versions"("prompt_id", "version");

-- CreateIndex
CREATE INDEX "cognition_memories_business_id_role_id_idx" ON "cognition_memories"("business_id", "role_id");

-- CreateIndex
CREATE INDEX "cognition_memories_business_id_function_id_idx" ON "cognition_memories"("business_id", "function_id");

-- CreateIndex
CREATE INDEX "cognition_memories_business_id_user_response_idx" ON "cognition_memories"("business_id", "user_response");

-- CreateIndex
CREATE INDEX "cognition_memories_created_at_idx" ON "cognition_memories"("created_at");

-- CreateIndex
CREATE INDEX "cognition_sessions_business_id_session_id_idx" ON "cognition_sessions"("business_id", "session_id");

-- CreateIndex
CREATE INDEX "cognition_sessions_business_id_status_idx" ON "cognition_sessions"("business_id", "status");

-- CreateIndex
CREATE INDEX "cognition_sessions_created_at_idx" ON "cognition_sessions"("created_at");

-- CreateIndex
CREATE INDEX "llm_provider_costs_business_id_created_at_idx" ON "llm_provider_costs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_provider_costs_business_id_provider_idx" ON "llm_provider_costs"("business_id", "provider");

-- CreateIndex
CREATE INDEX "llm_provider_costs_business_id_task_category_idx" ON "llm_provider_costs"("business_id", "task_category");

-- CreateIndex
CREATE INDEX "connector_health_logs_business_id_provider_key_checked_at_idx" ON "connector_health_logs"("business_id", "provider_key", "checked_at");

-- CreateIndex
CREATE INDEX "connector_health_logs_business_id_status_idx" ON "connector_health_logs"("business_id", "status");

-- CreateIndex
CREATE INDEX "connector_health_logs_business_id_created_at_idx" ON "connector_health_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "sync_jobs_business_id_status_idx" ON "sync_jobs"("business_id", "status");

-- CreateIndex
CREATE INDEX "sync_jobs_connection_id_started_at_idx" ON "sync_jobs"("connection_id", "started_at");

-- CreateIndex
CREATE INDEX "sync_jobs_business_id_started_at_idx" ON "sync_jobs"("business_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "business_settings_business_id_key" ON "business_settings"("business_id");

-- CreateIndex
CREATE INDEX "business_settings_business_id_idx" ON "business_settings"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_genomes_business_id_key" ON "business_genomes"("business_id");

-- CreateIndex
CREATE INDEX "business_genomes_business_id_idx" ON "business_genomes"("business_id");

-- CreateIndex
CREATE INDEX "activity_logs_business_id_type_idx" ON "activity_logs"("business_id", "type");

-- CreateIndex
CREATE INDEX "activity_logs_business_id_created_at_idx" ON "activity_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "tasks_business_id_status_idx" ON "tasks"("business_id", "status");

-- CreateIndex
CREATE INDEX "tasks_business_id_priority_idx" ON "tasks"("business_id", "priority");

-- CreateIndex
CREATE INDEX "tasks_business_id_due_date_idx" ON "tasks"("business_id", "due_date");

-- CreateIndex
CREATE INDEX "tasks_business_id_created_at_idx" ON "tasks"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_business_id_direction_idx" ON "messages"("business_id", "direction");

-- CreateIndex
CREATE INDEX "messages_business_id_status_idx" ON "messages"("business_id", "status");

-- CreateIndex
CREATE INDEX "messages_business_id_created_at_idx" ON "messages"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "flow_definitions_business_id_status_idx" ON "flow_definitions"("business_id", "status");

-- CreateIndex
CREATE INDEX "flow_definitions_business_id_category_idx" ON "flow_definitions"("business_id", "category");

-- CreateIndex
CREATE INDEX "flow_definitions_business_id_updated_at_idx" ON "flow_definitions"("business_id", "updated_at");

-- CreateIndex
CREATE INDEX "flow_executions_business_id_status_idx" ON "flow_executions"("business_id", "status");

-- CreateIndex
CREATE INDEX "flow_executions_flow_id_started_at_idx" ON "flow_executions"("flow_id", "started_at");

-- CreateIndex
CREATE INDEX "flow_executions_business_id_created_at_idx" ON "flow_executions"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_business_id_status_idx" ON "reports"("business_id", "status");

-- CreateIndex
CREATE INDEX "reports_business_id_created_at_idx" ON "reports"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "reminders_business_id_status_idx" ON "reminders"("business_id", "status");

-- CreateIndex
CREATE INDEX "reminders_business_id_trigger_time_idx" ON "reminders"("business_id", "trigger_time");

-- CreateIndex
CREATE INDEX "reminders_business_id_created_at_idx" ON "reminders"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "workflows_business_id_status_idx" ON "workflows"("business_id", "status");

-- CreateIndex
CREATE INDEX "workflows_business_id_module_status_idx" ON "workflows"("business_id", "module", "status");

-- CreateIndex
CREATE INDEX "workflows_business_id_created_at_idx" ON "workflows"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_business_id_type_idx" ON "documents"("business_id", "type");

-- CreateIndex
CREATE INDEX "documents_business_id_created_at_idx" ON "documents"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_business_id_status_idx" ON "leads"("business_id", "status");

-- CreateIndex
CREATE INDEX "leads_business_id_email_idx" ON "leads"("business_id", "email");

-- CreateIndex
CREATE INDEX "leads_business_id_created_at_idx" ON "leads"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "campaigns_business_id_status_idx" ON "campaigns"("business_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_business_id_created_at_idx" ON "campaigns"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "outbound_campaigns_business_id_status_idx" ON "outbound_campaigns"("business_id", "status");

-- CreateIndex
CREATE INDEX "outbound_campaigns_business_id_created_at_idx" ON "outbound_campaigns"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_tasks_business_id_status_idx" ON "crm_tasks"("business_id", "status");

-- CreateIndex
CREATE INDEX "crm_tasks_business_id_contact_id_idx" ON "crm_tasks"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "crm_tasks_business_id_due_date_idx" ON "crm_tasks"("business_id", "due_date");

-- CreateIndex
CREATE INDEX "crm_tasks_business_id_created_at_idx" ON "crm_tasks"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_activities_business_id_type_idx" ON "crm_activities"("business_id", "type");

-- CreateIndex
CREATE INDEX "crm_activities_business_id_contact_id_idx" ON "crm_activities"("business_id", "contact_id");

-- CreateIndex
CREATE INDEX "crm_activities_business_id_created_at_idx" ON "crm_activities"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_business_id_status_idx" ON "helpdesk_tickets"("business_id", "status");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_business_id_priority_idx" ON "helpdesk_tickets"("business_id", "priority");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_business_id_created_at_idx" ON "helpdesk_tickets"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "_MembershipToSkill_B_index" ON "_MembershipToSkill"("B");

-- CreateIndex
CREATE INDEX "_ServiceToStaffMember_B_index" ON "_ServiceToStaffMember"("B");

-- CreateIndex
CREATE INDEX "_SkillToStaffMember_B_index" ON "_SkillToStaffMember"("B");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_fkey" FOREIGN KEY ("referred_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_assets" ADD CONSTRAINT "business_assets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_terms" ADD CONSTRAINT "contract_terms_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_alerts" ADD CONSTRAINT "contract_alerts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_tags" ADD CONSTRAINT "contract_tags_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_tags_on_contracts" ADD CONSTRAINT "contract_tags_on_contracts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_tags_on_contracts" ADD CONSTRAINT "contract_tags_on_contracts_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "contract_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporal_flow_events" ADD CONSTRAINT "temporal_flow_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_signals" ADD CONSTRAINT "flow_signals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_role_subscriptions" ADD CONSTRAINT "flow_role_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporal_flow_memories" ADD CONSTRAINT "temporal_flow_memories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_evolution_proposals" ADD CONSTRAINT "genome_evolution_proposals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_facts" ADD CONSTRAINT "genome_facts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_evidence" ADD CONSTRAINT "genome_evidence_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_evidence" ADD CONSTRAINT "genome_evidence_fact_id_fkey" FOREIGN KEY ("fact_id") REFERENCES "genome_facts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_signals" ADD CONSTRAINT "genome_signals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_module_readiness" ADD CONSTRAINT "genome_module_readiness_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_recommendations" ADD CONSTRAINT "genome_recommendations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_recommendation_outcomes" ADD CONSTRAINT "genome_recommendation_outcomes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_outcome_learning_windows" ADD CONSTRAINT "genome_outcome_learning_windows_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_experiments" ADD CONSTRAINT "genome_experiments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_departments" ADD CONSTRAINT "genome_departments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_memory_events" ADD CONSTRAINT "genome_memory_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_financial_metrics" ADD CONSTRAINT "genome_financial_metrics_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_finance_snapshots" ADD CONSTRAINT "genome_finance_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_customer_segments" ADD CONSTRAINT "genome_customer_segments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_sales_motions" ADD CONSTRAINT "genome_sales_motions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_customer_sales_snapshots" ADD CONSTRAINT "genome_customer_sales_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_operational_processes" ADD CONSTRAINT "genome_operational_processes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_delivery_capabilities" ADD CONSTRAINT "genome_delivery_capabilities_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_operations_snapshots" ADD CONSTRAINT "genome_operations_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_growth_channels" ADD CONSTRAINT "genome_growth_channels_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_content_strategies" ADD CONSTRAINT "genome_content_strategies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_marketing_snapshots" ADD CONSTRAINT "genome_marketing_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genome_cross_domain_snapshots" ADD CONSTRAINT "genome_cross_domain_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_constitution_versions" ADD CONSTRAINT "business_constitution_versions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_strategies" ADD CONSTRAINT "market_strategies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_sync_cursors" ADD CONSTRAINT "drive_sync_cursors_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_intake_files" ADD CONSTRAINT "drive_intake_files_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_intakes" ADD CONSTRAINT "message_intakes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_intakes" ADD CONSTRAINT "message_intakes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_intakes" ADD CONSTRAINT "message_intakes_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_units"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_roles" ADD CONSTRAINT "job_roles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_assignments" ADD CONSTRAINT "org_assignments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_assignments" ADD CONSTRAINT "org_assignments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_assignments" ADD CONSTRAINT "org_assignments_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_assignments" ADD CONSTRAINT "org_assignments_job_role_id_fkey" FOREIGN KEY ("job_role_id") REFERENCES "job_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_assignments" ADD CONSTRAINT "org_assignments_reports_to_id_fkey" FOREIGN KEY ("reports_to_id") REFERENCES "org_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_rules" ADD CONSTRAINT "delegation_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stages" ADD CONSTRAINT "deal_stages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "deal_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_won_lost_reason_id_fkey" FOREIGN KEY ("won_lost_reason_id") REFERENCES "won_lost_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_from_contact_id_fkey" FOREIGN KEY ("from_contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_to_contact_id_fkey" FOREIGN KEY ("to_contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_shares" ADD CONSTRAINT "contact_shares_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_shares" ADD CONSTRAINT "contact_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_data_issues" ADD CONSTRAINT "contact_data_issues_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_data_issues" ADD CONSTRAINT "contact_data_issues_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "won_lost_reasons" ADD CONSTRAINT "won_lost_reasons_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_external_mappings" ADD CONSTRAINT "contact_external_mappings_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_sync_conflicts" ADD CONSTRAINT "calendar_sync_conflicts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_events" ADD CONSTRAINT "contact_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_events" ADD CONSTRAINT "contact_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_channel_stats" ADD CONSTRAINT "contact_channel_stats_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_channel_stats" ADD CONSTRAINT "contact_channel_stats_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_ai_insights" ADD CONSTRAINT "conversation_ai_insights_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_ai_insights" ADD CONSTRAINT "conversation_ai_insights_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_insight_snapshots" ADD CONSTRAINT "contact_insight_snapshots_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_insight_snapshots" ADD CONSTRAINT "contact_insight_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tasks" ADD CONSTRAINT "contact_tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tasks" ADD CONSTRAINT "contact_tasks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_import_contacts" ADD CONSTRAINT "contact_import_contacts_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "contact_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_import_contacts" ADD CONSTRAINT "contact_import_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_media" ADD CONSTRAINT "contact_media_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_media" ADD CONSTRAINT "contact_media_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_playbooks" ADD CONSTRAINT "contact_playbooks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_playbooks" ADD CONSTRAINT "contact_playbooks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_invoice_id_fkey" FOREIGN KEY ("recurring_invoice_id") REFERENCES "recurring_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availabilities" ADD CONSTRAINT "availabilities_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_members"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_deposit_invoice_id_fkey" FOREIGN KEY ("deposit_invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_destinations" ADD CONSTRAINT "channel_destinations_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_content" ADD CONSTRAINT "outbound_content_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_content" ADD CONSTRAINT "outbound_content_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "outbound_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_variants" ADD CONSTRAINT "outbound_variants_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "outbound_content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "outbound_content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "outbound_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_deliveries" ADD CONSTRAINT "outbound_deliveries_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "channel_destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "outbound_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_whatsapp_contact_id_fkey" FOREIGN KEY ("whatsapp_contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_engagements" ADD CONSTRAINT "social_engagements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_module_workflows" ADD CONSTRAINT "cross_module_workflows_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_agent_jobs" ADD CONSTRAINT "scheduled_agent_jobs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "business_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plans" ADD CONSTRAINT "project_plans_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plans" ADD CONSTRAINT "project_plans_ai_plan_id_fkey" FOREIGN KEY ("ai_plan_id") REFERENCES "ai_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plans" ADD CONSTRAINT "project_plans_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "business_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plans" ADD CONSTRAINT "project_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plan_events" ADD CONSTRAINT "project_plan_events_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "project_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopilot_tasks" ADD CONSTRAINT "autopilot_tasks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_loops" ADD CONSTRAINT "delegation_loops_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_loop_runs" ADD CONSTRAINT "delegation_loop_runs_loop_id_fkey" FOREIGN KEY ("loop_id") REFERENCES "delegation_loops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_loop_runs" ADD CONSTRAINT "delegation_loop_runs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notification_logs" ADD CONSTRAINT "customer_notification_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_chart_of_account_id_fkey" FOREIGN KEY ("chart_of_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_expense_id_fkey" FOREIGN KEY ("recurring_expense_id") REFERENCES "recurring_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_budgets" ADD CONSTRAINT "expense_budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_budgets" ADD CONSTRAINT "expense_budgets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_briefings" ADD CONSTRAINT "campaign_briefings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_contacts" ADD CONSTRAINT "email_campaign_contacts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_contacts" ADD CONSTRAINT "email_campaign_contacts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_form_mappings" ADD CONSTRAINT "google_form_mappings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "lead_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_template_usages" ADD CONSTRAINT "business_template_usages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "business_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_template_usages" ADD CONSTRAINT "business_template_usages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_from_business_id_fkey" FOREIGN KEY ("from_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_to_business_id_fkey" FOREIGN KEY ("to_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_from_business_id_fkey" FOREIGN KEY ("from_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_to_business_id_fkey" FOREIGN KEY ("to_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant_a_id_fkey" FOREIGN KEY ("participant_a_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant_b_id_fkey" FOREIGN KEY ("participant_b_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_business_id_fkey" FOREIGN KEY ("sender_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_requests" ADD CONSTRAINT "collaboration_requests_from_business_id_fkey" FOREIGN KEY ("from_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_requests" ADD CONSTRAINT "collaboration_requests_to_business_id_fkey" FOREIGN KEY ("to_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_notifications" ADD CONSTRAINT "community_notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_feedback" ADD CONSTRAINT "match_feedback_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_feedback" ADD CONSTRAINT "match_feedback_target_business_id_fkey" FOREIGN KEY ("target_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_insight_dismissals" ADD CONSTRAINT "relationship_insight_dismissals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_insight_dismissals" ADD CONSTRAINT "relationship_insight_dismissals_target_business_id_fkey" FOREIGN KEY ("target_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_pre_order_id_fkey" FOREIGN KEY ("pre_order_id") REFERENCES "pre_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_source_link_id_fkey" FOREIGN KEY ("source_link_id") REFERENCES "product_source_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_items" ADD CONSTRAINT "marketplace_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_items" ADD CONSTRAINT "marketplace_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_orders" ADD CONSTRAINT "pre_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_orders" ADD CONSTRAINT "pre_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_connection_id_fkey" FOREIGN KEY ("supplier_connection_id") REFERENCES "supplier_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sequences" ADD CONSTRAINT "crm_sequences_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sequence_enrollments" ADD CONSTRAINT "crm_sequence_enrollments_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "crm_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sequence_enrollments" ADD CONSTRAINT "crm_sequence_enrollments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_attributions" ADD CONSTRAINT "sequence_attributions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "crm_sequence_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_momentum" ADD CONSTRAINT "contact_momentum_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_momentum_snapshots" ADD CONSTRAINT "contact_momentum_snapshots_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "momentum_recommendations" ADD CONSTRAINT "momentum_recommendations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_plans" ADD CONSTRAINT "business_plans_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "sales_profiles" ADD CONSTRAINT "sales_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_strategy_profiles" ADD CONSTRAINT "marketing_strategy_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_profiles" ADD CONSTRAINT "people_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technology_profiles" ADD CONSTRAINT "technology_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnerships_profiles" ADD CONSTRAINT "partnerships_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intellectual_property_profiles" ADD CONSTRAINT "intellectual_property_profiles_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guidance_assessments" ADD CONSTRAINT "guidance_assessments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guidance_recommendations" ADD CONSTRAINT "guidance_recommendations_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guidance_recommendations" ADD CONSTRAINT "guidance_recommendations_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "guidance_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "guidance_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_guidance_profile_id_fkey" FOREIGN KEY ("guidance_profile_id") REFERENCES "business_guidance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profile_versions" ADD CONSTRAINT "business_profile_versions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "document_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_clauses" ADD CONSTRAINT "document_clauses_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_variants" ADD CONSTRAINT "clause_variants_clause_id_fkey" FOREIGN KEY ("clause_id") REFERENCES "document_clauses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_instances" ADD CONSTRAINT "document_instances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_instances" ADD CONSTRAINT "document_instances_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_instances" ADD CONSTRAINT "document_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_instances" ADD CONSTRAINT "document_instances_profile_version_id_fkey" FOREIGN KEY ("profile_version_id") REFERENCES "business_profile_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "document_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "document_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_change_logs" ADD CONSTRAINT "document_change_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_change_logs" ADD CONSTRAINT "document_change_logs_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "document_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "document_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impact_rules" ADD CONSTRAINT "impact_rules_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_standards" ADD CONSTRAINT "org_standards_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "output_templates" ADD CONSTRAINT "output_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_journeys" ADD CONSTRAINT "qualification_journeys_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_sessions" ADD CONSTRAINT "flow_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_connections" ADD CONSTRAINT "supplier_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_connection_id_fkey" FOREIGN KEY ("supplier_connection_id") REFERENCES "supplier_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_variants" ADD CONSTRAINT "supplier_variants_supplier_product_id_fkey" FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_source_links" ADD CONSTRAINT "product_source_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_source_links" ADD CONSTRAINT "product_source_links_supplier_product_id_fkey" FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cost_profiles" ADD CONSTRAINT "product_cost_profiles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "margin_snapshots" ADD CONSTRAINT "margin_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_execution_logs" ADD CONSTRAINT "ai_execution_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_execution_logs" ADD CONSTRAINT "ai_execution_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_items" ADD CONSTRAINT "ai_approval_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_items" ADD CONSTRAINT "ai_approval_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_items" ADD CONSTRAINT "ai_approval_items_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopilot_settings" ADD CONSTRAINT "autopilot_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_autonomy_profiles" ADD CONSTRAINT "business_autonomy_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomy_daily_spends" ADD CONSTRAINT "autonomy_daily_spends_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomy_daily_action_counts" ADD CONSTRAINT "autonomy_daily_action_counts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saga_executions" ADD CONSTRAINT "saga_executions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saga_steps" ADD CONSTRAINT "saga_steps_saga_id_fkey" FOREIGN KEY ("saga_id") REFERENCES "saga_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_goals" ADD CONSTRAINT "ai_goals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plan_results" ADD CONSTRAINT "ai_plan_results_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ai_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plan_results" ADD CONSTRAINT "ai_plan_results_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_cortex_trigger_rules" ADD CONSTRAINT "key_cortex_trigger_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_outcome_scores" ADD CONSTRAINT "tool_outcome_scores_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_variants" ADD CONSTRAINT "prompt_variants_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_grants" ADD CONSTRAINT "authority_grants_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomy_rules" ADD CONSTRAINT "autonomy_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomy_verdicts" ADD CONSTRAINT "autonomy_verdicts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_cortex_memories" ADD CONSTRAINT "key_cortex_memories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cognitive_events" ADD CONSTRAINT "cognitive_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "value_constraints" ADD CONSTRAINT "value_constraints_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_triggers" ADD CONSTRAINT "agent_triggers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_actions" ADD CONSTRAINT "revenue_actions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_items" ADD CONSTRAINT "command_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_action_items" ADD CONSTRAINT "finance_action_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyflow_notes" ADD CONSTRAINT "keyflow_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_memory_embeddings" ADD CONSTRAINT "ai_memory_embeddings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "ai_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_matches" ADD CONSTRAINT "business_matches_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_matches" ADD CONSTRAINT "business_matches_target_business_id_fkey" FOREIGN KEY ("target_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plan_steps" ADD CONSTRAINT "ai_plan_steps_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ai_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_instances" ADD CONSTRAINT "journey_instances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_instances" ADD CONSTRAINT "journey_instances_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ai_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_goals" ADD CONSTRAINT "business_goals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_quote_requests" ADD CONSTRAINT "community_quote_requests_from_business_id_fkey" FOREIGN KEY ("from_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_quote_requests" ADD CONSTRAINT "community_quote_requests_to_business_id_fkey" FOREIGN KEY ("to_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_referrals" ADD CONSTRAINT "community_referrals_from_business_id_fkey" FOREIGN KEY ("from_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_referrals" ADD CONSTRAINT "community_referrals_to_business_id_fkey" FOREIGN KEY ("to_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_collaborations" ADD CONSTRAINT "community_collaborations_from_business_id_fkey" FOREIGN KEY ("from_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_collaborations" ADD CONSTRAINT "community_collaborations_to_business_id_fkey" FOREIGN KEY ("to_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_messages" ADD CONSTRAINT "business_messages_from_business_id_fkey" FOREIGN KEY ("from_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_messages" ADD CONSTRAINT "business_messages_to_business_id_fkey" FOREIGN KEY ("to_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_businesses" ADD CONSTRAINT "saved_businesses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_businesses" ADD CONSTRAINT "saved_businesses_saved_business_id_fkey" FOREIGN KEY ("saved_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reviews" ADD CONSTRAINT "community_reviews_reviewer_business_id_fkey" FOREIGN KEY ("reviewer_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reviews" ADD CONSTRAINT "community_reviews_reviewee_business_id_fkey" FOREIGN KEY ("reviewee_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reputation" ADD CONSTRAINT "business_reputation_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_opportunities" ADD CONSTRAINT "community_opportunities_poster_business_id_fkey" FOREIGN KEY ("poster_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_opportunity_applications" ADD CONSTRAINT "community_opportunity_applications_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "community_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_opportunity_applications" ADD CONSTRAINT "community_opportunity_applications_applicant_business_id_fkey" FOREIGN KEY ("applicant_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_partner_programs" ADD CONSTRAINT "community_partner_programs_initiator_business_id_fkey" FOREIGN KEY ("initiator_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_partner_programs" ADD CONSTRAINT "community_partner_programs_partner_business_id_fkey" FOREIGN KEY ("partner_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_profile_views" ADD CONSTRAINT "community_profile_views_viewer_business_id_fkey" FOREIGN KEY ("viewer_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_profile_views" ADD CONSTRAINT "community_profile_views_viewed_business_id_fkey" FOREIGN KEY ("viewed_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_network_activities" ADD CONSTRAINT "community_network_activities_actor_business_id_fkey" FOREIGN KEY ("actor_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_resource_downloads" ADD CONSTRAINT "community_resource_downloads_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_resource_downloads" ADD CONSTRAINT "community_resource_downloads_downloader_business_id_fkey" FOREIGN KEY ("downloader_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestion_events" ADD CONSTRAINT "ai_suggestion_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestion_events" ADD CONSTRAINT "ai_suggestion_events_target_business_id_fkey" FOREIGN KEY ("target_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_pages" ADD CONSTRAINT "seo_pages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "seo_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_snapshots" ADD CONSTRAINT "ranking_snapshots_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "seo_keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_snapshots" ADD CONSTRAINT "ranking_snapshots_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "seo_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_journeys" ADD CONSTRAINT "customer_journeys_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_journeys" ADD CONSTRAINT "customer_journeys_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_touchpoints" ADD CONSTRAINT "journey_touchpoints_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_touchpoints" ADD CONSTRAINT "journey_touchpoints_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_touchpoints" ADD CONSTRAINT "journey_touchpoints_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "customer_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_results" ADD CONSTRAINT "attribution_results_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_insights" ADD CONSTRAINT "growth_insights_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_blueprints" ADD CONSTRAINT "business_blueprints_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_audit_entries" ADD CONSTRAINT "contact_audit_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_audit_entries" ADD CONSTRAINT "contact_audit_entries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_export_jobs" ADD CONSTRAINT "contact_export_jobs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_export_jobs" ADD CONSTRAINT "contact_export_jobs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page_drafts" ADD CONSTRAINT "site_page_drafts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_pages_published" ADD CONSTRAINT "site_pages_published_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_forget_requests" ADD CONSTRAINT "contact_forget_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_forget_requests" ADD CONSTRAINT "contact_forget_requests_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_attributions" ADD CONSTRAINT "revenue_attributions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_conversion_daily" ADD CONSTRAINT "storefront_conversion_daily_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_visitor_events" ADD CONSTRAINT "public_visitor_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_events" ADD CONSTRAINT "public_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_visitors" ADD CONSTRAINT "public_visitors_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence_insight_snapshots" ADD CONSTRAINT "presence_insight_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence_daily_stats" ADD CONSTRAINT "presence_daily_stats_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_chart_of_account_id_fkey" FOREIGN KEY ("chart_of_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "chart_of_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "financial_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_liabilities" ADD CONSTRAINT "tax_liabilities_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_liabilities" ADD CONSTRAINT "tax_liabilities_amends_tax_liability_id_fkey" FOREIGN KEY ("amends_tax_liability_id") REFERENCES "tax_liabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_entries" ADD CONSTRAINT "recurring_journal_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_document_templates" ADD CONSTRAINT "commercial_document_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_commands" ADD CONSTRAINT "key_commands_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_events" ADD CONSTRAINT "business_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "content_delivery_packages" ADD CONSTRAINT "content_delivery_packages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainer_agreements" ADD CONSTRAINT "retainer_agreements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainer_periods" ADD CONSTRAINT "retainer_periods_retainer_id_fkey" FOREIGN KEY ("retainer_id") REFERENCES "retainer_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access" ADD CONSTRAINT "portal_access_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_entity_links" ADD CONSTRAINT "business_entity_links_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_risks" ADD CONSTRAINT "business_risks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_reserve_buckets" ADD CONSTRAINT "cash_reserve_buckets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_documents" ADD CONSTRAINT "sop_documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_plans" ADD CONSTRAINT "marketing_campaign_plans_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_initiatives" ADD CONSTRAINT "business_initiatives_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_rules" ADD CONSTRAINT "business_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_signals" ADD CONSTRAINT "business_signals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_health_snapshots" ADD CONSTRAINT "business_health_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "automation_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_flow_version_id_fkey" FOREIGN KEY ("flow_version_id") REFERENCES "flow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "automation_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run_steps" ADD CONSTRAINT "flow_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "flow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_snapshots" ADD CONSTRAINT "business_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maturity_scores" ADD CONSTRAINT "maturity_scores_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projections" ADD CONSTRAINT "projections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_inbox_messages" ADD CONSTRAINT "key_inbox_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "key_inbox_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keystore_service_categories" ADD CONSTRAINT "keystore_service_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keystore_service_listings" ADD CONSTRAINT "keystore_service_listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "keystore_service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keystore_service_listings" ADD CONSTRAINT "keystore_service_listings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keystore_service_orders" ADD CONSTRAINT "keystore_service_orders_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "keystore_service_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keystore_service_orders" ADD CONSTRAINT "keystore_service_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keystore_service_order_messages" ADD CONSTRAINT "keystore_service_order_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "keystore_service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cortex_sessions" ADD CONSTRAINT "cortex_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cortex_action_logs" ADD CONSTRAINT "cortex_action_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_documents" ADD CONSTRAINT "key_documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_evolution_logs" ADD CONSTRAINT "key_evolution_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_call_sessions" ADD CONSTRAINT "key_call_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_tuning_logs" ADD CONSTRAINT "key_tuning_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_user_preferences" ADD CONSTRAINT "key_user_preferences_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_interaction_feedback" ADD CONSTRAINT "key_interaction_feedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sandbox_execution_logs" ADD CONSTRAINT "sandbox_execution_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_requests" ADD CONSTRAINT "ai_approval_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cognition_memories" ADD CONSTRAINT "cognition_memories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cognition_sessions" ADD CONSTRAINT "cognition_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_provider_costs" ADD CONSTRAINT "llm_provider_costs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_health_logs" ADD CONSTRAINT "connector_health_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_genomes" ADD CONSTRAINT "business_genomes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_definitions" ADD CONSTRAINT "flow_definitions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_campaigns" ADD CONSTRAINT "outbound_campaigns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MembershipToSkill" ADD CONSTRAINT "_MembershipToSkill_A_fkey" FOREIGN KEY ("A") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MembershipToSkill" ADD CONSTRAINT "_MembershipToSkill_B_fkey" FOREIGN KEY ("B") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ServiceToStaffMember" ADD CONSTRAINT "_ServiceToStaffMember_A_fkey" FOREIGN KEY ("A") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ServiceToStaffMember" ADD CONSTRAINT "_ServiceToStaffMember_B_fkey" FOREIGN KEY ("B") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SkillToStaffMember" ADD CONSTRAINT "_SkillToStaffMember_A_fkey" FOREIGN KEY ("A") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SkillToStaffMember" ADD CONSTRAINT "_SkillToStaffMember_B_fkey" FOREIGN KEY ("B") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

