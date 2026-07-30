/*
  Warnings:

  - You are about to drop the column `completed_at` on the `keystore_service_orders` table. All the data in the column will be lost.
  - You are about to drop the column `delivered_at` on the `keystore_service_orders` table. All the data in the column will be lost.
  - You are about to drop the column `started_at` on the `keystore_service_orders` table. All the data in the column will be lost.
  - Made the column `messages` on table `cortex_sessions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `deliverables` on table `keystore_service_listings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `pricing_tiers` on table `keystore_service_listings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `addons` on table `keystore_service_listings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `faq` on table `keystore_service_listings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `brief_questions` on table `keystore_service_listings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `metadata` on table `keystore_service_listings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `attachments` on table `keystore_service_order_messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `selected_addons` on table `keystore_service_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `brief_answers` on table `keystore_service_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `delivery_files` on table `keystore_service_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `timeline` on table `keystore_service_orders` required. This step will fail if there are existing NULL values in that column.

*/
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

-- DropForeignKey
ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_business_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_approval_requests" DROP CONSTRAINT "ai_approval_requests_business_id_fkey";

-- DropForeignKey
ALTER TABLE "business_genomes" DROP CONSTRAINT "business_genomes_business_id_fkey";

-- DropForeignKey
ALTER TABLE "business_settings" DROP CONSTRAINT "business_settings_business_id_fkey";

-- DropForeignKey
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_business_id_fkey";

-- DropForeignKey
ALTER TABLE "connector_health_logs" DROP CONSTRAINT "connector_health_logs_business_id_fkey";

-- DropForeignKey
ALTER TABLE "cortex_sessions" DROP CONSTRAINT "cortex_sessions_business_id_fkey";

-- DropForeignKey
ALTER TABLE "crm_activities" DROP CONSTRAINT "crm_activities_business_id_fkey";

-- DropForeignKey
ALTER TABLE "crm_activities" DROP CONSTRAINT "crm_activities_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "crm_tasks" DROP CONSTRAINT "crm_tasks_business_id_fkey";

-- DropForeignKey
ALTER TABLE "crm_tasks" DROP CONSTRAINT "crm_tasks_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_business_id_fkey";

-- DropForeignKey
ALTER TABLE "flow_definitions" DROP CONSTRAINT "flow_definitions_business_id_fkey";

-- DropForeignKey
ALTER TABLE "flow_executions" DROP CONSTRAINT "flow_executions_business_id_fkey";

-- DropForeignKey
ALTER TABLE "flow_executions" DROP CONSTRAINT "flow_executions_flow_id_fkey";

-- DropForeignKey
ALTER TABLE "helpdesk_tickets" DROP CONSTRAINT "helpdesk_tickets_business_id_fkey";

-- DropForeignKey
ALTER TABLE "key_call_sessions" DROP CONSTRAINT "key_call_sessions_business_id_fkey";

-- DropForeignKey
ALTER TABLE "key_documents" DROP CONSTRAINT "key_documents_business_id_fkey";

-- DropForeignKey
ALTER TABLE "key_evolution_logs" DROP CONSTRAINT "key_evolution_logs_business_id_fkey";

-- DropForeignKey
ALTER TABLE "key_tuning_logs" DROP CONSTRAINT "key_tuning_logs_business_id_fkey";

-- DropForeignKey
ALTER TABLE "key_user_preferences" DROP CONSTRAINT "key_user_preferences_business_id_fkey";

-- DropForeignKey
ALTER TABLE "keystore_service_orders" DROP CONSTRAINT "keystore_service_orders_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_business_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_business_id_fkey";

-- DropForeignKey
ALTER TABLE "outbound_campaigns" DROP CONSTRAINT "outbound_campaigns_business_id_fkey";

-- DropForeignKey
ALTER TABLE "outbound_content" DROP CONSTRAINT "outbound_content_campaign_fk";

-- DropForeignKey
ALTER TABLE "reminders" DROP CONSTRAINT "reminders_business_id_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_business_id_fkey";

-- DropForeignKey
ALTER TABLE "sandbox_execution_logs" DROP CONSTRAINT "sandbox_execution_logs_business_id_fkey";

-- DropForeignKey
ALTER TABLE "sync_jobs" DROP CONSTRAINT "sync_jobs_business_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_business_id_fkey";

-- DropForeignKey
ALTER TABLE "workflows" DROP CONSTRAINT "workflows_business_id_fkey";

-- DropIndex
DROP INDEX "ai_memory_embeddings_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "idx_outbound_content_campaign_id";

-- AlterTable
ALTER TABLE "activity_logs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ai_approval_requests" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "requested_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "resolved_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "business_genomes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "business_settings" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "onboarding_completed_at" TIMESTAMP(3),
ADD COLUMN     "onboarding_started_at" TIMESTAMP(3),
ADD COLUMN     "onboarding_step" TEXT DEFAULT 'welcome';

