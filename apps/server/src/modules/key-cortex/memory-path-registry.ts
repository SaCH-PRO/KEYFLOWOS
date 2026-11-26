/**
 * MEM-CENSUS (P107; D-100, D-128, D-227, D-234, D-238, D-254, D-257)
 *
 * Canonical machine-readable registry of every KEY memory read and write path
 * across `apps/server/src`, enforced by `memory-path-census.spec.ts`.
 *
 * Scope (10 Prisma models / SQL tables):
 *   - AiMemory (`aiMemory` / `ai_memories`)
 *   - AiMemoryEmbedding (`aiMemoryEmbedding` / `ai_memory_embeddings`)
 *   - TemporalFlowMemory (`temporalFlowMemory` / `temporal_flow_memories`)
 *   - CognitionMemory (`cognitionMemory` / `cognition_memories`)
 *   - KeyCortexMemory (`keyCortexMemory` / `key_cortex_memories`)
 *   - GenomeMemoryEvent (`genomeMemoryEvent` / `genome_memory_events`)
 *   - CognitiveEvent (`cognitiveEvent` / `cognitive_events`)
 *   - BusinessEvent (`businessEvent` / `business_events`)
 *   - AiExecutionLog (`aiExecutionLog` / `ai_execution_logs`)
 *   - CortexActionLog (`cortexActionLog` / `cortex_action_logs`)
 *
 * Genome read paths are inventoried and projected by FU-KEY-GENOME-READS-RESIDUAL
 * (`genome-context-for-reader.ts`, `genome-read-projections.ts`, and
 * `__tests__/genome-reads-residual*.spec.ts`); this registry covers the 10
 * memory/event/log stores above and references those genome rows where relevant.
 */

export const MEMORY_STORE_MODELS = [
  'AiMemory',
  'AiMemoryEmbedding',
  'TemporalFlowMemory',
  'CognitionMemory',
  'KeyCortexMemory',
  'GenomeMemoryEvent',
  'CognitiveEvent',
  'BusinessEvent',
  'AiExecutionLog',
  'CortexActionLog',
] as const;

export type MemoryStoreModel = (typeof MEMORY_STORE_MODELS)[number];

export const MEMORY_ACCESS_KINDS = ['read', 'write'] as const;
export type MemoryAccessKind = (typeof MEMORY_ACCESS_KINDS)[number];

export const MEMORY_ACCESS_VIAS = ['prisma', 'raw-sql'] as const;
export type MemoryAccessVia = (typeof MEMORY_ACCESS_VIAS)[number];

export const TENANT_PREDICATE_STATUSES = [
  'yes',
  'no',
  'ambient-only',
  'platform',
] as const;
export type TenantPredicateStatus = (typeof TENANT_PREDICATE_STATUSES)[number];

export const MEMORY_SURFACES = [
  'prompt',
  'api',
  'stream',
  'cache',
  'internal',
  'writer',
] as const;
export type MemorySurface = (typeof MEMORY_SURFACES)[number];

export const MEMORY_PROJECTIONS = [
  'readersOwnPromptMemory',
  'semantic-memory-sight',
  'readersModuleSight',
  'temporal-sight',
  'salience-sight',
  'genome-sight',
  'writer-only',
  'system-internal',
  'unprojected',
  'dormant',
] as const;
export type MemoryProjection = (typeof MEMORY_PROJECTIONS)[number];

/**
 * Planned data classes per D-254 / D-257 (`MEM-CLASS-COLUMNS` / `MEM-CLASS-READ`).
 * `MIXED` denotes a general-purpose store or reader that currently carries rows
 * of multiple classes prior to `MEM-CLASS-COLUMNS` stamping per-row provenance.
 */
export const MEMORY_DATA_CLASSES = [
  'GENERAL',
  'REVENUE',
  'PERSONAL',
  'SECRET_BEARING',
  'UNCLASSIFIED',
  'MIXED',
] as const;
export type MemoryDataClass = (typeof MEMORY_DATA_CLASSES)[number];

export interface MemoryStorePathEntry {
  /** POSIX path relative to `apps/server/src`. */
  file: string;
  /** Enclosing symbol (`ClassName.methodName`, top-level function name, or `<module>`). */
  symbol: string;
  /** One of the 10 models in scope. */
  model: MemoryStoreModel;
  /** Prisma delegate op or raw SQL op (`$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe`). */
  op: string;
  /** Zero-based occurrence index when `(file, symbol, model, op)` appears multiple times in one symbol. */
  occurrenceIndex?: number;
  /** Direction of database access. */
  kind: MemoryAccessKind;
  /** Prisma delegate vs raw SQL. */
  via: MemoryAccessVia;
  /** Whether the DB query itself carries a tenant predicate (`businessId` / `business_id`). */
  tenantPredicate: TenantPredicateStatus;
  /** Surface reached by this access. */
  surface: MemorySurface;
  /** Reader projection applied (closed enum). */
  projection: MemoryProjection;
  /** Planned D-254/D-257 data class carried by rows on this path. */
  dataClass: MemoryDataClass;
  /** Owning packet(s) for gaps, unprojected paths, or dormant paths. */
  followUp?: string;
  /** Concise factual audit note. */
  notes?: string;
}

export interface MemoryServiceWriterEntry {
  /** POSIX path relative to `apps/server/src`. */
  file: string;
  /** Service class name (verified by AST to exist in `file`). */
  className: string;
  /** Service write door methods (each verified by AST to exist on `className`). */
  methods: readonly string[];
  /** Memory store models written through this service door. */
  stores: readonly MemoryStoreModel[];
  /** Planned D-254/D-257 data classes emitted by this writer. */
  dataClasses: readonly MemoryDataClass[];
  /** Downstream packet owning classification / writer updates. */
  followUp: string;
  /** Summary of what this writer persists and its provenance source. */
  notes: string;
}

export interface DormantMemoryPathEntry {
  /** POSIX path relative to `apps/server/src`. */
  file: string;
  /** Class name (verified by AST to exist in `file`). */
  className: string;
  /** Method name on `className` (verified by AST to exist and have 0 live non-test callers). */
  methodName: string;
  /** Why this path is dormant and guarded against gaining a live caller. */
  reason: string;
  /** Owning packet or ruling. */
  followUp: string;
}

export const MEMORY_STORE_PATHS: readonly MemoryStorePathEntry[] = [];

export const MEMORY_SERVICE_WRITERS: readonly MemoryServiceWriterEntry[] = [];

export const DORMANT_MEMORY_PATHS: readonly DormantMemoryPathEntry[] = [];
