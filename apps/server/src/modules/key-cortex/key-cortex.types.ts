/**
 * KEY Cortex — JARVIS Business Brain
 *
 * Type contracts for the central intelligence cortex:
 * contextual reasoning, conversational memory, evidence-based answers,
 * autonomous action, and voice interface.
 *
 * This layer sits ON TOP of the KEY Genome system, using Kimi (Moonshot AI)
 * as the primary reasoning engine. It transforms structured genome data
 * into natural conversation, strategic insight, and autonomous execution.
 */

import type {
  GenomeFactData,
  GenomeRecommendationData,
  GenomeFinanceSnapshotData,
  GenomeCustomerSalesSnapshotData,
  GenomeOperationsSnapshotData,
  GenomeMarketingGrowthSnapshotData,
  GenomeCrossDomainSnapshotData,
  GenomeMemoryEventData,
  GenomeDepartmentData,
  GenomeAutonomyGateResult,
  GenomeRankedRecommendation,
  RiskLevel,
} from '../business-genome/key-genome/key-genome.types';

// ---------------------------------------------------------------------------
// Core Cortex Types
// ---------------------------------------------------------------------------

export type CortexIntent =
  | 'QUESTION'           // "What are my margins?"
  | 'COMMAND'            // "Send the overdue invoice reminders"
  | 'IDEA'               // "I'm thinking of launching a new service"
  | 'CRISIS'             // "My biggest customer just churned"
  | 'PLAN'               // "Create a growth plan for Q3"
  | 'ANALYSIS'           // "Why did revenue drop last month?"
  | 'SCENARIO'           // "What if I raise prices 10%?"
  | 'OPPORTUNITY'        // "Find me profit opportunities"
  | 'REVIEW'             // "Review my business health"
  | 'CHAT'               // "Good morning KEY"
  | 'VOICE';             // Voice input

export type CortexConfidence = 'CERTAIN' | 'HIGH' | 'MODERATE' | 'LOW' | 'SPECULATIVE';

export type CortexPersonality =
  | 'SHARK'      // Aggressive, profit-first, no fluff
  | 'STRATEGIST' // Balanced, long-term thinking
  | 'ANALYST'    // Data-heavy, conservative
  | 'MENTOR'     // Supportive, educational
  | 'JARVIS';    // Default: witty, capable, proactive

export interface CortexMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'action' | 'evidence';
  content: string;
  metadata?: CortexMessageMetadata;
  createdAt: Date;
}

export interface CortexMessageMetadata {
  intent?: CortexIntent;
  confidence?: CortexConfidence;
  evidenceRefs?: string[];
  actionResults?: CortexActionResult[];
  toolsUsed?: string[];
  provider?: string;
  model?: string;
  latencyMs?: number;
  tokensUsed?: number;
  genomeDataVersion?: string;
}

