/**
 * Normalized memory fragment produced by UnifiedMemoryRetrievalService.
 *
 * The goal is to hide the underlying storage silos (AiMemory, AiMemoryEmbedding,
 * GenomeMemoryEvent, TemporalFlowMemory, CognitionMemory) behind one consistent
 * shape that the reasoning engine can consume.
 */

export type MemorySourceType =
  | 'ai_memory'
  | 'ai_memory_embedding'
  | 'genome_memory_event'
  | 'temporal_flow_memory'
  | 'cognition_memory'
  | 'cognitive_event'
  | 'conversation'
  | 'business_event'
  | 'ai_execution_log'
  | 'cortex_action_log';

export interface MemoryFragment {
  /** Unique ID of the underlying record */
  id: string;
  /** Which memory store this fragment came from */
  sourceType: MemorySourceType;
  /** Human-readable label / title */
  title: string;
  /** Full content / summary */
  content: string;
  /** When the memory was created */
  timestamp: Date;
  /** Confidence score (0–1) assigned by the source */
  confidence: number;
  /** Relevance score (0–1) computed by the retrieval service */
  relevanceScore: number;
  /** Recency score (0–1) computed by the retrieval service */
  recencyScore: number;
  /** Final composite rank score (0–1) */
  rankScore: number;
  /** Optional source entity reference (e.g. contactId, threadId) */
  entityId?: string | null;
  /** Optional entity type (e.g. contact, thread) */
  entityType?: string | null;
  /** Source-specific metadata */
  metadata?: Record<string, unknown>;
}

export interface MemoryRetrievalOptions {
  /** Natural-language query for semantic search */
  query?: string;
  /** Hard limit on number of fragments */
  limit?: number;
  /** Filter to specific source types */
  sourceTypes?: MemorySourceType[];
  /** Filter to a specific entity (e.g. contact) */
  entityId?: string;
  /** Filter to a specific entity type */
  entityType?: string;
  /** Minimum composite rank score to include */
  minRankScore?: number;
  /** Optionally boost recent memories (default: true) */
  boostRecency?: boolean;
  /** Include episodic sources: business events, AI execution logs, cortex action logs (default: true) */
  includeEpisodic?: boolean;
}
