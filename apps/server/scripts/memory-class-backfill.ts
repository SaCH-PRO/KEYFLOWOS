#!/usr/bin/env tsx
/**
 * Backfill `data_class` and `module_scope` on legacy memory rows written before
 * `MEM-CLASS-COLUMNS` (P125, D-257) across:
 *   1. `ai_memories`
 *   2. `temporal_flow_memories`
 *   3. `ai_memory_embeddings`
 *
 * Packet: MEM-CLASS-BACKFILL (P133, V1-91; owner rulings D-257, D-254).
 *
 * PROVENANCE REUSE
 *
 * Uses the exact canonical classifiers exported by
 * `apps/server/src/modules/ai/memory-classification.ts` (`classifyAiMemoryWrite`,
 * `classifyTemporalEvent`, `classifyTemporalMemoryWrite`, `classifyEmbeddingWrite`,
 * `mergeMemoryClassifications`) so backfill and live writers never diverge.
 * Every linked-source lookup (`ai_memories`, `temporal_flow_memories`,
 * `temporal_flow_events`, `business_events`, `key_action_proposals`) is strictly
 * scoped to the candidate row's own `business_id` — never cross-tenant. Missing
 * or cross-tenant sources fail closed to `UNCLASSIFIED` (while financial,
 * personal, or secret content/metadata still elevates per the restrictiveness
 * lattice `SECRET_BEARING > PERSONAL > REVENUE > UNCLASSIFIED > GENERAL`).
 *
 * SAFETY (D-254)
 *
 * - Dry-run by default: writes NOTHING to Postgres unless `--apply` is passed.
 * - Output is structured JSON containing ONLY counts per table, per `data_class`,
 *   per `businessId` (tenant), and opaque row cursors — ZERO memory content,
 *   values, summaries, titles, keys, or PII ever printed.
 * - `--apply` writes in bounded batches (`--batch-size`, default 200), ordered by
 *   `id ASC`, updating ONLY rows where `data_class IS NULL` (idempotent on re-run;
 *   never overwrites or downgrades writer-stamped rows).
 * - Resumable via `--cursor=<json>` (per-table last `id`) or `--after-id=<id>`
 *   (when targeting a single `--table`), plus optional `--max-batches=<n>`.
 * - Production `--apply` requires explicit owner authority (D-254).
 *
 * Usage (from apps/server; reads DATABASE_URL from repo-root .env):
 *   pnpm backfill:memory-class                                  # dry-run (default)
 *   pnpm backfill:memory-class --business-id=<id>               # dry-run, single tenant
 *   pnpm backfill:memory-class --table=ai_memories              # dry-run, single table
 *   pnpm backfill:memory-class --apply --batch-size=200         # apply (owner authority)
 *   pnpm backfill:memory-class --apply --cursor='{"ai_memories":"<id>"}'
 *
 * Exit status: 0 done, 1 database error, 2 bad arguments.
 * Runbook: docs/DEPLOY_RUNBOOK.md.
 */
import { db } from '@keyflow/db';
import {
  MEMORY_ROW_DATA_CLASSES,
  classifyAiMemoryWrite,
  classifyEmbeddingWrite,
  classifyTemporalEvent,
  classifyTemporalMemoryWrite,
  isMemoryRowDataClass,
  mergeMemoryClassifications,
  type MemoryClassification,
  type MemoryRowDataClass,
  type TemporalEventProvenance,
} from '../src/modules/ai/memory-classification';

export type BackfillDb = Pick<typeof db, '$queryRawUnsafe' | '$executeRawUnsafe'>;

/** Ordered so source tables are classified before embedding copies. */
export const MEMORY_CLASS_BACKFILL_TABLES = [
  'ai_memories',
  'temporal_flow_memories',
  'ai_memory_embeddings',
] as const;

export type MemoryClassBackfillTable = (typeof MEMORY_CLASS_BACKFILL_TABLES)[number];

export const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 5_000;
const SOURCE_LOOKUP_CHUNK = 5_000;

export type DataClassCounts = Record<MemoryRowDataClass, number>;

export type MemoryClassBackfillCursor = Partial<Record<MemoryClassBackfillTable, string | null>>;

export interface MemoryClassBackfillOptions {
  /** Default false (dry-run, D-254: writes nothing to Postgres). */
  apply?: boolean;
  /** Maximum rows scanned/updated per batch (default 200, max 5000). */
  batchSize?: number;
  /** Optional cap on total batches executed in this invocation (for bounded/resumable runs). */
  maxBatches?: number;
  /** Optional single-tenant filter. */
  businessId?: string;
  /** Optional multi-tenant filter. */
  businessIds?: string[];
  /** Optional table subset (defaults to all 3 tables in dependency order). */
  tables?: MemoryClassBackfillTable[];
  /** Resumable per-table cursor (last processed `id` per table). */
  cursor?: MemoryClassBackfillCursor;
}

export interface TableBackfillReport {
  scanned: number;
  updated: number;
  batches: number;
  byClass: DataClassCounts;
  byTenant: Record<string, DataClassCounts>;
  lastId: string | null;
  done: boolean;
}