-- AlterTable
ALTER TABLE "campaigns" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "connector_health_logs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "checked_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "cortex_action_logs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "cortex_sessions" ADD COLUMN     "detected_function" TEXT,
ADD COLUMN     "detected_role" TEXT,
ADD COLUMN     "layers_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "llm_calls_made" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "response_time_ms" INTEGER,
ADD COLUMN     "running_summary" TEXT,
ADD COLUMN     "user_feedback" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "messages" SET NOT NULL,
ALTER COLUMN "last_accessed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "crm_activities" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "crm_tasks" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "due_date" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "flow_definitions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "last_execution_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "flow_executions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "started_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "helpdesk_tickets" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "resolved_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "key_call_sessions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "ended_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "key_documents" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "key_evolution_logs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "key_interaction_feedback" ADD COLUMN     "businessId" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "key_tuning_logs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "key_user_preferences" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "last_updated" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "keystore_service_listings" ALTER COLUMN "deliverables" SET NOT NULL,
ALTER COLUMN "pricing_tiers" SET NOT NULL,
ALTER COLUMN "addons" SET NOT NULL,
ALTER COLUMN "faq" SET NOT NULL,
ALTER COLUMN "brief_questions" SET NOT NULL,
ALTER COLUMN "metadata" SET NOT NULL;

-- AlterTable
ALTER TABLE "keystore_service_order_messages" ALTER COLUMN "attachments" SET NOT NULL;

-- AlterTable
ALTER TABLE "keystore_service_orders" DROP COLUMN "completed_at",
DROP COLUMN "delivered_at",
DROP COLUMN "started_at",
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3),
ALTER COLUMN "selected_addons" SET NOT NULL,
ALTER COLUMN "brief_answers" SET NOT NULL,
ALTER COLUMN "delivery_files" SET NOT NULL,
ALTER COLUMN "timeline" SET NOT NULL;

-- AlterTable
ALTER TABLE "leads" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "sent_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "read_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "outbound_campaigns" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "reminders" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "trigger_time" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "sent_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "reports" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sandbox_execution_logs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sync_jobs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "started_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tasks" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "due_date" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workflows" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

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
CREATE INDEX "cortex_sessions_business_id_detected_role_idx" ON "cortex_sessions"("business_id", "detected_role");

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
ALTER TABLE "flow_signals" ADD CONSTRAINT "flow_signals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_role_subscriptions" ADD CONSTRAINT "flow_role_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_content" ADD CONSTRAINT "outbound_content_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "outbound_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keystore_service_categories" ADD CONSTRAINT "keystore_service_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cortex_sessions" ADD CONSTRAINT "cortex_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- RenameIndex
ALTER INDEX "idx_activity_logs_business_created" RENAME TO "activity_logs_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_activity_logs_business_type" RENAME TO "activity_logs_business_id_type_idx";

-- RenameIndex
ALTER INDEX "idx_ai_approval_requests_business_created" RENAME TO "ai_approval_requests_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_ai_approval_requests_business_status" RENAME TO "ai_approval_requests_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_ai_approval_requests_business_user" RENAME TO "ai_approval_requests_business_id_user_id_idx";

-- RenameIndex
ALTER INDEX "idx_ai_approval_requests_correlation" RENAME TO "ai_approval_requests_correlation_id_idx";

-- RenameIndex
ALTER INDEX "idx_business_genomes_business" RENAME TO "business_genomes_business_id_idx";

-- RenameIndex
ALTER INDEX "idx_business_settings_business" RENAME TO "business_settings_business_id_idx";

-- RenameIndex
ALTER INDEX "idx_campaigns_business_created" RENAME TO "campaigns_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_campaigns_business_status" RENAME TO "campaigns_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_connector_health_logs_business_created" RENAME TO "connector_health_logs_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_connector_health_logs_business_provider_checked" RENAME TO "connector_health_logs_business_id_provider_key_checked_at_idx";

-- RenameIndex
ALTER INDEX "idx_connector_health_logs_business_status" RENAME TO "connector_health_logs_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_cortex_action_logs_session_created" RENAME TO "cortex_action_logs_session_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_cortex_sessions_business_created" RENAME TO "cortex_sessions_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_cortex_sessions_business_last_accessed" RENAME TO "cortex_sessions_business_id_last_accessed_at_idx";

-- RenameIndex
ALTER INDEX "idx_cortex_sessions_business_status" RENAME TO "cortex_sessions_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_crm_activities_business_contact" RENAME TO "crm_activities_business_id_contact_id_idx";

-- RenameIndex
ALTER INDEX "idx_crm_activities_business_created" RENAME TO "crm_activities_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_crm_activities_business_type" RENAME TO "crm_activities_business_id_type_idx";

-- RenameIndex
ALTER INDEX "idx_crm_tasks_business_contact" RENAME TO "crm_tasks_business_id_contact_id_idx";

-- RenameIndex
ALTER INDEX "idx_crm_tasks_business_created" RENAME TO "crm_tasks_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_crm_tasks_business_due_date" RENAME TO "crm_tasks_business_id_due_date_idx";

-- RenameIndex
ALTER INDEX "idx_crm_tasks_business_status" RENAME TO "crm_tasks_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_documents_business_created" RENAME TO "documents_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_documents_business_type" RENAME TO "documents_business_id_type_idx";

