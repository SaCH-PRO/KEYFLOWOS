import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { CanonicalModule } from '../../core/authority/module-vocabulary';
import {
  EVENT_MODULES,
  modulesNamedBy,
  promptMemoryReader,
  readersModuleSight,
  readsDocumentExtractions,
  type ModuleSight,
} from '../key-cortex/key-cortex-prompt-context.service';
import { isMoneyLabel, proposalTextStatesMoney } from '../business-genome/key-genome/genome-finance-scope';
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
}
/** The copy TemporalFlowMemoryService.createMemory embeds of a row: `<entityType>:<type> — <content>`. */
function temporalCopyOf(row: TemporalRow): string {
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
 * entity type), and revenue when a source event is money (a KEY proposal's event, money or sales in its type, module
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

/**
 * MEM-SEMANTIC-SIGHT, shared by MEM-PATTERNS-SIGHT (D-234, D-100, D-146): whether `who` may be handed an AiMemory row
 * (or its semantic copy, `copyContent`). A document extraction (DOCUMENT_EXTRACTION_CATEGORY), and a row whose
 * category, key or value states money, or whose copy does (a pattern totalling overdue invoices, a revenue goal), only
 * to a member reader with revenue read (readsDocumentExtractions); a row stating an expense only to a member reader with
 * expenses read (and revenue read too when it also states money, as "expense: rent TTD 4,000" does); any other row
 * business-wide, as readersOwnPromptMemory serves AiMemory rows.
 */
export function aiMemoryRowVisibleTo(
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
 * MEM-PATTERNS-SIGHT (security review F1), shared by FU-CORTEX-PATTERNS-SIGHT: whether a reader may read every pattern,
 * whatever it states: a member reader with revenue read (readsDocumentExtractions) and expenses read, the two sights
 * aiMemoryRowVisibleTo asks for. A memory read for any other reader passes aiMemoryPatterns: false.
 */
export function readsEveryPattern(reader: string | null, sight: ModuleSight): boolean {
  return reader !== null && readsDocumentExtractions(sight, reader) && sight('expenses');
}

/**
 * FU-CORTEX-PATTERNS-SIGHT (P0; D-257, D-100, D-234): which AiMemory 'patterns' rows a prompt read for `userId` may carry
 * (AiMemoryService.buildContextBlock's patternVisible), by the flow chat's rule (MEM-PATTERNS-SIGHT's
 * turnPatternVisibility) for a turn with no staff position: no requester (a plan no member asked for), no pattern at
 * all; otherwise each row by aiMemoryRowVisibleTo for the requester while a member (promptMemoryReader) and their module
 * sight (readersModuleSight); a requester who is no member keeps only the rows that state neither money nor an expense. A
 * sight that cannot be resolved keeps no pattern (fail closed). The intent parser and the planner use it.
 */
export async function promptPatternVisibility(
  prisma: PrismaService | undefined,
  businessId: string,
  userId: string | null | undefined,
  logger: Pick<Logger, 'warn'>,
  logTag: string,
): Promise<(row: { category: string; key: string; value: string }) => boolean> {
  if (!userId) return () => false;
  try {
    const reader = await promptMemoryReader(prisma, businessId, userId, logger, logTag);
    const sight = await readersModuleSight(prisma, businessId, reader, logger, logTag);
    return (row) => aiMemoryRowVisibleTo(row, { reader, sight });
  } catch (err: unknown) {
    logger.warn(`[${logTag}][${businessId}] reader sight unresolved, no pattern served: ${err instanceof Error ? err.message : String(err)}`);
    return () => false;
  }
}

/**
 * MEM-SEMANTIC-SIGHT: for each hit, whether `who` may be handed it, by its source's own rule (sourceType, sourceId,
 * always within `businessId`):
 * - an AiMemory copy ('memory') as its row: a document extraction (DOCUMENT_EXTRACTION_CATEGORY), and (re-review, D-234
 *   "authorization follows the data's meaning", D-100) a row whose category, key or value states money, or whose copy
 *   does (a pattern totalling overdue invoices, a revenue goal), only to a member reader with revenue read
 *   (readsDocumentExtractions); any other row business-wide, as readersOwnPromptMemory serves AiMemory rows;
 * - a temporal-memory summary ('temporal_memory') when the copy holds what the row holds now (its writer's form,
 *   `<entityType>:<type> — <content>`; a row is rewritten in place and keeps its old copies, whose provenance the row no
 *   longer records: review) and the reader may read every module temporalMemoryModulesOf names;
 * - a knowledge-source chunk ('document'): its KnowledgeSource carries no classification (a statement, a vendor bill or
 *   a menu alike), so only a member reader with revenue and expenses read, as an unclassified document event needs
 *   (MONEY_DOCUMENT_WORDS; D-234 fail closed);
 * - any other source type, or a source not found in the business: nobody (an unresolvable source fails closed).
 * A read that fails raises (re-review): the search then answers nothing, rather than paging on to lower-ranked hits.
 */
export async function semanticHitsVisibleTo(
  prisma: PrismaService,
  businessId: string,
  who: SemanticReader,
  hits: ReadonlyArray<Pick<SemanticMemory, 'sourceType' | 'sourceId' | 'content'>>,
  logger?: Pick<Logger, 'warn'>,
): Promise<boolean[]> {
  try {
    const idsOf = (type: string) => [...new Set(hits.filter((h) => h.sourceType === type).map((h) => h.sourceId))];
    const memoryIds = idsOf(AI_MEMORY_COPY_SOURCE_TYPE);
    const temporalIds = idsOf(TEMPORAL_MEMORY_SOURCE_TYPE);
    const knowledgeIds = [...new Set(idsOf(KNOWLEDGE_CHUNK_SOURCE_TYPE).map(knowledgeSourceIdOf))];

    const [memoryRows, temporalRows, knowledgeRows] = await Promise.all([
      memoryIds.length
        ? prisma.client.aiMemory.findMany({ where: { businessId, id: { in: memoryIds } }, select: { id: true, category: true, key: true, value: true } })
        : [],
      temporalIds.length
        ? prisma.client.temporalFlowMemory.findMany({
            where: { businessId, id: { in: temporalIds } },
            select: { id: true, entityType: true, entityId: true, type: true, metadata: true, sourceModule: true, sourceEventIds: true, content: true },
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

    const memoryRowsById = new Map((memoryRows as Array<{ id: string; category: string; key: string; value: string }>).map((row) => [row.id, row]));
    const temporal = new Map((temporalRows as TemporalRow[]).map((row) => [row.id, row]));
    const knowledge = new Set((knowledgeRows as Array<{ id: string }>).map((row) => row.id));
    const events = new Map(eventRows.map((event) => [event.id, event]));
    const memberWithRevenue = readsDocumentExtractions(who.sight, who.reader);

    return hits.map((hit) => {
      switch (hit.sourceType) {
        case AI_MEMORY_COPY_SOURCE_TYPE: {
          const row = memoryRowsById.get(hit.sourceId);
          return row !== undefined && aiMemoryRowVisibleTo(row, who, hit.content);
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
    });
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