export interface MemoryClassBackfillReport {
  mode: 'dry-run' | 'apply';
  completed: boolean;
  batchSize: number;
  tables: Record<MemoryClassBackfillTable, TableBackfillReport>;
  totals: {
    scanned: number;
    updated: number;
    byClass: DataClassCounts;
  };
  nextCursor: MemoryClassBackfillCursor;
}

export type ParsedCliArgs =
  | {
      apply: boolean;
      batchSize: number;
      maxBatches?: number;
      businessIds: string[];
      tables?: MemoryClassBackfillTable[];
      cursor: MemoryClassBackfillCursor;
    }
  | { error: string };

interface AiMemoryRow {
  id: string;
  business_id: string;
  category: string;
  key: string;
  value: string;
  source: string | null;
  data_class: string | null;
  module_scope: string[] | null;
}

interface TemporalFlowMemoryRow {
  id: string;
  business_id: string;
  entity_type: string;
  entity_id: string | null;
  type: string;
  content: string;
  source_event_ids: string[] | null;
  source_module: string;
  metadata: unknown;
  data_class: string | null;
  module_scope: string[] | null;
}

interface TemporalFlowEventRow {
  id: string;
  business_id: string;
  source: string | null;
  type: string | null;
  module: string | null;
  entity_type: string | null;
  title: string | null;
  summary: string | null;
  description: string | null;
}

interface BusinessEventRow {
  id: string;
  business_id: string;
  event_type: string | null;
  subject_type: string | null;
  action: string | null;
  source: string | null;
}

interface KeyActionProposalRow {
  id: string;
  business_id: string;
  module: string | null;
  tool_name: string | null;
  action_type: string | null;
  title: string | null;
  summary: string | null;
  description: string | null;
}

interface EmbeddingRow {
  id: string;
  business_id: string;
  content: string;
  source_type: string;
  source_id: string;
  metadata: unknown;
  data_class: string | null;
  module_scope: string[] | null;
}

interface PlannedUpdate {
  id: string;
  business_id: string;
  data_class: MemoryRowDataClass;
  module_scope: string[];
}

function emptyClassCounts(): DataClassCounts {
  return {
    GENERAL: 0,
    REVENUE: 0,
    PERSONAL: 0,
    SECRET_BEARING: 0,
    UNCLASSIFIED: 0,
  };
}

function emptyTableReport(lastId: string | null, done: boolean): TableBackfillReport {
  return {
    scanned: 0,
    updated: 0,
    batches: 0,
    byClass: emptyClassCounts(),
    byTenant: {},
    lastId,
    done,
  };
}

