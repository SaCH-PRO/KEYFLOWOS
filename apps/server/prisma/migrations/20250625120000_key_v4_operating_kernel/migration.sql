-- ============================================
-- Key V4 Operating Kernel Migration
-- Tables: BusinessEvent, ApprovalRequest, Evidence, TaskAssignment, CallLog
-- Enums: 9 PostgreSQL enum types
-- ============================================

-- ============================================
-- ENUM TYPES
-- ============================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BusinessEventType') THEN
    CREATE TYPE "BusinessEventType" AS ENUM (
      'ACTION_EXECUTED',
      'DECISION_MADE',
      'INSIGHT_GENERATED',
      'ALERT_TRIGGERED',
      'AUTONOMY_EXERCISED',
      'GOVERNANCE_DECISION',
      'RECOMMENDATION_OFFERED',
      'RECOMMENDATION_ACTED',
      'RECOMMENDATION_IGNORED',
      'GENOME_EVOLUTION',
      'USER_INTERACTION',
      'SYSTEM_EVENT'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApprovalStatus') THEN
    CREATE TYPE "ApprovalStatus" AS ENUM (
      'PENDING',
      'APPROVED',
      'REJECTED',
      'EXPIRED',
      'AUTO_APPROVED',
      'ESCALATED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EvidenceClaimType') THEN
    CREATE TYPE "EvidenceClaimType" AS ENUM (
      'TASK_COMPLETED',
      'INVOICE_COLLECTED',
      'LEAD_CONVERTED',
      'BOOKING_COMPLETED',
      'CAMPAIGN_SENT',
      'PAYMENT_RECEIVED',
      'CUSTOMER_RETAINED',
      'AUTOMATION_EXECUTED',
      'RECOMMENDATION_ACTED',
      'GOVERNANCE_DECISION'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssigneeType') THEN
    CREATE TYPE "AssigneeType" AS ENUM (
      'USER',
      'KEY_CORTEX',
      'AUTOPILOT',
      'DELEGATION_LOOP',
      'SYSTEM'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentPriority') THEN
    CREATE TYPE "AssignmentPriority" AS ENUM (
      'LOW',
      'NORMAL',
      'HIGH',
      'URGENT',
      'CRITICAL'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentStatus') THEN
    CREATE TYPE "AssignmentStatus" AS ENUM (
      'PENDING',
      'IN_PROGRESS',
      'AWAITING_APPROVAL',
      'COMPLETED',
      'OVERDUE',
      'REASSIGNED',
      'CANCELLED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallDirection') THEN
    CREATE TYPE "CallDirection" AS ENUM (
      'INBOUND',
      'OUTBOUND'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallStatus') THEN
    CREATE TYPE "CallStatus" AS ENUM (
      'INITIATED',
      'RINGING',
      'CONNECTED',
      'COMPLETED',
      'FAILED',
      'NO_ANSWER',
      'BUSY',
      'VOICEMAIL',
      'CANCELLED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallOutcome') THEN
    CREATE TYPE "CallOutcome" AS ENUM (
      'SUCCESSFUL',
      'CALLBACK_SCHEDULED',
      'VOICEMAIL_LEFT',
      'NO_ANSWER',
      'DECLINED',
      'WRONG_NUMBER',
      'FOLLOW_UP_NEEDED',
      'CONVERTED'
    );
  END IF;
END $$;

-- ============================================
-- BUSINESS EVENT TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "BusinessEvent" (
  id              TEXT NOT NULL PRIMARY KEY,
  "businessId"    TEXT NOT NULL,
  type            "BusinessEventType" NOT NULL,
  module          TEXT NOT NULL,
  source          TEXT NOT NULL,
  action          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  "genomeSignal"  BOOLEAN NOT NULL DEFAULT FALSE,
  "genomeImpact"  DOUBLE PRECISION,
  "userId"        TEXT,
  "sessionId"     TEXT,
  "correlationId" TEXT,
  "parentEventId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BusinessEvent_businessId_type_createdAt_idx"
  ON "BusinessEvent"("businessId", type, "createdAt");
CREATE INDEX IF NOT EXISTS "BusinessEvent_businessId_module_createdAt_idx"
  ON "BusinessEvent"("businessId", module, "createdAt");
CREATE INDEX IF NOT EXISTS "BusinessEvent_businessId_source_createdAt_idx"
  ON "BusinessEvent"("businessId", source, "createdAt");
CREATE INDEX IF NOT EXISTS "BusinessEvent_businessId_genomeSignal_createdAt_idx"
  ON "BusinessEvent"("businessId", "genomeSignal", "createdAt");
CREATE INDEX IF NOT EXISTS "BusinessEvent_correlationId_idx"
  ON "BusinessEvent"("correlationId");
CREATE INDEX IF NOT EXISTS "BusinessEvent_parentEventId_idx"
  ON "BusinessEvent"("parentEventId");

-- ============================================
-- APPROVAL REQUEST TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
  id                TEXT NOT NULL PRIMARY KEY,
  "businessId"      TEXT NOT NULL,
  requester         TEXT NOT NULL,
  "requesterId"     TEXT,
  "actionType"      TEXT NOT NULL,
  "actionModule"    TEXT NOT NULL,
  description       TEXT NOT NULL,
  rationale         TEXT NOT NULL,
  parameters        JSONB NOT NULL,
  "estimatedImpact" JSONB,
  status            "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  evidence          JSONB,
  "genomeSignalId"  TEXT,
  "decidedBy"       TEXT,
  "decisionNote"    TEXT,
  "decidedAt"       TIMESTAMP(3),
  "genomeDnaSnapshot" JSONB,
  "contextSnapshot" JSONB,
  "expiresAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "ApprovalRequest_businessId_status_createdAt_idx"
  ON "ApprovalRequest"("businessId", status, "createdAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_businessId_actionType_createdAt_idx"
  ON "ApprovalRequest"("businessId", "actionType", "createdAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_businessId_requester_status_idx"
  ON "ApprovalRequest"("businessId", requester, status);

-- ============================================
-- EVIDENCE TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "Evidence" (
  id                TEXT NOT NULL PRIMARY KEY,
  "businessId"      TEXT NOT NULL,
  claim             TEXT NOT NULL,
  "claimType"       "EvidenceClaimType" NOT NULL,
  proof             JSONB NOT NULL,
  "proofHash"       TEXT,
  confidence        DOUBLE PRECISION NOT NULL,
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  "verifiedBy"      TEXT,
  "verifiedAt"      TIMESTAMP(3),
  "verificationMethod" TEXT,
  source            TEXT NOT NULL,
  "sourceEventId"   TEXT,
  "relatedModule"   TEXT NOT NULL,
  "relatedEntityId" TEXT,
  "contributesToDna" BOOLEAN NOT NULL DEFAULT FALSE,
  "dnaSection"      TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "Evidence_businessId_claimType_createdAt_idx"
  ON "Evidence"("businessId", "claimType", "createdAt");
CREATE INDEX IF NOT EXISTS "Evidence_businessId_relatedModule_relatedEntityId_idx"
  ON "Evidence"("businessId", "relatedModule", "relatedEntityId");
CREATE INDEX IF NOT EXISTS "Evidence_businessId_verified_createdAt_idx"
  ON "Evidence"("businessId", verified, "createdAt");
CREATE INDEX IF NOT EXISTS "Evidence_sourceEventId_idx"
  ON "Evidence"("sourceEventId");

-- ============================================
-- TASK ASSIGNMENT TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "TaskAssignment" (
  id                      TEXT NOT NULL PRIMARY KEY,
  "businessId"            TEXT NOT NULL,
  "assigneeType"          "AssigneeType" NOT NULL,
  "assigneeId"            TEXT NOT NULL,
  "taskType"              TEXT NOT NULL,
  "taskId"                TEXT NOT NULL,
  "targetModule"          TEXT NOT NULL,
  "targetEntityType"      TEXT NOT NULL,
  "targetEntityId"        TEXT NOT NULL,
  priority                "AssignmentPriority" NOT NULL DEFAULT 'NORMAL',
  "dueDate"               TIMESTAMP(3),
  status                  "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
  "assignedBy"            TEXT NOT NULL,
  "assignedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "previousAssigneeId"    TEXT,
  "reassignmentReason"    TEXT,
  "completedAt"           TIMESTAMP(3),
  "completedBy"           TEXT,
  "completionEvidenceId"  TEXT,
  "genomeReadinessImpact" DOUBLE PRECISION,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "TaskAssignment_businessId_assigneeType_assigneeId_status_idx"
  ON "TaskAssignment"("businessId", "assigneeType", "assigneeId", status);
CREATE INDEX IF NOT EXISTS "TaskAssignment_businessId_targetModule_targetEntityId_idx"
  ON "TaskAssignment"("businessId", "targetModule", "targetEntityId");
CREATE INDEX IF NOT EXISTS "TaskAssignment_businessId_status_priority_dueDate_idx"
  ON "TaskAssignment"("businessId", status, priority, "dueDate");
CREATE INDEX IF NOT EXISTS "TaskAssignment_businessId_taskType_taskId_idx"
  ON "TaskAssignment"("businessId", "taskType", "taskId");

-- ============================================
-- CALL LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "CallLog" (
  id                      TEXT NOT NULL PRIMARY KEY,
  "businessId"            TEXT NOT NULL,
  "callSid"               TEXT,
  direction               "CallDirection" NOT NULL,
  "phoneNumber"           TEXT NOT NULL,
  "contactId"             TEXT,
  status                  "CallStatus" NOT NULL DEFAULT 'INITIATED',
  purpose                 TEXT NOT NULL,
  "scriptUsed"            TEXT,
  "startedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "connectedAt"           TIMESTAMP(3),
  "endedAt"               TIMESTAMP(3),
  "durationSeconds"       INTEGER,
  transcript              TEXT,
  "transcriptConfidence"  DOUBLE PRECISION,
  sentiment               TEXT,
  "keyPoints"             JSONB,
  "actionItems"           JSONB,
  "customerSatisfaction"  INTEGER,
  "recordingUrl"          TEXT,
  outcome                 "CallOutcome",
  "outcomeNote"           TEXT,
  "followUpRequired"      BOOLEAN NOT NULL DEFAULT FALSE,
  "followUpTaskId"        TEXT,
  "genomeSignal"          BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "CallLog_businessId_status_createdAt_idx"
  ON "CallLog"("businessId", status, "createdAt");
CREATE INDEX IF NOT EXISTS "CallLog_businessId_contactId_createdAt_idx"
  ON "CallLog"("businessId", "contactId", "createdAt");
CREATE INDEX IF NOT EXISTS "CallLog_businessId_direction_outcome_idx"
  ON "CallLog"("businessId", direction, outcome);
CREATE INDEX IF NOT EXISTS "CallLog_businessId_purpose_createdAt_idx"
  ON "CallLog"("businessId", purpose, "createdAt");