export interface CortexSession {
  id: string;
  businessId: string;
  userId: string;
  personality: CortexPersonality;
  messages: CortexMessage[];
  contextSnapshot: GenomeContextSnapshot | null;
  isActive: boolean;
  lastActivityAt: Date;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Genome Context Assembly
// ---------------------------------------------------------------------------

export interface GenomeContextSnapshot {
  business: BusinessContext;
  genomeScore: GenomeScoreContext;
  finance: GenomeFinanceSnapshotData | null;
  sales: GenomeCustomerSalesSnapshotData | null;
  operations: GenomeOperationsSnapshotData | null;
  marketing: GenomeMarketingGrowthSnapshotData | null;
  crossDomain: GenomeCrossDomainSnapshotData | null;
  facts: GenomeFactData[];
  recommendations: GenomeRecommendationData[];
  memory: GenomeMemoryEventData[];
  departments: GenomeDepartmentData[];
  autonomyGate: GenomeAutonomyContext;
  assembledAt: string;
  dataFreshness: 'FRESH' | 'STALE' | 'CRITICAL';
}

export interface BusinessContext {
  id: string;
  name: string;
  industry: string | null;
  currency: string;
  timezone: string;
  stage: string | null;
  employees: number | null;
  annualRevenue: number | null;
  foundedAt: Date | null;
}

export interface GenomeScoreContext {
  overall: number;
  integrity: number;
  readiness: number;
  confidence: number;
  weakestSection: string | null;
  strongestSection: string | null;
}

export interface GenomeAutonomyContext {
  automationAllowed: boolean;
  blockedDomains: string[];
  overallRisk: RiskLevel;
  topBlockingReasons: string[];
}

// ---------------------------------------------------------------------------
// Reasoning Engine
// ---------------------------------------------------------------------------

export interface CortexReasoningInput {
  session: CortexSession;
  userMessage: string;
  genomeContext: GenomeContextSnapshot;
  intent: CortexIntent;
  availableTools: CortexToolDefinition[];
}

export interface CortexReasoningResult {
  response: string;
  intent: CortexIntent;
  confidence: CortexConfidence;
  toolsCalled: CortexToolCall[];
  actionsProposed: CortexActionProposal[];
  evidence: CortexEvidence[];
  followUpQuestions: string[];
  provider: string;
  model: string;
  latencyMs: number;
  tokensUsed: number;
}

export interface CortexToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CortexToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Action System
// ---------------------------------------------------------------------------

export interface CortexActionProposal {
  id: string;
  actionType: string;
  title: string;
  description: string;
  rationale: string;
  payload: Record<string, unknown>;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  expectedOutcome: string;
  estimatedImpact: string;
}

export interface CortexActionResult {
  actionId: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  executedAt: Date;
}

export interface CortexApprovalRequest {
  proposal: CortexActionProposal;
  sessionId: string;
  businessId: string;
  requestedAt: Date;
  expiresAt: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
}

// ---------------------------------------------------------------------------
// Evidence & Attribution
// ---------------------------------------------------------------------------

export interface CortexEvidence {
  type: 'FACT' | 'SNAPSHOT' | 'RECOMMENDATION' | 'MEMORY' | 'PROJECTION' | 'INDUSTRY';
  source: string;
  description: string;
  confidence: number;
  value?: unknown;
  id?: string;
}

// ---------------------------------------------------------------------------
// Voice Interface
// ---------------------------------------------------------------------------

export interface VoiceTranscriptionResult {
  text: string;
  confidence: number;
  language: string;
  isFinal: boolean;
}

export interface VoiceSynthesisRequest {
  text: string;
  voice?: 'JARVIS' | 'PROFESSIONAL' | 'FRIENDLY';
  speed?: number;
  language?: string;
}

export interface VoiceSynthesisResult {
  audioUrl: string;
  durationSeconds: number;
  format: string;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export interface CortexStreamChunk {
  type: 'THINKING' | 'CONTENT' | 'TOOL_CALL' | 'TOOL_RESULT' | 'ACTION' | 'EVIDENCE' | 'DONE' | 'ERROR';
  content?: string;
  toolCall?: CortexToolCall;
  action?: CortexActionProposal;
  evidence?: CortexEvidence;
  error?: string;
  metadata?: Partial<CortexMessageMetadata>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CortexConfig {
  personality: CortexPersonality;
  primaryProvider: 'kimi' | 'openai' | 'anthropic' | 'xai';
  reasoningModel: string;
  fastModel: string;
  maxContextFacts: number;
  maxContextRecommendations: number;
  maxContextMemory: number;
  enableAutonomousActions: boolean;
  autonomyRiskThreshold: RiskLevel;
  voiceEnabled: boolean;
  proactiveEnabled: boolean;
}

export const DEFAULT_CORTEX_CONFIG: CortexConfig = {
  personality: 'JARVIS',
  primaryProvider: 'kimi',
  reasoningModel: 'moonshot-v1-128k',
  fastModel: 'moonshot-v1-8k',
  maxContextFacts: 50,
  maxContextRecommendations: 10,
  maxContextMemory: 20,
  enableAutonomousActions: false,
  autonomyRiskThreshold: 'LOW',
  voiceEnabled: false,
  proactiveEnabled: true,
};

// ---------------------------------------------------------------------------
// API Contracts
// ---------------------------------------------------------------------------

export interface CortexChatRequest {
  message: string;
  sessionId?: string;
  personality?: CortexPersonality;
  stream?: boolean;
  voice?: boolean;
}

export interface CortexChatResponse {
  message: CortexMessage;
  session: CortexSession;
  actions: CortexActionProposal[];
  evidence: CortexEvidence[];
  genomeSnapshot: GenomeContextSnapshot;
  suggestedFollowUps: string[];
}

export interface CortexApproveActionRequest {
  sessionId: string;
  actionId: string;
  approve: boolean;
}

export interface CortexHealthCheck {
  cortexStatus: 'OPERATIONAL' | 'DEGRADED' | 'OFFLINE';
  genomeDataFreshness: 'FRESH' | 'STALE' | 'CRITICAL';
  primaryProvider: string;
  providerAvailable: boolean;
  lastReasoningAt: Date | null;
  totalConversations: number;
  avgLatencyMs: number;
}