-- RenameIndex
ALTER INDEX "idx_flow_definitions_business_category" RENAME TO "flow_definitions_business_id_category_idx";

-- RenameIndex
ALTER INDEX "idx_flow_definitions_business_status" RENAME TO "flow_definitions_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_flow_definitions_business_updated" RENAME TO "flow_definitions_business_id_updated_at_idx";

-- RenameIndex
ALTER INDEX "idx_flow_executions_business_created" RENAME TO "flow_executions_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_flow_executions_business_status" RENAME TO "flow_executions_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_flow_executions_flow_started" RENAME TO "flow_executions_flow_id_started_at_idx";

-- RenameIndex
ALTER INDEX "idx_helpdesk_tickets_business_created" RENAME TO "helpdesk_tickets_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_helpdesk_tickets_business_priority" RENAME TO "helpdesk_tickets_business_id_priority_idx";

-- RenameIndex
ALTER INDEX "idx_helpdesk_tickets_business_status" RENAME TO "helpdesk_tickets_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_key_call_sessions_business_created" RENAME TO "key_call_sessions_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_key_call_sessions_business_status" RENAME TO "key_call_sessions_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_key_documents_business_created" RENAME TO "key_documents_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_key_documents_business_status" RENAME TO "key_documents_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_key_evolution_logs_business_created" RENAME TO "key_evolution_logs_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_key_evolution_logs_business_type" RENAME TO "key_evolution_logs_business_id_recommendation_type_idx";

-- RenameIndex
ALTER INDEX "idx_key_evolution_logs_business_user_created" RENAME TO "key_evolution_logs_business_id_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_key_interaction_feedback_session_created" RENAME TO "key_interaction_feedback_session_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_key_tuning_logs_business_created" RENAME TO "key_tuning_logs_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_key_user_preferences_business_created" RENAME TO "key_user_preferences_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "keystore_service_categories_business_active_idx" RENAME TO "keystore_service_categories_business_id_is_active_idx";

-- RenameIndex
ALTER INDEX "keystore_service_categories_business_slug_unique" RENAME TO "keystore_service_categories_business_id_slug_key";

-- RenameIndex
ALTER INDEX "keystore_service_listings_business_slug_unique" RENAME TO "keystore_service_listings_business_id_slug_key";

-- RenameIndex
ALTER INDEX "keystore_service_listings_business_status_idx" RENAME TO "keystore_service_listings_business_id_status_idx";

-- RenameIndex
ALTER INDEX "keystore_service_order_messages_order_created_idx" RENAME TO "keystore_service_order_messages_order_id_created_at_idx";

-- RenameIndex
ALTER INDEX "keystore_service_orders_business_status_idx" RENAME TO "keystore_service_orders_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_leads_business_created" RENAME TO "leads_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_leads_business_email" RENAME TO "leads_business_id_email_idx";

-- RenameIndex
ALTER INDEX "idx_leads_business_status" RENAME TO "leads_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_messages_business_created" RENAME TO "messages_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_messages_business_direction" RENAME TO "messages_business_id_direction_idx";

-- RenameIndex
ALTER INDEX "idx_messages_business_status" RENAME TO "messages_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_outbound_campaigns_business_created" RENAME TO "outbound_campaigns_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_outbound_campaigns_business_status" RENAME TO "outbound_campaigns_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_reminders_business_created" RENAME TO "reminders_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_reminders_business_status" RENAME TO "reminders_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_reminders_business_trigger" RENAME TO "reminders_business_id_trigger_time_idx";

-- RenameIndex
ALTER INDEX "idx_reports_business_created" RENAME TO "reports_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_reports_business_status" RENAME TO "reports_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_sandbox_execution_logs_business_created" RENAME TO "sandbox_execution_logs_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_sandbox_execution_logs_business_language" RENAME TO "sandbox_execution_logs_business_id_language_idx";

-- RenameIndex
ALTER INDEX "idx_sandbox_execution_logs_business_success" RENAME TO "sandbox_execution_logs_business_id_success_idx";

-- RenameIndex
ALTER INDEX "idx_sync_jobs_business_started" RENAME TO "sync_jobs_business_id_started_at_idx";

-- RenameIndex
ALTER INDEX "idx_sync_jobs_business_status" RENAME TO "sync_jobs_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_sync_jobs_connection_started" RENAME TO "sync_jobs_connection_id_started_at_idx";

-- RenameIndex
ALTER INDEX "idx_tasks_business_created" RENAME TO "tasks_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_tasks_business_due_date" RENAME TO "tasks_business_id_due_date_idx";

-- RenameIndex
ALTER INDEX "idx_tasks_business_priority" RENAME TO "tasks_business_id_priority_idx";

-- RenameIndex
ALTER INDEX "idx_tasks_business_status" RENAME TO "tasks_business_id_status_idx";

-- RenameIndex
ALTER INDEX "idx_workflows_business_created" RENAME TO "workflows_business_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_workflows_business_module_status" RENAME TO "workflows_business_id_module_status_idx";

-- RenameIndex
ALTER INDEX "idx_workflows_business_status" RENAME TO "workflows_business_id_status_idx";
