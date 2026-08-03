-- Migration: Add KeyConnector fields to IntegrationConnection + create ConnectorAuditLog
-- Created: 2026-06-26

-- Add display_name to IntegrationConnection
ALTER TABLE "integration_connections" 
ADD COLUMN IF NOT EXISTS "display_name" TEXT;

-- Add health_score to IntegrationConnection  
ALTER TABLE "integration_connections"
ADD COLUMN IF NOT EXISTS "health_score" INTEGER NOT NULL DEFAULT 100;

-- Add auth_data (JSONB) to IntegrationConnection
ALTER TABLE "integration_connections"
ADD COLUMN IF NOT EXISTS "auth_data" JSONB;

-- Create ConnectorAuditLog table
CREATE TABLE IF NOT EXISTS "connector_audit_logs" (
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

-- Create indexes for ConnectorAuditLog
CREATE INDEX IF NOT EXISTS "connector_audit_logs_business_id_idx" 
ON "connector_audit_logs"("business_id");

CREATE INDEX IF NOT EXISTS "connector_audit_logs_business_id_created_at_idx" 
ON "connector_audit_logs"("business_id", "created_at");

CREATE INDEX IF NOT EXISTS "connector_audit_logs_connection_id_idx" 
ON "connector_audit_logs"("connection_id");
