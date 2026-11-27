import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { CanonicalModule } from '../../core/authority/module-vocabulary';
import {
  EVENT_MODULES,
  modulesNamedBy,
  readsDocumentExtractions,
  type ModuleSight,
} from '../key-cortex/key-cortex-prompt-context.service';
import { isMoneyLabel, proposalTextStatesMoney } from '../business-genome/key-genome/genome-finance-scope';
import {
  classifyAiMemoryForRead,
  classifyEmbeddingForRead,
  classifyTemporalMemoryForRead,
  evaluateMemoryClassAccess,
  getMemoryClassReadMode,
  logMemoryClassShadowDiff,
  type MemoryClassShadowDiffEntry,
} from '../key-cortex/memory-class-read-projection';
import { AI_MEMORY_COPY_SOURCE_TYPE, DOCUMENT_EXTRACTION_CATEGORY, type SemanticMemory } from './semantic-memory.service';
import type { SemanticSight } from '../key-cortex/unified-memory.types';

/**
 * MEM-SEMANTIC-SIGHT (P0; D-234, D-227, D-238, D-100, D-128, D-257): who a semantic memory read is for. `reader` is the
 * member whose read it is (promptMemoryReader: the caller while a member, else null); `sight` the modules they may read
 * (readersModuleSight, or a staff position's resolved modules).
 */
export interface SemanticReader {
  reader: string | null;
  sight: ModuleSight;
}

/** How many source-event ids one read takes (well under Postgres's bind-parameter limit). */
const EVENT_READ_CHUNK = 5_000;

/** The ai_memory_embeddings source types a hit can resolve to; any other has no source to resolve and fails closed. */
export const TEMPORAL_MEMORY_SOURCE_TYPE = 'temporal_memory';
export const KNOWLEDGE_CHUNK_SOURCE_TYPE = 'document';

/** Whether free text states money (a money word or a figure): the fail-closed text backstop of design 8.2. */
function textIsMoney(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && (isMoneyLabel(value) || proposalTextStatesMoney(value));
}

/**
 * Acceptance review (D-146: expenses, bills, receipts, budgets and vendors are read at expenses read): whether free text
 * states an expense. The words of the expenses module (MODULE_WORDS) and what a business pays out (rent, payroll,
 * salaries, suppliers, utilities).
 */
const EXPENSE_WORDS =
  /(?<![a-z])(expenses?|expenditures?|bills?|receipts?|budgets?|vendors?|suppliers?|rent|payroll|salar(?:y|ies)|wages?|utilit(?:y|ies)|overheads?|outgoings?|spend(?:s|ing)?|spent|costs?|payables?|purchases?|purchased|procure(?:ment|d)?|reimburs\w*|leases?|landlords?|insurance|premiums?|electricity|fuel|cogs)(?![a-z])/i;
