/**
 * KEY Cortex ↔ KEY Genome Contract Stabilization
 * Phase 18A — Unified DTOs for brain-cortex-genome communication
 *
 * These DTOs ensure type-safe, versioned communication between:
 * - KeyCortexReasoningService (AI brain)
 * - KeyGenomeService (business intelligence judge)
 * - KeyActionProposalService (autonomy/approval gate)
 */

import { CortexActionType } from './key-cortex.types';

// ─────────────────────────────────────────────────────────────
// Autonomy Check — Cortex asks Genome: "Can I do this?"
// ─────────────────────────────────────────────────────────────

export interface GenomeAutonomyCheckRequest {
  businessId: string;
  userId: string;
  sessionId: string;
  action: {
    type: CortexActionType;
    params: Record<string, unknown>;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    estimatedImpact?: string;
  };
  context: {
    genomeStage: string;
    executiveReadiness: number;
    dnaScores: Record<string, number>;
    activeProjects: number;
    pendingInvoices: number;
    recentOutcomes: string[];
  };
}

export interface GenomeAutonomyCheckResponse {
  allowed: boolean;
  requiresApproval: boolean;
  policy: {
    autonomyTier: 'none' | 'assisted' | 'semi' | 'full';
    maxRiskLevel: string;
    dailyActionLimit: number;
    remainingActions: number;
  };
  genomeContext: {
    readinessScore: number;
    relevantDnaDimensions: string[];
    warnings: string[];
  };
  explanation: string;
  nextBestAction?: string;
}

// ─────────────────────────────────────────────────────────────
// Outcome Reporting — Cortex tells Genome: "Here's what happened"
// ─────────────────────────────────────────────────────────────

export interface GenomeOutcomeReport {
  businessId: string;
  sessionId: string;
  userId: string;
  action: {
    type: CortexActionType;
    params: Record<string, unknown>;
    status: 'success' | 'error' | 'pending_approval';
  };
  result: {
    description: string;
    data?: Record<string, unknown>;
    error?: string;
  };
  timestamps: {
    proposedAt: Date;
    executedAt?: Date;
    completedAt: Date;
  };
  genomeSnapshot: {
    stage: string;
    readiness: number;
    dnaScores: Record<string, number>;
  };
}

export interface GenomeOutcomeAcknowledgment {
  recorded: boolean;
  outcomeId: string;
  learningApplied: boolean;
  recommendationsUpdated: boolean;
  confidenceDelta: number;
}

// ─────────────────────────────────────────────────────────────
// Evidence Creation — Cortex asks Genome: "What evidence supports this?"
// ─────────────────────────────────────────────────────────────

export interface GenomeEvidenceRequest {
  businessId: string;
  claim: string;
  dataSources: GenomeDataSource[];
  confidenceRequired: number;
}

export type GenomeDataSource =
  | 'invoices'
  | 'leads'
  | 'tasks'
  | 'projects'
  | 'genome'
  | 'messages'
  | 'events'
  | 'contacts'
  | 'payments';

export interface GenomeEvidenceResponse {
  claim: string;
  verified: boolean;
  evidence: Array<{
    source: GenomeDataSource;
    data: Record<string, unknown>;
    relevance: number;
    timestamp: Date;
  }>;
  confidence: number;
  gaps: string[];
}

// ─────────────────────────────────────────────────────────────
// Memory Retrieval — Cortex asks Genome: "What do we know?"
// ─────────────────────────────────────────────────────────────

export type MemoryType =
  | 'user_preference'
  | 'business_fact'
  | 'past_decision'
  | 'conversation'
  | 'failed_attempt'
  | 'successful_action'
  | 'communication_style'
  | 'risk_tolerance'
  | 'common_workflow'
  | 'current_goal'
  | 'long_term_strategy'
  | 'document_extraction';

