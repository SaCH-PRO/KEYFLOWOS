/**
 * Normalized memory fragment produced by UnifiedMemoryRetrievalService.
 *
 * The goal is to hide the underlying storage silos (AiMemory, AiMemoryEmbedding,
 * GenomeMemoryEvent, TemporalFlowMemory, CognitionMemory) behind one consistent
 * shape that the reasoning engine can consume.
 */

import type { SemanticMemory } from '../ai/semantic-memory.service';
import type { CanonicalModule } from '../../core/authority/module-vocabulary';
import type { MemoryRowDataClass } from '../ai/memory-classification';

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

/**
 * MEM-CLASS-READ (P137, D-257): the key under which a retrieved fragment's metadata
 * carries its canonical persisted/provenance classification metadata so the unified
 * reader projection can decide access without re-parsing rendered strings.
 */
export const MEMORY_CLASS_METADATA_KEY = '__memoryClass';

/** Canonical classification metadata attached to a MemoryFragment by retrieval. */
export interface MemoryClassFragmentMeta {
  store: MemorySourceType;
  dataClass: MemoryRowDataClass | string | null;
  moduleScope: readonly string[] | null;
  ownerUserId?: string | null;
  hasOwnerColumn?: boolean;
  category?: string | null;
  key?: string | null;
  source?: string | null;
  sourceModule?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  type?: string | null;
  sourceEventIds?: readonly string[];
}

/** Reader scope passed to the unified MEM-CLASS-READ projection. */
export interface MemoryReaderContext {
  /** Authenticated member userId in this business, or null for memberless turns / non-members. */
  reader: string | null;
  /** Module read-level predicate (`rankOf(memberModuleLevel(membership, mod)) >= LEVEL_RANK.read`). */
  sight: (module: CanonicalModule) => boolean;
}

/**
 * FU-KEY-MEMORY-MONEY-SIGHT (review SEC-W1FPMS-3; D-128, D-100): the key under which a genome_memory_event fragment's
 * metadata carries its GenomeMemoryEvent row's own columns (GenomeRowColumns). UnifiedMemoryRetrievalService writes it
 * after the row's own metadata, so a writer's metadata cannot stand in for the row; a prompt's memory projection
 * (readersOwnPromptMemory) reads it to withhold the genome's money memory events from a reader without revenue read.
 */
export const GENOME_ROW_METADATA_KEY = 'genomeRow';

/**
 * MEM-UNIFIED-SEMANTIC-SIGHT (D-257, D-234): the key under which an ai_memory_embedding fragment's metadata carries the
 * source its semantic copy was resolved to (SemanticSource). UnifiedMemoryRetrievalService writes it after the copy's own
 * metadata, so a writer's metadata cannot stand in for it.
 */
export const SEMANTIC_SOURCE_METADATA_KEY = 'semanticSource';

/** MEM-UNIFIED-SEMANTIC-SIGHT: the source of a semantic copy (ai_memory_embeddings' source_type and source_id). */
export interface SemanticSource {
  sourceType: string;
  sourceId: string;
}

/** MEM-UNIFIED-SEMANTIC-SIGHT (delta A2): a type-only brand; it exists at compile time alone. */
declare const SEMANTIC_SIGHT_BRAND: unique symbol;

/**
 * MEM-UNIFIED-SEMANTIC-SIGHT (D-257, D-234): what makes a semantic read one reader's: MEM-SEMANTIC-SIGHT's
 * readerSearchOptions (semantic-memory-sight.ts), passed to SemanticMemoryService.search as is. Branded (delta A2): only
 * readerSearchOptions makes one, so no caller hands the read an admit-all object literal by accident (tests build theirs
 * through test/helpers/semantic-sight.js).
 */
export interface SemanticSight {
  readonly [SEMANTIC_SIGHT_BRAND]: true;
  includeDocumentExtractionCopies: boolean;
  visibleTo: (hits: SemanticMemory[]) => Promise<boolean[]>;
}

/** FU-KEY-MEMORY-MONEY-SIGHT: the GenomeMemoryEvent columns a genome fragment carries (GENOME_ROW_METADATA_KEY). */
export interface GenomeRowColumns {
  sourceType: string | null;
  eventType: string | null;
  domain: string | null;
  section: string | null;
}

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
  /**
   * Restrict PERSONALLY-ATTRIBUTED memory to one user.
   *
   * The episodic stores — AiExecutionLog and CortexActionLog — record what a
   * specific person asked KEY to do, including the rationale and an input
   * summary. Business-wide stores (cognitive events, business events, genome,
   * temporal flow) describe the BUSINESS and stay shared, because a business
   * assistant that did not know an invoice went overdue would be useless.
   *
   * Omitting this leaves episodic memory business-wide, which is correct for
   * background jobs reasoning about the company as a whole and wrong for
   * anything rendering into one person's prompt.
   */
  userId?: string;
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
  /**
   * MEM-DOC-EXTRACTION-SIGHT (D-234): read the document extractions (AiMemory rows of DOCUMENT_EXTRACTION_CATEGORY) too.
   * Only when true: they fail closed, so a read for a reader without revenue read never takes them (and they take no
   * place in its limits). A prompt's read passes the reader's revenue sight (readsDocumentExtractions).
   */
  documentExtractions?: boolean;
  /**
   * MEM-UNIFIED-SEMANTIC-SIGHT (D-257, D-234, D-100): the reader's semantic sight (readerSearchOptions for the prompt's
   * reader and module sight). With a query, every semantic hit passes it before the limit is cut. A read with a query and
   * no sight keeps no semantic hit (fail closed): a hit's text is whatever its source holds, an invoice amount included.
   */
  semanticSight?: SemanticSight;
  /**
   * MEM-PATTERNS-SIGHT (D-100, D-234, D-146): read the behavioural patterns (AiMemory rows of category 'patterns') too.
   * Default true. A prompt's read for a reader who may not read every pattern (one stating money or an expense) passes
   * false: a pattern is classified by its text, so none is read, and a withheld pattern takes no place in its limits.
   */
  aiMemoryPatterns?: boolean;
  /**
   * MEM-CLASS-READ (P137, D-257, D-234, D-100): unified reader projection context.
   * When supplied, `UnifiedMemoryRetrievalService` filters by `data_class`, `module_scope`,
   * `PERSONAL` ownership, and fail-closed backstop BEFORE ranking and BEFORE any count/slice
   * so withheld items change nothing the reader sees (design 6.1).
   */
  readerContext?: MemoryReaderContext;
}