/** Delta review: labels are read word by word, camelCase split ('rentExpense', 'vendorBills'). */
function textIsExpense(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  return EXPENSE_WORDS.test(value) || EXPENSE_WORDS.test(value.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

/** A knowledge chunk's source id: `<knowledgeSourceId>:<chunkIndex>` (KnowledgeIngestionService.ingestText). */
function knowledgeSourceIdOf(sourceId: string): string {
  const at = sourceId.lastIndexOf(':');
  return at > 0 ? sourceId.slice(0, at) : sourceId;
}

interface TemporalRow {
  id: string;
  entityType: string;
  entityId?: string | null;
  type?: string;
  metadata?: unknown;
  sourceModule: string;
  sourceEventIds: string[];
  content: string;
  dataClass?: string | null;
  moduleScope?: string[] | null;
}
/** The copy TemporalFlowMemoryService.createMemory embeds of a row: `<entityType>:<type> — <content>`. */
export function temporalCopyOf(row: Pick<TemporalRow, 'entityType' | 'type' | 'content'>): string {
  return `${row.entityType}:${row.type} — ${row.content}`;
}

interface SourceEvent {
  id: string;
  type: string;
  source: string;
  module: string | null;
  entityType: string | null;
  title: string | null;
  summary: string | null;
  description: string | null;
}

/**
 * MEM-SEMANTIC-SIGHT (design 8.2 taint propagation): the modules a reader needs to see a temporal-memory summary: those
 * its entity type and source module name, the union of those every source event names (its module, type, source and
 * entity type), and revenue when a source event is money (a KEY proposal's event, money or sales in its type, module,
 * or source, or money in its title, summary or description), when the row's own entity type, type or source module
 * names money, or when the summary's own text (or its copy's) states money. A source event that is gone, or that names no
 * module, needs every module (D-227: unclassified fails closed); so does a summary that names none at all, and (review)
 * one that counts more events than it records as its source (metadata.eventCount above sourceEventIds: summarizeChannel
 * records 20 of up to 200), whose provenance is incomplete. The summarised entity's id (a channel's name) names modules
 * too.
 */
export function temporalMemoryModulesOf(row: TemporalRow, events: ReadonlyMap<string, SourceEvent>, copyContent?: string): CanonicalModule[] {
  const modules = new Set<CanonicalModule>(modulesNamedBy(row.entityType, row.sourceModule, row.entityId));
  const add = (list: readonly CanonicalModule[]) => list.forEach((module) => modules.add(module));
  // Re-review: what KEY stored itself (TemporalAdapterService.storeMemory: entity 'business', source module key_cortex,
  // a key the model chose, its tags as sourceEventIds) has no recorded provenance: every module.
  if (row.entityType === 'business' || row.sourceModule === 'key_cortex') add(EVENT_MODULES);
  const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  const counted = meta.eventCount;
  if (counted !== undefined && counted !== null && !(typeof counted === 'number' && counted <= (row.sourceEventIds ?? []).length)) add(EVENT_MODULES);
  for (const id of row.sourceEventIds ?? []) {
    const event = events.get(id);
    if (!event) {
      add(EVENT_MODULES);
      continue;
    }
    const named = modulesNamedBy(event.module, event.type, event.source, event.entityType);
    add(named.length ? named : EVENT_MODULES);
    // Review round 3 (D-234: sales volume is finance by provenance): money or sales in the event's type, module or source
    // (sale.completed, payments, checkout) is revenue too, though the module words name another module.
    if (
      event.entityType === 'key_action_proposal' ||
      [event.type, event.module, event.source].some((label) => isMoneyLabel(label)) ||
      [event.title, event.summary, event.description].some(textIsMoney)
    ) {
      modules.add('revenue');
    }
    // Acceptance review (D-146): an expense in its text needs expenses read too.
    if ([event.title, event.summary, event.description].some(textIsExpense)) modules.add('expenses');
  }
  // Delta review: a summary whose provenance names no module needs every module; the text taints below are added on top
  // of that fallback, never instead of it (an event always adds its own modules, or every module, above).
  if (modules.size === 0) add(EVENT_MODULES);
  if (textIsExpense(row.content) || textIsExpense(copyContent)) modules.add('expenses');
  if (textIsMoney(row.content) || textIsMoney(copyContent) || [row.entityType, row.type, row.sourceModule].some((label) => isMoneyLabel(label))) {
    modules.add('revenue');
  }
  return [...modules];
}

function legacyAiMemoryRowVisibleTo(
  row: { category: string; key: string; value: string },
  who: SemanticReader,
  copyContent?: string,
): boolean {
  const money =
    row.category === DOCUMENT_EXTRACTION_CATEGORY ||
    isMoneyLabel(row.category) ||
    isMoneyLabel(row.key) ||
    textIsMoney(row.value) ||
    textIsMoney(copyContent);
  // Acceptance review (D-146): a row stating an expense needs a member with expenses read.
  // A document extraction keeps its own rule (MEM-DOC-EXTRACTION-SIGHT: revenue read).
  const expense = row.category !== DOCUMENT_EXTRACTION_CATEGORY && [row.category, row.key, row.value, copyContent].some(textIsExpense);
  return (!money || readsDocumentExtractions(who.sight, who.reader)) && (!expense || (who.reader !== null && who.sight('expenses')));
}

/**
 * MEM-SEMANTIC-SIGHT / MEM-CLASS-READ (D-234, D-100, D-146, D-257): whether `who` may be handed an AiMemory row
 * (or its semantic copy, `copyContent`). Under `MEMORY_CLASS_READ=ACTIVE`, decides via the unified `data_class` +
 * `module_scope` projection with fail-closed word-heuristic backstop.
 */
export function aiMemoryRowVisibleTo(
  row: {
    id?: string;
    category: string;
    key: string;
    value: string;
    source?: string | null;
    dataClass?: string | null;
    moduleScope?: readonly string[] | null;
  },
  who: SemanticReader,
  copyContent?: string,
): boolean {
  const mode = getMemoryClassReadMode();
  const legacyAllowed = legacyAiMemoryRowVisibleTo(row, who, copyContent);
  if (mode === 'OFF' || mode === 'SHADOW') {
    return legacyAllowed;
  }
  const classified = classifyAiMemoryForRead(row);
  const decision = evaluateMemoryClassAccess(
    {
      dataClass: classified.dataClass,
      moduleScope: classified.moduleScope,
      hasOwnerColumn: false,
      backstopTexts: [row.category, row.key, row.value, copyContent],
      skipExpenseBackstop: row.category === DOCUMENT_EXTRACTION_CATEGORY,
    },
    who,
  );
  return decision.allowed && legacyAllowed;
}

/**
 * MEM-SEMANTIC-SIGHT / MEM-CLASS-READ: for each hit, whether `who` may be handed it, by its source's own rule
 * (sourceType, sourceId, always within `businessId`) and the unified `data_class` / `module_scope` projection:
 * - an AiMemory copy ('memory') inherits the most restrictive `data_class` & union `module_scope` across the
 *   embedding copy and its live `AiMemory` row;
 * - a temporal-memory summary ('temporal_memory') must hold what the row holds now (`temporalCopyOf(row)`), and
 *   inherits the most restrictive `data_class` & union `module_scope` across the copy, the `TemporalFlowMemory` row,
 *   and (for legacy `data_class IS NULL` rows) its source events;
 * - a knowledge-source chunk ('document') requires a member reader with `revenue` and `expenses` read (D-234 fail closed)
 *   and inherits any stricter embedding `data_class` / `module_scope` (e.g. `SECRET_BEARING`);
 * - any other source type, or a source not found in the business: nobody (fail closed).
 * A read that fails raises: the search then answers nothing, rather than paging on to lower-ranked hits.
 */
export async function semanticHitsVisibleTo(
  prisma: PrismaService,
  businessId: string,
  who: SemanticReader,
  hits: ReadonlyArray<
    Pick<SemanticMemory, 'sourceType' | 'sourceId' | 'content'> & {
      id?: string;
      metadata?: Record<string, unknown> | null;
      dataClass?: string | null;
      moduleScope?: readonly string[] | null;
    }
  >,
  logger?: Pick<Logger, 'warn'>,
): Promise<boolean[]> {
  try {
    const idsOf = (type: string) => [...new Set(hits.filter((h) => h.sourceType === type).map((h) => h.sourceId))];
    const memoryIds = idsOf(AI_MEMORY_COPY_SOURCE_TYPE);
    const temporalIds = idsOf(TEMPORAL_MEMORY_SOURCE_TYPE);
    const knowledgeIds = [...new Set(idsOf(KNOWLEDGE_CHUNK_SOURCE_TYPE).map(knowledgeSourceIdOf))];

    const [memoryRows, temporalRows, knowledgeRows] = await Promise.all([
      memoryIds.length
        ? prisma.client.aiMemory.findMany({
            where: { businessId, id: { in: memoryIds } },
            select: {
              id: true,
              category: true,
              key: true,
              value: true,
              source: true,
              dataClass: true,
              moduleScope: true,
            },
          })
        : [],
      temporalIds.length
        ? prisma.client.temporalFlowMemory.findMany({
            where: { businessId, id: { in: temporalIds } },
            select: {
              id: true,
              entityType: true,
              entityId: true,
              type: true,
              metadata: true,
              sourceModule: true,
              sourceEventIds: true,
              content: true,
              dataClass: true,
              moduleScope: true,
            },
          })
        : [],
      knowledgeIds.length
        ? prisma.client.knowledgeSource.findMany({ where: { businessId, id: { in: knowledgeIds } }, select: { id: true } })
        : [],
    ]);
    const eventIds = [...new Set((temporalRows as TemporalRow[]).flatMap((row) => row.sourceEventIds ?? []))];
    // Re-review: read in chunks (a page of summaries can name many thousands of source events).
    const eventRows: SourceEvent[] = [];
    for (let at = 0; at < eventIds.length; at += EVENT_READ_CHUNK) {
      eventRows.push(
        ...(await prisma.client.temporalFlowEvent.findMany({
          where: { businessId, id: { in: eventIds.slice(at, at + EVENT_READ_CHUNK) } },
          select: { id: true, type: true, source: true, module: true, entityType: true, title: true, summary: true, description: true },
        })),
      );
    }

    type AiMemorySourceRow = {
      id: string;
      category: string;
      key: string;
      value: string;
      source?: string | null;
      dataClass?: string | null;
      moduleScope?: string[] | null;
    };
    const memoryRowsById = new Map((memoryRows as AiMemorySourceRow[]).map((row) => [row.id, row]));
    const temporal = new Map((temporalRows as TemporalRow[]).map((row) => [row.id, row]));
    const knowledge = new Set((knowledgeRows as Array<{ id: string }>).map((row) => row.id));
    const events = new Map(eventRows.map((event) => [event.id, event]));
    const memberWithRevenue = readsDocumentExtractions(who.sight, who.reader);

    const mode = getMemoryClassReadMode();

    const evalLegacy = (hit: (typeof hits)[number]): boolean => {
      switch (hit.sourceType) {
        case AI_MEMORY_COPY_SOURCE_TYPE: {
          const row = memoryRowsById.get(hit.sourceId);
          return row !== undefined && legacyAiMemoryRowVisibleTo(row, who, hit.content);
        }
        case TEMPORAL_MEMORY_SOURCE_TYPE: {
          const row = temporal.get(hit.sourceId);
          if (!row || hit.content !== temporalCopyOf(row)) return false;
          return temporalMemoryModulesOf(row, events, hit.content).every(who.sight);
        }
        case KNOWLEDGE_CHUNK_SOURCE_TYPE:
          return knowledge.has(knowledgeSourceIdOf(hit.sourceId)) && memberWithRevenue && who.sight('expenses');
        default:
          return false;
      }
    };

    if (mode === 'OFF') {
      return hits.map(evalLegacy);
    }

    const evalProjected = (hit: (typeof hits)[number]) => {
      switch (hit.sourceType) {
        case AI_MEMORY_COPY_SOURCE_TYPE: {
          const row = memoryRowsById.get(hit.sourceId);
          if (!row) {
            return { allowed: false, reason: 'missing_source', effectiveDataClass: 'UNCLASSIFIED' as const, effectiveModuleScope: [] as CanonicalModule[] };
          }
          const sourceClass = classifyAiMemoryForRead(row);
          const merged = classifyEmbeddingForRead(hit, sourceClass);
          const decision = evaluateMemoryClassAccess(
            {
              dataClass: merged.dataClass,
              moduleScope: merged.moduleScope,
              hasOwnerColumn: false,
              backstopTexts: [row.category, row.key, row.value, hit.content],
              skipExpenseBackstop: row.category === DOCUMENT_EXTRACTION_CATEGORY,
            },
            who,
          );
          return decision;
        }
        case TEMPORAL_MEMORY_SOURCE_TYPE: {
          const row = temporal.get(hit.sourceId);
          if (!row || hit.content !== temporalCopyOf(row)) {
            return { allowed: false, reason: 'stale_or_missing_temporal', effectiveDataClass: 'UNCLASSIFIED' as const, effectiveModuleScope: [] as CanonicalModule[] };
          }
          const sourceClass = classifyTemporalMemoryForRead(row, events);
          const merged = classifyEmbeddingForRead(hit, sourceClass);
          const legacyMods = temporalMemoryModulesOf(row, events, hit.content);
          const decision = evaluateMemoryClassAccess(
            {
              dataClass: merged.dataClass,
              moduleScope: [...new Set([...merged.moduleScope, ...legacyMods])],
              hasOwnerColumn: false,
              backstopTexts: [row.entityType, row.type, row.sourceModule, row.content, hit.content],
              unclassifiedRequiresAllModules: true,
            },
            who,
          );
          return decision;
        }
        case KNOWLEDGE_CHUNK_SOURCE_TYPE: {
          if (!knowledge.has(knowledgeSourceIdOf(hit.sourceId))) {
            return { allowed: false, reason: 'missing_knowledge_source', effectiveDataClass: 'UNCLASSIFIED' as const, effectiveModuleScope: ['expenses', 'revenue'] as CanonicalModule[] };
          }
          const merged = classifyEmbeddingForRead(hit, {
            dataClass: 'UNCLASSIFIED',
            moduleScope: ['expenses', 'revenue'],
          });
          return evaluateMemoryClassAccess(
            {
              dataClass: merged.dataClass,
              moduleScope: merged.moduleScope,
              hasOwnerColumn: false,
              backstopTexts: [hit.content],
            },
            who,
          );
        }
        default:
          return { allowed: false, reason: 'unknown_source_type', effectiveDataClass: 'UNCLASSIFIED' as const, effectiveModuleScope: [] as CanonicalModule[] };
      }
    };

    if (mode === 'SHADOW') {
      const legacyResults: boolean[] = [];
      let projectedCount = 0;
      const diffs: MemoryClassShadowDiffEntry[] = [];
      for (const hit of hits) {
        const legacyAllowed = evalLegacy(hit);
        const decision = evalProjected(hit);
        legacyResults.push(legacyAllowed);
        if (decision.allowed) projectedCount += 1;
        if (legacyAllowed !== decision.allowed) {
          diffs.push({
            id: hit.id ?? `${hit.sourceType}:${hit.sourceId}`,
            store: 'ai_memory_embedding',
            dataClass: decision.effectiveDataClass,
            moduleScope: decision.effectiveModuleScope,
            legacyAllowed,
            projectedAllowed: decision.allowed,
            reason: decision.reason,
          });
        }
      }
      logMemoryClassShadowDiff(logger ? { warn: (m) => logger.warn(m), log: (m) => logger.warn(m) } : undefined, {
        path: 'semanticHitsVisibleTo',
        businessId,
        readerPresent: who.reader !== null,
        totalCandidates: hits.length,
        legacyCount: legacyResults.filter(Boolean).length,
        projectedCount,
        diffs,
      });
      return legacyResults;
    }

    return hits.map((hit) => evalProjected(hit).allowed);
  } catch (err: unknown) {
    logger?.warn(`[semanticSight][${businessId}] source read failed, no semantic hit served: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * MEM-SEMANTIC-SIGHT: the SemanticMemoryService.search options that make a read `who`'s: every hit passes
 * semanticHitsVisibleTo before the limit is cut (search pages on past withheld hits, so they take no place and change
 * nothing returned), and the copies of document extractions are not even read for a reader who may not see them.
 */
export function readerSearchOptions(
  prisma: PrismaService,
  businessId: string,
  who: SemanticReader,
  logger?: Pick<Logger, 'warn'>,
): SemanticSight {
  // MEM-UNIFIED-SEMANTIC-SIGHT (delta A2): the one place a SemanticSight is made (its brand is type-only).
  return {
    includeDocumentExtractionCopies: readsDocumentExtractions(who.sight, who.reader),
    visibleTo: (hits: SemanticMemory[]) => semanticHitsVisibleTo(prisma, businessId, who, hits, logger),
  } as SemanticSight;
}
