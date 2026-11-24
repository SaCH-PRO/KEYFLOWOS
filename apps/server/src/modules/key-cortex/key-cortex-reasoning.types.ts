/**
 * Shared types for the KEY Cortex reasoning subsystem.
 *
 * These types were extracted from KeyCortexReasoningService so that the
 * orchestrator and its focused delegate services can share them without
 * creating circular imports.
 */

export interface GenomeEnrichedContext {
  dnaScores: Record<string, number>;
  /** Withheld (undefined) for a reader without revenue read (D-235: a categorical indicator of the whole genome). */
  genomeStage?: string;
  executiveReadiness: number;
  recommendations: GenomeRecommendation[];
  signals: GenomeSignal[];
  /**
   * D-235 round 8: the newest signals, of which `signals` are the first twenty. Unprojected; read only to project the
   * signals for a reader without revenue read, and never handed on by that projection.
   */
  signalPool?: GenomeSignal[];
  /**
   * D-235 round 9: the business's top-ranked recommendations, of which `recommendations` are the first ten. Unprojected;
   * read only to project the recommendations for a reader without revenue read, and never handed on by that projection.
   */
  recommendationPool?: GenomeRecommendation[];
  opportunities: GenomeOpportunity[];
  autonomyMap: Record<string, boolean>;
  timestamp: Date;
}

export interface GenomeRecommendation {
  id: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  category: string;
  confidence: number;
  genomeScore: number;
}

export interface GenomeSignal {
  id: string;
  type: 'urgent' | 'warning' | 'opportunity' | 'info';
  message: string;
  module: string;
  /** The signal row's section and domain (FU-KEY-CHAT-GENOME-MONEY-SIGHT): the finance rule reads them. */
  section?: string | null;
  domain?: string | null;
  /** Pre-evaluated full-row finance classification (CODEX-228 MAJOR-2: covers field, evidence, proposedValue, sourceEntityType). */
  isFinance?: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  createdAt: Date;
}

export interface GenomeOpportunity {
  id: string;
  title: string;
  estimatedValue: number;
  category: string;
  confidence: number;
}

export interface EnrichedContext {
  businessId: string;
  genome: GenomeEnrichedContext | null;
  contextV2: Record<string, unknown> | null;
  contextSnapshot: import('./key-cortex.types').CortexContextSnapshot | null;
  timestamp: Date;
}

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  category: string;
  source: 'genome' | 'pattern' | 'insight';
  confidence: number;
  action?: string;
}

export interface InteractionFeedback {
  query: string;
  response: string;
  userRating?: number;
  userComment?: string;
  actionsTaken: string[];
  actionsSkipped: string[];
  sessionId: string;
  metadata?: Record<string, unknown>;
}