function recordRowCount(
  report: TableBackfillReport,
  businessId: string,
  dataClass: MemoryRowDataClass,
): void {
  report.scanned += 1;
  report.byClass[dataClass] += 1;
  let tenantCounts = report.byTenant[businessId];
  if (!tenantCounts) {
    tenantCounts = emptyClassCounts();
    report.byTenant[businessId] = tenantCounts;
  }
  tenantCounts[dataClass] += 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBackfillTable(value: string): value is MemoryClassBackfillTable {
  return (MEMORY_CLASS_BACKFILL_TABLES as readonly string[]).includes(value);
}

function tenantKey(businessId: string, id: string): string {
  return `${businessId}\0${id}`;
}

/** Extracts string tags from optional metadata.tags. */
function metadataTagsOf(metadata: unknown): string[] | null {
  if (!isPlainObject(metadata) || !Array.isArray(metadata.tags)) return null;
  const tags = metadata.tags.filter((item): item is string => typeof item === 'string');
  return tags.length > 0 ? tags : null;
}

/** True when metadata.eventCount proves the summary aggregated more events than sourceEventIds records. */
function metadataReportsMissingEvents(metadata: unknown, sourceEventIdsCount: number): boolean {
  if (!isPlainObject(metadata)) return false;
  const counted = metadata.eventCount;
  return counted !== undefined && counted !== null && !(typeof counted === 'number' && counted <= sourceEventIdsCount);
}

/**
 * Fetches `temporal_flow_events` strictly scoped to each owning `business_id`.
 * Never reads across tenants.
 */
async function loadTenantTemporalEvents(
  database: BackfillDb,
  idsByBusiness: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<Map<string, TemporalEventProvenance>> {
  const result = new Map<string, TemporalEventProvenance>();
  for (const [businessId, idSet] of idsByBusiness.entries()) {
    const ids = [...idSet].filter(Boolean);
    for (let at = 0; at < ids.length; at += SOURCE_LOOKUP_CHUNK) {
      const slice = ids.slice(at, at + SOURCE_LOOKUP_CHUNK);
      const rows = (await database.$queryRawUnsafe(
        `SELECT id, business_id, source, type, module, entity_type, title, summary, description
           FROM temporal_flow_events
          WHERE business_id = $1 AND id = ANY($2::text[])`,
        businessId,
        slice,
      )) as TemporalFlowEventRow[];
      for (const r of rows) {
        if (r.business_id !== businessId) continue;
        result.set(tenantKey(businessId, r.id), {
          id: r.id,
          source: r.source,
          type: r.type,
          module: r.module,
          entityType: r.entity_type,
          title: r.title,
          summary: r.summary,
          description: r.description,
        });
      }
    }
  }
  return result;
}

/**
 * Fetches `business_events` strictly scoped to each owning `business_id`.
 * Never reads across tenants.
 */
async function loadTenantBusinessEvents(
  database: BackfillDb,
  idsByBusiness: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<Map<string, BusinessEventRow>> {
  const result = new Map<string, BusinessEventRow>();
  for (const [businessId, idSet] of idsByBusiness.entries()) {
    const ids = [...idSet].filter(Boolean);
    for (let at = 0; at < ids.length; at += SOURCE_LOOKUP_CHUNK) {
      const slice = ids.slice(at, at + SOURCE_LOOKUP_CHUNK);
      const rows = (await database.$queryRawUnsafe(
        `SELECT id, business_id, event_type, subject_type, action, source
           FROM business_events
          WHERE business_id = $1 AND id = ANY($2::text[])`,
        businessId,
        slice,
      )) as BusinessEventRow[];
      for (const r of rows) {
        if (r.business_id !== businessId) continue;
        result.set(tenantKey(businessId, r.id), r);
      }
    }
  }
  return result;
}

/**
 * Fetches `key_action_proposals` strictly scoped to each owning `business_id`.
 * Never reads across tenants.
 */
async function loadTenantActionProposals(
  database: BackfillDb,
  idsByBusiness: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<Map<string, KeyActionProposalRow>> {
  const result = new Map<string, KeyActionProposalRow>();
  for (const [businessId, idSet] of idsByBusiness.entries()) {
    const ids = [...idSet].filter(Boolean);
    for (let at = 0; at < ids.length; at += SOURCE_LOOKUP_CHUNK) {
      const slice = ids.slice(at, at + SOURCE_LOOKUP_CHUNK);
      const rows = (await database.$queryRawUnsafe(
        `SELECT id, business_id, module, tool_name, action_type, title, summary, description
           FROM key_action_proposals
          WHERE business_id = $1 AND id = ANY($2::text[])`,
        businessId,
        slice,
      )) as KeyActionProposalRow[];
      for (const r of rows) {
        if (r.business_id !== businessId) continue;
        result.set(tenantKey(businessId, r.id), r);
      }
    }
  }
  return result;
}

function addTenantLookupId(
  map: Map<string, Set<string>>,
  businessId: string,
  id: string | null | undefined,
): void {
  if (!id) return;
  let set = map.get(businessId);
  if (!set) {
    set = new Set<string>();
    map.set(businessId, set);
  }
  set.add(id);
}

/** Classifies a single `temporal_flow_memories` row using its same-tenant resolved events. */
function classifyTemporalFlowMemoryRow(
  row: TemporalFlowMemoryRow,
  eventsByTenantKey: ReadonlyMap<string, TemporalEventProvenance>,
): MemoryClassification {
  const sourceEventIds = Array.isArray(row.source_event_ids) ? row.source_event_ids : [];
  const isOpaqueCortex = row.entity_type === 'business' || row.source_module === 'key_cortex';

  const resolvedEvents: TemporalEventProvenance[] = [];
  let hasMissingSourceEvents = false;

  if (!isOpaqueCortex && sourceEventIds.length > 0) {
    const uniqueIds = [...new Set(sourceEventIds)];
    for (const evId of uniqueIds) {
      const ev = eventsByTenantKey.get(tenantKey(row.business_id, evId));
      if (ev) resolvedEvents.push(ev);
      else hasMissingSourceEvents = true;
    }
  }
  if (!isOpaqueCortex && metadataReportsMissingEvents(row.metadata, sourceEventIds.length)) {
    hasMissingSourceEvents = true;
  }

  const derived = classifyTemporalMemoryWrite({
    entityType: row.entity_type,
    entityId: row.entity_id,
    type: row.type,
    sourceModule: row.source_module,
    content: row.content,
    sourceEvents: resolvedEvents,
    sourceEventIds,
    hasMissingSourceEvents,
    tags: metadataTagsOf(row.metadata),
    explicitDataClass: isMemoryRowDataClass(row.data_class) ? row.data_class : null,
    explicitModuleScope: Array.isArray(row.module_scope) ? row.module_scope : null,
  });

  if (isMemoryRowDataClass(row.data_class)) {
    return mergeMemoryClassifications([
      { dataClass: row.data_class, moduleScope: row.module_scope },
      derived,
    ]);
  }
  return derived;
}

/** Builds WHERE clause and bind parameters for cursor-ordered legacy candidate selection. */
function buildBatchSelectWhere(
  businessIds: readonly string[],
  afterId: string | null,
  batchSize: number,
): { whereSql: string; limitPlaceholder: string; params: unknown[] } {
  const clauses = ['data_class IS NULL'];
  const params: unknown[] = [];

  if (businessIds.length > 0) {
    params.push(businessIds);
    clauses.push(`business_id = ANY($${params.length}::text[])`);
  }
  if (afterId !== null) {
    params.push(afterId);
    clauses.push(`id > $${params.length}::text`);
  }
  params.push(batchSize);
  const limitPlaceholder = `$${params.length}::int`;
  return {
    whereSql: clauses.join(' AND '),
    limitPlaceholder,
    params,
  };
}

/**
 * Applies a batch of classifications idempotently in a single parameterized statement.
 * `WHERE t.id = v.id AND t.business_id = v.business_id AND t.data_class IS NULL`
 * guarantees:
 *   - tenant-bound match,
 *   - never overwrites or downgrades rows already classified by a live writer or prior run,
 *   - sorted deduplicated union with any pre-existing `module_scope`.
 */
async function applyBatchUpdates(
  database: BackfillDb,
  table: MemoryClassBackfillTable,
  updates: readonly PlannedUpdate[],
): Promise<number> {
  if (updates.length === 0) return 0;
  // `table` is strictly constrained to the closed MemoryClassBackfillTable union.
  const sql = `UPDATE ${table} AS t
    SET data_class = v.data_class,
        module_scope = ARRAY(
          SELECT DISTINCT x
          FROM unnest(
            COALESCE(t.module_scope, ARRAY[]::text[]) ||
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v.module_scope)), ARRAY[]::text[])
          ) AS x
          WHERE x IS NOT NULL
          ORDER BY x
        )
    FROM jsonb_to_recordset($1::jsonb) AS v(id text, business_id text, data_class text, module_scope jsonb)
    WHERE t.id = v.id
      AND t.business_id = v.business_id
      AND t.data_class IS NULL`;
  const count = await database.$executeRawUnsafe(sql, JSON.stringify(updates));
  return Number(count ?? 0);
}

async function processAiMemoriesBatch(
  database: BackfillDb,
  businessIds: readonly string[],
  afterId: string | null,
  batchSize: number,
  apply: boolean,
  report: TableBackfillReport,
): Promise<{ rowCount: number; lastId: string | null }> {
  const { whereSql, limitPlaceholder, params } = buildBatchSelectWhere(businessIds, afterId, batchSize);
  const rows = (await database.$queryRawUnsafe(
    `SELECT id, business_id, category, key, value, source, data_class, module_scope
       FROM ai_memories
      WHERE ${whereSql}
      ORDER BY id ASC
      LIMIT ${limitPlaceholder}`,
    ...params,
  )) as AiMemoryRow[];

  if (rows.length === 0) return { rowCount: 0, lastId: afterId };

  const updates: PlannedUpdate[] = [];
  for (const r of rows) {
    const classified = classifyAiMemoryWrite({
      category: r.category,
      key: r.key,
      value: r.value,
      source: r.source,
      explicitModuleScope: Array.isArray(r.module_scope) ? r.module_scope : null,
    });
    recordRowCount(report, r.business_id, classified.dataClass);
    updates.push({
      id: r.id,
      business_id: r.business_id,
      data_class: classified.dataClass,
      module_scope: classified.moduleScope,
    });
  }

  if (apply) {
    report.updated += await applyBatchUpdates(database, 'ai_memories', updates);
  }
  const lastId = rows[rows.length - 1].id;
  report.lastId = lastId;
  report.batches += 1;
  return { rowCount: rows.length, lastId };
}

async function processTemporalMemoriesBatch(
  database: BackfillDb,
  businessIds: readonly string[],
  afterId: string | null,
  batchSize: number,
  apply: boolean,
  report: TableBackfillReport,
): Promise<{ rowCount: number; lastId: string | null }> {
  const { whereSql, limitPlaceholder, params } = buildBatchSelectWhere(businessIds, afterId, batchSize);
  const rows = (await database.$queryRawUnsafe(
    `SELECT id, business_id, entity_type, entity_id, type, content, source_event_ids, source_module, metadata, data_class, module_scope
       FROM temporal_flow_memories
      WHERE ${whereSql}
      ORDER BY id ASC
      LIMIT ${limitPlaceholder}`,
    ...params,
  )) as TemporalFlowMemoryRow[];

  if (rows.length === 0) return { rowCount: 0, lastId: afterId };

  // Collect sourceEventIds per businessId (strictly tenant-isolated)
  const eventIdsByBiz = new Map<string, Set<string>>();
  for (const r of rows) {
    const isOpaqueCortex = r.entity_type === 'business' || r.source_module === 'key_cortex';
    if (isOpaqueCortex) continue;
    for (const evId of r.source_event_ids ?? []) {
      addTenantLookupId(eventIdsByBiz, r.business_id, evId);
    }
  }
  const eventsByKey = await loadTenantTemporalEvents(database, eventIdsByBiz);

  const updates: PlannedUpdate[] = [];
  for (const r of rows) {
    const classified = classifyTemporalFlowMemoryRow(r, eventsByKey);
    recordRowCount(report, r.business_id, classified.dataClass);
    updates.push({
      id: r.id,
      business_id: r.business_id,
      data_class: classified.dataClass,
      module_scope: classified.moduleScope,
    });
  }

  if (apply) {
    report.updated += await applyBatchUpdates(database, 'temporal_flow_memories', updates);
  }
  const lastId = rows[rows.length - 1].id;
  report.lastId = lastId;
  report.batches += 1;
  return { rowCount: rows.length, lastId };
}

async function processEmbeddingsBatch(
  database: BackfillDb,
  businessIds: readonly string[],
  afterId: string | null,
  batchSize: number,
  apply: boolean,
  report: TableBackfillReport,
): Promise<{ rowCount: number; lastId: string | null }> {
  const { whereSql, limitPlaceholder, params } = buildBatchSelectWhere(businessIds, afterId, batchSize);
  // Intentionally omit the `embedding` vector column from SELECT.
  const rows = (await database.$queryRawUnsafe(
    `SELECT id, business_id, content, source_type, source_id, metadata, data_class, module_scope
       FROM ai_memory_embeddings
      WHERE ${whereSql}
      ORDER BY id ASC
      LIMIT ${limitPlaceholder}`,
    ...params,
  )) as EmbeddingRow[];

  if (rows.length === 0) return { rowCount: 0, lastId: afterId };

  // Group linked source IDs strictly by owning business_id
  const memIdsByBiz = new Map<string, Set<string>>();
  const tfmIdsByBiz = new Map<string, Set<string>>();
  const evIdsByBiz = new Map<string, Set<string>>();
  const actionIdsByBiz = new Map<string, Set<string>>();

  for (const r of rows) {
    switch (r.source_type) {
      case 'memory':
        addTenantLookupId(memIdsByBiz, r.business_id, r.source_id);
        break;
      case 'temporal_memory':
        addTenantLookupId(tfmIdsByBiz, r.business_id, r.source_id);
        break;
      case 'event':
        addTenantLookupId(evIdsByBiz, r.business_id, r.source_id);
        break;
      case 'action':
        addTenantLookupId(actionIdsByBiz, r.business_id, r.source_id);
        break;
      default:
        break;
    }
  }

  // Load linked ai_memories strictly per business_id
  const linkedAiMemories = new Map<string, MemoryClassification>();
  for (const [bizId, idSet] of memIdsByBiz.entries()) {
    const ids = [...idSet];
    for (let at = 0; at < ids.length; at += SOURCE_LOOKUP_CHUNK) {
      const slice = ids.slice(at, at + SOURCE_LOOKUP_CHUNK);
      const memRows = (await database.$queryRawUnsafe(
        `SELECT id, business_id, category, key, value, source, data_class, module_scope
           FROM ai_memories
          WHERE business_id = $1 AND id = ANY($2::text[])`,
        bizId,
        slice,
      )) as AiMemoryRow[];
      for (const m of memRows) {
        if (m.business_id !== bizId) continue;
        const derived = classifyAiMemoryWrite({
          category: m.category,
          key: m.key,
          value: m.value,
          source: m.source,
          explicitDataClass: isMemoryRowDataClass(m.data_class) ? m.data_class : null,
          explicitModuleScope: Array.isArray(m.module_scope) ? m.module_scope : null,
        });
        linkedAiMemories.set(
          tenantKey(bizId, m.id),
          isMemoryRowDataClass(m.data_class)
            ? mergeMemoryClassifications([{ dataClass: m.data_class, moduleScope: m.module_scope }, derived])
            : derived,
        );
      }
    }
  }

  // Load linked temporal_flow_memories strictly per business_id
  const linkedTfmRows: TemporalFlowMemoryRow[] = [];
  const tfmEventIdsByBiz = new Map<string, Set<string>>();
  for (const [bizId, idSet] of tfmIdsByBiz.entries()) {
    const ids = [...idSet];
    for (let at = 0; at < ids.length; at += SOURCE_LOOKUP_CHUNK) {
      const slice = ids.slice(at, at + SOURCE_LOOKUP_CHUNK);
      const tfmRows = (await database.$queryRawUnsafe(
        `SELECT id, business_id, entity_type, entity_id, type, content, source_event_ids, source_module, metadata, data_class, module_scope
           FROM temporal_flow_memories
          WHERE business_id = $1 AND id = ANY($2::text[])`,
        bizId,
        slice,
      )) as TemporalFlowMemoryRow[];
      for (const t of tfmRows) {
        if (t.business_id !== bizId) continue;
        linkedTfmRows.push(t);
        const isOpaqueCortex = t.entity_type === 'business' || t.source_module === 'key_cortex';
        if (!isOpaqueCortex) {
          for (const evId of t.source_event_ids ?? []) {
            addTenantLookupId(tfmEventIdsByBiz, bizId, evId);
          }
        }
      }
    }
  }
  const tfmEventsByKey = await loadTenantTemporalEvents(database, tfmEventIdsByBiz);
  const linkedTemporalMemories = new Map<string, MemoryClassification>();
  for (const t of linkedTfmRows) {
    linkedTemporalMemories.set(
      tenantKey(t.business_id, t.id),
      classifyTemporalFlowMemoryRow(t, tfmEventsByKey),
    );
  }

  // Load linked temporal_flow_events & fallback business_events strictly per business_id
  const linkedEvents = await loadTenantTemporalEvents(database, evIdsByBiz);
  const unresolvedEventIdsByBiz = new Map<string, Set<string>>();
  for (const [bizId, idSet] of evIdsByBiz.entries()) {
    for (const id of idSet) {
      if (!linkedEvents.has(tenantKey(bizId, id))) {
        addTenantLookupId(unresolvedEventIdsByBiz, bizId, id);
      }
    }
  }
  const linkedBusinessEvents = await loadTenantBusinessEvents(database, unresolvedEventIdsByBiz);

  // Load linked key_action_proposals strictly per business_id
  const linkedActions = await loadTenantActionProposals(database, actionIdsByBiz);

  const updates: PlannedUpdate[] = [];
  for (const r of rows) {
    const meta = isPlainObject(r.metadata) ? r.metadata : null;
    let effectiveMeta: Record<string, unknown> | null = meta;
    const key = tenantKey(r.business_id, r.source_id);
    let sourceDataClass: MemoryRowDataClass | null = null;
    let sourceModuleScope: readonly string[] | null = null;

    switch (r.source_type) {
      case 'memory': {
        const src = linkedAiMemories.get(key);
        if (src) {
          sourceDataClass = src.dataClass;
          sourceModuleScope = src.moduleScope;
        } else {
          // Source row missing or owned by another tenant: fail closed (UNCLASSIFIED floor)
          sourceDataClass = 'UNCLASSIFIED';
        }
        break;
      }
      case 'temporal_memory': {
        const src = linkedTemporalMemories.get(key);
        if (src) {
          sourceDataClass = src.dataClass;
          sourceModuleScope = src.moduleScope;
        } else {
          // Source row missing or owned by another tenant: fail closed (UNCLASSIFIED floor)
          sourceDataClass = 'UNCLASSIFIED';
        }
        break;
      }
      case 'event': {
        const ev = linkedEvents.get(key);
        if (ev) {
          const evClass = classifyTemporalEvent(ev);
          sourceDataClass = evClass.dataClass;
          sourceModuleScope = evClass.moduleScope;
          effectiveMeta = {
            ...(meta ?? {}),
            ...(ev.source ? { source: meta?.source ?? ev.source } : {}),
            ...(ev.type ? { type: meta?.type ?? ev.type } : {}),
            ...(ev.module ? { module: meta?.module ?? ev.module } : {}),
            ...(ev.entityType ? { entityType: meta?.entityType ?? ev.entityType } : {}),
            ...(ev.title ? { title: meta?.title ?? ev.title } : {}),
          };
        } else {
          const be = linkedBusinessEvents.get(key);
          if (be) {
            const beClass = classifyTemporalEvent({
              source: be.source,
              type: be.event_type,
              entityType: be.subject_type,
              title: be.action,
            });
            sourceDataClass = beClass.dataClass;
            sourceModuleScope = beClass.moduleScope;
            effectiveMeta = {
              ...(meta ?? {}),
              ...(be.source ? { source: meta?.source ?? be.source } : {}),
              ...(be.event_type ? { type: meta?.type ?? be.event_type } : {}),
              ...(be.subject_type ? { entityType: meta?.entityType ?? be.subject_type } : {}),
              ...(be.action ? { title: meta?.title ?? be.action } : {}),
            };
          } else {
            sourceDataClass = 'UNCLASSIFIED';
          }
        }
        break;
      }
      case 'action': {
        const proposal = linkedActions.get(key);
        if (proposal) {
          const actClass = classifyTemporalEvent({
            module: proposal.module,
            type: proposal.action_type,
            source: proposal.tool_name,
            entityType: null,
            title: proposal.title,
            summary: proposal.summary,
            description: proposal.description,
          });
          sourceDataClass = actClass.dataClass;
          sourceModuleScope = actClass.moduleScope;
          effectiveMeta = {
            ...(meta ?? {}),
            ...(proposal.module ? { module: meta?.module ?? proposal.module } : {}),
            ...(proposal.tool_name ? { toolName: meta?.toolName ?? proposal.tool_name } : {}),
            ...(proposal.action_type ? { action: meta?.action ?? proposal.action_type } : {}),
          };
        } else {
          sourceDataClass = 'UNCLASSIFIED';
        }
        break;
      }
      default:
        break;
    }

    const classified = classifyEmbeddingWrite({
      sourceType: r.source_type,
      content: r.content,
      metadata: effectiveMeta,
      sourceDataClass,
      sourceModuleScope,
      explicitModuleScope: Array.isArray(r.module_scope) ? r.module_scope : null,
    });
    recordRowCount(report, r.business_id, classified.dataClass);
    updates.push({
      id: r.id,
      business_id: r.business_id,
      data_class: classified.dataClass,
      module_scope: classified.moduleScope,
    });
  }

  if (apply) {
    report.updated += await applyBatchUpdates(database, 'ai_memory_embeddings', updates);
  }
  const lastId = rows[rows.length - 1].id;
  report.lastId = lastId;
  report.batches += 1;
  return { rowCount: rows.length, lastId };
}

/**
 * Core reusable runner for `MEM-CLASS-BACKFILL`.
 * Defaults to dry-run (`apply: false`, writes nothing to Postgres).
 */
export async function runMemoryClassBackfill(
  database: BackfillDb,
  options: MemoryClassBackfillOptions = {},
): Promise<MemoryClassBackfillReport> {
  const apply = options.apply === true;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Invalid batchSize (expected integer 1..${MAX_BATCH_SIZE})`);
  }
  const maxBatches = options.maxBatches;
  if (maxBatches !== undefined && (!Number.isInteger(maxBatches) || maxBatches < 1)) {
    throw new Error('Invalid maxBatches (expected positive integer)');
  }

  const businessIds: string[] = [];
  if (options.businessId !== undefined) {
    const trimmed = typeof options.businessId === 'string' ? options.businessId.trim() : '';
    if (!trimmed) {
      throw new Error('Invalid businessId (cannot be empty or whitespace)');
    }
    businessIds.push(trimmed);
  }
  if (options.businessIds !== undefined) {
    for (const rawId of options.businessIds) {
      const trimmed = typeof rawId === 'string' ? rawId.trim() : '';
      if (!trimmed) {
        throw new Error('Invalid businessIds entry (cannot be empty or whitespace)');
      }
      if (!businessIds.includes(trimmed)) businessIds.push(trimmed);
    }
  }

  const selectedTables: MemoryClassBackfillTable[] =
    options.tables && options.tables.length > 0
      ? MEMORY_CLASS_BACKFILL_TABLES.filter((t) => options.tables!.includes(t))
      : [...MEMORY_CLASS_BACKFILL_TABLES];

  const initialCursor: MemoryClassBackfillCursor = { ...(options.cursor ?? {}) };
  const nextCursor: MemoryClassBackfillCursor = { ...initialCursor };

  const tablesReport: Record<MemoryClassBackfillTable, TableBackfillReport> = {
    ai_memories: emptyTableReport(initialCursor.ai_memories ?? null, !selectedTables.includes('ai_memories')),
    temporal_flow_memories: emptyTableReport(
      initialCursor.temporal_flow_memories ?? null,
      !selectedTables.includes('temporal_flow_memories'),
    ),
    ai_memory_embeddings: emptyTableReport(
      initialCursor.ai_memory_embeddings ?? null,
      !selectedTables.includes('ai_memory_embeddings'),
    ),
  };

  let batchesExecuted = 0;
  let stoppedByMaxBatches = false;

  for (const table of selectedTables) {
    if (stoppedByMaxBatches) break;

    const report = tablesReport[table];
    let afterId: string | null = initialCursor[table] ?? null;

    for (;;) {
      if (maxBatches !== undefined && batchesExecuted >= maxBatches) {
        stoppedByMaxBatches = true;
        break;
      }

      const step =
        table === 'ai_memories'
          ? await processAiMemoriesBatch(database, businessIds, afterId, batchSize, apply, report)
          : table === 'temporal_flow_memories'
            ? await processTemporalMemoriesBatch(database, businessIds, afterId, batchSize, apply, report)
            : await processEmbeddingsBatch(database, businessIds, afterId, batchSize, apply, report);

      afterId = step.lastId;
      if (afterId !== null) {
        nextCursor[table] = afterId;
      }

      if (step.rowCount === 0) {
        report.done = true;
        break;
      }

      batchesExecuted += 1;

      if (step.rowCount < batchSize) {
        report.done = true;
        break;
      }

      if (maxBatches !== undefined && batchesExecuted >= maxBatches) {
        stoppedByMaxBatches = true;
        break;
      }
    }
  }

  const totalsByClass = emptyClassCounts();
  let totalScanned = 0;
  let totalUpdated = 0;
  for (const table of MEMORY_CLASS_BACKFILL_TABLES) {
    const r = tablesReport[table];
    totalScanned += r.scanned;
    totalUpdated += r.updated;
    for (const cls of MEMORY_ROW_DATA_CLASSES) {
      totalsByClass[cls] += r.byClass[cls];
    }
  }

  const completed = selectedTables.every((t) => tablesReport[t].done);

  return {
    mode: apply ? 'apply' : 'dry-run',
    completed,
    batchSize,
    tables: tablesReport,
    totals: {
      scanned: totalScanned,
      updated: totalUpdated,
      byClass: totalsByClass,
    },
    nextCursor,
  };
}

/** Parses CLI flags; dry-run is the default unless `--apply` is explicitly passed. */
export function parseArgs(argv: string[]): ParsedCliArgs {
  let apply = false;
  let explicitDryRun = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  let maxBatches: number | undefined;
  const businessIds: string[] = [];
  const tables: MemoryClassBackfillTable[] = [];
  let cursor: MemoryClassBackfillCursor = {};
  let afterId: string | null = null;

  const readValue = (flag: string, arg: string, index: number): { value: string; nextIndex: number } | { error: string } => {
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      const value = arg.slice(eq + 1).trim();
      return value ? { value, nextIndex: index } : { error: `${flag} requires a value` };
    }
    const next = argv[index + 1];
    const trimmed = typeof next === 'string' ? next.trim() : '';
    if (!trimmed || trimmed.startsWith('--')) {
      return { error: `${flag} requires a value` };
    }
    return { value: trimmed, nextIndex: index + 1 };
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      explicitDryRun = true;
      continue;
    }
    if (arg === '--batch-size' || arg.startsWith('--batch-size=')) {
      const parsed = readValue('--batch-size', arg, i);
      if ('error' in parsed) return parsed;
      i = parsed.nextIndex;
      const n = Number(parsed.value);
      if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH_SIZE) {
        return { error: `--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}` };
      }
      batchSize = n;
      continue;
    }
    if (arg === '--max-batches' || arg.startsWith('--max-batches=')) {
      const parsed = readValue('--max-batches', arg, i);
      if ('error' in parsed) return parsed;
      i = parsed.nextIndex;
      const n = Number(parsed.value);
      if (!Number.isInteger(n) || n < 1) {
        return { error: '--max-batches must be a positive integer' };
      }
      maxBatches = n;
      continue;
    }
    if (
      arg === '--business-id' ||
      arg.startsWith('--business-id=') ||
      arg === '--business' ||
      arg.startsWith('--business=')
    ) {
      const parsed = readValue('--business-id', arg, i);
      if ('error' in parsed) return parsed;
      i = parsed.nextIndex;
      if (!businessIds.includes(parsed.value)) businessIds.push(parsed.value);
      continue;
    }
    if (arg === '--table' || arg.startsWith('--table=')) {
      const parsed = readValue('--table', arg, i);
      if ('error' in parsed) return parsed;
      i = parsed.nextIndex;
      if (!isBackfillTable(parsed.value)) {
        return { error: `unknown table '${parsed.value}' (expected ${MEMORY_CLASS_BACKFILL_TABLES.join('|')})` };
      }
      if (!tables.includes(parsed.value)) tables.push(parsed.value);
      continue;
    }
    if (arg === '--after-id' || arg.startsWith('--after-id=')) {
      const parsed = readValue('--after-id', arg, i);
      if ('error' in parsed) return parsed;
      i = parsed.nextIndex;
      afterId = parsed.value;
      continue;
    }
    if (arg === '--cursor' || arg.startsWith('--cursor=')) {
      const parsed = readValue('--cursor', arg, i);
      if ('error' in parsed) return parsed;
      i = parsed.nextIndex;
      try {
        const raw = JSON.parse(parsed.value);
        if (!isPlainObject(raw)) {
          return { error: '--cursor must be a JSON object mapping table names to cursor ids' };
        }
        const validated: MemoryClassBackfillCursor = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!isBackfillTable(k)) {
            return { error: `unknown cursor table '${k}'` };
          }
          if (v !== null && typeof v !== 'string') {
            return { error: `cursor value for '${k}' must be a string or null` };
          }
          validated[k] = v;
        }
        cursor = { ...cursor, ...validated };
      } catch {
        return { error: '--cursor must be valid JSON' };
      }
      continue;
    }
    return { error: `unknown argument '${arg}'` };
  }

  if (apply && explicitDryRun) {
    return { error: 'cannot combine --apply and --dry-run' };
  }

  if (afterId !== null) {
    if (tables.length !== 1) {
      return { error: '--after-id requires exactly one --table=<name>; use --cursor=<json> for multi-table resume' };
    }
    cursor[tables[0]] = afterId;
  }

  return {
    apply,
    batchSize,
    maxBatches,
    businessIds,
    tables: tables.length > 0 ? tables : undefined,
    cursor,
  };
}

/** Error class and code only — never the DB message (which may contain row values or URLs). */
export function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (code ${code})` : name;
}

type Log = (...args: unknown[]) => void;

/**
 * CLI entrypoint. Returns exit status (0 ok, 1 DB error, 2 bad arguments).
 * Prints ONLY structured JSON counts/cursors — zero memory content or PII.
 */
export async function main(
  argv: string[],
  deps: { db?: BackfillDb; log?: Log; error?: Log } = {},
): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;

  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    error(
      `Bad arguments (${parsed.error}). Usage: memory-class-backfill [--apply] [--batch-size=<n>] [--max-batches=<n>] [--business-id=<id> ...] [--table=<ai_memories|temporal_flow_memories|ai_memory_embeddings> ...] [--after-id=<id> | --cursor=<json>]`,
    );
    return 2;
  }

  const database = deps.db ?? db;
  try {
    const report = await runMemoryClassBackfill(database, {
      apply: parsed.apply,
      batchSize: parsed.batchSize,
      maxBatches: parsed.maxBatches,
      businessIds: parsed.businessIds,
      tables: parsed.tables,
      cursor: parsed.cursor,
    });
    log(JSON.stringify(report, null, 2));
    return 0;
  } catch (err: unknown) {
    error(`Memory class backfill failed: ${describeFailure(err)}`);
    return 1;
  }
}

if (require.main === module) {
  void (async () => {
    let code: number;
    try {
      code = await main(process.argv.slice(2));
    } catch (err: unknown) {
      console.error(`Memory class backfill failed: ${describeFailure(err)}`);
      code = 1;
    } finally {
      await db.$disconnect().catch(() => undefined);
    }
    process.exit(code);
  })();
}
