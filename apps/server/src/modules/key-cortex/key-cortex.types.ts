// ============================================================
// KEY Cortex — Core Type Definitions
// Foundation for the entire KEY Cortex AI system
// ============================================================

import {
  GatewayMessage,
  GatewayToolDefinition,
} from '../ai/model-gateway.service';

// ─────────────────────────────────────────────────────────────
// 3.1 Core Type Aliases (string-literal unions)
// ─────────────────────────────────────────────────────────────

export type CortexProvider =
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'kimi'
  | 'native'
  | 'opensource';

export type CortexPersona =
  | 'jarvis' // Helpful, witty, British butler
  | 'friday' // Warm, proactive, personal assistant
  | 'jarvis_dark' // Serious, tactical, no-nonsense
  | 'nova' // Creative, enthusiastic, idea generator
  | 'titan' // Executive, strategic, profit-focused
  | 'ghost' // Minimal, quiet, observant
  | 'mentor' // Patient, educational, guiding
  | 'hustler'; // Aggressive, growth-focused, revenue-driven

export type CortexVoice =
  | 'alloy'
  | 'ash'
  | 'coral'
  | 'echo'
  | 'fable'
  | 'onyx'
  | 'nova'
  | 'sage'
  | 'shimmer'
  | 'echo_hd'
  | 'nova_hd'; // Premium voices

export type CortexMood =
  | 'focused'
  | 'creative'
  | 'analytical'
  | 'casual'
  | 'urgent';

export type CortexActionType =
  | 'CREATE_TASK'
  | 'CREATE_EVENT'
  | 'SEND_MESSAGE'
  | 'CREATE_DOCUMENT'
  | 'ANALYZE_DATA'
  | 'GENERATE_REPORT'
  | 'EXECUTE_FLOW'
  | 'QUERY_DATABASE'
  | 'UPDATE_RECORD'
  | 'SCHEDULE_REMINDER'
  | 'CREATE_INVOICE'
  | 'SEND_EMAIL'
  | 'CREATE_LEAD'
  | 'UPDATE_CRM'
  | 'SEARCH_KNOWLEDGE'
  | 'EXECUTE_TOOL';

export type CortexMessageRole =
  | 'user'
  | 'assistant'
  | 'system'
  | 'tool'
  | 'action_result';

export type CortexSessionStatus = 'active' | 'paused' | 'archived';

// ─────────────────────────────────────────────────────────────
// 3.2 Core Interfaces
// ─────────────────────────────────────────────────────────────

export interface CortexMessage {
  id: string;
  role: CortexMessageRole;
  content: string;
  timestamp: Date;
  metadata?: {
    provider?: CortexProvider;
    model?: string;
    tokensUsed?: number;
    cost?: number;
    latencyMs?: number;
    actionsTriggered?: CortexActionResult[];
    mood?: CortexMood;
    voiceUsed?: CortexVoice;
  };
}

export interface CortexSession {
  id: string;
  businessId: string;
  userId: string;
  status: CortexSessionStatus;
  persona: CortexPersona;
  voice: CortexVoice;
  mood: CortexMood;
  preferredProvider: CortexProvider;
  messages: CortexMessage[];
  contextSnapshot?: CortexContextSnapshot;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  title?: string;
}

export interface CortexContextSnapshot {
  businessId: string;
  genomeDna: Record<string, number>;
  genomeStage: string;
  executiveReadiness: number;
  recentTasks: string[];
  recentEvents: string[];
  keyMetrics: Record<string, number>;
  activeProjects: string[];
  pendingInvoices: number;
  unreadMessages: number;
  teamStatus: string;
  timestamp: Date;
}

export interface CortexQuery {
  text: string;
  sessionId?: string;
  businessId: string;
  userId: string;
  persona?: CortexPersona;
  voice?: CortexVoice;
  provider?: CortexProvider;
  mood?: CortexMood;
  stream?: boolean;
  enableActions?: boolean;
  enableVoice?: boolean;
  attachments?: CortexAttachment[];
}

export interface CortexAttachment {
  type: 'image' | 'document' | 'audio' | 'spreadsheet';
  url: string;
  mimeType: string;
  name: string;
}

export interface CortexResponse {
  message: CortexMessage;
  actions?: CortexActionResult[];
  contextUsed?: CortexContextSnapshot;
  suggestions?: string[];
  followUpQuestions?: string[];
  confidence: number;
}

export interface CortexActionResult {
  actionType: CortexActionType;
  status: 'success' | 'error' | 'pending_approval';
  description: string;
  result?: Record<string, unknown>;
  error?: string;
  requiresApproval?: boolean;
  estimatedImpact?: string;
}

export interface CortexPersonalityConfig {
  persona: CortexPersona;
  name: string;
  tagline: string;
  systemPrompt: string;
  voiceMapping: CortexVoice;
  temperature: number;
  creativityBoost: number;
  emojiStyle: 'none' | 'minimal' | 'moderate' | 'expressive';
  greetingStyle: string;
  signaturePhrases: string[];
  responseFormat:
    | 'conversational'
    | 'structured'
    | 'executive_summary'
    | 'creative';
}

export interface CortexStreamChunk {
  type: 'text_delta' | 'action_delta' | 'thought' | 'tool_call' | 'error' | 'done';
  content?: string;
  action?: Partial<CortexActionResult>;
  thought?: string;
  toolCall?: { name: string; params: Record<string, unknown> };
  error?: string;
}

export interface CortexVoiceRequest {
  text: string;
  voice?: CortexVoice;
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav';
  speed?: number; // 0.5 - 2.0
  persona?: CortexPersona;
  instructions?: string; // e.g., "Speak in a warm, encouraging tone"
}

export interface CortexVoiceResponse {
  audioUrl: string;
  duration: number;
  format: string;
  voice: CortexVoice;
}

export interface CortexSTTRequest {
  audioBuffer: Buffer;
  mimeType: string;
  language?: string;
  prompt?: string; // Context hint for transcription
}

export interface CortexInsight {
  type: 'opportunity' | 'risk' | 'trend' | 'anomaly' | 'suggestion';
  title: string;
  description: string;
  confidence: number;
  estimatedValue?: string;
  recommendedAction?: string;
  dataSource: string;
}

export interface CortexProfitOpportunity {
  id: string;
  title: string;
  description: string;
  estimatedRevenue: number;
  estimatedEffort: 'low' | 'medium' | 'high';
  confidence: number;
  category:
    | 'automation'
    | 'upsell'
    | 'cost_reduction'
    | 'new_revenue'
    | 'retention';
  actionSteps: string[];
  dataSources: string[];
}

// ─────────────────────────────────────────────────────────────
// Re-exports from Model Gateway for convenience
// ─────────────────────────────────────────────────────────────

export type { GatewayMessage, GatewayToolDefinition };