export interface CortexMemory {
  id: string;
  businessId: string;
  userId?: string;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  source: 'explicit' | 'inferred' | 'genome' | 'conversation';
  lastAccessedAt: Date;
  createdAt: Date;
  accessCount: number;
}

export interface CortexMemoryQuery {
  businessId: string;
  userId?: string;
  memoryTypes?: MemoryType[];
  recency?: 'recent' | 'all_time';
  limit?: number;
}

// ─────────────────────────────────────────────────────────────
// Proactive Triggers — Genome tells Cortex: "You should act"
// ─────────────────────────────────────────────────────────────

export type ProactiveTriggerType =
  | 'morning_brief'
  | 'end_of_day_report'
  | 'risk_alert'
  | 'opportunity_alert'
  | 'follow_up_reminder'
  | 'missed_task'
  | 'revenue_anomaly'
  | 'customer_escalation'
  | 'genome_weakness'
  | 'invoice_overdue'
  | 'lead_dormant';

export interface ProactiveTrigger {
  id: string;
  type: ProactiveTriggerType;
  businessId: string;
  scheduledAt: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  data: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Tool Declaration — Registry contract for all business tools
// ─────────────────────────────────────────────────────────────

export type ToolCategory =
  | 'communication'
  | 'calendar'
  | 'crm'
  | 'finance'
  | 'marketing'
  | 'document'
  | 'workflow'
  | 'data'
  | 'ai';

export interface ToolDeclaration {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  genomeRequirements: {
    minStage: string;
    minReadiness: number;
    requiredDna: Record<string, number>;
  };
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  dryRunSupported: boolean;
  rollbackSupported: boolean;
  executorRef: string;
  parameters: Record<string, unknown>;
  auditPayload: {
    logsInput: boolean;
    logsOutput: boolean;
    retentionDays: number;
  };
  outcomeTracking: {
    tracksSuccess: boolean;
    tracksFailure: boolean;
    successMetrics: string[];
  };
}

// ─────────────────────────────────────────────────────────────
// Trust Explanation — Every recommendation explains itself
// ─────────────────────────────────────────────────────────────

export interface TrustExplanation {
  reasoning: string;
  evidence: Array<{
    source: string;
    data: string;
    relevance: number;
  }>;
  risks: Array<{
    description: string;
    probability: 'low' | 'medium' | 'high';
    impact: string;
  }>;
  genomeFacts: Array<{
    dimension: string;
    score: number;
    fact: string;
  }>;
  knowledgeGaps: string[];
  inactionConsequence: string;
  trackingPlan: Array<{
    metric: string;
    target: string;
    timeframe: string;
  }>;
  rollbackPlan?: string;
}

// ─────────────────────────────────────────────────────────────
// Genome Judgment — Unified judgment response
// ─────────────────────────────────────────────────────────────

export interface GenomeJudgment {
  allowed: boolean;
  requiresApproval: boolean;
  policy: {
    autonomyTier: 'none' | 'assisted' | 'semi' | 'full';
    maxRiskLevel: string;
  };
  explanation: string;
  riskAssessment: {
    level: 'low' | 'medium' | 'high' | 'critical';
    factors: string[];
  };
  evidence: GenomeEvidenceResponse | null;
}

// ─────────────────────────────────────────────────────────────
// Calm Mode / Feature Visibility
// ─────────────────────────────────────────────────────────────

export type UserTier = 'beginner' | 'intermediate' | 'advanced';

export interface FeatureVisibility {
  featureId: string;
  module: string;
  beginner: boolean;
  intermediate: boolean;
  advanced: boolean;
  unlockCriteria?: {
    usageCount?: number;
    daysActive?: number;
    genomeStage?: string;
  };
}

export interface CalmModeConfig {
  enabled: boolean;
  userTier: UserTier;
  aiEntryPoint: 'chat_only' | 'command_palette' | 'all';
  showChrome: boolean;
  moduleSimplification: Record<string, boolean>;
}
