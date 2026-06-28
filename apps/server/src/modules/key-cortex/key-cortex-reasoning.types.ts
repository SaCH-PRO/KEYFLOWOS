/**
 * Shared types for the KEY Cortex reasoning subsystem.
 *
 * These types were extracted from KeyCortexReasoningService so that the
 * orchestrator and its focused delegate services can share them without
 * creating circular imports.
 */

export interface GenomeEnrichedContext {
  dnaScores: Record<string, number>;
  genomeStage: string;
  executiveReadiness: number;
  recommendations: GenomeRecommendation[];
  signals: GenomeSignal[];
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
